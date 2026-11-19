#!/usr/bin/env bash
# ============================================================
#  ส่ง Worker นาฬิกาปลุก (ซิงก์ชีทบัญชี 20:00 · นำเข้ารอบผลิตแอปเดิม 06:30/18:30) ขึ้น Cloudflare — เรียกต่อจาก tools/deploy-cf.sh ใน CI
#  ต้องมี env: CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID · PK_SYNC_KEY (ไม่มี = ข้ามพร้อมบอก)
#  ชื่อแยกจากโรงน้ำ: Worker pk-v2-cron · ผูก D1 pk-v2 ตัวเดียวกับแอป
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${PK_D1_NAME:-pk-v2}"
NAME="${PK_CRON_NAME:-pk-v2-cron}"
W="npx --yes wrangler@4"
case "$NAME$DB" in pk-*pk-*) ;; *) echo "::error::ชื่อ Worker/ฐานต้องขึ้นต้น pk- (กันชนกับโรงน้ำ)"; exit 1;; esac
if [ -z "${PK_SYNC_KEY:-}" ]; then echo "::warning::ยังไม่มี secret PK_SYNC_KEY — ข้ามนาฬิกาปลุกซิงก์ชีทบัญชี (กดซิงก์ในแอปได้ตามปกติ)"; exit 0; fi
GAS_URL="$(node -e 'global.window={};require("vm").runInThisContext(require("fs").readFileSync("web/config.js","utf8"));process.stdout.write(window.PK_CONFIG.gasUrl||"")')"
ID="$($W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const x=a.find(d=>d.name===process.argv[1]);process.stdout.write(x?x.uuid:"")}catch(e){}})' "$DB")"
[ -n "$ID" ] || { echo "::error::ไม่พบฐาน D1 $DB (ให้ deploy-cf.sh สร้างก่อน)"; exit 1; }
cat > cron/wrangler.toml <<TOML
# สร้างโดย tools/deploy-cron.sh — ไม่ commit
name = "$NAME"
main = "worker.mjs"
compatibility_date = "2026-11-01"
workers_dev = false

[triggers]
crons = ["0 13 * * *", "30 23 * * *", "30 11 * * *"]   # 20:00 ซิงก์บัญชี · 06:30 + 18:30 นำเข้ารอบผลิตแอปเดิม (เวลาไทย — ดู cron/worker.mjs)

[vars]
PK_GAS_URL = "$GAS_URL"

[[d1_databases]]
binding = "DB"
database_name = "$DB"
database_id = "$ID"
TOML
(cd cron && $W deploy)
printf '%s' "$PK_SYNC_KEY" | (cd cron && $W secret put PK_SYNC_KEY --name "$NAME") >/dev/null && echo "ตั้ง secret PK_SYNC_KEY ให้ $NAME แล้ว"
echo "✅ นาฬิกาปลุก: ซิงก์ชีทบัญชี 20:00 (ค่าตั้ง ACCT_SYNC_AUTO) · นำเข้ารอบผลิตแอปเดิม 06:30/18:30 (ค่าตั้ง LEGACY_RUNS_AUTO) — ปิดได้ในแอปประธาน › ทีม › ค่าตั้ง"
