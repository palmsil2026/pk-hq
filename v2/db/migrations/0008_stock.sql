-- ═══════════════════════════════════════════════════════════════════════════
--  0008_stock — สต๊อกแบบบัญชีแยกประเภท (ledger) · เกรด A / B แยกกันเด็ดขาด
--  stock_moves = สมุดเคลื่อนไหว เขียนเพิ่มอย่างเดียว (แก้/ลบไม่ได้ — trigger ใน 0011) · ย้อน = ลงแถวกลับทิศ (reverses)
--  stock_balance = ยอดคงเหลือ — trigger ขยับให้เองทุกครั้งที่ลงสมุด (ลืมขยับไม่ได้ · ยอดตรงสมุดเสมอ)
--  เกรด B ไม่บวกเข้าเกรด A จนกว่าคุณปาล์มเคาะวิธีขาย (PALM-WAY §5 · §9) · ยอดติดลบ = ไม่บล็อก แต่ขึ้นธง (action ทำ)
--  item_key = 'spec:<spec_key>' (สินค้าตามสเปก) / 'sku:<SKU>' / 'mat:<ชื่อวัตถุดิบ>' (พรีฟอร์ม · เม็ด · ฝา · ฟิล์ม ที่รับเข้า)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE stock_moves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  day        TEXT NOT NULL,
  item_key   TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',       -- ชื่อที่คนอ่าน ณ ตอนลง
  grade      TEXT NOT NULL DEFAULT 'A' CHECK (grade IN ('A', 'B')),
  qty_pcs    INTEGER NOT NULL CHECK (typeof(qty_pcs) = 'integer' AND qty_pcs <> 0),   -- + เข้า / − ออก
  move_type  TEXT NOT NULL,                  -- vocab stock_moves.move_type
  ref_entity TEXT NOT NULL DEFAULT '',       -- 'machine_runs' 'delivery_loads' …
  ref_id     TEXT NOT NULL DEFAULT '',
  by         TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',
  reverses   INTEGER REFERENCES stock_moves(id),   -- แถวนี้กลับทิศของแถวไหน (ย้อน)
  src        TEXT NOT NULL DEFAULT 'v2',
  CHECK (substr(item_key, 1, 4) IN ('spec', 'sku:', 'mat:'))
);
CREATE INDEX stock_moves_item ON stock_moves(item_key, grade, id);
CREATE INDEX stock_moves_ref ON stock_moves(ref_entity, ref_id);
CREATE INDEX stock_moves_day ON stock_moves(day);
-- กลับทิศได้ครั้งเดียว (กดย้อนซ้ำ/สองคนย้อนพร้อมกัน = ล้ม)
CREATE UNIQUE INDEX stock_moves_reverse_once ON stock_moves(reverses) WHERE reverses IS NOT NULL;

CREATE TABLE stock_balance (
  item_key   TEXT NOT NULL,
  grade      TEXT NOT NULL CHECK (grade IN ('A', 'B')),
  label      TEXT NOT NULL DEFAULT '',
  qty_pcs    INTEGER NOT NULL DEFAULT 0 CHECK (typeof(qty_pcs) = 'integer'),
  updated_at TEXT NOT NULL,
  last_move  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_key, grade)
);

CREATE TRIGGER stock_moves_balance AFTER INSERT ON stock_moves
BEGIN
  INSERT INTO stock_balance(item_key, grade, label, qty_pcs, updated_at, last_move)
  VALUES (NEW.item_key, NEW.grade, NEW.label, NEW.qty_pcs, NEW.at, NEW.id)
  ON CONFLICT(item_key, grade) DO UPDATE SET
    qty_pcs = qty_pcs + NEW.qty_pcs,
    label = CASE WHEN NEW.label <> '' THEN NEW.label ELSE label END,
    updated_at = NEW.at,
    last_move = NEW.id;
END;
