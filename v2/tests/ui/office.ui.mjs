// ============================================================
//  เทสต์หน้าจอออฟฟิศ (Playwright + หลังบ้านจริงบน SQLite + สะพาน PIN จริง) — ข้อมูลสมมติ PIN 1234
//    CI รันทุกไฟล์ใน tests/ui/ ทีละไฟล์ — รันเดี่ยว: node --no-warnings --test v2/tests/ui/office.ui.mjs
//  ลงออเดอร์ทีละขั้น (ลูกค้า → เคยสั่ง/ไล่ถามทีละแกน → แป้นตัวเลข → การ์ดยืนยัน → บันทึก → แชร์ไลน์) · ลูกค้าใหม่ (เตือนชื่อคล้าย)
//  รายละเอียด (คอม = แผงขวา) · ส่งเข้าคิว · ลูกค้ามารับ · ออกบิล (ประเภทต้องกดเอง) · แก้ไข (มีประวัติ) · ลูกค้า · สต๊อก
//  ทุกหน้า: 320/360/390/1366 ไม่เลื่อนข้าง · ปุ่ม ≥ 44px · ไม่มีอีโมจิ · ไม่มี null/undefined/NaN · ไม่มี error ในคอนโซล
// ============================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startDev } from "../../tools/dev-server.mjs";
import { specKey } from "../../server/core.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
let S, browser;
before(async () => {
  S = await startDev({ mem: true });
  browser = await pw.chromium.launch();
  const k = specKey({ type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" }, "ขนาด,คอขวด,รูปทรง,สี,สีสกรีน,พร้อมฝาสี");
  S.d1.raw.prepare("INSERT INTO prices(item_key, kind, price_satang, updated_at, updated_by) VALUES (?, 'ราคาโรงงาน', 120, ?, 'S199')").run("spec:" + k, new Date().toISOString());
});
after(async () => { await browser.close(); await S.close(); });

async function page(vp, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: vp || { width: 390, height: 844 } }, opt || {}));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(S.url + "?app=office");
  await p.locator(".person", { hasText: "แอน" }).click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector("nav.nav a[aria-current='page']");
  await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 });
  return p;
}
const pad = async (p, digits) => { for (const d of String(digits)) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d + "$") }).click(); await p.locator(".sheet.on .numpad button.ok").click(); };
const tapAx = (p, text) => p.locator(".sheet.on .axgrid button", { hasText: new RegExp("^" + text.replace(/[()]/g, "\\$&")) }).first().click();
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const lastOrder = () => S.d1.one("SELECT * FROM orders WHERE src = 'v2' ORDER BY created_at DESC, id DESC LIMIT 1");

test("ลงออเดอร์ทีละขั้น (มือถือ): ลูกค้าจากรายการ → ไล่ถามทีละแกน → แป้นถุง → ขั้นต่ำเตือนไม่บล็อก → การ์ดยืนยัน → บันทึก → ใบสั่งไลน์ (ไม่มีรหัส)", async () => {
  const p = await page();
  await p.locator(".fab", { hasText: "ลงออเดอร์" }).click();
  await p.waitForSelector(".cpick input");
  assert.equal(await p.locator("h1").innerText(), "ลงออเดอร์");
  await p.locator(".cpick input").fill("ตัวอย่างc");
  await p.locator(".sugg button", { hasText: "ร้านตัวอย่าง C" }).click();
  assert.match(await p.locator(".cust-tag").innerText(), /สาย 119 · อ.แม่ทะ/);
  // ไลน์เปล่า + เลือกลูกค้าแล้ว = ไล่ถามทีละแกนเอง (ประเภท → ขนาด → คอ → ทรง → สี → สกรีน → ฝา → จำนวน)
  await p.waitForSelector(".sheet.on .axgrid");
  assert.match(await p.locator(".sheet.on .step").innerText(), /ขั้น 1/);
  await tapAx(p, "ขวด");
  assert.match(await p.locator(".sheet.on .step").innerText(), /ขั้น 2\/8/);
  await tapAx(p, "600 ml");
  await tapAx(p, "คอยาว");
  await tapAx(p, "MK");
  await tapAx(p, "ใส");
  await tapAx(p, "ไม่สกรีน");
  await tapAx(p, "ไม่มีฝา");
  await p.waitForSelector(".sheet.on .numpad");
  await pad(p, "5");
  assert.match(await p.locator(".line .qsum").innerText(), /5 ถุง × 200 = 1,000 ใบ/);
  assert.match(await p.locator(".line .warnline").innerText(), /ต่ำกว่าขั้นต่ำ 1,200/);
  assert.equal(await p.locator(".line .ax", { hasText: "สีสกรีน" }).count(), 1, "ขวดมีแกนสีสกรีน");
  await p.locator(".wd", { hasText: "พรุ่งนี้" }).click();
  await p.locator(".savebar .btn.pri").click();
  await p.waitForSelector(".sheet.on.modal:has-text('ตรวจอีกครั้งก่อนบันทึก')");
  assert.match(await p.locator(".sheet.on.modal").innerText(), /ร้านตัวอย่าง C[\s\S]*ขวด 600 ml คอยาว MK ใส/);
  assert.equal(await p.locator(".sheet.on.modal .chip", { hasText: "ส่งเข้าคิวผลิตเลย" }).getAttribute("aria-pressed"), "true");
  // กดนอกการ์ด = กลับไปแก้ ไม่ล้างฟอร์ม
  await p.mouse.click(5, 5);
  await p.waitForSelector(".sheet.modal", { state: "detached" });
  assert.match(await p.locator(".line .lhead b").innerText(), /ขวด 600 ml/);
  await p.locator(".savebar .btn.pri").click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ยืนยันบันทึก" }).click();
  await p.waitForSelector(".sheet.on.modal pre.slip");
  const slip = await p.locator("pre.slip").innerText();
  assert.match(slip, /ลูกค้า: ร้านตัวอย่าง C \(สาย 119 · อ.แม่ทะ\)/); assert.match(slip, /ขวด 600 ml คอยาว MK ใส — 5 ถุง \(1,000 ใบ\)/);
  assert.ok(!/\bO[0-9A-Z]{10,}/.test(slip), "ใบสั่งไม่มีรหัสระบบ");
  assert.ok(await p.locator(".sheet.on.modal button", { hasText: "แชร์ไลน์" }).isVisible());
  const o = lastOrder();
  assert.equal(o.customer_id, "CDC"); assert.equal(o.status, "รอผลิต"); assert.equal(o.taker_staff_id, "S101");
  assert.equal(S.d1.one("SELECT qty_pcs FROM order_items WHERE order_id = ?", o.id).qty_pcs, 1000);
  assert.equal(S.d1.one("SELECT count(*) n FROM production_jobs WHERE order_id = ?", o.id).n, 1);
  assert.equal(S.d1.q("SELECT * FROM flags WHERE kind = 'ต่ำกว่าขั้นต่ำ' AND entity_id = ?", o.id).length, 1);
  await p.locator(".sheet.on.modal button", { hasText: "ลงใบต่อไป" }).click();
  await p.waitForSelector(".sheet", { state: "detached" });
  assert.equal(await p.locator(".cpick input").inputValue(), "", "ลงใบต่อไป = ฟอร์มว่าง");
  assert.deepEqual(p.errors, []);
});

test("ลูกค้าใหม่: เตือนชื่อคล้าย (แตะเลือกแทนได้) · แยกชื่องาน · ลงพร้อมออเดอร์ · การ์ด \"เคยสั่ง\" ของลูกค้าเดิมแตะทีเดียวได้ทั้งไลน์", async () => {
  const p = await page({ width: 1366, height: 900 });
  await p.goto(S.url + "?app=office#/new");
  await p.evaluate(() => { location.hash = "#/new"; });
  await p.waitForSelector(".cpick input");
  await p.locator(".cpick input").fill("ร้านตัวอย่าง Q งานน้ำดื่มคิว");
  await p.locator(".sugg button.new").click();
  await p.waitForSelector(".sheet.on.modal:has-text('ลูกค้าใหม่')");
  assert.match(await p.locator(".sheet.on .sim").first().innerText(), /ชื่องานปน/);
  assert.match(await p.locator(".sheet.on").innerText(), /มีชื่อคล้ายในทะเบียน/);
  await p.locator(".sheet.on .sim button", { hasText: "แยกให้เลย" }).click();
  assert.equal(await p.locator(".sheet.on input[aria-label='ชื่อร้าน/ลูกค้า']").inputValue(), "ร้านตัวอย่าง Q");
  await p.locator(".sheet.on .chip", { hasText: /^เถิน$/ }).click();
  await p.locator(".sheet.on .btn.pri", { hasText: "ใช้ลูกค้าใหม่นี้" }).click();
  await p.waitForSelector(".cust-tag:has-text('ลูกค้าใหม่')");
  assert.equal(await p.locator("input[aria-label='ชื่องาน/แบรนด์']").inputValue(), "น้ำดื่มคิว");
  // ลูกค้าใหม่ยังไม่มีประวัติ → การ์ดโชว์ "ที่สั่งบ่อยทั่วไป" (ไม่ว่าง)
  await p.waitForSelector(".of-aside .usual-title:has-text('ยังไม่เคยสั่ง')");
  await p.waitForSelector(".sheet.on .axgrid");   // ไล่ถามประเภทเปิดเอง — แต่ "เคยสั่ง" ด้านขวายังแตะได้ (แผ่นปิดเอง ไลน์เปล่าถูกแทน)
  await p.locator(".of-aside .usual button").first().click();
  await p.waitForSelector(".sheet", { state: "detached" });
  await p.waitForSelector(".line .ax:has-text('ประเภท')");
  await p.locator(".line .qbtn", { hasText: "จำนวน" }).first().click();
  await pad(p, "12");
  await p.locator(".savebar .btn.pri").click();
  await p.waitForSelector(".sheet.on.modal:has-text('ลูกค้าใหม่')");
  await p.locator(".sheet.on.modal .chip", { hasText: "ส่งเข้าคิวผลิตเลย" }).click();   // ปิด = ลงไว้ก่อน
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ยืนยันบันทึก" }).click();
  await p.waitForSelector(".sheet.on.modal pre.slip");
  const o = lastOrder();
  assert.equal(o.status, "ออเดอร์ใหม่"); assert.equal(o.brand, "น้ำดื่มคิว");
  const c = S.d1.one("SELECT * FROM customers WHERE id = ?", o.customer_id);
  assert.equal(c.name, "ร้านตัวอย่าง Q"); assert.equal(c.district, "เถิน");
  // ลูกค้าเดิม: "เคยสั่ง" = ของที่เขาเคยสั่ง แตะแล้วได้ทั้งไลน์ + ถุงครั้งล่าสุด
  await p.locator(".sheet.on.modal button", { hasText: "ลงใบต่อไป" }).click();
  await p.locator(".cpick input").fill("ร้านตัวอย่าง Q");
  await p.locator(".sugg button", { hasText: "ร้านตัวอย่าง Q" }).first().click();
  await p.waitForSelector(".of-aside .usual-title:has-text('ร้านตัวอย่าง Q เคยสั่ง')");
  await p.locator(".of-aside .usual button").first().click();
  await p.waitForSelector(".line .qbtn:has-text('12')");
  assert.deepEqual(p.errors, []);
});

test("รายละเอียด (คอม = แผงขวา): ส่งเข้าคิว → ลูกค้ามารับ (ตัดสต๊อก) → ออกบิล (ประเภทต้องกดเอง) → เอกสารบิล · ไม่มีรหัสบนรายการ", async () => {
  const p = await page({ width: 1366, height: 900 });
  await p.locator(".queue", { hasText: "ออเดอร์ใหม่" }).click();
  const card = p.locator(".orders .ocard", { hasText: "ร้านตัวอย่าง Q" }).first();
  await card.click();
  await p.waitForSelector(".md-detail .dhead");
  assert.match(await p.locator(".md-detail .ref").innerText(), /รหัสอ้างอิง/);
  assert.ok(!/รหัสอ้างอิง/.test(await p.locator(".orders").innerText()));
  await p.locator(".md-detail button", { hasText: "ส่งเข้าคิวผลิต" }).click();
  await p.waitForSelector(".sheet.on.modal:has-text('ส่งเข้าคิว')");
  await p.locator(".sheet.on.modal .chip", { hasText: "ใช้ของในสต๊อก" }).first().click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ส่งเข้าคิว" }).click();
  await p.waitForSelector(".snack.on:has-text('ส่งเข้าคิว')");
  const o = lastOrder();
  assert.equal(S.d1.one("SELECT status FROM orders WHERE id = ?", o.id).status, "พร้อมส่ง");
  await p.waitForSelector(".md-detail button:has-text('ลูกค้ามารับ')");
  await p.locator(".md-detail button", { hasText: "ลูกค้ามารับ" }).first().click();
  await p.waitForSelector(".sheet.on.modal:has-text('ลูกค้ามารับที่โรงงาน')");
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "บันทึกว่ารับแล้ว" }).click();
  await p.waitForSelector(".snack.on:has-text('ลูกค้ารับของ')");
  assert.equal(S.d1.one("SELECT status FROM orders WHERE id = ?", o.id).status, "ส่งแล้ว");
  assert.ok(S.d1.one("SELECT count(*) n FROM stock_moves WHERE ref_entity = 'delivery_loads' AND move_type = 'ส่งออก'").n >= 1);
  await p.waitForSelector(".md-detail button:has-text('ออกบิล')");
  await p.locator(".md-detail button", { hasText: "ออกบิล" }).first().click();
  await p.waitForSelector(".sheet.on.modal:has-text('ประเภทบิล')");
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ออกบิล" }).click();
  assert.match(await p.locator(".sheet.on.modal p.err").innerText(), /เลือกก่อนว่าเป็นบิลเงินสดหรือบิลเครดิต/, "ประเภทบิลไม่มีค่าตั้งต้น");
  await p.locator(".sheet.on.modal .chip", { hasText: "บิลเครดิต" }).click();
  await p.locator(".sheet.on.modal .qbtn", { hasText: "ใส่ราคา" }).first().click();
  for (const d of "1.5") await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d.replace(".", "\\.") + "$") }).click();
  await p.locator(".sheet.on .btn.pri", { hasText: "ตกลง" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ออกบิล" }).click();
  await p.waitForSelector(".billdoc");
  const b = S.d1.one("SELECT * FROM bills WHERE order_id = ?", o.id);
  const qty = S.d1.one("SELECT qty_pcs FROM order_items WHERE order_id = ? AND status = 'ใช้งาน'", o.id).qty_pcs;
  assert.equal(b.kind, "เครดิต"); assert.equal(b.status, "ค้างชำระ"); assert.equal(b.total_satang, 150 * qty, "1.50 บาท × จำนวนที่ส่ง"); assert.equal(b.pay_channel, "", "ช่องทางไม่เดา");
  assert.match(await p.locator(".billdoc").innerText(), /รวมทั้งสิ้น/);
  assert.ok(await p.locator(".sheet.on button", { hasText: "พิมพ์ / PDF" }).isVisible());
  assert.ok(await p.locator(".sheet.on button", { hasText: "บันทึกเป็นรูป" }).isVisible());
  assert.deepEqual(p.errors, []);
});

test("แก้ไขออเดอร์: จากรายละเอียด → ฟอร์มเติมครบ → เปลี่ยนจำนวน → บันทึก → ประวัติโชว์ ก่อน → หลัง", async () => {
  const p = await page({ width: 1366, height: 900 });
  await p.locator(".queue", { hasText: "รอผลิต" }).click();
  await p.locator(".orders .ocard", { hasText: "ร้านตัวอย่าง C" }).first().click();
  await p.waitForSelector(".md-detail button:has-text('แก้ไข')");
  await p.locator(".md-detail button", { hasText: "แก้ไข" }).click();
  await p.waitForSelector(".banner:has-text('กำลังแก้ออเดอร์')");
  assert.equal(await p.locator("h1").innerText(), "แก้ออเดอร์");
  await p.locator(".line .qbtn", { hasText: "จำนวนถุง" }).click();
  await p.locator(".sheet.on .numpad button[aria-label='ลบ']").click();
  await pad(p, "7");
  await p.locator(".savebar .btn.pri", { hasText: "บันทึกการแก้ไข" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ยืนยันบันทึกการแก้ไข" }).click();
  await p.waitForSelector(".sheet.on.modal:has-text('แก้ไขแล้ว')");
  const it = S.d1.one("SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = 'CDC' AND o.src = 'v2' ORDER BY o.created_at DESC LIMIT 1");
  assert.equal(it.bags, 7); assert.equal(it.qty_pcs, 1400);
  await p.locator(".sheet.on.modal button", { hasText: "ดูรายละเอียด" }).click();
  await p.waitForSelector(".md-detail details.more");
  await p.locator(".md-detail details.more summary").click();
  assert.match(await p.locator(".md-detail .hist").innerText(), /แก้ออเดอร์ · แอน[\s\S]*ถุง 5 → 7/);
  assert.deepEqual(p.errors, []);
});

test("ลูกค้า: ค้น → รายละเอียด (หมายเหตุการค้าเด่น · เคยสั่ง · ออเดอร์) → แก้ข้อมูล (มีประวัติ) · สต๊อก: เกรด A แยก B", async () => {
  const p = await page();
  await p.locator("nav.nav a[data-key='customers']").click();
  await p.waitForSelector(".main .card");
  await p.locator("input[aria-label='ค้นลูกค้า']").fill("ตัวอย่าง c");
  await p.locator(".main .card", { hasText: "ร้านตัวอย่าง C" }).click();
  await p.waitForSelector(".sheet.on .lbl:has-text('ออเดอร์ล่าสุด')");
  await p.locator(".sheet.on .btn", { hasText: "แก้ข้อมูล" }).click();
  await p.waitForSelector(".sheet.on.modal:has-text('แก้ข้อมูล')");
  await p.locator(".sheet.on.modal textarea[aria-label^='หมายเหตุการค้า']").fill("เงินไม่ดีให้สั่งทางออฟฟิศ");
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "บันทึก" }).click();
  await p.waitForSelector(".cust-note:has-text('เงินไม่ดี')");
  assert.equal(S.d1.one("SELECT note FROM customers WHERE id = 'CDC'").note, "เงินไม่ดีให้สั่งทางออฟฟิศ");
  assert.ok(S.d1.one("SELECT count(*) n FROM audit_log WHERE action = 'office.customer_update' AND entity_id = 'CDC'").n >= 1);
  await p.keyboard.press("Escape");
  await p.locator("nav.nav a[data-key='stock']").click();
  await p.waitForSelector(".main .stock-cards, .main .banner");
  assert.match(await p.locator(".main").innerText(), /เกรด B แยกจากของดีเสมอ/);
  assert.deepEqual(p.errors, []);
});

for (const vp of [{ width: 320, height: 640 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test("ทุกหน้าออฟฟิศที่จอ " + vp.width + ": ไม่เลื่อนข้าง · ปุ่ม ≥ 44px · ไม่มีอีโมจิ · ไม่มี null/undefined/NaN · ไม่มี error", async () => {
    const p = await page(vp);
    for (const k of ["home", "orders", "customers", "deliver", "stock", "new"]) {
      await p.evaluate(k => { location.hash = "#/" + k; }, k);
      await p.waitForSelector(".main .card:visible, .main .empty:visible, .main .ntable:visible", { timeout: 8000 });
      await p.waitForTimeout(250);
      await p.keyboard.press("Escape");
      assert.ok(await noHScroll(p), k + " เลื่อนข้างได้ที่ " + vp.width);
      const small = await p.$$eval(".main button, .main a", els => els.filter(e => e.offsetParent !== null && !e.closest("details:not([open])") && !e.closest(".sugg"))
        .map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute("aria-label") || "").slice(0, 24), h: Math.round(r.height), w: Math.round(r.width) }; }).filter(x => x.h < 43.5 || x.w < 43.5));
      assert.deepEqual(small, [], k + " มีปุ่มเล็กกว่า 44px ที่ " + vp.width);
      const text = await p.locator("body").innerText();
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), k + " มีอีโมจิ");
      assert.ok(!/\bnull\b|undefined|NaN/.test(text), k + " มีคำว่า null/undefined/NaN บนจอ");
    }
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}
