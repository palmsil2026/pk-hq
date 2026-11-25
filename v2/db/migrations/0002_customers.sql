-- ═══════════════════════════════════════════════════════════════════════════
--  0002_customers — ลูกค้า + สายส่ง/อำเภอ
--  ที่มา: ทะเบียน "P&K_ลูกค้า" (225 ราย · 16 สาย 111–121 / 211–215) + ชื่อจากออเดอร์/ชีทบัญชี
--  กติกา PALM-WAY §5: ลูกค้าต้องไม่เพี้ยน — ผูกด้วยรหัส · จับคู่ชื่อหลวม (name_key) · ชื่องาน/แบรนด์แยกจากชื่อลูกค้า
--  นำเข้าซ้ำ = เติมช่องที่ว่าง ไม่ทับของเดิม
-- ═══════════════════════════════════════════════════════════════════════════

-- สายส่ง (เส้นทาง) — ทะเบียนแก้จากหน้าจอ ไม่แก้โค้ด
CREATE TABLE routes (
  code       TEXT PRIMARY KEY,               -- '115' · '212' (ตามทะเบียนเดิม "เส้นทาง-2")
  name       TEXT NOT NULL DEFAULT '',
  area       TEXT NOT NULL DEFAULT '',       -- 'ใกล้' (1xx) / 'ไกล' (2xx) หรือคำอธิบาย
  pos        INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(trim(code)) > 0)
);

CREATE TABLE customers (
  id           TEXT PRIMARY KEY,             -- 'C…' (รหัสเดิมจาก PKSystem ถ้ามี · ไม่ขึ้นจอ)
  name         TEXT NOT NULL,                -- ชื่อร้าน/ลูกค้า (ไม่ปนชื่องาน)
  name_key     TEXT NOT NULL,                -- ชื่อแบบตัดช่องว่าง/วงเล็บ/ตัวพิมพ์ — ใช้จับคู่หลวม (server/import/names.mjs)
  phone        TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  district     TEXT NOT NULL DEFAULT '',     -- อำเภอ
  subdistrict  TEXT NOT NULL DEFAULT '',     -- ตำบล
  route_code   TEXT REFERENCES routes(code), -- NULL = ยังไม่มีสาย
  map_url      TEXT NOT NULL DEFAULT '',
  credit_days  INTEGER NOT NULL DEFAULT 0 CHECK (typeof(credit_days) = 'integer' AND credit_days BETWEEN 0 AND 365),
  note         TEXT NOT NULL DEFAULT '',     -- หมายเหตุการค้า ("เงินไม่ดีให้สั่งทางออฟฟิศ" …)
  status       TEXT NOT NULL DEFAULT 'ใช้งาน',
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),   -- 1 = เกิดจากนำเข้าแล้วจับคู่ไม่ติด รอคนรวม/ยืนยัน
  merged_into  TEXT REFERENCES customers(id),                               -- รวมเข้ากับรายอื่นแล้ว (ไม่ลบแถว)
  src          TEXT NOT NULL DEFAULT 'v2',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(trim(name)) > 0),
  CHECK (length(name_key) > 0),
  CHECK (merged_into IS NULL OR merged_into <> id)
);
CREATE INDEX customers_key ON customers(name_key);
CREATE INDEX customers_route ON customers(route_code, status);
CREATE INDEX customers_district ON customers(district);

-- ชื่ออื่นของลูกค้าคนเดิม (สะกดต่าง · ชื่อจากออเดอร์เก่าที่ปนชื่องาน) → ลูกค้าตัวจริง
CREATE TABLE customer_aliases (
  alias_key   TEXT PRIMARY KEY,
  alias       TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  src         TEXT NOT NULL DEFAULT 'v2',
  created_at  TEXT NOT NULL
);
CREATE INDEX customer_aliases_cust ON customer_aliases(customer_id);
