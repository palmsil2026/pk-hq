// ============================================================
//  ทีมผลิต: รอบเครื่อง (แทนแอป AppSheet "งานผลิต") · จอดเครื่อง · เปลี่ยนโมลด์ · ทะเบียนเครื่อง        v2/server/actions/prodRun.mjs
//
//  วงจร:  เปิดรอบ (run.open) ─┬─ เปลี่ยนสี (run.color = ปิดช่วงเดิมพร้อมยอด + เปิดช่วงใหม่ สีใหม่) ─┐
//                              ├─ จอดเครื่อง (run.stop + สาเหตุ) → เดินต่อ (run.resume)              │
//                              └─ ปิดรอบ (run.close ลง ดี / เกรด B / เสีย) ◄──────────────────────┘
//         เปลี่ยนโมลด์ (mold.step: จะเปลี่ยน → กำลังเปลี่ยน → เสร็จ) · แก้ยอดรอบที่ปิดแล้ว (run.fix + เหตุผล)
//  กติกา: ทีมผลิตใส่ PIN ตอนกดบันทึกทุกครั้ง (gate) · คนทำ = จากตั๋ว · ทุกปุ่มย้อนได้ (ของกลาง) จนกว่าขั้นถัดไปรับ
//         ดี = สต๊อกเกรด A · เกรด B แยกบัญชี · เสีย = ไม่เข้าสต๊อก · รอบนำเข้าจากแอปเดิมไม่แตะสต๊อก (ประวัติ)
//         ข้ามเที่ยงคืนได้ (วันเริ่ม/วันปิดแยก) · เปิดซ้ำบนเครื่องที่มีรอบเปิด = 409 พร้อมรอบนั้น (หน้าเว็บพาไปปิด)
//         รอบค้าง (เปิดนานเกิน RUN_STALE_HOURS หรือค้างจากแอปเดิม) ปิดย้อนหลังได้ + เหตุผล + ธง
// ============================================================
import { bad, conflict, notFound, need, text, int, oneOf, iso, thaiDay, thaiHm, specKey, specLabel, newId } from "../core.mjs";
import { readSpec, readWhen, readCrew, crewOps, produceMoves, negativeFlag, stockKey, jobsOps, JOB_OF_RUN, RUN_KINDS, OPEN_RUN } from "./prodLib.mjs";

const ROLES = ["prod"];   // ประธานใช้แอปทีมผลิตได้เอง (as=prod) ตามกติกากลาง
const q = (n, name) => int(n, name, { min: 0, max: 5000000 });
const newJob = (id, it, status) => ({ id, order_id: it.order_id, order_item_id: it.id, type: it.type, size: it.size, neck: it.neck, shape: it.shape, color: it.color, spec_key: it.spec_key, target_pcs: it.qty_pcs, status, due_day: it.due_day || "", urgent: it.urgent ? 1 : 0 });

function openRunInfo(run, machineName, crew) {
  return { id: run.id, machine: machineName, label: specLabel(run), started_at: run.started_at, crew: crew || "", version: run.version, status: run.status };
}
const busyRun = (m, run, crew) => conflict(m.name + " มีรอบเปิดอยู่แล้ว (" + specLabel(run) + " · เริ่ม " + thaiHm(Date.parse(run.started_at)) + (crew ? " · " + crew : "") + ") — ปิดรอบนั้นก่อน",
  { open: openRunInfo(run, m.name, crew) });

/** ย้อนรายการที่ลงยอดเข้าสต๊อก: ถ้าของถูกส่ง/ใช้ไปแล้ว (คงเหลือไม่พอให้หักคืน) = ย้อนไม่ได้ ให้ใช้ "แก้ยอด" พร้อมเหตุผลแทน */
async function stockUndoGuard(X, u) {
  const need = new Map();
  for (const o of JSON.parse(u.ops_json)) if (o.op === "unmove" && o.qty_pcs > 0) { const k = o.item_key + "#" + o.grade; need.set(k, (need.get(k) || 0) + o.qty_pcs); }
  if (!need.size) return;
  const keys = [...need.keys()];
  const rows = await X.db.all(`SELECT item_key || '#' || grade AS k, qty_pcs FROM stock_balance WHERE item_key || '#' || grade IN (${keys.map(() => "?").join(",")})`, ...keys);
  const have = new Map(rows.map(r => [r.k, r.qty_pcs]));
  for (const [k, n] of need) if ((have.get(k) || 0) < n) throw conflict("ของจากรอบนี้ถูกส่ง/ใช้ไปบางส่วนแล้ว (คงเหลือ " + (have.get(k) || 0).toLocaleString("en-US") + " น้อยกว่า " + n.toLocaleString("en-US") + ") — ย้อนไม่ได้ ใช้ \"แก้ยอด\" พร้อมเหตุผลแทน");
}


export function defineProdRuns(R) {
  // ── เปิดรอบ ─────────────────────────────────────────────────────────
  R.define({
    name: "run.open", roles: ROLES, write: true, gate: true, label: "เปิดรอบ",
    input: (raw, X) => ({
      machine: need(raw.machine, "เครื่อง", 40), raw, crew: readCrew(raw.crew, true),
      job: text(raw.job, 40), item: text(raw.item, 60), started_at: readWhen(raw.started_at, X.now, "เวลาเริ่ม", 12), note: text(raw.note, 300, "หมายเหตุ"),
    }),
    async load(X, input) {
      const [m, runs, evs, types, last, jobs, items, ijobs, staff] = await X.db.reads([
        ["SELECT * FROM machines WHERE id = ?", input.machine],
        [`SELECT r.*, (SELECT group_concat(name_text, ' , ') FROM run_crew c WHERE c.run_id = r.id AND c.status = 'ใช้งาน') AS crew FROM machine_runs r WHERE r.machine_id = ? AND r.status = 'กำลังผลิต'`, input.machine],
        ["SELECT * FROM machine_events WHERE machine_id = ? AND ended_at = '' AND status = 'ใช้งาน'", input.machine],
        ["SELECT code, axes FROM product_types"],
        ["SELECT max(ended_at) AS e FROM machine_runs WHERE machine_id = ? AND status = 'ปิดแล้ว' AND ended_at <> ''", input.machine],
        ["SELECT * FROM production_jobs WHERE id = ?", input.job || "-"],
        ["SELECT i.*, o.status AS order_status, o.due_day, o.urgent FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?", input.item || "-"],
        ["SELECT * FROM production_jobs WHERE order_item_id = ? AND status <> 'ยกเลิก' ORDER BY (status = 'เสร็จ'), created_at DESC LIMIT 1", input.item || "-"],
        ["SELECT id, nick FROM staff WHERE status = 'ทำงาน'"],
      ]);
      return { m: m[0], run: runs[0], stop: evs.find(e => e.kind === "จอดเครื่อง"), mold: evs.find(e => e.kind === "เปลี่ยนโมลด์"), types: new Map(types.map(t => [t.code, t.axes])), lastEnd: last[0] && last[0].e, job: jobs[0], item: items[0], itemJob: ijobs[0], nicks: new Map(staff.map(s => [s.nick, s.id])) };
    },
    onUnique: cols => (/machine_runs/.test(cols) ? conflict("เครื่องนี้เพิ่งมีคนเปิดรอบไปพร้อมกัน — โหลดใหม่แล้วดูรอบที่เปิดอยู่") : /production_jobs/.test(cols) ? conflict("มีคนเริ่มงานนี้พร้อมกัน — โหลดใหม่") : null),
    async run(X, input, ctx) {
      const m = ctx.m;
      if (!m || m.status === "เลิกใช้") throw notFound("ไม่พบเครื่องนี้");
      if (RUN_KINDS.indexOf(m.kind) < 0) throw bad(m.name + " เป็นเครื่อง" + m.kind + " — เปิดรอบผลิตได้เฉพาะเครื่องเป่า/เครื่องฉีด");
      if (m.status === "พัก") throw bad(m.name + " ถูกตั้งเป็น \"พักใช้งาน\" — ให้ประธานเปิดใช้ก่อน");
      if (ctx.run) throw busyRun(m, ctx.run, ctx.run.crew);
      if (ctx.mold && ctx.mold.stage === "กำลังเปลี่ยน") throw conflict(m.name + " กำลังเปลี่ยนโมลด์อยู่ — กด \"เปลี่ยนโมลด์เสร็จ\" ก่อนเปิดรอบ", { mold: { id: ctx.mold.id, version: ctx.mold.version } });
      const spec = readSpec(input.raw, ctx.types);
      const start = input.started_at || iso(X.now);
      if (ctx.lastEnd && start < ctx.lastEnd) throw bad("เวลาเริ่มทับรอบก่อนหน้า (ปิดเมื่อ " + thaiHm(Date.parse(ctx.lastEnd)) + ") — เลือกเวลาหลังจากนั้น");
      const ops = [];
      // ผูกงาน (ไม่บังคับ — ไม่ผูก = ผลิตเข้าสต๊อกแบบแอปเดิม) · งานเริ่ม = ออเดอร์ "กำลังผลิต" (ไหลตามกติกาออฟฟิศ)
      let jobId = null;
      if (input.job) {
        const j = ctx.job;
        if (!j) throw notFound("ไม่พบงานนี้ (อาจถูกยกเลิก) — โหลดใหม่");
        if (j.status !== "รอผลิต" && j.status !== "กำลังผลิต") throw conflict("งานนี้ " + j.status + " แล้ว — เลือกงานอื่นหรือผลิตเข้าสต๊อก");
        if (j.spec_key !== spec.spec_key) throw bad("สเปกที่เลือกไม่ตรงกับงาน (" + specLabel(j) + ")");
        jobId = j.id;
        ops.push(...await jobsOps(X, [[j, { status: "กำลังผลิต" }]]));
      } else if (input.item) {
        const it = ctx.item;
        if (!it || it.status !== "ใช้งาน") throw notFound("ไม่พบรายการออเดอร์นี้ (อาจถูกยกเลิก) — โหลดใหม่");
        if (it.spec_key !== spec.spec_key) throw bad("สเปกที่เลือกไม่ตรงกับรายการออเดอร์ (" + specLabel(it) + ")");
        if (ctx.itemJob && ctx.itemJob.status !== "เสร็จ") {
          jobId = ctx.itemJob.id;
          ops.push(...await jobsOps(X, [[ctx.itemJob, { status: "กำลังผลิต" }]]));
        } else {
          if (ctx.itemJob) throw conflict("งานนี้ทำครบแล้ว — ผลิตเข้าสต๊อกแทน หรือให้ออฟฟิศเพิ่มจำนวน");
          jobId = "J" + X.newId();
          ops.push(...await jobsOps(X, [], [newJob(jobId, it, "กำลังผลิต")]));
        }
      }
      // เครื่องจอดอยู่ = เปิดรอบใหม่คือเดินเครื่องต่อ (ปิดเรื่องจอดให้เอง)
      if (ctx.stop) ops.push({ op: "update", table: "machine_events", id: ctx.stop.id, expect: ctx.stop.version, before: ctx.stop, set: { ended_at: start < ctx.stop.started_at ? ctx.stop.started_at : start } });
      const id = "R" + X.newId();
      ops.push({ op: "insert", table: "machine_runs", row: {
        id, machine_id: m.id, job_id: jobId, type: spec.type, size: spec.size, neck: spec.neck, shape: spec.shape, color: spec.color, spec_key: spec.spec_key,
        started_at: start, started_day: thaiDay(Date.parse(start)), status: "กำลังผลิต", opened_by: X.staff.id, note: input.note, chain_id: id, src: "v2",
      } });
      ops.push(...crewOps(id, input.crew, ctx.nicks));
      return { result: { id, machine: m.id, job: jobId }, label: "เปิดรอบ " + m.name + " · " + spec.label, ops };
    },
  });

  // ── เปลี่ยนสี = ปิดช่วงสีเดิมพร้อมยอด + เปิดช่วงใหม่ (ความหมายเดียวกับ "เวลาเปลี่ยนสี/ปิดเครื่อง" ของแอปเดิม) ──
  R.define({
    name: "run.color", roles: ROLES, write: true, gate: true, label: "เปลี่ยนสี",
    input: raw => ({ run: need(raw.run, "รอบ", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), color: need(raw.color, "สีใหม่", 60),
      good: q(raw.good, "ดี (ใบ)"), b: q(raw.b === undefined || raw.b === "" ? 0 : raw.b, "เกรด B (ใบ)"), waste: q(raw.waste === undefined || raw.waste === "" ? 0 : raw.waste, "เสีย (ใบ)"), waste_reason: text(raw.waste_reason, 120), note: text(raw.note, 300) }),
    async load(X, input) {
      const [r, job, crew, ax] = await X.db.reads([
        ["SELECT r.*, m.name AS machine_name FROM machine_runs r JOIN machines m ON m.id = r.machine_id WHERE r.id = ?", input.run],
        [JOB_OF_RUN, input.run],
        ["SELECT name_text, staff_id FROM run_crew WHERE run_id = ? AND status = 'ใช้งาน'", input.run],
        ["SELECT t.axes FROM product_types t JOIN machine_runs r ON r.type = t.code WHERE r.id = ?", input.run],
      ]);
      return { r: r[0], crew, axes: ax[0] ? ax[0].axes : null, job: job[0] };
    },
    onUnique: () => conflict("เครื่องนี้เพิ่งมีคนเปิดรอบไปพร้อมกัน — โหลดใหม่"),
    undo: { guard: stockUndoGuard },
    async run(X, input, ctx) {
      const r = ctx.r;
      if (!r) throw notFound("ไม่พบรอบนี้");
      if (r.status !== "กำลังผลิต") throw conflict("รอบนี้ไม่ได้เดินอยู่แล้ว (" + r.status + ") — โหลดใหม่");
      if (r.version !== input.version) throw conflict();
      if (input.color === r.color) throw bad("สีใหม่เหมือนสีเดิม (" + r.color + ")");
      const at = iso(X.now);
      if (at < r.started_at) throw bad("รอบนี้เริ่มในอนาคต — ตรวจเวลาเครื่อง");
      const { machine_name, ...old } = r;
      const ops = [{ op: "update", table: "machine_runs", id: r.id, expect: r.version, before: old, set: {
        status: "ปิดแล้ว", end_kind: "เปลี่ยนสี", ended_at: at, ended_day: thaiDay(X.now), good_pcs: input.good, grade_b_pcs: input.b, waste_pcs: input.waste,
        waste_reason: input.waste_reason, closed_by: X.staff.id, stocked: 1, note: input.note ? (r.note ? r.note + " · " : "") + input.note : r.note } }];
      ops.push(...produceMoves(r, input.good, input.b));
      const id = "R" + X.newId();
      const it = { type: r.type, size: r.size, neck: r.neck, shape: r.shape, color: input.color };
      ops.push({ op: "insert", table: "machine_runs", row: { id, machine_id: r.machine_id, job_id: r.job_id, ...it, spec_key: specKey(it, ctx.axes),
        started_at: at, started_day: thaiDay(X.now), status: "กำลังผลิต", opened_by: X.staff.id, chain_id: r.chain_id || r.id, prev_run_id: r.id, src: "v2" } });
      const nick = new Map(ctx.crew.map(c => [c.name_text, c.staff_id]));
      ops.push(...crewOps(id, ctx.crew.map(c => c.name_text), nick));
      if (ctx.job) ops.push(...await jobsOps(X, [[ctx.job, { good_pcs: ctx.job.made + input.good }]]));
      return { result: { id, closed: r.id }, label: "เปลี่ยนสี " + machine_name + " " + (r.color || "—") + " → " + input.color, ops };
    },
  });

  // ── ปิดรอบ (รวมรอบค้าง/ค้างจากแอปเดิม = ปิดย้อนหลัง + เหตุผล + ธง) ──────────────────
  R.define({
    name: "run.close", roles: ROLES, write: true, gate: true, label: "ปิดรอบ",
    input: (raw, X) => ({ run: need(raw.run, "รอบ", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }),
      good: q(raw.good, "ดี (ใบ)"), b: q(raw.b === undefined || raw.b === "" ? 0 : raw.b, "เกรด B (ใบ)"), waste: q(raw.waste === undefined || raw.waste === "" ? 0 : raw.waste, "เสีย (ใบ)"),
      waste_reason: text(raw.waste_reason, 120), note: text(raw.note, 300), ended_at: readWhen(raw.ended_at, X.now, "เวลาปิด") }),
    async load(X, input) {
      const [r, flags, job] = await X.db.reads([
        ["SELECT r.*, m.name AS machine_name FROM machine_runs r JOIN machines m ON m.id = r.machine_id WHERE r.id = ?", input.run],
        ["SELECT * FROM flags WHERE dedupe_key = ? AND status = 'เปิด'", "stale:" + input.run],
        [JOB_OF_RUN, input.run],
      ]);
      return { r: r[0], flags, job: job[0] };
    },
    undo: { guard: stockUndoGuard },
    async run(X, input, ctx) {
      const r = ctx.r;
      if (!r) throw notFound("ไม่พบรอบนี้");
      if (r.status !== "กำลังผลิต" && r.status !== "ค้างจากระบบเดิม") throw conflict("รอบนี้ " + r.status + " ไปแล้ว — โหลดใหม่");
      if (r.version !== input.version) throw conflict();
      const end = input.ended_at || iso(X.now);
      if (end < r.started_at) throw bad("เวลาปิดอยู่ก่อนเวลาเริ่ม (" + thaiHm(Date.parse(r.started_at)) + " " + thaiDay(Date.parse(r.started_at)) + ")");
      const legacy = r.status === "ค้างจากระบบเดิม";
      const staleMs = Number(X.settings.RUN_STALE_HOURS || 14) * 3600000;
      const lateMs = Number(X.settings.LATE_CLOSE_MIN || 60) * 60000;
      const late = legacy || X.now - Date.parse(r.started_at) > staleMs || X.now - Date.parse(end) > lateMs;
      if (late && !X.reason) throw bad("รอบนี้ปิดย้อนหลัง — ต้องเลือกเหตุผล", { needReason: "late_close" });
      if (input.good + input.b + input.waste === 0 && !X.reason && !input.note) throw bad("ยอดเป็น 0 ทั้งหมด — ใส่หมายเหตุหรือเหตุผลว่าทำไม (เช่น เปิดผิดเครื่อง)", { needReason: "zero" });
      const { machine_name, ...old } = r;
      const ops = [{ op: "update", table: "machine_runs", id: r.id, expect: r.version, before: old, set: {
        status: "ปิดแล้ว", end_kind: "ปิดรอบ", ended_at: end, ended_day: thaiDay(Date.parse(end)), good_pcs: input.good, grade_b_pcs: input.b, waste_pcs: input.waste,
        waste_reason: input.waste_reason, closed_by: X.staff.id, late_close: late ? 1 : 0, stocked: legacy ? 0 : 1,
        note: input.note ? (r.note ? r.note + " · " : "") + input.note : r.note } }];
      if (!legacy) ops.push(...produceMoves(r, input.good, input.b));   // รอบจากแอปเดิม = ประวัติ ไม่แตะสต๊อก (นับยอดยกมาแทน)
      if (late) ops.push({ op: "flag", kind: "รอบค้าง", team: "prod", severity: "ดู", entity: "machine_runs", entity_id: r.id,
        title: "ปิดรอบย้อนหลัง " + machine_name + " · " + specLabel(r), detail: "เริ่ม " + thaiDay(Date.parse(r.started_at)) + " " + thaiHm(Date.parse(r.started_at)) + " · ปิดเวลา " + thaiDay(Date.parse(end)) + " " + thaiHm(Date.parse(end)) + " · เหตุผล: " + X.reason + (legacy ? " · รอบจากแอปเดิม (ไม่แตะสต๊อก)" : ""), dedupe_key: "late:" + r.id });
      for (const f of ctx.flags) ops.push({ op: "update", table: "flags", id: f.id, expect: f.version, before: f, set: { status: "ปิด", resolution: "ปิดรอบแล้ว (" + (X.reason || "ปิดรอบ") + ")", resolved_by: X.staff.id, resolved_at: iso(X.now) } });
      if (ctx.job) ops.push(...await jobsOps(X, [[ctx.job, { good_pcs: ctx.job.made + input.good }]]));
      return { result: { id: r.id, late, legacy }, label: "ปิดรอบ " + machine_name + " · ดี " + input.good.toLocaleString("en-US") + " ใบ", ops };
    },
  });

  // ── แก้ยอดรอบที่ปิดแล้ว (หลังย้อนไม่ได้แล้ว) — เหตุผลบังคับ · ลงส่วนต่างเข้าสต๊อก · ติดลบ = ธง ──
  R.define({
    name: "run.fix", roles: ROLES, write: true, gate: true, reason: "required", label: "แก้ยอดรอบ",
    input: raw => ({ run: need(raw.run, "รอบ", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), good: q(raw.good, "ดี (ใบ)"), b: q(raw.b, "เกรด B (ใบ)"), waste: q(raw.waste, "เสีย (ใบ)") }),
    async load(X, input) {
      const [r, bal, job] = await X.db.reads([
        ["SELECT r.*, m.name AS machine_name FROM machine_runs r JOIN machines m ON m.id = r.machine_id WHERE r.id = ?", input.run],
        ["SELECT b.grade, b.qty_pcs FROM stock_balance b JOIN machine_runs r ON b.item_key = 'spec:' || r.spec_key WHERE r.id = ?", input.run],
        [JOB_OF_RUN, input.run],
      ]);
      return { r: r[0], bal: new Map(bal.map(b => [b.grade, b.qty_pcs])), job: job[0] };
    },
    undo: { guard: stockUndoGuard },
    async run(X, input, ctx) {
      const r = ctx.r;
      if (!r) throw notFound("ไม่พบรอบนี้");
      if (r.status !== "ปิดแล้ว") throw conflict("แก้ยอดได้เฉพาะรอบที่ปิดแล้ว");
      if (r.version !== input.version) throw conflict();
      const dA = input.good - (r.good_pcs || 0), dB = input.b - (r.grade_b_pcs || 0);
      if (!dA && !dB && input.waste === (r.waste_pcs || 0)) throw bad("ยอดเท่าเดิม ไม่มีอะไรต้องแก้");
      const { machine_name, ...old } = r;
      const ops = [{ op: "update", table: "machine_runs", id: r.id, expect: r.version, before: old, set: { good_pcs: input.good, grade_b_pcs: input.b, waste_pcs: input.waste } }];
      if (r.stocked) {
        const lbl = specLabel(r);
        for (const [g, d] of [["A", dA], ["B", dB]]) {
          if (!d) continue;
          ops.push({ op: "move", item_key: stockKey(r.spec_key), label: lbl, grade: g, qty_pcs: d, move_type: "แก้ยอดผลิต", ref_entity: "machine_runs", ref_id: r.id, reason: X.reason });
          const nf = negativeFlag(stockKey(r.spec_key), g, lbl, ctx.bal.get(g) || 0, d);
          if (nf) ops.push(nf);
        }
      }
      if (ctx.job && dA) ops.push(...await jobsOps(X, [[ctx.job, { good_pcs: ctx.job.made + dA }]]));
      return { result: { id: r.id }, label: "แก้ยอดรอบ " + machine_name + " · ดี " + input.good.toLocaleString("en-US") + " ใบ", ops };
    },
  });

  // ── ผูก/เลิกผูกรอบกับงาน (ไม่บังคับ) ─────────────────────────────────────
  R.define({
    name: "run.link", roles: ROLES, write: true, gate: true, label: "ผูกรอบกับงาน",
    input: raw => ({ run: need(raw.run, "รอบ", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), job: text(raw.job, 40), item: text(raw.item, 60) }),
    async load(X, input) {
      const [r, j, it, ij, oj] = await X.db.reads([
        ["SELECT r.*, m.name AS machine_name FROM machine_runs r JOIN machines m ON m.id = r.machine_id WHERE r.id = ?", input.run],
        ["SELECT j.*, coalesce(m.good_pcs, 0) AS made FROM production_jobs j LEFT JOIN job_made m ON m.job_id = j.id WHERE j.id = ?", input.job || "-"],
        ["SELECT i.*, o.due_day, o.urgent FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?", input.item || "-"],
        ["SELECT j.*, coalesce(m.good_pcs, 0) AS made FROM production_jobs j LEFT JOIN job_made m ON m.job_id = j.id WHERE j.order_item_id = ? AND j.status <> 'ยกเลิก' ORDER BY (j.status = 'เสร็จ'), j.created_at DESC LIMIT 1", input.item || "-"],
        [JOB_OF_RUN, input.run],
      ]);
      return { r: r[0], j: j[0], it: it[0], ij: ij[0], oldJob: oj[0] };
    },
    onUnique: () => conflict("มีคนเริ่มงานนี้พร้อมกัน — โหลดใหม่"),
    async run(X, input, ctx) {
      const r = ctx.r;
      if (!r) throw notFound("ไม่พบรอบนี้");
      if (r.version !== input.version) throw conflict();
      if (r.status !== "กำลังผลิต" && r.status !== "ปิดแล้ว") throw conflict("รอบนี้ " + r.status + " — ผูกงานไม่ได้");
      const good = r.status === "ปิดแล้ว" ? (r.good_pcs || 0) : 0;   // รอบที่ปิดแล้ว = ย้ายยอดทำแล้วตามไปด้วย
      const changes = [], fresh = [];
      let jobId = null, what = "ผลิตเข้าสต๊อก";
      if (input.job || input.item) {
        const j = input.job ? ctx.j : (ctx.ij && ctx.ij.status !== "เสร็จ" ? ctx.ij : null);
        if (input.job && !j) throw notFound("ไม่พบงานนี้");
        if (input.item && !ctx.it) throw notFound("ไม่พบรายการออเดอร์นี้");
        const src = j || ctx.it;
        if (src.spec_key !== r.spec_key) throw bad("สเปกของรอบ (" + specLabel(r) + ") ไม่ตรงกับงาน (" + specLabel(src) + ")");
        if (j) {
          if (j.status === "ยกเลิก" || j.status === "เสร็จ") throw conflict("งานนี้" + j.status + "แล้ว");
          jobId = j.id;
          if (jobId !== r.job_id) changes.push([j, { status: "กำลังผลิต", good_pcs: j.made + good }]);
        } else {
          jobId = "J" + X.newId();
          fresh.push({ ...newJob(jobId, ctx.it, "กำลังผลิต"), good_pcs: good });
        }
        what = "ผูกกับงาน";
      }
      if ((r.job_id || null) === jobId) throw bad("รอบนี้ผูกอยู่แบบนี้แล้ว");
      if (ctx.oldJob && good) changes.push([ctx.oldJob, { good_pcs: Math.max(0, ctx.oldJob.made - good) }]);
      const { machine_name, ...old } = r;
      const ops = [{ op: "update", table: "machine_runs", id: r.id, expect: r.version, before: old, set: { job_id: jobId } }, ...await jobsOps(X, changes, fresh)];
      return { result: { id: r.id, job: jobId }, label: what + " · " + machine_name, ops };
    },
  });

  // ── จอดเครื่อง + สาเหตุ (ชิป reason.machine_stop) → เดินเครื่องต่อ ──────────────────
  R.define({
    name: "run.stop", roles: ROLES, write: true, gate: true, reason: "required", label: "จอดเครื่อง",
    input: (raw, X) => ({ machine: need(raw.machine, "เครื่อง", 40), at: readWhen(raw.at, X.now, "เวลาจอด", 12), note: text(raw.note, 300) }),
    async load(X, input) {
      const [m, ev, run] = await X.db.reads([
        ["SELECT * FROM machines WHERE id = ?", input.machine],
        ["SELECT * FROM machine_events WHERE machine_id = ? AND kind = 'จอดเครื่อง' AND ended_at = '' AND status = 'ใช้งาน'", input.machine],
        ["SELECT id, started_at FROM machine_runs WHERE machine_id = ? AND status = 'กำลังผลิต'", input.machine],
      ]);
      return { m: m[0], stop: ev[0], run: run[0] };
    },
    onUnique: () => conflict("เครื่องนี้เพิ่งถูกกดจอดไปพร้อมกัน — โหลดใหม่"),
    async run(X, input, ctx) {
      const m = ctx.m;
      if (!m || m.status === "เลิกใช้") throw notFound("ไม่พบเครื่องนี้");
      if (ctx.stop) throw conflict(m.name + " จอดอยู่แล้ว ตั้งแต่ " + thaiHm(Date.parse(ctx.stop.started_at)) + " (" + (ctx.stop.reason || "ไม่ระบุ") + ")", { stop: { id: ctx.stop.id, version: ctx.stop.version } });
      const at = input.at || iso(X.now);
      const id = "E" + X.newId();
      return { result: { id }, label: "จอด " + m.name + " · " + X.reason, ops: [{ op: "insert", table: "machine_events", row: {
        id, machine_id: m.id, run_id: ctx.run ? ctx.run.id : null, kind: "จอดเครื่อง", reason: X.reason, detail: input.note, started_at: at, started_day: thaiDay(Date.parse(at)), by: X.staff.id, src: "v2" } }] };
    },
  });
  R.define({
    name: "run.resume", roles: ROLES, write: true, gate: true, label: "เดินเครื่องต่อ",
    input: (raw, X) => ({ event: need(raw.event, "เรื่องที่จอด", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), at: readWhen(raw.at, X.now, "เวลาเดินต่อ", 12) }),
    async load(X, input) {
      const [e] = await X.db.reads([["SELECT e.*, m.name AS machine_name FROM machine_events e JOIN machines m ON m.id = e.machine_id WHERE e.id = ?", input.event]]);
      return { e: e[0] };
    },
    async run(X, input, ctx) {
      const e = ctx.e;
      if (!e || e.kind !== "จอดเครื่อง") throw notFound("ไม่พบเรื่องที่จอด");
      if (e.ended_at || e.status !== "ใช้งาน") throw conflict("เครื่องนี้เดินต่อไปแล้ว — โหลดใหม่");
      if (e.version !== input.version) throw conflict();
      const at = input.at || iso(X.now);
      if (at < e.started_at) throw bad("เวลาเดินต่ออยู่ก่อนเวลาที่จอด (" + thaiHm(Date.parse(e.started_at)) + ")");
      const { machine_name, ...old } = e;
      return { result: { id: e.id }, label: "เดินเครื่องต่อ " + machine_name, ops: [{ op: "update", table: "machine_events", id: e.id, expect: e.version, before: old, set: { ended_at: at } }] };
    },
  });

  // ── เปลี่ยนโมลด์: จะเปลี่ยน → กำลังเปลี่ยน (เครื่องหยุด) → เสร็จ (ขยับโมลด์ที่ติดอยู่) · ยกเลิก ──────────
  R.define({
    name: "mold.step", roles: ROLES, write: true, gate: true, label: "เปลี่ยนโมลด์",
    input: raw => ({ machine: need(raw.machine, "เครื่อง", 40), stage: oneOf(raw.stage, ["จะเปลี่ยน", "กำลังเปลี่ยน", "เสร็จ", "ยกเลิก"], "ขั้น"),
      event: text(raw.event, 40), version: raw.version === undefined || raw.version === "" ? null : int(raw.version, "รุ่นของรายการ", { min: 1 }), mold_to: text(raw.mold_to, 120, "โมลด์ใหม่"), note: text(raw.note, 300) }),
    async load(X, input) {
      const [m, ev, run] = await X.db.reads([
        ["SELECT * FROM machines WHERE id = ?", input.machine],
        ["SELECT * FROM machine_events WHERE machine_id = ? AND kind = 'เปลี่ยนโมลด์' AND ended_at = '' AND status = 'ใช้งาน'", input.machine],
        [`SELECT r.*, (SELECT group_concat(name_text, ' , ') FROM run_crew c WHERE c.run_id = r.id AND c.status = 'ใช้งาน') AS crew FROM machine_runs r WHERE r.machine_id = ? AND r.status = 'กำลังผลิต'`, input.machine],
      ]);
      return { m: m[0], ev: ev[0], run: run[0] };
    },
    onUnique: () => conflict("เครื่องนี้มีเรื่องเปลี่ยนโมลด์ค้างอยู่แล้ว — โหลดใหม่"),
    async run(X, input, ctx) {
      const m = ctx.m;
      if (!m || m.status === "เลิกใช้") throw notFound("ไม่พบเครื่องนี้");
      const at = iso(X.now), ev = ctx.ev, st = input.stage;
      if (st === "กำลังเปลี่ยน" && ctx.run) throw busyRun(m, ctx.run, ctx.run.crew);
      if (!ev) {
        if (st === "เสร็จ" || st === "ยกเลิก") throw conflict("ยังไม่มีเรื่องเปลี่ยนโมลด์ที่ค้างอยู่ของ " + m.name + " — โหลดใหม่");
        const id = "E" + X.newId();
        return { result: { id, stage: st }, label: (st === "จะเปลี่ยน" ? "แจ้งจะเปลี่ยนโมลด์ " : "เริ่มเปลี่ยนโมลด์ ") + m.name + (input.mold_to ? " → " + input.mold_to : ""), ops: [{ op: "insert", table: "machine_events", row: {
          id, machine_id: m.id, kind: "เปลี่ยนโมลด์", stage: st, mold_from: m.mold || "", mold_to: input.mold_to, detail: input.note, started_at: at, started_day: thaiDay(X.now), work_at: st === "กำลังเปลี่ยน" ? at : "", by: X.staff.id, src: "v2" } }] };
      }
      if (input.event && input.event !== ev.id) throw conflict("เรื่องเปลี่ยนโมลด์ของเครื่องนี้เปลี่ยนไปแล้ว — โหลดใหม่");
      if (input.version !== null && input.version !== ev.version) throw conflict();
      const rank = { "จะเปลี่ยน": 1, "กำลังเปลี่ยน": 2, "เสร็จ": 3 };
      if (st !== "ยกเลิก" && rank[st] <= rank[ev.stage]) throw conflict("ตอนนี้ " + m.name + " อยู่ขั้น \"" + ev.stage + "\" แล้ว — โหลดใหม่");
      const to = input.mold_to || ev.mold_to;
      const set = st === "กำลังเปลี่ยน" ? { stage: st, work_at: at, mold_to: to }
        : st === "เสร็จ" ? { stage: st, ended_at: at, mold_to: to }
        : { status: "ยกเลิก", ended_at: at };
      if (input.note) set.detail = (ev.detail ? ev.detail + " · " : "") + input.note;
      const ops = [{ op: "update", table: "machine_events", id: ev.id, expect: ev.version, before: ev, set }];
      if (st === "เสร็จ" && to && to !== m.mold) ops.push({ op: "update", table: "machines", id: m.id, expect: m.version, before: m, set: { mold: to } });
      return { result: { id: ev.id, stage: st }, label: (st === "ยกเลิก" ? "ยกเลิกเปลี่ยนโมลด์ " : st === "เสร็จ" ? "เปลี่ยนโมลด์เสร็จ " : "เริ่มเปลี่ยนโมลด์ ") + m.name + (to && st !== "ยกเลิก" ? " → " + to : ""), ops };
    },
  });

  // ── ยกธงรอบค้าง (หน้าแผนผังเรียกเองเมื่อเจอรอบค้างที่ยังไม่มีธง · ไม่ต้องใส่ PIN · กันซ้ำด้วย dedupe_key) ──
  R.define({
    name: "prod.sweep", roles: ["prod", "exec"], write: true, undo: false, label: "ตรวจรอบค้าง",
    async load(X) {
      const cut = iso(X.now - Number(X.settings.RUN_STALE_HOURS || 14) * 3600000);
      const [runs, legacy] = await X.db.reads([
        [`SELECT r.id, r.started_at, r.type, r.size, r.neck, r.shape, r.color, m.name AS machine_name FROM machine_runs r JOIN machines m ON m.id = r.machine_id
           WHERE r.status = 'กำลังผลิต' AND r.started_at < ? AND NOT EXISTS (SELECT 1 FROM flags f WHERE f.dedupe_key = 'stale:' || r.id AND f.status = 'เปิด') ORDER BY r.started_at LIMIT 20`, cut],
        ["SELECT count(*) AS n FROM machine_runs WHERE status = 'ค้างจากระบบเดิม' AND started_at < ?", cut],
      ]);
      return { runs, legacy: legacy[0].n };
    },
    async run(X, input, ctx) {
      const ops = ctx.runs.map(r => ({ op: "flag", kind: "รอบค้าง", team: "prod", severity: "ดู", entity: "machine_runs", entity_id: r.id,
        title: "รอบค้างไม่ได้ปิด " + r.machine_name + " · " + specLabel(r), detail: "เปิดตั้งแต่ " + thaiDay(Date.parse(r.started_at)) + " " + thaiHm(Date.parse(r.started_at)) + " — ปิดรอบย้อนหลังพร้อมเหตุผลในหน้าทีมผลิต", dedupe_key: "stale:" + r.id }));
      if (ctx.legacy) ops.push({ op: "flag", kind: "รอบค้าง", team: "prod", severity: "ดู", title: "รอบค้างจากแอปเดิม " + ctx.legacy + " รอบ", detail: "นำเข้ามาเป็น \"ค้างจากแอปเดิม\" — ปิดย้อนหลังในหน้าทีมผลิต › ประวัติ (ไม่แตะสต๊อก)", dedupe_key: "stale:legacy" });
      ops.push({ op: "note", entity: "machine_runs", entity_id: "", after: { stale: ctx.runs.length, legacy: ctx.legacy } });
      return { result: { flagged: ctx.runs.length, legacy: ctx.legacy }, undo: false, ops };
    },
  });

  // ── ทะเบียนเครื่อง (ประธาน): วางเครื่องในผัง · รวมกับช่อง K · ข้อมูลที่ "ยังไม่มีในระบบ" ──────────
  R.define({
    name: "machine.set", roles: ["exec"], write: true, label: "แก้ทะเบียนเครื่อง",
    input: raw => {
      const o = { id: need(raw.id, "เครื่อง", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), take_slot: text(raw.take_slot, 40), set: {} };
      for (const k of ["name", "map_label", "sub", "makes", "rating", "legacy_name", "model", "bought", "molds", "capacity", "mold", "note"]) if (raw[k] !== undefined) o.set[k] = text(raw[k], k === "note" || k === "makes" ? 300 : 120, k);
      if (raw.plant !== undefined) o.set.plant = oneOf(raw.plant, ["", "โรง 1", "โรง 2"], "โรง");
      for (const k of ["pos_x", "pos_y"]) if (raw[k] !== undefined) o.set[k] = int(raw[k], k, { min: 0, max: 5000 });
      for (const k of ["w", "h"]) if (raw[k] !== undefined) o.set[k] = int(raw[k], k, { min: 1, max: 3000 });
      if (raw.tracked !== undefined) o.set.tracked = raw.tracked ? 1 : 0;
      if (raw.status !== undefined) o.set.status = oneOf(raw.status, ["ใช้งาน", "พัก", "เลิกใช้"], "สถานะ");
      if (o.set.name === "") throw bad("ชื่อเครื่องว่างไม่ได้");
      return o;
    },
    async load(X, input) {
      const [m, s, busy] = await X.db.reads([["SELECT * FROM machines WHERE id = ?", input.id], ["SELECT * FROM machines WHERE id = ?", input.take_slot || "-"],
        [`SELECT count(*) AS n FROM machine_runs WHERE machine_id = ? AND status IN ${OPEN_RUN}`, input.take_slot || "-"]]);
      return { m: m[0], slot: s[0], busy: busy[0].n };
    },
    onUnique: () => bad("ชื่อเครื่องนี้มีอยู่แล้ว — ใช้ชื่ออื่น"),
    async run(X, input, ctx) {
      const m = ctx.m;
      if (!m) throw notFound("ไม่พบเครื่องนี้");
      if (m.version !== input.version) throw conflict();
      const set = Object.assign({}, input.set, { src: "v2" });   // แก้ในแอปแล้ว = ทะเบียนใน repo ไม่ทับอีก
      const ops = [];
      if (input.take_slot) {
        const s = ctx.slot;
        if (!s || s.status === "เลิกใช้") throw notFound("ไม่พบช่องในผังที่เลือก");
        if (s.id === m.id) throw bad("เลือกช่องของเครื่องตัวเอง");
        if (ctx.busy) throw conflict(s.name + " มีรอบเปิดอยู่ — ปิดรอบก่อนรวมเครื่อง");
        Object.assign(set, { plant: s.plant, pos_x: s.pos_x, pos_y: s.pos_y, w: s.w, h: s.h, map_label: set.map_label || s.map_label || s.name, sub: set.sub || m.name });
        ops.push({ op: "update", table: "machines", id: s.id, expect: s.version, before: s, set: { status: "เลิกใช้", note: (s.note ? s.note + " · " : "") + "รวมกับ " + m.name + " (" + thaiDay(X.now) + ")", src: "v2" } });
      }
      for (const k of Object.keys(set)) if (set[k] === m[k]) delete set[k];
      if (!Object.keys(set).filter(k => k !== "src").length && !ops.length) throw bad("ไม่มีอะไรเปลี่ยน");
      ops.unshift({ op: "update", table: "machines", id: m.id, expect: m.version, before: m, set });
      return { result: { id: m.id }, label: "แก้ทะเบียน " + m.name + (input.take_slot ? " · วางที่ " + ctx.slot.name : ""), ops };
    },
  });
}
export { stockUndoGuard, newId };
