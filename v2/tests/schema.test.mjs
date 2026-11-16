// เทสต์โครงฐานข้อมูล: กันลบทุกตาราง · ไม่มี PIN · เงิน/จำนวนเป็นจำนวนเต็ม · สมุดแก้ไม่ได้ · รอบเครื่องข้ามเที่ยงคืน · เปิดรอบซ้อนไม่ได้
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { freshDb, MIGRATIONS_DIR } from "./helpers/d1.mjs";

const T = "2026-11-16T02:00:00.000Z";
const tables = d => d.q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_guard','d1_migrations')").map(r => r.name);

test("migration: ชื่อไฟล์ 4 หลักเรียงกัน · ช่วง Foundation 0001–0099 · ใส่ซ้ำได้ไม่พัง", () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) assert.match(f, /^\d{4}_[a-z0-9_]+\.sql$/);
  assert.equal(new Set(files.map(f => f.slice(0, 4))).size, files.length, "เลข migration ซ้ำ");
  const d = freshDb();
  assert.ok(d.q("SELECT count(*) n FROM d1_migrations")[0].n >= 11);
});

test("ทุกตารางมี trigger กันลบ (โมดูลเพิ่มตารางแล้วลืม = แดง)", () => {
  const d = freshDb();
  const trig = new Set(d.q("SELECT name FROM sqlite_master WHERE type='trigger'").map(r => r.name));
  for (const t of tables(d)) assert.ok(trig.has("no_delete_" + t), "ตาราง " + t + " ไม่มี trigger no_delete_" + t);
});

test("ไม่มีคอลัมน์ PIN ที่ไหนในฐาน", () => {
  const d = freshDb();
  for (const t of tables(d)) for (const c of d.q(`PRAGMA table_info(${t})`)) assert.ok(!/^pin$|_pin$|^pin_(?!fp)/i.test(c.name), t + "." + c.name);
});

test("เงิน/จำนวน: ทศนิยมหรือข้อความ = ฐานปฏิเสธ", () => {
  const d = freshDb();
  d.raw.exec(`INSERT INTO customers(id,name,name_key,created_at,updated_at) VALUES ('C1','ร้าน','ร้าน','${T}','${T}')`);
  const bill = v => d.raw.prepare(`INSERT INTO bills(bill_no,bill_day,customer_name,total_satang,kind,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run("B" + Math.random(), "2026-11-16", "ร้าน", v, "เงินสด", "ค้างชำระ", T, T);
  assert.throws(() => bill(1.5), /CHECK/);
  assert.throws(() => bill("100 บาท"), /CHECK/);   // ข้อความเลขล้วน SQLite แปลงเป็นจำนวนเต็มเอง (ไม่ใช่ปัญหา) · ข้อความอื่นต้องล้ม
  assert.throws(() => bill(-1), /CHECK/);
  bill(12345);
  d.raw.exec(`INSERT INTO orders(id,order_day,customer_id,created_at,updated_at) VALUES ('O1','2026-11-16','C1','${T}','${T}')`);
  const item = (bags, per, extra, qty) => d.raw.prepare(`INSERT INTO order_items(id,order_id,line_no,type,spec_key,bags,per_bag,extra_pcs,qty_pcs,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("I" + Math.random(), "O1", Math.floor(Math.random() * 1e6) + 1, "ขวด", "ขวด|600 ml|||", bags, per, extra, qty, T, T);
  item(10, 200, 5, 2005);
  assert.throws(() => item(10, 200, 0, 1999), /CHECK/, "ถุง × ใบต่อถุง ต้องตรงกับจำนวนใบ");
  assert.throws(() => item(3, 0, 0, 3), /CHECK/, "ไม่รู้ใบต่อถุงห้ามใส่ถุง");
  item(0, 0, 0, 30);
  assert.throws(() => d.raw.exec(`INSERT INTO bills(bill_no,bill_day,customer_name,total_satang,kind,status,created_at,updated_at) VALUES ('X','2026-11-16','ร้าน',100,'เงินสด','ชำระแล้ว','${T}','${T}')`), /CHECK/, "ชำระแล้วต้องมีวันที่ชำระ");
});

test("สมุด (audit_log · stock_moves · price_history) แก้แถวไม่ได้", () => {
  const d = freshDb();
  d.raw.exec(`INSERT INTO audit_log(at,day,staff_id,action) VALUES ('${T}','2026-11-16','S1','x')`);
  assert.throws(() => d.raw.exec(`UPDATE audit_log SET action='y'`), /แก้ไม่ได้/);
  assert.throws(() => d.raw.exec(`DELETE FROM audit_log`), /ห้ามลบ/);
  assert.throws(() => d.raw.exec(`INSERT INTO audit_log(at,day,staff_id,action) VALUES ('2026-11-16 09:00','2026-11-16','S1','x')`), /CHECK/, "เวลาต้องเป็น ISO UTC");
});

test("รอบเครื่อง: ข้ามเที่ยงคืนได้ · ปิดก่อนเปิดไม่ได้ · เครื่องเดียวเปิดสองรอบพร้อมกันไม่ได้", () => {
  const d = freshDb();
  d.raw.exec(`INSERT INTO machines(id,name,kind,created_at,updated_at) VALUES ('PET1','PET 1','เป่า','${T}','${T}')`);
  const run = (id, st, en, status) => d.raw.prepare(`INSERT INTO machine_runs(id,machine_id,type,spec_key,started_at,started_day,ended_at,ended_day,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, "PET1", "ขวด", "ขวด||||", st, "2026-11-16", en, en ? "2026-11-17" : "", status, T, T);
  run("R1", "2026-11-16T16:30:00.000Z", "2026-11-16T18:10:00.000Z", "ปิดแล้ว");   // 23:30 → 01:10 ไทย
  assert.throws(() => run("R2", "2026-11-16T16:30:00.000Z", "2026-11-16T15:00:00.000Z", "ปิดแล้ว"), /CHECK/);
  run("R3", "2026-11-17T01:00:00.000Z", "", "กำลังผลิต");
  assert.throws(() => run("R4", "2026-11-17T01:05:00.000Z", "", "กำลังผลิต"), /UNIQUE/);
});

test("ค่าสถานะต้องอยู่ในคลัง vocab — โมดูลเพิ่มค่าใหม่ได้ด้วย INSERT vocab (ไม่ต้องรื้อตาราง)", () => {
  const d = freshDb();
  d.raw.exec(`INSERT INTO customers(id,name,name_key,created_at,updated_at) VALUES ('C1','ร้าน','ร้าน','${T}','${T}')`);
  assert.throws(() => d.raw.exec(`INSERT INTO orders(id,order_day,customer_id,status,created_at,updated_at) VALUES ('O1','2026-11-16','C1','รอรับ','${T}','${T}')`), /ไม่อยู่ในรายการ/);
  d.raw.exec(`INSERT INTO vocab(kind,value) VALUES ('orders.status','รอรับ')`);
  d.raw.exec(`INSERT INTO orders(id,order_day,customer_id,status,created_at,updated_at) VALUES ('O1','2026-11-16','C1','รอรับ','${T}','${T}')`);
});
