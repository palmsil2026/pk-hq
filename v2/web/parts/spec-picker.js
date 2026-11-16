// ═══════════════════════════════════════════════════════════════════════
//  ตัวเลือกสเปกสินค้า — 1 รายการ = ชิปต่อแกน (เรียกซ้ำได้: ลงออเดอร์ · งานผลิตเข้าสต๊อก · รับของเข้า)        v2/web/parts/spec-picker.js
//  PALM-WAY §3 §8: ปุ่ม/ชิปเห็นทุกตัวเลือก (ไม่ใช่ dropdown) · โชว์เฉพาะแกนที่ประเภทนั้นใช้จริง (ฟิล์มไม่มีคอขวด)
//    นับเป็นถุง → ถุง × ใบต่อถุง + เศษใบ (แป้นตัวเลขของแอป) · ขั้นต่ำ = เตือนไม่บล็อก · รายการให้แตะมี "อื่น ๆ (พิมพ์เอง)" เสมอ
//    รายการใหม่ = ไล่ถามทีละแกนให้เอง (ประเภท → ขนาด → … → จำนวน)
//  cat = ผลจาก office.form { types[{code, axes[], count_unit, piece_unit, sizes[{size, per_bag, min}]}], values{แกน:[{value}]}, prices[], products[] }
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, baht, pricePad } from "./kit.js";
const { h, icon } = ui;

export const AXES = [["ขนาด", "size"], ["คอขวด", "neck"], ["รูปทรง", "shape"], ["สี", "color"], ["สีสกรีน", "screen_color"], ["พร้อมฝาสี", "cap_color"]];
const SOFT = { "สีสกรีน": "ไม่สกรีน", "พร้อมฝาสี": "ไม่มีฝา" };
const PRICE_KIND = { "ขายราคาโรงงาน": "ราคาโรงงาน", "ขายหน้าร้าน": "ราคาหน้าร้าน" };
const norm = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().replace(/\|/g, "/");

/** กุญแจสเปก (ตรงกับ server/core.mjs › specKey) */
export function specKeyOf(it, type) {
  const use = type ? type.axes : null;
  return [norm(it.type), ...["size", "neck", "shape", "color"].map((f, i) => (!use || use.indexOf(["ขนาด", "คอขวด", "รูปทรง", "สี"][i]) >= 0 ? norm(it[f]) : ""))].join("|");
}
export const labelOf = it => [it.type, it.size, it.neck, it.shape, it.color].map(v => String(v || "").trim()).filter(Boolean).join(" ");
/** จำนวนใบ/ชิ้นที่คิดแล้ว + ข้อมูลประกอบ */
export function calcLine(it, cat) {
  const t = (cat.types || []).find(x => x.code === it.type);
  const sz = t && t.sizes.find(s => s.size === it.size);
  const per = t && t.count_unit === "ถุง" && sz ? sz.per_bag : 0;
  const qty = per ? (Number(it.bags) || 0) * per + (Number(it.extra_pcs) || 0) : Number(it.qty_pcs) || 0;
  return { t, per, qty, min: sz ? sz.min : 0, unit: t ? t.piece_unit : "ชิ้น" };
}
/** ราคาตั้งของประธาน (ตามประเภทการซื้อ) — null = ไม่มี */
export function listPriceOf(it, cat, purchaseType) {
  const kind = PRICE_KIND[purchaseType];
  if (!kind || !it.type) return null;
  const t = (cat.types || []).find(x => x.code === it.type);
  const key = "spec:" + specKeyOf(it, t);
  const prod = (cat.products || []).find(p => "spec:" + p.spec_key === key);
  const p = (cat.prices || []).find(x => x.kind === kind && (x.item_key === key || (prod && x.item_key === "sku:" + prod.id)));
  return p ? p.price_satang : null;
}

/** แผ่นเลือกค่าของแกน (ปุ่มใหญ่ · หลายสีได้สำหรับสีสกรีน · อื่น ๆ พิมพ์เอง) → ค่า | undefined (ปิด) */
export function axisSheet(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let result;
    const S = ui.sheet({ title: o.title, modal: true, onClose: () => resolve(result) });
    if (o.step) add(S.body, h("span.step", o.step));
    const multi = !!o.multi;
    let picked = multi ? String(o.value || "").split(/\s*\+\s*/).filter(Boolean) : [];
    const grid = h("div.axgrid", { role: "group", "aria-label": o.title });
    const other = h("input", { type: "text", maxlength: 60, placeholder: "พิมพ์ " + o.title, "aria-label": o.title + " (พิมพ์เอง)", hidden: true });
    const done = v => { result = v; S.close("ok"); };
    const vals = o.values || [];
    if (o.soft) add(grid, h("button.soft", { type: "button", "aria-pressed": String(!o.value), onclick: () => done("") }, o.soft));
    vals.forEach(v => add(grid, h("button", { type: "button", "aria-pressed": String(multi ? picked.includes(v.value) : v.value === o.value), onclick: e => {
      if (!multi) return done(v.value);
      picked = picked.includes(v.value) ? picked.filter(x => x !== v.value) : [...picked, v.value];
      e.currentTarget.setAttribute("aria-pressed", String(picked.includes(v.value)));
      okBtn.textContent = picked.length ? "ใช้ " + picked.length + " สี" : "ไม่สกรีน";
    } }, v.value, v.hint ? h("small", v.hint) : null)));
    add(grid, h("button.soft", { type: "button", onclick: () => { other.hidden = false; other.focus(); } }, "อื่น ๆ (พิมพ์เอง)"));
    const okBtn = h("button.btn.pri.block", { type: "button", onclick: () => {
      const typed = other.value.trim();
      if (multi) done([...picked, ...(typed ? [typed] : [])].join(" + "));
      else if (typed) done(typed);
    } }, multi ? (picked.length ? "ใช้ " + picked.length + " สี" : "ไม่สกรีน") : "ใช้ค่าที่พิมพ์");
    other.addEventListener("keydown", e => { if (e.key === "Enter") okBtn.click(); });
    other.addEventListener("input", () => { if (!multi) okBtn.hidden = !other.value.trim(); });
    if (!multi) okBtn.hidden = true;
    add(S.body, grid, other, okBtn);
    if (o.skipText) add(S.body, h("button.btn.ghost", { type: "button", onclick: () => done(o.value || "") }, o.skipText));
  });
}

/**
 * specLine(ctx, cat, item, { purchaseType(), onChange(item), onRemove(), guide, lockSpec, minQty, n })
 *   item ถูกแก้ในที่ (mutable) · คืน element (.item · .guide() · .refresh())
 */
export function specLine(ctx, cat, item, opt) {
  const o = opt || {};
  const el = h("section.line", { "aria-label": "รายการสินค้า" });
  const it = item;
  const typeObj = () => (cat.types || []).find(x => x.code === it.type);
  const axesOf = () => { const t = typeObj(); return t ? AXES.filter(([a]) => t.axes.indexOf(a) >= 0) : []; };
  const valuesOf = axis => {
    const t = typeObj();
    if (axis === "ขนาด") return t ? t.sizes.map(s => ({ value: s.size, hint: s.per_bag && t.count_unit === "ถุง" ? s.per_bag + " ใบ/ถุง" : "" })) : [];
    return ((cat.values || {})[axis] || []).map(v => ({ value: v.value, hint: v.grade === "B" ? "เกรด B" : "" }));
  };
  const changed = () => { draw(); if (o.onChange) o.onChange(it); };

  async function pickType(step) {
    const v = await axisSheet({ title: "ประเภทสินค้า", step, values: (cat.types || []).map(t => ({ value: t.code, hint: t.count_unit === "ถุง" ? "นับเป็นถุง" : "นับเป็นชิ้น" })), value: it.type });
    if (v === undefined) return false;
    if (v !== it.type) {   // เปลี่ยนประเภท = ล้างแกนเดิม (ฟิล์มไม่ติดคอขวดของขวดไปด้วย)
      it.type = v;
      AXES.forEach(([, f]) => { it[f] = ""; });
      it.bags = 0; it.extra_pcs = 0; it.qty_pcs = 0; it.price_satang = null; it.price_reason = "";
    }
    changed();
    return true;
  }
  async function pickAxis(axis, step) {
    const f = AXES.find(a => a[0] === axis)[1];
    const v = await axisSheet({ title: axis, step, values: valuesOf(axis), value: it[f], soft: SOFT[axis], multi: axis === "สีสกรีน" });
    if (v === undefined) return false;
    it[f] = v;
    if (axis === "ขนาด") { it.price_satang = it.price_satang; }
    changed();
    return true;
  }
  async function pickQty(which) {
    const c = calcLine(it, cat);
    if (c.per && which !== "extra") {
      const v = await ui.numpadSheet({ title: "จำนวนถุง · " + (labelOf(it) || it.type), label: c.per + " ใบ/ถุง", unit: "ถุง", value: it.bags || "", okText: "ตกลง" });
      if (v === null || v === undefined) return false;
      it.bags = v; changed();
      return true;
    }
    if (c.per) {
      const v = await ui.numpadSheet({ title: "เศษ (" + c.unit + ")", label: "นอกจากถุง", unit: c.unit, value: it.extra_pcs || "" });
      if (v === null || v === undefined) return false;
      it.extra_pcs = v; changed();
      return true;
    }
    const v = await ui.numpadSheet({ title: "จำนวน (" + c.unit + ") · " + (labelOf(it) || it.type), unit: c.unit, value: it.qty_pcs || "" });
    if (v === null || v === undefined) return false;
    it.qty_pcs = v; changed();
    return true;
  }
  async function pickPrice() {
    const c = calcLine(it, cat);
    const lp = listPriceOf(it, cat, o.purchaseType ? o.purchaseType() : "");
    const v = await pricePad({ title: "ราคาต่อ" + c.unit + " · " + (labelOf(it) || it.type), unit: c.unit, value: it.price_satang, list: lp });
    if (v === undefined) return;
    if (v !== null && lp !== null && v !== lp) {
      const r = await ui.confirmSheet({ title: "ราคาไม่ตรงราคาตั้ง", detail: "ลง ฿" + baht(v) + " · ราคาตั้ง ฿" + baht(lp) + " ต่อ" + c.unit + " — ระบบจะแจ้งประธานให้เห็น (ไม่บล็อก)",
        reasons: ctx.reasons("price"), need: "required", okText: "ใช้ราคานี้" });
      if (!r) return;
      it.price_reason = r.reason;
    } else it.price_reason = "";
    it.price_satang = v;
    changed();
  }
  /** ไล่ถามทีละแกน: ประเภท → แกนที่ยังว่าง → จำนวน */
  async function guide() {
    const total = () => 1 + axesOf().length + 1;   // ประเภท + แกนของประเภทนั้น + จำนวน (รู้จำนวนขั้นหลังเลือกประเภท)
    if (!it.type && !(await pickType("ขั้น 1 · เลือกประเภทก่อน"))) return;
    const axes = axesOf();
    for (let i = 0; i < axes.length; i++) {
      const [axis, f] = axes[i];
      if (it[f]) continue;
      if (axis === "ขนาด" && !valuesOf(axis).length) continue;
      if (!(await pickAxis(axis, "ขั้น " + (i + 2) + "/" + total()))) return;
    }
    if (!calcLine(it, cat).qty) await pickQty("bags");
  }

  function draw() {
    const t = typeObj(), c = calcLine(it, cat);
    const lp = listPriceOf(it, cat, o.purchaseType ? o.purchaseType() : "");
    const locked = o.lockSpec;
    const head = h("div.lhead", h("b", labelOf(it) || "สินค้ารายการใหม่ — แตะ \"ประเภท\""),
      o.onRemove ? h("button.iconbtn", { type: "button", "aria-label": "เอารายการนี้ออก", onclick: () => o.onRemove() }, icon("close")) : null);
    const ax = (label, value, onClick, cls) => h("button.ax" + (cls || ""), { type: "button", disabled: locked ? true : null, onclick: onClick }, h("small", label), h("span", value));
    const axes = h("div.axes",
      ax("ประเภท", it.type || "เลือก", () => pickType().then(ok => { if (ok && !locked) guide(); }), it.type ? "" : ".unset"),
      ...(t ? axesOf().map(([axis, f]) => ax(axis, it[f] || SOFT[axis] || "เลือก", () => pickAxis(axis), it[f] ? "" : SOFT[axis] ? ".soft" : ".unset")) : []));
    const qbtn = (label, value, unset, onClick) => h("button.qbtn" + (unset ? ".unset" : ""), { type: "button", onclick: onClick }, h("small", label), h("b", value));
    const qrow = h("div.qrow");
    if (t) {
      if (c.per) add(qrow, qbtn("จำนวนถุง (" + c.per + " ใบ/ถุง)", it.bags ? n0(it.bags) + " ถุง" : "ใส่จำนวน", !it.bags && !it.extra_pcs, () => pickQty("bags")),
        qbtn("เศษ (" + c.unit + ")", it.extra_pcs ? n0(it.extra_pcs) : "—", false, () => pickQty("extra")));
      else add(qrow, qbtn("จำนวน (" + c.unit + ")", it.qty_pcs ? n0(it.qty_pcs) : "ใส่จำนวน", !it.qty_pcs, () => pickQty()));
      add(qrow, qbtn("ราคา/" + c.unit + (lp !== null ? " (ตั้ง ฿" + baht(lp) + ")" : ""), it.price_satang === null || it.price_satang === undefined ? "ไม่ใส่" : "฿" + baht(it.price_satang), false, pickPrice));
    }
    const notes = [];
    if (t && c.qty) notes.push(h("div.qsum", c.per && it.bags ? n0(it.bags) + " ถุง × " + c.per + (it.extra_pcs ? " + " + n0(it.extra_pcs) : "") + " = " : "", h("b", n0(c.qty) + " " + c.unit),
      it.price_satang ? " · ฿" + baht(it.price_satang * c.qty) : ""));
    if (t && c.min && c.qty && c.qty < c.min) notes.push(h("div.warnline", icon("alert", "sm"), h("span", "ต่ำกว่าขั้นต่ำ " + n0(c.min) + " " + c.unit + " — ลงต่อได้ (ระบบแจ้งให้เห็นเฉย ๆ)")));
    if (o.minQty && c.qty < o.minQty) notes.push(h("div.warnline", icon("alert", "sm"), h("span", "ส่ง/ขึ้นรถไปแล้ว " + n0(o.minQty) + " " + c.unit + " — ลดต่ำกว่านี้ไม่ได้")));
    if (it.price_reason) notes.push(h("div.hint", "เหตุผลราคา: " + it.price_reason));
    if (locked) notes.push(h("div.hint", icon("lock", "sm"), " " + locked));
    el.classList.toggle("empty", !it.type);
    put(el, head, axes, t ? qrow : null, ...notes);
  }
  draw();
  el.item = it;
  el.guide = guide;
  el.refresh = draw;
  el.calc = () => calcLine(it, cat);
  if (o.guide) setTimeout(guide, 30);
  return el;
}
