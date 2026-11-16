// ═══════════════════════════════════════════════════════════════════════
//  ชิ้นส่วนหน้าจอกลาง — ทุกบทบาทใช้ชุดเดียว (แชทโมดูล import จากไฟล์นี้ ห้ามทำของซ้ำ)        v2/web/assets/ui.js
//  h() สร้าง DOM แบบปลอดภัย (ข้อความใส่เป็น textContent เสมอ — ไม่มี innerHTML จากข้อมูล)
//  แผ่นล่าง · แผ่นยืนยัน + ชิปเหตุผล · แถบ "ย้อน" · แป้นตัวเลข · แป้น PIN · ป้ายจำนวน · ป้ายสถานะ · ว่าง · วาดรายการแบบไม่กระพริบ
//  ห้ามใช้ alert / confirm / prompt ของเบราว์เซอร์
// ═══════════════════════════════════════════════════════════════════════

/** h('div.card#id', {onclick, 'aria-label': …}, ...children) — children: ข้อความ/โหนด/อาร์เรย์/null */
export function h(sel, attrs, ...kids) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel || "div");
  const el = document.createElement((m && m[1]) || "div");
  if (m && m[2]) for (const p of m[2].match(/[.#][\w-]+/g)) { if (p[0] === ".") el.classList.add(p.slice(1)); else el.id = p.slice(1); }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv; } }
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = c => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
export const ICONS = "assets/icons.svg";
/** ไอคอนจาก sprite ชุดเดียว (assets/icons.svg) */
export function icon(name, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("class", "ic" + (cls ? " " + cls : ""));
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(SVGNS, "use");
  u.setAttribute("href", ICONS + "#i-" + name);
  s.append(u);
  return s;
}

// ── ตัวเลข/เงิน/เวลา (ภาษาไทย · ไม่โชว์รหัสระบบ) ────────────────────────
const nf = new Intl.NumberFormat("th-TH");
export const fmt = n => (n === null || n === undefined || n === "" ? "—" : nf.format(Number(n)));
/** เงิน: สตางค์ → "฿1,234.50" · fresh=false (ข้อมูลไม่สด/โหลดไม่สำเร็จ) = "—" ห้ามโชว์เลขเก่าหรือ ฿0 */
export function money(satang, fresh) {
  if (fresh === false || satang === null || satang === undefined) return "—";
  const v = Number(satang) / 100;
  return "฿" + v.toLocaleString("th-TH", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** "2026-11-16" → "16 พ.ย." (ปีนี้) / "16 พ.ย. 68" */
export function thDay(day) {
  if (!day) return "";
  const [y, m, d] = String(day).split("-").map(Number);
  const now = new Date(Date.now() + 7 * 3600000);
  return d + " " + TH_MONTH[m - 1] + (y === now.getUTCFullYear() ? "" : " " + String((y + 543) % 100).padStart(2, "0"));
}
/** ISO → วันไทย "16 พ.ย." (ไม่ใช้ส่วนวันที่ของ ISO ตรง ๆ — นั่นคือวัน UTC) */
export function thDayOf(isoStr) { if (!isoStr) return ""; const d = new Date(Date.parse(isoStr) + 7 * 3600000); return thDay(d.toISOString().slice(0, 10)); }
/** ISO → "09:41" เวลาไทย */
export function thTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(Date.parse(isoStr) + 7 * 3600000);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}
/** ช่วงเวลาที่ผ่านมา: "2 ชม. 15 น." */
export function since(isoStr, now) {
  const m = Math.max(0, Math.floor(((now || Date.now()) - Date.parse(isoStr)) / 60000));
  return m < 60 ? m + " น." : Math.floor(m / 60) + " ชม." + (m % 60 ? " " + (m % 60) + " น." : "");
}

// ── ป้ายจำนวน [ขนาด | ตัวเลขหนา หน่วย] ─────────────────────────────────
//   ของที่นับเป็นถุง: โชว์ถุง (ตัวหนา) + ใบเป็นตัวรอง · ไม่มีขนาด = ตัดช่องซ้าย
export function qty(size, n, unit, title) {
  return h("span.qty", { title: title || null }, size ? h("i", size) : null, h("b", fmt(n)), unit ? h("i", unit) : null);
}
/** รายการออเดอร์ → ป้าย: ขวด 600 ml [40 ถุง] (8,000 ใบ) */
export function itemQty(it) {
  const size = [it.type === "ขวด" ? "" : it.type, it.size, it.color].filter(Boolean).join(" ") || it.label || it.type;
  if (it.bags && it.per_bag) return qty(size, it.bags, "ถุง", fmt(it.qty_pcs) + " " + (it.piece_unit || "ใบ"));
  return qty(size, it.qty_pcs, it.piece_unit || "ชิ้น");
}

// ── ป้ายสถานะ: สี + คำ + สัญลักษณ์ (ไม่ใช้สีอย่างเดียว) ──────────────────────
const TONE_ICON = { ok: "check-circle", warn: "clock", bad: "alert", brand: "dot", mute: "dot", "": "dot" };
export function pill(text, tone, iconName) {
  return h("span.pill.t-" + (tone || "mute"), icon(iconName || TONE_ICON[tone || ""], "sm"), text);
}
/** ป้ายสถานะจากคลังค่า (vocab ที่ได้จาก system.me) — kind = "orders.status" */
export function statusPill(vocab, kind, value) {
  const v = ((vocab || {})[kind] || []).find(x => x.value === value);
  return pill(v ? v.label : value || "—", v ? v.tone : "mute");
}

// ── ว่าง = "ไม่มีงานค้าง" · โหลด · ผิดพลาด ─────────────────────────────────
export function empty(text, sub) {
  return h("div.empty", { role: "status" }, icon("check-circle"), h("b", text || "ไม่มีงานค้าง"), sub ? h("span", sub) : null);
}
export function skeleton(n) { return h("div.stack", { "aria-busy": "true", "aria-label": "กำลังโหลด" }, Array.from({ length: n || 3 }, () => h("div.skel"))); }
export function errorBox(msg, retry) {
  return h("div.banner.t-bad", { role: "alert" }, icon("alert"), h("span", msg), retry ? h("button.btn", { type: "button", onclick: retry }, "ลองใหม่") : null);
}
/** บรรทัด "ข้อมูลเมื่อ 09:41 · กำลังอัปเดต" — บอกตรง ๆ ว่าจอโชว์ของรอบไหน */
export function stamp(at, updating) {
  return h("span.stamp", icon("clock", "sm"), "ข้อมูลเมื่อ " + thTime(at) + (updating ? " · กำลังอัปเดต…" : ""));
}

// ── วาดรายการแบบไม่กระพริบ: ใช้โหนดเดิมถ้าข้อมูลแถวนั้นไม่เปลี่ยน · เรียงตามข้อมูลใหม่ ──────────
export function renderList(box, items, keyOf, render, emptyNode) {
  const old = new Map([...box.children].filter(c => c.dataset && c.dataset.k).map(c => [c.dataset.k, c]));
  const nodes = items.map(it => {
    const k = String(keyOf(it)), sig = JSON.stringify(it);
    const prev = old.get(k);
    if (prev && prev.dataset.sig === sig) { old.delete(k); return prev; }
    const n = render(it);
    n.dataset.k = k; n.dataset.sig = sig;
    return n;
  });
  if (!items.length && emptyNode) { box.replaceChildren(emptyNode); return; }
  box.replaceChildren(...nodes);
}

// ── ปุ่มกำลังทำ: ⏳ ทันที + กันกดซ้ำ · ช้าเกิน 6 วิ บอกว่า "ยังรออยู่ ไม่ต้องกดซ้ำ" ──────────────
export async function busy(btn, fn) {
  if (btn.classList.contains("busy")) return;
  const label = btn.textContent;
  btn.classList.add("busy"); btn.setAttribute("aria-disabled", "true"); btn.setAttribute("aria-busy", "true");
  const slow = setTimeout(() => { btn.dataset.slow = "1"; toast("ยังรอหลังบ้านอยู่ ไม่ต้องกดซ้ำ", "warn"); }, 6000);
  try { return await fn(); }
  finally { clearTimeout(slow); btn.classList.remove("busy"); btn.removeAttribute("aria-disabled"); btn.removeAttribute("aria-busy"); if (btn.textContent !== label) btn.textContent = label; }
}

// ── ข้อความสั้น (มุมล่าง) ─────────────────────────────────────────────
let toastEl = null, toastT = 0;
export function toast(msg, tone) {
  if (!toastEl) { toastEl = h("div.snack", { role: "status", "aria-live": "polite" }); document.body.append(toastEl); }
  toastEl.replaceChildren(h("span.msg", msg));
  toastEl.dataset.tone = tone || "";
  requestAnimationFrame(() => toastEl.classList.add("on"));
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove("on"), 3500);
}

// ── แถบ "ย้อน" หลังบันทึก — กดได้ ~10 วิ (ย้อนจากประวัติได้ต่อจนกว่าขั้นถัดไปรับ) ────────────────
export function undoBar(label, onUndo, ms) {
  if (!toastEl) { toastEl = h("div.snack", { role: "status", "aria-live": "polite" }); document.body.append(toastEl); }
  clearTimeout(toastT);
  const btn = h("button", { type: "button" }, icon("undo", "sm"), " ย้อน");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { await onUndo(); toastEl.replaceChildren(h("span.msg", "ย้อนแล้ว — " + label)); }
    catch (e) { toastEl.replaceChildren(h("span.msg", e.message || "ย้อนไม่สำเร็จ")); }
    toastT = setTimeout(() => toastEl.classList.remove("on"), 3000);
  });
  toastEl.replaceChildren(h("span.msg", icon("check", "sm"), " บันทึกแล้ว · " + label), btn);
  requestAnimationFrame(() => toastEl.classList.add("on"));
  toastT = setTimeout(() => toastEl.classList.remove("on"), ms || 10000);
}

// ── แผ่นล่างแบบ Google Maps: ลากหูจับขึ้น/ลงได้ 3 ระดับ (ครึ่ง/เต็ม/ปิด) · Esc ปิด · โฟกัสวนในแผ่น ──────────
//   จอกว้าง ≥1100 = แผงขวา (modal:true = กล่องกลางจอ สำหรับยืนยัน/PIN)
let openSheets = [];
export const sheetOpen = () => openSheets.length > 0;
export function sheet(opt) {
  const o = opt || {};
  const prevFocus = document.activeElement;
  const scrim = h("div.scrim", { "aria-hidden": "true" });
  const titleId = "sh" + Math.random().toString(36).slice(2, 8);
  const body = h("div.sheet-body");
  const foot = o.foot ? h("div.sheet-foot") : null;
  const closeBtn = h("button.iconbtn", { type: "button", "aria-label": "ปิด", onclick: () => close("x") }, icon("close"));
  const el = h("section.sheet" + (o.modal ? ".modal" : ""), { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("div.grab", { "aria-hidden": "true" }), h("div.sheet-head", h("h2", { id: titleId }, o.title || ""), o.noClose ? null : closeBtn), body, foot);
  document.body.append(scrim, el);
  let resolve; const done = new Promise(r => { resolve = r; });
  let closed = false;
  function close(why) {
    if (closed) return; closed = true;
    el.classList.remove("on"); scrim.classList.remove("on");
    openSheets = openSheets.filter(s => s !== api);
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => { el.remove(); scrim.remove(); }, 340);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (o.onClose) o.onClose(why);
    resolve(why);
  }
  function onKey(e) {
    if (openSheets[openSheets.length - 1] !== api) return;
    if (e.key === "Escape" && !o.noClose) { e.preventDefault(); close("esc"); }
    if (e.key === "Tab") {   // โฟกัสวนอยู่ในแผ่น
      const f = [...el.querySelectorAll("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])")].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  document.addEventListener("keydown", onKey, true);
  // กดนอกแผ่น = ปิดแผ่น (ของที่กรอกไว้ยังอยู่กับเจ้าของฟอร์ม — แผ่นไม่ล้างอะไร)
  scrim.addEventListener("click", () => { if (!o.noClose) close("scrim"); });
  // ลากหูจับ: ลงเกิน 30% = ปิด · ขึ้น = เต็ม
  const grab = el.querySelector(".grab");
  let y0 = null, dy = 0;
  const onMove = e => { if (y0 === null) return; dy = Math.max(-40, e.clientY - y0); el.style.setProperty("--sheet-y", dy + "px"); };
  const onUp = () => {
    if (y0 === null) return;
    el.classList.remove("dragging"); el.style.setProperty("--sheet-y", "0px");
    if (dy > el.offsetHeight * 0.3 && !o.noClose) close("drag");
    else if (dy < -20) el.style.maxHeight = "94dvh";
    y0 = null; dy = 0;
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
  };
  grab.addEventListener("pointerdown", e => { y0 = e.clientY; el.classList.add("dragging"); window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); });
  const api = { el, body, foot, close, done, set title(t) { el.querySelector("h2").textContent = t; } };
  openSheets.push(api);
  requestAnimationFrame(() => { scrim.classList.add("on"); el.classList.add("on"); (el.querySelector(o.focus || ".sheet-body button, .sheet-body input, .sheet-foot button") || closeBtn).focus({ preventScroll: true }); });
  return api;
}

// ── แผ่นยืนยัน + ชิปเหตุผล (+ "อื่น ๆ (พิมพ์เอง)") — คืน { reason } หรือ null ถ้ายกเลิก ──────────────
//   reasons: รายการคำ (จาก vocab "reason.*") · need: 'required' | 'optional' | false · danger: ปุ่มแดง
export function confirmSheet(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let picked = "", other = false, result = null;
    const S = sheet({ title: o.title || "ยืนยัน", modal: true, foot: true, onClose: () => resolve(result) });
    if (o.detail) S.body.append(typeof o.detail === "string" ? h("p", o.detail) : o.detail);
    const msg = h("p.err", { role: "alert" });
    const input = h("input", { type: "text", maxlength: 300, placeholder: "พิมพ์เหตุผล", "aria-label": "เหตุผล (พิมพ์เอง)" });
    const box = h("div.field", { hidden: true }, input);
    if (o.reasons !== false && (o.reasons || o.need)) {
      const chips = h("div.chips", { role: "group", "aria-label": "เหตุผล" });
      const all = [...(o.reasons || []), "อื่น ๆ (พิมพ์เอง)"];
      all.forEach(r => chips.append(h("button.chip", { type: "button", "aria-pressed": "false", onclick: e => {
        chips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", "false"));
        e.currentTarget.setAttribute("aria-pressed", "true");
        other = r === "อื่น ๆ (พิมพ์เอง)"; picked = other ? "" : r;
        box.hidden = !other; if (other) input.focus();
        msg.textContent = "";
      } }, r)));
      S.body.append(h("div.lbl", o.need === "required" ? "เหตุผล (ต้องเลือก)" : "เหตุผล (ถ้ามี)"), chips, box);
    }
    S.body.append(msg);
    const ok = h("button.btn.block" + (o.danger ? ".pri" : ".pri"), { type: "button" }, o.okText || "ยืนยัน");
    ok.addEventListener("click", () => {
      const reason = other ? input.value.trim() : picked;
      if (o.need === "required" && !reason) { msg.textContent = other ? "พิมพ์เหตุผลก่อน" : "เลือกเหตุผลก่อน"; return; }
      result = { reason };
      S.close("ok");
    });
    S.foot.append(h("div.btns", h("button.btn", { type: "button", onclick: () => S.close("cancel") }, "กลับไปแก้"), ok));
  });
}

// ── แป้นตัวเลขของแอป (ไม่ใช้คีย์บอร์ดมือถือ) — คืนจำนวนเต็ม หรือ null ─────────────────────
export function numpadSheet(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let v = o.value !== undefined && o.value !== null ? String(o.value) : "", result = null;
    const S = sheet({ title: o.title || "ใส่จำนวน", modal: true, onClose: () => resolve(result) });
    const out = h("span.v", { "aria-live": "polite" });
    const show = () => { out.textContent = v === "" ? "0" : fmt(Number(v)); };
    const pad = numpad(k => {
      if (k === "del") v = v.slice(0, -1);
      else if (k === "ok") { result = v === "" ? null : Number(v); S.close("ok"); return; }
      else if (v.length < (o.maxLen || 9)) v = (v === "0" ? "" : v) + k;
      show();
    }, { ok: o.okText || "ตกลง" });
    S.body.append(h("div.numdisp", h("span.k", o.label || ""), out, o.unit ? h("span.k", o.unit) : null), pad);
    show();
  });
}
/** แป้นตัวเลข: onKey('0'..'9' | 'del' | 'ok') */
export function numpad(onKey, opt) {
  const o = opt || {};
  const b = (label, k, cls, aria) => h("button" + (cls || ""), { type: "button", "aria-label": aria || null, onclick: () => onKey(k) }, label);
  return h("div.numpad", ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => b(d, d)),
    b(icon("del"), "del", "", "ลบ"), b("0", "0"), b(o.ok === false ? "" : (o.okIcon ? icon(o.okIcon) : (o.ok || "ตกลง")), "ok", ".ok", o.okAria || "ยืนยัน"));
}

// ── แป้น PIN (เข้าระบบ / ทีมผลิต "ใครบันทึก") — onSubmit(pin) → { ok } | { error, shake } ─────────────
export function pinPad(container, onSubmit, opt) {
  const o = opt || {};
  let pin = "", working = false;
  const dots = h("div.pin-dots", { "aria-label": "PIN ใส่แล้ว 0 หลัก" });
  const msg = h("p.err", { role: "alert", "aria-live": "assertive" });
  const draw = () => { dots.replaceChildren(...Array.from({ length: o.len || 4 }, (_, i) => h("span" + (i < pin.length ? ".on" : "")))); dots.setAttribute("aria-label", "PIN ใส่แล้ว " + pin.length + " หลัก"); };
  async function submit() {
    if (working || !pin) return;
    working = true; msg.textContent = o.busyText || "กำลังตรวจ PIN…"; msg.className = "muted";
    const slow = setTimeout(() => { msg.textContent = "Google ตอบช้ากว่าปกติ — ยังรออยู่ ไม่ต้องกดซ้ำ"; }, 6000);
    let r;
    try { r = await onSubmit(pin); } catch (e) { r = { error: e.message || "ส่งไม่สำเร็จ — เช็คเน็ตแล้วลองอีกครั้ง" }; }
    clearTimeout(slow); working = false;
    if (r && r.ok) { msg.textContent = ""; return; }
    msg.className = "err"; msg.textContent = (r && r.error) || "ไม่สำเร็จ";
    pin = ""; draw();
    if (r && r.shake) { dots.classList.add("shake"); setTimeout(() => dots.classList.remove("shake"), 450); }
  }
  const pad = numpad(k => {
    if (working) return;
    if (k === "del") pin = pin.slice(0, -1);
    else if (k === "ok") return submit();
    else if (pin.length < 6) pin += k;
    draw();
    if (pin.length === (o.len || 4) && o.auto !== false) submit();
  }, { okIcon: "check", okAria: "ยืนยัน PIN" });
  container.append(dots, msg, pad);
  draw();
  return { reset() { pin = ""; draw(); msg.textContent = ""; } };
}
