// ═══════════════════════════════════════════════════════════════════════
//  ตัวคุยกับหลังบ้าน (Cloudflare /api/call) + สะพาน PIN (GAS) — ทุกบทบาทใช้ตัวนี้ตัวเดียว       v2/web/assets/api.js
//  · ตั๋วเก็บในเครื่อง (localStorage) — ไม่มี PIN ในเครื่อง · PIN ส่งตรงไป Google เท่านั้น (ไม่ผ่าน Cloudflare)
//  · บันทึกทุกครั้งมีรหัสกันกดซ้ำ (key) 1 ตัวต่อการกด 1 ครั้ง — เน็ตหลุดแล้วส่งซ้ำ = หลังบ้านคืนผลเดิม ไม่ลงสองที
//  · ข้อความผิดพลาดบอกสาเหตุจริง: ส่งไม่ถึง (เน็ต) ≠ หลังบ้านปฏิเสธ (มีเหตุผลภาษาไทยจากหลังบ้าน) ≠ หลังบ้านช้า
// ═══════════════════════════════════════════════════════════════════════
const CFG = window.PK_CONFIG || {};
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem("pk2." + k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem("pk2." + k); else localStorage.setItem("pk2." + k, JSON.stringify(v)); } catch (e) { /* โหมดส่วนตัว — ใช้ต่อได้แค่ไม่จำ */ } },
};
export const store = LS;

export class ApiError extends Error {
  constructor(message, info) { super(message); Object.assign(this, info || {}); }
}
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");

let role = "";
export const setRole = r => { role = r; };
export const session = () => {
  const s = LS.get("session");
  return s && s.exp > Date.now() ? s : null;
};
export function setSession(s) { LS.set("session", s); if (s && s.staff) LS.set("lastStaff", s.staff.id); }
export function logout() { LS.set("session", null); LS.set("me", null); Object.keys(localStorage).filter(k => k.startsWith("pk2.view.")).forEach(k => localStorage.removeItem(k)); }

async function post(url, body, headers, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || 45000);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal });
    let j = null;
    try { j = await res.json(); } catch (e) { throw new ApiError("หลังบ้านตอบกลับมาอ่านไม่ได้ (" + res.status + ") — ลองอีกครั้ง", { status: res.status, server: true }); }
    return { res, j };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === "AbortError") throw new ApiError("หลังบ้านไม่ตอบใน " + Math.round((timeoutMs || 45000) / 1000) + " วิ — ยังไม่แน่ว่าบันทึกแล้วหรือยัง กดอีกครั้งได้ (ระบบกันบันทึกซ้ำให้)", { network: true, timeout: true });
    throw new ApiError("ส่งไม่ถึงหลังบ้าน — เช็คเน็ตแล้วกดอีกครั้ง (กดซ้ำได้ ไม่บันทึกสองครั้ง)", { network: true });
  } finally { clearTimeout(t); }
}

/** เรียก action — คืน { data, undo } · opt: { write, key, reason, ticket (ตั๋วเฉพาะครั้ง เช่นตั๋ว PIN ทีมผลิต), as } */
export async function call(action, input, opt) {
  const o = opt || {};
  const s = session();
  const ticket = o.ticket || (s && s.ticket);
  const body = { action, input: input || {}, as: o.as || role || undefined, key: o.write ? o.key || newKey() : undefined, reason: o.reason || undefined };
  const headers = { "content-type": "application/json" };
  if (ticket) headers.authorization = "Bearer " + ticket;
  let r;
  try { r = await post((CFG.apiBase || "api") + "/call", body, headers); }
  catch (e) {
    if (!(e.network && o.write && !o._retried)) throw e;
    await new Promise(z => setTimeout(z, 800));   // เน็ตสะดุด: ส่งซ้ำเงียบ 1 ครั้งด้วยรหัสกันซ้ำตัวเดิม
    return call(action, input, Object.assign({}, o, { key: body.key, _retried: true }));
  }
  const { res, j } = r;
  if (!j || !j.ok) {
    const err = (j && j.error) || {};
    throw new ApiError(err.message || "หลังบ้านปฏิเสธ (" + res.status + ")", { status: res.status, code: err.code, needLogin: !!(j && j.needLogin), needPin: !!err.needPin, server: true });
  }
  return { data: j.data, undo: j.undo || null, replayed: !!j.replayed };
}
export const read = async (action, input, opt) => (await call(action, input, opt)).data;
export const write = (action, input, opt) => call(action, input, Object.assign({}, opt, { write: true }));
export const undo = (id, reason) => write("undo.run", { id }, { reason });

/** การ์ดชื่อหน้าเข้าระบบ (ไม่มี PIN) */
export async function staffCards(forRole) {
  const res = await fetch((CFG.apiBase || "api") + "/public/staff" + (forRole ? "?role=" + encodeURIComponent(forRole) : ""), { cache: "no-store" });
  const j = await res.json();
  if (!j.ok) throw new ApiError((j.error && j.error.message) || "โหลดรายชื่อไม่สำเร็จ");
  return j.data.staff;
}

// ── สะพาน PIN → ตั๋ว (GAS โดยตรง: PIN ไม่ผ่าน Cloudflare) ──────────────────────────
//   ส่งแบบ text/plain = ไม่ต้องขออนุญาตข้ามโดเมนล่วงหน้า (GAS เว็บแอปตอบข้ามโดเมนได้)
export async function gasTicket(sid, pin, kind) {
  if (!CFG.gasUrl) throw new ApiError("ยังไม่ได้ตั้งลิงก์ระบบตรวจ PIN — แจ้งผู้ดูแล");
  let res;
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    res = await fetch(CFG.gasUrl + (CFG.gasUrl.includes("?") ? "&" : "?") + "action=" + (kind === "renew" ? "pkV2Renew" : "pkV2Ticket"),
      { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify(kind === "renew" ? { ticket: pin } : { sid, pin, kind: kind || "s" }), redirect: "follow", signal: ac.signal });
    clearTimeout(t);
  } catch (e) {
    throw new ApiError(e.name === "AbortError" ? "Google ตอบช้าเกิน 30 วิ — ลองอีกครั้ง" : "ติดต่อ Google ไม่ได้ — เช็คเน็ตแล้วลองอีกครั้ง", { network: true });
  }
  const j = await res.json().catch(() => null);
  if (!j) throw new ApiError("Google ตอบกลับมาอ่านไม่ได้ — ลองอีกครั้ง");
  return j;
}
/** ต่ออายุตั๋วเงียบ ๆ เมื่อเหลือ < 7 วัน (ใช้ทุกวัน = ไม่ต้องใส่ PIN ใหม่) */
export async function renewIfNeeded() {
  const s = session();
  if (!s || s.exp - Date.now() > 7 * 864e5) return;
  try { const r = await gasTicket("", s.ticket, "renew"); if (r.ok) setSession(Object.assign({}, s, { ticket: r.ticket, exp: r.exp })); } catch (e) { /* ลองใหม่รอบหน้า */ }
}

// ── จำข้อมูลหน้าจอรอบก่อน (เปิดแล้วขึ้นทันที ไม่กระพริบ) ─────────────────────────────
export const viewCache = {
  get: k => LS.get("view." + k),
  set: (k, data) => LS.set("view." + k, { at: new Date().toISOString(), data }),
};
