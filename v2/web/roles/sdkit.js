// ═══════════════════════════════════════════════════════════════════════
//  ของที่หน้าทีมสกรีน + ส่งของใช้ร่วม: บันทึก (+ถามเหตุผลเมื่อหลังบ้านขอ) · ป้ายวันส่ง · ป้ายจำนวน · ใบส่งของ (ดู / พิมพ์-PDF / รูป-แชร์ไลน์)
//  v2/web/roles/sdkit.js — ใช้ชิ้นส่วนกลางจาก assets/ui.js เท่านั้น (ไม่ทำแผ่น/ปุ่มซ้ำ)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import * as api from "../assets/api.js";
const { h, icon } = ui;
/** ใส่ลูกลงกล่องโดยข้าม null/undefined/false (append ของเบราว์เซอร์จะเขียนคำว่า "null" ลงจอ) */
export const put = (el, ...kids) => el.append(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));

// สไตล์เฉพาะสองหน้านี้ (ไฟล์แยก ไม่แตะ app.css กลาง)
export function useCss() {
  if (document.getElementById("sd-css")) return;
  document.head.append(h("link#sd-css", { rel: "stylesheet", href: "roles/sd.css" }));
}

/**
 * บันทึก + แถบ "ย้อน" — เหมือน ctx.save แต่:
 *   · หลังบ้านขอเหตุผล (409 need_reason: ขึ้นเกิน/ขึ้นก่อนสกรีนเสร็จ) → เรียก onNeed(err) ให้หน้าถามแล้วส่งใหม่
 *   · ชนกัน (409) → บอกตรง ๆ แล้ววาดหน้าใหม่ให้เห็นของล่าสุด (คนหลังไม่ทับคนแรก)
 */
export async function save(ctx, action, input, o) {
  const opt = o || {};
  let reason = opt.reason || "";
  if (opt.confirm) {
    const c = await ui.confirmSheet(opt.confirm);
    if (!c) return null;
    reason = c.reason || reason;
  }
  const after = () => { if (opt.after) opt.after(); else ctx.refresh(); };
  try {
    const r = await api.write(action, input, { reason });
    if (r.undo) ui.undoBar(r.undo.label || opt.label || "บันทึกแล้ว", async () => { await api.write("undo.run", { id: r.undo.id }); after(); });
    else ui.toast("บันทึกแล้ว" + (opt.label ? " · " + opt.label : ""));
    if (opt.done) opt.done(r);
    after();
    return r;
  } catch (e) {
    if (e.code === "need_reason" && opt.onNeed) return opt.onNeed(e, reason);
    ui.toast(e.message || "บันทึกไม่สำเร็จ", "bad");
    if (e.status === 409 || e.status === 404) after();
    if (e.needLogin) ctx.refresh();
    return null;
  }
}

/** ป้ายวันส่ง: เลยกำหนด (แดง) · ส่งวันนี้ (อำพัน) · ส่ง 17 พ.ย. · ยังไม่กำหนด */
export function duePill(day, today, done) {
  if (!day) return ui.pill("ยังไม่กำหนดส่ง", "mute");
  if (!done && day < today) return ui.pill("เลยกำหนด " + ui.thDay(day), "bad", "alert");
  if (day === today) return ui.pill("ส่งวันนี้", "warn", "calendar");
  return ui.pill("ส่ง " + ui.thDay(day), "mute", "calendar");
}

/** ชื่อขนาดสั้นบนป้าย: "600 ml ใส" (ขวดไม่ต้องบอกว่าขวด) */
export const sizeName = it => [it.type === "ขวด" ? "" : it.type, it.size, it.color].filter(Boolean).join(" ") || it.label || it.type || "สินค้า";
export const fullName = it => it.label || [it.type, it.size, it.neck, it.shape, it.color].filter(Boolean).join(" ") || it.type || "สินค้า";
/** จำนวนเป็นป้าย [ขนาด | ตัวเลขหนา หน่วย] — นับถุงได้ (ลงตัว) = ถุง · ไม่งั้นเป็นใบ/ชิ้น */
export function qtyOf(it, pcs, label) {
  const unit = it.piece_unit || "ใบ";
  const size = label === undefined ? sizeName(it) : label;
  if (it.per_bag > 0 && pcs % it.per_bag === 0 && pcs > 0) return ui.qty(size, pcs / it.per_bag, "ถุง", ui.fmt(pcs) + " " + unit);
  return ui.qty(size, pcs, unit);
}
/** จำนวนเป็นคำ: "40 ถุง (8,000 ใบ)" */
export function qtyWords(it, pcs) {
  const unit = it.piece_unit || "ใบ";
  if (it.per_bag > 0 && pcs % it.per_bag === 0 && pcs > 0) return ui.fmt(pcs / it.per_bag) + " ถุง (" + ui.fmt(pcs) + " " + unit + ")";
  return ui.fmt(pcs) + " " + unit;
}

/** แป้นตัวเลขแบบถุง/ใบ — คืนจำนวนใบ (หรือ null) */
export async function askQty(it, title, maxPcs, startPcs) {
  const bags = it.per_bag > 0;
  const v = await ui.numpadSheet({ title, label: bags ? "ถุงละ " + ui.fmt(it.per_bag) : "", unit: bags ? "ถุง" : (it.piece_unit || "ใบ"),
    value: startPcs === undefined || startPcs === null ? "" : bags ? Math.floor(startPcs / it.per_bag) : startPcs, okText: "ตกลง" });
  if (v === null) return null;
  const pcs = bags ? v * it.per_bag : v;
  if (maxPcs !== undefined && pcs > maxPcs && bags && v === Math.ceil(maxPcs / it.per_bag)) return maxPcs;   // ถุงสุดท้ายไม่เต็ม = เท่าที่เหลือ
  return pcs;
}

/** ปุ่มกลุ่มเลือกได้อันเดียว (ชิป) — คืน { el, get value } */
export function choice(items, opt) {
  const o = opt || {};
  let value = o.value === undefined ? null : o.value;
  const el = h("div.chips", { role: "group", "aria-label": o.label || "" });
  const draw = () => el.replaceChildren(...items.map(it => h("button.chip" + (it.cls || ""), { type: "button", "aria-pressed": String(value === it.value),
    onclick: () => { value = it.value; draw(); if (o.onChange) o.onChange(value); } }, it.text, it.sub ? h("small.chip-sub", it.sub) : null)));
  draw();
  return { el, get value() { return value; }, set value(v) { value = v; draw(); } };
}

// ═══════════════════ ใบส่งของ ═══════════════════

/** ใบส่งของบนจอ (กระดาษขาว อ่านง่ายกลางแดด) */
export function docPaper(d) {
  return h("article.paper", { "aria-label": d.title },
    h("header", h("b.co", d.company), d.companyPhone ? h("span", "โทร " + d.companyPhone) : null, h("h3", d.title)),
    h("div.meta",
      h("div", h("span", "วันที่ "), h("b", ui.thDay(d.day) + (d.time ? " " + d.time : ""))),
      d.vehicle ? h("div", h("span", "รถ "), h("b", d.vehicle)) : null,
      h("div.wide", h("span", "ลูกค้า "), h("b", d.customer.name)),
      d.customer.address || d.customer.district ? h("div.wide", h("span", "ที่อยู่ "), [d.customer.address, d.customer.district].filter(Boolean).join(" ")) : null,
      d.customer.phone ? h("div", h("span", "โทร "), d.customer.phone) : null,
      d.customer.route ? h("div", h("span", "สาย "), d.customer.route) : null,
      d.customer.brand ? h("div.wide", h("span", "งาน "), d.customer.brand) : null),
    h("table", h("thead", h("tr", h("th", "#"), h("th", "รายการ"), h("th.n", "จำนวน"))),
      h("tbody", d.lines.map((l, i) => h("tr", h("td", String(i + 1)), h("td", l.name), h("td.n", l.text))))),
    h("div.sign", h("div", "ผู้รับสินค้า"), h("div", "ผู้ส่งสินค้า" + (d.by ? " (" + d.by + ")" : ""))),
    h("p.ref", "อ้างอิง " + d.ref));
}

/** พิมพ์ / บันทึกเป็น PDF (หน้าต่างพิมพ์ของเครื่อง → "บันทึกเป็น PDF") */
export function printDoc(d) {
  const box = h("div#sd-print", docPaper(d));
  document.body.append(box);
  document.body.classList.add("sd-printing");
  const done = () => { document.body.classList.remove("sd-printing"); box.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { try { window.print(); } finally { setTimeout(done, 1500); } }, 50);
}

/** วาดใบส่งของเป็นรูป PNG (ส่งไลน์ได้ทันที ไม่ต้องมีแอปพิมพ์) */
export async function docImage(d) {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ใช้ฟอนต์เครื่อง */ } }
  const W = 900, pad = 48, lh = 44;
  const rows = d.lines.length;
  const H = 520 + rows * lh + 220;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const font = (w, s, f) => { g.font = w + " " + s + "px " + (f || "Anuphan, Sarabun, sans-serif"); };
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#1f1718"; g.textBaseline = "top";
  font(800, 34); g.fillText(d.company, pad, pad);
  font(500, 22); g.fillStyle = "#5c4a4c"; if (d.companyPhone) g.fillText("โทร " + d.companyPhone, pad, pad + 46);
  g.fillStyle = "#1f1718"; font(800, 40); g.textAlign = "right"; g.fillText(d.title.replace(/ \(.*\)$/, ""), W - pad, pad); g.textAlign = "left";
  let y = pad + 100;
  g.fillStyle = "#B24A4F"; g.fillRect(pad, y, W - pad * 2, 4); y += 24;
  g.fillStyle = "#1f1718";
  const kv = (k, v, x) => { font(500, 22); g.fillStyle = "#5c4a4c"; g.fillText(k, x, y); const kw = g.measureText(k + " ").width; font(700, 24); g.fillStyle = "#1f1718"; g.fillText(v, x + kw, y - 1); };
  kv("วันที่", ui.thDay(d.day) + (d.time ? " " + d.time : ""), pad); if (d.vehicle) kv("รถ", d.vehicle, W / 2); y += 40;
  kv("ลูกค้า", d.customer.name, pad); y += 40;
  const addr = [d.customer.address, d.customer.district].filter(Boolean).join(" ");
  if (addr) { kv("ที่อยู่", addr.slice(0, 60), pad); y += 40; }
  const extra = [d.customer.phone ? "โทร " + d.customer.phone : "", d.customer.route ? "สาย " + d.customer.route : "", d.customer.brand ? "งาน " + d.customer.brand : ""].filter(Boolean).join("  ·  ");
  if (extra) { font(500, 22); g.fillStyle = "#5c4a4c"; g.fillText(extra, pad, y); y += 40; }
  y += 10;
  g.fillStyle = "#f3ecea"; g.fillRect(pad, y, W - pad * 2, lh); g.fillStyle = "#1f1718"; font(700, 22);
  g.fillText("#", pad + 14, y + 10); g.fillText("รายการ", pad + 60, y + 10); g.textAlign = "right"; g.fillText("จำนวน", W - pad - 14, y + 10); g.textAlign = "left";
  y += lh;
  d.lines.forEach((l, i) => {
    font(500, 24); g.fillStyle = "#1f1718";
    g.fillText(String(i + 1), pad + 14, y + 9);
    g.fillText(l.name.length > 34 ? l.name.slice(0, 33) + "…" : l.name, pad + 60, y + 9);
    font(800, 24); g.textAlign = "right"; g.fillText(l.text, W - pad - 14, y + 9); g.textAlign = "left";
    y += lh; g.fillStyle = "#e7dcdb"; g.fillRect(pad, y - 1, W - pad * 2, 1);
  });
  y += 70;
  g.fillStyle = "#5c4a4c"; font(500, 22);
  g.fillRect(pad, y, 300, 1); g.fillRect(W - pad - 300, y, 300, 1);
  g.fillText("ผู้รับสินค้า", pad + 100, y + 12); g.fillText("ผู้ส่งสินค้า" + (d.by ? " (" + d.by + ")" : ""), W - pad - 240, y + 12);
  font(500, 16); g.fillText("อ้างอิง " + d.ref, pad, H - 34);
  return new Promise(r => c.toBlob(b => r(b), "image/png"));
}

/** แชร์รูปใบส่งของ (มือถือ = แผ่นแชร์ของเครื่อง → LINE) · เครื่องที่แชร์ไฟล์ไม่ได้ = ดาวน์โหลดรูป */
export async function shareDoc(d) {
  const blob = await docImage(d);
  const name = "ใบส่งของ-" + d.customer.name.replace(/[\\/:*?"<>|\s]+/g, "-") + "-" + d.day + ".png";
  const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: d.title + " " + d.customer.name }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancel"; }
  }
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  ui.toast("บันทึกรูปใบส่งของแล้ว — ส่งเข้าไลน์จากรูปในเครื่องได้เลย");
  return "download";
}

/** แผ่นใบส่งของ: ดูบนจอ + ปุ่ม แชร์รูป/ไลน์ · พิมพ์-PDF (+ บิลถ้ามี ดูอย่างเดียว) */
export async function docSheet(ctx, input, extraFoot) {
  const sh = ui.sheet({ title: "ใบส่งของ", foot: true });
  put(sh.body, ui.skeleton(2));
  let d;
  try { d = await api.read("deliver.doc", input); }
  catch (e) { sh.body.replaceChildren(ui.errorBox("เปิดใบส่งของไม่สำเร็จ: " + e.message)); return sh; }
  sh.title = d.title.replace(/ \(.*\)$/, "") + " · " + d.customer.name;
  sh.body.replaceChildren(docPaper(d));
  if (d.bills && d.bills.length) {
    put(sh.body, h("div.card", h("div.lbl", "บิลของออเดอร์นี้ (ดูอย่างเดียว — ออก/แก้บิลที่ออฟฟิศ/บัญชี)"),
      d.bills.map(b => h("div.row", h("span.grow", (b.kind || "บิล") + " · " + ui.thDay(b.day) + (b.paper_no ? " · เล่ม " + b.paper_no : "")), ui.pill(b.status, b.status === "ชำระแล้ว" ? "ok" : "warn"), h("b", ui.money(b.total_satang))))));
  }
  const shareBtn = h("button.btn.pri", { type: "button" }, icon("download", "sm"), "ส่งรูป / ไลน์");
  shareBtn.addEventListener("click", () => ui.busy(shareBtn, () => shareDoc(d)));
  put(sh.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => printDoc(d) }, "พิมพ์ / PDF"), shareBtn), extraFoot || null);
  return sh;
}
