// ============================================================
//  เดโมทั้งระบบในเบราว์เซอร์ (ไฟล์ HTML เดียว)                                         v2/tools/demo/demo-main.mjs
//  · หลังบ้านตัวจริง (server/createApp + ทุก action) บน SQLite ในเบราว์เซอร์ (sql.js) แทน D1
//  · หน้าเว็บตัวจริง (web/assets/app.js + roles) — ชั้นเดโมแค่ดัก fetch / ลิงก์ ?app= / location.reload
//  · สะพาน PIN จำลอง: ทำแค่ pkV2Ticket / pkV2Renew (PIN 1234 ทุกคน) · ออกตั๋วรูปแบบเดียวกับ GAS จริง
//  · ไม่มีอะไรออกเน็ต (นอกจากฟอนต์) — action ที่ต้องต่อชีตจริงตอบว่า "ไม่มีในโหมดตัวอย่าง"
//  build: node v2/tools/build-demo.mjs → v2/dist/demo/pk-v2-demo.html
// ============================================================
import { makeD1, migrate } from "./d1-sqljs.mjs";
import { createApp } from "../../server/app.mjs";
import { buildRegistry } from "../../server/actions/index.mjs";
import { seedDemo, DEMO_STAFF, DEMO_PIN } from "../seed-demo.mjs";
import { issueTicket, readTicket, pinPrint } from "../../server/ticket.mjs";
import { MIGRATIONS, ROLE_CSS, WEB_VERSION, DEMO_BUILD } from "pk-demo-data";

// ── ค่าคงที่ของเดโม (ไม่ใช่ความลับ — ใช้ได้เฉพาะในหน้านี้) ─────────────────────────────
const KEYS = { ticket: "pk-demo-ticket-key-not-secret", sync: "pk-demo-sync-key-not-secret", pin: "pk-demo-pin-key-not-secret" };
const GAS_URL = "https://pk-demo.invalid/gas";
const BASE = "https://pk-demo.invalid/";
const ROUTE_TRIAL = "https://claude.ai/artifact/7VYg67UxzBZBCyXqSb6nay";
const NOT_SHEET = "ไม่มีในโหมดตัวอย่าง — การนำเข้า/ซิงก์ต้องต่อชีต Google จริง (เดโมนี้ไม่ต่อระบบจริง)";
const NOT_STAFF = "ไม่มีในโหมดตัวอย่าง — การแก้ทะเบียนพนักงาน/ตั้ง PIN เขียนที่ชีต Staff จริงผ่าน Google (เดโมนี้ไม่ต่อระบบจริง)";
const NOT_NET = "ไม่มีในโหมดตัวอย่าง — เดโมนี้ไม่ออกอินเทอร์เน็ต";

const APPS = [
  ["office", "ออฟฟิศ", "ลงออเดอร์ · ลูกค้า · บิล · งวดส่ง", "ออฟฟิศ"],
  ["prod", "ทีมผลิต", "ผังเครื่อง · เปิด/ปิดรอบ · สต๊อก · ซ่อม", "ผลิต"],
  ["screen", "ทีมสกรีนสี", "คิวงานสกรีน · เริ่ม/เสร็จ · ชิ้นส่วน", "สกรีน"],
  ["deliver", "ส่งของ", "ของรอส่ง · ขึ้นรถ · ส่งแล้ว", "ส่งของ"],
  ["account", "บัญชี", "รับชำระ · ลูกหนี้ · เงินเข้า", "บัญชี"],
  ["exec", "ประธาน", "ภาพรวม · ธง · ทีม · เปิดได้ทุกแอป", "บริหาร"],
];
const APP_KEYS = APPS.map(a => a[0]);

const doc = document;
const el = (tag, attrs, ...kids) => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
};
const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8" } });
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thWhen = ms => { const d = new Date(ms + 7 * 3600000); return d.getUTCDate() + " " + TH_MONTH[d.getUTCMonth()] + " " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + " น."; };

// ── ที่เก็บในเครื่องผู้ดู (IndexedDB) — เปิดไม่ได้ = ใช้ได้แบบไม่จำ ────────────────────────────
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open("pk-v2-demo", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      setTimeout(() => rej(new Error("timeout")), 2500);
    } catch (e) { rej(e); }
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction("kv", mode); const st = t.objectStore("kv");
    const r = fn(st);
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  return {
    get: k => tx("readonly", st => st.get(k)).catch(() => undefined),
    set: (k, v) => tx("readwrite", st => st.put(v, k)).then(() => true).catch(() => false),
    del: k => tx("readwrite", st => st.delete(k)).then(() => true).catch(() => false),
  };
})();
const ls = {
  clearViews(all) {
    try {
      Object.keys(localStorage).filter(k => k.startsWith("pk2.view.") || k === "pk2.me" || (all && k.startsWith("pk2."))).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ไม่มีที่เก็บ */ }
  },
};

// ── ฐานข้อมูล ────────────────────────────────────────────────────────
const S = { SQL: null, d1: null, env: null, seededAt: 0, persist: false, current: "", dirty: false, saveT: 0, engine: "" };

function b64bytes(s) {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function loadSql() {
  const wasmEl = doc.getElementById("pk-sqljs-wasm");
  let wasmOk = false;   // กรอบที่ห้าม wasm (CSP) → ใช้รุ่น asm.js (ช้ากว่าเล็กน้อย ทำงานเหมือนกัน)
  try { wasmOk = typeof WebAssembly === "object" && !!new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); } catch (e) { wasmOk = false; }
  if (wasmOk && window.pkInitSqlWasm && wasmEl) {
    try {
      const SQL = await Promise.race([
        window.pkInitSqlWasm({ wasmBinary: b64bytes(wasmEl.textContent.trim()), locateFile: f => f }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      S.engine = "wasm";
      return SQL;
    } catch (e) { console.warn("sql.js wasm ใช้ไม่ได้ — ใช้รุ่น asm.js แทน:", e && e.message); }
  }
  S.engine = "asm";
  return window.pkInitSqlAsm();
}
const markDirty = () => {
  S.dirty = true;
  if (!S.persist || S.saveT) return;
  S.saveT = setTimeout(save, 600);
};
async function save() {
  S.saveT = 0;
  if (!S.dirty || !S.persist || !S.d1) return;
  S.dirty = false;
  const ok = await idb.set("db", { build: DEMO_BUILD, seededAt: S.seededAt, bytes: S.d1.export() });
  if (!ok) S.persist = false;
}
async function freshDb() {
  const d1 = makeD1(S.SQL, null, markDirty);
  migrate(d1, MIGRATIONS);
  S.seededAt = Date.now();
  await seedDemo(d1, { now: S.seededAt, pinFp: (sid, pin) => pinPrint(KEYS.pin, sid, pin) });
  return d1;
}
async function openDb(reset) {
  if (S.d1) { try { S.d1.close(); } catch (e) { /* */ } }
  S.d1 = null;
  let saved = reset ? undefined : await idb.get("db");
  let d1 = null;
  if (saved && saved.build === DEMO_BUILD && saved.bytes) {
    try { d1 = makeD1(S.SQL, saved.bytes, markDirty); S.seededAt = saved.seededAt || Date.now(); }
    catch (e) { d1 = null; }
  }
  if (!d1) {
    ls.clearViews(false);   // แคชหน้าจอของฐานเก่า
    d1 = await freshDb();
    S.dirty = true;
  }
  S.d1 = d1;
  S.env = { DB: d1, PK_TICKET_KEY: KEYS.ticket, PK_SYNC_KEY: KEYS.sync, PK_GAS_URL: GAS_URL };
  S.persist = await idb.set("probe", 1);
  if (S.dirty) { S.dirty = true; await save(); }
}

// ── หลังบ้าน + สะพาน PIN จำลอง ─────────────────────────────────────────────
const fails = new Map();
async function gasCall(url, init) {
  const u = new URL(url);
  const action = u.searchParams.get("action") || "";
  let b = null;
  try { b = init && init.body ? JSON.parse(String(init.body)) : null; } catch (e) { b = null; }
  if (action === "pkV2Ticket") return gasTicket(b || {});
  if (action === "pkV2Renew") return gasRenew(b || {});
  if (action === "pkV2Staff") return { ok: false, error: NOT_STAFF };
  if (action === "pkV2Export") return { ok: false, error: NOT_SHEET };
  return { ok: false, error: "ไม่มีในโหมดตัวอย่าง (" + action + ")" };
}
async function issue(row, kind) {
  const now = Date.now();
  const exp = now + (kind === "g" ? 5 * 60000 : 30 * 864e5);   // เท่ากับ V2_GATE_MIN / V2_TICKET_DAYS ใน gas/Code.gs
  const roles = S.d1.q("SELECT role FROM staff_roles WHERE staff_id = ? AND active = 1", row.id).map(r => r.role);
  const ticket = await issueTicket(KEYS.ticket, { k: kind, sid: row.id, n: row.nick, r: roles, pf: await pinPrint(KEYS.pin, row.id, DEMO_PIN), iat: now, exp });
  return { ticket, exp, staff: { id: row.id, nick: row.nick, roles } };
}
async function gasTicket(b) {
  const pin = String(b.pin || "").trim();
  const kind = b.kind === "g" ? "g" : "s";
  if (!pin || !b.sid) return { ok: false, error: "ต้องเลือกชื่อและใส่ PIN" };
  const n = fails.get(b.sid) || 0;
  if (n >= 5) return { ok: false, error: "ใส่ PIN ผิดเกิน 5 ครั้ง — กด \"เริ่มใหม่\" หรือรอสักครู่", locked: true };
  const row = S.d1.one("SELECT id, nick, status FROM staff WHERE id = ?", String(b.sid));
  if (!row || row.status !== "ทำงาน") { fails.set(b.sid, n + 1); return { ok: false, error: row ? "บัญชีนี้ถูกพักการใช้งาน" : "ชื่อหรือ PIN ไม่ถูกต้อง", pinWrong: true }; }
  if (pin !== DEMO_PIN) { fails.set(b.sid, n + 1); return { ok: false, error: "PIN ไม่ถูกต้อง — โหมดตัวอย่างใช้ " + DEMO_PIN + " ทุกคน", pinWrong: true, left: Math.max(0, 4 - n) }; }
  fails.delete(b.sid);
  return Object.assign({ ok: true }, await issue(row, kind));
}
async function gasRenew(b) {
  const t = await readTicket(KEYS.ticket, b.ticket, Date.now());
  const row = t.ok && t.p.k === "s" ? S.d1.one("SELECT id, nick, status FROM staff WHERE id = ?", t.p.sid) : null;
  if (!row || row.status !== "ทำงาน") return { ok: false, error: "ตั๋วใช้ไม่ได้แล้ว — เข้าสู่ระบบใหม่", needLogin: true };
  const r = await issue(row, "s");
  return { ok: true, ticket: r.ticket, exp: r.exp };
}
// fetch ของหลังบ้าน (สะพาน GAS · อ่านลิงก์แผนที่) — ไม่ออกเน็ต
async function serverFetch(url, init) {
  if (String(url).startsWith(GAS_URL)) return json(await gasCall(String(url), init));
  throw new Error(NOT_NET);
}
const app = createApp({ registry: buildRegistry(), now: () => Date.now(), fetch: serverFetch });
let ready = null;

// ── ดัก fetch ของหน้าเว็บ: api/… → หลังบ้านในหน้านี้ · ลิงก์ GAS → สะพานจำลอง · version.json → รุ่นของหน้านี้ ─────────
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input && input.url) || String(input);
  const o = init || {};
  const rel = url.replace(/^\.\//, "");
  if (/^api\//.test(rel)) {
    await ready;
    const path = rel.slice(4).split("?")[0];
    const req = new Request(BASE + rel, { method: o.method || "GET", headers: o.headers, body: o.method && o.method !== "GET" && o.method !== "HEAD" ? o.body : undefined });
    const res = await app.handle(req, S.env, path);
    if (S.dirty) markDirty();
    return res;
  }
  if (url.startsWith(GAS_URL)) { await ready; return json(await gasCall(url, o)); }
  if (/^version\.json/.test(rel)) return json({ web: WEB_VERSION });
  return realFetch(input, init);
};

// ── เปิด/สลับแอป (โค้ดหน้าเว็บรันใหม่ทั้งชุดทุกครั้ง = เหมือนเปิดลิงก์ ?app= ใหม่) ───────────────────────
const BASELINE = new Set(doc.body.children);   // ของที่หน้านี้มีตั้งแต่แรก (แถบเดโม · ไอคอน · สคริปต์ · ของที่ Artifact ใส่) — ห้ามลบ
const tracked = { listeners: [], intervals: [] };
const origAdd = { win: window.addEventListener.bind(window), doc: doc.addEventListener.bind(doc) };
const origInterval = window.setInterval.bind(window);
let frontOn = false;
window.addEventListener = function (type, fn, opt) { if (frontOn) tracked.listeners.push([window, type, fn, opt]); return origAdd.win(type, fn, opt); };
doc.addEventListener = function (type, fn, opt) { if (frontOn) tracked.listeners.push([doc, type, fn, opt]); return origAdd.doc(type, fn, opt); };
window.setInterval = function (fn, ms, ...a) { const id = origInterval(fn, ms, ...a); if (frontOn) tracked.intervals.push(id); return id; };

function teardown() {
  frontOn = false;
  for (const [t, type, fn, opt] of tracked.listeners) t.removeEventListener(type, fn, opt);
  for (const id of tracked.intervals) clearInterval(id);
  tracked.listeners = []; tracked.intervals = [];
  window.onhashchange = null; window.onpopstate = null;
  for (const e of [...doc.body.children]) if (!BASELINE.has(e) || e.id === "app") e.remove();   // ลบเฉพาะที่หน้าแอปเพิ่มเอง (แผ่นล่าง · แถบย้อน · #app เดิม)
  doc.head.querySelectorAll("style[data-demo-css]").forEach(s => s.remove());
  doc.body.style.overflow = "";
  const root = el("div", { id: "app", "aria-live": "polite" });
  doc.body.append(root);
  return root;
}
function setHash(h) { try { history.replaceState(null, "", h ? "#" + h : location.pathname + location.search); } catch (e) { /* หน้านี้เปลี่ยนที่อยู่ไม่ได้ — ไม่เป็นไร */ } }

async function launch(role) {
  if (APP_KEYS.indexOf(role) < 0) return picker();
  S.current = role;
  markBar();
  const root = teardown();
  root.append(el("p", { style: "padding:24px" }, "กำลังเปิดแอป…"));
  await ready;
  setHash(role);
  // เปิดแอปของอีกทีมจากหน้าเลือกแอป: คนที่เข้าค้างไว้ไม่มีบทบาทนี้ (และไม่ใช่ประธาน) → ออกก่อน ให้แตะชื่อคนของทีมนั้น
  //   (ของจริงแต่ละเครื่องใช้แอปเดียว — เดโมสลับแอปบ่อย จึงล้างให้แทนที่จะปล่อยให้เจอ "ทำไม่ได้")
  try {
    const s = JSON.parse(localStorage.getItem("pk2.session") || "null");
    const roles = (s && s.staff && s.staff.roles) || [];
    if (s && roles.indexOf(role) < 0 && roles.indexOf("exec") < 0) { localStorage.removeItem("pk2.session"); localStorage.removeItem("pk2.me"); }
  } catch (e) { /* ไม่มีที่เก็บ */ }
  window.PK_CONFIG = { apiBase: "api", gasUrl: GAS_URL };
  frontOn = true;
  try { window.__pkFront(); }
  catch (e) { root.replaceChildren(el("p", { style: "padding:24px" }, "เปิดแอปไม่สำเร็จ: " + (e && e.message || e))); }
}

const HOST_THEME = doc.documentElement.getAttribute("data-theme") || "";   // ธีมที่ผู้ดูเลือกใน Claude (ถ้ามี)
window.__pkDemo = {
  search: () => (S.current ? "?app=" + S.current : ""),
  hostTheme() { if (HOST_THEME === "light" || HOST_THEME === "dark") doc.documentElement.dataset.theme = HOST_THEME; else delete doc.documentElement.dataset.theme; },
  reload: () => launch(S.current),
  open: r => launch(r),
  css(name) {
    const key = String(name || "").split("/").pop();
    if (!ROLE_CSS[key] || doc.head.querySelector('style[data-demo-css="' + key + '"]')) return;
    doc.head.append(el("style", { "data-demo-css": key }, ROLE_CSS[key]));
  },
};
// ลิงก์ "?app=…" ในแอป (เลือกแอป · สลับแอปของประธาน) → สลับในหน้านี้
origAdd.doc("click", e => {
  const a = e.target && e.target.closest && e.target.closest("a[href]");
  if (!a) return;
  const m = /^\?app=([a-z]+)/.exec(a.getAttribute("href") || "");
  if (!m) return;
  e.preventDefault();
  launch(m[1]);
}, true);

// ── แถบโหมดตัวอย่าง + หน้าเลือกแอป ────────────────────────────────────────────
const bar = doc.getElementById("demo-bar");
function markBar() {
  bar.querySelector("[data-act=apps]").hidden = !S.current;
}
function barNormal() {
  const act = bar.querySelector(".demo-act");
  act.replaceChildren(
    el("button", { type: "button", class: "demo-btn", "data-act": "apps", hidden: !S.current, onclick: () => picker() }, "เลือกแอป"),
    el("button", { type: "button", class: "demo-btn", "data-act": "reset", onclick: askReset }, "เริ่มใหม่"));
}
function askReset() {
  const act = bar.querySelector(".demo-act");
  act.replaceChildren(
    el("span", { class: "demo-ask" }, "ล้างที่ลองไว้ทั้งหมด?"),
    el("button", { type: "button", class: "demo-btn strong", "data-act": "reset-yes", onclick: doReset }, "ล้างเลย"),
    el("button", { type: "button", class: "demo-btn", onclick: barNormal }, "ไม่"));
}
async function doReset() {
  const act = bar.querySelector(".demo-act");
  act.replaceChildren(el("span", { class: "demo-ask" }, "กำลังตั้งข้อมูลใหม่…"));
  fails.clear();
  ready = openDb(true);
  await ready;
  ls.clearViews(false);
  barNormal();
  if (S.current) launch(S.current); else picker();
}

function picker() {
  S.current = "";
  setHash("");
  const root = teardown();
  doc.title = "แอปโรงขวด v2 ตัวอย่าง";
  barNormal();
  const who = dept => DEMO_STAFF.filter(s => s[2] === dept).map(s => s[1]).join(" · ");
  root.append(el("main", { class: "login demo-pick" },
    el("div", { class: "demo-head" },
      el("h1", {}, "แอปโรงขวด v2"),
      el("p", { class: "muted" }, "หน้าเว็บกับหลังบ้านตัวจริงทั้งชุด รันอยู่ในเครื่องนี้ — กดลองได้ทุกปุ่ม ข้อมูลเป็นของสมมติทั้งหมด")),
    el("div", { class: "demo-apps" }, APPS.map(([k, name, what, dept]) =>
      el("a", { class: "demo-app", href: "?app=" + k, "data-app": k },
        el("b", {}, name), el("span", { class: "small muted" }, what), el("span", { class: "demo-who" }, who(dept))))),
    el("div", { class: "card demo-how" },
      el("div", { class: "lbl" }, "วิธีเข้า"),
      el("p", {}, "แตะชื่อไหนก็ได้ แล้วใส่ PIN ", el("b", { class: "num" }, DEMO_PIN), " (ทุกคนใช้เลขเดียวกัน)"),
      el("p", { class: "small muted" }, "ทีมผลิตตั้งเครื่องครั้งเดียว แล้วถาม \"ใครบันทึก\" + PIN ทุกครั้งที่กดบันทึก · หัวหน้า (ประธาน) เปิดได้ทุกแอปจากปุ่มชื่อมุมขวาบน")),
    el("a", { class: "card demo-link", href: ROUTE_TRIAL, target: "_blank", rel: "noopener" },
      el("span", { class: "lbl" }, "หน้าทดลองแยก"),
      el("b", {}, "จัดสายส่ง (ออกแบบใหม่)"),
      el("span", { class: "small muted" }, "ยังไม่อยู่ใน v2 — เปิดในแท็บใหม่")),
    el("details", { class: "card demo-limits" },
      el("summary", { class: "lbl" }, "อะไรทำไม่ได้ในโหมดตัวอย่าง"),
      el("ul", { class: "small" },
        el("li", {}, "นำเข้า/ซิงก์จากชีต Google (ข้อมูลเดิม · ชีทบัญชี) — ขึ้นข้อความว่าไม่มีในโหมดตัวอย่าง"),
        el("li", {}, "แก้ทะเบียนพนักงาน · ตั้ง PIN ใหม่ · พักงาน (ของจริงเขียนที่ชีต Staff)"),
        el("li", {}, "อ่านลิงก์ Google Maps แบบย่อ · ตำแหน่งจาก GPS ของเครื่อง · แชร์ไฟล์ลงไลน์ · พิมพ์/PDF (หน้าตัวอย่างนี้ไม่ให้ใช้)"),
        el("li", {}, "ไม่มีการแจ้งเตือน/งานตั้งเวลา — ทุกอย่างอยู่ในเครื่องนี้เครื่องเดียว คนอื่นไม่เห็นที่คุณลอง"))),
    el("p", { class: "small muted" },
      "ข้อมูลตั้งต้นเมื่อ " + thWhen(S.seededAt) + " · " + (S.persist ? "จำที่ลองไว้ในเครื่องนี้ (กด \"เริ่มใหม่\" เพื่อล้าง)" : "เครื่องนี้ไม่ให้เก็บข้อมูล — ปิดหน้าแล้วจะเริ่มใหม่") + " · รุ่นหน้าเว็บ " + WEB_VERSION)));
}

// ── เริ่ม ────────────────────────────────────────────────────────────
async function main() {
  barNormal();
  const root = teardown();
  root.append(el("p", { style: "padding:24px" }, "กำลังเตรียมข้อมูลตัวอย่าง…"));
  ready = (async () => { S.SQL = await loadSql(); await openDb(false); })();
  try { await ready; }
  catch (e) {
    root.replaceChildren(el("main", { class: "login" }, el("h1", {}, "เปิดเดโมไม่สำเร็จ"), el("p", {}, String(e && e.message || e))));
    throw e;
  }
  origAdd.win("pagehide", () => { save(); });
  origAdd.doc("visibilitychange", () => { if (doc.hidden) save(); });
  window.__pkDemoState = () => ({ engine: S.engine, persist: S.persist, current: S.current, seededAt: S.seededAt, v2orders: S.d1 ? S.d1.one("SELECT count(*) AS n FROM orders WHERE src = 'v2'").n : 0 });   // ไว้ smoke test อ่านสถานะ (อ่านอย่างเดียว)
  const h = (location.hash || "").replace(/^#/, "");
  if (APP_KEYS.indexOf(h) >= 0) launch(h); else picker();
}
main();
