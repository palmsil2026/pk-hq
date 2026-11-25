// ============================================================
//  ออฟฟิศ — งวดส่ง · เลื่อนวันส่ง (เก็บสาเหตุ) · รอยืนยัน · ออเดอร์รวมตามสินค้า · รายการซื้อหน้าร้าน        v2/server/actions/office-plan.mjs
//
//  เขียน (ออฟฟิศ + ประธาน · ย้อนได้ · กันกดซ้ำ · ชนกัน = 409):
//    office.plan_set    วางงวดใหม่ทั้งชุด (งวดเดิม "ยกเลิก" + เพิ่มชุดใหม่) + ต้องการเมื่อไร · ย้ายวันที่นัดไว้แล้ว = ต้องมีสาเหตุ + ลงสมุดเลื่อน
//    office.round_move  นัด/เลื่อน/ยกเลิกนัด งวดเดียว (เลื่อนงวดถัดไปตามได้) · เลื่อน = สาเหตุบังคับ → reschedule_events
//    office.hold_set    รอยืนยัน — ยังไม่ส่งเข้าคิวผลิต (เปิด/ปิด)
//  อ่าน:
//    office.tree        ของที่ยังต้องส่ง (สั่ง − ส่งแล้ว) ทุกออเดอร์ที่ยังไม่จบ → หน้าเว็บประกอบต้นไม้ ประเภท → ขนาด → คอ/ทรง → สี → ใบสั่ง
//    office.walkin      ออเดอร์ "ขายหน้าร้าน" ตามวัน + ยอดรวม (ใบ/ถุง · เงินตามราคาที่ลง — ไม่เดาราคาที่ไม่ได้ลง)
//  วันส่งของออเดอร์ (orders.due_day) = วันนัดของงวดแรกที่ยังไม่ส่ง — งานผลิต/สกรีนที่ยังไม่เสร็จตามวันนี้ไปด้วย
// ============================================================
import { Fail, bad, conflict, notFound, need, text, int, oneOf, day, iso, thaiDay, addDays } from "../core.mjs";
import { registerTable } from "../db.mjs";
import { loadOrder, ROLES_OFFICE } from "./office-orders.mjs";
import { deriveOrder, OPEN_STATUSES, loadOrderParts, chunk } from "./office-lib.mjs";
import { planInput, wantInput, buildRounds, planState } from "./office-plan-lib.mjs";

registerTable("order_rounds", { pk: "id", void: { status: "ยกเลิก" } });
registerTable("reschedule_events", { pk: "id", void: { status: "ยกเลิก" } });

const locked = (msg, extra) => new Fail(409, "locked", msg, extra);
const IN = n => "(" + Array.from({ length: n }, () => "?").join(",") + ")";
const OPEN_SQL = "('" + OPEN_STATUSES.join("','") + "')";
export const ROUND_READS = id => [["SELECT * FROM order_rounds WHERE order_id = ? ORDER BY seq", id], ["SELECT value FROM vocab WHERE kind = 'reason.reschedule'"]];
const sentOf = loads => (loads || []).filter(l => l.status === "ส่งแล้ว").map(l => ({ order_item_id: l.order_item_id, qty_pcs: l.qty_pcs, done_day: l.done_day }));

/** สาเหตุเลื่อน: ชิปในคลัง = สาเหตุ · พิมพ์เอง = "อื่น ๆ" + ข้อความ (ไม่ทิ้งคำที่คนพิมพ์) */
export function causeOf(reason, causes) {
  const r = text(reason, 300, "สาเหตุ");
  if (!r) return null;
  if (causes.indexOf(r) >= 0 && r !== "อื่น ๆ") return { cause: r, note: "" };
  return { cause: "อื่น ๆ", note: r };
}
/** งานผลิต/สกรีนที่ยังไม่เสร็จ ตามวันส่งใหม่ */
export function dueOps(ctx, due) {
  const ops = [];
  for (const j of ctx.jobs) if (j.status !== "ยกเลิก" && j.status !== "เสร็จ" && j.due_day !== due) ops.push({ op: "update", table: "production_jobs", id: j.id, expect: j.version, before: j, set: { due_day: due } });
  for (const j of ctx.sjobs) if (j.status !== "ยกเลิก" && j.status !== "เสร็จแล้ว" && j.due_day !== due) ops.push({ op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set: { due_day: due } });
  return ops;
}
/** แถวงวดใหม่ของออเดอร์ (ยังไม่เขียน) */
export function roundRows(X, orderId, plan, mainQty) {
  return buildRounds(plan, mainQty).map(r => ({ id: "RD" + X.newId(), order_id: orderId, seq: r.seq, plan_day: r.plan_day, part_bp: r.part_bp, status: "ใช้งาน", src: "v2" }));
}
/** ช่องแผนในหัวออเดอร์ */
export const planCols = p => ({ plan_mode: p.mode, plan_each_pcs: p.each_pcs, plan_every_days: p.every_days, plan_cap_pcs: p.cap_pcs });

async function loadPlan(X, id) {
  const c = await loadOrder(X, id, ROUND_READS(id));
  c.rounds = c.more[0];
  c.causes = c.more[1].map(r => r.value);
  c.d = deriveOrder(c.o, c.items, c.jobs, c.sjobs, c.loads);
  c.plan = planState(c.o, c.rounds, c.d.items, sentOf(c.loads));
  return c;
}
const custName = ctx => (ctx.cust ? ctx.cust.name : "");
const notOpen = o => o.status === "ยกเลิก" ? "ออเดอร์นี้ยกเลิกแล้ว" : o.status === "ส่งแล้ว" ? "ออเดอร์นี้ส่งครบแล้ว" : "";

export function defineOfficePlan(R) {
  // ══ วางงวดส่งใหม่ทั้งชุด + ต้องการเมื่อไร ══════════════════════════════════════════
  R.define({
    name: "office.plan_set", roles: ROLES_OFFICE, write: true,
    input: raw => {
      const plan = planInput(raw.plan);
      if (!plan) throw bad("ต้องเลือกแบบงวดส่ง");
      return { id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }), plan, want: wantInput(raw) };
    },
    load: (X, input) => loadPlan(X, input.id),
    async run(X, input, ctx) {
      const o = ctx.o, p = input.plan;
      if (o.version !== input.version) throw conflict();
      if (notOpen(o)) throw locked(notOpen(o) + " — วางงวดใหม่ไม่ได้");
      if (p.first_day && p.first_day < thaiDay(X.now)) throw bad("วันนัดส่งเป็นวันที่ผ่านมาแล้ว — เลือกวันนี้หรือหลังจากนี้");
      const main = ctx.d.items[0];
      if (!main) throw bad("ออเดอร์นี้ไม่มีรายการ");
      if (ctx.d.delivered > 0 && p.mode !== ctx.plan.mode && ctx.plan.mode) throw locked("ส่งไปแล้วบางส่วน — เปลี่ยนแบบงวดไม่ได้ (เลื่อนวันของงวดได้)");
      const rows = roundRows(X, o.id, p, main.qty_pcs);
      const ops = [];
      for (const r of ctx.rounds) if (r.status !== "ยกเลิก") ops.push({ op: "update", table: "order_rounds", id: r.id, expect: r.version, before: r, set: { status: "ยกเลิก", note: "วางงวดใหม่" } });
      rows.forEach(r => ops.push({ op: "insert", table: "order_rounds", row: r }));
      const next = planState({ ...o, plan_mode: p.mode, plan_cap_pcs: p.cap_pcs }, rows, ctx.d.items, sentOf(ctx.loads));
      const before = ctx.plan.due, after = next.due;
      if (before && after !== before) {   // วันที่นัดลูกค้าไว้แล้วเปลี่ยน = เลื่อน → สาเหตุบังคับ
        const c = causeOf(X.reason, ctx.causes);
        if (!c) throw new Fail(400, "need_reason", "ย้ายวันที่นัดไว้ (" + before + " → " + (after || "ยังไม่นัด") + ") ต้องเลือกสาเหตุ", { needReason: true, why: ["เลื่อนวันส่งที่นัดลูกค้าไว้แล้ว"], kind: "reschedule" });
        ops.push({ op: "insert", table: "reschedule_events", row: { id: "RS" + X.newId(), order_id: o.id, round_id: rows[0].id, seq: 1, from_day: before, to_day: after, cause: c.cause, note: c.note, by_staff: X.staff.id, src: "v2" } });
      }
      const set = { ...planCols(p), ...input.want };
      if (after !== o.due_day) set.due_day = after;
      for (const k of Object.keys(set)) if (String(set[k]) === String(o[k] ?? "")) delete set[k];
      ops.unshift(Object.keys(set).length ? { op: "update", table: "orders", id: o.id, expect: o.version, before: o, set } : { op: "guard", sql: "SELECT 1 FROM orders WHERE id = ? AND version = ?", args: [o.id, o.version] });
      if ("due_day" in set) ops.push(...dueOps(ctx, after));
      return { label: "วางงวดส่ง " + custName(ctx), ops, result: { id: o.id, rounds: rows.length, due_day: after, reserve: next.reserve } };
    },
  });

  // ══ นัด / เลื่อน / ยกเลิกนัด งวดเดียว ══════════════════════════════════════════════
  R.define({
    name: "office.round_move", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }), round: text(raw.round, 40),
      to_day: day(raw.to_day, "วันนัดใหม่", true), shift_after: !!raw.shift_after }),
    load: (X, input) => loadPlan(X, input.id),
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (notOpen(o)) throw locked(notOpen(o) + " — เลื่อนวันไม่ได้");
      if (input.to_day && input.to_day < thaiDay(X.now)) throw bad("วันนัดเป็นวันที่ผ่านมาแล้ว — เลือกวันนี้หรือหลังจากนี้");
      const live = ctx.rounds.filter(r => r.status !== "ยกเลิก").sort((a, b) => a.seq - b.seq);
      const st = ctx.plan.rounds.find(r => r.id === input.round);
      let round = null, from;
      if (live.length) {
        round = live.find(r => r.id === input.round);
        if (!round) throw conflict("งวดนี้ถูกเปลี่ยนไปแล้ว — โหลดใหม่");
        if (st && st.state === "ส่งครบ") throw locked("งวดนี้ส่งครบแล้ว — เลื่อนไม่ได้");
        from = round.plan_day;
      } else from = o.due_day;   // ออเดอร์เก่าที่ไม่ได้วางงวด = เลื่อนวันส่งของทั้งใบ
      if (from === input.to_day) throw bad("วันเดิมอยู่แล้ว — ไม่มีอะไรเปลี่ยน");
      const ops = [];
      let c = null;
      if (from) {   // มีวันนัดอยู่แล้ว = เลื่อน/ยกเลิกนัด → สาเหตุบังคับ + ลงสมุด
        c = causeOf(X.reason, ctx.causes);
        if (!c) throw new Fail(400, "need_reason", "เลื่อนวันส่งต้องเลือกสาเหตุ", { needReason: true, why: ["เลื่อนจากวันที่นัดลูกค้าไว้"], kind: "reschedule" });
      }
      const rows = live.map(r => ({ ...r }));
      if (round) {
        const shift = input.shift_after && from && input.to_day ? Math.round((Date.parse(input.to_day) - Date.parse(from)) / 864e5) : 0;
        for (const r of rows) {
          let nd = null;
          if (r.id === round.id) nd = input.to_day;
          else if (shift && r.seq > round.seq && r.plan_day && !(ctx.plan.rounds.find(x => x.id === r.id) || {}).state?.startsWith("ส่ง")) nd = addDays(r.plan_day, shift);
          if (nd === null || nd === r.plan_day) continue;
          ops.push({ op: "update", table: "order_rounds", id: r.id, expect: r.version, before: live.find(x => x.id === r.id), set: { plan_day: nd } });
          if (c) ops.push({ op: "insert", table: "reschedule_events", row: { id: "RS" + X.newId(), order_id: o.id, round_id: r.id, seq: r.seq, from_day: r.plan_day, to_day: nd, cause: c.cause, note: c.note, by_staff: X.staff.id, src: "v2" } });
          r.plan_day = nd;
        }
      } else if (c) ops.push({ op: "insert", table: "reschedule_events", row: { id: "RS" + X.newId(), order_id: o.id, round_id: "", seq: 0, from_day: from, to_day: input.to_day, cause: c.cause, note: c.note, by_staff: X.staff.id, src: "v2" } });
      const next = round ? planState(o, rows, ctx.d.items, sentOf(ctx.loads)).due : input.to_day;
      if (next !== o.due_day) { ops.unshift({ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set: { due_day: next } }); ops.push(...dueOps(ctx, next)); }
      else ops.unshift({ op: "guard", sql: "SELECT 1 FROM orders WHERE id = ? AND version = ?", args: [o.id, o.version] });
      const what = !from ? "นัดส่ง" : !input.to_day ? "ยกเลิกนัด" : "เลื่อนวันส่ง";
      return { label: what + " " + custName(ctx), ops, result: { id: o.id, due_day: next, moved: ops.filter(x => x.table === "order_rounds").length, logged: !!c } };
    },
  });

  // ══ รอยืนยัน (ยังไม่ส่งเข้าคิวผลิต) ════════════════════════════════════════════════
  R.define({
    name: "office.hold_set", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }), hold: raw.hold ? 1 : 0 }),
    async load(X, input) { const o = await X.db.first("SELECT * FROM orders WHERE id = ?", input.id); if (!o) throw notFound("ไม่พบออเดอร์นี้"); return { o }; },
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (input.hold && o.status !== "ออเดอร์ใหม่") throw locked("ออเดอร์นี้ส่งเข้าคิวไปแล้ว — ตั้งรอยืนยันไม่ได้ (ถ้าลูกค้าขอหยุด ให้แก้/ยกเลิกออเดอร์)");
      if (o.hold === input.hold) throw bad("เป็นแบบนี้อยู่แล้ว");
      return { label: (input.hold ? "ตั้งรอยืนยัน " : "ยกเลิกรอยืนยัน ") + o.customer_text, ops: [{ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set: { hold: input.hold } }], result: { id: o.id, hold: input.hold } };
    },
  });

  // ══ ลำดับคิว: ดันขึ้นก่อน / เลื่อนลง / กลับตามวันนัด (คุณปาล์มเคาะ 19 พ.ย. — ค่าตั้งต้นตามงวดที่นัด/คิวไว้ก่อน แต่ปรับเปลี่ยนได้) ══
  //   เหตุผลบังคับ (ยกเว้นกลับเป็นค่าตั้งต้น) · ประวัติอยู่ใน audit_log · ย้อนได้ · มีผลกับงานรอผลิต · คิวสกรีน · การจัดสต๊อก "ไม่พอส่ง"
  R.define({
    name: "office.prio_move", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }), dir: oneOf(raw.dir || "", ["up", "down", "reset"], "ทิศ (ดันขึ้น/เลื่อนลง/ตามวันนัด)") }),
    async load(X, input) { const o = await X.db.first("SELECT * FROM orders WHERE id = ?", input.id); if (!o) throw notFound("ไม่พบออเดอร์นี้"); return { o }; },
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (notOpen(o)) throw locked(notOpen(o) + " — ไม่มีคิวให้ปรับ");
      const cur = Number(o.priority) || 0;
      const next = input.dir === "reset" ? 0 : Math.max(-99, Math.min(99, cur + (input.dir === "up" ? 1 : -1)));
      if (next === cur) throw bad(input.dir === "reset" ? "ใช้ลำดับตามวันนัดอยู่แล้ว" : "ปรับได้ถึงขีดสุดแล้ว");
      if (input.dir !== "reset" && !X.reason) throw new Fail(400, "need_reason", "ปรับลำดับคิวต้องใส่เหตุผล", { needReason: true, why: [input.dir === "up" ? "ดันออเดอร์นี้ขึ้นก่อนคิวตามวันนัด" : "เลื่อนออเดอร์นี้ลงจากคิวตามวันนัด"], kind: "priority" });
      const what = input.dir === "up" ? "ดันขึ้นก่อน" : input.dir === "down" ? "เลื่อนลง" : "กลับลำดับตามวันนัด";
      return { label: what + " · " + o.customer_text, result: { id: o.id, priority: next },
        ops: [{ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set: { priority: next } }] };
    },
  });

  // ══ ออเดอร์รวมตามสินค้า: ของที่ยังต้องส่ง (สั่ง − ส่งแล้ว) ═════════════════════════════
  R.define({
    name: "office.tree", roles: ROLES_OFFICE,
    async run(X) {
      const today = thaiDay(X.now);
      const ids = (await X.db.all(`SELECT id FROM orders WHERE status IN ${OPEN_SQL} LIMIT 2000`)).map(r => r.id);
      const P = await loadOrderParts(X, ids);
      const [units, custs, rounds] = await Promise.all([
        X.db.all("SELECT code, piece_unit, pos FROM product_types"),
        (async () => { const m = new Map(); for (const part of chunk([...new Set([...P.orders.values()].map(o => o.customer_id))], 90)) (await X.db.all("SELECT id, name, route_code, district FROM customers WHERE id IN " + IN(part.length), ...part)).forEach(c => m.set(c.id, c)); return m; })(),
        (async () => { const m = {}; for (const part of chunk(ids, 90)) (await X.db.all("SELECT * FROM order_rounds WHERE status = 'ใช้งาน' AND order_id IN " + IN(part.length), ...part)).forEach(r => { (m[r.order_id] = m[r.order_id] || []).push(r); }); return m; })(),
      ]);
      const U = new Map(units.map(u => [u.code, u]));
      const lines = [];
      for (const id of ids) {
        const o = P.orders.get(id);
        if (!o) continue;
        const d = deriveOrder(o, P.items[id], P.jobs[id], P.sjobs[id], P.loads[id]);
        if (OPEN_STATUSES.indexOf(d.status) < 0) continue;
        const plan = planState(o, rounds[id], d.items, sentOf(P.loads[id]));
        const c = custs.get(o.customer_id) || {};
        for (const i of d.items) {
          const left = Math.max(0, i.qty_pcs - Math.min(i.delivered, i.qty_pcs));
          if (!left) continue;
          lines.push({ order_id: id, customer: c.name || o.customer_text, route_code: c.route_code || "", district: c.district || "", brand: o.brand, status: d.status, urgent: o.urgent, hold: o.hold,
            due_day: plan.due, reserve: plan.reserve, order_day: o.order_day, type: i.type, size: i.size, neck: i.neck, shape: i.shape, color: i.color, screen_color: i.screen_color, cap_color: i.cap_color,
            left_pcs: left, qty_pcs: i.qty_pcs, per_bag: i.per_bag, on_truck: i.on_truck, piece_unit: (U.get(i.type) || {}).piece_unit || "ชิ้น", type_pos: (U.get(i.type) || {}).pos || 99 });
        }
      }
      return { asOf: iso(X.now), today, lines, orders: new Set(lines.map(l => l.order_id)).size };
    },
  });

  // ══ รายการซื้อหน้าร้าน (แทนเมนูเดิมของแอป Office) ══════════════════════════════════════
  R.define({
    name: "office.walkin", roles: ROLES_OFFICE,
    input: raw => ({ from: day(raw.from, "ตั้งแต่วันที่", true), to: day(raw.to, "ถึงวันที่", true) }),
    async run(X, input) {
      const today = thaiDay(X.now);
      const to = input.to || today, from = input.from || addDays(to, -6);
      if (from > to) throw bad("วันเริ่มอยู่หลังวันสุดท้าย");
      if (Date.parse(to) - Date.parse(from) > 62 * 864e5) throw bad("ดูได้ครั้งละไม่เกิน 2 เดือน");
      const ids = (await X.db.all("SELECT id FROM orders WHERE purchase_type = 'ขายหน้าร้าน' AND order_day BETWEEN ? AND ? AND status <> 'ยกเลิก' ORDER BY order_day DESC, id DESC LIMIT 600", from, to)).map(r => r.id);
      const P = await loadOrderParts(X, ids);
      const units = new Map((await X.db.all("SELECT code, piece_unit FROM product_types")).map(u => [u.code, u.piece_unit]));
      const custs = new Map();
      for (const part of chunk([...new Set([...P.orders.values()].map(o => o.customer_id))], 90)) (await X.db.all("SELECT id, name FROM customers WHERE id IN " + IN(part.length), ...part)).forEach(c => custs.set(c.id, c));
      const days = new Map();
      for (const id of ids) {
        const o = P.orders.get(id);
        const d = deriveOrder(o, P.items[id], P.jobs[id], P.sjobs[id], P.loads[id]);
        const g = days.get(o.order_day) || { day: o.order_day, orders: [], products: new Map(), money_satang: 0, unpriced: 0 };
        const its = d.items.map(i => ({ label: i.label, type: i.type, size: i.size, screen_color: i.screen_color, cap_color: i.cap_color, qty_pcs: i.qty_pcs, bags: i.bags, per_bag: i.per_bag, extra_pcs: i.extra_pcs,
          piece_unit: units.get(i.type) || "ชิ้น", price_satang: i.price_satang }));
        for (const i of its) {
          const k = i.label + "|" + i.screen_color + "|" + i.cap_color;
          const p = g.products.get(k) || { label: i.label, screen_color: i.screen_color, cap_color: i.cap_color, qty_pcs: 0, bags: 0, per_bag: i.per_bag, piece_unit: i.piece_unit, type: i.type, size: i.size };
          p.qty_pcs += i.qty_pcs; p.bags += i.per_bag ? Math.floor(i.qty_pcs / i.per_bag) : 0;
          g.products.set(k, p);
          if (i.price_satang === null || i.price_satang === undefined) g.unpriced++; else g.money_satang += i.price_satang * i.qty_pcs;
        }
        g.orders.push({ id, customer: (custs.get(o.customer_id) || {}).name || o.customer_text, brand: o.brand, status: d.status, items: its, delivered: d.delivered, qty: d.qty,
          total_satang: its.every(i => i.price_satang !== null && i.price_satang !== undefined) ? its.reduce((s, i) => s + i.price_satang * i.qty_pcs, 0) : null });
        days.set(o.order_day, g);
      }
      const out = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).map(g => ({ ...g, products: [...g.products.values()].sort((a, b) => b.qty_pcs - a.qty_pcs) }));
      return { asOf: iso(X.now), today, from, to, days: out, period: "ขายหน้าร้าน " + from + " ถึง " + to,
        total: { orders: ids.length, money_satang: out.reduce((s, g) => s + g.money_satang, 0), unpriced: out.reduce((s, g) => s + g.unpriced, 0) } };
    },
  });
}
