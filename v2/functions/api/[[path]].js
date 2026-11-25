// โรงขวด P&K v2 — ทุกคำขอ /api/* จบที่นี่ (Cloudflare Pages Functions · โปรเจกต์ pk-v2 · D1 ผูกชื่อ DB)
//   ตัวงานจริงอยู่ v2/server/ (ไม่ผูกกับ Cloudflare — เทสต์รันใน Node + sqlite) · ความลับ: PK_TICKET_KEY · PK_SYNC_KEY (Cloudflare secret)
import { createApp } from "../../server/app.mjs";
import { buildRegistry } from "../../server/actions/index.mjs";

const app = createApp({ registry: buildRegistry() });

export async function onRequest({ request, env, params }) {
  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  return app.handle(request, env, path);
}
