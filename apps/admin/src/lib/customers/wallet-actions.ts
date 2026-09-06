'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):#606 前的歷史遺留,見 session/actor.ts 註解(#612 更新:#606 起可用 @/,既有不回改)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { adjustCustomerWallet } from './customer-repository';
import { parseWalletAdjustForm } from './wallet-form';
import {
  WALLET_DUPLICATE_RESULT_CODE,
  walletFailure,
  type WalletAdjustActionState,
} from './wallet-action-state';

// M-4a 儲值金編輯 server action(🔴 高風險動錢;plan 關卡1 PASS 後實作、鏡像 order-actions 全套紀律)。
//
// 🔴 安全縱深(同 orders 線):
//   ① authorizeAdminMutation(session 自驗/Origin fail-closed/具名 actor;../session/authorize 共用閘);
//   ② 形狀層 parseWalletAdjustForm(UUID/direction 白名單/正整數/備註必填;語意權威在 RPC);
//   ③ 寫入走 admin_adjust_wallet owner RPC(ledger INSERT+audit 同交易、餘額只走 trigger、
//      EXECUTE 僅 service_role;稽核在 RPC、action 不另接);
//   ④ PRG:結果碼 → revalidate + redirect 帶固定 query(?r=saved/not_found/invalid/denied/error);
//      DB error 不外洩瀏覽器、server log 只留摘要(金額/備註不進 log=orders 線 Fable nit-2/7 紀律)。

/**
 * 🔴 **成功碼才走 redirect(PRG);失敗一律【回傳 state】。**
 * 形狀照 A6 `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §9 `Q1=A`
 * (Sean 2026-08-02 拍板;本片沿用 —— 主視窗 `-f1` 2026-09-06 `Q-wallet4=甲`)。
 *
 * ⛔ ~~第一版:失敗也 redirect, 並把 `t/a/n`(含**備註**)塞進 query string~~
 *    **那逐字違反 A6 §9 的 H13**:「失敗 state 必須帶回員工輸入的 body … 且**不得**把 body 塞進 URL」。
 *    codex 審 diff 當場抓到, 並且點出兩個我沒想到的後果:
 *    ① **扣款方向遺失**(query 只帶金額與備註)⇒ 員工重試時方向可能變成加值
 *    ② **同鍵不同內容被收斂成 `error`** ⇒ 畫面唸「請稍後再試」⇒ 他會**一直按**, 而那條路永不成功
 */
type SuccessCode = 'saved' | typeof WALLET_DUPLICATE_RESULT_CODE;

/** 成功碼 → returnTo?r=<code>(PRG;returnTo 已由 parse 限定站內 /customers 路徑)。 */
function redirectWith(returnTo: string, code: SuccessCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

/**
 * 🔴 RPC 的「同一個 request_id 帶著不同內容」帶專屬 SQLSTATE **`P9W01`**
 * (`20260906800000` 那支 migration 裡的 `USING ERRCODE`)。
 * 🛑 **不要比對訊息字串** —— 訊息會被改、會被翻譯, 而 SQLSTATE 不會。
 */
const WALLET_MISMATCH_SQLSTATE = 'P9W01';

export async function adjustWalletAction(
  _prev: WalletAdjustActionState,
  formData: FormData,
): Promise<WalletAdjustActionState> {
  // 🔵 `denied` / `invalid` 這兩條路上**還沒有可信的 token 與輸入**(表單可能根本沒帶或是偽造的)
  //    ⇒ 它們帶回空值。這不是疏漏:沒有可信的 token 時, 回填一個假的比不回填危險。
  const empty = { requestToken: '', direction: 'deposit' as const, amount: '', note: '' };

  // ① 授權閘(session/Origin/actor)。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    return walletFailure('denied', empty);
  }

  // ② 表單 → RPC 參數(形狀層;deposit=+n / use=-n 轉號在此)。
  const parsed = parseWalletAdjustForm(formData);
  if (!parsed.ok) {
    return walletFailure('invalid', empty);
  }

  /** 🔴 失敗時要原樣帶回的那一組(**含 direction** —— 少了它員工重試會變成另一個方向)。 */
  const keep = {
    requestToken: parsed.requestToken,
    direction: parsed.entryType,
    amount: String(Math.abs(parsed.signedAmount)),
    note: parsed.note,
  };

  // 🔴 **兩個 id, 不是一個**(⟦b4-WALLETDEDUPE⟧):
  //   · `httpRequestId` = middleware 每個 HTTP request 戳的 correlation id ⇒ **每次都不同**
  //   · `parsed.requestToken` = 表單帶回的一次性冪等 token ⇒ **重送時相同**, 這一個才進 RPC
  // 🛑 **兩個都要進 attempt log, 而且這是驗收格**(A6 §4 F2 逐字要求):
  //    冪等鍵一旦改吃表單值, 稽核列的 `request_id` 就**不再等於** HTTP `x-request-id`
  //    ⇒ 兩者要對得回來, 而**只寫在 prose 裡的話, 刪掉這行 log 不會有任何測試轉紅**。
  const httpRequestId = await getRequestId();

  // attempt log:僅識別欄位、不記金額/備註(動錢欄位不進 server log;稽核真相在 admin_audit_log)。
  console.info('[admin/customers] customer.wallet.adjust.attempt', {
    http_request_id: httpRequestId,
    idempotency_token: parsed.requestToken,
    sid: auth.sid,
    actor: auth.actorId,
    customer_id: parsed.customerId,
  });

  let code: SuccessCode;
  try {
    const result = await adjustCustomerWallet({
      customerId: parsed.customerId,
      entryType: parsed.entryType,
      signedAmount: parsed.signedAmount,
      note: parsed.note,
      actor: auth.actorId,
      // 🔴 這裡送的是**表單 token**, 不是 HTTP id —— 送錯就等於沒有去重(見 wallet-form.ts 該常數註解)。
      requestId: parsed.requestToken,
    });
    if (result === 'NOT_FOUND') {
      return walletFailure('not_found', keep);
    }
    code = result === 'DUPLICATE' ? WALLET_DUPLICATE_RESULT_CODE : 'saved';
  } catch (err) {
    // DB error / RPC 輸入 RAISE(反號/超上界/備註非法等)→ 固定碼、不外洩;server log 只留摘要
    // (不印整個 err 物件:訊息可能回顯輸入值;同 orders 線紀律)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/customers] 儲值金調整失敗', {
      http_request_id: httpRequestId,
      idempotency_token: parsed.requestToken,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    // 🔴🔴 **這兩條路要讓員工做【相反】的事, 所以絕不能收斂成同一個碼**:
    //   · `mismatch`(SQLSTATE P9W01)= 同一把 token 帶著不同內容 ⇒ **停下來, 重新整理**
    //     (系統一筆錢都沒動, 而他這次想做的事也沒有執行)
    //   · `error`   = RPC 可能已 commit、只是回應斷在路上 ⇒ **放心再按一次**
    //     (同一把 token 會被認出來, 不會重複扣款)
    // 🛑 第一版把兩者都收斂成 `error` ⇒ 畫面唸「請稍後再試」⇒ 撞到 mismatch 的員工會**一直按**,
    //    而那條路**永遠不會成功**。(codex 審 diff 抓到。)
    return walletFailure(
      typeof e.code === 'string' && e.code === WALLET_MISMATCH_SQLSTATE ? 'mismatch' : 'error',
      keep,
    );
  }

  // 成功路徑 revalidate(明細=餘額+流水;列表快取一併刷);redirect 在 catch 外(不被吞)。
  revalidatePath('/customers');
  revalidatePath(`/customers/${parsed.customerId}`);
  redirectWith(parsed.returnTo, code);
}
