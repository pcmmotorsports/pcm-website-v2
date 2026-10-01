/**
 * `GET /api/cron/new-product-drafts` — 每天挑幾件新品, 建首頁大圖 + FB / IG 草稿
 * (計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md, Sean 2026-10-01 批准)。
 *
 * ## 🔴 預設關
 * - `NEW_PRODUCT_DRAFTS_ENABLED` 不是 `on` ⇒ 200 + `skipped:'disabled'`, 什麼都不建。
 * - 正式網址(NEXT_PUBLIC_SITE_URL)沒設 ⇒ 200 + `skipped:'missing_site_url'`:連結組不出來就不建。
 * - 排程(pg_cron 每天 09:00 呼叫本 route)開旗標那天另外交(計畫片 6);在那之前沒有人會打這支。
 *
 * ## 認證與限流
 * 照 supplier-newproduct-drafts:`CRON_SECRET` Bearer + `timingSafeEqual`;env 未設 / 弱 ⇒ 500、
 * Bearer 缺 / 不符 ⇒ 401;限流在認證之後才計數。
 *
 * ## 失敗
 * 讀商品失敗 ⇒ 503 + log 分類;單一件被資料庫拒收 ⇒ 跳過那一件、整輪照跑(skipped.rejected)。
 * 同一商品已有草稿不算失敗(資料庫回 duplicate)。
 *
 * ## ⚠️「每天最多 3 份」= 每次呼叫最多 3 份
 * 排程一天只打一次;人工重跑或重疊時會再建最多 3 份(同一商品不會重複)。要嚴守就查當天
 * created_by = 'system:new-product-draft' 的數量再決定 —— 目前不做(R1 建議 4, 人工重跑是例外狀況)。
 */
import { timingSafeEqual } from 'node:crypto';
import { draftNewProductPosts } from '@pcm/use-cases';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { getNewProductDraftDeps } from '@/lib/new-product-drafts/composition';
import { resolveSiteUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 一輪:讀最多 1,000 張新卡(約 40 次查詢)+ 最多建 3 份草稿 ⇒ 遠低於 60 秒, 對齊其他 cron。 */
export const maxDuration = 60;

const MIN_SECRET_LEN = 32;
const BEARER_PREFIX = 'Bearer ';
const RATE_KEY = 'new-product-drafts';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LEN) {
    console.error('[new-product-drafts] CRON_SECRET 未設或太短 ⇒ 拒不執行');
    return json({ ok: false }, 500);
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith(BEARER_PREFIX) || !safeEqual(auth.slice(BEARER_PREFIX.length), secret)) {
    return json({ ok: false }, 401);
  }
  if (!checkCronRateLimit(RATE_KEY)) return json({ ok: false }, 429);

  if (process.env.NEW_PRODUCT_DRAFTS_ENABLED !== 'on') {
    console.info('[new-product-drafts] 旗標關 ⇒ 不建草稿', { reason: 'disabled' });
    return json({ ok: true, enabled: false, skipped: 'disabled' }, 200);
  }
  const siteUrl = resolveSiteUrl();
  if (!siteUrl) {
    console.warn('[new-product-drafts] 正式網址沒設 ⇒ 不建草稿', { reason: 'missing_site_url' });
    return json({ ok: true, enabled: true, skipped: 'missing_site_url' }, 200);
  }

  try {
    const result = await draftNewProductPosts(getNewProductDraftDeps(siteUrl));
    console.info('[new-product-drafts] 一輪完成', result);
    return json({ ok: true, enabled: true, ...result }, 200);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error('[new-product-drafts] 🔴 整輪失敗', { code: typeof code === 'string' ? code : 'unknown' });
    return json({ ok: false, error: typeof code === 'string' ? code : 'unknown' }, 503);
  }
}
