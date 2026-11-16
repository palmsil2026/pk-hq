// ============================================================
//  ของกลางของโมดูลทีมผลิต (ฟังก์ชันล้วน + ทะเบียนตาราง)                         v2/server/actions/prodLib.mjs
//  โมดูลอื่นใช้ได้: negativeFlag() (ส่งของ/สกรีนตัดสต๊อกแล้วติดลบ = ธง ไม่บล็อก) · stockKey() · PROD_TYPES · runState()
// ============================================================
import { registerTable } from "../db.mjs";
import { bad, text, specKey, specLabel, iso, isIso, thaiDay, thaiHm } from "../core.mjs";

registerTable("run_crew", { pk: "id", void: { status: "ยกเลิก" } });
registerTable("materials", { pk: "id", void: { status: "เลิกใช้" } });

/** ประเภทสินค้าที่โรงงานผลิตเอง (มีเครื่องทำ) — ที่เหลือ (ฝา ฟิล์ม ถุง ลัง) ซื้อมาขาย ไม่เข้าคิวผลิต */
export const PROD_TYPES = ["ขวด", "ถัง", "พรีฟอร์ม"];
/** ชนิดเครื่องที่เปิดรอบผลิตได้ */
export const RUN_KINDS = ["เป่า", "ฉีด"];
export const OPEN_RUN = "('กำลังผลิต','ค้างจากระบบเดิม')";

const AX = { size: "ขนาด", neck: "คอขวด", shape: "รูปทรง", color: "สี" };
/** สเปกจากหน้าเว็บ → ตรวจ + ตัดแกนที่ประเภทนั้นไม่ใช้ · types = Map(code → axes) */
export function readSpec(raw, types) {
  const type = text(raw.type, 40, "ประเภทสินค้า");
  if (!type) throw bad("ต้องเลือกประเภทสินค้า");
  if (!types.has(type)) throw bad("ไม่รู้จักประเภทสินค้า \"" + type + "\"");
  const axes = String(types.get(type) || "").split(",");
  const it = { type };
  for (const [k, th] of Object.entries(AX)) it[k] = axes.indexOf(th) >= 0 ? text(raw[k], 60, th) : "";
  if (!it.size) throw bad("ต้องเลือกขนาด");
  return { ...it, spec_key: specKey(it, types.get(type)), label: specLabel(it) };
}
export const stockKey = specKeyStr => "spec:" + specKeyStr;

/** เวลาที่คนเลือก (ISO) — ต้องไม่อยู่ในอนาคต · ไม่ย้อนเกิน maxBackH ชั่วโมง */
export function readWhen(v, now, name, maxBackH) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (!isIso(s)) throw bad(name + " ต้องเป็นเวลาที่อ่านได้");
  const t = Date.parse(s);
  if (t > now + 60000) throw bad(name + " อยู่ในอนาคต (" + thaiHm(t) + ") — เลือกเวลาใหม่");
  if (maxBackH && t < now - maxBackH * 3600000) throw bad(name + " ย้อนไปเกิน " + maxBackH + " ชั่วโมง — ถ้าลืมจริง ให้ยกธงแจ้งประธาน");
  return s;
}

/** รายชื่อผู้ปฏิบัติงาน (ชื่อเล่น) → ไม่ซ้ำ · 1–6 คน · ตัดช่องว่าง */
export function readCrew(raw, need) {
  const arr = Array.isArray(raw) ? raw : String(raw || "").split(/\s*[,،、]\s*/);
  const out = [];
  for (const n of arr) { const s = text(n, 40, "ชื่อผู้ปฏิบัติงาน"); if (s && out.indexOf(s) < 0) out.push(s); }
  if (need && !out.length) throw bad("ต้องเลือกผู้ปฏิบัติงานอย่างน้อย 1 คน");
  if (out.length > 6) throw bad("ผู้ปฏิบัติงานได้ไม่เกิน 6 คนต่อรอบ");
  return out;
}
export function crewOps(runId, names, staffByNick, src) {
  return names.map(n => ({ op: "insert", table: "run_crew", row: { id: runId + "|" + n, run_id: runId, name_text: n, staff_id: staffByNick.get(n) || null, src: src || "v2" } }));
}

/** ลงยอดผลิตเข้าสมุด: ดี = เกรด A · เกรด B แยกบัญชี (ไม่บวกเข้าของดี) · เสีย = ไม่เข้าสต๊อก */
export function produceMoves(run, good, b, moveType, reason) {
  const ops = [];
  const lbl = specLabel(run);
  if (good) ops.push({ op: "move", item_key: stockKey(run.spec_key), label: lbl, grade: "A", qty_pcs: good, move_type: moveType || "ผลิตเข้า", ref_entity: "machine_runs", ref_id: run.id, reason: reason || "" });
  if (b) ops.push({ op: "move", item_key: stockKey(run.spec_key), label: lbl, grade: "B", qty_pcs: b, move_type: moveType || "ผลิตเข้า", ref_entity: "machine_runs", ref_id: run.id, reason: reason || "" });
  return ops;
}

/**
 * สต๊อกติดลบ = ธง (ไม่บล็อกงาน) — ใช้ได้ทุกโมดูลที่ตัด/ลดสต๊อก
 *   balance = ยอดคงเหลือก่อนรายการนี้ · delta = จำนวนที่ขยับ (ลบ = ออก) → op ธง หรือ null
 */
export function negativeFlag(itemKey, grade, label, balance, delta, team) {
  const after = Number(balance || 0) + Number(delta || 0);
  if (after >= 0) return null;
  return { op: "flag", kind: "สต๊อกติดลบ", team: team || "prod", severity: "ดู", entity: "stock_balance", entity_id: itemKey + "#" + grade,
    title: "สต๊อกติดลบ: " + (label || itemKey) + (grade === "B" ? " (เกรด B)" : ""), detail: "ยอดหลังรายการนี้ " + after.toLocaleString("en-US") + " — ตรวจนับ/หารายการที่ลงขาด", dedupe_key: "neg:" + itemKey + "#" + grade };
}

/** สถานะเครื่องจากรอบ/เหตุการณ์ที่ค้างอยู่ */
export function runState(m, run, stop, mold, now, staleH) {
  const staleMs = Number(staleH || 14) * 3600000;
  const stale = !!run && now - Date.parse(run.started_at) > staleMs;
  if (mold && mold.stage === "กำลังเปลี่ยน") return "โมลด์";
  if (stop) return "จอด";
  if (run) return stale ? "ค้างปิด" : "เดิน";
  return "ว่าง";
}

/** ชั่วโมงของรอบ (ไม่นับรอบที่เวลามีปัญหา) */
export function runHours(r) {
  if (!r.ended_at || r.time_issue) return 0;
  return Math.max(0, (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 3600000);
}
export const dayOf = r => r.ended_day || r.started_day;
export { iso, thaiDay };
