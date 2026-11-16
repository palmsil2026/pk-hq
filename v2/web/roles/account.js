// บัญชี — หน้าแรก "งานที่รอตรวจ" (ฝ่ายบัญชียังจดชีท "ระบบบัญชี" เดิม — แอปนี้อ่าน/ตรวจ ไม่เขียนกลับชีทบัญชี)
//   เงิน: ไม่โชว์ค่าเก่าหรือ ฿0 ตอนโหลดไม่สำเร็จ (ui.money(x, st.fresh)) · ยอดเงินบอกช่วงเวลาเสมอ
export function accountHome(ctx, view) {
  const { h, ui } = ctx;
  return ctx.load(view, "money", "home.account", (box, d, st) => {
    const f = st.fresh;
    const ch = (d.moneyIn.byChannel || []);
    box.replaceChildren(
      st.fresh ? "" : ui.stamp(st.at, st.updating),
      h("div.card", h("div.row", h("b.grow", "บิลยังไม่ผูกเลขกระดาษ"), h("span.big.md", ui.fmt(d.unpaired))), h("span.small.muted", "ออฟฟิศออกบิลจากออเดอร์แล้ว รอใส่เลขบนบิลจริง")),
      h("div.card", h("div.row", h("b.grow", "ลูกหนี้ครบกำหนดภายใน 7 วัน"), h("span.big.md", { style: d.dueThisWeek ? { color: "var(--warn-ink)" } : null }, ui.fmt(d.dueThisWeek)))),
      h("div.card", h("div.row", h("b.grow", "ค้างชำระทั้งหมด"), h("span.big.md", ui.money(d.owing.satang, f))), h("span.small.muted", ui.fmt(d.owing.n) + " บิล · ยอดค้างทั้งหมด ณ " + ui.thDay(d.today))),
      h("div.card", h("div.row", h("b.grow", "เงินเข้าวันนี้"), h("span.small.muted", ui.thDay(d.moneyIn.day) + " · นับตามวันที่ชำระ")),
        ch.length ? h("div.kv", ch.map(c => h("div", h("div.lbl", c.channel), h("b", ui.money(c.satang, f))))) : h("span.muted", f ? "ยังไม่มีเงินเข้าวันนี้" : "—")));
  });
}
export default {
  code: "account", title: "บัญชี",
  nav: [
    { key: "check", label: "ตรวจ", icon: "check", title: "งานที่รอตรวจ" },
    { key: "owing", label: "ลูกหนี้", icon: "list" },
    { key: "money", label: "เงินเข้า", icon: "bank" },
  ],
  views: { check: accountHome },
};
