// ============================================================
//  ถ่ายภาพหน้าจอทุกบทบาท (ข้อมูลสมมติ) — 390×844 และ 1366×768 + สถานะชิ้นส่วนกลาง
//    node --no-warnings v2/tools/shots.mjs [โฟลเดอร์ปลายทาง]   (ค่าตั้งต้น v2/docs/shots)
//  ใช้ Chromium ที่ติดตั้งในเครื่องแล้ว (ห้ามติดตั้ง playwright ใหม่)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startDev } from "./dev-server.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, "..", "docs", "shots"));
const ROLES = [["office", "แอน"], ["prod", "บอส"], ["screen", "จอย"], ["deliver", "ต่อ"], ["account", "ฝ้าย"], ["exec", "หัวหน้า"]];

fs.mkdirSync(OUT, { recursive: true });
const S = await startDev({ mem: true });
const browser = await pw.chromium.launch();
const shots = [];
async function open(role, nick, vp, extra) {
  const ctx = await browser.newContext(Object.assign({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 }, extra || {}));
  const p = await ctx.newPage();
  await p.goto(S.url + "?app=" + role);
  await p.locator(".person", { hasText: nick }).first().click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector(".main .card, .main .empty");
  await p.evaluate(() => document.fonts && document.fonts.ready);
  await p.waitForTimeout(700);
  return p;
}
async function snap(p, name, caption) {
  const file = path.join(OUT, name + ".jpg");
  await p.screenshot({ path: file, type: "jpeg", quality: 72 });
  shots.push({ file: path.basename(file), caption });
}
for (const [role, nick] of ROLES) {
  for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    const p = await open(role, nick, vp);
    await snap(p, role + "-" + vp.width, role + " · " + vp.width);
    await p.context().close();
  }
}
// สถานะชิ้นส่วนกลาง (390)
{
  const p = await open("office", "แอน", { width: 390, height: 844 });
  await p.locator(".orders button.card").first().click(); await p.waitForTimeout(500);
  await snap(p, "x-sheet-390", "แผ่นล่างรายละเอียดออเดอร์");
  await p.context().close();
}
{
  const p = await open("prod", "บอส", { width: 390, height: 844 });
  await p.locator(".floor .mc", { hasText: "PET 1" }).first().click(); await p.waitForTimeout(500);
  await snap(p, "x-machine-390", "แตะเครื่อง = แผ่นล่าง");
  await p.locator(".sheet button", { hasText: "แจ้งปัญหาเครื่องนี้" }).click(); await p.waitForTimeout(500);
  await p.locator(".sheet.modal .chip", { hasText: "ไฟดับ" }).click();
  await snap(p, "x-confirm-390", "แผ่นยืนยัน + ชิปเหตุผล");
  await p.locator(".sheet.modal .btn.pri").click(); await p.waitForTimeout(600);
  await snap(p, "x-whosave-390", "ทีมผลิต: ใครบันทึก + PIN");
  await p.locator(".sheet.modal .person").first().click();
  for (const d of "1234") await p.locator(".sheet.on.modal .numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector(".snack.on"); await p.waitForTimeout(300);
  await snap(p, "x-undo-390", "แถบ ย้อน หลังบันทึก");
  await p.context().close();
}
{
  const p = await open("office", "แอน", { width: 390, height: 844 }, { colorScheme: "dark" });
  await snap(p, "x-dark-390", "โหมดมืด");
  await p.context().close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(S.url + "?app=office"); await p.waitForSelector(".person"); await p.waitForTimeout(400);
  await snap(p, "x-login-390", "เข้าระบบ: แตะการ์ดชื่อ");
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(shots, null, 1));
await browser.close(); await S.close();
console.log("ถ่ายแล้ว " + shots.length + " ภาพ → " + OUT);
