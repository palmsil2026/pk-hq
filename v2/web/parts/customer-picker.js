// ═══════════════════════════════════════════════════════════════════════
//  ตัวเลือกลูกค้า — พิมพ์แล้วเด้งแนะนำ (เรียกซ้ำได้ทุกบทบาท)                                   v2/web/parts/customer-picker.js
//  PALM-WAY §5 "ลูกค้าต้องไม่เพี้ยน": จับคู่ชื่อหลวม (ไม่สนช่องว่าง/วงเล็บ) · พิมพ์ชื่ออำเภอก็เจอ · โชว์สาย/อำเภอกันเลือกผิดคน
//    คนที่ค้างส่ง/ค้างเงินขึ้นก่อน แล้วตามด้วยคนที่สั่งล่าสุด · ชื่อใหม่ต้องผ่านแผ่น "ลูกค้าใหม่" (เตือนชื่อคล้าย · แยกชื่องานออก)
//  customers = แถวจาก office.customers { id, name, route_code, district, note, open_n, owe_n, overdue_n, last_day, needs_review }
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, nameKey, lev, thDayLong } from "./kit.js";
const { h, icon } = ui;

const tagOf = c => [c.route_code ? "สาย " + c.route_code : "", c.district ? "อ." + c.district : ""].filter(Boolean).join(" · ");
export const custTag = tagOf;
export function custPills(c) {
  return [c.open_n ? ui.pill("ค้างส่ง " + c.open_n, "brand", "truck") : null, c.overdue_n ? ui.pill("เลยกำหนดชำระ " + c.overdue_n, "bad", "alert") : c.owe_n ? ui.pill("ค้างเงิน " + c.owe_n, "warn", "coin") : null,
    c.needs_review ? ui.pill("รอตรวจชื่อ", "warn", "flag") : null, c.status && c.status !== "ใช้งาน" ? ui.pill(c.status, "mute") : null].filter(Boolean);
}
const score = c => (c.open_n > 0 ? 4 : 0) + (c.owe_n > 0 ? 2 : 0);

/** ค้นแบบหลวม — ขึ้นต้นตรงก่อน · ค้างส่ง/ค้างเงินก่อน · สั่งล่าสุดก่อน */
export function findCustomers(customers, q, limit) {
  const k = nameKey(q);
  const hit = (customers || []).filter(c => !k || nameKey(c.name).includes(k) || (c.district && nameKey(c.district).includes(k)) || (c.route_code && c.route_code === q.trim()));
  hit.sort((a, b) => (k ? (nameKey(a.name).indexOf(k) === 0 ? 0 : 1) - (nameKey(b.name).indexOf(k) === 0 ? 0 : 1) : 0) || score(b) - score(a) || String(b.last_day || "").localeCompare(String(a.last_day || "")) || a.name.localeCompare(b.name, "th"));
  return hit.slice(0, limit || 10);
}
/** ชื่อคล้ายในทะเบียน (ก่อนเพิ่มลูกค้าใหม่) */
export function similarCustomers(customers, name) {
  const q = nameKey(name);
  if (q.length < 2) return [];
  return (customers || []).filter(c => { const k = nameKey(c.name); return k === q || (q.length >= 3 && (k.includes(q) || q.includes(k))) || (q.length >= 4 && lev(k, q) <= 2); }).slice(0, 5);
}
/** "ช้างทิพย์ ลี้ งานช้างทิพย์" → ["ช้างทิพย์ ลี้", "ช้างทิพย์"] */
export const splitBrand = name => { const m = /^(.+?)\s*งาน\s*(\S.*)$/.exec(String(name || "").trim()); return m && m[1].trim().length >= 2 ? [m[1].trim(), m[2].trim()] : null; };

/**
 * customerPicker(ctx, { customers, value, onPick(c), onNew(nc, brand), districts, routes, placeholder })
 *   คืน element (.set(c) · .focus() · .setCustomers(list))
 */
export function customerPicker(ctx, opt) {
  const o = opt || {};
  let list = o.customers || [], cur = o.value || null, hi = -1, items = [];
  const input = h("input", { type: "text", autocomplete: "off", "aria-label": "ลูกค้า", placeholder: o.placeholder || "พิมพ์ชื่อร้าน หรืออำเภอ", role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list" });
  const sugg = h("div.sugg", { role: "listbox", hidden: true });
  const tag = h("div.cust-tag");
  const box = h("div.cpick", h("div.inp", icon("search", "sm"), input,
    h("button.iconbtn", { type: "button", "aria-label": "ล้างลูกค้า", hidden: true, onclick: () => { input.value = ""; pick(null); input.focus(); render(true); } }, icon("close", "sm"))), sugg, tag);
  const clearBtn = box.querySelector(".inp .iconbtn");
  const paint = () => {
    clearBtn.hidden = !input.value;
    put(tag);
    if (!cur) return;
    if (cur.isNew) tag.append(ui.pill("ลูกค้าใหม่", "brand", "plus"), h("span", [cur.district ? "อ." + cur.district : "ยังไม่ระบุอำเภอ", cur.phone].filter(Boolean).join(" · ")),
      h("button.btn.ghost", { type: "button", onclick: () => openNew(cur.name) }, "แก้"));
    else tag.append(ui.pill("ทะเบียน", "ok", "check"), h("span", tagOf(cur) || "ยังไม่มีสาย/อำเภอ"), ...custPills(cur));
    if (cur.note) tag.append(h("div.cust-note", { style: { flexBasis: "100%" } }, icon("alert", "sm"), h("span", "หมายเหตุการค้า: " + cur.note)));
  };
  const pick = c => { cur = c; if (c) input.value = c.name; paint(); if (o.onPick) o.onPick(c); };
  const render = show => {
    const q = input.value.trim();
    items = findCustomers(list, q, q ? 12 : 8).map(c => ({ c }));
    if (q && !list.some(c => nameKey(c.name) === nameKey(q))) items.push({ isNew: true, name: q });
    if (!show || !items.length) { sugg.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
    put(sugg, ...items.map((it, i) => it.isNew
      ? h("button.new" + (i === hi ? ".hi" : ""), { type: "button", role: "option", onclick: () => openNew(it.name) }, h("b", "+ ลูกค้าใหม่ \"" + it.name + "\""), h("small", "ยังไม่มีในทะเบียน — แตะเพื่อเพิ่ม (เช็คชื่อคล้ายให้)"))
      : h("button" + (i === hi ? ".hi" : ""), { type: "button", role: "option", onclick: () => { sugg.hidden = true; pick(it.c); } },
        h("b", it.c.name), h("small", [tagOf(it.c), it.c.last_day ? "สั่งล่าสุด " + thDayLong(it.c.last_day) : "ยังไม่เคยสั่ง"].filter(Boolean).join(" · ")),
        custPills(it.c).length ? h("span.tags", custPills(it.c)) : null)));
    sugg.hidden = false; input.setAttribute("aria-expanded", "true");
  };
  async function openNew(name) {
    sugg.hidden = true;
    const r = await newCustomerSheet(ctx, name, { customers: list, districts: o.districts, routes: o.routes, prev: cur && cur.isNew ? cur : null });
    if (!r) return;
    if (r.pick) { pick(r.pick); return; }
    pick({ ...r.nc, isNew: true });
    if (r.brand && o.onBrand) o.onBrand(r.brand);
  }
  input.addEventListener("input", () => { if (cur && input.value !== cur.name) { cur = null; paint(); if (o.onPick) o.onPick(null); } hi = -1; render(true); });
  input.addEventListener("focus", () => render(true));
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { hi = Math.min(hi + 1, items.length - 1); render(true); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hi = Math.max(hi - 1, 0); render(true); e.preventDefault(); }
    else if (e.key === "Enter") { const it = items[hi >= 0 ? hi : 0]; if (it) { if (it.isNew) openNew(it.name); else { sugg.hidden = true; pick(it.c); } } e.preventDefault(); }
    else if (e.key === "Escape") { sugg.hidden = true; }
  });
  sugg.addEventListener("mousedown", e => e.preventDefault());
  document.addEventListener("click", e => { if (!box.contains(e.target)) sugg.hidden = true; });
  box.set = c => { cur = c; input.value = c ? c.name : ""; paint(); };
  box.get = () => cur;
  box.typed = () => input.value.trim();
  box.focus = () => input.focus();
  box.setCustomers = l => { list = l || []; if (cur && !cur.isNew) { const f = list.find(c => c.id === cur.id); if (f) { cur = f; paint(); } } };
  box.openNew = openNew;
  /** พิมพ์ชื่อแต่ไม่ได้แตะเลือก: ตรงทะเบียน = ผูกให้ · ไม่ตรง = เปิดแผ่นลูกค้าใหม่ (คืน false) */
  box.resolve = async () => {
    if (cur) return true;
    const q = input.value.trim();
    if (!q) return false;
    const ex = list.find(c => nameKey(c.name) === nameKey(q));
    if (ex) { pick(ex); return true; }
    await openNew(q);
    return !!cur;
  };
  paint();
  return box;
}

/** แผ่น "ลูกค้าใหม่": ชื่อ · อำเภอ (แตะ) · สาย (แตะ) · เบอร์ — เตือนชื่อคล้าย (แตะเลือกแทนได้) · เจอ "งาน…" ปน = แยกให้ */
export function newCustomerSheet(ctx, name, opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let result = null, district = (o.prev && o.prev.district) || "", route = (o.prev && o.prev.route_code) || "", brand = "";
    const S = ui.sheet({ title: "ลูกค้าใหม่", modal: true, foot: true, onClose: () => resolve(result) });
    const nameIn = h("input", { type: "text", maxlength: 120, value: name || "", "aria-label": "ชื่อร้าน/ลูกค้า" });
    const phoneIn = h("input", { type: "tel", maxlength: 40, inputmode: "tel", value: (o.prev && o.prev.phone) || "", "aria-label": "เบอร์โทร", placeholder: "ไม่บังคับ" });
    const otherIn = h("input", { type: "text", maxlength: 60, placeholder: "พิมพ์ชื่ออำเภอ", "aria-label": "อำเภอ (พิมพ์เอง)", hidden: true });
    const warn = h("div"), msg = h("p.err", { role: "alert" });
    const ds = (o.districts || []).slice(0, 12);
    const dChips = h("div.chips", ds.map(d => h("button.chip", { type: "button", "aria-pressed": String(d === district), onclick: e => { district = d; otherIn.hidden = true; dChips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === e.currentTarget))); } }, d)),
      h("button.chip", { type: "button", "aria-pressed": String(!!district && !ds.includes(district)), onclick: e => { district = ""; otherIn.hidden = false; otherIn.value = ""; otherIn.focus(); dChips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === e.currentTarget))); } }, "อื่น ๆ (พิมพ์เอง)"));
    if (district && !ds.includes(district)) { otherIn.hidden = false; otherIn.value = district; }
    const rChips = h("div.chips", (o.routes || []).map(r => h("button.chip", { type: "button", "aria-pressed": String(r.code === route), onclick: e => { route = route === r.code ? "" : r.code; rChips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.c === route))); }, dataset: { c: r.code } }, r.code)));
    const check = () => {
      put(warn);
      const sp = splitBrand(nameIn.value);
      if (sp) warn.append(h("div.sim", h("b", "ดูเหมือนมีชื่องานปนอยู่"), h("span", "ชื่อลูกค้าควรเป็น \"" + sp[0] + "\" ส่วน \"" + sp[1] + "\" ไปอยู่ช่องชื่องาน/แบรนด์"),
        h("div", h("button.btn", { type: "button", onclick: () => { nameIn.value = sp[0]; brand = sp[1]; ui.toast("ย้าย \"" + sp[1] + "\" ไปช่องชื่องานแล้ว"); check(); } }, "แยกให้เลย"))));
      const sim = similarCustomers(o.customers, sp ? sp[0] : nameIn.value);   // เทียบชื่อที่ตัดชื่องานออกแล้ว
      if (sim.length) warn.append(h("div.sim", h("b", "มีชื่อคล้ายในทะเบียน"), h("span", "ถ้าเป็นร้านเดียวกัน แตะเลือกแทน ไม่ต้องเพิ่มใหม่"),
        h("div.chips", sim.map(c => h("button.chip", { type: "button", onclick: () => { result = { pick: c }; S.close("ok"); } }, c.name + (tagOf(c) ? " · " + tagOf(c) : ""))))));
    };
    nameIn.addEventListener("input", check);
    S.body.append(h("label.field", h("span.lbl", "ชื่อร้าน/ลูกค้า (ไม่ใส่ชื่องาน)"), nameIn), warn,
      h("div.lbl", "อำเภอ"), dChips, otherIn, (o.routes || []).length ? h("div.lbl", "สายส่ง (ถ้ารู้)") : null, (o.routes || []).length ? rChips : null,
      h("label.field", h("span.lbl", "เบอร์โทร"), phoneIn), msg);
    S.foot.append(h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("cancel") }, "กลับ"),
      h("button.btn.pri", { type: "button", onclick: () => {
        const nm = nameIn.value.replace(/\s+/g, " ").trim();
        if (!nm) { msg.textContent = "ใส่ชื่อร้านก่อน"; return; }
        if (splitBrand(nm)) { msg.textContent = "แยกชื่องานออกก่อน (กด \"แยกให้เลย\")"; return; }
        const ex = (o.customers || []).find(c => nameKey(c.name) === nameKey(nm));
        if (ex) { result = { pick: ex }; ui.toast("มีในทะเบียนแล้ว — ใช้ชื่อเดิม"); S.close("ok"); return; }
        result = { nc: { name: nm, district: otherIn.hidden ? district : otherIn.value.trim(), route_code: route, phone: phoneIn.value.trim() }, brand };
        S.close("ok");
      } }, "ใช้ลูกค้าใหม่นี้")));
    check();
  });
}
