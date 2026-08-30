/**
 * ════════════════════════════════════════════════════════════
 *  P&K System v2 — ระบบโรงขวด P&K (Google Apps Script)
 *  ครบวงจร: พนักงานล็อกอิน PIN · ออเดอร์ → ผลิต(รายสินค้า)
 *  → สกรีน → ส่งเป็นงวด(หักสต๊อกอัตโนมัติ) → ออกบิล → ใบวางบิล
 *  + สต๊อกสินค้า/วัตถุดิบ · ประวัติทุกการกระทำ (ActivityLog)
 *  + บอร์ดบริหาร: แจ้งเตือน/ผลิต/ของเสีย/พนักงาน/ราคา(ประธาน)
 *  ⚠️ คนละบริษัทกับโรงน้ำละกอน — ห้ามชี้ชีตนี้ไปที่ OriginSystem
 * ════════════════════════════════════════════════════════════
 *
 *  ติดตั้งครั้งแรก (ล็อกอิน palm.work2026@gmail.com):
 *  1) script.new → ตั้งชื่อ "P&K System" → วางไฟล์นี้ทั้งไฟล์
 *  2) รัน setupPkSystem() (รันซ้ำได้ ปลอดภัย — เพิ่มแท็บ/คอลัมน์ที่ขาดให้)
 *  3) Script properties: PK_KEY (รหัส API สำรอง/สคริปต์อื่น)
 *     และ PK_EXEC_KEY (รหัสผู้บริหาร — ตั้งยาว ๆ เดายาก)
 *  4) รัน importLegacyAccounting() → ดึงบิล/ลูกหนี้/ลูกค้าเก่า
 *  5) Deploy → New deployment → Web app (Execute as: Me / Anyone)
 *     → เอา URL วางใน pk/index.html + pk/exec/index.html (GAS_URL)
 *  6) เพิ่มพนักงานคนแรกจากบอร์ดบริหาร (ชื่อเล่น+PIN) แล้วให้ทีมล็อกอิน
 *     แก้โค้ดครั้งถัดไป: Manage deployments → ✏️ → New version + bump CODE_VERSION
 *
 *  ข้อตกลงกับแชท "แอพการเงินโรงขวด":
 *  - แท็บ Bills/Statements: ห้ามเปลี่ยนชื่อ/ความหมายคอลัมน์เดิม
 *    (v2 เพิ่มคอลัมน์ "ผู้ทำ" ต่อท้าย Bills และเพิ่มค่าสถานะ "ยกเลิก")
 *  - เงินรับจริง/ลูกหนี้ อ่านจาก Bills โดยข้ามแถวสถานะ "ยกเลิก" เสมอ
 *  - ⚠️ ห้ามเรียก rowsToObjs('Staff') ตรง ๆ — ใช้ staffPublic() เท่านั้น (กัน PIN หลุด)
 */

const CODE_VERSION = '2026-08-30m';
const LEGACY_SNAPSHOT_ID = '13BkMrh9sckRf3lCVW_Kze61zpcLNhGB2ERy1AFSJVhU'; // PK_ระบบบัญชี_snapshot_2026-08-30
const TZ = 'Asia/Bangkok';
const TOKEN_DAYS = 7;          // อายุ token หลังล็อกอิน
const WASTE_REASONS = ['ก้นบาง', 'ปากเบี้ยว', 'สีเพี้ยน', 'แตก/รั่ว', 'สกรีนเพี้ยน', 'อื่นๆ'];

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function setProp(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

// ─────────────────────────────────────────────
// โครงสร้างชีต PKSystem (setupPkSystem รันซ้ำได้ — เพิ่มเฉพาะที่ขาด)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// คลังคำศัพท์สเปกสินค้า — ถอดจากออเดอร์จริง 136 ใบในชีต "Order" ของ AppSheet เดิม (2568)
// พนักงานไม่ได้เลือก "ชื่อสินค้า" ชิ้นเดียว แต่ประกอบจาก ประเภท × ขนาด × คอ × ทรง × สี
// แก้เพิ่มได้ที่นี่ (เพิ่มค่าใหม่ต่อท้าย อย่าลบของเดิม เดี๋ยวออเดอร์เก่าอ่านไม่ออก)
// ─────────────────────────────────────────────
const SPEC = {
  ประเภทสินค้า: ['ขวด', 'ถัง', 'ฟิล์มหุ้มคอ', 'ฝา', 'ฟิล์มแพ็คโหล', 'ถุงหิ้ว', 'ลัง', 'พรีฟอร์ม'],
  ขนาดตามประเภท: {
    'ขวด': ['250 ml', '600 ml', '350 ml', '500 ml', 'น้ำลัง ปากแคบ (920)', '800 ml', '1500 ml', '1000 ml', 'น้ำลัง ปากกว้าง (920)'],
    'ถัง': ['18.9 ลิตร', 'ขุ่น 20 ลิตร', '15 ลิตร'],
    'ฟิล์มหุ้มคอ': ['คอขวดปากกว้าง', 'คอถัง', 'คอขวดปากแคบ'],
    'ฝา': ['ถังใส', 'ถังขุ่น', 'PET น้ำลัง ปากแคบ'],
    'ฟิล์มแพ็คโหล': ['12 x 15 (250 ml)'],
    'ถุงหิ้ว': ['เบอร์ 8 x 18 (800 ml)'],
    'ลัง': [],
    'พรีฟอร์ม': ['9 กรัม', '13.3 กรัม'],   // จากหน้าจอแอปงานผลิตจริง — พรีฟอร์มระบุขนาดเป็นน้ำหนัก
  },
  คอขวด: ['คอยาว', 'คอสั้น'],
  รูปทรง: ['เพชร', 'เรียบ', 'MK', 'เหลี่ยม'],
  สี: ['น้ำเงิน', 'ใส', 'เขียว', 'ฟ้า', 'ฟ้าทะเล', 'ฟ้าเข้ม', 'ขาวขุ่น', 'เขียวอ่อน', 'ดำ (เกรด B)'],
  สีสกรีน: ['น้ำเงิน', 'ขาว', 'ฟ้าคริสตัล', 'เขียวเข้ม', 'เขียวอ่อน', 'ส้ม', 'ชมพูบานเย็น', 'ดำ', 'แดง', 'ทอง', 'ฟ้านม', 'ม่วง', 'ยังไม่รู้'],
  พร้อมฝาสี: ['ขาว', 'น้ำเงิน', 'ฟ้าคริสตัล 012', 'ขาว 001', 'ดำ 018', 'เขียวอ่อน', 'เขียวเข้ม 038', 'ส้ม 045', 'ชมพูบานเย็น 006', 'ชมพู'],
  ประเภทการซื้อ: ['ขายราคาโรงงาน', 'ขายหน้าร้าน'],
  ราคา: ['มาตรฐาน', 'พิเศษ'],                       // ปุ่มในฟอร์มเดิม — 'มาตรฐาน' 148/174 ออเดอร์
  สถานะสกรีน: ['รอดำเนินการ', 'เตรียมการสกรีน', 'เสร็จแล้ว'],   // ตามแอปทีมสกรีนสีของเดิม
  ทีมสกรีน: ['ทีม 2', 'ทีม 1', 'ทีม 3'],
  สถานะเงิน: ['รอโอนเงิน', 'โอนแล้ว', 'ทำได้เลย', 'เก็บปลายทาง'],
  สถานะแบบ: ['ไม่ต้องใช้แบบ', 'รอแบบ', 'แก้ไขแบบ', 'แบบผ่านแล้ว'],

  // แกนที่แต่ละประเภท "ใช้จริง" — นับจากออเดอร์จริง 136 ใบ ว่าคอลัมน์ไหนถูกกรอกบ้าง
  // เดิมโชว์ทุกแกนกับทุกประเภท → ฟิล์ม/ฝา มีช่อง "คอขวด"(คอยาว/คอสั้น) กับ "รูปทรง" ของขวดโผล่มา
  //   ขวด  ขนาด 106/106 · คอขวด 98 · รูปทรง 100 · สี 106 · สีสกรีน 97 · ฝาสี 64
  //   ถัง  ขนาด 14/14 · สี 14 · สีสกรีน 12 · ฝาสี 6 · คอขวด 0 · รูปทรง 0
  //   ฟิล์มหุ้มคอ ขนาด 7/7 · สี 7 · ที่เหลือ 0    ·  ฝา ขนาด 5/5 · สี 3 · ที่เหลือ 0
  //   ฟิล์มแพ็คโหล/ถุงหิ้ว มีแต่ขนาด        ·  ลัง ไม่มีขนาดเลย มีแต่สี+สีสกรีน
  แกนตามประเภท: {
    'ขวด': ['ขนาด', 'คอขวด', 'รูปทรง', 'สี', 'สีสกรีน', 'พร้อมฝาสี'],
    'ถัง': ['ขนาด', 'สี', 'สีสกรีน', 'พร้อมฝาสี'],
    'ฟิล์มหุ้มคอ': ['ขนาด', 'สี'],
    'ฝา': ['ขนาด', 'สี'],
    'ฟิล์มแพ็คโหล': ['ขนาด'],
    'ถุงหิ้ว': ['ขนาด'],
    'ลัง': ['สี', 'สีสกรีน'],
    'พรีฟอร์ม': ['ขนาด', 'สี'],   // ⚠️ ยังไม่มีในออเดอร์เก่า — เดาจากหน้าจอแอปงานผลิต ต้องยืนยันกับหน้างาน
  },
  // หน่วยที่หน้างานนับจริง — ขวด/ถัง นับเป็น "ถุง" แล้วคูณเป็นใบ
  // ที่เหลือในออเดอร์เก่ากรอกช่อง "จำนวน (ชิ้น)" ล้วน ไม่เคยกรอกถุงเลย
  หน่วยนับตามประเภท: {
    'ขวด': 'ถุง', 'ถัง': 'ถุง',
    'ฟิล์มหุ้มคอ': 'ชิ้น', 'ฝา': 'ชิ้น', 'ฟิล์มแพ็คโหล': 'ชิ้น', 'ถุงหิ้ว': 'ชิ้น',
    'ลัง': 'ชิ้น', 'พรีฟอร์ม': 'ชิ้น',
  },
};
// ล้างแกนที่ประเภทนั้นไม่ได้ใช้ — กันค่าค้างจากหน้าเว็บรุ่นเก่า/ที่เลือกไว้ก่อนเปลี่ยนประเภท
// หลุดเข้าไปในออเดอร์ (เช่น ฟิล์มติด "คอสั้น" มาด้วย)
function cleanAxes_(it) {
  const use = SPEC['แกนตามประเภท'][String(it.type || '').trim()];
  if (!use) return it;                       // ประเภทที่ยังไม่รู้จัก — ไม่ตัดอะไร ปล่อยผ่าน
  const F = { 'ขนาด': 'size', 'คอขวด': 'neck', 'รูปทรง': 'shape', 'สี': 'color',
              'สีสกรีน': 'screenColor', 'พร้อมฝาสี': 'capColor' };
  Object.keys(F).forEach(function (label) {
    if (use.indexOf(label) < 0) it[F[label]] = '';
  });
  return it;
}
// จำนวน "ใบต่อถุง" — ถอดจากออเดอร์จริง (รวมใบ ÷ ถุง) ทุกค่าตรงกันหมดไม่มีขัดแย้ง
const PER_BAG = {
  'ขวด|350 ml': 300,
  'ขวด|250 ml': 252,
  'ขวด|500 ml': 250,
  'ขวด|600 ml': 200,
  'ขวด|800 ml': 190,
  'ขวด|น้ำลัง ปากแคบ (920)': 130,
  'ขวด|1500 ml': 100,
  'ถัง|18.9 ลิตร': 5,
  'ถัง|ขุ่น 20 ลิตร': 5,
  'ถัง|15 ลิตร': 5,
  'ขวด|น้ำลัง ปากกว้าง (920)': 130,
};
function perBag_(type, size) { return PER_BAG[type + '|' + size] || 0; }
// ขั้นต่ำการสั่ง (ใบ) — จากตาราง "ราคา" ในชีต Stock Management ของแอปเดิม
const MIN_ORDER = {
  'ขวด|250 ml': 2000, 'ขวด|350 ml': 2000, 'ขวด|500 ml': 1200, 'ขวด|600 ml': 1200,
  'ขวด|น้ำลัง ปากแคบ (920)': 500, 'ขวด|น้ำลัง ปากกว้าง (920)': 500,
  'ถัง|18.9 ลิตร': 25, 'ถัง|15 ลิตร': 25, 'ถัง|ขุ่น 20 ลิตร': 25,
};
// เครื่องฉีด 12 ตัว — จากแท็บ "เครื่องจักร" ของชีต Stock Management
const MACHINE_SEED = ['PET 1', 'PET 2', 'PET 3', 'PET 4', 'PET 5', 'PET 6', 'PET 7', 'PET 8', 'PET 9', 'PET 10', 'SHE230G PET', 'LG17-228 PET'];

const TABS = {
  Customers:  ['Customer_ID', 'ชื่อลูกค้า', 'เบอร์โทร', 'ที่อยู่', 'เครดิต(วัน)', 'หมายเหตุ', 'สร้างเมื่อ',
               // ▼ เพิ่ม 2026-08-30g — จากทะเบียนลูกค้าเดิม (P&K_ลูกค้า)
               'เส้นทาง', 'อำเภอ', 'ตำบล', 'พิกัด'],
  Products:   ['Product_ID', 'ชื่อสินค้า', 'หน่วย', 'ราคา/หน่วย', 'หมายเหตุ', 'คงเหลือ', 'จุดเตือน', 'สถานะ'],
  Materials:  ['Material_ID', 'ชื่อวัตถุดิบ', 'หน่วย', 'คงเหลือ', 'จุดสั่งซื้อ', 'หมายเหตุ'],
  Orders:     ['Order_ID', 'วันที่รับ', 'ลูกค้า', 'กำหนดส่ง', 'สถานะ', 'มีสกรีน', 'ยอดรวม', 'รายการ', 'หมายเหตุ', 'ผู้รับออเดอร์', 'Bill_No', 'อัปเดตล่าสุด', 'Customer_ID', 'ส่งครบเมื่อ',
               // ▼ เพิ่ม 2026-08-30f — เดิมพนักงานเขียนเรื่องพวกนี้ปนใน 'หมายเหตุ' เพราะแอปเก่าไม่มีช่อง
               'สถานะเงิน', 'สถานะแบบ', 'ค่าบล็อก', 'ด่วน', 'ทีมสกรีน', 'วันเสร็จจริง', 'ประเภทการซื้อ',
               'ทำแล้ว(ถุง)', 'ค้าง(ถุง)', 'สาเหตุค้าง',
               // ▼ เพิ่ม 2026-08-30j — เห็นในหน้าจอแอปเดิม (คอลัมน์ 'แบรนด์' + ปุ่ม 'ราคา')
               'แบรนด์', 'ราคา'],
  Production: ['Job_ID', 'Order_ID', 'วันที่เข้าคิว', 'งาน', 'จำนวนรวม', 'สถานะ', 'เริ่มเมื่อ', 'เสร็จเมื่อ', 'ผู้ทำ', 'หมายเหตุ', 'Product_ID', 'สินค้า', 'จำนวนสั่ง', 'ดีสะสม', 'เสียสะสม', 'สาเหตุค้าง', 'เกรดBสะสม'],
  ScreenJobs: ['Job_ID', 'Order_ID', 'วันที่เข้าคิว', 'ลาย/สี', 'จำนวน', 'สถานะ', 'เริ่มเมื่อ', 'เสร็จเมื่อ', 'ผู้ทำ', 'หมายเหตุ', 'Product_ID', 'สินค้า', 'จำนวนสั่ง', 'ดีสะสม', 'เสียสะสม', 'สาเหตุค้าง', 'เกรดBสะสม', 'ทีม'],
  Deliveries: ['Delivery_ID', 'เมื่อ', 'Order_ID', 'ลูกค้า', 'รายการ', 'ผู้ส่ง', 'หมายเหตุ'],
  Bills:      ['Bill_No', 'วันที่', 'ลูกค้า', 'Order_ID', 'ยอดรวม', 'ประเภท', 'ช่องทางชำระ', 'สถานะ', 'กำหนดชำระ', 'ชำระเมื่อ', 'Stmt_No', 'รายการ', 'หมายเหตุ', 'ที่มา', 'ผู้ทำ'],
  Statements: ['Stmt_No', 'วันที่วาง', 'ลูกค้า', 'จำนวนบิล', 'ยอดรวม', 'กำหนดเก็บเงิน', 'สถานะ', 'บิลที่รวม', 'หมายเหตุ'],
  Staff:      ['Staff_ID', 'ชื่อ', 'ชื่อเล่น', 'แผนก', 'PIN', 'สถานะ', 'เริ่มงาน', 'Token', 'TokenExp', 'หมายเหตุ'],
  StockMoves: ['Move_ID', 'เมื่อ', 'ประเภท', 'ชนิด', 'Item_ID', 'ชื่อ', 'จำนวน', 'คงเหลือหลัง', 'ผู้ทำ', 'อ้างอิง', 'หมายเหตุ'],
  ProductionLogs: ['เมื่อ', 'Job_ID', 'Order_ID', 'Product_ID', 'สินค้า', 'ประเภทงาน', 'ดี', 'เสีย', 'สาเหตุเสีย', 'เครื่อง', 'กะ', 'ผู้ลง', 'หมายเหตุ', 'เกรดB'],
  Machines:   ['ชื่อเครื่อง', 'สถานะ', 'หมายเหตุ'],
  ActivityLog: ['เมื่อ', 'ใคร', 'ช่องทาง', 'การกระทำ', 'อ้างอิง', 'รายละเอียด'],
  PriceHistory: ['วันที่', 'Product_ID', 'ชื่อสินค้า', 'ราคาเดิม', 'ราคาใหม่', 'ผู้ปรับ', 'หมายเหตุ'],
  Settings:   ['key', 'value'],
};

const SETTINGS_SEED = [
  ['COMPANY_NAME', 'โรงขวด P&K'], ['COMPANY_ADDR', ''], ['COMPANY_TEL', ''], ['TAX_ID', ''],
  ['BILL_PREFIX', 'PK'], ['BILL_NEXT', '1'], ['STMT_PREFIX', 'PKS'], ['STMT_NEXT', '1'],
];

function setupPkSystem() {
  let ss;
  const id = prop('PK_SHEET_ID');
  if (id) { ss = SpreadsheetApp.openById(id); }
  else { ss = SpreadsheetApp.create('PKSystem'); setProp('PK_SHEET_ID', ss.getId()); }
  Object.keys(TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(TABS[name]); sh.setFrozenRows(1); }
    else {
      // เพิ่มเฉพาะคอลัมน์ที่ขาด "ต่อท้าย" เท่านั้น — ไม่แทรกกลาง ไม่เรียงใหม่ ไม่ลบของที่มี
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      TABS[name].forEach(function (label) {
        if (head.indexOf(label) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(label);
      });
    }
  });
  // PIN/Token เก็บเป็นข้อความ กัน 0 นำหน้าหาย
  const stf = ss.getSheetByName('Staff');
  const stfHead = stf.getRange(1, 1, 1, stf.getLastColumn()).getValues()[0].map(String);
  ['PIN', 'Token'].forEach(function (c) {
    const i = stfHead.indexOf(c);
    if (i >= 0) stf.getRange(1, i + 1, stf.getMaxRows(), 1).setNumberFormat('@');
  });
  const st = ss.getSheetByName('Settings');
  if (st.getLastRow() <= 1) SETTINGS_SEED.forEach(function (r) { st.appendRow(r); });
  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  _SS = null;   // ล้างแคช handle เดิม เผื่อเพิ่งเพิ่มแท็บใหม่ในรอบนี้
  repairStaffIds_();
  Logger.log('PKSystem พร้อมใช้: ' + ss.getUrl());
}

// ─── ตัวช่วยชีต (หาคอลัมน์จากหัวตารางเสมอ) ───
let _SS = null;
function book() { if (!_SS) _SS = SpreadsheetApp.openById(prop('PK_SHEET_ID')); return _SS; }
function tab(name) {
  const sh = book().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแท็บ ' + name + ' — รัน setupPkSystem() ก่อน');
  return sh;
}
// Sheets คืนวันที่เป็น Date object — แปลงเป็นข้อความรูปแบบเดียวเสมอก่อนใช้เทียบ
function fmtCell(v) {
  if (v instanceof Date) {
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, TZ, 'HH:mm'); // Sheets เก็บ 'เวลาอย่างเดียว' เป็นฐานปี 1899
    const hasTime = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  return v;
}
function readTab(name) {
  const v = tab(name).getDataRange().getValues();
  const head = (v[0] || []).map(String);
  return { head: head, rows: v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) { return r.map(fmtCell); }) };
}
function toObjs(head, rows) {
  return rows.map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i] !== undefined ? r[i] : ''; }); return o; });
}
function rowsToObjs(name) { const d = readTab(name); return toObjs(d.head, d.rows); }
// อ่านเฉพาะหางแท็บ log ใหญ่ ๆ (ประหยัดเวลา — อย่าอ่านทั้งแท็บ)
function tailObjs(name, n) {
  const sh = tab(name);
  const last = sh.getLastRow();
  if (last <= 1) return [];
  const cols = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
  const from = Math.max(2, last - n + 1);
  const rows = sh.getRange(from, 1, last - from + 1, cols).getValues()
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (r) { return r.map(fmtCell); });
  return toObjs(head, rows);
}
// อ่านหางแท็บจนครอบช่วงวันที่ที่ต้องใช้ — กันข้อมูล 30 วันเกินโควตาแถวแล้วโดนตัดเงียบ ๆ
function tailSince_(name, dateLabel, since, n) {
  let rows = tailObjs(name, n);
  const total = tab(name).getLastRow() - 1;
  while (rows.length >= n && n < total && rows[0] && String(rows[0][dateLabel]).slice(0, 10) >= since) {
    n *= 2;
    rows = tailObjs(name, n);
  }
  return rows;
}
function col(head, label) {
  const i = head.indexOf(label);
  if (i < 0) throw new Error('ไม่พบคอลัมน์ "' + label + '"');
  return i;
}
function appendObj(name, obj) {
  const sh = tab(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(head.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
}
// เขียนหลายแถวรวดเดียว — ใช้กับงานก้อนใหญ่ (import) เพราะ appendObj ทีละแถว = อ่านหัวตาราง+เขียน
// อย่างละ 1 เรียก API ต่อ 1 แถว หลักพันแถวจะชนเพดานรัน 6 นาทีของ Apps Script แน่นอน
function appendObjs(name, objs) {
  if (!objs || !objs.length) return 0;
  const sh = tab(name);
  const cols = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
  const rows = objs.map(function (o) {
    return head.map(function (h) { return o[h] !== undefined ? o[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, cols).setValues(rows);
  return rows.length;
}
function updateWhere(name, idLabel, idValue, patch) {
  const sh = tab(name);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  const idc = col(head, idLabel);
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][idc]) === String(idValue)) {
      const row = v[i].slice();
      Object.keys(patch).forEach(function (label) { row[col(head, label)] = patch[label]; });
      sh.getRange(i + 1, 1, 1, head.length).setValues([row]);
      return true;
    }
  }
  return false;
}
function now() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function daysFromNow(d) { return Utilities.formatDate(new Date(Date.now() + d * 86400000), TZ, 'yyyy-MM-dd'); }
function num(x) { return Number(String(x).replace(/,/g, '')) || 0; }
function padN(n, pad) { const s2 = String(n); return s2.length >= pad ? s2 : ('000000' + s2).slice(-pad); }
function yy_() { return Utilities.formatDate(new Date(), TZ, 'yy'); }
function settingsMap() {
  const st = readTab('Settings'); const m = {};
  const kc = col(st.head, 'key'), vc = col(st.head, 'value');
  st.rows.forEach(function (r) { m[r[kc]] = r[vc]; });
  return m;
}
// เลขรัน (เรียกได้เฉพาะใน mutation ที่ถือ lock อยู่แล้ว — ห้ามใส่ lock ซ้อน)
function seq(counterKey, prefix, pad) {
  const st = tab('Settings');
  const v = st.getDataRange().getValues();
  const head = v[0].map(String);
  const kc = col(head, 'key'), vc = col(head, 'value');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][kc]) === counterKey) {
      const n = Number(v[i][vc]) || 1;
      st.getRange(i + 1, vc + 1).setValue(n + 1);
      return prefix + padN(n, pad || 4);
    }
  }
  st.appendRow([counterKey, 2]);
  return prefix + padN(1, pad || 4);
}
// ตัวนับแบบระบุ key ตรง ๆ (ใช้กับ BILL_NEXT / STMT_NEXT เดิมของ v1)
function nextCounter(counterKey, pad, prefix) {
  const st = tab('Settings');
  const v = st.getDataRange().getValues();
  const head = v[0].map(String);
  const kc = col(head, 'key'), vc = col(head, 'value');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][kc]) === counterKey) {
      const n = Number(v[i][vc]) || 1;
      st.getRange(i + 1, vc + 1).setValue(n + 1);
      return prefix + padN(n, pad);
    }
  }
  st.appendRow([counterKey, 2]);
  return prefix + padN(1, pad);
}

// ─────────────────────────────────────────────
// พนักงาน + ล็อกอิน (PIN → token) — PIN ห้ามหลุดออก API เด็ดขาด
// ─────────────────────────────────────────────
// แถวพนักงานที่พิมพ์มือลงชีตตรง ๆ มักไม่มี Staff_ID → บอร์ดกดแก้ไขไม่ได้ (ปุ่มอ้าง ID)
// เติม ID ให้ (เป็น "ชื่อเรียกแถว" ล้วน ๆ ไม่ได้ให้สิทธิ์อะไรเพิ่ม)
// ⚠️ ไม่แตะ "สถานะ" กับ PIN — ต้องให้ผู้บริหารตั้งเองจากบอร์ด
//    ไม่งั้นใครแอบเพิ่มแถวในชีตก็จะกลายเป็นพนักงานที่ล็อกอินได้ทันที
function repairStaffIds_() {
  const sh = tab('Staff');
  if (sh.getLastRow() < 2) return 0;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const c = head.indexOf('Staff_ID');
  if (c < 0) return 0;
  const col1 = sh.getRange(2, c + 1, sh.getLastRow() - 1, 1);
  const vals = col1.getValues();
  let n = 0;
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === '') { vals[i][0] = seq('STAFF_NEXT', 'S', 3); n++; }
  }
  if (n) col1.setValues(vals);
  return n;
}
function staffPublic() {
  return rowsToObjs('Staff').map(function (s) {
    return { 'Staff_ID': s['Staff_ID'], 'ชื่อ': s['ชื่อ'], 'ชื่อเล่น': s['ชื่อเล่น'], 'แผนก': s['แผนก'], 'สถานะ': s['สถานะ'], 'เริ่มงาน': s['เริ่มงาน'], 'หมายเหตุ': s['หมายเหตุ'] };
  });
}
function login(pay) {
  const nick = String(pay.nick || '').trim();
  const pin = String(pay.pin || '').trim();
  if (!nick || !pin) return { ok: false, error: 'ใส่ชื่อเล่นและ PIN' };
  const cache = CacheService.getScriptCache();
  const fkey = 'lf:' + nick;
  const fails = Number(cache.get(fkey) || 0);
  if (fails >= 5) return { ok: false, error: 'ผิดเกิน 5 ครั้ง — ล็อก 10 นาที' };
  const st = readTab('Staff');
  const o = toObjs(st.head, st.rows).filter(function (s) {
    return String(s['ชื่อเล่น']).trim() === nick && s['สถานะ'] === 'ทำงาน';
  })[0];
  if (!o || String(o['PIN']).trim() !== pin) {
    cache.put(fkey, String(fails + 1), 600);
    return { ok: false, error: 'ชื่อเล่นหรือ PIN ไม่ถูกต้อง' };
  }
  cache.remove(fkey);
  const token = Utilities.getUuid();
  const exp = Utilities.formatDate(new Date(Date.now() + TOKEN_DAYS * 86400000), TZ, 'yyyy-MM-dd HH:mm');
  updateWhere('Staff', 'Staff_ID', o['Staff_ID'], { 'Token': token, 'TokenExp': exp });
  return { ok: true, token: token, me: { id: o['Staff_ID'], name: o['ชื่อ'], nick: o['ชื่อเล่น'], dept: o['แผนก'] }, _log: { ref: o['Staff_ID'], detail: nick } };
}
function who(p) {
  if (p.token) {
    const st = readTab('Staff');
    const o = toObjs(st.head, st.rows).filter(function (s) {
      return String(s['Token']) === String(p.token) && s['สถานะ'] === 'ทำงาน' && String(s['TokenExp']) >= now();
    })[0];
    if (o) return { id: o['Staff_ID'], name: o['ชื่อ'], nick: o['ชื่อเล่น'], dept: o['แผนก'], via: 'pin' };
    return null;
  }
  if (p.key && p.key === prop('PK_EXEC_KEY')) return { id: 'EXEC', name: 'ผู้บริหาร', nick: 'ผู้บริหาร', dept: 'บริหาร', via: 'exec' };
  if (p.key && p.key === prop('PK_KEY')) return { id: 'KEY', name: 'ทีม(รหัสร่วม)' + (p.user ? ':' + p.user : ''), nick: p.user || 'รหัสร่วม', dept: 'ออฟฟิศ', via: 'key' };
  return null;
}
function staffSave(pay, me) { // exec เท่านั้น: {id?, name, nick, dept, pin?, status?, start?, note?}
  const nick = String(pay.nick || '').trim();
  if (!pay.name || !nick) return { ok: false, error: 'ต้องมีชื่อและชื่อเล่น' };
  const all = rowsToObjs('Staff');
  // adopt = บอร์ดกำลังแก้ "แถวที่ยังไม่มี Staff_ID" (พิมพ์มือลงชีตมาก่อน) — รับมาเป็นของระบบแล้วแก้ต่อ
  // ไม่ใช่การเพิ่มคนใหม่ จึงไม่ต้องเช็คชื่อเล่นซ้ำกับตัวเอง
  if (!pay.id && pay.adopt) {
    const rows = all.filter(function (s) { return String(s['ชื่อเล่น']).trim() === nick; });
    if (rows.length !== 1) return { ok: false, error: 'หาแถวของ "' + nick + '" ไม่เจอ หรือเจอซ้ำกัน ' + rows.length + ' แถว — แก้ในชีตก่อน' };
    if (!String(rows[0]['Staff_ID']).trim()) repairStaffIds_();   // เติม ID ให้ทุกแถวที่ยังว่าง แล้วค่อยอ่านใหม่
    const got = rowsToObjs('Staff').filter(function (s) { return String(s['ชื่อเล่น']).trim() === nick; })[0];
    if (!got || !String(got['Staff_ID']).trim()) return { ok: false, error: 'เติม Staff_ID ให้แถวนี้ไม่สำเร็จ' };
    pay.id = got['Staff_ID'];
  }
  const dup = all.filter(function (s) { return String(s['ชื่อเล่น']).trim() === nick && s['Staff_ID'] !== pay.id; })[0];
  if (dup) return { ok: false, error: 'ชื่อเล่น "' + nick + '" ถูกใช้แล้ว (' + dup['ชื่อ'] + ')' };
  if (pay.pin && !/^\d{4,6}$/.test(String(pay.pin))) return { ok: false, error: 'PIN ต้องเป็นตัวเลข 4-6 หลัก' };
  if (pay.id) {
    const patch = { 'ชื่อ': pay.name, 'ชื่อเล่น': nick, 'แผนก': pay.dept || '', 'สถานะ': pay.status || 'ทำงาน', 'หมายเหตุ': pay.note || '' };
    if (pay.pin) patch['PIN'] = String(pay.pin);
    if (pay.status && pay.status !== 'ทำงาน') { patch['Token'] = ''; patch['TokenExp'] = ''; }  // พ้นสภาพ = หลุดจากระบบทันที
    if (!updateWhere('Staff', 'Staff_ID', pay.id, patch)) return { ok: false, error: 'ไม่พบ ' + pay.id };
    return { ok: true, id: pay.id, _log: { ref: pay.id, detail: pay.name + (pay.pin ? ' (ตั้ง PIN ใหม่)' : '') } };
  }
  if (!pay.pin) return { ok: false, error: 'พนักงานใหม่ต้องตั้ง PIN' };
  const id = seq('STAFF_NEXT', 'S', 3);
  appendObj('Staff', { 'Staff_ID': id, 'ชื่อ': pay.name, 'ชื่อเล่น': nick, 'แผนก': pay.dept || '', 'PIN': String(pay.pin), 'สถานะ': 'ทำงาน', 'เริ่มงาน': pay.start || today() });
  return { ok: true, id: id, _log: { ref: id, detail: pay.name } };
}

// ─────────────────────────────────────────────
// สต๊อก — Products.คงเหลือ / Materials.คงเหลือ คือยอดจริง, StockMoves คือประวัติ
// ทุกตัวที่แตะยอดถูกเรียกภายใน lock ของ dispatch เท่านั้น
// ─────────────────────────────────────────────
function stockShift_(kind, itemId, name, qty, moveType, refId, byName, note) {
  const tabName = kind === 'วัตถุดิบ' ? 'Materials' : 'Products';
  const idLabel = kind === 'วัตถุดิบ' ? 'Material_ID' : 'Product_ID';
  const balLabel = 'คงเหลือ';
  const d = readTab(tabName);
  const o = toObjs(d.head, d.rows).filter(function (x) { return itemId ? String(x[idLabel]) === String(itemId) : String(x[kind === 'วัตถุดิบ' ? 'ชื่อวัตถุดิบ' : 'ชื่อสินค้า']).trim() === String(name).trim(); })[0];
  if (!o) return { moved: false, name: name };
  const bal = num(o[balLabel]) + qty;
  updateWhere(tabName, idLabel, o[idLabel], (function () { const pt = {}; pt[balLabel] = bal; return pt; })());
  appendObj('StockMoves', {
    'Move_ID': seq('MOVE_NEXT', 'MV', 6), 'เมื่อ': now(), 'ประเภท': moveType, 'ชนิด': kind,
    'Item_ID': o[idLabel], 'ชื่อ': o[kind === 'วัตถุดิบ' ? 'ชื่อวัตถุดิบ' : 'ชื่อสินค้า'], 'จำนวน': qty, 'คงเหลือหลัง': bal,
    'ผู้ทำ': byName, 'อ้างอิง': refId || '', 'หมายเหตุ': note || '',
  });
  return { moved: true, id: o[idLabel], bal: bal };
}
function stockIn(pay, me) { // {kind, id?, name, qty, note} รับของเข้า (ของใหม่ = สร้างรายการวัตถุดิบให้)
  const qty = Number(pay.qty);
  if (!qty || qty <= 0) return { ok: false, error: 'จำนวนต้องมากกว่า 0' };
  let r = stockShift_(pay.kind, pay.id, pay.name, qty, 'รับเข้า', '', me.name, pay.note);
  if (!r.moved && pay.kind === 'วัตถุดิบ' && pay.name) {
    const id = seq('MAT_NEXT', 'M', 3);
    appendObj('Materials', { 'Material_ID': id, 'ชื่อวัตถุดิบ': String(pay.name).trim(), 'หน่วย': pay.unit || '', 'คงเหลือ': 0, 'จุดสั่งซื้อ': pay.reorder || '' });
    r = stockShift_(pay.kind, id, pay.name, qty, 'รับเข้า', '', me.name, pay.note);
  }
  if (!r.moved) return { ok: false, error: 'ไม่พบ "' + pay.name + '" ในระบบ (สินค้าใหม่ให้ประธานเพิ่มจากบอร์ด)' };
  return { ok: true, bal: r.bal, _log: { ref: r.id, detail: pay.name + ' +' + qty } };
}
function stockCount(pay, me) { // {kind, id, counted, note} นับจริง-ปรับยอด
  const tabName = pay.kind === 'วัตถุดิบ' ? 'Materials' : 'Products';
  const idLabel = pay.kind === 'วัตถุดิบ' ? 'Material_ID' : 'Product_ID';
  const o = rowsToObjs(tabName).filter(function (x) { return String(x[idLabel]) === String(pay.id); })[0];
  if (!o) return { ok: false, error: 'ไม่พบรายการ' };
  const counted = Number(pay.counted);
  if (isNaN(counted) || counted < 0) return { ok: false, error: 'จำนวนนับไม่ถูกต้อง' };
  const diff = counted - num(o['คงเหลือ']);
  if (diff !== 0 && !pay.note) return { ok: false, error: 'ยอดต่างจากระบบ ' + diff + ' — ต้องใส่เหตุผล' };
  if (diff === 0) return { ok: true, diff: 0 };
  const r = stockShift_(pay.kind, pay.id, '', diff, 'ปรับยอด', '', me.name, pay.note);
  return { ok: true, diff: diff, bal: r.bal, _log: { ref: pay.id, detail: (o['ชื่อสินค้า'] || o['ชื่อวัตถุดิบ']) + ' ปรับ ' + (diff > 0 ? '+' : '') + diff + ' (' + pay.note + ')' } };
}

// ─────────────────────────────────────────────
// ออเดอร์ → งานผลิต/สกรีน "รายสินค้า" → ส่งเป็นงวด
// ─────────────────────────────────────────────
// ชื่อสินค้าอ่านง่ายจากสเปก 5 แกน — ใช้ทั้งแสดงผลและจับคู่แท็บ Products
function specName_(it) {
  return [it.type, it.size, it.shape, it.neck, it.color].map(function (x) { return String(x || '').trim(); })
    .filter(Boolean).join(' ');
}
// จำนวนใบ = ถุง × ใบต่อถุง + เศษใบ (วิธีนับจริงของหน้างาน) · ไม่ได้กรอกถุงก็ใช้จำนวนตรง ๆ
function specQty_(it) {
  const bags = Number(it.bags) || 0, extra = Number(it.extra) || 0;
  if (bags > 0) {
    const per = Number(it.perBag) || perBag_(it.type, it.size);
    if (per > 0) return bags * per + extra;
  }
  return Number(it.qty) || extra || 0;
}
function resolveItems_(items) {
  const prods = rowsToObjs('Products');
  const unmapped = [];
  const out = (items || []).map(function (it) {
    if (it.type) cleanAxes_(it);
    const name = it.type ? specName_(it) : String(it.name || '').trim();
    const qty = it.type ? specQty_(it) : (Number(it.qty) || 0);
    const p = prods.filter(function (x) { return String(x['ชื่อสินค้า']).trim() === name; })[0];
    if (!p && name) unmapped.push(name);
    return {
      pid: p ? p['Product_ID'] : '', name: name, qty: qty, price: Number(it.price) || 0,
      screen: !!it.screen, screenNote: it.screenNote || '',
      // เก็บสเปกดิบไว้ด้วย — รายงาน/ค้นย้อนหลังทำได้ ไม่ต้องแกะจากชื่อ
      type: it.type || '', size: it.size || '', neck: it.neck || '', shape: it.shape || '', color: it.color || '',
      screenColor: it.screenColor || '', capColor: it.capColor || '',
      bags: Number(it.bags) || 0, extra: Number(it.extra) || 0, perBag: Number(it.perBag) || perBag_(it.type, it.size) || 0,
    };
  }).filter(function (it) { return it.name && it.qty > 0; });
  return { items: out, unmapped: unmapped };
}
function orderSave(pay, me) {
  const rs = resolveItems_(pay.items);
  const items = rs.items;
  const customer = String(pay.customer || '').trim();
  if (!customer || !items.length) return { ok: false, error: 'ต้องมีลูกค้าและรายการ' };
  const total = items.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
  const hasScreen = items.some(function (it) { return it.screen; });
  const id = seq('ORD_NEXT', 'PO' + yy_() + '-', 4);
  const cust = custSave({ name: customer }, me);
  appendObj('Orders', {
    'Order_ID': id, 'วันที่รับ': today(), 'ลูกค้า': customer, 'Customer_ID': cust.id || '',
    'กำหนดส่ง': pay.due || '', 'สถานะ': 'รอผลิต', 'มีสกรีน': hasScreen ? 'มี' : '', 'ยอดรวม': total,
    'รายการ': JSON.stringify(items), 'หมายเหตุ': pay.note || '', 'ผู้รับออเดอร์': me.name, 'อัปเดตล่าสุด': now(),
    // ช่องใหม่ 2026-08-30f — เดิมเขียนปนในหมายเหตุ ("รอโอน" "รอแบบ" "ค่าบล้อค 500" "ขอด่วน")
    'สถานะเงิน': pay.payStatus || '', 'สถานะแบบ': pay.artStatus || '', 'ค่าบล็อก': Number(pay.blockFee) || '',
    'ด่วน': pay.urgent ? 'ด่วน' : '', 'ทีมสกรีน': pay.screenTeam || '', 'ประเภทการซื้อ': pay.buyType || '',
    'แบรนด์': pay.brand || '', 'ราคา': pay.priceMode || '',
  });
  items.forEach(function (it) {
    appendObj('Production', {
      'Job_ID': seq('JOB_NEXT', 'PJ' + yy_() + '-', 4), 'Order_ID': id, 'วันที่เข้าคิว': today(),
      'งาน': it.name + ' ×' + it.qty, 'จำนวนรวม': it.qty,
      'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอผลิต',
    });
    if (it.screen) {
      appendObj('ScreenJobs', {
        'Job_ID': seq('SJOB_NEXT', 'SJ' + yy_() + '-', 4), 'Order_ID': id, 'วันที่เข้าคิว': today(),
        'ลาย/สี': it.name + (it.screenNote ? ' (' + it.screenNote + ')' : ''), 'จำนวน': it.qty,
        'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอสกรีน',
      });
    }
  });
  return { ok: true, id: id, total: total, unmapped: rs.unmapped, _log: { ref: id, detail: customer + ' ' + items.length + ' รายการ ' + total + ' บ.' + (rs.unmapped.length ? ' (นอกระบบ: ' + rs.unmapped.join(',') + ')' : '') } };
}
function jobsOf_(orderId) {
  return {
    prod: rowsToObjs('Production').filter(function (j) { return j['Order_ID'] === orderId; }),
    scr: rowsToObjs('ScreenJobs').filter(function (j) { return j['Order_ID'] === orderId; }),
  };
}
function deliveredMapAll_() { // อ่าน Deliveries รอบเดียว → { orderId: { pid|ชื่อ: ยอดส่งสะสม } }
  const by = {};
  rowsToObjs('Deliveries').forEach(function (d) {
    let its = []; try { its = JSON.parse(d['รายการ'] || '[]'); } catch (e) {}
    const m = by[d['Order_ID']] = by[d['Order_ID']] || {};
    its.forEach(function (it) { const k = it.pid || it.name; m[k] = (m[k] || 0) + (Number(it.qty) || 0); });
  });
  return by;
}
function deliveredOf_(orderId) { return deliveredMapAll_()[orderId] || {}; }
function orderEdit(pay, me) { // แก้ได้เฉพาะออเดอร์ที่ยังไม่เริ่มอะไรเลย
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === pay.id; })[0];
  if (!ord) return { ok: false, error: 'ไม่พบออเดอร์' };
  if (ord['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'ออเดอร์ถูกยกเลิกแล้ว — เปิดออเดอร์ใหม่แทน' };
  const j = jobsOf_(pay.id);
  const started = j.prod.concat(j.scr).some(function (x) { return x['สถานะ'] !== 'รอผลิต' && x['สถานะ'] !== 'รอสกรีน' && x['สถานะ'] !== 'ยกเลิก'; });
  if (started || ord['Bill_No'] || Object.keys(deliveredOf_(pay.id)).length) return { ok: false, error: 'งานเริ่มแล้ว/มีบิลหรือการส่งแล้ว — แก้ไม่ได้ ให้ยกเลิกแล้วเปิดใหม่ หรือติดต่อผู้บริหาร' };
  j.prod.concat(j.scr).forEach(function (x) {
    updateWhere(x['Job_ID'].indexOf('SJ') === 0 ? 'ScreenJobs' : 'Production', 'Job_ID', x['Job_ID'], { 'สถานะ': 'ยกเลิก', 'หมายเหตุ': 'แก้ออเดอร์' });
  });
  const rs = resolveItems_(pay.items);
  if (!rs.items.length) return { ok: false, error: 'ต้องมีรายการอย่างน้อย 1 รายการ' };
  const total = rs.items.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
  const customer2 = String(pay.customer || ord['ลูกค้า']).trim();
  const cust2 = custSave({ name: customer2 }, me);
  updateWhere('Orders', 'Order_ID', pay.id, {
    'ลูกค้า': customer2, 'Customer_ID': cust2.id || '', 'กำหนดส่ง': pay.due || '', 'ยอดรวม': total,
    'มีสกรีน': rs.items.some(function (it) { return it.screen; }) ? 'มี' : '', 'รายการ': JSON.stringify(rs.items),
    'หมายเหตุ': pay.note || '', 'อัปเดตล่าสุด': now(),
  });
  rs.items.forEach(function (it) {
    appendObj('Production', { 'Job_ID': seq('JOB_NEXT', 'PJ' + yy_() + '-', 4), 'Order_ID': pay.id, 'วันที่เข้าคิว': today(), 'งาน': it.name + ' ×' + it.qty, 'จำนวนรวม': it.qty, 'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอผลิต' });
    if (it.screen) appendObj('ScreenJobs', { 'Job_ID': seq('SJOB_NEXT', 'SJ' + yy_() + '-', 4), 'Order_ID': pay.id, 'วันที่เข้าคิว': today(), 'ลาย/สี': it.name + (it.screenNote ? ' (' + it.screenNote + ')' : ''), 'จำนวน': it.qty, 'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอสกรีน' });
  });
  return { ok: true, unmapped: rs.unmapped, _log: { ref: pay.id, detail: 'แก้รายการ (' + rs.items.length + ' รายการ ' + total + ' บ.)' } };
}
function orderCancel(pay, me) {
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === pay.id; })[0];
  if (!ord) return { ok: false, error: 'ไม่พบออเดอร์' };
  if (Object.keys(deliveredOf_(pay.id)).length) return { ok: false, error: 'มีการส่งของไปแล้ว — ยกเลิกไม่ได้ ต้องทำรับคืนก่อน (แจ้งผู้บริหาร)' };
  if (ord['Bill_No']) return { ok: false, error: 'มีบิลแล้ว (' + ord['Bill_No'] + ') — ยกเลิกบิลก่อน' };
  const j = jobsOf_(pay.id);
  j.prod.forEach(function (x) { if (x['สถานะ'] !== 'เสร็จ') updateWhere('Production', 'Job_ID', x['Job_ID'], { 'สถานะ': 'ยกเลิก' }); });
  j.scr.forEach(function (x) { if (x['สถานะ'] !== 'เสร็จ') updateWhere('ScreenJobs', 'Job_ID', x['Job_ID'], { 'สถานะ': 'ยกเลิก' }); });
  updateWhere('Orders', 'Order_ID', pay.id, { 'สถานะ': 'ยกเลิก', 'หมายเหตุ': (ord['หมายเหตุ'] ? ord['หมายเหตุ'] + ' | ' : '') + 'ยกเลิก: ' + (pay.note || '-'), 'อัปเดตล่าสุด': now() });
  return { ok: true, _log: { ref: pay.id, detail: ord['ลูกค้า'] + (pay.note ? ' — เหตุผล: ' + pay.note : '') } };
}
function recomputeOrder_(orderId) {
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === orderId; })[0];
  if (!ord || ord['สถานะ'] === 'ยกเลิก') return;
  let items = []; try { items = JSON.parse(ord['รายการ'] || '[]'); } catch (e) {}
  const delivered = deliveredOf_(orderId);
  const orderedByKey = {};
  items.forEach(function (it) { const k = it.pid || it.name; orderedByKey[k] = (orderedByKey[k] || 0) + it.qty; });
  const totalOrdered = items.reduce(function (s, it) { return s + it.qty; }, 0);
  const totalDelivered = Object.keys(orderedByKey).reduce(function (s, k) { return s + Math.min(delivered[k] || 0, orderedByKey[k]); }, 0);
  let status;
  if (totalOrdered > 0 && totalDelivered >= totalOrdered) status = 'ส่งแล้ว';
  else if (totalDelivered > 0) status = 'ส่งบางส่วน';
  else {
    const j = jobsOf_(orderId);
    const active = function (list) { return list.filter(function (x) { return x['สถานะ'] !== 'ยกเลิก'; }); };
    const prod = active(j.prod), scr = active(j.scr);
    const prodDone = prod.every(function (x) { return x['สถานะ'] === 'เสร็จ'; });
    const scrDone = scr.every(function (x) { return x['สถานะ'] === 'เสร็จ'; });
    if (prodDone && scrDone) status = 'พร้อมส่ง';
    else if (scr.some(function (x) { return x['สถานะ'] === 'กำลังสกรีน'; })) status = 'กำลังสกรีน';
    else if (prodDone && !scrDone) status = 'รอสกรีน';
    else if (prod.some(function (x) { return x['สถานะ'] === 'กำลังผลิต'; })) status = 'กำลังผลิต';
    else status = 'รอผลิต';
  }
  const patch = { 'สถานะ': status, 'อัปเดตล่าสุด': now() };
  if (status === 'ส่งแล้ว' && !ord['ส่งครบเมื่อ']) patch['ส่งครบเมื่อ'] = today();
  updateWhere('Orders', 'Order_ID', orderId, patch);
  return status;
}

// ─── งานผลิต/สกรีน: เริ่ม → ลงผลผลิต (ดี/เสีย) → ปิดงาน ───
function jobTab_(type) { return type === 'screen' ? 'ScreenJobs' : 'Production'; }
function jobStart(pay, me) {
  const t = jobTab_(pay.type);
  const job = rowsToObjs(t).filter(function (j) { return j['Job_ID'] === pay.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน' };
  if (job['สถานะ'] === 'ยกเลิก' || job['สถานะ'] === 'เสร็จ') return { ok: false, error: 'งานนี้' + job['สถานะ'] + 'แล้ว' };
  updateWhere(t, 'Job_ID', pay.id, { 'สถานะ': pay.type === 'screen' ? 'กำลังสกรีน' : 'กำลังผลิต', 'เริ่มเมื่อ': now(), 'ผู้ทำ': me.name });
  recomputeOrder_(job['Order_ID']);
  return { ok: true, _log: { ref: pay.id, detail: job['สินค้า'] || job['งาน'] } };
}
function prodLog(pay, me) { // {type:'prod'|'screen', id, good, waste, reason?, machine?, shift?, note?}
  const t = jobTab_(pay.type);
  const job = rowsToObjs(t).filter(function (j) { return j['Job_ID'] === pay.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน' };
  if (job['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'งานนี้ถูกยกเลิกแล้ว — ลงผลผลิตไม่ได้' };
  if (job['สถานะ'] === 'เสร็จ') return { ok: false, error: 'งานนี้ปิดแล้ว' };
  const good = Number(pay.good) || 0, waste = Number(pay.waste) || 0, gradeB = Number(pay.gradeB) || 0;
  if (good <= 0 && waste <= 0 && gradeB <= 0) return { ok: false, error: 'ใส่จำนวนดี เกรด B หรือของเสียอย่างน้อยหนึ่งช่อง' };
  if (waste > 0 && !pay.reason) return { ok: false, error: 'มีของเสียต้องเลือกสาเหตุ' };
  // เกรด B = ขายได้แต่ราคาต่ำกว่า — นับแยก ไม่บวกเข้าสต๊อกของดี (กันยอดขายได้เกินจริง)
  const patch = { 'ดีสะสม': num(job['ดีสะสม']) + good, 'เสียสะสม': num(job['เสียสะสม']) + waste,
                  'เกรดBสะสม': num(job['เกรดBสะสม']) + gradeB, 'ผู้ทำ': me.name };
  if (job['สถานะ'].indexOf('รอ') === 0) { patch['สถานะ'] = pay.type === 'screen' ? 'กำลังสกรีน' : 'กำลังผลิต'; patch['เริ่มเมื่อ'] = now(); }
  updateWhere(t, 'Job_ID', pay.id, patch);
  appendObj('ProductionLogs', {
    'เมื่อ': now(), 'Job_ID': pay.id, 'Order_ID': job['Order_ID'], 'Product_ID': job['Product_ID'], 'สินค้า': job['สินค้า'],
    'ประเภทงาน': pay.type === 'screen' ? 'สกรีน' : 'ผลิต', 'ดี': good, 'เสีย': waste, 'เกรดB': gradeB, 'สาเหตุเสีย': pay.reason || '',
    'เครื่อง': pay.machine || '', 'กะ': pay.shift || '', 'ผู้ลง': me.name, 'หมายเหตุ': pay.note || '',
  });
  // ผลิต: ของดีเข้าสต๊อกสินค้า | สกรีน: ของเสียหักสต๊อก (ขวดที่ผลิตเข้าแล้วถูกทำเสีย)
  if (pay.type !== 'screen' && good > 0 && job['Product_ID']) stockShift_('สินค้า', job['Product_ID'], '', good, 'ผลิตเข้า', pay.id, me.name, '');
  if (pay.type === 'screen' && waste > 0 && job['Product_ID']) stockShift_('สินค้า', job['Product_ID'], '', -waste, 'ของเสีย', pay.id, me.name, pay.reason || '');
  recomputeOrder_(job['Order_ID']);
  return { ok: true, done: num(job['ดีสะสม']) + good, target: num(job['จำนวนสั่ง']), _log: { ref: pay.id, detail: (job['สินค้า'] || '') + ' ดี+' + good + (gradeB ? ' เกรดB+' + gradeB : '') + (waste ? ' เสีย+' + waste + '(' + (pay.reason || '') + ')' : '') } };
}
function jobClose(pay, me) {
  const t = jobTab_(pay.type);
  const job = rowsToObjs(t).filter(function (j) { return j['Job_ID'] === pay.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน' };
  if (job['สถานะ'] === 'เสร็จ' || job['สถานะ'] === 'ยกเลิก') return { ok: true, already: true };
  updateWhere(t, 'Job_ID', pay.id, { 'สถานะ': 'เสร็จ', 'เสร็จเมื่อ': now(), 'ผู้ทำ': me.name });
  const st = recomputeOrder_(job['Order_ID']);
  return { ok: true, orderStatus: st, _log: { ref: pay.id, detail: (job['สินค้า'] || job['งาน']) + ' (ดี ' + job['ดีสะสม'] + '/' + job['จำนวนสั่ง'] + ')' } };
}

// ─── ส่งของเป็นงวด — จุดเดียวที่หักสต๊อกสินค้าออก (ฝั่งมีออเดอร์) ───
function deliver(pay, me) { // {orderId, items:[{pid?, name, qty}], note}
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === pay.orderId; })[0];
  if (!ord) return { ok: false, error: 'ไม่พบออเดอร์' };
  if (ord['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'ออเดอร์ถูกยกเลิกแล้ว' };
  let ordered = []; try { ordered = JSON.parse(ord['รายการ'] || '[]'); } catch (e) {}
  const delivered = deliveredOf_(pay.orderId);
  const sending = (pay.items || []).map(function (it) { return { pid: it.pid || '', name: String(it.name).trim(), qty: Number(it.qty) || 0 }; }).filter(function (it) { return it.qty > 0; });
  if (!sending.length) return { ok: false, error: 'ไม่ได้ระบุจำนวนที่ส่ง' };
  // คิดเป็น pool ต่อสินค้า — สินค้าเดียวกันหลายบรรทัด (ทั้งในออเดอร์และใน payload) ไม่หลุด/ไม่เบิ้ล
  const orderedByKey = {};
  ordered.forEach(function (x) { const k = x.pid || x.name; orderedByKey[k] = (orderedByKey[k] || 0) + (Number(x.qty) || 0); });
  const sendByKey = {};
  sending.forEach(function (it) { const k = it.pid || it.name; sendByKey[k] = (sendByKey[k] || 0) + it.qty; });
  const keys = Object.keys(sendByKey);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const nameOf = sending.filter(function (x) { return (x.pid || x.name) === k; })[0].name;
    if (!(k in orderedByKey)) return { ok: false, error: '"' + nameOf + '" ไม่อยู่ในออเดอร์นี้' };
    const remain = orderedByKey[k] - (delivered[k] || 0);
    if (sendByKey[k] > remain) return { ok: false, error: '"' + nameOf + '" เหลือให้ส่งแค่ ' + remain + ' (สั่ง ' + orderedByKey[k] + ')' };
  }
  const id = seq('DLV_NEXT', 'DL' + yy_() + '-', 4);
  appendObj('Deliveries', { 'Delivery_ID': id, 'เมื่อ': now(), 'Order_ID': pay.orderId, 'ลูกค้า': ord['ลูกค้า'], 'รายการ': JSON.stringify(sending), 'ผู้ส่ง': me.name, 'หมายเหตุ': pay.note || '' });
  const unmapped = [], negatives = [];
  sending.forEach(function (it) {
    if (it.pid) {
      const r = stockShift_('สินค้า', it.pid, '', -it.qty, 'ส่งออก', id, me.name, 'ออเดอร์ ' + pay.orderId);
      if (r.moved && r.bal < 0) negatives.push(it.name + ' เหลือ ' + r.bal);
    } else unmapped.push(it.name);
  });
  const st = recomputeOrder_(pay.orderId);
  return { ok: true, id: id, status: st, unmapped: unmapped, negatives: negatives, _log: { ref: pay.orderId, detail: ord['ลูกค้า'] + ' ส่ง ' + sending.map(function (i) { return i.name + '×' + i.qty; }).join(', ') + (unmapped.length ? ' (ไม่หักสต๊อก: ' + unmapped.join(',') + ')' : '') } };
}

// ─────────────────────────────────────────────
// บิล / ใบวางบิล (สัญญากับแชทการเงิน: คอลัมน์เดิมห้ามเปลี่ยน)
// ─────────────────────────────────────────────
function activeBills_() { return rowsToObjs('Bills').filter(function (b) { return b['สถานะ'] !== 'ยกเลิก'; }); }
function billList(p) {
  let bills = activeBills_();
  if (p.customer) bills = bills.filter(function (b) { return String(b['ลูกค้า']).trim() === String(p.customer).trim(); });
  if (p.status) bills = bills.filter(function (b) { return b['สถานะ'] === p.status; });
  return bills.reverse().slice(0, Number(p.limit) || 80);
}
function billCreate(pay, me) {
  let items = [], customer = String(pay.customer || '').trim(), orderId = pay.orderId || '', unmapped = [];
  if (orderId) {
    const ord = rowsToObjs('Orders').filter(function (x) { return x['Order_ID'] === orderId; })[0];
    if (!ord) return { ok: false, error: 'ไม่พบออเดอร์ ' + orderId };
    if (ord['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'ออเดอร์นี้ถูกยกเลิกแล้ว — ออกบิลไม่ได้' };
    if (ord['Bill_No']) return { ok: false, error: 'ออเดอร์นี้ออกบิลแล้ว: ' + ord['Bill_No'] };
    try { items = JSON.parse(ord['รายการ'] || '[]'); } catch (e) {}
    customer = ord['ลูกค้า'];
  } else {
    const rs = resolveItems_(pay.items);
    items = rs.items;
    unmapped = rs.unmapped;
    if (!customer || !items.length) return { ok: false, error: 'ต้องมีลูกค้าและรายการ' };
  }
  const total = items.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  const m = settingsMap();
  const no = nextCounter('BILL_NEXT', 4, (m.BILL_PREFIX || 'PK') + '-' + Utilities.formatDate(new Date(), TZ, 'yyyy') + '-');
  const isCredit = pay.type === 'เครดิต';
  let due = '';
  if (isCredit) due = daysFromNow(Number(pay.dueDays) || 30);
  appendObj('Bills', {
    'Bill_No': no, 'วันที่': today(), 'ลูกค้า': customer, 'Order_ID': orderId, 'ยอดรวม': total,
    'ประเภท': pay.type || 'เงินสด', 'ช่องทางชำระ': pay.channel || '', 'สถานะ': isCredit ? 'ค้างชำระ' : 'ชำระแล้ว',
    'กำหนดชำระ': due, 'ชำระเมื่อ': isCredit ? '' : today(), 'รายการ': JSON.stringify(items),
    'หมายเหตุ': pay.note || '', 'ที่มา': 'ระบบใหม่', 'ผู้ทำ': me.name,
  });
  if (orderId) updateWhere('Orders', 'Order_ID', orderId, { 'Bill_No': no, 'อัปเดตล่าสุด': now() });
  else items.forEach(function (it) { if (it.pid) stockShift_('สินค้า', it.pid, '', -(Number(it.qty) || 0), 'ส่งออก', no, me.name, 'บิลอิสระ'); }); // ขายไม่ผ่านออเดอร์ = หักสต๊อกที่บิล
  return { ok: true, no: no, total: total, due: due, customer: customer, items: items, date: today(), settings: m, unmapped: unmapped, _log: { ref: no, detail: customer + ' ' + total + ' บ. (' + (pay.type || 'เงินสด') + ')' + (unmapped.length ? ' (ไม่หักสต๊อก: ' + unmapped.join(',') + ')' : '') } };
}
function billPay(pay, me) {
  const b = rowsToObjs('Bills').filter(function (x) { return String(x['Bill_No']) === String(pay.no); })[0];
  if (!b) return { ok: false, error: 'ไม่พบบิล ' + pay.no };
  if (b['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'บิลนี้ถูกยกเลิกไปแล้ว' };
  if (b['สถานะ'] === 'ชำระแล้ว') return { ok: true, already: true };
  updateWhere('Bills', 'Bill_No', pay.no, { 'สถานะ': 'ชำระแล้ว', 'ชำระเมื่อ': today(), 'ช่องทางชำระ': pay.channel || '', 'ผู้ทำ': me.name });
  return { ok: true, _log: { ref: pay.no, detail: 'รับชำระ ' + b['ยอดรวม'] + ' บ. (' + (pay.channel || '') + ')' } };
}
function billCancel(pay, me) { // {no, note}
  if (!pay.note) return { ok: false, error: 'ยกเลิกบิลต้องใส่เหตุผล' };
  const b = rowsToObjs('Bills').filter(function (x) { return String(x['Bill_No']) === String(pay.no); })[0];
  if (!b) return { ok: false, error: 'ไม่พบบิล' };
  if (b['สถานะ'] === 'ยกเลิก') return { ok: true, already: true };
  if (b['Stmt_No']) return { ok: false, error: 'บิลอยู่ในใบวางบิล ' + b['Stmt_No'] + ' — จัดการใบวางบิลก่อน' };
  updateWhere('Bills', 'Bill_No', pay.no, { 'สถานะ': 'ยกเลิก', 'หมายเหตุ': (b['หมายเหตุ'] ? b['หมายเหตุ'] + ' | ' : '') + 'ยกเลิก: ' + pay.note, 'ผู้ทำ': me.name });
  if (b['Order_ID']) updateWhere('Orders', 'Order_ID', b['Order_ID'], { 'Bill_No': '', 'อัปเดตล่าสุด': now() });
  else if (b['ที่มา'] === 'ระบบใหม่') { // บิลอิสระเคยหักสต๊อก → คืน
    let its = []; try { its = JSON.parse(b['รายการ'] || '[]'); } catch (e) {}
    its.forEach(function (it) { if (it.pid) stockShift_('สินค้า', it.pid, '', Number(it.qty) || 0, 'รับคืน', pay.no, me.name, 'ยกเลิกบิล'); });
  }
  return { ok: true, _log: { ref: pay.no, detail: 'ยกเลิก: ' + pay.note } };
}
function stmtCreate(pay, me) {
  const want = (pay.billNos || []).map(String);
  const cust = String(pay.customer || '').trim();
  const bills = activeBills_().filter(function (b) { return want.indexOf(String(b['Bill_No'])) >= 0 && b['สถานะ'] === 'ค้างชำระ' && !b['Stmt_No']; });
  if (!bills.length) return { ok: false, error: 'ไม่ได้เลือกบิล หรือบิลถูกวางบิล/ชำระไปแล้ว — กดดึงบิลค้างใหม่' };
  if (bills.length !== want.length) return { ok: false, error: 'บางบิลวางบิล/ชำระไปแล้ว — กดดึงบิลค้างใหม่' };
  const wrong = bills.filter(function (b) { return String(b['ลูกค้า']).trim() !== cust; });
  if (wrong.length) return { ok: false, error: 'บิล ' + wrong.map(function (b) { return b['Bill_No']; }).join(', ') + ' ไม่ใช่ของลูกค้า "' + cust + '" — กดดึงบิลค้างใหม่' };
  const total = bills.reduce(function (s, b) { return s + num(b['ยอดรวม']); }, 0);
  const no = nextCounter('STMT_NEXT', 4, (settingsMap().STMT_PREFIX || 'PKS') + '-' + Utilities.formatDate(new Date(), TZ, 'yyyy') + '-');
  appendObj('Statements', {
    'Stmt_No': no, 'วันที่วาง': today(), 'ลูกค้า': pay.customer, 'จำนวนบิล': bills.length,
    'ยอดรวม': total, 'กำหนดเก็บเงิน': pay.due || '', 'สถานะ': 'รอเก็บ', 'บิลที่รวม': bills.map(function (b) { return b['Bill_No']; }).join(', '), 'หมายเหตุ': pay.note || '',
  });
  bills.forEach(function (b) { updateWhere('Bills', 'Bill_No', b['Bill_No'], { 'สถานะ': 'วางบิลแล้ว', 'Stmt_No': no }); });
  return { ok: true, no: no, total: total, bills: bills, date: today(), due: pay.due || '', customer: pay.customer, settings: settingsMap(), _log: { ref: no, detail: pay.customer + ' ' + bills.length + ' บิล ' + total + ' บ.' } };
}
function stmtDone(pay, me) {
  const st = rowsToObjs('Statements').filter(function (s) { return s['Stmt_No'] === pay.no; })[0];
  if (!st) return { ok: false, error: 'ไม่พบใบวางบิล ' + pay.no };
  if (st['สถานะ'] === 'เก็บแล้ว') return { ok: true, already: true };
  updateWhere('Statements', 'Stmt_No', pay.no, { 'สถานะ': 'เก็บแล้ว' });
  String(st['บิลที่รวม']).split(',').map(function (s) { return s.trim(); }).forEach(function (bn) {
    if (bn) updateWhere('Bills', 'Bill_No', bn, { 'สถานะ': 'ชำระแล้ว', 'ชำระเมื่อ': today(), 'ช่องทางชำระ': pay.channel || '', 'ผู้ทำ': me.name });
  });
  return { ok: true, _log: { ref: pay.no, detail: st['ลูกค้า'] + ' ' + st['ยอดรวม'] + ' บ.' } };
}

// ─── ลูกค้า / ราคา ───
function custSave(pay, me) {
  const name = String(pay.name || '').trim();
  if (!name) return { ok: false, error: 'ไม่มีชื่อ' };
  const all = rowsToObjs('Customers');
  const exist = all.filter(function (c) { return String(c['ชื่อลูกค้า']).trim() === name; })[0];
  if (exist) {
    if (pay.tel || pay.addr || pay.creditDays) updateWhere('Customers', 'Customer_ID', exist['Customer_ID'], { 'เบอร์โทร': pay.tel || exist['เบอร์โทร'], 'ที่อยู่': pay.addr || exist['ที่อยู่'], 'เครดิต(วัน)': pay.creditDays || exist['เครดิต(วัน)'] });
    return { ok: true, id: exist['Customer_ID'] };
  }
  const id = seq('CUST_NEXT', 'C', 4);
  appendObj('Customers', { 'Customer_ID': id, 'ชื่อลูกค้า': name, 'เบอร์โทร': pay.tel || '', 'ที่อยู่': pay.addr || '', 'เครดิต(วัน)': pay.creditDays || '', 'สร้างเมื่อ': now() });
  return { ok: true, id: id, _log: { ref: id, detail: name } };
}
function priceSet(pay, me) {
  const all = rowsToObjs('Products');
  const exist = all.filter(function (x) { return String(x['ชื่อสินค้า']).trim() === String(pay.name).trim(); })[0];
  const newPrice = Number(pay.price);
  if (!pay.name || isNaN(newPrice)) return { ok: false, error: 'ต้องมีชื่อสินค้าและราคา' };
  let id, oldPrice = '';
  if (exist) {
    id = exist['Product_ID'];
    oldPrice = exist['ราคา/หน่วย'];
    updateWhere('Products', 'Product_ID', id, { 'ราคา/หน่วย': newPrice, 'หน่วย': pay.unit || exist['หน่วย'], 'สถานะ': pay.status || exist['สถานะ'] || 'ใช้งาน', 'จุดเตือน': pay.alert !== undefined ? pay.alert : exist['จุดเตือน'] });
  } else {
    id = seq('PROD_NEXT', 'P', 4);
    appendObj('Products', { 'Product_ID': id, 'ชื่อสินค้า': String(pay.name).trim(), 'หน่วย': pay.unit || '', 'ราคา/หน่วย': newPrice, 'หมายเหตุ': pay.note || '', 'คงเหลือ': 0, 'จุดเตือน': pay.alert || '', 'สถานะ': 'ใช้งาน' });
  }
  appendObj('PriceHistory', { 'วันที่': now(), 'Product_ID': id, 'ชื่อสินค้า': String(pay.name).trim(), 'ราคาเดิม': oldPrice, 'ราคาใหม่': newPrice, 'ผู้ปรับ': me.name, 'หมายเหตุ': pay.note || '' });
  return { ok: true, id: id, oldPrice: oldPrice, newPrice: newPrice, _log: { ref: id, detail: pay.name + ' ' + (oldPrice !== '' ? oldPrice + '→' : 'ตั้ง ') + newPrice } };
}

// ─────────────────────────────────────────────
// ข้อมูลรวมสำหรับแอปทีม (เรียกครั้งเดียวได้ทุกอย่าง)
// ─────────────────────────────────────────────
function teamData(p, me) {
  const orders = rowsToObjs('Orders');
  const active = orders.filter(function (o) { return ['ส่งแล้ว', 'ยกเลิก'].indexOf(o['สถานะ']) < 0; });
  const recentDone = orders.filter(function (o) { return o['สถานะ'] === 'ส่งแล้ว'; }).slice(-10).reverse();
  const notJob = function (j) { return j['สถานะ'] !== 'เสร็จ' && j['สถานะ'] !== 'ยกเลิก'; };
  const billable = orders.filter(function (o) { return ['พร้อมส่ง', 'ส่งบางส่วน', 'ส่งแล้ว'].indexOf(o['สถานะ']) >= 0 && !o['Bill_No']; });
  // คิวส่ง: ออเดอร์ที่ยังมีของค้างส่ง
  const custs = rowsToObjs('Customers');
  const custBy = {}; custs.forEach(function (c) { custBy[String(c['ชื่อลูกค้า']).trim()] = c; });
  const dAll = deliveredMapAll_();
  const deliverQueue = active.map(function (o) {
    let items = []; try { items = JSON.parse(o['รายการ'] || '[]'); } catch (e) {}
    const d = dAll[o['Order_ID']] || {};
    const pool = {};
    items.forEach(function (it) {
      const k = it.pid || it.name;
      pool[k] = pool[k] || { pid: it.pid, name: it.name, ordered: 0 };
      pool[k].ordered += it.qty;
    });
    const remain = Object.keys(pool).map(function (k) {
      const sent = d[k] || 0;
      return { pid: pool[k].pid, name: pool[k].name, ordered: pool[k].ordered, sent: sent, remain: pool[k].ordered - sent };
    }).filter(function (r) { return r.remain > 0; });
    const c = custBy[String(o['ลูกค้า']).trim()] || {};
    return remain.length ? { id: o['Order_ID'], customer: o['ลูกค้า'], tel: c['เบอร์โทร'] || '', addr: c['ที่อยู่'] || '', due: o['กำหนดส่ง'], status: o['สถานะ'], remain: remain } : null;
  }).filter(Boolean).sort(function (a, b) { return String(a.due || '9999').localeCompare(String(b.due || '9999')); });
  return {
    ok: true, version: CODE_VERSION, me: { id: me.id, name: me.name, nick: me.nick, dept: me.dept, via: me.via },
    customers: custs, products: rowsToObjs('Products').filter(function (p2) { return (p2['สถานะ'] || 'ใช้งาน') !== 'เลิกขาย'; }),
    spec: SPEC, perBag: PER_BAG, minOrder: MIN_ORDER,
    machines: rowsToObjs('Machines').filter(function (m) { return (m['สถานะ'] || 'ใช้งาน') === 'ใช้งาน'; }).map(function (m) { return m['ชื่อเครื่อง']; }),
    settings: settingsMap(),
    orders: active.reverse().concat(recentDone),
    production: rowsToObjs('Production').filter(notJob).reverse(),
    screens: rowsToObjs('ScreenJobs').filter(notJob).reverse(),
    billable: billable.map(function (o) { return { id: o['Order_ID'], customer: o['ลูกค้า'], total: o['ยอดรวม'] }; }),
    deliverQueue: deliverQueue,
    bills: activeBills_().reverse().slice(0, 25),
    stmts: rowsToObjs('Statements').filter(function (s) { return s['สถานะ'] === 'รอเก็บ'; }).reverse(),
    materials: rowsToObjs('Materials'),
    wasteReasons: WASTE_REASONS,
  };
}

// ─────────────────────────────────────────────
// บอร์ดบริหาร
// ─────────────────────────────────────────────
function dueOf_(b, creditBy) {
  if (b['กำหนดชำระ']) return String(b['กำหนดชำระ']);
  const days = Number(creditBy[String(b['ลูกค้า']).trim()]) || 30;
  const d = String(b['วันที่']);
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return '';   // บิลนำเข้าเก่าวันที่รูปแบบอื่น = ไม่นับเลยกำหนด (ดีกว่าบอร์ดล่ม)
  const t = new Date(d.slice(0, 10) + 'T00:00:00+07:00').getTime() + days * 86400000;
  if (isNaN(t)) return '';
  return Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd');
}
function execData() {
  const bills = activeBills_();
  const orders = rowsToObjs('Orders');
  const prod = rowsToObjs('Production');
  const scr = rowsToObjs('ScreenJobs');
  const stmts = rowsToObjs('Statements');
  const products = rowsToObjs('Products');
  const materials = rowsToObjs('Materials');
  const staff = staffPublic();
  const custs = rowsToObjs('Customers');
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const td = today();
  const d30 = daysFromNow(-30);
  const creditBy = {}; custs.forEach(function (c) { creditBy[String(c['ชื่อลูกค้า']).trim()] = c['เครดิต(วัน)']; });

  let mCash = 0, mCredit = 0, tSales = 0, arTotal = 0, overdueSum = 0, overdueCount = 0;
  const arByCust = {}, daily = {}, custMonth = {}, cashToday = {};
  bills.forEach(function (b) {
    const d = String(b['วันที่']);
    const amt = num(b['ยอดรวม']);
    if (d.slice(0, 7) === month) {
      if (b['ประเภท'] === 'เครดิต') mCredit += amt; else mCash += amt;
      custMonth[b['ลูกค้า']] = (custMonth[b['ลูกค้า']] || 0) + amt;
    }
    if (d === td) tSales += amt;
    if (b['สถานะ'] === 'ค้างชำระ' || b['สถานะ'] === 'วางบิลแล้ว') {
      arTotal += amt;
      arByCust[b['ลูกค้า']] = (arByCust[b['ลูกค้า']] || 0) + amt;
      const due = dueOf_(b, creditBy);
      if (due && due < td) { overdueSum += amt; overdueCount++; }
    }
    const chan = String(b['ช่องทางชำระ'] || '').trim();
    if (String(b['ชำระเมื่อ']) === td && (chan === 'เงินสด' || (!chan && b['ประเภท'] === 'เงินสด'))) cashToday[b['ผู้ทำ'] || '(ไม่ระบุ)'] = (cashToday[b['ผู้ทำ'] || '(ไม่ระบุ)'] || 0) + amt;
    if (d.length >= 10 && d >= d30) daily[d.slice(0, 10)] = (daily[d.slice(0, 10)] || 0) + amt;
  });
  const top = function (m2) { return Object.keys(m2).map(function (k) { return { name: k, amt: m2[k] }; }).sort(function (a, b) { return b.amt - a.amt; }).slice(0, 10); };
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const dd = daysFromNow(-i);
    last30.push({ d: dd.slice(5), amt: daily[dd] || 0 });
  }

  // แจ้งเตือน
  const lateOrders = orders.filter(function (o) { return ['ส่งแล้ว', 'ยกเลิก'].indexOf(o['สถานะ']) < 0 && o['กำหนดส่ง'] && String(o['กำหนดส่ง']) < td; })
    .map(function (o) { return { id: o['Order_ID'], customer: o['ลูกค้า'], due: o['กำหนดส่ง'], status: o['สถานะ'] }; });
  const lateStmts = stmts.filter(function (s) { return s['สถานะ'] === 'รอเก็บ' && s['กำหนดเก็บเงิน'] && String(s['กำหนดเก็บเงิน']) < td; })
    .map(function (s) { return { no: s['Stmt_No'], customer: s['ลูกค้า'], due: s['กำหนดเก็บเงิน'], amt: num(s['ยอดรวม']) }; });
  const lowStock = products.filter(function (p2) { return (p2['สถานะ'] || 'ใช้งาน') !== 'เลิกขาย' && (num(p2['คงเหลือ']) < 0 || (p2['จุดเตือน'] !== '' && num(p2['คงเหลือ']) <= num(p2['จุดเตือน']))); })
    .map(function (p2) { return { name: p2['ชื่อสินค้า'], bal: num(p2['คงเหลือ']), min: num(p2['จุดเตือน']), kind: 'สินค้า' }; })
    .concat(materials.filter(function (m2) { return m2['จุดสั่งซื้อ'] !== '' && num(m2['คงเหลือ']) <= num(m2['จุดสั่งซื้อ']); })
      .map(function (m2) { return { name: m2['ชื่อวัตถุดิบ'], bal: num(m2['คงเหลือ']), min: num(m2['จุดสั่งซื้อ']), kind: 'วัตถุดิบ' }; }));

  // ผลิต 30 วัน + ของเสียตามสาเหตุ + ผลงานรายคน
  const plogs = tailSince_('ProductionLogs', 'เมื่อ', d30, 800).filter(function (l) { return String(l['เมื่อ']).slice(0, 10) >= d30; });
  let good30 = 0, waste30 = 0;
  const wasteBy = {}, byStaff = {};
  plogs.forEach(function (l) {
    good30 += num(l['ดี']); waste30 += num(l['เสีย']);
    if (num(l['เสีย'])) wasteBy[l['สาเหตุเสีย'] || 'ไม่ระบุ'] = (wasteBy[l['สาเหตุเสีย'] || 'ไม่ระบุ'] || 0) + num(l['เสีย']);
    const k = l['ผู้ลง'] || '(ไม่ระบุ)';
    byStaff[k] = byStaff[k] || { good: 0, waste: 0, logs: 0 };
    byStaff[k].good += num(l['ดี']); byStaff[k].waste += num(l['เสีย']); byStaff[k].logs++;
  });
  const staff30 = staff.filter(function (s) { return s['สถานะ'] === 'ทำงาน'; }).map(function (s) {
    const w = byStaff[s['ชื่อ']] || { good: 0, waste: 0, logs: 0 };
    return { name: s['ชื่อ'], dept: s['แผนก'], logs: w.logs, good: w.good, waste: w.waste };
  });
  const adjust30 = tailSince_('StockMoves', 'เมื่อ', d30, 500).filter(function (m2) { return (m2['ประเภท'] === 'ปรับยอด' || m2['ประเภท'] === 'ของเสีย') && String(m2['เมื่อ']).slice(0, 10) >= d30; }).slice(-30).reverse();

  const orderCounts = {};
  orders.forEach(function (o) { orderCounts[o['สถานะ']] = (orderCounts[o['สถานะ']] || 0) + 1; });

  return {
    ok: true, version: CODE_VERSION, month: month,
    kpi: { monthTotal: mCash + mCredit, monthCash: mCash, monthCredit: mCredit, todaySales: tSales, arTotal: arTotal, overdueSum: overdueSum, overdueCount: overdueCount },
    arTop: top(arByCust), custTop: top(custMonth), orderCounts: orderCounts,
    queues: {
      prodWait: prod.filter(function (j) { return j['สถานะ'] === 'รอผลิต'; }).length,
      prodDoing: prod.filter(function (j) { return j['สถานะ'] === 'กำลังผลิต'; }).length,
      scrWait: scr.filter(function (j) { return j['สถานะ'] === 'รอสกรีน'; }).length,
      scrDoing: scr.filter(function (j) { return j['สถานะ'] === 'กำลังสกรีน'; }).length,
    },
    stmtsWait: stmts.filter(function (s) { return s['สถานะ'] === 'รอเก็บ'; }).length,
    daily30: last30,
    alerts: { lateOrders: lateOrders, lateStmts: lateStmts, lowStock: lowStock },
    prod30: { good: good30, waste: waste30, wasteBy: Object.keys(wasteBy).map(function (k) { return { reason: k, qty: wasteBy[k] }; }).sort(function (a, b) { return b.qty - a.qty; }) },
    staff30: staff30, staffList: staff,
    cashToday: Object.keys(cashToday).map(function (k) { return { name: k, amt: cashToday[k] }; }),
    stock: { products: products.filter(function (p2) { return (p2['สถานะ'] || 'ใช้งาน') !== 'เลิกขาย'; }), materials: materials },
    adjust30: adjust30,
    activity: tailObjs('ActivityLog', 25).reverse(),
    recentOrders: orders.slice(-8).reverse(),
    products: products, priceHistory: tailObjs('PriceHistory', 30).reverse(),
  };
}

// ─────────────────────────────────────────────
// Web API — GET: ?action=...&token=... (หรือ &key=...)[&payload=JSON]
// mutating ทุกตัวอยู่ใน lock เดียว + ลง ActivityLog อัตโนมัติ
// ─────────────────────────────────────────────
function jsonOut(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// วางโค้ดรุ่นใหม่ = โครงชีตต้องตามด้วย (รุ่นใหม่มักเพิ่มแท็บ/คอลัมน์) — ทำให้เองที่คำขอแรกหลังเวอร์ชันเปลี่ยน
// setupPkSystem() เติมแบบต่อท้ายอย่างเดียว ไม่แทรกกลาง ไม่ลบ → รันซ้ำปลอดภัย · ทำครั้งเดียวต่อเวอร์ชัน
function autoMigrate_() {
  if (!prop('PK_SHEET_ID')) return;                    // ยังไม่เคยติดตั้ง — ต้องรัน setupPkSystem() ใน editor ก่อน
  if (prop('SCHEMA_AT') === CODE_VERSION) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;                    // คำขออื่นทำอยู่ — รอบหน้าค่อยว่า
  try {
    if (prop('SCHEMA_AT') !== CODE_VERSION) {          // เช็คซ้ำหลังได้ lock กันทำสองรอบ
      setupPkSystem();
      setProp('SCHEMA_AT', CODE_VERSION);
    }
  } catch (e) {
    Logger.log('autoMigrate_ ล้มเหลว: ' + e);          // ไม่ให้ล้มทั้งคำขอ — คำขอนี้อาจยังทำงานได้
  } finally { lock.releaseLock(); }
}
const ACT_LABEL = {
  pkLogin: 'เข้าสู่ระบบ', pkOrderSave: 'ลงออเดอร์', pkOrderEdit: 'แก้ออเดอร์', pkOrderCancel: 'ยกเลิกออเดอร์',
  pkJobStart: 'เริ่มงาน', pkProdLog: 'ลงผลผลิต', pkJobClose: 'ปิดงาน', pkDeliver: 'ส่งของ',
  pkBillCreate: 'ออกบิล', pkBillPay: 'รับชำระ', pkBillCancel: 'ยกเลิกบิล', pkStmtCreate: 'สร้างใบวางบิล', pkStmtDone: 'ปิดใบวางบิล',
  pkCustSave: 'บันทึกลูกค้า', pkStockIn: 'รับของเข้า', pkStockCount: 'นับ/ปรับสต๊อก', pkOrderFlags: 'อัปเดตสถานะออเดอร์', pkScreenAssign: 'จ่ายงานสกรีน',
  pkPriceSet: 'ปรับราคา', pkStaffSave: 'บันทึกพนักงาน',
};
function ACTIONS() {
  return {
    pkHealth: { auth: 'none', fn: function () { return { ok: true, version: CODE_VERSION, sheet: !!prop('PK_SHEET_ID'), schemaAt: prop('SCHEMA_AT') || '(ยังไม่เคยปรับ)' }; } },
    pkLogin: { auth: 'none', mut: true, fn: function (pay) { return login(pay); } },
    pkTeamData: { auth: 'team', fn: function (pay, me, p) { return teamData(p, me); } },
    pkBills: { auth: 'team', fn: function (pay, me, p) { return { ok: true, bills: billList(p) }; } },
    pkOrderSave: { auth: 'team', mut: true, fn: orderSave },
    pkOrderEdit: { auth: 'team', mut: true, fn: orderEdit },
    pkOrderCancel: { auth: 'team', mut: true, fn: orderCancel },
    pkJobStart: { auth: 'team', mut: true, fn: jobStart },
    pkProdLog: { auth: 'team', mut: true, fn: prodLog },
    pkJobClose: { auth: 'team', mut: true, fn: jobClose },
    pkDeliver: { auth: 'team', mut: true, fn: deliver },
    pkBillCreate: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: billCreate },
    pkBillPay: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: billPay },
    pkBillCancel: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: billCancel },
    pkStmtCreate: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: stmtCreate },
    pkStmtDone: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: stmtDone },
    pkCustSave: { auth: 'team', mut: true, fn: custSave },
    pkStockIn: { auth: 'team', mut: true, fn: stockIn },
    pkStockCount: { auth: 'team', mut: true, depts: ['ผลิต', 'ออฟฟิศ', 'บริหาร'], fn: stockCount },
    pkOrderFlags: { auth: 'team', mut: true, fn: orderFlags },
    pkScreenAssign: { auth: 'team', mut: true, fn: screenAssign },
    pkOrderDetail: { auth: 'team', fn: orderDetail },
    pkCustomerHistory: { auth: 'team', fn: customerHistory },
    pkScreenHistory: { auth: 'team', fn: screenHistory },
    pkExec: { auth: 'exec', fn: function () { return execData(); } },
    pkPriceSet: { auth: 'exec', mut: true, fn: priceSet },
    pkPriceHistory: { auth: 'exec', fn: function (pay, me, p) { return { ok: true, history: tailObjs('PriceHistory', Number(p.limit) || 100).reverse() }; } },
    pkStaffSave: { auth: 'exec', mut: true, fn: staffSave },
  };
}
function doGet(e) {
  const p = (e && e.parameter) || {};
  const a = p.action || '';
  try {
    const spec = ACTIONS()[a];
    if (!spec) return jsonOut({ ok: false, error: 'ไม่รู้จัก action: ' + a });
    autoMigrate_();
    let me = null;
    if (spec.auth !== 'none') {
      me = who(p);
      if (!me) return jsonOut({ ok: false, error: 'ยังไม่ได้ล็อกอิน หรือรหัส/token หมดอายุ', needLogin: true });
      if (spec.auth === 'exec' && me.via !== 'exec') return jsonOut({ ok: false, error: 'เฉพาะผู้บริหาร' });
      if (spec.depts && me.via === 'pin' && spec.depts.indexOf(String(me.dept).trim()) < 0) return jsonOut({ ok: false, error: 'สิทธิ์ไม่พอ (แผนก ' + me.dept + ') — ให้ออฟฟิศ/ผู้บริหารทำรายการนี้' });
    }
    const pay = p.payload ? JSON.parse(p.payload) : {};
    let result;
    if (spec.mut) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return jsonOut({ ok: false, error: 'ระบบคิวแน่น — ลองใหม่อีกครั้ง', retry: true });
      try {
        // idempotency: request เดิม (กดซ้ำ/คิว replay/response หลุด) คืนผลเดิม ไม่ทำซ้ำ
        const rid = pay && pay._rid ? 'rid:' + a + ':' + pay._rid : '';
        const cache = rid ? CacheService.getScriptCache() : null;
        if (rid) {
          const hit = cache.get(rid);
          if (hit) return jsonOut(JSON.parse(hit));
        }
        result = spec.fn(pay, me, p);
        if (result && result.ok && a !== 'pkHealth') {
          const idn = (a === 'pkLogin' && result.me) ? { name: result.me.name, via: 'pin' } : (me || {});
          appendObj('ActivityLog', {
            'เมื่อ': now(), 'ใคร': idn.name || '', 'ช่องทาง': idn.via || '',
            'การกระทำ': ACT_LABEL[a] || a, 'อ้างอิง': (result._log && result._log.ref) || '',
            'รายละเอียด': (result._log && result._log.detail) || '',
          });
        }
        if (rid && result && result.ok) {
          const copy = JSON.parse(JSON.stringify(result));
          delete copy._log;
          try { cache.put(rid, JSON.stringify(copy), 21600); } catch (e2) {}
        }
      } finally { lock.releaseLock(); }
    } else {
      result = spec.fn(pay, me, p);
    }
    if (result && result._log) delete result._log;
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

// ─────────────────────────────────────────────
// นำเข้าข้อมูลเก่าจาก "ระบบบัญชี" (รันครั้งเดียวใน editor — อ่านอย่างเดียว)
// ─────────────────────────────────────────────
function importLegacyAccounting(srcId) {
  setupPkSystem();   // เผื่อโค้ดรุ่นใหม่มีแท็บ/คอลัมน์ที่ชีตยังไม่มี — รันซ้ำปลอดภัย
  srcId = srcId || LEGACY_SNAPSHOT_ID;
  const src = SpreadsheetApp.openById(srcId);
  let bills = 0, ar = 0, customers = 0;
  const outBills = [], outCust = [];   // สะสมไว้เขียนทีเดียวตอนจบ (ดู appendObjs)
  const seenCust = {};
  rowsToObjs('Customers').forEach(function (c) { seenCust[String(c['ชื่อลูกค้า']).trim()] = true; });
  let custCount = Object.keys(seenCust).length;
  const seenBill = {};
  rowsToObjs('Bills').forEach(function (b) { seenBill[String(b['Bill_No'])] = true; });   // รันซ้ำได้ ไม่เบิ้ล
  src.getSheets().forEach(function (sh) {
    const v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    let h = -1;
    for (let i = 0; i < Math.min(v.length, 10); i++) {
      if (v[i].map(String).indexOf('เลขที่บิล') >= 0 || v[i].map(String).indexOf('รายชื่อลูกค้า') >= 0) { h = i; break; }
    }
    if (h < 0) return;
    const head = v[h].map(String);
    const tabName = sh.getName();
    if (head.indexOf('รายชื่อลูกค้า') >= 0) {
      const nc = head.indexOf('รายชื่อลูกค้า');
      for (let i = h + 1; i < v.length; i++) {
        const name = String(v[i][nc]).trim();
        if (!name || seenCust[name]) continue;
        seenCust[name] = true; custCount++;
        outCust.push({ 'Customer_ID': 'C' + ('000' + custCount).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() });
        customers++;
      }
      return;
    }
    const isAR = head.indexOf('ยอดค้าง') >= 0;
    const iDate = head.indexOf('วันที่') >= 0 ? head.indexOf('วันที่') : 0;
    const iNo = head.indexOf('เลขที่บิล');
    const iName = head.indexOf('ชื่อลูกค้า');
    for (let i = h + 1; i < v.length; i++) {
      const r = v[i];
      const name = String(r[iName] || '').trim();
      const no = String(r[iNo] || '').trim();
      if (!name || !no || no === 'เลขที่บิล') continue;
      if (seenBill['เก่า-' + tabName + '-' + no]) continue;
      seenBill['เก่า-' + tabName + '-' + no] = true;
      const rawDate = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate], TZ, 'yyyy-MM-dd') : String(r[iDate] || '').trim();
      if (isAR) {
        const owe = num(r[head.indexOf('ยอดค้าง')]);
        const status = String(r[head.indexOf('สถานะ')] || '').trim();
        if (!owe) continue;
        outBills.push({
          'Bill_No': 'เก่า-' + tabName + '-' + no, 'วันที่': rawDate, 'ลูกค้า': name, 'ยอดรวม': owe, 'ประเภท': 'เครดิต',
          'สถานะ': (status.indexOf('จ่าย') >= 0 || status.indexOf('ชำระ') >= 0 || status.indexOf('เก็บ') >= 0) ? 'ชำระแล้ว' : 'ค้างชำระ',
          'ช่องทางชำระ': String(r[head.indexOf('ช่องทางชำระ')] || ''), 'หมายเหตุ': String(r[head.indexOf('หมายเหตุ')] || ''), 'ที่มา': 'นำเข้า:' + tabName,
        });
        ar++;
      } else {
        const cash = num(r[head.indexOf('เงินสด')]);
        const credit = num(r[head.indexOf('เครดิต')]);
        if (!cash && !credit) continue;
        outBills.push({
          'Bill_No': 'เก่า-' + tabName + '-' + no, 'วันที่': rawDate, 'ลูกค้า': name, 'ยอดรวม': cash + credit,
          'ประเภท': credit ? 'เครดิต' : 'เงินสด', 'ช่องทางชำระ': String(r[head.indexOf('ช่องทางชำระ')] || ''),
          'สถานะ': credit ? 'ค้างชำระ' : 'ชำระแล้ว', 'ชำระเมื่อ': credit ? '' : rawDate,
          'หมายเหตุ': String(r[head.indexOf('หมายเหตุ')] || ''), 'ที่มา': 'นำเข้า:' + tabName,
        });
        bills++;
        if (name !== 'สด' && name !== 'สดเซล' && !seenCust[name]) {
          seenCust[name] = true; custCount++;
          outCust.push({ 'Customer_ID': 'C' + ('000' + custCount).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() });
          customers++;
        }
      }
    }
  });
  // เขียนลงชีตทีเดียวจบ (2 เรียก API แทนหลักพัน) — ตายกลางทางแล้วรันซ้ำได้ ไม่เบิ้ล เพราะ seenBill/seenCust กรองของเดิมไว้แล้ว
  appendObjs('Customers', outCust);
  appendObjs('Bills', outBills);

  // seed ตัวนับลูกค้า กัน custSave ออก Customer_ID ชนกับที่ import มา
  const stg = tab('Settings');
  const sv = stg.getDataRange().getValues();
  let seeded = false;
  for (let i = 1; i < sv.length; i++) {
    if (String(sv[i][0]) === 'CUST_NEXT') { stg.getRange(i + 1, 2).setValue(Math.max(Number(sv[i][1]) || 1, custCount + 1)); seeded = true; break; }
  }
  if (!seeded) stg.appendRow(['CUST_NEXT', custCount + 1]);
  Logger.log('นำเข้าเสร็จ: บิล ' + bills + ' · ลูกหนี้เครดิต ' + ar + ' · ลูกค้าใหม่ ' + customers);
  Logger.log('⚠️ แท็บเครดิตกับแท็บบิลรายวันอาจมีบิลซ้ำกัน — เช็คก่อนใช้ยอดย้อนหลังจริงจัง');
}

// ─────────────────────────────────────────────
// ใส่ทะเบียนสินค้ามาตรฐานลงแท็บ Products (รันครั้งเดียวใน editor — รันซ้ำได้ ไม่เบิ้ล)
// ที่มา: docs/products/products-master.csv ของ repo pk-hq (29 รายการ 6 หมวด)
// เพิ่มเฉพาะชื่อที่ยังไม่มี — ของเดิม/ราคาที่แก้ไว้แล้ว ไม่ถูกทับ
// ─────────────────────────────────────────────
const PRODUCT_SEED = [   // [Product_ID, ชื่อสินค้า, หน่วย, ราคา/หน่วย, หมายเหตุ]
  ['PK-BOT-250-RB-CL','ขวด PET 250ml เรียบ ใส','ใบ',1.35,''],
  ['PK-BOT-250-DM-BL','ขวด PET 250ml เพชร ฟ้า','ใบ',1.35,''],
  ['PK-BOT-250-MK-CL','ขวด PET 250ml MK ใส','ใบ','','⚠️ รอยืนยัน'],
  ['PK-BOT-500-RB-CL','ขวด PET 500ml เรียบ ใส','ใบ','','⚠️ รอยืนยัน'],
  ['PK-BOT-600-RB-CL','ขวด PET 600ml เรียบ ใส','ใบ',1.95,'ราคาในบิล: 1.95-2.20 · 200 ใบ/ถุง (อ้างอิงขวด 600 ทรง MK)'],
  ['PK-BOT-600-OK-CL','ขวด PET 600ml ทรง "OK" ใส','ใบ',1.43,'ราคาในบิล: ~1.43 · ⚠️ รอยืนยัน'],
  ['PK-BOT-600-MK-CL','ขวด PET 600ml MK ใส','ใบ','','200 ใบ/ถุง'],
  ['PK-BOT-1500-MK-CL','ขวด PET 1500ml MK ใส','ใบ',3.80,''],
  ['PK-BOT-250-SC-PURESA','ขวด PET 250ml สกรีนเพียวซ่า','ใบ','','252 ใบ/ถุง'],
  ['PK-BOT-600-SC-PURESA','ขวด PET 600ml สกรีนเพียวซ่า','ใบ','','200 ใบ/ถุง'],
  ['PK-BOT-600-SC-BOONYAWAT','ขวด PET 600ml สกรีนบุญวาทย์','ใบ','','⚠️ รอยืนยัน'],
  ['PK-CAP-PET-PK','ฝาน้ำ PET สีชมพู','ชิ้น',0.25,''],
  ['PK-CAP-PET-BL','ฝาน้ำ PET สีฟ้า','ชิ้น',0.25,''],
  ['PK-CAP-PET-NV','ฝาน้ำ PET สีน้ำเงิน','ชิ้น',0.25,''],
  ['PK-CAP-PET-LG','ฝาน้ำ PET สีเขียวอ่อน','ชิ้น',0.25,''],
  ['PK-CAP-PET-DG','ฝาน้ำ PET สีเขียวเข้ม','ชิ้น',0.25,''],
  ['PK-CAP-PET-WH','ฝาน้ำ PET สีขาว','ชิ้น',0.25,''],
  ['PK-CAP-PET-BK','ฝาน้ำ PET สีดำ','ชิ้น',0.25,''],
  ['PK-CAP-PET-GD','ฝาน้ำ สีทอง','ชิ้น',0.25,'ราคาในบิล: ~0.25 · ⚠️ รอยืนยัน'],
  ['PK-CAP-TOK','ฝาต๊อก','ชิ้น',0.25,'⚠️ รอยืนยัน'],
  ['PK-FLM-NECK-WIDE-BL','ฟิล์มคอขวด ปากกว้าง สีฟ้า','ม้วน',200,''],
  ['PK-FLM-NECK-WH','ฟิล์มคอขวด สีขาว','ม้วน',200,''],
  ['PK-FLM-NECK-TANK-YL','ฟิล์มคอถัง สีเหลือง','ม้วน',150,''],
  ['PK-FLM-PACK12-CL','ฟิล์มแพ็คโหล (12 ขวด) ใส','ม้วน/ชิ้น','','⚠️ รอยืนยัน'],
  ['PK-FLM-CUPSEAL','ฟิล์มปิดฝาถ้วยแก้ว (ม้วน)','ม้วน',900,''],
  ['PK-TNK-GALLON','ถังแกลลอน (คาดว่า 20 ลิตร)','ใบ',465,''],
  ['PK-CUP-GLASS','ถ้วยแก้ว (น้ำถ้วย)','ลัง/แพ็ค',520,''],
  ['PK-MSC-PVC-CUT','PVC ตัดตามขนาด (เช่น 16.5x16.5)','เมตร',120,'⚠️ รอยืนยัน'],
  ['PK-MSC-PREFORM','หลอดพรีฟอร์ม (ขายยกกระสอบ)','กระสอบ',735,'⚠️ รอยืนยัน'],
];
function seedProducts() {
  setupPkSystem();   // เผื่อโค้ดรุ่นใหม่มีแท็บ/คอลัมน์ที่ชีตยังไม่มี — รันซ้ำปลอดภัย
  const have = {};
  rowsToObjs('Products').forEach(function (p) { have[String(p['ชื่อสินค้า']).trim()] = true; });
  const add = PRODUCT_SEED.filter(function (r) { return !have[r[1]]; }).map(function (r) {
    return { 'Product_ID': r[0], 'ชื่อสินค้า': r[1], 'หน่วย': r[2], 'ราคา/หน่วย': r[3],
             'หมายเหตุ': r[4], 'คงเหลือ': 0, 'จุดเตือน': '', 'สถานะ': 'ใช้งาน' };
  });
  appendObjs('Products', add);
  Logger.log('เพิ่มสินค้าใหม่ ' + add.length + ' รายการ (มีอยู่แล้ว ' + (PRODUCT_SEED.length - add.length) + ')');
  return add.length;
}

// ทีมสกรีน: แตะปุ่มเดียวจบ — เหมือนแอปเดิม (จ่ายทีม 1/2/3 หรือกดเสร็จแล้ว) ไม่ต้องกรอกจำนวน
function screenAssign(pay, me) {
  const j = rowsToObjs('ScreenJobs').filter(function (x) { return x['Job_ID'] === pay.id; })[0];
  if (!j) return { ok: false, error: 'ไม่พบงานสกรีน' };
  if (j['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'งานนี้ถูกยกเลิกแล้ว' };
  const patch = { 'ผู้ทำ': me.name };
  if (pay.done) {
    patch['สถานะ'] = 'เสร็จ'; patch['เสร็จเมื่อ'] = now();
    // ไม่ได้กรอกจำนวน = ถือว่าได้ครบตามสั่ง (แอปเดิมก็ไม่ให้กรอก)
    if (!num(j['ดีสะสม'])) patch['ดีสะสม'] = num(j['จำนวนสั่ง']);
  } else {
    if (!pay.team) return { ok: false, error: 'เลือกทีม' };
    patch['ทีม'] = pay.team;
    patch['สถานะ'] = 'กำลังสกรีน';
    if (!j['เริ่มเมื่อ']) patch['เริ่มเมื่อ'] = now();
  }
  updateWhere('ScreenJobs', 'Job_ID', pay.id, patch);
  const st = recomputeOrder_(j['Order_ID']);
  return { ok: true, orderStatus: st,
    _log: { ref: pay.id, detail: (j['สินค้า'] || j['ลาย/สี'] || '') + (pay.done ? ' → เสร็จแล้ว' : ' → ' + pay.team) } };
}

// อัปเดตสถานะที่เดิมเขียนมือในหมายเหตุ (จดใน ActivityLog ทุกครั้ง)
function orderFlags(pay, me) {
  const patch = {};
  ['สถานะเงิน', 'สถานะแบบ', 'ทีมสกรีน', 'วันเสร็จจริง'].forEach(function (k) {
    if (pay[k] !== undefined) patch[k] = pay[k];
  });
  if (pay['ค่าบล็อก'] !== undefined) patch['ค่าบล็อก'] = Number(pay['ค่าบล็อก']) || '';
  if (pay['ด่วน'] !== undefined) patch['ด่วน'] = pay['ด่วน'] ? 'ด่วน' : '';
  if (!Object.keys(patch).length) return { ok: false, error: 'ไม่มีอะไรให้แก้' };
  patch['อัปเดตล่าสุด'] = now();
  if (!updateWhere('Orders', 'Order_ID', pay.id, patch)) return { ok: false, error: 'ไม่พบออเดอร์ ' + pay.id };
  return { ok: true, _log: { ref: pay.id, detail: Object.keys(patch).filter(function (k) { return k !== 'อัปเดตล่าสุด'; })
    .map(function (k) { return k + '=' + patch[k]; }).join(' · ') } };
}

// ─────────────────────────────────────────────
// นำเข้าออเดอร์เก่าจากชีต "Order" ของ AppSheet (เมลเก่า palm.work2025) — รันครั้งเดียวใน editor
// ประวัติล้วน: ไม่สร้างงานผลิต/สกรีน ไม่แตะสต๊อก · รันซ้ำได้ ไม่เบิ้ล (กันด้วย Order_ID)
// แกะ "หมายเหตุ" ที่พนักงานเขียนมือ ออกเป็นช่องจริง (สถานะเงิน/สถานะแบบ/ค่าบล็อก/ด่วน/วันเสร็จจริง)
// ─────────────────────────────────────────────
const LEGACY_ORDER_SHEET_ID = '1515IKTrgz-b1LDlpW66y6LHy_S1WEZZraOWczwZaRYg';

function thaiDate_(s) {   // '28/7/2568' หรือ '28/7/68' → '2025-07-28'
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  let y = Number(m[3]);
  if (y < 100) y += 2500;           // 68 → 2568
  if (y > 2400) y -= 543;           // พ.ศ. → ค.ศ.
  const d = ('0' + m[1]).slice(-2), mo = ('0' + m[2]).slice(-2);
  return y + '-' + mo + '-' + d;
}

// แกะหมายเหตุมือ → ช่องจริง + คืนข้อความส่วนที่เหลือ
function parseLegacyNote_(note) {
  let rest = String(note || '').trim();
  const out = {};
  const take = function (re, fn) {
    const m = rest.match(re);
    if (m) { fn(m); rest = rest.replace(m[0], ' ').trim(); }
  };
  // "ค่าบล้อค 500 บาท" — สะกดได้หลายแบบ (บล็อค/บล้อค/บลอก)
  take(/ค่าบล[็้]?อ?[คก]\s*([\d,]+)\s*บาท?/, function (m) { out['ค่าบล็อก'] = Number(String(m[1]).replace(/,/g, '')) || ''; });
  // งานค้าง: "13/10/68ทำ25ถุงค้าง9ถุง(ขวดหมด)" · "ทำ50ถุงค้างอีก10ถุงขวดหมด"
  take(/ทำ\s*([\d,]+)\s*ถุง\s*ค้าง\s*(?:อีก)?\s*([\d,]+)\s*ถุง/, function (m) {
    out['ทำแล้ว(ถุง)'] = Number(String(m[1]).replace(/,/g, '')) || '';
    out['ค้าง(ถุง)'] = Number(String(m[2]).replace(/,/g, '')) || '';
  });
  take(/\(?\s*(ขวดหมด|ของหมด|วัตถุดิบหมด)\s*\)?/, function (m) { out['สาเหตุค้าง'] = m[1]; });
  take(/ทำครบแล้ว\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/, function (m) { out['วันเสร็จจริง'] = thaiDate_(m[1]); });
  take(/เสร็จ\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/, function (m) { if (!out['วันเสร็จจริง']) out['วันเสร็จจริง'] = thaiDate_(m[1]); });
  take(/แก้ไขแบบ/, function () { out['สถานะแบบ'] = 'แก้ไขแบบ'; });
  take(/รอแบบ/,   function () { out['สถานะแบบ'] = 'รอแบบ'; });
  take(/ทำแบบ/,   function () { out['สถานะแบบ'] = 'รอแบบ'; });
  take(/รอโอน(เงิน)?/, function () { out['สถานะเงิน'] = 'รอโอนเงิน'; });
  take(/ทำได้เลย/,     function () { out['สถานะเงิน'] = 'ทำได้เลย'; });
  take(/ขอด่วน|ด่วน/,  function () { out['ด่วน'] = 'ด่วน'; });
  out['หมายเหตุ'] = rest.replace(/\s{2,}/g, ' ').trim();
  return out;
}

function importLegacyOrders(srcId) {
  setupPkSystem();   // เผื่อโค้ดรุ่นใหม่มีแท็บ/คอลัมน์ที่ชีตยังไม่มี — รันซ้ำปลอดภัย
  const src = SpreadsheetApp.openById(srcId || LEGACY_ORDER_SHEET_ID);
  const sh = src.getSheets()[0];
  const v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  const at = function (r, label) { const i = head.indexOf(label); return i < 0 ? '' : r[i]; };
  const cellDate = function (x) { return x instanceof Date ? Utilities.formatDate(x, TZ, 'yyyy-MM-dd') : thaiDate_(x); };

  const seen = {};
  rowsToObjs('Orders').forEach(function (o) { seen[String(o['Order_ID'])] = true; });
  const seenCust = {};
  rowsToObjs('Customers').forEach(function (c) { seenCust[String(c['ชื่อลูกค้า']).trim()] = true; });
  let custCount = Object.keys(seenCust).length;

  const outOrders = [], outCust = [];
  let skipped = 0;
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    const rawId = String(at(r, 'ID') || '').trim();
    const cust = String(at(r, 'ลูกค้า') || '').trim();
    if (!rawId || !cust) continue;
    const id = 'เก่า-' + rawId;
    if (seen[id]) { skipped++; continue; }
    seen[id] = true;

    const bags  = Number(at(r, 'จำนวน (ถุง)')) || 0;
    const extra = Number(at(r, 'และซื้อย่อย (ใบ)')) || 0;
    const piece = Number(at(r, 'จำนวน (ชิ้น)')) || 0;
    let total   = Number(at(r, 'รวมทั้งหมด (ใบ)')) || 0;
    if (!total) total = piece || (bags ? bags * perBag_(String(at(r, 'ประเภทสินค้า')), String(at(r, 'ขนาด'))) + extra : extra);

    const it = {
      pid: '', name: '', qty: total, price: Number(at(r, 'ราคาต่อหน่วย')) || 0, screen: !!String(at(r, 'สีสกรีน')).trim(),
      type: String(at(r, 'ประเภทสินค้า') || '').trim(), size: String(at(r, 'ขนาด') || '').trim(),
      neck: String(at(r, 'คอขวด') || '').trim(), shape: String(at(r, 'รูปทรง') || '').trim(),
      color: String(at(r, 'สี') || '').trim(), screenColor: String(at(r, 'สีสกรีน') || '').trim(),
      capColor: String(at(r, 'พร้อมฝาสี') || '').trim(), bags: bags, extra: extra,
      perBag: perBag_(String(at(r, 'ประเภทสินค้า')), String(at(r, 'ขนาด'))) || 0,
    };
    it.name = specName_(it);

    const st = String(at(r, 'สถานะ') || '').trim();
    const n = parseLegacyNote_(at(r, 'หมายเหตุ'));
    outOrders.push({
      'Order_ID': id, 'วันที่รับ': cellDate(at(r, 'วันที่สั่งซื้อ')), 'ลูกค้า': cust,
      'กำหนดส่ง': cellDate(at(r, 'ส่งภายในวันที่')),
      'สถานะ': st === 'ยกเลิก' ? 'ยกเลิก' : 'ส่งแล้ว',
      'มีสกรีน': it.screenColor ? 'มี' : '', 'ยอดรวม': total * (Number(at(r, 'ราคาต่อหน่วย')) || 0),
      'รายการ': JSON.stringify([it]), 'หมายเหตุ': n['หมายเหตุ'] || '',
      'ผู้รับออเดอร์': String(at(r, 'ผู้รับออเดอร์') || '').trim(),
      'อัปเดตล่าสุด': now(), 'ส่งครบเมื่อ': n['วันเสร็จจริง'] || '',
      'สถานะเงิน': n['สถานะเงิน'] || '', 'สถานะแบบ': n['สถานะแบบ'] || '', 'ค่าบล็อก': n['ค่าบล็อก'] || '',
      'ด่วน': n['ด่วน'] || '', 'ทีมสกรีน': String(at(r, 'ทีมสกรีน') || '').trim(),
      'วันเสร็จจริง': n['วันเสร็จจริง'] || '', 'ประเภทการซื้อ': String(at(r, 'ประเภทการซื้อ') || '').trim(),
      'ทำแล้ว(ถุง)': n['ทำแล้ว(ถุง)'] || '', 'ค้าง(ถุง)': n['ค้าง(ถุง)'] || '', 'สาเหตุค้าง': n['สาเหตุค้าง'] || '',
    });
    if (!seenCust[cust]) {
      seenCust[cust] = true; custCount++;
      outCust.push({ 'Customer_ID': 'C' + ('000' + custCount).slice(-4), 'ชื่อลูกค้า': cust, 'สร้างเมื่อ': now() });
    }
  }
  appendObjs('Customers', outCust);
  appendObjs('Orders', outOrders);
  Logger.log('นำเข้าออเดอร์เก่า ' + outOrders.length + ' ใบ · ลูกค้าใหม่ ' + outCust.length + ' ราย · ข้ามที่มีแล้ว ' + skipped);
  Logger.log('⚠️ เป็นประวัติล้วน — ไม่สร้างงานผลิต/สกรีน และไม่แตะสต๊อก');
  return { orders: outOrders.length, customers: outCust.length, skipped: skipped };
}

// ─────────────────────────────────────────────
// ใส่ทะเบียนเครื่องฉีด 12 ตัว (รันครั้งเดียว — รันซ้ำได้ ไม่เบิ้ล)
// ─────────────────────────────────────────────
function seedMachines() {
  setupPkSystem();   // เผื่อโค้ดรุ่นใหม่มีแท็บ/คอลัมน์ที่ชีตยังไม่มี — รันซ้ำปลอดภัย
  const have = {};
  rowsToObjs('Machines').forEach(function (m) { have[String(m['ชื่อเครื่อง']).trim()] = true; });
  const add = MACHINE_SEED.filter(function (n) { return !have[n]; })
    .map(function (n) { return { 'ชื่อเครื่อง': n, 'สถานะ': 'ใช้งาน', 'หมายเหตุ': '' }; });
  appendObjs('Machines', add);
  Logger.log('เพิ่มเครื่องจักร ' + add.length + ' ตัว (มีอยู่แล้ว ' + (MACHINE_SEED.length - add.length) + ')');
  return add.length;
}

// ─────────────────────────────────────────────
// นำเข้าทะเบียนลูกค้าเดิม (ชีต "P&K_ลูกค้า" ของเมลเก่า) — 225 ราย พร้อมเส้นทางส่ง
// ลูกค้าที่มีอยู่แล้ว (จาก import ออเดอร์/บัญชี) จะถูก "เติมข้อมูลที่ขาด" ไม่ทับของเดิม
// ─────────────────────────────────────────────
const LEGACY_CUSTOMER_SHEET_ID = '1yg1p_WjFpDh68WtK5KVJeCcx_K57x-X3m1etsDnX__Q';

function importLegacyCustomers(srcId) {
  setupPkSystem();   // เผื่อโค้ดรุ่นใหม่มีแท็บ/คอลัมน์ที่ชีตยังไม่มี — รันซ้ำปลอดภัย
  const src = SpreadsheetApp.openById(srcId || LEGACY_CUSTOMER_SHEET_ID);
  // หาแท็บที่เป็นทะเบียนจริง (มีหัว "เส้นทาง-2")
  let sh = null, head = null;
  src.getSheets().forEach(function (s) {
    if (sh) return;
    const v = s.getDataRange().getValues();
    for (let i = 0; i < Math.min(v.length, 10); i++) {
      const row = v[i].map(String);
      if (row.indexOf('เส้นทาง-2') >= 0 && row.indexOf('ลูกค้า') >= 0) { sh = s; head = { row: i, cols: row }; return; }
    }
  });
  if (!sh) return { ok: false, error: 'ไม่พบแท็บทะเบียนลูกค้า (ต้องมีหัวคอลัมน์ "เส้นทาง-2")' };

  const v = sh.getDataRange().getValues();
  const idx = function (label) { return head.cols.indexOf(label); };
  const at = function (r, label) { const i = idx(label); return i < 0 ? '' : String(r[i] || '').trim(); };

  const existing = rowsToObjs('Customers');
  const byName = {};
  existing.forEach(function (c) { byName[String(c['ชื่อลูกค้า']).trim()] = c; });
  let custCount = existing.length, added = 0, filled = 0;
  const outNew = [];

  for (let i = head.row + 1; i < v.length; i++) {
    const name = at(v[i], 'ลูกค้า');
    if (!name) continue;
    const info = {
      'เบอร์โทร': at(v[i], 'เบอร์'), 'ที่อยู่': at(v[i], 'ที่อยู่'),
      'เส้นทาง': at(v[i], 'เส้นทาง-2'), 'อำเภอ': at(v[i], 'อำเภอ'),
      'ตำบล': at(v[i], 'ตำบล'), 'พิกัด': at(v[i], 'โลเคชั่นลิงก์'),
      'หมายเหตุ': at(v[i], 'หมายเหตุ'),
    };
    const cur = byName[name];
    if (cur) {
      // เติมเฉพาะช่องที่ยังว่าง — ของที่คนกรอกไว้เองไม่ถูกทับ
      const patch = {};
      Object.keys(info).forEach(function (k) { if (info[k] && !String(cur[k] || '').trim()) patch[k] = info[k]; });
      if (Object.keys(patch).length) { updateWhere('Customers', 'Customer_ID', cur['Customer_ID'], patch); filled++; }
      continue;
    }
    custCount++; added++;
    const row = { 'Customer_ID': 'C' + ('000' + custCount).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() };
    Object.keys(info).forEach(function (k) { row[k] = info[k]; });
    byName[name] = row;
    outNew.push(row);
  }
  appendObjs('Customers', outNew);
  Logger.log('ลูกค้าใหม่ ' + added + ' ราย · เติมข้อมูลให้ของเดิม ' + filled + ' ราย');
  Logger.log('⚠️ ชื่อลูกค้าในออเดอร์เก่ามักมีชื่องานปนอยู่ ("ช้างทิพย์ ลี้ งานช้างทิพย์") จึงจับคู่กับทะเบียนไม่ติดทุกราย — ค่อยรวมมือทีหลังได้');
  return { added: added, filled: filled };
}

// ─────────────────────────────────────────────
// ดูรายละเอียด / ประวัติ — อ่านอย่างเดียว ไม่ส่งมากับก้อนหลัก (ประวัติโตเรื่อย ๆ)
// ─────────────────────────────────────────────
function orderItems_(o) { try { return JSON.parse(o['รายการ'] || '[]'); } catch (e) { return []; } }

// รายละเอียดออเดอร์ใบเดียว — รายการ + งานผลิต/สกรีน + ส่งไปแล้ว + บิล
function orderDetail(pay) {
  const o = rowsToObjs('Orders').filter(function (x) { return x['Order_ID'] === pay.id; })[0];
  if (!o) return { ok: false, error: 'ไม่พบออเดอร์ ' + pay.id };
  const items = orderItems_(o);
  const sent = (deliveredMapAll_()[o['Order_ID']] || {});
  const jobsOf = function (tabName) {
    return rowsToObjs(tabName).filter(function (j) { return j['Order_ID'] === o['Order_ID']; })
      .map(function (j) {
        return { id: j['Job_ID'], item: j['สินค้า'] || j['งาน'] || j['ลาย/สี'], ordered: num(j['จำนวนสั่ง']),
                 good: num(j['ดีสะสม']), gradeB: num(j['เกรดBสะสม']), waste: num(j['เสียสะสม']),
                 status: j['สถานะ'], by: j['ผู้ทำ'] || '', start: j['เริ่มเมื่อ'] || '', end: j['เสร็จเมื่อ'] || '',
                 stuck: j['สาเหตุค้าง'] || '' };
      });
  };
  const cust = rowsToObjs('Customers').filter(function (c) { return String(c['ชื่อลูกค้า']).trim() === String(o['ลูกค้า']).trim(); })[0] || {};
  return {
    ok: true,
    order: o,
    customer: { tel: cust['เบอร์โทร'] || '', route: cust['เส้นทาง'] || '', district: cust['อำเภอ'] || '', note: cust['หมายเหตุ'] || '' },
    items: items.map(function (it) {
      const k = it.pid || it.name;
      return { name: it.name, qty: it.qty, price: it.price, bags: it.bags || 0, extra: it.extra || 0, perBag: it.perBag || 0,
               screenColor: it.screenColor || '', capColor: it.capColor || '', sent: sent[k] || 0 };
    }),
    prodJobs: jobsOf('Production'), screenJobs: jobsOf('ScreenJobs'),
    deliveries: rowsToObjs('Deliveries').filter(function (d) { return d['Order_ID'] === o['Order_ID']; })
      .map(function (d) { return { when: d['เมื่อ'], by: d['ผู้ส่ง'], note: d['หมายเหตุ'] || '', items: d['รายการ'] }; }),
    bill: o['Bill_No'] ? (rowsToObjs('Bills').filter(function (b) { return b['Bill_No'] === o['Bill_No']; })[0] || null) : null,
  };
}

// ประวัติออเดอร์ของลูกค้ารายหนึ่ง — เทียบเคียงชื่อแบบหลวม (ชื่อในออเดอร์เก่ามักมีชื่องานพ่วง)
function customerHistory(pay) {
  const key = String(pay.customer || '').trim();
  if (!key) return { ok: false, error: 'ระบุชื่อลูกค้า' };
  const loose = key.replace(/[\s()]/g, '');
  const all = rowsToObjs('Orders').filter(function (o) {
    const n = String(o['ลูกค้า']).trim();
    return n === key || n.replace(/[\s()]/g, '').indexOf(loose) >= 0;
  });
  const rows = all.map(function (o) {
    const items = orderItems_(o);
    return { id: o['Order_ID'], date: o['วันที่รับ'], customer: o['ลูกค้า'], due: o['กำหนดส่ง'],
             status: o['สถานะ'], total: num(o['ยอดรวม']), urgent: o['ด่วน'] || '',
             pay: o['สถานะเงิน'] || '', art: o['สถานะแบบ'] || '', done: o['วันเสร็จจริง'] || '',
             qty: items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0),
             summary: items.map(function (it) { return it.name + ' ×' + baht_(it.qty); }).join(' · ') };
  }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  const live = rows.filter(function (r) { return ['ส่งแล้ว', 'ยกเลิก'].indexOf(r.status) < 0; });
  return {
    ok: true, customer: key, orders: rows.slice(0, 120),
    stat: { count: rows.length, qty: rows.reduce(function (s, r) { return s + r.qty; }, 0),
            baht: rows.reduce(function (s, r) { return s + r.total; }, 0), open: live.length },
  };
}
function baht_(n) { return Number(n || 0).toLocaleString('en-US'); }

// ประวัติงานทีมสกรีน — งานที่ปิดแล้ว + ยอดที่ลงในแต่ละครั้ง
function screenHistory(pay) {
  const days = Number(pay && pay.days) || 60;
  const since = daysFromNow(-days);
  const jobs = rowsToObjs('ScreenJobs').filter(function (j) {
    const d = String(j['เสร็จเมื่อ'] || j['วันที่เข้าคิว'] || '').slice(0, 10);
    return d >= since && (!pay.team || String(j['หมายเหตุ']).indexOf(pay.team) >= 0);
  });
  const ordBy = {};
  rowsToObjs('Orders').forEach(function (o) { ordBy[o['Order_ID']] = o; });
  const logs = tailSince_('ProductionLogs', 'เมื่อ', since, 800)
    .filter(function (l) { return l['ประเภทงาน'] === 'สกรีน' && String(l['เมื่อ']).slice(0, 10) >= since; });
  const logBy = {};
  logs.forEach(function (l) { (logBy[l['Job_ID']] = logBy[l['Job_ID']] || []).push(l); });
  const rows = jobs.map(function (j) {
    const o = ordBy[j['Order_ID']] || {};
    return { id: j['Job_ID'], order: j['Order_ID'], customer: o['ลูกค้า'] || '', team: o['ทีมสกรีน'] || '',
             item: j['สินค้า'] || j['ลาย/สี'], ordered: num(j['จำนวนสั่ง']), good: num(j['ดีสะสม']),
             gradeB: num(j['เกรดBสะสม']), waste: num(j['เสียสะสม']), status: j['สถานะ'],
             by: j['ผู้ทำ'] || '', queued: j['วันที่เข้าคิว'] || '', end: j['เสร็จเมื่อ'] || '',
             logs: (logBy[j['Job_ID']] || []).map(function (l) {
               return { when: l['เมื่อ'], good: num(l['ดี']), gradeB: num(l['เกรดB']), waste: num(l['เสีย']),
                        reason: l['สาเหตุเสีย'] || '', by: l['ผู้ลง'] || '', note: l['หมายเหตุ'] || '' };
             }) };
  }).sort(function (a, b) { return String(b.end || b.queued || '').localeCompare(String(a.end || a.queued || '')); });
  return { ok: true, days: days, rows: rows.slice(0, 150),
           stat: { jobs: rows.length, good: rows.reduce(function (s, r) { return s + r.good; }, 0),
                   gradeB: rows.reduce(function (s, r) { return s + r.gradeB; }, 0),
                   waste: rows.reduce(function (s, r) { return s + r.waste; }, 0) } };
}

function doPost(e) { return doGet(e); }
// รันจาก editor เมื่อสงสัยว่ารหัสผู้บริหารหลุด — ได้รหัสใหม่ทันที (แจ้งผู้บริหารทุกคน)
function rotateExecKey() {
  const k = Utilities.getUuid().replace(/-/g, '');
  setProp('PK_EXEC_KEY', k);
  Logger.log('PK_EXEC_KEY ใหม่: ' + k);
}
function healthCheck() {
  Logger.log('P&K System ' + CODE_VERSION + ' · PK_SHEET_ID=' + (prop('PK_SHEET_ID') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง — รัน setupPkSystem()'));
  Logger.log('PK_KEY=' + (prop('PK_KEY') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง') + ' · PK_EXEC_KEY=' + (prop('PK_EXEC_KEY') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง'));
}
