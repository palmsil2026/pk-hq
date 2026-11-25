// ============================================================
//  ตัวช่วยเทสต์โมดูลประธาน+บัญชี: โลกจำลองที่มีพนักงานครบบทบาท + ลูกค้า + ออเดอร์ + บิลจากออเดอร์ (ข้อมูลสมมติ)
// ============================================================
import { world, T0 } from "./world.mjs";
import { thaiDay, addDays } from "../../server/core.mjs";

export const TODAY = thaiDay(T0);
export async function moneyWorld(opt) {
  const W = world(opt);
  const t = {
    boss: await W.staff("S900", "หัวหน้า", ["exec"]),
    acct: await W.staff("S901", "ฝ้าย", ["account"]),
    acct2: await W.staff("S902", "ฟ้า", ["account"]),
    office: await W.staff("S903", "แอน", ["office"]),
    prod: await W.staff("S904", "บอส", ["prod"]),
    screen: await W.staff("S905", "จอย", ["screen"]),
    deliver: await W.staff("S906", "ต่อ", ["deliver"]),
  };
  const at = new Date(W.clock.now).toISOString();
  const run = (sql, ...a) => W.d1.raw.prepare(sql).run(...a);
  for (const [id, name] of [["C1", "ร้านทดสอบ หนึ่ง"], ["C2", "ร้านทดสอบ สอง"], ["C3", "ร้านทดสอบ สาม"]]) {
    run("INSERT INTO customers(id, name, name_key, src, created_at, updated_at) VALUES (?,?,?,?,?,?)", id, name, name.replace(/\s/g, "").toLowerCase(), "test", at, at);
  }
  /** ออเดอร์ + บิลจากออเดอร์ (แบบที่โมดูลออฟฟิศจะออก) */
  W.orderBill = (no, cust, satang, kind, extra) => {
    const e = extra || {};
    const oid = "O-" + no;
    run("INSERT INTO orders(id, order_day, customer_id, status, total_satang, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", oid, e.day || TODAY, cust, "ส่งแล้ว", satang, "test", at, at);
    run(`INSERT INTO bills(bill_no, bill_day, customer_id, customer_name, order_id, total_satang, kind, status, due_day, src, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, no, e.day || TODAY, cust, W.one("SELECT name FROM customers WHERE id=?", cust).name, oid, satang, kind || "เครดิต", "ค้างชำระ", e.due || (kind === "เงินสด" ? "" : addDays(TODAY, 3)), "v2", at, at);
    return W.one("SELECT * FROM bills WHERE bill_no=?", no);
  };
  /** แถวที่นำเข้าจากชีทบัญชี (src acct:*) */
  W.acctBill = (no, paper, name, satang, status, extra) => {
    const e = extra || {};
    run(`INSERT INTO bills(bill_no, bill_day, customer_name, total_satang, kind, status, paid_day, paid_satang, pay_channel, src, paper_no, acct_kind, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, no, e.day || TODAY, name, satang, e.kind || "เครดิต", status, status === "ชำระแล้ว" ? (e.paid || TODAY) : "", status === "ชำระแล้ว" ? satang : 0, e.channel || "",
      "acct:" + (e.tab || "ลูกหนี้"), paper, e.acct_kind || "ลูกหนี้", at, at);
    return W.one("SELECT * FROM bills WHERE bill_no=?", no);
  };
  W.bill = no => W.one("SELECT * FROM bills WHERE bill_no=?", no);
  return { W, t };
}
