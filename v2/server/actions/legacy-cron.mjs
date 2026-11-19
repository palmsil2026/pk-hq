// ============================================================
//  นาฬิกาปลุกนำเข้ารอบผลิตจากแอปเดิม (Stock Management › ProductionLog) วันละ 2 รอบ — ช่วงเปลี่ยนผ่านที่ทีมผลิตยังลงแอปเดิม
//                                                                                         v2/server/actions/legacy-cron.mjs
//  เรียกจาก v2/cron/worker.mjs (Cloudflare Worker แยก — Pages Functions ตั้ง Cron ไม่ได้) · ตัวนำเข้าตัวเดียวกับปุ่ม "นำเข้า" ของประธาน
//    (SOURCES['legacy:stock:ProductionLog'] · planImport ของ import.run) → รันซ้ำได้ไม่เบิ้ล · ไม่ทับที่แก้ใน v2 · ไม่แตะสต๊อก · ไม่เขียนกลับชีต
//  ปิดได้จากค่าตั้ง LEGACY_RUNS_AUTO = 0 (ไม่ต้อง deploy) · ล้ม/หัวคอลัมน์ไม่ครบ = รอบ "ล้มเหลว" + ธงด่วนให้ประธานเห็น (ไม่เงียบ)
//  รันในเครื่องทดสอบได้โดยไม่มีกุญแจ Cloudflare: tests/legacy-cron.test.mjs · node --no-warnings tools/cron-local.mjs legacy
// ============================================================
import { Fail, iso, thaiDay, newId, auditJson } from "../core.mjs";
import { wrapDb, compileOps, translateDbError } from "../db.mjs";
import { fetchExport } from "../bridge.mjs";
import { SOURCES } from "../import/importers.mjs";
import { planImport } from "./import.mjs";

export const LEGACY_RUNS_SOURCE = "legacy:stock:ProductionLog";

/** env = { DB, PK_GAS_URL, PK_SYNC_KEY } · opt = { now, fetch, force, limit, maxPages } */
export async function runLegacyRunsSync(env, opt) {
  const o = opt || {};
  const clock = o.now || (() => Date.now());
  if (!env || !env.DB) throw new Error("ไม่ได้ผูกฐานข้อมูล DB");
  const X = { env, now: clock(), db: wrapDb(env.DB), staff: { id: "system", nick: "นำเข้าอัตโนมัติ" }, role: "", reason: "", reqKey: "", fetch: o.fetch || ((...a) => fetch(...a)) };
  X.newId = () => newId("", X.now);
  const settings = {};
  (await X.db.all("SELECT key, value FROM settings")).forEach(r => { settings[r.key] = r.value; });
  X.settings = settings;
  if (String(settings.LEGACY_RUNS_AUTO || "1") === "0" && !o.force) return { skipped: true, reason: "ปิดนำเข้ารอบผลิตอัตโนมัติไว้ (ค่าตั้ง LEGACY_RUNS_AUTO = 0)" };
  const src = SOURCES[LEGACY_RUNS_SOURCE];
  let cursor = "0", run = null, pages = 0, last = null;
  const maxPages = o.maxPages || 80, limit = o.limit || 200;
  try {
    do {
      X.now = clock();
      X.reqKey = "cron-legacy-runs-" + newId("", X.now);
      const input = { source: LEGACY_RUNS_SOURCE, cursor, run: run ? run.id : "", limit };
      const page = await fetchExport(X, LEGACY_RUNS_SOURCE, cursor, limit);
      const plan = await planImport(X, input, { src, run, page });
      await writeSystem(X, "import.cron", plan.ops);
      last = plan.result; pages++;
      if (last.status === "ล้มเหลว") throw new Error("นำเข้าไม่ได้: " + (last.problems || []).slice(0, 3).join(" · "));
      run = await X.db.first("SELECT * FROM sync_runs WHERE id = ?", last.run);
      cursor = last.next;
    } while (cursor !== null && pages < maxPages);
    if (cursor !== null) throw new Error("แท็บ ProductionLog ยาวเกิน " + maxPages + " หน้า — หยุดไว้ก่อน (รอบหน้าทำใหม่ตั้งแต่ต้น ไม่เบิ้ล)");
    const tot = await X.db.first("SELECT inserted, updated, skipped, rows_in FROM sync_runs WHERE id = ?", last.run);
    return { ok: true, run: last.run, pages, inserted: tot.inserted, updated: tot.updated, skipped: tot.skipped, rows: tot.rows_in, problems: last.problems || [] };
  } catch (e) {
    const msg = (e instanceof Fail ? e.message : String(e && e.message || e)).slice(0, 300);
    X.now = clock(); X.reqKey = "cron-legacy-runs-fail-" + newId("", X.now);
    const ops = [{ op: "flag", kind: "นำเข้ามีปัญหา", team: "prod", severity: "ด่วน", title: "นำเข้ารอบผลิตจากแอปเดิมอัตโนมัติไม่สำเร็จ",
      detail: msg + " — รอบที่ทีมลงในแอปเดิมยังไม่เข้าแอปใหม่ · กดนำเข้าเองได้ที่ ประธาน › ทีม › นำเข้า (รอบผลิตเก่า)", dedupe_key: "legacyruns:fail:" + thaiDay(X.now) }];
    if (run || (last && last.run)) {
      const r = await X.db.first("SELECT * FROM sync_runs WHERE id = ?", (run && run.id) || last.run);
      if (r && r.status === "กำลังทำ") ops.push({ op: "update", table: "sync_runs", id: r.id, expect: r.version, before: r, undo: false, set: { status: "ล้มเหลว", finished_at: iso(X.now), error: [r.error, msg].filter(Boolean).join(" · ").slice(0, 2000) } });
    }
    ops.push({ op: "note", entity: "sync_runs", entity_id: (run && run.id) || (last && last.run) || "", after: { source: LEGACY_RUNS_SOURCE, error: msg } });
    try { await writeSystem(X, "import.cron", ops); } catch (e2) { /* ฐานล่มด้วย — ไม่มีอะไรทำได้ */ }
    return { ok: false, error: msg, pages };
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
