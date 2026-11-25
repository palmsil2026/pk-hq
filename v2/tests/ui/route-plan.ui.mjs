import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startDev } from "../../tools/dev-server.mjs";
import { addDays, thaiDay } from "../../server/core.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node-tools/node_modules/playwright"); }

const shots = process.env.PK_ROUTE_PLAN_SHOTS;
let browser;
before(async () => {
  browser = await pw.chromium.launch();
  if (shots) await mkdir(shots, { recursive: true });
});
after(async () => { await browser?.close(); });

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test("สกรีน › จัดสายส่ง: หมุด ย้ายงวด ดูยอดขวด และประกาศ ที่ " + viewport.width, async () => {
    const S = await startDev({ mem: true });
    const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
    try {
      if (!shots) await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => {
        if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g/.test(m.text())) errors.push(m.text());
      });
      const mobile = viewport.width === 390;
      const board = page.locator(mobile ? ".rp-mobile" : ".rp-desktop");
      const dialog = page.locator(".sheet.on").last();
      const today = thaiDay(S.clock());
      await page.goto(S.url + "?app=screen");
      await page.locator(".person", { hasText: "จอย" }).click();
      for (const digit of "1234") await page.getByRole("button", { name: digit, exact: true }).click();
      await page.getByRole("link", { name: "จัดสายส่ง" }).click();
      await page.locator(".rp-overview .btn.pri:enabled").waitFor();
      assert.equal(await (mobile ? board.locator(".rp-date") : board.locator(".rp-column")).count(), 7);
      assert.match(await page.locator(".rp-range").innerText(), /อำเภอเมืองส่งได้ทุกวัน/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.evaluate(() => document.fonts.ready);
      if (shots) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(shots, "calendar-" + viewport.width + ".png") });
      }

      await page.getByRole("button", { name: "ขวดที่ต้องมี", exact: true }).click();
      await page.getByRole("heading", { name: "ต้องเป่าเพิ่ม" }).waitFor();
      await page.getByRole("heading", { name: "ต้องสกรีน" }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (shots) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(shots, "bottles-" + viewport.width + ".png") });
      }
      await page.getByRole("button", { name: "ปฏิทิน", exact: true }).click();

      if (mobile) await board.locator(".rp-date").nth(2).click();
      const col = mobile ? board.locator(".rp-column") : board.locator(".rp-column").nth(2);
      await col.getByRole("button", { name: /หมุดสาย/ }).click();
      await dialog.getByRole("button", { name: "เถิน", exact: true }).click();
      await dialog.getByRole("button", { name: "บันทึกหมุดสาย", exact: true }).click();
      await col.locator(".rp-pin", { hasText: "เถิน" }).waitFor();

      if (mobile) await board.getByRole("button", { name: /^รอลงวัน / }).click();
      const reserve = board.locator(".rp-tray").getByRole("button", { name: "ร้านตัวอย่าง J", exact: true });
      await reserve.click();
      await dialog.locator(".rp-choice").nth(2).click();
      await page.waitForFunction(() => !document.querySelector(".sheet.on"));
      await col.getByRole("button", { name: /ร้านตัวอย่าง J/ }).waitFor();
      assert.equal(S.d1.one("SELECT plan_day FROM order_rounds WHERE id = 'RDP21'").plan_day, addDays(today, 2));

      await page.locator(".rp-overview").getByRole("button", { name: "ประกาศแผน", exact: true }).click();
      await dialog.getByRole("button", { name: "ประกาศแผน", exact: true }).click();
      const share = await dialog.getByRole("textbox", { name: "ข้อความแผนสายส่ง" }).inputValue();
      assert.match(share, /แผนสายส่ง/);
      assert.match(share, /ต้องเป่าเพิ่ม/);
      assert.doesNotMatch(share, /ร้านตัวอย่าง|20\d\d-\d\d-\d\d/);
      assert.equal(S.d1.one("SELECT count(*) AS n FROM plan_lines").n, 7);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await S.close();
    }
  });
}
