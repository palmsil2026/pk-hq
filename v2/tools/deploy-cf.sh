#!/usr/bin/env bash
# ============================================================
#  ส่ง v2 ขึ้น Cloudflare (Pages + Functions + D1) — CI เรียก (.github/workflows/v2-ci.yml › deploy-cloudflare)
#  ต้องมี env: CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID · (ถ้ามี) PK_TICKET_KEY · PK_SYNC_KEY
#  ชื่อแยกจากโรงน้ำเด็ดขาด: Pages project + D1 ชื่อขึ้นต้น pk- (ค่าตั้งต้น pk-v2)
#  branch ที่ไม่ใช่ main = ขึ้นเป็น "พรีวิว" (https://<branch>.pk-v2.pages.dev) ไม่ใช่ของจริง
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${PK_CF_PROJECT:-pk-v2}"
DB="${PK_D1_NAME:-pk-v2}"
BRANCH="${DEPLOY_BRANCH:-pk-app-v2}"
GAS_URL="$(node -e 'global.window={};require("vm").runInThisContext(require("fs").readFileSync("web/config.js","utf8"));process.stdout.write(window.PK_CONFIG.gasUrl||"")')"
W="npx --yes wrangler@4"
case "$NAME$DB" in pk-*pk-*) ;; *) echo "::error::ชื่อโปรเจกต์/ฐานต้องขึ้นต้น pk- (กันชนกับโรงน้ำ)"; exit 1;; esac

db_id() { $W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const x=a.find(d=>d.name===process.argv[1]);process.stdout.write(x?x.uuid:"")}catch(e){}})' "$DB"; }
ID="$(db_id)"
if [ -z "$ID" ]; then echo "สร้างฐาน D1 $DB"; $W d1 create "$DB" >/dev/null; ID="$(db_id)"; fi
[ -n "$ID" ] || { echo "::error::หา/สร้างฐาน D1 $DB ไม่สำเร็จ"; exit 1; }

cat > wrangler.toml <<TOML
# สร้างโดย tools/deploy-cf.sh ตอน deploy — ไม่ commit (ไม่มีความลับ แต่ database_id ผูกกับบัญชี)
name = "$NAME"
pages_build_output_dir = "web"
compatibility_date = "2026-11-01"

[vars]
PK_GAS_URL = "$GAS_URL"

[[d1_databases]]
binding = "DB"
database_name = "$DB"
database_id = "$ID"
migrations_dir = "db/migrations"
TOML

echo "ใส่ migration ที่ยังไม่ได้ใส่ (รันซ้ำได้ — wrangler จำในตาราง d1_migrations)"
$W d1 migrations apply "$DB" --remote
$W pages project create "$NAME" --production-branch main >/dev/null 2>&1 || true
for k in PK_TICKET_KEY PK_SYNC_KEY; do
  v="${!k:-}"
  if [ -n "$v" ]; then printf '%s' "$v" | $W pages secret put "$k" --project-name "$NAME" >/dev/null && echo "ตั้ง secret $k แล้ว"; else echo "::warning::ยังไม่มี secret $k — เข้าระบบ/นำเข้าใน v2 ยังใช้ไม่ได้ (ดู v2/README.md)"; fi
done
$W pages deploy web --project-name "$NAME" --branch "$BRANCH" --commit-dirty=true | tee /tmp/pk-deploy.log
URL="https://$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g').$NAME.pages.dev"
echo "ตรวจ $URL/api/health"
for i in 1 2 3 4 5 6; do
  if curl -fsS "$URL/api/health" | tee /tmp/pk-health.json | grep -q '"db":true'; then echo; echo "✅ ขึ้นแล้ว: $URL"; exit 0; fi
  sleep 10
done
echo "::error::/api/health ไม่ตอบ db:true"; cat /tmp/pk-health.json || true; exit 1
