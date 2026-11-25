-- ═══════════════════════════════════════════════════════════════════════════
--  0003_products — สินค้า = สเปกหลายแกน · ตัวคูณถุง · ขั้นต่ำ · ราคา + ประวัติราคา
--  ที่มา: gas/Code.gs (SPEC · PER_BAG · MIN_ORDER — ถอดจากออเดอร์จริง) + docs/products/products-master.csv (SKU 29 รายการ)
--  สินค้าในออเดอร์ = ประเภท × ขนาด × คอขวด × รูปทรง × สี (+ สีสกรีน · ฝาสี) → spec_key (server/core.mjs › specKey)
--  ราคา: ปรับได้เฉพาะบทบาทประธาน (exec) · ทุกครั้งลง price_history ใน batch เดียวกัน
-- ═══════════════════════════════════════════════════════════════════════════

-- ประเภทสินค้า + แกนที่ประเภทนั้นใช้จริง (ฟอร์มโชว์เฉพาะแกนเหล่านี้) + หน่วยนับหน้างาน
CREATE TABLE product_types (
  code       TEXT PRIMARY KEY,               -- 'ขวด' 'ถัง' 'ฟิล์มหุ้มคอ' 'ฝา' 'ฟิล์มแพ็คโหล' 'ถุงหิ้ว' 'ลัง' 'พรีฟอร์ม'
  axes       TEXT NOT NULL DEFAULT '',       -- แกนที่ใช้ คั่น , : 'ขนาด,คอขวด,รูปทรง,สี,สีสกรีน,พร้อมฝาสี'
  count_unit TEXT NOT NULL DEFAULT 'ชิ้น' CHECK (count_unit IN ('ถุง', 'ชิ้น')),   -- หน้างานนับเป็น … (ถุง = คูณ per_bag เป็นใบ)
  piece_unit TEXT NOT NULL DEFAULT 'ชิ้น' CHECK (piece_unit IN ('ใบ', 'ชิ้น', 'ม้วน')),
  pos        INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note       TEXT NOT NULL DEFAULT '',
  src        TEXT NOT NULL DEFAULT 'ref:Code.gs',
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- ขนาดต่อประเภท + ใบต่อถุง + ขั้นต่ำสั่ง (ใบ) — ขั้นต่ำ = เตือนอย่างเดียว ไม่บล็อก (PALM-WAY §5)
CREATE TABLE type_sizes (
  type          TEXT NOT NULL REFERENCES product_types(code),
  size          TEXT NOT NULL,
  per_bag       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(per_bag) = 'integer' AND per_bag >= 0),   -- 0 = ไม่นับเป็นถุง/ยังไม่รู้
  min_order_pcs INTEGER NOT NULL DEFAULT 0 CHECK (typeof(min_order_pcs) = 'integer' AND min_order_pcs >= 0),
  pos           INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note          TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (type, size)
);

-- ค่าของแกนอื่น ๆ (คอขวด · รูปทรง · สี · สีสกรีน · พร้อมฝาสี) — เพิ่มต่อท้าย ห้ามลบ (ออเดอร์เก่าอ้างอยู่)
CREATE TABLE spec_values (
  axis   TEXT NOT NULL CHECK (axis IN ('คอขวด', 'รูปทรง', 'สี', 'สีสกรีน', 'พร้อมฝาสี')),
  value  TEXT NOT NULL,
  pos    INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  grade  TEXT NOT NULL DEFAULT 'A' CHECK (grade IN ('A', 'B')),   -- สี "ดำ (เกรด B)" = ของเกรด B
  PRIMARY KEY (axis, value)
);

-- ทะเบียน SKU มาตรฐาน (docs/products/products-master.csv) — รหัสตั้งแล้วห้ามเปลี่ยนความหมาย · เลิกขาย = status
CREATE TABLE products (
  id           TEXT PRIMARY KEY,             -- SKU เช่น 'PK-BOT-600-MK-CL'
  category     TEXT NOT NULL CHECK (category IN ('BOT', 'CAP', 'FLM', 'TNK', 'CUP', 'MSC')),
  name         TEXT NOT NULL,
  type         TEXT REFERENCES product_types(code),   -- ประเภทในระบบออเดอร์ (NULL = ยังจับคู่ไม่ได้)
  size         TEXT NOT NULL DEFAULT '',
  neck         TEXT NOT NULL DEFAULT '',
  shape        TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '',
  spec_key     TEXT NOT NULL DEFAULT '',
  sale_unit    TEXT NOT NULL DEFAULT 'ชิ้น',
  per_pack     INTEGER NOT NULL DEFAULT 0 CHECK (typeof(per_pack) = 'integer' AND per_pack >= 0),
  data_status  TEXT NOT NULL DEFAULT 'รอยืนยัน' CHECK (data_status IN ('ยืนยันแล้ว', 'รอยืนยัน')),
  status       TEXT NOT NULL DEFAULT 'ขาย',
  note         TEXT NOT NULL DEFAULT '',
  src          TEXT NOT NULL DEFAULT 'v2',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(trim(name)) > 0)
);
CREATE INDEX products_spec ON products(spec_key);

-- ราคาปัจจุบัน: item_key = 'sku:<SKU>' หรือ 'spec:<spec_key>' · kind = ราคาโรงงาน/หน้าร้าน/ไม่รวมฝา
--   แก้ได้เฉพาะ action price.set (บทบาท exec) — ทุกครั้งมีแถว price_history ใน batch เดียวกัน
CREATE TABLE prices (
  item_key     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  price_satang INTEGER NOT NULL CHECK (typeof(price_satang) = 'integer' AND price_satang >= 0),
  label        TEXT NOT NULL DEFAULT '',     -- ชื่อสินค้าที่คนอ่านได้ (ไว้โชว์)
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (item_key, kind),
  CHECK (substr(item_key, 1, 4) IN ('sku:', 'spec'))
);

CREATE TABLE price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  day         TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  old_satang  INTEGER CHECK (old_satang IS NULL OR (typeof(old_satang) = 'integer' AND old_satang >= 0)),   -- NULL = ตั้งราคาครั้งแรก
  new_satang  INTEGER NOT NULL CHECK (typeof(new_satang) = 'integer' AND new_satang >= 0),
  by          TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  src         TEXT NOT NULL DEFAULT 'v2'
);
CREATE INDEX price_history_item ON price_history(item_key, kind, id);
