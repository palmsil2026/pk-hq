// ============================================================
//  ข้อมูลสมมติเพิ่มของโมดูลสกรีน + ส่งของ (เรียกจาก seed-demo.mjs บรรทัดเดียว) — ชื่อร้าน/ยอดไม่ใช่ของจริง
//  ทำให้หน้าส่งของ/สกรีนในเครื่องนักพัฒนา · พรีวิว · เทสต์หน้าจอ มีของครบทุกสถานะ:
//    บนรถ (รถ 04) · ส่งไม่ได้ (รถ 05) · ส่งแล้ววันนี้ · ส่งบางส่วนเมื่อวาน · งานสกรีนเสร็จวันนี้ · ยอดยกมาในคลัง
// ============================================================
import { iso, thaiDay, addDays, specKey, specLabel } from "../server/core.mjs";

export async function seedScreenDeliver(X, apply, now) {
  const today = thaiDay(now), at = ms => iso(now - ms), H = 3600000;
  const ops = [];
  const trip = (v, day) => ({ op: "insert", table: "delivery_trips", row: { id: "T" + day + "-" + v, day, vehicle_id: v, status: "จัดของ", src: "demo" } });
  ops.push(trip("04", today), trip("05", today), trip("04", addDays(today, -1)));
  // ของที่ seed-demo ขึ้นรถไว้แล้ว (LD1) → ผูกรถ 04 + ตัวนับบนรถให้ตรง
  const b600 = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
  ops.push({ op: "raw", sql: "UPDATE delivery_loads SET trip_id = ?, stock_key = ? WHERE id = 'LD1'", args: ["T" + today + "-04", "spec:" + specKey(b600)] });
  ops.push({ op: "raw", sql: "UPDATE order_items SET onboard_pcs = 8000 WHERE id = 'OD001-1'", args: [] });
  // ร้าน F (ส่งบางส่วน): เมื่อวานส่ง 12 ถุงของรายการแรก · วันนี้ขึ้นรถ 05 รายการที่สองแล้ว "ส่งไม่ได้ ร้านปิด"
  ops.push({ op: "insert", table: "delivery_loads", row: { id: "LDF1", trip_id: "T" + addDays(today, -1) + "-04", order_id: "OD006", order_item_id: "OD006-1", qty_pcs: 3000, status: "ส่งแล้ว", loaded_at: at(26 * H), loaded_by: "S131", done_at: at(22 * H), done_day: addDays(today, -1), done_by: "S131", stop_id: "PDEMO1", src: "demo" } });
  ops.push({ op: "raw", sql: "UPDATE order_items SET delivered_pcs = 3000 WHERE id = 'OD006-1'", args: [] });
  ops.push({ op: "insert", table: "delivery_loads", row: { id: "LDF2", trip_id: "T" + today + "-05", order_id: "OD006", order_item_id: "OD006-2", qty_pcs: 2520, status: "ส่งไม่ได้", fail_reason: "ร้านปิด", loaded_at: at(4 * H), loaded_by: "S131", done_at: at(1.2 * H), done_day: today, done_by: "S131", src: "demo" } });
  ops.push({ op: "raw", sql: "UPDATE order_items SET onboard_pcs = 2520 WHERE id = 'OD006-2'", args: [] });
  // ร้าน B: ออเดอร์ที่ส่งครบแล้ววันนี้ (ส่งแล้ว)
  ops.push({ op: "insert", table: "orders", row: { id: "OD010", order_day: addDays(today, -3), customer_id: "CDB", due_day: today, status: "ส่งแล้ว", delivered_day: today, purchase_type: "ขายราคาโรงงาน", taker_staff_id: "S101", src: "demo" } });
  ops.push({ op: "insert", table: "order_items", row: { id: "OD010-1", order_id: "OD010", line_no: 1, ...b600, spec_key: specKey(b600), label: specLabel(b600), bags: 10, per_bag: 200, qty_pcs: 2000, delivered_pcs: 2000, src: "demo" } });
  ops.push({ op: "insert", table: "delivery_loads", row: { id: "LDB1", trip_id: "T" + today + "-04", order_id: "OD010", order_item_id: "OD010-1", qty_pcs: 2000, status: "ส่งแล้ว", loaded_at: at(5 * H), loaded_by: "S131", done_at: at(1.6 * H), done_day: today, done_by: "S131", stop_id: "PDEMO2", stock_key: "spec:" + specKey(b600), src: "demo" } });
  // ร้าน E: งานสกรีนเสร็จวันนี้ (ทีม 1) → ออเดอร์พร้อมส่งพรุ่งนี้
  const b250 = { type: "ขวด", size: "250 ml", neck: "คอยาว", shape: "เพชร", color: "ใส" };
  ops.push({ op: "insert", table: "orders", row: { id: "OD011", order_day: addDays(today, -2), customer_id: "CDE", due_day: addDays(today, 1), status: "พร้อมส่ง", has_screen: 1, brand: "น้ำดื่มตัวอย่าง", purchase_type: "ขายราคาโรงงาน", taker_staff_id: "S102", src: "demo" } });
  ops.push({ op: "insert", table: "order_items", row: { id: "OD011-1", order_id: "OD011", line_no: 1, ...b250, screen_color: "เขียวเข้ม", spec_key: specKey(b250), label: specLabel(b250), bags: 20, per_bag: 252, qty_pcs: 5040, src: "demo" } });
  ops.push({ op: "insert", table: "screen_jobs", row: { id: "SJD11", order_id: "OD011", order_item_id: "OD011-1", team: "ทีม 1", colors: "เขียวเข้ม", qty_pcs: 5040, due_day: addDays(today, 1), status: "เสร็จแล้ว", done_at: at(2 * H), done_day: today, done_by: "S121", src: "demo" } });
  // คลัง: ยอดยกมา (ทีมผลิตจะเริ่มนับจริงตอนย้ายมา)
  for (const [it, n] of [[b600, 12000], [b250, 6000]]) ops.push({ op: "move", item_key: "spec:" + specKey(it), label: specLabel(it), grade: "A", qty_pcs: n, move_type: "ยอดยกมา", ref_entity: "demo", ref_id: "seed", src: "demo" });
  ops.push({ op: "move", item_key: "spec:" + specKey(b250) + "|สกรีน เขียวเข้ม", label: specLabel(b250) + " สกรีน เขียวเข้ม", grade: "A", qty_pcs: 5040, move_type: "สกรีนเข้า", ref_entity: "screen_jobs", ref_id: "SJD11", src: "demo" });
  await apply(X, ops);
}
