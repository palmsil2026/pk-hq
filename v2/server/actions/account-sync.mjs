// ============================================================
//  ซิงก์ชีท "ระบบบัญชี" → D1 (อ่านอย่างเดียว · ห้ามเขียนกลับ)                                   v2/server/actions/account-sync.mjs
//  ทางเข้า 3 ทาง ใช้โค้ดชุดเดียวกัน (planPage) และแหล่งเดียวกัน (source 'acct' — ตัวนำเข้า server/import/acct.mjs):
//    ① account.sync     — ฝ่ายบัญชี/ประธานกด "ซิงก์ตอนนี้" (หน้าเว็บวนเรียกทีละหน้าจน next = null)
//    ② import.run acct  — หน้าประธาน › ทีม › นำเข้า (ของ Foundation · ใช้ตัวนำเข้าตัวเดียวกัน)
//    ③ runAcctSync(env) — นาฬิกาปลุกวันละครั้ง (Cloudflare Worker แยก v2/cron/ — Pages Functions ตั้ง Cron ไม่ได้)
//       ปิดได้จากค่าตั้ง ACCT_SYNC_AUTO = 0 (ไม่ต้อง deploy) · ล้ม = รอบ "ล้มเหลว" + ธงให้ประธานเห็น (ไม่เงียบ)
//  รันซ้ำไม่เบิ้ล · แต่ละหน้า = batch เดียว · ซิงก์แตะเฉพาะแถวจากชีทบัญชี (src acct:*) บิลที่แอปออกเองไม่แตะ
// ============================================================
import { Fail, text, int, iso, thaiDay, newId, auditJson } from "../core.mjs";
import { wrapDb, compileOps, translateDbError } from "../db.mjs";
import { fetchExport } from "../bridge.mjs";
import { importAcct } from "../import/acct.mjs";
import { MONEY_ROLES } from "./account-lib.mjs";

const SOURCE = "acct";

/** อ่านก่อนเขียน: รอบที่ทำค้าง + ข้อมูลหนึ่งหน้าจาก GAS (ลงชื่อสองทาง) */
export async function loadPage(X, input) {
  const run = input.run ? await X.db.first("SELECT * FROM sync_runs WHERE id = ?", input.run) : null;
  if (input.run && !run) throw new Fail(404, "not_found", "ไม่พบรอบซิงก์นี้");
  if (run && (run.source !== SOURCE || run.status !== "กำลังทำ")) throw new Fail(409, "conflict", "รอบซิงก์นี้จบไปแล้ว — เริ่มรอบใหม่");
  const page = await fetchExport(X, SOURCE, input.cursor, input.limit);
  return { run, page };
}
/** แผนการเขียนของหนึ่งหน้า (เหมือน import.run ของ Foundation ทุกช่อง — สมุด sync_runs เดียวกัน) */
export async function planPage(X, input, ctx) {
  const out = await importAcct(X, ctx.page);
  const ops = out.fatal ? [] : out.ops;
  const st = out.stats;
  const next = out.fatal ? null : (ctx.page.next === undefined || ctx.page.next === null ? null : String(ctx.page.next));
  const runId = ctx.run ? ctx.run.id : "SR" + X.newId();
  const status = out.fatal ? "ล้มเหลว" : next === null ? "สำเร็จ" : "กำลังทำ";
  const err = (out.problems || []).slice(0, 20).join(" · ").slice(0, 1500);
  const agg = {
    status, cursor: next || "", pages: (ctx.run ? ctx.run.pages : 0) + 1, rows_in: (ctx.run ? ctx.run.rows_in : 0) + (ctx.page.rows || []).length,
    inserted: (ctx.run ? ctx.run.inserted : 0) + st.inserted, updated: (ctx.run ? ctx.run.updated : 0) + st.updated, skipped: (ctx.run ? ctx.run.skipped : 0) + st.skipped,
    error: [ctx.run ? ctx.run.error : "", err].filter(Boolean).join(" · ").slice(0, 2000), finished_at: status === "กำลังทำ" ? "" : iso(X.now),
  };
  ops.push(ctx.run
    ? { op: "update", table: "sync_runs", id: runId, expect: ctx.run.version, before: ctx.run, set: agg, undo: false }
    : { op: "insert", table: "sync_runs", undo: false, row: { id: runId, source: SOURCE, kind: "import", started_at: iso(X.now), by: X.staff.id, ...agg } });
  ops.push({ op: "note", entity: "sync_runs", entity_id: runId, after: { source: SOURCE, tab: ctx.page.tab || "", cursor: input.cursor, ...st } });
  return { ops, undo: false, label: "ซิงก์ชีทบัญชี", result: { run: runId, next, status, page: st, problems: out.problems || [], total: ctx.page.total || 0, tab: ctx.page.tab || "" } };
}

export function defineAccountSync(R) {
  R.define({
    name: "account.sync", roles: MONEY_ROLES, write: true, undo: false, label: "ซิงก์ชีทบัญชี",
    input: raw => ({ cursor: text(raw.cursor, 40) || "0", run: text(raw.run, 40), limit: int(raw.limit === undefined ? 200 : raw.limit, "จำนวนแถวต่อหน้า", { min: 1, max: 300 }) }),
    load: loadPage,
    run: planPage,
  });
  R.define({
    name: "account.sync_status", roles: MONEY_ROLES,
    async run(X) {
      const [runs, seen] = await X.db.reads([
        ["SELECT r.id, r.status, r.started_at, r.finished_at, r.pages, r.rows_in, r.inserted, r.updated, r.skipped, r.error, r.by, s.nick AS by_nick FROM sync_runs r LEFT JOIN staff s ON s.id = r.by WHERE r.source = 'acct' ORDER BY r.started_at DESC LIMIT 10"],
        ["SELECT count(*) AS n FROM bills WHERE substr(src, 1, 5) = 'acct:' AND status <> 'ยกเลิก'"],
      ]);
      return { asOf: iso(X.now), runs, auto: String(X.settings.ACCT_SYNC_AUTO || "1") !== "0", schedule: "ทุกวันประมาณ 20:00", bills: seen[0].n, bridge: { gas: !!X.env.PK_GAS_URL, key: !!X.env.PK_SYNC_KEY } };
    },
  });
}

// ── ③ นาฬิกาปลุกวันละครั้ง (เรียกจาก v2/cron/acct-sync.mjs) ─────────────────────────────────
//   ผู้กระทำ = "system" (audit จดว่า action acct.sync.cron) · ทุกหน้าเป็น batch เดียวพร้อม audit เหมือนท่อเขียนกลาง
export async function runAcctSync(env, opt) {
  const o = opt || {};
  const clock = o.now || (() => Date.now());
  if (!env || !env.DB) throw new Error("ไม่ได้ผูกฐานข้อมูล DB");
  const X = { env, now: clock(), db: wrapDb(env.DB), staff: { id: "system", nick: "ซิงก์อัตโนมัติ" }, role: "", reason: "", reqKey: "", fetch: o.fetch || ((...a) => fetch(...a)) };
  X.newId = () => newId("", X.now);
  const settings = {};
  (await X.db.all("SELECT key, value FROM settings")).forEach(r => { settings[r.key] = r.value; });
  X.settings = settings;
  if (String(settings.ACCT_SYNC_AUTO || "1") === "0" && !o.force) return { skipped: true, reason: "ปิดซิงก์อัตโนมัติไว้ (ค่าตั้ง ACCT_SYNC_AUTO = 0)" };
  let cursor = "0", run = "", pages = 0, last = null;
  const maxPages = o.maxPages || 60;
  try {
    do {
      X.now = clock();
      X.reqKey = "cron-acct-" + newId("", X.now);
      const input = { cursor, run, limit: o.limit || 200 };
      const ctx = await loadPage(X, input);
      const plan = await planPage(X, input, ctx);
      await writeSystem(X, "acct.sync.cron", plan.ops);
      last = plan.result; run = last.run; cursor = last.next; pages++;
    } while (cursor !== null && pages < maxPages);
    if (cursor !== null) throw new Error("ชีทบัญชียาวเกิน " + maxPages + " หน้า — หยุดไว้ก่อน (รอบหน้าจะทำต่อจากต้น)");
    return { ok: true, run, pages, status: last && last.status, problems: last ? last.problems : [] };
  } catch (e) {
    const msg = (e instanceof Fail ? e.message : String(e && e.message || e)).slice(0, 300);
    X.now = clock(); X.reqKey = "cron-acct-fail-" + newId("", X.now);
    const ops = [{ op: "flag", kind: "นำเข้ามีปัญหา", team: "account", severity: "ด่วน", title: "ซิงก์ชีทบัญชีอัตโนมัติไม่สำเร็จ", detail: msg + " — ตัวเลขบัญชีในแอปอาจไม่ใช่ล่าสุด กด \"ซิงก์ตอนนี้\" ในแอปบัญชี", dedupe_key: "acctsync:fail:" + thaiDay(X.now) },
      { op: "note", entity: "sync_runs", entity_id: run || "", after: { source: SOURCE, error: msg } }];
    if (run) {
      const r = await X.db.first("SELECT * FROM sync_runs WHERE id = ?", run);
      if (r && r.status === "กำลังทำ") ops.push({ op: "update", table: "sync_runs", id: run, expect: r.version, before: r, undo: false, set: { status: "ล้มเหลว", finished_at: iso(X.now), error: [r.error, msg].filter(Boolean).join(" · ").slice(0, 2000) } });
    }
    try { await writeSystem(X, "acct.sync.cron", ops); } catch (e2) { /* ฐานล่มด้วย — ไม่มีอะไรทำได้ */ }
    return { ok: false, error: msg, run, pages };
  }
}
/** เขียนแบบระบบ (ไม่มีคำขอจากหน้าเว็บ) — ops + audit ใน batch เดียว เหมือนท่อเขียนกลาง */
async function writeSystem(X, action, ops) {
  const { stmts, audits } = compileOps(X, ops);
  const at = iso(X.now), day = thaiDay(X.now);
  const auditSql = audits.map(a => ["INSERT INTO audit_log(at, day, staff_id, staff_name, role, action, entity, entity_id, before_json, after_json, reason, req_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    at, day, X.staff.id, X.staff.nick, "", action, a.entity, a.entity_id, auditJson(a.before), auditJson(a.after), "", X.reqKey]);
  try { await X.db.batch([...stmts, ...auditSql]); }
  catch (e) { const f = translateDbError(e); throw f || e; }
}
