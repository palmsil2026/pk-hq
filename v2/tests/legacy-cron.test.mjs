// เทสต์นาฬิกาปลุกนำเข้ารอบผลิตจากแอปเดิมวันละ 2 รอบ (ครบสาย: gas/Code.gs จริง → ลงชื่อ → D1) — ไม่ต้องมีกุญแจ Cloudflare
//   รันซ้ำไม่เบิ้ล · ปิดได้จากค่าตั้ง · ล้ม = ธงด่วนให้ประธานเห็น (วันละเรื่องเดียว) · Worker แยกงานตามเวลาปลุก
//   + ยืนยันว่า "ไม่มีตัวนำเข้าตัวไหนดึงยอดสต๊อก/StockMovement ของแอปเดิม" (ยอดเดิมพัง — สต๊อกเริ่มจากยอดยกมา/นับปรับเท่านั้น)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { world } from "./helpers/world.mjs";
import { runLegacyRunsSync, LEGACY_RUNS_SOURCE } from "../server/actions/legacy-cron.mjs";
import worker, { runCron, CRONS } from "../cron/worker.mjs";
import { SOURCES } from "../server/import/importers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 18, 23, 30, 0);   // 19 พ.ย. 2569 06:30 ไทย (รอบเช้า)
const H = 3600000;

// แท็บ StockMovement ของแอปเดิม (ข้อมูลสมมติรูปแบบเดียวกับของจริง) — ยอดในนี้ "พัง" ห้ามเข้าระบบใหม่
const STOCK_MOVEMENT = [
  ["ID", "วันที่", "เวลา", "ประเภท", "สินค้า", "ขนาด", "จำนวน (ใบ)", "OrderKey", "หมายเหตุ"],
  ["m1", "10/11/2569", "8:10:00", "นำออก (สกรีน)", "ขวด", "600 ml", "4000", "K1", ""],
  ["m2", "11/11/2569", "8:12:00", "นำออก (สกรีน)", "ขวด", "600 ml", "4000", "K1", "กดซ้ำวันที่สอง"],
  ["m3", "12/11/2569", "9:00:00", "รับเข้า (ผลิต)", "ขวด", "250 ml", "50000", "", ""],
];

async function setup(opt) {
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  G.books.get(IDS.stock).addSheet("StockMovement", STOCK_MOVEMENT.map(r => r.slice()));
  let down = false;
  const gasFetch = async url => {
    if (down) throw new Error("connect ETIMEDOUT");
    const p = Object.fromEntries(new URL(url).searchParams.entries());
    G.setNow(W.clock.now);
    return new Response(JSON.stringify(G.call(p.action, p)), { headers: { "content-type": "application/json" } });
  };
  const W = world({ now: T0, fetch: gasFetch, env: Object.assign({ PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" }, (opt && opt.env) || {}) });
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  if (!(opt && opt.noRef)) for (const s of ["ref:products", "ref:machines"]) assert.equal((await W.call(boss, "import.run", { source: s })).ok, true);   // ทะเบียนเครื่องต้องมีก่อน (ตัวนำเข้ารอบบอกเองถ้ายังไม่มี)
  const cron = (more) => runLegacyRunsSync(W.env, Object.assign({ fetch: gasFetch, now: () => W.clock.now, limit: 2 }, more || {}));
  return { G, W, boss, cron, gasFetch, setDown: v => { down = v; } };
}
const runs = W => W.one("SELECT count(*) n FROM machine_runs WHERE src LIKE 'legacy%'").n;
const stockRows = W => W.one("SELECT count(*) n FROM stock_moves").n;

test("นาฬิกาปลุก: นำเข้าครบทุกหน้า · รันซ้ำไม่เบิ้ล · แอปเดิมปิดรอบทีหลัง = ตาม · ไม่แตะสต๊อก · ไม่เขียนกลับชีต · audit เป็นระบบ", async () => {
  const { G, W, cron } = await setup();
  const r1 = await cron();
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.ok(r1.pages >= 2, "ต้องแบ่งหน้า");
  assert.equal(r1.inserted, 3); assert.equal(runs(W), 3);
  const sr = W.one("SELECT * FROM sync_runs WHERE id = ?", r1.run);
  assert.deepEqual([sr.source, sr.status, sr.by], [LEGACY_RUNS_SOURCE, "สำเร็จ", "system"]);
  assert.ok(W.q("SELECT * FROM audit_log WHERE action = 'import.cron' AND staff_id = 'system'").length >= r1.pages);
  W.tick(12 * H);
  const r2 = await cron();
  assert.equal(r2.ok, true); assert.equal(r2.inserted, 0); assert.equal(runs(W), 3, "รันซ้ำไม่เบิ้ล");
  // แอปเดิมปิดรอบที่ค้าง (r003) → รอบถัดไปตาม
  const pl = G.books.get(IDS.stock).getSheetByName("ProductionLog").data;
  const row = pl.find(r => r[0] === "r003");
  row[3] = "17:00"; row[4] = "ปิดงาน"; row[12] = "70000";
  W.tick(12 * H);
  const r3 = await cron();
  assert.equal(r3.updated, 1);
  assert.equal(W.one("SELECT status, good_pcs FROM machine_runs WHERE src LIKE 'legacy%' AND good_pcs = 70000").status, "ปิดแล้ว");
  assert.equal(stockRows(W), 0, "รอบเก่าเป็นประวัติ ไม่แตะสต๊อก");
  assert.equal(G.books.get(IDS.stock).writes, 0, "ชีต Stock Management ถูกเขียน!");
  // ประธานเห็นรอบล่าสุดในหน้า นำเข้า (แหล่งเดียวกับปุ่ม)
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  const src = (await W.call(boss, "import.sources", {})).data.sources.find(s => s.source === LEGACY_RUNS_SOURCE);
  assert.equal(src.last.id, r3.run);
});

test("นาฬิกาปลุก: ปิดจากค่าตั้งได้ (ไม่ต้อง deploy) · GAS ล่ม = ธงด่วนวันละเรื่อง + รอบล้มเหลว · หัวคอลัมน์ไม่ครบ = ธง ไม่เดา · กดเองยังได้", async () => {
  const { G, W, cron, setDown, boss } = await setup();
  W.d1.raw.prepare("UPDATE settings SET value = '0' WHERE key = 'LEGACY_RUNS_AUTO'").run();
  const off = await cron();
  assert.equal(off.skipped, true); assert.equal(runs(W), 0);
  assert.equal((await cron({ force: true })).ok, true, "สั่งเองข้ามค่าตั้งได้ (เครื่องมือในเครื่อง)");
  W.d1.raw.prepare("UPDATE settings SET value = '1' WHERE key = 'LEGACY_RUNS_AUTO'").run();
  setDown(true);
  const f1 = await cron(), f2 = await cron();
  assert.equal(f1.ok, false); assert.match(f1.error, /ติดต่อ Google/);
  assert.equal(f2.ok, false);
  const flags = W.q("SELECT * FROM flags WHERE status = 'เปิด' AND kind = 'นำเข้ามีปัญหา'");
  assert.equal(flags.length, 1, "ล้มซ้ำวันเดียวกัน = ธงเดียว");
  assert.equal(flags[0].severity, "ด่วน");
  const seen = (await W.call(boss, "flag.list", {})).data.items.map(x => x.title);
  assert.ok(seen.includes("นำเข้ารอบผลิตจากแอปเดิมอัตโนมัติไม่สำเร็จ"), "ประธานเห็นธง");
  setDown(false);
  G.books.get(IDS.stock).getSheetByName("ProductionLog").data[0] = ["รหัส", "อะไรสักอย่าง"];
  W.tick(24 * H);
  const bad = await cron();
  assert.equal(bad.ok, false);
  assert.equal(W.q("SELECT * FROM sync_runs WHERE source = ? AND status = 'ล้มเหลว'", LEGACY_RUNS_SOURCE).length >= 1, true);
  assert.equal(W.q("SELECT * FROM flags WHERE status = 'เปิด' AND kind = 'นำเข้ามีปัญหา'").length, 2, "วันใหม่ = ธงใหม่");
});

test("Worker: แยกงานตามเวลาปลุก (บัญชี 20:00 · รอบผลิต 06:30/18:30) · เวลาไม่รู้จัก = ไม่ทำ · scheduled() ใช้ fetch ของ Worker", async () => {
  const { W, gasFetch } = await setup();
  assert.deepEqual(Object.entries(CRONS).sort(), [["0 13 * * *", "acct"], ["30 11 * * *", "legacy-runs"], ["30 23 * * *", "legacy-runs"]]);
  const sh = fs.readFileSync(path.join(HERE, "..", "tools", "deploy-cron.sh"), "utf8");
  for (const c of Object.keys(CRONS)) assert.ok(sh.includes('"' + c + '"'), "deploy-cron.sh ต้องตั้งเวลา " + c);
  assert.match(sh, /main = "worker\.mjs"/);
  assert.equal((await runCron("0 0 * * *", W.env)).skipped, true);
  const real = globalThis.fetch;
  globalThis.fetch = gasFetch;
  W.clock.now = Date.now();   // Worker ใช้นาฬิกาจริง — ให้ GAS จำลองเห็นเวลาเดียวกัน (คำขอลงชื่ออายุ 5 นาที)
  try {
    let p;
    await worker.scheduled({ cron: "30 11 * * *" }, W.env, { waitUntil: x => { p = x; } });
    await p;
  } finally { globalThis.fetch = real; }
  assert.equal(runs(W), 3, "Worker นำเข้ารอบผลิตตามเวลา 18:30");
  const a = await runCron("0 13 * * *", W.env, { fetch: gasFetch, now: () => W.clock.now });
  assert.equal(a.job, "acct"); assert.equal(a.result.ok, true);
});

test("ไม่มีตัวนำเข้าตัวไหนดึงยอดสต๊อก/StockMovement ของแอปเดิม — สต๊อกเริ่มจากยอดยกมา/นับปรับเท่านั้น", async () => {
  // ① รายชื่อแหล่ง: แท็บของชีต Stock Management ที่นำเข้าได้มีแค่ ProductionLog (ประวัติรอบเครื่อง)
  const stockSources = Object.keys(SOURCES).filter(k => /stock/i.test(k));
  assert.deepEqual(stockSources, [LEGACY_RUNS_SOURCE]);
  assert.ok(!Object.keys(SOURCES).some(k => /StockMovement|Stock(?!\s*Management)|balance|ยอดคงเหลือ|คลัง/i.test(k.replace(LEGACY_RUNS_SOURCE, ""))));
  // ② ขอแหล่งนอกรายชื่อ (เช่น StockMovement) = ปฏิเสธ แม้สะพาน GAS จะส่งแท็บนั้นได้
  const { G, W, boss, cron } = await setup();
  const r = await W.call(boss, "import.run", { source: "legacy:stock:StockMovement" });
  assert.equal(r.status, 400); assert.match(r.error.message, /ไม่รู้จักแหล่งข้อมูล/);
  // ③ นำเข้าทุกแหล่งจริงครบสาย (+ นาฬิกาปลุก) แล้ว สมุดสต๊อกต้องว่าง — ทั้งที่ชีตเดิมมีแท็บ StockMovement ที่มีตัวเลข
  for (const source of Object.keys(SOURCES)) {
    let cursor = "0", run = "", last, pages = 0;
    do {
      last = await W.call(boss, "import.run", { source, cursor, run, limit: 50 });
      assert.equal(last.status, 200, source + ": " + JSON.stringify(last.error));
      run = last.data.run; cursor = last.data.next; pages++;
    } while (cursor !== null && pages < 40);
  }
  assert.equal((await cron()).ok, true);
  assert.equal(stockRows(W), 0, "มีตัวนำเข้าที่ลงสมุดสต๊อก!");
  assert.equal(W.one("SELECT count(*) n FROM stock_balance WHERE qty_pcs <> 0").n, 0);
  assert.ok(W.one("SELECT count(*) n FROM machine_runs").n > 0 && W.one("SELECT count(*) n FROM orders").n > 0, "นำเข้าจริง (ไม่ใช่ว่างเพราะไม่ได้รัน)");
  for (const id of [IDS.stock, IDS.order, IDS.customer, IDS.acct]) assert.equal(G.books.get(id).writes, 0);
  // ④ โค้ดตัวนำเข้าทุกไฟล์: ไม่มีคำสั่งลงสมุดสต๊อก (op move / INSERT stock_moves) และไม่ขอแท็บ StockMovement
  const files = [...fs.readdirSync(path.join(HERE, "..", "server", "import")).map(f => path.join("server", "import", f)), "server/actions/prodLegacy.mjs", "server/actions/legacy-cron.mjs", "server/import/acct.mjs"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(HERE, "..", f), "utf8");
    assert.ok(!/op:\s*"move"/.test(src), f + " มี op move (ลงสมุดสต๊อก)");
    assert.ok(!/INSERT\s+INTO\s+stock_moves/i.test(src), f + " เขียน stock_moves ตรง");
    assert.ok(!/StockMovement/.test(src.replace(/\/\/.*$/gm, "")), f + " อ้างแท็บ StockMovement");
  }
});
