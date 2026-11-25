-- ═══════════════════════════════════════════════════════════════════════════
--  0004_orders — ออเดอร์ + รายการ
--  ที่มา: แท็บ Orders ของ PKSystem + ชีต "Order" ของ AppSheet (5,745 แถว) — ช่องที่เคยเขียนปนในหมายเหตุกลายเป็นช่องจริง:
--    สถานะเงิน · สถานะแบบ · ค่าบล็อก · ด่วน · วันเสร็จจริง · ทำแล้ว/ค้าง(ถุง) + สาเหตุค้าง (docs/legacy-apps/README.md §3)
--  จำนวน: หน้างานนับ "ถุง" → เก็บ bags + per_bag ณ ตอนลง + qty_pcs (ใบ/ชิ้น) ที่คิดแล้ว (CHECK ให้ตรงกัน)
--  เงิน: ไม่บังคับราคา (ระบบเดิมไม่ได้คิดเงิน · เงินจริงอยู่ชีทบัญชี) — ไม่มีราคา = NULL ไม่ใช่ 0
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,         -- 'O…' (v2) · 'เก่า-<ID>' (AppSheet) · Order_ID ของ PKSystem
  order_day        TEXT NOT NULL,            -- วันที่รับ/วันที่สั่งซื้อ (วันไทย)
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  customer_text    TEXT NOT NULL DEFAULT '', -- ชื่อตามที่เขียนในต้นทาง (ออเดอร์เก่ามีชื่องานปน) — ไว้ตรวจย้อน
  brand            TEXT NOT NULL DEFAULT '', -- ชื่องาน/แบรนด์ (แยกจากชื่อลูกค้า)
  taker_staff_id   TEXT REFERENCES staff(id),
  taker_text       TEXT NOT NULL DEFAULT '', -- ผู้รับออเดอร์ตามต้นทาง (ออเดอร์เก่าพิมพ์อิสระ)
  due_day          TEXT NOT NULL DEFAULT '', -- กำหนดส่ง ('' = ยังไม่กำหนด)
  status           TEXT NOT NULL DEFAULT 'รอผลิต',
  purchase_type    TEXT NOT NULL DEFAULT '', -- 'ขายราคาโรงงาน' / 'ขายหน้าร้าน'
  price_mode       TEXT NOT NULL DEFAULT '', -- 'มาตรฐาน' / 'พิเศษ'
  pay_status       TEXT NOT NULL DEFAULT '', -- 'รอโอนเงิน' 'โอนแล้ว' 'ทำได้เลย' 'เก็บปลายทาง' ('' = ไม่ระบุ — ไม่เดาให้)
  design_status    TEXT NOT NULL DEFAULT '', -- 'ไม่ต้องใช้แบบ' 'รอแบบ' 'แก้ไขแบบ' 'แบบผ่านแล้ว'
  block_fee_satang INTEGER CHECK (block_fee_satang IS NULL OR (typeof(block_fee_satang) = 'integer' AND block_fee_satang >= 0)),
  urgent           INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
  has_screen       INTEGER NOT NULL DEFAULT 0 CHECK (has_screen IN (0, 1)),
  screen_team      TEXT NOT NULL DEFAULT '',
  done_bags        INTEGER CHECK (done_bags IS NULL OR (typeof(done_bags) = 'integer' AND done_bags >= 0)),       -- ทำแล้ว (ถุง) ตามที่หน้างานจด
  pending_bags     INTEGER CHECK (pending_bags IS NULL OR (typeof(pending_bags) = 'integer' AND pending_bags >= 0)), -- ค้าง (ถุง)
  pending_reason   TEXT NOT NULL DEFAULT '',
  finished_day     TEXT NOT NULL DEFAULT '', -- วันเสร็จจริง
  delivered_day    TEXT NOT NULL DEFAULT '', -- ส่งครบเมื่อ
  total_satang     INTEGER CHECK (total_satang IS NULL OR (typeof(total_satang) = 'integer' AND total_satang >= 0)),
  note             TEXT NOT NULL DEFAULT '',
  cancel_reason    TEXT NOT NULL DEFAULT '',
  src              TEXT NOT NULL DEFAULT 'v2',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(order_day) = 10),
  CHECK (due_day = '' OR length(due_day) = 10),
  CHECK (finished_day = '' OR length(finished_day) = 10),
  CHECK (delivered_day = '' OR length(delivered_day) = 10)
);
CREATE INDEX orders_status_due ON orders(status, due_day);
CREATE INDEX orders_customer ON orders(customer_id, order_day);
CREATE INDEX orders_day ON orders(order_day);

-- รายการในออเดอร์ (1 แถว = 1 สเปก) · qty_pcs = bags × per_bag + extra_pcs (ถ้านับเป็นถุง) หรือ จำนวนชิ้นตรง ๆ
CREATE TABLE order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  line_no       INTEGER NOT NULL CHECK (line_no >= 1),
  product_id    TEXT REFERENCES products(id),   -- SKU ถ้าจับคู่ได้ (ไม่บังคับ — สินค้านอกทะเบียนขายได้ผ่าน "อื่น ๆ")
  type          TEXT NOT NULL,
  size          TEXT NOT NULL DEFAULT '',
  neck          TEXT NOT NULL DEFAULT '',
  shape         TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT '',
  screen_color  TEXT NOT NULL DEFAULT '',
  cap_color     TEXT NOT NULL DEFAULT '',
  spec_key      TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',       -- ชื่อสินค้าที่คนอ่าน (คิดตอนลง)
  bags          INTEGER NOT NULL DEFAULT 0 CHECK (typeof(bags) = 'integer' AND bags >= 0),
  per_bag       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(per_bag) = 'integer' AND per_bag >= 0),
  extra_pcs     INTEGER NOT NULL DEFAULT 0 CHECK (typeof(extra_pcs) = 'integer' AND extra_pcs >= 0),
  qty_pcs       INTEGER NOT NULL CHECK (typeof(qty_pcs) = 'integer' AND qty_pcs >= 0),
  price_satang  INTEGER CHECK (price_satang IS NULL OR (typeof(price_satang) = 'integer' AND price_satang >= 0)),  -- ต่อใบ/ชิ้น · NULL = ไม่ใส่ราคา
  made_pcs      INTEGER NOT NULL DEFAULT 0 CHECK (typeof(made_pcs) = 'integer' AND made_pcs >= 0),
  delivered_pcs INTEGER NOT NULL DEFAULT 0 CHECK (typeof(delivered_pcs) = 'integer' AND delivered_pcs >= 0),
  status        TEXT NOT NULL DEFAULT 'ใช้งาน',
  note          TEXT NOT NULL DEFAULT '',
  src           TEXT NOT NULL DEFAULT 'v2',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (order_id, line_no),
  CHECK (per_bag = 0 OR qty_pcs = bags * per_bag + extra_pcs),
  CHECK (per_bag > 0 OR bags = 0)
);
CREATE INDEX order_items_order ON order_items(order_id);
CREATE INDEX order_items_spec ON order_items(spec_key, status);
