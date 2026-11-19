// ============================================================
//  นาฬิกาปลุกของ v2 — Cloudflare Worker แยกตัวเดียว (pk-v2-cron) แยกงานตามเวลาที่ปลุก                   v2/cron/worker.mjs
//  (Pages Functions ตั้ง Cron ไม่ได้ · Worker นี้ไม่มีทางเข้าจากเน็ต — ผูกฐาน D1 ตัวเดียวกับแอป)
//    "0 13 * * *"   20:00 ไทย  ซิงก์ชีท "ระบบบัญชี" (อ่านอย่างเดียว) — runAcctSync · ปิดได้ที่ค่าตั้ง ACCT_SYNC_AUTO
//    "30 23 * * *"  06:30 ไทย  นำเข้ารอบผลิตจากแอปเดิม (หลังกะดึก) — runLegacyRunsSync · ปิดได้ที่ค่าตั้ง LEGACY_RUNS_AUTO
//    "30 11 * * *"  18:30 ไทย  นำเข้ารอบผลิตจากแอปเดิม (หลังกะเช้า)
//  ต้องมี: D1 binding "DB" · secret PK_SYNC_KEY · var PK_GAS_URL — ตั้งให้เองโดย tools/deploy-cron.sh
//  (cron/acct-sync.mjs = ตัวเดิมที่ซิงก์บัญชีอย่างเดียว เก็บไว้ ไม่ใช้เป็นตัวหลักแล้ว)
// ============================================================
import { runAcctSync } from "../server/actions/account-sync.mjs";
import { runLegacyRunsSync } from "../server/actions/legacy-cron.mjs";

export const CRONS = { "0 13 * * *": "acct", "30 23 * * *": "legacy-runs", "30 11 * * *": "legacy-runs" };
export const JOBS = {
  acct: (env, opt) => runAcctSync(env, opt),
  "legacy-runs": (env, opt) => runLegacyRunsSync(env, opt),
};

/** งานของเวลาที่ปลุก (ไม่รู้จัก = ไม่ทำอะไร แต่บอกใน log) */
export async function runCron(cron, env, opt) {
  const job = CRONS[cron];
  if (!job) return { skipped: true, reason: "ไม่รู้จักเวลา " + cron };
  return { job, result: await JOBS[job](env, opt) };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(controller.cron, env).then(r => console.log("pk-v2 cron", controller.cron, JSON.stringify(r))).catch(e => console.error("pk-v2 cron error", controller.cron, e && e.stack || e)));
  },
  async fetch() {
    return new Response(JSON.stringify({ ok: true, worker: "pk-v2-cron", jobs: ["ซิงก์ชีทบัญชี ~20:00", "นำเข้ารอบผลิตแอปเดิม ~06:30 และ ~18:30"] }), { headers: { "content-type": "application/json; charset=utf-8" } });
  },
};
