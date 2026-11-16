// ============================================================
//  ข้อมูลสมมติล้วน (ชื่อร้าน/ยอดไม่ใช่ของจริง — repo นี้เปิดสาธารณะ) สำหรับเครื่องนักพัฒนา · พรีวิว · เทสต์หน้าจอ
//  เวลาทุกอย่างอิง "ตอนนี้" (ข้อมูลดูสดเสมอ) · ทะเบียนสินค้า/เครื่องใช้ตัวนำเข้าจริง (ref:products · ref:machines)
//  พนักงานตัวอย่าง: PIN 1234 ทุกคน (เครื่องนักพัฒนาเท่านั้น)
// ============================================================
import { compileOps, wrapDb } from "../server/db.mjs";
import { iso, thaiDay, addDays, specKey, specLabel, newId } from "../server/core.mjs";
import { importProducts, importMachines } from "../server/import/importers.mjs";
import { seedScreenDeliver } from "./seed-sd.mjs";   // ข้อมูลสมมติของโมดูลสกรีน + ส่งของ
import { seedProd } from "./seed-prod.mjs";   // ทีมผลิต: ประวัติรอบ · สต๊อก · โมลด์ (ข้อมูลสมมติ)
import { seedExecAccount } from "./seed-exec-account.mjs";   // ประธาน + บัญชี

export const DEMO_STAFF = [
  ["S101", "แอน", "ออฟฟิศ"], ["S102", "ฝน", "ออฟฟิศ"], ["S111", "บอส", "ผลิต"], ["S112", "เก่ง", "ผลิต"], ["S113", "นุ่น", "ผลิต"],
  ["S121", "จอย", "สกรีน"], ["S131", "ต่อ", "ส่งของ"], ["S141", "ฝ้าย", "บัญชี"], ["S199", "หัวหน้า", "บริหาร"],
];
export const DEMO_PIN = "1234";
const ROLE = { "ออฟฟิศ": "office", "ผลิต": "prod", "สกรีน": "screen", "ส่งของ": "deliver", "บัญชี": "account", "บริหาร": "exec" };

async function apply(X, ops) {
  const { stmts } = compileOps(X, ops);
  for (let i = 0; i < stmts.length; i += 200) await X.db.batch(stmts.slice(i, i + 200));
}

/** pinFp(sid, pin) → ลายนิ้วมือแบบที่ GAS คิด (dev server ส่งตัวคิดของ Code.gs จริงมา) */
export async function seedDemo(d1, opt) {
  const o = opt || {};
  const now = o.now || Date.now();
  const X = { db: wrapDb(d1), now, staff: { id: "system", nick: "ระบบ" }, newId: () => newId("", now), reqKey: "seed-demo" };
  const today = thaiDay(now), at = ms => iso(now - ms), H = 3600000;
  await apply(X, (await importProducts(X)).ops);
  await apply(X, (await importMachines(X)).ops);
  const ops = [];
  for (const [id, nick, dept] of DEMO_STAFF) {
    ops.push({ op: "insert", table: "staff", row: { id, name: nick + " (ตัวอย่าง)", nick, dept_th: dept, status: "ทำงาน", pin_fp: o.pinFp ? await o.pinFp(id, DEMO_PIN) : "", pf_at: now - 864e5, src: "demo" } });
    ops.push({ op: "raw", sql: "INSERT INTO staff_roles(staff_id, role) VALUES (?,?)", args: [id, ROLE[dept]] });
  }
  for (const [code, area] of [["111", "ใกล้"], ["115", "ใกล้"], ["119", "ใกล้"], ["212", "ไกล"]]) ops.push({ op: "insert", table: "routes", row: { code, name: "สาย " + code, area, pos: Number(code), src: "demo" } });
  const C = [["A", "115", "เมือง"], ["B", "115", "เมือง"], ["C", "119", "แม่ทะ"], ["D", "212", "เถิน"], ["E", "212", "เถิน"], ["F", "111", "ห้างฉัตร"], ["G", "119", "แม่ทะ"], ["H", "111", "เมือง"]];
  for (const [x, route, district] of C) ops.push({ op: "insert", table: "customers", row: { id: "CD" + x, name: "ร้านตัวอย่าง " + x, name_key: "ร้านตัวอย่าง" + x.toLowerCase(), route_code: route, district, src: "demo" } });
  // ออเดอร์ที่ยังไม่จบ: [ลูกค้า, สถานะ, วันส่ง(+วัน), ด่วน, สกรีน, รายการ[[type,size,neck,shape,color,bags]] ]
  const O = [
    ["A", "พร้อมส่ง", 0, 0, "", [["ขวด", "600 ml", "คอยาว", "MK", "ใส", 40], ["ฝา", "PET น้ำลัง ปากแคบ", "", "", "น้ำเงิน", 0, 400]]],
    ["B", "รอผลิต", 2, 1, "", [["ขวด", "250 ml", "คอสั้น", "เพชร", "น้ำเงิน", 20]]],
    ["C", "รอสกรีน", 1, 0, "น้ำเงิน", [["ขวด", "600 ml", "คอยาว", "เรียบ", "ใส", 60]]],
    ["D", "พร้อมส่ง", -2, 0, "", [["ขวด", "350 ml", "คอยาว", "เพชร", "ใส", 10]]],
    ["E", "กำลังผลิต", 4, 0, "", [["ถัง", "18.9 ลิตร", "", "", "ใส", 12]]],
    ["F", "ส่งบางส่วน", 0, 0, "", [["ขวด", "500 ml", "คอยาว", "เหลี่ยม", "ฟ้า", 30], ["ขวด", "250 ml", "คอยาว", "เพชร", "ใส", 10]]],
    ["G", "รอผลิต", 6, 0, "แดง", [["ขวด", "600 ml", "คอสั้น", "MK", "น้ำเงิน", 25]]],
    ["H", "รอสกรีน", 1, 1, "ขาว", [["ขวด", "1500 ml", "คอยาว", "MK", "ใส", 8]]],
    ["A", "รอผลิต", 0, 0, "", [["ขวด", "800 ml", "คอยาว", "เรียบ", "ใส", 15]], 0],
  ];
  const per = { "ขวด|600 ml": 200, "ขวด|250 ml": 252, "ขวด|350 ml": 300, "ขวด|500 ml": 250, "ขวด|800 ml": 190, "ขวด|1500 ml": 100, "ถัง|18.9 ลิตร": 5 };
  let n = 0;
  for (const [x, status, dueIn, urgent, screen, items, orderedAgo] of O) {
    const id = "OD" + String(++n).padStart(3, "0");
    ops.push({ op: "insert", table: "orders", row: { id, order_day: addDays(today, orderedAgo === 0 ? 0 : -(n % 4) - 1), customer_id: "CD" + x, due_day: addDays(today, dueIn), status, urgent, has_screen: screen ? 1 : 0, purchase_type: "ขายราคาโรงงาน", taker_staff_id: "S101", src: "demo" } });
    items.forEach((t, i) => {
      const it = { type: t[0], size: t[1], neck: t[2], shape: t[3], color: t[4] };
      const pb = per[t[0] + "|" + t[1]] || 0;
      const bags = pb ? t[5] : 0;
      ops.push({ op: "insert", table: "order_items", row: { id: id + "-" + (i + 1), order_id: id, line_no: i + 1, ...it, screen_color: screen, spec_key: specKey(it), label: specLabel(it), bags, per_bag: bags ? pb : 0, qty_pcs: bags ? bags * pb : (t[6] || t[5]), src: "demo" } });
      if (screen) ops.push({ op: "insert", table: "screen_jobs", row: { id: "SJ" + id + i, order_id: id, order_item_id: id + "-" + (i + 1), colors: screen, qty_pcs: bags * pb, due_day: addDays(today, dueIn), team: n === 8 ? "ทีม 2" : null, status: n === 8 ? "เตรียมการสกรีน" : "รอดำเนินการ", src: "demo" } });
    });
  }
  ops.push({ op: "insert", table: "delivery_loads", row: { id: "LD1", order_id: "OD001", order_item_id: "OD001-1", qty_pcs: 8000, status: "บนรถ", loaded_at: at(H), loaded_by: "S131", src: "demo" } });
  // รอบเครื่อง: เดิน 6 เครื่อง (1 รอบค้าง 16 ชม.) · จอด 1 · ปิดแล้ววันนี้ 3
  const runs = [["PET1", "ขวด", "600 ml", "คอยาว", "MK", "ใส", 2.3], ["PET2", "ขวด", "250 ml", "คอยาว", "เพชร", "น้ำเงิน", 5], ["PET4", "ขวด", "250 ml", "คอสั้น", "เพชร", "น้ำเงิน", 2.25],
    ["PET6", "ขวด", "น้ำลัง ปากแคบ (920)", "", "", "ใส", 1], ["PET9", "ถัง", "18.9 ลิตร", "", "", "ใส", 3.5], ["K2", "พรีฟอร์ม", "13.3 กรัม", "", "", "ใส", 16]];
  for (const [m, type, size, neck, shape, color, hrs] of runs) {
    const it = { type, size, neck, shape, color };
    ops.push({ op: "insert", table: "machine_runs", row: { id: "RD" + m, machine_id: m, ...it, spec_key: specKey(it), started_at: at(hrs * H), started_day: thaiDay(now - hrs * H), status: "กำลังผลิต", opened_by: "S111", src: "demo" } });
  }
  ops.push({ op: "insert", table: "machine_events", row: { id: "EV1", machine_id: "PET3", kind: "จอดเครื่อง", reason: "รอวัตถุดิบ", started_at: at(1.5 * H), started_day: thaiDay(now - 1.5 * H), by: "S112", src: "demo" } });
  const closed = [["PET5", 26000, 120, 80], ["PET10", 18500, 0, 45], ["PET8", 4200, 30, 12]];
  closed.forEach(([m, good, b, w], i) => {
    const s = now - (9 - i) * H, e = now - (1 + i) * H;
    const it = { type: "ขวด", size: "500 ml", neck: "คอยาว", shape: "เรียบ", color: "ใส" };
    ops.push({ op: "insert", table: "machine_runs", row: { id: "RC" + i, machine_id: m, ...it, spec_key: specKey(it), started_at: iso(s), started_day: thaiDay(s), ended_at: iso(e), ended_day: thaiDay(e), end_kind: "ปิดรอบ", good_pcs: good, grade_b_pcs: b, waste_pcs: w, status: "ปิดแล้ว", opened_by: "S111", closed_by: "S111", src: "demo" } });
  });
  // บิล + เงินเข้าวันนี้
  const bills = [["PD-0001", "B", 1250000, "เครดิต", "ค้างชำระ", 3], ["PD-0002", "D", 386000, "เครดิต", "ค้างชำระ", 12], ["PD-0003", "A", 90000, "เงินสด", "ชำระแล้ว", 0], ["PD-0004", "F", 245050, "เงินสด", "ชำระแล้ว", 0]];
  for (const [no, x, satang, kind, status, dueIn] of bills) {
    ops.push({ op: "insert", table: "bills", row: { bill_no: no, bill_day: addDays(today, -1), customer_id: "CD" + x, customer_name: "ร้านตัวอย่าง " + x, total_satang: satang, kind, status, due_day: kind === "เครดิต" ? addDays(today, dueIn) : "", paid_day: status === "ชำระแล้ว" ? today : "", paid_satang: status === "ชำระแล้ว" ? satang : 0, pay_channel: status === "ชำระแล้ว" ? (x === "A" ? "เงินสด" : "โอน KBank") : "", src: "v2", by_name: "แอน" } });
    if (status === "ชำระแล้ว") ops.push({ op: "insert", table: "bill_payments", row: { id: "PY" + no, bill_no: no, at: at(2 * H), day: today, amount_satang: satang, channel: x === "A" ? "เงินสด" : "โอน KBank", by: "S141", src: "demo" } });
  }
  // ธงให้ประธานตัดสิน
  const F = [["ยอดไม่ตรง", "account", "บิลกระดาษ ร้านตัวอย่าง B 12,400 แต่ออเดอร์ลง 12,000", "ด่วน"], ["ราคาไม่ตรงทะเบียน", "office", "ขวด 600 ml ลงราคาต่ำกว่าทะเบียน · เหตุผล: ลูกค้าประจำ", "ดู"], ["รอบค้าง", "prod", "K2 เปิดรอบไว้ตั้งแต่เมื่อวาน ยังไม่ได้ปิด", "ดู"]];
  F.forEach(([kind, team, title, sev], i) => ops.push({ op: "insert", table: "flags", row: { id: "FD" + i, at: at((i + 1) * 2 * H), day: thaiDay(now - (i + 1) * 2 * H), kind, team, title, severity: sev, raised_by: "system", src: undefined } }));
  for (const op of ops) if (op.row && op.row.src === undefined) delete op.row.src;
  await apply(X, ops);
  await seedScreenDeliver(X, apply, now);   // สกรีน + ส่งของ (tools/seed-sd.mjs)
  await seedProd(d1, { now });
  await seedExecAccount(X, { unconfirmed: ["S113"] });   // ประธาน + บัญชี
  return { staff: DEMO_STAFF.length };
}
