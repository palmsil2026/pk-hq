// สร้าง v2/db/migrations/0010_reference.sql (คลังค่า + ทะเบียนอ้างอิง) และ 0011_guards.sql (trigger กันลบ/กันค่าผิด)
//   node v2/tools/gen-reference-sql.mjs  → เขียนไฟล์ · ใส่ --check = ตรวจว่าไฟล์ตรงกับสคริปต์ (CI)
//   ⚠️ migration ที่ขึ้นของจริงแล้วห้ามแก้ — หลังขึ้นจริงให้เพิ่มไฟล์ใหม่แทน (สคริปต์นี้ใช้ช่วง Foundation เท่านั้น)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "db", "migrations");
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

// [kind, [[value, tone, label?], …]]
export const VOCAB = [
  ["staff.status", [["ทำงาน", "ok"], ["พัก", "warn"], ["ลาออก", "mute"]]],
  ["customers.status", [["ใช้งาน", "ok"], ["พัก", "warn"], ["เลิกกิจการ", "mute"]]],
  ["products.status", [["ขาย", "ok"], ["เลิกขาย", "mute"]]],
  ["orders.status", [["รอผลิต", "warn"], ["กำลังผลิต", "brand"], ["รอสกรีน", "warn"], ["กำลังสกรีน", "brand"], ["พร้อมส่ง", "ok"], ["ส่งบางส่วน", "warn"], ["ส่งแล้ว", "ok"], ["ยกเลิก", "mute"]]],
  ["orders.purchase_type", [["", "mute", "ไม่ระบุ"], ["ขายราคาโรงงาน", ""], ["ขายหน้าร้าน", ""]]],
  ["orders.price_mode", [["", "mute", "ไม่ระบุ"], ["มาตรฐาน", ""], ["พิเศษ", "warn"]]],
  ["orders.pay_status", [["", "mute", "ไม่ระบุ"], ["รอโอนเงิน", "warn"], ["โอนแล้ว", "ok"], ["ทำได้เลย", "ok"], ["เก็บปลายทาง", "warn"]]],
  ["orders.design_status", [["", "mute", "ไม่ระบุ"], ["ไม่ต้องใช้แบบ", "mute"], ["รอแบบ", "warn"], ["แก้ไขแบบ", "warn"], ["แบบผ่านแล้ว", "ok"]]],
  ["order_items.status", [["ใช้งาน", "ok"], ["ยกเลิก", "mute"]]],
  ["production_jobs.status", [["รอผลิต", "warn"], ["กำลังผลิต", "brand"], ["เสร็จ", "ok"], ["ยกเลิก", "mute"]]],
  ["machines.kind", [["เป่า", ""], ["ฉีด", ""], ["สกรีน", ""], ["ลม", ""], ["น้ำเย็น", ""], ["ไฟฟ้า", ""], ["อื่น", ""]]],
  ["machines.status", [["ใช้งาน", "ok"], ["พัก", "warn"], ["เลิกใช้", "mute"]]],
  ["machine_runs.status", [["กำลังผลิต", "ok", "เดินอยู่"], ["ปิดแล้ว", "mute"], ["ยกเลิก", "mute"], ["ค้างจากระบบเดิม", "warn", "ค้างจากแอปเดิม"]]],
  ["machine_runs.end_kind", [["", "mute", "ยังเดินอยู่"], ["ปิดรอบ", ""], ["เปลี่ยนสี", ""], ["ยกเลิก", "mute"]]],
  ["machine_events.kind", [["จอดเครื่อง", "warn"], ["เปลี่ยนโมลด์", ""], ["ซ่อม", "bad"]]],
  ["machine_events.status", [["ใช้งาน", "ok"], ["ยกเลิก", "mute"]]],
  ["screen_jobs.status", [["รอดำเนินการ", "warn"], ["เตรียมการสกรีน", "brand"], ["เสร็จแล้ว", "ok"], ["ยกเลิก", "mute"]]],
  ["delivery_trips.status", [["จัดของ", "warn"], ["ออกรถ", "brand"], ["กลับแล้ว", "ok"], ["ยกเลิก", "mute"]]],
  ["delivery_loads.status", [["บนรถ", "brand"], ["ส่งแล้ว", "ok"], ["ส่งไม่ได้", "bad"], ["คืนคลัง", "warn"], ["ยกเลิก", "mute"]]],
  ["bills.kind", [["เงินสด", ""], ["เครดิต", ""]]],
  ["bills.status", [["ค้างชำระ", "warn"], ["ชำระแล้ว", "ok"], ["ยกเลิก", "mute"]]],
  ["bill_payments.status", [["ใช้ได้", "ok"], ["ยกเลิก", "mute"]]],
  ["statements.status", [["รอเก็บ", "warn"], ["วางบิลแล้ว", "brand"], ["เก็บแล้ว", "ok"], ["ยกเลิก", "mute"]]],
  ["stock_moves.move_type", [["ผลิตเข้า", "ok"], ["ส่งออก", ""], ["รับเข้า", "ok"], ["เบิกใช้", ""], ["นับปรับ", "warn"], ["ย้อน", "mute"], ["ยอดยกมา", "mute"]]],
  ["flags.kind", [["ราคาไม่ตรงทะเบียน", "warn"], ["ต่ำกว่าขั้นต่ำ", "warn"], ["รอบค้าง", "warn"], ["ยอดไม่ตรง", "bad"], ["สต๊อกติดลบ", "bad"], ["ลูกค้าจับคู่ไม่ได้", "warn"], ["ทำนอกขั้นตอน", "warn"], ["นำเข้ามีปัญหา", "bad"], ["อื่น ๆ", ""]]],
  ["flags.severity", [["ดู", "warn"], ["ด่วน", "bad"]]],
  ["flags.status", [["เปิด", "warn"], ["รับทราบ", "brand"], ["ปิด", "mute"]]],
  ["sync_runs.status", [["กำลังทำ", "brand"], ["สำเร็จ", "ok"], ["ล้มเหลว", "bad"]]],
  ["sync_runs.kind", [["import", ""], ["export", ""], ["mirror", ""]]],
  ["undo_log.status", [["พร้อมย้อน", "brand"], ["ย้อนแล้ว", "mute"], ["หมดสิทธิ์", "mute"]]],
  ["devices.kind", [["มิเตอร์ไฟ", ""], ["ตัวนับ", ""], ["อุณหภูมิ", ""], ["แรงดันลม", ""], ["มิเตอร์น้ำ", ""]]],
  ["devices.status", [["ใช้งาน", "ok"], ["พัก", "warn"], ["เลิกใช้", "mute"]]],
  // รายการเหตุผล (ชิปในแผ่นยืนยัน — ทุกรายการมี "อื่น ๆ (พิมพ์เอง)" ต่อท้ายที่หน้าจอเสมอ)
  ["reason.machine_stop", [["ไฟดับ", ""], ["เครื่องเสีย/ซ่อม", ""], ["รอวัตถุดิบ", ""], ["เปลี่ยนโมลด์", ""], ["ไม่มีงาน", ""], ["พัก/เปลี่ยนกะ", ""]]],
  ["reason.waste", [["ก้นบาง", ""], ["ปากเบี้ยว", ""], ["สีเพี้ยน", ""], ["แตก/รั่ว", ""], ["สกรีนเพี้ยน", ""]]],
  ["reason.delivery_fail", [["ร้านปิด", ""], ["ไม่มีคนรับ", ""], ["ลูกค้าขอเลื่อน", ""], ["ของไม่ครบ/ผิดสเปก", ""], ["รถเสีย/ไม่ทันเวลา", ""]]],
  ["reason.pending", [["ขวดหมด", ""], ["วัตถุดิบหมด", ""], ["เครื่องเสีย", ""], ["รอแบบ", ""]]],
  ["reason.order_cancel", [["ลูกค้ายกเลิก", ""], ["ลงซ้ำ", ""], ["ลงผิด", ""]]],
  ["reason.undo", [["กดผิด", ""], ["ลงผิดคน/ผิดเครื่อง", ""], ["ลงจำนวนผิด", ""]]],
];
// คอลัมน์ที่ trigger ตรวจกับ vocab (ค่าที่ไม่มีในคลัง = ล้ม พร้อมข้อความไทย)
export const CHECKED = [
  ["staff", "status"], ["customers", "status"], ["products", "status"],
  ["orders", "status"], ["orders", "purchase_type"], ["orders", "price_mode"], ["orders", "pay_status"], ["orders", "design_status"],
  ["order_items", "status"], ["production_jobs", "status"],
  ["machines", "kind"], ["machines", "status"], ["machine_runs", "status"], ["machine_runs", "end_kind"],
  ["machine_events", "kind"], ["machine_events", "status"], ["screen_jobs", "status"],
  ["delivery_trips", "status"], ["delivery_loads", "status"],
  ["bills", "kind"], ["bills", "status"], ["bill_payments", "status"], ["statements", "status"],
  ["stock_moves", "move_type"], ["flags", "kind"], ["flags", "severity"], ["flags", "status"],
  ["sync_runs", "status"], ["sync_runs", "kind"], ["undo_log", "status"], ["devices", "kind"], ["devices", "status"],
];
// ตารางที่ห้ามแก้แถว (เขียนเพิ่มอย่างเดียว)
export const APPEND_ONLY = ["audit_log", "stock_moves", "price_history", "device_readings"];

const SPEC = {
  types: [
    // [code, axes, count_unit, piece_unit]
    ["ขวด", "ขนาด,คอขวด,รูปทรง,สี,สีสกรีน,พร้อมฝาสี", "ถุง", "ใบ"],
    ["ถัง", "ขนาด,สี,สีสกรีน,พร้อมฝาสี", "ถุง", "ใบ"],
    ["ฟิล์มหุ้มคอ", "ขนาด,สี", "ชิ้น", "ชิ้น"],
    ["ฝา", "ขนาด,สี", "ชิ้น", "ชิ้น"],
    ["ฟิล์มแพ็คโหล", "ขนาด", "ชิ้น", "ชิ้น"],
    ["ถุงหิ้ว", "ขนาด", "ชิ้น", "ชิ้น"],
    ["ลัง", "สี,สีสกรีน", "ชิ้น", "ชิ้น"],
    ["พรีฟอร์ม", "ขนาด,สี", "ชิ้น", "ชิ้น"],
  ],
  // [type, size, per_bag, min_order_pcs] — ตัวเลขทุกตัวจาก gas/Code.gs PER_BAG / MIN_ORDER (ถอดจากออเดอร์จริง)
  sizes: [
    ["ขวด", "250 ml", 252, 2000], ["ขวด", "600 ml", 200, 1200], ["ขวด", "350 ml", 300, 2000], ["ขวด", "500 ml", 250, 1200],
    ["ขวด", "น้ำลัง ปากแคบ (920)", 130, 500], ["ขวด", "800 ml", 190, 0], ["ขวด", "1500 ml", 100, 0], ["ขวด", "1000 ml", 0, 0],
    ["ขวด", "น้ำลัง ปากกว้าง (920)", 130, 500],
    ["ถัง", "18.9 ลิตร", 5, 25], ["ถัง", "ขุ่น 20 ลิตร", 5, 25], ["ถัง", "15 ลิตร", 5, 25],
    ["ฟิล์มหุ้มคอ", "คอขวดปากกว้าง", 0, 0], ["ฟิล์มหุ้มคอ", "คอถัง", 0, 0], ["ฟิล์มหุ้มคอ", "คอขวดปากแคบ", 0, 0],
    ["ฝา", "ถังใส", 0, 0], ["ฝา", "ถังขุ่น", 0, 0], ["ฝา", "PET น้ำลัง ปากแคบ", 0, 0],
    ["ฟิล์มแพ็คโหล", "12 x 15 (250 ml)", 0, 0], ["ถุงหิ้ว", "เบอร์ 8 x 18 (800 ml)", 0, 0],
    ["พรีฟอร์ม", "9 กรัม", 0, 0], ["พรีฟอร์ม", "13.3 กรัม", 0, 0],
  ],
  values: {
    "คอขวด": ["คอยาว", "คอสั้น"],
    "รูปทรง": ["เพชร", "เรียบ", "MK", "เหลี่ยม"],
    "สี": ["น้ำเงิน", "ใส", "เขียว", "ฟ้า", "ฟ้าทะเล", "ฟ้าเข้ม", "ขาวขุ่น", "เขียวอ่อน", "ดำ (เกรด B)"],
    "สีสกรีน": ["น้ำเงิน", "ขาว", "ฟ้าคริสตัล", "เขียวเข้ม", "เขียวอ่อน", "ส้ม", "ชมพูบานเย็น", "ดำ", "แดง", "ทอง", "ฟ้านม", "ม่วง", "ยังไม่รู้"],
    "พร้อมฝาสี": ["ขาว", "น้ำเงิน", "ฟ้าคริสตัล 012", "ขาว 001", "ดำ 018", "เขียวอ่อน", "เขียวเข้ม 038", "ส้ม 045", "ชมพูบานเย็น 006", "ชมพู"],
  },
};
const ROLES = [["office", "ออฟฟิศ", "ออฟฟิศ", 1], ["prod", "ทีมผลิต", "ผลิต", 2], ["screen", "ทีมสกรีนสี", "สกรีน", 3], ["deliver", "ส่งของ", "ส่งของ", 4], ["account", "บัญชี", "บัญชี", 5], ["exec", "ประธาน", "บริหาร", 6]];
const T0 = "2026-11-16T00:00:00.000Z";
const SETTINGS = [
  ["UNDO_HOURS", "24", "ย้อนได้ภายในกี่ชั่วโมงหลังบันทึก (ถ้าขั้นถัดไปยังไม่รับงาน)"],
  ["GATE_TICKET_MIN", "5", "ทีมผลิต: ตั๋วจาก PIN ตอนกดบันทึก ใช้ได้กี่นาที"],
  ["RUN_STALE_HOURS", "14", "รอบเครื่องเปิดค้างเกินกี่ชั่วโมง = ธง \"รอบค้าง\" (ไม่บล็อก)"],
  ["MIN_WEB_VERSION", "", "รุ่นหน้าเว็บต่ำสุดที่ยอมให้ใช้ (ว่าง = ไม่บังคับ) — ต่ำกว่านี้ขึ้นแถบบังคับอัปเดต"],
  ["COMPANY_NAME", "โรงขวด P&K", "ชื่อบนหัวเอกสาร"],
];

function reference() {
  const L = [];
  const A = s => L.push(s);
  A("-- ═══════════════════════════════════════════════════════════════════════════");
  A("--  0010_reference — คลังค่า (vocab) · บทบาท · สเปกสินค้า · ทีมสกรีน · รถ · ค่าตั้ง");
  A("--  ⚠️ สร้างโดย v2/tools/gen-reference-sql.mjs — แก้ที่สคริปต์แล้วรันใหม่ (ช่วง Foundation) · หลังขึ้นจริงห้ามแก้ไฟล์นี้ ให้เพิ่ม migration ใหม่");
  A("--  ตัวเลขสเปก/ตัวคูณถุง/ขั้นต่ำ มาจาก gas/Code.gs (SPEC · PER_BAG · MIN_ORDER — ถอดจากออเดอร์จริง)");
  A("-- ═══════════════════════════════════════════════════════════════════════════");
  for (const [kind, vals] of VOCAB) {
    A(`INSERT INTO vocab(kind, value, pos, label, tone) VALUES ` + vals.map((v, i) => `(${q(kind)}, ${q(v[0])}, ${i + 1}, ${q(v[2] || "")}, ${q(v[1] || "")})`).join(", ") + ";");
  }
  A(`INSERT INTO roles(code, name_th, dept_th, pos) VALUES ` + ROLES.map(r => `(${q(r[0])}, ${q(r[1])}, ${q(r[2])}, ${r[3]})`).join(", ") + ";");
  A(`INSERT INTO product_types(code, axes, count_unit, piece_unit, pos) VALUES ` + SPEC.types.map((t, i) => `(${q(t[0])}, ${q(t[1])}, ${q(t[2])}, ${q(t[3])}, ${i + 1})`).join(", ") + ";");
  A(`INSERT INTO type_sizes(type, size, per_bag, min_order_pcs, pos) VALUES ` + SPEC.sizes.map((s, i) => `(${q(s[0])}, ${q(s[1])}, ${s[2]}, ${s[3]}, ${i + 1})`).join(", ") + ";");
  for (const [axis, vals] of Object.entries(SPEC.values)) {
    A(`INSERT INTO spec_values(axis, value, pos, grade) VALUES ` + vals.map((v, i) => `(${q(axis)}, ${q(v)}, ${i + 1}, ${q(/เกรด B/.test(v) ? "B" : "A")})`).join(", ") + ";");
  }
  A(`INSERT INTO screen_teams(code, pos) VALUES ('ทีม 1', 1), ('ทีม 2', 2), ('ทีม 3', 3);`);
  A(`INSERT INTO vehicles(id, name, created_at, updated_at, src) VALUES ` + ["04", "05", "06", "07", "08", "09"].map(v => `(${q(v)}, ${q("รถ " + v)}, ${q(T0)}, ${q(T0)}, 'ref:Code.gs')`).join(", ") + ";");
  A(`INSERT INTO settings(key, value, note, updated_at, updated_by) VALUES ` + SETTINGS.map(s => `(${q(s[0])}, ${q(s[1])}, ${q(s[2])}, ${q(T0)}, 'system')`).join(", ") + ";");
  return L.join("\n") + "\n";
}

const NO_GUARD = new Set(["_guard", "sqlite_sequence", "d1_migrations", "_cf_KV"]);
function guards(tables) {
  const L = [];
  const A = s => L.push(s);
  A("-- ═══════════════════════════════════════════════════════════════════════════");
  A("--  0011_guards — trigger กลาง: ① ห้ามลบทุกตาราง (พลิกสถานะแทน) ② ตารางสมุดแก้แถวไม่ได้ ③ ค่าสถานะ/ประเภทต้องอยู่ในคลัง vocab");
  A("--  ⚠️ สร้างโดย v2/tools/gen-reference-sql.mjs · โมดูลที่เพิ่มตารางใหม่ ต้องใส่ trigger กันลบของตารางตัวเองใน migration ของตัวเอง");
  A("--     (เทสต์ tests/schema.test.mjs ตรวจทุกตาราง — ลืมใส่ = แดง)");
  A("-- ═══════════════════════════════════════════════════════════════════════════");
  for (const t of tables) {
    if (NO_GUARD.has(t)) continue;
    A(`CREATE TRIGGER no_delete_${t} BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (${t}) — ใช้การเปลี่ยนสถานะแทน'); END;`);
  }
  for (const t of APPEND_ONLY) {
    A(`CREATE TRIGGER no_update_${t} BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'สมุด ${t} แก้ไม่ได้ — ลงแถวใหม่แทน'); END;`);
  }
  for (const [t, c] of CHECKED) {
    const cond = `NOT EXISTS (SELECT 1 FROM vocab WHERE kind = '${t}.${c}' AND value = NEW.${c})`;
    const msg = `ค่า ${c} ของ ${t} ไม่อยู่ในรายการที่อนุญาต`;
    A(`CREATE TRIGGER vocab_${t}_${c}_ins BEFORE INSERT ON ${t} WHEN ${cond} BEGIN SELECT RAISE(ABORT, '${msg}'); END;`);
    A(`CREATE TRIGGER vocab_${t}_${c}_upd BEFORE UPDATE OF ${c} ON ${t} WHEN ${cond} BEGIN SELECT RAISE(ABORT, '${msg}'); END;`);
  }
  return L.join("\n") + "\n";
}

export function tablesFromSql(sql) {
  return [...sql.matchAll(/CREATE TABLE (\w+)/g)].map(m => m[1]);
}

function main() {
  const files = fs.readdirSync(MIG).filter(f => /^00(0\d|10)_/.test(f) && f !== "0010_reference.sql" && f !== "0011_guards.sql").sort();
  const tables = files.flatMap(f => tablesFromSql(fs.readFileSync(path.join(MIG, f), "utf8")));
  const out = { "0010_reference.sql": reference(), "0011_guards.sql": guards(tables) };
  let bad = 0;
  for (const [f, body] of Object.entries(out)) {
    const p = path.join(MIG, f);
    if (process.argv.includes("--check")) {
      if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== body) { console.error("✗ " + f + " ไม่ตรงกับสคริปต์ — รัน node v2/tools/gen-reference-sql.mjs"); bad++; }
    } else { fs.writeFileSync(p, body); console.log("เขียน " + f); }
  }
  if (bad) process.exit(1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
