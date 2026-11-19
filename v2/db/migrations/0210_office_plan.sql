-- ═══════════════════════════════════════════════════════════════════════════
--  0210_office_plan — ออฟฟิศ: ต้องการเมื่อไร · งวดส่ง · จอง/นัดแล้ว · รอยืนยัน · เลื่อนวันส่ง (เก็บสาเหตุ) · มัดจำ
--  ที่มา: docs/app-v2/WORKFLOW.md §3–4 · PLANNING.md §3 (ของเดิม วันส่ง = วันสั่ง +10 วันอัตโนมัติ 97.9% · งวดส่ง/มัดจำ/รอแบบ จดในหมายเหตุ)
--  ไม่รื้อตารางเดิม — เพิ่มคอลัมน์ (มี DEFAULT) + ตารางใหม่ (กันลบ) + คลังค่า
-- ═══════════════════════════════════════════════════════════════════════════

-- ต้องการเมื่อไร (คำของลูกค้า ไม่ใช่วันนัด) — ไม่บังคับ และระบบไม่ตั้งให้เอง ('' = ไม่ได้บอก)
ALTER TABLE orders ADD COLUMN want_when TEXT NOT NULL DEFAULT '' CHECK (want_when IN ('', 'สัปดาห์นี้', 'สัปดาห์หน้า', 'ไม่รีบ', 'ระบุวัน'));
ALTER TABLE orders ADD COLUMN want_day TEXT NOT NULL DEFAULT '' CHECK (want_day = '' OR length(want_day) = 10);
-- งวดส่ง: '' = ไม่ได้วางงวด (ออเดอร์เก่า/นำเข้า — ใช้ due_day เป็นงวดเดียว) · ครั้งเดียว · กำหนดจำนวน (ต่อครั้ง × กี่ครั้ง/ทุกกี่วัน) · ทยอย (ตามที่ทำได้)
ALTER TABLE orders ADD COLUMN plan_mode TEXT NOT NULL DEFAULT '' CHECK (plan_mode IN ('', 'ครั้งเดียว', 'กำหนดจำนวน', 'ทยอย'));
ALTER TABLE orders ADD COLUMN plan_each_pcs INTEGER NOT NULL DEFAULT 0 CHECK (typeof(plan_each_pcs) = 'integer' AND plan_each_pcs >= 0);   -- กำหนดจำนวน: ต่อครั้ง (ใบ/ชิ้นของรายการแรก) · 0 = ใช้ "กี่ครั้ง"
ALTER TABLE orders ADD COLUMN plan_every_days INTEGER NOT NULL DEFAULT 0 CHECK (typeof(plan_every_days) = 'integer' AND plan_every_days BETWEEN 0 AND 365);   -- 0 = ไม่กำหนดระยะ (นัดทีละงวด)
ALTER TABLE orders ADD COLUMN plan_cap_pcs INTEGER NOT NULL DEFAULT 0 CHECK (typeof(plan_cap_pcs) = 'integer' AND plan_cap_pcs >= 0);       -- ทยอย: เพดานต่อเที่ยว (รายการแรก) · 0 = ไม่กำหนด
-- รอยืนยัน — ยังไม่ส่งเข้าคิวผลิต (แทนหมายเหตุ "รอแบบ/ยังไม่ต้องทำ") · ส่งเข้าคิวแล้วล้างเอง
ALTER TABLE orders ADD COLUMN hold INTEGER NOT NULL DEFAULT 0 CHECK (hold IN (0, 1));

-- งวดส่งของออเดอร์ (1 แถว = 1 งวด) · part_bp = ส่วนของทั้งออเดอร์ (หน่วย 1/10000 — รายการหลายตัวแบ่งตามสัดส่วนเดียวกัน · งวดสุดท้ายเก็บเศษให้ครบ)
--   plan_day '' = ยังไม่นัด (ทั้งออเดอร์ไม่มีงวดที่มีวัน = "จอง") · ส่งครบ/ส่งไม่ครบ คิดจากการส่งจริง (office-plan-lib.mjs › planState) ไม่ให้คนกด
--   วางงวดใหม่ = งวดเดิม "ยกเลิก" + เพิ่มชุดใหม่ (ไม่ลบ · ย้อนได้)
CREATE TABLE order_rounds (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  seq        INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 1),
  plan_day   TEXT NOT NULL DEFAULT '' CHECK (plan_day = '' OR length(plan_day) = 10),
  part_bp    INTEGER NOT NULL CHECK (typeof(part_bp) = 'integer' AND part_bp BETWEEN 1 AND 10000),
  status     TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  note       TEXT NOT NULL DEFAULT '',
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE UNIQUE INDEX order_rounds_seq ON order_rounds(order_id, seq) WHERE status = 'ใช้งาน';
CREATE INDEX order_rounds_day ON order_rounds(plan_day, status);
CREATE TRIGGER no_delete_order_rounds BEFORE DELETE ON order_rounds BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (order_rounds) — ใช้การเปลี่ยนสถานะแทน'); END;

-- เลื่อนวันส่ง/งวด = เลือกสาเหตุ (สมุดเขียนเพิ่ม — นับสาเหตุรายสัปดาห์ได้) · "อื่น ๆ" ต้องมีเหตุผล
CREATE TABLE reschedule_events (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  round_id   TEXT NOT NULL DEFAULT '',     -- '' = ออเดอร์ที่ไม่ได้วางงวด (เลื่อน due_day ตรง)
  seq        INTEGER NOT NULL DEFAULT 0,
  from_day   TEXT NOT NULL DEFAULT '' CHECK (from_day = '' OR length(from_day) = 10),
  to_day     TEXT NOT NULL DEFAULT '' CHECK (to_day = '' OR length(to_day) = 10),   -- '' = ยกเลิกนัด (กลับเป็นจอง)
  cause      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  by_staff   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (cause <> 'อื่น ๆ' OR length(trim(note)) > 0)
);
CREATE INDEX reschedule_events_order ON reschedule_events(order_id, created_at);
CREATE TRIGGER no_delete_reschedule_events BEFORE DELETE ON reschedule_events BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (reschedule_events) — ใช้การเปลี่ยนสถานะแทน'); END;
CREATE TRIGGER vocab_reschedule_events_cause_ins BEFORE INSERT ON reschedule_events WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'reason.reschedule' AND value = NEW.cause) BEGIN SELECT RAISE(ABORT, 'สาเหตุเลื่อนวันส่งไม่อยู่ในรายการ'); END;

-- มัดจำต่อออเดอร์ (บันทึกได้หลายครั้ง) — เงิน = สตางค์ · ช่องทางต้องเลือกเอง (คลัง pay.channel ชุดเดียวกับรับชำระ) · ยกเลิก = สถานะ + เหตุผล
--   แค่บันทึก + โชว์ในหน้าบิล — **ไม่หักยอดบิลเอง** (เรื่องเงินห้ามเดา · ออกบิลตอนมีมัดจำ = ธงให้คนตัดสิน)
CREATE TABLE order_deposits (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  amount_satang INTEGER NOT NULL CHECK (typeof(amount_satang) = 'integer' AND amount_satang > 0),
  channel       TEXT NOT NULL,
  paid_day      TEXT NOT NULL CHECK (length(paid_day) = 10),
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  by_staff      TEXT NOT NULL DEFAULT '',
  src           TEXT NOT NULL DEFAULT 'v2',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX order_deposits_order ON order_deposits(order_id, status);
CREATE TRIGGER no_delete_order_deposits BEFORE DELETE ON order_deposits BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (order_deposits) — ใช้การเปลี่ยนสถานะแทน'); END;
CREATE TRIGGER vocab_order_deposits_channel_ins BEFORE INSERT ON order_deposits WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'pay.channel' AND value = NEW.channel) BEGIN SELECT RAISE(ABORT, 'ช่องทางรับเงินไม่อยู่ในรายการ (เงินสด / KBank / KTB / BBL / เช็ค)'); END;
CREATE TRIGGER vocab_order_deposits_channel_upd BEFORE UPDATE OF channel ON order_deposits WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'pay.channel' AND value = NEW.channel) BEGIN SELECT RAISE(ABORT, 'ช่องทางรับเงินไม่อยู่ในรายการ (เงินสด / KBank / KTB / BBL / เช็ค)'); END;

-- คลังค่า: สาเหตุเลื่อน (ชิป) · ธงใหม่ · เหตุผลยกเลิกมัดจำ
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('reason.reschedule', 'ลูกค้าขอเลื่อน', 1, '', ''), ('reason.reschedule', 'ขวดไม่พอ', 2, '', ''), ('reason.reschedule', 'เครื่องเสีย', 3, '', ''),
  ('reason.reschedule', 'สกรีนไม่ทัน', 4, '', ''), ('reason.reschedule', 'รถเต็ม', 5, '', ''), ('reason.reschedule', 'อื่น ๆ', 9, '', ''),
  ('reason.deposit_cancel', 'ลงผิดออเดอร์', 1, '', ''), ('reason.deposit_cancel', 'ยอด/ช่องทางผิด', 2, '', ''), ('reason.deposit_cancel', 'คืนมัดจำลูกค้า', 3, '', ''),
  ('flags.kind', 'มีมัดจำ ตรวจตอนออกบิล', 22, '', 'warn'), ('flags.kind', 'ยังไม่มีมัดจำ', 23, '', 'warn');
-- แก้ในหน้าออเดอร์ (ฟอร์มแก้ทั้งใบของเดิม) = สาเหตุที่ระบบลงให้ ไม่ใช่ชิปให้เลือก — เก็บในคลังเพื่อผ่าน trigger
INSERT INTO vocab(kind, value, pos, label, tone) VALUES ('reason.reschedule', 'แก้ในหน้าออเดอร์', 99, '', 'mute');

-- ค่าตั้ง (เรื่อง §9 — ยังไม่ตัดสินเป็นกติกาถาวร ประธานเปลี่ยนได้)
INSERT INTO settings(key, value, note, updated_at, updated_by) VALUES
  ('DEPOSIT_REMIND', 'ไม่เตือน', 'มัดจำ: เตือนตอนส่งเข้าคิวถ้ายังไม่มีมัดจำ — ไม่เตือน / งานสกรีน / ทุกออเดอร์ (เตือน + ธง ไม่บล็อก)', '2026-11-19T00:00:00.000Z', 'system'),
  ('RESERVE_CALL_DAYS', '14', 'ของจอง (ยังไม่มีวันนัด) ค้างเกินกี่วัน ขึ้นรายชื่อให้โทรยืนยัน (ไม่ตัดเอง)', '2026-11-19T00:00:00.000Z', 'system');

CREATE INDEX orders_purchase_day ON orders(purchase_type, order_day);
