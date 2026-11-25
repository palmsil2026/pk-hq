// บัญชี (?app=account) — "ที่รวมและตรวจ" ข้อมูลที่ทีมอื่นลงไว้ · ฝ่ายบัญชียังจดชีท "ระบบบัญชี" เดิม (แอปนี้ไม่เขียนกลับชีท)
//   หน้าแรก = งานที่รอตรวจ (ทำเสร็จหนึ่งเรื่อง เปิดเรื่องถัดไปให้เอง) · เมนู: ตรวจ · บิล · ลูกหนี้ · เงินเข้า
//   เงิน: ไม่โชว์ค่าเก่าหรือ ฿0 ตอนโหลดไม่สำเร็จ (ui.money(x, st.fresh)) · ยอดบอกช่วงเวลาเสมอ · ช่องทางรับเงินไม่มีค่าตั้งต้น
import { thText, linkSheet, paySheet, billSheet, billForm, owingView, moneyInView, syncButton, syncLine, chLabel, statusPill } from "./money.js";

const sec = (ctx, title, n, sub, rows, tone) => {
  const { h } = ctx;
  return h("section.card", { "aria-label": title }, h("div.sec-h", h("b", title), h("span.n", { style: tone ? { color: "var(--" + tone + "-ink, var(--" + tone + "))" } : null }, ctx.ui.fmt(n))),
    sub ? h("span.small.muted", sub) : null, h("div.stack", { style: { gap: "8px" } }, rows));
};

export function accountHome(ctx, view) {
  const { h, ui } = ctx;
  return ctx.load(view, "check", "home.account", (box, d, st) => {
    const f = st.fresh, refresh = () => ctx.refresh();
    const money = s => ui.money(s, f);
    const groups = [];
    const openLink = i => { const b = d.unlinked[i]; if (b) linkSheet(ctx, b, { after: refresh, next: i + 1 < d.unlinked.length ? () => openLink(i + 1) : null }); };
    if (d.unlinked.length) groups.push(sec(ctx, "บิลจากออเดอร์ รอใส่เลขบิลกระดาษ", d.unlinked.length, "แตะแล้วใส่เลข + ยอดตามบิลกระดาษ — เสร็จแล้วเปิดใบถัดไปให้เอง",
      d.unlinked.map((b, i) => h("button.card", { type: "button", onclick: () => openLink(i) },
        h("div.row", h("span.name.grow", b.customer_name), h("b", money(b.total_satang))),
        h("div.row.small.muted", "บิลวันที่ " + ui.thDay(b.bill_day), ui.pill(b.kind, b.kind === "เงินสด" ? "warn" : "mute"), b.brand ? h("span", "งาน " + b.brand) : null)))));
    const waitOffice = d.issues.filter(x => x.kind === "ยอดไม่ตรง"), sheetIssues = d.issues.filter(x => x.kind !== "ยอดไม่ตรง");
    if (waitOffice.length) groups.push(sec(ctx, "ยอดไม่ตรง — รอออฟฟิศเช็ค", waitOffice.length, "บัญชีไม่ต้องแก้บิลจากออเดอร์ · ออฟฟิศแก้แล้วผูกเลขใหม่ได้", waitOffice.map(x =>
      h("button.card", { type: "button", onclick: () => x.entity === "bills" ? billSheet(ctx, x.entity_id, { after: refresh }) : null },
        h("div.row", ui.pill(x.kind, "bad", "alert"), h("span.small.muted.r", ui.thDayOf(x.at) + " " + ui.thTime(x.at))), h("b", x.title), x.detail ? h("span.small", x.detail) : null)), "bad"));
    if (d.sheetPaid.length) groups.push(sec(ctx, "ชีทบัญชีบอกจ่ายแล้ว แต่ในแอปยังค้าง", d.sheetPaid.length, "บิลใบเดียวกัน — รับชำระในแอปให้ตรงกับชีท (ช่องทางยังต้องเลือกเอง)", d.sheetPaid.map(b =>
      h("button.card", { type: "button", onclick: () => paySheet(ctx, [b], { after: refresh, hint: "ในชีทบัญชี: " + (b.sheet_channel ? chLabel(ctx, b.sheet_channel) : "ไม่ระบุช่องทาง") + (b.sheet_paid_day ? " · " + ui.thDay(b.sheet_paid_day) : "") }) },
        h("div.row", h("span.name.grow", b.customer_name), h("b", money(b.due_satang))),
        h("div.row.small.muted", (b.paper_no ? "บิล #" + b.paper_no + " · " : "") + "ในชีท: " + (b.sheet_channel ? chLabel(ctx, b.sheet_channel) : "ไม่ระบุช่องทาง"))))));
    if (d.due.length) groups.push(sec(ctx, "ลูกหนี้ครบกำหนดภายใน " + d.dueDays + " วัน", d.due.length, null, d.due.map(b =>
      h("button.card", { type: "button", onclick: () => billSheet(ctx, b.bill_no, { after: refresh }) },
        h("div.row", h("span.name.grow", b.customer_name), h("b", money(b.due_satang))),
        h("div.row.small", b.late ? ui.pill("เลยกำหนด " + ui.thDay(b.due_day), "bad", "alert") : ui.pill("กำหนด " + ui.thDay(b.due_day), "warn", "calendar"), b.src === "acct" ? ui.pill("ชีทบัญชี", "mute") : null, b.paper_no ? h("span.muted", "บิล #" + b.paper_no) : null))), "warn"));
    if (sheetIssues.length) groups.push(sec(ctx, "เรื่องจากชีทบัญชี", sheetIssues.length, "ประธานเป็นคนตัดสิน · ดูไว้ให้รู้", sheetIssues.map(x =>
      h("div.card", h("div.row", ui.statusPill(ctx.vocab, "flags.kind", x.kind), h("span.small.muted.r", ui.thDayOf(x.at))), h("b", x.title), x.detail ? h("span.small.muted", x.detail) : null))));
    const ch = d.moneyIn.byChannel || [];
    const side = h("div.stack",
      h("div.card", h("div.row", h("b.grow", "ค้างชำระทั้งหมด"), h("span.big.md", money(d.owing.satang))), h("span.small.muted", ui.fmt(d.owing.n) + " บิล · " + thText(d.owing.period))),
      h("div.card", h("div.row", h("b.grow", "เงินเข้าวันนี้"), h("span.big.md", money(d.moneyIn.total))), h("span.small.muted", thText(d.moneyIn.period)),
        ch.length ? h("div.kv", ch.map(c => h("div", h("div.lbl", chLabel(ctx, c.channel)), h("b", money(c.satang))))) : h("span.muted", f ? "ยังไม่มีเงินเข้าวันนี้" : "—")),
      h("div.card", syncLine(d.sync, d.syncAuto), syncButton(ctx, refresh)));
    const main = h("div.stack", groups.length ? groups : ui.empty("ไม่มีงานค้าง", "บิลจากออเดอร์ผูกเลขครบ · ไม่มีลูกหนี้ใกล้ครบกำหนด"));
    box.replaceChildren(h("div.row", h("span.muted.grow", "วันนี้ " + ui.thDay(d.today)), st.fresh ? null : ui.stamp(st.at, st.updating)), h("div.wide-2.stack", main, side));
  });
}

// ── บิล: ฟอร์มลงบิลบนสุด (บิลที่ไม่ได้มาจากออเดอร์) · รายการใหม่สุดบน · ค้น/กรอง ─────────────────────────
function billsView(ctx, view) {
  const { h, ui, api } = ctx;
  const form = h("section.card", { "aria-label": "ลงบิล" }, h("div.sec-h", h("b", "ลงบิล"), h("span.small.muted", "บิลที่ไม่ได้มาจากออเดอร์ (บิลจากออเดอร์ = ผูกเลขที่หน้าตรวจ)")));
  const listBox = h("div.stack");
  const q = h("input", { type: "search", placeholder: "ค้นชื่อร้าน หรือเลขบิลกระดาษ", "aria-label": "ค้นบิล", maxlength: 60 });
  let filter = "all", next = null, items = [], seq = 0;
  const chips = h("div.chips", { role: "group", "aria-label": "กรองบิล" }, [["all", "ทั้งหมด"], ["unpaid", "ค้างชำระ"], ["unlinked", "ยังไม่ผูกเลข"], ["app", "ลงในแอปบัญชี"], ["cancelled", "ยกเลิก"]].map(([k, l]) =>
    h("button.chip", { type: "button", "aria-pressed": String(k === filter), onclick: e => { filter = k; chips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === e.currentTarget))); load(); } }, l)));
  const more = h("button.btn.ghost.block", { type: "button", hidden: true, onclick: () => ui.busy(more, () => load(true)) }, "โหลดเพิ่ม");
  const row = b => h("button.card", { type: "button", onclick: () => billSheet(ctx, b.bill_no, { after: () => load() }) },
    h("div.row", h("span.name.grow", b.customer_name), h("b", ui.money(b.status === "ค้างชำระ" ? b.due_satang : b.total_satang))),
    h("div.row.small", h("span.muted", ui.thDay(b.bill_day) + (b.paper_no ? " · บิล #" + b.paper_no : " · ยังไม่ผูกเลข")), statusPill(ctx, b), b.src === "acct" ? ui.pill("ชีทบัญชี", "mute") : b.src === "order" ? ui.pill("จากออเดอร์", "brand") : null));
  async function load(append) {
    const n = ++seq;
    if (!append) { next = null; listBox.replaceChildren(ui.skeleton(3)); }
    let d;
    try { d = await api.read("account.bills", { q: q.value.trim(), filter, before: append ? next : undefined, limit: 40 }); }
    catch (e) { if (n === seq) listBox.replaceChildren(ui.errorBox("โหลดบิลไม่สำเร็จ: " + e.message, () => load())); return; }
    if (n !== seq) return;
    items = append ? items.concat(d.items) : d.items; next = d.next; more.hidden = !next;
    ui.renderList(listBox, items, b => b.bill_no + ":" + b.version, row, ui.empty(q.value.trim() ? "ไม่พบบิลที่ค้น" : "ยังไม่มีบิล"));
  }
  let t = 0;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load(), 250); });
  billForm(ctx, { into: form, after: () => load() });
  view.append(h("div.wide-2.stack", form, h("div.stack", h("div.field", q), chips, listBox, more)));
  return load();
}

export default {
  code: "account", title: "บัญชี",
  nav: [
    { key: "check", label: "ตรวจ", icon: "check", title: "งานที่รอตรวจ" },
    { key: "bills", label: "บิล", icon: "list", title: "ลงบิล · บิลทั้งหมด" },
    { key: "owing", label: "ลูกหนี้", icon: "users" },
    { key: "money", label: "เงินเข้า", icon: "bank", title: "เงินเข้าบัญชีไหน" },
  ],
  views: { check: accountHome, bills: billsView, owing: owingView, money: moneyInView },
};
