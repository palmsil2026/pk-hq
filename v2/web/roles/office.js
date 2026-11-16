// ออฟฟิศ — หน้าแรก "งานที่รอวันนี้" (คิวทุกขั้น + รายการ) · แชทโมดูลออฟฟิศเติม: ลงออเดอร์ · ออเดอร์ · ลูกค้า · ส่งของ · สต๊อก
import { orderRow, orderSheet } from "./shared.js";
export default {
  code: "office", title: "ออฟฟิศ",
  nav: [
    { key: "home", label: "งาน", icon: "home", title: "งานที่รอวันนี้" },
    { key: "orders", label: "ออเดอร์", icon: "list" },
    { key: "customers", label: "ลูกค้า", icon: "users" },
    { key: "deliver", label: "ส่งของ", icon: "truck" },
    { key: "stock", label: "สต๊อก", icon: "box" },
  ],
  fab: { label: "ลงออเดอร์", run: ctx => { const s = ctx.ui.sheet({ title: "ลงออเดอร์" }); s.body.append(ctx.ui.empty("หน้าลงออเดอร์กำลังทำ", "ระหว่างนี้ลงในแอปเดิมไปก่อน")); } },
  views: {
    home(ctx, view) {
      const { h, ui } = ctx;
      let filter = "";
      return ctx.load(view, "home", "home.office", (box, d, st) => {
        if (!box.dataset.built) {
          box.dataset.built = "1";
          box.append(h("div.row", h("span.muted.grow", "วันนี้ " + ui.thDay(d.today)), h("span.stamp-slot")), h("div.queues", { role: "group", "aria-label": "คิวงาน" }), h("div.lbl.listlbl"), h("div.stack.orders"));
        }
        box.querySelector(".stamp-slot").replaceChildren(st.fresh ? "" : ui.stamp(st.at, st.updating));
        const keyOf = { prod: ["รอผลิต", "กำลังผลิต"], screen: ["รอสกรีน", "กำลังสกรีน"], deliver: ["พร้อมส่ง", "ส่งบางส่วน"] };
        const draw = () => {
          box.querySelector(".queues").replaceChildren(...d.queues.map(q => h("button.queue", { type: "button", "aria-pressed": String(filter === q.key),
            onclick: () => { filter = filter === q.key ? "" : q.key; draw(); } }, h("span", q.label), h("b", { style: q.tone === "warn" && q.n ? { color: "var(--warn-ink)" } : null }, ui.fmt(q.n)))));
          let list = d.orders;
          if (filter === "new") list = list.filter(o => o.order_day === d.today);
          else if (keyOf[filter]) list = list.filter(o => keyOf[filter].includes(o.status));
          box.querySelector(".listlbl").textContent = filter === "money" ? "ค้างเงิน — ดูในแอปบัญชี" : (filter ? d.queues.find(q => q.key === filter).label : "ออเดอร์ที่ยังไม่จบ") + " · " + list.length + " ใบ";
          ui.renderList(box.querySelector(".orders"), filter === "money" ? [] : list, o => o.id, o => orderRow(ctx, o, x => orderSheet(ctx, x), d.today), ui.empty());
        };
        draw();
      });
    },
  },
};
