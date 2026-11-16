// ประธาน/คุณปาล์ม — หน้าแรก "เรื่องที่ต้องตัดสินใจ" (ธงทุกทีม) → ภาพรวมวันนี้ · ระบบหาข้อยกเว้น คนตัดสิน
import { floorView } from "./shared.js";
import { accountHome } from "./account.js";
const TEAM = { office: "ออฟฟิศ", prod: "ทีมผลิต", screen: "ทีมสกรีน", deliver: "ส่งของ", account: "บัญชี", exec: "ประธาน", "": "ระบบ" };
export default {
  code: "exec", title: "ประธาน",
  nav: [
    { key: "today", label: "วันนี้", icon: "home", title: "เรื่องที่ต้องตัดสินใจ" },
    { key: "floor", label: "แผนผัง", icon: "map", title: "แผนผังโรงงาน" },
    { key: "money", label: "เงิน", icon: "coin" },
    { key: "price", label: "ราคา", icon: "tag" },
    { key: "team", label: "ทีม", icon: "users", title: "ทีม · นำเข้าข้อมูล" },
  ],
  views: {
    today(ctx, view) {
      const { h, ui } = ctx;
      return ctx.load(view, "today", "home.exec", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.lbl.fl"), h("div.stack.flags"), h("div.lbl", "ภาพรวมวันนี้"), h("div.kv.sum")); }
        box.querySelector(".fl").replaceChildren("เรื่องที่ต้องตัดสินใจ · " + d.flags.length, st.fresh ? "" : " ", st.fresh ? "" : ui.stamp(st.at, st.updating));
        ui.renderList(box.querySelector(".flags"), d.flags, f => f.id + ":" + f.version, f => h("div.card",
          h("div.row", ui.statusPill(ctx.vocab, "flags.kind", f.kind), f.severity === "ด่วน" ? ui.pill("ด่วน", "bad", "alert") : null, h("span.r.small.muted", TEAM[f.team] + " · " + ui.thDayOf(f.at) + " " + ui.thTime(f.at))),
          h("b", f.title), f.detail ? h("span.muted", f.detail) : null,
          h("div.btns",
            h("button.btn", { type: "button", onclick: () => ctx.save("flag.resolve", { id: f.id, version: f.version, status: "รับทราบ" }, { label: "รับทราบ: " + f.title, after: () => ctx.refresh() }).catch(() => {}) }, "รับทราบ"),
            h("button.btn.pri", { type: "button", onclick: () => ctx.save("flag.resolve", { id: f.id, version: f.version, status: "ปิด" }, { label: "ปิดเรื่อง: " + f.title, after: () => ctx.refresh(),
              confirm: { title: "ปิดเรื่องนี้", detail: f.title, reasons: ["ตรวจแล้ว ถูกต้อง", "แก้แล้ว", "ไม่ต้องทำอะไร"], need: "optional", okText: "ปิดเรื่อง" } }).catch(() => {}) }, "ปิดเรื่อง"))),
          ui.empty("ไม่มีเรื่องต้องตัดสินใจ"));
        box.querySelector(".sum").replaceChildren(
          h("div.card", h("span.muted", "ผลิตได้ (ดี)"), h("span.big", ui.fmt(d.made.good)), h("span.small.muted", "ใบ · รอบที่ปิดวันนี้ " + ui.thDay(d.today))),
          h("div.card", h("span.muted", "เกรด B / เสีย"), h("span.big.md", ui.fmt(d.made.b) + " / " + ui.fmt(d.made.waste)), h("span.small.muted", "ใบ · วันนี้")),
          h("div.card", h("span.muted", "เครื่องเดิน"), h("span.big", { style: { color: "var(--ok)" } }, ui.fmt(d.machines.running) + "/" + ui.fmt(d.machines.total)), h("span.small.muted", "ตอนนี้")));
      });
    },
    floor: (ctx, view) => floorView(ctx, view),
    money: accountHome,
    async team(ctx, view) {
      const { h, ui, api } = ctx;
      view.append(h("div.lbl", "นำเข้าข้อมูลจากชีตเดิม (อ่านอย่างเดียว · กดซ้ำได้ไม่เบิ้ล)"));
      const box = h("div.stack"); view.append(box);
      let d;
      try { d = await api.read("import.sources"); } catch (e) { box.append(ui.errorBox(e.message)); return; }
      if (!d.bridge.gas || !d.bridge.key) box.append(h("div.banner.t-warn", ui.icon("alert"), "ยังไม่ได้ต่อสะพาน Google — นำเข้าได้เฉพาะทะเบียนสินค้า/เครื่องจักร"));
      d.sources.forEach(s => {
        const btn = h("button.btn" + (s.local || (d.bridge.gas && d.bridge.key) ? "" : ""), { type: "button" }, ui.icon("download", "sm"), "นำเข้า");
        const st = h("span.small.muted", s.last ? s.last.status + " · " + ui.thDayOf(s.last.started_at) + " " + ui.thTime(s.last.started_at) + " · ใหม่ " + ui.fmt(s.last.inserted) + " · อัปเดต " + ui.fmt(s.last.updated) : "ยังไม่เคยนำเข้า");
        btn.addEventListener("click", () => ui.busy(btn, async () => {
          let cursor = "0", run = "", n = 0, last;
          try {
            do { last = (await api.write("import.run", { source: s.source, cursor, run })).data; run = last.run; cursor = last.next; n++; st.textContent = "กำลังนำเข้า… หน้า " + n; } while (cursor !== null && n < 500);
            st.textContent = last.status + " · หน้า " + n + (last.problems.length ? " · " + last.problems[0] : "");
          } catch (e) { st.textContent = "ไม่สำเร็จ: " + e.message; }
        }));
        box.append(h("div.card", h("div.row", h("b.grow", s.label), btn), st));
      });
    },
  },
};
