// ============================================================
//  ประตูเดียวของ API (router) · ตรวจตั๋ว · สิทธิ์ตามบทบาท · ท่อเขียนข้อมูลกลาง       v2/server/app.mjs
//
//  เส้นทาง (ทุกคำตอบเป็น JSON · ข้อความผิดพลาดภาษาไทย):
//    GET  /api/health          ไม่ต้องมีตั๋ว — สุขภาพระบบ + รุ่น (smoke test หลัง deploy)
//    GET  /api/public/staff    ไม่ต้องมีตั๋ว — การ์ดชื่อหน้าเข้าระบบ (ชื่อเล่น + บทบาท · ไม่มี PIN/ลายนิ้วมือ)
//    POST /api/call            ทุกอย่างที่เหลือ — { action, input, as, key, reason } + หัว Authorization: Bearer <ตั๋ว>
//         as   = บทบาทที่กำลังใช้ (แอปที่เปิด) — ต้องเป็นบทบาทของคนนั้นจริง (ประธานใช้ได้ทุกบทบาท)
//         key  = idempotency key (บังคับทุก action เขียน · หน้าเว็บสร้างต่อการกด 1 ครั้ง · กดซ้ำ/เน็ตหลุดส่งซ้ำ = ได้ผลเดิม)
//
//  ผู้กระทำ = จากตั๋ว + ตาราง staff เสมอ (ชื่อ/รหัสที่หน้าเว็บส่งมาไม่ถูกใช้)
//  action เขียน: ด่านอ่าน (auth + กุญแจกันซ้ำ = 1 รอบ) → load (1 รอบ) → batch เดียว (ข้อมูล + audit_log + กันซ้ำ + ย้อน + ธง)
// ============================================================
import { API_VERSION, Fail, bad, denied, needLogin, conflict, iso, thaiDay, thaiHm, newId, auditJson, text } from "./core.mjs";
import { wrapDb, compileOps, translateDbError, isIdemDup } from "./db.mjs";
import { readTicket, sha256Hex } from "./ticket.mjs";

export const ROLES = ["office", "prod", "screen", "deliver", "account", "exec"];
export const ALL_ROLES = ROLES.slice();

// ---- ทะเบียน action ----
export function createRegistry() {
  const map = new Map();
  return {
    /**
     * def = {
     *   name: 'กลุ่ม.คำสั่ง', roles: [...บทบาทที่ทำได้], write: true|false,
     *   input(raw, X) → ค่าที่ตรวจแล้ว (throw bad() เมื่อผิด),
     *   load?(X, input) → ข้อมูลที่ต้องอ่านก่อน (ใช้ X.db.reads เพื่อรวบเป็นรอบเดียว),
     *   run(X, input, ctx) → อ่าน: ผลลัพธ์ · เขียน: { result, ops, label?, undo?: false }
     *   undo?: false | { hours?, guard?(X, undoRow) }   ← ย้อนได้ (ค่าตั้งต้น) จนกว่าขั้นถัดไปรับ
     *   reason?: 'required' | 'optional'                ← ต้องมีเหตุผลไหม (ชิปเหตุผลในแผ่นยืนยัน)
     *   onUnique?(columns) → Fail                        ← แปลงการชน UNIQUE เป็นข้อความไทยของงานนั้น
     *   gate?: true                                      ← ทีมผลิต: รับตั๋ว PIN-ตอนบันทึก (k='g')
     * }
     */
    define(def) {
      if (!def || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(def.name)) throw new Error("ชื่อ action ไม่ถูกแบบ กลุ่ม.คำสั่ง: " + (def && def.name));
      if (map.has(def.name)) throw new Error("action ซ้ำ: " + def.name);
      if (!def.public) {
        if (!Array.isArray(def.roles) || !def.roles.length || def.roles.some(r => ROLES.indexOf(r) < 0)) throw new Error("action " + def.name + " ต้องระบุ roles");
      }
      if (typeof def.run !== "function") throw new Error("action " + def.name + " ไม่มี run");
      map.set(def.name, Object.assign({ write: false, input: () => ({}) }, def));
      return def;
    },
    get: name => map.get(name),
    list: () => [...map.values()],
  };
}

// ---- คำตอบ ----
const json = (status, body, extraHeaders) => new Response(JSON.stringify(body), {
  status,
  headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }, extraHeaders || {}),
});
const failBody = f => ({ ok: false, error: { code: f.code, message: f.message, ...(f.extra || {}) }, ...(f.code === "need_login" ? { needLogin: true } : {}) });

// ---- ตรวจตั๋ว + หาคน (1 รอบคุยกับฐาน: staff + บทบาท + กุญแจกันซ้ำ) ----
async function authenticate(X, token, idemKey) {
  const t = await readTicket(X.env.PK_TICKET_KEY, token, X.now);
  if (!t.ok) {
    if (t.config) throw new Fail(503, "not_configured", t.bad);
    throw needLogin(t.bad);
  }
  const p = t.p;
  const [srows, rrows, irows] = await X.db.reads([
    ["SELECT id, name, nick, status, pin_fp, pf_at, version FROM staff WHERE id = ?", p.sid],
    ["SELECT role FROM staff_roles WHERE staff_id = ? AND active = 1", p.sid],
    ["SELECT staff_id, action, req_hash, result_json FROM idempotency WHERE key = ?", idemKey || "-"],
  ]);
  let s = srows[0];
  const at = iso(X.now);
  if (!s) {
    // คนใหม่ที่เพิ่งเพิ่มในชีต (ยังไม่ได้นำเข้า) — ตั๋วลงชื่อโดย GAS = หลักฐานว่ามีตัวตน + บทบาท ณ เวลาออกตั๋ว → ลงทะเบียนให้เอง
    const roles = (Array.isArray(p.r) ? p.r : []).filter(r => ROLES.indexOf(r) >= 0);
    const nick = text(p.n, 60) || p.sid;
    const stmts = [
      ["INSERT INTO staff(id, name, nick, dept_th, status, pin_fp, pf_at, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        p.sid, nick, nick, "", "ทำงาน", p.pf, Number(p.iat) || 0, "ticket", at, at],
      ...roles.map(r => ["INSERT INTO staff_roles(staff_id, role, active) VALUES (?,?,1) ON CONFLICT DO NOTHING", p.sid, r]),
      ["INSERT INTO audit_log(at, day, staff_id, staff_name, action, entity, entity_id, after_json, reason) VALUES (?,?,?,?,?,?,?,?,?)",
        at, thaiDay(X.now), "system", "", "staff.from_ticket", "staff", p.sid, auditJson({ nick, roles }), "พบตั๋วของพนักงานที่ยังไม่อยู่ในฐาน — ลงทะเบียนจากตั๋ว"],
    ];
    await X.db.batch(stmts);
    s = { id: p.sid, name: nick, nick, status: "ทำงาน", pin_fp: p.pf, pf_at: Number(p.iat) || 0, version: 1 };
    rrows.splice(0, rrows.length, ...roles.map(role => ({ role })));
  }
  if (s.status !== "ทำงาน") throw needLogin("บัญชีของ " + s.nick + " ถูกพักการใช้งาน — ติดต่อผู้ดูแล");
  if (s.pin_fp !== p.pf) {
    if (!s.pin_fp || Number(p.iat) > Number(s.pf_at)) {
      // ตั๋วใหม่กว่าลายนิ้วมือที่จำไว้ = PIN เปลี่ยนแล้ว (GAS ตรวจ PIN ใหม่แล้วถึงออกตั๋วนี้) → จำของใหม่ ตั๋วเก่าทุกใบตายทันที
      await X.db.batch([
        ["UPDATE staff SET pin_fp = ?, pf_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND (pin_fp <> ? ) AND pf_at < ?", p.pf, Number(p.iat), at, s.id, p.pf, Number(p.iat)],
        ["INSERT INTO audit_log(at, day, staff_id, staff_name, action, entity, entity_id, reason) VALUES (?,?,?,?,?,?,?,?)",
          at, thaiDay(X.now), "system", s.nick, "staff.pin_changed", "staff", s.id, "ลายนิ้วมือ PIN เปลี่ยน (ตั๋วใหม่กว่า) — ตั๋วเก่าใช้ไม่ได้แล้ว"],
      ]);
    } else {
      throw needLogin("PIN ของ " + s.nick + " ถูกเปลี่ยนแล้ว — ใส่ PIN ใหม่");
    }
  }
  const roles = rrows.map(r => r.role);
  return { staff: { id: s.id, nick: s.nick, name: s.name }, roles, kind: p.k, idem: irows[0] || null };
}

/** บทบาทที่ใช้ทำคำขอนี้: ต้องเป็นบทบาทของคนนั้น · ประธาน (exec) ใช้ได้ทุกบทบาท (ทุกครั้งจดใน audit ว่าใช้บทบาทไหน) */
function pickRole(auth, asRole, def) {
  const want = String(asRole || "");
  const isExec = auth.roles.indexOf("exec") >= 0;
  if (want) {
    if (ROLES.indexOf(want) < 0) throw bad("ไม่รู้จักบทบาท " + want);
    if (auth.roles.indexOf(want) < 0 && !isExec) throw denied(auth.staff.nick + " ไม่มีสิทธิ์ใช้แอปส่วนนี้");
    if (def.roles.indexOf(want) < 0) throw denied("แอปส่วนนี้ทำรายการนี้ไม่ได้");
    return want;
  }
  const hit = def.roles.find(r => auth.roles.indexOf(r) >= 0) || (isExec ? def.roles[0] : null);
  if (!hit) throw denied(auth.staff.nick + " ไม่มีสิทธิ์ทำรายการนี้");
  return hit;
}

// ---- ท่อเขียนข้อมูลกลาง ----
async function runWrite(X, def, input, idemHit, rawInput) {
  if (!X.reqKey || !/^[A-Za-z0-9_-]{8,80}$/.test(X.reqKey)) throw bad("คำขอบันทึกต้องมีรหัสกันกดซ้ำ (key) — หน้าเว็บรุ่นเก่า กรุณาโหลดใหม่");
  const reqHash = await sha256Hex(def.name + "|" + JSON.stringify(rawInput === undefined ? null : rawInput) + "|" + (X.reason || ""));
  if (idemHit) return replay(X, def, idemHit, reqHash);
  if (def.reason === "required" && !X.reason) throw bad("ต้องเลือกหรือพิมพ์เหตุผล");
  const ctx = def.load ? await def.load(X, input) : {};
  const plan = await def.run(X, input, ctx);
  if (!plan || !Array.isArray(plan.ops)) throw new Error("action " + def.name + " ต้องคืน { result, ops }");
  const { stmts, inverse, audits } = compileOps(X, plan.ops);
  if (!audits.length) throw new Error("action " + def.name + " ไม่ได้เขียนอะไรเลย (ต้องมีอย่างน้อย 1 op ที่ลง audit)");
  const at = iso(X.now), day = thaiDay(X.now);
  const auditSql = audits.map(a => ["INSERT INTO audit_log(at, day, staff_id, staff_name, role, action, entity, entity_id, before_json, after_json, reason, req_key, undo_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    at, day, X.staff.id, X.staff.nick, X.role, def.name, a.entity, a.entity_id, auditJson(a.before), auditJson(a.after), X.reason || "", X.reqKey, X.undoOf || null]);
  let undo = null;
  const undoStmts = [];
  if (def.undo !== false && plan.undo !== false && inverse && inverse.length) {
    const hours = Number((def.undo && def.undo.hours) || X.settings.UNDO_HOURS || 24);
    const id = "U" + newId("", X.now);
    const until = iso(X.now + hours * 3600000);
    undo = { id, label: plan.label || def.label || def.name, until };
    undoStmts.push(["INSERT INTO undo_log(id, audit_id, staff_id, action, entity, entity_id, label, ops_json, until_at, created_at, updated_at) VALUES (?, (SELECT min(id) FROM audit_log WHERE req_key = ?), ?,?,?,?,?,?,?,?,?)",
      id, X.reqKey, X.staff.id, def.name, audits[0].entity, audits[0].entity_id, undo.label, JSON.stringify(inverse), until, at, at]);
  }
  const out = { ok: true, data: plan.result === undefined ? null : plan.result, undo };
  const idemSql = ["INSERT INTO idempotency(key, staff_id, action, req_hash, result_json, at) VALUES (?,?,?,?,?,?)", X.reqKey, X.staff.id, def.name, reqHash, JSON.stringify(out), at];
  try {
    await X.db.batch([...stmts, ...auditSql, ...undoStmts, idemSql]);
  } catch (e) {
    if (isIdemDup(e)) {   // สองคำขอกุญแจเดียวกันมาพร้อมกัน (เน็ตหลุดแล้วส่งซ้ำ) — ตัวแรกบันทึกไปแล้ว คืนผลของตัวแรก
      const hit = await X.db.first("SELECT staff_id, action, req_hash, result_json FROM idempotency WHERE key = ?", X.reqKey);
      if (hit) return replay(X, def, hit, reqHash);
    }
    const f = translateDbError(e, def);
    if (f && f.code === "conflict" && plan.conflictMessage) f.message = plan.conflictMessage;
    throw f || e;
  }
  return out;
}
function replay(X, def, hit, reqHash) {
  if (hit.staff_id !== X.staff.id || hit.action !== def.name || hit.req_hash !== reqHash) {
    throw conflict("รหัสกันกดซ้ำนี้ถูกใช้กับคำขออื่นไปแล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง");
  }
  const r = JSON.parse(hit.result_json);
  r.replayed = true;
  return r;
}

async function loadSettings(X) {
  const rows = await X.db.all("SELECT key, value FROM settings");
  const m = {};
  rows.forEach(r => { m[r.key] = r.value; });
  return m;
}

/**
 * createApp({ registry, gas? }) → { handle(request, env, path) }
 *   registry = ทะเบียน action (server/actions/index.mjs › buildRegistry)
 *   now / idgen ส่งเข้ามาได้ (เทสต์คุมเวลา)
 */
export function createApp(opt) {
  const registry = opt.registry;
  const clock = opt.now || (() => Date.now());

  async function handle(request, env, path) {
    const url = new URL(request.url);
    const p = (path || url.pathname.replace(/^\/api\/?/, "")).replace(/\/+$/, "");
    const X = { env: env || {}, now: clock(), db: null, reason: "", reqKey: "", newId: () => newId("", X.now), registry, fetch: opt.fetch || ((...a) => fetch(...a)) };
    try {
      if (!X.env.DB) throw new Fail(503, "not_configured", "ยังไม่ได้ผูกฐานข้อมูล (DB) — แจ้งผู้ดูแล");
      X.db = wrapDb(X.env.DB);
      if (p === "health" && request.method === "GET") return json(200, await health(X));
      if (p === "public/staff" && request.method === "GET") return json(200, await staffCards(X, url.searchParams.get("role")));
      if (p !== "call") return json(404, failBody(new Fail(404, "not_found", "ไม่มีเส้นทาง /api/" + p)));
      if (request.method !== "POST") return json(405, failBody(new Fail(405, "method", "ต้องส่งแบบ POST")));
      let body;
      try { body = await request.json(); } catch (e) { throw bad("คำขออ่านไม่ได้ (ไม่ใช่ JSON)"); }
      if (!body || typeof body !== "object") throw bad("คำขอว่าง");
      const def = registry.get(String(body.action || ""));
      if (!def) throw new Fail(404, "unknown_action", "ไม่รู้จักคำสั่ง " + String(body.action || "(ว่าง)") + " — หน้าเว็บอาจเก่ากว่าหลังบ้าน ลองโหลดใหม่");
      X.reqKey = def.write ? String(body.key || "") : "";
      X.reason = text(body.reason, 300, "เหตุผล");
      if (def.public) {
        X.settings = await loadSettings(X);
        return json(200, { ok: true, data: await def.run(X, def.input(body.input || {}, X), {}) });
      }
      const auth = request.headers.get("authorization") || "";
      const token = /^Bearer\s+(\S+)$/i.exec(auth);
      const a = await authenticate(X, token ? token[1] : "", X.reqKey);
      // ทีมผลิต: action ที่ติด gate ต้องใช้ตั๋วจาก PIN ที่เพิ่งใส่ตอนกดบันทึก (k='g') — ตั๋วประจำเครื่องใช้แทนไม่ได้
      if (def.gate && a.kind !== "g") throw new Fail(401, "need_pin", "ใส่ PIN เพื่อยืนยันว่าใครบันทึก", { needPin: true });
      X.staff = a.staff; X.roles = a.roles;
      X.role = pickRole(a, body.as, def);
      X.settings = await loadSettings(X);
      const input = def.input(body.input || {}, X);
      if (!def.write) return json(200, { ok: true, data: await def.run(X, input, def.load ? await def.load(X, input) : {}) });
      return json(200, await runWrite(X, def, input, a.idem, body.input));
    } catch (e) {
      const f = e instanceof Fail ? e : translateDbError(e);
      if (f) return json(f.status, failBody(f));
      console.error("pk-v2 error", e && e.stack || e);
      return json(500, failBody(new Fail(500, "server", "หลังบ้านทำงานผิดพลาด (ไม่ใช่ปัญหาเน็ตของคุณ) — ลองอีกครั้ง ถ้ายังไม่ได้แจ้งผู้ดูแล: " + String(e && e.message || e).slice(0, 120))));
    }
  }

  async function health(X) {
    let db = false, migrations = 0;
    try { migrations = Number((await X.db.first("SELECT count(*) AS n FROM d1_migrations")).n) || 0; db = true; }
    catch (e) { try { await X.db.first("SELECT 1 AS one"); db = true; } catch (e2) { db = false; } }
    return { ok: db, api: API_VERSION, at: iso(X.now), day: thaiDay(X.now), hm: thaiHm(X.now), db, migrations, ticketKey: !!X.env.PK_TICKET_KEY, syncKey: !!X.env.PK_SYNC_KEY, gas: !!X.env.PK_GAS_URL };
  }
  async function staffCards(X, role) {
    const rows = await X.db.all(`SELECT s.id, s.nick, group_concat(r.role) AS roles FROM staff s LEFT JOIN staff_roles r ON r.staff_id = s.id AND r.active = 1
      WHERE s.status = 'ทำงาน' GROUP BY s.id ORDER BY s.nick`);
    const list = rows.map(r => ({ id: r.id, nick: r.nick, roles: String(r.roles || "").split(",").filter(Boolean) }))
      .filter(r => !role || r.roles.indexOf(role) >= 0 || r.roles.indexOf("exec") >= 0);
    return { ok: true, data: { staff: list } };
  }

  return { handle };
}
