// ═══════════════════════════════════════════════════════════════════════
//  ชิ้นส่วนเล็กที่หลายหน้าใช้ร่วม (ทำโดยแชทออฟฟิศ — บทบาทอื่น import ได้)                 v2/web/parts/kit.js
//  วันที่ไทย · เงินบาท · แชร์ข้อความไลน์ · แป้นราคา (มีจุดทศนิยม) · ปฏิทินเต็มเดือน · แถวสัปดาห์ · ปุ่มเลือกแบบเห็นทุกตัว
//  เซิร์ฟเวอร์ตอบ "ต้องใส่เหตุผล" → แผ่นชิปเหตุผลแล้วส่งซ้ำ (withReason)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
const { h, icon } = ui;

/** แทนที่ลูกทั้งหมดของ el — ข้าม null/false (DOM replaceChildren(null) พิมพ์คำว่า "null" บนจอ) */
export const put = (el, ...kids) => el.replaceChildren(...kids.flat(9).filter(k => k !== null && k !== undefined && k !== false && k !== ""));
const loaded = new Set();
/** ใส่ไฟล์ CSS ครั้งเดียว (ชิ้นส่วนแต่ละตัวพก CSS ของตัวเอง — ไม่ต้องแก้ app.css กลาง) */
export function useCss(href) {
  const url = new URL(href, import.meta.url).href;
  if (loaded.has(url)) return;
  loaded.add(url);
  document.head.append(h("link", { rel: "stylesheet", href: url }));
}
useCss("./parts.css");

// ── วันที่ (วันไทย "YYYY-MM-DD" — คิดแบบ UTC+7 คงที่ ไม่พึ่งเขตเวลาของเครื่อง) ─────────────
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export const TH_DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export const todayTh = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const asDate = day => { const [y, m, d] = String(day).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
export const addDay = (day, n) => new Date(asDate(day).getTime() + n * 864e5).toISOString().slice(0, 10);
export const dowOf = day => asDate(day).getUTCDay();
export const daysBetween = (a, b) => Math.round((asDate(b) - asDate(a)) / 864e5);
/** "พฤ. 19 พ.ย." · ใส่ปี พ.ศ. ถ้าไม่ใช่ปีนี้ */
export function thDayLong(day) {
  if (!day) return "";
  const d = asDate(day), y = d.getUTCFullYear();
  return TH_DOW[d.getUTCDay()] + " " + d.getUTCDate() + " " + TH_MONTH[d.getUTCMonth()] + (y === asDate(todayTh()).getUTCFullYear() ? "" : " " + String((y + 543) % 100).padStart(2, "0"));
}
/** วันส่งแบบคนพูด: วันนี้ · พรุ่งนี้ · อีก 3 วัน · เลยมา 2 วัน */
export function dueWords(day, today) {
  if (!day) return "ยังไม่กำหนดวันส่ง";
  const n = daysBetween(today || todayTh(), day);
  if (n === 0) return "ส่งวันนี้";
  if (n === 1) return "ส่งพรุ่งนี้";
  if (n < 0) return "เลยกำหนด " + (-n) + " วัน";
  return "ส่ง " + thDayLong(day);
}

// ── เงิน/จำนวน ─────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat("th-TH");
export const n0 = n => nf.format(Number(n) || 0);
/** สตางค์ → "1,234.50" (ไม่มี ฿ — ใส่เองตามที่) */
export const baht = s => (Number(s) / 100).toLocaleString("th-TH", { minimumFractionDigits: Number(s) % 100 ? 2 : 0, maximumFractionDigits: 2 });
/** บรรทัดจำนวนของรายการ: "40 ถุง + 15 ใบ (8,015 ใบ)" / "500 ชิ้น" */
export function qtyWords(it) {
  const unit = it.piece_unit || it.unit || (it.type === "ขวด" || it.type === "ถัง" ? "ใบ" : "ชิ้น");
  if (it.per_bag && it.bags) return n0(it.bags) + " ถุง" + (it.extra_pcs ? " + " + n0(it.extra_pcs) + " " + unit : "") + " (" + n0(it.qty_pcs) + " " + unit + ")";
  return n0(it.qty_pcs) + " " + unit;
}
export const nameKey = s => String(s || "").toLowerCase().replace(/[\s()\-_.,'"]/g, "");
export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return a.length || b.length;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}

// ── แชร์ข้อความเข้าไลน์ (มือถือ = แผ่นแชร์ของเครื่อง · คอม = คัดลอกให้วาง) ─────────────────────
export async function shareText(text, files) {
  if (navigator.share) {
    try { await navigator.share(files && navigator.canShare && navigator.canShare({ files }) ? { files, text } : { text }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "abort"; }
  }
  try { await navigator.clipboard.writeText(text); ui.toast("คัดลอกแล้ว — เปิดไลน์แล้ววางได้เลย"); return "copied"; }
  catch (e) {
    const ta = h("textarea", { style: { position: "fixed", opacity: "0" } }, text);
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    ui.toast(ok ? "คัดลอกแล้ว — เปิดไลน์แล้ววางได้เลย" : "คัดลอกไม่ได้ — กดค้างที่ข้อความแล้วคัดลอกเอง", ok ? "" : "warn");
    return ok ? "copied" : "fail";
  }
}

// ── ปุ่มเลือกแบบเห็นทุกตัว (แทน dropdown) ─────────────────────────────────────
/** seg([["ค่า","คำบนจอ"],…], ค่าปัจจุบัน, onChange, {label, allowNone}) */
export function seg(options, value, onChange, opt) {
  const o = opt || {};
  const box = h("div.chips.seg", { role: "group", "aria-label": o.label || null });
  const draw = v => box.querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  options.forEach(([v, label]) => box.append(h("button.chip", { type: "button", dataset: { v }, "aria-pressed": String(v === value), onclick: () => {
    const nv = o.allowNone && v === box.dataset.cur ? "" : v;
    box.dataset.cur = nv; draw(nv); onChange(nv);
  } }, label)));
  box.dataset.cur = value || "";
  box.set = v => { box.dataset.cur = v || ""; draw(v || ""); };
  return box;
}

// ── แป้นราคา (บาท มีจุด) → สตางค์ · ราคาตั้งแตะใช้ได้ทีเดียว · null = ล้างราคา · undefined = ยกเลิก ─────────
export function pricePad(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let v = o.value === null || o.value === undefined ? "" : String(Number(o.value) / 100), result;
    const S = ui.sheet({ title: o.title || "ราคาต่อหน่วย", modal: true, onClose: () => resolve(result) });
    const out = h("span.v", { "aria-live": "polite" });
    const show = () => { out.textContent = v === "" ? "ไม่ใส่ราคา" : "฿" + (v.endsWith(".") || /\.\d?0$/.test(v) ? v : Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 })); };
    const key = k => {
      if (k === "del") v = v.slice(0, -1);
      else if (k === ".") { if (!v.includes(".")) v = (v || "0") + "."; }
      else if (/^\d$/.test(k)) { const [, dec] = v.split("."); if (dec !== undefined && dec.length >= 2) return; if (v.replace(".", "").length < 8) v = v === "0" ? k : v + k; }
      show();
    };
    const b = (label, k, cls, aria) => h("button" + (cls || ""), { type: "button", "aria-label": aria || null, onclick: () => key(k) }, label);
    const pad = h("div.numpad", ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => b(d, d)), b(".", ".", "", "จุดทศนิยม"), b("0", "0"), b(icon("del"), "del", "", "ลบ"));
    S.body.append(h("div.numdisp", h("span.k", o.label || "บาท/" + (o.unit || "ใบ")), out), pad);
    if (o.list !== null && o.list !== undefined) S.body.append(h("button.btn", { type: "button", onclick: () => { result = o.list; S.close("ok"); } }, "ใช้ราคาตั้ง ฿" + baht(o.list) + "/" + (o.unit || "ใบ")));
    S.body.append(h("div.btns", h("button.btn", { type: "button", onclick: () => { result = null; S.close("ok"); } }, "ไม่ใส่ราคา"),
      h("button.btn.pri", { type: "button", onclick: () => {
        if (v === "" || v === ".") { result = null; S.close("ok"); return; }
        result = Math.round(Number(v) * 100); S.close("ok");
      } }, "ตกลง")));
    show();
  });
}

// ── ปฏิทินเต็มเดือน (แตะวัน) → วันไทย | "" (ยังไม่กำหนด) | undefined (ปิด) ──────────────────────
export function dateSheet(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let result, month = (o.value || o.min || todayTh()).slice(0, 7);
    const S = ui.sheet({ title: o.title || "เลือกวัน", modal: true, onClose: () => resolve(result) });
    const head = h("div.row.cal-head"), grid = h("div.cal", { role: "grid" });
    const draw = () => {
      const [y, m] = month.split("-").map(Number);
      put(head, 
        h("button.iconbtn", { type: "button", "aria-label": "เดือนก่อน", onclick: () => { month = addDay(month + "-01", -1).slice(0, 7); draw(); } }, icon("back")),
        h("b.grow", { style: { textAlign: "center" } }, TH_MONTH_FULL[m - 1] + " " + (y + 543)),
        h("button.iconbtn.flip", { type: "button", "aria-label": "เดือนถัดไป", onclick: () => { month = addDay(month + "-28", 7).slice(0, 7); draw(); } }, icon("back")));
      const first = month + "-01", pad = dowOf(first), days = [];
      for (let d = first; d.slice(0, 7) === month; d = addDay(d, 1)) days.push(d);
      put(grid, ...TH_DOW.map(w => h("span.dow", w)), ...Array.from({ length: pad }, () => h("span")),
        ...days.map(d => h("button.day" + (d === o.value ? ".on" : "") + (d === todayTh() ? ".today" : ""), {
          type: "button", disabled: o.min && d < o.min ? true : null, "aria-label": thDayLong(d), "aria-pressed": String(d === o.value),
          onclick: () => { result = d; S.close("ok"); } }, String(Number(d.slice(8))))));
    };
    S.body.append(head, grid);
    if (o.allowNone) S.body.append(h("button.btn", { type: "button", onclick: () => { result = ""; S.close("ok"); } }, o.noneText || "ยังไม่กำหนด"));
    draw();
  });
}
/** แถวสัปดาห์ 7 ช่อง (วันนี้ → +6) + ปุ่มปฏิทิน · onPick(day) */
export function weekRow(value, onPick, opt) {
  const o = opt || {};
  const box = h("div.week", { role: "group", "aria-label": o.label || "เลือกวัน" });
  const draw = v => {
    const t = todayTh();
    const cells = Array.from({ length: 7 }, (_, i) => addDay(t, i));
    put(box, ...cells.map((d, i) => h("button.wd" + (d === v ? ".on" : ""), { type: "button", "aria-pressed": String(d === v), "aria-label": thDayLong(d), onclick: () => { draw(d); onPick(d); } },
      h("small", i === 0 ? "วันนี้" : i === 1 ? "พรุ่งนี้" : TH_DOW[dowOf(d)]), h("b", String(Number(d.slice(8))))),
    ), h("button.wd.cal-btn" + (v && !cells.includes(v) ? ".on" : ""), { type: "button", "aria-label": "ปฏิทินเต็มเดือน", onclick: async () => {
      const d = await dateSheet({ title: o.title || "วันส่ง", value: v, min: o.min === undefined ? t : o.min, allowNone: o.allowNone, noneText: o.noneText });
      if (d === undefined) return;
      draw(d); onPick(d);
    } }, icon("calendar", "sm"), h("small", v && !cells.includes(v) ? thDayLong(v).replace(/^\S+ /, "") : "ปฏิทิน")));
  };
  draw(value);
  box.set = draw;
  return box;
}

/**
 * เรียกบันทึก → ถ้าหลังบ้านตอบ "ต้องใส่เหตุผล" (แก้หลังทีมผลิตรับ · รับเกิน · ราคาต่างจากออเดอร์) เปิดแผ่นชิปเหตุผลบอกสาเหตุ แล้วส่งซ้ำ
 *   doWrite(reason) → Promise · คืนผล หรือ null ถ้าผู้ใช้กดกลับไปแก้
 */
export async function withReason(ctx, doWrite, reasonKind, title) {
  try { return await doWrite(""); }
  catch (e) {
    if (e.code !== "need_reason") throw e;
    const why = ((e.detail && e.detail.why) || [e.message]).map(w => h("li", w));
    const c = await ui.confirmSheet({ title: title || "ต้องใส่เหตุผลก่อนบันทึก", detail: h("div", h("p", "ระบบเจอเรื่องนี้:"), h("ul.why", why)), reasons: ctx.reasons(reasonKind), need: "required", okText: "บันทึกพร้อมเหตุผล" });
    if (!c) return null;
    return doWrite(c.reason);
  }
}

/** ป้ายจำนวนแบบออเดอร์ [ขนาด | ตัวเลขหนา หน่วย] — นับเป็นถุงโชว์ถุง (ใบอยู่ใน title) */
export function itemBadge(it) {
  const size = it.size || (it.type === "ขวด" || it.type === "ถัง" ? "" : it.type);
  const unit = it.piece_unit || (it.type === "ขวด" || it.type === "ถัง" ? "ใบ" : "ชิ้น");
  if (it.per_bag && it.bags) return ui.qty(size, it.bags, "ถุง" + (it.extra_pcs ? " +" + n0(it.extra_pcs) : ""), n0(it.qty_pcs) + " " + unit);
  return ui.qty(size, it.qty_pcs, unit);
}
/** ชื่อสินค้าสั้นสำหรับแถว (ขนาดอยู่ในป้ายแล้ว): "ขวด MK ใส · สกรีนน้ำเงิน" */
export function itemShort(it) {
  return [[it.type === "ขวด" ? "" : it.type, it.shape, it.neck, it.color].filter(Boolean).join(" ") || it.type,
    it.screen_color ? "สกรีน" + it.screen_color : "", it.cap_color ? "ฝา" + it.cap_color : ""].filter(Boolean).join(" · ");
}
