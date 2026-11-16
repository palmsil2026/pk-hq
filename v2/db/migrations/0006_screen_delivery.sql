-- ═══════════════════════════════════════════════════════════════════════════
--  0006_screen_delivery — งานสกรีน (ทีม) · รถ · รอบส่ง · ของขึ้นรถ · ส่งแล้ว / ส่งไม่ได้ + เหตุผล
--  ทีมสกรีนของเดิม: แตะทีม → แตะเสร็จ (ไม่บังคับลงจำนวน) · สถานะ รอดำเนินการ → เตรียมการสกรีน → เสร็จแล้ว
--  ส่งของ: ของขึ้นรถทีละรายการ (เต็ม/บางส่วน) → ส่งแล้ว / ส่งไม่ได้ (+เหตุผล) / คืนคลัง
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE screen_teams (
  code   TEXT PRIMARY KEY,                   -- 'ทีม 1' 'ทีม 2' 'ทีม 3'
  pos    INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE screen_jobs (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  order_item_id TEXT REFERENCES order_items(id),
  team          TEXT REFERENCES screen_teams(code),   -- NULL = ยังไม่จ่ายทีม
  colors        TEXT NOT NULL DEFAULT '',             -- สีสกรีน
  qty_pcs       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(qty_pcs) = 'integer' AND qty_pcs >= 0),
  good_pcs      INTEGER CHECK (good_pcs IS NULL OR (typeof(good_pcs) = 'integer' AND good_pcs >= 0)),     -- ไม่บังคับ
  waste_pcs     INTEGER CHECK (waste_pcs IS NULL OR (typeof(waste_pcs) = 'integer' AND waste_pcs >= 0)),
  status        TEXT NOT NULL DEFAULT 'รอดำเนินการ',
  due_day       TEXT NOT NULL DEFAULT '',
  done_at       TEXT NOT NULL DEFAULT '',
  done_day      TEXT NOT NULL DEFAULT '',
  done_by       TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  src           TEXT NOT NULL DEFAULT 'v2',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((done_at = '') = (done_day = ''))
);
CREATE INDEX screen_jobs_queue ON screen_jobs(status, due_day);
CREATE INDEX screen_jobs_order ON screen_jobs(order_id);
CREATE INDEX screen_jobs_done ON screen_jobs(done_day, team);

-- รถส่งของ (เลขคัน 04–09 ตามของเดิม) — ทะเบียนแก้จากหน้าจอ
CREATE TABLE vehicles (
  id         TEXT PRIMARY KEY,               -- '04'
  name       TEXT NOT NULL DEFAULT '',
  plate      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- รอบส่ง (1 คัน 1 วัน อาจหลายรอบ)
CREATE TABLE delivery_trips (
  id          TEXT PRIMARY KEY,
  day         TEXT NOT NULL,
  vehicle_id  TEXT REFERENCES vehicles(id),
  driver_id   TEXT REFERENCES staff(id),
  route_code  TEXT REFERENCES routes(code),
  status      TEXT NOT NULL DEFAULT 'จัดของ',
  left_at     TEXT NOT NULL DEFAULT '',
  back_at     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  src         TEXT NOT NULL DEFAULT 'v2',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(day) = 10)
);
CREATE INDEX delivery_trips_day ON delivery_trips(day, vehicle_id);

-- ของขึ้นรถ: 1 แถว = รายการออเดอร์ 1 รายการ บนรอบส่ง 1 รอบ (บางส่วนได้)
CREATE TABLE delivery_loads (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT REFERENCES delivery_trips(id),   -- NULL = ส่งเอง/ลูกค้ามารับ (ของเก่า)
  order_id      TEXT NOT NULL REFERENCES orders(id),
  order_item_id TEXT REFERENCES order_items(id),
  qty_pcs       INTEGER NOT NULL CHECK (typeof(qty_pcs) = 'integer' AND qty_pcs > 0),
  status        TEXT NOT NULL DEFAULT 'บนรถ',
  loaded_at     TEXT NOT NULL,
  loaded_by     TEXT NOT NULL DEFAULT '',
  done_at       TEXT NOT NULL DEFAULT '',
  done_day      TEXT NOT NULL DEFAULT '',
  done_by       TEXT NOT NULL DEFAULT '',
  fail_reason   TEXT NOT NULL DEFAULT '',             -- บังคับเมื่อ status = 'ส่งไม่ได้' (ตรวจที่ action + CHECK)
  note          TEXT NOT NULL DEFAULT '',
  src           TEXT NOT NULL DEFAULT 'v2',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (status <> 'ส่งไม่ได้' OR length(trim(fail_reason)) > 0)
);
CREATE INDEX delivery_loads_trip ON delivery_loads(trip_id, status);
CREATE INDEX delivery_loads_order ON delivery_loads(order_id);
CREATE INDEX delivery_loads_done ON delivery_loads(done_day);
