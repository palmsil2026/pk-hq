// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ (คอมจอใหญ่ + มือถือ) — แทน AppSheet "รับออเดอร์" + "Office"                            v2/web/roles/office.js
//  หน้าแรก = งานที่รอ: คิว ออเดอร์ใหม่ · รอผลิต · รอสกรีน · รอส่ง · ค้างเงิน (ตัวเลขใหญ่) → แตะคิวเปลี่ยนรายการ → แตะรายการเปิดรายละเอียด
//  คอม ≥1100: แถบซ้าย + รายการ + แผงรายละเอียดขวา · มือถือ: เมนูล่าง + ปุ่ม ＋ ลงออเดอร์ มุมขวาล่าง
//  แถวออเดอร์ไม่โชว์ยอดเงิน (สินค้าคร่าว ๆ บรรทัดละรายการ + วันส่ง + ชื่องาน) · ไม่มีรหัสระบบบนจอ
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, useCss, n0, thDayLong, addDay, todayTh, dueWords, seg, baht } from "../parts/kit.js";
import { orderCard } from "../parts/order-card.js";
import { orderFormView } from "./office-order-form.js";
import { openOrderIn } from "./office-order-detail.js";
import { customersView } from "./office-customers.js";
import { isWide } from "./office-data.js";
const { h, icon } = ui;
useCss("../roles/office.css");

const QUEUE_OF = { new: ["ออเดอร์ใหม่"], prod: ["รอผลิต", "กำลังผลิต"], screen: ["รอสกรีน", "กำลังสกรีน"], deliver: ["พร้อมส่ง", "ส่งบางส่วน"] };
const mark = (view, key) => { document.body.dataset.view = "office-" + key; };

/** รายการ + แผงรายละเอียด: แตะการ์ด = เปิดรายละเอียด (คอมเปิดในแผงขวา · มือถือเป็นแผ่นล่าง) */
function master(ctx, onChanged) {
  const panel = h("aside.md-detail", { "aria-label": "รายละเอียด" }, h("p.panel-empty", "แตะออเดอร์เพื่อดูรายละเอียด"));
  let cur = "";
  const open = (id, listBox) => {
    cur = id;
    if (listBox) listBox.querySelectorAll(".ocard").forEach(c => c.setAttribute("aria-current", String(c.dataset.id === id)));
    openOrderIn(ctx, panel, id, onChanged);
  };
  return { panel, open, get cur() { return cur; } };
}

export default {
  code: "office", title: "ออฟฟิศ",
  nav: [
    { key: "home", label: "งาน", icon: "home", title: "งานที่รอวันนี้" },
    { key: "orders", label: "ออเดอร์", icon: "list", title: "ออเดอร์ทั้งหมด" },
    { key: "customers", label: "ลูกค้า", icon: "users", title: "ลูกค้า" },
    { key: "deliver", label: "ส่งของ", icon: "truck", title: "คิวส่งของ" },
    { key: "stock", label: "สต๊อก", icon: "box", title: "สต๊อก (ดูอย่างเดียว)" },
  ],
  pages: { new: { title: "ลงออเดอร์", nav: "" } },
  fab: { label: "ลงออเดอร์", run: ctx => ctx.go("new") },
  views: {
    new(ctx, view, n) { mark(view, "new"); if (/^edit:/.test(n.arg || "")) document.querySelector(".top h1").textContent = "แก้ออเดอร์"; return orderFormView(ctx, view, n); },

    // ── หน้าแรก: งานที่รอ ──────────────────────────────────────────────
    home(ctx, view) {
      mark(view, "home");
      let filter = ctx.api.store.get("office.q") || "";
      let data = null, lastSt = null;
      // หลังกดงานในแผงรายละเอียด: ดึงคิวใหม่แล้ววาดเฉพาะที่เปลี่ยน (แผงขวายังเปิดออเดอร์เดิมอยู่)
      const reload = async () => { try { data = await ctx.api.read("office.home"); ctx.api.viewCache.set("office.home", data); draw({ fresh: true }); } catch (e) { ui.toast(e.message, "bad"); } };
      const M = master(ctx, reload);
      const head = h("div.row"), queues = h("div.queues.big", { role: "group", "aria-label": "คิวงาน" }), lbl = h("div.lbl"), list = h("div.stack.orders"), note = h("div");
      view.append(head, queues, h("div.md", h("div.stack", lbl, note, list), M.panel));
      const draw = st => {
        const d = data;
        put(head, h("span.muted.grow", "วันนี้ " + thDayLong(d.today) + " · ลงวันนี้ " + n0(d.takenToday) + " ใบ"), st && !st.fresh ? ui.stamp(st.at, st.updating) : null);
        put(queues, ...d.queues.map(q => h("button.queue" + (q.tone === "warn" && q.n ? ".hot" : ""), { type: "button", "aria-pressed": String(filter === q.key), onclick: () => { filter = filter === q.key ? "" : q.key; ctx.api.store.set("office.q", filter); draw(st); } },
          h("span", q.label), h("b", n0(q.n)), q.hint ? h("small", q.hint) : null)));
        let rows = d.orders;
        if (QUEUE_OF[filter]) rows = rows.filter(o => QUEUE_OF[filter].includes(o.status));
        else if (filter === "money") rows = rows.filter(o => o.money);
        else rows = rows.filter(o => o.status !== "ส่งแล้ว" && o.status !== "ยกเลิก");
        const q = d.queues.find(x => x.key === filter);
        lbl.textContent = (q ? q.label + (q.hint ? " (" + q.hint + ")" : "") : "ออเดอร์ที่ยังไม่จบ") + " · " + n0(rows.length) + " ใบ";
        put(note, filter === "money" && d.acctOwing ? h("p.hint", "บิลค้างจากชีทบัญชี (ไม่ผูกออเดอร์) อีก " + n0(d.acctOwing) + " ใบ — ดูรายร้านในหน้าลูกค้า") : null);
        ui.renderList(list, rows, o => o.id, o => orderCard(ctx, o, x => M.open(x.id, list), { today: d.today, current: o.id === M.cur }),
          ui.empty(filter ? "ไม่มีงานในคิวนี้" : "ไม่มีงานค้าง", filter ? "แตะคิวเดิมอีกครั้งเพื่อดูทั้งหมด" : ""));
      };
      return ctx.load(view, "home", "office.home", (box, d, st) => { data = d; lastSt = st; box.remove(); draw(st); });
    },

    // ── ออเดอร์ทั้งหมด: ค้น/กรอง (รวมที่จบแล้ว + ประวัติแอปเดิม) ทีละหน้า ────────────────────
    orders(ctx, view, n) {
      mark(view, "orders");
      let q = "", group = "open", next = null, rows = [], seq = 0;
      const M = master(ctx, () => load());
      const search = h("input", { type: "search", placeholder: "ค้นร้าน · ชื่องาน · สินค้า · หมายเหตุ", "aria-label": "ค้นออเดอร์" });
      let t = 0;
      search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(); }, 300); });
      const groups = seg([["open", "ยังไม่จบ"], ["done", "ส่งแล้ว"], ["cancel", "ยกเลิก"], ["all", "ทั้งหมด"]], group, v => { group = v || "open"; load(); }, { label: "กลุ่มออเดอร์" });
      const list = h("div.stack.orders"), lbl = h("div.lbl"), moreBtn = h("button.btn", { type: "button", hidden: true, onclick: e => ui.busy(e.currentTarget, () => load(true)) }, "โหลดเพิ่ม");
      const status = h("div");
      view.append(h("div.cpick", h("div.inp", icon("search", "sm"), search)), groups, status, h("div.md", h("div.stack", lbl, list, moreBtn), M.panel));
      async function load(more) {
        const my = ++seq;
        if (!more) { next = null; put(list, ui.skeleton(3)); }
        let d;
        try { d = await ctx.api.read("office.orders", { q, group, before: more ? next : "", limit: 40 }); }
        catch (e) { put(status, ui.errorBox("โหลดไม่สำเร็จ: " + e.message, () => load(more))); return; }
        if (my !== seq) return;
        put(status);
        rows = more ? rows.concat(d.orders) : d.orders;
        next = d.next;
        lbl.textContent = n0(rows.length) + (next ? "+" : "") + " ใบ" + (q ? " · ค้น \"" + q + "\"" : "");
        ui.renderList(list, rows, o => o.id, o => orderCard(ctx, o, x => M.open(x.id, list), { today: d.today, maxItems: 3, current: o.id === M.cur }), ui.empty("ไม่พบออเดอร์", q ? "ลองคำสั้นลง หรือเลือก \"ทั้งหมด\"" : ""));
        moreBtn.hidden = !next;
      }
      load();
      if (n.arg) M.open(n.arg, list);
    },

    customers(ctx, view, n) { mark(view, "customers"); return customersView(ctx, view, n); },

    // ── คิวส่งของ (ดู + ลูกค้ามารับ): ตามวันส่ง → สายส่ง ─────────────────────────────
    deliver(ctx, view) {
      mark(view, "deliver");
      let paint = null;
      const M = master(ctx, async () => { try { const d = await ctx.api.read("office.home"); ctx.api.viewCache.set("office.home", d); if (paint) paint(d); } catch (e) { ui.toast(e.message, "bad"); } });
      return ctx.load(view, "home", "office.home", (box, d0, st0) => { paint = d => drawDeliver(box, d, { fresh: true }); drawDeliver(box, d0, st0); });
      function drawDeliver(box, d, st) {
        const today = d.today, tom = addDay(today, 1);
        const open = d.orders.filter(o => !["ออเดอร์ใหม่", "ส่งแล้ว", "ยกเลิก"].includes(o.status));
        const bucket = o => !o.due_day ? "none" : o.due_day < today ? "late" : o.due_day === today ? "today" : o.due_day === tom ? "tom" : "later";
        const B = [["late", "เลยกำหนด"], ["today", "วันนี้ " + thDayLong(today)], ["tom", "พรุ่งนี้ " + thDayLong(tom)], ["later", "ถัดไป"], ["none", "ยังไม่กำหนดวันส่ง"]];
        const ready = open.filter(o => o.status === "พร้อมส่ง" || o.status === "ส่งบางส่วน").length;
        const list = h("div.tl");
        for (const [k, label] of B) {
          const rows = open.filter(o => bucket(o) === k);
          if (!rows.length) continue;
          const routes = {};
          rows.forEach(o => { (routes[o.route_code || "ไม่มีสาย"] = routes[o.route_code || "ไม่มีสาย"] || []).push(o); });
          list.append(h("section" + (k === "late" ? ".late" : ""), h("div.lbl", label + " · " + rows.length + " ร้าน"),
            ...Object.keys(routes).sort().map(r => h("div.stack", h("div.small.muted", r === "ไม่มีสาย" ? "ยังไม่มีสาย" : "สาย " + r), h("div.stack.orders", routes[r].map(o => orderCard(ctx, o, x => M.open(x.id, list), { today, maxItems: 3 })))))));
        }
        put(box, h("div.row", h("span.big.md", n0(ready)), h("span.muted.grow", "ร้านพร้อมส่ง · ทั้งหมดในคิว " + n0(open.length) + " ร้าน"), st.fresh ? null : ui.stamp(st.at, st.updating)),
          h("p.hint", "ขึ้นรถ/ส่งแล้วบันทึกในแอปทีมส่งของ · ลูกค้ามารับเองที่โรงงาน กดในรายละเอียดออเดอร์"),
          h("div.md", open.length ? list : ui.empty("ไม่มีของรอส่ง"), M.panel));
      }
    },

    // ── สต๊อก (ดูอย่างเดียว · A แยก B) เทียบของที่ต้องส่ง ───────────────────────────────
    stock(ctx, view) {
      mark(view, "stock");
      let q = "", only = "";
      return ctx.load(view, "stock", "office.stock", (box, d, st) => {
        const search = h("input", { type: "search", placeholder: "ค้นสินค้า", "aria-label": "ค้นสินค้า", value: q });
        const types = [...new Set(d.rows.map(r => r.type).filter(Boolean))];
        const chips = seg([["", "ทั้งหมด"], ["short", "ไม่พอส่ง"], ...types.map(t => [t, t])], only, v => { only = v || ""; draw(); }, { label: "กรองสต๊อก" });
        const tableBox = h("div");
        const draw = () => {
          let rows = d.rows;
          if (q) rows = rows.filter(r => String(r.label).includes(q) || String(r.item_key).includes(q));
          if (only === "short") rows = rows.filter(r => r.short > 0); else if (only) rows = rows.filter(r => r.type === only);
          const pill = r => (r.need ? (r.short > 0 ? ui.pill("ขาด " + n0(r.short), "bad", "alert") : ui.pill("พอส่ง", "ok", "check")) : ui.pill("ไม่มีออเดอร์รอ", "mute"));
          const name = r => (r.label || r.item_key.slice(5).replace(/\|+/g, " ")) + (r.item_key.includes("|สกรีน ") ? "" : "");
          put(tableBox, 
            h("table.ntable", h("thead", h("tr", h("th", "สินค้า"), h("th", "เกรด A"), h("th", "เกรด B"), h("th", "ต้องส่ง (ค้าง)"), h("th", ""))),
              h("tbody", rows.map(r => h("tr", h("td", name(r), r.soonest ? h("div.small.muted", "ส่งเร็วสุด " + thDayLong(r.soonest) + " · " + r.orders + " ออเดอร์") : null),
                h("td", h("b", n0(r.a))), h("td", r.b ? n0(r.b) : "—"), h("td", r.need ? n0(r.need) : "—"), h("td", pill(r)))))),
            h("div.stack.stock-cards", rows.map(r => h("div.card", h("div.row", h("b.grow", name(r)), pill(r)),
              h("div.row", ui.qty("เกรด A", r.a, "ใบ"), r.b ? ui.qty("เกรด B", r.b, "ใบ") : null, r.need ? ui.qty("ต้องส่ง", r.need, "ใบ") : null)))),
            rows.length ? null : ui.empty("ไม่มีรายการ"));
        };
        search.addEventListener("input", () => { q = search.value.trim(); draw(); });
        put(box, 
          d.started ? null : h("div.banner.t-warn", icon("alert"), h("span", "ระบบใหม่ยังไม่เริ่มนับสต๊อก (ทีมผลิตจะลง \"ยอดยกมา\" ตอนย้ายมา) — ตอนนี้เห็นแค่ของที่ต้องส่ง")),
          h("div.row", h("span.muted.grow", "เกรด B แยกจากของดีเสมอ · ต้องส่ง = ค้างในออเดอร์ที่ยังไม่จบ"), st.fresh ? null : ui.stamp(st.at, st.updating)),
          h("div.cpick", h("div.inp", icon("search", "sm"), search)), chips, tableBox);
        draw();
      });
    },
  },
};
