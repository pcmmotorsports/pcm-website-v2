// wallet-form.ts — 儲值金調整 server action 的純函式核心(M-4a 儲值金編輯片;可單測、無 'use server'/next 依賴)。
// authz(session/Origin/actor)在 action 檔;本檔只做「表單 → RPC 參數」形狀層
// (語意 fail-closed 權威在 admin_adjust_wallet RPC〔20260716210000〕,此處輕驗 + 縱深)。
//
// Sean 拍板(07-16、Q1=B):UI=「加值」「扣款」兩顆 submit(name=direction)+ 金額(正整數、元位)
// + 備註必填;server 端負責 use → 轉負號(RPC 的 wallet_amount_sign 語意=deposit>0/use<0)。

import type { FormLike } from '../orders/workflow-form';

// ── 表單欄名(明細頁儲值金卡表單用)──
export const WALLET_CUSTOMER_ID_FIELD = 'customer_id';
export const WALLET_DIRECTION_FIELD = 'direction';
export const WALLET_AMOUNT_FIELD = 'amount';
export const WALLET_NOTE_FIELD = 'note';
export const WALLET_RETURN_TO_FIELD = 'return_to';

/** 單筆金額上限(元;與 RPC 1c sanity 上界一致=抓多零手滑;D2 值班台建議維持、Sean 可改)。 */
export const WALLET_AMOUNT_MAX = 10_000_000;
/** 備註長度上限(與 RPC 1d 一致)。 */
export const WALLET_NOTE_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WalletAdjustDirection = 'deposit' | 'use';

export type WalletAdjustParseResult =
  | {
      ok: true;
      customerId: string;
      entryType: WalletAdjustDirection;
      /** 已轉號金額:deposit=+n / use=-n(RPC 端 CHECK 語意;UI 恆收正整數)。 */
      signedAmount: number;
      note: string;
      returnTo: string;
    }
  | { ok: false };

function asString(v: FormDataEntryValue | null): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * 表單 → { customerId, entryType, signedAmount, note }(形狀層;語意 fail-closed 在 RPC):
 * - customer_id 須 UUID,否則 ok:false;
 * - direction 須 'deposit' | 'use'(refund 無 UI 路徑;手工 POST 其他值=ok:false);
 * - amount 須 1..10,000,000 的十進位正整數(拒空/小數/負號/千分位/前導加號);use → server 轉負號;
 * - note 須 trim 後非空且 ≤200 字(必填=Sean Q1;RPC 端另拒控制字元);
 * - return_to:只接受站內絕對路徑 `/customers...`(防 open redirect、拒 `..`);非法 → 退 '/customers'。
 */
export function parseWalletAdjustForm(form: FormLike): WalletAdjustParseResult {
  const customerId = asString(form.get(WALLET_CUSTOMER_ID_FIELD));
  if (!customerId || !UUID_RE.test(customerId)) return { ok: false };

  const direction = asString(form.get(WALLET_DIRECTION_FIELD));
  if (direction !== 'deposit' && direction !== 'use') return { ok: false };

  const amountRaw = (asString(form.get(WALLET_AMOUNT_FIELD)) ?? '').trim();
  if (!/^\d{1,8}$/.test(amountRaw)) return { ok: false };
  const amount = Number(amountRaw);
  if (!Number.isInteger(amount) || amount < 1 || amount > WALLET_AMOUNT_MAX) {
    return { ok: false };
  }

  const note = (asString(form.get(WALLET_NOTE_FIELD)) ?? '').trim();
  if (note === '' || note.length > WALLET_NOTE_MAX) return { ok: false };
  // 零寬字防(codex F2 縱深):JS trim() 已吃 NBSP/全形空白,但零寬(U+200B/200C/200D/FEFF)不算
  // whitespace → 「看似空白」備註在此擋;語意權威=RPC v_ws 集(migration 20260716210000)。
  if (note.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim() === '') return { ok: false };

  return {
    ok: true,
    customerId,
    entryType: direction,
    signedAmount: direction === 'use' ? -amount : amount,
    note,
    returnTo: parseCustomersReturnTo(form.get(WALLET_RETURN_TO_FIELD)),
  };
}

/**
 * return_to:站內 /customers 路徑(鏡像 orders 線 parseReturnTo;拒 `..`);非法 → 退 '/customers'。
 * export 供客戶域各表單共用(儲值金/tier 編輯同一守門;tier-form.ts 亦用)。
 */
export function parseCustomersReturnTo(raw: FormDataEntryValue | null): string {
  const v = typeof raw === 'string' ? raw : null;
  return v && !v.includes('..') && /^\/customers(\/[^\s]*)?(\?[^\s]*)?$/.test(v)
    ? v
    : '/customers';
}
