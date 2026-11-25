// ============================================================
//  ลองนาฬิกาปลุกในเครื่อง (ไม่ต้องมีกุญแจ Cloudflare/Google): ฐาน SQLite + สะพาน GAS จำลอง (gas/Code.gs ตัวจริง + ชีตจำลอง)
//    node --no-warnings v2/tools/cron-local.mjs legacy    → นำเข้ารอบผลิตแอปเดิม (เหมือนเวลา 06:30/18:30)
//    node --no-warnings v2/tools/cron-local.mjs acct      → ซิงก์ชีทบัญชี (เหมือนเวลา 20:00)
//  รันสองครั้งติดกันเพื่อดูว่าไม่เบิ้ล (รอบสอง inserted = 0)
// ============================================================
import { startDev } from "./dev-server.mjs";
import { runCron } from "../cron/worker.mjs";

const which = process.argv[2] || "legacy";
const cron = which === "acct" ? "0 13 * * *" : "30 23 * * *";
const S = await startDev({ mem: true });
try {
  for (const round of [1, 2]) {
    const r = await runCron(cron, S.env, { fetch: S.gasFetch, now: S.clock, force: true });
    console.log("รอบ " + round + ":", JSON.stringify(r));
  }
  console.log("stock_moves จากการนำเข้า:", S.d1.one("SELECT count(*) n FROM stock_moves WHERE ref_entity = 'machine_runs' AND ref_id IN (SELECT id FROM machine_runs WHERE substr(src, 1, 6) = 'legacy')").n);
} finally { await S.close(); }
