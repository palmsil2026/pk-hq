// ═══════════════════════════════════════════════════════════════════════
//  การ์ดออเดอร์ + ข้อความใบสั่งสำหรับไลน์ (เรียกซ้ำได้ทุกบทบาท)                                 v2/web/parts/order-card.js
//  PALM-WAY §3 §8: แถวออเดอร์ "ไม่โชว์ยอดเงิน" — สินค้าคร่าว ๆ บรรทัดละรายการ (ป้าย [ขนาด | ตัวเลขหนา หน่วย]) + วันส่ง + ชื่องาน
//    ไม่มีรหัสระบบบนจอ (อ้างด้วย ร้าน · วันที่) · สถานะ = สี + คำ + สัญลักษณ์
//  row = แถวจาก office.home / office.orders { customer, route_code, district, brand, due_day, order_day, status, urgent, late, money, items[] }
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { itemBadge, itemShort, dueWords, thDayLong, n0, qtyWords, baht } from "./kit.js";
const { h, icon } = ui;

export const MONEY_PILL = { unbilled: ["ยังไม่ออกบิล", "warn", "bill"], owing: ["บิลค้างชำระ", "brand", "coin"], overdue: ["เลยกำหนดชำระ", "bad", "alert"] };
export function duePill(o, today) {
  if (o.wait_next) return ui.pill("ทยอย · รอนัดเที่ยวถัดไป", "warn", "calendar");
  if (!o.due_day) return ui.pill(o.reserve ? "จอง · ยังไม่นัดส่ง" : "ยังไม่กำหนดส่ง", "mute", "calendar");
  if (o.late) return ui.pill(dueWords(o.due_day, today), "bad", "alert");
  if (o.due_day === today) return ui.pill("ส่งวันนี้", "warn", "truck");
  return ui.pill(dueWords(o.due_day, today), "mute", "calendar");
}

/** orderCard(ctx, row, onOpen, { today, maxItems, current }) */
export function orderCard(ctx, o, onOpen, opt) {
  const p = opt || {};
  const items = o.items || [];
  const max = p.maxItems || 4;
  const m = o.money && MONEY_PILL[o.money];
  const done = o.qty ? Math.round(100 * Math.min(o.delivered || 0, o.qty) / o.qty) : 0;
  return h("button.card.ocard", { type: "button", "aria-current": p.current ? "true" : null, dataset: { id: o.id }, onclick: () => onOpen(o) },
    h("div.row", h("span.name.grow", o.customer), o.urgent ? ui.pill("ด่วน", "bad", "bolt") : null),
    h("div.row.small.muted", [o.route_code ? "สาย " + o.route_code : "", o.district ? "อ." + o.district : "", o.brand ? "งาน " + o.brand : ""].filter(Boolean).join(" · ") || "ยังไม่มีสาย/อำเภอ"),
    h("div.ilines", items.slice(0, max).map(it => h("div.iline", itemBadge(it), h("span", itemShort(it)))),
      items.length > max ? h("span.small.muted", "อีก " + (items.length - max) + " รายการ") : null),
    o.status === "ส่งบางส่วน" && done > 0 ? h("div.bar", { title: "ส่งแล้ว " + done + "%" }, h("i", { style: { width: done + "%" } })) : null,
    h("div.foot", ui.statusPill(ctx.vocab, "orders.status", o.status), o.status === "ส่งแล้ว" || o.status === "ยกเลิก" ? null : duePill(o, p.today), m ? ui.pill(m[0], m[1], m[2]) : null,
      o.design_status === "รอแบบ" || o.design_status === "แก้ไขแบบ" ? ui.pill(o.design_status, "warn", "brush") : null,
      o.pay_status === "รอโอนเงิน" ? ui.pill("รอโอนเงิน", "warn", "coin") : null,
      o.hold ? ui.pill("รอยืนยัน", "warn", "clock") : null,
      o.round ? ui.pill("งวด " + o.round.seq + "/" + o.round.n + (o.round.carried ? " +ส่วนขาด" : ""), "brand", "truck") : null,
      h("span.when", "ลง " + thDayLong(o.order_day))));
}

/**
 * ข้อความใบสั่ง (แชร์เข้าไลน์กลุ่มผลิต/ส่งลูกค้าเช็ค) — ไม่มีรหัสระบบ · ไม่มีอีโมจิ · จำนวนเป็นถุง (ใบ)
 *   o = { customer, tag, brand, due_day, urgent, purchase_type, price_mode, pay_status, design_status, note, by, order_day, items[], total_satang? }
 */
export function orderText(o) {
  const L = ["ใบสั่ง โรงขวด P&K · " + thDayLong(o.order_day)];
  L.push("ลูกค้า: " + o.customer + (o.tag ? " (" + o.tag + ")" : ""));
  if (o.brand) L.push("งาน/แบรนด์: " + o.brand);
  L.push(o.plan_text ? "นัดส่ง: " + o.plan_text.replace(/^นัดส่ง /, "") + (o.urgent ? " · ด่วน" : "") : "กำหนดส่ง: " + (o.due_day ? thDayLong(o.due_day) : "ยังไม่นัด (จอง)") + (o.urgent ? " · ด่วน" : ""));
  let pcs = 0;
  const units = new Set();
  (o.items || []).forEach((it, i) => {
    units.add(it.piece_unit || "ใบ"); pcs += Number(it.qty_pcs) || 0;
    L.push((i + 1) + ". " + (it.label || it.type) + " — " + qtyWords(it) + (it.screen_color ? " · สกรีน" + it.screen_color : "") + (it.cap_color ? " · ฝา" + it.cap_color : "") +
      (it.price_satang !== null && it.price_satang !== undefined && o.withPrice ? " · ฿" + baht(it.price_satang) + "/" + (it.piece_unit || "ใบ") : ""));
  });
  L.push("รวม " + n0(pcs) + " " + (units.size === 1 ? [...units][0] : "ชิ้น") + " · " + (o.items || []).length + " รายการ" + (o.withPrice && o.total_satang ? " · ฿" + baht(o.total_satang) : ""));
  const more = [o.purchase_type, o.price_mode ? "ราคา" + o.price_mode : "", o.pay_status, o.design_status].filter(Boolean);
  if (more.length) L.push(more.join(" · "));
  if (o.note) L.push("หมายเหตุ: " + o.note);
  if (o.by) L.push("รับโดย " + o.by);
  return L.join("\n");
}
