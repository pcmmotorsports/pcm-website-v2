// 🔴🔴 **這一行是機制,不是註解**(A13b D6-a R2 codex must-fix):本區塊收整包
//    `AdminOrderDetail`(帶金額與會員 tier 脈絡)。被 `'use client'` 檔 import 的話,
//    那整包會進 RSC payload(純文字)= 鐵則 12 ② 的洩漏面,而且**沒有任何東西會紅**。
//    `import 'server-only'` 讓那種 import 在**建置期**就炸。
//    ⚠️ `cancel-review-section.tsx` 的舊註解寫「`server-only` 不是 apps/admin 的直接依賴」
//    —— **那句已過期**:實查 `apps/admin/package.json` 的 `dependencies` 有 `server-only@^0.0.1`。
//    ⇒ 測試端要 `vi.mock('server-only', () => ({}))`(既有頁層測試本來就這樣做)。
import 'server-only';
import type { AdminOrderDetail } from '@pcm/domain';
import { buildOrderCancelView } from '../../lib/orders/cancel-view';
import { CancelReviewSection } from './cancel-review-section';
import { FullCancelForm, PartialCancelForm } from './cancel-order-forms';

// order-cancel-block.tsx — M-4b E10 **A13b D6-a**:訂單明細頁上的取消區塊(複核 + 兩支表單)。
//
// 🔴 **為什麼抽成獨立檔**(鐵則 6):接線之後 `order-detail.tsx` 從 393 行漲到 429 行、
//    越過 400 的硬線。抽出來之後那支**當時回到 400 行整**,而本檔把「取消要不要出現」的
//    三道判斷收在同一個地方 —— 它們本來就該一起讀。
//    ⚠️ **「未超過硬上限」那句已過期**(#350d-2 實查):`order-detail.tsx` 現在 **410 行**、
//    已越線 —— 是 #350d 兩片各加幾行推上去的。拆它要動的是卡片區塊的切分、與 return_to 無關
//    ⇒ 另立一片,不拆的理由寫在 #350d-2 的 commit body。
//
// 🔴 判定只有一份:`buildOrderCancelView` 是唯一真相,本檔不重算任何拒因或上限
//    (同 `cancel-review-section.tsx` 的紀律:重算一份就會有兩份會漂移的規格)。

export function OrderCancelBlock({
  detail,
  returnTo,
  formsAllowed,
}: {
  detail: AdminOrderDetail;
  /**
   * #350d C1:兩支取消表單的 `return_to` 值 = 當下這個視圖自己的網址。
   * 🔴 **必填、無預設**:給預設值等於「忘了接就靜默把面板關掉」,而那個症狀在測試裡
   *    看起來完全正常(頁面是對的、只是視圖換了)。
   */
  returnTo: string;
  /**
   * 這一次渲染准不准出現取消表單(頁層算好後下傳)。
   *
   * 🔴🔴 **預設 `false` 是刻意的 fail-closed**:忘記傳 = 不給表單,不是「照常給」。
   *    反面(預設 true)會讓「呼叫端忘了接」變成靜默把表單開回去 —— 那正是
   *    `cancel-action-state.ts` 義務 B 要防的動作(第二筆刪不掉的取消)。
   *    ⚠️ 這條有專屬測試(`cancel-wiring.test.tsx` 的「不傳 prop 直渲」兩格)——
   *    突變把預設改成 `true` 時它會紅;沒有那兩格的話,頁層測試每次都明確傳值、
   *    **這個預設值不會被任何測試走到**(實測存活過一次)。
   * 🔴 值由 `cancelFormsAllowedOnResultPage(?r=)` 算(`cancel-result-panel.tsx`):
   *    面板出現的那一次渲染 = 結果頁 ⇒ 不給;員工重新整理讓網址回 canonical ⇒ 自然回來。
   */
  formsAllowed?: boolean;
}) {
  const view = buildOrderCancelView(detail);
  // 🔴 兩道都要成立才給表單:①判定說可以(`buildOrderCancelView` 是唯一真相)②不是結果頁。
  //
  // ⚠️ **原本還有第三道 `detail.cancelledAt === null`,已移除**(R2 突變實測):
  //    它被 `canCancel` **嚴格蘊含** —— `cancelledAt` 非 null 時 `buildOrderCancelView` 必推
  //    `already_cancelled` 或 `payment_expired` 拒因 ⇒ `canCancel` 恆 false。
  //    症狀正是「**寫不出只紅它的負測**」:拿掉它,全套測試零轉紅。
  //    我原本把它寫成「縱深」,但**沒有測試證得了的縱深不是縱深,是一句宣稱**
  //    (memory `feedback_unconstructible-negative-test-means-noop-guard`)。
  //    ⇒ 留一句話在這裡代替那行 code:**已取消的單由 `canCancel` 擋**,
  //    若日後有人讓 `already_cancelled` 不再阻擋,要回來補一道明確的閘 + 只紅它的負測。
  const showForms = view.canCancel && formsAllowed === true;

  return (
    <>
      {/* 🔴 **複核區塊永遠掛著**(即使已取消 / 不能取消)—— 關單之後員工仍要看得到
          「取消了什麼」,那是義務 5 的比對面。 */}
      <CancelReviewSection detail={detail} />
      {showForms && (
        <div className='space-y-4'>
          {/* 🔴 整單那支還要多過 `fullCancelAllowed`(有到貨就只能逐品項取消,RPC 會拒)。 */}
          {view.fullCancelAllowed && (
            <FullCancelForm orderId={detail.id} returnTo={returnTo} />
          )}
          <PartialCancelForm
            orderId={detail.id}
            returnTo={returnTo}
            items={view.items}
            itemNames={new Map(detail.items.map((item) => [item.id, item.title ?? item.variantSku]))}
          />
        </div>
      )}
    </>
  );
}
