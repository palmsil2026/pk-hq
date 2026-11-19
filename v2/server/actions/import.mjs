// ============================================================
//  นำเข้า/ซิงก์จากชีตเดิม (ประธานกดในแอป · ทีละหน้า · รันซ้ำได้ไม่เบิ้ล)          v2/server/actions/import.mjs
//  import.sources → รายชื่อแหล่ง + รอบล่าสุด · import.run { source, cursor?, run?, limit? } → นำเข้า 1 หน้า คืน next (null = จบ)
//  หน้าเว็บวนเรียกจน next = null (แต่ละหน้าเป็น batch เดียว — หน้าไหนล้ม ของหน้าก่อนอยู่ครบ กดต่อจาก cursor เดิมได้)
// ============================================================
import { Fail, bad, need, text, int, iso } from "../core.mjs";
import { fetchExport } from "../bridge.mjs";
import { SOURCES } from "../import/importers.mjs";

export function defineImport(R) {
  R.define({
    name: "import.sources", roles: ["exec"],
    async run(X) {
      const runs = await X.db.all("SELECT id, source, status, started_at, finished_at, rows_in, inserted, updated, skipped, error FROM sync_runs ORDER BY started_at DESC LIMIT 50");
      return { sources: Object.entries(SOURCES).map(([k, v]) => ({ source: k, label: v.label, local: !!v.local, last: runs.find(r => r.source === k) || null })), bridge: { gas: !!X.env.PK_GAS_URL, key: !!X.env.PK_SYNC_KEY } };
    },
  });
  R.define({
    name: "import.run", roles: ["exec"], write: true, undo: false, label: "นำเข้าข้อมูล",
    input: raw => ({
      source: need(raw.source, "แหล่งข้อมูล", 60), cursor: text(raw.cursor, 40) || "0", run: text(raw.run, 40),
      limit: int(raw.limit === undefined ? 100 : raw.limit, "จำนวนแถวต่อหน้า", { min: 1, max: 300 }),
    }),
    async load(X, input) {
      const src = SOURCES[input.source];
      if (!src) throw bad("ไม่รู้จักแหล่งข้อมูล " + input.source);
      const run = input.run ? await X.db.first("SELECT * FROM sync_runs WHERE id = ?", input.run) : null;
      if (input.run && !run) throw new Fail(404, "not_found", "ไม่พบรอบนำเข้านี้");
      if (run && run.status !== "กำลังทำ") throw new Fail(409, "conflict", "รอบนำเข้านี้จบไปแล้ว — เริ่มรอบใหม่");
      const page = src.local ? { rows: [], next: null, total: 0 } : await fetchExport(X, input.source, input.cursor, input.limit);
      return { src, run, page };
    },
    run: planImport,
  });
}

/** แผนการเขียนของ 1 หน้านำเข้า (ใช้ทั้งปุ่มประธาน import.run และนาฬิกาปลุก server/actions/legacy-cron.mjs) — ctx = { src, run, page } */
export async function planImport(X, input, ctx) {
  const out = await ctx.src.run(X, ctx.page);
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
    : { op: "insert", table: "sync_runs", undo: false, row: { id: runId, source: input.source, kind: "import", started_at: iso(X.now), by: X.staff.id, ...agg } });
  ops.push({ op: "note", entity: "sync_runs", entity_id: runId, after: { source: input.source, tab: ctx.page.tab || "", cursor: input.cursor, ...st } });
  return { ops, undo: false, result: { run: runId, source: input.source, next, status, page: st, problems: out.problems || [], total: ctx.page.total || 0 } };
}
