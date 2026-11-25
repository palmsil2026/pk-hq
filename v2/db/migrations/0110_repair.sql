-- ═══════════════════════════════════════════════════════════════════════════
--  0110_repair — ช่างกด "ซ่อมเสร็จ" + สาเหตุจอดระดับชิ้นส่วน · นาฬิกาปลุกนำเข้ารอบผลิตเดิม · ช่วงเลขทีมผลิต 0110–0129
--
--  ที่มา (กลุ่มไลน์ TEAMWORK 9 วัน ~50 ครั้ง): เครื่องหยุด/ซ่อมเสร็จแจ้งในไลน์อย่างเดียว · ส่วนใหญ่ PET4 ชุดก้ามปูจับหลอด/รางหลอด
--        · ปั้มลม low ตัดทั้งแผนก → ต้องรู้ว่า "หยุดบ่อยเพราะชิ้นไหน" (ครั้ง + ชั่วโมง) เพื่อสั่งอะไหล่/แก้ถาวร
--  กติกา: ชิ้นส่วน = ตัวเลือกเสริม (ไม่บังคับ · ชุดสาเหตุเดิม reason.machine_stop ยังบังคับเหมือนเดิม ไม่ลบ)
--         เดินต่อ (run.resume) = ซ่อมเสร็จ: จดว่าใครแก้ (คนที่ใส่ PIN) + แก้ชิ้นส่วนได้ถ้าเพิ่งรู้ตอนซ่อม · เวลาหยุดรวม = ended_at − started_at
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE machine_events ADD COLUMN part TEXT NOT NULL DEFAULT '';       -- ชิ้นส่วนที่เป็นสาเหตุ (ไม่บังคับ) — ชิปจาก vocab part.machine / part.screen_machine
ALTER TABLE machine_events ADD COLUMN fixed_by TEXT NOT NULL DEFAULT '';   -- staff.id ของคนกด "ซ่อมเสร็จ/เดินต่อ" (จากตั๋ว PIN)
ALTER TABLE machine_events ADD COLUMN fix_note TEXT NOT NULL DEFAULT '';   -- แก้อะไรไป (ไม่บังคับ)
CREATE INDEX machine_events_part ON machine_events(kind, started_at, part);

-- ชิ้นส่วนเครื่องเป่า/ฉีด (ชิปเสริมตอนจอด/ซ่อมเสร็จ) — แก้/เพิ่มได้ด้วย INSERT vocab
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('part.machine', 'ก้ามปู', 1, '', ''), ('part.machine', 'รางหลอด', 2, '', ''), ('part.machine', 'โมลด์ค้าง', 3, '', ''),
  ('part.machine', 'ลม', 4, '', ''), ('part.machine', 'น้ำเย็น', 5, '', ''), ('part.machine', 'ไฟ/คอนแทคเตอร์', 6, '', ''),
  ('part.machine', 'ฮีตเตอร์', 7, '', ''), ('part.machine', 'ท่อน้ำ', 8, '', ''), ('part.machine', 'อื่น ๆ', 99, '', '');

-- นาฬิกาปลุกนำเข้ารอบผลิตจากแอปเดิม (ช่วงเปลี่ยนผ่าน) — ปิดได้ไม่ต้อง deploy
INSERT INTO settings(key, value, note, updated_at, updated_by) VALUES
  ('LEGACY_RUNS_AUTO', '1', 'นำเข้ารอบผลิตจากแอปเดิม (ProductionLog) อัตโนมัติวันละ 2 รอบ ~06:30 และ ~18:30 — 0 = ปิด (ปิดได้เมื่อทีมผลิตเลิกใช้แอปเดิมแล้ว)', '2026-11-19T00:00:00.000Z', 'system');
