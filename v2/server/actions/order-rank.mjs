// ============================================================
//  ลำดับคิว "ขวดไม่พอ ใครได้ก่อน" — คุณปาล์มเคาะแล้ว 19 พ.ย. 2569                             v2/server/actions/order-rank.mjs
//    ค่าตั้งต้น: วันงวดที่นัดใกล้สุด → (วันเท่ากัน) ด่วนก่อน → ลงคิวก่อน → ของจอง (ไม่มีงวดนัด) ท้ายสุด
//    ปรับมือได้ (ออฟฟิศ/ประธาน · office.prio_move): orders.priority บวก = ดันขึ้นก่อน · ลบ = เลื่อนลง — ชนะค่าตั้งต้นเสมอ (ป้ายบอกว่าถูกปรับมือ)
//  ลำดับเดียวกันใช้ทุกที่: งานรอผลิต (prod.jobs) · คิวสกรีน (screen.list) · การจัดสต๊อกว่าใบไหน "ไม่พอส่ง" (office.stock / office.home)
//  วันงวด = planState (งวดที่ถึงคิว — ส่งไม่ครบงวดก่อน = ส่วนขาดรวมงวดนี้) ชุดเดียวกับหน้าส่งของ
// ============================================================
import { planState } from "./office-plan-lib.mjs";
import { chunk } from "./office-lib.mjs";

const IN = n => "(" + Array.from({ length: n }, () => "?").join(",") + ")";

/** เทียบสองแถว { priority, reserve, due, urgent, queued_at, id } — ฟังก์ชันล้วน (เทสต์ + หน้าเว็บใช้ตัวเดียวกัน) */
export function compareRank(a, b) {
  return ((Number(b.priority) || 0) - (Number(a.priority) || 0))
    || ((a.reserve ? 1 : 0) - (b.reserve ? 1 : 0))
    || String(a.due || "9999").localeCompare(String(b.due || "9999"))
    || ((b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))
    || String(a.queued_at || "").localeCompare(String(b.queued_at || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
}

/** อ่านลำดับของออเดอร์ (เปิดอยู่ทั้งหมด หรือเฉพาะ ids) → Map(id → { no, of, priority, due, reserve, urgent }) · no = ลำดับที่ 1.. ในออเดอร์ที่ยังไม่จบทั้งหมด */
export async function orderRanks(X, opts) {
  const o = opts || {};
  const open = "('ออเดอร์ใหม่','รอผลิต','กำลังผลิต','รอสกรีน','กำลังสกรีน','พร้อมส่ง','ส่งบางส่วน')";
  const orders = await X.db.all(`SELECT id, priority, urgent, created_at, due_day, plan_mode, plan_cap_pcs, status FROM orders WHERE status IN ${open} LIMIT 2000`);
  const ids = orders.map(r => r.id);
  const rounds = {}, items = {}, sent = {};
  const reads = [];
  for (const part of chunk(ids, 90)) {
    reads.push(["SELECT * FROM order_rounds WHERE status = 'ใช้งาน' AND order_id IN " + IN(part.length), ...part]);
    reads.push(["SELECT id, order_id, qty_pcs, per_bag, delivered_pcs, status FROM order_items WHERE status = 'ใช้งาน' AND order_id IN " + IN(part.length), ...part]);
    reads.push(["SELECT order_id, order_item_id, qty_pcs, done_day FROM delivery_loads WHERE status = 'ส่งแล้ว' AND order_id IN " + IN(part.length), ...part]);
  }
  const res = reads.length ? await X.db.reads(reads) : [];
  for (let i = 0; i < res.length; i += 3) {
    res[i].forEach(r => { (rounds[r.order_id] = rounds[r.order_id] || []).push(r); });
    res[i + 1].forEach(r => { (items[r.order_id] = items[r.order_id] || []).push(r); });
    res[i + 2].forEach(r => { (sent[r.order_id] = sent[r.order_id] || []).push(r); });
  }
  return ranksFrom(orders, rounds, items, sent);
}
const OPEN = ["ออเดอร์ใหม่", "รอผลิต", "กำลังผลิต", "รอสกรีน", "กำลังสกรีน", "พร้อมส่ง", "ส่งบางส่วน"];
/** ลำดับจากของที่อ่านมาแล้ว (ฟังก์ชันล้วน) — orders[] · rounds/items/sent = { order_id: [...] } (sent = delivery_loads ส่งแล้ว) */
export function ranksFrom(orders, rounds, items, sent) {
  const rows = orders.filter(od => OPEN.indexOf(od.status) >= 0).map(od => {
    const s = (sent[od.id] || []).filter(x => !x.status || x.status === "ส่งแล้ว");
    const its = (items[od.id] || []).filter(it => it.status !== "ยกเลิก").map(it => ({ ...it, delivered: Math.max(Number(it.delivered_pcs) || 0, s.filter(x => x.order_item_id === it.id).reduce((t, x) => t + x.qty_pcs, 0)) }));
    const p = planState(od, rounds[od.id], its, s);
    return { id: od.id, priority: od.priority || 0, urgent: od.urgent ? 1 : 0, queued_at: od.created_at, due: p.due, reserve: p.reserve };
  }).sort(compareRank);
  const out = new Map();
  rows.forEach((r, i) => out.set(r.id, { ...r, no: i + 1, of: rows.length }));
  return out;
}

/** เทียบงาน/แถวที่ผูกออเดอร์ (งานไม่มีออเดอร์ = ผลิตเข้าสต๊อก → ต่อท้ายตามวันของงานเอง) */
export function rankOf(ranks, orderId, fallback) {
  const r = orderId ? ranks.get(orderId) : null;
  if (r) return r;
  const f = fallback || {};
  return { id: orderId || f.id || "", priority: 0, reserve: !f.due, due: f.due || "", urgent: f.urgent ? 1 : 0, queued_at: f.queued_at || "", no: 0, of: ranks.size, stock: true };
}
export const byRank = (ranks, getOrder, getFallback) => (a, b) => compareRank(rankOf(ranks, getOrder(a), getFallback && getFallback(a)), rankOf(ranks, getOrder(b), getFallback && getFallback(b)));
