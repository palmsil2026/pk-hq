// ============================================================
//  เทสต์หน้าจอทีมผลิต (Playwright + หลังบ้านจริง + สะพาน PIN จริง · ข้อมูลสมมติ) — รันผ่าน tests/ui/run.mjs
//  แผนผัง (โรง 1/โรง 2/ทั้งหมด) · แผ่นเครื่อง · เปิดรอบ (สเปกด้วยชิป · หลายคน) · เปิดซ้ำ = บอกในจอเดียว + ปุ่มพาไปปิด
//  ปิดรอบด้วยแป้นตัวเลขของแอป · จอดเครื่อง+สาเหตุ → เดินต่อ · ปิดรอบค้างย้อนหลัง · งานรอผลิต · สต๊อกรับเข้า · จอ 390 และ 1366
// ============================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startDev } from "../../tools/dev-server.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
let S, browser;
before(async () => { S = await startDev({ mem: true }); browser = await pw.chromium.launch(); });
after(async () => { await browser.close(); await S.close(); });

async function page(vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(S.url + "?app=prod");
  await p.locator(".person", { hasText: "บอส" }).first().click();
  await digits(p, "1234");
  await p.waitForSelector(".pf-tiles .pf-tile");
  return p;
}
const digits = async (p, s) => { for (const d of s) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d + "$") }).last().click(); };
/** ใครบันทึก + PIN (คนล่าสุดขึ้นแป้นให้เลย) */
async function pin(p, nick) {
  await p.waitForSelector(".sheet.on.modal .numpad, .sheet.on.modal .person");
  if (await p.locator(".sheet.on.modal .person").count()) await p.locator(".sheet.on.modal .person", { hasText: nick || "เก่ง" }).click();
  await p.waitForSelector(".sheet.on.modal .pin-dots");
  await digits(p, "1234");
}
const tile = (p, name) => p.locator(".pf-tile", { has: p.locator(".nm", { hasText: new RegExp("^" + name + "$") }) });
const noText = async p => { const t = await p.locator("body").innerText(); assert.ok(!/\bnull\b|undefined|NaN/.test(t), "มี null/undefined/NaN บนจอ"); };

test("ทีมผลิต: แผนผังจริง — เครื่องเดิน X/12 · สลับโรง 1/โรง 2/ทั้งหมด · ผังเลื่อน/ซูม · ถาดเครื่องที่ยังไม่ได้วาง · ไม่มีรหัสบนจอ", async () => {
  const p = await page();
  assert.equal(await p.locator("h1").innerText(), "แผนผังโรงงาน");
  assert.match(await p.locator(".pf-sum").innerText(), /\/ 12 เครื่องเดิน/);
  assert.ok(await p.locator("svg.pmap g.it[data-id='PET4']").count(), "โรง 1 ต้องมี PET 4");
  await p.locator(".pf-bar .chip", { hasText: "โรง 2" }).click();
  assert.ok(await p.locator("svg.pmap g.it[data-id='PET9']").count());
  assert.equal(await p.locator(".pf-tiles .pf-tile").first().locator(".nm").innerText(), "PET 6");
  await p.locator(".pf-bar .chip", { hasText: "ทั้งหมด" }).click();
  const w0 = await p.locator("svg.pmap").evaluate(e => e.getBoundingClientRect().width);
  await p.locator("button[aria-label='ขยายผัง']").click();
  const w1 = await p.locator("svg.pmap").evaluate(e => e.getBoundingClientRect().width);
  assert.ok(w1 > w0 * 1.3, "ซูมแล้วผังต้องใหญ่ขึ้น");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "หน้าไม่เลื่อนข้าง (ผังเลื่อนในกรอบ)");
  assert.match(await p.locator("main").innerText(), /ยังไม่ได้วางในผัง[\s\S]*SHE230G/);
  assert.equal(/RD|RH|L-demo/.test(await p.locator("main").innerText()), false, "ไม่โชว์รหัสระบบ");
  // แตะเครื่องในผัง (SVG) = แผ่นเดียวกับแตะการ์ด
  await p.locator("svg.pmap g.it[data-id='PET9']").click();
  await p.waitForSelector(".sheet.on .pf-sec");
  assert.match(await p.locator(".sheet.on h2").innerText(), /PET 9/);
  await noText(p);
  await p.keyboard.press("Escape");
  // ระบบลม = ข้อมูล ไม่มีปุ่มงาน
  await p.locator("svg.pmap g.it[data-id='AIR1']").click();
  await p.waitForSelector(".sheet.on .pf-missing");
  assert.equal(await p.locator(".sheet.on .btn.pri").count(), 0);
  assert.deepEqual(p.errors, []);
});

test("ทีมผลิต: เปิดรอบด้วยชิป (หลายคน) → ใครบันทึก + PIN → เครื่องเดิน · เปิดซ้ำ = บอกรอบที่เปิดอยู่ + ปุ่มพาไปปิด", async () => {
  const p = await page();
  await tile(p, "PET 5").click();
  await p.locator(".sheet.on .btn.pri", { hasText: "เปิดรอบ" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('เปิดรอบ · PET 5')");
  await p.waitForSelector(".sheet.on .pf-form .chip");
  const sheet = p.locator(".sheet.on").last();
  await sheet.locator(".chip", { hasText: "500 ml" }).first().click();
  await sheet.locator(".chip", { hasText: "ใส" }).first().click();
  await sheet.locator("[aria-label='ผู้ปฏิบัติงาน'] .chip", { hasText: "เก่ง" }).click();
  await sheet.locator("[aria-label='ผู้ปฏิบัติงาน'] .chip", { hasText: "นุ่น" }).click();
  assert.match(await sheet.locator(".pf-picked").innerText(), /500 ml[\s\S]*ใส[\s\S]*เก่ง , นุ่น/);
  await sheet.locator(".btn.pri", { hasText: "เปิดรอบ" }).click();
  await pin(p, "เก่ง");
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const run = S.d1.one("SELECT * FROM machine_runs WHERE machine_id = 'PET5' AND status = 'กำลังผลิต'");
  assert.equal(run.opened_by, "S112"); assert.equal(run.size, "500 ml"); assert.equal(run.color, "ใส");
  assert.deepEqual(S.d1.q("SELECT name_text FROM run_crew WHERE run_id = ? ORDER BY name_text", run.id).map(r => r.name_text).sort(), ["นุ่น", "เก่ง"].sort());
  await p.waitForSelector(".pf-tile.s-run .nm:text-is('PET 5')");
  // เปิดซ้ำจากจอเก่า: มีคนเปิด PET 10 ไปก่อน (จำลอง) → บอกในแผ่นเดียว + ปุ่มพาไปปิด
  await p.locator(".pf-bar .chip", { hasText: "โรง 2" }).click();
  await tile(p, "PET 10").click();
  await p.locator(".sheet.on .btn.pri", { hasText: "เปิดรอบ" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('เปิดรอบ · PET 10')");
  const at = new Date().toISOString();
  S.d1.raw.prepare("INSERT INTO machine_runs(id,machine_id,type,size,spec_key,started_at,started_day,status,created_at,updated_at) VALUES ('RX1','PET10','ขวด','800 ml','ขวด|800 ml|||',?,?,'กำลังผลิต',?,?)").run(at, at.slice(0, 10), at, at);
  const s2 = p.locator(".sheet.on").last();
  await s2.locator("[aria-label='ผู้ปฏิบัติงาน'] .chip", { hasText: "บอส" }).click();
  await s2.locator(".btn.pri", { hasText: "เปิดรอบ" }).click();
  await pin(p, "เก่ง");
  await p.waitForSelector(".sheet.on .pf-warn:has-text('มีรอบเปิดอยู่แล้ว')");
  await p.locator(".sheet.on .pf-warn button", { hasText: "ไปปิดรอบนั้น" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('ปิดรอบ')");
  await p.waitForSelector(".sheet.on .cnt");
  assert.deepEqual(p.errors.filter(e => !/status of 409/.test(e)), [], "409 ที่ตั้งใจให้ชนเท่านั้น");
});

test("ทีมผลิต: ปิดรอบด้วยแป้นตัวเลขของแอป (ดี/เกรด B/เสีย) → สต๊อก A/B แยก · ย้อนได้ · จอดเครื่อง+สาเหตุ → เดินต่อ", async () => {
  const p = await page();
  await tile(p, "PET 1").click();
  await p.locator(".sheet.on .btn.pri", { hasText: "ปิดรอบ" }).click();
  await p.waitForSelector(".sheet.on .cnt");
  const sh = p.locator(".sheet.on").last();
  await sh.locator(".btn.pri", { hasText: "ปิดรอบ" }).click();
  assert.match(await sh.locator("p.err").innerText(), /ใส่จำนวนดี/);
  await digits(p, "2000"); await sh.locator(".numpad button[aria-label='ไปช่องถัดไป']").click();
  await digits(p, "12"); await sh.locator(".numpad button[aria-label='ไปช่องถัดไป']").click();
  await digits(p, "30");
  assert.match(await sh.locator(".cnt-note").innerText(), /10 ถุง[\s\S]*รวม 2,042 ใบ/);
  await sh.locator(".btn.pri", { hasText: "ปิดรอบ" }).click();
  await pin(p, "เก่ง");
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const r = S.d1.one("SELECT * FROM machine_runs WHERE id = 'RDPET1'");
  assert.deepEqual([r.status, r.good_pcs, r.grade_b_pcs, r.waste_pcs, r.closed_by], ["ปิดแล้ว", 2000, 12, 30, "S112"]);
  assert.equal(S.d1.one("SELECT count(*) n FROM stock_moves WHERE ref_id = 'RDPET1'").n, 2);
  // ย้อน
  await p.locator(".snack button", { hasText: "ย้อน" }).click();
  await pin(p, "เก่ง");
  await p.waitForSelector(".snack .msg:has-text('ย้อนแล้ว')");
  assert.equal(S.d1.one("SELECT status FROM machine_runs WHERE id = 'RDPET1'").status, "กำลังผลิต");
  // จอดเครื่อง
  await p.reload(); await p.waitForSelector(".pf-tiles .pf-tile");
  await tile(p, "PET 2").click();
  await p.locator(".sheet.on .btn", { hasText: "จอดเครื่อง" }).click();
  await p.waitForSelector(".sheet.on.modal .chip");
  await p.locator(".sheet.on.modal .chip", { hasText: "ลม/ปั๊มลม" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "จอดเครื่อง" }).click();
  await pin(p, "เก่ง");
  await p.waitForSelector(".pf-tile.s-stop .nm:text-is('PET 2')");
  assert.match(await tile(p, "PET 2").innerText(), /ลม\/ปั๊มลม/);
  await tile(p, "PET 2").click();
  await p.locator(".sheet.on .btn.pri", { hasText: "เดินเครื่องต่อ" }).click();
  await pin(p, "เก่ง");
  await p.waitForSelector(".pf-tile.s-run .nm:text-is('PET 2')");
  assert.deepEqual(p.errors, []);
});

test("ทีมผลิต: รอบค้าง → ปิดย้อนหลัง (วัน + เวลาจริง + เหตุผล) · ประวัติวันนี้ · งานรอผลิต (ค้าง+สาเหตุ) · สต๊อกรับพรีฟอร์ม", async () => {
  const p = await page();
  await p.locator("nav.nav a", { hasText: "ประวัติ" }).click();
  await p.waitForSelector(".pf-warn:has-text('รอบค้างที่ต้องปิด')");
  await p.locator(".pf-warn .row", { hasText: "LG17-228" }).locator("button", { hasText: "ปิดย้อนหลัง" }).click();
  await p.waitForSelector(".sheet.on .cnt");
  const sh = p.locator(".sheet.on").last();
  await digits(p, "40000");
  await sh.locator(".btn", { hasText: "แตะเพื่อใส่เวลาปิดจริง" }).click();
  await p.waitForSelector(".sheet.on.modal .numdisp");
  await digits(p, "1830");
  await p.locator(".sheet.on.modal .numpad .ok").click();
  await sh.locator(".chip", { hasText: "ลืมกดปิด" }).click();
  await sh.locator(".btn.pri", { hasText: "ปิดรอบ" }).click();
  await pin(p, "นุ่น");
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const r = S.d1.one("SELECT * FROM machine_runs WHERE id = 'L-demo1'");
  assert.deepEqual([r.status, r.late_close, r.good_pcs, r.stocked], ["ปิดแล้ว", 1, 40000, 0]);
  assert.ok(S.d1.one("SELECT count(*) n FROM flags WHERE dedupe_key = 'late:L-demo1'").n === 1);
  // งานรอผลิต
  await p.locator("nav.nav a", { hasText: "งานรอผลิต" }).click();
  await p.waitForSelector(".main button.card");
  await p.locator(".main button.card").first().click();
  await p.locator(".sheet.on .btn", { hasText: "ค้าง + สาเหตุ" }).click();
  await p.waitForSelector(".sheet.on.modal .chip");
  await p.locator(".sheet.on.modal .chip", { hasText: "วัตถุดิบหมด" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "แจ้งค้าง" }).click();
  await pin(p, "นุ่น");
  await p.waitForSelector(".main .pill:has-text('ค้าง: วัตถุดิบหมด')");
  // สต๊อก: รับพรีฟอร์มเข้า
  await p.locator("nav.nav a", { hasText: "สต๊อก" }).click();
  await p.waitForSelector(".main button.card");
  const before = (S.d1.one("SELECT qty_pcs FROM stock_balance WHERE item_key = 'spec:พรีฟอร์ม|9 กรัม|||น้ำเงิน'") || { qty_pcs: 0 }).qty_pcs;
  await p.locator(".main .btn.pri", { hasText: "รับเข้า" }).click();
  await p.waitForSelector(".sheet.on .pf-form .chip");
  const rs = p.locator(".sheet.on").last();
  await rs.locator(".chip", { hasText: "9 กรัม" }).click();
  await rs.locator(".chip", { hasText: "น้ำเงิน" }).first().click();
  await rs.locator(".btn", { hasText: "แตะเพื่อใส่จำนวน" }).click();
  await digits(p, "60000");
  await p.locator(".sheet.on.modal .numpad .ok").click();
  await rs.locator(".chip", { hasText: "ซื้อเข้า" }).click();
  await rs.locator(".btn.pri", { hasText: "รับเข้า" }).click();
  await pin(p, "นุ่น");
  const bal = () => (S.d1.one("SELECT qty_pcs FROM stock_balance WHERE item_key = 'spec:พรีฟอร์ม|9 กรัม|||น้ำเงิน'") || { qty_pcs: 0 }).qty_pcs;
  for (let i = 0; i < 50 && bal() === before; i++) await p.waitForTimeout(100);
  await p.waitForSelector(".main button.card:has-text('พรีฟอร์ม 9 กรัม น้ำเงิน')");
  assert.equal(S.d1.one("SELECT qty_pcs FROM stock_balance WHERE item_key = 'spec:พรีฟอร์ม|9 กรัม|||น้ำเงิน'").qty_pcs, before + 60000);
  await noText(p);
  assert.deepEqual(p.errors, []);
});

test("ทีมผลิต จอคอม 1366: ผังเต็มจอ + แผ่นเครื่องเป็นแผงขวา (ผังยังเห็น) · ไทม์ไลน์ + ยอด วัน/เดือน/ทั้งหมด · ข้อมูลเครื่อง", async () => {
  const p = await page({ width: 1366, height: 768 });
  const map = await p.locator(".mapwrap").boundingBox();
  assert.ok(map.width > 1000);
  await tile(p, "PET 4").click();
  await p.waitForSelector(".sheet.on .pf-sec h3:has-text('ข้อมูลเครื่อง')");
  const sh = await p.locator(".sheet.on").boundingBox();
  assert.ok(sh.x > 800 && sh.width <= 460, "จอกว้าง = แผงขวา");
  assert.ok(await p.locator(".sheet.on .tl i").count() >= 1);
  await p.locator(".sheet.on .seg button", { hasText: "ทั้งหมด" }).click();
  assert.ok(await p.locator(".sheet.on table.pf-t tbody tr").count() >= 1);
  assert.match(await p.locator(".sheet.on dl.pf-kv").innerText(), /ใบ\/ชม\./);
  assert.match(await p.locator(".sheet.on").innerText(), /ยังไม่มีในระบบ[\s\S]*รุ่น\/ยี่ห้อ/);
  await noText(p);
  assert.deepEqual(p.errors, []);
});
