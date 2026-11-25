// ============================================================
//  เทสต์หน้าจอ ออฟฟิศ 0210 + หมุดลูกค้า 0310 (Playwright + หลังบ้านจริงบน SQLite + ข้อมูลสมมติ PIN 1234)
//    รันเดี่ยว: node --no-warnings --test v2/tests/ui/office-plan.ui.mjs
//  ออเดอร์ › รวมตามสินค้า (ต้นไม้ · แตะใบสั่ง = รายละเอียด) · ซื้อหน้าร้าน · ลงออเดอร์พร้อมงวดส่ง + รอยืนยัน · นัด/เลื่อนงวด + สาเหตุ
//  มัดจำ (ช่องทางต้องเลือก) · แนะนำสาย · หมุดจากพิกัด · ส่งของ: ส่งแล้ว → ปักหมุด GPS · ประธาน: ชื่อสาย
//  ทุกหน้า: 320/360/390/1366 + โหมดมืด ไม่เลื่อนข้าง · ไม่มี error ในคอนโซล · ไม่มี null/undefined/NaN
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

async function page(app, who, vp, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: vp || { width: 390, height: 844 } }, opt || {}));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(S.url + "?app=" + app);
  await p.locator(".person", { hasText: who }).click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector("nav.nav a[aria-current='page']");
  await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 });
  return p;
}
const pad = async (p, digits) => { for (const d of String(digits)) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d + "$") }).last().click(); await p.locator(".sheet.on .numpad button.ok").last().click(); };
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const clean = async p => { const t = await p.locator("body").innerText(); assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(t), "มีคำว่า null/undefined/NaN บนจอ"); };
const ordersTab = async p => { await p.locator("nav.nav a", { hasText: "ออเดอร์" }).click(); await p.waitForSelector(".oview"); };

test("ออเดอร์ › รวมตามสินค้า: ต้นไม้ ประเภท → ขนาด → คอ/ทรง → สี → ใบสั่ง · ยอดใบ+ถุงทุกชั้น · แตะใบสั่ง = แผงรายละเอียด (คอม)", async () => {
  const p = await page("office", "แอน", { width: 1366, height: 768 });
  await ordersTab(p);
  await p.locator(".oview .chip", { hasText: "รวมตามสินค้า" }).click();
  await p.waitForSelector(".tnode.d0");
  assert.match(await p.locator(".main").innerText(), /ยังต้องส่ง [\d,]+ ใบ\/ชิ้น · \d+ ใบสั่ง/);
  const top = p.locator(".tnode.d0", { hasText: "ขวด" });
  assert.match(await top.innerText(), /ถุง/);
  await top.click();
  await p.locator(".tnode.d1").first().click();
  // เปิดลงไปจนเจอใบสั่ง (ชั้นคอ/ทรงที่ว่างข้ามไปเอง)
  for (let i = 0; i < 4 && !(await p.locator(".tnode.ord").count()); i++) await p.locator(".tnode[aria-expanded='false']:not(.d0)").last().click();
  const ord = p.locator(".tnode.ord").first();
  assert.ok(await ord.count(), "เห็นใบสั่งในชั้นสุดท้าย");
  await ord.click();
  await p.waitForSelector(".md-detail .dhead, .md-detail .icard", { timeout: 8000 });
  assert.ok(await p.locator(".md-detail h2.name").count(), "รายละเอียดเปิดในแผงขวา");
  // กิ่งที่กางยังกางอยู่หลังกรอง
  await p.locator(".chip:visible", { hasText: "จอง / รอยืนยัน" }).click();
  await p.locator(".chip:visible", { hasText: "ทั้งหมด" }).first().click();
  assert.ok(await p.locator(".tnode.d1").count(), "กิ่งยังกาง");
  assert.ok(await noHScroll(p)); await clean(p);
  assert.deepEqual(p.errors, []);
});

test("ออเดอร์ › ซื้อหน้าร้าน: ตามวัน + รวมตามสินค้า + ยอดตามราคาที่ลง (บอกรายการที่ยังไม่ใส่ราคา) · มือถือ 390 / 320 ไม่เลื่อนข้าง", async () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const p = await page("office", "แอน", vp);
    await ordersTab(p);
    await p.locator(".oview .chip", { hasText: "ซื้อหน้าร้าน" }).click();
    await p.waitForSelector(".wday");
    const t = await p.locator(".main").innerText();
    assert.match(t, /ใบ ขายหน้าร้าน/); assert.match(t, /ยอดตามราคาที่ลง ฿/); assert.match(t, /ยังไม่ใส่ราคา/);
    assert.ok(await p.locator(".wday .iline").count() >= 2);
    await p.locator(".oview .chip", { hasText: "วันนี้" }).click().catch(() => {});
    assert.ok(await noHScroll(p), "ไม่เลื่อนข้างที่ " + vp.width); await clean(p);
    assert.deepEqual(p.errors, []);
  }
});

test("ลงออเดอร์: ต้องการเมื่อไร + งวดกำหนดจำนวน (ต่อครั้ง × ทุก 7 วัน) + รอยืนยัน → บันทึก = 2 งวด · ไม่เข้าคิว · ใบสั่งไลน์บอกงวด", async () => {
  const p = await page("office", "ฝน", { width: 390, height: 844 });
  await p.locator(".fab", { hasText: "ลงออเดอร์" }).click();
  await p.locator(".cpick input").fill("ตัวอย่างk");
  await p.locator(".sugg button", { hasText: "ร้านตัวอย่าง K" }).click();
  await p.waitForSelector(".sheet.on .axgrid");
  for (const t of ["ขวด", "600 ml", "คอยาว", "MK", "ใส", "ไม่สกรีน", "ไม่มีฝา"]) await p.locator(".sheet.on .axgrid button", { hasText: new RegExp("^" + t) }).first().click();
  await pad(p, "40");
  await p.locator(".want .chip", { hasText: "สัปดาห์หน้า" }).click();
  await p.locator(".wd", { hasText: "พรุ่งนี้" }).click();
  await p.locator(".plan-modes .chip", { hasText: "กำหนดจำนวน" }).click();
  await p.locator(".qbtn", { hasText: "ต่อครั้ง" }).click();
  await pad(p, "20");
  await p.locator(".chip", { hasText: "ทุก 7 วัน" }).click();
  assert.match(await p.locator(".plan-box").innerText(), /รวม 2 งวด/);
  await p.locator(".holdsw").click();
  await p.locator(".savebar .btn.pri").click();
  await p.waitForSelector(".sheet.on.modal");
  const card = await p.locator(".sheet.on.modal").innerText();
  assert.match(card, /ครั้งละ 20 ถุง × 2 ครั้ง ทุก 7 วัน/); assert.match(card, /สัปดาห์หน้า/);
  assert.equal(await p.locator(".sheet.on.modal .chip", { hasText: "ส่งเข้าคิวผลิตเลย" }).isDisabled(), true, "รอยืนยัน = ส่งเข้าคิวไม่ได้");
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ยืนยันบันทึก" }).click();
  await p.waitForSelector(".sheet.on .slip");
  assert.match(await p.locator(".sheet.on .slip").innerText(), /นัดส่ง: .*ครั้งละ 20 ถุง/);
  const o = S.d1.one("SELECT * FROM orders WHERE customer_id = 'CDK' ORDER BY created_at DESC LIMIT 1");
  assert.equal(o.hold, 1); assert.equal(o.status, "ออเดอร์ใหม่"); assert.equal(o.want_when, "สัปดาห์หน้า"); assert.equal(o.plan_mode, "กำหนดจำนวน");
  assert.equal(S.d1.q("SELECT * FROM order_rounds WHERE order_id = ? AND status = 'ใช้งาน'", o.id).length, 2);
  assert.ok(await noHScroll(p)); assert.deepEqual(p.errors, []);
});

test("รายละเอียด: งวดส่ง (ส่งไม่ครบ = ส่วนขาดไปงวดถัดไป) · เลื่อนงวด = เลือกสาเหตุ → ลงสมุด · ลงมัดจำ (ช่องทางต้องเลือก) · หน้าบิลบอกมัดจำ", async () => {
  const p = await page("office", "แอน", { width: 1366, height: 768 });
  await ordersTab(p);
  await p.locator(".oview .chip", { hasText: "รายใบ" }).click();
  await p.locator(".ocard", { hasText: "งวดตัวอย่าง" }).first().click();
  await p.waitForSelector(".md-detail .plan");
  const plan = await p.locator(".md-detail .plan").innerText();
  assert.match(plan, /งวดส่ง · กำหนดจำนวนต่อครั้ง 3 งวด/); assert.match(plan, /ส่งไม่ครบ · ส่วนขาดไปงวดถัดไป/); assert.match(plan, /รวมส่วนขาด/); assert.match(plan, /ประวัติเลื่อนวันส่ง \(1\)/);
  const before = S.d1.q("SELECT * FROM reschedule_events WHERE order_id = 'OP001'").length;
  await p.locator(".md-detail .rnd.cur .btn", { hasText: "เลื่อน" }).click();
  await p.waitForSelector(".sheet.on .cal");
  await p.locator(".sheet.on .cal button.day:not([disabled])").last().click();
  await p.waitForSelector(".sheet.on .chip", { hasText: "ขวดไม่พอ" });
  assert.ok(await p.locator(".sheet.on .chip", { hasText: "เลื่อนงวดถัดไปตามด้วย" }).count(), "มีงวดถัดไป = ถามว่าเลื่อนตามไหม");
  await p.locator(".sheet.on .chip", { hasText: "ขวดไม่พอ" }).click();
  await p.locator(".sheet.on .btn.pri", { hasText: "เลื่อนวันส่ง" }).click();
  await p.waitForFunction(n => document.body.innerText.includes("ประวัติเลื่อนวันส่ง (" + n + ")"), before + 2, { timeout: 8000 });
  assert.equal(S.d1.q("SELECT * FROM reschedule_events WHERE order_id = 'OP001' AND cause = 'ขวดไม่พอ'").length, 2, "งวดที่ถึงคิว + งวดถัดไปที่เลื่อนตาม");
  // มัดจำ
  await p.locator(".md-detail .btn", { hasText: "ลงมัดจำ" }).click();
  await p.locator(".sheet.on .qbtn", { hasText: "ยอดมัดจำ" }).click();
  for (const d of "5000") await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d + "$") }).last().click();
  await p.locator(".sheet.on .btn.pri", { hasText: "ตกลง" }).click();
  await p.locator(".sheet.on .btn.pri", { hasText: "บันทึกมัดจำ" }).click();
  assert.match(await p.locator(".sheet.on .err").innerText(), /เลือกช่องทาง/, "ไม่มีค่าตั้งต้นช่องทาง");
  await p.locator(".sheet.on .chip", { hasText: "KTB" }).click();
  await p.locator(".sheet.on .btn.pri", { hasText: "บันทึกมัดจำ" }).click();
  await p.waitForFunction(() => /มัดจำ\s*฿5,000/.test(document.querySelector(".md-detail").innerText) || /฿5,000/.test(document.querySelector(".md-detail").innerText), null, { timeout: 8000 });
  assert.equal(S.d1.one("SELECT sum(amount_satang) s FROM order_deposits WHERE order_id = 'OP001' AND status = 'ใช้งาน'").s, 950000);
  // ลำดับคิว: ดันขึ้นก่อน = เหตุผล → ป้ายปรับมือ (คุณปาล์มเคาะ 19 พ.ย.)
  assert.match(await p.locator(".md-detail .qline").innerText(), /ลำดับคิว #\d+ จาก \d+ ใบ/);
  await p.locator(".md-detail .btn", { hasText: "ดันขึ้นก่อน" }).click();
  await p.locator(".sheet.on .chip", { hasText: "ลูกค้าขอด่วน" }).click();
  await p.locator(".sheet.on .btn.pri").last().click();
  await p.waitForFunction(() => /ปรับมือ/.test((document.querySelector(".md-detail .qline") || {}).innerText || ""), null, { timeout: 8000 })
    .catch(async e => { throw new Error("qline: " + await p.locator(".md-detail .qline").innerText().catch(() => "?") + " · sheet: " + await p.locator(".sheet.on").innerText().catch(() => "-") + " · " + e.message); });
  assert.equal(S.d1.one("SELECT priority FROM orders WHERE id = 'OP001'").priority, 1);
  // ออกบิล (คุณปาล์มเคาะ 19 พ.ย.): หักมัดจำในบิลเลย — แผ่นออกบิลบอกยอดหักมัดจำ + ค้างชำระ
  await p.locator(".md-detail .btn", { hasText: "ออกบิล" }).click();
  await p.waitForSelector(".sheet.on .money-big");
  await p.locator(".sheet.on .chip", { hasText: "เครดิต" }).click();
  await p.waitForFunction(() => /หักมัดจำ \(คงเหลือ ฿9,500\)/.test(document.querySelector(".sheet.on").innerText), null, { timeout: 8000 });
  await p.locator(".sheet.on .btn.pri", { hasText: "ออกบิล" }).click();
  await p.waitForSelector(".sheet.on .billdoc", { timeout: 8000 });
  assert.match(await p.locator(".sheet.on .billdoc").innerText(), /หักมัดจำ[\s\S]*ยอดค้างชำระ/);
  const bill = S.d1.one("SELECT * FROM bills WHERE order_id = 'OP001' AND status <> 'ยกเลิก'");
  assert.ok(bill.deposit_satang > 0 && bill.deposit_satang <= 950000);
  assert.ok(await noHScroll(p)); await clean(p);
  assert.deepEqual(p.errors, []);
});

test("ลูกค้า: แนะนำสายจากอำเภอ (แตะใช้ — ไม่เขียนเอง) · วางพิกัด = หมุด · แผ่นแนะนำสายทั้งทะเบียน", async () => {
  const p = await page("office", "แอน", { width: 1366, height: 768 });
  await p.locator("nav.nav a", { hasText: "ลูกค้า" }).click();
  await p.locator(".card", { hasText: "ร้านตัวอย่าง L" }).first().click();
  await p.waitForSelector(".md-detail .kv2");
  assert.match(await p.locator(".md-detail").innerText(), /ยังไม่มีหมุด/);
  await p.locator(".md-detail .btn", { hasText: "วางลิงก์แผนที่" }).click();
  await p.locator(".sheet.on input").fill("18.2501, 99.6702");
  await p.locator(".sheet.on .btn.pri", { hasText: "บันทึก" }).click();
  await p.waitForFunction(() => /จากลิงก์แผนที่/.test(document.querySelector(".md-detail").innerText), null, { timeout: 8000 });
  assert.equal(S.d1.one("SELECT geo_lat_e6 FROM customers WHERE id = 'CDL'").geo_lat_e6, 18250100);
  // แผ่นแนะนำสาย (ทั้งทะเบียน)
  await p.locator(".btn", { hasText: "แนะนำสาย" }).first().click();
  await p.waitForSelector(".sheet.on .icard, .sheet.on .empty");
  const t = await p.locator(".sheet.on").innerText();
  assert.match(t, /ยังไม่มีสาย \d+ ราย/); assert.match(t, /ร้านตัวอย่าง J/);
  await p.locator(".sheet.on .btn.pri", { hasText: "ยืนยันสาย" }).click();
  await p.waitForFunction(() => !document.querySelector(".sheet.on.modal"), null, { timeout: 8000 });
  assert.equal(S.d1.one("SELECT route_code FROM customers WHERE id = 'CDJ'").route_code, "212");
  assert.equal(S.d1.one("SELECT route_code FROM customers WHERE id = 'CDM'").route_code, null, "ไม่มีอำเภอ = ไม่เดา");
  assert.deepEqual(p.errors, []);
});

test("ส่งของ: เส้นทางใช้วันของงวด + ป้ายงวด · ขึ้นรถตั้งต้น \"งวดนี้\" · ส่งแล้วที่ร้านไม่มีหมุด → ปักหมุด GPS แตะเดียว", async () => {
  const p = await page("deliver", "ต่อ", { width: 390, height: 844 }, { geolocation: { latitude: 18.31234, longitude: 99.51234, accuracy: 9 }, permissions: ["geolocation"] });
  const card = p.locator(".stop", { hasText: "งวด 2/3" }).first();   // ร้าน B มีหลายใบสั่ง — ใบที่วางงวดไว้มีป้ายงวด
  assert.match(await card.innerText(), /ร้านตัวอย่าง B/);
  await card.click();
  assert.match(await p.locator(".sheet.on").innerText(), /ยังไม่มีหมุด/);
  await p.locator(".sheet.on .btn", { hasText: "ขึ้นรถ" }).click();
  await p.locator(".sheet.on .vchips button").first().click();
  assert.equal(await p.locator(".sheet.on [aria-pressed='true']", { hasText: "งวดนี้" }).count(), 1, "ตั้งต้นขึ้นเฉพาะงวดนี้");
  assert.match(await p.locator(".sheet.on .itemrow").first().innerText(), /25/);
  await p.locator(".sheet.on .btn.pri", { hasText: "ขึ้น" }).click();
  await p.waitForFunction(() => !document.querySelector(".sheet.on"), null, { timeout: 8000 });
  await p.locator("nav.nav a", { hasText: "บนรถ" }).click();
  await p.locator(".card.job", { hasText: "ร้านตัวอย่าง B" }).locator(".btn.ok", { hasText: "ส่งแล้ว" }).first().click();
  await p.locator(".sheet.on .btn.ok", { hasText: "ส่งแล้ว" }).click();
  await p.waitForSelector(".sheet.on .btn.pri", { hasText: "ปักหมุดตรงนี้" });
  await p.locator(".sheet.on .btn.pri", { hasText: "ปักหมุดตรงนี้" }).click();
  await p.waitForFunction(() => !document.querySelector(".sheet.on"), null, { timeout: 8000 });
  const c = S.d1.one("SELECT geo_lat_e6, geo_acc_m, geo_src FROM customers WHERE id = 'CDB'");
  assert.equal(c.geo_lat_e6, 18312340); assert.equal(c.geo_src, "GPS ตอนส่งของ"); assert.equal(c.geo_acc_m, 9);
  assert.ok(await noHScroll(p)); assert.deepEqual(p.errors, []);
});

test("ประธาน › ทีม › ชื่อสายส่ง: เดาจากอำเภอ (รอยืนยัน) → ยืนยันชื่อ · ทุกหน้าใหม่ไม่เลื่อนข้างที่ 320/360 + โหมดมืด", async () => {
  const p = await page("exec", "หัวหน้า", { width: 1366, height: 768 });
  await p.locator("nav.nav a", { hasText: "ทีม" }).click();
  await p.locator(".btn", { hasText: "เดาชื่อสายจากอำเภอ" }).click();
  await p.waitForFunction(() => !/เดาชื่อสายจากอำเภอ \(/.test(document.body.innerText), null, { timeout: 8000 });
  assert.ok(S.d1.q("SELECT * FROM route_areas WHERE confirmed = 0").length >= 3);
  const row = p.locator("button.card", { hasText: "212" }).last();
  assert.match(await row.innerText(), /รอยืนยันชื่อสาย/);
  await row.click();
  await p.locator(".sheet.on input").fill("เถิน–แม่พริก");
  await p.locator(".sheet.on .btn.pri").click();
  await p.waitForFunction(() => /เถิน–แม่พริก/.test(document.body.innerText), null, { timeout: 8000 });
  assert.equal(S.d1.one("SELECT confirmed FROM route_areas WHERE route_code = '212'").confirmed, 1);
  assert.deepEqual(p.errors, []);
  for (const [vp, scheme] of [[{ width: 320, height: 640 }, "light"], [{ width: 360, height: 640 }, "dark"]]) {
    const q = await page("office", "แอน", vp, { colorScheme: scheme });
    await ordersTab(q);
    for (const m of ["รวมตามสินค้า", "ซื้อหน้าร้าน"]) {
      await q.locator(".oview .chip", { hasText: m }).click();
      await q.waitForTimeout(700);
      const t = q.locator(".tnode.d0").first(); if (m === "รวมตามสินค้า" && await t.count()) await t.click();
      assert.ok(await noHScroll(q), m + " ไม่เลื่อนข้างที่ " + vp.width + " " + scheme);
    }
    await q.goto(S.url + "?app=office#/new"); await q.waitForSelector(".plan-box");
    await q.locator(".plan-modes .chip", { hasText: "กำหนดจำนวน" }).click();
    assert.ok(await noHScroll(q), "ฟอร์มงวดส่งไม่เลื่อนข้างที่ " + vp.width);
    const small = await q.evaluate(() => [...document.querySelectorAll(".plan-box button, .tnode")].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5).map(b => b.textContent.trim().slice(0, 20)));
    assert.deepEqual(small, [], "ปุ่ม ≥ 44px");
    assert.deepEqual(q.errors, []);
  }
});
