import 'server-only';
import { isSyntheticEmailDomain } from '@pcm/schemas';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { formatTaipeiShort } from '../orders/payment-list-view';

// auth-mail-lookup.ts —— 後台客戶頁「查最近寄信紀錄」(2026-10-02, Sean Q1 甲 / Q2 甲)。
// 計畫 ~/pcm-mailbox/計畫-查得到驗證信有沒有寄出去-20261002.md(Fable R1/R2/R4、Codex R3/R5 審過)。
//
// 驗證信、重設密碼信是 Supabase 透過 Resend SMTP 寄的, 我們沒有紀錄 ⇒ 員工按一下, 伺服器當場問 Resend「最近寄了哪些信、狀態如何」。
// · 不寫資料庫、不加排程、不動 Supabase 寄信。
// · 金鑰 RESEND_AUDIT_API_KEY 是 Sean 另開的【完整權限】金鑰(Resend 沒有只讀金鑰)⇒ 只在伺服器用, 只叫「列表」,
//   畫面只拿到 時間 / 主旨 / 狀態;不回收件人、不回信件編號(信件編號配這把金鑰可以取回全文)。
// · log 只記筆數與耗時, 不記列表內容(裡面有其他客人的信箱)。

const RESEND_LIST_URL = 'https://api.resend.com/emails';
/** Supabase 寄會員信用的寄件位址(計畫-資安修正-註冊登入-20260926.md:31)。訂單信是 orders@、告警是 alerts@。 */
export const AUTH_MAIL_FROM = 'no-reply@pcmmotorsports.com';
export const AUTH_MAIL_MAX_PAGES = 3;
export const AUTH_MAIL_PAGE_SIZE = 100;
export const AUTH_MAIL_TIMEOUT_MS = 5_000;
export const AUTH_MAIL_THROTTLE_MS = 10_000;

/** Resend 列表裡我們用到的欄位。 */
export type ResendListedEmail = {
  id: string;
  to: readonly string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string | null;
};
export type ResendListPage = { data: readonly ResendListedEmail[]; has_more: boolean };

export type AuthMailRow = { sentAt: string; subject: string; status: string };

export type AuthMailLookupResult =
  | { kind: 'found'; rows: AuthMailRow[]; checkedSince: string | null; allChecked: boolean }
  | { kind: 'none'; checkedSince: string | null; allChecked: boolean }
  | { kind: 'empty_account' }
  | { kind: 'not_applicable' }
  | { kind: 'not_configured' }
  /** 金鑰被 Resend 拒絕(401 / 403):多半是開成「只能寄信」或已被刪掉。重按不會好, 要找人改設定。 */
  | { kind: 'key_rejected' }
  | { kind: 'busy' }
  | { kind: 'error' };

/** Resend `last_event` ⇒ 員工看得懂的字。對不上的照原值顯示, 不硬塞成「寄送失敗」(Fable R2 nit 2)。 */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  delivered: '已送達',
  sent: '已寄出，還沒確認送達',
  queued: '排隊中',
  scheduled: '已排定',
  delivery_delayed: '延遲中',
  bounced: '被退回',
  complained: '被標成垃圾信',
  failed: '寄送失敗',
  suppressed: '被 Resend 擋下（這個信箱之前退信或檢舉過）',
  opened: '已開啟',
  clicked: '已點信裡的連結',
  canceled: '已取消',
};
export function authMailStatusLabel(lastEvent: string | null): string {
  if (lastEvent === null || lastEvent === '') return '狀態不明';
  return STATUS_LABEL[lastEvent] ?? lastEvent;
}

/** 「PCM 重機零件販售 <no-reply@pcmmotorsports.com>」⇒「no-reply@pcmmotorsports.com」(小寫)。 */
export function emailAddressOf(raw: string): string {
  const m = /<([^<>]+)>/.exec(raw);
  return (m?.[1] ?? raw).trim().toLowerCase();
}

/**
 * 純函式:把讀到的幾頁 Resend 列表, 篩出寄給這位會員(目前登入信箱或申請中的新信箱)的會員信。
 * `checkedSince` = 實際讀到的最舊一封的時間(R2 必修:不寫固定天數, 印實際查到的範圍)。
 */
export function summarizeAuthMail(
  pages: readonly ResendListPage[],
  recipients: readonly string[],
): Extract<AuthMailLookupResult, { kind: 'found' | 'none' | 'empty_account' }> {
  const all = pages.flatMap((p) => p.data);
  // 訂單信每天都在寄 ⇒ 整個列表是空的, 多半是金鑰開在別的 Resend 帳號。
  if (all.length === 0) return { kind: 'empty_account' };
  const wanted = new Set(recipients.map((r) => r.trim().toLowerCase()).filter((r) => r !== ''));
  const oldest = all.reduce<string | null>(
    (acc, e) => (acc === null || Date.parse(e.created_at) < Date.parse(acc) ? e.created_at : acc),
    null,
  );
  const checkedSince = oldest === null ? null : formatTaipeiShort(oldest);
  const allChecked = pages.length > 0 && pages[pages.length - 1]?.has_more === false;
  const rows = all
    .filter((e) => emailAddressOf(e.from) === AUTH_MAIL_FROM)
    .filter((e) => e.to.some((t) => wanted.has(emailAddressOf(t))))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((e) => ({
      sentAt: formatTaipeiShort(e.created_at) ?? e.created_at,
      subject: e.subject,
      status: authMailStatusLabel(e.last_event),
    }));
  return rows.length > 0 ? { kind: 'found', rows, checkedSince, allChecked } : { kind: 'none', checkedSince, allChecked };
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function isListPage(v: unknown): v is ResendListPage {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { data?: unknown; has_more?: unknown };
  return Array.isArray(o.data) && typeof o.has_more === 'boolean';
}

/**
 * 依序讀最多 3 頁(新到舊)。任一頁失敗 ⇒ 整次回 null(R3 consider:中途失敗不能把前面那頁當完整答案)。
 */
export async function listRecentResendEmails(
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<ResendListPage[] | 'key_rejected' | null> {
  const pages: ResendListPage[] = [];
  let after: string | null = null;
  for (let i = 0; i < AUTH_MAIL_MAX_PAGES; i++) {
    const url = `${RESEND_LIST_URL}?limit=${AUTH_MAIL_PAGE_SIZE}${after === null ? '' : `&after=${encodeURIComponent(after)}`}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AUTH_MAIL_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal });
      if (!res.ok) {
        console.error('[auth-mail-lookup] Resend 回錯', { status: res.status, page: i + 1 });
        return res.status === 401 || res.status === 403 ? 'key_rejected' : null;
      }
      const body = await res.json();
      if (!isListPage(body)) {
        console.error('[auth-mail-lookup] Resend 回應形狀不對', { page: i + 1 });
        return null;
      }
      pages.push(body);
      const last = body.data[body.data.length - 1];
      if (!body.has_more || last === undefined) break;
      after = last.id;
    } catch (err) {
      console.error('[auth-mail-lookup] 呼叫 Resend 失敗', { page: i + 1, name: (err as { name?: unknown })?.name });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return pages;
}

/**
 * 伺服器自己查這位會員的登入信箱與申請中的新信箱(不接受畫面傳來的信箱)。
 * 讀不到 ⇒ null(畫面顯示「暫時查不到」, 不當成沒有紀錄)。
 */
export async function readAuthMailRecipients(
  customerId: string,
): Promise<{ kind: 'ok'; recipients: string[] } | { kind: 'not_applicable' } | null> {
  try {
    const { data, error } = await createSupabaseServiceClient().auth.admin.getUserById(customerId);
    if (error || !data.user) return null;
    const user = data.user as { email?: string | null; new_email?: string | null; app_metadata?: { providers?: unknown } };
    const email = user.email ?? '';
    const providers = user.app_metadata?.providers;
    const emailOnly = Array.isArray(providers) && providers.length > 0 && providers.every((p) => p === 'email');
    // 與重設密碼、改信箱同一個判準:LINE、後台手動建、Google 這些帳號不收驗證信。
    if (email === '' || isSyntheticEmailDomain(email) || !emailOnly) return { kind: 'not_applicable' };
    const recipients = [email, user.new_email ?? ''].filter((x) => x !== '');
    return { kind: 'ok', recipients };
  } catch (err) {
    console.error('[auth-mail-lookup] 讀取會員失敗', { status: (err as { status?: unknown })?.status });
    return null;
  }
}

// ponytail: 節流只在同一個伺服器實例內有效(Vercel 可能同時有多個實例), 是上限的大概值不是保證;
//   真正的防線是每次最多 3 次呼叫、Resend 回錯就停(計畫 R4 必修)。
let lastLookupAt = Number.NEGATIVE_INFINITY;
export function takeLookupSlot(now: number): boolean {
  if (now - lastLookupAt < AUTH_MAIL_THROTTLE_MS) return false;
  lastLookupAt = now;
  return true;
}
/** 測試用:把節流歸零。 */
export function resetLookupSlotForTest(): void {
  lastLookupAt = Number.NEGATIVE_INFINITY;
}

export async function lookupAuthMail(
  customerId: string,
  deps: { apiKey: string | undefined; fetchImpl: FetchLike; now: number },
): Promise<AuthMailLookupResult> {
  if (deps.apiKey === undefined || deps.apiKey.trim() === '') return { kind: 'not_configured' };
  const who = await readAuthMailRecipients(customerId);
  if (who === null) return { kind: 'error' };
  if (who.kind === 'not_applicable') return { kind: 'not_applicable' };
  if (!takeLookupSlot(deps.now)) return { kind: 'busy' };
  const started = Date.now();
  const pages = await listRecentResendEmails(deps.apiKey, deps.fetchImpl);
  if (pages === null) return { kind: 'error' };
  if (pages === 'key_rejected') return { kind: 'key_rejected' };
  const total = pages.reduce((n, p) => n + p.data.length, 0);
  console.info('[auth-mail-lookup] 查詢完成', { pages: pages.length, emails: total, ms: Date.now() - started });
  return summarizeAuthMail(pages, who.recipients);
}
