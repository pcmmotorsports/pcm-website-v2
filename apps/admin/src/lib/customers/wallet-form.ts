// wallet-form.ts — 儲值金調整 server action 的純函式核心(M-4a 儲值金編輯片;可單測、無 'use server'/next 依賴)。
// authz(session/Origin/actor)在 action 檔;本檔只做「表單 → RPC 參數」形狀層
// (語意 fail-closed 權威在 admin_adjust_wallet RPC〔20260716210000〕,此處輕驗 + 縱深)。
//
// Sean 拍板(07-16、Q1=B):UI=「加值」「扣款」兩顆 submit(name=direction)+ 金額(正整數、元位)
// + 備註必填;server 端負責 use → 轉負號(RPC 的 wallet_amount_sign 語意=deposit>0/use<0)。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import type { FormLike } from '../orders/workflow-form';

// ── 表單欄名(明細頁儲值金卡表單用)──
export const WALLET_CUSTOMER_ID_FIELD = 'customer_id';
export const WALLET_DIRECTION_FIELD = 'direction';
export const WALLET_AMOUNT_FIELD = 'amount';
export const WALLET_NOTE_FIELD = 'note';
export const WALLET_RETURN_TO_FIELD = 'return_to';
/**
 * 🔴 冪等鍵欄位(⟦b4-WALLETDEDUPE⟧;2026-09-06)。
 * **形狀照 repo 既有先例, 不自己發明**:`apps/admin/src/proxy.ts:28-34` 逐字記著
 * `order_note.append` 的冪等鍵**就是 `p_request_id`**, 吃的是表單帶回的一次性 token,
 * token 由 **server 在渲染表單時**產(不是瀏覽器自造)。設計與拍板:
 * `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §4 / §9 `Q2=C`(Sean 2026-08-02);
 * 本片沿用同一個拍板(主視窗 `-f1` 2026-09-06 `Q-wallet4=甲`)。
 *
 * 🛑 **為什麼不能用 `getRequestId()`**(這是本片存在的理由):
 * 它讀的是 middleware 每個 **HTTP request** 戳的 `x-request-id`(`proxy.ts:36` 一律新產)
 * ⇒ **back-resubmit / 網路重送 = 新請求 = 新 id ⇒ 唯一索引不會撞 ⇒ 照樣扣兩次。**
 * ⇒ 📌 backlog `#279` 的舊解法(拿 `request_id` 當去重鍵)**會看起來做完了而病還在**。
 */
export const WALLET_REQUEST_TOKEN_FIELD = 'request_token';

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
      /** 表單帶回的一次性冪等 token(uuid 形狀已驗;直接當 RPC 的 `p_request_id`)。 */
      requestToken: string;
    }
  | { ok: false };

// #365:本地 asString 已刪,單值欄位改走共用的「getAll 恰一筆」讀法。

/**
 * 表單 → { customerId, entryType, signedAmount, note }(形狀層;語意 fail-closed 在 RPC):
 * - customer_id 須 UUID,否則 ok:false;
 * - direction 須 'deposit' | 'use'(refund 無 UI 路徑;手工 POST 其他值=ok:false);
 * - amount 須 1..10,000,000 的十進位正整數(拒空/小數/負號/千分位/前導加號);use → server 轉負號;
 * - note 須 trim 後非空且 ≤200 字(必填=Sean Q1;RPC 端另拒控制字元);
 * - return_to:只接受站內絕對路徑 `/customers...`(防 open redirect、拒 `..`);非法 → 退 '/customers'。
 */
/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄的「送兩份」洞照舊且無症狀 ⇒ 測試逐欄跑一遍當完整性守門。
 */
export const WALLET_SINGLE_FIELDS = [
  WALLET_CUSTOMER_ID_FIELD,
  WALLET_DIRECTION_FIELD,
  WALLET_AMOUNT_FIELD,
  WALLET_NOTE_FIELD,
  WALLET_RETURN_TO_FIELD,
  WALLET_REQUEST_TOKEN_FIELD,
] as const;

export function parseWalletAdjustForm(form: FormLike): WalletAdjustParseResult {
  // 🔴 重複欄位在語意層之前擋掉(理由見 `anyMalformed` docstring)。
  if (anyMalformed(form, WALLET_SINGLE_FIELDS)) return { ok: false };
  const customerId = readString(form, WALLET_CUSTOMER_ID_FIELD);
  if (!customerId || !UUID_RE.test(customerId)) return { ok: false };

  const direction = readString(form, WALLET_DIRECTION_FIELD);
  if (direction !== 'deposit' && direction !== 'use') return { ok: false };

  const amountRaw = (readString(form, WALLET_AMOUNT_FIELD) ?? '').trim();
  if (!/^\d{1,8}$/.test(amountRaw)) return { ok: false };
  const amount = Number(amountRaw);
  if (!Number.isInteger(amount) || amount < 1 || amount > WALLET_AMOUNT_MAX) {
    return { ok: false };
  }

  const note = (readString(form, WALLET_NOTE_FIELD) ?? '').trim();
  if (note === '' || note.length > WALLET_NOTE_MAX) return { ok: false };
  // 零寬字防(codex F2 縱深):JS trim() 已吃 NBSP/全形空白/U+FEFF,但零寬(U+200B/200C/200D)不算
  // whitespace → 「看似空白」備註在此擋;語意權威=RPC v_ws 集(migration 20260716210000)。
  // 🔴 原註解把 U+FEFF 一起列進「trim() 不吃」是**錯的**(node v22.22.3 實測:`'﻿'.trim() === ''`
  //    為 true;200B/200C/200D 為 false)。**本行 code 的行為不受影響** —— 它顯式先 replace 再 trim,
  //    從不依賴那個判斷。2026-08-02 Sean 拍板 Q2=A 順手更正;同一個錯字面在 supplier 線
  //    (`supplier-form.test.ts:56`、S3b plan `:137`)已各自更正過。
  if (note.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim() === '') return { ok: false };

  // 🔴 冪等 token:**強制存在且為 uuid 形狀**。缺 / 形狀不對 ⇒ ok:false。
  // 🛑 **不得 fallback 到 `getRequestId()`** —— fallback = 靜默退回「沒有冪等」,
  //    而那正是本片要修的那個病(A6 §4 逐字:「fallback 等於靜默退回沒有冪等」)。
  //    ⇒ fail-closed:寧可讓表單送不出去, 不要讓它送出去而沒有去重。
  const requestToken = readString(form, WALLET_REQUEST_TOKEN_FIELD);
  if (!requestToken || !UUID_RE.test(requestToken)) return { ok: false };

  return {
    ok: true,
    customerId,
    entryType: direction,
    signedAmount: direction === 'use' ? -amount : amount,
    note,
    returnTo: parseCustomersReturnTo(readString(form, WALLET_RETURN_TO_FIELD)),
    requestToken,
  };
}

/* 🔴 ⛔ ~~這裡原本有一支 `parseWalletRetryParams`~~ —— **已刪, 而理由要留著**:
 * 第一版的失敗路徑是 `redirect` + query string(`?r=error&t=…&a=…&n=<備註>`),
 * 這支就是用來把那三個值讀回來的。
 * 🛑 而那**逐字違反** A6 `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §9 `Q1=A` 的 H13:
 *   「失敗 state 必須帶回員工輸入的 body … 且**不得**把 body 塞進 URL」。
 * ⇒ ✅ 改成失敗回傳 state(`wallet-action-state.ts`), URL 那條路整條拆掉。
 */

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
