'use client';

import { useState } from 'react';
import { updateOrderItemAmountAction } from '../../lib/orders/amount-actions';
import {
  AMOUNT_ORDER_ID_FIELD,
  AMOUNT_ORDER_ITEM_ID_FIELD,
  AMOUNT_RETURN_TO_FIELD,
  AMOUNT_UNIT_PRICE_FIELD,
  AMOUNT_VERSION_FIELD,
  AMOUNT_ZERO_PRICE_REASON_FIELD,
} from '../../lib/orders/amount-form';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// item-amount-form.tsx — 單一品項的「改單價」表單(M-4b E10 #13 片1c-2)。
//
// 🔴 **只用既有原件與 token**:`ADMIN_INPUT_CLASS` / `AdminFormField`(`components/shared/admin-form.tsx`)
//    ＋ 既有 utility class。**不自己寫新的視覺** —— B 窗的 token 會蓋上來
//    (它已回覆:`ADMIN_INPUT_CLASS` 這個**字串不改**,但 `--radius` 8px→0、`--input` 會變明顯
//     ⇒ **畫面會變成直角 + 邊框更清楚,那是預期的,不是這片弄壞的**)。
//
// 🔴 **版本用的是【訂單層】的 `version`,不是品項的** —— RPC 的樂觀鎖逐字比
//    `v_ord.version <> p_expected_version`(`20260815040000_…:382`)。
//    ⚠️ 而 `AdminOrderDetailItem` **自 A9w3 起就沒有 `version` 欄了**(該欄的唯一消費端是已下架的九碼下拉)
//    ⇒ 想從品項拿版本會拿不到,那不是漏傳、是拿錯對象。
//
// 🔴 **文案是暫定的,結構鎖、字不鎖**(同 `item-procurement-form.tsx` 檔頭的慣例)。

export type ItemAmountFormProps = {
  orderId: string;
  /** 🔴 訂單層樂觀鎖版本(`AdminOrderDetail.version`),不是品項的 */
  expectedVersion: number;
  orderItemId: string;
  /** 現行成交單價(整數元位)—— 只拿來當輸入框的預設值 */
  currentUnitPrice: number;
  returnTo: string;
  /**
   * 🔴 **不為 null ⇒ 不給編輯,並就地把這句話顯示出來**(R3/fable F2)。
   *
   * 判斷在 `order-detail-items-table.tsx` 的 `resolveAmountEditBlock`(server 端,拿得到收款與折扣)。
   * ⚠️ **advisory 不是保證** —— 權威是 RPC 在交易內重查;這裡擋的是「**最常見的那條必敗路徑**」,
   * 不是安全邊界。
   */
  blockedReason?: string | null;
};

/**
 * 🔴🔴 **原因欄的 `defaultValue` 必須是空的,而且是刻意的。**
 *
 * 母 plan §4「零元防呆分兩層」:RPC 守 API 契約、UI 守員工手滑。
 * 而**預填一個常數**(例:「贈品」)會讓那道防呆退化成「員工按 Enter 就過」——
 * 它擋不住任何事,卻讓畫面看起來有在守。
 * ⇒ `item-amount-form.test.tsx` 有一格**源碼契約測試**釘住這件事。
 *
 * ⚠️ **那道守門的限度(母 plan §6a L3 逐字)**:
 * **擋得住常數,擋不住動態產生的字串** —— 沒有機械方法分辨「員工打的字」與「程式組的字」。
 * **這條就是沒有觸發器,不要讓它看起來有。**
 */
export const ZERO_PRICE_REASON_DEFAULT = '';

export function ItemAmountForm({
  orderId,
  expectedVersion,
  orderItemId,
  currentUnitPrice,
  returnTo,
  blockedReason = null,
}: ItemAmountFormProps) {
  const [price, setPrice] = useState(String(currentUnitPrice));
  const [confirmed, setConfirmed] = useState(false);
  /**
   * 🔴 送出中鎖(R3/fable F7)。
   *
   * 沒有它:雙擊 ⇒ 送出兩發,**而第二發帶的是同一個 `version`**
   * ⇒ 第一發成功後 version 已 +1 ⇒ 第二發被 RPC 判 `CONFLICT` ⇒ 員工看到「被改過了」。
   * ⚠️ **錢不會被改兩次**(樂觀鎖擋住了),**壞的是他會以為有別人在動這張單。**
   */
  const [submitting, setSubmitting] = useState(false);

  // 🔴 只用**字面**判斷是不是零元,不做數值運算(表單層的整數/範圍驗證在 `amount-form.ts`,
  //    這裡只決定「要不要多問一次」)。`'0'` / `'000'` 都算零元。
  const isZero = /^0+$/.test(price.trim());

  /**
   * 🔴 **離開零元時把確認清掉**(codex 關卡2 R1 nit)。
   *
   * 不清的話:輸入 `0` → 打勾 → 改成 `100` → **再改回 `0`** ⇒ 勾勾還在、按鈕直接可送
   * ⇒ **第二次進入零元完全沒有再確認過一次。**
   * ⚠️ 而畫面上看起來一切正常 —— 那個勾是上一輪留下的,沒有任何東西會提醒員工。
   */
  const onPriceChange = (next: string) => {
    setPrice(next);
    if (!/^0+$/.test(next.trim())) setConfirmed(false);
  };
  // 二次確認**只在零元時**要求 —— 一般改價每次都要打勾會被員工訓練成無意識點擊。
  const blocked = isZero && !confirmed;

  // 🔴 **不能改時:不畫表單,改成就地說明**(F2)。
  //    **不隱藏** —— 隱藏會讓員工找不到「改金額」而懷疑是自己看漏了。
  if (blockedReason) {
    return <p className='text-muted-foreground mt-1 text-xs'>{blockedReason}</p>;
  }

  return (
    <form
      action={updateOrderItemAmountAction}
      onSubmit={() => setSubmitting(true)}
      className='flex flex-col gap-2'
    >
      <input type='hidden' name={AMOUNT_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={AMOUNT_ORDER_ITEM_ID_FIELD} value={orderItemId} />
      <input type='hidden' name={AMOUNT_VERSION_FIELD} value={expectedVersion} />
      <input type='hidden' name={AMOUNT_RETURN_TO_FIELD} value={returnTo} />

      <AdminFormField label='單價(元)'>
        {/* 🔴 **client 驗證是必要的,不是加分**(R3/fable F3):
            送出前擋不掉的話,`1,200` / `12.5` / 全形數字 / 前導空白都會走到 server,
            被 `amount-form.ts` 的 `/^\d+$/` 判 `invalid` ⇒ **員工被彈出這一頁**。
            ⚠️ `inputMode` **只是鍵盤提示、不是驗證** —— 第一版只有它,等於沒擋。
            ⇒ 這裡用 `required` + `pattern`(瀏覽器原生驗證會在送出前擋下)。
            ⚠️ 而它**擋不住停用 JS / 直接 POST** ⇒ server 那道**仍然必要**,兩邊都要在。 */}
        <input
          name={AMOUNT_UNIT_PRICE_FIELD}
          className={ADMIN_INPUT_CLASS}
          inputMode='numeric'
          required
          pattern='[0-9]+'
          title='只能填數字(不要加逗號、小數點或空白)'
          value={price}
          onChange={(e) => onPriceChange(e.target.value)}
        />
      </AdminFormField>

      {isZero ? (
        <>
          <AdminFormField label='改成 0 元的原因(必填)'>
            <input
              name={AMOUNT_ZERO_PRICE_REASON_FIELD}
              className={ADMIN_INPUT_CLASS}
              // 🔴 不得預填,見 `ZERO_PRICE_REASON_DEFAULT` 的 docstring。
              defaultValue={ZERO_PRICE_REASON_DEFAULT}
              // 🔴 F3:零元忘填原因是**最容易發生的一種** ⇒ 送出前就擋,不要讓他被彈出這一頁。
              required
              placeholder='例:贈品 / 換貨補寄'
            />
          </AdminFormField>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我確認這個品項要改成 0 元
          </label>
        </>
      ) : null}

      <div>
        <button
          type='submit'
          disabled={blocked || submitting}
          className='text-sm underline disabled:opacity-50'
        >
          {submitting ? '儲存中…' : '儲存單價'}
        </button>
      </div>
    </form>
  );
}
