// ทีมสกรีนสี — หน้าแรก "คิวสกรีน" เรียงตามวันส่ง · ของเดิม: แตะทีม → แตะเสร็จ (สองแตะจบ · ลงจำนวนได้แต่ไม่บังคับ)
import { soonBtn } from "./shared.js";
export default {
  code: "screen", title: "ทีมสกรีนสี",
  nav: [
    { key: "queue", label: "คิว", icon: "list", title: "คิวสกรีน" },
    { key: "done", label: "เสร็จวันนี้", icon: "check" },
    { key: "history", label: "ประวัติ", icon: "clock" },
  ],
  views: {
    queue(ctx, view) {
      const { h, ui } = ctx;
      return ctx.load(view, "queue", "home.screen", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.stack.jobs")); }
        const first = d.jobs.find(j => j.due_day);
        box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(d.jobs.length)), h("span.muted.grow", "งานรอ" + (first ? " · ส่งเร็วสุด " + ui.thDay(first.due_day) : "")), h("span", "เสร็จวันนี้ " + ui.fmt(d.doneToday))), st.fresh ? "" : ui.stamp(st.at, st.updating));
        const teams = (ctx.me && ctx.me.screenTeams) || ["ทีม 1", "ทีม 2", "ทีม 3"];
        ui.renderList(box.querySelector(".jobs"), d.jobs, j => j.id, j => h("div.card",
          h("div.row", h("span.name.grow", j.customer), j.late ? ui.pill("เลยกำหนด " + ui.thDay(j.due_day), "bad", "alert") : j.due_day === d.today ? ui.pill("ส่งวันนี้", "warn") : j.due_day ? ui.pill("ส่ง " + ui.thDay(j.due_day), "mute", "calendar") : null),
          h("div.row", ui.qty([j.size, j.color].filter(Boolean).join(" ") || j.label, j.bags && j.per_bag ? j.bags : j.qty_pcs, j.bags && j.per_bag ? "ถุง" : "ใบ"), j.colors ? h("span.muted", "สกรีน " + j.colors) : null, j.team ? ui.pill(j.team, "brand", "users") : null),
          h("div.btns", teams.map(t => soonBtn(t, null, j.team === t ? ".pri" : "")), soonBtn("เสร็จ", "check", ".ok"))), ui.empty("ไม่มีงานค้าง", "งานสกรีนใหม่จะขึ้นที่นี่เมื่อออฟฟิศลงออเดอร์ที่มีสกรีน"));
      });
    },
  },
};
