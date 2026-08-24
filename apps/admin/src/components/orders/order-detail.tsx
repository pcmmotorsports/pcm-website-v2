import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
/* 🔴🔴 **片4a 搬家留下的 11 個死 import 已一次清完**(2026-08-16 片4c)。
   `GoodsAxisValue` 與四張摘要卡在片4a 搬進 `order-detail-summary-cards.tsx`,
   **而它們用的 import 全部留在這裡沒跟著走。** 清掉的 11 個:
     `PAYMENT_STATUS_LABEL` `GOODS_AXIS_LABEL` `ORDER_SOURCE_LABEL` `PAYMENT_CHANNEL_LABEL`
     `formatOrderAmount` `INVOICE_STATUS_LABEL` `customerEmailDisplay`
     `invoiceTypeLabel` `shippingMethodLabel` `orderDetailGoodsAxis` `goodsAxisProgressNote`
   **數法**:`for s in <每個符號>; do grep -c "$s" <本檔>; done` ⇒ 全部 **1**(只命中 import 行本身)。
   留下的只有 `formatOrderDateTime`(實得 3)。(⚠️ 2026-08-24 拆檔片:它隨標頭搬進 `order-detail-header.tsx`,本檔已不 import;
      同行的 `SHOW_UNPAID_CARD_*` 兩個成員拆檔時已是零使用的死 import,整行移除、不留新的死 import。)

   ⚠️ **`lint --force` 18/18 全綠抓不到它們** —— `eslint.config.js` 全檔 `grep -n unused` 零命中,
      沒有 `no-unused-vars` / `unused-imports` 規則 ⇒ **結構上抓不到,不是這次剛好沒抓到。**
   🔴 **真實傷害不是體積**:code-reviewer 找「軸的消費者」時命中這裡,據以判斷本檔是第二個消費者
      —— **一個不存在的消費者比沒有消費者更花時間。**
   🔴🔴 **而我第一版【只清了被指名的那 2 個】** —— 同一批、同一次搬家、同一種傷害的另外 9 個
      原封不動,是下一輪 code-reviewer 抓的。**finding 是症狀的位置,不是病的邊界。** */
import { generateNoteRequestToken } from '../../lib/orders/note-action-state';
import { NOTE_TYPE_LABEL, canCorrectNote } from '../../lib/orders/note-timeline';
import { OrderEditForm } from './order-edit-form';
import { NotesTimeline } from './notes-timeline';
import { NoteComposeForm, type CorrectTarget } from './note-compose-form';
import { ItemsTable } from './order-detail-items-table';
import { OrderInfoCards } from './order-detail-summary-cards';
// 🔴 OD FIX-07/17/45:四分頁 + 全部展開逃生口。**唯一的 client 島**,理由見該檔檔頭
//    (本檔是 server component,渲染期產 token / 讀 `Date.now()` ⇒ 不能加 `'use client'`)。
import { OrderDetailTabs } from './order-detail-tabs';
// 🔴 拆檔片(2026-08-24):標頭 / money 分頁內容 / 兩顆分頁判斷各自成檔(鐵則 6;本檔曾 961 行)。
import { OrderDetailHeader } from './order-detail-header';
import { OrderDetailMoneyTab } from './order-detail-money-tab';
import { resolveOrderDetailTabFlags } from './order-detail-tab-routing';
import { ShipmentSection } from './shipment-section';
import type { PaymentListData } from './payment-list';
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

// 🔴 OrderHeadChip(片2 付款狀態 chip)已隨標頭整塊搬進 `order-detail-header.tsx`(2026-08-24 拆檔片)。

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
  // 🔴 codex R2(拆檔片):原本這裡還算一顆 `cancelled` —— 消費端已全部隨 header/money 搬檔
  //    (兩支各自就地重算),主檔那份變成【零消費的死計算】而 typecheck 對它沉默。已刪;
  //    「真的沒有消費端」的驗法 = grep 本檔 `cancelled` 僅剩註解命中,見交件檔。
  const correctTarget = resolveCorrectTarget(detail, correctNoteId);

  /* 🔴 兩顆分頁判斷(refundLedgerAbnormal / moneyTabMustSee)2026-08-24 拆檔片抽到
     `order-detail-tab-routing.ts`(純判斷、條件級可測,同 `refund-entry-gate.ts` 前例;
     兩段 JSDoc —— 含分母表與 SUB2-009 更正史 —— 逐字跟著走)。
     `hasStuckRefundVerdict` 隨唯一消費端搬進 `order-detail-money-tab.tsx`。
     🔴 「本檔真的在用回傳值」由 `order-detail-tabs-wiring.test.tsx` 的頁級行為格守 ——
        純函式自己再會測,也答不了「呼叫端接了沒」。 */
  const { refundLedgerAbnormal, moneyTabMustSee } = resolveOrderDetailTabFlags({
    refundsFailed,
    refundUnregisteredFailed,
    manualRefundsFailed,
    refundUnregisteredAmount,
    refundsTruncated,
    manualRefundsTruncated,
    payments,
  });

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
        /* 🔴 標頭整塊(片2 標頭列 + OrderFocalRow + 已取消橫幅)2026-08-24 拆檔片搬到
           `order-detail-header.tsx` —— 註解逐字在那裡;三支源碼守門跟著改讀該檔。 */
        <OrderDetailHeader detail={detail} customerHref={customerHref} payments={payments} />
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
          /* 🔴 §12 組 28 / OD FIX-11 警示圓點(Sean 2026-08-25 拍「對帳出錯時三處變色 ⇒ 要補」)。
             **判準刻意重用 `moneyTabMustSee`,不另外寫一個** —— 它的分母是 codex 關卡2
             逐格數出來的(見 `order-detail-tab-routing.ts` 那段),再寫一個就是第五個各自為政的判準。
             🔴 **與 `initialKey` 同一個值 ⇒ 點亮的時機與跳頁的時機天生一致**:
                不會出現「跳到 money 但沒有點」或「有點但不跳」那種讓人不信任它的狀態。
             🔴 **fail-loud 是逐格查過的,不是假設**(codex 關卡2 must-fix 要求給證據,2026-08-25):
                四個輸入**每一個都是「出事 ⇒ 真」**,所以「判不出來」一律【亮】,不會安靜地不亮:
                  · `payments.status !== 'ok'`  讀不到/查無 ⇒ 真
                  · `refundsFailed` / `manualRefundsFailed` / `refundUnregisteredFailed` 讀取失敗 ⇒ 真
                  · `*Truncated` 沒讀完 ⇒ 真
                ⚠️ 唯一看起來像 fail-open 的是 `refundUnregisteredAmount === null` 那一項為假,
                   **但它不是「讀不到」** —— `order-detail-route.tsx` 該處逐字:
                   「失敗≠查無(codex MF2):壓成 null 會顯示成普通『查無』被照著操作」
                   ⇒ 讀失敗走的是 `refundUnregisteredFailed = true` 那條,**仍然會亮**。
             🔴 **而這正是它要解的那個已知殘餘**:`initialKey` 只在 mount 算一次 ⇒
                revalidate 之後才變異常的單,跳頁那條路救不到它;**這顆點每次渲染都算。**
                (該殘餘逐字寫在本檔 `initialKey` 那段:「真解仍是那顆紅點…這一格是已知殘餘」。)
             ⚠️ **「同一個值」不等於「同一個時機」**(codex 關卡2 nit,2026-08-25):
                `initialKey` 只在 mount 算一次、`alert` 每次渲染都算 ⇒ revalidate 之後
                **點會亮而頁不會自己跳**。那是刻意的(跳頁會把人從他正在看的地方拉走),
                但不要把它讀成「執行期也會自動切頁」。 */
          alert: moneyTabMustSee,
          /* 🔴 **`#cancel` 是既有深連結的目的地**(列表那兩條),而它住在這一頁的取消區裡。
             沒有這一格,那兩條連結會連到一個 `hidden` 的區塊 —— 而 `order-detail.tsx` 自己
             早就寫著「收起來就等於連過去看到空白」。**分頁把「收起來」又做了一次。** */
          hashes: ['cancel'],
          content: (
            /* 🔴 這一頁的 content 2026-08-24 拆檔片整塊搬到 `order-detail-money-tab.tsx` ——
               各段註解(危險操作沉底/兩顆鈕/收款位置的決策史)逐字在那裡。
               key/label/hashes 刻意留在本檔(MF-2 契約端與 #cancel 認領,源碼守門讀這裡)。 */
            <OrderDetailMoneyTab
              detail={detail}
              returnTo={returnTo}
              payments={payments}
              refunds={refunds}
              refundsFailed={refundsFailed}
              refundsTruncated={refundsTruncated}
              refundUnregisteredAmount={refundUnregisteredAmount}
              refundUnregisteredFailed={refundUnregisteredFailed}
              manualRefunds={manualRefunds}
              manualRefundsFailed={manualRefundsFailed}
              manualRefundsTruncated={manualRefundsTruncated}
              refundEnabled={refundEnabled}
              cancelFormsAllowed={cancelFormsAllowed}
              refundLedgerAbnormal={refundLedgerAbnormal}
            />
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
