// ============================================================
//  รวมทะเบียน action ทั้งระบบ                                               v2/server/actions/index.mjs
//  เพิ่มโมดูล: สร้างไฟล์ server/actions/<โมดูล>.mjs ที่ export function define<ชื่อ>(R) แล้วเรียกในนี้ 1 บรรทัด
//  (ไฟล์นี้คือจุดเดียวที่ทุกแชทแตะร่วมกัน — เพิ่มบรรทัดของตัวเองต่อท้าย ไม่แก้บรรทัดของคนอื่น)
// ============================================================
import { createRegistry } from "../app.mjs";
import { defineFoundation } from "./foundation.mjs";
import { defineHomes } from "./home.mjs";
import { defineImport } from "./import.mjs";
import { defineOffice } from "./office.mjs";
import { defineScreen } from "./screen.mjs";   // 0300 สกรีน + ส่งของ
import { defineDeliver } from "./deliver.mjs"; // 0300 สกรีน + ส่งของ
import { defineProduction } from "./prod.mjs";   // 0100 ทีมผลิต
import { defineExec } from "./exec.mjs";          // 0400 ประธาน + บัญชี
import { defineAccount } from "./account.mjs";    // 0400 ประธาน + บัญชี

export function buildRegistry(extra) {
  const R = createRegistry();
  defineFoundation(R);
  defineHomes(R);
  defineImport(R);
  // ── โมดูล (แชทย่อย) เพิ่มต่อท้ายตรงนี้ ──
  defineProduction(R);     // 0100 ทีมผลิต
  defineOffice(R);         // 0200 ออฟฟิศ
  defineScreen(R);       // 0300 สกรีน + ส่งของ
  defineDeliver(R);      // 0300 สกรีน + ส่งของ
  defineExec(R);         // 0400 ประธาน + บัญชี
  defineAccount(R);      // 0400 ประธาน + บัญชี
  if (typeof extra === "function") extra(R);   // เทสต์ใส่ action ตัวอย่างเพิ่มได้
  return R;
}
