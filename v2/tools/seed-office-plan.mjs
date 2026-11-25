// ============================================================
//  ข้อมูลสมมติ ออฟฟิศ 0210 + หมุดลูกค้า 0310 (ชื่อร้าน/ยอด/พิกัด ไม่ใช่ของจริง — repo สาธารณะ)              v2/tools/seed-office-plan.mjs
//  งวดส่ง (กำหนดจำนวน 3 งวด · ส่งงวดแรกไม่ครบ) · จอง · รอยืนยัน · มัดจำ · เลื่อนวันส่ง · ขายหน้าร้าน 3 วัน · ลูกค้ามีแค่อำเภอ (แนะนำสาย) · หมุดจากลิงก์
// ============================================================
import { addDays, specKey, specLabel, iso } from "../server/core.mjs";

export async function seedOfficePlan(X, apply, now) {
  const today = addDays(new Date(now + 7 * 3600000).toISOString().slice(0, 10), 0);
  const at = ms => iso(now - ms), H = 3600000;
  const ops = [];
  // ลูกค้าที่มีแค่อำเภอ (ระบบแนะนำสายจากรายอื่นในอำเภอเดียวกัน) + รายเพิ่มใน อ.เถิน ให้ตารางเรียนได้
  [["J", "เถิน", null], ["K", "เถิน", "212"], ["L", "แม่ทะ", null], ["M", "", null]].forEach(([x, d, r]) =>
    ops.push({ op: "insert", table: "customers", row: { id: "CD" + x, name: "ร้านตัวอย่าง " + x, name_key: "ร้านตัวอย่าง" + x.toLowerCase(), district: d, route_code: r, src: "demo" } }));
  ops.push({ op: "raw", sql: "UPDATE customers SET geo_lat_e6 = 18288800, geo_lng_e6 = 99490800, geo_src = 'ลิงก์แผนที่', geo_at = ?, map_url = 'https://maps.app.goo.gl/demo' WHERE id = 'CDA'", args: [at(30 * H)] });
  const it = (type, size, neck, shape, color) => ({ type, size, neck, shape, color });
  const B600 = it("ขวด", "600 ml", "คอยาว", "MK", "ใส"), B250 = it("ขวด", "250 ml", "คอสั้น", "เพชร", "น้ำเงิน"), B350 = it("ขวด", "350 ml", "คอยาว", "เพชร", "ใส");
  const order = (id, cust, extra, lines) => {
    ops.push({ op: "insert", table: "orders", row: { id, order_day: extra.order_day || today, customer_id: cust, due_day: extra.due_day || "", status: extra.status || "รอผลิต", purchase_type: extra.purchase_type || "ขายราคาโรงงาน",
      taker_staff_id: "S101", src: "v2", plan_mode: extra.plan_mode || "", plan_each_pcs: extra.each || 0, plan_every_days: extra.every || 0, hold: extra.hold || 0, want_when: extra.want || "", brand: extra.brand || "" } });
    lines.forEach(([spec, bags, per, price, scr], i) => ops.push({ op: "insert", table: "order_items", row: { id: id + "-" + (i + 1), order_id: id, line_no: i + 1, ...spec, screen_color: scr || "", spec_key: specKey(spec), label: specLabel(spec),
      bags, per_bag: per, qty_pcs: bags * per, price_satang: price === undefined ? null : price, src: "v2", delivered_pcs: extra.delivered && i === 0 ? extra.delivered : 0 } }));
  };
  // กำหนดจำนวน 3 งวด ทุก 7 วัน · งวด 1 ส่งไม่ครบ (ส่วนขาดไปงวด 2) · มัดจำ 2 ครั้ง
  order("OP001", "CDB", { status: "ส่งบางส่วน", plan_mode: "กำหนดจำนวน", each: 20 * 252, every: 7, due_day: addDays(today, 1), want: "ไม่รีบ", order_day: addDays(today, -8), delivered: 15 * 252, brand: "งวดตัวอย่าง" }, [[B250, 60, 252, 95]]);
  [[1, addDays(today, -6), 3333], [2, addDays(today, 1), 3333], [3, addDays(today, 8), 3334]].forEach(([seq, d, bp]) => ops.push({ op: "insert", table: "order_rounds", row: { id: "RDP1" + seq, order_id: "OP001", seq, plan_day: d, part_bp: bp, src: "demo" } }));
  ops.push({ op: "insert", table: "delivery_loads", row: { id: "LDP1", order_id: "OP001", order_item_id: "OP001-1", qty_pcs: 15 * 252, status: "ส่งแล้ว", loaded_at: at(150 * H), done_at: at(146 * H), done_day: addDays(today, -6), stop_id: "PDEMO1", src: "demo" } });
  ops.push({ op: "insert", table: "reschedule_events", row: { id: "RSD1", order_id: "OP001", round_id: "RDP12", seq: 2, from_day: addDays(today, -1), to_day: addDays(today, 1), cause: "เครื่องเสีย", by_staff: "S101", src: "demo" } });
  ops.push({ op: "insert", table: "order_deposits", row: { id: "DPD1", order_id: "OP001", amount_satang: 300000, channel: "โอน KBank", paid_day: addDays(today, -8), note: "สลิปในไลน์", by_staff: "S101", src: "demo" } });
  ops.push({ op: "insert", table: "order_deposits", row: { id: "DPD2", order_id: "OP001", amount_satang: 150000, channel: "เงินสด", paid_day: addDays(today, -2), by_staff: "S141", src: "demo" } });
  // จอง (ยังไม่นัด) ค้างนาน + รอยืนยัน
  order("OP002", "CDJ", { status: "ออเดอร์ใหม่", plan_mode: "ครั้งเดียว", want: "สัปดาห์หน้า", order_day: addDays(today, -20) }, [[B600, 50, 200], [B350, 10, 300]]);
  ops.push({ op: "insert", table: "order_rounds", row: { id: "RDP21", order_id: "OP002", seq: 1, plan_day: "", part_bp: 10000, src: "demo" } });
  order("OP003", "CDL", { status: "ออเดอร์ใหม่", plan_mode: "ทยอย", hold: 1, want: "ไม่รีบ", brand: "งานโลโก้ใหม่" }, [[B600, 80, 200, undefined, "แดง"]]);
  ops.push({ op: "insert", table: "order_rounds", row: { id: "RDP31", order_id: "OP003", seq: 1, plan_day: "", part_bp: 10000, src: "demo" } });
  // ขายหน้าร้าน 3 วัน (บางรายการไม่ใส่ราคา — หน้ารวมบอกว่ายังไม่ใส่ ไม่เดา)
  [[0, "CDH", [[B600, 3, 200, 130]]], [0, "CDC", [[B350, 2, 300]]], [-1, "CDG", [[B250, 4, 252, 110], [B600, 1, 200, 130]]], [-3, "CDE", [[B600, 2, 200, 130]]]].forEach(([d, c, lines], i) => {
    const id = "OW00" + (i + 1);
    order(id, c, { status: "ส่งแล้ว", purchase_type: "ขายหน้าร้าน", order_day: addDays(today, d) }, lines);
    lines.forEach((l, k) => ops.push({ op: "insert", table: "delivery_loads", row: { id: "LW" + i + k, order_id: id, order_item_id: id + "-" + (k + 1), qty_pcs: l[1] * l[2], status: "ส่งแล้ว", loaded_at: at(H), done_at: at(H), done_day: addDays(today, d), src: "demo", note: "ลูกค้ารับที่โรงงาน" } }));
  });
  // ลำดับคิวที่ออฟฟิศดันขึ้น (ป้าย "ดันขึ้นก่อน")
  ops.push({ op: "raw", sql: "UPDATE orders SET priority = 1 WHERE id = 'OD007'", args: [] });
  // หมุดสายสำหรับปฏิทินตัวอย่าง (อำเภอเมืองแสดงทุกวันเอง)
  for (const [offset, routes] of [[0, ["111", "212"]], [1, ["119", "212"]], [3, ["119"]], [4, ["212"]], [6, ["119"]]]) {
    ops.push({ op: "insert", table: "route_day_pins", row: { day: addDays(today, offset), routes_json: JSON.stringify(routes) } });
  }
  await apply(X, ops);
}
