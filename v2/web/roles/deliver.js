// ส่งของ — หน้าแรก "เส้นทางวันนี้": เลยกำหนด → วันนี้ → พรุ่งนี้ → ถัดไป · ในวันแยกตามสาย
import { soonBtn } from "./shared.js";
const GROUPS = [["late", "เลยกำหนด", true], ["today", "วันนี้"], ["tomorrow", "พรุ่งนี้"], ["later", "ถัดไป"]];
export default {
  code: "deliver", title: "ส่งของ",
  nav: [
    { key: "route", label: "เส้นทาง", icon: "route", title: "เส้นทางวันนี้" },
    { key: "truck", label: "บนรถ", icon: "truck" },
    { key: "done", label: "ส่งแล้ว", icon: "check" },
  ],
  views: {
    route(ctx, view) {
      const { h, ui } = ctx;
      return ctx.load(view, "route", "home.deliver", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.tl")); }
        box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(d.stops)), h("span.muted", "ร้านต้องส่ง · บนรถแล้ว " + ui.fmt(d.onTruck))), st.fresh ? "" : ui.stamp(st.at, st.updating));
        const tl = box.querySelector(".tl");
        if (!d.stops) { tl.replaceChildren(ui.empty("ไม่มีงานค้าง", "ไม่มีของต้องส่งวันนี้และพรุ่งนี้")); return; }
        tl.replaceChildren(...GROUPS.filter(([k]) => d.groups[k].length).map(([k, label, late]) => {
          const byRoute = {};
          d.groups[k].forEach(o => { (byRoute[o.route_code || "ไม่มีสาย"] = byRoute[o.route_code || "ไม่มีสาย"] || []).push(o); });
          return h("section" + (late ? ".late" : ""), h("div.lbl", { style: late ? { color: "var(--bad)" } : null }, label + " " + d.groups[k].length + " ร้าน"),
            Object.keys(byRoute).sort().map(r => h("div.stack", h("div.small.muted", r === "ไม่มีสาย" ? r : "สาย " + r),
              byRoute[r].map(o => h("div.card",
                h("div.row", h("span.name.grow", o.customer), o.on_truck_pcs ? ui.pill("บนรถ", "brand", "truck") : o.ready ? ui.pill("พร้อมส่ง", "ok") : ui.statusPill(ctx.vocab, "orders.status", o.status)),
                h("div.items", (o.items || []).slice(0, 3).map(ui.itemQty)),
                h("div.btns", soonBtn("ส่งไม่ได้", "x-circle"), soonBtn("ส่งแล้ว", "check", ".ok")))))));
        }));
      });
    },
  },
};
