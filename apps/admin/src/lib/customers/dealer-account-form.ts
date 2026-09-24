// 後台「新增經銷帳號」的表單解析與畫面狀態(B2B 計畫 §9.9 片 D4a)。純函式, action 與表單元件共用。
// 公司資料的規則與前台申請表同一份(@pcm/domain validateDealerApply), 資料庫 CHECK 是最後一道。
import {
  EMPTY_DEALER_APPLY,
  validateDealerApply,
  type DealerApplyField,
  type DealerApplyFieldErrors,
  type DealerApplyValues,
} from '@pcm/domain';

export const DEALER_ACCOUNT_FIELDS = Object.keys(EMPTY_DEALER_APPLY) as DealerApplyField[];

/**
 * resume = 不寄邀請, 用這個 Email 已經存在的帳號完成經銷設定(第 3 步)。
 * 帳號由 server 用 Email 查, 不收表單傳來的 user ID(Codex R1 nit:管理者不能指定任意帳號)。
 */
export type DealerAccountForm = { email: string; values: DealerApplyValues; resume: boolean };

/** 畫面狀態。除了 done / denied, 其餘都把員工填的資料帶回去, 不用重打。 */
export type DealerAccountState =
  | { kind: 'idle' }
  | { kind: 'denied' }
  | { kind: 'invalid'; form: DealerAccountForm; fieldErrors: DealerApplyFieldErrors & { email?: string } }
  | {
      kind: 'email_exists' | 'invite_failed' | 'invite_unknown' | 'setup_unknown' | 'no_account' | 'lookup_failed' | 'ambiguous' | 'mismatch';
      form: DealerAccountForm;
    }
  | { kind: 'would_downgrade'; form: DealerAccountForm }
  | { kind: 'done'; userId: string; email: string; invited: boolean; already: boolean };

/**
 * 這幾種狀態下, 按鈕變成「用這個帳號完成經銷設定」(resume)。
 * 其他狀態沿用上一次送出的模式(form.resume):🔴 補做途中查詢失敗或欄位要修, 下一次仍是補做, 不會改走寄邀請(Codex D4a R2)。
 */
export const RESUME_KINDS = ['email_exists', 'invite_unknown', 'setup_unknown'] as const;

export type ParsedDealerAccount =
  | { ok: true; email: string; values: DealerApplyValues; resume: boolean }
  | { ok: false; form: DealerAccountForm; fieldErrors: DealerApplyFieldErrors & { email?: string } };

export function parseDealerAccountForm(fd: FormData): ParsedDealerAccount {
  const email = String(fd.get('email') ?? '').trim();
  const raw = Object.fromEntries(DEALER_ACCOUNT_FIELDS.map((k) => [k, String(fd.get(k) ?? '')])) as DealerApplyValues;
  const v = validateDealerApply(raw);
  const fieldErrors: DealerApplyFieldErrors & { email?: string } = v.ok ? {} : { ...v.fieldErrors };
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = '登入 Email 格式不正確，請再確認一次。';
  const resume = fd.get('resume') === '1';
  const form = { email, values: v.values, resume };
  // 🔴 員工不能替客人設密碼:有人把密碼欄加回表單, 整張拒收(計畫 §9.9 測試①)
  if ([...fd.keys()].some((k) => /pass/i.test(k))) return { ok: false, form, fieldErrors };
  if (Object.keys(fieldErrors).length > 0) return { ok: false, form, fieldErrors };
  return { ok: true, email, values: v.values, resume };
}

/** 各狀態給員工看的一句話(狀態說事實, 下一步說清楚;結果不明不說失敗)。 */
export function dealerAccountMessage(s: DealerAccountState): { tone: 'ok' | 'warn' | 'error'; text: string } | null {
  switch (s.kind) {
    case 'idle':
      return null;
    case 'denied':
      return { tone: 'error', text: '只有管理者可以新增經銷帳號。請用管理者帳號登入後再操作。' };
    case 'invalid':
      return { tone: 'error', text: '有欄位需要修正，請檢查標示的欄位後再送出。' };
    case 'email_exists':
      return {
        tone: 'warn',
        text: '這個 Email 已經有帳號，沒有建立新帳號，也沒有寄信。確認是同一位客人後，按「用這個帳號完成經銷設定」，會記下公司資料並把等級改成車行。',
      };
    case 'invite_failed':
      return { tone: 'error', text: '帳號沒有建立，邀請信也沒有寄出。請稍後再試一次；若仍失敗，請聯絡系統管理員。' };
    case 'invite_unknown':
      return {
        tone: 'warn',
        text: '無法確認帳號是否已經建立、邀請信是否寄出。請按「用這個帳號完成經銷設定」：帳號已建立就會接著完成設定；查不到帳號，再重新送出。',
      };
    case 'setup_unknown':
      return { tone: 'warn', text: '無法確認經銷資格是否設定完成。請按「用這個帳號完成經銷設定」再試一次，不會重複設定。' };
    case 'no_account':
      return {
        tone: 'warn',
        text: '客戶資料裡查不到這個 Email 的帳號，沒有做任何變更。若剛才顯示結果不明，請稍等一分鐘再查一次；仍查不到，再按「建立經銷帳號並寄邀請信」。',
      };
    case 'lookup_failed':
      return { tone: 'error', text: '帳號資料讀取失敗，沒有做任何變更。請稍後再試一次。' };
    case 'ambiguous':
      return { tone: 'error', text: '這個 Email 對到不只一個帳號，沒有做任何變更。請聯絡系統管理員確認是哪一個帳號。' };
    case 'mismatch':
      return {
        tone: 'error',
        text: '這個帳號的登入 Email 與客戶資料不一致，沒有做任何變更。請先到客戶明細核對 Email，再聯絡系統管理員。',
      };
    case 'would_downgrade':
      return { tone: 'warn', text: '這個帳號目前是「經銷」，設定成車行會降低等級，所以沒有變更。' };
    case 'done':
      if (s.already) return { tone: 'ok', text: '這個帳號之前已經設定成車行，這次沒有重複設定。' };
      return {
        tone: 'ok',
        text: s.invited
          ? `已建立經銷帳號，等級為車行，邀請信已寄到 ${s.email}。客人點信裡的連結即可設定密碼。`
          : '已把這個帳號設定成車行，並記下公司資料。這次沒有寄信。',
      };
  }
}
