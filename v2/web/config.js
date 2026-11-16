// ค่าตั้งของหน้าเว็บ (ไม่ใช่ความลับ — ไฟล์นี้เปิดสาธารณะ)
//   gasUrl = เว็บแอป GAS "P&K System" ตัวเดิม (deployment เดิม ไม่เปลี่ยน URL) — ใช้ตรวจ PIN ออกตั๋วเท่านั้น (pkV2Ticket)
//   ⚠️ pkV2* จะใช้ได้หลังคุณปาล์มอนุมัติให้ gas/Code.gs รุ่น 2026-11-16v2 ขึ้น main (ตอนนี้อยู่ branch pk-app-v2)
window.PK_CONFIG = {
  apiBase: "api",
  gasUrl: "https://script.google.com/macros/s/AKfycbw8guY7h7Q_BCfl_RwlD6PQn5fmhXmsu1myjr60OGwbEiAwB_PVE59iAsZmgY9meWH-/exec",
};
