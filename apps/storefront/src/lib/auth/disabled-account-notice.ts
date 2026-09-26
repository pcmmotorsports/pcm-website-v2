// lib/auth/disabled-account-notice.ts —— 停用帳號按「忘記密碼」:不寄重設連結, 改寄停用通知(Sean 2026-09-26 Q30 甲)。
//
// 🔴 不能讓外人看出帳號是否停用:畫面回應要跟一般帳號完全一樣。所以順序是 ——
//   ① 不是停用帳號(或查不到)⇒ 照原本流程交給 Supabase 寄重設信。
//   ② 是停用帳號 ⇒ 網站自己向 Cloudflare 驗人機驗證碼(Q31 甲;一般帳號的驗證碼由 Supabase 驗, 這條路不經過 Supabase)。
//      · 沒帶驗證碼、或驗證碼不對 ⇒ 仍交給 Supabase 走原本流程:驗證碼只能用一次, Supabase 一定也判失敗,
//        畫面回應就跟一般帳號帶錯驗證碼時一模一樣, 而且不會寄出任何信。
//      · 驗證通過 ⇒ 寄停用通知(Q32 甲:現有 Resend 寄信器, 不進 email_outbox;防重複鍵 = 會員 id + 小時 ⇒ 每小時最多一封)。
//      · 還沒設 TURNSTILE_SECRET_KEY、或 Cloudflare 連不上 ⇒ 不寄信, 回一般畫面(Q31 甲)。
// 本檔只做判斷與寄送, 查帳號與寄信器由 lib/email/composition.ts 注入(那是 storefront 已核准用 service 金鑰的單檔)。
import 'server-only';
import type { SendEmailInput, SendEmailResult } from '@pcm/ports';
import { renderAccountDisabledEmail } from '@pcm/use-cases';

export type CaptchaCheck = 'ok' | 'invalid' | 'unconfigured' | 'error';

export type DisabledNoticeDeps = {
  /** 這個 Email 是已停用的會員 ⇒ 回會員 id;不是或查無 ⇒ null。查詢出錯就丟例外。 */
  findDisabledUserId: (email: string) => Promise<string | null>;
  isSyntheticEmail: (email: string) => boolean;
  verifyCaptcha: (token: string) => Promise<CaptchaCheck>;
  send: (input: SendEmailInput) => Promise<SendEmailResult>;
  now: () => Date;
};

/**
 * - `use_supabase`:照原本流程交給 Supabase(不是停用帳號、查詢失敗、或驗證碼沒過 —— 後者 Supabase 會判失敗, 不寄信)
 * - `done`:停用帳號這條路處理完了(寄了、重複、或刻意不寄), 回一般畫面
 */
export type DisabledNoticeDecision =
  | { kind: 'use_supabase'; reason: 'not_disabled' | 'lookup_failed' | 'captcha_missing' | 'captcha_invalid' }
  | { kind: 'done'; reason: 'sent' | 'send_failed' | 'synthetic' | 'captcha_unconfigured' | 'captcha_error' };

export async function handleForgotForDisabledAccount(
  deps: DisabledNoticeDeps,
  email: string,
  captchaToken: string | undefined,
): Promise<DisabledNoticeDecision> {
  let userId: string | null;
  try {
    userId = await deps.findDisabledUserId(email);
  } catch {
    return { kind: 'use_supabase', reason: 'lookup_failed' };
  }
  if (userId === null) return { kind: 'use_supabase', reason: 'not_disabled' };

  // 假信箱(LINE 合成信箱)寄不到, 不必花一次驗證
  if (deps.isSyntheticEmail(email)) return { kind: 'done', reason: 'synthetic' };
  if (!captchaToken) return { kind: 'use_supabase', reason: 'captcha_missing' };
  let captcha: CaptchaCheck;
  try {
    captcha = await deps.verifyCaptcha(captchaToken);
  } catch {
    captcha = 'error';
  }
  if (captcha === 'invalid') return { kind: 'use_supabase', reason: 'captcha_invalid' };
  if (captcha === 'unconfigured') return { kind: 'done', reason: 'captcha_unconfigured' };
  if (captcha === 'error') return { kind: 'done', reason: 'captcha_error' };

  const mail = renderAccountDisabledEmail();
  // 防重複鍵以 UTC 小時分桶:同一個 UTC 小時內重按, Resend 回同一封、不再寄(跨整點會各寄一封)
  const hour = deps.now().toISOString().slice(0, 13);
  try {
    const r = await deps.send({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      idempotency: { eventType: 'account_disabled_notice', outboxId: `${userId}:${hour}` },
    });
    return { kind: 'done', reason: r.kind === 'sent' ? 'sent' : 'send_failed' };
  } catch {
    return { kind: 'done', reason: 'send_failed' };
  }
}

/** 網站自己向 Cloudflare 驗 Turnstile 驗證碼(Q31 甲)。沒設金鑰 ⇒ unconfigured;連不上或逾時 ⇒ error。 */
export async function verifyTurnstileToken(token: string): Promise<CaptchaCheck> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return 'unconfigured';
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (body.success === true) return 'ok';
    // 金鑰填錯或請求格式錯:不是客人的驗證碼有問題。當成 invalid 會交回 Supabase(Supabase 的金鑰是對的 ⇒ 停用會員照舊收到重設連結),
    // 功能會靜靜失效 ⇒ 改當 error:不寄、回一般畫面, log 看得到 captcha_error(Fable R1 應修 5)。
    const codes = Array.isArray(body['error-codes']) ? body['error-codes'] : [];
    if (codes.some((c) => c === 'missing-input-secret' || c === 'invalid-input-secret' || c === 'bad-request')) return 'error';
    return 'invalid';
  } catch {
    return 'error';
  }
}
