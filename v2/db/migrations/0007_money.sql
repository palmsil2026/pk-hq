-- ═══════════════════════════════════════════════════════════════════════════
--  0007_money — บิล · รับชำระ · ใบวางบิล
--  ความหมายเดียวกับแท็บ `Bills` / `Statements` ของชีต PKSystem (ห้ามเปลี่ยนชื่อ/ความหมายคอลัมน์ชีต — CLAUDE.md)
--  ตอนทำกระจก D1 → ชีตภายหลัง: map คอลัมน์ตามตารางใน v2/db/SCHEMA.md §money (หัวคอลัมน์ชีตเดิมทุกตัว)
--  ฝ่ายบัญชียังจดชีท "ระบบบัญชี" เดิม — บิลจากชีทนั้นเข้ามาเป็น src = 'acct:<แท็บ>' (อ่านอย่างเดียว · ห้ามเขียนกลับ)
--  เงิน = จำนวนเต็มสตางค์ · "เงินเข้าบัญชีไหน" นับตามวันที่ชำระ (paid_day / bill_payments.day) ไม่ใช่วันที่บิล
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE bills (
  bill_no      TEXT PRIMARY KEY,             -- Bill_No (เดิม 'PK0001' · นำเข้า 'เก่า-<แท็บ>-<เลข>')
  bill_day     TEXT NOT NULL,                -- วันที่
  customer_id  TEXT REFERENCES customers(id),
  customer_name TEXT NOT NULL,               -- ลูกค้า (ชื่อตามบิล — ชีทบัญชีไม่มีรหัสลูกค้า)
  order_id     TEXT REFERENCES orders(id),   -- Order_ID
  total_satang INTEGER NOT NULL CHECK (typeof(total_satang) = 'integer' AND total_satang >= 0),   -- ยอดรวม
  kind         TEXT NOT NULL,                -- ประเภท: 'เงินสด' / 'เครดิต'
  pay_channel  TEXT NOT NULL DEFAULT '',     -- ช่องทางชำระ ('' = ยังไม่รู้ — ไม่เดาให้)
  status       TEXT NOT NULL,                -- สถานะ: 'ค้างชำระ' / 'ชำระแล้ว' / 'ยกเลิก'
  due_day      TEXT NOT NULL DEFAULT '',     -- กำหนดชำระ
  paid_day     TEXT NOT NULL DEFAULT '',     -- ชำระเมื่อ
  paid_satang  INTEGER NOT NULL DEFAULT 0 CHECK (typeof(paid_satang) = 'integer' AND paid_satang >= 0),
  stmt_no      TEXT NOT NULL DEFAULT '',     -- Stmt_No
  items_json   TEXT NOT NULL DEFAULT '',     -- รายการ
  note         TEXT NOT NULL DEFAULT '',     -- หมายเหตุ
  src          TEXT NOT NULL DEFAULT 'v2',   -- ที่มา ('v2' · 'pk' · 'acct:<แท็บ>')
  by_name      TEXT NOT NULL DEFAULT '',     -- ผู้ทำ
  paper_no     TEXT NOT NULL DEFAULT '',     -- เลขบิลกระดาษ
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(bill_day) = 10),
  CHECK (status <> 'ชำระแล้ว' OR paid_day <> '')
);
CREATE INDEX bills_status ON bills(status, due_day);
CREATE INDEX bills_customer ON bills(customer_id, bill_day);
CREATE INDEX bills_order ON bills(order_id);
CREATE INDEX bills_paid ON bills(paid_day, pay_channel);
CREATE INDEX bills_paper ON bills(paper_no, bill_day);

-- รับชำระทีละครั้ง (บิลเครดิตจ่ายหลายงวดได้) · ยกเลิก = status ไม่ลบ
CREATE TABLE bill_payments (
  id            TEXT PRIMARY KEY,
  bill_no       TEXT NOT NULL REFERENCES bills(bill_no),
  at            TEXT NOT NULL,
  day           TEXT NOT NULL,               -- วันที่ชำระ (นับ "เงินเข้าบัญชีไหน" ตามวันนี้)
  amount_satang INTEGER NOT NULL CHECK (typeof(amount_satang) = 'integer' AND amount_satang > 0),
  channel       TEXT NOT NULL,               -- ต้องเลือกเอง ไม่มีค่าตั้งต้น
  status        TEXT NOT NULL DEFAULT 'ใช้ได้',
  by            TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  src           TEXT NOT NULL DEFAULT 'v2',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(trim(channel)) > 0)
);
CREATE INDEX bill_payments_bill ON bill_payments(bill_no);
CREATE INDEX bill_payments_day ON bill_payments(day, channel);

-- ใบวางบิล (Statements)
CREATE TABLE statements (
  stmt_no      TEXT PRIMARY KEY,             -- Stmt_No
  stmt_day     TEXT NOT NULL,                -- วันที่วาง
  customer_id  TEXT REFERENCES customers(id),
  customer_name TEXT NOT NULL,               -- ลูกค้า
  bill_count   INTEGER NOT NULL DEFAULT 0 CHECK (bill_count >= 0),   -- จำนวนบิล
  total_satang INTEGER NOT NULL CHECK (typeof(total_satang) = 'integer' AND total_satang >= 0),   -- ยอดรวม
  collect_day  TEXT NOT NULL DEFAULT '',     -- กำหนดเก็บเงิน
  status       TEXT NOT NULL,                -- สถานะ: 'รอเก็บ' / 'วางบิลแล้ว' / 'เก็บแล้ว' / 'ยกเลิก'
  bill_nos     TEXT NOT NULL DEFAULT '',     -- บิลที่รวม (คั่น ,)
  note         TEXT NOT NULL DEFAULT '',     -- หมายเหตุ
  src          TEXT NOT NULL DEFAULT 'v2',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX statements_customer ON statements(customer_id, stmt_day);
