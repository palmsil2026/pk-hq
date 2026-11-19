// ============================================================
//  หมุดลูกค้า — ของกลาง (ฟังก์ชันล้วน + ตามลิงก์ย่อ)                                                  v2/server/actions/geo-lib.mjs
//  · แกะพิกัดจากลิงก์ Google Maps: ?q=lat,lng · ?query= · ?ll= · /@lat,lng · !3dlat!4dlng (หมุดสถานที่ — แม่นกว่า @ ที่เป็นกลางจอ) · /place/lat,lng · พิมพ์ "lat, lng" ตรง ๆ
//  · ลิงก์ย่อ (maps.app.goo.gl · goo.gl/maps · share.google · g.co) → ตามทางต่อฝั่งเซิร์ฟเวอร์ ≤ 5 ทอด เฉพาะโดเมนของ Google (กันใช้เซิร์ฟเวอร์ยิงที่อื่น)
//    ตามไม่ได้/ไม่มีพิกัด = คืน null → ผู้เรียกเก็บลิงก์ไว้ + ธง (ไม่เดาพิกัด)
//  · พิกัดเก็บเป็นไมโครองศา (จำนวนเต็ม) · ตารางเรียน อำเภอ → สาย จากลูกค้าที่มีทั้งสองช่อง (แนะนำให้คนยืนยัน ไม่เขียนทับ)
// ============================================================

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PATTERNS = [
  new RegExp("!3d" + NUM + "!4d" + NUM),
  new RegExp("[?&](?:q|query|ll|center|daddr|destination|sll)=(?:loc:)?" + NUM + "\\s*,\\s*\\+?" + NUM),
  new RegExp("@" + NUM + "," + NUM),
  new RegExp("/(?:place|search|dir)/(?:[^/]*/)?" + NUM + ",\\s*\\+?" + NUM),
  new RegExp("^\\s*" + NUM + "\\s*,\\s*" + NUM + "\\s*$"),
];
/** ไมโครองศาจากข้อความองศา (ไม่ผ่านทศนิยมลอย — ตัดเลขหลักที่ 7 ทิ้ง) */
export function e6(s) {
  const m = /^(-?)(\d{1,3})(?:\.(\d+))?$/.exec(String(s));
  if (!m) return null;
  const n = Number(m[2]) * 1e6 + Number(((m[3] || "") + "000000").slice(0, 6));
  return m[1] ? -n : n;
}
export function validGeo(lat, lng) {
  return Number.isInteger(lat) && Number.isInteger(lng) && Math.abs(lat) <= 90e6 && Math.abs(lng) <= 180e6 && !(lat === 0 && lng === 0);
}
/** ข้อความ/ลิงก์ → { lat_e6, lng_e6 } หรือ null */
export function parseMapLink(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  for (let i = 0; i < 2; i++) { try { const d = decodeURIComponent(s); if (d === s) break; s = d; } catch (e) { break; } }
  s = s.replace(/\+/g, " ").replace(/%2C/gi, ",");
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = e6(m[1]), lng = e6(m[2]);
    if (validGeo(lat, lng)) return { lat_e6: lat, lng_e6: lng };
  }
  return null;
}
const GOOGLE = /(^|\.)(google\.[a-z.]{2,6}|goo\.gl|g\.co|share\.google|googleusercontent\.com)$/i;
export function isGoogleUrl(u) { try { const x = new URL(u); return (x.protocol === "https:" || x.protocol === "http:") && GOOGLE.test(x.hostname); } catch (e) { return false; } }
export function isShortLink(u) { try { const x = new URL(u); return /^(maps\.app\.goo\.gl|goo\.gl|share\.google|g\.co)$/i.test(x.hostname); } catch (e) { return false; } }

/** ลิงก์ → พิกัด (ตามลิงก์ย่อด้วย fetch ของเซิร์ฟเวอร์) · คืน { geo, final, why } */
export async function resolveMapLink(fetchFn, url) {
  const direct = parseMapLink(url);
  if (direct) return { geo: direct, final: url, why: "" };
  if (!/^https?:\/\//i.test(String(url))) return { geo: null, final: url, why: "ไม่ใช่ลิงก์แผนที่ และไม่มีพิกัดในข้อความ" };
  if (!isGoogleUrl(url)) return { geo: null, final: url, why: "ไม่ใช่ลิงก์ Google Maps — เก็บลิงก์ไว้ให้เปิดดูเอง" };
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    let res;
    try {
      const ac = typeof AbortController === "function" ? new AbortController() : null;
      const t = ac ? setTimeout(() => ac.abort(), 4000) : null;
      res = await fetchFn(cur, { method: "GET", redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (pk-v2 map-link reader)", accept: "text/html" }, signal: ac ? ac.signal : undefined });
      if (t) clearTimeout(t);
    } catch (e) { return { geo: null, final: cur, why: "เปิดลิงก์ไม่ได้ (" + (e && e.name === "AbortError" ? "ช้าเกิน" : "เชื่อมต่อไม่ได้") + ")" }; }
    const loc = res.headers && res.headers.get ? res.headers.get("location") : null;
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, cur).href;
      const g = parseMapLink(next);
      if (g) return { geo: g, final: next, why: "" };
      if (!isGoogleUrl(next)) return { geo: null, final: next, why: "ลิงก์พาไปนอก Google — ไม่ตามต่อ" };
      cur = next;
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      let body = "";
      try { body = (await res.text()).slice(0, 300000); } catch (e) { body = ""; }
      const m = /(?:https?:\/\/[^"'\s<>]*google[^"'\s<>]*\/maps[^"'\s<>]*)/i.exec(body);
      const g = parseMapLink(m ? m[0] : "") || (/!3d-?\d/.test(body) ? parseMapLink(body.match(/!3d-?\d[^"'\s]*/)[0]) : null);
      return g ? { geo: g, final: m ? m[0] : cur, why: "" } : { geo: null, final: cur, why: "หน้าลิงก์ไม่มีพิกัด" };
    }
    return { geo: null, final: cur, why: "ลิงก์ตอบกลับผิดปกติ (" + res.status + ")" };
  }
  return { geo: null, final: cur, why: "ลิงก์พาต่อหลายทอดเกินไป" };
}

/** ลิงก์เปิดแผนที่จากพิกัด (ปุ่ม "นำทาง") */
export const mapsUrl = (lat, lng) => "https://www.google.com/maps/search/?api=1&query=" + (lat / 1e6).toFixed(6) + "," + (lng / 1e6).toFixed(6);

/**
 * ตาราง อำเภอ → สาย จากลูกค้าที่มีทั้งสองช่อง · แนะนำเมื่อสายที่พบบ่อยสุดได้ ≥ 60% และอย่างน้อย 2 ราย (ไม่ถึง = ไม่แนะนำ — ดีกว่าแนะนำผิด)
 *   rows = [{ district, route_code }] → Map(อำเภอ → { route, n, total, share })
 */
export const SUGGEST_MIN_N = 2, SUGGEST_MIN_SHARE = 0.6;
export const districtKey = s => String(s || "").replace(/^(อ\.|อำเภอ)\s*/, "").replace(/\s+/g, "").trim();
export function learnRoutes(rows) {
  const by = new Map();
  for (const r of rows) {
    const d = districtKey(r.district);
    if (!d || !r.route_code) continue;
    const m = by.get(d) || new Map();
    m.set(r.route_code, (m.get(r.route_code) || 0) + 1);
    by.set(d, m);
  }
  const out = new Map();
  for (const [d, m] of by) {
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    const [route, n] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    out.set(d, { district: d, route, n, total, share: n / total, ok: n >= SUGGEST_MIN_N && n / total >= SUGGEST_MIN_SHARE, others: [...m.entries()].filter(([k]) => k !== route).map(([k, v]) => ({ route: k, n: v })) });
  }
  return out;
}
/** ชื่อสายเดาจากอำเภอที่พบบ่อยในสายนั้น ("เมืองลำปาง" → "เมือง") · ไม่มีข้อมูล = null */
export function guessAreaName(rows, code) {
  const m = new Map();
  for (const r of rows) if (r.route_code === code) { const d = districtKey(r.district); if (d) m.set(d, (m.get(d) || 0) + 1); }
  if (!m.size) return null;
  const total = [...m.values()].reduce((s, n) => s + n, 0);
  const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const nm = d => (/^เมือง/.test(d) ? "เมือง" : d);
  const name = top.length > 1 && top[1][1] / total >= 0.3 ? nm(top[0][0]) + "–" + nm(top[1][0]) : nm(top[0][0]);
  return { name, from: top.slice(0, 2).map(([d, n]) => "อ." + d + " " + n).join(" · ") + " จาก " + total + " ราย" };
}
