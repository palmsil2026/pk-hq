-- ═══════════════════════════════════════════════════════════════════════════
--  0211_deposit_priority — คุณปาล์มเคาะแล้ว 19 พ.ย. 2569
--   (1) มีมัดจำ = หักในบิลเลย · (2) ขวดไม่พอ = ตามงวดที่นัด/คิวไว้ก่อน แต่ปรับเปลี่ยนได้
-- ═══════════════════════════════════════════════════════════════════════════

-- มัดจำที่หักในบิลนี้ (สตางค์) — ยอดบิล (total_satang = "ยอดรวม" ของแท็บ Bills) คงเป็นยอดเต็มเหมือนเดิม
--   paid_satang = มัดจำที่หัก + รับชำระจริง → ยอดค้าง (total − paid) ถูกทุกหน้าโดยไม่ต้องรู้จักมัดจำ
--   ยกเลิก/ย้อนบิล = สถานะยกเลิก → มัดจำส่วนนี้ไม่ถูกนับว่าใช้แล้ว กลับเป็นคงเหลือเอง (ไม่มีตารางจับคู่แยก)
ALTER TABLE bills ADD COLUMN deposit_satang INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(deposit_satang) = 'integer' AND deposit_satang >= 0 AND deposit_satang <= total_satang AND deposit_satang <= paid_satang);

-- ลำดับมือ: 0 = ตามค่าตั้งต้น (งวดที่นัดใกล้สุด → ลงคิวก่อน → ของจองท้ายสุด) · บวก = ดันขึ้นก่อน · ลบ = เลื่อนลง
--   ปรับต้องมีเหตุผล (ประวัติอยู่ใน audit_log · ย้อนได้) · ลำดับเดียวกันใช้กับงานรอผลิต · คิวสกรีน · การจัดสต๊อกว่าใครไม่พอส่ง
ALTER TABLE orders ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK (typeof(priority) = 'integer' AND priority BETWEEN -99 AND 99);

INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('flags.kind', 'มัดจำคงเหลือ ยกเลิกออเดอร์', 27, '', 'warn'),
  ('reason.priority', 'ลูกค้าขอด่วน', 1, '', ''), ('reason.priority', 'ลูกค้าประจำ/รายใหญ่', 2, '', ''), ('reason.priority', 'จ่ายเงินแล้ว', 3, '', ''),
  ('reason.priority', 'ลูกค้ายังไม่พร้อมรับ', 4, '', ''), ('reason.priority', 'ประธานสั่ง', 5, '', '');

CREATE INDEX bills_order_status ON bills(order_id, status);
