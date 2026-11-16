// ============================================================
//  ของกลางของโมดูลสกรีน + ส่งของ: กุญแจสต๊อก · สถานะออเดอร์ที่ขยับเพราะงานสกรีน/การส่ง · ธงสต๊อกติดลบ     v2/server/actions/deliver_common.mjs
//
//  สต๊อก (ตัดสินแทนคุณปาล์ม 16 พ.ย. — เหตุผลใน docs/app-v2/STATUS.md):
//    ขวดเปล่า        spec:<spec_key>                 (ทีมผลิต "ผลิตเข้า" ที่กุญแจนี้)
//    ขวดสกรีนแล้ว    spec:<spec_key>|สกรีน <สี>      (สกรีนเสร็จ = เปล่าออก ดี+เสีย · สกรีนแล้วเข้า ดี)
//    ขึ้นรถ          ออกจากกุญแจที่เหมาะกับรายการ (มีงานสกรีน = กุญแจสกรีน · ไม่มี = เปล่า) — จดกุญแจไว้ในแถวของบนรถ
//    ส่งแล้ว         ไม่ขยับคลัง (ออกไปตอนขึ้นรถแล้ว) · เอาลงจากรถ = คืนเข้ากุญแจเดิม
// ============================================================

export const OPEN_ORDER_STATUSES = ["รอผลิต", "กำลังผลิต", "รอสกรีน", "กำลังสกรีน", "พร้อมส่ง", "ส่งบางส่วน"];
export const OPEN_ORDER_SQL = "('" + OPEN_ORDER_STATUSES.join("','") + "')";
export const ON_TRUCK = ["บนรถ", "ส่งไม่ได้"];          // ของที่ยังอยู่บนรถ (ส่งไม่ได้ = ยังอยู่บนรถ จนกว่าจะส่งใหม่หรือเอาลง)
export const ON_TRUCK_SQL = "('บนรถ','ส่งไม่ได้')";
const PRE_DELIVERY = ["รอผลิต", "กำลังผลิต", "รอสกรีน", "กำลังสกรีน", "พร้อมส่ง"];

export const plainKey = item => "spec:" + item.spec_key;
export function screenColorOf(item, job) {
  return String((item && item.screen_color) || (job && job.colors) || "").trim() || "ไม่ระบุสี";
}
export const screenKey = (item, job) => plainKey(item) + "|สกรีน " + screenColorOf(item, job);
export function itemName(item) {
  if (!item) return "สินค้า";
  return item.label || [item.type, item.size, item.neck, item.shape, item.color].map(v => String(v || "").trim()).filter(Boolean).join(" ") || item.type || "สินค้า";
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
 * สถานะออเดอร์หลังงานสกรีนเปลี่ยน (ใช้เฉพาะช่วงก่อนส่ง — ส่งบางส่วน/ส่งแล้ว/ยกเลิก ไม่แตะ)
 *   มีงานกำลังสกรีน (จ่ายทีมแล้ว) → กำลังสกรีน
 *   ยังมีงานรอ (ไม่มีทีมทำอยู่)     → ถ้าเดิมกำลังสกรีน = รอสกรีน · อย่างอื่นคงเดิม
 *   งานสกรีนเสร็จหมด               → งานผลิตที่ผูกออเดอร์ยังไม่เสร็จ = กำลังผลิต/รอผลิต · ไม่งั้น = พร้อมส่ง
 *   jobs = งานสกรีนทั้งหมดของออเดอร์ (สถานะหลังเปลี่ยน) · prodJobs = งานผลิตที่ผูกออเดอร์ (ไม่รวมยกเลิก)
 */
export function orderStatusAfterScreen(order, jobs, prodJobs) {
  const cur = order.status;
  if (PRE_DELIVERY.indexOf(cur) < 0) return cur;
  const act = jobs.filter(j => j.status !== "ยกเลิก");
  if (!act.length) return cur;
  if (act.some(j => j.status === "เตรียมการสกรีน")) return "กำลังสกรีน";
  if (act.some(j => j.status === "รอดำเนินการ")) return cur === "กำลังสกรีน" ? "รอสกรีน" : cur;
  const pend = (prodJobs || []).filter(p => p.status !== "เสร็จ" && p.status !== "ยกเลิก");
  if (pend.length) return pend.some(p => p.status === "กำลังผลิต") ? "กำลังผลิต" : "รอผลิต";
  return "พร้อมส่ง";
}

/** สถานะออเดอร์หลังส่ง: ทุกรายการส่งครบ = ส่งแล้ว · ส่งไปบ้าง = ส่งบางส่วน · ยังไม่ได้ส่งเลย = คงเดิม */
export function orderStatusAfterDelivery(order, items) {
  const act = items.filter(i => i.status === "ใช้งาน");
  if (!act.length) return order.status;
  if (act.every(i => i.delivered_pcs >= i.qty_pcs)) return "ส่งแล้ว";
  if (act.some(i => i.delivered_pcs > 0)) return "ส่งบางส่วน";
  return order.status === "ส่งแล้ว" || order.status === "ส่งบางส่วน" ? "พร้อมส่ง" : order.status;
}
