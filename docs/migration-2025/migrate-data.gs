/** ================================================================
 *  migrate-data.gs — ย้ายข้อมูล AppSheet จากเมลเก่า → เมลใหม่ (ครั้งเดียว)
 *  บริษัท ออริจิ้น แล็บส์ · สร้าง ส.ค. 2026 (palm-hq/docs/migration-2025)
 *
 *  โจทย์: AppSheet 4 แอป (Office / งานผลิต / รับออเดอร์ / ทีมสกรีนสี)
 *  อยู่ในบัญชีเก่า palm.work2025@gmail.com — จะย้ายข้อมูลทั้งหมด
 *  มาไว้ในบัญชีใหม่ palm.work2026@gmail.com แล้วปิดของเก่า
 *
 *  ใช้ยังไง (รันในบัญชี "ใหม่" palm.work2026 เท่านั้น):
 *   1) ล็อกอินเมลเก่า → Google Drive → โฟลเดอร์ appsheet/data
 *      → คลิกขวา Share → ใส่ palm.work2026@gmail.com สิทธิ์ Viewer ก็พอ
 *   2) ล็อกอินเมลใหม่ → เปิด script.new → วางไฟล์นี้ทั้งไฟล์
 *   3) แก้ SOURCE_FOLDER_ID ด้านล่าง = id โฟลเดอร์ที่แชร์มา
 *      (เปิดโฟลเดอร์ใน Drive แล้วดูใน URL: /folders/<ตรงนี้คือ id>)
 *   4) รัน migrateAll() → กดอนุญาตสิทธิ์ → ดู Log จนขึ้น "== เสร็จ =="
 *      โฟลเดอร์ใหญ่/รูปเยอะ สคริปต์จะพักเองก่อนชน 6 นาที
 *      แล้วตั้งเวลารันต่อเองอัตโนมัติ ไม่ต้องเฝ้า
 *   5) รัน verifyReport() → เปิดชีต Migration_Report ในโฟลเดอร์
 *      Migration-2025 → คอลัมน์ "ตรวจ" ต้องเป็น OK ทุกแถว
 *
 *  ความปลอดภัย: สคริปต์ "อ่านอย่างเดียว" กับของเก่า — ทำสำเนาเท่านั้น
 *  ไม่แก้ ไม่ลบ ไม่ย้ายไฟล์ต้นฉบับ ข้อมูลในเมลเก่าอยู่ครบเหมือนเดิม
 * ================================================================ */

const SOURCE_FOLDER_ID   = 'ใส่_ID_โฟลเดอร์_appsheet_data_ที่แชร์มา';
const TARGET_FOLDER_NAME = 'Migration-2025';  // สร้างใน My Drive ของเมลใหม่
const COPY_ATTACHMENTS   = true;              // ก๊อปรูป/ไฟล์แนบของ AppSheet ด้วย (false = เอาเฉพาะสเปรดชีต)
const TIME_LIMIT_MS      = 4.5 * 60 * 1000;   // กันชนลิมิต 6 นาทีของ Apps Script

const MIME_SHEET  = 'application/vnd.google-apps.spreadsheet';
const PROPS = PropertiesService.getScriptProperties();

/** เริ่มย้ายทั้งหมด (ล้างสถานะเก่าแล้วเริ่มใหม่) */
function migrateAll() {
  clearTriggers_();
  PROPS.deleteAllProperties();

  const target = getOrCreateFolder_(DriveApp.getRootFolder(), TARGET_FOLDER_NAME);
  const report = SpreadsheetApp.create('Migration_Report');
  DriveApp.getFileById(report.getId()).moveTo(target);
  report.getActiveSheet()
    .setName('รายการ')
    .appendRow(['เส้นทาง', 'ชนิด', 'id ต้นฉบับ', 'id สำเนา', 'ต้นฉบับ (แท็บ×แถว)', 'สำเนา (แท็บ×แถว)', 'ตรวจ']);

  PROPS.setProperty('reportId', report.getId());
  PROPS.setProperty('queue', JSON.stringify([
    { src: SOURCE_FOLDER_ID, dst: target.getId(), path: '' }
  ]));
  processQueue_();
}

/** ตัวรันต่ออัตโนมัติ (trigger เรียกเอง — ไม่ต้องรันมือ) */
function continueMigration() { processQueue_(); }

/** เดินคิวโฟลเดอร์ทีละไฟล์ พักเองก่อนหมดเวลา */
function processQueue_() {
  const start  = Date.now();
  const report = SpreadsheetApp.openById(PROPS.getProperty('reportId')).getSheetByName('รายการ');
  let queue    = JSON.parse(PROPS.getProperty('queue') || '[]');

  while (queue.length) {
    const job = queue[0];
    const srcFolder = DriveApp.getFolderById(job.src);
    const dstFolder = DriveApp.getFolderById(job.dst);

    // 1) ไฟล์ในโฟลเดอร์นี้ (จำตำแหน่งด้วย continuation token ไว้รันต่อ)
    let files = job.token
      ? DriveApp.continueFileIterator(job.token)
      : srcFolder.getFiles();
    while (files.hasNext()) {
      const f    = files.next();
      const mime = f.getMimeType();
      if (mime === MIME_SHEET || COPY_ATTACHMENTS) {
        const copy = f.makeCopy(f.getName(), dstFolder);
        report.appendRow([
          job.path + '/' + f.getName(),
          mime === MIME_SHEET ? 'สเปรดชีต' : 'ไฟล์แนบ',
          f.getId(), copy.getId(), '', '', ''
        ]);
      }
      if (Date.now() - start > TIME_LIMIT_MS) {           // ใกล้หมดเวลา → เซฟจุด แล้วนัดตัวเองมารันต่อ
        job.token = files.getContinuationToken();
        PROPS.setProperty('queue', JSON.stringify(queue));
        scheduleContinue_();
        Logger.log('พักชั่วคราว จะรันต่อเองใน 1 นาที — ก๊อปไปแล้วบางส่วน ดูชีต Migration_Report');
        return;
      }
    }

    // 2) โฟลเดอร์ย่อย → สร้างปลายทางคู่กัน แล้วต่อคิว
    const subs = srcFolder.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      const newSub = getOrCreateFolder_(dstFolder, sub.getName());
      queue.push({ src: sub.getId(), dst: newSub.getId(), path: job.path + '/' + sub.getName() });
    }

    queue.shift();                                        // โฟลเดอร์นี้เสร็จแล้ว
    PROPS.setProperty('queue', JSON.stringify(queue));
  }

  clearTriggers_();
  Logger.log('== เสร็จ == ก๊อปครบทุกโฟลเดอร์แล้ว → รัน verifyReport() ต่อได้เลย');
}

/** ตรวจทาน: เทียบจำนวนแท็บ+แถวของทุกสเปรดชีต ต้นฉบับ vs สำเนา */
function verifyReport() {
  const sheet = SpreadsheetApp.openById(PROPS.getProperty('reportId')).getSheetByName('รายการ');
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== 'สเปรดชีต') continue;
    const a = countTabs_(rows[i][2]);
    const b = countTabs_(rows[i][3]);
    sheet.getRange(i + 1, 5, 1, 3).setValues([[a, b, a === b ? 'OK' : 'ไม่ตรง!']]);
  }
  Logger.log('ตรวจเสร็จ — เปิดชีต Migration_Report คอลัมน์ "ตรวจ" ต้องเป็น OK ทุกแถว');
}

/** สรุปสเปรดชีตหนึ่งไฟล์เป็นข้อความ "ชื่อแท็บ×จำนวนแถว" ทุกแท็บ */
function countTabs_(id) {
  try {
    return SpreadsheetApp.openById(id).getSheets()
      .map(s => s.getName() + '×' + s.getLastRow())
      .join(', ');
  } catch (e) {
    return 'เปิดไม่ได้: ' + e.message;
  }
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function scheduleContinue_() {
  clearTriggers_();
  ScriptApp.newTrigger('continueMigration').timeBased().after(60 * 1000).create();
}

function clearTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'continueMigration')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
