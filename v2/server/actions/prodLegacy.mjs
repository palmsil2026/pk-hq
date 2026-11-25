// ============================================================
//  นำเข้ารอบผลิตเก่า (ชีต Stock Management › แท็บ ProductionLog ของแอป AppSheet "งานผลิต") — ซิงก์ทางเดียว รันซ้ำเป็นรอบ ๆ ได้
//                                                                                         v2/server/actions/prodLegacy.mjs
//  หัวคอลัมน์จริง: ID · วันที่ · เวลาเริ่มเครื่อง · สถานะ · เวลาเปลี่ยนสี/ปิดเครื่อง · ผู้ปฏิบัติงาน · เครื่อง · ประเภทสินค้า · ขนาด · คอขวด · สี · รูปทรง
//                 ผลิตได้ (ใบ) · เกรด B (ใบ) · ของเสีย (ใบ) · หมายเหตุ · เวลาทำงานสุทธิ · สินค้า · ขนาด (Ref) · SessionID
//  รูปแบบ: วันที่ พ.ศ. d/m/yyyy (หรือ yyyy-mm-dd ที่ GAS แปลงจากช่องวันที่) · เวลา h:mm:ss (หรือ HH:mm) · ผู้ปฏิบัติงาน "ไก่ , กานต์"
//          สถานะ: ปิดงาน / เสร็จสิ้น (= ปิดแล้ว) · กำลังผลิต (ไม่มีเวลาปิด = ค้างจากแอปเดิม)
//  กติกา:
//   · เวลาปิดก่อนเวลาเริ่ม: บวก 1 วันแล้วรอบยาว ≤ RUN_MAX_HOURS (หรือตรงกับ "เวลาทำงานสุทธิ") = กะดึกข้ามเที่ยงคืน
//     ไม่เข้าเกณฑ์ = พิมพ์ผิด → เก็บแถวไว้ (ยอดครบ) แต่ไม่มีเวลาปิด + time_issue (ไม่นับชั่วโมง) + ธงสรุป
//   · ไม่ระบุเครื่อง = เครื่อง "ไม่ระบุเครื่อง" (ไม่อยู่ในผัง ประวัติครบ) + ธงสรุป · ชื่อเครื่องที่ไม่รู้จัก = สร้างเครื่องรอจับคู่ (อยู่ในถาดใต้ผัง)
//   · รันซ้ำ: แถวเนื้อเดิม = ข้าม · แถวที่แอปเดิมแก้/ปิดทีหลัง = อัปเดตตาม ถ้ายังไม่มีใครแตะใน v2 (version = sync_version)
//     ถ้า v2 แก้ไปแล้ว (เช่นปิดย้อนหลัง) = ไม่ทับ + ธง "ยอดไม่ตรง" ให้คนตัดสิน
//   · ประวัติ ไม่แตะสต๊อก · ไม่มีทางเขียนกลับชีตเดิม (สะพานมีแต่คำสั่งอ่าน)
// ============================================================
import { iso, thaiDay, atThai, specKey } from "../core.mjs";
import { sha256Hex } from "../ticket.mjs";
import { thaiDate, intOf, colOf } from "../import/legacy.mjs";
import "./prodLib.mjs";   // ลงทะเบียนตาราง run_crew

const SOURCE = "legacy:stock:ProductionLog";
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const normM = s => String(s || "").replace(/\s+/g, "").toUpperCase();

/** "8:15" · "08:15:30" · "8.15" · "2026-11-10 08:15" · "10/11/2569 8:15:00" → { day?, sec } (วินาทีนับจากเที่ยงคืน) */
export function parseClock(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  let day = "", t = s;
  const dm = /^(\S+)\s+(\d{1,2}[:.]\d{2}(?::\d{2})?)$/.exec(s);
  if (dm) { day = thaiDate(dm[1]); t = dm[2]; if (!day) return null; }
  const m = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), se = Number(m[3] || 0);
  if (h > 24 || mi > 59 || se > 59 || (h === 24 && (mi || se))) return null;
  return { day, sec: h * 3600 + mi * 60 + se };
}
const at = (day, sec) => iso(atThai(day, 0, 0) + sec * 1000);
/** "เวลาทำงานสุทธิ": "7:30:00" · "007:30:00" · "07:30" → นาที (null = อ่านไม่ได้/ไม่มี) */
export function parseNet(v) {
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(String(v == null ? "" : v).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 60 : null;
}
const hm = sec => String(Math.floor(sec / 3600) % 24).padStart(2, "0") + ":" + String(Math.floor(sec / 60) % 60).padStart(2, "0");

/**
 * แถวต้นทาง → เวลาเริ่ม/ปิด + ปัญหาเวลา (ฟังก์ชันล้วน — เทสต์ได้ตรง ๆ)
 *   คืน { day, started_at, ended_at, time_issue, crossed }
 */
export function legacyTimes(dayStr, startStr, endStr, netStr, maxHours) {
  const day = thaiDate(dayStr);
  if (!day) return null;
  const s = parseClock(startStr), e = parseClock(endStr), net = parseNet(netStr);
  const sDay = (s && s.day) || day;
  if (!s) return { day, started_at: at(day, 0), ended_at: "", time_issue: "ไม่มีเวลาเริ่ม" + (String(startStr || "").trim() ? " (\"" + String(startStr).trim() + "\")" : ""), crossed: false };
  const started_at = at(sDay, s.sec);
  if (!e) return { day: sDay, started_at, ended_at: "", time_issue: String(endStr || "").trim() ? "เวลาปิดอ่านไม่ได้ (\"" + String(endStr).trim() + "\")" : "", crossed: false };
  let ended_at = at(e.day || sDay, e.sec);
  if (ended_at >= started_at) return { day: sDay, started_at, ended_at, time_issue: "", crossed: (e.day || sDay) !== sDay };
  if (e.day) return { day: sDay, started_at, ended_at: "", time_issue: "เวลาปิดก่อนเวลาเริ่ม (เริ่ม " + hm(s.sec) + " ปิด " + e.day + " " + hm(e.sec) + ")", crossed: false };
  const next = iso(Date.parse(ended_at) + 864e5);
  const durMin = (Date.parse(next) - Date.parse(started_at)) / 60000;
  const ok = net !== null ? Math.abs(net - durMin) <= 20 : durMin <= Number(maxHours || 20) * 60;
  if (ok) return { day: sDay, started_at, ended_at: next, time_issue: "", crossed: true };
  return { day: sDay, started_at, ended_at: "", time_issue: "เวลาปิดก่อนเวลาเริ่ม (เริ่ม " + hm(s.sec) + " ปิด " + hm(e.sec) + ") น่าจะพิมพ์ผิด", crossed: false };
}

export async function importLegacyRuns(X, page) {
  const st = { inserted: 0, updated: 0, skipped: 0 }, ops = [], problems = [];
  const h = page.head || [];
  const col = { id: colOf(h, "ID"), day: colOf(h, "วันที่"), start: colOf(h, "เวลาเริ่มเครื่อง"), end: colOf(h, "เวลาเปลี่ยนสี/ปิดเครื่อง", "เวลาปิดเครื่อง"), status: colOf(h, "สถานะ"),
    crew: colOf(h, "ผู้ปฏิบัติงาน"), machine: colOf(h, "เครื่อง"), type: colOf(h, "ประเภทสินค้า"), size: colOf(h, "ขนาด"), neck: colOf(h, "คอขวด"), shape: colOf(h, "รูปทรง"), color: colOf(h, "สี"),
    good: colOf(h, "ผลิตได้ (ใบ)", "ผลิตได้"), b: colOf(h, "เกรด B (ใบ)", "เกรด B", "เกรดB"), waste: colOf(h, "ของเสีย (ใบ)", "ของเสีย"), note: colOf(h, "หมายเหตุ"), net: colOf(h, "เวลาทำงานสุทธิ"), session: colOf(h, "SessionID") };
  const missing = ["day", "start", "machine", "type", "good"].filter(k => col[k] < 0);
  if (missing.length) return { ops, stats: st, problems: ["หัวคอลัมน์ไม่ครบ (" + missing.join(", ") + ") — ตรวจหัวชีต ProductionLog จริงก่อน ระบบไม่เดา"], fatal: true };
  const [machines, types, staff] = await X.db.reads([["SELECT id, name, map_label, legacy_name FROM machines"], ["SELECT code, axes FROM product_types"], ["SELECT id, nick FROM staff"]]);
  if (!machines.some(m => m.id === "PET1")) return { ops, stats: st, problems: ["ยังไม่ได้นำเข้าทะเบียนเครื่อง — กดนำเข้า \"ทะเบียนเครื่องจักร + ผัง\" ก่อน"], fatal: true };
  const mBy = new Map();
  for (const m of machines) for (const n of [m.name, m.map_label, m.legacy_name, m.id]) if (n) mBy.set(normM(n), m.id);
  const axes = new Map(types.map(t => [t.code, t.axes]));
  const nick = new Map(staff.map(s => [s.nick, s.id]));
  const g = (r, k) => (col[k] < 0 ? "" : String(r[col[k]] == null ? "" : r[col[k]]).trim());
  const rows = page.rows.filter(r => g(r, "day") || g(r, "id"));
  const keys = await Promise.all(rows.map(async r => g(r, "id") || "h" + (await sha256Hex([g(r, "day"), g(r, "start"), g(r, "machine"), g(r, "session"), g(r, "type"), g(r, "size")].join("|"))).slice(0, 20)));
  const hashes = await Promise.all(rows.map(async r => (await sha256Hex(JSON.stringify(r))).slice(0, 24)));
  const ids = keys.map(k => "L-" + k);
  const map = new Map(), cur = new Map();
  for (const part of chunk(keys, 90)) (await X.db.all(`SELECT source_key, hash FROM import_map WHERE source = ? AND source_key IN (${part.map(() => "?").join(",")})`, SOURCE, ...part)).forEach(x => map.set(x.source_key, x.hash));
  for (const part of chunk(ids, 90)) (await X.db.all(`SELECT * FROM machine_runs WHERE id IN (${part.map(() => "?").join(",")})`, ...part)).forEach(x => cur.set(x.id, x));
  const maxH = Number(X.settings.RUN_MAX_HOURS || 20);
  const now = iso(X.now);
  let stuck = 0, typo = 0, noMachine = 0, newMachines = 0, diff = 0;
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], key = keys[i], id = ids[i];
    if (seen.has(key)) { problems.push("แถว ID " + key + " ซ้ำในชีต — ใช้แถวแรก"); st.skipped++; continue; }
    seen.add(key);
    if (map.get(key) === hashes[i]) { st.skipped++; continue; }
    const tm = legacyTimes(g(r, "day"), g(r, "start"), g(r, "end"), g(r, "net"), maxH);
    if (!tm) { problems.push("รอบ " + key + ": วันที่อ่านไม่ได้ (\"" + g(r, "day") + "\") — ข้าม"); st.skipped++; continue; }
    // เครื่อง
    const mName = g(r, "machine");
    let mid = "NOMACHINE";
    if (!mName) noMachine++;
    else if (mBy.has(normM(mName))) mid = mBy.get(normM(mName));
    else {
      mid = "LM" + (await sha256Hex(normM(mName))).slice(0, 8).toUpperCase();
      ops.push({ op: "raw", sql: "INSERT INTO machines(id, name, map_label, kind, legacy_name, note, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        args: [mid, mName, mName, "อื่น", mName, "เจอในประวัติแอปเดิม ไม่อยู่ในทะเบียน — รอจับคู่ (ประธานวางในผังได้)", "legacy:stock", now, now] });
      mBy.set(normM(mName), mid); newMachines++;
    }
    const statusTxt = g(r, "status");
    const open = !tm.ended_at && !tm.time_issue && statusTxt === "กำลังผลิต";
    const time_issue = tm.time_issue || (!tm.ended_at && !open ? "ไม่มีเวลาปิด" : "");
    if (open) stuck++;
    if (/ก่อนเวลาเริ่ม/.test(tm.time_issue)) typo++;
    const it = { type: g(r, "type"), size: g(r, "size"), neck: g(r, "neck"), shape: g(r, "shape"), color: g(r, "color") };
    const row = {
      machine_id: mid, ...it, spec_key: specKey(it, axes.get(it.type)), started_at: tm.started_at, started_day: tm.day,
      ended_at: tm.ended_at, ended_day: tm.ended_at ? thaiDay(Date.parse(tm.ended_at)) : "", end_kind: tm.ended_at || !open ? "ปิดรอบ" : "",
      good_pcs: intOf(g(r, "good")), grade_b_pcs: intOf(g(r, "b")), waste_pcs: intOf(g(r, "waste")),
      status: open ? "ค้างจากระบบเดิม" : "ปิดแล้ว", note: g(r, "note"), time_issue, chain_id: g(r, "session") ? "LS-" + g(r, "session") : "",
    };
    for (const k of ["good_pcs", "grade_b_pcs", "waste_pcs"]) if (row[k] !== null && row[k] < 0) { problems.push("รอบ " + key + ": จำนวนติดลบ (" + row[k] + ") — เก็บเป็นว่าง"); row[k] = null; }
    const names = g(r, "crew").split(/\s*[,،、]\s*|\s+และ\s+/).map(x => x.trim()).filter(Boolean).slice(0, 8);
    const c = cur.get(id);
    if (!c) {
      ops.push({ op: "insert", table: "machine_runs", undo: false, row: { id, ...row, src: "legacy:stock", sync_version: 1 } });
      st.inserted++;
    } else if (c.version === c.sync_version) {
      const set = {};
      for (const [k, v] of Object.entries(row)) if (c[k] !== v) set[k] = v;
      if (Object.keys(set).length) { set.sync_version = c.version + 1; ops.push({ op: "update", table: "machine_runs", id, expect: c.version, before: c, set, undo: false }); st.updated++; }
      else st.skipped++;
      if (names.length) ops.push({ op: "raw", sql: `UPDATE run_crew SET status = 'ยกเลิก', version = version + 1, updated_at = ? WHERE run_id = ? AND status = 'ใช้งาน' AND name_text NOT IN (${names.map(() => "?").join(",")})`, args: [now, id, ...names] });
    } else {
      // v2 แตะรอบนี้แล้ว (ปิดย้อนหลัง/แก้ยอด) — ไม่ทับ ให้คนตัดสินถ้าต่างกัน
      const differ = ["good_pcs", "grade_b_pcs", "waste_pcs", "ended_at"].filter(k => row[k] !== null && row[k] !== "" && c[k] !== row[k]);
      if (differ.length) {
        diff++;
        ops.push({ op: "flag", kind: "ยอดไม่ตรง", team: "prod", severity: "ดู", entity: "machine_runs", entity_id: id, title: "รอบเก่าที่ปิดใน v2 แล้ว แต่แอปเดิมลงต่างกัน",
          detail: "รอบ " + key + " · ช่องที่ต่าง: " + differ.join(", ") + " — ระบบไม่ทับของที่แก้ใน v2", dedupe_key: "legacy-diff:" + id });
      }
      st.skipped++;
    }
    for (const n of names) ops.push({ op: "raw", sql: `INSERT INTO run_crew(id, run_id, name_text, staff_id, status, src, created_at, updated_at) VALUES (?,?,?,?,'ใช้งาน','legacy:stock',?,?)
      ON CONFLICT(id) DO UPDATE SET status = 'ใช้งาน', staff_id = coalesce(run_crew.staff_id, excluded.staff_id)`, args: [id + "|" + n, id, n, nick.get(n) || null, now, now] });
    ops.push({ op: "raw", sql: `INSERT INTO import_map(source, source_key, entity, entity_id, hash, first_at, last_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(source, source_key) DO UPDATE SET entity = excluded.entity, entity_id = excluded.entity_id, hash = excluded.hash, last_at = excluded.last_at`, args: [SOURCE, key, "machine_runs", id, hashes[i], now, now] });
  }
  if (stuck) ops.push({ op: "flag", kind: "รอบค้าง", team: "prod", title: "รอบเครื่องค้าง \"กำลังผลิต\" จากแอปเดิม", detail: "นำเข้าเป็นสถานะ \"ค้างจากแอปเดิม\" — ที่เพิ่งเริ่มนับว่าเครื่องเดิน · ที่เก่าเกินกำหนดไล่ปิดย้อนหลังในหน้าทีมผลิต › ประวัติ", dedupe_key: "import:legacy:runs:stuck" });
  if (typo) {
    ops.push({ op: "flag", kind: "นำเข้ามีปัญหา", team: "prod", title: "รอบเก่าที่เวลาปิดมาก่อนเวลาเริ่ม (น่าจะพิมพ์ผิด)", detail: "เก็บยอดไว้ครบ แต่ไม่นับชั่วโมงเครื่อง/ใบต่อชั่วโมง — ดูแถวที่มีป้าย \"เวลาผิด\" ในหน้าประวัติ", dedupe_key: "import:legacy:runs:time" });
    problems.push("เวลาปิดก่อนเวลาเริ่ม (พิมพ์ผิด) " + typo + " รอบ — ติดป้ายไว้ ไม่นับชั่วโมง");
  }
  if (noMachine) {
    ops.push({ op: "flag", kind: "นำเข้ามีปัญหา", team: "prod", title: "รอบเก่าที่ไม่ได้ระบุเครื่อง", detail: "เก็บไว้ใต้ \"ไม่ระบุเครื่อง\" (ไม่อยู่ในผัง) — ยอดรวมตามสินค้ายังนับครบ", dedupe_key: "import:legacy:runs:nomachine" });
    problems.push("ไม่ระบุเครื่อง " + noMachine + " รอบ");
  }
  if (newMachines) problems.push("ชื่อเครื่องที่ไม่อยู่ในทะเบียน " + newMachines + " ชื่อ — สร้างไว้ในถาด \"ยังไม่ได้วางในผัง\"");
  if (diff) problems.push("แอปเดิมลงต่างจากที่ปิดใน v2 " + diff + " รอบ — ขึ้นธงแล้ว ไม่ทับ");
  return { ops, stats: st, problems };
}
