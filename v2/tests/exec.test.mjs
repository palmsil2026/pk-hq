// เทสต์แอปประธาน: เรื่องที่ต้องตัดสินใจ (ธงทุกทีม + คนใหม่ในรายชื่อ) · ภาพรวมวันนี้ · รายละเอียดเรื่อง · ราคา + ประวัติราคา
import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyWorld, TODAY } from "./helpers/money.mjs";
import { importProducts } from "../server/import/importers.mjs";
import { compileOps, wrapDb } from "../server/db.mjs";
import { iso } from "../server/core.mjs";

const ok = (r, msg) => assert.equal(r.status, 200, (msg || "") + " " + JSON.stringify(r.error));
async function withProducts(W) {
  const X = { db: wrapDb(W.d1), now: W.clock.now, staff: { id: "system", nick: "ระบบ" }, newId: () => "x", reqKey: "seed" };
  const { stmts } = compileOps(X, (await importProducts(X)).ops);
  await W.d1.batch(stmts.map(([sql, ...a]) => W.d1.prepare(sql).bind(...a)));
}

test("หน้าแรกประธาน: เรื่องที่ต้องตัดสินใจจากทุกทีม (ด่วนขึ้นก่อน) · ไม่มีเรื่อง = ว่าง · ภาพรวมวันนี้ครบ + ระบุช่วงเวลา", async () => {
  const { W, t } = await moneyWorld();
  W.d1.raw.prepare("UPDATE staff SET exec_ok_at = ?").run(iso(W.clock.now));
  let h = (await W.call(t.boss, "home.exec")).data;
  assert.deepEqual(h.flags, []); assert.deepEqual(h.newStaff, []);
  for (const k of ["made", "machines", "orders", "deliver", "moneyIn", "owing"]) assert.ok(h[k], "ภาพรวมต้องมี " + k);
  assert.match(h.made.period, new RegExp(TODAY)); assert.match(h.deliver.period, /วันนี้/); assert.match(h.owing.period, /ณ/);
  ok(await W.call(t.prod, "flag.raise", { title: "PET 3 ไฟดับ", kind: "อื่น ๆ" }, { reason: "ไฟดับ" }));
  ok(await W.call(t.office, "flag.raise", { title: "ลูกค้าขอลดราคา", kind: "อื่น ๆ", severity: "ด่วน" }, { reason: "อื่น" }));
  h = (await W.call(t.boss, "home.exec")).data;
  assert.deepEqual(h.flags.map(f => [f.team, f.severity]), [["office", "ด่วน"], ["prod", "ดู"]]);
  assert.equal(h.flags[1].raised_nick, "บอส");
  const f = h.flags[1];
  ok(await W.call(t.boss, "flag.resolve", { id: f.id, version: f.version, status: "ปิด", resolution: "สั่งช่างแล้ว" }));
  const d = (await W.call(t.boss, "exec.flag_detail", { id: f.id })).data;
  assert.equal(d.flag.status, "ปิด"); assert.equal(d.flag.resolution, "สั่งช่างแล้ว"); assert.equal(d.flag.resolved_nick, "หัวหน้า");
  assert.ok(d.history.some(x => x.action === "flag.resolve"));
});

test("รายละเอียดเรื่อง: พาไปถึงของที่อ้างถึง (บิล → ยอด/ที่มา) · เรื่องที่ไม่มีของอ้างถึงก็เปิดได้", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 1200000);
  ok(await W.call(t.acct, "account.mismatch_report", { bill_no: "PB1", paper_satang: 1240000 }));
  const f = W.one("SELECT * FROM flags");
  const d = (await W.call(t.boss, "exec.flag_detail", { id: f.id })).data;
  assert.equal(d.entity.table, "bills"); assert.equal(d.entity.total_satang, 1200000); assert.equal(d.entity.src_label, "จากออเดอร์");
  assert.equal((await W.call(t.boss, "exec.flag_detail", { id: "ไม่มี" })).status, 404);
});

test("คนใหม่ในรายชื่อที่ไม่ผ่านประธาน (นำเข้าจากชีต/ตั๋ว) = เรื่องให้ตัดสิน · ยืนยันทีละคน/ทั้งหมด · ย้อนได้", async () => {
  const { W, t } = await moneyWorld();
  let h = (await W.call(t.boss, "home.exec")).data;
  assert.equal(h.newStaff.length, 7, "พนักงานในโลกเทสต์ยังไม่มีใครยืนยัน");
  const one = h.newStaff.find(s => s.nick === "บอส");
  const r1 = await W.call(t.boss, "exec.staff_ack", { ids: [one.id] });
  ok(r1);
  assert.equal((await W.call(t.boss, "home.exec")).data.newStaff.length, 6);
  ok(await W.call(t.boss, "undo.run", { id: r1.undo.id }));
  assert.equal((await W.call(t.boss, "home.exec")).data.newStaff.length, 7, "ย้อนแล้วกลับมาเป็นเรื่องให้ตัดสิน");
  ok(await W.call(t.boss, "exec.staff_ack", { ids: h.newStaff.map(s => s.id) }));
  assert.equal((await W.call(t.boss, "home.exec")).data.newStaff.length, 0);
  assert.equal((await W.call(t.boss, "exec.staff_ack", { ids: [one.id] })).status, 400, "ยืนยันซ้ำ");
  assert.equal((await W.call(t.acct, "exec.staff_ack", { ids: [one.id] })).status, 403);
  const list = (await W.call(t.boss, "exec.staff_list")).data;
  assert.ok(!JSON.stringify(list).includes("pin_fp") && list.staff.every(s => typeof s.has_pin === "boolean"), "ห้ามส่งลายนิ้วมือ PIN ไปหน้าเว็บ");
  assert.equal(list.staff.find(s => s.nick === "ฝ้าย").roles[0], "account");
});

test("ราคา: ประธานคนเดียว · ครั้งแรก = ประวัติ (เดิมว่าง) · ปรับ = ประวัติ เดิม→ใหม่ ใคร เมื่อ เหตุผล · ชนกัน 409 · ราคาเท่าเดิม = ไม่บันทึก", async () => {
  const { W, t } = await moneyWorld();
  await withProducts(W);
  const L = (await W.call(t.boss, "price.list")).data;
  assert.equal(L.items.length, 29);
  const ref = L.items.find(i => i.item_key === "sku:PK-BOT-250-RB-CL");
  assert.equal(ref.ref_satang, 135, "ราคาอ้างอิงจากบิล 1.35 บ."); assert.deepEqual(ref.prices, {}, "ระบบไม่ตั้งราคาจากราคาอ้างอิงเอง");
  assert.equal(W.one("SELECT count(*) n FROM prices").n, 0);
  assert.equal((await W.call(t.office, "price.set", { item_key: ref.item_key, kind: "ราคาโรงงาน", satang: 140 })).status, 403);
  assert.equal((await W.call(t.acct, "price.list")).status, 403);
  const s1 = await W.call(t.boss, "price.set", { item_key: ref.item_key, kind: "ราคาโรงงาน", satang: 140, version: 0 }, { reason: "ตั้งราคาครั้งแรก" });
  ok(s1);
  assert.equal(s1.undo, null, "ราคาไม่มีปุ่มย้อนซ่อน — แก้ด้วยการตั้งใหม่ (มีประวัติทุกครั้ง)");
  W.tick(60000);
  const s2 = await W.call(t.boss, "price.set", { item_key: ref.item_key, kind: "ราคาโรงงาน", satang: 150, version: 1 }, { reason: "ต้นทุนขึ้น" });
  ok(s2);
  assert.equal((await W.call(t.boss, "price.set", { item_key: ref.item_key, kind: "ราคาโรงงาน", satang: 160, version: 1 })).status, 409, "รุ่นเก่า");
  assert.equal((await W.call(t.boss, "price.set", { item_key: ref.item_key, kind: "ราคาโรงงาน", satang: 150, version: 2 })).status, 400, "เท่าเดิม");
  assert.equal((await W.call(t.boss, "price.set", { item_key: ref.item_key, kind: "ลดพิเศษ", satang: 1 })).status, 400, "ชนิดราคาไม่อยู่ในรายการ");
  assert.equal((await W.call(t.boss, "price.set", { item_key: "sku:ไม่มี", kind: "ราคาโรงงาน", satang: 1 })).status, 404);
  const hist = W.q("SELECT * FROM price_history ORDER BY id");
  assert.deepEqual(hist.map(h => [h.old_satang, h.new_satang, h.by, h.reason]), [[null, 140, "S900", "ตั้งราคาครั้งแรก"], [140, 150, "S900", "ต้นทุนขึ้น"]]);
  assert.throws(() => W.d1.raw.prepare("UPDATE price_history SET new_satang = 1").run(), /แก้ไม่ได้/);
  const L2 = (await W.call(t.boss, "price.list")).data;
  assert.equal(L2.items.find(i => i.item_key === ref.item_key).prices["ราคาโรงงาน"].satang, 150);
  assert.equal(L2.history[0].by_nick, "หัวหน้า"); assert.equal(L2.history[0].label, "ขวด PET 250ml เรียบ ใส");
  assert.ok(W.q("SELECT * FROM audit_log WHERE action='price.set'").length >= 4, "ทุกครั้งลง audit (ราคา + ประวัติ)");
});

test("ราคาต่อสเปก: ตรวจกับทะเบียน (ประเภท/ขนาด/แกน) · แกนที่ประเภทไม่ใช้ถูกตัดทิ้ง · สองคนตั้งครั้งแรกพร้อมกัน = คนหลัง 409", async () => {
  const { W, t } = await moneyWorld();
  const s = await W.call(t.boss, "price.set", { item_key: "spec:ขวด|600 ml|คอยาว|MK|", kind: "ราคาโรงงาน", satang: 210 });
  ok(s); assert.equal(s.data.item_key, "spec:ขวด|600 ml|คอยาว|MK|");
  const film = await W.call(t.boss, "price.set", { item_key: "spec:ฟิล์มหุ้มคอ|" + W.one("SELECT size FROM type_sizes WHERE type='ฟิล์มหุ้มคอ' LIMIT 1").size + "|คอยาว||", kind: "ราคาโรงงาน", satang: 5 });
  ok(film); assert.ok(!film.data.item_key.includes("คอยาว"), "ฟิล์มไม่มีแกนคอขวด — ตัดทิ้ง");
  assert.equal((await W.call(t.boss, "price.set", { item_key: "spec:ขวด|999 ml||||", kind: "ราคาโรงงาน", satang: 1 })).status, 400);
  assert.equal((await W.call(t.boss, "price.set", { item_key: "spec:ขวด|600 ml||ทรงแปลก|", kind: "ราคาโรงงาน", satang: 1 })).status, 400);
  assert.equal((await W.call(t.boss, "price.set", { item_key: "ขวด", kind: "ราคาโรงงาน", satang: 1 })).status, 400);
  const again = await W.call(t.boss, "price.set", { item_key: "spec:ขวด|600 ml|คอยาว|MK|", kind: "ราคาโรงงาน", satang: 220, version: 0 });
  assert.equal(again.status, 409, "หน้าจอเก่ายังคิดว่ายังไม่เคยตั้ง");
  const L = (await W.call(t.boss, "price.list")).data;
  assert.equal(L.specs.length, 2); assert.equal(L.specs.find(x => x.item_key === "spec:ขวด|600 ml|คอยาว|MK|").label, "ขวด 600 ml คอยาว MK");
});
