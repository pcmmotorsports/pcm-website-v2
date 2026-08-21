import type { AdminOrderCancellationReasonCode, AdminOrderDetail } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { CANCEL_REASON_LABEL } from '../../lib/orders/cancel-form';
import {
  buildOrderCancelView,
  type CancelViewPayments,
  type OrderCancelBlockReason,
  type OrderCancelView,
} from '../../lib/orders/cancel-view';

// cancel-review-section.tsx — M-4b E10 **A13a**:取消訂單的**唯讀複核區塊**。
//
// 🔴 **server component、零 `'use client'`**(刻意):本區塊全部是唯讀顯示,
//    「同頁兩段式展開」(Sean Q2=A)用原生 `<details>/<summary>` 做,不需要任何 client JS。
//    ⇒ 順帶避開 D 窗踩過的那個坑:`AdminOrderDetail` 帶金額與會員等級脈絡,
//      整包丟進 client props 會進 RSC payload(純文字)。這裡它從頭到尾留在 server。
//    ⚠️ **本行 2026-08-10 由 D4 更正**:原本寫「A13b 的表單才需要 `'use client'`」——
//      那是 A13b v2 的舊形狀。v3 換路之後表單改成原生 form + server action;
//      **A13b E1 又加回了一層薄的 `'use client'`**(`cancel-form-body.tsx`,漸進增強)——
//      界線是「**送出值不由 client state 產生或回寫**」(不是「state 裡沒有送出值」——
//      `reason_code` 就在 state 裡),而那正是「不會誤送整單取消」的修法本體,
//      不是風格選擇。要引用這段的人**讀 `cancel-form-body.tsx` 檔頭的三條不變式**,別照抄「零 client state」。
//      兩支檔仍刻意不合併(鐵則 6:唯讀複核區塊 vs 表單,職責不同)。
// 🔴 **這條目前只有註解在守,沒有機制**(R1 F15 誠實記載):`import 'server-only'` 是正解,
//    但 `server-only` 不是 `apps/admin` 的直接依賴(實測 vite 解析不到、整支測試檔載入即炸),
//    為一條 nit 加依賴會動到 `package.json`(鐵則 12 ④ 那類)⇒ 不划算。
//    ⇒ **接線的人注意**:本元件收整包 `AdminOrderDetail`(帶金額與 tier 脈絡),
//    只能從 server component 呼叫;若哪天被 `'use client'` 檔 import,那整包會進 RSC payload 且沒有東西會紅。
//
// 🔴 判定不在本檔:`buildOrderCancelView()`(`lib/orders/cancel-view.ts`)是唯一真相,
//    本檔只把它的輸出翻成中文。**不得**在這裡重算任何一條拒因或上限 ——
//    重算一份就會有兩份會漂移的規格(同 `cancel-form.ts:52` 的紀律)。
//
// 🔴 中文字面暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';

/**
 * 11 條拒因的文案表。
 *
 * 🔴 **型別是守門**(主視窗 `E-005-A` 核可):`Record<OrderCancelBlockReason, …>` 要求逐碼寫滿 ——
 * `cancel-view.ts` 日後新增一個碼而這裡沒補,**編譯期就紅**,不會靜默少一句話。
 * ⚠️ plan `docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:192` 寫的是「八條拒因」——
 * 那是 **RPC 的八個條件數**,不是 UI 的碼數;本層把幾種「看不到」拆成獨立碼(處置不同),所以是 11 條。
 *
 * `hint` 的紀律(逐條依據見 `cancel-view.ts` 各碼的 docstring):
 * - 只有**狀態可能剛變動**的那幾條才寫「請重新整理」;
 * - 讀不到 / 讀不全那幾條,成因含**投影退版**(重整不會好)⇒ 一律補「若仍相同,請通知系統維護」;
 * - 帳本異常類直接指向系統維護,不叫員工重試。
 */
export const BLOCK_REASON_TEXT: Record<
  OrderCancelBlockReason,
  { title: string; hint: string }
> = {
  already_cancelled: {
    title: '這張單已經取消過了',
    hint: '整單取消只會發生一次。若你要看取消了什麼,見下方「取消紀錄」。',
  },
  payment_expired: {
    title: '這張單因為未付款已自動失效',
    hint: '系統在付款期限內沒有收到款項,自動把它關閉了,不是客服取消的。客人要買請重新下單。',
  },
  // 🔴 2026-08-18 文案審查(E-706 §1)。本族原本寫「這期還不能」「退款線之後才開通」——
  //    「這期」是我們的開發週期、「退款線」是內部工作線的叫法,**員工的世界裡沒有這兩個東西**;
  //    而那個講法還傳達「你等一下就有了」⇒ 員工會【等】,真正要做的事被塞在括號後面。
  // 🔴🔴 **但不可以改成「不能取消」** —— `cancel-review-section.test.tsx:197` 那格的名字逐字是
  //    「說『這期還不能』而不是『不能取消』(Sean 07-26 拍已付款可取消,缺口在第 3 批)」
  //    ⇒ **「暫時性」是刻意的、是 Sean 的拍板**,講死了員工會以為這條路永遠不存在。
  //    ⇒ 折衷:用「目前」——它是白話、不是內部語彙,而且一樣帶得出暫時性。
  //    ⇒ 拿掉的是【為什麼不行】與【什麼時候會好】,保留【暫時】與【現在該做什麼】。
  // 🔴🔴 **2026-08-20 第二刀:同一個病當時只清了 `title`,`hint` 一個字沒動。**
  //    Sean 逐字(第 6 條)「…但是**警示語寫得很不清楚**」。而那句 hint 原本是:
  //    ~~「請走人工退款流程:先確認這張單要退多少錢,再依退款流程處理。」~~
  //    ①「人工退款流程」與「退款流程」是**同一個內部語彙**,而它**循環定義**——
  //      叫你去做那件事的方法,是再講一次那件事的名字。
  //    ②「人工」對**刷卡單是錯的**:這一頁最下方就有線上退款入口,不必走人工。
  //    ③ 它**沒有說在哪** ⇒ 員工讀完不知道下一個動作要點哪裡。
  //    ⇒ 改法一致:**指位置,不指流程名**。字面當場核過、不憑記憶:
  //      「收款」= `payment-list.tsx:182` `<h2>收款</h2>`
  //      「退款」= `order-detail.tsx:511`(對帳異常時是「退款(對帳異常)」,含「退款」二字)
  //    ⚠️ 三句都**不講各收款方式該怎麼退** —— 那是 `W1-071` plan 的射程,而它還押著。
  //       這一刀只把「指錯地方 / 指不到地方」修掉,不預先替那份 plan 表態。
  // ⚠️ hint 要比 title 長是**守門要求的**(`cancel-review-section.test.tsx` 搜 `hint 不得等於 title`)——
  //    它守的是「hint 必須比 title 多給東西」。⇒ 這裡補的是【下一步的細節】,不是湊字數。
  // 🔴 **片 B(2026-08-20):這個碼現在【不再給 paid 用】** —— `paid` 依收款管道分岔成
  //    `payment_card_rail` / `payment_rail_unverifiable`(見下兩則),或**不擋**(現金/匯款)。
  //    ⚠️ 碼名與這句文案都是歷史的、比現況寬,**刻意不改名**(改名要動 RPC 對照、測試與本表,
  //       而本片的病是**分流**不是命名)。它現在的唯一去處是 `PAYMENT_BLOCK_REASON` 之外的舊路徑。
  payment_not_unpaid: {
    title: '已付款的單目前還不能在這裡取消',
    hint: '這張單的錢要先處理完。退款在本頁最下方的「退款」裡:先確認要退多少、用什麼方式退,錢處理完再回來取消。',
  },
  // 🔴 **片 B:刷卡收款的單。** 判準照你自己在 W1-082 §4 寫的:
  //    **看完這句話,你知道下一步該做什麼嗎?** ⇒ 所以它要**指路**,不只是拒絕。
  //    ⚠️ 位置字面當場核過(同本檔上面那條紀律:**指位置,不指流程名**):
  //       「退款」= `order-detail.tsx` 那一塊的標題(對帳異常時作「退款(對帳異常)」,仍含「退款」二字)。
  // 🔴 **這張表自己的守門抓到我一次**(片 B,2026-08-20):我原本把 title 寫成
  //    「取消要走**退款流程**」—— 而 `cancel-review-section.test.ts` 那條「不得出現流程名」的
  //    表格驅動測試當場紅:**畫面上沒有一個叫「退款流程」的東西**。
  //    ⇒ 照本檔上面那條紀律改成**指位置**:「本頁最下方的『退款』」(字面在 order-detail.tsx 那一塊)。
  //    📌 值得記:**我整晚在別處講「訊息不得指向不存在的動作」,而寫這一句時自己又犯了** ——
  //       而這次抓到我的不是人,是這張表的守門。
  payment_card_rail: {
    title: '這張單是刷卡付款的,要先把錢退回原卡片才能取消',
    hint: '刷卡的錢不能只把訂單取消掉就算數,要退回原本那張卡。請到本頁最下方的「退款」裡處理;錢退完之後這張單才能取消。現金或匯款收的單則可以直接在這裡取消。',
  },
  // 🔴 **片 B:看不出這張單是怎麼收的 ⇒ fail-closed。** 兩個來源共用一句,因為下一步相同。
  //    ⚠️ 這句**不可以**寫成「這張單沒有收款紀錄」—— 那是把「不知道」講成「沒有」,
  //       而那正是本碼存在要防的事(方向會與後端相反)。
  payment_rail_unverifiable: {
    title: '看不出這張單是用什麼方式收款的,先不開放取消',
    hint: '要判斷能不能在這裡取消,得先知道這筆錢是刷卡收的還是現金/匯款收的,而現在讀不到這張單的收款明細(可能是讀取失敗,也可能是這張單根本沒有收款紀錄)。請重新整理一次;若還是一樣,請通知系統維護 —— 這不是你操作錯誤。',
  },
  // 🔴 `#494` 的三條:**下一步各不相同**,所以不共用上面那句(Sean 2026-08-14 拍板 B)。
  //    起因是 Sean 對著一張**已經退過款**的單,看到上面那句「已付款…請走人工退款流程」。
  // 🔴 codex 關卡2 F2:~~原本這句先說「不用再退一次」、又說「取消要連著退款一起做」、
  //    再叫人「通知系統維護結案」~~ —— 三句互相打架,而且**發明了一個不存在的結案流程**。
  //    這張單的錢已經處理完了,員工現在**真的不需要做任何事**,那就照實說。
  payment_refunded: {
    title: '這張單的錢已經退回去了',
    hint: '款項已經退還,不用再退一次。這張單的錢已經結清 —— 現在不需要為它做任何事。',
    // (本句原本還有「取消鈕這期還不能用(要等退款線開通)」—— 拿掉:這張單已經結清,
    //  員工不需要為它做任何事,講「取消鈕何時會好」對他當下的決定沒有作用。)
  },
  payment_partially_refunded: {
    title: '這張單退了一部分款',
    hint: '還有一部分款留在這張單上,跟「已全退」不一樣、不能當結案處理。這張單目前不能在這裡取消:剩下的金額要退,用本頁最下方的「退款」;要收,用上方的「收款」。',
  },
  payment_partially_paid: {
    title: '這張單只收到一部分款',
    hint: '收了一部分款的單目前不能在這裡取消。尾款要收齊,用上方的「收款」;要退,用本頁最下方的「退款」。',
  },
  charge_attempt_blocked: {
    // 🔴 **Sean 2026-08-21 逐字定稿(他選甲)。改任何一個字都要先問他。**
    //   舊字面逐字:「這張單有一筆刷卡還在進行中」/「等那筆刷卡結束(成功或失敗)才能取消。請重新整理看看最新狀態。」
    //   換掉的理由不是語感,是**那句話叫人做一件永遠不會有結果的事**:
    //   正式庫此刻有 5 張單卡在這個狀態,**重整一百次都不會變**;其中 `2SQH2P` / `GVRDMH`
    //   是 Sean 自己拿出來問的那兩張。⇒ 「請重新整理」把責任推給員工,而那條路是死的。
    //   ⚠️ 這一格是給**員工**看的、不是客人(Sean 特地確認過)⇒ 指路到 TapPay 後台是合理的。
    //   守門:`cancel-review-section.copy.test.tsx` 兩發(逐字釘死 + 舊字面不得回來)。
    title: '這張單有一筆刷卡還沒有結束',
    hint: '要等那筆刷卡有結果(成功或失敗)才能取消。重整沒有用,卡住的話去 TapPay 後台查那筆。',
  },
  charge_attempt_stuck: {
    // 🔴🔴 **這一格的逐字【還沒有經過 Sean】** —— 上面 `charge_attempt_blocked` 那格是他
    //   2026-08-21 親自定稿的(他選甲),本格是 `#808`/`#387` 拆四態之後**新長出來的一格**,
    //   由實作者照他那格的語氣寫的草稿。⇒ **端給他定稿之前,不要把它當成拍板過的字面。**
    //   `#808` plan §2 的原話:乙版(「系統已經停止自動重試」)要靠本片才寫得準 —— 現在寫得準了。
    // 🔴 兩問各一格(`MAIN-109 §4`):
    //   ①誰看得到 ⇒ 訂單明細頁的取消複核區塊(與其餘拒因同一個位置,不需要新頁面)。
    //   ②看到之後他能做什麼 ⇒ **只有「去 TapPay 後台查那一筆」這一件**,而那件事今天做得到。
    //     ⚠️ 刻意**不寫**「請重新整理」「請通知系統維護」「請標記免處理」——
    //     前兩者是那條跑了 12 天的死迴圈,第三者在後台根本不存在(`#818` 實查零命中)。
    // 守門:`cancel-review-copy.test.ts`(逐字釘死 + 那三句禁語不得回來)。
    // 🔴🔴 **第一版的 hint 寫「這張單也不會自己變好,重整不會有變化」—— 那句話是【假的】,
    //   對抗審查 R1 F1 抓到,而它假的方式正好是本片要治的那一族**(對員工斷言一件沒量過的事):
    //     `20260627120000_..._b1a_claim_expired_pending_attempts.sql:16` 逐字:B1a 再確認
    //     **不濾 `needs_manual_review`、不濾 `settle_attempt_count`(繞 ceiling)**,
    //     受 age≥12h + order unpaid + 6 小時 throttle 限制;它接在
    //     `apps/storefront/src/app/api/cron/settle-sweep/route.ts:226` 的 `reconfirmExpiredOrphans`。
    //   ⇒ 被舉手的單**仍會**被低頻再確認,TapPay 那邊一旦回 paid,它就會自己變。
    // 🔴 而【那條路今天有沒有在跑,我量不到】:`CRON_SWEEPER_ENABLED`(`route.ts:156`)的正式站值
    //   看不到(`vercel env ls` 最後一欄是 created 不是 updated,答不出值)。
    //   ⇒ 兩個世界都可能 ⇒ **這句話必須在兩個世界裡都為真**,所以絕對句一律不寫。
    //   缺的那道檢查:請 Sean 開 Vercel 看那個值,或改完 Redeploy 後實走一次那條路。
    title: '這張單的刷卡卡住了,系統已經停止自動重試',
    hint: '系統試到上限就停了,這張單一直停在這個狀態。不要坐著等它自己變 —— 現在能做的是去 TapPay 後台查那一筆的實際狀態。這張單目前在後台還不能取消、也還不能退款。',
  },
  charge_attempt_unknown: {
    title: '付款狀態沒有讀完整',
    hint: '看不到全部的刷卡紀錄,不能確定有沒有在進行中的刷卡。請重新整理;若仍相同,請通知系統維護。',
  },
  items_truncated: {
    title: '這張單的品項太多,畫面沒有列完',
    hint: '沒有看到全部品項就不能複核取消範圍。請通知系統維護處理。',
  },
  no_items: {
    title: '這張單沒有任何品項',
    hint: '這是不該出現的狀態,請通知系統維護。',
  },
  quantity_summary_missing: {
    title: '有品項的數量資料異常',
    // 🔴 `#646` 關卡2 code-reviewer:同一張單、同一個品項,採購區塊那則說「可以先重新整理看看」,
    //    這則卻說「不要重試」⇒ 員工讀到的是**兩條相反的指示**(而其實它們講的是不同動作:
    //    前者是重新載入頁面、後者是重複送出取消)。⇒ 把「不要重試」講精確,歧義就沒了。
    hint: '這張單有採購或取消紀錄,數量卻對不起來(或採購清單沒讀到/沒讀完整)。請通知系統維護;在那之前不要重複送出取消。',
  },
  ledger_unhealthy: {
    // 🔴 三種病理共用一碼(`cancel-view.ts` 的 `ledger_unhealthy` docstring),文案不可只描述其中一種
    //    ——員工會照著向維護回報錯的症狀(R1 F5)。
    title: '取消紀錄異常',
    hint: '這張單的取消紀錄本身有問題(數量對不起來、或有一筆紀錄底下沒有品項、或關單資料殘留)。請通知系統維護,不要重試。',
  },
  cancellations_unreadable: {
    title: '取消紀錄沒有讀完整',
    hint: '看不到全部的取消紀錄,不能確定已經取消過多少。請重新整理;若仍相同,請通知系統維護。',
  },
  nothing_cancellable: {
    // 🔴 本碼有已知的假陽性路徑(`cancel-view.ts` 的 `INSTOCK_PROXY` ②:快取到貨非 0 / 真相 0
    //    ⇒ 整張單錯報,而 RPC 其實會放行)⇒ 不可把成因講死、也不可零出路(R1 F4)。
    title: '這張單看起來沒有可以取消的數量',
    // 🔴 **2026-08-14 止血(`#18` 查證報告 §1 與 §4-R5)**:原字面「已到貨的部分**要走退貨流程**」
    //    **指向一條不存在的流程** —— 退貨線在本 repo 零落點(pattern `order_returns` /
    //    `order_return_items` / `returned_quantity` / `return_requested_quantity` /
    //    `return_received_quantity` 於 `supabase/migrations`+`packages`+`apps` 命中 **0**;
    //    正向對照:同範圍換 `order_item_quantity_summary` = 191 行,見報告 §1)。
    //    ⇒ 這是全檔**唯一**一句把不存在的東西講成現行流程的 hint,員工照著找會找不到、
    //      而畫面沒告訴他那是因為還沒做。
    //    改法對齊**本檔既有慣例**:`:65`/`:74`/`:82` 都是「講明這條線還沒開通」而不是指路。
    //    ⚠️ **這是止血、不是文案定案** —— 措辭是 Sean 的地盤,他要換隨時換。
    hint: '下表每個品項的「還能取消」都是 0。已到貨的部分不能在這裡取消,而退貨功能目前還沒有;若你確定還有沒到貨的數量,請重新整理,仍相同就通知系統維護。',
  },
};

/**
 * 🔴 **字典搬到 `cancel-form.ts`(A13b D4)** —— 表單下拉與歷程顯示必須是同一組字。
 *    這裡只留一個別名,呼叫點不動。搬家理由見那支常數的 docstring。
 * ⚠️ 型別對齊:`CancelReasonCode`(解析器的七碼)與 `AdminOrderCancellationReasonCode`
 *    (domain 的七碼)是同一組字面值,兩者都由 `20260730130000:131-139` 的 CHECK 當權威。
 */
const REASON_CODE_LABEL: Record<AdminOrderCancellationReasonCode, string> = CANCEL_REASON_LABEL;

/**
 * 這次取消共幾件。
 *
 * 🔴 **不能裸 `reduce`**(R1 F2):`mappers/order-cancellations.ts:88-93` 逐欄直送、
 * **沒有** `Number.isFinite` 守門(`cancel-view.ts` 的 `LEDGER_FROM_TRUTH` ④ 逐字記著這件事)
 * ⇒ `null` 會被加法靜默當 0(少算)、`NaN` 會畫出「共 NaN 件」。
 * 本檔宣稱「不知道不畫成 0」,這一格也要做到 ⇒ 任一列不是有限正數就回 `null`、畫成「無法計算」。
 */
function sumCancelledQuantity(
  rows: readonly { cancelledQuantity: number }[],
): number | null {
  let total = 0;
  for (const row of rows) {
    // 🔴 `isInteger` 不是 `isFinite`(R2 nit):欄位是 int4,`1.5` 會畫出「共 3.5 件」。
    //    真實資料不可達(DB CHECK + integer 欄),但同長度的寫法就選強的那個。
    if (!Number.isInteger(row.cancelledQuantity) || row.cancelledQuantity <= 0) return null;
    total += row.cancelledQuantity;
  }
  return total;
}

function BlockReasons({ reasons }: { reasons: readonly OrderCancelBlockReason[] }) {
  return (
    <ul className='space-y-2'>
      {reasons.map((reason) => {
        const text = BLOCK_REASON_TEXT[reason];
        return (
          <li key={reason} className='border-destructive/30 bg-destructive/5 rounded-md border p-3'>
            <p className='text-destructive text-sm font-medium'>{text.title}</p>
            <p className='text-muted-foreground mt-1 text-xs'>{text.hint}</p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 逐品項的影響範圍。
 *
 * 🔴 **已到貨量與尚可取消量分開顯示**(plan §1.2 的 K1-7 更正逐字):
 * 買 5、到貨 2、已取消 0 時**剩下 3 仍可取消** —— 不可把整個品項標成「不可取消」。
 * 已到貨的那部分是**部分**不可取消,不是整項。
 * ⚠️ **2026-08-14 更正**:原字面「要指路**退貨**(第 3 批)」—— 那條線目前**零落點**
 * (`#18` 查證報告 §1),UI 不得指向它;`BLOCK_REASON_TEXT.nothing_cancellable` 已同批止血。
 */
function ItemRows({
  detail,
  view,
}: {
  detail: AdminOrderDetail;
  view: OrderCancelView;
}) {
  const byId = new Map(view.items.map((item) => [item.orderItemId, item]));
  return (
    <table className='w-full text-sm'>
      <thead>
        <tr className='text-muted-foreground border-b text-left text-xs'>
          <th className='py-2 font-medium'>品項</th>
          <th className='py-2 text-right font-medium'>買了</th>
          <th className='py-2 text-right font-medium'>已到貨</th>
          <th className='py-2 text-right font-medium'>已取消</th>
          <th className='py-2 text-right font-medium'>還能取消</th>
        </tr>
      </thead>
      <tbody>
        {detail.items.map((item) => {
          const row = byId.get(item.id);
          return (
            <tr key={item.id} className='border-b last:border-0'>
              <td className='py-2'>
                <span className='block'>{item.title ?? item.variantSku}</span>
                <span className='text-muted-foreground text-xs'>{item.variantSku}</span>
              </td>
              {/* 🔴 整列一律走 `view`(R1 F9):混用 `item` 與 view 算出來的欄位,
                  快取漂移時整列算式會對不起來(買 5 / 到貨 0 / 取消 0 / 還能取消 3)。
                  ⚠️ 精確講 view 內部仍是兩源(`quantity` 取真相、其餘取摘要快取),
                  只是被複合 FK 釘成同值 —— 不可達性見 `cancel-view.ts` 的 `quantity` 註解(R2 nit)。 */}
              <td className='py-2 text-right tabular-nums'>{row?.quantity ?? item.quantity}</td>
              {/* 🔴 `null` 是「不知道」不是 0 —— 畫成「?」而不是數字,免得員工照著它算。 */}
              <td className='py-2 text-right tabular-nums'>{row?.instockQuantity ?? '?'}</td>
              <td className='py-2 text-right tabular-nums'>{row?.cancelledQuantity ?? '?'}</td>
              <td className='py-2 text-right font-medium tabular-nums'>
                {row?.maxCancellable ?? '?'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CancellationHistory({ detail }: { detail: AdminOrderDetail }) {
  // 🔴 三態逐條分開(`types.ts` 對 `cancellations` 的契約):
  //    `null` = 沒讀到(別畫成空清單)/ `[]` = 真的沒取消過 / 有內容才畫清單。
  // 🔴 **`== null` 而不是 `=== null`**(A13b D6-a 加的**防禦性**收斂)。
  //    ⚠️ **誠實更正(R1 must-fix)**:我第一版把理由寫成「投影退版時這個鍵會整個不存在、
  //    是產線真的會發生的值」——**那句不實**。實查 `mappers/order.ts:750-751`:
  //    `cancellations` 與 `cancellationsTruncated` 由 mapper **恆設**,產不出 `undefined`。
  //    真正的觸發是 D6-a 接線時,三支既有頁層測試的 **fixture 沒有這兩個鍵** ⇒ `.length` throw。
  //    ⇒ 保留 `== null` 的理由只有一條:**入口是結構型別、擋不住手寫物件**,而缺值與 `null`
  //    在這裡的處置本來就相同 —— 純防禦,**不是**在修一個已知的產線缺陷。
  //    ⚠️ 方向不變:兩種缺值都走「讀取失敗」那句(fail-closed),不是畫成「沒有取消紀錄」。
  if (detail.cancellations == null) {
    return (
      <p className='text-muted-foreground text-sm'>
        取消紀錄讀取失敗,無法顯示。請重新整理;若仍相同,請通知系統維護。
      </p>
    );
  }
  if (detail.cancellations.length === 0) {
    return <p className='text-muted-foreground text-sm'>這張單沒有取消紀錄。</p>;
  }
  return (
    <div className='space-y-3'>
      {detail.cancellationsTruncated ? (
        <p className='text-muted-foreground text-xs'>
          只顯示最近幾筆,更早的取消紀錄沒有列出來。
        </p>
      ) : null}
      <ul className='space-y-2'>
        {detail.cancellations.map((entry) => (
          <li key={entry.id} className='rounded-md border p-3 text-sm'>
            <div className='flex justify-between gap-4'>
              <span>{REASON_CODE_LABEL[entry.reasonCode] ?? entry.reasonCode}</span>
              {/* 🔴 用同頁姊妹區塊那支(R1 F8):①同一張訂單頁不出現兩種日期格式
                  ②`Intl.DateTimeFormat().format(new Date('bad'))` **丟 RangeError** ⇒ 整頁 server render 500,
                  而那支走 `toLocaleDateString`、壞值只會印 "Invalid Date"。`createdAt` 同樣是直送未驗字串。 */}
              <span className='text-muted-foreground text-xs'>
                {formatOrderDateTime(entry.createdAt)}
              </span>
            </div>
            {entry.reasonDetail === null ? null : (
              <p className='text-muted-foreground mt-1 text-xs break-all'>{entry.reasonDetail}</p>
            )}
            {/* 🔴 `items === null` = 沒讀到,不是「這次取消沒動到品項」(後者在 DB 端不存在)。 */}
            {entry.items === null ? (
              <p className='text-muted-foreground mt-1 text-xs'>這次取消的品項明細沒有讀到。</p>
            ) : (
              <p className='text-muted-foreground mt-1 text-xs'>
                {(() => {
                  const total = sumCancelledQuantity(entry.items);
                  return total === null ? '件數無法計算(明細數字異常)' : `共 ${total} 件`;
                })()}
                {entry.itemsTruncated ? '(品項明細沒有列完)' : null}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A13a 唯讀複核區塊。**不含任何送出動作**(那是 A13b)。
 *
 * 🔴 `<details>` 預設收合、可取消時才預設展開:能取消的單員工要先看影響範圍;
 * 不能取消的單只要看到「為什麼不能」就夠了,展開一整張表是噪音。
 */
export function CancelReviewSection({
  detail,
  payments,
}: {
  detail: AdminOrderDetail;
  /**
   * 這張單的收款明細(三態)。**片 B 新增、必填無預設。**
   * 🔴 判斷「現金/匯款可取消、刷卡不行」需要 rail,而 rail 只在這裡。
   *    給預設值會說謊(`ok/[]` ⇒ 當成零收款列;`unreadable` ⇒ 每張單都掛警告)⇒ **忘了接必須編不過。**
   */
  payments: CancelViewPayments;
}) {
  const view = buildOrderCancelView({ ...detail, payments });

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>取消訂單</h2>

      {view.canCancel ? (
        // 🔴 不可把「不能整單取消」的成因講死(R1 F1):`fullCancelAllowed` 有**兩個**獨立成因
        //    (任一品項有到貨 / 某品項的上限被壓到低於剩餘量),寫死其中一個會與下表自打嘴巴。
        <p className='text-sm'>
          這張單可以取消。
          {view.fullCancelAllowed
            ? '可以整單取消,也可以只取消部分品項。'
            : '這張單只能逐項取消,請照下表每個品項的「還能取消」勾選。'}
        </p>
      ) : (
        <BlockReasons reasons={view.blockReasons} />
      )}

      <details className='mt-4' open={view.canCancel}>
        <summary className='cursor-pointer text-sm font-medium'>影響範圍與取消紀錄</summary>
        <div className='mt-3 space-y-4'>
          <ItemRows detail={detail} view={view} />
          <div>
            <h3 className={CARD_TITLE}>取消紀錄</h3>
            <CancellationHistory detail={detail} />
          </div>
        </div>
      </details>
    </section>
  );
}
