// ═══════════════════════════════════════════════════════════════════════
//  ต้องการเมื่อไร + นัดส่ง + งวดส่ง (ฟอร์มลงออเดอร์ · แผ่น "วางงวดใหม่" ในรายละเอียด)              v2/web/parts/plan-picker.js
//  ของเดิม: วันส่ง = วันสั่ง +10 วันอัตโนมัติ 97.9% · งวดส่ง/ด่วน/มารับเอง จดในหมายเหตุ → ที่นี่เป็นปุ่มทั้งหมด
//    ต้องการเมื่อไร = ไม่บังคับ และไม่ตั้งให้เอง · นัดส่งไม่เลือก = "จอง" (ยังไม่ได้คิวนัด)
//    งวดส่ง 3 แบบ: ครั้งเดียวครบ · กำหนดจำนวนต่อครั้ง (× กี่ครั้ง หรือทุกกี่วัน) · ทยอยตามที่ทำได้ (เพดานต่อเที่ยวไม่บังคับ)
//  P = { want_when, want_day, mode, first_day, each, times, every_days, cap } (each/cap = จำนวนตามหน่วยของรายการแรก: ถุงถ้านับถุง)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, thDayLong, seg, weekRow, dateSheet, addDay } from "./kit.js";
const { h, icon } = ui;

export const blankPlan = () => ({ want_when: "", want_day: "", mode: "ครั้งเดียว", first_day: "", each: 0, times: 0, every_days: 0, cap: 0 });
const MODES = [["ครั้งเดียว", "ครั้งเดียวครบ"], ["กำหนดจำนวน", "กำหนดจำนวนต่อครั้ง"], ["ทยอย", "ทยอยตามที่ทำได้"]];

/** P + รายการแรก → plan ที่ส่งหลังบ้าน (แปลงถุง → ใบ) */
export function planPayload(P, main) {
  const per = (main && main.per) || 0;
  const pcs = n => (per ? n * per : n);
  return { mode: P.mode, first_day: P.first_day || "", each_pcs: P.mode === "กำหนดจำนวน" && P.each ? pcs(P.each) : 0, times: P.mode === "กำหนดจำนวน" && !P.each ? P.times || 0 : 0,
    every_days: P.mode === "กำหนดจำนวน" ? P.every_days || 0 : 0, cap_pcs: P.mode === "ทยอย" && P.cap ? pcs(P.cap) : 0 };
}
/** คำอธิบายสั้นของแผน (การ์ดยืนยัน / ใบสั่ง) */
export function planWords(P, main) {
  const u = main && main.per ? "ถุง" : (main && main.unit) || "ใบ";
  const n = roundsOf(P, main);
  const first = P.first_day ? "นัดส่ง " + thDayLong(P.first_day) : "ยังไม่นัด (จอง)";
  if (P.mode === "กำหนดจำนวน") return first + " · " + (P.each ? "ครั้งละ " + n0(P.each) + " " + u : "แบ่ง") + (n ? " × " + n + " ครั้ง" : "") + (P.every_days ? " ทุก " + P.every_days + " วัน" : " (นัดทีละงวด)");
  if (P.mode === "ทยอย") return first + " · ทยอยตามที่ทำได้" + (P.cap ? " เที่ยวละไม่เกิน " + n0(P.cap) + " " + u : "");
  return first + " · ครั้งเดียวครบ";
}
export function wantWords(P) {
  if (!P.want_when) return "";
  return "ลูกค้าต้องการ " + (P.want_when === "ระบุวัน" ? thDayLong(P.want_day) : P.want_when);
}
function roundsOf(P, main) {
  if (P.mode !== "กำหนดจำนวน") return 1;
  if (P.each) { const total = main ? (main.per ? Math.ceil(main.qty / main.per) : main.qty) : 0; return total ? Math.ceil(total / P.each) : 0; }
  return P.times || 0;
}

/** planPicker(P, { main: () => ({qty, per, unit, label}), onChange, firstOnly }) → element (.refresh()) */
export function planPicker(P, opt) {
  const o = opt || {};
  const box = h("div.plan-box");
  const changed = () => { draw(); if (o.onChange) o.onChange(); };
  // ── ต้องการเมื่อไร ──
  const wantLbl = h("span.small.muted");
  const want = seg([["สัปดาห์นี้", "สัปดาห์นี้"], ["สัปดาห์หน้า", "สัปดาห์หน้า"], ["ไม่รีบ", "ไม่รีบ"], ["ระบุวัน", "ระบุวัน"]], P.want_when, async v => {
    if (v === "ระบุวัน") {
      const d = await dateSheet({ title: "ลูกค้าต้องการวันไหน", value: P.want_day, min: o.today });
      if (!d) { want.set(P.want_when); return; }
      P.want_day = d;
    } else P.want_day = "";
    P.want_when = v; changed();
  }, { label: "ต้องการเมื่อไร", allowNone: true });
  want.classList.add("want");
  // ── นัดส่ง (งวดแรก) ──
  const dueLbl = h("span.muted");
  const week = weekRow(P.first_day, d => { P.first_day = d; changed(); }, { title: "วันนัดส่ง", allowNone: true, noneText: "ยังไม่นัด (จอง)" });
  const noDue = h("button.chip", { type: "button", onclick: () => { P.first_day = ""; week.set(""); changed(); } }, "ยังไม่นัด (จอง)");
  // ── งวดส่ง ──
  const modes = seg(MODES, P.mode, v => { P.mode = v || "ครั้งเดียว"; changed(); }, { label: "งวดส่ง" });
  modes.classList.add("plan-modes");
  const extra = h("div.stack");
  const unitOf = () => { const m = o.main ? o.main() : null; return m && m.per ? "ถุง" : (m && m.unit) || "ใบ"; };
  const numBtn = (label, key, title, onSet) => h("button.qbtn", { type: "button", onclick: async () => {
    const v = await ui.numpadSheet({ title, unit: key === "times" ? "ครั้ง" : key === "every_days" ? "วัน" : unitOf(), value: P[key] || "" });
    if (v === undefined) return;
    P[key] = v || 0; if (onSet) onSet(); changed();
  } }, h("small", label), h("b", P[key] ? n0(P[key]) + " " + (key === "times" ? "ครั้ง" : key === "every_days" ? "วัน" : unitOf()) : "ไม่กำหนด"));
  function draw() {
    dueLbl.textContent = P.first_day ? thDayLong(P.first_day) : "ยังไม่นัด = จอง";
    wantLbl.textContent = P.want_when === "ระบุวัน" ? thDayLong(P.want_day) : P.want_when ? "" : "ไม่บังคับ";
    const m = o.main ? o.main() : null, n = roundsOf(P, m);
    put(extra);
    if (P.mode === "กำหนดจำนวน") {
      const every = seg([["0", "นัดทีละงวด"], ["7", "ทุก 7 วัน"], ["14", "ทุก 14 วัน"], ["x", "ระบุ"]], [0, 7, 14].includes(P.every_days) ? String(P.every_days) : "x", async v => {
        if (v === "x") { const d = await ui.numpadSheet({ title: "ส่งทุกกี่วัน", unit: "วัน", value: P.every_days || "" }); if (d === undefined || d === null) { every.set(String(P.every_days)); return; } P.every_days = d; }
        else P.every_days = Number(v); changed();
      }, { label: "ระยะห่างงวด" });
      add(extra, h("div.qrow", numBtn("ต่อครั้ง (" + (m && m.label ? m.label : "รายการแรก") + ")", "each", "ส่งครั้งละเท่าไร", () => { P.times = 0; }), numBtn("หรือ กี่ครั้ง", "times", "แบ่งส่งกี่ครั้ง", () => { P.each = 0; })),
        every, h("p.hint", (n ? "รวม " + n + " งวด" + (P.every_days && P.first_day ? " · งวดสุดท้าย " + thDayLong(addDay(P.first_day, (n - 1) * P.every_days)) : "") + " · " : "") + "ส่งไม่ครบงวดไหน ส่วนขาดไปรวมงวดถัดไป · รายการอื่นแบ่งตามสัดส่วนเดียวกัน"));
    } else if (P.mode === "ทยอย") add(extra, h("div.qrow", numBtn("เพดานต่อเที่ยว (ไม่บังคับ)", "cap", "ส่งเที่ยวละไม่เกิน")), h("p.hint", "ทำได้เท่าไรส่งเท่านั้น ที่เหลือค้างไว้ทยอยต่อ · ส่งแล้วระบบรอนัดเที่ยวถัดไป"));
    else add(extra, h("p.hint", "ส่งไม่ครบ = ที่เหลือค้างอยู่ในงวดเดิม"));
  }
  add(box, h("div.row", h("div.lbl.grow", "ลูกค้าต้องการเมื่อไร"), wantLbl), want,
    h("div.row", h("div.lbl.grow", "นัดส่ง" + (o.firstOnly ? "" : " (งวดแรก)")), dueLbl), week, h("div.chips", noDue, o.extraChips || null),
    h("div.lbl", "งวดส่ง"), modes, extra);
  draw();
  box.refresh = draw;
  return box;
}

/** แผ่นเลือกวันนัดใหม่ + สาเหตุ (เลื่อนจากวันที่นัดไว้ = สาเหตุบังคับ) → { to_day, reason, shift_after } | null */
export async function moveSheet(ctx, opt) {
  const o = opt || {};
  const to = await dateSheet({ title: o.title || "นัดส่งวันไหน", value: o.from || "", min: o.today, allowNone: !!o.from, noneText: "ยกเลิกนัด (กลับเป็นจอง)" });
  if (to === undefined || to === o.from) return null;
  if (!o.from) return { to_day: to, reason: "", shift_after: false };   // นัดครั้งแรก = ไม่ใช่การเลื่อน
  let shift = !!o.hasLater;
  const sw = o.hasLater ? h("button.chip", { type: "button", "aria-pressed": "true", onclick: e => { shift = !shift; e.currentTarget.setAttribute("aria-pressed", String(shift)); } }, "เลื่อนงวดถัดไปตามด้วย") : null;
  const reasons = ctx.reasons("reschedule").filter(r => r !== "อื่น ๆ" && r !== "แก้ในหน้าออเดอร์");
  const c = await ui.confirmSheet({ title: (to ? "เลื่อนวันส่ง" : "ยกเลิกนัด") + " — เลือกสาเหตุ", detail: h("div.stack", h("p", (o.label ? o.label + ": " : "") + thDayLong(o.from) + " → " + (to ? thDayLong(to) : "ยังไม่นัด (จอง)")),
    sw, h("p.small.muted", "สาเหตุเก็บไว้นับรายสัปดาห์ (ลูกค้าขอเลื่อน / ขวดไม่พอ / เครื่องเสีย …)")), reasons, need: "required", okText: to ? "เลื่อนวันส่ง" : "ยกเลิกนัด" });
  if (!c) return null;
  return { to_day: to, reason: c.reason, shift_after: shift };
}
export { icon };
