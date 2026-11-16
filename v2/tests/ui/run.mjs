// ============================================================
//  เทสต์หน้าจอจริง (Playwright + Chromium ที่ติดตั้งในเครื่องแล้ว) — เปลือกแอป + ชิ้นส่วนกลาง ทุกบทบาท
//    node --no-warnings v2/tests/ui/run.mjs
//  จอ: 320 · 360×640 · 390×844 · 1366×768 · โหมดมืด · reduced-motion · ปุ่ม ≥ 44px · ไม่มีเลื่อนข้าง · ไม่มี error ในคอนโซล
//  ต่อกับหลังบ้านจริง (server/) + สะพาน GAS จริง (gas/Code.gs) ในเครื่อง — ข้อมูลสมมติ PIN 1234
// ============================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startDev } from "../../tools/dev-server.mjs";
import "./prod.mjs";   // เทสต์หน้าจอทีมผลิต

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
const ROLES = ["office", "prod", "screen", "deliver", "account", "exec"];
let S, browser;
before(async () => { S = await startDev({ mem: true }); browser = await pw.chromium.launch(); });
after(async () => { await browser.close(); await S.close(); });

async function page(vp, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: vp || { width: 390, height: 844 } }, opt || {}));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());   // ไม่ยิงเน็ตจริงในเทสต์
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g/.test(m.text())) p.errors.push(m.text()); });
  return p;
}
async function login(p, role, nick, pin) {
  await p.goto(S.url + "?app=" + role);
  await p.locator(".person", { hasText: nick || "" }).first().click();
  for (const d of pin || "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector("nav.nav");
  await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 });
}
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("เข้าระบบ: แตะการ์ดชื่อ → PIN ผิดบอกตรง + เขย่า → PIN ถูกเข้าหน้าแรก (เมนู ≤5 · ป้ายเวอร์ชัน · ปุ่มลงออเดอร์)", async () => {
  const p = await page();
  await p.goto(S.url + "?app=office");
  await p.locator(".person", { hasText: "แอน" }).click();
  for (const d of "9999") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector(".pin-dots.shake, p.err:has-text('PIN ไม่ถูกต้อง')");
  assert.match(await p.locator(".sheet p.err").innerText(), /PIN ไม่ถูกต้อง/);
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector("nav.nav a[aria-current='page']");
  assert.equal(await p.locator("nav.nav a").count(), 5);
  assert.match(await p.locator(".ver").innerText(), /^v\d/);
  assert.ok(await p.locator(".fab", { hasText: "ลงออเดอร์" }).isVisible());
  assert.equal(await p.locator("h1").innerText(), "งานที่รอวันนี้");
  assert.deepEqual(p.errors, []);
});

test("เปิดแอปเริ่มหน้าแรกเสมอ (ลิงก์ค้างหน้าอื่นก็กลับหน้าแรก) · ← กลับหน้าก่อน", async () => {
  let p = await page();
  await login(p, "office", "แอน");
  const p2 = await p.context().newPage();
  await p2.goto(S.url + "?app=office#/stock");   // เปิดใหม่จากลิงก์ที่ค้างหน้าอื่น
  await p2.waitForSelector("nav.nav a[aria-current='page']");
  p = p2;
  assert.equal(await p.locator("nav.nav a[aria-current='page']").getAttribute("data-key"), "home");
  assert.equal(await p.locator(".top .iconbtn[aria-label='กลับหน้าก่อน']").isHidden(), true);
});

for (const vp of [{ width: 320, height: 640 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test("ทุกบทบาทที่จอ " + vp.width + "×" + vp.height + ": ไม่มีเลื่อนข้าง · ปุ่ม ≥ 44px · ไม่มี error · ไม่มีอีโมจิ", async () => {
    for (const role of ROLES) {
      const p = await page(vp);
      await login(p, role, role === "exec" ? "หัวหน้า" : "");
      assert.ok(await noHScroll(p), role + " เลื่อนข้างได้ที่ " + vp.width);
      const small = await p.$$eval(".main button, .main a, nav.nav a, .top button", els => els.filter(e => e.offsetParent !== null && !e.closest("details:not([open])"))
        .map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute("aria-label") || "").slice(0, 20), h: r.height, w: r.width }; }).filter(x => x.h < 43.5 || x.w < 43.5));
      assert.deepEqual(small, [], role + " มีปุ่มเล็กกว่า 44px");
      const text = await p.locator("body").innerText();
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), role + " มีอีโมจิบนจอ");
      assert.ok(!/\bnull\b|undefined|NaN/.test(text), role + " มีคำว่า null/undefined/NaN บนจอ");
      if (vp.width >= 1100) {
        const nav = await p.locator("nav.nav").boundingBox();
        assert.ok(nav.x === 0 && nav.height >= vp.height - 2 && nav.width < 300, role + " จอกว้างต้องเป็นแถบเมนูซ้าย");
        const main = await p.locator("main.main").boundingBox();
        assert.ok(main.width > 1000, role + " จอกว้างต้องใช้พื้นที่เต็ม (" + main.width + ")");
      }
      assert.deepEqual(p.errors, [], role);
      await p.context().close();
    }
  });
}

test("แผ่นล่าง: เปิดรายละเอียด = role dialog · Esc ปิด · โฟกัสกลับที่เดิม · รหัสอ้างอิงอยู่ในรายละเอียดที่เดียว", async () => {
  const p = await page();
  await login(p, "office", "แอน");
  assert.equal(await p.locator(".main").innerText().then(t => /OD\d{3}/.test(t)), false, "ห้ามโชว์รหัสระบบบนรายการ");
  const card = p.locator(".orders button.card").first();
  await card.click();
  await p.waitForSelector(".sheet.on[role='dialog']");
  assert.match(await p.locator(".sheet .ref").innerText(), /รหัสอ้างอิง/);
  await p.keyboard.press("Escape");
  await p.waitForSelector(".sheet", { state: "detached" });
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("card")), true);
});

test("ประธาน: ปิดเรื่อง → แผ่นยืนยัน + ชิปเหตุผล + อื่น ๆ (พิมพ์เอง) → บันทึก → แถบย้อน → ย้อนได้ (ไม่ลบแถว)", async () => {
  const p = await page();
  await login(p, "exec", "หัวหน้า");
  const first = p.locator(".flags .card").first();
  const title = await first.locator("b").innerText();
  await first.locator("button", { hasText: "ปิดเรื่อง" }).click();
  await p.waitForSelector(".sheet.on .chip");
  const chips = await p.locator(".sheet .chip").allInnerTexts();
  assert.ok(chips.includes("อื่น ๆ (พิมพ์เอง)"));
  await p.locator(".sheet .chip", { hasText: "อื่น ๆ (พิมพ์เอง)" }).click();
  await p.locator(".sheet input").fill("ตรวจกับบิลจริงแล้ว");
  await p.locator(".sheet .btn.pri", { hasText: "ปิดเรื่อง" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const row = () => S.d1.one("SELECT status, resolution FROM flags WHERE title = ?", title);
  assert.equal(row().status, "ปิด"); assert.equal(row().resolution, "ตรวจกับบิลจริงแล้ว");
  await p.locator(".snack button", { hasText: "ย้อน" }).click();
  await p.waitForSelector(".snack .msg:has-text('ย้อนแล้ว')");
  assert.equal(row().status, "เปิด");
  assert.equal(S.d1.one("SELECT count(*) n FROM flags WHERE title = ?", title).n, 1);
});

// ทีมผลิต (แผนผัง · รอบเครื่อง · แจ้งปัญหา) → tests/ui/prod.mjs

test("เงิน: โหลดไม่สำเร็จ = ไม่โชว์ ฿0 หรือยอดเก่า (โชว์ — + บอกตรง ๆ) · รายการอื่นโชว์ของรอบก่อนพร้อมเวลา", async () => {
  const p = await page();
  await login(p, "account", "ฝ้าย");
  await p.waitForSelector(".main .card:has-text('ค้างชำระทั้งหมด')");
  assert.match(await p.locator(".main").innerText(), /฿/);
  await p.route("**/api/call", r => r.request().postData().includes("home.account") ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "server", message: "หลังบ้านทำงานผิดพลาด" } }) }) : r.continue());
  await p.reload();
  await p.waitForSelector(".banner.t-bad");
  const t = await p.locator(".main").innerText();
  assert.ok(!/฿/.test(t), "โหลดไม่สำเร็จแล้วยังโชว์ยอดเงิน: " + t);
  assert.match(t, /อัปเดตไม่สำเร็จ/); assert.match(t, /ข้อมูลเมื่อ/);
});

test("รุ่นบังคับอัปเดต: ขึ้นแถบ · ระหว่างแผ่น/ฟอร์มเปิดอยู่ไม่โหลดใหม่ · ปิดแผ่นแล้วโหลดใหม่เอง", async () => {
  const p = await page();
  await login(p, "office", "แอน");
  S.d1.raw.prepare("UPDATE settings SET value = '9999-99-99z' WHERE key = 'MIN_WEB_VERSION'").run();
  await p.reload();
  await p.waitForSelector(".upd:not([hidden]):has-text('ต้องอัปเดต')");
  await p.locator(".orders button.card").first().click();
  await p.waitForSelector(".sheet.on");
  let reloaded = false;
  p.on("load", () => { reloaded = true; });
  await p.waitForTimeout(3500);
  assert.equal(reloaded, false, "โหลดใหม่ทั้งที่แผ่นยังเปิดอยู่");
  await p.keyboard.press("Escape");
  await p.waitForEvent("load", { timeout: 8000 });
  S.d1.raw.prepare("UPDATE settings SET value = '' WHERE key = 'MIN_WEB_VERSION'").run();
});

test("reduced-motion: แผ่นล่างไม่เคลื่อนไหว · โหมดมืดพื้นหลังเข้ม", async () => {
  const p = await page({ width: 390, height: 844 }, { reducedMotion: "reduce", colorScheme: "dark" });
  await login(p, "office", "แอน");
  await p.locator(".orders button.card").first().click();
  await p.waitForSelector(".sheet.on");
  const dur = await p.$eval(".sheet", e => getComputedStyle(e).transitionDuration);
  assert.ok(dur.split(",").every(x => parseFloat(x) < 0.01), "ยังมีการเคลื่อนไหว: " + dur);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  assert.ok(r + g + b < 120, "โหมดมืดพื้นหลังยังสว่าง: " + bg);
});

test("แป้นตัวเลขของแอป: ใส่/ลบ/ตกลง ได้จำนวนเต็ม (ไม่เปิดคีย์บอร์ดมือถือ)", async () => {
  const p = await page();
  await login(p, "office", "แอน");
  const v = p.evaluate(async () => { const ui = await import("./assets/ui.js"); return ui.numpadSheet({ title: "ดี", unit: "ใบ" }); });
  await p.waitForSelector(".sheet.on .numpad");
  for (const k of ["5", "0", "8", "9", "1"]) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + k + "$") }).click();
  await p.locator(".sheet.on .numpad button[aria-label='ลบ']").click();
  assert.equal(await p.locator(".sheet.on .numdisp .v").innerText(), "5,089");
  await p.locator(".sheet.on .numpad button.ok").click();
  assert.equal(await v, 5089);
  assert.equal(await p.locator("input").count(), 0);
});

// ── โมดูล (แชทย่อย) เพิ่มไฟล์เทสต์หน้าจอของตัวเองต่อท้ายตรงนี้ ──
import "./screen_deliver.mjs";   // ทีมสกรีนสี + ส่งของ
import "./office.ui.mjs";        // ออฟฟิศ
