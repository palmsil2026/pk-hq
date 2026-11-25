// ═══════════════════════════════════════════════════════════════════════
//  เปลือกแอป (โค้ดชุดเดียว แยกหน้าตามบทบาท ?app=office|prod|screen|deliver|account|exec)        v2/web/assets/app.js
//  · เปิดแอป = หน้าแรกของบทบาทเสมอ · ← กลับหน้าก่อนจริง (ประวัติในแอป) · เมนู ≤ 5 (จอ ≥1100 = แถบซ้าย)
//  · เข้าระบบ = แตะการ์ดชื่อ → แป้น PIN (PIN ส่งตรงไป Google) · ทีมผลิต = ไม่มีหน้าเข้าระบบทุกวัน ใส่ PIN ตอนกดบันทึก
//  · ป้ายเวอร์ชันมุมบน + แถบอัปเดต (บังคับ = รอออกจากฟอร์มก่อนแล้วโหลดใหม่เอง)
//  · หน้าจอโหลดแบบไม่กระพริบ: โชว์ของรอบก่อนทันที แล้ววาดใหม่เฉพาะที่เปลี่ยน · เงินไม่โชว์ค่าเก่า/฿0 ตอนโหลดไม่สำเร็จ
// ═══════════════════════════════════════════════════════════════════════
import * as api from "./api.js";
import * as ui from "./ui.js";
const { h, icon } = ui;

export const WEB_VERSION = "2026-11-26a";   // ขยับทุกครั้งที่แก้หน้าเว็บ v2 (ต้องตรงกับ version.json)
const ROLE_FILES = { office: "office", prod: "prod", screen: "screen", deliver: "deliver", account: "account", exec: "exec" };
const ROLE_TH = { office: "ออฟฟิศ", prod: "ทีมผลิต", screen: "ทีมสกรีนสี", deliver: "ส่งของ", account: "บัญชี", exec: "ประธาน" };

const root = document.getElementById("app");
const S = { role: "", mod: null, me: null, depth: 0, route: "", forced: false };

// ── ทางเข้า ───────────────────────────────────────────────────────────
async function boot() {
  applyTheme(api.store.get("theme"));
  const qs = new URLSearchParams(location.search);
  let role = qs.get("app") || "";
  const s = api.session();
  if (!ROLE_FILES[role]) role = (s && s.staff && s.staff.roles && s.staff.roles[0]) || "";
  if (!role) return chooseRole();
  S.role = role;
  api.setRole(role);
  S.mod = (await import("../roles/" + ROLE_FILES[role] + ".js")).default;
  history.replaceState({ d: 0 }, "", location.pathname + location.search + "#/" + S.mod.nav[0].key);   // เปิดแอปเริ่มหน้าแรกเสมอ
  if (!s) return login();
  api.renewIfNeeded();
  start();
}

function chooseRole() {
  document.title = "โรงขวด P&K";
  root.replaceChildren(h("main.login", h("h1", "โรงขวด P&K"), h("p.muted", "เลือกแอปของทีมคุณ"),
    h("div.people", Object.keys(ROLE_FILES).map(r => h("a.person", { href: "?app=" + r }, ROLE_TH[r])))));
}

// ── เข้าระบบ: แตะการ์ดชื่อ → แป้น PIN ───────────────────────────────────────
async function login(note) {
  document.title = "เข้าสู่ระบบ · " + ROLE_TH[S.role];
  const box = h("div.people", ui.skeleton(1));
  const head = S.role === "prod"
    ? [h("h1", "ตั้งเครื่องนี้สำหรับทีมผลิต"), h("p.muted", "ใส่ PIN ครั้งเดียวของเครื่องนี้ — ต่อไปเปิดแล้วเห็นแผนผังเลย ส่วนตอนกดบันทึกจะถามว่าใครบันทึกทุกครั้ง")]
    : [h("h1", ROLE_TH[S.role]), h("p.muted", "แตะชื่อของคุณ")];
  root.replaceChildren(h("main.login", head, note ? h("div.banner.t-warn", { role: "status" }, icon("alert"), note) : null, box, h("p.small.muted", "รุ่น " + WEB_VERSION)));
  let people;
  try { people = await api.staffCards(S.role); }
  catch (e) { box.replaceChildren(ui.errorBox("โหลดรายชื่อไม่สำเร็จ: " + e.message, () => login(note))); return; }
  if (!people.length) { box.replaceChildren(ui.empty("ยังไม่มีรายชื่อของทีมนี้", "ให้ผู้ดูแลเพิ่มพนักงาน (ชื่อเล่น + PIN + แผนก) ในบอร์ดบริหาร แล้วนำเข้า")); return; }
  const last = api.store.get("lastStaff");
  people.sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : a.nick.localeCompare(b.nick, "th")));
  box.replaceChildren(...people.map(p => h("button.person" + (p.id === last ? ".last" : ""), { type: "button", onclick: () => askPin(p) }, p.nick, p.id === last ? h("small", "ล่าสุดในเครื่องนี้") : null)));
}
function askPin(p) {
  const sh = ui.sheet({ title: p.nick + " — ใส่ PIN", modal: true });
  ui.pinPad(sh.body, async pin => {
    const r = await api.gasTicket(p.id, pin, "s");
    if (!r.ok) return { error: r.error, shake: !!r.pinWrong };
    api.setSession({ ticket: r.ticket, exp: r.exp, staff: r.staff });
    sh.close("ok");
    start();
    return { ok: true };
  });
}

// ── ทีมผลิต: "ใครบันทึก" + PIN ทุกครั้งที่กดบันทึก (คนล่าสุดขึ้นให้) → ตั๋วใช้ครั้งนี้ ─────────────────
export function pinGate(label) {
  return new Promise(async resolve => {
    let done = null;
    const sh = ui.sheet({ title: "ใครบันทึก?", modal: true, onClose: () => resolve(done) });
    sh.body.append(h("p.muted", (label || "บันทึก") + " — ใส่ PIN ของคนที่กด"));
    let people = [];
    try { people = await api.staffCards("prod"); } catch (e) { sh.body.append(ui.errorBox(e.message)); return; }
    const last = api.store.get("prodLast");
    const pick = p => {
      sh.title = p.nick;
      sh.body.replaceChildren(h("p.muted", (label || "บันทึก") + " — ใส่ PIN ของ " + p.nick));
      ui.pinPad(sh.body, async pin => {
        const r = await api.gasTicket(p.id, pin, "g");
        if (!r.ok) return { error: r.error, shake: !!r.pinWrong };
        api.store.set("prodLast", p.id);
        done = { ticket: r.ticket, staff: r.staff };
        sh.close("ok");
        return { ok: true };
      }, { busyText: "กำลังตรวจ PIN…" });
      sh.body.append(h("button.btn.ghost", { type: "button", onclick: () => list() }, icon("back", "sm"), "เปลี่ยนคน"));
    };
    const list = () => {
      sh.title = "ใครบันทึก?";
      sh.body.replaceChildren(h("p.muted", (label || "บันทึก") + " — แตะชื่อคนที่กด"),
        h("div.people", people.map(p => h("button.person" + (p.id === last ? ".last" : ""), { type: "button", onclick: () => pick(p) }, p.nick))));
    };
    const lp = people.find(p => p.id === last);
    if (lp) pick(lp); else list();
  });
}

// ── เปลือกแอป ────────────────────────────────────────────────────────
async function start() {
  const s = api.session();
  const M = S.mod;
  document.title = M.title + " · โรงขวด P&K";
  const titleEl = h("h1");
  const back = h("button.iconbtn", { type: "button", "aria-label": "กลับหน้าก่อน", hidden: true, onclick: () => history.back() }, icon("back"));
  const meBtn = h("button.me-chip", { type: "button", onclick: accountSheet }, icon("user", "sm"), s.staff.nick);
  const upd = h("div.banner.upd.t-brand", { hidden: true, role: "status" });
  const nav = h("nav.nav", { "aria-label": "เมนู" }, h("div.rail-head", "โรงขวด P&K", h("small", M.title)),
    M.nav.map(n => h("a", { href: "#/" + n.key, dataset: { key: n.key } }, icon(n.icon), h("span", n.label))),
    M.fab ? h("button.fab", { type: "button", onclick: () => M.fab.run(ctx) }, icon("plus"), M.fab.label) : null);
  const main = h("main.main", { id: "main", tabindex: "-1" });
  root.replaceChildren(h("div.app", h("header.top", back, titleEl, h("span.ver", { title: "รุ่นหน้าเว็บ" }, "v" + WEB_VERSION.slice(2)), meBtn), upd, nav, main));
  S.els = { titleEl, back, main, nav, upd };
  window.onhashchange = route;
  window.onpopstate = e => { S.depth = (e.state && e.state.d) || 0; };
  // คลังค่า (ป้ายสถานะ/ชิปเหตุผล) จำไว้ในเครื่อง — มีแล้วเปิดหน้าทันที · ยังไม่มี (เข้าครั้งแรก) = รอรอบเดียวก่อนวาด
  const cachedMe = api.store.get("me");
  if (cachedMe) { S.me = cachedMe; route(); }
  try { S.me = await api.read("system.me"); api.store.set("me", S.me); }
  catch (e) { if (e.needLogin) return relogin(e.message); S.me = cachedMe; }
  if (!cachedMe) route();
  checkVersion();
  setInterval(checkVersion, 5 * 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
}
function relogin(msg) { api.logout(); login(msg); }

// ไปหน้าในแอป (เก็บประวัติให้ ← กลับได้จริง)
export function go(key) { S.depth++; history.pushState({ d: S.depth }, "", "#/" + key); route(); }
async function route() {
  const parts = (location.hash.replace(/^#\/?/, "") || S.mod.nav[0].key).split("/");
  const key = parts[0];
  // หน้าย่อยที่ไม่อยู่ในเมนู (เช่น #/new = ลงออเดอร์) — บทบาทประกาศใน mod.pages { key: { title, nav } } · ส่วนท้ายของ # ส่งให้หน้าเป็น n.arg
  const page = S.mod.pages && S.mod.pages[key];
  const n = Object.assign({}, S.mod.nav.find(x => x.key === key) || (page ? { key, label: page.title, title: page.title } : S.mod.nav[0]));
  n.arg = parts.length > 1 && (S.mod.nav.some(x => x.key === key) || page) ? decodeURIComponent(parts.slice(1).join("/")) : "";
  S.route = n.key;
  const navKey = page ? page.nav || "" : n.key;
  S.els.nav.querySelectorAll("a").forEach(a => (a.dataset.key === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  S.els.titleEl.textContent = n.title || n.label;
  S.els.back.hidden = !(history.state && history.state.d > 0);
  const view = h("div.stack");
  S.els.main.replaceChildren(view);
  try { await (S.mod.views[n.key] || placeholder)(ctx, view, n); }
  catch (e) { if (e.needLogin) return relogin(e.message); view.replaceChildren(ui.errorBox(e.message || String(e))); }
}
function placeholder(c, view, n) {
  view.append(ui.empty("หน้า \"" + n.label + "\" กำลังทำ", "ระหว่างนี้ใช้แอปเดิมไปก่อน"));
}

// ── บัญชีของฉัน: สลับแอป (ถ้ามีหลายบทบาท) · โหมดมืด · ออกจากระบบ ───────────────────────────
function accountSheet() {
  const s = api.session();
  const sh = ui.sheet({ title: s.staff.nick });
  const roles = (S.me && S.me.roles) || s.staff.roles || [];
  const can = roles.includes("exec") ? Object.keys(ROLE_FILES) : roles;
  if (can.length > 1) sh.body.append(h("div.lbl", "เปิดแอปของทีม"), h("div.chips", can.map(r => h("a.chip" + (r === S.role ? "" : ""), { href: "?app=" + r, "aria-pressed": String(r === S.role), style: { display: "inline-flex", alignItems: "center", textDecoration: "none" } }, ROLE_TH[r]))));
  const cur = api.store.get("theme") || "auto";
  sh.body.append(h("div.lbl", "หน้าจอ"), h("div.chips", [["auto", "ตามเครื่อง"], ["light", "สว่าง"], ["dark", "มืด"]].map(([k, l]) =>
    h("button.chip", { type: "button", "aria-pressed": String(cur === k), onclick: () => { api.store.set("theme", k); applyTheme(k); sh.close(); } }, l))));
  sh.body.append(h("p.small.muted", "รุ่นหน้าเว็บ " + WEB_VERSION + (S.me ? " · หลังบ้าน " + S.me.api : "")),
    h("button.btn", { type: "button", onclick: () => { api.logout(); sh.close(); login(); } }, icon("logout", "sm"), "ออกจากระบบ"));
}
function applyTheme(t) { if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

// ── รุ่นใหม่: แถบบอก · บังคับ = รอออกจากฟอร์ม (ไม่มีแผ่นเปิดอยู่) แล้วโหลดใหม่เอง ─────────────────────
const vnum = v => String(v || "");
async function checkVersion() {
  let latest = "";
  try { latest = (await (await fetch("version.json?t=" + Date.now(), { cache: "no-store" })).json()).web || ""; } catch (e) { return; }
  const min = (S.me && S.me.minWeb) || "";
  const forced = !!min && vnum(WEB_VERSION) < vnum(min);
  const newer = !!latest && latest !== WEB_VERSION;
  if (!forced && !newer) return;
  const u = S.els.upd;
  u.hidden = false;
  u.replaceChildren(icon(forced ? "alert" : "download"), h("span", forced ? "ต้องอัปเดตแอปก่อนใช้ต่อ — จะอัปเดตเองเมื่อออกจากหน้าที่กรอกอยู่" : "มีแอปรุ่นใหม่"),
    h("button.btn", { type: "button", onclick: () => location.reload() }, "อัปเดตเลย"));
  if (forced && !S.forced) {
    S.forced = true;
    const t = setInterval(() => { if (!ui.sheetOpen() && !document.querySelector("[data-form-dirty='1']")) { clearInterval(t); location.reload(); } }, 1500);
  }
}

// ── ของที่ส่งให้หน้าของแต่ละบทบาท ────────────────────────────────────────────
//   ctx.load(view, key, action, render) = โชว์ของรอบก่อนทันที → ดึงใหม่ → วาดเฉพาะที่เปลี่ยน · render(data, st) st = {fresh, at, failed}
//   ctx.save(action, input, {label, reason, confirm}) = บันทึก + แถบย้อน · ทีมผลิตถามใครบันทึก + PIN เอง
export const ctx = {
  api, ui, h, icon, go, pinGate,
  get role() { return S.role; }, get route() { return S.route; }, get me() { return S.me || api.store.get("me"); }, get vocab() { return (S.me || api.store.get("me") || {}).vocab || {}; },
  reasons(kind) { return ((this.vocab["reason." + kind]) || []).map(v => v.value); },
  async load(view, key, action, render, input) {
    const ck = S.role + "." + key;
    const cached = api.viewCache.get(ck);
    const holder = h("div.stack");
    const status = h("div");
    view.append(status, holder);
    if (cached) render(holder, cached.data, { fresh: false, at: cached.at, updating: true });
    else holder.append(ui.skeleton(3));
    try {
      const data = await api.read(action, input);
      api.viewCache.set(ck, data);
      if (!cached) holder.replaceChildren();
      render(holder, data, { fresh: true, at: data.asOf || new Date().toISOString() });
      status.replaceChildren();
      return data;
    } catch (e) {
      if (e.needLogin) throw e;
      if (cached) {
        render(holder, cached.data, { fresh: false, failed: true, at: cached.at });
        status.replaceChildren(ui.errorBox("อัปเดตไม่สำเร็จ: " + e.message + " — ที่เห็นคือข้อมูลเมื่อ " + ui.thTime(cached.at) + " (ยอดเงินซ่อนไว้จนกว่าจะโหลดได้)", () => route()));
      } else holder.replaceChildren(ui.errorBox("โหลดไม่สำเร็จ: " + e.message, () => route()));
      return null;
    }
  },
  async save(action, input, opt) {
    const o = opt || {};
    let reason = o.reason || "";
    if (o.confirm) {
      const c = await ui.confirmSheet(o.confirm);
      if (!c) return null;
      reason = c.reason || reason;
    }
    let ticket;
    if (S.role === "prod") {   // ทีมผลิต: ใส่ PIN ตอนกดบันทึกทุกครั้ง
      const g = await pinGate(o.label);
      if (!g) return null;
      ticket = g.ticket;
    }
    try {
      const r = await api.write(action, input, { reason, ticket });
      if (r.undo) ui.undoBar(r.undo.label || o.label || "บันทึกแล้ว", async () => {
        let t2;
        if (S.role === "prod") { const g = await pinGate("ย้อน " + (r.undo.label || "")); if (!g) throw new Error("ยังไม่ได้ย้อน"); t2 = g.ticket; }
        await api.write("undo.run", { id: r.undo.id }, { ticket: t2 });
        if (o.after) o.after();
      });
      else ui.toast("บันทึกแล้ว" + (o.label ? " · " + o.label : ""));
      if (o.after) o.after();
      return r;
    } catch (e) {
      if (e.needLogin && S.role !== "prod") { relogin(e.message); return null; }
      ui.toast(e.message, "bad");
      throw e;
    }
  },
  refresh() { route(); },
};

boot().catch(e => { root.replaceChildren(h("main.login", ui.errorBox("เปิดแอปไม่สำเร็จ: " + (e.message || e)))); });
