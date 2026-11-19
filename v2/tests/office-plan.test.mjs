// เทสต์ออฟฟิศ 0210: งวดส่ง (ครั้งเดียว/กำหนดจำนวน/ทยอย) · จอง · เลื่อนวัน + สาเหตุ · รอยืนยัน · มัดจำ · รวมตามสินค้า · หน้าร้าน
//   ทุก action: ถูก / ผิดสิทธิ์ / กดซ้ำ / ย้อน / ชนกัน — ข้อมูลสมมติล้วน
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { buildRounds, planState, targetOf, planInput, wantRange } from "../server/actions/office-plan-lib.mjs";

const AT = new Date(T0).toISOString();   // 16 พ.ย. 69
const B600 = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };   // 200 ใบ/ถุง

async function setup() {
  const W = world();
  const T = { off: await W.staff("S1", "แอน", ["office"]), off2: await W.staff("S2", "ฝน", ["office"]), prod: await W.staff("S3", "บอส", ["prod"]),
    drv: await W.staff("S5", "ต่อ", ["deliver"]), scr: await W.staff("S6", "จอย", ["screen"]), acc: await W.staff("S4", "ฝ้าย", ["account"]), boss: await W.staff("S9", "หัวหน้า", ["exec"]) };
  const ex = (sql, ...a) => W.d1.raw.prepare(sql).run(...a);
  ex("INSERT INTO routes(code, name, area, created_at, updated_at) VALUES ('115','สาย 115','ใกล้',?,?)", AT, AT);
  ex("INSERT INTO customers(id, name, name_key, route_code, district, created_at, updated_at) VALUES ('CA','ร้านทดสอบ ก','ร้านทดสอบก','115','เมือง',?,?)", AT, AT);
  ex("INSERT INTO customers(id, name, name_key, district, created_at, updated_at) VALUES ('CB','ร้านทดสอบ ข','ร้านทดสอบข','แม่ทะ',?,?)", AT, AT);
  const call = (who, action, input, more) => W.call(T[who], action, input, more);
  const ok = async (who, action, input, more) => { const r = await call(who, action, input, more); assert.equal(r.status, 200, action + ": " + JSON.stringify(r.error)); return r; };
  const create = async over => (await ok("off", "office.order_create", Object.assign({ customer_id: "CA", purchase_type: "ขายราคาโรงงาน", items: [{ ...B600, bags: 40 }] }, over || {}))).data;
  const order = id => W.one("SELECT * FROM orders WHERE id = ?", id);
  const rounds = id => W.q("SELECT * FROM order_rounds WHERE order_id = ? AND status = 'ใช้งาน' ORDER BY seq", id);
  const items = id => W.q("SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no", id);
  const sent = (oid, iid, qty, dd) => { ex("INSERT INTO delivery_loads(id, order_id, order_item_id, qty_pcs, status, loaded_at, done_at, done_day, created_at, updated_at) VALUES (?,?,?,?,'ส่งแล้ว',?,?,?,?,?)",
    "L" + Math.random().toString(36).slice(2, 9), oid, iid, qty, AT, AT, dd, AT, AT); ex("UPDATE order_items SET delivered_pcs = delivered_pcs + ?, version = version + 1 WHERE id = ?", qty, iid); };
  return { W, T, call, ok, create, order, rounds, items, sent, ex };
}

// ── ฟังก์ชันล้วน ───────────────────────────────────────────────────────────
test("งวด (ฟังก์ชันล้วน): ต่อครั้ง × ทุกกี่วัน · ส่วนสุดท้ายเก็บเศษ · นับถุงปัดเต็มถุง · กี่ครั้ง", () => {
  const r = buildRounds(planInput({ mode: "กำหนดจำนวน", first_day: "2026-11-20", each_pcs: 3000, every_days: 7 }), 8000);
  assert.deepEqual(r.map(x => x.plan_day), ["2026-11-20", "2026-11-27", "2026-12-04"]);
  assert.equal(r.reduce((s, x) => s + x.part_bp, 0), 10000);
  const it = { qty_pcs: 8000, per_bag: 200 };
  assert.equal(targetOf(it, r[0].part_bp), 3000, "15 ถุง");
  assert.equal(targetOf(it, r[0].part_bp + r[1].part_bp), 6000);
  assert.equal(targetOf(it, 10000), 8000);
  assert.equal(targetOf({ qty_pcs: 8015, per_bag: 200 }, 5000), 8000 / 2, "ปัดเป็นถุงเต็ม");
  const t = buildRounds(planInput({ mode: "กำหนดจำนวน", times: 4 }), 8000);
  assert.equal(t.length, 4); assert.ok(t.every(x => x.plan_day === ""), "ไม่บอกวัน = ยังไม่นัด");
  assert.equal(buildRounds(planInput({ mode: "ครั้งเดียว", first_day: "" }), 10).length, 1);
  assert.throws(() => planInput({ mode: "กำหนดจำนวน" }), /ต่อครั้ง/);
  assert.throws(() => buildRounds(planInput({ mode: "กำหนดจำนวน", each_pcs: 1 }), 100000), /ไม่เกิน 52 งวด/);
  assert.deepEqual(wantRange("2026-11-19", "สัปดาห์นี้"), { from: "2026-11-19", to: "2026-11-22" });
  assert.deepEqual(wantRange("2026-11-19", "สัปดาห์หน้า"), { from: "2026-11-23", to: "2026-11-29" });
});

test("สภาพงวด: ส่งไม่ครบแบบกำหนดจำนวน = ส่วนขาดไปรวมงวดถัดไป · ทยอยค้างต่อ (รอนัดเที่ยวถัดไป) · จอง", () => {
  const its = [{ id: "i1", qty_pcs: 8000, per_bag: 200 }];
  const rr = buildRounds(planInput({ mode: "กำหนดจำนวน", first_day: "2026-11-20", each_pcs: 4000, every_days: 7 }), 8000).map((r, i) => ({ ...r, id: "r" + i }));
  let s = planState({ plan_mode: "กำหนดจำนวน" }, rr, its.map(i => ({ ...i, delivered: 3000 })), [{ order_item_id: "i1", qty_pcs: 3000, done_day: "2026-11-20" }]);
  assert.equal(s.rounds[0].state, "ส่งไม่ครบ");
  assert.equal(s.current.seq, 2); assert.equal(s.current.carried, true);
  assert.equal(s.current.need[0].pcs, 5000, "งวด 2 = 4000 + ขาด 1000");
  assert.equal(s.due, "2026-11-27");
  s = planState({ plan_mode: "กำหนดจำนวน" }, rr, its.map(i => ({ ...i, delivered: 8000 })), [{ order_item_id: "i1", qty_pcs: 8000, done_day: "2026-11-20" }]);
  assert.equal(s.done, true, "ส่งเกินงวดแรกจนครบ = จบทั้งหมด");
  // ทยอย: ส่งวันที่นัดแล้วยังค้าง → รอนัดเที่ยวถัดไป · เพดานต่อเที่ยว
  const one = [{ id: "x", seq: 1, plan_day: "2026-11-20", part_bp: 10000 }];
  s = planState({ plan_mode: "ทยอย", plan_cap_pcs: 2000 }, one, its.map(i => ({ ...i, delivered: 2000 })), [{ order_item_id: "i1", qty_pcs: 2000, done_day: "2026-11-20" }]);
  assert.equal(s.due, ""); assert.equal(s.current.wait_next, true); assert.equal(s.current.need[0].pcs, 2000, "เพดาน 2000"); assert.equal(s.reserve, true);
  // ครั้งเดียว: ส่งไม่ครบ = ค้างในงวดเดิม วันเดิม
  s = planState({ plan_mode: "ครั้งเดียว" }, one, its.map(i => ({ ...i, delivered: 2000 })), [{ order_item_id: "i1", qty_pcs: 2000, done_day: "2026-11-20" }]);
  assert.equal(s.due, "2026-11-20"); assert.equal(s.current.need[0].pcs, 6000);
  // ไม่ได้วางงวด (ออเดอร์เก่า) = due_day เป็นงวดเดียว · ไม่มีวัน = จอง
  assert.equal(planState({ due_day: "2026-11-25" }, [], its.map(i => ({ ...i, delivered: 0 })), []).due, "2026-11-25");
  assert.equal(planState({ due_day: "" }, [], its.map(i => ({ ...i, delivered: 0 })), []).reserve, true);
});

// ── ลงออเดอร์พร้อมงวด · รอยืนยัน · ต้องการเมื่อไร ───────────────────────────────────────
test("ลงออเดอร์: งวดกำหนดจำนวน (ต่อครั้ง × ทุก 7 วัน) · วันส่ง = งวดแรก · ต้องการเมื่อไรไม่ตั้งให้เอง · รอยืนยัน = ไม่ส่งเข้าคิวแม้ขอ · ย้อนได้", async () => {
  const { W, ok, call, create, order, rounds } = await setup();
  const o = await create({ plan: { mode: "กำหนดจำนวน", first_day: "2026-11-20", each_pcs: 3000, every_days: 7 }, want_when: "สัปดาห์นี้" });
  const od = order(o.id);
  assert.equal(od.due_day, "2026-11-20"); assert.equal(od.plan_mode, "กำหนดจำนวน"); assert.equal(od.plan_each_pcs, 3000); assert.equal(od.want_when, "สัปดาห์นี้");
  assert.deepEqual(rounds(o.id).map(r => r.plan_day), ["2026-11-20", "2026-11-27", "2026-12-04"]);
  const plain = await create();
  assert.equal(order(plain.id).want_when, "", "ไม่บอก = ว่าง (ไม่ตั้ง +10 วันให้)"); assert.equal(order(plain.id).due_day, "");
  const h = await create({ hold: true, queue: true, plan: { mode: "ครั้งเดียว" } });
  assert.equal(order(h.id).hold, 1); assert.equal(order(h.id).status, "ออเดอร์ใหม่", "รอยืนยัน = ไม่เข้าคิว");
  assert.equal(W.q("SELECT * FROM production_jobs WHERE order_id = ?", h.id).length, 0);
  const d = await ok("off", "office.order", { id: h.id });
  assert.equal(d.data.plan.reserve, true, "ยังไม่มีวันนัด = จอง");
  const bad = await call("off", "office.order_create", { customer_id: "CA", items: [{ ...B600, bags: 1 }], plan: { mode: "ครั้งเดียว", first_day: "2026-11-01" } });
  assert.equal(bad.status, 400); assert.match(bad.error.message, /ผ่านมาแล้ว/);
  const w = await call("off", "office.order_create", { customer_id: "CA", items: [{ ...B600, bags: 1 }], want_when: "ระบุวัน" });
  assert.equal(w.status, 400, "ระบุวันแต่ไม่ใส่วัน");
  const r = await call("off", "office.order_create", { customer_id: "CA", items: [{ ...B600, bags: 4 }], plan: { mode: "กำหนดจำนวน", times: 2, first_day: "2026-11-20", every_days: 3 } });
  assert.equal(rounds(r.data.id).length, 2);
  await ok("off", "undo.run", { id: r.undo.id });
  assert.equal(rounds(r.data.id).length, 0, "ย้อนลงออเดอร์ = งวดยกเลิกด้วย");
});

test("นัด/เลื่อนงวด: นัดครั้งแรกไม่ต้องสาเหตุ · เลื่อน = สาเหตุบังคับ + ลงสมุด · เลื่อนงวดถัดไปตาม · ผิดสิทธิ์ · กดซ้ำ · ย้อน · ชนกัน", async () => {
  const { W, T, ok, call, create, order, rounds } = await setup();
  const o = await create({ queue: true, plan: { mode: "กำหนดจำนวน", each_pcs: 4000, times: 0 } });
  let rs = rounds(o.id);
  assert.equal(rs.length, 2); assert.equal(order(o.id).due_day, "");
  const first = await ok("off", "office.round_move", { id: o.id, version: order(o.id).version, round: rs[0].id, to_day: "2026-11-20" });
  assert.equal(first.data.logged, false, "นัดครั้งแรก = ไม่ใช่การเลื่อน");
  assert.equal(order(o.id).due_day, "2026-11-20");
  assert.equal(W.one("SELECT due_day FROM production_jobs WHERE order_id = ?", o.id).due_day, "2026-11-20", "งานผลิตตามวันนัด");
  await ok("off", "office.round_move", { id: o.id, version: order(o.id).version, round: rs[1].id, to_day: "2026-11-27" });
  // เลื่อนไม่ใส่สาเหตุ
  const nr = await call("off", "office.round_move", { id: o.id, version: order(o.id).version, round: rs[0].id, to_day: "2026-11-22", shift_after: true });
  assert.equal(nr.status, 400); assert.equal(nr.error.code, "need_reason");
  const pr = await call("prod", "office.round_move", { id: o.id, version: order(o.id).version, round: rs[0].id, to_day: "2026-11-22" }, { reason: "เครื่องเสีย" });
  assert.equal(pr.status, 403, "ทีมผลิตเลื่อนนัดลูกค้าไม่ได้");
  const key = W.key();
  const mv = await ok("off", "office.round_move", { id: o.id, version: order(o.id).version, round: rs[0].id, to_day: "2026-11-22", shift_after: true }, { reason: "เครื่องเสีย", key });
  const again = await ok("off", "office.round_move", { id: o.id, version: order(o.id).version - 1, round: rs[0].id, to_day: "2026-11-22", shift_after: true }, { reason: "เครื่องเสีย", key });
  assert.equal(again.replayed, true, "กดซ้ำ = ผลเดิม");
  rs = rounds(o.id);
  assert.deepEqual(rs.map(r => r.plan_day), ["2026-11-22", "2026-11-29"], "งวดถัดไปเลื่อนตาม 2 วัน");
  const ev = W.q("SELECT * FROM reschedule_events WHERE order_id = ? ORDER BY seq", o.id);
  assert.equal(ev.length, 2); assert.equal(ev[0].cause, "เครื่องเสีย"); assert.equal(ev[0].from_day, "2026-11-20"); assert.equal(ev[0].by_staff, "S1");
  // พิมพ์เอง = อื่น ๆ + ข้อความ
  await ok("off", "office.round_move", { id: o.id, version: order(o.id).version, round: rs[1].id, to_day: "2026-12-01" }, { reason: "ลูกค้าไปต่างจังหวัด" });
  const other = W.one("SELECT cause, note FROM reschedule_events WHERE seq = 2 AND to_day = '2026-12-01'");
  assert.equal(other.cause, "อื่น ๆ"); assert.equal(other.note, "ลูกค้าไปต่างจังหวัด");
  // ชนกัน (version เก่า)
  const stale = await call("off2", "office.round_move", { id: o.id, version: 1, round: rs[0].id, to_day: "2026-11-25" }, { reason: "รถเต็ม" });
  assert.equal(stale.status, 409);
  // ย้อนการเลื่อนอันก่อนไม่ได้ เมื่อแถวถูกแก้ต่อไปแล้ว (กติกากลาง) — บอกให้ทำรายการแก้แทน
  const u = await call("off", "undo.run", { id: mv.undo.id });
  assert.equal(u.status, 409);
  // ยกเลิกนัด (กลับเป็นจอง) ก็ต้องมีสาเหตุ
  const cur = rounds(o.id);
  const cancel = await call("off", "office.round_move", { id: o.id, version: order(o.id).version, round: cur[0].id, to_day: "" });
  assert.equal(cancel.error.code, "need_reason");
  void T;
});

test("ย้อนการเลื่อนงวด = งวดกลับวันเดิม · สมุดเลื่อนพลิกเป็นยกเลิก (ไม่ลบ)", async () => {
  const { W, ok, create, order, rounds } = await setup();
  const o = await create({ plan: { mode: "ครั้งเดียว", first_day: "2026-11-20" } });
  const r = rounds(o.id)[0];
  const mv = await ok("off", "office.round_move", { id: o.id, version: order(o.id).version, round: r.id, to_day: "2026-11-24" }, { reason: "ลูกค้าขอเลื่อน" });
  assert.equal(order(o.id).due_day, "2026-11-24");
  await ok("off", "undo.run", { id: mv.undo.id });
  assert.equal(rounds(o.id)[0].plan_day, "2026-11-20"); assert.equal(order(o.id).due_day, "2026-11-20");
  assert.equal(W.one("SELECT status FROM reschedule_events WHERE order_id = ?", o.id).status, "ยกเลิก");
});

test("วางงวดใหม่: แทนชุดเดิม (เดิมยกเลิก ไม่ลบ) · ย้ายวันที่นัดไว้ = ต้องมีสาเหตุ · ส่งไปแล้วเปลี่ยนแบบงวดไม่ได้ · ออเดอร์ยกเลิก = ล็อก", async () => {
  const { W, ok, call, create, order, rounds, items, sent } = await setup();
  const o = await create({ plan: { mode: "ครั้งเดียว", first_day: "2026-11-20" } });
  const nr = await call("off", "office.plan_set", { id: o.id, version: order(o.id).version, plan: { mode: "กำหนดจำนวน", each_pcs: 4000, first_day: "2026-11-21", every_days: 7 } });
  assert.equal(nr.error.code, "need_reason");
  await ok("off", "office.plan_set", { id: o.id, version: order(o.id).version, plan: { mode: "กำหนดจำนวน", each_pcs: 4000, first_day: "2026-11-21", every_days: 7 }, want_when: "ไม่รีบ" }, { reason: "ลูกค้าขอเลื่อน" });
  assert.equal(rounds(o.id).length, 2); assert.equal(order(o.id).due_day, "2026-11-21"); assert.equal(order(o.id).want_when, "ไม่รีบ");
  assert.equal(W.q("SELECT * FROM order_rounds WHERE order_id = ? AND status = 'ยกเลิก'", o.id).length, 1, "งวดเดิมยังอยู่ (สถานะยกเลิก)");
  assert.equal(W.one("SELECT cause FROM reschedule_events WHERE order_id = ?", o.id).cause, "ลูกค้าขอเลื่อน");
  sent(o.id, items(o.id)[0].id, 2000, "2026-11-16");
  const ch = await call("off", "office.plan_set", { id: o.id, version: order(o.id).version, plan: { mode: "ทยอย" } }, { reason: "ลูกค้าขอเลื่อน" });
  assert.equal(ch.status, 409); assert.match(ch.error.message, /เปลี่ยนแบบงวดไม่ได้/);
  const sc = await call("scr", "office.plan_set", { id: o.id, version: order(o.id).version, plan: { mode: "ครั้งเดียว" } });
  assert.equal(sc.status, 403);
  void W;
});

test("ออเดอร์เก่าที่ไม่ได้วางงวด: แก้วันส่งในฟอร์ม = ลงสมุดเลื่อน · ฟอร์มไม่ส่งวัน = ไม่แตะ · มีงวดแล้วแก้วันในฟอร์มไม่ได้", async () => {
  const { W, ok, call, create, order } = await setup();
  const o = await create({ due_day: "2026-11-20" });
  const base = { customer_id: "CA", purchase_type: "ขายราคาโรงงาน", items: [{ id: o.id + "-1", ...B600, bags: 40 }] };
  await ok("off", "office.order_update", { id: o.id, version: order(o.id).version, ...base, due_day: "2026-11-23", brand: "ก" });
  const ev = W.one("SELECT * FROM reschedule_events WHERE order_id = ?", o.id);
  assert.equal(ev.cause, "แก้ในหน้าออเดอร์"); assert.equal(ev.from_day, "2026-11-20"); assert.equal(ev.to_day, "2026-11-23");
  await ok("off", "office.order_update", { id: o.id, version: order(o.id).version, ...base, brand: "ข" });
  assert.equal(order(o.id).due_day, "2026-11-23", "ไม่ส่ง due_day = คงเดิม");
  const p = await create({ plan: { mode: "ครั้งเดียว", first_day: "2026-11-20" } });
  const r = await call("off", "office.order_update", { id: p.id, version: order(p.id).version, ...base, items: [{ id: p.id + "-1", ...B600, bags: 40 }], due_day: "2026-11-25" });
  assert.equal(r.status, 409); assert.match(r.error.message, /งวดส่ง/);
  // ออเดอร์เก่าเลื่อนผ่าน round_move (ไม่มีงวด) ได้ + สมุด
  await ok("off", "office.round_move", { id: o.id, version: order(o.id).version, round: "", to_day: "2026-11-26" }, { reason: "รถเต็ม" });
  assert.equal(order(o.id).due_day, "2026-11-26");
  assert.equal(W.q("SELECT * FROM reschedule_events WHERE order_id = ? AND cause = 'รถเต็ม'", o.id).length, 1);
});

test("รอยืนยัน: ตั้ง/ยกเลิกได้ก่อนส่งเข้าคิว · ส่งเข้าคิว = ล้างรอยืนยัน · ส่งเข้าคิวแล้วตั้งไม่ได้ · ย้อน", async () => {
  const { ok, call, create, order } = await setup();
  const o = await create();
  const s = await ok("off", "office.hold_set", { id: o.id, version: order(o.id).version, hold: true });
  assert.equal(order(o.id).hold, 1);
  const dup = await call("off", "office.hold_set", { id: o.id, version: order(o.id).version, hold: true });
  assert.equal(dup.status, 400);
  await ok("off", "undo.run", { id: s.undo.id });
  assert.equal(order(o.id).hold, 0);
  await ok("off", "office.hold_set", { id: o.id, version: order(o.id).version, hold: true });
  await ok("off", "office.order_queue", { id: o.id, version: order(o.id).version, sources: {} });
  assert.equal(order(o.id).hold, 0, "ส่งเข้าคิว = ยืนยันแล้ว");
  const late = await call("off", "office.hold_set", { id: o.id, version: order(o.id).version, hold: true });
  assert.equal(late.status, 409);
  assert.equal((await call("drv", "office.hold_set", { id: o.id, version: order(o.id).version, hold: false })).status, 403);
});

// ── มัดจำ ───────────────────────────────────────────────────────────────
test("มัดจำ: หลายครั้ง · ช่องทางต้องเลือกเอง · เห็นเฉพาะบทบาทที่เห็นเงิน · ยกเลิกต้องมีเหตุผล · ย้อน · ไม่หักยอดบิล + ธงตอนออกบิล", async () => {
  const { W, ok, call, create, order, items } = await setup();
  const o = await create({ queue: true, items: [{ ...B600, bags: 40, price_satang: 120 }] });
  const a = await ok("off", "office.deposit_add", { order: o.id, amount_satang: 100000, channel: "โอน KBank", paid_day: "2026-11-16", note: "สลิปในไลน์" });
  await ok("acc", "office.deposit_add", { order: o.id, amount_satang: 50050, channel: "เงินสด", paid_day: "2026-11-15" });
  for (const who of ["prod", "drv", "scr"]) {
    assert.equal((await call(who, "office.deposit_add", { order: o.id, amount_satang: 1, channel: "เงินสด", paid_day: "2026-11-16" })).status, 403, who + " ลงมัดจำไม่ได้");
    assert.equal((await call(who, "office.deposits", { order: o.id })).status, 403, who + " เห็นมัดจำไม่ได้");
  }
  assert.equal((await call("off", "office.deposit_add", { order: o.id, amount_satang: 100, paid_day: "2026-11-16" })).status, 400, "ไม่เลือกช่องทาง");
  assert.equal((await call("off", "office.deposit_add", { order: o.id, amount_satang: 100, channel: "พร้อมเพย์มั่ว", paid_day: "2026-11-16" })).status, 400);
  assert.equal((await call("off", "office.deposit_add", { order: o.id, amount_satang: 100, channel: "เงินสด", paid_day: "2026-11-30" })).status, 400, "วันในอนาคต");
  assert.equal((await call("off", "office.deposit_add", { order: o.id, amount_satang: "12.5", channel: "เงินสด", paid_day: "2026-11-16" })).status, 400, "สตางค์ต้องเป็นจำนวนเต็ม");
  const list = await ok("off", "office.deposits", { order: o.id });
  assert.equal(list.data.sum_satang, 150050);
  const det = await ok("off", "office.order", { id: o.id });
  assert.equal(det.data.deposit_satang, 150050); assert.equal(det.data.deposits.length, 2);
  // ยกเลิก = เหตุผลบังคับ
  const dep = W.one("SELECT * FROM order_deposits WHERE id = ?", a.data.id);
  assert.equal((await call("off", "office.deposit_cancel", { id: dep.id, version: dep.version })).status, 400);
  const c = await ok("off", "office.deposit_cancel", { id: dep.id, version: dep.version }, { reason: "ยอด/ช่องทางผิด" });
  assert.equal(W.one("SELECT status, cancel_reason FROM order_deposits WHERE id = ?", dep.id).status, "ยกเลิก");
  await ok("off", "undo.run", { id: c.undo.id });
  assert.equal(W.one("SELECT status FROM order_deposits WHERE id = ?", dep.id).status, "ใช้งาน");
  // ออกบิล: ยอดบิล = ราคา × จำนวน (ไม่หักมัดจำ) + ธงให้บัญชีตัดสิน
  const b = await ok("off", "office.bill_create", { order_id: o.id, version: order(o.id).version, kind: "เครดิต", due_day: "2026-12-16", lines: [{ item_id: items(o.id)[0].id, qty_pcs: 8000, price_satang: 120 }] });
  assert.equal(b.data.total_satang, 960000, "ไม่หักมัดจำเอง");
  const f = W.one("SELECT * FROM flags WHERE kind = 'มีมัดจำ ตรวจตอนออกบิล'");
  assert.equal(f.team, "account"); assert.match(f.title, /1,500.5/);
  const bill = await ok("off", "office.bill", { bill_no: b.data.bill_no });
  assert.equal(bill.data.deposit_satang, 150050); assert.equal(bill.data.bill.total_satang, 960000);
  // ออเดอร์ยกเลิกแล้ว = ลงมัดจำไม่ได้
  const o2 = await create();
  await ok("off", "office.order_cancel", { id: o2.id, version: order(o2.id).version }, { reason: "ลงซ้ำ" });
  assert.equal((await call("off", "office.deposit_add", { order: o2.id, amount_satang: 100, channel: "เงินสด", paid_day: "2026-11-16" })).status, 409);
});

test("มัดจำ: ค่าตั้ง DEPOSIT_REMIND (§9 ยังไม่ตัดสิน) — ไม่เตือน = ไม่มีธง · งานสกรีน/ทุกออเดอร์ = ธงตอนส่งเข้าคิว ไม่บล็อก", async () => {
  const { W, ok, create, order, ex } = await setup();
  const o1 = await create({ queue: true });
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ยังไม่มีมัดจำ'").length, 0, "ค่าตั้งต้น = ไม่เตือน");
  ex("UPDATE settings SET value = 'งานสกรีน' WHERE key = 'DEPOSIT_REMIND'");
  await create({ queue: true });
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ยังไม่มีมัดจำ'").length, 0, "ไม่มีสกรีน = ไม่เตือน");
  const s = await create({ queue: true, items: [{ ...B600, bags: 40, screen_color: "น้ำเงิน" }] });
  assert.equal(order(s.id).status, "รอผลิต", "ไม่บล็อก");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ยังไม่มีมัดจำ'").length, 1);
  ex("UPDATE settings SET value = 'ทุกออเดอร์' WHERE key = 'DEPOSIT_REMIND'");
  const n = await create();
  await ok("off", "office.deposit_add", { order: n.id, amount_satang: 5000, channel: "เงินสด", paid_day: "2026-11-16" });
  await ok("off", "office.order_queue", { id: n.id, version: order(n.id).version, sources: {} });
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ยังไม่มีมัดจำ' AND entity_id = ?", n.id).length, 0, "มีมัดจำแล้ว = ไม่เตือน");
  void o1;
});

// ── รวมตามสินค้า · หน้าร้าน ─────────────────────────────────────────────────────
test("รวมตามสินค้า: นับเฉพาะที่ยังต้องส่ง (สั่ง − ส่งแล้ว) · ไม่นับใบที่จบ/ยกเลิก · ไม่มียอดเงิน · ผิดสิทธิ์", async () => {
  const { ok, call, create, order, items, sent } = await setup();
  const a = await create({ queue: true, items: [{ ...B600, bags: 40 }, { ...B600, color: "น้ำเงิน", bags: 10, screen_color: "ขาว" }] });
  const b = await create({ customer_id: "CB", queue: true, items: [{ ...B600, bags: 5 }] });
  const c = await create({ items: [{ ...B600, bags: 99 }] });
  await ok("off", "office.order_cancel", { id: c.id, version: order(c.id).version }, { reason: "ลงซ้ำ" });
  sent(a.id, items(a.id)[0].id, 3000, "2026-11-16");
  const t = await ok("off", "office.tree", {});
  const clear = t.data.lines.filter(l => l.color === "ใส");
  assert.equal(clear.reduce((s, l) => s + l.left_pcs, 0), 8000 - 3000 + 1000);
  assert.equal(t.data.orders, 2);
  assert.ok(t.data.lines.every(l => !("price_satang" in l) && !("total_satang" in l)), "ไม่มีเงินในรายการ");
  assert.equal(t.data.lines.find(l => l.color === "น้ำเงิน").screen_color, "ขาว");
  assert.equal((await call("prod", "office.tree", {})).status, 403);
  void b;
});

test("รายการซื้อหน้าร้าน: ตามวัน + ยอดรวมใบ/ถุง + เงินตามราคาที่ลง (ไม่ใส่ราคา = นับว่ายังไม่ใส่ ไม่เดา) · ช่วงวัน", async () => {
  const { W, ok, call, create } = await setup();
  await create({ purchase_type: "ขายหน้าร้าน", items: [{ ...B600, bags: 2, price_satang: 150 }] });
  await create({ purchase_type: "ขายหน้าร้าน", customer_id: "CB", items: [{ ...B600, bags: 3 }] });
  await create({ purchase_type: "ขายราคาโรงงาน", items: [{ ...B600, bags: 50 }] });
  W.tick(864e5);
  await create({ purchase_type: "ขายหน้าร้าน", items: [{ ...B600, bags: 1, price_satang: 150 }] });
  const r = await ok("off", "office.walkin", {});
  assert.equal(r.data.days.length, 2);
  const d16 = r.data.days.find(d => d.day === "2026-11-16");
  assert.equal(d16.orders.length, 2, "ไม่รวมขายราคาโรงงาน");
  assert.equal(d16.products[0].qty_pcs, 1000); assert.equal(d16.products[0].bags, 5);
  assert.equal(d16.money_satang, 400 * 150); assert.equal(d16.unpriced, 1);
  assert.equal(r.data.total.orders, 3);
  const only = await ok("off", "office.walkin", { from: "2026-11-17", to: "2026-11-17" });
  assert.equal(only.data.days.length, 1);
  assert.equal((await call("off", "office.walkin", { from: "2026-11-20", to: "2026-11-01" })).status, 400);
  assert.equal((await call("drv", "office.walkin", {})).status, 403);
});

test("หน้าออฟฟิศ/ส่งของใช้วันของงวด: แถวออเดอร์ due = งวดที่ถึงคิว · เส้นทางส่งของได้วันงวด 2 หลังงวด 1 ส่งไม่ครบ + จำนวนงวดนี้", async () => {
  const { ok, create, items, sent } = await setup();
  const o = await create({ queue: true, plan: { mode: "กำหนดจำนวน", first_day: "2026-11-16", each_pcs: 4000, every_days: 7 } });
  sent(o.id, items(o.id)[0].id, 3000, "2026-11-16");
  const home = await ok("off", "office.home", {});
  const row = home.data.orders.find(r => r.id === o.id);
  assert.equal(row.due_day, "2026-11-23"); assert.deepEqual(row.round, { seq: 2, n: 2, carried: true }); assert.equal(row.late, false);
  const board = await ok("drv", "deliver.board", {});
  const s = board.data.stops.find(x => x.id === o.id);
  assert.equal(s.due_day, "2026-11-23"); assert.equal(s.round.seq, 2);
  assert.equal(s.items[0].round_pcs, 5000, "งวด 2 + ส่วนขาดงวด 1");
  assert.equal(s.has_geo, false);
  assert.ok(!("price_satang" in s.items[0]), "ส่งของไม่เห็นเงิน");
});
