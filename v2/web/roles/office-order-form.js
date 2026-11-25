// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ — ลงออเดอร์ / แก้ออเดอร์ (#/new · #/new/edit:<ออเดอร์> · #/new/cust:<ลูกค้า>)          v2/web/roles/office-order-form.js
//  ยกพฤติกรรมที่คุณปาล์มอนุมัติจากหน้าลงออเดอร์เดิม (STATUS.md › แอปลงออเดอร์ v2/v2.1):
//    ลูกค้าพิมพ์แล้วเด้งแนะนำ + แผ่นลูกค้าใหม่ (เตือนชื่อคล้าย · แยกชื่องาน) · การ์ด "เคยสั่ง" ของลูกค้าคนนั้น แตะทีเดียวได้ทั้งไลน์
//    ชิปต่อแกน (เฉพาะแกนที่ใช้) · ถุง → ใบ + เศษ · ขั้นต่ำเตือนไม่บล็อก · ช่องที่เคยเขียนในหมายเหตุเป็นปุ่ม · การ์ดยืนยัน → บันทึก → แชร์ไลน์
//  กดนอกการ์ดยืนยัน = กลับไปแก้ (ไม่ล้างฟอร์ม) · ร่างที่กรอกค้างจำไว้ (ออกไปหน้าอื่นแล้วกลับมายังอยู่)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, baht, thDayLong, todayTh, seg, weekRow, shareText, itemBadge } from "../parts/kit.js";
import { customerPicker, custTag } from "../parts/customer-picker.js";
import { specLine, calcLine, labelOf, listPriceOf } from "../parts/spec-picker.js";
import { orderText } from "../parts/order-card.js";
import { cached, forget, write } from "./office-data.js";
import { blankPlan, planPicker, planPayload, planWords, wantWords } from "../parts/plan-picker.js";
const { h, icon } = ui;

const DRAFT = "office.draft";
const blank = () => ({ mode: "new", id: "", version: 0, customer: null, brand: "", items: [], due_day: "", urgent: 0, purchase_type: "ขายราคาโรงงาน", price_mode: "มาตรฐาน",
  pay_status: "", design_status: "", block_fee_satang: null, note: "", plan: blankPlan(), hold: 0 });
const newItem = x => Object.assign({ type: "", size: "", neck: "", shape: "", color: "", screen_color: "", cap_color: "", bags: 0, extra_pcs: 0, qty_pcs: 0, price_satang: null, price_reason: "" }, x || {});
let F = null;   // ร่างที่กรอกค้าง (อยู่ข้ามการสลับหน้า)
const saveDraft = () => { if (F && F.mode === "new") ctxStore.set(DRAFT, F); };
let ctxStore = null;

export async function orderFormView(ctx, view, n) {
  ctxStore = ctx.api.store;
  const arg = n.arg || "";
  const edit = /^edit:/.test(arg) ? arg.slice(5) : "";
  const preCust = /^cust:/.test(arg) ? arg.slice(5) : "";
  add(view, ui.skeleton(3));
  let cat, customers;
  try { [cat, customers] = await Promise.all([cached(ctx, "office.form"), cached(ctx, "office.customers")]); }
  catch (e) { put(view, ui.errorBox("โหลดข้อมูลฟอร์มไม่สำเร็จ: " + e.message, () => ctx.refresh())); return; }
  customers = customers.customers;
  if (edit) {
    let d;
    try { d = await ctx.api.read("office.order", { id: edit }); }
    catch (e) { put(view, ui.errorBox("โหลดออเดอร์ไม่สำเร็จ: " + e.message, () => ctx.refresh())); return; }
    const od = d.order;
    F = { ...blank(), mode: "edit", id: od.id, version: od.version, customer: customers.find(c => c.id === od.customer_id) || { id: od.customer_id, name: d.customer ? d.customer.name : od.customer_text },
      brand: od.brand, due_day: od.due_day, urgent: od.urgent, purchase_type: od.purchase_type, price_mode: od.price_mode, pay_status: od.pay_status, design_status: od.design_status,
      block_fee_satang: od.block_fee_satang, note: od.note, canItems: d.can.editItems, editWhy: d.can.editWhy,
      items: d.items.map(i => ({ ...newItem(i), id: i.id, _lock: (i.job && (i.job.status !== "รอผลิต" || i.job.good_pcs > 0)) ? "ทีมผลิตเริ่มทำแล้ว — แก้สเปกไม่ได้ (ลดจำนวน/ลบรายการแล้วเพิ่มใหม่ได้)" : (i.delivered || i.on_truck) ? "ส่ง/ขึ้นรถไปแล้ว — แก้สเปกไม่ได้" : "", _min: (i.delivered || 0) + (i.on_truck || 0) })) };
  } else if (!F || F.mode !== "new") {
    F = ctx.api.store.get(DRAFT) || blank();
    if (F.mode !== "new") F = blank();
    if (!F.plan) F.plan = { ...blankPlan(), first_day: F.due_day || "" };   // ร่างรุ่นก่อน (มีแค่วันส่ง)
  }
  if (preCust) { const c = customers.find(x => x.id === preCust); if (c) F.customer = c; }
  if (!F.items.length) F.items.push(newItem());
  render(ctx, view, cat, customers);
  cached(ctx, "office.customers", d => { customers = d.customers; if (view.isConnected && view.picker) view.picker.setCustomers(customers); });
}

function render(ctx, view, cat, customers) {
  const editing = F.mode === "edit";
  const dirty = () => { view.dataset.formDirty = "1"; saveDraft(); paintSum(); };
  view.dataset.formDirty = editing ? "1" : "";
  // ── ลูกค้า ──
  const usualBox = h("div.usual");
  const usualCard = h("section.card", { "aria-label": "เคยสั่ง" }, h("div.row", icon("clock", "sm"), h("b.grow.usual-title", "เคยสั่ง")), usualBox);
  const picker = customerPicker(ctx, { customers, value: F.customer, districts: cat.districts, routes: cat.routes,
    onPick: c => { F.customer = c; dirty(); loadUsual(); if (c && !editing && F.items.length === 1 && !F.items[0].type) setTimeout(() => lineEls[0] && lineEls[0].guide(), 60); },
    onBrand: b => { F.brand = b; brandIn.value = b; dirty(); } });
  view.picker = picker;
  if (editing && F.items.some(i => i._min)) picker.querySelector("input").disabled = true;
  const brandIn = h("input", { type: "text", maxlength: 80, value: F.brand || "", placeholder: "ไม่บังคับ — เช่น ชื่อแบรนด์น้ำที่สกรีน", "aria-label": "ชื่องาน/แบรนด์", oninput: e => { F.brand = e.target.value; dirty(); } });
  async function loadUsual() {
    const c = F.customer;
    const title = usualCard.querySelector(".usual-title");
    if (!c) { title.textContent = "เคยสั่ง"; put(usualBox, h("p.hint", "เลือกลูกค้าก่อน — สินค้าที่เขาเคยสั่งจะขึ้นตรงนี้ แตะทีเดียวได้ทั้งรายการ")); return; }
    let list = [], own = false;
    if (!c.isNew && c.id) {
      put(usualBox, ui.skeleton(1));
      try { const d = await ctx.api.read("office.customer", { id: c.id }); list = d.usual; own = list.length > 0; }
      catch (e) { put(usualBox, ui.errorBox("โหลด \"เคยสั่ง\" ไม่สำเร็จ: " + e.message)); return; }
      if (F.customer !== c) return;
    }
    if (!own) list = cat.top || [];
    title.textContent = own ? c.name + " เคยสั่ง" : c.name + " ยังไม่เคยสั่ง — ที่สั่งบ่อยทั่วไป";
    put(usualBox, ...(list.length ? list.map(u => h("button", { type: "button", onclick: () => addFrom(u, own) },
      h("span.t", h("b", labelOf(u)), h("small", [u.screen_color ? "สกรีน" + u.screen_color : "", u.cap_color ? "ฝา" + u.cap_color : "",
        own ? (u.bags ? "ล่าสุด " + n0(u.bags) + " ถุง" : "ล่าสุด " + n0(u.qty_pcs)) : "", own && u.price_satang !== null && u.price_satang !== undefined ? "฿" + baht(u.price_satang) : "", own ? thDayLong(u.last_day) : ""].filter(Boolean).join(" · "))),
      h("span.n", n0(u.n) + "×"))) : [h("p.hint", "ยังไม่มีประวัติ")]));
  }
  function addFrom(u, own) {
    // แผ่นเลือกแกนที่ไล่ถามค้างอยู่ชี้ไลน์เปล่าที่กำลังจะถูกแทน → ปิดก่อน (แบบหน้าลงออเดอร์เดิม: "เคยสั่ง" อยู่เหนือฉากหลัง แตะได้เลย)
    while (ui.sheetOpen()) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const it = newItem({ type: u.type, size: u.size, neck: u.neck, shape: u.shape, color: u.color, screen_color: u.screen_color, cap_color: u.cap_color,
      bags: own ? u.bags : 0, extra_pcs: own ? u.extra_pcs : 0, qty_pcs: own && !u.per_bag ? u.qty_pcs : 0, price_satang: own ? u.price_satang : null });
    if (it.price_satang !== null) { const lp = listPriceOf(it, cat, F.purchase_type); if (lp !== null && lp !== it.price_satang) it.price_reason = "ราคาเก่าที่ตกลงไว้"; }
    const blankIdx = F.items.findIndex(x => !x.type && !x.id);
    if (blankIdx >= 0) F.items.splice(blankIdx, 1, it); else F.items.push(it);
    drawLines(); dirty();
    ui.toast("ใส่ " + labelOf(it) + " แล้ว — เช็คจำนวนอีกที");
  }
  // ── สินค้า ──
  const linesBox = h("div.stack");
  let lineEls = [];
  function drawLines() {
    lineEls = F.items.map((it, i) => specLine(ctx, cat, it, { n: i + 1, purchaseType: () => F.purchase_type, lockSpec: it._lock || (editing && !F.canItems ? F.editWhy : ""), minQty: it._min,
      onChange: () => dirty(), onRemove: F.items.length > 1 || !it.type ? () => { F.items.splice(i, 1); if (!F.items.length) F.items.push(newItem()); drawLines(); dirty(); } : null }));
    put(linesBox, ...lineEls);
  }
  const addBtn = h("button.btn", { type: "button", onclick: () => { F.items.push(newItem()); drawLines(); dirty(); lineEls[lineEls.length - 1].guide(); } }, icon("plus", "sm"), "เพิ่มสินค้า");
  // ── ต้องการเมื่อไร · นัดส่ง · งวดส่ง · ด่วน · รอยืนยัน (เลิกตั้งวันส่ง +10 วันเอง — ไม่เลือก = จอง) ──
  const urgent = h("button.chip", { type: "button", "aria-pressed": String(!!F.urgent), onclick: e => { F.urgent = F.urgent ? 0 : 1; e.currentTarget.setAttribute("aria-pressed", String(!!F.urgent)); dirty(); } }, icon("bolt", "sm"), " ด่วน");
  const mainItem = () => { const it = F.items.find(i => i.type); if (!it) return null; const c = calcLine(it, cat); return { qty: c.qty, per: c.per, unit: c.unit, label: labelOf(it) }; };
  const planEl = editing ? null : planPicker(F.plan, { main: mainItem, today: todayTh(), onChange: () => { F.due_day = F.plan.first_day; dirty(); }, extraChips: urgent });
  const holdBtn = h("button.chip.holdsw", { type: "button", "aria-pressed": String(!!F.hold), onclick: e => { F.hold = F.hold ? 0 : 1; e.currentTarget.setAttribute("aria-pressed", String(!!F.hold)); dirty(); } }, icon("clock", "sm"), " รอยืนยัน — ยังไม่ส่งเข้าคิวผลิต");
  // ── การซื้อ · ตัวเลือกเพิ่มเติม ──
  const vals = k => ((ctx.vocab["orders." + k] || []).filter(v => v.value).map(v => [v.value, v.label]));
  const purchase = seg(vals("purchase_type").length ? vals("purchase_type") : [["ขายราคาโรงงาน", "ขายราคาโรงงาน"], ["ขายหน้าร้าน", "ขายหน้าร้าน"]], F.purchase_type, v => { F.purchase_type = v; lineEls.forEach(l => l.refresh()); dirty(); }, { label: "ประเภทการซื้อ" });
  const priceMode = seg(vals("price_mode").length ? vals("price_mode") : [["มาตรฐาน", "มาตรฐาน"], ["พิเศษ", "พิเศษ"]], F.price_mode, v => { F.price_mode = v; dirty(); }, { label: "ราคา" });
  const pay = seg(vals("pay_status"), F.pay_status, v => { F.pay_status = v; dirty(); }, { label: "สถานะเงิน", allowNone: true });
  const design = seg(vals("design_status"), F.design_status, v => { F.design_status = v; dirty(); }, { label: "สถานะแบบ", allowNone: true });
  const blockBtn = h("button.qbtn", { type: "button", onclick: async () => {
    const v = await ui.numpadSheet({ title: "ค่าบล็อกสกรีน (บาท)", unit: "บาท", value: F.block_fee_satang ? F.block_fee_satang / 100 : "" });
    if (v === undefined) return;
    F.block_fee_satang = v === null ? null : v * 100; paintBlock(); dirty();
  } }, h("small", "ค่าบล็อก (บาท)"), h("b"));
  const paintBlock = () => { blockBtn.querySelector("b").textContent = F.block_fee_satang ? "฿" + baht(F.block_fee_satang) : "ไม่มี"; };
  paintBlock();
  const noteIn = h("textarea", { maxlength: 500, placeholder: "นัดรับของ · สเปกพิเศษ · อื่น ๆ", "aria-label": "หมายเหตุ", oninput: e => { F.note = e.target.value; dirty(); } }, F.note || "");
  const moreSum = h("span.small.muted");
  const paintMore = () => { moreSum.textContent = [F.pay_status, F.design_status, F.block_fee_satang ? "ค่าบล็อก ฿" + baht(F.block_fee_satang) : "", F.note ? "มีหมายเหตุ" : ""].filter(Boolean).join(" · "); };
  const more = h("details.more.card", { open: F.pay_status || F.design_status || F.block_fee_satang || F.note ? true : null },
    h("summary.row", icon("chev", "sm"), h("b", "ตัวเลือกเพิ่มเติม"), moreSum),
    h("div.lbl", "สถานะเงิน"), pay, h("div.lbl", "สถานะแบบ (งานสกรีน)"), design, h("div.qrow", blockBtn), h("label.field", h("span.lbl", "หมายเหตุ"), noteIn));
  // ── แถบรวม + บันทึก ──
  const sum = h("div.sb-sum");
  const err = h("p.err", { role: "alert" });
  function paintSum() {
    paintMore();
    if (planEl) planEl.refresh();
    const ok = F.items.filter(i => i.type && calcLine(i, cat).qty > 0);
    const pcs = ok.reduce((s, i) => s + calcLine(i, cat).qty, 0);
    const money = ok.length && ok.every(i => i.price_satang !== null && i.price_satang !== undefined) ? ok.reduce((s, i) => s + calcLine(i, cat).qty * i.price_satang, 0) : null;
    const units = [...new Set(ok.map(i => calcLine(i, cat).unit))];
    put(sum, h("b", ok.length ? "รวม " + n0(pcs) + " " + (units.length === 1 ? units[0] : "ใบ/ชิ้น") : "ยังไม่มีสินค้า"), h("small", ok.length + " รายการ" + (money !== null ? " · ฿" + baht(money) : " · ยังไม่ใส่ราคาครบ") + (F.customer ? " · " + F.customer.name : "")));
  }
  const saveBtn = h("button.btn.pri", { type: "button", onclick: () => review() }, editing ? "บันทึกการแก้ไข" : "บันทึก");
  const resetBtn = editing ? h("button.btn.ghost", { type: "button", onclick: () => { history.back(); } }, "เลิกแก้") : h("button.btn.ghost", { type: "button", onclick: e => {
    const b = e.currentTarget;
    if (!b.dataset.arm) { b.dataset.arm = "1"; b.textContent = "แตะอีกครั้งเพื่อล้าง"; setTimeout(() => { delete b.dataset.arm; b.textContent = "ล้างฟอร์ม"; }, 3000); return; }
    F = blank(); F.items.push(newItem()); ctx.api.store.set(DRAFT, null); render(ctx, view, cat, customers);
  } }, "ล้างฟอร์ม");
  const bar = h("div.savebar", h("div.grow", sum, err), saveBtn);

  /** ตรวจฟอร์ม → payload (หรือบอกว่าขาดอะไร) */
  async function collect() {
    err.textContent = "";
    if (!(await picker.resolve())) { err.textContent = "เลือกลูกค้าก่อน (พิมพ์ชื่อแล้วแตะจากรายการ หรือเพิ่มลูกค้าใหม่)"; picker.focus(); return null; }
    F.customer = picker.get();
    const its = F.items.filter(i => i.type || i.id);
    if (!its.length) { err.textContent = "เลือกสินค้าอย่างน้อย 1 รายการ"; return null; }
    for (let k = 0; k < its.length; k++) {
      const it = its[k], c = calcLine(it, cat);
      if (!it.type) { err.textContent = "รายการที่ " + (k + 1) + ": เลือกประเภท"; return null; }
      if (c.t && c.t.axes.includes("ขนาด") && c.t.sizes.length && !it.size) { err.textContent = "รายการที่ " + (k + 1) + " (" + it.type + "): เลือกขนาด"; return null; }
      if (!c.qty) { err.textContent = "รายการที่ " + (k + 1) + " (" + labelOf(it) + "): ใส่จำนวน"; return null; }
    }
    const items = its.map(i => ({ ...(i.id ? { id: i.id } : {}), type: i.type, size: i.size, neck: i.neck, shape: i.shape, color: i.color, screen_color: i.screen_color, cap_color: i.cap_color,
      bags: i.bags || 0, extra_pcs: i.extra_pcs || 0, qty_pcs: calcLine(i, cat).qty, price_satang: i.price_satang === undefined ? null : i.price_satang, price_reason: i.price_reason || "" }));
    if (!editing && F.plan.mode === "กำหนดจำนวน" && !F.plan.each && !F.plan.times) { err.textContent = "งวดแบบกำหนดจำนวน: ใส่ \"ต่อครั้ง\" หรือ \"กี่ครั้ง\""; return null; }
    const head = { brand: F.brand.trim(), urgent: F.urgent ? 1 : 0, purchase_type: F.purchase_type, price_mode: F.price_mode, pay_status: F.pay_status, design_status: F.design_status,
      block_fee_satang: F.block_fee_satang, note: F.note.trim(), items };
    if (!editing) Object.assign(head, { plan: planPayload(F.plan, mainItem()), want_when: F.plan.want_when, want_day: F.plan.want_day, hold: F.hold ? 1 : 0 });   // แก้ไข = ไม่ส่งวันส่ง (เลื่อนที่งวดส่ง พร้อมสาเหตุ)
    if (F.customer.isNew) head.new_customer = { name: F.customer.name, district: F.customer.district, phone: F.customer.phone, route_code: F.customer.route_code };
    else head.customer_id = F.customer.id;
    return head;
  }
  async function review() {
    const p = await collect();
    if (!p) return;
    const c = F.customer;
    const hold = p.pay_status === "รอโอนเงิน" || p.design_status === "รอแบบ" || p.design_status === "แก้ไขแบบ" || !!p.hold;
    let queue = !editing && !hold;
    const S = ui.sheet({ title: editing ? "ตรวจการแก้ไขก่อนบันทึก" : "ตรวจอีกครั้งก่อนบันทึก", modal: true, foot: true });
    const qToggle = editing ? null : h("button.chip", { type: "button", "aria-pressed": String(queue), disabled: p.hold ? true : null, onclick: e => { queue = !queue; e.currentTarget.setAttribute("aria-pressed", String(queue)); } }, "ส่งเข้าคิวผลิตเลย");
    const rows = p.items.map(it => { const x = { ...it, piece_unit: calcLine(it, cat).unit, per_bag: calcLine(it, cat).per }; return h("div.icard", h("div.row", h("b.grow", labelOf(it)), itemBadge(x)),
      h("div.small.muted", [it.screen_color ? "สกรีน" + it.screen_color : "", it.cap_color ? "ฝา" + it.cap_color : "", it.price_satang !== null ? "฿" + baht(it.price_satang) + "/" + x.piece_unit : "ไม่ใส่ราคา"].filter(Boolean).join(" · "))); });
    add(S.body, h("div.dhead", h("b.name", c.name), h("span.small.muted", c.isNew ? "ลูกค้าใหม่ · " + ([c.district ? "อ." + c.district : "", c.phone].filter(Boolean).join(" · ") || "ยังไม่ระบุอำเภอ") : custTag(c))),
      c.note ? h("div.cust-note", icon("alert", "sm"), h("span", "หมายเหตุการค้า: " + c.note)) : null, ...rows,
      h("dl.kv2", editing ? null : [h("dt", "นัดส่ง"), h("dd", planWords(F.plan, mainItem()) + (p.urgent ? " · ด่วน" : ""))], editing && p.urgent ? [h("dt", "ด่วน"), h("dd", "ด่วน")] : null,
        wantWords(F.plan) && !editing ? [h("dt", "ต้องการ"), h("dd", wantWords(F.plan).replace("ลูกค้าต้องการ ", ""))] : null, h("dt", "ประเภท"), h("dd", [p.purchase_type, p.price_mode ? "ราคา" + p.price_mode : ""].filter(Boolean).join(" · ")),
        p.brand ? [h("dt", "งาน"), h("dd", p.brand)] : null, p.pay_status ? [h("dt", "เงิน"), h("dd", p.pay_status)] : null, p.design_status ? [h("dt", "แบบ"), h("dd", p.design_status)] : null,
        p.block_fee_satang ? [h("dt", "ค่าบล็อก"), h("dd", "฿" + baht(p.block_fee_satang))] : null, p.note ? [h("dt", "หมายเหตุ"), h("dd", p.note)] : null),
      qToggle ? h("div", qToggle, h("p.hint", p.hold ? "รอยืนยัน — ยังไม่ส่งเข้าคิว (ลูกค้ายืนยันแล้วกด \"ส่งเข้าคิวผลิต\" ในหน้ารายละเอียด)" : hold ? "รอโอนเงิน/รอแบบ — ตั้งให้ยังไม่ส่งเข้าคิว (ส่งทีหลังจากหน้ารายละเอียด)" : "ปิด = ลงไว้ก่อน ยังไม่ให้ทีมผลิตเห็น")) : null);
    const okBtn = h("button.btn.pri", { type: "button" }, editing ? "ยืนยันบันทึกการแก้ไข" : "ยืนยันบันทึก");
    add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("back") }, "กลับไปแก้"), okBtn));
    okBtn.addEventListener("click", () => ui.busy(okBtn, async () => {
      const input = editing ? { id: F.id, version: F.version, ...p } : { ...p, queue };
      const r = await write(ctx, editing ? "office.order_update" : "office.order_create", input, { label: (editing ? "แก้ออเดอร์ " : "ลงออเดอร์ ") + c.name, noUndoBar: true });
      if (!r) return;
      forget("office.customers");
      const savedId = editing ? F.id : r.data.id;
      const text = orderText({ ...p, due_day: editing ? F.due_day : F.plan.first_day, plan_text: editing ? "" : planWords(F.plan, mainItem()), customer: c.name, tag: c.isNew ? (c.district ? "อ." + c.district : "") : custTag(c), order_day: todayTh(), by: ctx.me && ctx.me.staff ? ctx.me.staff.nick : "",
        items: p.items.map(it => ({ ...it, label: labelOf(it), piece_unit: calcLine(it, cat).unit, per_bag: calcLine(it, cat).per })) });
      // การ์ดเดิมกลายเป็น "บันทึกแล้ว" + ใบสั่งข้อความ + แชร์ไลน์ (ฟอร์มข้างหลังล้างรอใบถัดไป)
      S.title = editing ? "แก้ไขแล้ว" : "บันทึกแล้ว";
      put(S.body, h("div.banner.t-ok", icon("check-circle"), h("span", (editing ? "แก้ไขแล้ว · " : "บันทึกแล้ว · ") + c.name + (r.data.queued ? " · ส่งเข้าคิวผลิตแล้ว" : !editing ? " · ยังไม่ส่งเข้าคิว" : ""))),
        h("pre.slip", text));
      put(S.foot, h("div.acts", h("button.btn.pri", { type: "button", onclick: () => shareText(text) }, icon("share", "sm"), "แชร์ไลน์"),
        h("button.btn", { type: "button", onclick: () => { S.close("ok"); ctx.go("orders/" + savedId); } }, "ดูรายละเอียด"),
        editing ? null : h("button.btn", { type: "button", onclick: () => S.close("next") }, icon("plus", "sm"), "ลงใบต่อไป"),
        r.undo ? h("button.btn.ghost", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
          try { await ctx.api.write("undo.run", { id: r.undo.id }); ui.toast("ย้อนแล้ว — " + r.undo.label); S.close("undo"); }
          catch (err) { ui.toast(err.message, "bad"); }
        }) }, icon("undo", "sm"), editing ? "ย้อนการแก้ไข" : "ย้อน (ไม่เอาใบนี้)") : null));
      view.dataset.formDirty = "";
      ctx.api.store.set(DRAFT, null);
      const was = F;
      F = blank(); F.items.push(newItem());
      // ปิดการ์ด = ฟอร์มใหม่ (โหลดทะเบียนลูกค้าใหม่ — ลูกค้าที่เพิ่งเพิ่มต้องเลือกได้ใบถัดไป) · แก้ไขเสร็จ = กลับหน้าก่อน
      S.done.then(why => { if (editing) { if (why !== "ok") history.back(); } else if (why !== "ok") ctx.refresh(); });
      void was;
    }));
  }

  const main = h("div.stack.of-main",
    editing ? h("div.banner.t-brand", icon("edit"), h("span", "กำลังแก้ออเดอร์ · " + (F.customer ? F.customer.name : "") + (F.editWhy ? " — " + F.editWhy : ""))) : null,
    h("section.card", h("div.lbl", "ลูกค้า"), picker, h("label.field", h("span.lbl", "ชื่องาน/แบรนด์"), brandIn)),
    h("div.of-usual-m"),
    h("section.card", h("div.row", h("div.lbl.grow", "สินค้า")), linesBox, addBtn),
    editing ? h("section.card", h("div.row", h("div.lbl.grow", "วันส่ง"), h("span.muted", F.due_day ? thDayLong(F.due_day) : "ยังไม่นัด")), h("p.hint", "นัด/เลื่อนวันส่งและงวดส่ง ทำที่หน้ารายละเอียดออเดอร์ (ต้องเลือกสาเหตุ)"), h("div.chips", urgent))
      : h("section.card", planEl, h("div.chips", holdBtn)),
    h("section.card", h("div.lbl", "ประเภทการซื้อ"), purchase, h("div.lbl", "ราคา"), priceMode),
    more, h("div.row", h("span.grow"), resetBtn), bar);
  const aside = h("div.stack.of-aside");
  const place = () => { const wide = window.matchMedia("(min-width: 1100px)").matches; (wide ? aside : main.querySelector(".of-usual-m")).append(usualCard); };
  put(view, h("div.oform", main, aside));
  place();
  window.addEventListener("resize", place);
  drawLines(); paintSum(); loadUsual();
  if (!F.customer && !editing && window.matchMedia("(min-width: 1100px)").matches) setTimeout(() => picker.focus(), 50);   // มือถือไม่เด้งคีย์บอร์ดเอง
}
