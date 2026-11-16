// ซิงก์ออเดอร์จากแอปเดิม (ชีต Order ของ AppSheet — ยังมีคนลงทุกวัน) ทางเดียว เป็นรอบ ๆ:
//   ดึงเฉพาะที่ใหม่/เปลี่ยน · ไม่เบิ้ล · ติดที่มา · แถวเดิมถูกแก้ = ตามทั้งใบ · แก้ในแอปใหม่แล้ว = ไม่ทับ · เริ่มกลางชีตได้
//   ไม่สร้างงานผลิต/สกรีน · ไม่แตะสต๊อก · ไม่เขียนกลับชีตเดิม (ชีตจำลองตั้งเป็นอ่านอย่างเดียว — เขียน = เทสต์ล้ม)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS, ORDER_HEAD } from "./fixtures/sheets.mjs";
import { world, KEYS } from "./helpers/world.mjs";
import { issueTicket, pinPrint } from "../server/ticket.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);
const col = n => ORDER_HEAD.indexOf(n);

async function setup() {
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  const gasFetch = async url => { const p = Object.fromEntries(new URL(url).searchParams.entries()); return new Response(JSON.stringify(G.call(p.action, p)), { headers: { "content-type": "application/json" } }); };
  const W = world({ now: T0, fetch: gasFetch, env: { PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" } });
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  const run = async (source, from) => {
    let cursor = String(from || 0), runId = "", last, pages = 0;
    const agg = { inserted: 0, updated: 0, skipped: 0, problems: [] };
    do {
      last = await W.call(boss, "import.run", { source, cursor, run: runId, limit: 2 });
      assert.equal(last.status, 200, JSON.stringify(last.error));
      runId = last.data.run; cursor = last.data.next; pages++;
      for (const k of ["inserted", "updated", "skipped"]) agg[k] += last.data.page[k];
      agg.problems.push(...last.data.problems);
    } while (cursor !== null && pages < 50);
    return { ...agg, total: last.data.total, pages };
  };
  const sheet = G.books.get(IDS.order).getSheetByName("Order");
  const tick = ms => { W.tick(ms); G.setNow(W.clock.now); };
  return { G, W, boss, run, sheet, tick };
}

test("ซิงก์ออเดอร์เก่าเป็นรอบ ๆ: แถวใหม่เข้า · แถวที่แก้ตามทั้งใบ · ไม่เปลี่ยน = ไม่เขียน · ไม่สร้างงานผลิต/ไม่แตะสต๊อก", async () => {
  const { G, W, run, sheet, tick } = await setup();
  await run("legacy:customer");
  const r1 = await run("legacy:order");
  assert.equal(r1.inserted, 4);
  const auditN = () => W.one("SELECT count(*) n FROM audit_log WHERE entity IN ('orders','order_items')").n;
  const a0 = auditN();
  const r2 = await run("legacy:order");
  assert.equal(r2.inserted + r2.updated, 0); assert.equal(auditN(), a0, "รอบที่ไม่มีอะไรเปลี่ยน ไม่เขียนออเดอร์ซ้ำ");
  // แอปเดิม: มีคนลงแถวใหม่ + แก้แถวเดิม (จำนวน · วันส่ง · ยกเลิก · ชื่อลูกค้า)
  sheet.data.push(["z9y8", "16/11/2569", "เอ", "ร้านตัวอย่าง ข", "", "ขวด", "600 ml", "คอยาว", "MK", "ใส", "", "", "5", "", "", "", "", "20/11/2569", "", "", "ขายราคาโรงงาน", ""]);
  const row = sheet.data.find(x => x[0] === "c3d4");
  row[col("จำนวน (ถุง)")] = "30"; row[col("รวมทั้งหมด (ใบ)")] = ""; row[col("ส่งภายในวันที่")] = "5/8/2568";
  const can = sheet.data.find(x => x[0] === "g7h8");
  can[col("สถานะ")] = "ยกเลิก"; can[col("ลูกค้า")] = "ร้านตัวอย่าง ก (เมือง)";
  tick(3600000);
  const r3 = await run("legacy:order");
  assert.equal(r3.inserted, 1); assert.equal(r3.updated, 2);
  const nw = W.one("SELECT * FROM orders WHERE id = 'เก่า-z9y8'");
  assert.equal(nw.src, "legacy:order"); assert.equal(nw.order_day, "2026-11-16"); assert.equal(nw.status, "ส่งแล้ว");
  assert.equal(W.one("SELECT qty_pcs FROM order_items WHERE id = 'เก่า-z9y8-1'").qty_pcs, 1000);
  const c = W.one("SELECT * FROM orders WHERE id = 'เก่า-c3d4'");
  assert.equal(c.due_day, "2025-08-05");
  const ci = W.one("SELECT * FROM order_items WHERE id = 'เก่า-c3d4-1'");
  assert.equal(ci.bags, 30); assert.equal(ci.qty_pcs, 30 * 252 + 10);
  const g = W.one("SELECT o.status, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = 'เก่า-g7h8'");
  assert.equal(g.status, "ยกเลิก"); assert.equal(g.name, "ร้านตัวอย่าง ก (เมือง)", "เปลี่ยนชื่อลูกค้าในแอปเดิม = จับคู่ใหม่");
  assert.equal(W.one("SELECT count(*) n FROM production_jobs").n, 0);
  assert.equal(W.one("SELECT count(*) n FROM screen_jobs").n, 0);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves").n, 0);
  assert.equal(G.books.get(IDS.order).writes, 0, "ไม่เขียนกลับชีตแอปเดิม");
});

test("ซิงก์ออเดอร์เก่า: ออเดอร์ที่ออฟฟิศแก้ในแอปใหม่แล้ว = ไม่ทับ + บอกครั้งเดียว · เริ่มอ่านกลางชีตได้ (รอบเร็วรายวัน)", async () => {
  const { G, W, run, sheet, tick } = await setup();
  await run("legacy:customer");
  await run("legacy:order");
  await W.staff("S7", "แอน", ["office"]);
  const off = await issueTicket(G.ctx.v2Key_("ticket"), { k: "s", sid: "S7", n: "แอน", r: ["office"], pf: await pinPrint(KEYS.pin, "S7", "1234"), iat: W.clock.now, exp: W.clock.now + 864e5 });
  tick(60000);
  const o = W.one("SELECT * FROM orders WHERE id = 'เก่า-a1b2'");
  const it = W.one("SELECT * FROM order_items WHERE order_id = 'เก่า-a1b2'");
  const ed = await W.call(off, "office.order_update", { id: o.id, version: o.version, customer_id: o.customer_id, brand: o.brand, due_day: "", urgent: o.urgent, purchase_type: o.purchase_type,
    pay_status: o.pay_status, note: "ออฟฟิศตรวจแล้ว", items: [{ id: it.id, type: it.type, size: it.size, neck: it.neck, shape: it.shape, color: it.color, screen_color: it.screen_color, bags: it.bags }] });
  assert.equal(ed.status, 200, JSON.stringify(ed.error));
  sheet.data.find(x => x[0] === "a1b2")[col("หมายเหตุ")] = "แก้ในแอปเดิม";
  tick(60000);
  const r = await run("legacy:order");
  assert.equal(r.updated, 0);
  assert.ok(r.problems.some(p => /a1b2.*มีคนแก้ในแอปใหม่แล้ว — ไม่ทับ/.test(p)), r.problems.join("\n"));
  assert.equal(W.one("SELECT note FROM orders WHERE id = 'เก่า-a1b2'").note, "ออฟฟิศตรวจแล้ว");
  const again = await run("legacy:order");
  assert.deepEqual(again.problems.filter(p => /a1b2/.test(p)), [], "บอกครั้งเดียวต่อการแก้ในแอปเดิม");
  // รอบเร็ว: อ่านเฉพาะหางชีต (แถวที่ 3 เป็นต้นไป)
  sheet.data.push(["n1", "16/11/2569", "เอ", "ร้านตัวอย่าง ข", "", "ถัง", "18.9 ลิตร", "", "", "ใส", "", "", "2", "", "", "", "", "", "", "", "", ""]);
  const tail = await run("legacy:order", 3);
  assert.equal(tail.inserted, 1); assert.equal(tail.pages, 1);
  assert.equal(W.one("SELECT qty_pcs FROM order_items WHERE id = 'เก่า-n1-1'").qty_pcs, 10);
  assert.equal(W.one("SELECT count(*) n FROM orders").n, 5, "ไม่เบิ้ล");
  assert.equal(G.books.get(IDS.order).writes, 0, "ไม่เขียนกลับชีตแอปเดิม");
});
