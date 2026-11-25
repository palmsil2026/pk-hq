// เทสต์โมดูลออฟฟิศ: ลงออเดอร์ · ส่งเข้าคิว · แก้ (ก่อน/หลังทีมผลิตรับ) · ยกเลิก (ทั้งใบ/หลังส่งบางส่วน) · ลูกค้ามารับ · บิล · ลูกค้า · หน้าอ่าน
//   ทุก action: ถูก / ผิดสิทธิ์ / กดซ้ำ / ย้อน / ชนกัน — ข้อมูลสมมติล้วน
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { specKey } from "../server/core.mjs";
import { deriveOrder, orderStatusOps, splitBags } from "../server/actions/office-lib.mjs";
import { wrapDb } from "../server/db.mjs";

const AT = new Date(T0).toISOString();
const B600 = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
const K600 = specKey(B600, "ขนาด,คอขวด,รูปทรง,สี,สีสกรีน,พร้อมฝาสี");

async function setup() {
  const W = world();
  const T = {
    off: await W.staff("S1", "แอน", ["office"]), off2: await W.staff("S2", "ฝน", ["office"]),
    prod: await W.staff("S3", "บอส", ["prod"]), boss: await W.staff("S9", "หัวหน้า", ["exec"]), acc: await W.staff("S4", "ฝ้าย", ["account"]),
  };
  const ex = (sql, ...a) => W.d1.raw.prepare(sql).run(...a);
  ex("INSERT INTO routes(code, name, area, created_at, updated_at) VALUES ('115','สาย 115','ใกล้',?,?)", AT, AT);
  ex("INSERT INTO customers(id, name, name_key, route_code, district, note, created_at, updated_at) VALUES ('CA','ร้านทดสอบ ก','ร้านทดสอบก','115','เมือง','เงินไม่ดีให้สั่งทางออฟฟิศ',?,?)", AT, AT);
  ex("INSERT INTO customers(id, name, name_key, district, credit_days, created_at, updated_at) VALUES ('CB','ร้านทดสอบ ข','ร้านทดสอบข','แม่ทะ',15,?,?)", AT, AT);
  ex("INSERT INTO prices(item_key, kind, price_satang, updated_at, updated_by) VALUES (?, 'ราคาโรงงาน', 120, ?, 'S9')", "spec:" + K600, AT);
  const call = (who, action, input, more) => W.call(T[who], action, input, more);
  const create = async (over, who) => {
    const r = await call(who || "off", "office.order_create", Object.assign({ customer_id: "CA", purchase_type: "ขายราคาโรงงาน", items: [{ ...B600, bags: 40 }] }, over || {}));
    assert.equal(r.status, 200, JSON.stringify(r.error));
    return r.data;
  };
  const order = id => W.one("SELECT * FROM orders WHERE id = ?", id);
  const items = id => W.q("SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no", id);
  // เรียงตามบรรทัดของออเดอร์ (นาฬิกาเทสต์หยุดนิ่ง — created_at เท่ากันหมด)
  const jobs = id => W.q("SELECT j.* FROM production_jobs j JOIN order_items i ON i.id = j.order_item_id WHERE j.order_id = ? ORDER BY i.line_no, j.rowid", id);
  const sjobs = id => W.q("SELECT * FROM screen_jobs WHERE order_id = ?", id);
  const prodStarts = jobId => ex("UPDATE production_jobs SET status = 'กำลังผลิต', version = version + 1 WHERE id = ?", jobId);
  const load = (oid, iid, qty, status) => ex("INSERT INTO delivery_loads(id, order_id, order_item_id, qty_pcs, status, loaded_at, done_at, done_day, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    "L" + Math.random().toString(36).slice(2, 8), oid, iid, qty, status, AT, status === "ส่งแล้ว" ? AT : "", status === "ส่งแล้ว" ? "2026-11-16" : "", AT, AT);
  return { W, T, call, create, order, items, jobs, sjobs, prodStarts, load, ex };
}

test("ลงออเดอร์: จำนวนคิดที่หลังบ้าน (ถุง × ใบต่อถุง + เศษ) · แกนที่ไม่ใช้ถูกล้าง · ยังไม่ส่งเข้าคิว = ไม่มีงานผลิต · audit + ย้อนได้", async () => {
  const { W, call, order, items, jobs } = await setup();
  const r = await call("off", "office.order_create", { customer_id: "CA", brand: "แบรนด์ทดสอบ", due_day: "2026-11-20", urgent: true, purchase_type: "ขายราคาโรงงาน",
    items: [{ ...B600, bags: 40, extra_pcs: 15, qty_pcs: 999999, per_bag: 1 }, { type: "ฟิล์มหุ้มคอ", size: "คอถัง", neck: "คอยาว", shape: "MK", color: "ใส", qty_pcs: 3000, bags: 9 }] });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  const o = order(r.data.id);
  assert.equal(o.status, "ออเดอร์ใหม่"); assert.equal(o.urgent, 1); assert.equal(o.brand, "แบรนด์ทดสอบ"); assert.equal(o.taker_staff_id, "S1"); assert.equal(o.src, "v2"); assert.equal(o.order_day, "2026-11-16");
  assert.equal(o.total_satang, null, "ไม่ใส่ราคา = NULL ไม่ใช่ 0");
  const [a, b] = items(r.data.id);
  assert.equal(a.qty_pcs, 40 * 200 + 15); assert.equal(a.per_bag, 200); assert.equal(a.bags, 40); assert.equal(a.spec_key, K600);
  assert.equal(b.neck, ""); assert.equal(b.shape, ""); assert.equal(b.bags, 0); assert.equal(b.qty_pcs, 3000, "ฟิล์มนับเป็นชิ้น ไม่มีถุง");
  assert.equal(jobs(r.data.id).length, 0, "ยังไม่ส่งเข้าคิว = ยังไม่มีงานผลิต");
  assert.ok(W.q("SELECT * FROM audit_log WHERE action = 'office.order_create'").length >= 3);
  assert.equal(r.undo.label, "ลงออเดอร์ ร้านทดสอบ ก");
  const u = await call("off", "undo.run", { id: r.undo.id });
  assert.equal(u.status, 200);
  assert.equal(order(r.data.id).status, "ยกเลิก", "ย้อน = พลิกสถานะ ไม่ลบแถว");
});

test("ลงออเดอร์: สิทธิ์ · กดซ้ำได้ผลเดิม · ข้อมูลผิดบอกเป็นไทย", async () => {
  const { W, call, T } = await setup();
  const bad1 = await call("prod", "office.order_create", { customer_id: "CA", items: [{ ...B600, bags: 1 }] });
  assert.equal(bad1.status, 403);
  const acc = await call("acc", "office.order", { id: "x" });
  assert.equal(acc.status, 403, "บัญชีไม่ได้เปิดหน้าออฟฟิศ");
  const key = W.key();
  const in1 = { customer_id: "CA", items: [{ ...B600, bags: 10 }] };
  const a = await W.call(T.off, "office.order_create", in1, { key });
  const b = await W.call(T.off, "office.order_create", in1, { key });
  assert.equal(a.data.id, b.data.id); assert.equal(b.replayed, true);
  assert.equal(W.one("SELECT count(*) n FROM orders").n, 1);
  const cases = [
    [{ customer_id: "CA", items: [] }, /อย่างน้อย 1 รายการ/],
    [{ customer_id: "CA", items: [{ type: "เรือ", bags: 1 }] }, /ไม่รู้จักประเภทสินค้า/],
    [{ customer_id: "CA", items: [{ type: "ขวด", bags: 1 }] }, /ต้องเลือกขนาด/],
    [{ customer_id: "CA", items: [{ ...B600, bags: 0 }] }, /ต้องใส่จำนวน/],
    [{ customer_id: "CA", items: [{ ...B600, bags: 1.5 }] }, /จำนวนเต็ม/],
    [{ customer_id: "CA", due_day: "2026-11-15", items: [{ ...B600, bags: 1 }] }, /ผ่านมาแล้ว/],
    [{ customer_id: "CA", pay_status: "จ่ายครึ่ง", items: [{ ...B600, bags: 1 }] }, /สถานะเงิน/],
    [{ customer_id: "ไม่มี", items: [{ ...B600, bags: 1 }] }, /ไม่พบลูกค้า/],
    [{ items: [{ ...B600, bags: 1 }] }, /ต้องเลือกลูกค้า/],
  ];
  for (const [inp, re] of cases) { const r = await call("off", "office.order_create", inp); assert.ok(r.status >= 400, JSON.stringify(inp)); assert.match(r.error.message, re); }
  assert.equal(W.one("SELECT count(*) n FROM orders").n, 1, "คำขอที่ล้มไม่ทิ้งอะไรไว้");
});

test("ลงออเดอร์: ราคาไม่ตรงราคาตั้ง = ต้องมีเหตุผล + ธง · ขั้นต่ำ = เตือน (ธง) ไม่บล็อก · สเปกนอกทะเบียน = ทำได้ + ธง", async () => {
  const { W, call, items } = await setup();
  const r1 = await call("off", "office.order_create", { customer_id: "CA", purchase_type: "ขายราคาโรงงาน", items: [{ ...B600, bags: 40, price_satang: 110 }] });
  assert.equal(r1.status, 400); assert.match(r1.error.message, /ไม่ตรงราคาตั้ง ฿1.2/); assert.equal(r1.error.needPriceReason, 1);
  const r2 = await call("off", "office.order_create", { customer_id: "CA", purchase_type: "ขายราคาโรงงาน", items: [{ ...B600, bags: 40, price_satang: 110, price_reason: "ลูกค้าประจำ" }] });
  assert.equal(r2.status, 200);
  assert.equal(items(r2.data.id)[0].price_reason, "ลูกค้าประจำ");
  assert.equal(W.one("SELECT total_satang FROM orders WHERE id = ?", r2.data.id).total_satang, 110 * 8000);
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ราคาไม่ตรงทะเบียน'").length, 1);
  const r3 = await call("off", "office.order_create", { customer_id: "CA", purchase_type: "ขายราคาโรงงาน", items: [{ ...B600, bags: 40, price_satang: 120 }] });
  assert.equal(r3.status, 200, "ราคาตรง = ไม่ต้องมีเหตุผล");
  const r4 = await call("off", "office.order_create", { customer_id: "CA", items: [{ ...B600, bags: 2 }, { ...B600, color: "ม่วงพาสเทล", bags: 10 }] });
  assert.equal(r4.status, 200, "ต่ำกว่าขั้นต่ำ/สีนอกทะเบียน ไม่บล็อก");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'ต่ำกว่าขั้นต่ำ'").length, 1);
  assert.match(W.one("SELECT detail FROM flags WHERE kind = 'สเปกนอกทะเบียน'").detail, /สี ม่วงพาสเทล/);
  // ย้อนออเดอร์ = ธงที่ออเดอร์นั้นยกปิดเอง
  await call("off", "undo.run", { id: r4.undo.id });
  assert.equal(W.q("SELECT * FROM flags WHERE kind IN ('ต่ำกว่าขั้นต่ำ','สเปกนอกทะเบียน') AND status = 'เปิด'").length, 0);
});

test("ลงออเดอร์พร้อมลูกค้าใหม่: ลงชุดเดียว · ชื่อซ้ำแบบหลวม = 409 + บอกรายเดิม · ชื่อมีงานปน (ในหน้าลูกค้า) ถูกเตือน", async () => {
  const { W, call } = await setup();
  const r = await call("off", "office.order_create", { new_customer: { name: "ร้านใหม่ เถิน", district: "เถิน", phone: "080-000-0000", route_code: "115" }, items: [{ ...B600, bags: 10 }] });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  const c = W.one("SELECT * FROM customers WHERE id = ?", r.data.customer_id);
  assert.equal(c.name, "ร้านใหม่ เถิน"); assert.equal(c.name_key, "ร้านใหม่เถิน"); assert.equal(c.src, "v2");
  const dup = await call("off", "office.order_create", { new_customer: { name: "ร้านทดสอบ(ก)" }, items: [{ ...B600, bags: 10 }] });
  assert.equal(dup.status, 409); assert.equal(dup.error.customer_id, "CA"); assert.match(dup.error.message, /มี "ร้านทดสอบ ก" ในทะเบียนแล้ว/);
  const mixed = await call("off", "office.customer_create", { name: "ช้างทดสอบ งานช้างทดสอบ" });
  assert.equal(mixed.status, 400); assert.match(mixed.error.message, /ชื่องานปน/);
  // ย้อนออเดอร์ที่มากับลูกค้าใหม่ = ลูกค้าใหม่ถูกพัก (ไม่ลบ)
  await call("off", "undo.run", { id: r.undo.id });
  assert.equal(W.one("SELECT status FROM customers WHERE id = ?", r.data.customer_id).status, "พัก");
});

test("ส่งเข้าคิว: งานผลิตต่อรายการ + งานสกรีน · ของในสต๊อก = ไม่สร้างงานผลิต · ซ้ำ/ชนกันถูกกัน · ย้อนได้จนทีมผลิตรับ", async () => {
  const { W, call, create, order, items, jobs, sjobs, prodStarts } = await setup();
  const o = await create({ due_day: "2026-11-20", items: [{ ...B600, bags: 40, screen_color: "น้ำเงิน + ขาว" }, { type: "ฝา", size: "ถังใส", color: "น้ำเงิน", qty_pcs: 500 }] });
  const its = items(o.id);
  assert.equal(its[0].screen_color, "น้ำเงิน + ขาว");
  const r = await call("off", "office.order_queue", { id: o.id, version: 1, sources: { [its[1].id]: "สต๊อก" } });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  assert.equal(order(o.id).status, "รอผลิต");
  const j = jobs(o.id);
  assert.equal(j.length, 1); assert.equal(j[0].target_pcs, 8000); assert.equal(j[0].due_day, "2026-11-20"); assert.equal(j[0].order_item_id, its[0].id);
  assert.equal(sjobs(o.id).length, 1); assert.equal(sjobs(o.id)[0].colors, "น้ำเงิน + ขาว"); assert.equal(sjobs(o.id)[0].status, "รอดำเนินการ");
  assert.deepEqual(items(o.id).map(i => i.source), ["ผลิต", "สต๊อก"]);
  const again = await call("off", "office.order_queue", { id: o.id, version: order(o.id).version });
  assert.equal(again.status, 409); assert.match(again.error.message, /ส่งเข้าคิวไปแล้ว/);
  const stale = await call("off2", "office.order_queue", { id: o.id, version: 1 });
  assert.equal(stale.status, 409, "สองคนกดพร้อมกัน คนหลังชน");
  // ย้อนได้ก่อนทีมผลิตรับ
  const u = await call("off", "undo.run", { id: r.undo.id });
  assert.equal(u.status, 200);
  assert.equal(order(o.id).status, "ออเดอร์ใหม่"); assert.equal(jobs(o.id)[0].status, "ยกเลิก"); assert.equal(sjobs(o.id)[0].status, "ยกเลิก");
  // ส่งใหม่ → ทีมผลิตรับ → ย้อนไม่ได้แล้ว (บอกให้ทำรายการแก้แทน)
  const r2 = await call("off", "office.order_queue", { id: o.id, version: order(o.id).version });
  prodStarts(jobs(o.id).find(x => x.status === "รอผลิต").id);
  const u2 = await call("off", "undo.run", { id: r2.undo.id });
  assert.equal(u2.status, 409); assert.match(u2.error.message, /ขั้นถัดไปรับงานไปแล้ว/);
  // ทุกอย่างจากคลังสต๊อก + ไม่มีสกรีน = พร้อมส่งทันที
  const s = await create({ items: [{ ...B600, bags: 5 }] });
  const q = await call("off", "office.order_queue", { id: s.id, version: 1, sources: { [items(s.id)[0].id]: "สต๊อก" } });
  assert.equal(q.data.status, "พร้อมส่ง"); assert.equal(jobs(s.id).length, 0);
});

test("ลงแล้วส่งเข้าคิวเลยในคำขอเดียว", async () => {
  const { call, order, jobs } = await setup();
  const r = await call("off", "office.order_create", { customer_id: "CB", queue: true, items: [{ ...B600, bags: 12 }] });
  assert.equal(r.data.status, "รอผลิต"); assert.equal(r.data.jobs, 1);
  assert.equal(order(r.data.id).status, "รอผลิต"); assert.equal(jobs(r.data.id)[0].target_pcs, 2400);
});

test("แก้ออเดอร์ก่อนทีมผลิตรับ: แก้ได้เลย ไม่ต้องมีเหตุผล · วันส่ง/ด่วนไหลไปงานผลิต · มีประวัติก่อน/หลัง · ย้อนได้", async () => {
  const { W, call, create, order, items, jobs } = await setup();
  const o = await create({ queue: true, due_day: "2026-11-20" });
  const it = items(o.id)[0];
  const r = await call("off", "office.order_update", { id: o.id, version: order(o.id).version, customer_id: "CA", due_day: "2026-11-25", urgent: true, purchase_type: "ขายราคาโรงงาน",
    items: [{ id: it.id, ...B600, bags: 50 }, { type: "ถัง", size: "18.9 ลิตร", color: "ใส", bags: 4 }] });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  assert.equal(items(o.id)[0].qty_pcs, 10000); assert.equal(items(o.id)[1].qty_pcs, 20);
  const j = jobs(o.id);
  assert.equal(j.length, 2); assert.equal(j[0].target_pcs, 10000); assert.equal(j[0].due_day, "2026-11-25"); assert.equal(j[0].urgent, 1); assert.equal(j[1].type, "ถัง");
  const d = await call("off", "office.order", { id: o.id });
  const h = d.data.history[0];
  assert.equal(h.what, "แก้ออเดอร์"); assert.equal(h.who, "แอน");
  assert.ok(h.changes.some(c => c.field === "วันส่ง" && c.from === "2026-11-20" && c.to === "2026-11-25"));
  assert.ok(h.changes.some(c => c.field === "จำนวน" && c.from === 8000 && c.to === 10000));
  assert.equal(d.data.undo.id, r.undo.id, "รายละเอียดบอกว่ายังย้อนได้");
  await call("off", "undo.run", { id: r.undo.id });
  assert.equal(items(o.id)[0].qty_pcs, 8000); assert.equal(items(o.id)[1].status, "ยกเลิก"); assert.equal(jobs(o.id)[0].due_day, "2026-11-20");
  const none = await call("off", "office.order_update", { id: o.id, version: order(o.id).version, customer_id: "CA", due_day: "2026-11-20", purchase_type: "ขายราคาโรงงาน", items: [{ id: it.id, ...B600, bags: 40 }] });
  assert.equal(none.status, 400); assert.match(none.error.message, /ไม่มีอะไรเปลี่ยน/);
  assert.equal((await call("prod", "office.order_update", { id: o.id, version: 1, items: [{ ...B600, bags: 1 }] })).status, 403);
});

test("แก้ออเดอร์หลังทีมผลิตรับงาน: เปลี่ยนจำนวน = ต้องมีเหตุผล + ธงถึงทีมผลิต · เปลี่ยนสเปก = บอกทางแก้ · เอาออก = เหตุผล · ชนกัน = 409", async () => {
  const { W, call, create, order, items, jobs, prodStarts, ex } = await setup();
  const o = await create({ queue: true, items: [{ ...B600, bags: 40 }, { ...B600, color: "น้ำเงิน", bags: 20 }] });
  const [a, b] = items(o.id);
  prodStarts(jobs(o.id)[0].id);
  const base = { id: o.id, customer_id: "CA", purchase_type: "ขายราคาโรงงาน" };
  const q1 = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: a.id, ...B600, bags: 45 }, { id: b.id, ...B600, color: "น้ำเงิน", bags: 20 }] });
  assert.equal(q1.status, 400); assert.equal(q1.error.code, "need_reason"); assert.equal(q1.error.needReason, true); assert.match(q1.error.why[0], /ทีมผลิตเริ่มทำแล้ว/);
  const q2 = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: a.id, ...B600, bags: 45 }, { id: b.id, ...B600, color: "น้ำเงิน", bags: 20 }] }, { reason: "ลูกค้าขอเปลี่ยน" });
  assert.equal(q2.status, 200, JSON.stringify(q2.error));
  assert.equal(jobs(o.id)[0].target_pcs, 9000);
  const f = W.one("SELECT * FROM flags WHERE kind = 'แก้ออเดอร์หลังเริ่มงาน'");
  assert.equal(f.team, "prod"); assert.match(f.detail, /ลูกค้าขอเปลี่ยน/);
  const spec = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: a.id, ...B600, color: "เขียว", bags: 45 }, { id: b.id, ...B600, color: "น้ำเงิน", bags: 20 }] }, { reason: "ลงผิด" });
  assert.equal(spec.status, 409); assert.equal(spec.error.code, "locked"); assert.match(spec.error.message, /แก้สเปกไม่ได้ · ให้ลบรายการนี้/);
  // รายการที่ 2 ยังไม่เริ่ม → แก้สเปกได้ (งานผลิตตามไปด้วย)
  const ok2 = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: a.id, ...B600, bags: 45 }, { id: b.id, ...B600, color: "เขียว", bags: 20 }] });
  assert.equal(ok2.status, 200, JSON.stringify(ok2.error));
  assert.equal(jobs(o.id)[1].color, "เขียว"); assert.equal(jobs(o.id)[1].spec_key, items(o.id)[1].spec_key);
  // เอารายการที่เริ่มแล้วออก = เหตุผล · งานผลิตถูกยกเลิก
  const rm = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: b.id, ...B600, color: "เขียว", bags: 20 }] }, { reason: "ลูกค้าขอเปลี่ยน" });
  assert.equal(rm.status, 200);
  assert.equal(items(o.id)[0].status, "ยกเลิก"); assert.equal(jobs(o.id)[0].status, "ยกเลิก");
  // สองคนแก้จาก version เดียวกัน คนหลังชน
  const v = order(o.id).version;
  const x1 = await call("off", "office.order_update", { ...base, version: v, note: "คนแรก", items: [{ id: b.id, ...B600, color: "เขียว", bags: 20 }] });
  const x2 = await call("off2", "office.order_update", { ...base, version: v, note: "คนที่สอง", items: [{ id: b.id, ...B600, color: "เขียว", bags: 20 }] });
  assert.equal(x1.status, 200); assert.equal(x2.status, 409);
  assert.equal(order(o.id).note, "คนแรก");
  // ทีมผลิตทำเสร็จแล้ว แต่ลูกค้าขอเพิ่ม = งานผลิตใบใหม่เฉพาะส่วนที่เพิ่ม
  const jb = jobs(o.id).find(j => j.order_item_id === b.id);
  ex("UPDATE production_jobs SET status = 'เสร็จ', good_pcs = 4000, version = version + 1 WHERE id = ?", jb.id);
  const more = await call("off", "office.order_update", { ...base, version: order(o.id).version, note: "คนแรก", items: [{ id: b.id, ...B600, color: "เขียว", bags: 30 }] }, { reason: "ลูกค้าขอเปลี่ยน" });
  assert.equal(more.status, 200, JSON.stringify(more.error));
  const extra = jobs(o.id).filter(j => j.order_item_id === b.id && j.status === "รอผลิต");
  assert.equal(extra.length, 1); assert.equal(extra[0].target_pcs, 2000);
  assert.equal(order(o.id).status, "รอผลิต");
});

test("แก้ออเดอร์ที่ส่ง/มีบิลแล้ว: ลดต่ำกว่าที่ส่งไม่ได้ · แก้สเปกของที่ส่งแล้วไม่ได้ · มีบิล = แก้รายการไม่ได้ แต่หมายเหตุแก้ได้", async () => {
  const { call, create, order, items, load } = await setup();
  const o = await create({ queue: true });
  const it = items(o.id)[0];
  load(o.id, it.id, 3000, "ส่งแล้ว");
  const base = { id: o.id, customer_id: "CA", purchase_type: "ขายราคาโรงงาน" };
  const low = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: it.id, ...B600, bags: 10 }] });
  assert.equal(low.status, 409); assert.match(low.error.message, /ลดให้ต่ำกว่านี้ไม่ได้/);
  const sp = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: it.id, ...B600, color: "ฟ้า", bags: 40 }] });
  assert.equal(sp.status, 409); assert.match(sp.error.message, /ส่ง\/ขึ้นรถไปแล้ว/);
  const cust = await call("off", "office.order_update", { ...base, customer_id: "CB", version: order(o.id).version, items: [{ id: it.id, ...B600, bags: 40 }] });
  assert.equal(cust.status, 409); assert.match(cust.error.message, /เปลี่ยนลูกค้าไม่ได้/);
  const bill = await call("off", "office.bill_create", { order_id: o.id, version: order(o.id).version, kind: "เงินสด", lines: [{ item_id: it.id, qty_pcs: 3000, price_satang: 120 }] });
  assert.equal(bill.status, 200, JSON.stringify(bill.error));
  const after = await call("off", "office.order_update", { ...base, version: order(o.id).version, items: [{ id: it.id, ...B600, bags: 41 }] });
  assert.equal(after.status, 409); assert.match(after.error.message, /มีบิลแล้ว/);
  const note = await call("off", "office.order_update", { ...base, version: order(o.id).version, note: "ลูกค้าโทรตาม", items: [{ id: it.id, ...B600, bags: 40 }] });
  assert.equal(note.status, 200, JSON.stringify(note.error));
});

test("ยกเลิก: เหตุผลบังคับ · งานผลิต/สกรีนยกเลิกตาม (ธงถึงทีมที่เริ่มแล้ว) · ของบนรถ = รอ · มีบิล = ยกเลิกบิลก่อน · ย้อนได้", async () => {
  const { W, call, create, order, items, jobs, sjobs, prodStarts, load } = await setup();
  const o = await create({ queue: true, items: [{ ...B600, bags: 40, screen_color: "แดง" }] });
  const noReason = await call("off", "office.order_cancel", { id: o.id, version: order(o.id).version });
  assert.equal(noReason.status, 400); assert.match(noReason.error.message, /เหตุผล/);
  prodStarts(jobs(o.id)[0].id);
  const r = await call("off", "office.order_cancel", { id: o.id, version: order(o.id).version }, { reason: "ลูกค้ายกเลิก" });
  assert.equal(r.status, 200);
  assert.equal(order(o.id).status, "ยกเลิก"); assert.equal(order(o.id).cancel_reason, "ลูกค้ายกเลิก");
  assert.equal(jobs(o.id)[0].status, "ยกเลิก"); assert.equal(sjobs(o.id)[0].status, "ยกเลิก");
  assert.equal(W.one("SELECT team FROM flags WHERE kind = 'แก้ออเดอร์หลังเริ่มงาน'").team, "prod");
  const twice = await call("off", "office.order_cancel", { id: o.id, version: order(o.id).version }, { reason: "ลงซ้ำ" });
  assert.equal(twice.status, 409);
  await call("off", "undo.run", { id: r.undo.id });
  assert.equal(order(o.id).status, "รอผลิต"); assert.equal(jobs(o.id)[0].status, "กำลังผลิต");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'แก้ออเดอร์หลังเริ่มงาน' AND status = 'เปิด'").length, 0, "ย้อนแล้วธงปิดเอง");
  // ของอยู่บนรถ
  load(o.id, items(o.id)[0].id, 1000, "บนรถ");
  const truck = await call("off", "office.order_cancel", { id: o.id, version: order(o.id).version }, { reason: "ลูกค้ายกเลิก" });
  assert.equal(truck.status, 409); assert.match(truck.error.message, /บนรถ/);
  // มีบิล
  const o2 = await create();
  await call("off", "office.bill_create", { order_id: o2.id, version: 1, kind: "เครดิต", due_day: "2026-12-16", lines: [{ item_id: items(o2.id)[0].id, qty_pcs: 8000, price_satang: 120 }] });
  const billed = await call("off", "office.order_cancel", { id: o2.id, version: order(o2.id).version }, { reason: "ลูกค้ายกเลิก" });
  assert.equal(billed.status, 409); assert.match(billed.error.message, /ยกเลิกบิลก่อน/); assert.ok(billed.error.bill_no);
});

test("ยกเลิกหลังส่งไปบางส่วน = ปิดออเดอร์ที่จำนวนเท่าที่ส่ง (ถุง+เศษลงตัว) · รายการที่ยังไม่ส่งเลยยกเลิก · สถานะ ส่งแล้ว", async () => {
  const { call, create, order, items, jobs, load } = await setup();
  const o = await create({ queue: true, items: [{ ...B600, bags: 40, price_satang: 120 }, { ...B600, color: "น้ำเงิน", bags: 10 }] });
  const [a, b] = items(o.id);
  load(o.id, a.id, 3050, "ส่งแล้ว");
  const r = await call("off", "office.order_cancel", { id: o.id, version: order(o.id).version }, { reason: "ลูกค้ารับแค่ที่ส่งไปแล้ว" });
  assert.equal(r.status, 200, JSON.stringify(r.error)); assert.equal(r.data.partial, true);
  const [a2, b2] = items(o.id);
  assert.equal(a2.qty_pcs, 3050); assert.equal(a2.bags, 15); assert.equal(a2.extra_pcs, 50); assert.equal(a2.per_bag, 200);
  assert.equal(b2.status, "ยกเลิก");
  assert.equal(order(o.id).status, "ส่งแล้ว"); assert.equal(order(o.id).cancel_reason, "ลูกค้ารับแค่ที่ส่งไปแล้ว"); assert.equal(order(o.id).delivered_day, "2026-11-16");
  assert.ok(jobs(o.id).every(j => j.status === "ยกเลิก"));
  assert.deepEqual(splitBags(3050, 200), { bags: 15, per_bag: 200, extra_pcs: 50, qty_pcs: 3050 });
});

test("ลูกค้ามารับที่โรงงาน: ของออก + ตัดสต๊อก (A/B แยก) · สต๊อกติดลบ = ธง · ส่งเป็นงวด · เกินที่สั่ง = เหตุผล · ย้อน = คืนสต๊อก", async () => {
  const { W, call, create, order, items } = await setup();
  W.d1.raw.prepare("INSERT INTO stock_moves(at, day, item_key, label, grade, qty_pcs, move_type) VALUES (?, '2026-11-16', ?, 'ขวด 600', 'A', 5000, 'ยอดยกมา')").run(AT, "spec:" + K600);
  const o = await create({ queue: true });
  const it = items(o.id)[0];
  const p1 = await call("off", "office.order_pickup", { id: o.id, version: order(o.id).version, lines: [{ item_id: it.id, qty_pcs: 4000 }] });
  assert.equal(p1.status, 200, JSON.stringify(p1.error));
  assert.equal(order(o.id).status, "ส่งบางส่วน");
  assert.equal(W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = 'A'", "spec:" + K600).qty_pcs, 1000);
  assert.equal(items(o.id)[0].delivered_pcs, 4000);
  const l = W.one("SELECT * FROM delivery_loads WHERE order_id = ?", o.id);
  assert.equal(l.status, "ส่งแล้ว"); assert.equal(l.trip_id, null); assert.equal(l.done_by, "S1");
  const over = await call("off", "office.order_pickup", { id: o.id, version: order(o.id).version, lines: [{ item_id: it.id, qty_pcs: 4500 }] });
  assert.equal(over.status, 400); assert.equal(over.error.code, "need_reason");
  const p2 = await call("off", "office.order_pickup", { id: o.id, version: order(o.id).version, lines: [{ item_id: it.id, qty_pcs: 4000 }] });
  assert.equal(p2.status, 200);
  assert.equal(order(o.id).status, "ส่งแล้ว"); assert.equal(order(o.id).delivered_day, "2026-11-16");
  assert.equal(W.q("SELECT * FROM flags WHERE kind = 'สต๊อกติดลบ'").length, 1, "ตัดเกินที่มี = ธง ไม่บล็อก");
  await call("off", "undo.run", { id: p2.undo.id });
  assert.equal(order(o.id).status, "ส่งบางส่วน"); assert.equal(order(o.id).delivered_day, "");
  assert.equal(W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = 'A'", "spec:" + K600).qty_pcs, 1000, "ย้อน = แถวกลับทิศ ยอดคืน");
  assert.equal(W.one("SELECT count(*) n FROM stock_moves WHERE move_type = 'ย้อน'").n, 1);
  // สีเกรด B ตัดสต๊อกเกรด B
  const ob = await create({ items: [{ ...B600, color: "ดำ (เกรด B)", bags: 1 }] });
  await call("off", "office.order_pickup", { id: ob.id, version: 1, lines: [{ item_id: items(ob.id)[0].id, qty_pcs: 200 }] });
  assert.equal(W.one("SELECT grade FROM stock_moves WHERE move_type = 'ส่งออก' ORDER BY id DESC LIMIT 1").grade, "B");
});

test("บิลจากออเดอร์: ประเภทต้องกดเอง · เครดิตต้องมีกำหนด · ค้างชำระเสมอ · เลขรันต่อปี · มีบิลแล้ว = ไม่ออกใหม่ · ราคาต่างจากออเดอร์ = เหตุผล + ธง", async () => {
  const { W, call, create, order, items } = await setup();
  const o = await create({ items: [{ ...B600, bags: 40, price_satang: 120 }], block_fee_satang: 50000 });
  const it = items(o.id)[0];
  const line = [{ item_id: it.id, qty_pcs: 8000, price_satang: 120 }];
  const noKind = await call("off", "office.bill_create", { order_id: o.id, version: 1, lines: line });
  assert.equal(noKind.status, 400); assert.match(noKind.error.message, /ประเภทบิล/);
  const noDue = await call("off", "office.bill_create", { order_id: o.id, version: 1, kind: "เครดิต", lines: line });
  assert.equal(noDue.status, 400); assert.match(noDue.error.message, /กำหนดชำระ/);
  const r = await call("off", "office.bill_create", { order_id: o.id, version: 1, kind: "เครดิต", due_day: "2026-12-16", block_fee: true, lines: line });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  assert.equal(r.data.bill_no, "PK2-2026-0001"); assert.equal(r.data.total_satang, 8000 * 120 + 50000);
  const b = W.one("SELECT * FROM bills WHERE bill_no = 'PK2-2026-0001'");
  assert.equal(b.status, "ค้างชำระ"); assert.equal(b.paid_satang, 0); assert.equal(b.pay_channel, "", "ช่องทางไม่เดา"); assert.equal(b.src, "v2"); assert.equal(b.order_id, o.id); assert.equal(b.by_name, "แอน");
  assert.equal(JSON.parse(b.items_json).length, 2);
  const again = await call("off2", "office.bill_create", { order_id: o.id, version: order(o.id).version, kind: "เงินสด", lines: line });
  assert.equal(again.status, 409); assert.equal(again.error.code, "has_bill"); assert.equal(again.error.bill_no, "PK2-2026-0001");
  assert.throws(() => W.d1.raw.prepare("INSERT INTO bills(bill_no, bill_day, customer_name, order_id, total_satang, kind, status, src, created_at, updated_at) VALUES ('X1','2026-11-16','x',?,1,'เงินสด','ค้างชำระ','v2',?,?)").run(o.id, AT, AT), /UNIQUE/, "ฐานกันบิลซ้ำอีกชั้น");
  const o2 = await create({ items: [{ ...B600, bags: 40, price_satang: 120 }] });
  const diff = await call("off", "office.bill_create", { order_id: o2.id, version: 1, kind: "เงินสด", lines: [{ item_id: items(o2.id)[0].id, qty_pcs: 8000, price_satang: 115 }] });
  assert.equal(diff.status, 400); assert.equal(diff.error.code, "need_reason");
  const ok = await call("off", "office.bill_create", { order_id: o2.id, version: 1, kind: "เงินสด", lines: [{ item_id: items(o2.id)[0].id, qty_pcs: 8000, price_satang: 115 }] }, { reason: "ลูกค้าประจำ" });
  assert.equal(ok.data.bill_no, "PK2-2026-0002");
  assert.equal(W.one("SELECT kind FROM flags WHERE entity = 'bills'").kind, "ยอดไม่ตรง");
  assert.equal((await call("prod", "office.bill_create", { order_id: o2.id, version: 1, kind: "เงินสด", lines: line })).status, 403);
  // เอกสารบิล
  const doc = await call("off", "office.bill", { bill_no: "PK2-2026-0001" });
  assert.equal(doc.data.bill.lines[0].qty_pcs, 8000); assert.match(doc.data.company.name, /พี แอนด์ เค/); assert.equal(doc.data.customer.name, "ร้านทดสอบ ก");
});

test("ยกเลิกบิล: ได้เฉพาะบิลที่ยังไม่มีใครแตะ · ผูกเลขกระดาษ/รับชำระแล้ว = ให้บัญชีจัดการ · ยกเลิกแล้วออกใหม่ได้", async () => {
  const { W, call, create, items } = await setup();
  const o = await create({ items: [{ ...B600, bags: 40, price_satang: 120 }] });
  const line = [{ item_id: items(o.id)[0].id, qty_pcs: 8000, price_satang: 120 }];
  const r = await call("off", "office.bill_create", { order_id: o.id, version: 1, kind: "เงินสด", lines: line });
  W.d1.raw.prepare("UPDATE bills SET paper_no = '0457', version = version + 1 WHERE bill_no = ?").run(r.data.bill_no);
  const paired = await call("off", "office.bill_cancel", { bill_no: r.data.bill_no, version: 2 }, { reason: "ออกบิลผิดใบ" });
  assert.equal(paired.status, 409); assert.match(paired.error.message, /ผูกเลขบิลกระดาษ 0457/);
  W.d1.raw.prepare("UPDATE bills SET paper_no = '', version = version + 1 WHERE bill_no = ?").run(r.data.bill_no);
  W.d1.raw.prepare("INSERT INTO bill_payments(id, bill_no, at, day, amount_satang, channel, created_at, updated_at) VALUES ('P1', ?, ?, '2026-11-16', 100, 'เงินสด', ?, ?)").run(r.data.bill_no, AT, AT, AT);
  const paid = await call("off", "office.bill_cancel", { bill_no: r.data.bill_no, version: 3 }, { reason: "ออกบิลผิดใบ" });
  assert.equal(paid.status, 409); assert.match(paid.error.message, /รับชำระแล้ว/);
  W.d1.raw.prepare("UPDATE bill_payments SET status = 'ยกเลิก' WHERE id = 'P1'").run();
  const ok = await call("off", "office.bill_cancel", { bill_no: r.data.bill_no, version: 3 }, { reason: "ออกบิลผิดใบ" });
  assert.equal(ok.status, 200);
  assert.equal(W.one("SELECT status, cancel_reason FROM bills WHERE bill_no = ?", r.data.bill_no).cancel_reason, "ออกบิลผิดใบ");
  const re = await call("off", "office.bill_create", { order_id: o.id, version: 1, kind: "เครดิต", due_day: "2026-12-01", lines: line });
  assert.equal(re.status, 200); assert.equal(re.data.bill_no, "PK2-2026-0002", "เลขเก่าไม่ถูกใช้ซ้ำ");
  const acct = W.d1.raw.prepare("INSERT INTO bills(bill_no, bill_day, customer_name, total_satang, kind, status, src, created_at, updated_at) VALUES ('เก่า-ก-1','2026-11-01','x',100,'เงินสด','ค้างชำระ','acct:ก',?,?)").run(AT, AT);
  const ac = await call("off", "office.bill_cancel", { bill_no: "เก่า-ก-1", version: 1 }, { reason: "ออกบิลผิดใบ" });
  assert.equal(ac.status, 409); assert.match(ac.error.message, /ชีทบัญชี/);
});

test("ลูกค้า: เพิ่ม/แก้ (ชื่อซ้ำหลวม · ชนกัน) · ยืนยันรายนำเข้า · รวมรายซ้ำ (ออเดอร์/บิลย้ายตาม · ชื่ออื่น · ย้อนได้)", async () => {
  const { W, call, create } = await setup();
  const c = await call("off", "office.customer_create", { name: "ร้านดาว", district: "สอง", phone: "081", route_code: "115", credit_days: 30, note: "หยอดเหรียญ" });
  assert.equal(c.status, 200, JSON.stringify(c.error));
  assert.equal((await call("off", "office.customer_create", { name: " ร้าน ดาว " })).status, 409);
  assert.equal((await call("off", "office.customer_create", { name: "ร้านใหม่", route_code: "999" })).status, 400);
  const u1 = await call("off", "office.customer_update", { id: c.data.id, version: 1, phone: "082", note: "เงินไม่ดี" });
  const u2 = await call("off2", "office.customer_update", { id: c.data.id, version: 1, phone: "083" });
  assert.equal(u1.status, 200); assert.equal(u2.status, 409);
  assert.equal(W.one("SELECT phone, note FROM customers WHERE id = ?", c.data.id).note, "เงินไม่ดี");
  const ren = await call("off", "office.customer_update", { id: c.data.id, version: 2, name: "ร้านทดสอบ ก" });
  assert.equal(ren.status, 409); assert.match(ren.error.message, /รวมกับรายอื่น/);
  W.d1.raw.prepare("INSERT INTO customers(id, name, name_key, needs_review, src, created_at, updated_at) VALUES ('CX','ทดสอบ ก (นำเข้า)','ทดสอบกนำเข้า',1,'legacy:order',?,?)").run(AT, AT);
  const o = await create({ customer_id: "CX" });
  const cf = await call("off", "office.customer_confirm", { id: "CX", version: 1 });
  assert.equal(cf.status, 200);
  await call("off", "undo.run", { id: cf.undo.id });
  const m = await call("off", "office.customer_merge", { id: "CX", version: W.one("SELECT version FROM customers WHERE id='CX'").version, into: "CA" });
  assert.equal(m.status, 200, JSON.stringify(m.error)); assert.equal(m.data.moved.orders, 1);
  assert.equal(W.one("SELECT customer_id FROM orders WHERE id = ?", o.id).customer_id, "CA");
  assert.equal(W.one("SELECT merged_into FROM customers WHERE id = 'CX'").merged_into, "CA");
  assert.equal(W.one("SELECT customer_id FROM customer_aliases WHERE alias_key = 'ทดสอบกนำเข้า'").customer_id, "CA");
  const back = await call("off", "undo.run", { id: m.undo.id });
  assert.equal(back.status, 200);
  assert.equal(W.one("SELECT customer_id FROM orders WHERE id = ?", o.id).customer_id, "CX");
  assert.equal(W.one("SELECT merged_into FROM customers WHERE id = 'CX'").merged_into, null);
});

test("สถานะไหลตามงานจริง: งานผลิตเสร็จ → รอสกรีน → กำลังสกรีน → พร้อมส่ง → ส่งบางส่วน → ส่งแล้ว · orderStatusOps ให้โมดูลอื่นใช้ · ออเดอร์จากแอปเดิมไม่แตะ", async () => {
  const { W, call, create, items, jobs, sjobs, ex, load } = await setup();
  const o = await create({ queue: true, items: [{ ...B600, bags: 40, screen_color: "แดง" }] });
  const st = async () => (await call("off", "office.order", { id: o.id })).data.order.status;
  assert.equal(await st(), "รอผลิต");
  ex("UPDATE production_jobs SET status = 'กำลังผลิต', good_pcs = 2000 WHERE order_id = ?", o.id);
  assert.equal(await st(), "กำลังผลิต");
  ex("UPDATE production_jobs SET status = 'เสร็จ', good_pcs = 8000 WHERE order_id = ?", o.id);
  assert.equal(await st(), "รอสกรีน");
  ex("UPDATE screen_jobs SET status = 'เตรียมการสกรีน', team = 'ทีม 1' WHERE order_id = ?", o.id);
  assert.equal(await st(), "กำลังสกรีน");
  ex("UPDATE screen_jobs SET status = 'เสร็จแล้ว' WHERE order_id = ?", o.id);
  assert.equal(await st(), "พร้อมส่ง");
  load(o.id, items(o.id)[0].id, 5000, "ส่งแล้ว");
  assert.equal(await st(), "ส่งบางส่วน");
  // ตัวช่วยของโมดูลอื่น: คิดจากสภาพหลังบันทึก (overrides) แล้วคืน op ปรับสถานะ
  const X = { db: wrapDb(W.d1), now: T0 };
  const ops = await orderStatusOps(X, [o.id], { loads: [{ id: "new", order_id: o.id, order_item_id: items(o.id)[0].id, qty_pcs: 3000, status: "ส่งแล้ว" }] });
  assert.equal(ops.length, 1); assert.equal(ops[0].set.status, "ส่งแล้ว"); assert.equal(ops[0].set.delivered_day, "2026-11-16");
  W.d1.raw.prepare("INSERT INTO orders(id, order_day, customer_id, status, src, created_at, updated_at) VALUES ('เก่า-1','2025-01-01','CA','ส่งแล้ว','legacy:order',?,?)").run(AT, AT);
  assert.deepEqual(await orderStatusOps(X, ["เก่า-1"]), [], "ประวัติจากแอปเดิมไม่ถูกคิดสถานะใหม่");
  assert.equal(deriveOrder({ status: "รอผลิต", src: "legacy:order" }, [], [], [], []).status, "รอผลิต");
});

test("หน้าแรก: คิวนับจากสถานะจริง · ค้างเงิน = ส่งแล้วยังไม่ออกบิล/บิลค้าง · แถวไม่มียอดเงิน · คุยกับฐานไม่กี่รอบ", async () => {
  const { W, call, create, items, ex, load } = await setup();
  const n1 = await create();                                  // ออเดอร์ใหม่
  const p = await create({ queue: true });                    // รอผลิต
  const s = await create({ queue: true, items: [{ ...B600, bags: 10, screen_color: "ขาว" }] });
  ex("UPDATE production_jobs SET status = 'เสร็จ' WHERE order_id = ?", s.id);   // → รอสกรีน
  const d = await create({ queue: true });
  ex("UPDATE production_jobs SET status = 'เสร็จ' WHERE order_id = ?", d.id);   // → พร้อมส่ง
  const m = await create({ queue: true });
  load(m.id, items(m.id)[0].id, 8000, "ส่งแล้ว");             // ส่งครบ ยังไม่ออกบิล → ค้างเงิน
  const before = W.d1.stats.rounds;
  const h = await call("off", "office.home");
  assert.ok(W.d1.stats.rounds - before <= 8, "หน้าแรกคุยกับฐาน " + (W.d1.stats.rounds - before) + " รอบ");
  const q = Object.fromEntries(h.data.queues.map(x => [x.key, x.n]));
  assert.deepEqual(q, { new: 1, prod: 1, screen: 1, deliver: 1, money: 1 });
  const row = h.data.orders.find(x => x.id === m.id);
  assert.equal(row.status, "ส่งแล้ว"); assert.equal(row.money, "unbilled");
  assert.ok(!/satang|price/.test(JSON.stringify(h.data.orders)), "แถวออเดอร์ต้องไม่มียอดเงิน");
  assert.equal(h.data.orders.find(x => x.id === n1.id).items[0].piece_unit, "ใบ");
  assert.equal(h.data.takenToday, 5);
  // ลงออเดอร์ = ≤ 4 รอบ (ตั๋ว+กันซ้ำ · ค่าตั้ง · อ่าน · เขียน)
  const b2 = W.d1.stats.rounds;
  await create({ queue: true });
  assert.ok(W.d1.stats.rounds - b2 <= 4, "ลงออเดอร์คุยกับฐาน " + (W.d1.stats.rounds - b2) + " รอบ");
});

test("ค้นออเดอร์ · ทีละหน้า · ลูกค้าราย (เคยสั่ง/ค้างเงิน) · ฟอร์ม · สต๊อกเทียบของต้องส่ง", async () => {
  const { W, call, create, items } = await setup();
  for (let i = 0; i < 5; i++) await create({ brand: "งานพิเศษ " + i, items: [{ ...B600, bags: 10 + i }] });
  await create({ customer_id: "CB", items: [{ type: "ถัง", size: "18.9 ลิตร", color: "ใส", bags: 4 }] });
  const s1 = await call("off", "office.orders", { q: "ร้านทดสอบข" });
  assert.equal(s1.data.orders.length, 1); assert.equal(s1.data.orders[0].customer, "ร้านทดสอบ ข");
  assert.equal((await call("off", "office.orders", { q: "18.9" })).data.orders.length, 1, "ค้นจากชื่อสินค้า");
  assert.equal((await call("off", "office.orders", { q: "งานพิเศษ 3" })).data.orders.length, 1, "ค้นจากชื่องาน");
  const pg = await call("off", "office.orders", { limit: 4 });
  assert.equal(pg.data.orders.length, 4); assert.ok(pg.data.next);
  const pg2 = await call("off", "office.orders", { limit: 4, before: pg.data.next });
  assert.equal(pg2.data.orders.length, 2); assert.equal(pg2.data.next, null);
  assert.equal(new Set([...pg.data.orders, ...pg2.data.orders].map(o => o.id)).size, 6, "ไม่ซ้ำข้ามหน้า");
  const c = await call("off", "office.customer", { id: "CA" });
  assert.equal(c.data.usual[0].n, 5); assert.equal(c.data.usual[0].spec_key, K600); assert.equal(c.data.orders.length, 5);
  assert.equal(c.data.customer.note, "เงินไม่ดีให้สั่งทางออฟฟิศ");
  const list = await call("off", "office.customers");
  const ca = list.data.customers.find(x => x.id === "CA");
  assert.equal(ca.open_n, 5); assert.equal(ca.last_day, "2026-11-16");
  const f = await call("off", "office.form");
  const bottle = f.data.types.find(t => t.code === "ขวด");
  assert.deepEqual(bottle.axes, ["ขนาด", "คอขวด", "รูปทรง", "สี", "สีสกรีน", "พร้อมฝาสี"]);
  assert.equal(bottle.sizes.find(s => s.size === "600 ml").per_bag, 200); assert.equal(bottle.sizes.find(s => s.size === "600 ml").min, 1200);
  assert.deepEqual(f.data.types.find(t => t.code === "ฟิล์มแพ็คโหล").axes, ["ขนาด"]);
  assert.equal(f.data.prices[0].price_satang, 120);
  W.d1.raw.prepare("INSERT INTO stock_moves(at, day, item_key, label, grade, qty_pcs, move_type) VALUES (?, '2026-11-16', ?, 'ขวด 600', 'A', 5000, 'ยอดยกมา')").run(AT, "spec:" + K600);
  W.d1.raw.prepare("INSERT INTO stock_moves(at, day, item_key, label, grade, qty_pcs, move_type) VALUES (?, '2026-11-16', ?, 'ขวด 600', 'B', 700, 'ผลิตเข้า')").run(AT, "spec:" + K600);
  const sk = await call("off", "office.stock");
  const r = sk.data.rows.find(x => x.item_key === "spec:" + K600);
  assert.equal(r.a, 5000); assert.equal(r.b, 700, "เกรด B แยก ไม่บวกรวม"); assert.equal(r.need, (10 + 11 + 12 + 13 + 14) * 200); assert.equal(r.short, 12000 - 5000);
  assert.equal(sk.data.rows[0].item_key, "spec:" + K600, "ของที่ไม่พอขึ้นก่อน");
  assert.equal((await call("prod", "office.stock")).status, 403);
});
