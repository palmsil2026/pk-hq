// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ — ลูกค้า: ทะเบียน (ค้างส่ง/ค้างเงินขึ้นก่อน) · รายละเอียด · แก้ไข · ยืนยัน/รวมรายที่นำเข้ามา        v2/web/roles/office-customers.js
//  หมายเหตุการค้า ("เงินไม่ดี") ขึ้นเด่นทุกที่ที่เห็นลูกค้า · เงินในหน้าลูกค้าบอกช่วงเวลาเสมอ · รหัสอยู่บรรทัดอ้างอิงที่เดียว
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, baht, thDayLong, seg, nameKey } from "../parts/kit.js";
import { customerPicker, findCustomers, custPills, custTag, similarCustomers, splitBrand } from "../parts/customer-picker.js";
import { orderCard } from "../parts/order-card.js";
import { labelOf } from "../parts/spec-picker.js";
import { cached, forget, write, isWide } from "./office-data.js";
import { openOrderIn } from "./office-order-detail.js";
import { billDoc } from "./office-bill.js";
const { h, icon } = ui;

const FILTERS = [["all", "ทั้งหมด"], ["open", "ค้างส่ง"], ["owe", "ค้างเงิน"], ["review", "รอตรวจชื่อ"]];

export function customersView(ctx, view, n) {
  let q = "", filter = "all", list = [], sel = n.arg || "";
  const search = h("input", { type: "search", placeholder: "ค้นชื่อร้าน · อำเภอ · สาย", "aria-label": "ค้นลูกค้า", oninput: e => { q = e.target.value; draw(); } });
  const chips = seg(FILTERS, filter, v => { filter = v || "all"; draw(); }, { label: "กรองลูกค้า" });
  const listBox = h("div.stack.orders"), panel = h("aside.md-detail", h("p.panel-empty", "แตะลูกค้าเพื่อดูรายละเอียด"));
  const count = h("div.lbl");
  add(view, h("div.row", h("div.cpick.grow", h("div.inp", icon("search", "sm"), search)),
    h("button.btn", { type: "button", onclick: () => editCustomer(ctx, null, cat, list, c => { reload(); open(c.id); }) }, icon("plus", "sm"), "ลูกค้าใหม่"),
    h("button.btn", { type: "button", onclick: () => routeSuggestSheet(ctx, () => reload()) }, icon("route", "sm"), "แนะนำสาย")),
  chips, h("div.md", h("div.stack", count, listBox), panel));
  let cat = null;
  cached(ctx, "office.form").then(c => { cat = c; }).catch(() => {});
  function draw() {
    let rows = q ? findCustomers(list, q, 200) : list.slice().sort((a, b) => (b.open_n > 0) - (a.open_n > 0) || (b.owe_n > 0) - (a.owe_n > 0) || String(b.last_day || "").localeCompare(String(a.last_day || "")) || a.name.localeCompare(b.name, "th"));
    if (filter === "open") rows = rows.filter(c => c.open_n > 0);
    if (filter === "owe") rows = rows.filter(c => c.owe_n > 0);
    if (filter === "review") rows = rows.filter(c => c.needs_review);
    count.textContent = n0(rows.length) + " ราย";
    ui.renderList(listBox, rows.slice(0, 150), c => c.id, c => h("button.card", { type: "button", "aria-current": c.id === sel ? "true" : null, onclick: () => open(c.id) },
      h("div.row", h("span.name.grow", c.name)), h("div.small.muted", [custTag(c) || "ยังไม่มีสาย/อำเภอ", c.last_day ? "สั่งล่าสุด " + thDayLong(c.last_day) : "ยังไม่เคยสั่ง"].join(" · ")),
      custPills(c).length ? h("div.row", custPills(c)) : null, c.note ? h("div.small", { style: { color: "var(--warn-ink)" } }, icon("alert", "sm"), " " + c.note) : null), ui.empty("ไม่พบลูกค้า", q ? "ลองพิมพ์สั้นลง หรือกด \"ลูกค้าใหม่\"" : ""));
    if (rows.length > 150) add(listBox, h("p.hint", "แสดง 150 รายแรก — พิมพ์ค้นเพื่อหาที่เหลือ"));
  }
  function open(id) {
    sel = id;
    listBox.querySelectorAll(".card").forEach(c => c.setAttribute("aria-current", String(c.dataset.k === id)));
    showCustomer(ctx, id, isWide() ? panel : null, { onChanged: reload, list: () => list, cat: () => cat });
  }
  async function reload() {
    forget("office.customers");
    try { list = (await ctx.api.read("office.customers")).customers; draw(); } catch (e) { ui.toast(e.message, "bad"); }
  }
  return ctx.load(view, "customers", "office.customers", (box, d) => { list = d.customers; box.remove(); draw(); if (sel && isWide()) open(sel); else if (sel) { open(sel); sel = ""; } });
}

/** รายละเอียดลูกค้า — host = แผงขวา (คอม) · null = แผ่นล่าง */
export function showCustomer(ctx, id, host, opt) {
  const o = opt || {};
  let S = null, box = host;
  if (!box) { S = ui.sheet({ title: "ลูกค้า", foot: true }); box = S.body; }
  put(box, ui.skeleton(3));
  box.dataset.id = id;
  const load = async () => {
    let d;
    try { d = await ctx.api.read("office.customer", { id }); }
    catch (e) { put(box, ui.errorBox("โหลดไม่สำเร็จ: " + e.message, load)); return; }
    if (box.dataset.id !== id) return;
    const c = d.customer;
    if (S) S.title = c.name;
    const kv = h("dl.kv2");
    const kvAdd = (k, v) => { if (v) add(kv, h("dt", k), h("dd", v)); };
    kvAdd("สาย/อำเภอ", [c.route_code ? "สาย " + c.route_code : "", c.district ? "อ." + c.district : "", c.subdistrict ? "ต." + c.subdistrict : ""].filter(Boolean).join(" · ") || "ยังไม่ระบุ");
    if (c.phone) add(kv, h("dt", "เบอร์"), h("dd", h("a", { href: "tel:" + c.phone.replace(/[^\d+]/g, "") }, icon("phone", "sm"), " " + c.phone)));
    kvAdd("ที่อยู่", c.address);
    // หมุดร้าน: มีพิกัด = เปิดนำทาง · มีแต่ลิงก์ที่อ่านไม่ได้ = เปิดลิงก์เดิม · วางลิงก์ที่ลูกค้าส่งในไลน์ได้ทุกเมื่อ
    add(kv, h("dt", "หมุดร้าน"), h("dd", h("div.geo-row",
      d.geo ? h("a.btn", { href: d.geo.open, target: "_blank", rel: "noopener" }, icon("pin", "sm"), "เปิดแผนที่") : c.map_url && /^https?:\/\//.test(c.map_url) ? h("a.btn", { href: c.map_url, target: "_blank", rel: "noopener" }, icon("pin", "sm"), "เปิดลิงก์เดิม") : null,
      h("span.small.muted", d.geo ? "จาก" + d.geo.src + (d.geo.acc_m ? " · แม่น ~" + d.geo.acc_m + " ม." : "") : c.map_url ? "ลิงก์นี้อ่านพิกัดไม่ได้ — รอคนขับปักหมุดตอนส่ง" : "ยังไม่มีหมุด (คนขับปักได้ตอนส่งของ)"),
      h("button.btn.ghost", { type: "button", onclick: () => geoSheet(ctx, c, !!d.geo, () => { load(); if (o.onChanged) o.onChanged(); }) }, icon("pin", "sm"), d.geo ? "แก้หมุด" : "วางลิงก์แผนที่"))));
    kvAdd("เครดิต", c.credit_days ? c.credit_days + " วัน" : "");
    if (d.aliases.length) kvAdd("ชื่ออื่นที่เคยใช้", d.aliases.join(" · "));
    const hint = !c.route_code && d.route_hint ? h("div.icard", h("div.row", icon("route", "sm"), h("b.grow", d.route_hint.route ? "แนะนำสาย " + d.route_hint.route : "ยังแนะนำสายไม่ได้")),
      h("span.small.muted", d.route_hint.basis + (d.route_hint.route ? " — ระบบแนะนำ คนยืนยัน (ไม่เขียนเอง)" : " — ยังไม่ชัดพอ เลือกเองในแก้ข้อมูล")),
      d.route_hint.route ? h("div.acts", h("button.btn", { type: "button", onclick: async () => { const r = await write(ctx, "office.route_apply", { items: [{ id: c.id, version: c.version, route_code: d.route_hint.route }] }, { label: "ใช้สาย " + d.route_hint.route + " · " + c.name }); if (r) { forget("office.customers"); load(); if (o.onChanged) o.onChanged(); } } }, icon("check", "sm"), "ใช้สาย " + d.route_hint.route)) : null) : null;
    const owe = d.owing.n ? h("div.icard", h("div.row", icon("coin", "sm"), h("b.grow", "ค้างชำระ " + d.owing.n + " บิล" + (d.owing.overdue ? " · เลยกำหนด " + d.owing.overdue : "")), h("b", "฿" + baht(d.owing.satang))),
      h("span.small.muted", d.owing.period)) : null;
    const actions = [h("button.btn.pri", { type: "button", onclick: () => { if (S) S.close(); ctx.go("new/cust:" + c.id); } }, icon("plus", "sm"), "ลงออเดอร์ให้ร้านนี้"),
      h("button.btn", { type: "button", onclick: () => editCustomer(ctx, c, o.cat && o.cat(), o.list ? o.list() : [], () => { load(); if (o.onChanged) o.onChanged(); }) }, icon("edit", "sm"), "แก้ข้อมูล")];
    if (c.needs_review && !c.merged_into) actions.push(
      h("button.btn", { type: "button", onclick: async () => { const r = await write(ctx, "office.customer_confirm", { id: c.id, version: c.version }, { label: "ยืนยันลูกค้า " + c.name }); if (r) { load(); if (o.onChanged) o.onChanged(); } } }, icon("check", "sm"), "ยืนยันเป็นรายใหม่"),
      h("button.btn", { type: "button", onclick: () => mergeSheet(ctx, c, o.list ? o.list() : [], () => { if (S) S.close(); if (o.onChanged) o.onChanged(); }) }, icon("users", "sm"), "รวมกับรายอื่น"));
    put(box, 
      host ? h("h2.name", c.name) : null,
      h("div.row", c.needs_review ? ui.pill("รอตรวจชื่อ — มาจากออเดอร์เก่าที่จับคู่ทะเบียนไม่ได้", "warn", "flag") : null, c.merged_into ? ui.pill("รวมเข้ารายอื่นแล้ว", "mute") : null, c.status !== "ใช้งาน" ? ui.pill(c.status, "mute") : null),
      c.note ? h("div.cust-note", icon("alert", "sm"), h("span", "หมายเหตุการค้า: " + c.note)) : null, kv, hint, owe,
      ...(S ? [] : [h("div.acts", actions)]),
      d.usual.length ? h("div.lbl", "เคยสั่ง (บ่อยสุดก่อน)") : null,
      d.usual.length ? h("div.usual", d.usual.map(u => h("div.icard", h("div.row", h("b.grow", labelOf(u)), h("span.small.muted", n0(u.n) + " ครั้ง")),
        h("span.small.muted", [u.screen_color ? "สกรีน" + u.screen_color : "", u.bags ? "ล่าสุด " + n0(u.bags) + " ถุง" : "ล่าสุด " + n0(u.qty_pcs), thDayLong(u.last_day)].filter(Boolean).join(" · "))))) : null,
      d.bills.length ? h("details.more", h("summary.btn.ghost", icon("chev", "sm"), "บิล (" + d.bills.length + ")"), h("div.stack", d.bills.map(b => h("button.icard", { type: "button", style: { textAlign: "left" }, onclick: () => b.src === "v2" ? billDoc(ctx, b.bill_no) : null },
        h("div.row", h("b.grow", "บิล" + b.kind + " · " + thDayLong(b.bill_day)), h("b", "฿" + baht(b.total_satang))),
        h("span.small.muted", [b.status, b.due_day && b.status === "ค้างชำระ" ? "ครบ " + thDayLong(b.due_day) : "", b.src !== "v2" ? "จากชีทบัญชี" : ""].filter(Boolean).join(" · ")))))) : null,
      h("div.lbl", "ออเดอร์ล่าสุด (" + d.orders.length + ")"),
      h("div.stack", d.orders.length ? d.orders.map(r => orderCard(ctx, r, x => openOrderIn(ctx, null, x.id, load), { today: d.today, maxItems: 2 })) : [h("p.hint", "ยังไม่มีออเดอร์")]),
      h("p.ref", "รหัสอ้างอิง " + c.id));
    if (S) put(S.foot, h("div.acts", actions));
  };
  load();
}

/** แผ่นเพิ่ม/แก้ลูกค้า (เตือนชื่อคล้าย · แยกชื่องาน) */
async function editCustomer(ctx, c, cat, list, done) {
  const S = ui.sheet({ title: c ? "แก้ข้อมูล " + c.name : "ลูกค้าใหม่", modal: true, foot: true });
  const f = { name: c ? c.name : "", phone: c ? c.phone : "", district: c ? c.district : "", subdistrict: c ? c.subdistrict : "", address: c ? c.address : "", map_url: c ? c.map_url : "",
    note: c ? c.note : "", route_code: c ? c.route_code || "" : "", credit_days: c ? c.credit_days || 0 : 0, status: c ? c.status : "ใช้งาน" };
  const inp = (k, label, attrs) => { const i = h(k === "note" || k === "address" ? "textarea" : "input", Object.assign({ "aria-label": label, oninput: e => { f[k] = e.target.value; if (k === "name") warn(); } }, attrs || {}), k === "note" || k === "address" ? f[k] || "" : null); if (i.tagName === "INPUT") i.value = f[k] || ""; return h("label.field", h("span.lbl", label), i); };
  const warnBox = h("div");
  const warn = () => {
    put(warnBox);
    const sp = splitBrand(f.name);
    if (sp) add(warnBox, h("div.sim", h("b", "มีชื่องานปนในชื่อลูกค้า"), h("span", "ชื่อลูกค้าควรเป็น \"" + sp[0] + "\" — ชื่องานใส่ในออเดอร์")));
    const sim = similarCustomers(list.filter(x => !c || x.id !== c.id), f.name);
    if (sim.length) add(warnBox, h("div.sim", h("b", "มีชื่อคล้ายในทะเบียน"), h("span", sim.map(x => x.name + (custTag(x) ? " (" + custTag(x) + ")" : "")).join(" · "))));
  };
  const routes = (cat && cat.routes) || [];
  const rSeg = seg(routes.map(r => [r.code, r.code]), f.route_code, v => { f.route_code = v; }, { label: "สายส่ง", allowNone: true });
  const stSeg = seg([["ใช้งาน", "ใช้งาน"], ["พัก", "พัก"], ["เลิกกิจการ", "เลิกกิจการ"]], f.status, v => { f.status = v || "ใช้งาน"; }, { label: "สถานะ" });
  const credit = h("button.qbtn", { type: "button", onclick: async () => { const v = await ui.numpadSheet({ title: "เครดิต (วัน)", unit: "วัน", value: f.credit_days || "" }); if (v !== undefined) { f.credit_days = v || 0; credit.querySelector("b").textContent = f.credit_days ? f.credit_days + " วัน" : "เงินสด/ไม่มี"; } } },
    h("small", "เครดิต"), h("b", f.credit_days ? f.credit_days + " วัน" : "เงินสด/ไม่มี"));
  add(S.body, inp("name", "ชื่อร้าน/ลูกค้า", { maxlength: 120 }), warnBox, inp("district", "อำเภอ", { maxlength: 60 }), inp("subdistrict", "ตำบล", { maxlength: 60 }),
    routes.length ? h("div.lbl", "สายส่ง") : null, routes.length ? rSeg : null, inp("phone", "เบอร์โทร", { type: "tel", maxlength: 40 }), inp("address", "ที่อยู่", { maxlength: 300 }),
    inp("map_url", "ลิงก์แผนที่", { type: "url", maxlength: 400, placeholder: "https://maps…" }), h("div.qrow", credit), inp("note", "หมายเหตุการค้า (เช่น เงินไม่ดีให้สั่งทางออฟฟิศ)", { maxlength: 300 }),
    c ? h("div.lbl", "สถานะ") : null, c ? stSeg : null);
  warn();
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"), h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
    const input = { ...f, route_code: f.route_code || "", credit_days: Number(f.credit_days) || 0 };
    const r = c ? await write(ctx, "office.customer_update", { id: c.id, version: c.version, ...input }, { label: "แก้ข้อมูลลูกค้า" })
      : await write(ctx, "office.customer_create", input, { label: "เพิ่มลูกค้า " + f.name });
    if (!r) return;
    forget("office.customers");
    S.close("ok");
    done(c || r.data);
  }) }, "บันทึก")));
}

/** รวมรายที่ซ้ำ (เช่นนำเข้าจากออเดอร์เก่า) เข้ากับรายหลัก — ออเดอร์/บิลย้ายตาม · ย้อนได้ */
function mergeSheet(ctx, c, list, done) {
  let into = null;
  const S = ui.sheet({ title: "รวม \"" + c.name + "\" กับรายอื่น", modal: true, foot: true });
  const sim = similarCustomers(list.filter(x => x.id !== c.id), c.name);
  const picker = customerPicker(ctx, { customers: list.filter(x => x.id !== c.id), onPick: x => { into = x; } });
  add(S.body, h("p.muted", "ออเดอร์และบิลของ \"" + c.name + "\" จะย้ายไปอยู่กับรายหลัก · ชื่อนี้จะจำไว้เป็นชื่ออื่น (นำเข้ารอบหน้าจับคู่ถูก) · ย้อนได้"),
    sim.length ? h("div.chips", sim.map(x => h("button.chip", { type: "button", onclick: () => { into = x; picker.set(x); } }, x.name))) : null, picker);
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"), h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
    if (!into || into.isNew) { ui.toast("เลือกรายหลักจากทะเบียนก่อน", "warn"); return; }
    const r = await write(ctx, "office.customer_merge", { id: c.id, version: c.version, into: into.id }, { label: "รวมลูกค้า" });
    if (r) { forget("office.customers"); S.close("ok"); done(); }
  }) }, "รวม")));
}
export { nameKey };

/** วางลิงก์แผนที่ (ลิงก์ที่ลูกค้าส่งในไลน์ · ลิงก์ย่อก็ได้) หรือพิมพ์พิกัด → หลังบ้านแกะพิกัดเอง · อ่านไม่ได้ = เก็บลิงก์ + ธง */
function geoSheet(ctx, c, had, done) {
  const S = ui.sheet({ title: (had ? "แก้หมุด · " : "หมุดร้าน · ") + c.name, modal: true, foot: true });
  const inp = h("input", { type: "url", maxlength: 600, placeholder: "วางลิงก์ Google Maps หรือ 18.2888, 99.4908", "aria-label": "ลิงก์แผนที่" });
  const msg = h("p.err", { role: "alert" });
  add(S.body, h("p.muted", "วางลิงก์ที่ลูกค้าส่งในไลน์ได้เลย (maps.app.goo.gl / share.google ก็ได้) — แอปอ่านพิกัดให้เอง"), h("label.field", h("span.lbl", "ลิงก์แผนที่"), inp),
    had ? h("p.hint", "ร้านนี้มีหมุดแล้ว — แก้ได้ แต่ต้องบอกเหตุผล (เก็บประวัติ)") : null, msg);
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"), h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
    const url = inp.value.trim();
    if (!url) { msg.textContent = "วางลิงก์ก่อน"; return; }
    const r = await write(ctx, "office.customer_geo", { id: c.id, version: c.version, url }, { label: "หมุดร้าน " + c.name, reasonKind: "geo_fix", reasonTitle: "แก้หมุดเดิม — ใส่เหตุผล" });
    if (!r) return;
    forget("office.customers");
    if (r.data && r.data.ok === false) ui.toast("เก็บลิงก์แล้ว แต่อ่านพิกัดไม่ได้ (" + r.data.why + ")", "warn");
    S.close("ok"); done();
  }) }, "บันทึก")));
  setTimeout(() => inp.focus(), 60);
}

/** แนะนำสายให้ลูกค้าที่มีแค่อำเภอ (เรียนจากลูกค้าที่มีทั้งสองช่อง) — เลือกแล้วยืนยันทีเดียว · ไม่เขียนทับรายที่มีสาย */
async function routeSuggestSheet(ctx, done) {
  const S = ui.sheet({ title: "แนะนำสายจากอำเภอ", modal: true, foot: true });
  add(S.body, ui.skeleton(2));
  let d;
  try { d = await ctx.api.read("office.route_suggest"); } catch (e) { put(S.body, ui.errorBox("โหลดไม่สำเร็จ: " + e.message)); return; }
  const pick = new Map();
  const ok = d.list.filter(x => x.route);
  ok.forEach(x => pick.set(x.id, x));
  const rows = ok.map(x => h("button.icard", { type: "button", "aria-pressed": "true", style: { textAlign: "left" }, onclick: e => {
    const on = !pick.has(x.id); if (on) pick.set(x.id, x); else pick.delete(x.id);
    e.currentTarget.setAttribute("aria-pressed", String(on)); e.currentTarget.querySelector(".ck").replaceChildren(icon(on ? "check-circle" : "x-circle", "sm")); count();
  } }, h("div.row", h("span.ck", icon("check-circle", "sm")), h("b.grow", x.name), ui.pill("สาย " + x.route + (x.area ? " " + x.area : ""), "brand", "route")), h("span.small.muted", x.basis)));
  const btn = h("button.btn.pri", { type: "button" });
  const count = () => { btn.textContent = "ยืนยันสาย " + pick.size + " ราย"; btn.disabled = !pick.size; };
  put(S.body, h("p.muted", "ยังไม่มีสาย " + n0(d.counts.no_route) + " ราย · แนะนำได้ " + n0(d.counts.suggest) + " · ไม่มีอำเภอเลย " + n0(d.counts.nothing) + " (รอปักหมุดตอนส่ง)"),
    h("p.hint", "แนะนำเมื่อลูกค้าอำเภอเดียวกันส่วนใหญ่ (≥ 60% และอย่างน้อย 2 ราย) อยู่สายเดียวกัน — แตะเพื่อเอาออกก่อนยืนยัน"),
    ...(rows.length ? rows.slice(0, 60) : [ui.empty("ไม่มีรายที่แนะนำได้")]), ok.length > 60 ? h("p.hint", "แสดง 60 รายแรก — ยืนยันแล้วเปิดใหม่เพื่อดูที่เหลือ") : null,
    d.list.filter(x => !x.route).length ? h("details.more", h("summary.btn.ghost", icon("chev", "sm"), "แนะนำไม่ได้ (" + d.list.filter(x => !x.route).length + ")"),
      h("div.stack", d.list.filter(x => !x.route).slice(0, 80).map(x => h("div.small", h("b", x.name), " · " + x.basis)))) : null);
  count();
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"), btn));
  btn.addEventListener("click", () => ui.busy(btn, async () => {
    const items = [...pick.values()].slice(0, 60).map(x => ({ id: x.id, version: x.version, route_code: x.route }));
    const r = await write(ctx, "office.route_apply", { items }, { label: "ยืนยันสาย " + items.length + " ราย" });
    if (r) { forget("office.customers"); S.close("ok"); done(); }
  }));
}
