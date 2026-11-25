// ============================================================
//  โมดูลทีมผลิต — รวมทะเบียน action (แผนผังโรงงาน · รอบเครื่อง · งานรอผลิต · สต๊อก · ประวัติ)     v2/server/actions/prod.mjs
//  ไฟล์ย่อย: prodLib (ของกลาง) · prodRead (หน้าอ่าน) · prodRun (รอบ/จอด/โมลด์/ทะเบียนเครื่อง) · prodStock (งาน/สต๊อก) · prodLegacy (นำเข้ารอบเก่า)
// ============================================================
import { defineProdRead } from "./prodRead.mjs";
import { defineProdRuns } from "./prodRun.mjs";
import { defineProdStock } from "./prodStock.mjs";

export function defineProduction(R) {
  defineProdRead(R);
  defineProdRuns(R);
  defineProdStock(R);
}
export { negativeFlag, stockKey, PROD_TYPES, RUN_KINDS } from "./prodLib.mjs";
export { loadJobs } from "./prodStock.mjs";
