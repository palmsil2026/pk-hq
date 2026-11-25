// ============================================================
//  ข้อมูลสมมติของโมดูลประธาน + บัญชี (ต่อจาก seed-demo.mjs) — ชื่อร้าน/ยอดไม่ใช่ของจริง (repo เปิดสาธารณะ)
//  บิลจากออเดอร์รอผูกเลขกระดาษ · ลูกหนี้ใกล้ครบกำหนด/เลยกำหนด · บิลจากชีทบัญชี (แท็บรายวัน/ลูกหนี้) · คู่ที่ชีทจ่ายแล้วแต่แอปยังค้าง
//  · ใบวางบิล · ราคาที่ประธานตั้ง + ประวัติ · พนักงานตัวอย่างยืนยันแล้ว 1 คนยังไม่ยืนยัน (ให้เห็นเรื่องที่ต้องตัดสินใจ)
// ============================================================
import { compileOps } from "../server/db.mjs";
import { iso, thaiDay, addDays } from "../server/core.mjs";

export async function seedExecAccount(X, opt) {
  const o = opt || {};
  const now = X.now, today = thaiDay(now), at = ms => iso(now - ms), H = 3600000;
  const ops = [];
  const bill = (no, x, satang, kind, e) => {
    const ee = e || {};
    ops.push({ op: "insert", table: "bills", row: { bill_no: no, bill_day: ee.day || addDays(today, -1), customer_id: "CD" + x, customer_name: "ร้านตัวอย่าง " + x, order_id: ee.order || null,
      total_satang: satang, kind, status: ee.status || "ค้างชำระ", due_day: kind === "เครดิต" ? (ee.due || addDays(today, 10)) : "", paid_day: ee.status === "ชำระแล้ว" ? (ee.paid || today) : "",
      paid_satang: ee.status === "ชำระแล้ว" ? satang : (ee.paidPart || 0), pay_channel: ee.channel || "", paper_no: ee.paper || "", src: "v2", origin: ee.origin || "", by_name: ee.by || "แอน", stmt_no: ee.stmt || "" } });
  };
  // บิลจากออเดอร์ที่ออฟฟิศออก รอบัญชีใส่เลขกระดาษ
  bill("PD-0101", "C", 1200000, "เครดิต", { order: "OD003", day: today });
  bill("PD-0102", "E", 432000, "เงินสด", { order: "OD005", day: today });
  bill("PD-0103", "G", 287500, "เครดิต", { order: "OD007", day: addDays(today, -1) });
  // ลูกหนี้: เลยกำหนด + ใกล้ครบ + ในใบวางบิล
  bill("PD-0090", "H", 615000, "เครดิต", { order: "OD008", paper: "4471", day: addDays(today, -40), due: addDays(today, -5), paidPart: 115000 });
  bill("PD-0091", "H", 98000, "เครดิต", { paper: "4502", day: addDays(today, -20), due: addDays(today, 2), origin: "บัญชี", by: "ฝ้าย", stmt: "ST" + today.slice(2, 4) + "-0001" });
  ops.push({ op: "insert", table: "statements", row: { stmt_no: "ST" + today.slice(2, 4) + "-0001", stmt_day: addDays(today, -3), customer_id: "CDH", customer_name: "ร้านตัวอย่าง H", bill_count: 1, total_satang: 98000, collect_day: addDays(today, 2), status: "วางบิลแล้ว", bill_nos: "PD-0091", src: "v2" } });
  ops.push({ op: "insert", table: "doc_seq", row: { key: "stmt:" + today.slice(2, 4), value: 1 } });
  ops.push({ op: "insert", table: "bill_payments", row: { id: "PY-0090", bill_no: "PD-0090", at: at(30 * 24 * H), day: addDays(today, -30), amount_satang: 115000, channel: "โอน KTB", by: "S141", note: "งวดแรก", src: "demo" } });
  // บิลจากชีทบัญชี (ซิงก์มา) — แท็บรายวัน (จ่ายแล้ววันนี้) + แท็บลูกหนี้ (ค้าง)
  const acct = (no, paper, name, satang, status, e) => ops.push({ op: "insert", table: "bills", row: { bill_no: no, bill_day: e.day || today, customer_name: name, total_satang: satang, kind: e.kind || "เครดิต", status,
    paid_day: status === "ชำระแล้ว" ? (e.day || today) : "", paid_satang: status === "ชำระแล้ว" ? satang : 0, pay_channel: e.channel || "", src: "acct:" + e.tab, paper_no: paper, acct_kind: e.ak, same_as: e.same || "", note: e.note || "" } });
  acct("เก่า-บิลรายวัน 2569-4510", "4510", "ร้านตัวอย่าง B", 186000, "ชำระแล้ว", { tab: "บิลรายวัน 2569", ak: "รายวัน", kind: "เงินสด", channel: "โอน BBL" });
  acct("เก่า-บิลรายวัน 2569-4511", "4511", "สด", 54000, "ชำระแล้ว", { tab: "บิลรายวัน 2569", ak: "รายวัน", kind: "เงินสด", channel: "เงินสด" });
  acct("เก่า-ลูกหนี้-3920", "3920", "ร้านตัวอย่าง D", 1450000, "ค้างชำระ", { tab: "ลูกหนี้", ak: "ลูกหนี้", day: addDays(today, -26) });
  // คู่: บิลในแอปที่ผูกเลขแล้ว + ใบเดียวกันในชีทที่ชีทบอกจ่ายแล้ว (งานรอตรวจ "ชีทจ่ายแล้ว แอปยังค้าง")
  bill("PD-0095", "F", 330000, "เครดิต", { order: "OD006", paper: "4488", day: addDays(today, -6), due: addDays(today, 9) });
  acct("เก่า-ลูกหนี้-4488", "4488", "ร้านตัวอย่าง F", 330000, "ชำระแล้ว", { tab: "ลูกหนี้", ak: "ลูกหนี้", day: addDays(today, -6), channel: "โอน KBank", same: "PD-0095", note: "วันที่ชำระจริงไม่มีในชีท (ใช้วันที่บิล)" });
  // รอบซิงก์ล่าสุด (เมื่อวาน 20:00)
  const last = Date.parse(addDays(today, -1) + "T13:00:00.000Z");
  ops.push({ op: "insert", table: "sync_runs", row: { id: "SR-DEMO", source: "acct", kind: "import", status: "สำเร็จ", started_at: iso(last), finished_at: iso(last + 9000), pages: 4, rows_in: 690, inserted: 12, updated: 3, skipped: 675, by: "system" } });
  // ราคาที่ประธานตั้ง + ประวัติ
  const price = (key, kind, satang, label, old, ago, reason) => {
    ops.push({ op: "insert", table: "prices", row: { pid: kind + "|" + key, item_key: key, kind, price_satang: satang, label, updated_by: "S199" } });
    if (old !== undefined) ops.push({ op: "insert", table: "price_history", row: { at: at(ago * 24 * H + H), day: thaiDay(now - ago * 24 * H - H), item_key: key, kind, old_satang: null, new_satang: old, by: "S199", reason: "ตั้งราคาครั้งแรก", src: "demo" } });
    ops.push({ op: "insert", table: "price_history", row: { at: at(ago * 24 * H), day: thaiDay(now - ago * 24 * H), item_key: key, kind, old_satang: old === undefined ? null : old, new_satang: satang, by: "S199", reason: reason || "ตั้งราคาครั้งแรก", src: "demo" } });
  };
  price("sku:PK-BOT-250-RB-CL", "ราคาโรงงาน", 135, "ขวด PET 250ml เรียบ ใส", undefined, 9);
  price("sku:PK-BOT-250-RB-CL", "ราคาหน้าร้าน", 150, "ขวด PET 250ml เรียบ ใส", 145, 2, "ต้นทุนขึ้น");
  price("spec:ขวด|600 ml|คอยาว|MK|", "ราคาโรงงาน", 210, "ขวด 600 ml คอยาว MK", undefined, 5);
  // ธงเพิ่ม: ชีทบัญชี
  ops.push({ op: "insert", table: "flags", row: { id: "FD-A1", at: at(13 * H), day: thaiDay(now - 13 * H), kind: "บิลหายจากชีทบัญชี", team: "account", severity: "ดู", title: "บิลหายจากชีทบัญชี 1 ใบ — ยกเลิกในแอปตามชีทแล้ว", detail: "ร้านตัวอย่าง A 1,250 บ. — ถ้าลบในชีทโดยไม่ตั้งใจ ให้ใส่กลับในชีท", raised_by: "system" } });
  const { stmts } = compileOps(X, ops);
  for (let i = 0; i < stmts.length; i += 200) await X.db.batch(stmts.slice(i, i + 200));
  // พนักงานตัวอย่าง: ยืนยันแล้วทุกคน ยกเว้นคนที่ระบุ (ให้เห็นเรื่อง "คนใหม่ในรายชื่อ")
  const keep = o.unconfirmed || [];
  await X.db.batch([["UPDATE staff SET exec_ok_at = ?, exec_ok_by = 'S199' WHERE exec_ok_at = '' AND id NOT IN (" + (keep.map(() => "?").join(",") || "''") + ")", iso(now - 864e5), ...keep]]);
}
