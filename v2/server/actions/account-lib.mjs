// ============================================================
//  ของกลางโมดูลบัญชี + ประธาน: ช่องทางรับเงิน · ที่มาของบิล · เงื่อนไขลูกหนี้ · เงินเข้าบัญชีไหน · เลขเอกสาร     v2/server/actions/account-lib.mjs
//
//  กติกาเงิน (PALM-WAY §4):
//   · ฝ่ายบัญชียังจดชีท "ระบบบัญชี" — แถวจากชีท (src acct:*) = ชีทเป็นตัวจริง: ดู/ตรวจได้ แต่รับชำระ/แก้ "ในชีท" (ระบบไม่เขียนกลับ)
//   · บิลในแอป (src v2: จากออเดอร์ / ลงในแอปบัญชี) = แอปเป็นตัวจริง: รับชำระในแอป · แก้/ยกเลิกได้เฉพาะที่ลงจากแอปบัญชีเอง
//   · บิลใบเดียวกันอยู่ทั้งสองที่ (เลขกระดาษ+วันใกล้กัน) → แถวชีทมี same_as = บิลในแอป → นับครั้งเดียว (นับบิลในแอป)
//   · ลูกหนี้จากชีทนับจากแท็บลูกหนี้ (แท็บรายวันไม่มีสถานะการจ่ายของบิลเครดิต — ฝ่ายบัญชีเองก็นับลูกหนี้จากแท็บลูกหนี้)
//   · "เงินเข้าบัญชีไหน" นับตามวันที่ชำระ · ช่องทางว่าง = "ไม่ระบุช่องทาง" (ไม่เดาว่าเงินสด)
// ============================================================
import { registerTable } from "../db.mjs";
import { bad, thaiDay, addDays, day as dayOf } from "../core.mjs";

registerTable("doc_seq", { pk: "key", created: false });

export const MONEY_ROLES = ["account", "exec"];
export const CHANNELS = ["เงินสด", "โอน KBank", "โอน KTB", "โอน BBL", "เช็ค"];
export const NO_CHANNEL = "ไม่ระบุช่องทาง";

/** ลูกหนี้ (ใช้กับ alias b) */
export const AR_WHERE = "b.status = 'ค้างชำระ' AND b.same_as = '' AND b.acct_kind <> 'รายวัน'";
export const isAcct = b => String((b && b.src) || "").indexOf("acct:") === 0;

/** ที่มาของบิล → ป้ายบนจอ + ทำอะไรได้ในแอป */
export function sourceOf(b) {
  if (isAcct(b)) return { key: "acct", label: "จากชีทบัญชี", payable: false, editable: false, why: "บิลนี้มาจากชีท \"ระบบบัญชี\" — รับชำระ/แก้ในชีท แล้วระบบซิงก์ตามเอง (ระบบไม่เขียนกลับชีท)" };
  if (b.src !== "v2") return { key: "other", label: "นำเข้า", payable: false, editable: false, why: "บิลนำเข้าจากระบบเดิม — ดูได้อย่างเดียว" };
  if (b.order_id) return { key: "order", label: "จากออเดอร์", payable: true, editable: false, why: "บิลจากออเดอร์ — ยอด/รายการออฟฟิศเป็นคนแก้ (บัญชีผูกเลขกระดาษและรับชำระได้)" };
  if (b.origin === "บัญชี") return { key: "app", label: "ลงในแอปบัญชี", payable: true, editable: true, why: "" };
  return { key: "v2", label: "ลงในแอป", payable: true, editable: false, why: "บิลนี้ลงจากส่วนอื่นของแอป — แก้ที่ต้นทาง (บัญชีรับชำระได้)" };
}
/** ยอดหลังหักมัดจำ (คุณปาล์มเคาะ 19 พ.ย.: มัดจำหักในบิลเลย) — ยอดที่ควรตรงกับบิลกระดาษ/ชีทบัญชี */
export const netOf = b => (Number(b.total_satang) || 0) - (Number(b.deposit_satang) || 0);
/** ยอดจากกระดาษ/ชีท เทียบกับบิล: "ok" = ตรงยอดหลังหักมัดจำ · "gross" = ลงยอดเต็ม (ต่างเพราะมัดจำ — ไม่ใช่ยอดไม่ตรง) · "" = ไม่ตรง */
export function moneyMatch(satang, b) {
  if (satang === netOf(b)) return "ok";
  if (Number(b.deposit_satang) > 0 && satang === b.total_satang) return "gross";
  return "";
}
export const depositNote = b => "ต่างเพราะมัดจำ — ยอดเต็ม ฿" + baht(b.total_satang) + " หักมัดจำ ฿" + baht(b.deposit_satang) + " เหลือ ฿" + baht(netOf(b));
/** แถวบิลที่ส่งให้หน้าจอ (ไม่มีอะไรลับ — ส่งเฉพาะบทบาทเงิน) */
export function billOut(b) {
  const s = sourceOf(b);
  return {
    bill_no: b.bill_no, bill_day: b.bill_day, customer_id: b.customer_id || null, customer_name: b.customer_name, order_id: b.order_id || null,
    total_satang: b.total_satang, paid_satang: b.paid_satang, due_satang: Math.max(0, b.total_satang - b.paid_satang), deposit_satang: Number(b.deposit_satang) || 0, kind: b.kind, status: b.status,
    pay_channel: b.pay_channel, paid_day: b.paid_day, due_day: b.due_day, stmt_no: b.stmt_no, paper_no: b.paper_no, note: b.note,
    same_as: b.same_as || "", acct_kind: b.acct_kind || "", version: b.version, src: s.key, src_label: s.label, payable: s.payable && b.status === "ค้างชำระ", editable: s.editable && b.status !== "ยกเลิก", why: s.why,
  };
}

/** วันที่รับเงิน: ต้องระบุ · ไม่เกินวันนี้ · ย้อนได้ไม่เกิน ~1 ปี */
export function payDay(v, X) {
  const d = dayOf(v, "วันที่รับเงิน");
  const today = thaiDay(X.now);
  if (d > today) throw bad("วันที่รับเงินเป็นวันในอนาคตไม่ได้");
  if (d < addDays(today, -400)) throw bad("วันที่รับเงินย้อนหลังเกิน 1 ปี — ตรวจวันที่อีกครั้ง");
  return d;
}
export function channelOf(v, optional) {
  const s = String(v == null ? "" : v).trim();
  if (!s && optional) return "";
  if (CHANNELS.indexOf(s) < 0) throw bad("เลือกว่าเงินเข้าทางไหน: " + CHANNELS.join(" / "));
  return s;
}

/** เงินเข้า (ตามวันที่ชำระ) ช่วง from–to → [{ day, channel, satang, n }] — 1 คำสั่ง */
export const MONEY_IN_SQL = `SELECT day, channel, sum(satang) AS satang, count(*) AS n FROM (
    SELECT p.day AS day, p.channel AS channel, p.amount_satang AS satang FROM bill_payments p JOIN bills b ON b.bill_no = p.bill_no
      WHERE p.status = 'ใช้ได้' AND b.status <> 'ยกเลิก' AND p.day BETWEEN ? AND ?
    UNION ALL
    SELECT b.paid_day, CASE WHEN trim(b.pay_channel) = '' THEN '${NO_CHANNEL}' ELSE b.pay_channel END, b.total_satang - b.deposit_satang FROM bills b
      WHERE b.status = 'ชำระแล้ว' AND b.same_as = '' AND b.paid_day BETWEEN ? AND ? AND b.total_satang > b.deposit_satang
        AND (substr(b.src, 1, 5) = 'acct:' OR NOT EXISTS (SELECT 1 FROM bill_payments q WHERE q.bill_no = b.bill_no AND q.status = 'ใช้ได้'))
  ) GROUP BY day, channel`;
export const moneyInArgs = (from, to) => [from, to, from, to];
/** รวมตามช่องทาง เรียงตามลำดับช่องทางมาตรฐาน */
export function byChannel(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.channel, (m.get(r.channel) || 0) + Number(r.satang || 0));
  const order = c => { const i = CHANNELS.indexOf(c); return i < 0 ? 99 : i; };
  return [...m.entries()].map(([channel, satang]) => ({ channel, satang })).sort((a, b) => order(a.channel) - order(b.channel) || b.satang - a.satang);
}
export const monthOf = d => String(d).slice(0, 7);
export const monthStart = d => monthOf(d) + "-01";
export function monthEnd(d) { const [y, m] = monthOf(d).split("-").map(Number); return addDays((m === 12 ? y + 1 : y) + "-" + String(m === 12 ? 1 : m + 1).padStart(2, "0") + "-01", -1); }

/** เลขเอกสารเรียงต่อกัน (ใบวางบิล) — ด่าน version กันสองคนออกเลขพร้อมกัน · ย้อนรายการไม่คืนเลข (เลขที่ใช้ไปแล้วไม่ใช้ซ้ำ) */
export function nextDoc(seqRow, key, prefix) {
  const n = (seqRow ? Number(seqRow.value) : 0) + 1;
  const op = seqRow
    ? { op: "update", table: "doc_seq", id: key, expect: seqRow.version, before: seqRow, set: { value: n }, undo: false }
    : { op: "insert", table: "doc_seq", row: { key, value: n }, undo: false };
  return { no: prefix + String(n).padStart(4, "0"), op };
}
/** เลขบิลกระดาษ: ตัวเลข/ตัวอักษรสั้น ๆ (ตัดช่องว่าง) */
export function paperNo(v, optional) {
  const s = String(v == null ? "" : v).replace(/\s+/g, "").trim();
  if (!s && optional) return "";
  if (!s) throw bad("ใส่เลขบนบิลกระดาษ");
  if (!/^[0-9A-Za-zก-๙/_.-]{1,20}$/.test(s)) throw bad("เลขบิลกระดาษต้องเป็นตัวเลข/ตัวอักษร ไม่เกิน 20 ตัว");
  return s;
}
export const baht = s => (Number(s || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(s) % 100 ? 2 : 0, maximumFractionDigits: 2 });
/** วันห่างกันกี่วัน (วันไทย YYYY-MM-DD) */
export const dayGap = (a, b) => Math.round(Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
