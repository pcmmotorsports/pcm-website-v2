'use server';

import { isEmailCopyKey, resolveEmailCopyOverrides, validateEmailCopyText, EMAIL_COPY_LOCKED } from '@pcm/domain';
import { NotificationEmailInput, isSyntheticEmailDomain } from '@pcm/schemas';
import { EMAIL_PREVIEW_SAMPLES, renderEmailCopyPreview } from '@pcm/use-cases';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import { listEmailCopyVersions } from './email-copy-repository';
import { takeTestEmailSlot } from './test-email-rate-limit';

// 信件文字第 3 片:「寄測試信」(Sean 10-02 Q1 乙)。
// · 用寄訂單信那把金鑰(RESEND_API_KEY、ORDER_EMAIL_FROM, 後台 Vercel 另外放);沒設 ⇒ not_configured, 頁面不壞。
// · 寄到員工當場輸入的信箱;主旨前加「〔測試〕」, 內文最上面標明這是測試信、訂單資料是範例。
// · 每位員工每分鐘最多 3 封(同一個伺服器實例內的上限;Vercel 多實例時是大概值, 不是保證)。
// · 寄出記操作紀錄:誰、寄到哪、哪一句、用的文字、結果。

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;
const TEST_SUBJECT_PREFIX = '〔測試〕';
const TEST_TEXT_BANNER = '〔測試信〕這封信是從後台「信件文字」頁寄出的測試信，裡面的訂單資料都是範例，不是真的訂單。';

export type SendTestEmailResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'not_configured' | 'too_many' | 'bad_address' | 'error' | 'unknown' }
  | { ok: false; reason: 'invalid'; problems: string[] };

/** 後台頁面用:寄測試信需要的兩個設定有沒有放。 */
export async function isTestEmailConfigured(): Promise<boolean> {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.ORDER_EMAIL_FROM?.trim());
}

function markHtmlAsTest(html: string): string {
  const banner = `<div style="background:#fff4d6;color:#7a4b00;padding:10px 14px;font-size:14px;font-family:sans-serif;">${TEST_TEXT_BANNER}</div>`;
  return /<body[^>]*>/.test(html) ? html.replace(/<body[^>]*>/, (m) => m + banner) : banner + html;
}

export async function sendTestEmailCopyAction(input: {
  key: string;
  draft: string | null;
  sampleId: string;
  to: string;
}): Promise<SendTestEmailResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, reason: 'denied' };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ORDER_EMAIL_FROM?.trim();
  if (!apiKey || !from) return { ok: false, reason: 'not_configured' };

  const { key, draft, sampleId } = input;
  if (typeof key !== 'string' || !isEmailCopyKey(key) || EMAIL_COPY_LOCKED.has(key)) {
    return { ok: false, reason: 'invalid', problems: ['這一句不開放修改'] };
  }
  if (draft !== null) {
    if (typeof draft !== 'string') return { ok: false, reason: 'invalid', problems: ['文字格式不對'] };
    const problems = validateEmailCopyText(key, draft);
    if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  }
  const parsed = NotificationEmailInput.safeParse(typeof input.to === 'string' ? input.to : '');
  if (!parsed.success || isSyntheticEmailDomain(parsed.data)) return { ok: false, reason: 'bad_address' };
  const to = parsed.data;
  if (!takeTestEmailSlot(auth.actorId, Date.now())) return { ok: false, reason: 'too_many' };

  const requestId = await getRequestId();
  let preview;
  try {
    const versions = await listEmailCopyVersions();
    const overrides = new Map(resolveEmailCopyOverrides(versions, new Date().toISOString()).overrides);
    if (draft === null) overrides.delete(key);
    else overrides.set(key, draft);
    preview = renderEmailCopyPreview(sampleId, overrides);
  } catch (err) {
    console.error('[email-copy] 測試信組信失敗', { request_id: requestId, name: (err as { name?: unknown })?.name });
    return { ok: false, reason: 'error' };
  }
  if (preview === null) return { ok: false, reason: 'error' };

  // accepted = Resend 收下了;failed = 明確的 4xx(確定沒寄);unknown = 5xx / 逾時 / 斷線(可能已寄出)。
  let outcome: 'accepted' | 'failed' | 'unknown';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to,
        subject: `${TEST_SUBJECT_PREFIX}${preview.subject}`,
        text: `${TEST_TEXT_BANNER}\n\n${preview.text}`,
        html: markHtmlAsTest(preview.html),
      }),
    });
    outcome = res.ok ? 'accepted' : res.status >= 400 && res.status < 500 ? 'failed' : 'unknown';
    if (!res.ok) console.error('[email-copy] 測試信 Resend 回錯', { request_id: requestId, status: res.status });
  } catch (err) {
    console.error('[email-copy] 測試信送出失敗', { request_id: requestId, name: (err as { name?: unknown })?.name });
    outcome = 'unknown';
  }

  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'email_copy.test_send',
        target: `email_copy:${key}`,
        // sample 記範例名稱(給員工看), 不記內部代號。
        after: { to, sample: EMAIL_PREVIEW_SAMPLES.find((x) => x.id === sampleId)?.label ?? sampleId, text: draft, uses_default: draft === null, outcome },
      },
      { actor: auth.actorId, requestId, sourceApp: 'admin' },
    );
  } catch {
    console.error('[email-copy] 測試信操作紀錄寫入失敗', { request_id: requestId });
  }

  if (outcome === 'accepted') return { ok: true };
  return { ok: false, reason: outcome === 'failed' ? 'error' : 'unknown' };
}
