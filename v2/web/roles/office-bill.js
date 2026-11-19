// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ — ออกบิลจากออเดอร์ + เอกสารบิล (พิมพ์/PDF · บันทึกเป็นรูป · แชร์ไลน์)                   v2/web/roles/office-bill.js
//  กติกาเงิน: ประเภทบิลต้องกดเอง (ไม่มีค่าตั้งต้น) · ราคาไม่เดา (ไม่มีราคา = ต้องใส่) · มีบิลแล้ว = เปิดใบเดิม ไม่ออกใหม่
//  บิลที่ออฟฟิศออก = ค้างชำระ (รับเงิน/ผูกเลขบิลกระดาษ = งานฝ่ายบัญชี) · ห้ามเขียนชีทบัญชี (ไม่มีทางเขียนอยู่แล้ว)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, baht, thDayLong, pricePad, dateSheet, shareText, seg, todayTh } from "../parts/kit.js";
import { write, blockedSheet } from "./office-data.js";
const { h, icon } = ui;

/** แผ่นออกบิล — d = ผลจาก office.order */
export function billSheet(ctx, d, opt) {
  const o = opt || {};
  const od = d.order;
  if (d.bill) return billDoc(ctx, d.bill.bill_no, opt);
  let kind = "", due = d.suggest_due, block = !!od.block_fee_satang;
  const lines = d.items.map(it => ({ it, qty: it.delivered > 0 ? it.delivered : it.qty_pcs, price: it.price_satang }));
  const S = ui.sheet({ title: "ออกบิล · " + (d.customer ? d.customer.name : od.customer_text), modal: true, foot: true });
  const total = h("div.money-big"), msg = h("p.err", { role: "alert" });
  const dueBtn = h("button.qbtn", { type: "button", onclick: async () => { const v = await dateSheet({ title: "กำหนดชำระ", value: due, min: todayTh() }); if (v) { due = v; draw(); } } }, h("small", "กำหนดชำระ"), h("b"));
  const dueRow = h("div", { hidden: true }, dueBtn, h("p.hint", "ตั้งตามเครดิตของลูกค้า (หรือ " + "ค่าตั้งต้นระบบ) — แตะเพื่อเปลี่ยน"));
  const kinds = seg([["เงินสด", "บิลเงินสด"], ["เครดิต", "บิลเครดิต"]], "", v => { kind = v; draw(); }, { label: "ประเภทบิล" });
  const rows = h("div.stack");
  const noteIn = h("input", { type: "text", maxlength: 300, placeholder: "ไม่บังคับ", "aria-label": "หมายเหตุบนบิล" });
  const blockChip = od.block_fee_satang ? h("button.chip", { type: "button", "aria-pressed": String(block), onclick: e => { block = !block; e.currentTarget.setAttribute("aria-pressed", String(block)); draw(); } }, "รวมค่าบล็อก ฿" + baht(od.block_fee_satang)) : null;
  function draw() {
    dueRow.hidden = kind !== "เครดิต";
    dueBtn.querySelector("b").textContent = due ? thDayLong(due) : "เลือกวัน";
    put(rows, ...lines.map(l => {
      const qb = h("button.qbtn", { type: "button", onclick: async () => { const v = await ui.numpadSheet({ title: "จำนวนในบิล · " + l.it.label, unit: l.it.piece_unit, value: l.qty, label: "สั่ง " + n0(l.it.qty_pcs) + " · ส่งแล้ว " + n0(l.it.delivered) }); if (v !== null && v !== undefined) { l.qty = v; draw(); } } },
        h("small", "จำนวน (" + l.it.piece_unit + ")"), h("b", n0(l.qty)));
      const pb = h("button.qbtn" + (l.price === null ? ".unset" : ""), { type: "button", onclick: async () => { const v = await pricePad({ title: "ราคาในบิล · " + l.it.label, unit: l.it.piece_unit, value: l.price, list: l.it.price_satang }); if (v !== undefined) { l.price = v; draw(); } } },
        h("small", "ราคา/" + l.it.piece_unit), h("b", l.price === null ? "ใส่ราคา" : "฿" + baht(l.price)));
      return h("div.icard", h("div.row", h("b.grow", l.it.label), l.price !== null && l.qty ? h("b", "฿" + baht(l.qty * l.price)) : null), h("div.qrow", qb, pb));
    }));
    const t = lines.reduce((s, l) => s + (l.price === null ? 0 : l.qty * l.price), 0) + (block ? od.block_fee_satang : 0);
    total.textContent = "฿" + baht(t);
  }
  add(S.body, h("div.lbl", "ประเภทบิล (ต้องเลือก)"), kinds, dueRow, h("div.lbl", "รายการในบิล"), rows, blockChip, h("label.field", h("span.lbl", "หมายเหตุบนบิล"), noteIn),
    h("div.row", h("span.muted.grow", "ยอดบิล"), total),
    d.deposit_satang ? h("div.banner.t-warn", icon("coin"), h("span", "ออเดอร์นี้มัดจำแล้ว ฿" + baht(d.deposit_satang) + " — ระบบไม่หักให้เอง ยอดบิลคือยอดเต็ม · ออกบิลแล้วฝ่ายบัญชีจะเห็นเรื่องนี้เพื่อตรวจ")) : null, msg);
  add(S.foot, h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("x") }, "กลับ"),
    h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
      if (!kind) { msg.textContent = "เลือกก่อนว่าเป็นบิลเงินสดหรือบิลเครดิต"; return; }
      if (kind === "เครดิต" && !due) { msg.textContent = "เลือกกำหนดชำระ"; return; }
      if (lines.some(l => l.qty > 0 && l.price === null)) { msg.textContent = "ใส่ราคาให้ครบทุกรายการที่มีจำนวน"; return; }
      msg.textContent = "";
      const r = await write(ctx, "office.bill_create", { order_id: od.id, version: od.version, kind, due_day: kind === "เครดิต" ? due : "", block_fee: block, note: noteIn.value.trim(),
        lines: lines.map(l => ({ item_id: l.it.id, qty_pcs: l.qty, price_satang: l.price === null ? 0 : l.price })) }, { label: "ออกบิล", reasonKind: "price", reasonTitle: "บิลไม่ตรงกับออเดอร์ — ใส่เหตุผล" });
      if (!r) return;
      S.close("ok");
      if (o.onDone) o.onDone();
      billDoc(ctx, r.data.bill_no, o);
    }) }, "ออกบิล")));
  draw();
  return S.done;
}

/** เอกสารบิล: พิมพ์/บันทึก PDF · บันทึกเป็นรูป · แชร์ไลน์ · ยกเลิก (ถ้ายังไม่มีใครแตะ) */
export async function billDoc(ctx, billNo, opt) {
  const o = opt || {};
  const S = ui.sheet({ title: "บิล", foot: true });
  add(S.body, ui.skeleton(2));
  let d;
  try { d = await ctx.api.read("office.bill", { bill_no: billNo }); }
  catch (e) { put(S.body, ui.errorBox("โหลดบิลไม่สำเร็จ: " + e.message)); return; }
  const b = d.bill;
  S.title = "บิล" + b.kind + " · " + b.customer_name;
  const doc = docEl(d);
  put(S.body, h("div.row", ui.statusPill(ctx.vocab, "bills.status", b.status), b.paper_no ? ui.pill("เลขบิลกระดาษ " + b.paper_no, "mute") : ui.pill("ยังไม่ผูกเลขบิลกระดาษ", "warn")),
    d.deposit_satang ? h("div.banner.t-warn", icon("coin"), h("span", "มัดจำแล้ว ฿" + baht(d.deposit_satang) + " (" + d.deposits.map(x => thDayLong(x.paid_day)).join(", ") + ") — ยังไม่ได้หักในบิลนี้ ให้ฝ่ายบัญชีตัดสิน")) : null,
    h("div.doc-wrap", doc), h("p.ref", "รหัสอ้างอิง " + b.bill_no));
  const canCancel = b.src === "v2" && b.status === "ค้างชำระ" && !b.paid_satang && !b.paper_no && !b.stmt_no;
  add(S.foot, h("div.acts",
    h("button.btn.pri", { type: "button", onclick: () => printDoc(doc) }, icon("print", "sm"), "พิมพ์ / PDF"),
    h("button.btn", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => { const f = await docImage(d); downloadFile(f); }) }, icon("image", "sm"), "บันทึกเป็นรูป"),
    h("button.btn", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => { const f = await docImage(d); await shareText(docText(d), [f]); }) }, icon("share", "sm"), "แชร์ไลน์"),
    canCancel ? h("button.btn.ghost", { type: "button", onclick: async () => {
      const r = await write(ctx, "office.bill_cancel", { bill_no: b.bill_no, version: b.version }, { label: "ยกเลิกบิล",
        confirm: { title: "ยกเลิกบิลนี้", detail: "ยกเลิกแล้วออกใบใหม่ได้ (เลขเดิมไม่ถูกใช้ซ้ำ)", reasons: ctx.reasons("bill_cancel"), need: "required", okText: "ยกเลิกบิล", danger: true } });
      if (r) { S.close("ok"); if (o.onChanged) o.onChanged(); if (o.onDone) o.onDone(); }
    } }, icon("x-circle", "sm"), "ยกเลิกบิล") : null));
  return S;
}

function docEl(d) {
  const b = d.bill, c = d.customer || {};
  return h("article.billdoc", { "aria-label": "เอกสารบิล" },
    h("div.co", h("div", h("h3", d.company.name), d.company.phone ? h("div", "โทร. " + d.company.phone) : null),
      h("div", { style: { textAlign: "right" } }, h("h3", b.kind === "เครดิต" ? "ใบส่งของ/ใบแจ้งหนี้" : "บิลเงินสด"), h("div", "วันที่ " + thDayLong(b.bill_day)), h("div", "เลขที่ " + b.bill_no))),
    h("div", h("b", "ลูกค้า: "), b.customer_name, c.district ? " · อ." + c.district : "", c.phone ? " · โทร. " + c.phone : ""),
    d.order && d.order.brand ? h("div", h("b", "งาน: "), d.order.brand) : null,
    h("table", h("thead", h("tr", h("th", "#"), h("th", "รายการ"), h("th.n", "จำนวน"), h("th.n", "ราคา/หน่วย"), h("th.n", "จำนวนเงิน"))),
      h("tbody", b.lines.map((l, i) => h("tr", h("td", String(i + 1)), h("td", l.label + (l.screen ? " · สกรีน" + l.screen : "") + (l.cap ? " · ฝา" + l.cap : "")),
        h("td.n", n0(l.qty_pcs) + " " + l.unit + (l.per_bag && l.qty_pcs % l.per_bag === 0 ? " (" + n0(l.qty_pcs / l.per_bag) + " ถุง)" : "")), h("td.n", baht(l.price_satang)), h("td.n", baht(l.amount_satang)))))),
    h("div.tot", h("span", "รวมทั้งสิ้น"), h("span", baht(b.total_satang) + " บาท")),
    b.kind === "เครดิต" && b.due_day ? h("div", h("b", "กำหนดชำระ: "), thDayLong(b.due_day)) : null,
    b.note ? h("div", h("b", "หมายเหตุ: "), b.note) : null,
    h("div.sign", h("span", "ผู้รับของ"), h("span", "ผู้ออกบิล " + (b.by_name || ""))));
}
function docText(d) {
  const b = d.bill;
  return [d.company.name, (b.kind === "เครดิต" ? "ใบแจ้งหนี้" : "บิลเงินสด") + " เลขที่ " + b.bill_no + " · " + thDayLong(b.bill_day), "ลูกค้า: " + b.customer_name,
    ...b.lines.map((l, i) => (i + 1) + ". " + l.label + " " + n0(l.qty_pcs) + " " + l.unit + " × " + baht(l.price_satang) + " = " + baht(l.amount_satang)),
    "รวมทั้งสิ้น " + baht(b.total_satang) + " บาท", b.kind === "เครดิต" && b.due_day ? "กำหนดชำระ " + thDayLong(b.due_day) : ""].filter(Boolean).join("\n");
}
/** พิมพ์เฉพาะเอกสาร (เครื่องพิมพ์ หรือ "บันทึกเป็น PDF" ของเบราว์เซอร์) */
export function printDoc(doc) {
  const root = h("div.print-root", doc.cloneNode(true));
  document.body.append(root);
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); root.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { try { window.print(); } finally { setTimeout(done, 1000); } }, 50);
}
/** วาดบิลเป็นรูป (PNG) — ไม่ใช้ไลบรารีภายนอก */
export async function docImage(d) {
  const b = d.bill, W = 900, pad = 40, lh = 34;
  const lines = b.lines.length;
  const H = 360 + lines * lh + (b.note ? lh : 0);
  const cv = document.createElement("canvas");
  cv.width = W * 2; cv.height = H * 2;
  const g = cv.getContext("2d");
  g.scale(2, 2);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#111";
  const font = (w, s) => { g.font = w + " " + s + "px Anuphan, Sarabun, 'Noto Sans Thai', sans-serif"; };
  let y = pad + 10;
  font(800, 24); g.fillText(d.company.name, pad, y);
  g.textAlign = "right"; g.fillText(b.kind === "เครดิต" ? "ใบส่งของ/ใบแจ้งหนี้" : "บิลเงินสด", W - pad, y); g.textAlign = "left";
  y += lh; font(400, 17);
  if (d.company.phone) g.fillText("โทร. " + d.company.phone, pad, y);
  g.textAlign = "right"; g.fillText("วันที่ " + thDayLong(b.bill_day) + " · เลขที่ " + b.bill_no, W - pad, y); g.textAlign = "left";
  y += 14; g.fillRect(pad, y, W - 2 * pad, 2); y += lh;
  font(700, 18); g.fillText("ลูกค้า: " + b.customer_name, pad, y); y += lh * 1.2;
  font(700, 16); g.fillText("รายการ", pad, y);
  const cols = [W - pad - 330, W - pad - 160, W - pad];
  g.textAlign = "right"; ["จำนวน", "ราคา/หน่วย", "จำนวนเงิน"].forEach((t, i) => g.fillText(t, cols[i], y)); g.textAlign = "left";
  y += 10; g.fillRect(pad, y, W - 2 * pad, 1); y += lh - 6;
  font(400, 17);
  b.lines.forEach((l, i) => {
    g.fillText((i + 1) + ". " + l.label + (l.screen ? " · สกรีน" + l.screen : ""), pad, y, cols[0] - pad - 150);
    g.textAlign = "right";
    g.fillText(n0(l.qty_pcs) + " " + l.unit, cols[0], y); g.fillText(baht(l.price_satang), cols[1], y); g.fillText(baht(l.amount_satang), cols[2], y);
    g.textAlign = "left"; y += lh;
  });
  g.fillRect(pad, y - lh + 12, W - 2 * pad, 1); y += 8;
  font(800, 22); g.textAlign = "right"; g.fillText("รวมทั้งสิ้น " + baht(b.total_satang) + " บาท", W - pad, y); g.textAlign = "left";
  y += lh;
  font(400, 17);
  if (b.kind === "เครดิต" && b.due_day) { g.fillText("กำหนดชำระ " + thDayLong(b.due_day), pad, y); y += lh; }
  if (b.note) { g.fillText("หมายเหตุ: " + b.note, pad, y, W - 2 * pad); }
  const blob = await new Promise(r => cv.toBlob(r, "image/png"));
  return new File([blob], "บิล-" + b.customer_name.replace(/[\\/:*?"<>|\s]+/g, "-") + "-" + b.bill_day + ".png", { type: "image/png" });
}
function downloadFile(f) {
  const a = h("a", { href: URL.createObjectURL(f), download: f.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  ui.toast("บันทึกรูปบิลแล้ว");
}
export { blockedSheet };
