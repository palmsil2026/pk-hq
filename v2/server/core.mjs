// ============================================================
//  โรงขวด P&K v2 — ของกลางฝั่งหลังบ้าน (ไม่ผูกกับ Cloudflare — เทสต์รันใน Node + sqlite ได้)     v2/server/core.mjs
//  เวลา: Worker รัน UTC → วันไทยคิดด้วย thaiDay() (UTC+7 คงที่ ประเทศไทยไม่มีเวลาออมแสง) ห้ามใช้ getDate()/getHours() ตรง ๆ
//  เงิน = จำนวนเต็มสตางค์ · จำนวนของ = จำนวนเต็มใบ/ชิ้น · ข้อความผิดพลาด = ภาษาไทย บอกสาเหตุจริง
// ============================================================

export const API_VERSION = "v2-foundation-2026-11-16";
const TZ_MS = 7 * 3600000;

// ---- ข้อผิดพลาดที่ตั้งใจส่งให้ผู้ใช้เห็น (ข้อความไทย) ----
export class Fail extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}
export const bad = (msg, extra) => new Fail(400, "bad_input", msg, extra);
export const denied = msg => new Fail(403, "forbidden", msg || "บทบาทนี้ทำรายการนี้ไม่ได้");
export const notFound = msg => new Fail(404, "not_found", msg || "ไม่พบรายการ (อาจถูกเปลี่ยนไปแล้ว — โหลดใหม่)");
export const conflict = (msg, extra) => new Fail(409, "conflict", msg || "มีคนแก้รายการนี้ไปก่อนแล้ว — โหลดใหม่แล้วลองอีกครั้ง", extra);
export const needLogin = msg => new Fail(401, "need_login", msg || "ยังไม่ได้เข้าสู่ระบบ หรือหมดอายุ — เข้าสู่ระบบใหม่");

// ---- เวลา ----
export const iso = ms => new Date(ms).toISOString();
const pad = n => (n < 10 ? "0" : "") + n;
export function thaiDay(ms) {
  const d = new Date(ms + TZ_MS);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
export function thaiHm(ms) { const d = new Date(ms + TZ_MS); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
/** วันไทย "YYYY-MM-DD" + HH:mm ไทย → มิลลิวินาที UTC */
export function atThai(day, h, m) { const p = String(day).split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2], h || 0, m || 0) - TZ_MS; }
export function addDays(day, n) { return thaiDay(atThai(day, 12, 0) + n * 86400000); }
export function isDay(v) { const s = String(v || ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s; }
export function isIso(v) { const s = String(v || ""); return s.length === 24 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && iso(Date.parse(s)) === s; }

// ---- รหัสแถว: เรียงตามเวลา + สุ่ม (ไม่ต้องใช้ตัวนับ · รหัสไม่ขึ้นจอ) ----
const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford base32
export function newId(prefix, ms) {
  let t = Math.floor(Number(ms) || Date.now()), s = "";
  for (let i = 0; i < 9; i++) { s = ALPHA[t % 32] + s; t = Math.floor(t / 32); }
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) s += ALPHA[r[i] % 32];
  return (prefix || "") + s;
}

// ---- ข้อความ/ตัวเลขจากหน้าเว็บ (ไม่เชื่ออะไรเลย) ----
/** ข้อความที่คนพิมพ์: ตัดอักขระควบคุม · ยุบช่องว่าง · ตัด = + - @ ที่ขึ้นต้น (กันกลายเป็นสูตรเมื่อส่งออกชีต/CSV) */
export function text(v, max, name) {
  const s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/^[=+\-@]+/, "").trim();
  if (max && s.length > max) throw bad((name || "ข้อความ") + " ยาวเกิน " + max + " ตัวอักษร");
  return s;
}
export function need(v, name, max) {
  const s = text(v, max || 200, name);
  if (!s) throw bad("ต้องใส่" + name);
  return s;
}
/** จำนวนเต็ม (ใบ/ชิ้น/ถุง/สตางค์) — รับเลขหรือข้อความเลขล้วน ไม่มีทศนิยม · ไม่เดาค่าแทนคน */
export function int(v, name, opt) {
  const o = opt || {};
  if (v === null || v === undefined || v === "") {
    if (o.optional) return null;
    throw bad("ต้องใส่" + name);
  }
  const s = typeof v === "number" ? v : String(v).replace(/,/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || (typeof s === "string" && !/^-?\d+$/.test(s))) throw bad(name + " ต้องเป็นจำนวนเต็ม");
  if (o.min !== undefined && n < o.min) throw bad(name + " ต้องไม่น้อยกว่า " + o.min.toLocaleString("en-US"));
  if (o.max !== undefined && n > o.max) throw bad(name + " ต้องไม่เกิน " + o.max.toLocaleString("en-US"));
  if (!Number.isSafeInteger(n)) throw bad(name + " ใหญ่เกินไป");
  return n;
}
/** บาท (ข้อความ/เลข ทศนิยมไม่เกิน 2 ตำแหน่ง) → สตางค์ (จำนวนเต็ม) — ใช้ตอนนำเข้าข้อมูลเก่าที่เก็บเป็นบาท */
export function bahtToSatang(v, name) {
  const s = String(v == null ? "" : v).replace(/,/g, "").trim();
  if (s === "") return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw bad((name || "ยอดเงิน") + " ไม่ใช่ตัวเลขเงินที่อ่านได้: " + s);
  const n = Number(m[2]) * 100 + Number((m[3] || "").padEnd(2, "0") || 0);
  return m[1] ? -n : n;
}
export function oneOf(v, list, name) {
  const s = text(v, 100, name);
  if (list.indexOf(s) < 0) throw bad(name + " ต้องเป็นหนึ่งใน: " + list.filter(Boolean).join(" / "));
  return s;
}
export function day(v, name, optional) {
  const s = text(v, 10, name);
  if (!s && optional) return "";
  if (!isDay(s)) throw bad(name + " ต้องเป็นวันที่ (ปี-เดือน-วัน)");
  return s;
}

// ---- สเปกสินค้า → กุญแจเดียว (ใช้ทุกที่: ออเดอร์ · งานผลิต · รอบเครื่อง · สต๊อก · ราคา) ----
//   ประเภท|ขนาด|คอขวด|รูปทรง|สี — ตัดช่องว่างซ้ำ · แกนที่ประเภทนั้นไม่ใช้ = ว่าง (ส่ง axes จาก product_types)
export const SPEC_AXES = [["size", "ขนาด"], ["neck", "คอขวด"], ["shape", "รูปทรง"], ["color", "สี"]];
export function specKey(it, axes) {
  const norm = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().replace(/\|/g, "/");
  const use = axes ? String(axes).split(",") : null;
  const parts = [norm(it.type)];
  for (const [k, th] of SPEC_AXES) parts.push(!use || use.indexOf(th) >= 0 ? norm(it[k]) : "");
  return parts.join("|");
}
/** ชื่อสินค้าที่คนอ่าน: "ขวด 600 ml คอยาว MK ใส" */
export function specLabel(it) {
  return [it.type, it.size, it.neck, it.shape, it.color].map(v => String(v || "").trim()).filter(Boolean).join(" ");
}

// ---- JSON ปลอดภัยสำหรับ audit (ตัดยาว · ไม่เก็บช่องลับ) ----
const SECRET_KEYS = /^(pin|token|ticket|secret|key|password)$/i;
export function auditJson(o) {
  if (o === undefined || o === null || o === "") return "";
  const s = JSON.stringify(o, (k, v) => (SECRET_KEYS.test(k) ? undefined : v));
  return s.length > 4000 ? s.slice(0, 3990) + "…(ตัด)" : s;
}
export const sameText = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return d === 0; };
