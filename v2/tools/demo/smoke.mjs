// ============================================================
//  smoke เดโมทั้งระบบ (ไฟล์ที่ build แล้ว) — Playwright + Chromium ในเครื่อง                  v2/tools/demo/smoke.mjs
//    node v2/tools/build-demo.mjs && node --no-warnings v2/tools/demo/smoke.mjs [ไฟล์เดโม] [--shots โฟลเดอร์]
//  ห่อไฟล์ด้วยโครง doctype/head/body แบบเดียวกับที่ Artifact ห่อ · เสิร์ฟพร้อม CSP ที่ห้ามออกเน็ต (connect-src 'none')
//  จอมือถือ 390 = CSP ไม่อนุญาต wasm (พิสูจน์ว่าสลับไปรุ่น asm.js ได้เอง) · จอคอม 1366 = wasm
//  ทุกจอ: เลือกแอป → เข้าระบบ (PIN 1234) → ทำรายการหลัก 1 อย่างต่อแอป → ไม่มี error ในคอนโซล · ไม่เลื่อนข้าง
//  + จำข้อมูลข้ามการโหลดหน้า · ปุ่ม "เริ่มใหม่" ล้างจริง · ประธานสลับแอปในหน้า · นำเข้าจากชีต = บอก "ไม่มีในโหมดตัวอย่าง"
// ============================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
const args = process.argv.slice(2);
const shotsAt = args.indexOf("--shots");
const SHOTS = shotsAt >= 0 ? args[shotsAt + 1] : "";
const FILE = path.resolve(args.find((a, i) => !a.startsWith("--") && (shotsAt < 0 || i !== shotsAt + 1)) || path.join(HERE, "..", "..", "dist", "demo", "pk-v2-demo.html"));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const body = fs.readFileSync(FILE, "utf8");
const page0 = '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + body + "</body></html>";
const csp = wasm => "default-src 'none'; script-src 'unsafe-inline'" + (wasm ? " 'wasm-unsafe-eval'" : "") + "; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'";
const srv = http.createServer((q, r) => {
  r.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp(!q.url.includes("nowasm")), "cache-control": "no-store" });
  r.end(page0);
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + srv.address().port + "/";
const browser = await pw.chromium.launch();
const results = [];

const digits = async (p, s) => { for (const d of s) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d + "$") }).last().click(); };
async function pickApp(p, role) {
  if (await p.locator("#demo-bar [data-act=apps]").isVisible()) await p.locator("#demo-bar [data-act=apps]").click();
  await p.locator('.demo-app[data-app="' + role + '"]').click();
}
async function login(p, nick) {
  await p.locator(".person", { hasText: nick }).first().click();
  await digits(p, "1234");
}
async function gatePin(p, nick) {   // ทีมผลิต: ใครบันทึก + PIN
  await p.waitForSelector(".sheet.on.modal .numpad, .sheet.on.modal .person");
  if (await p.locator(".sheet.on.modal .person").count()) await p.locator(".sheet.on.modal .person", { hasText: nick }).click();
  await p.waitForSelector(".sheet.on.modal .pin-dots");
  await digits(p, "1234");
}
const snackUndo = p => p.waitForSelector(".snack.on button:has-text('ย้อน')", { timeout: 10000 });
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const tile = (p, name) => p.locator(".pf-tile", { has: p.locator(".nm", { hasText: new RegExp("^" + name + "$") }) });

const FLOWS = {
  async office(p) {   // ลงออเดอร์
    await login(p, "แอน");
    await p.waitForSelector(".fab");
    await p.locator(".fab", { hasText: "ลงออเดอร์" }).click();
    await p.locator(".cpick input").fill("ตัวอย่างc");
    await p.locator(".sugg button", { hasText: "ร้านตัวอย่าง C" }).click();
    await p.waitForSelector(".sheet.on .axgrid");
    for (const t of ["ขวด", "600 ml", "คอยาว", "MK", "ใส", "ไม่สกรีน", "ไม่มีฝา"]) await p.locator(".sheet.on .axgrid button", { hasText: new RegExp("^" + t) }).first().click();
    await p.waitForSelector(".sheet.on .numpad");
    await digits(p, "8"); await p.locator(".sheet.on .numpad button.ok").click();
    await p.locator(".wd", { hasText: "พรุ่งนี้" }).click();
    await p.locator(".savebar .btn.pri").click();
    await p.locator(".sheet.on.modal .btn.pri", { hasText: "ยืนยันบันทึก" }).click();
    await p.waitForSelector(".sheet.on.modal pre.slip");
    assert.match(await p.locator("pre.slip").innerText(), /ร้านตัวอย่าง C[\s\S]*8 ถุง/);
    await p.locator(".sheet.on.modal button", { hasText: "ลงใบต่อไป" }).click();
    return "ลงออเดอร์ร้านตัวอย่าง C 8 ถุง";
  },
  async prod(p) {   // เปิดรอบ + ปิดรอบ
    await login(p, "บอส");
    await p.waitForSelector(".pf-tiles .pf-tile");
    await tile(p, "PET 5").click();
    await p.locator(".sheet.on .btn.pri", { hasText: "เปิดรอบ" }).click();
    await p.waitForSelector(".sheet.on .pf-form .chip");
    const sh = p.locator(".sheet.on").last();
    await sh.locator(".chip", { hasText: "500 ml" }).first().click();
    await sh.locator(".chip", { hasText: "ใส" }).first().click();
    await sh.locator("[aria-label='ผู้ปฏิบัติงาน'] .chip", { hasText: "เก่ง" }).click();
    await sh.locator(".btn.pri", { hasText: "เปิดรอบ" }).click();
    await gatePin(p, "เก่ง");
    await snackUndo(p);
    await p.waitForSelector(".pf-tile.s-run .nm:text-is('PET 5')");
    await tile(p, "PET 1").click();
    await p.locator(".sheet.on .btn.pri", { hasText: "ปิดรอบ" }).click();
    await p.waitForSelector(".sheet.on .cnt");
    const c = p.locator(".sheet.on").last();
    await digits(p, "2000"); await c.locator(".numpad button[aria-label='ไปช่องถัดไป']").click();
    await digits(p, "12"); await c.locator(".numpad button[aria-label='ไปช่องถัดไป']").click();
    await digits(p, "30");
    await c.locator(".btn.pri", { hasText: "ปิดรอบ" }).click();
    await gatePin(p, "เก่ง");
    await p.waitForFunction(() => !document.querySelector(".sheet.on.modal"));
    await p.waitForSelector(".snack.on");
    return "เปิดรอบ PET 5 · ปิดรอบ PET 1 (ดี 2,000)";
  },
  async screen(p) {   // สกรีนเสร็จ
    await login(p, "จอย");
    const card = p.locator(".jobs .card.job", { hasText: "ร้านตัวอย่าง H" }).first();
    await card.waitFor();
    await card.locator("button", { hasText: "เสร็จ" }).click();
    await snackUndo(p);
    return "งานสกรีนร้านตัวอย่าง H เสร็จ";
  },
  async deliver(p) {   // ขึ้นรถ → ส่งแล้ว
    await login(p, "ต่อ");
    await p.locator(".stop", { hasText: "ร้านตัวอย่าง D" }).first().click();
    await p.locator(".sheet.on .sheet-foot button", { hasText: "ขึ้นรถ" }).click();
    await p.waitForSelector(".sheet.on h2:has-text('ขึ้นรถ · ร้านตัวอย่าง D')");
    await p.locator(".sheet.on .vchips .chip", { hasText: "รถ 06" }).click();
    await p.locator(".sheet.on .sheet-foot .btn.pri").click();
    await snackUndo(p);
    await p.locator("nav.nav a[data-key='truck']").click();
    const blk = p.locator(".truckblk", { hasText: "รถ 06" });
    await blk.waitFor();
    await blk.locator(".card.job", { hasText: "ร้านตัวอย่าง D" }).locator("button", { hasText: "ส่งแล้ว" }).click();
    await p.waitForSelector(".sheet.on h2:has-text('ส่งแล้ว · ร้านตัวอย่าง D')");
    await p.locator(".sheet.on .sheet-foot .btn.ok").click();
    await snackUndo(p);
    const skip = await p.waitForSelector(".sheet.on .btn:has-text('ข้าม')", { timeout: 4000 }).catch(() => null);   // ร้านยังไม่มีหมุด → ถามปักหมุด (ไม่บังคับ)
    if (skip) await skip.click();
    await p.waitForFunction(() => !document.querySelector(".sheet.on"));
    return "ร้านตัวอย่าง D ขึ้นรถ 06 → ส่งแล้ว";
  },
  async account(p) {   // รับชำระ
    await login(p, "ฝ้าย");
    await p.waitForSelector("nav.nav");
    await p.locator("nav.nav a[data-key='owing']").click();
    await p.locator(".main button.card", { hasText: "ร้านตัวอย่าง H" }).first().click();
    await p.waitForSelector(".sheet.on");
    await p.locator(".sheet.on .sheet-body button.card").first().click();
    await p.locator(".sheet.on button", { hasText: "รับชำระที่เลือก" }).click();
    await p.waitForSelector(".sheet.on h2:has-text('รับชำระ')");
    await p.locator(".sheet.on .chip", { hasText: "KTB" }).click();
    await p.locator(".sheet.on .sheet-foot .btn.pri").click();
    await snackUndo(p);
    return "รับชำระร้านตัวอย่าง H (โอน KTB)";
  },
  async exec(p) {   // ดูผัง + นำเข้า (บอกไม่มีในโหมดตัวอย่าง) + สลับแอป
    await login(p, "หัวหน้า");
    await p.waitForSelector("nav.nav a[data-key='floor']");
    await p.locator("nav.nav a[data-key='floor']").click();
    await p.waitForSelector(".pf-tile");
    const n = await p.locator(".pf-tile").count();
    assert.ok(n >= 10, "ผังมีเครื่อง " + n);
    await shot(p, "exec-floor-" + p.viewportSize().width);
    await p.locator("nav.nav a[data-key='team']").click();
    const row = p.locator(".card, .row, div", { has: p.locator("button", { hasText: /^นำเข้า$/ }) }).filter({ hasText: /พนักงาน/ }).last();
    await row.locator("button", { hasText: /^นำเข้า$/ }).first().click();
    await p.waitForSelector("text=ไม่มีในโหมดตัวอย่าง", { timeout: 8000 });
    // ประธานสลับไปแอปบัญชีจากปุ่มชื่อ (ลิงก์ ?app= → สลับในหน้า)
    await p.locator(".me-chip").click();
    await p.locator(".sheet.on a.chip", { hasText: "บัญชี" }).click();
    await p.waitForSelector("nav.nav a[data-key='owing']");
    assert.equal(await p.evaluate(() => window.__pkDemoState().current), "account");
    return "ดูผัง " + n + " เครื่อง · นำเข้าพนักงาน → ไม่มีในโหมดตัวอย่าง · สลับไปแอปบัญชี";
  },
};
const NAMES = { office: "ออฟฟิศ", prod: "ทีมผลิต", screen: "ทีมสกรีนสี", deliver: "ส่งของ", account: "บัญชี", exec: "ประธาน" };

for (const vp of [{ width: 390, height: 844, wasm: false }, { width: 1366, height: 768, wasm: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/fonts\.g|net::ERR_FAILED/.test(m.text()) && !(!vp.wasm && /WebAssembly/.test(m.text()))) errors.push(m.text()); });   // จอที่ตั้งใจห้าม wasm: ข้อความ CSP ตอนลองเปิด wasm ครั้งเดียว
  const t0 = Date.now();
  await p.goto(BASE + (vp.wasm ? "" : "?nowasm"));
  await p.waitForSelector(".demo-app", { timeout: 30000 });
  const st = await p.evaluate(() => window.__pkDemoState());
  const seeded = st.v2orders;
  assert.equal(st.engine, vp.wasm ? "wasm" : "asm", "เครื่องยนต์ฐาน");
  results.push(vp.width + ": เปิดหน้าเลือกแอป " + (Date.now() - t0) + " ms · ฐาน " + st.engine + " · จำในเครื่อง " + st.persist);
  assert.ok(await noHScroll(p), "หน้าเลือกแอปเลื่อนข้างได้");
  await shot(p, "picker-" + vp.width);
  for (const role of Object.keys(FLOWS)) {
    await pickApp(p, role);
    await p.waitForSelector(".person, nav.nav", { timeout: 10000 });
    const t = Date.now();
    const did = await FLOWS[role](p);
    assert.ok(await noHScroll(p), role + " เลื่อนข้างได้ที่ " + vp.width);
    await shot(p, role + "-" + vp.width);
    results.push(vp.width + " " + NAMES[role] + ": " + did + " (" + (Date.now() - t) + " ms)");
  }
  // จำข้ามการโหลดหน้า → เริ่มใหม่ล้างจริง
  const before = (await p.evaluate(() => window.__pkDemoState())).v2orders;
  assert.equal(before, seeded + 1, "ต้องมีออเดอร์ที่ลงในเดโมเพิ่ม 1 ใบ");
  await p.waitForTimeout(1200);   // ให้บันทึกลงเครื่องทัน (หน่วง 0.6 วิ)
  await p.reload();
  await p.waitForSelector(".demo-app", { timeout: 30000 });
  await pickApp(p, "office");
  await p.waitForSelector("nav.nav");
  assert.equal((await p.evaluate(() => window.__pkDemoState())).v2orders, before, "โหลดหน้าใหม่แล้วออเดอร์ที่ลงไว้ต้องยังอยู่");
  await p.locator("#demo-bar [data-act=reset]").click();
  await p.locator("#demo-bar [data-act=reset-yes]").click();
  await p.waitForSelector("nav.nav, .person", { timeout: 20000 });
  const fresh = await p.evaluate(async () => {
    const r = await fetch("api/call", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + JSON.parse(localStorage.getItem("pk2.session")).ticket }, body: JSON.stringify({ action: "home.office", as: "office", input: {} }) });
    return r.status;
  });
  assert.equal(fresh, 200, "หลังเริ่มใหม่ ตั๋วเดิมยังใช้ได้");
  assert.equal((await p.evaluate(() => window.__pkDemoState())).v2orders, seeded, "เริ่มใหม่ต้องล้างออเดอร์ที่ลองไว้");
  results.push(vp.width + ": โหลดหน้าใหม่ = ออเดอร์ที่ลงไว้ยังอยู่ · เริ่มใหม่ = ตั้งข้อมูลใหม่");
  assert.deepEqual(errors, [], "error ในคอนโซลที่จอ " + vp.width);
  await ctx.close();
}
await browser.close();
srv.close();
console.log(results.map(r => "  ✓ " + r).join("\n"));
console.log("ผ่านทั้งหมด · ไม่มี error ในคอนโซล");
