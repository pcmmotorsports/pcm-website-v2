// app/api/cron/bing-weekly/route.ts — 每週一 Bing 週報(2026-09-29;Sean 選甲 = 獨立排程, 不併進告警)。
//
// Supabase pg_cron `pcm-bing-weekly`(`5 1 * * 1` = 台北週一 09:05)經 `pcm_cron.invoke_cron_route` 打這裡。
// 計畫:~/pcm-mailbox/計畫-Bing週報LINE-20260929.md 第 12～14 節。
//
// 流程:驗 CRON_SECRET → 限流 → 讀 Bing(最多 15 秒)→ 送一則 LINE → 心跳。
// 🔴 不管 Bing 讀到、過期或讀不到, 都送一則(每週固定一則, Sean 看得出它有在跑);
//    讀不到不算這一輪失敗 —— LINE 會照實寫「讀不到」。只有設定缺漏與 LINE 送不出去才回 503。
// 🔴 金鑰在 Bing 的網址參數裡 ⇒ 本檔只印固定的 reason / 錯誤類別名, 不印錯誤物件、網址或回應內容。
// 範本:../order-ineligible-gate/route.ts(CRON_SECRET 驗證、限流、心跳同一個寫法)。
import { timingSafeEqual } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- 受控例外(Sean 2026-09-29 選甲 Bing 週報獨立排程):只取 LINE 推播(token 由本檔從 env 注入)與 Bing 讀取純函式;兩者都不碰資料庫、不建 service_role client、不回傳 client;本檔 server-only(route handler)、不入 client bundle。
import { LineAlertNotifierAdapter, readBingWeekly, formatBingWeeklyLine, type BingReadOutcome, type BingFetch } from '@pcm/adapters/server';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { CRON_JOB_NAME, recordHeartbeatSuccess, recordHeartbeatFailure } from '@/lib/cron/heartbeat';
import { safeErrorName } from '@/lib/safe-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Bing 最多 15 秒 + LINE 最多 10 秒 + 心跳最多 4 秒 ≈ 29 秒;比照其他排程 route 給 60。 */
export const maxDuration = 60;

const MIN_SECRET_LEN = 32;
const BEARER_PREFIX = 'Bearer ';
/** Bing Webmaster 上驗證過的站台(主視窗 09-29 用 GetUserSites 唯讀實測)。 */
const BING_SITE_URL = 'https://pcmmotorsports.com/';
/** 讀 Bing 的截止時間。讀取器內用同一個數字讓 fetch 真的中止, route 這一層再保一次(測試靠這一層)。 */
const BING_READ_BUDGET_MS = 15_000;
const TITLE = 'PCM Bing 週報';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) {
    throw new Error('CRON_SECRET 未設或強度不足(需 ≥32)');
  }
  return s;
}

/** 讀 Bing, 最多等 BING_READ_BUDGET_MS。讀取器同步丟錯或逾時都回「讀不到」, 本函式不丟錯。 */
async function readWithDeadline(apiKey: string, now: Date): Promise<BingReadOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() =>
          readBingWeekly({
            apiKey,
            siteUrl: BING_SITE_URL,
            now,
            fetchFn: globalThis.fetch as unknown as BingFetch,
            signal: AbortSignal.timeout(BING_READ_BUDGET_MS),
          }),
        )
        .catch((): BingReadOutcome => ({ result: null, reason: 'network' })),
      new Promise<BingReadOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ result: null, reason: 'timeout' }), BING_READ_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function GET(request: Request): Promise<Response> {
  let expected: string;
  try {
    expected = requireCronSecret();
  } catch {
    return new Response(null, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith(BEARER_PREFIX) ? auth.slice(BEARER_PREFIX.length) : '';
  if (!safeEqual(presented, expected)) {
    return new Response(null, { status: 401 });
  }

  if (!checkCronRateLimit('bing-weekly')) {
    return new Response(null, { status: 429 });
  }

  // 設定缺漏是設定錯誤 ⇒ 503 + 失敗心跳, 讓儀表板與告警看得到(上線順序見計畫 12.5)。只印變數名稱。
  const apiKey = process.env.BING_WEBMASTER_API_KEY?.trim();
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const to = process.env.LINE_ALERT_TO?.trim();
  const missingEnvNames = [
    ...(apiKey ? [] : ['BING_WEBMASTER_API_KEY']),
    ...(accessToken ? [] : ['LINE_CHANNEL_ACCESS_TOKEN']),
    ...(to ? [] : ['LINE_ALERT_TO']),
  ];
  if (!apiKey || !accessToken || !to) {
    console.error('[bing-weekly] 🔴 缺環境變數, 這週不讀也不送', { missingEnvNames });
    await recordHeartbeatFailure(CRON_JOB_NAME.bingWeekly);
    return new Response(null, { status: 503 });
  }

  const outcome = await readWithDeadline(apiKey, new Date());
  if (outcome.result === null) {
    console.warn('[bing-weekly] 讀不到 Bing', { reason: outcome.reason ?? 'network' });
  }
  const lineText = `${TITLE}\n${formatBingWeeklyLine(outcome)}`;

  try {
    // subject / text 是型別必填;LINE 只印 lineText(LineAlertNotifierAdapter 有 lineText 就不加長信格式)。
    await new LineAlertNotifierAdapter({ accessToken, to }).notify({ subject: TITLE, text: lineText, lineText });
  } catch (err) {
    console.error('[bing-weekly] 🔴 LINE 送不出去', { error: safeErrorName(err) });
    await recordHeartbeatFailure(CRON_JOB_NAME.bingWeekly);
    return new Response(null, { status: 503 });
  }

  await recordHeartbeatSuccess(CRON_JOB_NAME.bingWeekly);
  return Response.json({ ok: true, kind: outcome.result?.kind ?? 'unreadable' }, { status: 200 });
}
