import Link from 'next/link';
import { cancelShipmentWarning } from '../../lib/orders/cancel-shipment-warning';
import { cancelPendingRefundNotice } from '../../lib/orders/cancel-pending-refund-notice';
import {
  listPendingRefundAmounts,
  type PendingRefundRail,
} from '../../lib/payment/pending-refund-repository';
import { loadOrderShipments } from '../../lib/shipping/order-shipments';
import { listOrderItemReceipts } from '../../lib/orders/receipt-repository';
import { notFound } from 'next/navigation';
import type { AdminOrderDetail } from '@pcm/domain';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { isOrderId } from '../../lib/orders/order-detail-view';
import { mergeDetailItems } from '../../lib/orders/merge-detail-items';
import { findEffectiveVerdicts } from '../../lib/payment/refund-correction-read';
import { isStuckManualVerdict } from '../../lib/payment/refund-ledger-view';
import { isRefundUiEnabled } from '../../lib/payment/refund-ui-flag';
import { isUuid } from '../../lib/orders/note-action-state';
import {
  getLedgerUnregisteredAmount,
  listOrderRefunds,
  type OrderRefundRow,
} from '../../lib/payment/refund-read';
import {
  listOrderManualRefunds,
  readOrderManualRefundRailCap,
  type ManualRefundRow,
} from '../../lib/payment/manual-refund-read';
import { listOrderPayments } from '../../lib/orders/payment-repository';
import { listOrderEmailLog } from '../../lib/orders/email-log-repository';
import { listSuppliers } from '../../lib/supplier';
import { OrderDetail } from './order-detail';
import type { PaymentListData } from './payment-list';
import { EmailLogSection, type EmailLogData } from './email-log-section';
import { ResultBanner } from './result-banner';
import { getSessionActor } from '../../lib/session/actor';
import {
  CancelResultPanel,
  cancelFormsAllowedOnResultPage,
} from './cancel-result-panel';

// order-detail-route.tsx — #350c:訂單明細的**載入 + 組裝**,兩個消費者共用。
//
// 🔴 為什麼抽出來:面板版(`app/@panel/orders/page.tsx`)與整頁版(`app/orders/[id]/page.tsx`)
//    要跑**完全相同**的四路 `Promise.allSettled`(#15-B2-c 片1a 起:明細 / 供應商 / 退款帳本 /
//    **收款明細**,見 `:117-124`)與四組容錯旗標,外加收款那一路的**三態 union**
//    (`:161-166`,刻意不用旗標的理由寫在那)。複製一份 = 兩邊會慢慢分岔,
//    而分岔的其中一條是**退款入口的 fail-closed 判斷**(帳本讀不到就不准按退款)——
//    那不是可以有兩個版本的東西。
//
// 🔴 本檔**沒有 `'use client'`**:它與 `OrderDetail` 一樣是 server component
//    (PII 白名單投影 + server action 全部留在 server,鐵則 12 ②)。
//
// 🔴 `missing` 是兩個消費者**唯一**的行為差異(主視窗 2026-08-10 裁⑤「notFound 面板自理」):
//    整頁版查無 → `notFound()`(整頁 404,既有行為);
//    面板版查無 → **面板內一句話**,不得 `notFound()` —— 在平行路由槽裡呼叫它會把
//    **整個頁面**打成 root 404,員工手上的列表會整片消失,只因為某張單被刪了。

/** 讀取失敗(非查無)的共用文案 —— 兩個消費者都用這一份,不各寫一句。 */
const LOAD_FAILED_TEXT = '訂單明細載入失敗,請稍後再試或聯絡系統維護。';

export async function OrderDetailRoute({
  id,
  resultCode,
  requestToken,
  correctNoteId,
  back,
  returnTo,
  missing,
  buildCustomerHref,
}: {
  id: string;
  /**
   * URL 的 `?r=`,**原封轉入**。
   * 🔴🔴 **不要在呼叫端先 narrow**(A13b D6-a 實測踩過):頁層若先寫
   *    `typeof x === 'string' ? x : undefined`,重複鍵(`?r=a&r=b`)就會變成 `undefined`
   *    ⇒ `cancelFormsAllowedOnResultPage` 收到「沒有結果碼」⇒ **把取消表單放行**。
   *    面板那側因為自己也 narrow 所以不顯示 ⇒ 症狀是「**面板不出現、表單卻開著**」= fail-open。
   *    ⇒ 原始值一路帶到閘門前,narrow 只在**真的需要字串的那一個消費點**(banner)做。
   */
  resultCode: string | string[] | undefined;
  /**
   * A13b D6-a:URL 的 `?rt=`(**原封轉入,呼叫端不要先 narrow**)。
   * 🔴 重複鍵(`string[]`)的 fail-closed 決定收攏在 D3 的 classifier,不在頁層。
   */
  requestToken?: string | string[] | null;
  correctNoteId: string | null;
  /** 返回連結:整頁版 = 回列表;面板版 = 關閉面板(同一份列表 href、不帶 `panel`)。 */
  back: { href: string; label: string };
  /**
   * OD 片 3b:給定客人 id → 「客人明細」入口的連結。**不傳 = 不顯示入口。**
   *
   * 🔴 收 **builder 而不是現成字串**:本層才知道 `detail.customerUserId`(它在投影裡),
   *    而**連去哪**只有呼叫端知道(面板版換 param、整頁版換路徑)。
   *    傳現成字串的話,呼叫端得先自己拿到客人 id —— 那要嘛多一次查詢,要嘛把 id 從別處抄一份。
   * 🔴 **fail-closed 的決定點不在這裡**:`customerUserId` 為 `null`(投影退版)時本層直接不呼叫
   *    builder、傳 `null` 下去 ⇒ 入口不渲染。拼網址的收斂點見
   *    `lib/orders/order-detail-view.ts` 的 `customerDetailHref()`。
   */
  buildCustomerHref?: (customerId: string) => string | null;
  /**
   * #350d C1:**這個視圖自己的網址** —— 表單裡的 `return_to` hidden 欄位吃它,
   * server action 動作做完就導回這裡(整頁版 = `/orders/{id}`;面板版 = 帶 `panel` 的列表網址)。
   *
   * 🔴🔴 **不是 `back.href`**(契約 §4/§6-2 的字面錯誤,`D-420-NOTE` §1 實查更正):
   *    `back.href` 面板版是**關閉**連結、整頁版是回列表 ⇒ 拿它當 `return_to` 會讓動作做完
   *    面板被關掉 / 整頁版的人被踢回列表(後者是回歸)。兩者長得很像,差別只在有沒有 `panel`,
   *    所以這裡刻意收兩個 prop 而不是從 `back` 推 —— 推錯不會編譯紅,只會在畫面上默默發生。
   * ⚠️ 值不信任:action 端一律再過 `parseOrderReturnTo`(站內白名單 + 剝一次性參數)。
   */
  returnTo: string;
  missing: 'not-found' | 'inline';
  // 🔴 **`showResultBanner` prop 已於 #350d 刪除**(code-reviewer R1 must-fix 1):
  //    C2 把 `r` 的擁有權翻給面板之後,兩個消費者都要畫 ⇒ 這個 prop 零呼叫端。
  //    「誰不畫」的決定搬到**列表**那一側(`app/orders/page.tsx` 的 `!panelOpen &&`),
  //    因為只有列表有辦法知道面板開著。留一個沒人傳的 prop = 下一個人以為還有這個旋鈕。
}) {
  // 🔴 只有 banner 需要字串;閘門吃原始值(見 `resultCode` 的 docstring)。
  //    算在最前面是因為**每一條 return 路徑都要畫得出它**(#350d nit-6:少畫一條 = 零橫幅)。
  const bannerCode = typeof resultCode === 'string' ? resultCode : undefined;

  // id 形狀守門:非 UUID 不打 DB(路由參數不透傳查詢)。
  if (!isOrderId(id)) {
    if (missing === 'not-found') notFound();
    return <PanelMessage text='找不到這張訂單。' back={back} bannerCode={bannerCode} />;
  }

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 依 `missing` 分流。
  // A10b:供應商選單與明細**各自容錯** —— 供應商壞掉不該讓整頁看不了,但也**不得靜默**:
  // 空選單會讓員工以為「這家不存在」而去建重複的供應商,而供應商不可刪除(`lib/supplier.ts:22-26`)。
  let detail: AdminOrderDetail | null = null;
  let suppliers: SupplierOption[] = [];
  let suppliersFailed = false;
  let loadFailed = false;
  // M-3 RW3:退款帳本(獨立容錯,不靜默 —— 藏掉 processing 滯留列比整頁掛掉更糟)。
  // 🔴 兩種讀取健康各自成旗標(codex MF2):任一失敗 ⇒ 退款發起入口 fail-closed
  //    (order-detail 掛載閘),不只顯示警告 —— 看不見帳本現況時放人按退款=盲飛。
  let refunds: OrderRefundRow[] = [];
  let refundsFailed = false;
  let refundsTruncated = false;
  let refundUnregisteredAmount: number | null = null;
  let refundUnregisteredFailed = false;
  // 🔴 `#890` 片4:卡住那幾列**現行有效的更正判定**。
  //    `null` = 讀不到(或還沒查)⇒ 退款入口 fail-closed;空 Map = 讀到了而一筆都沒被更正過。
  //    ⚠️ 兩者**必須分得出來**,理由寫在 `refund-ledger-view.ts` 的 `isBlockingStuckVerdict` 旁邊。
  let stuckVerdicts: ReadonlyMap<string, { correctedTo: string }> | null = null;
  // M-4b E10 D3:非卡退款登記列表(獨立容錯,同 refunds 的立場——藏掉登記紀錄比整頁掛掉更糟)。
  let manualRefunds: ManualRefundRow[] = [];
  let manualRefundsFailed = false;
  let manualRefundsTruncated = false;
  // 🔴 ⟦b4-PCM01RECORD⟧ 兩軌可退上限。**初值 `null` = 算不出來** ⇒ 這一格 fail-loud。
  //    讀失敗與 RPC 回不出可信整數**都落在這個 `null`**,而那是刻意的:員工的下一步一樣
  //    (重新整理 ⇒ 不行就叫工程),分成兩句畫面上一個字都不會不同。
  //    ⚠️ **而「`null` 就會標紅」不是無條件的**(codex R2 nit ⑧ 更正我原本的絕對句):
  //    零列、未截斷、列表讀得到的那張單,`null` **不標紅** —— 沒有登記過的單, 上限算不出來
  //    對員工沒有任何下一步。判準在 `ManualRefundLedgerSection` 的 `capUnknown`。
  let manualRefundRailCap: number | null = null;
  // 🔴 A13b D6-a:取消面板要拿它比對「這筆是不是你送的」。
  //    ⚠️ **不是授權邊界** —— 只做顯示層比對,不拿它擋任何東西。
  //
  // 🔴 **⟦b4-MGR0-COPY⟧ 2026-08-29 線F:上面這句的【出處】與【`null` 的意思】都要更新。**
  //    ~~原本寫「`session/actor.ts:6-7` 自陳:cookie 承載、使用者自選、未驗證」~~ **作廢** ——
  //    那個座標現在是一段 `⛔ ~~刪節線~~` 的墓碑(B5-a 之後那段被劃掉了)。
  //    📌 **順著那個行號過去的人,會落在一句【被標成已撤銷】的話上** ——
  //    要嘛以為這個立場已經不成立,要嘛沒看到刪節線而把一句退役的話當「逐字」引用。
  //    ⇒ 改引**錨字串**:`session/actor.ts` 的 `getSessionActorWithSource` docstring
  //      與它的三層說明。**行號會漂,而漂掉的時候零訊號。**
  //
  // 🔴🔴 **而更重要的是:`null` 已經不只是「尚未選人」了。**
  //    `getSessionActorWithSource()` 回的 `source` 有四個值,其中三個都會讓 `actor` 是 `null`:
  //      · `self-selected` + null ⇒ **真的還沒選**(右上角那顆選單是活的,選了就有)
  //      · `none`(共用密碼 / 首次建置登入)⇒ **選單選了不會生效**
  //      · `stale-ticket`(真實身分閘開著而票是舊的)⇒ 同上,選了也不會生效
  //      · `ticket` + null ⇒ 票上有人, 而那個人現在不在啟用名單裡
  //    ⇒ D3 對這四種**一律** fail-closed 走 `match_other_actor`,**那是對的、不要改**
  //      (`lib/orders/cancel-ledger-classifier.ts` 錨 `一律走 match_other_actor`)。
  //    ⚠️ 而**下游的文案有一格因此變窄**:`cancel-result-panel.tsx` 的 `match_other_actor`
  //      ~~逐字「也可能是你還沒在右上角選人」—— 在後三種世界裡,**照它做是做白工**。~~
  //      ~~🔴 **本片不改那句**:它長在取消/退款動線上(鐵則 12 ①)⇒ 另一片工,已回報。~~
  //      ✅ **2026-08-29 那一片做完了**(`Q-CANCELHINT` = 甲):那句仍然提到那顆選單,而改口徑成
  //      「不一定選了就生效」(codex R2 nit 更正我原本寫的「不再指那顆選單」—— **那句話是假的**),
  //      並把員工送去首頁「具名身分」卡(那裡分得出四種世界)。**不得在任一處叫他登出重登**
  //      —— 理由見 `app/page.tsx:100-104`(codex 關卡2 R4 must-fix),在取消頁一字不變地成立。
  //      現行字面釘在 `cancel-result-panel.test.tsx`(整句斷言,改一個字就紅)。
  const actor = await getSessionActor();
  const [
    detailSettled,
    suppliersSettled,
    refundsSettled,
    paymentsSettled,
    emailLogSettled,
    unregisteredSettled,
    manualRefundsSettled,
  ] = await Promise.allSettled([
      (async () => getAdminOrderRepository().findAdminOrderDetail(id))(),
      (async () => listSuppliers())(),
      (async () => listOrderRefunds(id))(),
      // #15-B2-c 片1a:收款明細(獨立容錯 —— 讀不到**不是**「沒收過款」,見下方折三態)。
      (async () => listOrderPayments(id))(),
      // 片A:這張單寄過哪幾封信(獨立容錯 —— 讀不到**不是**「沒寄過信」, 見下方折二態)。
      (async () => listOrderEmailLog(id))(),
      // 🔴 #445a-3:帳本未登記額**併進這一批平行查**,不放在下面串著等。
      //    它不依賴 `refunds`(445a-3 之後是無條件查)⇒ 沒有理由多一趟往返。
      //    ⚠️ 第一版我寫在 `refundsSettled` 的 fulfilled 區塊裡 `await` ——
      //    那是**串行**的第二趟,而且位置在 `detail === null → notFound()` 之前
      //    ⇒ **連「找不到訂單」的 404 頁都要先等這支 RPC**。關卡2 codex 抓到。
      (async () => getLedgerUnregisteredAmount(id))(),
      // M-4b E10 D3:非卡退款登記列表,同 refunds 併進平行查(不依賴 detail)。
      //
      // 🔴🔴 **⟦b4-PCM01RECORD⟧ 兩軌可退上限【故意排在列之後】, 不與它平行**
      //    ~~第一版把兩支併排在同一批 `allSettled` 裡~~ ⇒ codex R1④/R2① 給了一個會漏紅的時序:
      //      cap 先讀到舊的非負值 → 另一名員工登記一筆超額退款 → 列表後讀到那筆新列
      //      ⇒ 畫面有列、而 cap 說沒事 ⇒ 🛑 **該紅而完全不紅。**
      //    ✅ **修法是排序, 不是加旗標**:cap 讀在列之後 ⇒ cap 的快照**永遠不早於**列的快照
      //      ⇒ **「新列配舊 cap」這個方向不存在了。**
      //    🔵 而反方向(cap 比列新、cap 是負的而列還沒出現)**仍然可能**, 但它**不漏紅** ——
      //      `overCap` 在元件那側是無條件的, 零列照樣渲染那條紅。
      //    ⚠️ **代價寫清楚**:這一支分支變成兩趟往返。**而它仍與另外五支平行**
      //      ⇒ 頁面總延遲只在「這一支變成最慢那一支」時才會被它決定。
      //      📌 這與上方 `#445a-3` 那條「不要串著等」不衝突:那條講的是**跨批**串行
      //      (會擋到 `notFound()`),而這裡是**同一批之內**的兩跳。
      // 🔴 cap 自己 `catch` ⇒ **它失敗不得把列一起拖掉**(兩件事、兩個顯示)。
      (async () => {
        const list = await listOrderManualRefunds(id);
        const cap = await readOrderManualRefundRailCap(id).catch((reason: unknown) => {
          console.error('[admin/order-detail] 兩軌可退上限讀取失敗(顯示為算不出上限)', reason);
          return null;
        });
        return { list, cap };
      })(),
    ]);
  if (detailSettled.status === 'fulfilled') {
    detail = detailSettled.value;
  } else {
    console.error('[admin/order-detail] 訂單明細載入失敗', detailSettled.reason);
    loadFailed = true;
  }

  // 🔴🔴 **品項清單改走頂層分頁撈到盡**(`D2` C 條,Sean 2026-08-18 批)。
  //    `detail.items` 是**內嵌**撈的、被 `ORDER_ITEMS_EMBED_LIMIT = 200` 夾住,而 Sean 逐字說
  //    一張單「可能到 200 個品項」⇒ **正常業務的上緣就是斷點,不是未來風險**。
  //    2026-08-18 真資料實測(201 品項的真單、真瀏覽器):**這一頁只顯示 200 項,而缺的是
  //    【中間隨機那一項】** —— 內嵌按 `id` 排序而 `order_items.id` 是隨機 uuid ⇒ **掉的不是尾巴**。
  //
  // 🔴 **為什麼不併進上面那個 `Promise.allSettled`** ——
  //    它要**用 `detail` 存在當前提**:`detail === null`(整張單讀不到)時多打這一趟毫無意義,
  //    而且會在一條已經失敗的路徑上多一個失敗點。
  //    ⚠️ **代價寫出來:它是串行的第二趟**(多一次往返)。明細頁是高頻互動頁 ⇒
  //    🔴 **本片未量**改前改後的回應時間,那條風險是**定性的、不是定量的**。
  //
  // 🔴 **讀失敗 ⇒ 整頁 fail-closed,不吞** —— 吞掉會讓畫面**退回內嵌那份**
  //    (少一項、而畫面完全正常),那正是本片在修的病。⇒ 走與明細同一條 `loadFailed`。
  if (detail !== null) {
    try {
      const full = await getAdminOrderRepository().listOrderItemsForDetail(id);
      detail = mergeDetailItems(detail, full.items, full.reportedTotal);
    } catch (e) {
      console.error('[admin/order-detail] 品項清單撈到盡失敗(整頁 fail-closed,不退回內嵌那份)', e);
      detail = null;
      loadFailed = true;
    }
  }

  // 🔴🔴 **取消已出貨的單要擋一次 —— 出貨資料在這一層讀, 往下傳三層。**
  //    ⛔ ~~原作把 `OrderCancelBlock` 改成 `async` 讓它自己讀~~
  //    🛑 而它的**三層祖先沒有一支是 async**(`order-detail-route` 是, 但中間兩支不是)
  //       ⇒ 同步渲染一個 async 元件會拿到 Promise ⇒ **什麼都沒 render, 43 格紅**。
  //    ✅ 本層本來就是 `async`(`:55`)⇒ 在這裡讀一次, 三層轉手下去。
  //
  // 🔴🔴 **讀不到出貨 ⇒ 走 `cancelShipmentWarning(null)` ⇒ 它回【擋】(kind `unreadable`)。**
  //
  // ⛔ ~~我第一版讓它退成 `cancelShipmentWarning([])` = 不擋~~,理由寫的是
  //    「畫面是警示不是閘, 讀取失敗不該攔住員工」。
  // 🛑 **而 codex 抓到那是一個【解不開的迴圈】**:
  //    server 端那道**自己重讀一次**, 它讀到失敗時是【擋】(同一支判準對 `null` 就是擋)
  //    ⇒ 畫面說「不擋」⇒ **不畫那個確認格**
  //    ⇒ 而那個確認格是 server 放行的**唯一** ack
  //    ⇒ ⇒ 🔴 **員工按取消 → 被 server 擋回來 → 頁面上仍然沒有可以勾的東西 → 再按 → 再被擋。**
  //    ⇒ 📌 **兩邊對同一個世界給了相反的答案, 而那個不一致【只在失敗時】顯形。**
  // ✅ **修法:兩邊同向** —— 讀不到就兩邊都當「擋」, 而畫面把確認格畫出來
  //    ⇒ 員工看得到發生什麼事, 也有一條走得出去的路(勾了還是能取消)。
  //    🔵 而它仍然**不是硬擋**:勾一下就過。這一格要的是「他知道」, 不是「他不能」。
  // 🔵 `#450`:逐筆到貨列表要的兩份資料【都在這一層讀】——
  //    ① 包裹分組(下面那發本來就在讀, 給取消閘用)⇒ **零額外查詢**, 直接共用
  //    ② 逐筆到貨(新的一發)
  //    🛑 而 `null` 在兩份裡都是「**讀不到 / 被截斷**」不是「沒有」——
  //       下游的判準與列表各自對 `null` fail-closed。
  let receiptRows: Awaited<ReturnType<typeof listOrderItemReceipts>> = null;
  let shipmentGroups: Awaited<ReturnType<typeof loadOrderShipments>> | null = null;

  let shipmentWarning = cancelShipmentWarning(null);
  // 🔴🔴 **`null` 起手 = `unknown` = 畫成一句話**(Sean 2026-09-05 第 1 題拍乙)。
  //    🛑 **不可以起手 `{kind:'none'}`** —— 那會讓「還沒讀」與「這單沒收過錢」變成同一個東西,
  //       而後者在畫面上是**沒有紅框**。⇒ 📌 忘記接線的那個世界要**畫錯**, 不是**畫空**。
  let pendingRefundRails: PendingRefundRail[] | null = null;
  if (detail !== null) {
    try {
      // 🔵 與隔壁那兩發同一個形狀:讀不到就 `null`, 由下游畫成一句話, **不靜靜當成沒有**。
      //    🔴 這一發**只在取消區用得到**, 而它與到貨/包裹兩發共用同一個 try 風格 ——
      //       不自創第二種錯誤處置。
      pendingRefundRails = await listPendingRefundAmounts(id);
    } catch (e) {
      console.error(
        '[admin/order-detail] 待退款金額讀不到 —— 取消區會畫成「請自己看收款紀錄」, 不會靜靜沒有紅框',
        e,
      );
      pendingRefundRails = null;
    }
    try {
      receiptRows = await listOrderItemReceipts(detail.items.map((it) => it.id));
    } catch (e) {
      console.error('[admin/order-detail] 逐筆到貨載入失敗(那一區畫成一句話, 不靜靜少列)', e);
      receiptRows = null;
    }
    try {
      shipmentWarning = cancelShipmentWarning(
        // 🔵 只餵 id 與 title 兩欄 —— 不把整包 detail(帶成交價)交給資料層。
        //    形狀抄隔壁 `shipment-section.tsx`, 不自創第二種寫法。
        (shipmentGroups = await loadOrderShipments(
          new Map(detail.items.map((it) => [it.id, it.title])),
        )),
      );
    } catch (e) {
      // 🔴 這裡**不改回不擋** —— 見上面那段。讀不到就是讀不到, 而那要讓員工看見。
      console.error('[admin/order-detail] 出貨狀態載入失敗(畫面走「讀不到」那一種警示)', e);
    }
  }

  if (suppliersSettled.status === 'fulfilled') {
    suppliers = suppliersSettled.value;
  } else {
    console.error('[admin/order-detail] 供應商清單載入失敗(採購選單只剩既有供應商)', suppliersSettled.reason);
    suppliersFailed = true;
  }
  if (refundsSettled.status === 'fulfilled') {
    refunds = refundsSettled.value.rows;
    refundsTruncated = refundsSettled.value.truncated;
  } else {
    console.error('[admin/order-detail] 退款帳本載入失敗(區塊顯示警告、入口 fail-closed)', refundsSettled.reason);
    refundsFailed = true;
  }
  // 🔴 `#890` 片4:卡住那幾列的更正判定 —— **串行的第二趟,而它有前提**。
  //    ⚠️ **不能併進上面那個 `Promise.allSettled`**:它要用 `refunds` 當輸入(問哪幾個 id)。
  //    🔴 **而絕大多數訂單根本不會走它**:沒有卡住的列 ⇒ `stuckIds` 為空 ⇒
  //       `findEffectiveVerdicts` 自己早退、**不打 DB**(`refund-correction-read.ts` 的
  //       `if (ids.length === 0) return new Map()`)⇒ 那一趟只在真的有卡住列時發生。
  //    ⚠️ **成本未量**:有卡住列的那條路多一次往返,而明細頁是高頻互動頁。**定性、非定量。**
  //
  //    🔴 **`refundsFailed` 時不查、留 `null`** —— 帳本都讀不到了,問「哪幾列被更正過」
  //       沒有意義,而**留 `null` 正是 fail-closed 要的值**。
  if (!refundsFailed) {
    const stuckIds = refunds.filter(isStuckManualVerdict).map((row) => row.id);
    try {
      const got = await findEffectiveVerdicts(stuckIds);
      // 型別漂移也算讀不到(不是 Map 就別往下 `.get()`,那會炸整頁)。
      stuckVerdicts = got instanceof Map ? got : null;
    } catch (error) {
      console.error('[admin/order-detail] 卡住判定的更正紀錄載入失敗(退款入口 fail-closed)', error);
      stuckVerdicts = null;
    }
  }

  // 🔴 #445a-3:帳本未登記額改成**無條件查**(原本只在 `refunds.length > 0` 才查)。
  // ⚠️ **本片只鋪管線,不負責把那個數字顯示出來** —— 零帳本列時
  //    `RefundLedgerSection` 仍然整區不渲染(plan §6-33 明文要求「不因刪短路多冒空區塊」),
  //    **顯示是 445c 的工作**(開退款面板時顯示可受理上限)。
  //    🔴 我第一版註解寫成「省掉的那趟正是員工最需要金額參考的時候」——
  //    那句把**本片的收益**講成已經兌現,實際上零列訂單今天看到的仍是空的。
  //    code-reviewer 與 codex 各自獨立抓到同一句。**照 plan 排序上,但字面不准灌水。**
  //    ⇒ 本片此刻的淨效果 = 零列訂單多一趟(已併平行、零額外往返)+ 一條新的
  //    fail-closed 失敗路徑;收益要等 445c。主視窗 2026-08-14 裁「照 plan 排序、不綁 445c」,
  //    理由 = 後台尚未啟用、只有 Sean 在測(memory `project_admin-preprod-planning-posture`)
  //    ⇒ 那條失敗路徑的代價落在他自己身上,而綁著等會讓 diff 長大、關卡 2 難審。
  // ⚠️ **這不是零行為變化**:每一張訂單的退款入口自此新增一條對
  //    `pcm_order_refundable_remaining` 可用性的 **fail-closed 依賴**
  //    (`refund-entry-gate.ts` 的 `!refundUnregisteredFailed`)——
  //    以前零列時根本不呼叫、不可能失敗;現在會。**不得宣稱「零變化」。**
  if (unregisteredSettled.status === 'fulfilled') {
    refundUnregisteredAmount = unregisteredSettled.value;
  } else {
    // 🔴 失敗≠查無(codex MF2):壓成 null 會顯示成普通「查無」被照著操作。
    console.error(
      '[admin/order-detail] 帳本未登記額查詢失敗(顯錯誤態+入口 fail-closed)',
      unregisteredSettled.reason,
    );
    refundUnregisteredFailed = true;
  }

  if (manualRefundsSettled.status === 'fulfilled') {
    manualRefunds = manualRefundsSettled.value.list.rows;
    manualRefundsTruncated = manualRefundsSettled.value.list.truncated;
    manualRefundRailCap = manualRefundsSettled.value.cap;
  } else {
    console.error(
      '[admin/order-detail] 非卡退款登記載入失敗(區塊顯示警告)',
      manualRefundsSettled.reason,
    );
    manualRefundsFailed = true;
    // 🔵 列讀不到 ⇒ cap 那一跳**根本沒跑到**(它排在列之後)⇒ `manualRefundRailCap` 留在初值 `null`
    //    ⇒ 畫面顯示「算不出上限」。**那是對的**:列都看不到了,沒有理由宣稱上限沒問題。
  }

  // 🔴🔴 #15-B2-c 片1a:**三態不可收斂成兩態**(`payment-repository.ts:93-96` 逐字)——
  //    `[]` = 訂單在、還沒收過款;`null` = **訂單不存在**;`throw` = **沒讀到**。
  //    把 `throw` 或 `null` 畫成「尚未登錄任何收款」= 員工照著再登一次 ⇒ **重複入帳**。
  //    ⚠️ 這裡刻意**不用**上面那三段的 `let + 旗標` 形狀:旗標形狀要兩個變數才表達得完
  //    (`failed` 與 `notFound`),而兩個布林能組出第四種不存在的狀態。一個 union 收斂成三態,
  //    多出來的組合在型別上就不存在。
  const payments: PaymentListData =
    paymentsSettled.status === 'rejected'
      ? { status: 'unreadable' }
      : paymentsSettled.value === null
        ? { status: 'order_not_found' }
        : { status: 'ok', rows: paymentsSettled.value };
  // 🔴 片A:折**二**態而不是三態 —— 而少的那一態要說明白, 不然下一個人會以為我漏了。
  //    `listOrderEmailLog` 直查表 ⇒ 訂單不存在時它回**空陣列**, 不是 null
  //    ⇒ 這裡沒有 `order_not_found` 那一格可折。
  //    🔴🔴 **R2 nit 訂正:下面這句推理是錯的, 舊字面留著。**
  //    ⛔ ~~「而『訂單不存在』那一格由上面的 `detail === null → notFound()` 接走
  //         ⇒ 走到本行時訂單一定存在」~~
  //    ⇒ **兩個地方都不成立**:①那一行 `if (missing === 'not-found') notFound();`
  //      **在本行之下**, 不在上面
  //      ②它只在 `missing === 'not-found'` 時呼叫, 而**面板版刻意不呼叫**
  //        (檔頭那段「notFound 面板自理」;平行路由槽裡呼叫它會把整頁打成 root 404)
  //        ⇒ 面板版走到本行時訂單**可以不存在**。
  //    ✅ 真正接住它的是**渲染那一行**的 `{loadFailed || detail === null ? null : <EmailLogSection`
  //       ⇒ 訂單不存在時這個區塊根本不掛上去。**行為是對的, 錯的是我寫的理由。**
  //
  //    🔴🔴 **R3 must-fix:上面這段原本引的是【本檔自己的行號】(`:360` / `:415`), 而兩個都已經漂了**
  //       (實查 `notFound()` 在 368、那個三元在 424)—— 而**漂的原因就是我在寫這段註解**。
  //       🛑 而最毒的一格:那兩個行號, 就寫在下面十行那句「描述這支檔自己的數字, 在寫下它的
  //          那個動作裡就過期了」的**正上方** ⇒ **我一邊寫下那條規律, 一邊違反它。**
  //       ✅ ⇒ 引本檔內的位置一律用**程式字面**當錨, 不用行號。字面會跟著搬, 行號不會。
  //    📌 ⇒ 一段【結論正確而推理錯誤】的註解, 比沒有註解貴 ——
  //       下一個人會照那個理由去改別的地方, 而那個理由在別的地方不成立。
  const emailLog: EmailLogData =
    emailLogSettled.status === 'rejected'
      ? { status: 'unreadable' }
      : { status: 'ok', rows: emailLogSettled.value };
  if (emailLogSettled.status === 'rejected') {
    console.error('[admin/order-detail] 寄信紀錄載入失敗(顯錯誤態≠沒寄過)', emailLogSettled.reason);
  }
  if (paymentsSettled.status === 'rejected') {
    console.error('[admin/order-detail] 收款明細載入失敗(顯錯誤態≠查無)', paymentsSettled.reason);
  }

  if (!loadFailed && detail === null) {
    if (missing === 'not-found') notFound();
    return (
      <PanelMessage text='找不到這張訂單(可能已被刪除)。' back={back} bannerCode={bannerCode} />
    );
  }

  return (
    <>
      <BackLink back={back} />

      {/* 🔴 #350d C2:兩個消費者都畫 —— 「面板開著時列表停畫」的決定在
          `app/orders/page.tsx`(只有列表知道面板開著)。這裡不再有旋鈕。 */}
      <ResultBanner code={bannerCode} />

      {/* 🔴 `cancellationsTruncated` 缺值折成 `true` 不是 `false`(R1 must-fix):
          折成 false ⇒ classifier 落 `miss_complete` ⇒ 面板說「仍然沒有,才重新送一次」
          = 全片唯一會讓員工按第二次的那句;折成 true 只會多說一句「無法斷定」,方向安全。
          ⚠️ `detail` 為 null 時 `cancellations` 已先觸發 `unreadable`,這行不影響那條路。 */}
      {/* 🔴🔴 A13b D6-a:取消結果面板掛在**資格閘之外**(plan D6-a 逐字)——
          RPC 關單成功之後 `canCancel` 會變 false,若把面板掛在資格閘內,
          **最需要看到「寫進去了沒有」的那一刻反而什麼都不顯示**。
          🔴 它也在 `loadFailed` 分支之外:明細**讀取失敗(repo throw)**時仍說得出「你剛才那筆怎麼了」。
          ⚠️ **但「查無」那條走不到這裡**(R1 must-fix 更正原本說滿的字面):`missing === 'not-found'`
          時上面已經 `notFound()` return ⇒ 員工帶著 `?r=&rt=` 開一張被刪掉的單,看到的是整頁 404。
          那是既有的路由行為,本片不改;寫下來免得下一個人以為面板涵蓋所有失敗路徑。 */}
      <CancelResultPanel
        resultCode={resultCode}
        requestToken={requestToken}
        actor={actor?.id ?? null}
        cancellations={detail?.cancellations ?? null}
        cancellationsTruncated={detail?.cancellationsTruncated ?? true}
      />

      {/* 🔴🔴 片A:「這張單寄過哪幾封信」—— **而它為什麼在這裡而不在 `OrderDetail` 裡面**:
          `order-detail.tsx:329` 有一條 2026-08-20 的裁定 ——「下一次動這支檔【先抽再改】」,
          而它逐字寫著「對這支檔的【下一次非一行改動】仍然生效」⇒ 那指的就是本片。
          ⇒ 本區塊放在 route 是為了【不讓那支檔長大】, **不是為了避開那條裁定** ——
             那條裁定要防的東西, 這條路本來就不會發生(那支檔一個字都不長)。
          🛑 而【抽檔】那件**仍然開著, 沒有因為本片而消失** —— 它是 backlog **`#675`**
             (`docs/phase-1-backlog.md` 搜 `### #675`, 標題逐字「`order-detail.tsx` 該抽下一塊了」)。
             ⛔ ~~原句寫「主視窗 2026-09-02 已請 `-f3` 開列」~~ —— R1 nit #11 訂正:
                **那一條【早就存在】, 不需要開新的。**
             ⛔ ~~而訂正句原本還附了行號 `:24487`~~ —— R3 nit:**板子是多窗共寫檔, 那個行號已漂到 24492**
                ⇒ **錨(`#675` + 標題)夠用, 行號是會過期的裝飾。**
             📌 ⇒ 而「宣稱某件事已在 backlog 而實際查無」正是 `#281` 那一條的出生原因
                ⇒ **指既有編號, 不要指一個還沒生出來的。**
          🔴 **而本片沒有讓 route 變小 —— 它已過鐵則 6 的 400 線。**
             ⛔ ~~「它是 487 行」~~ —— R2 must-fix 訂正, 而 R3 又量到一次:
                **487 ⇒ 494 ⇒ 506**, 三個數字全部是我自己加註解推上去的。
                ⇒ **本檔行數以當場 `wc -l` 為準**;改前 `git show HEAD:<path> | wc -l` ⇒ 456。
             📌 **⇒ 一個寫死在檔案裡、描述【這支檔自己】的數字, 在寫下它的那個動作裡就過期了。**
             🔴 **⇒ 而它與一般的過期不同:一般的過期要等別人來改, 而這一種**
                **在我按下存檔【之前】就已經錯了。**
             不拆的理由寫在 commit body(鐵則 6 逐字要求), 不留白。
          📌 ⇒ 下一個人:看到「有人把區塊放外面」**不要**把它讀成這支檔的新慣例。

          🔵 而位置(常駐、不進分頁)是產品判斷:客服是【接電話當下】在看它
             ⇒ 常駐比「要先點到某一個分頁」快一步。
          🔴 代價照留:它不在 `OrderDetail` 的分頁結構裡 ⇒ 版面上是獨立一張卡。
             ⇒ Sean 開後台看到不喜歡, 那時再搬。 */}
      {loadFailed || detail === null ? null : <EmailLogSection data={emailLog} />}

      {loadFailed || detail === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          {LOAD_FAILED_TEXT}
        </div>
      ) : (
        <OrderDetail
          detail={detail}
          shipmentWarning={shipmentWarning}
          pendingRefund={cancelPendingRefundNotice(pendingRefundRails)}
          receiptRows={receiptRows}
          shipmentGroups={shipmentGroups}
          returnTo={returnTo}
          correctNoteId={correctNoteId}
          suppliers={suppliers}
          suppliersFailed={suppliersFailed}
          refundEnabled={isRefundUiEnabled()}
          refunds={refunds}
          refundsFailed={refundsFailed}
          refundsTruncated={refundsTruncated}
          stuckVerdicts={stuckVerdicts}
          refundUnregisteredAmount={refundUnregisteredAmount}
          refundUnregisteredFailed={refundUnregisteredFailed}
          manualRefunds={manualRefunds}
          manualRefundsFailed={manualRefundsFailed}
          manualRefundsTruncated={manualRefundsTruncated}
          manualRefundRailCap={manualRefundRailCap}
          cancelFormsAllowed={cancelFormsAllowedOnResultPage(resultCode)}
          customerHref={
            // 🔴 **形狀閘、不是只有 falsy**:型別是 `string | null`,但實際可能是
            //    `undefined`(手寫 detail 物件缺這一欄)、空字串、或**任何非 UUID 字串**。
            //    第一版寫 `=== null` 漏掉 undefined;第二版改 falsy **仍漏掉第四類**
            //    ——`'null'`、空白字串、亂碼都會產生一個點下去沒反應(面板版)或 404(整頁版)的入口
            //    (codex 關卡2 important:**我的「fail-closed」宣稱當時沒有涵蓋那一類**)。
            //    ⇒ 改用與槽頁同一支 `isUuid`,讓**宣稱與實作一致**:進不了閘就不渲染入口。
            //    ⚠️ 這不是在擋洩漏(DB 端是 uuid 欄、值本來就合法),是讓壞形狀**當場不出現**
            //    而不是變成一條壞連結。
            buildCustomerHref === undefined ||
            typeof detail.customerUserId !== 'string' ||
            !isUuid(detail.customerUserId)
              ? null
              : buildCustomerHref(detail.customerUserId)
          }
          payments={payments}
        />
      )}
    </>
  );
}

function BackLink({ back }: { back: { href: string; label: string } }) {
  return (
    <Link
      href={back.href}
      className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
    >
      {back.label}
    </Link>
  );
}

/**
 * 面板版的「這張單看不到」訊息。
 *
 * 🔴 **橫幅也要畫在這裡**(#350d code-reviewer R1 nit-6):C2 之後列表在面板開著時會停畫,
 *    而這條路徑原本在畫橫幅**之前**就 return ⇒ `?panel=<合法 uuid 但查無>&r=saved` 會變成
 *    **零橫幅**:動作做完了、單同時被別人刪掉,員工兩邊都看不到「存好了沒有」。
 *    到得了這裡的方式不只「單被刪」——書籤與上一頁都算。
 */
function PanelMessage({
  text,
  back,
  bannerCode,
}: {
  text: string;
  back: { href: string; label: string };
  bannerCode?: string;
}) {
  return (
    <>
      <BackLink back={back} />
      <ResultBanner code={bannerCode} />
      <div className='text-muted-foreground rounded-lg border p-6 text-sm'>{text}</div>
    </>
  );
}
