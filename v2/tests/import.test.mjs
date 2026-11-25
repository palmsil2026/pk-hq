// เทสต์ตัวนำเข้าแบบครบสาย: gas/Code.gs ตัวจริง (ชีตจำลอง) → ส่งออกลงชื่อ → Cloudflare นำเข้า → D1 จำลอง
//   รันซ้ำไม่เบิ้ล · ไม่ทับของเดิม · ไม่มี PIN · ชีทบัญชี/AppSheet ไม่ถูกเขียน · ข้อความผิดพลาดภาษาไทย
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { world } from "./helpers/world.mjs";
import { splitCustomerText, matchCustomer, nameKey, thaiDate, parseLegacyNote } from "../server/import/legacy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);

async function setup(envOver) {
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  const gasFetch = async url => {
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams.entries());
    return new Response(JSON.stringify(G.call(p.action, p)), { headers: { "content-type": "application/json" } });
  };
  const W = world({ now: T0, fetch: gasFetch, env: Object.assign({ PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" }, envOver || {}) });
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  const run = async (source, limit) => {
    let cursor = "0", runId = "", last, pages = 0;
    do {
      last = await W.call(boss, "import.run", { source, cursor, run: runId, limit: limit || 100 });
      assert.equal(last.status, 200, source + ": " + JSON.stringify(last.error));
      runId = last.data.run; cursor = last.data.next; pages++;
    } while (cursor !== null && pages < 50);
    return { ...last.data, pages };
  };
  return { G, W, boss, run };
}

test("ตัวแกะชื่อ/วันที่/หมายเหตุ (ตรงกับ gas/Code.gs)", () => {
  assert.deepEqual(splitCustomerText("ช้างทิพย์ ลี้ งานช้างทิพย์"), { name: "ช้างทิพย์ ลี้", brand: "ช้างทิพย์", note: "" });
  assert.deepEqual(splitCustomerText("สายธารทิพย์(แม่เมาะ)งานสวมฉลาก"), { name: "สายธารทิพย์(แม่เมาะ)", brand: "สวมฉลาก", note: "" });
  assert.equal(splitCustomerText("สโรชา (วัดประตูต้นผึ้ง) ครั้งต่อไป เปนคอยาว").note, "ครั้งต่อไป เปนคอยาว");
  const idx = { byKey: new Map([[nameKey("อุดมทรัพย์ (งาว)"), "C1"], [nameKey("ร้านกขค"), "C2"], [nameKey("ร้านกขคง"), "C3"]]), alias: new Map() };
  assert.equal(matchCustomer("อุดมทรัพย์(งาว)", idx).id, "C1");
  assert.equal(matchCustomer("ร้านกขคง สาขา 2", idx).id, "C3", "ขึ้นต้นตรง = เลือกชื่อที่ยาวสุด");
  assert.equal(matchCustomer("ร้านอื่น", idx), null);
  idx.byKey.set(nameKey("อุดมทรัพย์ (เมือง)"), "C4");
  assert.equal(matchCustomer("อุดมทรัพย์", idx), null, "ชื่อย่อที่ตรงหลายราย = กำกวม ไม่จับ");
  assert.equal(thaiDate("28/7/2568"), "2025-07-28"); assert.equal(thaiDate("28/7/68"), "2025-07-28"); assert.equal(thaiDate("02/04/2025"), "2025-04-02");
  assert.equal(thaiDate("2/04", "2025"), "2025-04-02"); assert.equal(thaiDate("2/04"), ""); assert.equal(thaiDate("31/2/2568"), "");
  const n = parseLegacyNote("13/10/68ทำ25ถุงค้าง9ถุง(ขวดหมด)ทำครบแล้ว29/11/68 รอโอน ค่าบล้อค 500 บาท");
  assert.equal(n.doneBags, 25); assert.equal(n.pendingBags, 9); assert.equal(n.pendingReason, "ขวดหมด"); assert.equal(n.finished, "2025-11-29"); assert.equal(n.pay, "รอโอนเงิน"); assert.equal(n.blockFeeBaht, 500);
});

test("ทะเบียนใน repo: สินค้า 29 SKU + เครื่อง/ผัง — รันซ้ำไม่เบิ้ล · ไม่ตั้งราคาให้เอง", async () => {
  const { W, run } = await setup();
  const p1 = await run("ref:products");
  assert.equal(p1.status, "สำเร็จ"); assert.equal(p1.page.inserted, 29);
  assert.equal((await run("ref:products")).page.skipped, 29);
  assert.equal(W.one("SELECT count(*) n FROM products").n, 29);
  assert.equal(W.one("SELECT count(*) n FROM prices").n, 0, "ราคาตั้งโดยประธานเท่านั้น — นำเข้าไม่ตั้งราคา");
  const p = W.one("SELECT * FROM products WHERE id='PK-BOT-600-MK-CL'");
  assert.equal(p.type, "ขวด"); assert.equal(p.per_pack, 200); assert.equal(p.spec_key, "ขวด|600 ml||MK|ใส");
  const m1 = await run("ref:machines");
  assert.ok(m1.page.inserted >= 40);
  assert.equal((await run("ref:machines")).page.inserted, 0);
  assert.equal(W.one("SELECT plant FROM machines WHERE id='PET9'").plant, "โรง 2");
  assert.equal(W.one("SELECT legacy_name FROM machines WHERE id='SHE230G'").legacy_name, "SHE230G PET");
});

test("พนักงาน: ไม่มี PIN ในฐาน · บทบาทจากแผนก · พักงาน · เปลี่ยน PIN ในชีต = ตั๋วเก่าตายหลังนำเข้า", async () => {
  const { G, W, run } = await setup();
  const before = G.call("pkV2Ticket", {}, { sid: "S001", pin: "1111" }).ticket;
  const r = await run("staff");
  assert.equal(r.page.inserted, 3); assert.equal(r.page.updated, 1, "ประธาน (S004) ลงทะเบียนจากตั๋วไปก่อน — นำเข้าเติมชื่อจริง/แผนกให้");
  assert.deepEqual(W.q("SELECT staff_id, role FROM staff_roles WHERE active=1 ORDER BY staff_id").map(x => x.staff_id + ":" + x.role), ["S001:office", "S002:prod", "S003:screen", "S004:exec"]);
  assert.equal(W.one("SELECT status FROM staff WHERE id='S003'").status, "พัก");
  const dump = JSON.stringify(W.q("SELECT * FROM staff")) + JSON.stringify(W.q("SELECT * FROM audit_log"));
  for (const pin of ["1111", "2222", "3333", "4444"]) assert.ok(!dump.includes(pin), "PIN หลุดเข้าฐาน v2");
  assert.equal((await W.call(before, "system.me")).status, 200, "ตั๋วที่ออกก่อนนำเข้ายังใช้ได้ (ลายนิ้วมือตรงกัน)");
  assert.equal((await run("staff")).page.skipped, 4);
  // เปลี่ยน PIN ในชีต → นำเข้ารอบหน้า → ตั๋วเก่าใช้ไม่ได้ · ตั๋วใหม่ใช้ได้
  G.books.get(G.props.PK_SHEET_ID).getSheetByName("Staff").data.find(x => x[0] === "S001")[4] = "5555";
  G.ctx.dirty_(); G.tick(60000); W.tick(60000);
  assert.equal((await run("staff")).page.updated, 1);
  assert.equal((await W.call(before, "system.me")).status, 401);
  const after = G.call("pkV2Ticket", {}, { sid: "S001", pin: "5555" }).ticket;
  assert.equal((await W.call(after, "system.me")).status, 200);
});

test("ลูกค้า: สาย/อำเภอ · เติมช่องว่างไม่ทับของเดิม · รันซ้ำไม่เบิ้ล · ชื่อสะกดต่างจับคู่หลวม", async () => {
  const { W, run } = await setup();
  const T = new Date(T0).toISOString();
  W.d1.raw.prepare("INSERT INTO customers(id,name,name_key,phone,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("C9", "ร้านตัวอย่าง ข", nameKey("ร้านตัวอย่าง ข"), "099-999-9999", "", T, T);
  const r = await run("legacy:customer");
  assert.equal(r.page.inserted, 2); assert.equal(r.page.updated, 1);
  const b = W.one("SELECT * FROM customers WHERE id='C9'");
  assert.equal(b.phone, "099-999-9999", "เบอร์ที่มีอยู่แล้วต้องไม่ถูกทับ");
  assert.equal(b.route_code, "212"); assert.equal(b.district, "แม่ทะ"); assert.equal(b.note, "เงินไม่ดีให้สั่งทางออฟฟิศ");
  assert.deepEqual(W.q("SELECT code, area FROM routes ORDER BY code").map(x => x.code + x.area), ["115ใกล้", "212ไกล"]);
  assert.equal((await run("legacy:customer")).page.skipped, 3);
  assert.equal(W.one("SELECT count(*) n FROM customers").n, 3);
  await run("acct");   // แท็บ "รายชื่อ" ในชีทบัญชี: "ร้านตัวอย่าง ก" (ไม่มี "(เมือง)") ต้องไม่กลายเป็นคนใหม่ซ้ำ? — ชื่อต่างกันจริง = รายใหม่ รอรวมมือ
  assert.ok(W.one("SELECT count(*) n FROM customers WHERE name='ร้านตัวอย่าง ง'").n === 1);
});

test("ออเดอร์เก่า: แบ่งหน้า · ชื่องานแยกจากลูกค้า · หมายเหตุมือเป็นช่องจริง · จับคู่ไม่ได้ = รอตรวจ + ธง · รันซ้ำไม่เบิ้ล", async () => {
  const { W, run } = await setup();
  await run("staff");
  await run("legacy:customer");
  const r = await run("legacy:order", 2);
  assert.equal(r.pages, 2); assert.equal(W.one("SELECT count(*) n FROM orders").n, 4);
  const a = W.one("SELECT * FROM orders WHERE id='เก่า-a1b2'");
  assert.equal(a.brand, "แบรนด์เอ"); assert.equal(a.pay_status, "รอโอนเงิน"); assert.equal(a.urgent, 1); assert.equal(a.order_day, "2025-07-28"); assert.equal(a.taker_staff_id, "S001");
  assert.equal(W.one("SELECT name FROM customers WHERE id=?", a.customer_id).name, "ร้านตัวอย่าง ก (เมือง)");
  const ia = W.one("SELECT * FROM order_items WHERE order_id='เก่า-a1b2'");
  assert.equal(ia.bags, 10); assert.equal(ia.per_bag, 200); assert.equal(ia.qty_pcs, 2000);
  const c = W.one("SELECT * FROM orders WHERE id='เก่า-c3d4'");
  assert.equal(c.done_bags, 25); assert.equal(c.pending_bags, 9); assert.equal(c.finished_day, "2025-11-29");
  assert.equal(W.one("SELECT qty_pcs FROM order_items WHERE order_id='เก่า-c3d4'").qty_pcs, 20 * 252 + 10);
  const e = W.one("SELECT * FROM orders WHERE id='เก่า-e5f6'");
  assert.equal(e.status, "ยกเลิก"); assert.equal(e.block_fee_satang, 50000); assert.equal(e.brand, "งานพิเศษ");
  assert.equal(W.one("SELECT needs_review FROM customers WHERE id=?", e.customer_id).needs_review, 1);
  assert.equal(W.q("SELECT * FROM flags WHERE kind='ลูกค้าจับคู่ไม่ได้' AND status='เปิด'").length, 1);
  assert.equal(W.one("SELECT qty_pcs FROM order_items WHERE order_id='เก่า-g7h8'").qty_pcs, 500);
  const again = await run("legacy:order", 2);
  assert.equal(again.page.inserted + again.page.updated, 0);
  assert.equal(W.one("SELECT count(*) n FROM orders").n, 4);
  assert.equal(W.q("SELECT * FROM flags WHERE kind='ลูกค้าจับคู่ไม่ได้'").length, 1, "ธงไม่ซ้ำ");
  assert.equal(W.one("SELECT count(*) n FROM stock_moves").n, 0, "ประวัติไม่แตะสต๊อก");
  assert.equal(W.one("SELECT count(*) n FROM production_jobs").n, 0);
});

test("รอบผลิตเก่า: ข้ามเที่ยงคืน · หลายคนต่อรอบ · ชื่อเครื่องเดิม · รอบค้าง = สถานะแยก + ธง (ไม่ชนกฎเปิดรอบเดียว)", async () => {
  const { W, run } = await setup();
  await run("ref:machines"); await run("staff");
  const r = await run("legacy:stock:ProductionLog");
  assert.equal(r.page.inserted, 3);
  const night = W.one("SELECT * FROM machine_runs WHERE id='L-r002'");
  assert.equal(night.started_at, "2026-11-10T15:00:00.000Z"); assert.equal(night.ended_at, "2026-11-10T23:30:00.000Z"); assert.equal(night.ended_day, "2026-11-11");
  assert.deepEqual(W.q("SELECT name_text, staff_id FROM run_crew WHERE run_id='L-r001' ORDER BY name_text").map(x => x.name_text + ":" + x.staff_id), ["บี:S002", "เอ:S001"]);
  const stuck = W.one("SELECT * FROM machine_runs WHERE id='L-r003'");
  assert.equal(stuck.status, "ค้างจากระบบเดิม"); assert.equal(stuck.machine_id, "SHE230G");
  assert.equal(W.q("SELECT * FROM flags WHERE kind='รอบค้าง'").length, 1);
  assert.equal((await run("legacy:stock:ProductionLog")).page.inserted, 0);
});

test("บิลจากชีทบัญชี: สตางค์ · \"ค้างจ่าย\" ไม่ใช่จ่ายแล้ว · ชีทบัญชีแก้ → ตามได้ · บิล v2 ไม่แตะ · ไม่เขียนกลับ", async () => {
  const { G, W, run } = await setup();
  await run("legacy:customer");
  const r = await run("acct", 3);
  assert.equal(r.status, "สำเร็จ");
  const b = no => W.one("SELECT * FROM bills WHERE bill_no=?", no);
  assert.equal(b("เก่า-บิลรายวัน 2025-0001").total_satang, 125050);
  assert.equal(b("เก่า-บิลรายวัน 2025-0001").status, "ชำระแล้ว"); assert.equal(b("เก่า-บิลรายวัน 2025-0001").paid_day, "2025-03-02");
  assert.equal(b("เก่า-บิลรายวัน 2025-0002").status, "ค้างชำระ");
  assert.equal(b("เก่า-ลูกหนี้-0002").status, "ค้างชำระ", "\"ค้างจ่าย\" ต้องไม่กลายเป็นชำระแล้ว (บั๊กเดิม 31 ส.ค.)");
  assert.equal(b("เก่า-ลูกหนี้-0090").status, "ชำระแล้ว");
  assert.equal(b("เก่า-บิลรายวัน 2025-0003").customer_id, null, "\"สด\" ไม่ผูกลูกค้า");
  assert.ok(b("เก่า-บิลรายวัน 2025-0004").customer_id, "\"ร้าน ตัวอย่าง ก\" จับคู่หลวมกับทะเบียนได้");
  const T = new Date(T0).toISOString();
  W.d1.raw.prepare("INSERT INTO bills(bill_no,bill_day,customer_name,total_satang,kind,status,src,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("PK0001", "2026-11-16", "ร้านใน v2", 9900, "เงินสด", "ค้างชำระ", "v2", T, T);
  // ฝ่ายบัญชีแก้ในชีท: ลูกหนี้ 0002 จ่ายแล้ว
  G.books.get(IDS.acct).getSheetByName("ลูกหนี้").data[1][4] = "จ่ายแล้ว";
  const r2 = await run("acct", 50);
  assert.ok(W.one("SELECT updated FROM sync_runs WHERE id=?", r2.run).updated >= 1, "รอบนี้ต้องอัปเดตบิลที่ชีทบัญชีแก้");
  assert.equal(b("เก่า-ลูกหนี้-0002").status, "ชำระแล้ว");
  assert.equal(b("PK0001").version, 1, "บิลที่ v2 ลงเองต้องไม่ถูกแตะ");
  for (const id of [IDS.acct, IDS.order, IDS.customer, IDS.stock]) assert.equal(G.books.get(id).writes, 0, id + " ถูกเขียน!");
});

test("นำเข้า: สิทธิ์ประธานเท่านั้น · กุญแจไม่ตรง/ไม่ได้ตั้ง = ข้อความไทยบอกสาเหตุ · audit ทุกหน้า", async () => {
  const { G, W, boss, run } = await setup();
  const office = G.call("pkV2Ticket", {}, { sid: "S001", pin: "1111" }).ticket;
  assert.equal((await W.call(office, "import.run", { source: "staff" })).status, 403);
  await run("staff");
  assert.ok(W.q("SELECT * FROM audit_log WHERE action='import.run' AND entity='sync_runs'").length >= 1);
  const { W: W2, boss: b2 } = await setup({ PK_SYNC_KEY: "กุญแจผิด" });
  const bad = await W2.call(b2, "import.run", { source: "staff" });
  assert.equal(bad.status, 502); assert.match(bad.error.message, /ลายเซ็น/);
  const { W: W3, boss: b3 } = await setup({ PK_GAS_URL: "" });
  const nc = await W3.call(b3, "import.run", { source: "staff" });
  assert.equal(nc.status, 503); assert.match(nc.error.message, /PK_GAS_URL/);
  const list = await W.call(boss, "import.sources");
  assert.equal(list.data.sources.find(s => s.source === "staff").last.status, "สำเร็จ");
});
