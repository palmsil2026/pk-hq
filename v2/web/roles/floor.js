// ═══════════════════════════════════════════════════════════════════════
//  แผนผังโรงงาน — ส่วนประกอบที่บทบาทอื่นใช้ซ้ำได้แบบอ่านอย่างเดียว (ประธาน: import { floorView } from "./floor.js")      v2/web/roles/floor.js
//   floorView(ctx, view, { readOnly, onMachine }) = ทั้งหน้า (สรุป · ผัง โรง 1/โรง 2/ทั้งหมด · การ์ดเครื่อง · ถาดยังไม่ได้วาง)
//   floorMap(data, opt) = SVG ผังจริง (หน่วยพิกเซลของรูปผัง) เลื่อน/ซูมได้ · machineSections(ctx, d) = รายละเอียดเครื่อง (ไทม์ไลน์ · ยอด · ข้อมูลเครื่อง)
//   ข้อมูลจาก action prod.floor / prod.machine (ทีมผลิต · ประธาน · ออฟฟิศ อ่านได้)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
const { h, icon } = ui;
// ใส่ลูกลง DOM โดยข้าม null/undefined/false (append/replaceChildren ของเบราว์เซอร์จะพิมพ์คำว่า "null" ลงจอ)
const clean = k => k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false);
export const put = (el, ...k) => { el.replaceChildren(...clean(k)); return el; };
export const add = (el, ...k) => { el.append(...clean(k)); return el; };

export function ensureCss() {
  if (document.getElementById("prod-css")) return;
  add(document.head, h("link", { id: "prod-css", rel: "stylesheet", href: "roles/prod.css" }));
}

// สถานะ → [คลาส, คำ, โทน, ไอคอน]
export const STATE = {
  "เดิน": ["s-run", "เดินอยู่", "ok", "play"], "ค้างปิด": ["s-stale", "ค้างไม่ได้ปิด", "warn", "flag"], "จอด": ["s-stop", "จอดเครื่อง", "warn", "pause"],
  "โมลด์": ["s-mold", "กำลังเปลี่ยนโมลด์", "warn", "gear"], "ว่าง": ["", "ว่าง", "mute", "dot"],
};
const BC = { "น้ำเงิน": "blue", "ใส": "clear", "เขียว": "green", "ฟ้า": "sky", "ฟ้าทะเล": "sea", "ฟ้าเข้ม": "navy", "ขาวขุ่น": "milk", "เขียวอ่อน": "lime", "ดำ": "black", "ดำ (เกรด B)": "black", "ชมพู": "pink" };
export const colorVar = c => "var(--bc-" + (BC[String(c || "").trim()] || "other") + ")";
export const swatch = c => h("span.sw", { style: { background: colorVar(c) }, "aria-hidden": "true" });
const KCLS = { "เป่า": "k-blow", "ฉีด": "k-inj", "สกรีน": "k-scr", "ลม": "k-util", "น้ำเย็น": "k-util", "ไฟฟ้า": "k-pwr", "อื่น": "k-oth" };
const VIEWS = ["โรง 1", "โรง 2", "ทั้งหมด"];
const MINW = { "โรง 1": 820, "โรง 2": 430, "ทั้งหมด": 1000 };
const fmt = ui.fmt;
/** ใบ → "40 ถุง" / "40 ถุง 12 ใบ" (ไม่รู้ใบต่อถุง = ใบอย่างเดียว) */
export function bagsText(pcs, perBag, unit) {
  const n = Number(pcs) || 0;
  if (!perBag) return fmt(n) + " " + (unit || "ใบ");
  const b = Math.floor(n / perBag), r = n % perBag;
  return fmt(b) + " ถุง" + (r ? " " + fmt(r) + " " + (unit || "ใบ") : "");
}
const durText = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + " นาที" : Math.floor(m / 60) + " ชม." + (m % 60 ? " " + (m % 60) + " น." : ""); };
export { durText };

/** ความกว้างตัวอักษรไทยโดยประมาณ (สระบน/ล่างไม่กินที่) → ขนาดตัวหนังสือที่พอดีกล่อง */
const fit = (txt, w, hh, max) => Math.max(10, Math.min(max, hh - 7, (w - 10) / (Math.max(2, [...String(txt)].filter(c => !/[ัิ-ฺ็-๎]/.test(c)).length) * 0.56)));
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) add(el, c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** ข้อความรองบนผัง: เดิน = ขนาด+สี · จอด = สาเหตุ · ว่าง = ผลิตวันนี้/ป้ายรอง */
function subOf(m) {
  if (m.state === "โมลด์") return "เปลี่ยนโมลด์";
  if (m.state === "จอด") return "จอด · " + (m.stop.reason || "");
  if (m.run) return [m.run.size, m.run.color].filter(Boolean).join(" ");
  if (m.today && m.today.good) return "วันนี้ " + fmt(m.today.good) + " ใบ";
  return m.sub || "";
}

export function floorMap(d, opt) {
  const o = opt || {};
  const L = d.layout;
  let view = o.view || "โรง 1", zoom = 1;
  const wrap = h("div.mapwrap");
  const box = h("div.stack");
  const chips = h("div.chips", { role: "group", "aria-label": "เลือกส่วนของโรงงาน" });
  const zoomBtns = h("div.zoom", h("button.btn", { type: "button", "aria-label": "ย่อผัง", onclick: () => setZoom(zoom / 1.5) }, "−"), h("button.btn", { type: "button", "aria-label": "ขยายผัง", onclick: () => setZoom(zoom * 1.5) }, "+"));
  const draw = () => {
    put(chips, ...VIEWS.map(v => h("button.chip", { type: "button", "aria-pressed": String(v === view), onclick: () => { view = v; try { localStorage.setItem("pk2.prod.view", v); } catch (e) { /* ไม่มีที่เก็บ = ไม่จำ */ } draw(); if (o.onView) o.onView(v); } }, v)));
    const vb = L.views[view];
    const svg = s("svg", { class: "pmap" + (zoom === 1 ? " fitv" : ""), viewBox: vb.join(" "), role: "group", "aria-label": "ผังโรงงาน " + view, style: "min-width:" + Math.round(MINW[view] * zoom) + "px" });
    for (const b of L.buildings) {
      add(svg, s("rect", { class: "hall", x: b.x, y: b.y, width: b.w, height: b.h, rx: 4 }));
      add(svg, s("text", { class: "bt", x: b.x + 12, y: b.y + 30, "font-size": 24 }, b.name));
    }
    for (const a of L.areas) {
      const g = s("g", {}, s("rect", { class: "k-" + a.kind, x: a.x, y: a.y, width: a.w, height: a.h, rx: 5 }));
      const fs = fit(a.name, a.w, a.sub && a.h >= 44 ? a.h / 2 + 4 : a.h, 18);
      add(g, s("text", { class: "sb", x: a.x + a.w / 2, y: a.y + a.h / 2 + (a.sub && a.h >= 44 ? -2 : fs * 0.36), "text-anchor": "middle", "font-size": fs }, a.name));
      if (a.sub && a.h >= 44) add(g, s("text", { class: "sb", x: a.x + a.w / 2, y: a.y + a.h / 2 + fs, "text-anchor": "middle", "font-size": Math.min(14, fs) }, a.sub));
      add(svg, g);
    }
    for (const m of d.machines) if (m.plant) add(svg, item(m));
    put(wrap, svg);
    // จอแคบ: เลื่อนให้เห็นตัวอาคารของโรงนั้นก่อน (ไม่ใช่มุมซ้ายบนที่เป็นห้องช่าง/ระบบลม)
    const b = L.buildings.find(x => x.name === view);
    requestAnimationFrame(() => { if (b && svg.clientWidth > wrap.clientWidth) wrap.scrollLeft = Math.max(0, (b.x - vb[0]) / vb[2] * svg.clientWidth - 12); });
  };
  const item = m => {
    const [scls, word] = STATE[m.state] || STATE["ว่าง"];
    const { x, y, w, h: hh } = m;
    const cls = ["box", KCLS[m.kind] || "k-oth", m.runnable && scls ? scls : "", o.selected === m.id ? "sel" : ""].filter(Boolean).join(" ");
    const g = s("g", { class: "it", tabindex: 0, role: "button", "data-id": m.id, "aria-label": m.name + " · " + (m.runnable ? word : m.kind) + (subOf(m) ? " · " + subOf(m) : "") });
    add(g, s("rect", { class: cls, x, y, width: w, height: hh, rx: 5 }));
    let tx = x + w / 2;
    if (m.runnable) {
      const r = Math.max(3.5, Math.min(7, hh / 2 - 5));
      add(g, s("circle", { class: m.state === "เดิน" || m.state === "ค้างปิด" ? "l-run" : m.state === "จอด" || m.state === "โมลด์" ? "l-stop" : "l-off", cx: x + 6 + r, cy: y + (hh < 44 ? hh / 2 : 16), r }));
      if (w > 70) tx += r;
    }
    const sub = m.runnable ? subOf(m) : m.sub;
    const two = sub && hh >= 44;
    const fs = fit(m.label, w - (m.runnable ? 16 : 0), two ? hh / 2 + 4 : hh, 22);
    if (two) {
      const fs2 = fit(sub, w, hh / 2, 15);
      add(g, s("text", { class: "lb", x: tx, y: y + hh / 2 - 3, "text-anchor": "middle", "font-size": fs }, m.label));
      add(g, s("text", { class: "sb", x: x + w / 2, y: y + hh / 2 + fs2 + 2, "text-anchor": "middle", "font-size": fs2 }, sub));
    } else add(g, s("text", { class: "lb", x: tx, y: y + hh / 2 + fs * 0.36, "text-anchor": "middle", "font-size": fs }, m.label));
    if (m.state === "ค้างปิด" || m.stuck) add(g, s("circle", { class: "wd", cx: x + w - 8, cy: y + 8, r: 6 }));
    const pick = () => o.onPick && o.onPick(m);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    return g;
  };
  const setZoom = z => { zoom = Math.max(1, Math.min(3.4, z)); draw(); };
  add(box, h("div.pf-bar", chips, zoomBtns), wrap, legend());
  draw();
  return box;
}
function legend() {
  const i = bg => h("i", { style: bg });
  return h("div.pf-legend", { "aria-label": "ความหมายสีในผัง" },
    h("span", i({ background: "var(--ok-soft)", borderColor: "var(--ok)" }), "เดินอยู่"), h("span", i({ background: "var(--warn-soft)", borderColor: "var(--warn)" }), "จอด / เปลี่ยนโมลด์"),
    h("span", i({ background: "var(--surface)" }), "ว่าง"), h("span", h("span.lampd.on", { style: { borderColor: "var(--warn)" } }), "จุดเหลือง = รอบค้างไม่ได้ปิด"),
    h("span", i({ background: "var(--k-inj)" }), "เครื่องฉีด"), h("span", i({ background: "var(--k-scr)" }), "สกรีนสี"), h("span", i({ background: "var(--k-util)" }), "ลม · น้ำเย็น"), h("span", i({ background: "var(--k-pwr)" }), "ไฟฟ้า"));
}

/** การ์ดเครื่อง (ปุ่มใหญ่ แตะง่ายบนมือถือ) */
export function machineTile(m, onPick) {
  const [scls, word] = STATE[m.state] || STATE["ว่าง"];
  const what = m.state === "จอด" ? "จอด: " + (m.stop.reason || "ไม่ระบุ") : m.state === "โมลด์" ? "โมลด์ → " + (m.moldEv.mold_to || "ยังไม่ระบุ")
    : m.run ? [m.run.label.replace(/^ขวด /, ""), m.run.legacy ? "(แอปเดิม)" : ""].filter(Boolean).join(" ") : (m.today.good ? "วันนี้ " + fmt(m.today.good) + " ใบ" : m.sub || m.kind);
  return h("button.pf-tile" + (scls ? "." + scls : ""), { type: "button", "data-id": m.id, "aria-label": m.name + " · " + word + " · " + what, onclick: () => onPick(m) },
    h("span.r1", h("span.lampd"), h("span.nm", m.label), h("span.st", word)),
    h("span.wh", m.run && m.run.color ? swatch(m.run.color) : null, what),
    m.stuck ? h("span.wh", { style: { color: "var(--warn-ink)" } }, icon("flag", "sm"), " ค้างจากแอปเดิม " + m.stuck + " รอบ") : null,
    m.moldEv && m.moldEv.stage === "จะเปลี่ยน" ? h("span.wh", icon("gear", "sm"), " จะเปลี่ยนโมลด์") : null);
}

/** ทั้งหน้า: สรุป · ผัง · การ์ดเครื่อง · ถาด · ระบบอื่น — ใช้ได้ทั้งทีมผลิตและประธาน (readOnly) */
export function floorView(ctx, view, opt) {
  ensureCss();
  const o = opt || {};
  let saved = "โรง 1";
  try { saved = localStorage.getItem("pk2.prod.view") || "โรง 1"; } catch (e) { /* ไม่มีที่เก็บ */ }
  if (VIEWS.indexOf(saved) < 0) saved = "โรง 1";
  let cur = saved;
  return ctx.load(view, "floor2", "prod.floor", (box, d, st) => {
    const pick = m => (o.onMachine ? o.onMachine(m, d) : infoSheet(ctx, m));
    const S = d.summary;
    const tiles = h("div.pf-tiles");
    const drawTiles = () => {
      const list = d.machines.filter(m => m.runnable && m.plant && (cur === "ทั้งหมด" || m.plant === cur))
        .sort((a, b) => (b.tracked - a.tracked) || (a.kind === b.kind ? 0 : a.kind === "เป่า" ? -1 : 1) || a.label.localeCompare(b.label, "th", { numeric: true }));
      put(tiles, ...list.map(m => machineTile(m, pick)));
    };
    const tray = d.machines.filter(m => !m.plant);
    put(box, 
      h("section.card.pf-sum", { "aria-label": "สรุปเครื่อง" },
        h("span.big", fmt(S.running)), h("span.of", "/ " + fmt(S.total) + " เครื่องเดิน"),
        h("span.pills",
          S.stopped ? ui.pill("จอด " + S.stopped, "warn", "pause") : null,
          S.mold ? ui.pill("เปลี่ยนโมลด์ " + S.mold, "warn", "gear") : null,
          S.stale ? ui.pill("ค้างไม่ได้ปิด " + S.stale, "warn", "flag") : null,
          S.stuck ? ui.pill("ค้างจากแอปเดิม " + S.stuck, "warn", "flag") : null,
          ui.pill("ผลิตวันนี้ " + fmt(S.madeToday) + " ใบ", "mute", "box"),
          !o.readOnly && S.jobsWaiting ? h("button.pill.t-brand", { type: "button", onclick: () => ctx.go("jobs") }, icon("list", "sm"), "งานรอผลิต " + S.jobsWaiting) : null),
        st.fresh ? null : ui.stamp(st.at, st.updating)),
      floorMap(d, { view: cur, onPick: pick, onView: v => { cur = v; drawTiles(); } }),
      h("section.pf-sec", { "aria-label": "เครื่องผลิต" }, h("h3", "เครื่องผลิต", h("small", "แตะเพื่อดูรายละเอียด" + (o.readOnly ? "" : " และปุ่มงาน"))), tiles),
      tray.length ? h("section.pf-sec", { "aria-label": "ยังไม่ได้วางในผัง" }, h("h3", "ยังไม่ได้วางในผัง", h("small", "ใช้งานได้ครบ — รอบอกว่าเป็นเครื่องไหนในผัง")),
        h("div.pf-tiles", tray.map(m => machineTile(m, pick)))) : null);
    drawTiles();
    if (o.afterRender) o.afterRender(d);
  });
}

// ── รายละเอียดของที่ไม่ใช่เครื่องผลิต (ลม · น้ำเย็น · ไฟฟ้า · สกรีน) ──
function infoText(m) {
  if (m.kind === "สกรีน") return "เครื่องสกรีนสี — งานมาจากแอปทีมสกรีนสี";
  if (m.kind === "ไฟฟ้า") return /โซลาร์/.test(m.name) ? "ไฟจากโซลาร์ทำให้บิลการไฟฟ้าน้อยกว่าไฟที่เครื่องใช้จริง ค่าไฟรายเครื่องจึงต้องวัดที่ตัวเครื่อง" : "ไฟเข้าโรงงาน — ถ้ามีมิเตอร์ดิจิทัล ระบบอ่านไฟรวมเทียบกับไฟรายเครื่องได้";
  if (/แท้งลม|ถังลม/.test(m.name)) return "ถังเก็บลม — ไม่ใช้ไฟ";
  if (m.kind === "ลม") return "ระบบลม ใช้ร่วมกันหลายเครื่อง กินไฟมาก — ติดมิเตอร์ไฟแล้วจะเห็นสถานะเดิน/หยุดที่นี่";
  if (m.kind === "น้ำเย็น") return "ระบบน้ำเย็น ใช้ร่วมกันหลายเครื่อง — ติดมิเตอร์ไฟแล้วจะเห็นสถานะเดิน/หยุดที่นี่";
  return m.makes || "";
}
export function infoSheet(ctx, m) {
  ensureCss();
  const sh = ui.sheet({ title: m.name });
  add(sh.body, h("p", h("b", m.kind), m.sub ? " · " + m.sub : ""), infoText(m) ? h("p", infoText(m)) : null,
    h("div.pf-missing", h("b", "ยังไม่มีข้อมูลสด"), h("br"), "ต่อมิเตอร์ไฟ/ตัวนับที่เครื่องแล้ว สถานะจะขึ้นเอง (ของที่เครื่องวัดได้ ไม่ต้องให้คนกรอก)"),
    h("p.ref", "รหัสอ้างอิง " + m.id + " · " + (m.plant || "ยังไม่ระบุโรง")));
  return sh;
}

// ── รายละเอียดเครื่องผลิต (ใช้ในแผ่นเครื่อง) ──
/** แถบเวลาวันนี้ 00–24 น. (สีแถบ = สีขวด · ลายเฉียง = จอด) */
export function timeline(d, now) {
  const day0 = Date.parse(d.day + "T00:00:00+07:00"), span = 864e5;
  const pct = t => Math.max(0, Math.min(100, (t - day0) / span * 100));
  const bar = h("div.tl", { role: "img", "aria-label": "เส้นเวลาวันที่ " + ui.thDay(d.day) + " · " + d.runs.length + " รอบ" });
  const endOf = r => (r.ended_at ? Date.parse(r.ended_at) : r.status === "ค้างจากระบบเดิม" || r.status === "กำลังผลิต" ? now : Date.parse(r.started_at));
  for (const r of d.runs) {
    const a = pct(Date.parse(r.started_at)), b = pct(endOf(r));
    if (b > a) add(bar, h("i", { style: { left: a + "%", width: Math.max(0.6, b - a) + "%", background: colorVar(r.color) } }));
  }
  for (const e of d.events.filter(e => e.kind === "จอดเครื่อง" || (e.kind === "เปลี่ยนโมลด์" && e.work_at))) {
    const a = pct(Date.parse(e.kind === "จอดเครื่อง" ? e.started_at : e.work_at)), b = pct(e.ended_at ? Date.parse(e.ended_at) : now);
    if (b > a) add(bar, h("i.stop", { style: { left: a + "%", width: Math.max(0.6, b - a) + "%" } }));
  }
  if (now >= day0 && now < day0 + span) add(bar, h("span.now", { style: { left: pct(now) + "%" } }));
  const ticks = h("div.ticks", { "aria-hidden": "true" }, [0, 6, 12, 18, 24].map(x => h("span", { style: { left: (x / 24 * 100) + "%" } }, x + ":00")));
  return h("div", bar, ticks);
}
export function runRow(r, onOpen) {
  const t = ui.thTime(r.started_at) + "–" + (r.ended_at ? ui.thTime(r.ended_at) : r.status === "ปิดแล้ว" ? "?" : "…");
  const badges = [r.end_kind === "เปลี่ยนสี" ? "เปลี่ยนสี" : "", r.late_close ? "ปิดย้อนหลัง" : "", r.time_issue ? "เวลาผิด" : "", r.legacy ? "จากแอปเดิม" : "", r.status === "ค้างจากระบบเดิม" ? "ค้าง" : ""].filter(Boolean);
  const kids = [h("span.tm", t),
    h("span", swatch(r.color), r.label, h("br"), h("small.muted", [r.crew || "ไม่ระบุคน", ...badges].join(" · "))),
    h("span.q", r.status === "ปิดแล้ว" ? [bagsText(r.good, r.per_bag), h("small", [r.per_bag ? fmt(r.good) + " ใบ" : "", r.b ? "B " + fmt(r.b) : "", r.waste ? "เสีย " + fmt(r.waste) : ""].filter(Boolean).join(" · "))] : h("small", r.status === "กำลังผลิต" ? "เดินอยู่" : r.status))];
  if (r.time_issue) kids.push(h("span.ev", icon("alert", "sm"), " " + r.time_issue));
  return onOpen ? h("button.r", { type: "button", onclick: () => onOpen(r) }, kids) : h("div.r", kids);
}
/** ส่วนรายละเอียดเครื่อง: ไทม์ไลน์ · รอบวันนี้ · ยอดผลิต (วัน/เดือน/ทั้งหมด) · ข้อมูลเครื่อง · ยังไม่มีในระบบ · มิเตอร์ */
export function machineSections(ctx, d, opt) {
  const o = opt || {};
  const now = Date.now();
  const out = [];
  const evs = d.events.filter(e => e.kind === "จอดเครื่อง");
  out.push(h("section.pf-sec", h("h3", "วันนี้", h("small", d.runs.length + " รอบ · สีแถบ = สีขวด · ลายเฉียง = จอด")), timeline(d, now),
    d.runs.length ? h("div.pf-runs", d.runs.map(r => runRow(r, o.onRun))) : h("p.muted", "ยังไม่ได้เปิดรอบวันนี้"),
    evs.length ? h("div.stack", evs.map(e => h("p.small", icon("pause", "sm"), " จอด " + ui.thTime(e.started_at) + "–" + (e.ended_at ? ui.thTime(e.ended_at) : "ตอนนี้") + " · " + (e.reason || "ไม่ระบุ") + (e.by ? " · " + e.by : "")))) : null));
  // ยอดผลิต
  let range = "day";
  const tbl = h("div");
  const drawT = () => {
    const rows = d.totals[range];
    const lbl = { day: ui.thDay(d.day), month: "เดือนนี้", all: "ทั้งหมด" }[range];
    put(tbl, rows.length ? h("table.pf-t", h("thead", h("tr", h("th", lbl), h("th", "ดี"), h("th", "B"), h("th", "เสีย"))),
      h("tbody", rows.map(x => h("tr", h("td", swatch(x.color), x.label), h("td", x.per_bag ? [bagsText(x.good, x.per_bag), h("br"), h("small.muted", fmt(x.good) + " ใบ")] : fmt(x.good)), h("td", x.b ? fmt(x.b) : "–"), h("td", x.waste ? fmt(x.waste) : "–")))))
      : h("p.muted", "ไม่มีรอบที่ปิดในช่วงนี้"));
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.r === range)));
  };
  const seg = h("div.seg", { role: "group", "aria-label": "ช่วงเวลา" }, [["day", "วันนี้"], ["month", "เดือนนี้"], ["all", "ทั้งหมด"]].map(([k, t]) => h("button", { type: "button", dataset: { r: k }, onclick: () => { range = k; drawT(); } }, t)));
  drawT();
  out.push(h("section.pf-sec", h("h3", "ยอดผลิตของเครื่องนี้", h("small", "นับรอบที่ปิดแล้ว")), seg, tbl,
    h("p.small.muted", "นี่คือยอดที่เครื่องผลิตออกมา — ของคงเหลือดูที่เมนูสต๊อก (หักที่ส่ง/ใช้ไปแล้ว)")));
  // ข้อมูลเครื่อง
  const I = d.info, M = d.machine;
  const pct = x => (x === null || x === undefined ? "–" : (x * 100).toFixed(1) + "%");
  const kv = [];
  const add = (k, v) => { if (v !== "" && v !== null && v !== undefined) kv.push(h("dt", k), h("dd", v)); };
  add("ที่จดไว้", M.makes);
  add("โมลด์ที่ติดอยู่", M.mold);
  add("ทำบ่อย", I.top.length ? I.top.map(x => x.label + " (" + fmt(x.n) + " รอบ)").join(" · ") : "ยังไม่มีประวัติ");
  add("เฉลี่ย", I.per_hour ? fmt(I.per_hour.pcs) + " ใบ/ชม. (" + I.per_hour.label + ")" : null);
  add("ใช้งานรวม", fmt(I.runs) + " รอบ · " + fmt(Math.round(I.hours)) + " ชม." + (I.first_day ? " ตั้งแต่ " + ui.thDay(I.first_day) : "") + (I.bad_time ? " (ไม่นับ " + I.bad_time + " รอบที่เวลาผิด)" : ""));
  add("ผลิตรวม", fmt(I.good) + " ใบ");
  add("เกรด B / เสีย", pct(I.b_rate) + " / " + pct(I.waste_rate));
  add("คนใช้บ่อย", I.crew.length ? I.crew.join(" · ") : "–");
  if (M.legacy_name && M.legacy_name !== M.name) add("ชื่อในแอปเดิม", M.legacy_name);
  add("รุ่น/ยี่ห้อ", M.model); add("ปีที่ซื้อ", M.bought); add("แม่พิมพ์ที่ใช้ได้", M.molds); add("กำลังผลิตตามสเปก", M.capacity);
  out.push(h("section.pf-sec", h("h3", "ข้อมูลเครื่อง", h("small", "คิดจากประวัติรอบทั้งหมด")), h("dl.pf-kv", kv),
    I.notes.length ? h("div.stack", h("div.lbl", "หมายเหตุล่าสุด"), I.notes.map(n => h("p.small", ui.thDay(n.started_day) + " · " + n.note))) : null,
    I.molds.length ? h("div.stack", h("div.lbl", "เปลี่ยนโมลด์ล่าสุด"), I.molds.map(x => h("p.small", ui.thDayOf(x.started_at) + " · " + (x.mold_from || "—") + " → " + (x.mold_to || "—") + (x.ended_at ? "" : " (ยังไม่เสร็จ)")))) : null,
    I.missing.length ? h("div.pf-missing", h("b", "ยังไม่มีในระบบ"), h("br"), I.missing.join(" · "), h("br"), "กรอกครั้งเดียวในทะเบียนเครื่อง (ประธาน)") : null,
    h("div.pf-missing", h("b", "มิเตอร์ไฟ/ตัวนับ"), h("br"), d.meters.length ? d.meters.map(x => x.name + ": " + (x.last === null ? "ยังไม่มีค่า" : fmt(x.last) + " " + x.unit + " (" + ui.thTime(x.last_at) + ")")).join(" · ") : "ยังไม่ได้ติด — ติดแล้วจะเห็นเดิน/หยุดจริงและค่าไฟต่อ 1,000 ใบที่นี่")));
  return out;
}
