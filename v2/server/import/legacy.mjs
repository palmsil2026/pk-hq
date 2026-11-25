// ============================================================
//  ตัวแกะข้อมูลชีตเดิม (ชื่อลูกค้า · วันที่ไทย · หมายเหตุมือ · เวลาเครื่อง) — ฟังก์ชันล้วน ไม่แตะฐาน      v2/server/import/legacy.mjs
//  กติกาจับคู่ชื่อตาม PALM-WAY §5: ผูกด้วยรหัส · จับคู่ชื่อหลวม · แยกชื่องาน/แบรนด์ออกจากชื่อลูกค้า
//  parseLegacyNote / thaiDate = ยกจาก gas/Code.gs (parseLegacyNote_ · thaiDate_) ให้ผลเหมือนกัน
// ============================================================
import { atThai, iso, isDay, bahtToSatang } from "../core.mjs";

/** กุญแจชื่อแบบหลวม — ชุดเดียวกับ normName_() ใน gas/Code.gs (ตัวพิมพ์เล็ก · ตัดช่องว่าง/วงเล็บ/ขีด/จุด/จุลภาค/เครื่องหมายคำพูด) */
export const nameKey = s => String(s || "").toLowerCase().replace(/[\s()\-_.,'"]/g, "");

/** "ร้าน ก (เมือง) งานแบรนด์ X" → { name: "ร้าน ก (เมือง)", brand: "แบรนด์ X" } · "… ครั้งต่อไป …" ตัดเป็นหมายเหตุ */
export function splitCustomerText(text) {
  let s = String(text || "").replace(/\s+/g, " ").trim(), note = "", brand = "";
  const nx = /\s*ครั้งต่อไป(.*)$/.exec(s);
  if (nx) { note = ("ครั้งต่อไป" + nx[1]).trim(); s = s.slice(0, nx.index).trim(); }
  const m = /^(.+?)\s*งาน\s*(.*)$/.exec(s);
  if (m && m[1].trim().length >= 2) { brand = m[2].trim(); s = m[1].trim(); }
  return { name: s, brand, note };
}

/** หาลูกค้าจากชื่อ: ตรงตัว → ชื่ออื่น (alias) → ขึ้นต้นด้วยชื่อในทะเบียน (≥ 4 ตัว) → ชื่อในทะเบียนขึ้นต้นด้วยชื่อนี้ (≥ 5 ตัว) · กำกวม = ไม่จับ */
export function matchCustomer(name, index) {
  const key = nameKey(name);
  if (!key) return null;
  if (index.byKey.has(key)) return { id: index.byKey.get(key), how: "ตรงตัว" };
  if (index.alias.has(key)) return { id: index.alias.get(key), how: "ชื่ออื่น" };
  let best = null, tie = false;
  for (const [k, id] of index.byKey) {
    if (k.length >= 4 && key.startsWith(k)) {
      if (!best || k.length > best.k.length) { best = { k, id }; tie = false; }
      else if (k.length === best.k.length && id !== best.id) tie = true;
    }
  }
  if (best && !tie) return { id: best.id, how: "ขึ้นต้นตรง" };
  if (best) return null;
  // ชื่อสั้นกว่าทะเบียน ("อุดมทรัพย์" ↔ "อุดมทรัพย์ (งาว)") — จับได้เฉพาะเมื่อมีรายเดียว (มี "(งาว)" กับ "(เมือง)" = กำกวม ไม่จับ)
  if (key.length < 5) return null;
  const longer = [...new Set([...index.byKey].filter(([k]) => k.startsWith(key)).map(([, id]) => id))];
  return longer.length === 1 ? { id: longer[0], how: "ชื่อย่อ" } : null;
}

/** '28/7/2568' · '28/7/68' · '2025-07-28' · '02/04/2025' → 'YYYY-MM-DD' ('' = อ่านไม่ได้) · yearHint ใช้เมื่อไม่มีปี ('2/04') */
export function thaiDate(v, yearHint) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const isoM = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoM) { const d = isoM[1] + "-" + isoM[2] + "-" + isoM[3]; return isDay(d) ? d : ""; }
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (!m) return "";
  let y = m[3] ? Number(m[3]) : Number(yearHint) || 0;
  if (!y) return "";
  if (y < 100) y += 2500;
  if (y > 2400) y -= 543;
  const d = y + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");
  return isDay(d) ? d : "";
}

/** "HH:mm" (เวลาไทย) ของวันไทย day → ISO UTC · '' = ไม่มีเวลา */
export function thaiTime(day, hm) {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(hm || "").trim());
  if (!m || !day) return "";
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59) return "";
  return iso(atThai(day, h, mi));
}

/** หมายเหตุที่พนักงานเขียนมือ → ช่องจริง (เหมือน parseLegacyNote_ ใน gas/Code.gs) */
export function parseLegacyNote(note) {
  let rest = String(note || "").trim();
  const out = {};
  const take = (re, fn) => { const m = rest.match(re); if (m) { fn(m); rest = rest.replace(m[0], " ").trim(); } };
  take(/ค่าบล[็้]?อ?[คก]\s*([\d,]+)\s*บาท?/, m => { out.blockFeeBaht = Number(String(m[1]).replace(/,/g, "")) || null; });
  take(/ทำ\s*([\d,]+)\s*ถุง\s*ค้าง\s*(?:อีก)?\s*([\d,]+)\s*ถุง/, m => { out.doneBags = Number(String(m[1]).replace(/,/g, "")) || null; out.pendingBags = Number(String(m[2]).replace(/,/g, "")) || null; });
  take(/\(?\s*(ขวดหมด|ของหมด|วัตถุดิบหมด)\s*\)?/, m => { out.pendingReason = m[1]; });
  take(/ทำครบแล้ว\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/, m => { out.finished = thaiDate(m[1]); });
  take(/เสร็จ\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/, m => { if (!out.finished) out.finished = thaiDate(m[1]); });
  take(/แก้ไขแบบ/, () => { out.design = "แก้ไขแบบ"; });
  take(/รอแบบ/, () => { out.design = "รอแบบ"; });
  take(/ทำแบบ/, () => { out.design = "รอแบบ"; });
  take(/รอโอน(เงิน)?/, () => { out.pay = "รอโอนเงิน"; });
  take(/ทำได้เลย/, () => { out.pay = "ทำได้เลย"; });
  take(/ขอด่วน|ด่วน/, () => { out.urgent = true; });
  out.rest = rest.replace(/^[\s\d/]+$/, "").replace(/\s{2,}/g, " ").trim();
  return out;
}

/** เลขจากชีต ("1,250" · 1250 · "") → จำนวนเต็ม หรือ null */
export function intOf(v) {
  const s = String(v == null ? "" : v).replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
/** ยอดเงินจากชีต (บาท อาจมีทศนิยม/จุลภาค) → สตางค์ หรือ null (อ่านไม่ได้ = null ไม่เดาเป็น 0) */
export function satangOf(v) {
  const s = String(v == null ? "" : v).replace(/,/g, "").trim();
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [a, b] = s.split(".");
  return bahtToSatang(a + (b ? "." + b.slice(0, 2) : ""));
}
/** หาคอลัมน์แบบหลวม (หัวชีตจริงสะกดต่างกันได้ เช่น "ผลิตได้ (ใบ)" / "ผลิตได้(ใบ)") */
export function colOf(head, ...names) {
  const h = head.map(x => String(x).replace(/\s+/g, ""));
  for (const n of names) { const i = h.indexOf(n.replace(/\s+/g, "")); if (i >= 0) return i; }
  for (const n of names) { const k = n.replace(/\s+/g, ""); const i = h.findIndex(x => x.startsWith(k)); if (i >= 0) return i; }
  return -1;
}
