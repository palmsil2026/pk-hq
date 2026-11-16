// ประธาน/คุณปาล์ม (?app=exec) — หน้าแรก "เรื่องที่ต้องตัดสินใจ" (ธงทุกทีม + คนใหม่ในรายชื่อ) → ภาพรวมวันนี้ · ระบบหาข้อยกเว้น คนตัดสิน
//   เมนู: วันนี้ · แผนผัง (ดูอย่างเดียว) · เงิน · ราคา · ทีม (PIN/พักงาน ผ่าน Google — PIN ไม่ขึ้น Cloudflare) · ไม่มีรายงานรายวันที่ไม่มีเรื่องให้ตัดสิน
import { floorView } from "./floor.js";   // แผนผังจริงของทีมผลิต (ผังโรง 1/โรง 2 · เครื่องเดิน X/12 เลขเดียวกับหน้าทีมผลิต) แบบดูอย่างเดียว
import { thText, moneyInView, owingView, billSheet, syncButton, syncLine, moneyPad, chLabel } from "./money.js";

const TEAM = { office: "ออฟฟิศ", prod: "ทีมผลิต", screen: "ทีมสกรีน", deliver: "ส่งของ", account: "บัญชี", exec: "ประธาน", "": "ระบบ" };
const APP_OF = { bills: "account", statements: "account", machines: "prod", machine_runs: "prod", machine_events: "prod", production_jobs: "prod", orders: "office", customers: "office", screen_jobs: "screen", delivery_loads: "deliver", delivery_trips: "deliver" };
const CAT = { BOT: "ขวด", CAP: "ฝา", FLM: "ฟิล์ม", TNK: "ถัง/แกลลอน", CUP: "ถ้วย", MSC: "อื่น ๆ" };
const DEPTS = ["ออฟฟิศ", "ผลิต", "สกรีน", "ส่งของ", "บัญชี", "บริหาร"];
const baht = s => (s === null || s === undefined ? "—" : "฿" + (s / 100).toLocaleString("th-TH", { minimumFractionDigits: s % 100 ? 2 : 0, maximumFractionDigits: 2 }));

// ── วันนี้: เรื่องที่ต้องตัดสินใจ → ภาพรวม ─────────────────────────────────────────────
function today(ctx, view) {
  const { h, ui } = ctx;
  return ctx.load(view, "today", "home.exec", (box, d, st) => {
    const f = st.fresh, refresh = () => ctx.refresh();
    const groups = new Map();
    d.flags.forEach(x => { if (!groups.has(x.kind)) groups.set(x.kind, []); groups.get(x.kind).push(x); });
    const n = d.flags.length + (d.newStaff.length ? 1 : 0);
    const decide = h("div.stack");
    if (d.newStaff.length) decide.append(h("section.card", { "aria-label": "คนใหม่ในรายชื่อ" },
      h("div.row", ui.pill("คนใหม่ในรายชื่อ", "warn", "users"), h("span.small.muted.r", "ยังไม่ได้ยืนยัน")),
      h("b", d.newStaff.length + " คนเข้ารายชื่อโดยไม่ได้ผ่านประธาน"),
      h("span.small", d.newStaff.map(s => s.nick + (s.dept_th ? " (" + s.dept_th + ")" : "")).join(" · ")),
      h("span.small.muted", "มาจากชีต Staff (นำเข้า) หรือเข้าแอปครั้งแรก — ถ้าไม่รู้จัก ให้พักงานที่หน้าทีม"),
      h("div.btns", h("button.btn", { type: "button", onclick: () => ctx.go("team") }, "ดูที่หน้าทีม"),
        h("button.btn.pri", { type: "button", onclick: () => ctx.save("exec.staff_ack", { ids: d.newStaff.map(s => s.id) }, { label: "ยืนยัน " + d.newStaff.length + " คน", after: refresh }).catch(() => {}) }, "ยืนยันว่ารู้จัก"))));
    for (const [kind, list] of groups) {
      decide.append(h("div.lbl", kind + " · " + list.length));
      const box2 = h("div.stack.flags");
      ui.renderList(box2, list, x => x.id + ":" + x.version, x => flagCard(ctx, x, refresh));
      decide.append(box2);
    }
    if (!n) decide.append(ui.empty("ไม่มีเรื่องต้องตัดสินใจ"));
    const o = d.orders, m = d.machines, dl = d.deliver;
    const tile = (label, big, sub, onclick, color) => h("button.card", { type: "button", onclick }, h("span.muted", label), h("span.big.md", { style: color ? { color } : null }, big), sub ? h("span.small.muted", sub) : null);
    const app = r => () => { location.href = "?app=" + r; };
    const sum = h("div.kv",
      tile("เครื่องเดิน", ui.fmt(m.running) + "/" + ui.fmt(m.total), m.stopped ? "จอดอยู่ " + m.stopped + " เครื่อง · ตอนนี้" : "ตอนนี้", () => ctx.go("floor"), "var(--ok)"),
      tile("ผลิตได้ (ดี)", ui.fmt(d.made.good), "ใบ · เกรด B " + ui.fmt(d.made.b) + " · เสีย " + ui.fmt(d.made.waste) + " · " + thText(d.made.period), () => ctx.go("floor")),
      tile("ออเดอร์รอ", ui.fmt(o.waitProd + o.waitScreen + o.waitSend), "รอผลิต " + o.waitProd + " · รอสกรีน " + o.waitScreen + " · รอส่ง " + o.waitSend + (o.urgent ? " · ด่วน " + o.urgent : "") + (o.late ? " · เลยกำหนด " + o.late : ""), app("office")),
      tile("ส่งวันนี้", ui.fmt(dl.dueToday), "ร้านที่กำหนดส่งวันนี้ · พร้อม " + dl.readyToday + " · ส่งแล้ว " + dl.deliveredOrders + " ร้าน", app("deliver")),
      tile("เงินเข้าวันนี้", ui.money(d.moneyIn.total, f), (d.moneyIn.byChannel.length ? d.moneyIn.byChannel.map(c => chLabel(ctx, c.channel) + " " + ui.money(c.satang, f)).join(" · ") + " · " : "") + thText(d.moneyIn.period), () => ctx.go("money")),
      tile("ค้างชำระทั้งหมด", ui.money(d.owing.satang, f), ui.fmt(d.owing.n) + " บิล · " + thText(d.owing.period), () => ctx.go("money")));
    box.replaceChildren(h("div.wide-2.stack",
      h("div.stack", h("div.lbl.fl", "เรื่องที่ต้องตัดสินใจ · " + n, st.fresh ? "" : " ", st.fresh ? "" : ui.stamp(st.at, st.updating)), decide),
      h("div.stack", h("div.lbl", "ภาพรวมวันนี้ " + ui.thDay(d.today)), sum, h("p.small", syncLine(d.acctSync, true)))));
  });
}
function flagCard(ctx, x, refresh) {
  const { h, ui } = ctx;
  return h("div.card",
    h("button.tap", { type: "button", onclick: () => flagSheet(ctx, x, refresh), "aria-label": "เปิดเรื่อง " + x.title },
      h("div.row", ui.statusPill(ctx.vocab, "flags.kind", x.kind), x.severity === "ด่วน" ? ui.pill("ด่วน", "bad", "alert") : null, h("span.r.small.muted", TEAM[x.team] + " · " + ui.thDayOf(x.at) + " " + ui.thTime(x.at))),
      h("b", x.title), x.detail ? h("span.muted", x.detail) : null),
    h("div.btns",
      h("button.btn", { type: "button", onclick: () => ctx.save("flag.resolve", { id: x.id, version: x.version, status: "รับทราบ" }, { label: "รับทราบ: " + x.title, after: refresh }).catch(() => {}) }, "รับทราบ"),
      h("button.btn.pri", { type: "button", onclick: () => ctx.save("flag.resolve", { id: x.id, version: x.version, status: "ปิด" }, { label: "ปิดเรื่อง: " + x.title, after: refresh,
        confirm: { title: "ปิดเรื่องนี้", detail: x.title, reasons: ctx.reasons("flag_close"), need: "optional", okText: "ปิดเรื่อง" } }).catch(() => {}) }, "ปิดเรื่อง")));
}
async function flagSheet(ctx, x, refresh) {
  const { h, ui, api } = ctx;
  const sh = ui.sheet({ title: x.kind, foot: true });
  sh.body.append(ui.skeleton(2));
  let d;
  try { d = await api.read("exec.flag_detail", { id: x.id }); } catch (e) { sh.body.replaceChildren(ui.errorBox(e.message)); return; }
  const f = d.flag, e = d.entity;
  sh.body.replaceChildren(
    h("div.row", ui.statusPill(ctx.vocab, "flags.status", f.status), f.severity === "ด่วน" ? ui.pill("ด่วน", "bad", "alert") : null, h("span.small.muted", "จาก " + TEAM[f.team] + (f.raised_nick ? " · " + f.raised_nick : "") + " · " + ui.thDayOf(f.at) + " " + ui.thTime(f.at))),
    h("b.title", f.title), f.detail ? h("p", f.detail) : "");
  if (e) {
    const card = h("div.card", h("div.lbl", "เรื่องนี้เกี่ยวกับ"));
    if (e.table === "bills") card.append(h("div.row", h("span.grow", e.customer_name + " · บิล " + ui.thDay(e.bill_day) + (e.paper_no ? " #" + e.paper_no : "")), h("b", ui.money(e.total_satang))), h("span.small.muted", e.src_label + " · " + e.status),
      h("button.btn", { type: "button", onclick: () => billSheet(ctx, e.bill_no, { after: refresh }) }, "เปิดบิล"));
    else if (e.table === "machines" || e.table === "machine_runs") card.append(h("span", (e.name || e.machine || "") + (e.label ? " · " + e.label : "") + " · " + (e.status || "")), h("button.btn", { type: "button", onclick: () => { sh.close(); ctx.go("floor"); } }, "ดูในแผนผัง"));
    else if (e.table === "orders") card.append(h("span", (e.customer || "") + " · สั่ง " + ui.thDay(e.order_day) + (e.due_day ? " · ส่ง " + ui.thDay(e.due_day) : "") + " · " + e.status));
    else if (e.table === "customers") card.append(h("span", e.name + (e.route_code ? " · สาย " + e.route_code : "") + (e.district ? " · " + e.district : "")));
    else if (e.table === "staff") card.append(h("span", e.nick + " · " + (e.dept_th || "ไม่มีแผนก") + " · " + e.status), h("button.btn", { type: "button", onclick: () => { sh.close(); ctx.go("team"); } }, "ดูที่หน้าทีม"));
    sh.body.append(card);
  }
  const appKey = APP_OF[f.entity] || (f.team && f.team !== "exec" ? f.team : "");
  if (appKey) sh.body.append(h("a.btn.ghost", { href: "?app=" + appKey }, "เปิดแอป" + (TEAM[appKey] || "") + " (ทำแทนได้)"));
  if (f.resolution) sh.body.append(h("p.small", "ตัดสิน: " + f.resolution + (f.resolved_nick ? " · " + f.resolved_nick : "")));
  if (d.history.length) sh.body.append(h("details", h("summary.btn.ghost", "ประวัติ " + d.history.length + " รายการ"), h("div.stack", { style: { gap: "4px", marginTop: "8px" } },
    d.history.map(a => h("div.small", h("span.muted", ui.thDayOf(a.at) + " " + ui.thTime(a.at) + " · " + (a.staff_name || "ระบบ") + " · "), a.action + (a.reason ? " — " + a.reason : ""))))));
  sh.body.append(h("p.ref", "รหัสอ้างอิง " + f.id + (f.entity_id ? " · " + f.entity + " " + f.entity_id : "")));
  if (f.status !== "ปิด") sh.foot.append(h("div.btns",
    f.status === "เปิด" ? h("button.btn", { type: "button", onclick: () => ctx.save("flag.resolve", { id: f.id, version: f.version, status: "รับทราบ" }, { label: "รับทราบ: " + f.title, after: () => { sh.close(); refresh(); } }).catch(() => {}) }, "รับทราบ") : null,
    h("button.btn.pri", { type: "button", onclick: () => ctx.save("flag.resolve", { id: f.id, version: f.version, status: "ปิด" }, { label: "ปิดเรื่อง: " + f.title, after: () => { sh.close(); refresh(); },
      confirm: { title: "ตัดสิน/ปิดเรื่อง", detail: f.title, reasons: ctx.reasons("flag_close"), need: "optional", okText: "ปิดเรื่อง" } }).catch(() => {}) }, "ตัดสิน · ปิดเรื่อง")));
}

// ── แผนผัง (ดูอย่างเดียว · ทำแทนได้ในแอปทีมผลิต) ───────────────────────────────────────────
function floor(ctx, view) {
  const { h } = ctx;
  view.append(h("div.banner.t-brand", ctx.icon("map"), h("span", "ดูอย่างเดียว — ถ้าต้องทำแทนทีมผลิต เปิดแอปทีมผลิต"), h("a.btn", { href: "?app=prod" }, "เปิดแอปทีมผลิต")));
  return floorView(ctx, view, { readOnly: true });
}

// ── เงิน (เงินเข้าแยกบัญชี + ลูกหนี้) ──────────────────────────────────────────────────
function money(ctx, view) {
  const { h } = ctx;
  const a = h("div.stack"), b = h("div.stack");
  view.append(h("div.wide-2.stack", h("div.stack", h("div.lbl", "เงินเข้าบัญชีไหน"), a), h("div.stack", h("div.lbl", "ลูกหนี้"), b, h("a.btn.ghost", { href: "?app=account" }, "เปิดแอปบัญชี"))));
  return Promise.all([moneyInView(ctx, a), owingView(ctx, b)]);
}

// ── ราคา (ประธานคนเดียว · ทุกครั้งลงประวัติ · ราคาอ้างอิงจากบิล = อ้างอิงเท่านั้น) ─────────────────────────
function price(ctx, view) {
  const { h, ui } = ctx;
  let q = "";
  return ctx.load(view, "price", "price.list", (box, d, st) => {
    const refresh = () => ctx.refresh();
    const search = h("input", { type: "search", placeholder: "ค้นสินค้า", "aria-label": "ค้นสินค้า", value: q, maxlength: 60 });
    const list = h("div.stack");
    const row = it => h("button.card", { type: "button", onclick: () => priceSheet(ctx, it, d.kinds, refresh) },
      h("div.row", h("span.name.grow", it.label), it.data_status === "รอยืนยัน" ? ui.pill("สเปกรอยืนยัน", "mute") : null),
      h("div.row.small", d.kinds.map(k => it.prices[k] ? h("span", h("span.muted", kindTh(ctx, k) + " "), h("b", baht(it.prices[k].satang))) : h("span.muted", kindTh(ctx, k) + " ยังไม่ตั้ง"))),
      it.ref_satang ? h("span.small.muted", "อ้างอิงจากบิลจริง " + baht(it.ref_satang) + " (ไม่ใช่ราคาตั้ง)") : null);
    const draw = () => {
      const k = q.trim().toLowerCase();
      const items = d.items.filter(it => !k || it.label.toLowerCase().includes(k));
      const specs = d.specs.filter(it => !k || it.label.toLowerCase().includes(k));
      const parts = [];
      if (specs.length || !k) parts.push(h("div.lbl", "ราคาต่อสเปก (ใช้ตอนลงออเดอร์) · " + specs.length), ...specs.map(row));
      for (const cat of Object.keys(CAT)) {
        const xs = items.filter(it => it.category === cat);
        if (xs.length) parts.push(h("div.lbl", CAT[cat] + " · " + xs.length), ...xs.map(row));
      }
      list.replaceChildren(...(parts.length ? parts : [ui.empty("ไม่พบสินค้าที่ค้น")]));
    };
    search.addEventListener("input", () => { q = search.value; draw(); });
    const hist = h("div.stack", { style: { gap: "6px" } }, d.history.length ? d.history.map(x => h("div.small",
      h("b", x.label + " · " + kindTh(ctx, x.kind)), " ", x.old_satang === null ? "ตั้ง " + baht(x.new_satang) : baht(x.old_satang) + " → " + baht(x.new_satang),
      h("span.muted", " · " + (x.by_nick || "") + " · " + ui.thDayOf(x.at) + " " + ui.thTime(x.at) + (x.reason ? " · " + x.reason : "")))) : h("span.muted", "ยังไม่เคยตั้งราคา"));
    box.replaceChildren(st.fresh ? "" : ui.stamp(st.at, st.updating), h("div.wide-2.stack",
      h("div.stack", h("div.row", h("div.field.grow", search), h("button.btn", { type: "button", onclick: () => specPicker(ctx, d, refresh) }, ctx.icon("plus", "sm"), "ราคาต่อสเปก")), list),
      h("section.card", { "aria-label": "ประวัติราคา" }, h("div.sec-h", h("b", "ประวัติราคาล่าสุด")), hist)));
    draw();
  });
}
const kindTh = (ctx, k) => (((ctx.vocab || {})["prices.kind"] || []).find(v => v.value === k) || { label: k.replace(/^ราคา/, "") }).label;
function priceSheet(ctx, it, kinds, refresh) {
  const { h, ui } = ctx;
  const sh = ui.sheet({ title: it.label });
  sh.body.append(it.ref_satang ? h("p.small.muted", "อ้างอิงจากบิลจริง " + baht(it.ref_satang) + " — " + (it.ref_note || "") + " · ระบบไม่ตั้งเป็นราคาขายเอง") : "");
  for (const k of kinds) {
    const cur = it.prices[k];
    sh.body.append(h("div.card", h("div.row", h("span.muted.grow", kindTh(ctx, k)), h("span.big.md", cur ? baht(cur.satang) : "ยังไม่ตั้ง")),
      h("button.btn" + (cur ? "" : ".pri"), { type: "button", onclick: async () => {
        const v = await moneyPad({ title: (cur ? "ปรับ" : "ตั้ง") + "ราคา" + kindTh(ctx, k) + " · " + it.label, label: "ราคาต่อหน่วย", value: cur ? cur.satang : undefined, detail: cur ? "ตอนนี้ " + baht(cur.satang) : "ยังไม่เคยตั้ง" });
        if (v === null) return;
        await ctx.save("price.set", { item_key: it.item_key, kind: k, satang: v, version: cur ? cur.version : 0 }, { label: it.label + " " + kindTh(ctx, k) + " " + baht(v),
          confirm: { title: "ยืนยันราคา" + kindTh(ctx, k), detail: it.label + ": " + (cur ? baht(cur.satang) + " → " : "ตั้ง ") + baht(v) + " (ลงประวัติราคา)", reasons: ctx.reasons("price"), need: "optional", okText: "บันทึกราคา" },
          after: () => { sh.close(); refresh(); } }).catch(() => {});
      } }, cur ? "ปรับราคา" : "ตั้งราคา")));
  }
}
function specPicker(ctx, d, refresh) {
  const { h, ui } = ctx;
  const sh = ui.sheet({ title: "ราคาต่อสเปก" });
  const st = { type: "", size: "", neck: "", shape: "", color: "" };
  const AX = [["neck", "คอขวด"], ["shape", "รูปทรง"], ["color", "สี"]];
  const draw = () => {
    const t = d.spec.types.find(x => x.code === st.type);
    const axes = t ? String(t.axes || "").split(",") : [];
    const chips = (label, items, key) => h("div.stack", { style: { gap: "6px" } }, h("div.lbl", label), h("div.chips", items.map(([v, l]) => h("button.chip", { type: "button", "aria-pressed": String(st[key] === v), onclick: () => { st[key] = v; if (key === "type") { st.size = st.neck = st.shape = st.color = ""; } draw(); } }, l))));
    const parts = [chips("ประเภท", d.spec.types.map(x => [x.code, x.code]), "type")];
    if (t) parts.push(chips("ขนาด", d.spec.sizes.filter(s => s.type === st.type).map(s => [s.size, s.size]), "size"));
    if (t && st.size) for (const [k, th] of AX) if (axes.includes(th)) parts.push(chips(th, [["", "ทุกแบบ"]].concat(d.spec.values.filter(v => v.axis === th).map(v => [v.value, v.value])), k));
    if (t && st.size) {
      const key = "spec:" + [st.type, st.size].concat(AX.map(([k, th]) => axes.includes(th) ? st[k] : "")).join("|");
      const label = [st.type, st.size, st.neck, st.shape, st.color].filter(Boolean).join(" ");
      const ex = d.specs.find(x => x.item_key === key);
      parts.push(h("button.btn.pri.block", { type: "button", onclick: () => { sh.close(); priceSheet(ctx, ex || { item_key: key, label, prices: {} }, d.kinds, refresh); } }, "ตั้งราคา: " + label));
    }
    sh.body.replaceChildren(h("p.small.muted", "แกนที่เลือก \"ทุกแบบ\" = ราคาเดียวกันทุกแบบ (ออฟฟิศเห็นราคานี้ตอนลงออเดอร์)"), ...parts);
  };
  draw();
}

// ── ทีม: รายชื่อ · PIN · พักงาน/เปิดงาน · แผนก · เพิ่มคน (เขียนที่ชีต Staff ผ่าน Google) · นำเข้า · ค่าตั้ง ─────────────────
async function gasStaff(ctx, body) {
  const cfg = window.PK_CONFIG || {};
  const s = ctx.api.session();
  if (!cfg.gasUrl) throw new Error("ยังไม่ได้ตั้งลิงก์ Google ของระบบ — แจ้งผู้ดูแล");
  const rid = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
  let r;
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    const res = await fetch(cfg.gasUrl + (cfg.gasUrl.includes("?") ? "&" : "?") + "action=pkV2Staff", { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ ticket: s && s.ticket, rid }, body)), redirect: "follow", signal: ac.signal });
    clearTimeout(t);
    r = await res.json();
  } catch (e) { throw new Error(e.name === "AbortError" ? "Google ตอบช้าเกิน 30 วิ — ยังไม่แน่ว่าบันทึกแล้วหรือยัง โหลดหน้าทีมใหม่แล้วดูอีกครั้ง" : "ติดต่อ Google ไม่ได้ — เช็คเน็ตแล้วลองอีกครั้ง"); }
  if (!r || !r.ok) { const e = new Error((r && r.error) || "Google ไม่รับคำขอ"); e.needPin = !!(r && r.needPin); throw e; }
  const a = await ctx.api.write("exec.staff_apply", { receipt: r.receipt });   // ขยับในแอปทันที (พักงาน = เข้าไม่ได้ทันที · PIN ใหม่ = ตั๋วเก่าตาย)
  return Object.assign({ sid: r.sid }, a.data);
}
function pinTwice(ctx, title) {
  const { h, ui } = ctx;
  return new Promise(resolve => {
    let first = "", done = null;
    const sh = ui.sheet({ title, modal: true, onClose: () => resolve(done) });
    const step = () => {
      sh.body.replaceChildren(h("p.muted", first ? "ใส่ PIN เดิมอีกครั้งเพื่อยืนยัน" : "ใส่ PIN ใหม่ 4 หลัก (PIN ส่งตรงไป Google — แอปไม่เก็บ)"));
      ui.pinPad(sh.body, async pin => {
        if (!first) { first = pin; step(); return { ok: true }; }
        if (pin !== first) { first = ""; setTimeout(step, 900); return { error: "PIN สองครั้งไม่ตรงกัน — เริ่มใหม่", shake: true }; }
        done = pin; sh.close("ok"); return { ok: true };
      }, { busyText: "…" });
    };
    step();
  });
}
function team(ctx, view) {
  const { h, ui, api } = ctx;
  const listBox = h("div.stack");
  const p1 = ctx.load(listBox, "team", "exec.staff_list", (box, d, st) => {
    const refresh = () => ctx.refresh();
    const groups = [["ทำงาน", d.staff.filter(s => s.status === "ทำงาน")], ["พัก", d.staff.filter(s => s.status === "พัก")], ["ลาออก", d.staff.filter(s => s.status === "ลาออก")]];
    box.replaceChildren(st.fresh ? "" : ui.stamp(st.at, st.updating), h("button.btn.pri", { type: "button", onclick: () => newStaff(ctx, d, refresh) }, ctx.icon("plus", "sm"), "เพิ่มพนักงาน"));
    for (const [label, xs] of groups) {
      if (!xs.length) continue;
      box.append(h("div.lbl", label + " · " + xs.length));
      const list = h("div.stack");
      ui.renderList(list, xs, s => s.id + ":" + s.version, s => h("button.card", { type: "button", onclick: () => staffSheet(ctx, s, d, refresh) },
        h("div.row", h("span.name.grow", s.nick), s.dept_th ? ui.pill(s.dept_th, "mute") : ui.pill("ไม่มีแผนก", "warn")),
        h("div.row.small", h("span.muted.grow", s.name || ""), s.confirmed ? null : ui.pill("ยังไม่ยืนยัน", "warn", "users"), s.has_pin ? null : ui.pill("ยังไม่มี PIN", "warn", "lock"))));
      box.append(list);
    }
    if (d.lastImport) box.append(h("p.small.muted", "นำเข้าพนักงานจากชีตล่าสุด " + ui.thDayOf(d.lastImport.started_at) + " " + ui.thTime(d.lastImport.started_at) + " · " + d.lastImport.status));
  });
  const imp = h("div.stack"), settings = h("div.stack"), acct = h("div.stack");
  view.append(h("div.wide-2.stack", h("div.stack", h("div.lbl", "พนักงาน"), listBox),
    h("div.stack", h("div.lbl", "ชีทบัญชี"), acct, h("div.lbl", "นำเข้าข้อมูลจากชีตเดิม (อ่านอย่างเดียว · กดซ้ำได้ไม่เบิ้ล)"), imp, h("div.lbl", "ค่าตั้ง"), settings)));
  return Promise.all([p1, importBox(ctx, imp), settingsBox(ctx, settings), acctBox(ctx, acct)]);
}
function staffSheet(ctx, s, d, refresh) {
  const { h, ui } = ctx;
  const sh = ui.sheet({ title: s.nick, foot: true });
  const msg = h("div");
  const me = s.id === d.me;
  const run = async (btn, body, label, after) => ui.busy(btn, async () => {
    msg.replaceChildren(h("p.muted", "กำลังบันทึกที่ชีต Staff ผ่าน Google…"));
    try {
      await gasStaff(ctx, body);
      sh.close("ok"); ui.toast("บันทึกแล้ว · " + label);
      if (after) after(); else refresh();
    } catch (e) { msg.replaceChildren(ui.errorBox(e.message)); }
  });
  sh.body.append(h("div.row", ui.statusPill(ctx.vocab, "staff.status", s.status), s.dept_th ? ui.pill(s.dept_th, "mute") : null, s.confirmed ? null : ui.pill("ยังไม่ยืนยัน", "warn")),
    h("div.kv", h("div", h("div.lbl", "ชื่อ"), s.name || "—"), h("div", h("div.lbl", "PIN"), s.has_pin ? "ตั้งแล้ว" : "ยังไม่มี"), h("div", h("div.lbl", "แก้ล่าสุดจากแอป"), s.last_change ? ui.thDayOf(s.last_change) + " " + ui.thTime(s.last_change) : "—")),
    h("p.small.muted", "ทะเบียนตัวจริงอยู่ชีต Staff — ทุกปุ่มบันทึกที่ชีตผ่าน Google แล้วมีผลในแอปทันที · ประวัติอยู่ใน ActivityLog"), msg,
    h("p.ref", "รหัสอ้างอิง " + s.id));
  const pinBtn = h("button.btn.pri", { type: "button", onclick: async () => {
    const pin = await pinTwice(ctx, "ตั้ง PIN ใหม่ · " + s.nick);
    if (!pin) return;
    await run(pinBtn, { op: "pin", sid: s.id, pin }, "ตั้ง PIN ใหม่ " + s.nick, me ? () => { ui.toast("PIN ของคุณเปลี่ยนแล้ว — เข้าใหม่ด้วย PIN ใหม่"); setTimeout(() => { ctx.api.logout(); location.reload(); }, 1500); } : null);
  } }, ctx.icon("lock", "sm"), "ตั้ง PIN ใหม่");
  const status = (to, label, reasons) => {
    const b = h("button.btn", { type: "button", onclick: async () => {
      const c = await ui.confirmSheet({ title: label + " · " + s.nick, detail: to === "ทำงาน" ? "เข้าแอปได้อีกครั้ง (ต้องมี PIN)" : "เข้าแอปไม่ได้ทันที ทั้งแอปใหม่และแอปเดิม", reasons, need: "optional", okText: label });
      if (c) await run(b, { op: "status", sid: s.id, status: to, note: c.reason }, label + " " + s.nick);
    } }, label);
    return b;
  };
  const deptBtn = h("button.btn", { type: "button", onclick: () => {
    const s2 = ui.sheet({ title: "ย้ายแผนก · " + s.nick, modal: true });
    s2.body.append(h("p.small.muted", "สิทธิ์เข้าแอปมาจากแผนก — บัญชี/บริหาร เห็นตัวเลขเงิน"), h("div.chips", DEPTS.map(dp => h("button.chip", { type: "button", "aria-pressed": String(s.dept_th === dp), onclick: async () => { s2.close(); await run(deptBtn, { op: "dept", sid: s.id, dept: dp }, s.nick + " → " + dp); } }, dp))));
  } }, "ย้ายแผนก");
  const main = [pinBtn];
  const more = [deptBtn];
  if (s.status === "ทำงาน") { if (!me) more.unshift(status("พัก", "พักงาน", ctx.reasons("staff")), status("ลาออก", "ลาออก", ctx.reasons("staff"))); }
  else main.push(status("ทำงาน", "เปิดงาน", ctx.reasons("staff")));
  if (!s.confirmed) main.push(h("button.btn", { type: "button", onclick: () => ctx.save("exec.staff_ack", { ids: [s.id] }, { label: "ยืนยัน " + s.nick, after: () => { sh.close(); refresh(); } }).catch(() => {}) }, "ยืนยันว่ารู้จัก"));
  sh.foot.append(h("div.btns", main), h("details", { style: { marginTop: "8px" } }, h("summary.btn.ghost.block", "ตัวเลือกเพิ่มเติม"), h("div.btns", { style: { marginTop: "8px", gridAutoFlow: "row" } }, more)));
}
function newStaff(ctx, d, refresh) {
  const { h, ui } = ctx;
  const sh = ui.sheet({ title: "เพิ่มพนักงาน", foot: true });
  const name = h("input", { type: "text", maxlength: 60, placeholder: "ชื่อ-สกุล", "aria-label": "ชื่อ-สกุล" });
  const nick = h("input", { type: "text", maxlength: 30, placeholder: "ชื่อเล่น (ขึ้นบนการ์ดเข้าระบบ)", "aria-label": "ชื่อเล่น" });
  let dept = "";
  const chips = h("div.chips", { role: "group", "aria-label": "แผนก" }, DEPTS.map(dp => h("button.chip", { type: "button", "aria-pressed": "false", onclick: e => { dept = dp; chips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === e.currentTarget))); } }, dp)));
  const msg = h("div");
  sh.body.append(h("div.field", h("div.lbl", "ชื่อ"), name), h("div.field", h("div.lbl", "ชื่อเล่น"), nick), h("div.lbl", "แผนก (สิทธิ์เข้าแอป)"), chips, msg);
  const btn = h("button.btn.pri.block", { type: "button", onclick: async () => {
    if (!name.value.trim() || !nick.value.trim()) { msg.replaceChildren(h("p.err", "ใส่ชื่อและชื่อเล่นก่อน")); return; }
    if (!dept) { msg.replaceChildren(h("p.err", "เลือกแผนกก่อน")); return; }
    const pin = await pinTwice(ctx, "ตั้ง PIN · " + nick.value.trim());
    if (!pin) return;
    await ui.busy(btn, async () => {
      msg.replaceChildren(h("p.muted", "กำลังเพิ่มที่ชีต Staff ผ่าน Google…"));
      try { await gasStaff(ctx, { op: "create", name: name.value.trim(), nick: nick.value.trim(), dept, pin }); sh.close("ok"); ui.toast("เพิ่ม " + nick.value.trim() + " แล้ว"); refresh(); }
      catch (e) { msg.replaceChildren(ui.errorBox(e.message)); }
    });
  } }, "ถัดไป: ตั้ง PIN");
  sh.foot.append(btn);
}
async function importBox(ctx, box) {
  const { h, ui, api } = ctx;
  let d;
  try { d = await api.read("import.sources"); } catch (e) { box.append(ui.errorBox(e.message)); return; }
  if (!d.bridge.gas || !d.bridge.key) box.append(h("div.banner.t-warn", ui.icon("alert"), "ยังไม่ได้ต่อสะพาน Google — นำเข้าได้เฉพาะทะเบียนสินค้า/เครื่องจักร"));
  d.sources.forEach(s => {
    const btn = h("button.btn", { type: "button" }, ui.icon("download", "sm"), "นำเข้า");
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
}
const SETTING_TH = { UNDO_HOURS: "ย้อนรายการได้ภายใน (ชั่วโมง)", GATE_TICKET_MIN: "ทีมผลิต: PIN ตอนบันทึกใช้ได้ (นาที)", RUN_STALE_HOURS: "รอบเครื่องเปิดค้างเกิน (ชั่วโมง) = ขึ้นเรื่อง", MIN_WEB_VERSION: "รุ่นหน้าเว็บต่ำสุดที่ยอมให้ใช้", COMPANY_NAME: "ชื่อบนหัวเอกสาร", ACCT_SYNC_AUTO: "ซิงก์ชีทบัญชีอัตโนมัติทุกวัน ~20:00", ACCT_DUE_DAYS: "ลูกหนี้ครบกำหนดภายใน (วัน) ขึ้นหน้าบัญชี" };
async function settingsBox(ctx, box) {
  const { h, ui, api } = ctx;
  let d;
  try { d = await api.read("setting.list"); } catch (e) { box.append(ui.errorBox(e.message)); return; }
  for (const s of d.items) {
    const onoff = s.key === "ACCT_SYNC_AUTO";
    box.append(h("button.card", { type: "button", onclick: () => {
      const sh = ui.sheet({ title: SETTING_TH[s.key] || s.key, foot: true });
      const inp = h("input", { type: "text", value: s.value, maxlength: 100, "aria-label": SETTING_TH[s.key] || s.key });
      const save = v => ctx.save("setting.set", { key: s.key, value: v, version: s.version }, { label: (SETTING_TH[s.key] || s.key) + " = " + v, after: () => { sh.close(); ctx.refresh(); } }).catch(() => {});
      sh.body.append(h("p.small.muted", s.note), onoff ? h("div.chips", [["1", "เปิด"], ["0", "ปิด"]].map(([v, l]) => h("button.chip", { type: "button", "aria-pressed": String(s.value === v), onclick: () => save(v) }, l))) : h("div.field", inp), h("p.ref", "ชื่อค่าตั้ง " + s.key));
      if (!onoff) sh.foot.append(h("button.btn.pri.block", { type: "button", onclick: () => save(inp.value.trim()) }, "บันทึก"));
    } }, h("div.row", h("span.grow", { style: { minWidth: "8em" } }, SETTING_TH[s.key] || s.note || s.key), h("b", { style: { minWidth: "0", overflowWrap: "anywhere" } }, onoff ? (s.value === "0" ? "ปิด" : "เปิด") : (s.value || "—")))));
  }
}
async function acctBox(ctx, box) {
  const { h, ui, api } = ctx;
  let d;
  try { d = await api.read("account.sync_status"); } catch (e) { box.append(ui.errorBox(e.message)); return; }
  box.append(h("div.card", syncLine(d.runs[0] || null, d.auto), h("span.small.muted", "บิลจากชีทบัญชีในแอป " + ui.fmt(d.bills) + " ใบ · อ่านอย่างเดียว ไม่เขียนกลับชีท"), syncButton(ctx, () => ctx.refresh())));
}

export default {
  code: "exec", title: "ประธาน",
  nav: [
    { key: "today", label: "วันนี้", icon: "home", title: "เรื่องที่ต้องตัดสินใจ" },
    { key: "floor", label: "แผนผัง", icon: "map", title: "แผนผังโรงงาน" },
    { key: "money", label: "เงิน", icon: "coin", title: "เงิน · ลูกหนี้" },
    { key: "price", label: "ราคา", icon: "tag", title: "ราคา · ประวัติราคา" },
    { key: "team", label: "ทีม", icon: "users", title: "ทีม · นำเข้า · ค่าตั้ง" },
  ],
  views: { today, floor, money, price, team },
};
