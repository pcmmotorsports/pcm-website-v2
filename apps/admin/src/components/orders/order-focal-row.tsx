// order-focal-row.tsx — 訂單明細抬頭的【焦點列】(OD FIX-01)。
//
// 🔴 **為什麼獨立成檔(Sean 2026-08-27 拍乙)**:它與 `order-detail-summary-cards.tsx` 的三張
//    資訊卡**不是同一種東西** —— 卡片走 `CARD`/`SPEC` 那套髮絲線格,而焦點列是一條 flex 橫排。
//    留在同一支檔裡,下一個人會以為它們共用 `SPEC`。(該檔改前 540 行,鐵則 6 已過警戒。)
//    ⚠️ **本檔的註解全部是【搬過來的原文】,一個字都沒有壓縮** —— 鐵則 6 逐字:
//       「不得以壓縮/刪減註解作為降行手段 —— 那些註解裡住著 Sean 的拍板紀錄」。
//
// ══ 🔴 對稿的來源與量法(不是「我看過稿」)══════════════════════════════════
//    稿 = OD `pcm-524f/orders-admin-v2.html`,sha256 `fc4a24a5…` / 6795 行(2026-08-27 實量,
//    與 `CLAUDE.md` 路由表記載一致)。
//    🔴 **真正生效的是 gzip+base64 的 `<script id="od-payload">`,不是明文 `<style>`**
//       (`docs/design/od-orders-admin-v2-payload-authority.md`;明文只有 1 個 `order-focal`,
//        payload 裡 38 個)⇒ **本檔每一個 class 字面都是從解開的 payload 抄的,不是 grep 明文。**
//    量法可重跑:見那份檔的 §4(payload 是 JSON、引號 escape 成 `\"` ⇒ 直接 grep 也數到 0)。
//
// ══ 每一格的分母(我量的,不是轉述)════════════════════════════════════════
//    `data-od-id="order-focal"` 共 38 個 = panel 19 + page 19(page 版多一個 `od-focal` class)。
//    🔴 **尾款的顏色有規則,而兩半【都有樣本】**:
//       `text-primary`  20 個 ⇒ 值全部非 0(值=0 的 **0** 個)
//       `text-foreground` 18 個 ⇒ 值全部是 0(非 0 的 **0** 個)
//       負對照 `text-zzz text-[28px]` ⇒ 0 ⇒ 那把尺會歸零。
// ══ 🔴🔴 稿寫 28px,而畫面上量到的是【30px】—— 那不是 bug ═══════════════════
//    `apps/admin/src/app/globals.css:1968` 逐字:`.text-\[28px\] {font-size:30px}`
//    它屬 **Sean 2026-08-24 拍板「A = 全站放大」**(同區塊:`text-sm` 14→16、`text-2xl` 24→26),
//    而**那個拍板比 OD FIX-01 那份稿【更晚】** ⇒ 兩者衝突時以拍板為準。
//    ⚠️ **所以本檔照抄 `text-[28px]` 是對的** —— 它是「稿的意圖」,而最終字級由那條全站規則決定。
//    🔴 **不要因為量到 30 ≠ 28 就去改這個 class**:改了會讓這一格脫離那個全站系統,
//       而畫面上只會看起來「小了一點」。(實測 2026-08-27:真瀏覽器 390px ⇒ `fontSize: 30px`;
//       同頁 `text-sm` ⇒ `16px`,也不是 14px,同一個原因。)
//    📌 **母題**:稿只答得出「稿上怎麼畫」;要答「現在該怎麼做」,還得查【這一格有沒有被後來的拍板動過】。
//
//    ⚠️ **而稿上那一格只出現過【數字】**:`0 / 101 / 340 / 1,500 / 2,400 / 2,480 / 4,950 / 13,050`
//       ⇒ **「未知」與「溢收 N」兩態在稿上【零樣本】**。本檔給它們的顏色是**我推的、不是量到的**:
//       兩者都走 `text-foreground`(理由:它們不是「還要收多少錢」這個語意,
//       而 `text-primary` 在稿上 20/20 都掛在一個真的待收金額上)。**要改請當它是未定案。**
//
// ══ 🔴 與稿【明知的差異】一格,不是漏做 ═══════════════════════════════════
//    稿的焦點列還有第四格 `data-od-id="order-vehicle"`(車款;panel 8/19、page 8/19,
//    **依那張單有沒有車款而定,不是版面決定**)。**本片刻意不做**(主視窗 2026-08-27 裁甲):
//    我方 `vehicle` 掛在**品項**上(`order_items.vehicle_snapshot`),`AdminOrderDetail` 上
//    **沒有訂單級 vehicle 欄位** ⇒ 一張單可以有好幾台不同的車,而稿假設一張單一台。
//    🔴 **這一格的錯法是【安靜的】** —— 顯示一台真實存在、但不是這個品項的車,
//       畫面上完全正常,而**員工會照著它去拿貨**;而稿自己在 `FIX-80` 寫著
//       「車款是員工核對實物的欄位,截字不能接受」⇒ **稿在意的是【準確】,不是【有東西可看】。**
//    ⚠️ **而「不做」不等於「留白」**:稿裡那條分隔線是**跟著車款走的** ⇒ 本檔連那條線一起不畫。
//       留著它 ⇒ 畫面上是一段空白 + 一條線 ⇒ **下一個人會以為「資料沒撈到」,而不是「我們沒做」。**
//
// ══ ⚠️ RWD:同一列在窄螢幕是【另一個版面】,不是縮小 ═══════════════════════
//    稿 `FIX-80` / `@media (max-width:640px)`(`orders-admin-v2.html:5769-5783`)把整頁版改成:
//    2×2 網格、分隔線與彈簧 `display:none`、`<details>` 與車款各獨佔一整列、**`28px ⇒ 22px`**。
//    🔴 **那段 CSS 掛在 `.od-fullpage>header>.od-focal`** —— 而本 repo 沒有 `od-fullpage` 這個 class。
//       ⇒ **本片不搬那段**:它的選擇器在我們這邊接不上,硬搬會變成一段永遠不生效的 CSS。
//       ⚠️ **驗收要量【兩個寬度】**:桌機照 28px;而 ≤640px 我們現在會是 `flex-wrap` 自己換行,
//          **與稿的 2×2 網格不同**。那是**已知差異,不是通過** —— 要對齊得先接上一個等價的容器選擇器。

import type { AdminOrderDetail } from '@pcm/domain';

import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { goodsQuantityHeadline } from '../../lib/orders/order-status-axes';
import { toPaymentSummary } from '../../lib/orders/payment-list-view';
import type { PaymentListData } from './payment-list';

/**
 * 頭條兩格:「總額 / 已收」與「件數 已訂 / 到貨」(BMW M 片4b,Sean 2026-08-16 拍板)。
 *
 * 🔴🔴 **四條閘全部是【既有規則】,不是本片新立的** —— 收斂成同一句:
 *    **「不知道」與「是 0」不是同一件事,而【頭條數字】是最不能把這兩者講成同一句的位置。**
 *    ```
 *    後端把「不知道」當 0  ⇒ 下游還有機會發現
 *    畫在畫面 / 印在紙上   ⇒ 那就是最終答案,看的人沒有第二個來源可以對
 *    ```
 *
 *    ① `quantitySummary === null` ⇒ 件數那格一個數字都不印。
 *       實作在 `goodsQuantityHeadline`(`order-status-axes.ts`),原文警告在它的 docstring 裡複述。
 *    ② `PaymentSummary.kind === 'unknown'` ⇒ **已收那半不畫任何金額**(總額仍印,它不來自那條路)。
 *       出處錨點:`payment-list.tsx` 搜 `不畫任何金額` —— 逐字「讀不到明細時算出來的『已收』必然是假的,
 *       而它會被畫成一句員工無法分辨真假的催款訊息」。⇒ 頭條吃**同一個** `toPaymentSummary()`,
 *       **不另立算法**。
 *       ⚠️ **上一版我寫「⇒ 結構上不可能與付款卡對不起來」,那是講大了**(code-reviewer 2026-08-16 抓,已改口):
 *          共用的是**那支函式**,**不是它的第一個引數** —— `amountDue` 由 `order-detail.tsx`
 *          **分兩個 call site** 傳給付款卡與本元件。誰把其中一邊改成別的口徑,另一邊不會跟,
 *          而**沒有任何一格斷言把兩個「已收」綁在一起**。
 *          ⇒ 正確講法:**同一支算式 + 同一個來源欄位,而「兩邊傳同一個引數」靠呼叫端自律、不是型別。**
 *    ③ `detail.itemsTruncated` ⇒ 件數那格一個數字都不印。
 *       🔴 **這道只有這裡擋得到**:`goodsQuantityHeadline` 的參數型別看不到這個旗標(刻意的)。
 *       📎 **風險量測與「代價不對稱」的完整論證只寫一處** —— 在
 *       `order-detail-summary-cards.tsx` 的 `GoodsAxisValue` 前面那段(搜 `ORDER_ITEMS_EMBED_LIMIT`)。
 *       🔴 **2026-08-27 改指向:原文寫「見【本檔上方】」,而那是搬家之前的話** ——
 *          `GoodsAxisValue` 與那個常數**留在舊檔**,本檔一個都沒有。
 *          📌 一句自指的「本檔上方」,在搬家之後會變成一個**指著空氣、而讀起來完全正常**的指路。
 *       **兩處全文會漂**,這裡只留指標。
 *    ④ **扣已取消件數** —— 見下方那段。
 *
 * 🔴 **④ 的註解釘在【一致性】,不釘在某個數字上**:
 *    ```
 *    本頭條的扣法必須與 `goodsAxisOfLines`(order-status-axes.ts)一致。
 *    🔴 那邊改了扣法,這邊要跟 —— 不一致時員工會看到頭條與狀態膠囊互相矛盾,
 *       而【沒有任何東西會紅】。
 *    📎 歷史:#522 就是這樣把前一版的裁定作廢的(前提變了、結論沒跟著翻)。
 *    ```
 *    **機制上已經做到了**:本元件不自己算,直接吃 `goodsQuantityHeadline` ——
 *    它與軸/小字**共用同一支 `lineNeed`** ⇒ 「跟著改」不再依賴有人記得。
 *    ⚠️ `Q-A7` 第一次裁「不扣」、第二次改裁「扣」。**判準始終是「與軸一致」,變的是軸怎麼算**
 *    (`#522` 把分母換成 `quantity − cancelled`)⇒ 那不是推翻裁定,是前提被換掉。
 *    🔴 `~/pcm-mailbox/A-215-STOP.md` 約束表第 ④ 條仍寫著「不扣」= **同一個過期來源的迴音**,
 *       不要拿它來推翻本檔(2026-08-16 A 窗實查 `lineNeed` 字面確認)。
 */

/**
 * 頭條「件數」答不出來時,旁邊那一行。
 *
 * 🔴 **字面是提案,等 Sean 過目** —— 三句都照取消區那格的三段式(原因 / 下一步 / 不是你的錯)。
 * ⚠️ `truncated` 那句**逐字對齊既有兄弟**(`order-detail-summary-cards.tsx` 的 `GoodsAxisValue`
 *    截斷態;2026-08-27 補上檔名 —— 搬家之後裸寫元件名會讓人在本檔裡找它),兩處講同一件事不該兩種說法。
 *
 * 🔴 **`export` 的理由(照 `orders-table.tsx` 的 `CELL` 前例)**:`refund-wiring.test.tsx` 的
 *    四格錨要接上這幾句才撈得到那一格,而**在測試檔裡硬寫一份**會與本表各自漂 ——
 *    **而漂掉的時候不會紅,只會讓那四格靜靜地失去判別力。**
 *    ⚠️ 只有測試在用這個 export;元件內用法一行沒變。
 * 🔴 **它守不到的那一格,明講**:測試從本常數組出期望字串 ⇒ **若這裡有一句被改成空字串,
 *    那四格仍然綠**(兩邊一起變)。「這三句話真的有內容、而且互不相同」由
 *    `order-detail-headline-qty-note.test.tsx` 釘(它斷言的是**寫死的片語**,不是本常數)。
 */
export const QTY_MISSING_NOTE = {
  truncated: '這張單的品項清單這次沒有完整載入,算不出件數。請重新整理。',
  noItems: '這張單沒有任何品項,所以沒有件數可以算。',
  // 🔴 2026-08-22 改字(線 A `-86` 扮員工走一天時量到的):
  //    舊句先講【罕見】的那個世界(資料沒建好 ⇒ 找系統維護),而**這一格 89% 的時候是正常的**
  //    —— 正式庫實測 17/19 張單、19/22 個品項沒有 quantity summary 列,
  //    而那正是「還沒跟供應商下訂」的樣子(`lib/orders/order-status-axes.ts:240-243`:惰性建列,
  //    「沒有那一列」**就是**「這個品項還沒訂貨」)。
  //    ⇒ 舊句會讓員工每天為了沒事打電話,而**等真的壞掉那天,他已經學會忽略這句話了**。
  // 🔴 **形狀是「先做這個,還是不對再說」,不是宣稱** —— 因為程式自己承認
  //    「摘要列真的不存在」與「投影壞掉讀不到」**在畫面上長得一樣**(同檔 :244-246)。
  //    ⇒ 不可以寫成「這代表還沒下訂」,那是一句它證明不了的話。
  // ⚠️ 既有四格守門(`order-detail-headline-qty-note.test.tsx:99-102`)一格都沒放寬:
  //    仍含「數量資料尚未就緒」與「系統維護」、仍不含「請重新整理」。**我沒有改任何期望值。**
  notReady:
    '還算不出件數。最常見的原因是這幾項還沒跟供應商下訂 —— 請看下面商品清單裡標「數量資料尚未就緒」的那幾項,下訂之後這裡就會出現數字。若你確定已經下訂過、數字卻一直沒出現,那時才需要通知系統維護 —— 這不是你操作錯誤。',
} as const;

/**
 * 頭條那一排(總額/已收 · 尾款 · 件數)—— OD FIX-07 之後它住在**分頁列上方的抬頭**,四頁共用。
 *
 * 🔴 **名字從 `HeadlineNumbers` 改成 `OrderFocalRow`,而那不是美化**:
 *    上一版我用 `<OrderSummaryCards section='focal'/>` 叫它 —— 而 `section='focal'` 渲染的是
 *    `HeadlineNumbers`,**名字與它畫出來的東西對不起來**(審查 important 5 點名「名字說謊」)。
 * 🔴 **`OrderSummaryCards` 那個外殼已刪除**,理由是審查量到的:
 *    ```
 *    生產呼叫端 order-detail.tsx:440 section='focal' / :779 section='cards'
 *    ⇒ 【沒有任何一處不給 section】⇒ 那個預設分支從出生就沒有生產呼叫端
 *    ⇒ 它不是既有債, 是【本片自己造的死碼】, 而三支測試在斷言一棵沒有人看得到的樹
 *    ```
 *    ⚠️ 我原本擋掉這個乾淨做法的理由是「改 `vi.mock` = 動測試檔」——**那個理由經不起看**:
 *       補 mock 的 key 是**模組 export 改名時同步 mock**,不是改期望值。
 *       §3-② 那條紀律的射程是【斷言】,不涵蓋這個。**主視窗 2026-08-23 授權,射程只到這裡。**
 * 📌 **原本那個 `-space-y-px` 外殼一併消失**:它的作用是讓頭條與三卡**共用同一條 1px 線**,
 *    而分頁化之後這兩塊**不再相鄰**(一個在抬頭、一個在客戶頁)⇒ 它已經沒有對象。
 *    (實查:全 repo 測試零處斷言 `space-y-px`。)
 */
export function OrderFocalRow({
  detail,
  payments,
}: {
  detail: AdminOrderDetail;
  payments: PaymentListData;
}) {
  // 🔴 與付款卡逐字同一個呼叫形狀:只有 `ok` 才交得出 rows,其餘兩態一律傳 `null`。
  const payment = toPaymentSummary(
    detail.total.amount,
    payments.status === 'ok' ? payments.rows : null,
  );
  // ③ 截斷閘與 ① 的 null 閘在這裡合流 —— 兩者都只能答「未知」,不能答一個數字。
  const qty = detail.itemsTruncated ? null : goodsQuantityHeadline(detail.items);
  /**
   * 🔴 **「未知」有三條路,而它們的【下一步】不同**(2026-08-21 線 E)。
   *    在此之前三條路共用一個裸「未知」:24px、整個面板最大的字、**而它沒說原因也沒說怎麼辦**。
   *    同一個面板裡的取消區已經有正確形狀(原因 + 下一步 + 「這不是你操作錯誤」)
   *    ⇒ 這一片是**把那個形狀複製過來**,不是發明新文案。
   *    (anchor:grep `這不是你操作錯誤`)
   *
   * 🔴🔴 **2026-08-27 補:那一行【從常駐變成要點一下才看得到】,而這是一個可觀察的行為改變。**
 *    稿把它收進 `<details>`(虛線 chip 就是 `<summary>`,說明在裡面)—— **收合是稿本身**,
 *    我解 payload 逐字確認過(`<details>` + 三個 `<span>` + `max-w-[46ch]` 的 `<p>`),不是我發明的。
 *    ⚠️ **而守它的那把尺沒有跟著改**:`order-detail-headline-qty-note.test.tsx` 讀的是
 *       `textContent`,而 `textContent` 讀得到**尚未展開**的 `<p>` ⇒ 那把尺量的是
 *       【那句話在不在 DOM 裡】,**不是【使用者現在看不看得到】**。
 *    🔴 **尺沒變,而被量的東西縮進了尺量不到的那一半。** 那不是尺壞了,是它的射程沒有涵蓋新的問法
 *       ——「員工會不會發現要點它」只有真的看畫面(或加一格可見性斷言)才答得出來。**本片沒有做那件事。**
 *
 * 🔴 **「未知」那兩個字本身不動** —— 本檔自己寫著理由
   *    (anchor:grep `「不知道」與「是 0」不是同一件事`)。**缺的是它旁邊那一行。**
   *
   * ⚠️ **`notReady` 那句刻意【不提】重新整理**:`quantitySummary === null` 的來由是
   *    `SupabaseOrderAdapter.ts`(anchor:grep `還沒建那一列`)—— 那讀起來像持久狀態、
   *    不是暫時載入失敗 ⇒ 「請重新整理」很可能是**叫員工做一件不會有用的事**。
   *    🔴 **而「重整到底有沒有用」我沒有驗過** ⇒ 所以那句話**兩個方向都不承諾**,
   *    只講「去哪裡看」與「找誰」。**驗出來之前不要幫它補上「請重新整理」。**
   */
  const qtyMissingReason: 'truncated' | 'noItems' | 'notReady' | null =
    qty !== null
      ? null
      : detail.itemsTruncated
        ? 'truncated'
        : detail.items.length === 0
          ? 'noItems'
          : 'notReady';

  /**
   * 🔴 **尾款的顏色 = 稿上量到的規則,不是我挑的**(payload 實量,分母寫在檔頭):
   *    `text-primary` 20 個 ⇒ 值全部非 0;`text-foreground` 18 個 ⇒ 值全部是 0。
   * ⚠️ **而 `unknown` / `over` 兩態在稿上【零樣本】** ⇒ 這兩態走 `text-foreground` 是**我推的**。
   *    判準:`text-primary` 在稿上 20/20 都掛在**一個真的待收金額**上,而「未知」與「溢收」
   *    都不是那個語意。**要改請當它是未定案,不要當成對過稿。**
   */
  const dueEmphasised = payment.kind === 'short';

  return (
    /* 🔴 OD FIX-01 焦點列 —— **class 字面逐字抄自解開的 payload**(檔頭寫了量法與 sha)。
       ⚠️ **`px-0 py-2.5` 不是筆誤**:稿上這一列的容器就是這個值。
          那個 `bg-card px-4 py-3 text-card-foreground`(payload 114 個)是**別的元素**,
          照它做會多出左右內距。 */
    <div
      data-od-id='order-focal'
      className='bg-card text-card-foreground flex flex-wrap items-center gap-x-6 gap-y-2 px-0 py-2.5'
    >
      {/* 🔴 **底下這段是【搬過來的原文,一個字沒改】** —— 它解釋的碼從三張卡換成了這一列,
          而**它記的拍板沒有跟著版面失效**。鐵則 6:註解跟著它解釋的那段碼搬。 */}
      {/* 🔴 片3 新增:尾款。**四態各講各的話,不共用一個數字** ——
          `toPaymentSummary` 回四種 kind(`apps/admin/src/lib/orders/payment-list-view.ts:161-165`
          —— 🔴 **寫全路徑不寫裸檔名**:讀的人在 `components/orders/` 底下找不到它,
          而**行號對得上會讓他以為是自己找錯**;W6 nit),而它們的下一步不同:
            unknown  收款列讀不到 ⇒ **不能答一個數字**(答 0 = 對員工說「收齊了」)
            short    還欠 gap     ⇒ 這是設計稿畫的那一格(23,800 / 10,000 ⇒ 13,800)
            settled  剛好收齊     ⇒ `0`,而**要真的印 0**,不是留白(留白讀起來像「還沒算」)
            over     溢收         ⇒ 🔴 **不印負數**。負的尾款沒有意義,而它會被讀成「還要收 -N」;
                                     用「溢收 N」——那是本 repo 既有詞(`payment-list.tsx:145`)。
          🔴 **輸入是三態不是兩態**(W6 nit):`PaymentListData` = `ok` / `order_not_found` / `unreadable`
          (`payment-list.tsx:24-29`)。本格只在 `ok` 時交出 rows、**其餘一律 `null` ⇒ 收斂成 `unknown`**
          ⇒ **構造上 fail-closed**:日後多一個 status,它也自動落進「未知」而不是某個假數字。
          ⚠️ 而**那兩個非-ok 態的下一步其實不同**(`order-detail-items-table.tsx:119-124` 各給不同訊息)
          —— 本格刻意不分,因為頭條只有一格、講不了兩句話;要分要去那張卡看。
          ⚠️ **本格與左邊那格吃【同一支】`toPaymentSummary`** ⇒ 兩格結構上不可能互相矛盾。
             各自算一次的話,哪天有人改了其中一邊的規則,畫面會同時顯示兩個都合理而互相打架的數。 */}
      {/* 🔴 尾款 —— 稿上這一格是**整列唯一的大字**,而小標在數字【左邊同一基線】,不在下方。
          (舊版三張卡是「大數字在上、小標在下」;那個結構在現行稿裡一個都不剩:
           `text-2xl leading-[1.15] font-light` 在 payload ⇒ **0**。) */}
      <div className='flex items-baseline gap-2'>
        <span className='text-muted-foreground text-xs font-bold tracking-[1.5px]'>尾款</span>
        <span
          className={`${dueEmphasised ? 'text-primary' : 'text-foreground'} text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums`}
        >
          {payment.kind === 'unknown'
            ? '未知'
            : payment.kind === 'over'
              ? `溢收 ${formatOrderAmount(payment.excess)}`
              : formatOrderAmount(payment.kind === 'short' ? payment.gap : 0)}
        </span>
      </div>
      {/* 稿上的直立分隔線。`aria-hidden` 也是稿上的。
          🔴 **`max-sm:hidden` 是【真瀏覽器量到才補的】**:390px 下這一列會 `flex-wrap` 換行,
             而分隔線與彈簧會**吊在行尾**(截圖 `l1-shot-4-mobile-after` 第一版看得到)。
             稿的 `FIX-80` 對這兩個元素逐字寫的就是 `display:none`
             (`orders-admin-v2.html:5772-5773`)⇒ 這是**搬稿,不是我發明的修法**。
          ⚠️ **而 FIX-80 的另一半(2×2 網格 + `28px⇒22px`)仍然沒搬** —— 它掛在
             `.od-fullpage>header>.od-focal`,而本 repo 沒有 `od-fullpage` 這個 class。
             ⇒ **本片只搬得動這兩條;窄螢幕的版面與稿【仍有已知差異】,不要讀成已對齊。** */}
      <div className='bg-border h-8 w-px max-sm:hidden' aria-hidden='true' />
        {/* 🔴 **金額不帶 `NT$`**(Sean 2026-08-16 於真路由肉眼驗後逐字:「不用NT」)。
            ⚠️ **這是【呼叫端字面】不是格式化函式** —— `formatOrderAmount` 本身只回數字
            (`order-list-view.ts` 搜 `toLocaleString`),`NT$` 一直是各處自己前綴的。
            ⇒ 本片**沒有動共用函式**,只動這兩行 ⇒ **不中鐵則 12⑥**。
            **數法**:`grep -rn 'formatOrderAmount(' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '.test.' | wc -l`
            ⇒ **27**,其中 1 行是**定義本身**(`order-list-view.ts` 搜 `export function formatOrderAmount`)、
            1 行是**註解**(`customers/customer-detail-view.ts` 搜 `千分位對齊`)⇒ **真消費端 25**。
            (我第一版寫「27 個消費端」—— 那是把定義與註解也算進去,code-reviewer 抓到。**先分類再報數。**)
            🔴🔴 **同一頁上面沒幣別、下面有,是【他知情的選擇】,不是漏改**
            (`Q-A216-F4` Sean 2026-08-16 拍**乙**,逐字「乙 留著」):
              **頭條是速覽 → 不帶幣別;明細表底部的「總計」是正式金額 → 帶 `NT$`。**
            (那一處在 `order-detail-items-table.tsx` 搜 `總計`。)
            ⚠️ **不要當成不一致去「修好」它** —— 我在他拍板前就是把它列成「請他再看一眼」的疑點,
            而他看了、選了留著。**把兩處統一才是違反拍板。** */}
      {/* 🔴 總額 / 已收 —— 稿上降成 `text-sm`(14px)且**與標籤同一行**,不再是一張卡。 */}
      <p className='text-sm tabular-nums'>
        <span className='text-muted-foreground'>總額 / 已收</span>{' '}
        <span className='font-medium'>
          {formatOrderAmount(detail.total.amount)} /{' '}
          {payment.kind === 'unknown' ? '未知' : formatOrderAmount(payment.received)}
        </span>
      </p>
      {/* 稿上的彈簧:把件數那塊推到最右。`max-sm:hidden` 同上一條(FIX-80 `:5773`)。 */}
      <span className='flex-1 max-sm:hidden' />
        {/* 🔴🔴 **小標是「件數」不是「品項數」——【這是正確性修正,不是文案調整】。**
            (`Q-A216-F2b` Sean 2026-08-16 拍甲)
            `goodsQuantityHeadline` 加總的是**件數**(每個 line 的 `quantity` 面),
            而「品項數」是**另一個數**:OD 稿自己就把兩者分開寫成「**3 項 · 4 件**」
            (`overview-desktop-bmw-m.html` 搜 `項 ·`)⇒ 一張 3 個品項、共 4 件的單,
            兩個詞的值不同。**用「品項數」會讓員工照字面去對帳,然後對不上。**
            🔴 **不要改回去** —— 這不是「哪個詞好聽」,是那個詞指錯了對象。
            ⚠️ 而「已訂 / 到貨」放小標的理由不變:兩個裸數字掛在一個詞底下分不出誰是誰,
            而後台 UI 常設驗收條款是「不用人教能做對嗎」(2026-08-11 Sean 拍板)。 */}
      {/* 🔴🔴 件數 —— **稿上這是【一個 `<details>`】,不是「一個 chip + 一個說明區塊」。**
          虛線 chip 就是它的 `<summary>`,而「為什麼」是 summary 裡的一個 `<span>`。
          (主視窗轉給我的描述把它寫成兩件事 ⇒ 照那個做會多出一個元素。)
          ⚠️ `[&::-webkit-details-marker]:hidden` 是稿上的:不藏的話 Safari 會多一個三角形。 */}
      <details className='min-w-0'>
        <summary className='border-border hover:bg-muted inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-xs [&::-webkit-details-marker]:hidden'>
          <span className='text-muted-foreground'>件數 已訂 / 到貨</span>
          <span className='font-semibold tabular-nums'>
            {qty === null ? '未知' : `${qty.ordered} / ${qty.instock}`}
          </span>
          {qtyMissingReason !== null && (
            <span className='text-primary underline underline-offset-2'>為什麼</span>
          )}
        </summary>
        {qtyMissingReason !== null && (
          <p className='text-muted-foreground mt-2 max-w-[46ch] text-xs leading-relaxed'>
            {QTY_MISSING_NOTE[qtyMissingReason]}
          </p>
        )}
      </details>
    </div>
  );
}
