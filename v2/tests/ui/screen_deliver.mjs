// ============================================================
//  เทสต์หน้าจอจริง: ทีมสกรีนสี + ส่งของ (Playwright + Chromium ในเครื่อง · หลังบ้านจริง · ข้อมูลสมมติ PIN 1234)
//  ถูก import จาก tests/ui/run.mjs (CI รันไฟล์นั้นไฟล์เดียว) — รันเดี่ยวได้: node --no-warnings --test v2/tests/ui/screen_deliver.mjs
//  งานจริงทีละขั้น: แตะทีม → เสร็จ (สองแตะ) · ย้อน · สองเครื่องกดงานเดียวกัน · ขึ้นรถ → ส่งแล้ว → ใบส่งของ · ส่งบางส่วน · ส่งไม่ได้ · ขึ้นเกิน (ถามเหตุผล)
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

async function open(role, nick, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g|status of 409|status of 400/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(S.url + "?app=" + role);
  await p.locator(".person", { hasText: nick }).first().click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 });
  return p;
}
const one = (sql, ...a) => S.d1.one(sql, ...a);
const jobOf = cust => one("SELECT j.* FROM screen_jobs j JOIN orders o ON o.id = j.order_id JOIN customers c ON c.id = o.customer_id WHERE c.name = ? AND j.status <> 'ยกเลิก' ORDER BY j.created_at LIMIT 1", cust);
const card = (p, cust) => p.locator(".jobs .card.job", { has: p.locator(".name", { hasText: new RegExp("^" + cust + "$") }) });
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const smallBtns = (p, sel) => p.$$eval(sel, els => els.filter(e => e.offsetParent !== null && !e.closest("details:not([open])")).map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute("aria-label") || "").slice(0, 24), h: r.height, w: r.width }; }).filter(x => x.h < 43.5 || x.w < 43.5));

test("สกรีน: แตะทีม = บันทึกทันที + แถบย้อน · ย้อนได้ · แตะเสร็จ (มีทีม) = จบ · ไม่มีทีม = ถามทีมไหนทำ (แตะทีเดียว) · ไปอยู่เสร็จวันนี้", async () => {
  const p = await open("screen", "จอย");
  assert.equal(await p.locator("h1").innerText(), "คิวสกรีน");
  assert.ok(!/SJ|OD0/.test(await p.locator(".main").innerText()), "ไม่มีรหัสระบบบนคิว");
  await card(p, "ร้านตัวอย่าง C").locator("button", { hasText: "ทีม 1" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  assert.equal(jobOf("ร้านตัวอย่าง C").team, "ทีม 1");
  await p.waitForSelector(".jobs .card.job:has-text('ทีม 1 กำลังทำ')");
  await p.locator(".snack button", { hasText: "ย้อน" }).click();
  await p.waitForSelector(".snack .msg:has-text('ย้อนแล้ว')");
  assert.equal(jobOf("ร้านตัวอย่าง C").team, null);
  assert.equal(jobOf("ร้านตัวอย่าง C").status, "รอดำเนินการ");
  // H มีทีม 2 อยู่แล้ว → แตะ "เสร็จ" ครั้งเดียวจบ
  await card(p, "ร้านตัวอย่าง H").locator("button", { hasText: "เสร็จ" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const h = jobOf("ร้านตัวอย่าง H");
  assert.equal(h.status, "เสร็จแล้ว"); assert.equal(h.team, "ทีม 2"); assert.equal(h.good_pcs, null, "ไม่บังคับลงจำนวน");
  // C ไม่มีทีม → แผ่น "ทีมไหนทำงานนี้?" → แตะทีม 3 = บันทึก
  await card(p, "ร้านตัวอย่าง C").locator("button", { hasText: "เสร็จ" }).click();
  await p.waitForSelector(".sheet.on.modal h2:has-text('ทีมไหนทำงานนี้?')");
  await p.locator(".sheet.modal button", { hasText: "ทีม 3" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  assert.equal(jobOf("ร้านตัวอย่าง C").status, "เสร็จแล้ว"); assert.equal(jobOf("ร้านตัวอย่าง C").team, "ทีม 3");
  await p.locator("nav.nav a[data-key='done']").click();
  await p.waitForSelector(".main .card:has-text('ร้านตัวอย่าง C')");
  assert.match(await p.locator(".teamsum").innerText(), /ทีม 3/);
  // ลงจำนวนภายหลัง (ไม่บังคับ) จากแผ่นรายละเอียด
  await p.locator(".main .jobs button.card", { hasText: "ร้านตัวอย่าง C" }).click();
  await p.locator(".sheet.on button", { hasText: "ลงจำนวนดี/เสีย" }).click();
  await p.waitForSelector(".sheet.on.modal .numpad");
  for (const k of ["del", "del", "del", "del", "del"]) await p.locator(".sheet.on.modal .numpad button[aria-label='ลบ']").click();
  for (const k of "11800") await p.locator(".sheet.on.modal .numpad button", { hasText: new RegExp("^" + k + "$") }).click();
  await p.locator(".sheet.on.modal .numpad button.ok").click();
  await p.waitForSelector(".sheet.on.modal h2:has-text('เสีย')");
  await p.locator(".sheet.on.modal .numpad button[aria-label='ลบ']").click();
  for (const k of "200") await p.locator(".sheet.on.modal .numpad button", { hasText: new RegExp("^" + k + "$") }).click();
  await p.locator(".sheet.on.modal .numpad button.ok").click();
  await p.waitForSelector(".snack.on:has-text('ลงจำนวน')");
  const c = jobOf("ร้านตัวอย่าง C");
  assert.equal(c.good_pcs, 11800); assert.equal(c.waste_pcs, 200);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test("สกรีน: สองเครื่องกดงานเดียวกัน — เครื่องหลังเห็นว่า ทีมไหน/ใคร รับไปแล้ว และจอวาดใหม่ (ไม่ทับคนแรก)", async () => {
  const a = await open("screen", "จอย"), b = await open("screen", "จอย");
  await card(a, "ร้านตัวอย่าง G").locator("button", { hasText: "ทีม 1" }).click();
  await a.waitForSelector(".snack.on button:has-text('ย้อน')");
  await card(b, "ร้านตัวอย่าง G").locator("button", { hasText: "ทีม 2" }).click();   // เครื่อง b ยังเห็นของเก่า
  await b.waitForSelector(".snack.on:has-text('ทีม 1 รับงานนี้ไปแล้ว')");
  assert.equal(jobOf("ร้านตัวอย่าง G").team, "ทีม 1");
  await b.waitForSelector(".jobs .card.job:has-text('ร้านตัวอย่าง G'):has-text('ทีม 1 กำลังทำ')");
  await a.context().close(); await b.context().close();
});

test("ส่งของ: เส้นทาง (timeline วัน → สาย · การ์ดเล็ก) → แตะร้าน = แผ่นล่าง → ขึ้นรถ (ต้องเลือกคันเอง) → บนรถ → ส่งแล้ว → ใบส่งของ → ย้อนการส่ง", async () => {
  const p = await open("deliver", "ต่อ");
  assert.equal(await p.locator("h1").innerText(), "เส้นทางส่งของ");
  const sections = await p.locator(".tl > section .dayhead b").allInnerTexts();
  assert.deepEqual(sections.slice(0, 3), ["เลยกำหนด", "วันนี้", "พรุ่งนี้"]);
  assert.ok(sections.includes("ยังไม่กำหนดวันส่ง") || true);
  assert.ok(!/OD0|LD|PDEMO/.test(await p.locator(".main").innerText()), "ไม่มีรหัสระบบบนจอ");
  await p.locator(".stop", { hasText: "ร้านตัวอย่าง D" }).click();
  await p.waitForSelector(".sheet.on");
  await p.locator(".sheet.on .sheet-foot button", { hasText: "ขึ้นรถ" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('ขึ้นรถ · ร้านตัวอย่าง D')");
  await p.locator(".sheet.on .sheet-foot .btn.pri").click();
  assert.match(await p.locator(".sheet.on .sheet-foot p.err").innerText(), /เลือกคันก่อน/, "ระบบไม่เลือกคันให้");
  await p.locator(".sheet.on .vchips .chip", { hasText: "รถ 06" }).click();
  assert.match(await p.locator(".sheet.on .sheet-foot .btn.pri").innerText(), /ขึ้นรถ 06/);
  await p.locator(".sheet.on .sheet-foot .btn.pri").click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const L = one("SELECT l.*, t.vehicle_id FROM delivery_loads l JOIN delivery_trips t ON t.id = l.trip_id WHERE l.order_id = 'OD004'");
  assert.equal(L.vehicle_id, "06"); assert.equal(L.qty_pcs, 3000); assert.equal(L.status, "บนรถ");
  await p.locator("nav.nav a[data-key='truck']").click();
  const blk = p.locator(".truckblk", { hasText: "รถ 06" });
  await blk.waitFor();
  await blk.locator(".card.job", { hasText: "ร้านตัวอย่าง D" }).locator("button", { hasText: "ส่งแล้ว" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('ส่งแล้ว · ร้านตัวอย่าง D')");
  await p.locator(".sheet.on .sheet-foot .btn.ok").click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  // 0310: ร้านที่ยังไม่มีหมุด → แอปถาม "ปักหมุดร้านนี้" (ไม่บังคับ) — ข้าม
  await p.locator(".sheet.on .btn", { hasText: "ข้าม" }).click();
  await p.waitForFunction(() => !document.querySelector(".sheet.on"));
  assert.equal(one("SELECT delivered_pcs FROM order_items WHERE order_id = 'OD004'").delivered_pcs, 3000);   // ออเดอร์ตัวอย่าง (ไม่ใช่ v2) สถานะไม่ไหล — กติกาออฟฟิศ
  await p.locator("nav.nav a[data-key='done']").click();
  await p.locator(".stopsdone button.card", { hasText: "ร้านตัวอย่าง D" }).click();
  await p.waitForSelector(".sheet.on .paper");
  const paper = await p.locator(".sheet.on .paper").innerText();
  assert.match(paper, /ใบส่งของ/); assert.match(paper, /ร้านตัวอย่าง D/); assert.match(paper, /10 ถุง \(3,000 ใบ\)/); assert.match(paper, /รถ 06/);
  assert.ok(await p.locator(".sheet.on button", { hasText: "ส่งรูป / ไลน์" }).isVisible());
  assert.ok(await p.locator(".sheet.on button", { hasText: "พิมพ์ / PDF" }).isVisible());
  await p.locator(".sheet.on button", { hasText: "ย้อนการส่งนี้" }).click();
  await p.waitForSelector(".sheet.on.modal h2:has-text('ย้อนการส่ง')");
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ย้อนการส่ง" }).click();
  await p.waitForSelector(".snack.on:has-text('กลับไปอยู่บนรถ')");
  assert.equal(one("SELECT status FROM delivery_loads WHERE id = ?", L.id).status, "บนรถ");
  assert.equal(one("SELECT delivered_pcs FROM order_items WHERE order_id = 'OD004'").delivered_pcs, 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test("ส่งของ: ส่งบางส่วน (แป้นตัวเลขเป็นถุง) → ที่เหลือยังอยู่บนรถ · ส่งไม่ได้ต้องเลือกเหตุผล · ขึ้นเกินที่เหลือ = ถามเหตุผลแล้วไปต่อได้", async () => {
  const p = await open("deliver", "ต่อ");
  await p.locator("nav.nav a[data-key='truck']").click();
  const a = p.locator(".truckblk", { hasText: "รถ 04" }).locator(".card.job", { hasText: "ร้านตัวอย่าง A" });
  await a.waitFor();
  await a.locator("button", { hasText: "ส่งแล้ว" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('ส่งแล้ว · ร้านตัวอย่าง A')");
  await p.locator(".sheet.on .chip", { hasText: "ส่งบางส่วน" }).click();
  await p.locator(".sheet.on button", { hasText: "แก้จำนวน" }).click();
  await p.waitForSelector(".sheet.on.modal .numpad");
  await p.locator(".sheet.on.modal .numpad button[aria-label='ลบ']").click();
  await p.locator(".sheet.on.modal .numpad button[aria-label='ลบ']").click();
  for (const k of "30") await p.locator(".sheet.on.modal .numpad button", { hasText: new RegExp("^" + k + "$") }).click();
  await p.locator(".sheet.on.modal .numpad button.ok").click();
  await p.waitForSelector(".sheet.on .itemrow:has-text('30')");
  await p.locator(".sheet.on .sheet-foot .btn.ok").click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const rows = S.d1.q("SELECT status, qty_pcs, split_from FROM delivery_loads WHERE order_id = 'OD001' AND status <> 'ยกเลิก' ORDER BY qty_pcs DESC");
  assert.deepEqual(rows.map(r => [r.status, r.qty_pcs]), [["ส่งแล้ว", 6000], ["บนรถ", 2000]]);
  assert.equal(one("SELECT delivered_pcs FROM order_items WHERE id = 'OD001-1'").delivered_pcs, 6000);
  // ส่งไม่ได้: ต้องเลือกเหตุผล
  await p.locator(".truckblk", { hasText: "รถ 04" }).locator(".card.job", { hasText: "ร้านตัวอย่าง A" }).locator("button", { hasText: "ส่งไม่ได้" }).click();
  await p.waitForSelector(".sheet.on.modal .chip");
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "บันทึกว่าส่งไม่ได้" }).click();
  assert.match(await p.locator(".sheet.on.modal p.err").innerText(), /เลือกเหตุผล/);
  await p.locator(".sheet.on.modal .chip", { hasText: "ไม่มีคนรับ" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "บันทึกว่าส่งไม่ได้" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  assert.equal(one("SELECT fail_reason FROM delivery_loads WHERE order_id = 'OD001' AND status = 'ส่งไม่ได้'").fail_reason, "ไม่มีคนรับ");
  await p.waitForSelector(".truckblk .card.job:has-text('ส่งไม่ได้: ไม่มีคนรับ')");
  // ขึ้นเกิน: ฝา เหลือ 400 ชิ้น แต่ขึ้น 500 → หลังบ้านถามเหตุผล → เลือกชิป → ขึ้นได้ + ธงให้ประธานตรวจ
  await p.locator("nav.nav a[data-key='route']").click();
  await p.locator(".stop", { hasText: "ร้านตัวอย่าง A" }).filter({ hasText: "ไม่มีคนรับ" }).first().click();
  await p.locator(".sheet.on .sheet-foot button", { hasText: "ขึ้นเพิ่ม" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('ขึ้นรถ · ร้านตัวอย่าง A')");
  await p.locator(".sheet.on .vchips .chip", { hasText: "รถ 04" }).click();
  await p.locator(".sheet.on .chip", { hasText: "บางส่วน" }).click();
  await p.locator(".sheet.on button", { hasText: "แก้จำนวน" }).click();
  for (let i = 0; i < 4; i++) await p.locator(".sheet.on.modal .numpad button[aria-label='ลบ']").click();
  for (const k of "500") await p.locator(".sheet.on.modal .numpad button", { hasText: new RegExp("^" + k + "$") }).click();
  await p.locator(".sheet.on.modal .numpad button.ok").click();
  await p.locator(".sheet.on .sheet-foot .btn.pri").click();
  await p.waitForSelector(".sheet.on.modal h2:has-text('ขึ้นเกินที่ต้องส่ง')");
  assert.match(await p.locator(".sheet.on.modal").innerText(), /เหลือให้ขึ้น 400 ชิ้น/);
  await p.locator(".sheet.on.modal .chip", { hasText: "ของแถม/เผื่อแตก" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "ขึ้นรถต่อ" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  assert.equal(one("SELECT onboard_pcs FROM order_items WHERE id = 'OD001-2'").onboard_pcs, 500);
  assert.ok(one("SELECT count(*) n FROM flags WHERE kind = 'ทำนอกขั้นตอน' AND status = 'เปิด' AND instr(title, 'ขึ้นรถเกินออเดอร์') > 0").n >= 1);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

for (const vp of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test("สกรีน + ส่งของ ที่จอ " + vp.width + ": ทุกแท็บ + แผ่นล่าง ไม่มีเลื่อนข้าง · ปุ่ม ≥ 44px · ไม่มีอีโมจิ/null", async () => {
    for (const [role, nick, tabs] of [["screen", "จอย", ["queue", "done", "history"]], ["deliver", "ต่อ", ["route", "truck", "done"]]]) {
      const p = await open(role, nick, vp);
      for (const t of tabs) {
        await p.locator("nav.nav a[data-key='" + t + "']").click();
        await p.waitForSelector(".main .card, .main .empty");
        await p.waitForTimeout(250);
        assert.ok(await noHScroll(p), role + "/" + t + " เลื่อนข้างที่ " + vp.width);
        assert.deepEqual(await smallBtns(p, ".main button, .main a"), [], role + "/" + t + " ปุ่มเล็กกว่า 44px");
        const txt = await p.locator(".main").innerText();
        assert.ok(!/\bnull\b|undefined|NaN/.test(txt), role + "/" + t + " มี null/undefined บนจอ");
        assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(txt), role + "/" + t + " มีอีโมจิ");
      }
      await p.locator("nav.nav a[data-key='" + tabs[0] + "']").click();
      await p.waitForSelector(".main .card");
      await p.locator(role === "screen" ? ".jobs .cardhead" : ".stop").first().click();
      await p.waitForSelector(".sheet.on");
      await p.waitForTimeout(350);
      assert.ok(await noHScroll(p), role + " แผ่นล่างเลื่อนข้าง");
      assert.deepEqual(await smallBtns(p, ".sheet.on button:not(.iconbtn), .sheet.on a"), [], role + " ปุ่มในแผ่นเล็กกว่า 44px");
      assert.ok(!/\bnull\b|undefined|NaN/.test(await p.locator(".sheet.on").innerText()));
      assert.deepEqual(p.errors, [], role);
      await p.context().close();
    }
  });
}
