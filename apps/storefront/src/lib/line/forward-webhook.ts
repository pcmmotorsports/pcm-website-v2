import { LINE_SIGNATURE_HEADER } from './friend-webhook';

// forward-webhook.ts — 把 LINE webhook 整包【原封】轉給第二個接收端(主視窗 2026-09-14 裁甲案)。
//
// 為什麼:一個 LINE channel 只能填一個 webhook URL, 而報價單(pcm-quote-v2)靠 message 事件做 FAQ / 沉默追單。
// www 接下 URL 之後自己處理 follow / unfollow, 再把原始 bytes + 原 x-line-signature 轉過去 ——
// 兩邊同一把 channel secret, 所以對方照樣驗得過, 我們不必也不能改動任何一個 byte。
//
// 🔴 只轉【本地簽章已驗過】的包(route 保證), 不當 relay 放大器。
// 🔴 先回 LINE 200、再背景轉(route 用 next/server after());對方回什麼、有沒有掛, 都不影響我們的回應。
// 🔴 失敗只 log 事件 id 與筆數, 不記 userId、不記 body。

export const LINE_FORWARD_TIMEOUT_MS = 3_000;
/** 1 次 + 3 次重試, 退避 1s / 3s / 9s(報價單窗 2026-09-14 補:LINE 拿到我們的 200 就不管了, 這一跳掉了 = 訊息靜默消失)。 */
export const LINE_FORWARD_BACKOFF_MS: readonly number[] = [1_000, 3_000, 9_000];
export const LINE_FORWARD_ATTEMPTS = LINE_FORWARD_BACKOFF_MS.length + 1;

export type ForwardOutcome = 'skipped_no_url' | 'skipped_bad_url' | 'ok' | 'failed';

export type ForwardLineWebhookInput = {
  /** 沒設(空字串 / undefined)⇒ 不轉發, 純本地行為。 */
  forwardUrl: string | undefined;
  rawBytes: Uint8Array;
  signature: string;
  /** 只拿來 log, 沒有就給空陣列。 */
  eventIds: readonly string[];
  fetchImpl?: typeof fetch;
  /** 測試用;正式走 setTimeout。 */
  sleepImpl?: (ms: number) => Promise<void>;
  /** 四次都失敗才叫一次;detail 只有原因 + 事件 id。它自己丟例外 ⇒ 這裡吞掉只 log(留痕失敗不能再炸一次)。 */
  onFailed?: (detail: string) => Promise<void>;
};

/** 從原始 JSON 抽 webhookEventId(LINE 每個事件都帶);抽不到就空。只給 log 用, 不影響轉發。 */
export function extractLineEventIds(rawBody: string): string[] {
  try {
    const parsed = JSON.parse(rawBody) as { events?: unknown };
    if (!Array.isArray(parsed?.events)) return [];
    return parsed.events
      .map((e: unknown) => (e as { webhookEventId?: unknown } | null)?.webhookEventId)
      .filter((id: unknown): id is string => typeof id === 'string' && id !== '');
  } catch {
    return [];
  }
}

export async function forwardLineWebhook(input: ForwardLineWebhookInput): Promise<ForwardOutcome> {
  const url = input.forwardUrl?.trim() ?? '';
  if (url === '') return 'skipped_no_url';
  // codex R1 nit:只准 https(明文會把整包對話送出去);設錯 = 設定問題, 不是每包重試的事。
  if (!/^https:\/\//i.test(url)) {
    console.error('[line/webhook] LINE_WEBHOOK_FORWARD_URL 不是 https ⇒ 不轉');
    return 'skipped_bad_url';
  }
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: string = 'unknown';
  for (let attempt = 1; attempt <= LINE_FORWARD_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(LINE_FORWARD_BACKOFF_MS[attempt - 2]!);
    try {
      // 🔴 body = req.arrayBuffer() 拿到的原始 bytes 原封(不 parse / stringify);Content-Type 逐字給定, fetch 不會再補 charset。
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [LINE_SIGNATURE_HEADER]: input.signature },
        // 型別:TS 的 BodyInit 要 ArrayBuffer-backed 的 view;slice 出一份不共用 buffer 的 Uint8Array<ArrayBuffer>, bytes 不變。
        body: new Uint8Array(input.rawBytes) as Uint8Array<ArrayBuffer>,
        // codex R1 must-fix:預設跟隨轉址 ⇒ 301/302 會變 GET 丟 body 而 200 被當成功, 307/308 會把整包 + 簽章送去別的主機。
        redirect: 'error',
        signal: AbortSignal.timeout(LINE_FORWARD_TIMEOUT_MS),
      });
      // 對方回 2xx 才算送到;其他碼視同失敗、重試一次(對方可能剛好在部署)。
      if (res.ok) return 'ok';
      lastError = `http_${res.status}`;
    } catch (e) {
      // fetch 連不上時是 TypeError 而真原因在 cause.code(ECONNREFUSED / ENOTFOUND …);有就用它, 進 log 與 pcm_incident 才看得懂。
      const cause = (e as { cause?: { code?: unknown } })?.cause?.code;
      const name = (e as { name?: unknown })?.name;
      lastError = typeof cause === 'string' ? cause : typeof name === 'string' ? name : 'fetch_error';
    }
  }
  console.error('[line/webhook] 轉發失敗(已重試)', {
    reason: lastError,
    attempts: LINE_FORWARD_ATTEMPTS,
    events: input.eventIds.length,
    eventIds: input.eventIds,
  });
  // 留痕 pcm_incident(kind=line_forward_failed, 20260914100000)⇒ 進 Sean 的早上摘要。detail 不含 userId / body。
  if (input.onFailed) {
    try {
      await input.onFailed(`${lastError} x${LINE_FORWARD_ATTEMPTS} events=${input.eventIds.join(',') || '(無 id)'}`);
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      console.error('[line/webhook] 轉發失敗留痕也失敗', { code: typeof code === 'string' ? code : 'unknown' });
    }
  }
  return 'failed';
}
