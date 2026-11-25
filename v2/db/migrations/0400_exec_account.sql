-- ═══════════════════════════════════════════════════════════════════════════
--  0400_exec_account — โมดูลประธาน + บัญชี (ช่วงเลข 0400–0499)
--  · บิล: ที่มาที่แก้ได้ (origin) · แท็บต้นทางของชีทบัญชี (acct_kind) · บิลในชีทที่ซ้ำกับบิลในแอป (same_as)
--         · เลขบิลกระดาษห้ามซ้ำวันเดียวกัน (unique บางส่วน — ยอมให้ซ้ำได้เมื่อยืนยัน+เหตุผล = paper_dup_ok)
--  · ช่องทางรับเงิน = คลังค่า pay.channel (ตรงกับคอลัมน์ "ช่องทางชำระ" ของชีทบัญชี) — ไม่มีค่าตั้งต้น
--  · เลขเอกสารที่ต้องเรียงต่อกัน (ใบวางบิล) = doc_seq (มี version กันสองคนออกเลขพร้อมกัน)
--  · ราคา: pid = กุญแจแถวเดียว (ท่อเขียนกลางแก้แถวด้วยคีย์เดียว) · ชนิดราคาเช็คกับคลังค่า
--  · ซิงก์ชีทบัญชี: acct_seen = บิลไหนยังอยู่ในชีทรอบล่าสุด (หาบิลที่หายจากชีท — ไม่ต้องขยับ version ของบิล)
--  · พนักงาน: exec_ok_at = ประธานยืนยันแล้ว (คนที่โผล่ในรายชื่อโดยไม่ผ่านประธาน ขึ้นเป็นเรื่องให้ตัดสิน)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── บิล ──────────────────────────────────────────────────────────────────
ALTER TABLE bills ADD COLUMN origin TEXT NOT NULL DEFAULT '';          -- 'บัญชี' = ลงจากแอปบัญชี (แก้/ยกเลิกได้) · อื่น ๆ แก้ไม่ได้ (ออเดอร์/ชีทบัญชี)
ALTER TABLE bills ADD COLUMN acct_kind TEXT NOT NULL DEFAULT '';       -- แถวจากชีทบัญชี: 'รายวัน' (แท็บบิลรายวัน) · 'ลูกหนี้' (แท็บที่มี "ยอดค้าง")
ALTER TABLE bills ADD COLUMN same_as TEXT NOT NULL DEFAULT '';         -- แถวชีทบัญชีนี้ = บิลใบเดียวกับบิลในแอป (bill_no) → ไม่นับยอดซ้ำ
ALTER TABLE bills ADD COLUMN paper_dup_ok INTEGER NOT NULL DEFAULT 0 CHECK (paper_dup_ok IN (0, 1));   -- 1 = ยืนยันแล้วว่าเลขซ้ำแต่คนละใบ (มีเหตุผล+ธง)
CREATE UNIQUE INDEX bills_paper_once ON bills(paper_no, bill_day) WHERE paper_no <> '' AND src = 'v2' AND status <> 'ยกเลิก' AND paper_dup_ok = 0;
CREATE INDEX bills_same_as ON bills(same_as) WHERE same_as <> '';
CREATE INDEX bills_src_paper ON bills(src, paper_no, bill_day);

-- ── ช่องทางรับเงิน (ชิป · ไม่มีค่าตั้งต้น) — ค่าเดียวกับ SPEC['ช่องทางชำระ'] ใน gas/Code.gs / ชีทบัญชี ─────────────
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('pay.channel', 'เงินสด', 1, 'เงินสด', ''), ('pay.channel', 'โอน KBank', 2, 'KBank', ''), ('pay.channel', 'โอน KTB', 3, 'KTB', ''),
  ('pay.channel', 'โอน BBL', 4, 'BBL', ''), ('pay.channel', 'เช็ค', 5, 'เช็ค', '');
CREATE TRIGGER vocab_bill_payments_channel_ins BEFORE INSERT ON bill_payments WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'pay.channel' AND value = NEW.channel) BEGIN SELECT RAISE(ABORT, 'ช่องทางรับเงินไม่อยู่ในรายการ (เงินสด / KBank / KTB / BBL / เช็ค)'); END;
CREATE TRIGGER vocab_bill_payments_channel_upd BEFORE UPDATE OF channel ON bill_payments WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'pay.channel' AND value = NEW.channel) BEGIN SELECT RAISE(ABORT, 'ช่องทางรับเงินไม่อยู่ในรายการ (เงินสด / KBank / KTB / BBL / เช็ค)'); END;

-- ── ชนิดราคา + กุญแจแถว ─────────────────────────────────────────────────────
ALTER TABLE prices ADD COLUMN pid TEXT NOT NULL DEFAULT '';           -- = ชนิด|item_key (ตั้งตอนเพิ่มแถว)
CREATE UNIQUE INDEX prices_pid ON prices(pid) WHERE pid <> '';
-- ชื่อชนิดราคา = ที่โมดูลออฟฟิศอ่าน (office-lib.mjs › PRICE_KIND: ขายราคาโรงงาน → ราคาโรงงาน · ขายหน้าร้าน → ราคาหน้าร้าน)
INSERT INTO vocab(kind, value, pos, label, tone) VALUES ('prices.kind', 'ราคาโรงงาน', 1, 'โรงงาน', ''), ('prices.kind', 'ราคาหน้าร้าน', 2, 'หน้าร้าน', ''), ('prices.kind', 'ราคาไม่รวมฝา', 3, 'ไม่รวมฝา', '');
CREATE TRIGGER vocab_prices_kind_ins BEFORE INSERT ON prices WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'prices.kind' AND value = NEW.kind) BEGIN SELECT RAISE(ABORT, 'ชนิดราคาไม่อยู่ในรายการ (ราคาโรงงาน / ราคาหน้าร้าน / ราคาไม่รวมฝา)'); END;
CREATE TRIGGER vocab_price_history_kind_ins BEFORE INSERT ON price_history WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'prices.kind' AND value = NEW.kind) BEGIN SELECT RAISE(ABORT, 'ชนิดราคาไม่อยู่ในรายการ (ราคาโรงงาน / ราคาหน้าร้าน / ราคาไม่รวมฝา)'); END;

-- ── เลขเอกสารเรียงต่อกัน (ใบวางบิล) ───────────────────────────────────────────
CREATE TABLE doc_seq (
  key        TEXT PRIMARY KEY,                -- เช่น 'stmt:26'
  value      INTEGER NOT NULL DEFAULT 0 CHECK (typeof(value) = 'integer' AND value >= 0),
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE TRIGGER no_delete_doc_seq BEFORE DELETE ON doc_seq BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (doc_seq) — ใช้การเปลี่ยนสถานะแทน'); END;

-- ── ซิงก์ชีทบัญชี: เห็นบิลไหนในชีทรอบไหน ─────────────────────────────────────────
CREATE TABLE acct_seen (
  bill_no  TEXT PRIMARY KEY REFERENCES bills(bill_no),
  seen_at  TEXT NOT NULL                        -- เวลาเริ่มรอบซิงก์ที่ยังเห็นบิลนี้ในชีท
);
CREATE TRIGGER no_delete_acct_seen BEFORE DELETE ON acct_seen BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (acct_seen) — ใช้การเปลี่ยนสถานะแทน'); END;

-- ── พนักงาน: ประธานยืนยันแล้ว ─────────────────────────────────────────────────
ALTER TABLE staff ADD COLUMN exec_ok_at TEXT NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN exec_ok_by TEXT NOT NULL DEFAULT '';

-- ── ธง · ชิปเหตุผล · ค่าตั้ง ───────────────────────────────────────────────────
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('flags.kind', 'เลขบิลซ้ำ', 20, '', 'warn'), ('flags.kind', 'บิลหายจากชีทบัญชี', 21, '', 'warn'), ('flags.kind', 'ชีทบัญชีไม่ตรงแอป', 22, '', 'warn');
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('reason.price', 'ต้นทุนขึ้น', 1, '', ''), ('reason.price', 'ปรับตามตลาด', 2, '', ''), ('reason.price', 'ตั้งราคาครั้งแรก', 3, '', ''), ('reason.price', 'แก้ที่ตั้งผิด', 4, '', ''),
  ('reason.bill_cancel', 'ลงซ้ำ', 1, '', ''), ('reason.bill_cancel', 'ลงผิด', 2, '', ''), ('reason.bill_cancel', 'ลูกค้ายกเลิก', 3, '', ''),
  ('reason.pay_cancel', 'ลงผิดบิล', 1, '', ''), ('reason.pay_cancel', 'ลงยอดผิด', 2, '', ''), ('reason.pay_cancel', 'ลงช่องทางผิด', 3, '', ''), ('reason.pay_cancel', 'เช็คเด้ง', 4, '', ''),
  ('reason.flag_close', 'ตรวจแล้ว ถูกต้อง', 1, '', ''), ('reason.flag_close', 'แก้แล้ว', 2, '', ''), ('reason.flag_close', 'ไม่ต้องทำอะไร', 3, '', ''),
  ('reason.dup_paper', 'คนละเล่ม', 1, '', ''), ('reason.dup_paper', 'เลขบนกระดาษพิมพ์ซ้ำ', 2, '', ''),
  ('reason.excess', 'ลูกค้าโอนเกิน', 1, '', ''), ('reason.excess', 'ทอนไม่ได้ เก็บไว้หักครั้งหน้า', 2, '', ''),
  ('reason.relink', 'ใส่เลขผิด', 1, '', ''), ('reason.relink', 'ผูกผิดใบ', 2, '', ''),
  ('reason.stmt_cancel', 'ลูกค้าขอแก้รายการ', 1, '', ''), ('reason.stmt_cancel', 'ออกซ้ำ', 2, '', ''),
  ('reason.staff', 'ลืม PIN', 1, '', ''), ('reason.staff', 'พักงานชั่วคราว', 2, '', ''), ('reason.staff', 'ลาออก', 3, '', ''), ('reason.staff', 'กลับมาทำงาน', 4, '', '');
INSERT INTO settings(key, value, note, updated_at, updated_by) VALUES
  ('ACCT_SYNC_AUTO', '1', 'ซิงก์ชีทบัญชีอัตโนมัติทุกวัน ~20:00 (1 = เปิด · 0 = ปิด) — อ่านอย่างเดียว ไม่เขียนกลับชีท', '2026-11-16T00:00:00.000Z', 'system'),
  ('ACCT_DUE_DAYS', '7', 'ลูกหนี้ครบกำหนดภายในกี่วัน ขึ้นหน้า "งานที่รอตรวจ" ของบัญชี', '2026-11-16T00:00:00.000Z', 'system');
