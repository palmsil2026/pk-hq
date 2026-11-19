// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ — รายละเอียดออเดอร์ (คอม = แผงขวา · มือถือ = แผ่นล่าง) + ปุ่มงาน                         v2/web/roles/office-order-detail.js
//  ส่งเข้าคิว · ลูกค้ามารับ · ออกบิล/พิมพ์บิล · แก้ไข · แชร์ไลน์ · ยกเลิก · ย้อน · ประวัติการแก้
//  ปุ่มที่กดไม่ได้ = บอกเหตุผลในจอเดียว (ไม่ซ่อนเงียบ) · รหัสอยู่บรรทัด "รหัสอ้างอิง" จาง ๆ ที่เดียว
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, baht, thDayLong, qtyWords, itemBadge, shareText, dueWords, pricePad, dateSheet, seg, todayTh, addDay } from "../parts/kit.js";
import { planPicker, planPayload, moveSheet, blankPlan } from "../parts/plan-picker.js";
import { orderText, MONEY_PILL } from "../parts/order-card.js";
import { custTag } from "../parts/customer-picker.js";
import { write, isWide } from "./office-data.js";
import { billSheet, billDoc } from "./office-bill.js";
const { h, icon } = ui;

/** showOrder(ctx, id, host?, { onChanged }) — host = แผงขวา (คอม) · ไม่ส่ง = แผ่นล่าง */
export function showOrder(ctx, id, host, opt) {
  const o = opt || {};
  let sheet = null, box = host;
  if (!box) { sheet = ui.sheet({ title: "ออเดอร์", foot: true }); box = sheet.body; }
  const changed = () => { load(); if (o.onChanged) o.onChanged(); };
  async function load() {
    if (!box.firstChild || box.dataset.id !== id) put(box, ui.skeleton(3));
    box.dataset.id = id;
    let d;
    try { d = await ctx.api.read("office.order", { id }); }
    catch (e) { put(box, ui.errorBox("โหลดรายละเอียดไม่สำเร็จ: " + e.message, load)); return; }
    if (box.dataset.id !== id) return;
    render(d);
  }
  function render(d) {
    const od = d.order, c = d.customer || {}, can = d.can;
    if (sheet) sheet.title = od.customer_text || c.name || "ออเดอร์";
    const money = od.status === "ยกเลิก" ? null : d.bill ? (d.bill.status === "ค้างชำระ" ? (d.bill.due_day && d.bill.due_day < d.today ? "overdue" : "owing") : null) : (od.src === "v2" && d.items.some(i => i.delivered > 0) ? "unbilled" : null);
    const head = h("div.dhead",
      host ? h("h2.name", c.name || od.customer_text) : null,
      h("div.small.muted", [custTag(c), od.brand ? "งาน " + od.brand : ""].filter(Boolean).join(" · ") || "ยังไม่มีสาย/อำเภอ"),
      h("div.row", ui.statusPill(ctx.vocab, "orders.status", od.status), od.urgent ? ui.pill("ด่วน", "bad", "bolt") : null,
        od.status !== "ส่งแล้ว" && od.status !== "ยกเลิก" ? (od.late ? ui.pill(dueWords(od.due_day, d.today), "bad", "alert") : ui.pill(dueWords(od.due_day, d.today), od.due_day === d.today ? "warn" : "mute", "calendar")) : null,
        money ? ui.pill(MONEY_PILL[money][0], MONEY_PILL[money][1], MONEY_PILL[money][2]) : null,
        od.hold ? ui.pill("รอยืนยัน", "warn", "clock") : null, d.plan && d.plan.reserve && od.status !== "ส่งแล้ว" && od.status !== "ยกเลิก" ? ui.pill("จอง · ยังไม่นัดส่ง", "mute", "calendar") : null,
        od.pay_status ? ui.statusPill(ctx.vocab, "orders.pay_status", od.pay_status) : null, od.design_status ? ui.statusPill(ctx.vocab, "orders.design_status", od.design_status) : null));
    const note = c.note ? h("div.cust-note", icon("alert", "sm"), h("span", "หมายเหตุการค้า: " + c.note)) : null;
    const items = h("div.stack", d.items.map(it => {
      const prog = [];
      if (it.job) prog.push(h("span", "ผลิต ", h("b", n0(Math.min(it.made, it.qty_pcs))), "/" + n0(it.qty_pcs) + (it.job.status === "เสร็จ" ? " เสร็จ" : it.job.status === "กำลังผลิต" ? " กำลังทำ" : " รอคิว")));
      else if (it.source === "สต๊อก") prog.push(h("span", "ใช้ของในสต๊อก"));
      if (it.screen) prog.push(h("span", "สกรีน " + it.screen_color + " · " + (it.screen.status === "เสร็จแล้ว" ? "เสร็จ" : it.screen.team ? it.screen.team + " กำลังทำ" : "รอทีม")));
      if (it.delivered || it.on_truck) prog.push(h("span", "ส่งแล้ว ", h("b", n0(it.delivered)), it.on_truck ? " · บนรถ " + n0(it.on_truck) : ""));
      if (od.status !== "ส่งแล้ว" && od.status !== "ยกเลิก") prog.push(h("span", "สต๊อก A ", h("b", n0(it.stock_a)), it.stock_b ? " · B " + n0(it.stock_b) : ""));
      return h("div.icard", h("div.row", h("b.grow", it.label || it.type), itemBadge(it)),
        h("div.small.muted", [qtyWords(it), it.screen_color && !it.screen ? "สกรีน" + it.screen_color : "", it.cap_color ? "ฝา" + it.cap_color : "",
          it.price_satang !== null ? "฿" + baht(it.price_satang) + "/" + it.piece_unit : ""].filter(Boolean).join(" · ")),
        prog.length ? h("div.prog", prog) : null, it.price_reason ? h("div.hint", "เหตุผลราคา: " + it.price_reason) : null);
    }), d.cancelled_items.length ? h("div.small.muted", "ยกเลิกแล้ว: " + d.cancelled_items.map(i => i.label + " " + n0(i.qty_pcs)).join(" · ")) : null);
    const kv = h("dl.kv2");
    const kvAdd = (k, v) => { if (v !== "" && v !== null && v !== undefined) add(kv, h("dt", k), h("dd", v)); };
    kvAdd("ลงเมื่อ", thDayLong(od.order_day) + (od.taker ? " · " + od.taker : ""));
    kvAdd("กำหนดส่ง", od.due_day ? thDayLong(od.due_day) : "ยังไม่นัด");
    kvAdd("ประเภทซื้อ", [od.purchase_type, od.price_mode ? "ราคา" + od.price_mode : ""].filter(Boolean).join(" · "));
    kvAdd("ค่าบล็อก", od.block_fee_satang ? "฿" + baht(od.block_fee_satang) : "");
    kvAdd("ยอดตามราคาที่ลง", od.total_satang !== null ? "฿" + baht(od.total_satang) : "");
    kvAdd("หมายเหตุ", od.note);
    kvAdd("เหตุผลยกเลิก/ปิด", od.cancel_reason);
    if (/^legacy/.test(od.src)) kvAdd("ที่มา", "ประวัติจากแอปเดิม (AppSheet)"); else if (od.src === "demo") kvAdd("ที่มา", "ข้อมูลตัวอย่าง");
    // ── บิล ──
    const billBox = h("div.stack");
    if (d.bill) add(billBox, h("div.icard", h("div.row", icon("bill", "sm"), h("b.grow", "บิล" + d.bill.kind + " · " + d.bill.status), h("b", "฿" + baht(d.bill.total_satang))),
      h("div.small.muted", ["ออก " + thDayLong(d.bill.bill_day), d.bill.due_day && d.bill.kind === "เครดิต" ? "ครบกำหนด " + thDayLong(d.bill.due_day) : "", d.bill.paper_no ? "เลขบิลกระดาษ " + d.bill.paper_no : "ยังไม่ผูกเลขบิลกระดาษ"].filter(Boolean).join(" · ")),
      h("div.acts", h("button.btn", { type: "button", onclick: () => billDoc(ctx, d.bill.bill_no, { onChanged: changed }) }, icon("print", "sm"), "ดู/พิมพ์บิล"))));
    // ── ปุ่มงาน ──
    const btn = (label, ic, fn, cls) => h("button.btn" + (cls || ""), { type: "button", onclick: () => { fn(); } }, ic ? icon(ic, "sm") : null, label);   // ปุ่มเปิดแผ่น — ปุ่มบันทึกจริงอยู่ในแผ่น (มี ⏳ + กันกดซ้ำ)
    const main = [];
    if (can.queue) main.push(btn(od.hold ? "ลูกค้ายืนยันแล้ว — ส่งเข้าคิว" : "ส่งเข้าคิวผลิต", "play", () => queueSheet(ctx, d, changed), ".pri"));
    else if (can.pickup && (od.status === "พร้อมส่ง" || od.status === "ส่งบางส่วน")) main.push(btn("ลูกค้ามารับ", "hand", () => pickupSheet(ctx, d, changed), ".pri"));
    if (can.bill && od.status !== "ออเดอร์ใหม่") main.push(btn("ออกบิล", "bill", () => billSheet(ctx, d, { onDone: changed }), money === "unbilled" ? ".pri" : ""));
    const second = [
      can.edit ? btn("แก้ไข", "edit", () => { if (sheet) sheet.close(); ctx.go("new/edit:" + od.id); }) : null,
      btn("แชร์ไลน์", "share", () => shareText(orderText({ ...od, customer: c.name || od.customer_text, tag: custTag(c), items: d.items, by: od.taker }))),
      can.pickup && !main.some(b => /มารับ/.test(b.textContent)) ? btn("ลูกค้ามารับ", "hand", () => pickupSheet(ctx, d, changed)) : null,
      can.bill && od.status === "ออเดอร์ใหม่" ? btn("ออกบิล", "bill", () => billSheet(ctx, d, { onDone: changed })) : null,
      can.cancel ? btn(can.partialCancel ? "ปิดออเดอร์ (รับแค่ที่ส่ง)" : "ยกเลิกออเดอร์", "x-circle", () => cancelOrder(ctx, d, changed)) : null,
    ].filter(Boolean);
    const why = [can.editWhy, !can.cancel && od.status !== "ยกเลิก" && od.status !== "ส่งแล้ว" ? can.cancelWhy : ""].filter(Boolean);
    const undo = d.undo ? h("button.btn.ghost", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
      try { await ctx.api.write("undo.run", { id: d.undo.id }); ui.toast("ย้อนแล้ว — " + d.undo.label); changed(); }
      catch (err) { ui.toast(err.message, "bad"); }
    }) }, icon("undo", "sm"), "ย้อน: " + d.undo.label) : null;
    const hist = h("details.more", h("summary.btn.ghost", icon("chev", "sm"), "ประวัติ (" + d.history.length + ")"),
      h("div.hist", d.history.map(x => h("div", h("span", h("b", x.what), " · " + (x.who || "ระบบ") + " · " + thDayLong(new Date(Date.parse(x.at) + 7 * 3600000).toISOString().slice(0, 10)) + " " + ui.thTime(x.at)),
        x.changes.length ? h("span.chg", x.changes.slice(0, 6).map(ch => ch.field + " " + fmtVal(ch.key, ch.from) + " → " + fmtVal(ch.key, ch.to)).join(" · ")) : null,
        x.reason ? h("span.chg", "เหตุผล: " + x.reason) : null))));
    const actions = [main.length ? h("div.acts", main) : null, second.length ? h("div.acts", second) : null, why.length ? h("p.hint", why.join(" · ")) : null, undo].filter(Boolean);
    put(box, head, note, h("div.lbl", "สินค้า " + d.items.length + " รายการ"), items, planCard(ctx, d, changed), kv, depositCard(ctx, d, changed), billBox, ...(sheet ? [] : actions), hist, h("p.ref", "รหัสอ้างอิง " + od.id));
    if (sheet) put(sheet.foot, h("div.stack", { style: { gap: "8px" } }, actions));
  }
  load();
  return { reload: load, close: () => sheet && sheet.close() };
}
const fmtVal = (k, v) => (v === "" || v === null || v === undefined ? "ว่าง" : /_satang$/.test(k) ? "฿" + baht(v) : /_day$/.test(k) ? thDayLong(v) : k === "urgent" ? (v ? "ด่วน" : "ไม่ด่วน") : typeof v === "number" ? n0(v) : String(v));

/** ของที่โรงงานผลิตเองได้ (ชุดเดียวกับหลังบ้าน server/actions/prodLib.mjs › PROD_TYPES) */
const MADE_HERE = ["ขวด", "ถัง", "พรีฟอร์ม"];
/** ส่งเข้าคิว: ต่อรายการเลือก "ผลิตใหม่" หรือ "ใช้ของในสต๊อก" (ตั้งต้น = ผลิต) · รอโอน/รอแบบ = เตือนก่อน */
async function queueSheet(ctx, d, done) {
  const od = d.order, src = {};
  const S = ui.sheet({ title: "ส่งเข้าคิว", modal: true, foot: true });
  if (od.hold) add(S.body, h("div.banner.t-warn", icon("clock"), h("span", "ออเดอร์นี้ตั้ง \"รอยืนยัน\" ไว้ — ส่งเข้าคิว = ลูกค้ายืนยันแล้ว (ป้ายรอยืนยันหายเอง)")));
  if (od.pay_status === "รอโอนเงิน" || od.design_status === "รอแบบ" || od.design_status === "แก้ไขแบบ")
    add(S.body, h("div.banner.t-warn", icon("alert"), h("span", "ออเดอร์นี้ " + [od.pay_status === "รอโอนเงิน" ? "ยังรอโอนเงิน" : "", /แบบ/.test(od.design_status) ? od.design_status : ""].filter(Boolean).join(" · ") + " — แน่ใจว่าให้เริ่มผลิตแล้ว")));
  d.items.forEach(it => {
    if (MADE_HERE.indexOf(it.type) < 0) {   // ฝา ฟิล์ม ถุง ลัง = ซื้อมาขาย ไม่มีเครื่องผลิต → ใช้ของในสต๊อกเสมอ (หลังบ้านบังคับแบบเดียวกัน)
      src[it.id] = "สต๊อก";
      add(S.body, h("div.icard", h("div.row", h("b.grow", it.label), itemBadge(it)), h("span.small.muted", "ซื้อมาขาย — ใช้ของในสต๊อก (ไม่เข้าคิวผลิต)" + (it.stock_a ? " · มี " + n0(it.stock_a) : ""))));
      return;
    }
    src[it.id] = "ผลิต";
    const segs = h("div.chips", [["ผลิต", "ผลิตใหม่"], ["สต๊อก", "ใช้ของในสต๊อก" + (it.stock_a ? " (มี " + n0(it.stock_a) + ")" : "")]].map(([v, l]) =>
      h("button.chip", { type: "button", "aria-pressed": String(v === "ผลิต"), onclick: e => { src[it.id] = v; segs.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === e.currentTarget))); } }, l)));
    add(S.body, h("div.icard", h("div.row", h("b.grow", it.label), itemBadge(it)), segs, it.screen_color ? h("span.small.muted", "สกรีน" + it.screen_color + " → เข้าคิวทีมสกรีนด้วย") : null));
  });
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"),
    h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
      const r = await write(ctx, "office.order_queue", { id: od.id, version: od.version, sources: src }, { label: "ส่งเข้าคิว " + od.customer_text, after: () => done() });
      if (r) S.close("ok");
    }) }, "ส่งเข้าคิว")));
}

/** ลูกค้ามารับที่โรงงาน: จำนวนต่อรายการ (ตั้งต้น = ที่ยังค้าง) แป้นตัวเลขของแอป */
async function pickupSheet(ctx, d, done) {
  const od = d.order, q = {};
  const S = ui.sheet({ title: "ลูกค้ามารับที่โรงงาน", modal: true, foot: true });
  add(S.body, h("p.muted", "ระบบตัดสต๊อกและนับเป็นส่งแล้วให้ — ส่งเป็นงวดได้ (รับบางส่วนก่อน)"));
  d.items.forEach(it => {
    const left = Math.max(0, it.qty_pcs - it.delivered - it.on_truck);
    q[it.id] = left;
    const b = h("button.qbtn", { type: "button", onclick: async () => {
      const v = await ui.numpadSheet({ title: "รับ " + it.label, unit: it.piece_unit, value: q[it.id] || "", label: "ค้าง " + n0(left) });
      if (v === null || v === undefined) return;
      q[it.id] = v; b.querySelector("b").textContent = n0(v) + " " + it.piece_unit;
    } }, h("small", "รับครั้งนี้"), h("b", n0(left) + " " + it.piece_unit));
    add(S.body, h("div.icard", h("div.row", h("b.grow", it.label), itemBadge(it)), h("div.small.muted", "ส่งแล้ว " + n0(it.delivered) + " · ค้าง " + n0(left) + " · สต๊อก A " + n0(it.stock_a)), b));
  });
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"),
    h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
      const lines = Object.entries(q).filter(([, v]) => v > 0).map(([item_id, qty_pcs]) => ({ item_id, qty_pcs }));
      if (!lines.length) { ui.toast("ใส่จำนวนที่รับก่อน", "warn"); return; }
      const r = await write(ctx, "office.order_pickup", { id: od.id, version: od.version, lines }, { label: "ลูกค้ารับของ", reasonKind: "pickup", reasonTitle: "รับเกินที่สั่ง — ใส่เหตุผล", after: () => done() });
      if (r) S.close("ok");
    }) }, "บันทึกว่ารับแล้ว")));
}

async function cancelOrder(ctx, d, done) {
  const od = d.order, partial = d.can.partialCancel;
  await write(ctx, "office.order_cancel", { id: od.id, version: od.version }, {
    label: partial ? "ปิดออเดอร์" : "ยกเลิกออเดอร์",
    confirm: { title: partial ? "ปิดออเดอร์ที่จำนวนเท่าที่ส่ง" : "ยกเลิกออเดอร์ " + od.customer_text,
      detail: partial ? "ส่งไปแล้วบางส่วน — รายการจะตัดเหลือเท่าที่ส่ง ที่ยังไม่ส่งยกเลิก งานผลิต/สกรีนที่ค้างหยุด (ย้อนได้)" : "งานผลิต/สกรีนของออเดอร์นี้จะหยุดด้วย (ย้อนได้ถ้ายังไม่มีใครแตะต่อ)",
      reasons: ctx.reasons("order_cancel"), need: "required", okText: partial ? "ปิดออเดอร์" : "ยกเลิกออเดอร์", danger: true },
    after: () => done(),
  });
}

/** เปิดรายละเอียดแบบ master-detail: คอม = แผงขวาในหน้า · มือถือ = แผ่นล่าง */
export function openOrderIn(ctx, panel, id, onChanged) {
  if (panel && isWide()) return showOrder(ctx, id, panel, { onChanged });
  return showOrder(ctx, id, null, { onChanged });
}

// ── งวดส่ง (ต้องการเมื่อไร · นัด/เลื่อน + สาเหตุ · ส่งครบ/ไม่ครบคิดจากการส่งจริง) ─────────────────────────
const STATE_PILL = { "ส่งครบ": ["ส่งครบ", "ok", "check"], "ส่งไม่ครบ": ["ส่งไม่ครบ · ส่วนขาดไปงวดถัดไป", "warn", "alert"], "ถึงคิว": ["ถึงคิว", "brand", "truck"], "รอ": ["รอ", "mute", "clock"] };
const MODE_TH = { "ครั้งเดียว": "ครั้งเดียวครบ", "กำหนดจำนวน": "กำหนดจำนวนต่อครั้ง", "ทยอย": "ทยอยตามที่ทำได้", "": "ครั้งเดียว" };
const tgt = (it, cum) => { const q = it.qty_pcs; if (cum >= 10000) return q; return it.per_bag ? Math.min(q, Math.round((q / it.per_bag) * cum / 10000) * it.per_bag) : Math.min(q, Math.round(q * cum / 10000)); };
const qWords = (it, pcs) => (it.per_bag ? n0(Math.round(pcs / it.per_bag)) + " ถุง" : n0(pcs) + " " + (it.piece_unit || "ใบ"));
function planCard(ctx, d, done) {
  const od = d.order, P = d.plan;
  if (!P) return null;
  const openOrder = od.status !== "ส่งแล้ว" && od.status !== "ยกเลิก";
  const main = d.items[0];
  const want = od.want_when ? "ลูกค้าต้องการ " + (od.want_when === "ระบุวัน" ? thDayLong(od.want_day) : od.want_when + (od.want_range ? " (" + thDayLong(od.want_range.from) + " – " + thDayLong(od.want_range.to) + ")" : "")) : "";
  let prev = 0;
  const rows = P.rounds.map((r, i) => {
    const part = main ? tgt(main, r.cum_bp) - tgt(main, prev) : 0;
    prev = r.cum_bp;
    const cur = P.current && P.current.seq === r.seq;
    const need = cur && main ? (P.current.need.find(x => x.item_id === main.id) || {}).pcs : null;
    const later = P.rounds.slice(i + 1).some(x => x.plan_day);
    const canMove = openOrder && r.state !== "ส่งครบ" && !(r.state === "ส่งไม่ครบ");
    const sp = STATE_PILL[r.state] || STATE_PILL["รอ"];
    return h("div.rnd" + (cur ? ".cur" : ""), h("span.no", P.n > 1 ? "งวด " + r.seq : "นัด"),
      h("span.t", h("b", r.plan_day ? thDayLong(r.plan_day) + (cur && P.current.wait_next ? " (ส่งแล้ว · รอนัดเที่ยวถัดไป)" : "") : "ยังไม่นัด"),
        h("small", [main && P.n > 1 ? main.label + " " + qWords(main, part) : "", cur && need !== null && need !== undefined ? "ต้องส่งงวดนี้ " + qWords(main, need) + (P.current.carried ? " (รวมส่วนขาด)" : "") : "", r.days.length ? "ส่งเมื่อ " + r.days.map(thDayLong).join(", ") : ""].filter(Boolean).join(" · ")),
        h("span.row", ui.pill(sp[0], sp[1], sp[2]))),
      canMove ? h("button.btn", { type: "button", onclick: async () => {
        const m = await moveSheet(ctx, { from: r.plan_day, today: todayTh(), hasLater: later, label: P.n > 1 ? "งวด " + r.seq : od.customer_text, title: r.plan_day ? "เลื่อนไปวันไหน" : "นัดส่งวันไหน" });
        if (!m) return;
        await write(ctx, "office.round_move", { id: od.id, version: od.version, round: r.id, to_day: m.to_day, shift_after: m.shift_after }, { label: (r.plan_day ? "เลื่อนวันส่ง " : "นัดส่ง ") + od.customer_text, reasonKind: "reschedule", reasonTitle: "เลื่อนวันส่ง — เลือกสาเหตุ", after: () => done(), reason: m.reason });
      } }, icon("calendar", "sm"), r.plan_day ? "เลื่อน" : "นัด") : null);
  });
  const acts = [];
  if (openOrder) acts.push(h("button.btn", { type: "button", onclick: () => replanSheet(ctx, d, done) }, icon("edit", "sm"), "วางงวดใหม่"));
  if (od.status === "ออเดอร์ใหม่") acts.push(h("button.btn", { type: "button", onclick: () => write(ctx, "office.hold_set", { id: od.id, version: od.version, hold: od.hold ? 0 : 1 }, { label: od.hold ? "ยกเลิกรอยืนยัน" : "ตั้งรอยืนยัน", after: () => done() }) }, icon("clock", "sm"), od.hold ? "ไม่ต้องรอยืนยันแล้ว" : "ตั้งรอยืนยัน"));
  const hist = (d.reschedules || []).length ? h("details.more", h("summary.btn.ghost", icon("chev", "sm"), "ประวัติเลื่อนวันส่ง (" + d.reschedules.length + ")"),
    h("div.hist", d.reschedules.map(e => h("div", h("span", h("b", (e.seq ? "งวด " + e.seq + " · " : "") + (e.from_day ? thDayLong(e.from_day) : "ยังไม่นัด") + " → " + (e.to_day ? thDayLong(e.to_day) : "ยังไม่นัด")),
      " · " + e.cause + (e.note ? " (" + e.note + ")" : "") + " · " + (e.nick || "") + " " + ui.thTime(e.created_at)))))) : null;
  return h("section.icard.plan", h("div.row", icon("truck", "sm"), h("b.grow", "งวดส่ง · " + (P.virtual ? "ครั้งเดียว" : MODE_TH[P.mode] || P.mode) + (P.n > 1 ? " " + P.n + " งวด" : "")),
    P.done ? ui.pill("ส่งครบทุกงวด", "ok", "check") : null),
    want ? h("div.small.muted", want) : null, h("div.rounds", rows),
    P.reserve && openOrder ? h("p.hint", "จอง — ยังไม่มีวันนัด (ไม่ได้คิวนัดส่ง) · แตะ \"นัด\" เมื่อลูกค้ายืนยันวัน") : null,
    acts.length ? h("div.acts", acts) : null, hist);
}
function replanSheet(ctx, d, done) {
  const od = d.order;
  const P = { ...blankPlan(), want_when: od.want_when || "", want_day: od.want_day || "", mode: od.plan_mode || "ครั้งเดียว", first_day: d.plan && d.plan.current ? d.plan.current.plan_day || "" : od.due_day || "" };
  const main = d.items[0];
  const mi = () => (main ? { qty: main.qty_pcs, per: main.per_bag, unit: main.piece_unit, label: main.label } : null);
  if (od.plan_mode === "กำหนดจำนวน") { P.each = od.plan_each_pcs ? (main && main.per_bag ? Math.round(od.plan_each_pcs / main.per_bag) : od.plan_each_pcs) : 0; P.times = od.plan_each_pcs ? 0 : (d.plan ? d.plan.n : 0); P.every_days = od.plan_every_days || 0; }
  if (od.plan_mode === "ทยอย" && od.plan_cap_pcs) P.cap = main && main.per_bag ? Math.round(od.plan_cap_pcs / main.per_bag) : od.plan_cap_pcs;
  const S = ui.sheet({ title: "วางงวดส่งใหม่ · " + od.customer_text, modal: true, foot: true });
  add(S.body, h("p.small.muted", "งวดเดิมจะถูกแทนทั้งชุด (เก็บประวัติไว้ ย้อนได้) · ถ้าวันที่นัดลูกค้าไว้เปลี่ยน ระบบจะถามสาเหตุ"), planPicker(P, { main: mi, today: todayTh() }));
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"), h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
    if (P.mode === "กำหนดจำนวน" && !P.each && !P.times) { ui.toast("ใส่ \"ต่อครั้ง\" หรือ \"กี่ครั้ง\" ก่อน", "warn"); return; }
    const r = await write(ctx, "office.plan_set", { id: od.id, version: od.version, plan: planPayload(P, mi()), want_when: P.want_when, want_day: P.want_day },
      { label: "วางงวดส่ง " + od.customer_text, reasonKind: "reschedule", reasonTitle: "ย้ายวันที่นัดไว้ — เลือกสาเหตุ", after: () => done() });
    if (r) S.close("ok");
  }) }, "บันทึกงวดส่ง")));
}

// ── มัดจำ (เห็นเฉพาะบทบาทที่เห็นเงิน — หน้านี้ออฟฟิศ/ประธานเท่านั้น) · ไม่หักยอดบิลเอง ─────────────────────────
function depositCard(ctx, d, done) {
  const od = d.order;
  if (!Array.isArray(d.deposits)) return null;
  const ch = v => ((ctx.vocab["pay.channel"] || []).find(x => x.value === v) || {}).label || v;
  const rows = d.deposits.map(x => h("div.depo" + (x.status === "ยกเลิก" ? ".off" : ""), h("span", h("b", "฿" + baht(x.amount_satang)), " · " + ch(x.channel) + " · " + thDayLong(x.paid_day) + (x.by_nick ? " · " + x.by_nick : "") + (x.note ? " · " + x.note : "") + (x.status === "ยกเลิก" ? " · ยกเลิก: " + x.cancel_reason : "")),
    x.status === "ใช้งาน" ? h("button.btn.ghost", { type: "button", onclick: () => write(ctx, "office.deposit_cancel", { id: x.id, version: x.version }, { label: "ยกเลิกมัดจำ",
      confirm: { title: "ยกเลิกมัดจำ ฿" + baht(x.amount_satang), reasons: ctx.reasons("deposit_cancel"), need: "required", okText: "ยกเลิกรายการนี้", danger: true }, after: () => done() }) }, "ยกเลิก") : null));
  return h("section.icard", h("div.row", icon("coin", "sm"), h("b.grow", "มัดจำ"), d.deposit_satang ? h("b", "฿" + baht(d.deposit_satang)) : h("span.small.muted", "ยังไม่มี")),
    rows.length ? h("div.stack", rows) : null,
    d.deposit_satang && d.bill ? h("p.hint", "บิลไม่ได้หักมัดจำให้เอง — ฝ่ายบัญชีตรวจตอนรับชำระ") : null,
    od.status !== "ยกเลิก" ? h("div.acts", h("button.btn", { type: "button", onclick: () => depositSheet(ctx, od, done) }, icon("plus", "sm"), "ลงมัดจำ")) : null);
}
async function depositSheet(ctx, od, done) {
  const f = { amount: null, channel: "", day: todayTh(), note: "" };
  const S = ui.sheet({ title: "ลงมัดจำ · " + od.customer_text, modal: true, foot: true });
  const amt = h("button.qbtn", { type: "button", onclick: async () => { const v = await pricePad({ title: "ยอดมัดจำ (บาท)", label: "บาท", value: f.amount }); if (v === undefined) return; f.amount = v; paint(); } }, h("small", "ยอดมัดจำ"), h("b"));
  const chans = (ctx.vocab["pay.channel"] || []).map(v => [v.value, v.label || v.value]);
  const chSeg = seg(chans, "", v => { f.channel = v; }, { label: "ช่องทางรับเงิน" });
  const t = todayTh();
  const days = seg([[t, "วันนี้"], [addDay(t, -1), "เมื่อวาน"], ["x", "วันอื่น"]], t, async v => {
    if (v === "x") { const dd = await dateSheet({ title: "รับมัดจำวันไหน", value: f.day, min: addDay(t, -365) }); if (dd) f.day = dd > t ? t : dd; else days.set(f.day === t ? t : addDay(t, -1)); }
    else f.day = v; paint();
  }, { label: "วันที่รับ" });
  const dayLbl = h("span.small.muted");
  const note = h("input", { type: "text", maxlength: 200, placeholder: "เช่น สลิปในไลน์ P&K", "aria-label": "หมายเหตุ", oninput: e => { f.note = e.target.value; } });
  const msg = h("p.err", { role: "alert" });
  const paint = () => { amt.querySelector("b").textContent = f.amount ? "฿" + baht(f.amount) : "แตะใส่ยอด"; dayLbl.textContent = thDayLong(f.day); };
  add(S.body, h("div.qrow", amt), h("div.lbl", "ช่องทางรับเงิน (เลือกเอง)"), chSeg, h("div.row", h("div.lbl.grow", "วันที่รับ"), dayLbl), days, h("label.field", h("span.lbl", "หมายเหตุ"), note),
    h("p.small.muted", "บันทึกไว้ให้ทุกคนเห็นว่ามัดจำแล้ว — ระบบไม่หักออกจากบิลเอง"), msg);
  paint();
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"), h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
    if (!f.amount) { msg.textContent = "ใส่ยอดมัดจำก่อน"; return; }
    if (!f.channel) { msg.textContent = "เลือกช่องทางรับเงินก่อน (ไม่มีค่าตั้งต้น)"; return; }
    const r = await write(ctx, "office.deposit_add", { order: od.id, amount_satang: f.amount, channel: f.channel, paid_day: f.day, note: f.note.trim() }, { label: "มัดจำ ฿" + baht(f.amount), after: () => done() });
    if (r) S.close("ok");
  }) }, "บันทึกมัดจำ")));
}
