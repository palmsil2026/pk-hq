// ============================================================
//  ตั๋วเข้าระบบ (ออกโดย GAS เท่านั้น — Cloudflare แค่ตรวจ)                       v2/server/ticket.mjs
//  รูปแบบ:  pk1.<เนื้อ>.<ลายเซ็น>
//    เนื้อ    = base64url ของ JSON (ASCII ล้วน) {v:1, k:'s'|'g', sid, n, r:[บทบาท], pf, iat, exp}
//              k = 's' ตั๋วประจำเครื่อง (~30 วัน) · 'g' ตั๋ว PIN-ตอนบันทึกของทีมผลิต (อายุไม่กี่นาที)
//              pf = ลายนิ้วมือ PIN (HMAC ด้วยกุญแจที่อยู่ใน GAS เท่านั้น — Cloudflare ถอด/เดาไม่ได้)
//    ลายเซ็น = base64url( HMAC-SHA256( PK_TICKET_KEY , "pk1." + เนื้อ ) ) ไม่มี "="
//  ตรงกับ v2TicketIssue_() ใน gas/Code.gs (เทสต์ tests/gas-bridge.test.mjs ออกตั๋วด้วยโค้ด GAS จริงแล้วตรวจด้วยไฟล์นี้)
//  สะพานส่งข้อมูล (นำเข้า): ลายเซ็นด้วย PK_SYNC_KEY แยกกุญแจ — กุญแจตั๋วหลุด ≠ ดึงข้อมูลชีตได้ และกลับกัน
// ============================================================
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
export async function hmacB64u(key, data) { return b64u(await hmac(key, data)); }
export async function sha256Hex(data) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data)));
  return Array.from(h, b => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return d === 0; }
export const asciiJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));

const RE = /^pk1\.([A-Za-z0-9_-]{20,3000})\.([A-Za-z0-9_-]{43})$/;
const SKEW_MS = 5 * 60000;   // นาฬิกา GAS กับ Cloudflare ต่างกันได้นิดหน่อย

/** ตรวจตั๋ว → payload หรือ { bad: เหตุผลภาษาไทย } (ไม่ throw — ให้ชั้นบนตัดสิน) */
export async function readTicket(key, token, now) {
  if (!key) return { bad: "ระบบยังไม่ได้ตั้งกุญแจตั๋ว (PK_TICKET_KEY) — แจ้งผู้ดูแล", config: true };
  const m = RE.exec(String(token || ""));
  if (!m) return { bad: "ยังไม่ได้เข้าสู่ระบบ" };
  if (!same(await hmacB64u(key, "pk1." + m[1]), m[2])) return { bad: "ตั๋วไม่ถูกต้อง — เข้าสู่ระบบใหม่" };
  let p;
  try { p = JSON.parse(dec.decode(unb64u(m[1]))); } catch (e) { return { bad: "ตั๋วอ่านไม่ได้ — เข้าสู่ระบบใหม่" }; }
  if (!p || p.v !== 1 || !p.sid || !p.pf || (p.k !== "s" && p.k !== "g")) return { bad: "ตั๋วรุ่นนี้ใช้ไม่ได้ — เข้าสู่ระบบใหม่" };
  if (!(Number(p.exp) > now)) return { bad: p.k === "g" ? "หมดเวลายืนยัน PIN — ใส่ PIN ใหม่" : "ตั๋วหมดอายุ — เข้าสู่ระบบใหม่", expired: true };
  if (!(Number(p.iat) <= now + SKEW_MS)) return { bad: "เวลาในตั๋วผิดปกติ — เข้าสู่ระบบใหม่" };
  return { ok: true, p };
}

/** ออกตั๋ว — ใช้ในเทสต์/เครื่องจำลอง GAS เท่านั้น (ของจริงออกที่ GAS) */
export async function issueTicket(key, payload) {
  const body = b64u(enc.encode(asciiJson(Object.assign({ v: 1 }, payload))));
  return "pk1." + body + "." + (await hmacB64u(key, "pk1." + body));
}
/** ลายนิ้วมือ PIN แบบเดียวกับ GAS (เทสต์/เครื่องจำลองเท่านั้น — ของจริงคิดที่ GAS ด้วยกุญแจที่ไม่ออกจาก Google) */
export async function pinPrint(pinKey, sid, pin) { return (await hmacB64u(pinKey, "pf|" + sid + "|" + pin)).slice(0, 22); }
