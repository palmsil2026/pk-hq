// ============================================================
//  นาฬิกาปลุกซิงก์ชีท "ระบบบัญชี" วันละครั้ง — Cloudflare Worker แยก (pk-v2-cron)                 v2/cron/acct-sync.mjs
//  ทำไมแยก: Cloudflare Pages Functions ตั้ง Cron Trigger ไม่ได้ (ได้เฉพาะ Worker) → Worker เล็ก ๆ ตัวนี้ผูกฐาน D1 ตัวเดียวกัน
//           แล้วเรียกโค้ดซิงก์ตัวเดียวกับปุ่ม "ซิงก์ตอนนี้" (server/actions/account-sync.mjs › runAcctSync) — ไม่มีทางเข้าใหม่จากเน็ต
//  เวลา: 13:00 UTC = 20:00 ไทย (เวลาเดียวกับ installAccountingSync ของระบบเดิม) · ปิดได้จากค่าตั้ง ACCT_SYNC_AUTO = 0 ในแอปประธาน
//  ต้องมี: D1 binding "DB" (pk-v2) · secret PK_SYNC_KEY · var PK_GAS_URL — ตั้งให้เองโดย tools/deploy-cron.sh
//  อ่านชีทอย่างเดียว ไม่เขียนกลับ (สะพาน GAS มีแต่คำสั่งอ่าน) · ล้ม = รอบ "ล้มเหลว" + ธงในแอป (ไม่เงียบ)
// ============================================================
import { runAcctSync } from "../server/actions/account-sync.mjs";

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runAcctSync(env).then(r => console.log("pk-v2 acct sync", JSON.stringify(r))).catch(e => console.error("pk-v2 acct sync error", e && e.stack || e)));
  },
  // เปิดลิงก์ Worker ตรง ๆ = บอกแค่ว่าเป็นตัวไหน (ไม่มีข้อมูล · ไม่ซิงก์)
  async fetch() {
    return new Response(JSON.stringify({ ok: true, worker: "pk-v2-cron", job: "ซิงก์ชีทบัญชีวันละครั้ง ~20:00" }), { headers: { "content-type": "application/json; charset=utf-8" } });
  },
};
