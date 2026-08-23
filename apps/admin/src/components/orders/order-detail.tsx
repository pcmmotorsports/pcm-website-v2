import Link from 'next/link';
import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
/* 🔴🔴 **片4a 搬家留下的 11 個死 import 已一次清完**(2026-08-16 片4c)。
   `GoodsAxisValue` 與四張摘要卡在片4a 搬進 `order-detail-summary-cards.tsx`,
   **而它們用的 import 全部留在這裡沒跟著走。** 清掉的 11 個:
     `PAYMENT_STATUS_LABEL` `GOODS_AXIS_LABEL` `ORDER_SOURCE_LABEL` `PAYMENT_CHANNEL_LABEL`
     `formatOrderAmount` `INVOICE_STATUS_LABEL` `customerEmailDisplay`
     `invoiceTypeLabel` `shippingMethodLabel` `orderDetailGoodsAxis` `goodsAxisProgressNote`
   **數法**:`for s in <每個符號>; do grep -c "$s" <本檔>; done` ⇒ 全部 **1**(只命中 import 行本身)。
   留下的只有 `formatOrderDateTime`(實得 3)。

   ⚠️ **`lint --force` 18/18 全綠抓不到它們** —— `eslint.config.js` 全檔 `grep -n unused` 零命中,
      沒有 `no-unused-vars` / `unused-imports` 規則 ⇒ **結構上抓不到,不是這次剛好沒抓到。**
   🔴 **真實傷害不是體積**:code-reviewer 找「軸的消費者」時命中這裡,據以判斷本檔是第二個消費者
      —— **一個不存在的消費者比沒有消費者更花時間。**
   🔴🔴 **而我第一版【只清了被指名的那 2 個】** —— 同一批、同一次搬家、同一種傷害的另外 9 個
      原封不動,是下一輪 code-reviewer 抓的。**finding 是症狀的位置,不是病的邊界。** */
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
// 片2 標頭列:兩個標籤表都是**既有的**,本片零新增詞彙(理由見 `OrderHeadChip` 那段)。
import {
  PAYMENT_STATUS_LABEL,
  SHOW_UNPAID_CARD_ON,
  SHOW_UNPAID_CARD_PARAM,
  formatOrderAmount,
} from '../../lib/orders/order-list-view';
import { OrderHiddenNotice } from './order-hidden-notice';
import { generateNoteRequestToken } from '../../lib/orders/note-action-state';
import { NOTE_TYPE_LABEL, canCorrectNote } from '../../lib/orders/note-timeline';
import { OrderEditForm } from './order-edit-form';
import { NotesTimeline } from './notes-timeline';
import { NoteComposeForm, type CorrectTarget } from './note-compose-form';
import { DangerZoneDetails } from './danger-zone-details';
import { ItemsTable } from './order-detail-items-table';
import { OrderFocalRow, OrderInfoCards } from './order-detail-summary-cards';
// 🔴 OD FIX-07/17/45:四分頁 + 全部展開逃生口。**唯一的 client 島**,理由見該檔檔頭
//    (本檔是 server component,渲染期產 token / 讀 `Date.now()` ⇒ 不能加 `'use client'`)。
import { OrderDetailTabs } from './order-detail-tabs';
import { OrderCancelBlock } from './order-cancel-block';
import { ShipmentSection } from './shipment-section';
import { RefundSection } from './refund-section';
import { RefundLedgerSection } from './refund-ledger-section';
import { isStuckManualVerdict } from '../../lib/payment/refund-ledger-view';
import { shouldShowRefundEntry } from './refund-entry-gate';
import { ManualRefundEntrySection } from './manual-refund-entry-section';
import { ManualRefundLedgerSection } from './manual-refund-ledger-section';
import { shouldShowManualRefundEntry } from './manual-refund-entry-gate';
import type { PaymentListData } from './payment-list';
import { PaymentSection } from './payment-section';
import { generateRefundRequestToken } from '../../lib/payment/refund-action-state';
import { generateManualRefundRequestToken } from '../../lib/payment/manual-refund-action-state';
import type { OrderRefundRow } from '../../lib/payment/refund-read';
import type { ManualRefundRow } from '../../lib/payment/manual-refund-read';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';

// M-4a Slice B:訂單明細(server-render、唯讀;狀態/出貨/發票的「改」= Slice C 寫入片)。
// M-4b E10 A9w1(P3 九碼退場):本頁的九碼**全部下架** —— 品項列的 `ItemWorkflowStatusCell`
// 與 header 的整單彙總 badge(`summarizeOrderItemWorkflow` + `workflowStatusBadge`)一併移除,
// 品項列改顯示 A9g-1 三軸數量摘要;`statusOptions` prop 隨之消失(頁層不再讀狀態詞彙)。
// 列表側的九碼 cell 當時**不在本片** —— 🏁 已於 **A11a-1(2026-08-06)**隨列表重建退場。
// ⚠️ 上一段提到的 `summarizeOrderItemWorkflow` / `workflowStatusBadge` 兩個具名**現已不存在**
// (A11a-1 同片刪);保留這段是歷史敘述,別照著去 grep。
// 🔴 PII 邊界:本頁顯示客人姓名/電話/email+收件快照(admin-only、service_role、明細專用白名單);
// 仍零成本/經銷價(品項單價=該單成交價)、零 tappay_rec_trade_id。

// M-3 RW2d:退款入口的**顯示層**狀態閘(權威在 RPC 步 5 白名單 `20260803150000:530-532`:
// paid/partiallyRefunded 可退、refunded 回 LEDGER_FULL、其餘 NOT_REFUNDABLE)——
// 🔴 判斷本體與 `REFUND_ENTRY_STATUSES` 已於 **#445a-3** 搬到 `refund-entry-gate.ts`,
//    理由:445a-3 讓「未登記額讀取失敗」變成每張單都可達的狀態,那個閘需要 oracle,
//    而純判斷不該為了被測而在測試裡 mock `server-only`。**邏輯未變,只是換了位置。**

/**
 * A9w1:品項列的三軸顯示(取代九碼 `ItemWorkflowStatusCell`)。
 *
 * 資料源 = A9g-1 的 `quantitySummary`(`order_item_quantity_summary` 衍生快取,A4a trigger 維護)。
 * 🔴 `null` 的意思是「不知道」,**不是**「都是 0」(`packages/domain/src/order/types.ts:477-501` 逐字:
 *    品項從未被採購也從未被取消時根本沒有那一列)⇒ 這裡顯示「數量資料尚未就緒」、**不補 0**。
 *    純顯示補 0 的最壞後果只是少顯示資訊,但同一個 `?? 0` 一旦被抄進取消流程就會放行超量取消
 *    ⇒ 這一格從一開始就不留那個寫法可抄。
 * 🔴 **出貨軸本片仍不畫,但理由已經換了(L0,2026-08-13)**:
 *    ⚠️ 這段原本寫「`shipped_quantity` **目前不存在**」—— **那句現在是假的**:
 *    L0 已把它補進 `AdminOrderItemQuantitySummary` 與兩條投影(DB 側自 B2-S2b 就有)。
 *    🔴 留著錯字面的代價是具體的:下一個做狀態八值的人 grep 到這句,會得出
 *    「欄還沒有、要先做前置」的**反向結論**,而欄已經在手上。
 *    ⇒ 現在的正確理由是:**本片(明細頁)沒有要畫它**,不是拿不到它。
 */
/**
 * A10a-3:`?correct=<id>` → 表單更正模式的目標(含原型別 = MF1 radio 初值;節錄 40 字供辨認)。
 * 解析不到(不在已載入集合 —— 截斷後的書籤/返回、或已被更正 —— 並行 session 先更正了)
 * → 回 null,呼叫端**必須**顯示警告、不得靜默當一般新增(MF2);
 * RPC 端 `ALREADY_CORRECTED` / `CORRECTS_NOT_FOUND` 為第二道。
 */
function resolveCorrectTarget(
  detail: AdminOrderDetail,
  correctNoteId: string | null,
): CorrectTarget | null {
  if (correctNoteId === null) return null;
  const index = detail.notes.findIndex((note) => note.id === correctNoteId);
  const note = index === -1 ? undefined : detail.notes[index];
  if (!note || !canCorrectNote(note)) return null;
  const chars = [...note.body];
  return {
    id: note.id,
    seq: index + 1,
    noteType: note.noteType,
    typeLabel: NOTE_TYPE_LABEL[note.noteType],
    excerpt: chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : note.body,
  };
}

/**
 * 片2:標頭的付款狀態 chip(設計稿 §1 那顆紅色 `[未收齊]`)。
 *
 * 🔴🔴 **字面用既有的 `PAYMENT_STATUS_LABEL`,【不是】設計稿的「未收齊」—— 這是刻意的偏離。**
 *    設計稿寫「未收齊」,而 `partiallyPaid` 這一格的字面 **Sean 2026-08-18 才剛拍板過**
 *    (`Q3` = 「已收訂金」,`order-list-view.ts:170-176` 逐字記著理由:
 *     ~~付款確認中~~ 讀起來像「錢在路上」⇒ 員工不會去催尾款)。
 *    ⇒ 在**同一張畫面**上,標頭寫「未收齊」而下方付款卡寫「已收訂金」= 兩個詞指同一件事,
 *      那正是他抱怨過的「同一張單畫面講三句相反的話」。
 *    ⇒ **本片不引入第六個詞。** 要不要改成「未收齊」是 Sean 的題(已回報主視窗),
 *      改的話是**一行**的事,而且要**兩處一起改**。
 *
 * 🔴 **顏色的判準是「還欠不欠錢」,不是 enum 名字**:`unpaid` 與 `partiallyPaid` 都還欠錢 ⇒ 紅;
 *    其餘(含 `refunded` / `partiallyRefunded`)不紅 —— 退款單不該掛一顆催款色的 chip。
 *    ⚠️ 這個判準與 `order-edit-pay-axis.ts` 的三值軸**同語意但不共用**:那支服務改單矩陣、
 *       本處只決定一個顏色。**不要把顏色接到那支上去**,它的 `refunded ⇒ paid` 是為了
 *       「別讓改單以為這張單沒收過錢」,拿來決定顏色會是巧合對、不是同一個問題。
 */
function OrderHeadChip({ detail }: { detail: AdminOrderDetail }) {
  const owing = detail.paymentStatus === 'unpaid' || detail.paymentStatus === 'partiallyPaid';
  return (
    <span
      // 🔴 `shrink-0`(`W6-019` M1):它在標頭那一列裡,而**沒有它的東西會被【安靜壓扁】而不是溢出**。
      //    壓扁不像壞掉、像設計 ⇒ 連「拿去真瀏覽器給人看」那道驗證都騙得過去。
      /* 🔴 2026-08-23 夜:`rounded-md` → `rounded-full`。**依據是量到的,不是「圓角比較好看」**:
         線A 用 `tool-final-css.py`(五個世界自檢全 PASS)量 OD 產物的**頂層最終值**
         ⇒ `.od-pill` = `9999px`。而 Sean 同日逐字「都依照OD」「去看OD長怎樣,就怎樣」。
         📌 **這一格原本準備用「去數全樹那 18 處」來決定** —— 而真權威一直都在,只是沒有人去量它。
            **去數分母,是沒有真權威時才做的事。** */
      className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        owing ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
      }`}
    >
      {PAYMENT_STATUS_LABEL[detail.paymentStatus]}
    </span>
  );
}

export function OrderDetail({
  detail,
  returnTo,
  correctNoteId = null,
  suppliers = [],
  suppliersFailed = false,
  refundEnabled = false,
  refunds = [],
  refundsFailed = false,
  refundsTruncated,
  refundUnregisteredAmount = null,
  refundUnregisteredFailed = false,
  manualRefunds = [],
  manualRefundsFailed = false,
  manualRefundsTruncated = false,
  cancelFormsAllowed = false,
  customerHref = null,
  payments,
}: {
  detail: AdminOrderDetail;
  /**
   * #350d C1:這個視圖自己的網址,逐支表單當 `return_to` hidden 欄位送出。
   * 🔴 **必填、無預設**:給預設值等於「忘了接就靜默回整頁版」——面板裡的動作會把面板關掉,
   *    而那個症狀在測試裡看起來完全正常(頁面是對的、只是視圖換了)。逐條理由見 `order-return-to.ts`。
   */
  returnTo: string;
  /** A10a-3:`?correct` searchParam(頁層過 uuid 閘後下傳) */
  correctNoteId?: string | null;
  /** A10b:S3a 供應商選單(啟用中、zh-TW 排序) */
  suppliers?: readonly SupplierOption[];
  /** A10b:供應商清單載入失敗(不靜默;見 item-procurement-section) */
  suppliersFailed?: boolean;
  /** M-3 RW2d:退款入口旗標(頁層讀 `isRefundUiEnabled()` 下傳;預設 off)。 */
  refundEnabled?: boolean;
  /** M-3 RW3:退款帳本列(頁層讀;顯示不吃旗標 —— 既成事實必須可見)。 */
  refunds?: readonly OrderRefundRow[];
  /** M-3 RW3:帳本讀取失敗(區塊顯警告 + 發起入口 fail-closed,codex MF2)。 */
  refundsFailed?: boolean;
  /** M-3 RW3:帳本列被上限截斷(codex MF1)。 */
  /**
   * 🔴 **本檔唯一的必填旗標,而它是刻意的**(2026-08-24 codex R1 must-fix ①)。
   *
   * 病灶:`refund-entry-gate.ts` 那格已經是必填,**而必填只擋到最後一段** ——
   * 這一層若是 `?: boolean = false`,route 忘了傳 ⇒ 這裡靜靜填 `false`
   * ⇒ 閘拿到 `false` ⇒ **退款入口亮回來,而 typecheck 全綠**。
   * 🔴 **一道必填,在鏈上任何一段變成選填,整條鏈就回到選填。**
   *
   * ⚠️ **而它的兄弟還沒收**(照實寫,不要讀成「這一族都處理好了」):
   *   `refundsFailed` / `refundUnregisteredFailed` **同樣是選填 + 預設 `false`**,
   *   而 `false` 對它們一樣是**不安全的方向**(= 沒失敗 ⇒ 入口亮)。
   *   本片刻意只收這一格(scope = codex 指名的那條),其餘列為待辦、見交件檔。
   * 📌 `refundEnabled` 不在此列:它的預設 `false` 落在**安全**方向(關著=入口不顯示)。
   */
  refundsTruncated: boolean;
  /** M-3 RW3:`pcm_order_refundable_remaining`(措辭鐵律=「帳本未登記額」)。 */
  refundUnregisteredAmount?: number | null;
  /** M-3 RW3:未登記額讀取失敗(顯錯誤態≠查無 + 發起入口 fail-closed,codex MF2)。 */
  refundUnregisteredFailed?: boolean;
  /** M-4b E10 D3:非卡退款登記列(頁層讀;顯示不吃旗標,同 `refunds` 的立場)。 */
  manualRefunds?: readonly ManualRefundRow[];
  /** M-4b E10 D3:登記載入失敗(區塊顯示警告)。 */
  manualRefundsFailed?: boolean;
  /** M-4b E10 D3:登記列被上限截斷。 */
  manualRefundsTruncated?: boolean;
  /** A13b D6-a:這一次渲染准不准出現取消表單。**預設 fail-closed**,逐條理由見 `OrderCancelBlock`。 */
  cancelFormsAllowed?: boolean;
  /**
   * OD 片 3b:標題列「客人明細」入口的連結;**`null` = 不渲染入口**(需求檔 §0-J J-4)。
   *
   * 🔴 **由呼叫端決定連去哪**,本元件不知道自己在面板還整頁版裡(它同時被兩邊渲染):
   *    面板版 = `?panel=<單>&customer=<客>`(客人卡蓋上來);整頁版 = `/customers/<客>`。
   * 🔴 **`null` 必須真的不渲染**(fail-closed):`AdminOrderDetail.customerUserId` 在投影退版時
   *    是 `null`,而拼網址的決定點在 `order-detail-view.ts` 的 `customerDetailHref()` ——
   *    拼不出來就回 `null`,這裡照著不畫。**不得 `?? ''`、不得畫一個連到 `/customers/null` 的連結。**
   */
  customerHref?: string | null;
  /**
   * #15-B2-c 片1a:收款明細三態(頁層讀 `listOrderPayments` 折出來)。
   *
   * 🔴 **必填、無預設**(同 `returnTo` 的立場):給預設值等於「忘了接就靜默顯示成某一態」——
   *    而這裡任何一個預設都會說謊:`ok/[]` 說「沒收過款」(員工照著再登一次 ⇒ 重複入帳)、
   *    `unreadable` 說「讀取失敗」(對一個其實讀得到的頁面亂報錯)。忘了接**必須編不過**。
   */
  payments: PaymentListData;
}) {
  const cancelled = detail.cancelledAt !== null;
  const correctTarget = resolveCorrectTarget(detail, correctNoteId);

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
  /**
   * 🔴 SUB2-009:帳本裡有沒有「人工判定沒動到錢」而卡住的列。
   *
   * **算在這裡、不算在閘裡**:閘吃的是旗標(它是純判斷、不認識列),
   * 而判準本身住在 `refund-ledger-view.ts` —— 這裡只是把它套在列上,**不複製那個判準**
   * (複製一份就是下一個漂移點,同檔頭那條「兩處各養一份 label」的教訓)。
   * ⚠️ 這一顆**刻意不併進 `refundLedgerAbnormal`**:它不是對帳異常,掛紅標題會說謊
   *    —— 與 `refundsTruncated` 同一個理由。
   */
  const hasStuckRefundVerdict = refunds.some((r) => isStuckManualVerdict(r));

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
   * 分母 = 本元件 16 個 props 逐一過、逐個開消費元件看它渲染什麼、渲染在哪一頁:
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
   * ⚠️ 截斷紅區住在「退款」收合塊【裡面】⇒ 只開分頁不夠,defaultOpen 也要接(見下)。
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

  /* ═══ 🔴 分頁上那顆「還有未收款」紅點(OD FIX-11)—— **本片刻意沒有做** ═════════════
     ① **它不在本條線的 FIX 清單裡**(線A 2026-08-23 補齊後的清單:
        01/02/03/04/05/06/07/08/17/18/44/45/46/69/72 —— **沒有 11**)。
     ② 🔴 **而且它會踩到一條明文的復審閘**:我第一版真的寫了那一行(吃同一支彙總函式),
        跑測試時 `payment-amount-due-single-source.test.ts` 當場紅 ——
        那一格逐字寫著「**恰有 3 個呼叫端 —— 多一個就要有人看過這條不變式**」。
        ⇒ **那不是它壞了,是它在做它的工作。** 多一個呼叫端本身就是要被人看過的事,
          不是我可以順手決定的。⇒ 撤回,寫進交件檔的待決事項。
     ⚠️ 連帶:FIX-45 的「兩個狀態指示器在藍底上要翻色」只做到**徽章**那一半(FIX-44②,在清單裡);
        **紅點那一半沒有對象可翻**。`order-detail-tabs.tsx` 的 `dot` 支援也一併不留 ——
        留一個沒有呼叫端的介面,下一個人會以為它已經接好了。 */

  return (
    <OrderDetailTabs
      /* 🔴🔴 **must-fix 1(審查抓,2026-08-23):`key` 是【承重的】,不是效能優化。**
         情境:面板停在單 A,員工點列表上**單 B** 的取消鈕(`orders-table.tsx:593` 是 Next `<Link>`)
         ⇒ 那是 client-side 導航,**`pushState` 不發 `hashchange`** ⇒ 本元件不 remount、
           `syncFromHash` 那個 effect 不重跑 ⇒ **停在「商品·出貨」**;
           而 `DangerZoneDetails`(它自己有 `key={detail.id}`)在一個 `hidden` 的分頁裡把自己 `open`
         ⇒ **員工點「取消」連過去看到空白。**
         🔴🔴 **而這個坑本檔 `:739` 附近【早就逐字寫過】**:「換單就換 key ⇒ 強制重新掛載
            ⇒ effect 一定重跑一次讀 hash」—— **同一個坑,新元件沒跟上。**
            📌 判別句:**我把一個舊元件的承重理由讀懂了,不代表我把它套用到我新寫的那個。**
         ⚠️ 而我交件檔 §2 寫「`#cancel` 深連結…已處理」—— **那句是假的**,已更正。 */
      key={detail.id}
      /* 🔴 起始分頁三選一,**順序有意義**:
         ① `?correct=<id>` ⇒ 「備註」—— 那個網址的**唯一用途**就是更正一則備註,而表單住在備註頁。
            ⚠️ 它與 `correctionMissing` 那條警告不是同一件事:解析不到目標時警告仍要顯示,
               而警告也在備註頁 ⇒ 兩種情形都停這一頁。
         ② 🔴🔴 **must-fix 2(審查抓):對帳異常 ⇒ 「收款·退款」。**
            `refundLedgerAbnormal`(`:230` 附近)為真時,那一塊會**自己展開**並印紅標題
            「退款(對帳異常)」與「勿再發起退款」—— 而分頁把它藏起來
            ⇒ 員工開單落在「商品·出貨」,**那些字一個都看不到**。
            🔴 **本檔自己寫過這個判準**(搜 `退化成沉默`):「那類警告存在的唯一理由就是要員工看到它
               …把一個 fail-closed 的安全設計,退化成一個沉默的安全設計」
               ⇒ **分頁化把我自己防過的那件事又做了一次。**
            ✅ 修法**不碰那道閘**:只決定「開單時先看哪一頁」,`shouldShowRefundEntry`、
               `defaultOpen`、`refundLedgerAbnormal` 的算法一個字沒動。
            ✅ **而它不吃 `toPaymentSummary`** ⇒ §3-② 那道「恰有 3 個呼叫端」的復審閘管不到它。
         ⚠️ **①贏過② 是刻意的**:`?correct=` 是員工**點連結表達的明確意圖**,把他丟到別頁 = 那條連結壞掉。
            🔴 **代價寫明(兩條,都是已知殘餘)**:
            ① 一張「對帳異常 + 帶 `?correct=`」的單,警告仍會被藏起來。
            ② 🔴 **`initialKey` 只在 mount 讀一次**(`order-detail-tabs.tsx` 的 `useState` 初值)——
               同一張單 revalidate 之後 `refundLedgerAbnormal` 由 `false` 翻 `true` 時,
               `key={detail.id}` **刻意不 remount**(那是 must-fix 1 要的)⇒ **警告仍被藏。**
               ⚠️ 這與 ① 是**同一個失敗模式**(起始頁只算一次),不是兩個獨立的洞。
               📌 而 `key` 不能改成「異常時也換」——那會把 must-fix 1 換成一個更難查的 bug。
               ⇒ 真解仍是那顆紅點(FIX-11):**它不依賴「開單當下停在哪一頁」。**(R2 N6)
               兩者都罕見、同時發生更罕見,**但那不是零** —— 真正的解法是那顆紅點(FIX-11,見 §3-②),
               它被那道復審閘擋著。**這一格是已知殘餘,不是已解決。** */
      /* 🔴 ② 的判準 2026-08-24 由 `refundLedgerAbnormal` 擴成 `moneyTabMustSee`(codex MF-1/MF-2):
         上面那段講的「對帳異常 ⇒ 收款·退款」仍然成立,只是它現在是分母表的其中四列 ——
         截斷兩態與收款讀不到,藏起來的病一模一樣。已知殘餘 ①② 照舊(起始頁只算一次)。 */
      initialKey={
        correctNoteId !== null ? 'notes' : moneyTabMustSee ? 'money' : 'items'
      }
      header={
        <div className='space-y-4'>
          {/* ═══ 片2 標頭列 —— **單列**(逐字搬設計稿 `.hdr`)═══════════════════════
              **來源**:OD 專案 `pcm-admin-order-ui` / `overview-desktop.html`
              (`/Users/sean_1/Library/Application Support/Open Design/namespaces/release-stable/
                data/projects/pcm-admin-order-ui/overview-desktop.html`,**mtime 2026-08-13 16:16**)。
              ⚠️ **可能存在更新的一版而我們沒找到** —— Sean 提過有一份「昨天改過」的 artifact,
                 主視窗已去問他;**在他回答之前照這一份做**。搬的是哪一份、哪一天,寫在這裡不寫在別處。

              **設計稿逐字(`:1105-1118`)**,由左到右:
                單號 · 付款 chip · 客人入口 · **金額** · 下單時間 · (彈性空白) · 狀態 chip · ⋯ · ✕
              **版面(`:219`)**:`height:38px; flex:0 0 38px; display:flex; align-items:center; gap:9px; padding:0 12px`

              🔴🔴 **上一版我把它做成【兩列】,那是錯的,而根因值得留**:
                 我照的是 `MAIN-057 §1` 的 **ASCII 轉錄**,那張圖長兩行 ⇒ 我把它讀成設計。
                 **而 ASCII 轉錄天生表達不了「這是換行」還是「這只是排不下才折」。**
                 設計稿真正有 `flex-wrap:wrap` 的那一版在 `:553` 的 `@container (max-width:520px)`,
                 而那個 media query 上方註解逐字「**手機 ≤520:標題列合併**」
                 ⇒ **我把手機版的形狀套到桌機了**;面板固定 720 ⇒ **永遠不會命中 ≤520**。
                 (Sean `A2` 拍板「員工用電腦」⇒ 桌機那一列才算數。)

              ✅ **裝得下,是量到的不是推的**:直接把設計稿當成能跑的 HTML 起 server 渲染,
                 量它自己的 `.hdr` ⇒ **設計稿自己的面板是 674px(比我們鎖的 720 還窄)**、
                 `flex-wrap: nowrap`、實測高 36px、**不換行**;
                 餵最壞資料(長客名 + 七位數金額 + 長狀態)⇒ **彈性空白仍剩 120px**。
                 ⚠️ 量具自檢:我第一把尺 `scrollWidth - clientWidth` 是**瞎的** ——
                    flex 子元素預設 `flex-shrink:1` ⇒ 它們互相壓縮、不產生溢出 ⇒ 兩個世界印同一個 0。
                    改量**彈性空白**才會動(荒謬長字 ⇒ 0 / 正常 ⇒ 119)。

              🔴 **`✕` 不在本元件**:關閉是**面板才有**的動作,而本元件同時被整頁版渲染。
                 關閉連結由 `order-detail-route.tsx` 的 `BackLink` 畫、文案由各呼叫端傳。
                 ⚠️ 已知偏離:設計稿的 `✕` 在**同一列最右**,而 `BackLink` 是**上方自成一行**。
                 要同列得讓本元件收 `closeSlot` prop、兩個呼叫端各傳一份 ⇒ 跨元件手術,不屬本片。

              🔴 **設計稿有、本片【刻意不做】的一顆**:`:1116` 的 `⋯ 更多操作`。
                 理由:**它是一個沒有行為的入口,做了會是死按鈕。**
                 (與 Sean 2026-08-19 對包裹卡那四顆鈕拍「甲 = 不做」同一個理由。)
                 ⚠️ **不寫成 TODO** —— TODO 讀起來像「快做了」,而它其實在等一個功能決定。

              🔴 **本片【拿掉】了上一版自己加的「發票」那一格**:設計稿標頭沒有它,
                 而它與兩列標頭**同一個根因**(從 ASCII 推的)。鐵則 1:不反向遷就。
                 ⚠️ 「標頭要不要顯示發票狀態」已列進 Sean 的肉眼題清單,**不是消失**。
                 📎 而背景要一起帶:正式庫 19 張單**零張有發票**、三個欄位全空、零流程在填
                    ⇒ **發票是【流程的缺口】,不是【標頭少一格】。不要用一個欄位替一個不存在的流程作代表。**

              🔴🔴 **本片改的是【兩個視圖共用】的標頭 ⇒ 整頁版 `/orders/[id]` 也跟著變,
                 而【沒有人看過整頁版的畫面】** —— 已列進交件檔「需肉眼驗」清單,不要當成已驗。 */}
          {/* 逐字搬 `:219`:`gap:9px` / `height:38px` / `align-items:center` / **`nowrap`**。
              **不換算成 Tailwind 級距**(鐵則 1 禁翻譯)⇒ 用 `gap-[9px]` / `h-[38px]`。
              `min-w-0` 給下面的客人入口截字用:沒有它,長名字會把整列撐開而不是自己截。

              🔴🔴 **這一列每一顆都要 `shrink-0`,唯一的例外是客人名(`W6-019` M1)**:
                 flex 子元素**預設 `flex-shrink:1`** ⇒ 空間不足時它們**安靜地互相壓扁,而不是溢出**。
                 · 而 spacer 的 `flex-basis` 是 0 ⇒ **它本來就沒東西可縮** ⇒ 壓力全落到別人身上。
                 · 更糟的是 **spacer 量到 0 之後【飽和】** ⇒ 分不出「剛好到邊」與「chip 和按鈕已經被壓爛」
                   ⇒ **我用來判斷『裝不裝得下』的那把尺,在最需要它的時候失去判別力。**
                 🔴 **而它會連下一道驗證一起騙過去**:我把長相交給「真瀏覽器 + Sean 的眼睛」,
                    而**一列安靜壓縮的版面,在瀏覽器裡看起來就是「裝得下」——壓扁不像壞掉,像設計。**
                 ⇒ 修完之後唯一可縮的只剩客人名(它 `truncate` 是設計好的),再不夠就**看得見地溢出**。 */}
          {/* 🔴 FIX-72②(OD,OPEN-05):**窄的時候要換行,而不是把整頁撐開。**
              OD 實量 820px 視窗:內容寬 686 / 需要 728 ⇒ 舞台出現橫捲;
              面板版早在 FIX-18 做過同一件事,**整頁版漏了**。
              🔴 **`flex h-[38px] flex-nowrap` 這串字面【刻意原封不動】**:桌機那一列的形狀
                 是量出來的(設計稿自己的面板 674px、`nowrap`、實測高 36px、彈性空白仍剩 120px),
                 本片**沒有推翻它** —— 只是在**容器真的裝不下**的時候放開。
                 ⚠️ 順帶:`order-detail-header.test.tsx` 用 `indexOf('flex h-[38px] flex-nowrap')`
                    當標頭那一列的定位錨。**它守的東西沒變,所以錨也不該被弄丟。**
              🔴 **用【容器】查詢不是 media query**:面板被拖窄而視窗很寬是桌機常態,
                 media query 在那時候不會生效 —— FIX-18 逐字記過這一格:
                 「FIX-13 只處理了『視窗窄』…面板被拖窄但視窗很寬(桌機常態)媒體查詢不會生效」。
              🔴 **門檻 820px 是抄 OD 的,不是我挑的**。他的規則逐字:
                 `@container (max-width:820px){[data-od-id="panel-header"] .flex-nowrap{flex-wrap:wrap;height:auto;row-gap:4px}}`
                 —— 而 820 是 FIX-08 v16 **量出來的**(6 欄列最少 722px + 卡片與分頁區內距 64 = 786;
                 面板 760 時仍走寬版就會把小計切掉)。
                 ⚠️ **我第一版寫 `@max-2xl`(672px),那是我自己挑的、比量到的門檻低 148px**
                    ⇒ 面板寬落在 672–820 之間時抬頭仍然 `nowrap`、仍然會溢出。**已改成逐字的 820。**
                    🔴 判別句:**這個數字是量到的,還是我挑一個看起來差不多的?**
              ⚠️ **`@max-[…]` 這個變體本 repo 之前零使用** ⇒「Tailwind 編不編得出來」是真問題,不是形式。
                 已對**真 build 產物**驗過,規則原文抄在交件檔裡。 */}
          <div className='flex h-[38px] flex-nowrap items-center gap-[9px] @max-[820px]:h-auto @max-[820px]:flex-wrap @max-[820px]:gap-y-[4px]'>
            <h1 className='shrink-0 text-2xl font-semibold'>{detail.displayId}</h1>
            <OrderHeadChip detail={detail} />
            {/* 🔴 入口位置照 OD `overview-desktop.html:1109-1112` 逐字:「客人明細的入口。
                **做在標題列的名字上**,因為那是『這張單是誰的』唯一會被讀的位置,
                員工要查電話/地址時眼睛本來就落在這裡。一下就開,不用先跳到客戶頁再搜尋。」
                ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
                   這一句退場文案是**我自己決定的**,OD 沒有畫這個狀態。 */}
            {/* A9w1:整單九碼彙總 badge 退場。付款軸(三軸的訂單層)在下方「付款」卡的付款狀態,
                訂貨/到貨在品項列 —— 不另補一顆彙總 badge,那正是九碼被退場的東西。 */}
            {/* 🔴 `rounded-md` 不是 `rounded-full`:Sean 2026-08-16 拍板「狀態膠囊改方角,
                全站統一、沒有例外要記」(memory `project_0816-sean-morning-13-rulings.md:22` Q5、
                `project_0816-evening-five-rulings.md:33` 再確認)。
                ⚠️ **這一顆是漏網的** —— 列表那邊 08-16 已改(`orders-table.tsx` 的 `rounded-full` 現為 0),
                   而本檔這顆沒跟上,且 `design-tokens.test.ts` **沒有任何一條在管 `rounded-full`**
                   (STATUS.md Blocker 欄逐字記著這件事)⇒ 它不是被放行,是**根本沒有那道門**。
                   本片只改我正在動的這一顆,**不順手掃全樹的 18 處**(那是另一片、要自己的分母)。
                🔴 **2026-08-23 晚:上面整段的【前提】被 Sean 自己推翻了(原句不改,加註)** ——
                   他逐字裁「乙 不算了 —— 照 OD 新稿,**全部圓角**」,線A 已把 `--radius` 由 0 改成 8px、
                   四階 xs2/sm4/md6/lg8/xl12。
                   ⇒ **這顆 chip 的 `rounded-md` 現在是 6px,不再是方角** —— 而**我一個字都沒改它**。
                   🔴 **這一格最值得記的形狀**:同一串 class、同一個檔、零 diff,而**畫出來的東西變了**,
                      **且沒有任何測試會紅** —— 值住在別人的 token 裡。
                      ⇒ 「我確認過這個 class」不等於「我確認過它會畫出什麼」。
                   ✅ **2026-08-23 夜已決:改回 `rounded-full`(見上方那段的量測出處)。**
                      🔴 **而 08-16 那條「狀態膠囊改方角、全站統一沒有例外」現在【整條作廢】** —— 不是只有這一顆。
                      🔴🔴 **⚠️ 我在這裡寫過一句「列表方角、明細圓角,兩邊不一致」—— 那是【錯的】,而錯法值得留。**
                         我從「**我改不到 `order-list-view.ts`**」推出「**那支檔沒被改**」,
                         中間少了一步:**有沒有別人用別的路做到同一個效果?**
                         實查(我自己 grep,不是聽來的):
                           · `order-list-view.ts:213` `STATUS_CAPSULE = 'inline-flex px-2 py-0.5 text-xs font-medium'`
                             ⇒ **它本來就沒有任何 `rounded-*`**,形狀從來不是它給的
                           · `globals.css:1956-1959` `.cap-n,.cap-y,.cap-bl,.cap-g,.cap-risk{border-radius:9999px!important…}`
                             ⇒ **列表膠囊今天已經是圓的**(線A 搬 OD 樣式時一起進來)
                         ⇒ **兩邊一致,而且不需要動 `order-list-view.ts` —— 那條路是空的。**
                         📌 判別句:**檔案歸屬答的是「誰動了哪支檔」,答不出「這個效果現在是什麼」。**
                      ⚠️ 而**本檔這顆 chip 不吃 `.cap-*`**(它有自己的一串 Tailwind)⇒ 上面那行 `rounded-full` 仍然要自己寫。
                      📌 「全樹 18 處」那個分母**始終沒有人數過**,而它現在也不需要了:
                         真權威是 OD 產物的最終值,逐個元件去量,不是數我方有幾處。 */}
            {/* 🔴 客人入口 —— OD `:1110-1111` 逐字:「客人明細的入口。**做在標題列的名字上**,
                因為那是『這張單是誰的』唯一會被讀的位置,員工要查電話/地址時眼睛本來就落在這裡。」
                設計稿的形狀是 `<button class="cus cuslink">${o.cus}<span class="ci">›</span></button>`(`:1112`)。
                ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
                   **這句退場文案是我自己決定的,OD 沒有畫這個狀態。**
                🔴 `truncate` + `min-w-0`:長名字自己截,不要把整列撐開(`.cuslink` 在設計稿裡也不吃固定寬)。 */}
            {customerHref !== null && (
              <Link
                href={customerHref}
                className='text-primary hover:bg-muted inline-flex min-w-0 shrink items-center gap-0.5 truncate rounded-md px-1.5 py-0.5 text-[13px]'
              >
                <span className='truncate'>{detail.customer.name ?? '客人明細'}</span>
                <span aria-hidden='true' className='text-muted-foreground shrink-0'>
                  ›
                </span>
              </Link>
            )}
            {/* 🔴 金額 —— 設計稿 `:1113` 逐字 `<span class="amt">NT$ ${money(tot)}</span>`。
                **上一版沒做也沒揭露**(`W4-004` 判「這是漏,不是偏離」)。
                ⚠️ **這裡帶 `NT$`,而頭條那三格不帶** —— 那**不是不一致**:
                   Sean 2026-08-16 拍過「頭條速覽不用 NT」而「明細表底部的總計是正式金額、帶 NT$」
                   (`Q-A216-F4` 拍乙「留著」);**而設計稿這一格自己就寫著 `NT$`** ⇒ 兩個來源同向。 */}
            <span className='shrink-0 text-[13px] tabular-nums'>
              NT$ {formatOrderAmount(detail.total.amount)}
            </span>
            {/* 下單時間 —— 設計稿 `:1114` `<span class="dt">${o.d} 14:05</span>`。 */}
            <span className='text-muted-foreground shrink-0 text-[13px]'>
              {formatOrderDateTime(detail.createdAt)}
            </span>
            {/* 🔴 彈性空白 —— 設計稿 `:1115` `<span class="sp"></span>`,它把右邊那組推到最右。
                **它就是我用來量「裝不裝得下」的那一格**:它的寬度 >0 代表還有餘裕、=0 代表擠到底了。 */}
            <span className='flex-1' />
            {/* ⚠️ **這一顆跟著上面那顆一起改 `rounded-full`,而依據弱一階,明說**:
                線A 量到的是 `.od-pill`,**他沒有給我「已取消」這一顆在 OD 的 selector**。
                我是**從「同一列、同一串 class、同一種狀態膠囊」推的** ——
                只改其中一顆會讓同一列出現兩種形狀,那比兩顆都推錯更難看。
                🔴 **這是推的不是量的**,若之後量到 OD 這顆是別的值,改它一個字即可。 */}
            {cancelled && (
              <span className='bg-destructive/10 text-destructive inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium'>
                已取消
              </span>
            )}
            {/* #10 片1:揀貨單入口。**開新分頁**(`target='_blank'`)—— 員工按了列印之後要回到這張單
                繼續做事,把工作面換掉再叫他按上一頁是多一步。
                🔴 `rel='noopener'`:`target='_blank'` 預設會把 `window.opener` 交給新分頁。
                   這裡兩邊同源、風險低,但這是**寫一次就不用再想**的東西。
                🔴 **已取消就不給入口**(R1 must-fix 3)。第一版我無條件渲染,而 `:312` 的「已取消」
                   badge 明明就守著同一顆 `cancelled` —— 同一列裡一個守、一個不守。
                ⚠️ **但這裡只是 UX,不是守門**:網址可以被貼、被書籤、或分頁開著時訂單才被取消,
                   那些路徑全部繞過這顆鈕。真正的守門在 `components/print/picking-doc.tsx`
                   (已取消 ⇒ 不印品項表)。**兩層都要,少了下面那層這顆鈕等於零。**
                📍 位置在 `ml-auto` 的日期**之前**(nit-12):放後面會被推到整列最尾端、
                   與 `:300` 的客人入口分兩側,員工要找兩個地方。 */}
            {!cancelled && (
              <Link
                href={`/print/orders/${detail.id}/picking`}
                target='_blank'
                rel='noopener'
                className='border-border bg-card hover:bg-muted text-foreground inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-sm'
              >
                訂單明細
              </Link>
            )}
          </div>
          {/* 🔴 片4b:`payments` 是頭條「已收」的來源 —— 傳的是**原始 `PaymentListData`**,
              不是算好的金額。理由:元件內部要吃 `toPaymentSummary()`(與付款卡同一支函式),
              `unknown` 那態才畫得出「未知」而不是一個假的 0。 */}
          <OrderFocalRow detail={detail} payments={payments} />
          {cancelled && (
            <div className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
              <span className='text-destructive font-medium'>
                已取消({detail.cancelledAt ? formatOrderDateTime(detail.cancelledAt) : '—'})
              </span>
              {detail.cancelledReason && (
                <span className='text-muted-foreground ml-2'>原因:{detail.cancelledReason}</span>
              )}
            </div>
          )}
        </div>
      }
      /* ═══════════════════════════════════════════════════════════════════════════
         🔴🔴 **讀下面那些「位置 / 順序」的註解之前先讀這一段 —— 它們的射程被分頁縮小了。**

         分頁化之前,這支檔的子區塊是**一條直上直下的長捲軸**,所以「A 排在 B 之後」是
         一句對整張畫面成立的話。**現在不是了**:順序只在**同一個分頁之內**成立,
         跨分頁的先後由**分頁順序**決定,而分頁順序是 OD FIX-07 定的四組。

         🔴 **而其中一句是 Sean 親自拍的板,必須端給他,不能由我吸收掉**:
            2026-08-18 他逐字拍 `09 收款區搬到到貨之後 = 甲`
            (memory `project_0818-sean-eleven-rulings-noon.md:19`),理由是員工「做事」的動線
            **…到貨了 → 收尾款 → 出貨**。
            ⇒ 那條動線在分頁化之後**跨了兩個分頁**:採購與到貨在「商品 · 出貨」、收款在「收款 · 退款」。
            ⇒ **他要的相鄰關係沒有了**,換成「切一次分頁」。
            ⚠️ 這**不是**我在推翻他 —— OD FIX-07 的分組是他這一輪要的;而**兩件事會互相咬**。
            ✅ **2026-08-23 Sean 已裁:「甲 依照OD」** —— 收款留在「收款 · 退款」頁,
               `09 收款區搬到到貨之後 = 甲` 那條板的**相鄰要求就此讓位給分頁分組**。
               🔴 **他知道代價**(選項端給他時逐字寫著:「做事時『看到貨 → 收尾款』要切一次分頁」)
                  ⇒ **這不是被漏掉的,是被換掉的。**
               ⚠️ **08-18 那條板本身沒有被作廢** —— 它在**同一頁之內**仍然成立
                  (收款仍排在退款之前、危險操作仍沉底)。作廢的只有「跨區塊相鄰」那一半。
               📌 **不要拿 08-18 那條去把收款搬回「商品 · 出貨」頁** —— 那會推翻 08-23 這次。

         📌 下面每一塊的註解**一個字都沒改**(它們記的理由與踩過的坑仍然有效),
            只是「在頁面的哪個位置」那一半現在要配著這一段讀。
         ═══════════════════════════════════════════════════════════════════════════ */
      tabs={[
        {
          key: 'items',
          label: '商品 · 出貨',
          content: (
            <>
              {/* 🔴 片7:採購那張獨立的卡不見了 —— 它現在住在**每個商品自己的卡片展開區**裡
                  (Sean 2026-08-19 看真畫面後選「甲 = 卡片版」)。
                  ⇒ 這三個 prop 是**跟著採購一起搬過來的**,不是表格自己要用的。 */}
              {/* 🔴🔴 片C(取消介面搬家):`order-detail.tsx`(579 行)本次僅新增一個 prop 傳遞(1 行)。
                  『下一次動這支檔先抽再改』那條裁定,主視窗 2026-08-20 對【本次這一行】豁免;
                  對這支檔的【下一次非一行改動】仍然生效,不因本次豁免而作廢。 */}
              <ItemsTable
                detail={detail}
                payments={payments}
                returnTo={returnTo}
                suppliers={suppliers}
                suppliersFailed={suppliersFailed}
                cancelFormsAllowed={cancelFormsAllowed}
              />
              {/* 2c:出貨卡。**查看與補救用,不是主要建箱動線**(建箱走訂單總覽勾單、Sean 拍 S1=A)。
                  位置 = 採購與到貨 → 收款 → **出貨**,收在頁面主流程的最後一步
                  (2026-08-18 收款搬位後更新這一行;~~原寫「放在採購之後、備註之前」~~ 兩半都已不成立:
                   備註 2026-08-13 搬到發票卡下方、收款 2026-08-18 插進採購與出貨之間)。 */}
              {/* 🔴 片9:`payments` 傳的是**原始 `PaymentListData`**,不是算好的尾款 ——
                  出貨區內部要吃 `toPaymentSummary()`(與付款卡、頭條同一支),
                  在這裡先算好等於在第三個地方複製一份「尾款」的定義。 */}
              <ShipmentSection detail={detail} payments={payments} />
            </>
          ),
        },
        {
          key: 'money',
          label: '收款 · 退款',
          /* 🔴 **`#cancel` 是既有深連結的目的地**(列表那兩條),而它住在這一頁的取消區裡。
             沒有這一格,那兩條連結會連到一個 `hidden` 的區塊 —— 而 `order-detail.tsx` 自己
             早就寫著「收起來就等於連過去看到空白」。**分頁把「收起來」又做了一次。** */
          hashes: ['cancel'],
          content: (
            <>
              {/* #15-B2-c:已登錄的收款明細 + 登錄表單(片2a 起同一張卡,Sean 拍板 Q-D2=A)。
                  🔴 位置 = 採購與到貨【之後】、出貨之前(2026-08-18 Sean 逐字 `09 收款區搬到到貨之後 = 甲`;
                  出處 memory `project_0818-sean-eleven-rulings-noon.md:19`,plan
                  `docs/specs/2026-08-18-m4b-order-detail-payment-block-order-plan.md`)。
                  🔴 這個位置推翻了原本寫在這裡的一個理由,而**那個理由不是錯的** —— 兩個都成立:
                    看單  打開這張單想知道現況 ⇒ 付款狀態 → 錢收了哪幾筆   ← 原安排(收款緊跟付款/發票那一組)
                    做事  要把這張單往前推一步 ⇒ …到貨了 → 收尾款 → 出貨   ← Sean 09=甲 拍的是這個
                  搬**之前**量到的病(過去式,不是現況):收尾款得捲回頁面上方 ↑2,578 px
                  (5 品項單;真後台真資料 viewport 1728×1117、**拋棄式庫非正式站**)。
                  搬之後那一步是 ↓569。⚠️ **折返沒有消失,只是換了位置** —— 收訂金現在也在採購下面,
                  第 1→2 步變成 ↑2,322。Sean 的五步裡收款出現兩次,線性頁面在其中一次會折返。
                  (所以不要寫「唯一的折返」——那句在改前改後都不成立。)
                  **留著這段是為了不讓下一個人照「看單」那個理由把它搬回去。**
                  ⚠️ 只動渲染順序:零 props、零查詢、零業務邏輯改動。
                  🔴 **但不要寫成「什麼行為都沒變」** —— DOM 順序就是鍵盤 Tab 與螢幕閱讀器的朗讀順序,
                  它跟著一起變了(codex 對抗審查 2026-08-18 抓到)。這是**這片本來就要的效果**、不是副作用,
                  但它是行為。「已取消」橫幅留在原地(訂單層狀態、不屬收款)。
                  退款相關的兩塊刻意留在頁尾(危險操作沉底,見 `RefundSection` 那段),不與收款混在一起。 */}
              {/* 🔴 `detail.total.amount` 與 `order_payments.amount` **同單位(整數元、非分)**:
                  前者見 `order-list-view.ts:675` 逐字引 migration `20260604120000`「金額一律 integer 元位」,
                  後者見 `order_payments.amount` 欄 COMMENT 逐字「整數元、非零」⇒ 彙總行直接相減、零換算。 */}
              <PaymentSection
                orderId={detail.id}
                returnTo={returnTo}
                payments={payments}
                amountDue={detail.total.amount}
              />
              {/* 🔴 `#841`:這一整塊(判斷 + 文案)**2026-08-23 抽到 `order-hidden-notice.tsx`** ——
                  理由是 `:421-423` 那條 standing ruling(「下一次非一行改動先抽再改」),而本片就是那個下一次。
                  🔴 **判斷不留在這裡**:它必須逐項對得上 `SupabaseOrderAdapter.ts` 那句述詞的隱藏面,
                     而那個對應關係寫在新檔的檔頭。改述詞的人要去那裡。 */}
              <OrderHiddenNotice
                paymentChannel={detail.paymentChannel}
                paymentStatus={detail.paymentStatus}
                cancelled={cancelled}
                payments={payments}
              />
              {/* ═══ 危險操作沉底:取消 / 退款 ═════════════════════════════════════════════
                  🔴🔴 **鈕上不得出現「退貨」二字**(2026-08-19,W1)——
                     **退貨整條功能在本 repo 一行程式碼都沒有**,而這顆鈕原本寫著「退貨 / 退款」
                     ⇒ 那是一顆通往不存在功能的入口。
                     權威 = **Aug-17 18:39「720 側邊欄確認稿」**(`<title>` 逐字;
                     `~/.claude/projects/-Users-sean-1-pcm-website-v2/07788b5a-.../tool-results/
                      artifact-c3c6cc94-1786959567-bf41.html`,另見 `globals.css:1460` /
                      `order-detail-items-table.tsx:228` 兩處也指著它):
                       `:429` 區塊標題逐字「取消 / 退款」、`:431` 鈕逐字「線上退款(TapPay)」
                       `:432` 逐字「🔴 退貨 —— 整條功能後台沒有。畫面已經改成講明
                                    『退貨功能目前還沒有』,不會叫你去走。」
                     ⚠️ **這覆蓋了 Aug-13 稿的「退貨 / 退款」**,而片12 當時照的是 Aug-13
                        (經由二手轉述 `MAIN-057`)⇒ **不是兩份稿打架,是後者明文處理了前者沒處理的問題。**
                     📎 同族的另一處早就改對了:`cancel-review-section.tsx:142` 逐字
                        「而退貨功能目前還沒有」(2026-08-14 止血)⇒ 本次是把**最後一處**補齊。
                  🔴 **取消從第 ④ 位(夾在收款與品項中間)移到這裡**(2026-08-16)。
                  **兩個獨立來源都說墊底,而【當時的】現況兩邊都不符** ⇒ 這是**缺陷不是選項**,不需要拍板。
                  (2026-08-18 修字面:那句原本是現在式,而它描述的是 08-16 改**之前**;現在已經墊底了。)
                    · Sean 逐字(`docs/specs/2026-08-12-admin-order-ui-design-brief.md` 搜
                      `回去採購等於說跟國外下單`,同段末):「最難的大概就是取消,**所以放最下面沒問題**」
                    · OD 定案主稿 `overview-desktop.html` 搜 `危險操作沉底` —— 同一句話的設計版
                  ⚠️ **只動渲染順序,零 props / 零查詢 / 零業務邏輯改動**:`OrderCancelBlock` 的 props、
                     `cancelFormsAllowed` 的算法、它自己的判斷全部一個字沒動。
                     🔴 **這裡原本還寫了一句「什麼行為都沒變」,2026-08-18 撤回**(codex R2 抓到,
                     與收款搬位那段同一個病):搬動含互動元件的區塊會改變**鍵盤 Tab 與螢幕閱讀器的朗讀順序**
                     —— 那也是行為。(撤回句刻意不留原字面:留著的話字面掃描會一直命中一句已經作廢的話。)
                  📎 **與 OD 的最後一塊對齊**:OD `more` 區塊 = 取消 → 退貨/退款面板(同一塊、取消在前)
                     ⇒ 我方擺成 取消 → 退款帳本 → 退款入口,是同一個順序。
                  🔴 **這片可能會被之後的版面重排吸收掉**(`~/pcm-mailbox/A-218-demo-brief.md`
                     那一輪若改掉整個面板編排)—— **那不是白做**:它**現在**就是缺陷,
                     而 demo 那一輪還要好幾天。 */}
              {/* 🔴 片12(2026-08-19):設計稿區塊⑥ —— 面板最底是**一列兩顆鈕**:
                     `[退款]                            [申請取消整張單(紅)]`
                     (~~原寫 `[退貨 / 退款]`~~ —— 那是 Aug-13 稿的字面,已被確認稿覆蓋,見上一段。)
                  ⇒ 三大塊(複核 / 退款帳本 / 退款入口)收進兩顆鈕底下。
                  🔴 **DOM 順序 = 設計稿的左右順序(退款在前、取消在後),沒有 `order-*`**。
                     ⚠️ **我第一版用 `order-1/2` 把視覺左右對調、DOM 維持「取消在前」,理由寫「朗讀順序跟 DOM」**
                        —— 那個理由本身沒錯,**但它換來的是【視覺順序與鍵盤焦點順序打架】**
                        (codex K2 2026-08-19 抓到:畫面左邊是退款,而 Tab 先跳到右邊的取消)。
                     ⇒ 兩害相權:設計稿自己就把退款排左邊 ⇒ **照它排 DOM,三個順序(視覺/Tab/朗讀)一致。**
                        (先前那句「與 OD `more` 同序」講的是**舊的直排版**,那個版面已經不存在了。)
                  ⚠️ **零 props / 零查詢 / 零閘改動**:`shouldShowRefundEntry(…)` 那道顯示閘、
                     `cancelFormsAllowed`、各元件自己的判斷,一個字沒動 —— 它們只是換了位置。
                  🔴 **而「換位置」本身就是行為**(codex R2 在收款搬位那次抓過同款):
                     Tab 與朗讀順序會變,且**收起來的內容報讀器預設讀不到**
                     ⇒ 這不是純視覺,不要寫成零風險。 */}
              {/* 🔴 2026-08-20:Sean 親自開後台看畫面後裁定,兩塊改成【上下堆疊、各自摺疊】,
                  與上面收款/出貨/備註等卡片統一(原字:「不要左右,改成上下然後欄位可以點開.
                  跟上面其他功能意思一樣．讓介面統一性」)。
                  🔴 判準去畫面上找,不是自己設計:比對既有卡片(`payment-list.tsx`/`notes-timeline.tsx`)
                  的收合寫法——外層 `<details className='group bg-card ... rounded-lg border p-4'>`、
                  `<summary>` 內自己畫一顆 `▶` 三角(`group-open:rotate-90`,`display:flex` 會蓋掉原生
                  marker)、標題用 `<h2 className='font-semibold'>`。plan 見
                  `~/pcm-mailbox/W2-014-退款取消版面上下堆疊-plan-20260820.md`。
                  ⚠️ **只換外層樣式與排列方式,`DangerZoneDetails` 本體(hash 深連結/對帳異常強制展開/
                  捲進視野三個行為邏輯)一行未動**,`OrderCancelBlock`/`RefundLedgerSection`/
                  `ManualRefundLedgerSection` 等內容元件也未動。文字(「退款」「申請取消整張單」)
                  不改——文案是另一題(main window 2026-08-20 交代:等自動退刷那題答完再動)。 */}
              <div className='space-y-4'>
                {/* 🔴🔴 **對帳異常時這一塊【自己打開】,而且鈕上就寫著異常**(codex K2 2026-08-19 finding 3)。
                    我第一版把帳本無條件收進鈕底下,而帳本裡有「帳本讀不到 / 未登記額為負 ⇒ 勿再發起退款」
                    這種**警告** —— 那類警告存在的唯一理由就是要員工看到它。
                    收起來 ⇒ 員工看到的是一顆平平無奇的「退款」鈕,退款入口消失了他也**不知道為什麼**
                    ⇒ **那是把一個 fail-closed 的安全設計,退化成一個沉默的安全設計。**
                    ⇒ 判準與那道閘**高度重疊而不相同** —— 逐格差異寫在 `refundLedgerAbnormal` 那段
                    (2026-08-24 更正;~~原句「同一組輸入」~~ 是同一句話的**第三份副本**。
                    🔴 本檔今天有三份, 只改一份 = 同一份檔案把兩個相反的說法各餵給不同的人 ——
                    改這句話之前先 `grep -c '同一組輸入'`)。 */}
                <DangerZoneDetails
                  className='group bg-card text-card-foreground rounded-lg border p-4'
                  /* 🔴 codex MF-2(2026-08-24):截斷兩態也要自己打開 —— 截斷紅區(「勿發起退款」/
                     「不顯示任何一列」)住在這一塊【裡面】,只開對分頁、塊還收著,紅字一樣看不到。
                     ⚠️ 刻意不用 `moneyTabMustSee`:收款讀不到的紅字在 PaymentList、不在這一塊裡,
                        拿它來開這一塊會對一個其實沒事的退款區平白掛開。
                     ⚠️ 紅標題「退款(對帳異常)」的判準【不動】(仍是 refundLedgerAbnormal):
                        截斷不是對帳異常,掛那五個字會說謊 —— 打開之後紅區自己會講話。 */
                  defaultOpen={refundLedgerAbnormal || refundsTruncated || manualRefundsTruncated}
                  summary={
                    <span className='flex flex-wrap items-center gap-2'>
                      {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):10px → 13px。 */}
                      <span className='text-muted-foreground text-[13px] transition-transform group-open:rotate-90'>
                        ▶
                      </span>
                      {/* 🔴 FIX-03(OD):標題規格從 4 種壓成 2 種 —— 這一顆走**卡片標題**那一級
                          (`text-muted-foreground text-xs font-bold tracking-[1.5px]`),與摘要卡、
                          商品明細卡同一組。⚠️ **對帳異常時仍然走 `text-destructive`** ——
                          那不是「另一種標題規格」,是同一級的**警示色**;
                          OD 對「申請取消整張單」也是同規格 + 保留 destructive。 */}
                      <h2
                        className={
                          refundLedgerAbnormal
                            ? 'text-destructive text-xs font-bold tracking-[1.5px]'
                            : 'text-muted-foreground text-xs font-bold tracking-[1.5px]'
                        }
                      >
                        {refundLedgerAbnormal ? '退款(對帳異常)' : '退款'}
                      </h2>
                    </span>
                  }
                >
                  {/* M-3 RW3:退款帳本呈現(唯讀、不吃旗標;零列且未失敗時區塊自回 null)。
                      nowMs 在 server render 期取 —— 列級「滯留逾閾」判定的現在時刻。 */}
                  <RefundLedgerSection
                    rows={refunds}
                    unregisteredAmount={refundUnregisteredAmount}
                    unregisteredFailed={refundUnregisteredFailed}
                    rowsTruncated={refundsTruncated}
                    loadFailed={refundsFailed}
                    nowMs={Date.now()}
                  />

                  {/* M-4b E10 D3:非卡退款登記列表(唯讀、不吃旗標,同上一塊的立場)。
                      並列於 RefundLedgerSection、不合併型別,理由見該元件檔頭。 */}
                  <ManualRefundLedgerSection
                    rows={manualRefunds}
                    orderId={detail.id}
                    returnTo={returnTo}
                    rowsTruncated={manualRefundsTruncated}
                    loadFailed={manualRefundsFailed}
                  />

                  {/* M-3 RW2d:退款入口(危險操作沉底)。旗標 && 顯示層狀態閘 && tappay 管道才渲染;
                      token 同備註片慣例 = server component 渲染期產(頁層 force-dynamic、零快取層)。
                      channel 閘(R1 N5)=顯示層:轉帳/現金單不該看到「線上退款(TapPay)」紅框;
                      已知代價 = 若歷史資料 channel 記錯而 rec_trade_id 其實存在,入口會隱藏(fail-closed,
                      修資料即恢復)—— 真權威仍是 action 步 ④ 的 rec_trade_id 檢查與 RPC。
                      🔴 帳本健康閘(codex MF2 + R2/opus R2b 負值補格):帳本列或未登記額讀不到、
                      或未登記額為**負**(帳本登記已超過訂單總額=對帳異常,區塊明寫「勿再發起」)
                      ⇒ 入口 fail-closed —— 同一頁「文字叫你別按、按鈕還亮著」就是自打嘴巴。
                      負值下錢仍安全(S5 single-flight 擋下一發),關的是矛盾畫面。
                      🔴 **片12 沒有動這道閘**:它照舊決定「渲不渲染」,片12 只決定「渲出來的東西收在哪」。 */}
                  {shouldShowRefundEntry({
                    refundEnabled,
                    refundsFailed,
                    refundUnregisteredFailed,
                    refundUnregisteredAmount,
                    refundsTruncated,
                    hasStuckRefundVerdict,
                    paymentChannel: detail.paymentChannel,
                    paymentStatus: detail.paymentStatus,
                  }) && (
                      <RefundSection
                        orderId={detail.id}
                        returnTo={returnTo}
                        serverToken={generateRefundRequestToken()}
                      />
                    )}

                  {/* 🔴 2026-08-22(線 A `-86` 扮員工走一天時撞到):旗標關著時,這一整塊會渲染成
                      **一個只有「退款」兩個字、底下一片空白的盒子** —— 而**同一張畫面上的取消區
                      正在叫他來這裡**(逐字「請到本頁最下方的「退款」裡處理;錢退完之後這張單才能取消」)
                      ⇒ 員工照著做,到了這裡什麼都沒有,而**沒有任何東西告訴他為什麼**。
                      📌 這正是本檔 :528-534 那段已經寫過的病,只是那段治的是「對帳異常」那一種:
                         逐字「退款入口消失了他也**不知道為什麼** ⇒ 那是把一個 fail-closed 的安全設計,
                         **退化成一個沉默的安全設計**」。⇒ 同一個判準,補上旗標關著的那一種。
                      🔴 **文案刻意不寫「你不能退款」** —— 那不是真的(換一個有開旗標的環境就能退),
                         寫的是**這個環境沒開放**,並指出下一步找誰。
                      ⚠️ 只補顯示;**旗標本身、`shouldShowRefundEntry`、server 端 `refund-actions.ts:124`
                         的閘一個字都沒動** ⇒ fail-closed 的立場完全不變,變的只是它會不會講話。
                      🔴 **這句話裡不可以出現「退款紀錄」四個字** —— 我第一版寫「上面的退款紀錄照常顯示」,
                         被 `refund-wiring.test.tsx:411` 那條既有守門當場擋下(它斷言零帳本列時整頁不得
                         出現「退款紀錄」)。而**那條守門擋對了**:零帳本列的時候上面**根本沒有**退款紀錄,
                         我那句是一個沒查過就寫下的宣稱。⇒ 加字前先想:**這句話在【每一種】會顯示它的
                         情況下都成立嗎?** */}
                  {!refundEnabled && (
                    <p
                      role='status'
                      className='rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
                    >
                      這個環境沒有開放「線上退款(TapPay)」的操作入口 ——
                      這是系統設定,不是這張單的問題。要退這張單的款,
                      請通知系統維護開放之後再操作。
                    </p>
                  )}

                  {/* M-4b E10 D3:非卡退款登記入口。與上面的 TapPay 入口互斥並列——gating 用
                      order_payments.rail(非 paymentChannel),理由見 manual-refund-entry-gate.ts 檔頭。 */}
                  {shouldShowManualRefundEntry({
                    payments,
                    refundUnregisteredFailed,
                    refundUnregisteredAmount,
                  }) && (
                      <ManualRefundEntrySection
                        orderId={detail.id}
                        returnTo={returnTo}
                        serverToken={generateManualRefundRequestToken()}
                      />
                    )}
                </DangerZoneDetails>

                {/* A13b D6-a:取消區塊(複核 + 兩支表單)。判斷全部收在該檔內,見鐵則 6 的抽檔理由。
                    🔴 `anchorId='cancel'` 是**承重的**:列表那兩條 `#cancel` 深連結的目的地
                       (`id='cancel'`)住在這一塊裡面 ⇒ 收起來就等於連過去看到空白。
                       為什麼不能只靠瀏覽器自動展開,量測與射程見 `danger-zone-details.tsx` 檔頭。 */}
                {/* 🔴🔴 `key={detail.id}` 是**承重的**(codex K2 2026-08-19 finding 2):
                    面板已經開著、員工再點**另一張單**的 `#cancel` 連結時,那是 Next 的 client-side 導航
                    ⇒ 網址換了但**不一定發出 `hashchange`**,而 `anchorId` 一直是 `'cancel'` 沒變
                    ⇒ effect 不會重跑 ⇒ **連過去是收起來的**。
                    換單就換 key ⇒ 強制重新掛載 ⇒ effect 一定重跑一次讀 hash。 */}
                <DangerZoneDetails
                  key={detail.id}
                  anchorId='cancel'
                  className='group bg-card text-card-foreground rounded-lg border p-4'
                  summary={
                    <span className='flex flex-wrap items-center gap-2'>
                      {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):10px → 13px。 */}
                      <span className='text-muted-foreground text-[13px] transition-transform group-open:rotate-90'>
                        ▶
                      </span>
                      <h2 className='text-destructive text-xs font-bold tracking-[1.5px]'>
                        申請取消整張單
                      </h2>
                    </span>
                  }
                >
                  {/* 🔴 片 B:`payments` 是「現金/匯款可取消、刷卡不行」的唯一輸入 ——
                      必填無預設,忘了傳會編不過(理由見 cancel-view.ts 的 payments 欄)。 */}
                  <OrderCancelBlock
                    detail={detail}
                    payments={payments}
                    returnTo={returnTo}
                    formsAllowed={cancelFormsAllowed}
                  />
                </DangerZoneDetails>
              </div>
            </>
          ),
        },
        {
          key: 'customer',
          label: '客戶 · 發票',
          content: (
            <>
              {/* 客戶 / 付款 / 發票三欄 —— 頭條那一排留在抬頭,兩塊分家見
                  `order-detail-summary-cards.tsx` 的 `section` prop 檔頭。 */}
              <OrderInfoCards detail={detail} />
              {/* 🔴🔴 **這裡沒有條件包裹,是 Sean 2026-08-15 拍板的結果,不是漏做。**
                  (`Q-13-2 = 丙`、`Q-13-3 = 乙`;完整矩陣見
                   `docs/specs/2026-08-15-e10-13-order-edit-matrix-order-level.md` §3-4。)

                  **已取消 / 已退款 / 已出貨的單,這張表單一律照常出現、四欄一律可改。理由**:
                  · **已取消 / 已退款** → 那張單**可能正需要作廢發票**。開立狀態(~~開票狀態~~ 2026-08-21 改名)、發票號碼、發票金額
                    都是「單沒了之後還要處理的事」⇒ **鎖掉會讓員工無路可走。**
                  · **已出貨** → 實際走的物流可能與當初填的不同(換快遞、改自取)
                    ⇒ **要能補登真實情況**;鎖掉等於強迫紀錄與事實不符。

                  ⚠️ **在加任何 `detail.cancelledAt === null && …` 之前,先去讀上面那份矩陣。**
                  🔴 **這段註解存在的理由**:拍板之前,這裡的「沒有守門」與「決定要開放」
                     **在畫面上、在程式碼裡都長得一模一樣** —— 而現在它是後者。 */}
              <OrderEditForm detail={detail} returnTo={returnTo} />
            </>
          ),
        },
        {
          key: 'notes',
          label: '備註',
          /* 🔴 OD FIX-44②(Sean 逐字:「如果備註裡面有東西,這個地方幫我做顏色或任何方式做提醒」)。
             **數字用後端已經回傳的筆數**(`detail.notes`),不在前端數 DOM —— OD 給線A 的注意事項逐字。
             ⚠️ **誠實邊界**:`notesTruncated` 時這個數字是**下界**不是總數
                (超過載入上限的更早紀錄沒進來)⇒ 徽章說的是「至少有這麼多」。
                時間軸那塊自己會把截斷講出來(`notes-timeline.tsx` 搜 `僅顯示最新`),
                **這顆徽章不重複講一次**,但也不要拿它當總數去對帳。 */
          badge: detail.notes.length,
          content: (
            <>
              {/* A10a-2/-3:備註時間軸 + 表單。
                  🔴 位置 = **發票卡下方**(OD 第十二輪定案 `overview-desktop.html:1171-1173` 逐字
                  「既有的『訂單備註 / 聯絡紀錄』整塊搬到發票下方(原本在頁面最底)」;
                  主視窗 MAIN-902-A 裁 Q1=A)。發票是上面那個 grid 的最後一張卡 ⇒ 這裡 = 緊接 grid 之後,
                  DOM 順序上在發票之後,OD 那支驗證器(`:1656-1662` 用 compareDocumentPosition 比 DOM 順序)認的就是這個。
                  ⚠️ 已知代價(主視窗接受、待 Sean 肉眼驗):視覺上橫跨全寬,不是貼在發票那一格正下方——
                  要做到後者得把發票卡拆出 grid(Q1 的 B 案),那是版面改動、本輪不做。
                  token 在本 server component 渲染期產(Q2=C;頁層 force-dynamic、此處零快取層 ——
                  契約債①的「不得落快取層」就是指這一行)。
                  key 綁更正目標:進出更正模式必 remount ⇒ noteType 初值恆新鮮(MF1)。 */}
              {/* 🔴 Sean 2026-08-19:兩塊合成**一張卡片**(原本是兩個平行的兄弟 = 他說的「拆成兩段」)。
                  合的是**外殼**:表單以 children 進到時間軸那張卡裡,兩支元件本身不合併(鐵則 6)。 */}
              <NotesTimeline detail={detail} orderId={detail.id}>
                <NoteComposeForm
                  key={correctTarget?.id ?? 'compose-new'}
                  orderId={detail.id}
                  returnTo={returnTo}
                  serverToken={generateNoteRequestToken()}
                  correctTarget={correctTarget}
                  correctionMissing={correctNoteId !== null && correctTarget === null}
                />
              </NotesTimeline>
              {/* 🔴 備註時間軸 + 表單原本在這裡(頁尾、退款帳本之前),2026-08-13 OD 片 1 已搬到發票卡下方。
                  搬走的是**同兩個元件**、不是複製一份 —— 這裡不得再渲染第二份(重複的 NoteComposeForm
                  會產第二顆 token、兩張表單同時存在)。 */}
            </>
          ),
        },
      ]}
    />
  );
}
