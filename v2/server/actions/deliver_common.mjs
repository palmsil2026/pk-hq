// ============================================================
//  ของกลางของโมดูลสกรีน + ส่งของ: กุญแจสต๊อก · สถานะออเดอร์ที่ขยับเพราะงานสกรีน/การส่ง · ธงสต๊อกติดลบ     v2/server/actions/deliver_common.mjs
//
//  สต๊อก (ตัดสินแทนคุณปาล์ม 16 พ.ย. — เหตุผลใน docs/app-v2/STATUS.md):
//    ขวดเปล่า        spec:<spec_key>                 (ทีมผลิต "ผลิตเข้า" ที่กุญแจนี้)
//    ขวดสกรีนแล้ว    spec:<spec_key>|งานสกรีน:<รายการออเดอร์>|สกรีน <สี> · แยกของแต่ละใบสั่ง
//    ขึ้นรถ          ออกจากกุญแจที่เหมาะกับรายการ (มีงานสกรีน = กุญแจสกรีน · ไม่มี = เปล่า) — จดกุญแจไว้ในแถวของบนรถ
//    ส่งแล้ว         ไม่ขยับคลัง (ออกไปตอนขึ้นรถแล้ว) · เอาลงจากรถ = คืนเข้ากุญแจเดิม
// ============================================================

import { deriveOrder, statusSet, OPEN_STATUSES } from "./office-lib.mjs";
import { conflict } from "../core.mjs";   // สถานะออเดอร์กติกาเดียวทั้งระบบ (โมดูลออฟฟิศเปิดให้ใช้)

export const OPEN_ORDER_STATUSES = OPEN_STATUSES;   // ออเดอร์ใหม่ · รอผลิต · กำลังผลิต · รอสกรีน · กำลังสกรีน · พร้อมส่ง · ส่งบางส่วน
export const OPEN_ORDER_SQL = "('" + OPEN_ORDER_STATUSES.join("','") + "')";
export const ON_TRUCK = ["บนรถ", "ส่งไม่ได้"];          // ของที่ยังอยู่บนรถ (ส่งไม่ได้ = ยังอยู่บนรถ จนกว่าจะส่งใหม่หรือเอาลง)
export const ON_TRUCK_SQL = "('บนรถ','ส่งไม่ได้')";

export const plainKey = item => "spec:" + item.spec_key;
export function screenColorOf(item, job) {
  return String((item && item.screen_color) || (job && job.colors) || "").trim() || "ไม่ระบุสี";
}
export function screenKey(item, job) {
  if (!item.id) throw new Error("สต๊อกสกรีนต้องผูกรายการสินค้า");
  return plainKey(item) + "|งานสกรีน:" + encodeURIComponent(item.id) + "|สกรีน " + screenColorOf(item, job);
}
export function itemName(item) {
  if (!item) return "สินค้า";
  return item.label || [item.type, item.size, item.neck, item.shape, item.color].map(v => String(v || "").trim()).filter(Boolean).join(" ") || item.type || "สินค้า";
}

export function screenedStockLabel(item, job, customer, brand) {
  return [itemName(item) + " สกรีน " + screenColorOf(item, job), customer, brand].filter(Boolean).join(" · ");
}

/** ของเดิมที่รวมตามสีเก็บไว้ดูเพื่อให้คนตรวจว่าเป็นของงานไหน */
export function stockViewLabel(key, label) {
  return key.startsWith("spec:") && key.split("|")[5]?.startsWith("สกรีน ")
    ? label + " · ต้องยืนยันว่าเป็นของงานไหน"
    : label;
}

/** จำนวนเป็นคำที่คนอ่าน: "40 ถุง (8,000 ใบ)" / "400 ชิ้น" */
export function qtyText(item, pcs) {
  const unit = (item && item.piece_unit) || "ใบ";
  const n = Number(pcs) || 0;
  if (item && item.per_bag > 0 && n % item.per_bag === 0) return (n / item.per_bag).toLocaleString("en-US") + " ถุง (" + n.toLocaleString("en-US") + " " + unit + ")";
  return n.toLocaleString("en-US") + " " + unit;
}

/** ธง "สต๊อกติดลบ" เมื่อการลงสมุดครั้งนี้ทำให้ยอดต่ำกว่า 0 (ไม่บล็อกงาน · ธงเดียวต่อกุญแจจนกว่าจะปิด) */
export function negativeStockFlags(balances, moves, team) {
  const cur = {};
  (balances || []).forEach(b => { cur[b.item_key] = Number(b.qty_pcs) || 0; });
  const out = [], seen = new Set();
  for (const m of moves) {
    const k = m.item_key, before = cur[k] || 0, after = before + m.qty_pcs;
    cur[k] = after;
    if (m.qty_pcs >= 0 || after >= 0 || seen.has(k)) continue;
    seen.add(k);
    out.push({ op: "flag", kind: "สต๊อกติดลบ", severity: "ดู", team, entity: "stock_balance", entity_id: k,
      title: "สต๊อกติดลบ: " + (m.label || k.replace(/^spec:/, "")),
      detail: "หลังรายการนี้คงเหลือ " + after.toLocaleString("en-US") + " (ก่อนหน้า " + before.toLocaleString("en-US") + ") — ของจริงมีแต่ยังไม่ได้ลงเข้า หรือนับผิด ให้ตรวจ",
      dedupe_key: "stockneg:" + k });
  }
  return out;
}

/**
 * สถานะออเดอร์ใช้กติกาเดียวกับโมดูลออฟฟิศ (office-lib › deriveOrder/statusSet — ยกจาก recomputeOrder_ ของ GAS)
 *   ส่งรายการ/งาน/ของบนรถ "หลังบันทึก" เข้ามา → op เปลี่ยนสถานะเฉพาะเมื่อเปลี่ยนจริง (ไม่แตะ = ไม่ทำให้ "ย้อน" ของคนอื่นติด)
 *   ออเดอร์ที่ไม่ใช่ของ v2 (นำเข้า/ตัวอย่าง) ไม่แตะ — แบบเดียวกับออฟฟิศ
 */
export function orderStatusOp(X, order, items, prodJobs, screenJobs, loads) {
  if (!order) return [];
  const set = statusSet(order, deriveOrder(order, items, prodJobs, screenJobs, loads), X);
  return set ? [{ op: "update", table: "orders", id: order.id, expect: order.version, before: order, set }] : [];
}
/** แทนแถวเดิมด้วยแถวหลังแก้ (ตามรหัส) + ต่อแถวใหม่ */
export function patchRows(rows, changed) {
  const m = new Map((rows || []).map(r => [r.id, r]));
  (changed || []).forEach(r => m.set(r.id, Object.assign({}, m.get(r.id) || {}, r)));
  return [...m.values()];
}
/** เกรดสต๊อกของขวดเปล่า: สีเกรด B (เช่น "ดำ (เกรด B)") = B · ขวดสกรีนแล้ว = A (กติกาเดียวกับออฟฟิศ › ลูกค้ามารับ) */
export const gradeFor = (key, item, bColors) => (key === plainKey(item) && (bColors || []).indexOf(item.color) >= 0 ? "B" : "A");
export const B_COLORS_SQL = "SELECT value FROM spec_values WHERE axis = 'สี' AND grade = 'B'";

/**
 * ด่านย้อน "ส่งแล้ว" (ส่งของ · ลูกค้ามารับ): ออฟฟิศออกบิลของออเดอร์นั้นหลังการส่งนี้แล้ว = ขั้นถัดไปรับไปแล้ว → ย้อนไม่ได้
 *   (ไม่งั้นมีบิลของที่ระบบบอกว่ายังไม่ได้ส่ง) · orderSql = SELECT ที่คืน order_id ของรายการที่จะย้อน (ผูกกับ undo_log.entity_id)
 */
export function billAfterGuard(orderSql) {
  return async (X, u) => {
    const b = await X.db.first(`SELECT bill_no, customer_name FROM bills WHERE status <> 'ยกเลิก' AND created_at >= ? AND order_id IN (${orderSql}) LIMIT 1`, u.created_at, u.entity_id);
    if (b) throw conflict("ออฟฟิศออกบิลของออเดอร์นี้หลังส่งแล้ว — ย้อนการส่งไม่ได้ · ถ้าส่งไม่ถึงจริง ให้ออฟฟิศยกเลิกบิลก่อน แล้วค่อยย้อน");
  };
}
