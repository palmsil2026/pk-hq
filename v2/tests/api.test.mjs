// เทสต์ประตู API + ท่อเขียนข้อมูลกลาง: ตั๋ว · สิทธิ์ · กดซ้ำ · ชนกัน · ย้อน · audit · ไม่มี DELETE
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { world, KEYS, T0 } from "./helpers/world.mjs";
import { issueTicket, pinPrint } from "../server/ticket.mjs";
import { iso, thaiDay, need, int, specKey } from "../server/core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// action ตัวอย่างสำหรับเทสต์ท่อกลาง (insert ลูกค้า+ออเดอร์ · update · ลงสมุดสต๊อก · gate)
function extra(R) {
  R.define({
    name: "test.order_new", roles: ["office"], write: true, label: "ลงออเดอร์ทดสอบ",
    input: raw => ({ customer: need(raw.customer, "ลูกค้า"), bags: int(raw.bags, "จำนวนถุง", { min: 1 }), status: raw.status || "รอผลิต", staffName: raw.staffName }),
    async run(X, input) {
      const cid = "C" + X.newId(), oid = "O" + X.newId();
      const it = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
      return {
        result: { id: oid }, label: "ลงออเดอร์ " + input.customer,
        ops: [
          { op: "insert", table: "customers", row: { id: cid, name: input.customer, name_key: input.customer } },
          { op: "insert", table: "orders", row: { id: oid, order_day: thaiDay(X.now), customer_id: cid, status: input.status } },
          { op: "insert", table: "order_items", row: { id: "I" + X.newId(), order_id: oid, line_no: 1, ...it, spec_key: specKey(it), bags: input.bags, per_bag: 200, qty_pcs: input.bags * 200 } },
        ],
      };
    },
  });
  R.define({
    name: "test.order_due", roles: ["office"], write: true, label: "เลื่อนวันส่ง",
    input: raw => ({ id: need(raw.id, "ออเดอร์"), due: need(raw.due, "วันส่ง"), version: int(raw.version, "รุ่น", { min: 1 }) }),
    async load(X, input) { return { o: await X.db.first("SELECT * FROM orders WHERE id = ?", input.id) }; },
    async run(X, input, ctx) {
      return { result: { id: input.id }, ops: [{ op: "update", table: "orders", id: input.id, expect: input.version, before: ctx.o, set: { due_day: input.due } }] };
    },
  });
  R.define({
    name: "test.stock_in", roles: ["prod"], write: true, label: "รับของเข้า",
    input: raw => ({ qty: int(raw.qty, "จำนวน", { min: 1 }), grade: raw.grade === "B" ? "B" : "A", ref: need(raw.ref, "อ้างอิง") }),
    async run(X, input) {
      return { result: {}, ops: [{ op: "move", item_key: "spec:ขวด|600 ml|คอยาว|MK|ใส", label: "ขวด 600", grade: input.grade, qty_pcs: input.qty, move_type: "ผลิตเข้า", ref_entity: "test", ref_id: input.ref }] };
    },
  });
  R.define({
    name: "test.gate_save", roles: ["prod"], write: true, gate: true,
    input: raw => ({ title: need(raw.title, "หัวข้อ") }),
    async run(X, input) { return { result: {}, ops: [{ op: "flag", kind: "อื่น ๆ", title: input.title }, { op: "insert", table: "flags", row: { id: "F" + X.newId(), at: iso(X.now), day: thaiDay(X.now), kind: "อื่น ๆ", title: input.title } }] }; },
  });
}

test("health + การ์ดชื่อ: ไม่ต้องมีตั๋ว · ไม่มี PIN/ลายนิ้วมือหลุด", async () => {
  const W = world();
  await W.staff("S001", "เปา", ["prod"]);
  await W.staff("S002", "ออย", ["office"]);
  const h = await W.get("health");
  assert.equal(h.ok, true); assert.equal(h.db, true); assert.ok(h.migrations >= 11); assert.equal(h.ticketKey, true);
  const c = await W.get("public/staff?role=prod");
  assert.equal(c.status, 200);
  assert.deepEqual(c.data.staff.map(s => s.nick), ["เปา"]);
  const raw = JSON.stringify(c);
  assert.ok(!/pin|pf/i.test(raw), "ห้ามมีช่อง pin/pf ในการ์ดชื่อ");
});

test("ตั๋ว: ไม่มี / ลายเซ็นผิด / หมดอายุ / ไม่ได้ตั้งกุญแจ", async () => {
  const W = world();
  const tk = await W.staff("S001", "เปา", ["prod"]);
  assert.equal((await W.call(null, "system.me")).status, 401);
  const forged = tk.slice(0, -3) + (tk.endsWith("AAA") ? "BBB" : "AAA");
  const r1 = await W.call(forged, "system.me");
  assert.equal(r1.status, 401); assert.equal(r1.needLogin, true); assert.match(r1.error.message, /ตั๋วไม่ถูกต้อง/);
  const otherKey = await issueTicket("คนละกุญแจ", { k: "s", sid: "S001", n: "เปา", r: ["prod"], pf: "x".repeat(22), iat: T0, exp: T0 + 864e5 });
  assert.equal((await W.call(otherKey, "system.me")).status, 401);
  W.tick(31 * 864e5);
  const r2 = await W.call(tk, "system.me");
  assert.equal(r2.status, 401); assert.match(r2.error.message, /หมดอายุ/);
  const W2 = world({ env: { PK_TICKET_KEY: "" } });
  const r3 = await W2.call(tk, "system.me");
  assert.equal(r3.status, 503); assert.match(r3.error.message, /PK_TICKET_KEY/);
});

test("ลายนิ้วมือ PIN: เปลี่ยน PIN = ตั๋วเก่าตาย · ตั๋วใหม่กว่าใช้ได้ · พักงาน = เข้าไม่ได้", async () => {
  const W = world();
  const old = await W.staff("S001", "เปา", ["prod"], "1234");
  assert.equal((await W.call(old, "system.me")).status, 200);
  W.tick(60000);
  const fresh = await W.ticket("S001", "เปา", ["prod"], "9999");   // GAS ตรวจ PIN ใหม่แล้วออกตั๋วนี้
  const r = await W.call(fresh, "system.me");
  assert.equal(r.status, 200);
  assert.equal(W.one("SELECT pin_fp FROM staff WHERE id='S001'").pin_fp, await pinPrint(KEYS.pin, "S001", "9999"));
  assert.equal(W.q("SELECT * FROM audit_log WHERE action='staff.pin_changed'").length, 1);
  const r2 = await W.call(old, "system.me");
  assert.equal(r2.status, 401); assert.match(r2.error.message, /PIN ของ เปา ถูกเปลี่ยน/);
  W.d1.raw.prepare("UPDATE staff SET status='พัก' WHERE id='S001'").run();
  const r3 = await W.call(fresh, "system.me");
  assert.equal(r3.status, 401); assert.match(r3.error.message, /ถูกพัก/);
});

test("พนักงานใหม่ที่ยังไม่นำเข้า: ตั๋วจาก GAS = ลงทะเบียนให้เอง (+audit)", async () => {
  const W = world();
  const tk = await W.ticket("S050", "ใหม่", ["screen"], "4321");
  const r = await W.call(tk, "system.me");
  assert.equal(r.status, 200); assert.deepEqual(r.data.roles, ["screen"]); assert.equal(r.data.staff.nick, "ใหม่");
  assert.equal(W.q("SELECT * FROM audit_log WHERE action='staff.from_ticket' AND entity_id='S050'").length, 1);
});

test("สิทธิ์ตามบทบาท: ผิดบทบาท = 403 · ขอใช้บทบาทที่ไม่มี = 403 · ประธานใช้ได้ทุกบทบาท", async () => {
  const W = world({ extra });
  const acc = await W.staff("S010", "บัญชี", ["account"]);
  const boss = await W.staff("S099", "ปาล์ม", ["exec"]);
  const r1 = await W.call(acc, "home.prod");
  assert.equal(r1.status, 403);
  const r2 = await W.call(acc, "home.account", {}, { as: "office" });
  assert.equal(r2.status, 403); assert.match(r2.error.message, /ไม่มีสิทธิ์ใช้แอปส่วนนี้/);
  assert.equal((await W.call(acc, "home.account")).status, 200);
  assert.equal((await W.call(boss, "home.prod", {}, { as: "prod" })).status, 200);
  const r3 = await W.call(boss, "test.order_new", { customer: "ร้านตัวอย่าง A", bags: 2 }, { as: "office" });
  assert.equal(r3.status, 200);
  assert.equal(W.one("SELECT role FROM audit_log WHERE action='test.order_new' LIMIT 1").role, "office");
  assert.equal((await W.call(acc, "nope.nothing")).status, 404);
});

test("เขียน: ต้องมี key · audit ครบทุก op (คน=จากตั๋ว ไม่ใช่จากหน้าเว็บ) · รอบคุยกับฐาน ≤ 4", async () => {
  const W = world({ extra });
  const tk = await W.staff("S002", "ออย", ["office"]);
  const r0 = await W.call(tk, "test.order_new", { customer: "ร้าน A", bags: 1 }, { key: "" });
  assert.equal(r0.status, 400); assert.match(r0.error.message, /รหัสกันกดซ้ำ/);
  const before = W.d1.stats.rounds;
  const r = await W.call(tk, "test.order_new", { customer: "ร้าน A", bags: 3, staffName: "คนปลอม" }, { reason: "ลูกค้าโทรมา" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(W.d1.stats.rounds - before <= 4, "ปุ่มเดียวคุยกับฐาน " + (W.d1.stats.rounds - before) + " รอบ");
  const a = W.q("SELECT * FROM audit_log WHERE action='test.order_new' ORDER BY id");
  assert.equal(a.length, 3);
  assert.deepEqual(a.map(x => x.entity), ["customers", "orders", "order_items"]);
  for (const x of a) { assert.equal(x.staff_id, "S002"); assert.equal(x.staff_name, "ออย"); assert.equal(x.reason, "ลูกค้าโทรมา"); assert.ok(x.req_key); }
  assert.ok(!JSON.stringify(a).includes("คนปลอม"));
  assert.equal(JSON.parse(a[2].after_json).qty_pcs, 600);
  assert.ok(r.undo && r.undo.id && r.undo.label === "ลงออเดอร์ ร้าน A");
});

test("กดซ้ำ: key เดิม = ผลเดิม ไม่ลงซ้ำ · key เดิมคนละเนื้อ = ปฏิเสธ · ส่งซ้ำพร้อมกัน = แถวเดียว", async () => {
  const W = world({ extra });
  const tk = await W.staff("S002", "ออย", ["office"]);
  const key = "same-key-0001";
  const a = await W.call(tk, "test.order_new", { customer: "ร้าน B", bags: 1 }, { key });
  const b = await W.call(tk, "test.order_new", { customer: "ร้าน B", bags: 1 }, { key });
  assert.equal(b.status, 200); assert.equal(b.replayed, true); assert.equal(b.data.id, a.data.id);
  assert.equal(W.one("SELECT count(*) n FROM orders").n, 1);
  const c = await W.call(tk, "test.order_new", { customer: "ร้าน B", bags: 5 }, { key });
  assert.equal(c.status, 409);
  const other = await W.staff("S003", "บี", ["office"]);
  assert.equal((await W.call(other, "test.order_new", { customer: "ร้าน B", bags: 1 }, { key })).status, 409);
  // เน็ตหลุดแล้วหน้าเว็บส่งซ้ำทันที — สองคำขอวิ่งพร้อมกัน
  const k2 = "race-key-0002";
  const [x, y] = await Promise.all([
    W.call(tk, "test.order_new", { customer: "ร้าน C", bags: 2 }, { key: k2 }),
    W.call(tk, "test.order_new", { customer: "ร้าน C", bags: 2 }, { key: k2 }),
  ]);
  assert.equal(x.status, 200); assert.equal(y.status, 200);
  assert.equal(x.data.id, y.data.id);
  assert.equal(W.one("SELECT count(*) n FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE name='ร้าน C')").n, 1);
});

test("ชนกัน: สองคนแก้รายการเดียวกันจาก version เดิม → คนหลังได้ 409 ข้อความไทย · ไม่มีอะไรครึ่ง ๆ กลาง ๆ", async () => {
  const W = world({ extra });
  const t1 = await W.staff("S002", "ออย", ["office"]);
  const t2 = await W.staff("S003", "บี", ["office"]);
  const o = await W.call(t1, "test.order_new", { customer: "ร้าน D", bags: 1 });
  const [p, q] = await Promise.all([
    W.call(t1, "test.order_due", { id: o.data.id, due: "2026-11-20", version: 1 }),
    W.call(t2, "test.order_due", { id: o.data.id, due: "2026-11-21", version: 1 }),
  ]);
  const codes = [p.status, q.status].sort();
  assert.deepEqual(codes, [200, 409]);
  const loser = p.status === 409 ? p : q;
  assert.match(loser.error.message, /มีคนแก้รายการนี้ไปก่อน/);
  const row = W.one("SELECT due_day, version FROM orders WHERE id=?", o.data.id);
  assert.equal(row.version, 2);
  assert.equal(W.q("SELECT * FROM audit_log WHERE action='test.order_due'").length, 1, "audit ของคนที่แพ้ต้องไม่เข้า");
});

test("ย้อน: พลิกสถานะไม่ลบแถว · ซ้ำไม่ได้ · คนอื่นย้อนไม่ได้ · ขั้นถัดไปรับแล้วย้อนไม่ได้ · เลยเวลาไม่ได้", async () => {
  const W = world({ extra });
  const tk = await W.staff("S002", "ออย", ["office"]);
  const other = await W.staff("S003", "บี", ["office"]);
  const boss = await W.staff("S099", "ปาล์ม", ["exec"]);
  const o = await W.call(tk, "test.order_new", { customer: "ร้าน E", bags: 2 });
  assert.equal((await W.call(other, "undo.run", { id: o.undo.id })).status, 403);
  const u = await W.call(tk, "undo.run", { id: o.undo.id }, { reason: "กดผิด" });
  assert.equal(u.status, 200, JSON.stringify(u));
  assert.equal(W.one("SELECT status FROM orders WHERE id=?", o.data.id).status, "ยกเลิก");
  assert.equal(W.one("SELECT count(*) n FROM orders").n, 1, "ย้อน = ไม่ลบแถว");
  assert.equal(W.one("SELECT status FROM order_items").status, "ยกเลิก");
  assert.equal(W.one("SELECT status FROM customers").status, "พัก");
  const ua = W.q("SELECT * FROM audit_log WHERE action='undo.run' AND entity='orders'");
  assert.equal(ua.length, 1); assert.ok(ua[0].undo_of); assert.equal(ua[0].reason, "กดผิด");
  const again = await W.call(tk, "undo.run", { id: o.undo.id });
  assert.equal(again.status, 409); assert.match(again.error.message, /ย้อนไปแล้ว/);

  // ขั้นถัดไปแตะแล้ว (มีคนแก้ออเดอร์หลังบันทึก) → ย้อนไม่ได้ ข้อมูลไม่เปลี่ยน
  const o2 = await W.call(tk, "test.order_new", { customer: "ร้าน F", bags: 1 });
  assert.equal((await W.call(other, "test.order_due", { id: o2.data.id, due: "2026-11-30", version: 1 })).status, 200);
  const blocked = await W.call(tk, "undo.run", { id: o2.undo.id });
  assert.equal(blocked.status, 409); assert.match(blocked.error.message, /ขั้นถัดไปรับงานไปแล้ว/);
  assert.equal(W.one("SELECT status FROM orders WHERE id=?", o2.data.id).status, "รอผลิต");
  assert.equal(W.one("SELECT status FROM undo_log WHERE id=?", o2.undo.id).status, "พร้อมย้อน");

  // ย้อนการแก้ (update) คืนค่าเดิม · ประธานย้อนแทนได้
  const d = await W.call(other, "test.order_due", { id: o2.data.id, due: "2026-12-01", version: 2 });
  assert.equal((await W.call(boss, "undo.run", { id: d.undo.id }, { as: "office" })).status, 200);
  assert.equal(W.one("SELECT due_day FROM orders WHERE id=?", o2.data.id).due_day, "2026-11-30");

  // เลยเวลา
  const o3 = await W.call(tk, "test.order_new", { customer: "ร้าน G", bags: 1 });
  W.tick(25 * 3600000);
  const late = await W.call(tk, "undo.run", { id: o3.undo.id });
  assert.equal(late.status, 410); assert.match(late.error.message, /เลยเวลาย้อน/);
});

test("สต๊อกแบบสมุด: ลงเข้า → ยอดขยับเอง · ย้อน = แถวกลับทิศ · เกรด B แยกจาก A · ย้อนซ้ำไม่ได้", async () => {
  const W = world({ extra });
  const tk = await W.staff("S001", "เปา", ["prod"]);
  const a = await W.call(tk, "test.stock_in", { qty: 1000, ref: "R1" });
  await W.call(tk, "test.stock_in", { qty: 50, grade: "B", ref: "R1" });
  const bal = () => Object.fromEntries(W.q("SELECT grade, qty_pcs FROM stock_balance").map(r => [r.grade, r.qty_pcs]));
  assert.deepEqual(bal(), { A: 1000, B: 50 });
  assert.equal((await W.call(tk, "undo.run", { id: a.undo.id })).status, 200);
  assert.deepEqual(bal(), { A: 0, B: 50 });
  const moves = W.q("SELECT qty_pcs, move_type, reverses FROM stock_moves ORDER BY id");
  assert.equal(moves.length, 3); assert.equal(moves[2].qty_pcs, -1000); assert.equal(moves[2].move_type, "ย้อน"); assert.equal(moves[2].reverses, 1);
  assert.throws(() => W.d1.raw.prepare("UPDATE stock_moves SET qty_pcs = 5 WHERE id = 1").run(), /แก้ไม่ได้/);
});

test("ทีมผลิต PIN-ตอนบันทึก: ตั๋วประจำเครื่องบันทึกไม่ได้ · ตั๋ว g ได้ · ตั๋ว g หมดอายุบอกให้ใส่ PIN ใหม่", async () => {
  const W = world({ extra });
  const sess = await W.staff("S001", "เปา", ["prod"]);
  const r = await W.call(sess, "test.gate_save", { title: "ทดสอบ" });
  assert.equal(r.status, 401); assert.equal(r.error.needPin, true);
  const g = await W.ticket("S001", "เปา", ["prod"], "1234", { k: "g", exp: T0 + 5 * 60000 });
  assert.equal((await W.call(g, "test.gate_save", { title: "ทดสอบ" })).status, 200);
  W.tick(6 * 60000);
  const r2 = await W.call(g, "test.gate_save", { title: "อีกครั้ง" });
  assert.equal(r2.status, 401); assert.match(r2.error.message, /ใส่ PIN ใหม่/);
});

test("ธง: ยกธงต้องมีเหตุผล · ย้อนคำขอที่ยกธง = ปิดธงให้ · ประธานปิดธงแบบ version", async () => {
  const W = world();
  const tk = await W.staff("S002", "ออย", ["office"]);
  const boss = await W.staff("S099", "ปาล์ม", ["exec"]);
  assert.equal((await W.call(tk, "flag.raise", { title: "ราคาแปลก" })).status, 400);
  const f = await W.call(tk, "flag.raise", { title: "ราคาแปลก", kind: "ราคาไม่ตรงทะเบียน" }, { reason: "ลูกค้าประจำ" });
  assert.equal(f.status, 200);
  const list = await W.call(boss, "flag.list");
  assert.equal(list.data.items.length, 1);
  const res = await W.call(boss, "flag.resolve", { id: f.data.id, version: 1, status: "ปิด", resolution: "โอเค" });
  assert.equal(res.status, 200);
  assert.equal((await W.call(boss, "flag.resolve", { id: f.data.id, version: 1 })).status, 409);
  assert.equal((await W.call(tk, "flag.resolve", { id: f.data.id, version: 2 })).status, 403);
  const g = await W.call(tk, "flag.raise", { title: "กดผิด" }, { reason: "ทดสอบ" });
  assert.equal((await W.call(tk, "undo.run", { id: g.undo.id })).status, 200);
  assert.equal(W.one("SELECT status FROM flags WHERE id=?", g.data.id).status, "ปิด");
});

test("ข้อความผิดพลาดภาษาไทยจากฐาน: ค่าสถานะนอกคลัง · ข้อมูลไม่ผ่านเงื่อนไข", async () => {
  const W = world({ extra });
  const tk = await W.staff("S002", "ออย", ["office"]);
  const r = await W.call(tk, "test.order_new", { customer: "ร้าน H", bags: 1, status: "มั่ว" });
  assert.equal(r.status, 400); assert.match(r.error.message, /ไม่อยู่ในรายการที่อนุญาต/);
  assert.equal(W.one("SELECT count(*) n FROM customers").n, 0, "ล้มทั้งชุด — ลูกค้าต้องไม่ค้าง");
  const r2 = await W.call(tk, "test.order_new", { customer: "ร้าน H", bags: "1.5" });
  assert.equal(r2.status, 400); assert.match(r2.error.message, /จำนวนเต็ม/);
});

test("ไม่มี DELETE: โค้ดหลังบ้านไม่มีคำสั่งลบ · ฐานปฏิเสธการลบทุกตาราง · D1 จำลองปฏิเสธ", async () => {
  const W = world();
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(path.join(HERE, "..", "server"));
  walk(path.join(HERE, "..", "functions"));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8").split("\n").filter(l => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    assert.ok(!/\bDELETE\s+FROM\b/i.test(src), f + " มีคำสั่ง DELETE");
  }
  await W.staff("S001", "เปา", ["prod"]);
  assert.throws(() => W.d1.raw.prepare("DELETE FROM staff WHERE id='S001'").run(), /ห้ามลบข้อมูล/);
  await assert.rejects(W.d1.prepare("DELETE FROM staff").run(), /ห้ามใช้ DELETE/);
  await assert.rejects(W.d1.prepare("SELECT * FROM staff WHERE nick LIKE ?").bind("%").all(), /LIKE/);
});

test("เวลาไทย: ข้ามเที่ยงคืน (UTC+7 คงที่)", () => {
  assert.equal(thaiDay(Date.UTC(2026, 10, 16, 16, 59)), "2026-11-16");   // 23:59 ไทย
  assert.equal(thaiDay(Date.UTC(2026, 10, 16, 17, 1)), "2026-11-17");    // 00:01 ไทย
  assert.equal(thaiDay(Date.UTC(2026, 11, 31, 17, 0)), "2027-01-01");
});
