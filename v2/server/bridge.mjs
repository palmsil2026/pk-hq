// ============================================================
//  ไคลเอนต์สะพาน Google (ฝั่ง Cloudflare) — ขอข้อมูลชีตแบบอ่านอย่างเดียวจาก GAS ทีละหน้า          v2/server/bridge.mjs
//  คำขอลงชื่อด้วย PK_SYNC_KEY (อายุ 5 นาที) · คำตอบต้องลงชื่อกลับด้วยกุญแจเดียวกัน (กันข้อมูลปลอม/ถูกแก้กลางทาง)
//  ตรงกับ v2Export_() ใน gas/Code.gs
// ============================================================
import { Fail } from "./core.mjs";
import { hmacB64u } from "./ticket.mjs";

export async function fetchExport(X, source, cursor, limit) {
  const url = X.env.PK_GAS_URL, key = X.env.PK_SYNC_KEY;
  if (!url) throw new Fail(503, "not_configured", "ยังไม่ได้ตั้งลิงก์ GAS (PK_GAS_URL) ของสะพาน — แจ้งผู้ดูแล");
  if (!key) throw new Fail(503, "not_configured", "ยังไม่ได้ตั้งกุญแจสะพาน (PK_SYNC_KEY) — แจ้งผู้ดูแล");
  const ts = String(X.now), c = String(cursor || "0"), l = String(limit || 100);
  const sig = await hmacB64u(key, ["pkV2Export", source, c, l, ts].join("|"));
  const q = new URLSearchParams({ action: "pkV2Export", source, cursor: c, limit: l, ts, sig });
  let res, body;
  try {
    res = await X.fetch(url + (url.includes("?") ? "&" : "?") + q.toString(), { redirect: "follow" });
    body = await res.json();
  } catch (e) {
    throw new Fail(502, "bridge", "ติดต่อ Google (GAS) ไม่สำเร็จ: " + String(e && e.message || e).slice(0, 120) + " — ลองใหม่อีกครั้ง");
  }
  if (!body || !body.ok) throw new Fail(502, "bridge", "Google ตอบว่า: " + String(body && body.error || "ไม่ทราบสาเหตุ"));
  if (typeof body.data !== "string" || body.sig !== (await hmacB64u(key, body.data))) throw new Fail(502, "bridge", "ข้อมูลจาก Google ลายเซ็นไม่ตรง — กุญแจ PK_SYNC_KEY สองฝั่งไม่ตรงกัน หรือข้อมูลถูกแก้กลางทาง");
  return JSON.parse(body.data);
}
