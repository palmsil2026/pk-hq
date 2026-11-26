-- งานผลิต สกรีน และส่งของเก็บทั้งรหัสออเดอร์และรหัสรายการ ต้องอ้างใบเดียวกัน
-- NULL ของรายการยังใช้ได้สำหรับงานผลิตเข้าสต๊อก และข้อมูลเก่าที่มีแต่หัวออเดอร์

CREATE TRIGGER production_jobs_item_order_ins BEFORE INSERT ON production_jobs
WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'รายการของงานผลิตต้องอยู่ในออเดอร์เดียวกัน'); END;

CREATE TRIGGER production_jobs_item_order_upd BEFORE UPDATE OF order_id, order_item_id ON production_jobs
WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'รายการของงานผลิตต้องอยู่ในออเดอร์เดียวกัน'); END;

CREATE TRIGGER screen_jobs_item_order_ins BEFORE INSERT ON screen_jobs
WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'รายการของงานสกรีนต้องอยู่ในออเดอร์เดียวกัน'); END;

CREATE TRIGGER screen_jobs_item_order_upd BEFORE UPDATE OF order_id, order_item_id ON screen_jobs
WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'รายการของงานสกรีนต้องอยู่ในออเดอร์เดียวกัน'); END;

CREATE TRIGGER delivery_loads_item_order_ins BEFORE INSERT ON delivery_loads
WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'รายการส่งของต้องอยู่ในออเดอร์เดียวกัน'); END;

CREATE TRIGGER delivery_loads_item_order_upd BEFORE UPDATE OF order_id, order_item_id ON delivery_loads
WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'รายการส่งของต้องอยู่ในออเดอร์เดียวกัน'); END;

CREATE TRIGGER order_items_keep_order BEFORE UPDATE OF order_id ON order_items
WHEN NEW.order_id <> OLD.order_id AND (
  EXISTS (SELECT 1 FROM production_jobs WHERE order_id = OLD.order_id AND order_item_id = OLD.id)
  OR EXISTS (SELECT 1 FROM screen_jobs WHERE order_id = OLD.order_id AND order_item_id = OLD.id)
  OR EXISTS (SELECT 1 FROM delivery_loads WHERE order_item_id = OLD.id)
)
BEGIN SELECT RAISE(ABORT, 'รายการสินค้าที่มีงานหรือการส่งของแล้วต้องอยู่ใบเดิม'); END;

CREATE TRIGGER stock_moves_reverse_matches BEFORE INSERT ON stock_moves
WHEN (NEW.move_type = 'ย้อน') <> (NEW.reverses IS NOT NULL)
  OR (NEW.reverses IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM stock_moves
    WHERE id = NEW.reverses AND reverses IS NULL AND move_type <> 'ย้อน'
      AND item_key = NEW.item_key AND grade = NEW.grade AND qty_pcs = -NEW.qty_pcs
      AND ref_entity = NEW.ref_entity AND ref_id = NEW.ref_id
  ))
BEGIN SELECT RAISE(ABORT, 'ยอดย้อนต้องกลับทิศรายการสต๊อกเดิมครบทั้งสินค้า เกรด และจำนวน'); END;
