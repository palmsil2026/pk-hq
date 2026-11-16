// ทีมผลิต — หน้าแรก "แผนผังโรงงาน" (ไฟสถานะทุกเครื่อง · แตะเครื่อง = แผ่นล่างพร้อมปุ่มงาน)
//   ไม่มีหน้าเข้าระบบทุกวัน: เครื่องที่ตั้งแล้วเปิดมาเห็นแผนผังเลย · กดบันทึก = ถามใครบันทึก + PIN ทุกครั้ง (ctx.save ทำให้เอง)
//   แชทโมดูลทีมผลิตเติม: เปิดรอบ · เปลี่ยนสี · จอดเครื่อง · ปิดรอบ (ดี/เกรด B/เสีย) · งานรอผลิต · สต๊อก · ประวัติ
import { floorView } from "./shared.js";
export default {
  code: "prod", title: "ทีมผลิต",
  nav: [
    { key: "floor", label: "แผนผัง", icon: "map", title: "แผนผังโรงงาน" },
    { key: "jobs", label: "งานรอผลิต", icon: "list" },
    { key: "stock", label: "สต๊อก", icon: "box" },
    { key: "history", label: "ประวัติ", icon: "clock" },
  ],
  views: { floor: (ctx, view) => floorView(ctx, view) },
};
