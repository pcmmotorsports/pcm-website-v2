// order-detail-tab-routing.ts — 「開單先看哪一頁 / 退款區要不要自己打開」的兩顆純判斷
// (2026-08-24 拆檔片,自 `order-detail.tsx` 抽出;該檔 961 行 > 400,鐵則 6)。
//
// 🔴 **抽檔理由與 `refund-entry-gate.ts` 同款**(下手窗 78 批的字面:「抽出一顆可測的判斷,
//    不是再砍 77 行」):純判斷要條件級可測、不用 mock `server-only`。
// 🔴 **兩顆 JSDoc 逐字搬**(它們記的分母與更正史是承重的);表達式一個字沒動。
// ⚠️ 呼叫端只有 `order-detail.tsx` 一個 —— 「它有沒有真的在用回傳值」由
//    `order-detail-tabs-wiring.test.tsx` 的頁級行為格守(那不是本檔的測試能代替的:
//    接線改恆定值時,純函式自己的測試照樣全綠)。

import type { PaymentListData } from './payment-list';

export function resolveOrderDetailTabFlags(input: {
  refundsFailed: boolean;
  refundUnregisteredFailed: boolean;
  manualRefundsFailed: boolean;
  refundUnregisteredAmount: number | null;
  refundsTruncated: boolean;
  manualRefundsTruncated: boolean;
  payments: PaymentListData;
}): { refundLedgerAbnormal: boolean; moneyTabMustSee: boolean } {
  const {
    refundsFailed,
    refundUnregisteredFailed,
    manualRefundsFailed,
    refundUnregisteredAmount,
    refundsTruncated,
    manualRefundsTruncated,
    payments,
  } = input;

  /**
   * 片12:退款帳本處於**對帳異常**態 ⇒ 那一塊不准收起來(codex K2 finding 3)。
   *
   * 🔴 **這一顆與 `shouldShowRefundEntry` 那道閘【高度重疊而不相同】,差異逐格列在下面。**
   *
   *    ⚠️ ~~原句:「判準用的是**與那道閘同一組輸入**…**兩套會各自漂**」~~
   *    **2026-08-24 更正(SUB2-009):那句話當時是【規範】,而它警告的「各自漂」已經發生了。**
   *    寫的當下它要求你去維持那個不變式;不變式破了之後,它變成一句**錯誤的現況描述**,
   *    讀的人會以為還成立、因此**不去檢查** —— 而中間那一刻**沒有任何訊號**:
   *    沒有測試會紅、`grep` 數不變。⇒ 改成**列出差異**,不再宣稱「相同」。
   *
   *    逐格對照(**數出來的**;閘的定義 = `refund-entry-gate.ts` 的參數型別,那是唯一權威):
   *      兩邊都有:`refundsFailed` / `refundUnregisteredFailed` / 未登記額為負
   *      🔴 只有本顆有:`manualRefundsFailed`
   *         —— 非卡退款登記讀不到**也是對帳異常**(那一塊掛紅字),而它不進閘:
   *            那格的紅字講的是**另一個入口**(「勿重複登記」)。⇒ 該不該進閘 = 待判(乙案)。
   *      只有閘有:`refundEnabled`(理由見下)/ `refundsTruncated` / `paymentChannel` / `paymentStatus`
   *         —— `refundsTruncated` **2026-08-24 才進閘**(它讓「勿發起退款」的紅字與亮著的入口同頁);
   *            **刻意不進本顆**:截斷不是對帳異常,掛紅標題「退款(對帳異常)」會說謊。
   *
   * 🔴 **刻意不含 `refundEnabled`**:旗標關著只是「這功能還沒開放」,不是「對帳出事」;
   *    把它算進來會讓每一張單都掛上紅字異常。
   */
  const refundLedgerAbnormal =
    refundsFailed ||
    refundUnregisteredFailed ||
    manualRefundsFailed ||
    (refundUnregisteredAmount !== null && refundUnregisteredAmount < 0);

  /**
   * 🔴 codex 關卡2(2026-08-24)MF-1/MF-2:「開單要不要先開 money」的判準,**分母數出來的**。
   *
   * 病灶不是漏兩個變數:原本只接 `refundLedgerAbnormal`,而「哪些 flag 會在 money 頁
   * 產生員工必須看到的紅字」這張表沒有人數過(`*Failed` 有接、`*Truncated` 沒接)。
   * 分母 = `OrderDetail` 16 個 props 逐一過、逐個開消費元件看它渲染什麼、渲染在哪一頁:
   *   接(紅字在 money):
   *     refundLedgerAbnormal 四項      RefundLedgerSection 讀取失敗/負值紅字
   *     refundsTruncated               RefundLedgerSection 截斷紅區「勿發起退款」(:94)
   *     manualRefundsTruncated         ManualRefundLedgerSection 截斷紅區(:51)
   *     payments.status !== 'ok'       PaymentList「勿再登錄一筆收款」紅區(:191)/
   *                                    「查不到這張訂單」(:197)—— 兩態都是「不知道有沒有」
   *   不接(警示不在 money,接了反而把人送離警示;負對照守在 wiring test):
   *     suppliersFailed / itemsTruncated / 品項卡住   → items(預設頁)
   *     correctionMissing                            → notes(由 `?correct=` 那條路已接)
   *     cancelled 橫幅                                → 抬頭,四頁都看得到
   *     !refundEnabled 的琥珀說明                     → 環境說明非異常,且取消區文案會指路過去
   * ⚠️ 截斷紅區住在「退款」收合塊【裡面】⇒ 只開分頁不夠,defaultOpen 也要接(呼叫端那顆)。
   * 🔴 刻意不併進 `refundLedgerAbnormal`(那顆的逐格差異寫在它自己上方那段;
   *    ~~原本這裡寫「與那道閘同一組輸入(:224…)」~~ —— **兩處都在 2026-08-24 更正**:
   *    ①「同一組輸入」不成立 ②**行號引用會被本檔自己的改動推走**,改成字面錨)。
   *    ⚠️ ~~「而截斷與收款讀不到**不在閘的輸入裡**」~~ —— **`refundsTruncated` 已於 2026-08-24 進閘**
   *    (SUB2-009);**收款讀不到仍不在**。
   *    📌 留這句留痕的理由:它當時是**對的觀察**,而它被拿去回答「紅標題該不該變」,
   *       **沒有人拿它問「入口該不該暗掉」** —— 那正是 SUB2-009 那個 bug 活下來的方式。
   *    本顆仍不併截斷:併進去會把紅標題「退款(對帳異常)」也掛到截斷單上,那是另一個語意。
   */
  const moneyTabMustSee =
    refundLedgerAbnormal ||
    refundsTruncated ||
    manualRefundsTruncated ||
    payments.status !== 'ok';

  return { refundLedgerAbnormal, moneyTabMustSee };
}
