/**
 * `GET /api/cron/supplier-newproduct-drafts` — 每天讀廠商新品信 → 首頁大圖草稿(PRD 2026-09-15 §4、§12)。
 *
 * ## 🔴 預設關
 * - `SUPPLIER_MAIL_DRAFTS_ENABLED` 不是 `on` ⇒ 200 + `skipped:'disabled'`,**一封信都不讀**。
 * - 旗標開但 Gmail / Claude 的 env 缺 ⇒ 200 + `skipped:'missing_env'` + 缺哪幾個【名字】(不印值),不讀信。
 * - 白名單是空的 ⇒ 200 + `skipped:'no_senders'`。
 * - 排程(pg_cron 呼叫本 route)還沒建 ⇒ 今天沒有人會打這支;排程是 migration,後面那一片。
 *
 * ## 認證與限流
 * 照 `capture-recheck` / `email-sweep`:`CRON_SECRET` Bearer + `timingSafeEqual`;env 未設/弱 ⇒ 500、
 * Bearer 缺/不符 ⇒ 401;限流在認證之後才計數。
 *
 * ## 失敗
 * 列信失敗(授權失效 / Gmail 掛)⇒ 503 + log 分類;單封失敗由 use-case 記 failed,不影響回應碼。
 */
import { timingSafeEqual } from 'node:crypto';
import { draftSupplierNewProductBanners } from '@pcm/use-cases';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { getSupplierNewProductDraftDeps } from '@/lib/supplier-mail/composition';
import { SUPPLIER_MAIL_SENDERS } from '@/data/supplier-mail-senders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 一輪最多 20 封 × (Gmail get + DB + Claude ~數秒) ⇒ 對齊其他 cron 的 60 秒。 */
export const maxDuration = 60;

const MIN_SECRET_LEN = 32;
const BEARER_PREFIX = 'Bearer ';
const RATE_KEY = 'supplier-newproduct-drafts';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) throw new Error('CRON_SECRET 未設或強度不足(需 ≥32)');
  return s;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = requireCronSecret();
  } catch {
    console.error('[supplier-newproduct-drafts] CRON_SECRET 未設或太短 ⇒ 拒不執行');
    return json({ ok: false }, 500);
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith(BEARER_PREFIX) || !safeEqual(auth.slice(BEARER_PREFIX.length), secret)) {
    return json({ ok: false }, 401);
  }
  if (!checkCronRateLimit(RATE_KEY)) return json({ ok: false }, 429);

  if (process.env.SUPPLIER_MAIL_DRAFTS_ENABLED !== 'on') {
    console.info('[supplier-newproduct-drafts] 旗標關 ⇒ 不讀信', { reason: 'disabled' });
    return json({ ok: true, enabled: false, skipped: 'disabled' }, 200);
  }

  // 🔴 只記【名字】,值不進 log / 回應
  const env = {
    GMAIL_OAUTH_CLIENT_ID: process.env.GMAIL_OAUTH_CLIENT_ID,
    GMAIL_OAUTH_CLIENT_SECRET: process.env.GMAIL_OAUTH_CLIENT_SECRET,
    GMAIL_OAUTH_REFRESH_TOKEN: process.env.GMAIL_OAUTH_REFRESH_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.warn('[supplier-newproduct-drafts] 旗標開但 env 缺 ⇒ 不讀信', { reason: 'missing_env', missing });
    return json({ ok: true, enabled: true, skipped: 'missing_env', missing }, 200);
  }
  if (SUPPLIER_MAIL_SENDERS.length === 0) {
    console.warn('[supplier-newproduct-drafts] 寄件者白名單是空的 ⇒ 不讀信', { reason: 'no_senders' });
    return json({ ok: true, enabled: true, skipped: 'no_senders' }, 200);
  }

  try {
    const result = await draftSupplierNewProductBanners(
      getSupplierNewProductDraftDeps({
        gmailClientId: env.GMAIL_OAUTH_CLIENT_ID!,
        gmailClientSecret: env.GMAIL_OAUTH_CLIENT_SECRET!,
        gmailRefreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN!,
        anthropicApiKey: env.ANTHROPIC_API_KEY!,
      }),
    );
    console.info('[supplier-newproduct-drafts] 一輪完成', result);
    return json({ ok: true, enabled: true, ...result }, 200);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error('[supplier-newproduct-drafts] 🔴 整輪失敗', { code: typeof code === 'string' ? code : 'unknown' });
    return json({ ok: false, error: typeof code === 'string' ? code : 'unknown' }, 503);
  }
}
