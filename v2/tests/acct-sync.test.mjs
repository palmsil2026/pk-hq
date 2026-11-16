// เทสต์ซิงก์ชีท "ระบบบัญชี" ครบสาย: gas/Code.gs จริง (ชีตจำลอง อ่านอย่างเดียว) → ลงชื่อ → นำเข้า D1
//   รันซ้ำไม่เบิ้ล · แตะเฉพาะแถวจากชีท · จับคู่บิลใบเดียวกับในแอป · บิลหายจากชีท = ยกเลิก (หายเยอะผิดปกติ = ไม่ยกเลิก ขึ้นธง)
//   · นาฬิกาปลุกวันละครั้ง (runAcctSync) · ปิดได้จากค่าตั้ง · ล้ม = บอก (ธง) ไม่เงียบ · ไม่มีการเขียนกลับชีทบัญชีเลย
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { world } from "./helpers/world.mjs";
import { runAcctSync } from "../server/actions/account-sync.mjs";
import { issueTicket } from "../server/ticket.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "gas", "Code.gs"), "utf8");
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);

async function setup(envOver) {
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  let down = false;
  const gasFetch = async url => {
    if (down) throw new Error("connect ETIMEDOUT");
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams.entries());
    G.setNow(W.clock.now);
    return new Response(JSON.stringify(G.call(p.action, p)), { headers: { "content-type": "application/json" } });
  };
  const W = world({ now: T0, fetch: gasFetch, env: Object.assign({ PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" }, envOver || {}) });
  // พนักงานในฐาน + ตั๋วที่ลงชื่อด้วยกุญแจของ GAS ตัวจริง (ลายนิ้วมือเดียวกับในฐาน)
  W.who = async (id, nick, roles) => { await W.staff(id, nick, roles); const pf = W.one("SELECT pin_fp FROM staff WHERE id=?", id).pin_fp;
    return issueTicket(G.ctx.v2Key_("ticket"), { k: "s", sid: id, n: nick, r: roles, pf, iat: W.clock.now, exp: W.clock.now + 30 * 864e5 }); };
  const acc = await W.who("S141", "ฝ้าย", ["account"]);
  const office = await W.who("S101", "แอน", ["office"]);
  const sync = async (who, limit) => {
    let cursor = "0", run = "", last, pages = 0;
    do {
      last = await W.call(who || acc, "account.sync", { cursor, run, limit: limit || 3 });
      assert.equal(last.status, 200, JSON.stringify(last.error));
      run = last.data.run; cursor = last.data.next; pages++;
    } while (cursor !== null && pages < 50);
    return { ...last.data, pages };
  };
  const sheet = name => G.books.get(IDS.acct).getSheetByName(name);
  return { G, W, acc, office, sync, sheet, setDown: v => { down = v; }, gasFetch };
}
const b = (W, no) => W.one("SELECT * FROM bills WHERE bill_no=?", no);

test("ซิงก์โดยฝ่ายบัญชี: หลายหน้า · รันซ้ำไม่เบิ้ล · เลขกระดาษ+แท็บต้นทาง · ลูกหนี้นับจากแท็บลูกหนี้ · ทีมอื่นซิงก์ไม่ได้ · ไม่เขียนกลับ", async () => {
  const { G, W, office, sync } = await setup();
  assert.equal((await W.call(office, "account.sync", {})).status, 403);
  const r1 = await sync();
  assert.equal(r1.status, "สำเร็จ"); assert.ok(r1.pages >= 3, "ต้องแบ่งหน้า (" + r1.pages + ")");
  const n1 = W.one("SELECT count(*) n FROM bills").n;
  assert.equal(n1, 6);
  assert.equal(b(W, "เก่า-บิลรายวัน 2025-0002").paper_no, "0002"); assert.equal(b(W, "เก่า-บิลรายวัน 2025-0002").acct_kind, "รายวัน");
  assert.equal(b(W, "เก่า-ลูกหนี้-0002").acct_kind, "ลูกหนี้");
  const r2 = await sync();
  assert.equal(r2.status, "สำเร็จ");
  assert.equal(W.one("SELECT count(*) n FROM bills").n, n1, "รันซ้ำไม่เบิ้ล");
  assert.equal(W.one("SELECT sum(updated) u FROM sync_runs WHERE id=?", r2.run).u, 0, "ชีทไม่เปลี่ยน = ไม่เขียนบิล");
  const o = (await W.call((await W.who("S199", "หัวหน้า", ["exec"])), "account.owing")).data;
  assert.equal(o.total.satang, 340000, "ลูกหนี้ = ยอดค้างในแท็บลูกหนี้ (0002) — บิลเครดิตในแท็บรายวันไม่นับซ้ำ");
  assert.equal(o.sheetDailyCredit.n, 1);
  assert.equal(G.books.get(IDS.acct).writes, 0, "ชีทบัญชีถูกเขียน!");
  assert.ok(W.q("SELECT * FROM audit_log WHERE action='account.sync'").length >= r1.pages);
});

test("ชีทเปลี่ยน → ตาม · บิลที่แอปออกเองไม่แตะ · บิลหายจากชีท = ยกเลิก + ธง · ใส่กลับในชีท = กลับมา", async () => {
  const { G, W, sync, sheet } = await setup();
  await sync();
  const T = new Date(T0).toISOString();
  W.d1.raw.prepare("INSERT INTO bills(bill_no,bill_day,customer_name,total_satang,kind,status,src,paper_no,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("PK0001", "2026-11-16", "ร้านใน v2", 9900, "เงินสด", "ค้างชำระ", "v2", "", T, T);
  sheet("ลูกหนี้").data[1][4] = "จ่ายแล้ว";
  const removed = sheet("บิลรายวัน 2025").data.splice(6, 1)[0];   // ฝ่ายบัญชีลบแถว 0004 ออกจากชีท
  W.tick(3600000);
  const r = await sync();
  assert.equal(b(W, "เก่า-ลูกหนี้-0002").status, "ชำระแล้ว");
  assert.equal(b(W, "PK0001").version, 1, "บิลที่ v2 ลงเองต้องไม่ถูกแตะ");
  const gone = b(W, "เก่า-บิลรายวัน 2025-0004");
  assert.equal(gone.status, "ยกเลิก"); assert.match(gone.cancel_reason, /ไม่พบในชีทบัญชี/);
  assert.equal(W.q("SELECT * FROM flags WHERE kind='บิลหายจากชีทบัญชี' AND status='เปิด'").length, 1);
  assert.ok(W.one("SELECT updated FROM sync_runs WHERE id=?", r.run).updated >= 2);
  sheet("บิลรายวัน 2025").data.splice(6, 0, removed);
  W.tick(3600000);
  await sync();
  assert.equal(b(W, "เก่า-บิลรายวัน 2025-0004").status, "ชำระแล้ว", "ใส่กลับในชีท = กลับมาตามชีท");
  assert.equal(b(W, "เก่า-บิลรายวัน 2025-0004").cancel_reason, "");
  assert.equal(G.books.get(IDS.acct).writes, 0);
});

test("บิลหายเยอะผิดปกติ (เช่นเปลี่ยนชื่อแท็บ) = ไม่ยกเลิกให้ · ขึ้นธงด่วน", async () => {
  const { W, sync, sheet, G } = await setup();
  for (let i = 10; i < 22; i++) sheet("บิลรายวัน 2025").data.push(["2025-03-05", "00" + i, "ร้านตัวอย่าง " + i, "100", "", "เงินสด", ""]);
  await sync(null, 50);
  assert.equal(W.one("SELECT count(*) n FROM bills").n, 18);
  sheet("บิลรายวัน 2025").name = "บิลรายวัน 2025 (ใหม่)";   // เปลี่ยนชื่อแท็บ = เลขบิลในระบบเปลี่ยนทั้งแท็บ
  W.tick(3600000);
  await sync(null, 50);
  assert.equal(W.one("SELECT count(*) n FROM bills WHERE status='ยกเลิก'").n, 0, "ห้ามยกเลิกเป็นกอง");
  const f = W.one("SELECT * FROM flags WHERE kind='นำเข้ามีปัญหา' AND status='เปิด'");
  assert.ok(f); assert.equal(f.severity, "ด่วน"); assert.match(f.title, /มากผิดปกติ/);
  assert.equal(G.books.get(IDS.acct).writes, 0);
});

test("บิลใบเดียวกันในแอปกับในชีท: ซิงก์จับคู่เอง (เลขกระดาษ+วันใกล้กัน) → นับครั้งเดียว · ยอดต่าง = ธงครั้งเดียว", async () => {
  const { W, sync, sheet } = await setup();
  const T = new Date(T0).toISOString();
  const ins = (no, paper, day, satang) => W.d1.raw.prepare("INSERT INTO bills(bill_no,bill_day,customer_name,total_satang,kind,status,src,paper_no,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(no, day, "ร้านตัวอย่าง ข", satang, "เครดิต", "ค้างชำระ", "v2", paper, T, T);
  ins("APP-2", "0002", "2025-03-03", 340000);   // ใบเดียวกับ 0002 ในชีท (ห่าง 1 วัน)
  ins("APP-1", "0001", "2025-03-02", 99900);    // เลข 0001 ในชีท = 1,250.50 → ยอดต่าง
  await sync();
  assert.equal(b(W, "เก่า-บิลรายวัน 2025-0002").same_as, "APP-2"); assert.equal(b(W, "เก่า-ลูกหนี้-0002").same_as, "APP-2");
  assert.equal(b(W, "เก่า-บิลรายวัน 2025-0001").same_as, "APP-1");
  const boss = await W.who("S199", "หัวหน้า", ["exec"]);
  const o = (await W.call(boss, "account.owing")).data;
  assert.equal(o.total.satang, 340000 + 99900, "ใบเดียวกันนับครั้งเดียว (นับบิลในแอป)");
  assert.equal(W.q("SELECT * FROM flags WHERE kind='ชีทบัญชีไม่ตรงแอป'").length, 1);
  W.tick(3600000); await sync();
  assert.equal(W.q("SELECT * FROM flags WHERE kind='ชีทบัญชีไม่ตรงแอป'").length, 1, "ไม่ทวงซ้ำทุกรอบ");
  // ชีทบอกจ่ายแล้ว แต่ในแอปยังค้าง → ขึ้นเป็นงานรอตรวจของบัญชี
  sheet("ลูกหนี้").data[1][4] = "จ่ายแล้ว"; sheet("ลูกหนี้").data[1][5] = "โอน KTB";
  W.tick(3600000); await sync();
  const h = (await W.call(boss, "home.account")).data;
  assert.deepEqual(h.sheetPaid.map(x => [x.bill_no, x.sheet_channel]), [["APP-1", "เงินสด"], ["APP-2", "โอน KTB"]], "ชีทบอกจ่ายแล้ว (บิลเงินสด 0001 + ลูกหนี้ 0002) แต่ในแอปยังค้าง");
});

test("นาฬิกาปลุกวันละครั้ง: ซิงก์ครบทุกหน้าเอง · audit ในนามระบบ · ปิดได้จากค่าตั้ง · Google ล่ม = รอบล้มเหลว + ธง (ไม่เงียบ)", async () => {
  const { G, W, setDown, gasFetch } = await setup();
  const r = await runAcctSync(W.env, { now: () => W.clock.now, fetch: gasFetch, limit: 2 });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.pages >= 3); assert.equal(r.status, "สำเร็จ");
  assert.equal(W.one("SELECT count(*) n FROM bills").n, 6);
  assert.ok(W.q("SELECT * FROM audit_log WHERE action='acct.sync.cron' AND staff_id='system'").length >= r.pages);
  W.tick(864e5);
  const r2 = await runAcctSync(W.env, { now: () => W.clock.now, fetch: gasFetch });
  assert.equal(r2.ok, true); assert.equal(W.one("SELECT count(*) n FROM bills").n, 6, "รันซ้ำไม่เบิ้ล");
  W.d1.raw.prepare("UPDATE settings SET value='0' WHERE key='ACCT_SYNC_AUTO'").run();
  assert.equal((await runAcctSync(W.env, { now: () => W.clock.now, fetch: gasFetch })).skipped, true);
  W.d1.raw.prepare("UPDATE settings SET value='1' WHERE key='ACCT_SYNC_AUTO'").run();
  setDown(true);
  const bad = await runAcctSync(W.env, { now: () => W.clock.now, fetch: gasFetch });
  assert.equal(bad.ok, false); assert.match(bad.error, /Google/);
  const f = W.one("SELECT * FROM flags WHERE kind='นำเข้ามีปัญหา' AND status='เปิด'");
  assert.ok(f); assert.match(f.title, /ซิงก์ชีทบัญชีอัตโนมัติไม่สำเร็จ/);
  assert.equal(G.books.get(IDS.acct).writes, 0);
});

test("ซิงก์ผ่านหน้าประธาน (import.run acct ของ Foundation) ใช้ตัวนำเข้าตัวเดียวกัน — ผลเหมือนกัน", async () => {
  const { G, W } = await setup();
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  let cursor = "0", run = "", last;
  do { last = (await W.call(boss, "import.run", { source: "acct", cursor, run, limit: 50 })).data; run = last.run; cursor = last.next; } while (cursor !== null);
  assert.equal(last.status, "สำเร็จ");
  assert.equal(b(W, "เก่า-ลูกหนี้-0002").acct_kind, "ลูกหนี้"); assert.equal(b(W, "เก่า-ลูกหนี้-0002").paper_no, "0002");
  assert.equal(W.one("SELECT count(*) n FROM acct_seen").n, 6);
});

test("Worker นาฬิกาปลุก (v2/cron/acct-sync.mjs): โหลดได้ · scheduled เรียกซิงก์จริงผ่าน waitUntil · เปิดลิงก์ตรง ๆ ไม่มีข้อมูล", async () => {
  const { W, gasFetch } = await setup();
  const mod = (await import("../cron/acct-sync.mjs")).default;
  W.clock.now = Date.now();   // Worker ใช้นาฬิกาจริง — ให้ GAS จำลองเวลาตรงกัน (ลายเซ็นคำขออายุ 5 นาที)
  const real = globalThis.fetch;
  globalThis.fetch = gasFetch;
  try {
    const waits = [];
    await mod.scheduled({ cron: "0 13 * * *" }, W.env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
  } finally { globalThis.fetch = real; }
  assert.equal(W.one("SELECT count(*) n FROM bills").n, 6);
  const res = await mod.fetch(new Request("https://pk-v2-cron.test/"));
  const j = await res.json();
  assert.equal(j.ok, true); assert.ok(!JSON.stringify(j).includes("satang"));
});
