// order-list-view.ts — 後台訂單列表「顯示層」純工具(M-4a 訂單線第一片)。
//
// 訂單專屬:searchParams 白名單守門 / 篩選標籤 / 日期金額格式化。通用分頁數學 / param 解析 / 連結建構
// 走 ../shared/list-params(訂單與客戶列表共用)。無 server-only、無 @/、型別 import 自 @pcm/domain(抹除)→ 可單測。

import type {
  AdminOrderFilter,
  PaymentStatus,
  FulfillmentStatus,
  OrderGoodsAxis,
  OrderSource,
  PaymentChannel,
  MemberTier,
  OrderItemVehicleSnapshot,
  InvoiceStatus,
} from '@pcm/domain';
// 🔴 `#484a` A2:四值的**唯一權威**在 domain(migration 的 `goods_axis` 與本檔的下拉是兩個消費者)。
//    本檔不自己抄一份陣列 —— 抄了就是第三份字面,而三份只會在其中一份改動時才發現不同步。
import { ORDER_GOODS_AXIS_VALUES } from '@pcm/domain';
import {
  pickEnum,
  pickEnumMulti,
  firstValue,
  parsePage,
  buildListHref,
  type FilterOption,
} from '../shared/list-params';
// #350d:面板判準要 uuid 閘;一次性參數清單與 `order-return-to.ts` 共用單一來源
// (兩邊各寫一份 = 補了 `rt` 卻只補一邊,症狀是重複鍵讓取消面板永遠讀不到)。
import { isUuid } from './note-action-state';
import { ORDER_PANEL_PARAM, ORDER_OPEN_PARAM, RESULT_ONLY_PARAMS } from './order-return-to';
// #347-3c-1:曆面日 ↔ 絕對時刻的換算只有 domain 一份(自己拼 `new Date(ymd)` 是 UTC 午夜、差 8 小時)。
import {
  taipeiDayEndExclusiveIso,
  taipeiDayStartIso,
  recentTaipeiMonthsRange,
  taipeiYmdFromDayEndExclusive,
  taipeiYmdFromInstantIso,
} from '@pcm/domain';

/** 每頁筆數(server 端 .range 分頁)。 */
export const ORDERS_PAGE_SIZE = 20;

/** 查詢字串鍵名(與 DB 欄對齊、URL 可讀)。 */
export const PAYMENT_STATUS_PARAM = 'payment_status';
/**
 * `#484a` A2:貨品軸的查詢鍵。**取代了舊的出貨狀態鍵**。
 *
 * 🔴 **舊鍵自此被忽略**(白名單只認下列鍵)。這不是為了乾淨,是因為**舊鍵的值篩不到任何東西**:
 *    舊值是 `notOrdered/ordered/inStock/shipped`,新欄的值是 `none/ordered/instock/shipped`
 *    —— 第一與第三個字面不同。正式站實測 `goods_axis=in.(notOrdered)` ⇒ **0 筆**;
 *    `in.(none)` ⇒ 12 筆、`in.(ordered,instock,shipped)` ⇒ 1 筆(合計 13 = 全部)。
 *    ⇒ 若留著舊鍵讓它「照樣解析」,舊書籤會安靜地變成「篩了一個永遠零筆的條件」。
 * ⚠️ **殘留的死參數會被帶著走、但不影響行為**:`buildCarriedUrlValues` 只回聲表上認得的鍵,
 *    舊書籤上的 `fulfillment_status=…` 改一次篩選就掉了。解析端已經忽略它 ⇒ **零行為影響**。
 */
export const GOODS_AXIS_PARAM = 'goods_axis';
export const ORDER_SOURCE_PARAM = 'order_source';
export const PAYMENT_CHANNEL_PARAM = 'payment_channel';
// A9w2(九碼退場):`workflow_status` 查詢鍵、`unset` 哨兵與其解析函式已下架 ——
// URL 帶 `?workflow_status=…` 自此**被忽略**(白名單只認下列鍵),不再進 `AdminOrderFilter`。
// #347-B(Q-347-B1=B):`order_no` / `supplier_no` 兩個專用搜尋 query key 已隨兩個搜尋欄一起退場。
// URL 帶 `?order_no=…` 或 `?supplier_no=…` 自此**被忽略**(白名單只認下列鍵)——
// 兩者的能力併入關鍵字搜尋(`admin_search_orders` 的 #1 新單號 / #12 舊單號 / #11 供應商單號)。
/**
 * 「連刷卡未付款一起顯示」切換(M-4b 生命週期 L6)。
 * 🔴 **只有字面 `'1'` 才算開**:任何其他值(`'true'` / `'0'` / 空字串 / 未知字串)一律當關 ——
 * 預設隱藏是 Sean 要的行為,解析出錯時要倒向**預設**,不是倒向「全顯示」。
 * ⚠️ 同鍵重複(`?show_unpaid_card=1&show_unpaid_card=x`)**取首值後再比對** —— 與其他軸一致;
 *    直接拿陣列比字串會恆 false,那會讓「勾打開後一翻頁就失效」(測試 L6-4 釘住)。
 */
export const SHOW_UNPAID_CARD_PARAM = 'show_unpaid_card';
/**
 * `#1` 片1:「待收款/待訂貨」chip 的 URL 參數(唯一開啟值 `'1'`,形狀照抄上面那顆 L6 布林開關)。
 * 🔴 **參數名固定是 `pending`,不隨顯示字面走** —— 片6 改了 chip 名字而這裡一個字沒動,
 *    那是刻意的:改文案不該讓使用者存起來的網址失效。
 *
 * 🔴 **片1 就把它接進 URL,不留到片2** —— 不是範圍擴張,是 `buildOrderListHref` 的**編譯期窮舉守門**
 *    (本檔 `byFilterKey`)在我加了 `AdminOrderFilter.pendingOnly` 的當下就紅了,逼我現在做決定。
 *    ⚠️ 另一個選法是「登記但不進 URL」,而那會埋下本檔已經記過**兩次**的同一個坑:
 *    **翻頁時那一軸靜默消失、而畫面上的選擇還在。** 片2 接上 chip 之後才會有人踩到,
 *    到時**沒有任何東西會叫**。⇒ 現在接,零 producer、零可見變化。
 */
export const PENDING_ONLY_PARAM = 'pending';
/** 唯一開啟值;其餘一律關(fail-safe 倒向不篩)。 */
export const PENDING_ONLY_ON = '1';
export const SHOW_UNPAID_CARD_ON = '1';

// ── L3 片4:列表**顯示設定**(密度)。與上面那些**篩選**軸分開放,理由見 `OrderListDisplayState` ──

/** 密度切換的 query key(Sean 拍 Q3=A:走 URL 參數,不走 cookie / localStorage)。 */
export const ORDER_DENSITY_PARAM = 'den';

/**
 * 密度三檔的**值域**(哪三檔),真權威 = OD `overview-desktop.html:171-173` 的 CSS 宣告。
 *
 * 🔴 **這裡刻意不寫三檔的 px 值**(R 審 nit②):值只准住 `app/globals.css` 的
 *    `--od-row-h` / `--od-fs` / `--od-fs-sm`。註解裡再抄一份是**第二份文字複本** ——
 *    它不影響行為、但 CSS 改值時會**靜默過期**,而守門掃不到註解。
 *    要看數字請直接看那三條 CSS 規則。
 * ⚠️ **不要照 OD `index.html:204` 那張說明表**(它的緊湊檔是舊值)——
 *    同一份 OD 內部有兩處這種矛盾,通則與另一處記在
 *    `docs/specs/2026-08-12-admin-order-ui-design-brief.md` §0-D 開頭那張表。
 */
export const ORDER_DENSITY_VALUES = ['loose', 'std', 'tight'] as const;
export type OrderDensity = (typeof ORDER_DENSITY_VALUES)[number];

/** 預設 = **寬鬆**(OD `:170` 註解逐字要求維持第五輪拍板的寬鬆檔;px 值同上,只住 CSS)。 */
export const ORDER_DENSITY_DEFAULT: OrderDensity = 'loose';

/**
 * 列表的**顯示狀態**(不是篩選)。
 *
 * 🔴🔴 **為什麼不塞進 `AdminOrderFilter`**(主視窗 E-407 §2 裁 A,理由是型別語意不是省工):
 *    `AdminOrderFilter` 一路傳到 repository / DB 查詢層 ⇒ 把顯示設定混進去,
 *    等於**讓查詢層看得到一個它永遠不該用的欄位**,而「這個欄位要不要進 SQL」
 *    會變成每個讀 code 的人都要重新判斷一次。
 * 🔴 但它**仍然要有窮舉守門** —— 見 `buildOrderListHref` 的 `byDisplayKey`:
 *    這個型別加一軸而那裡沒列,`tsc` 直接紅。兩個型別語意乾淨分離、兩邊都有機制。
 */
export type OrderListDisplayState = {
  density: OrderDensity;
};

// ── 值域(對齊 domain enum + DB CHECK;解析時白名單守門,非法值忽略)──

// 🔴 手抄清單、typecheck 抓不到漏抄(`readonly PaymentStatus[]` 少一個元素不是型別錯誤)。
//    漏抄的後果:新狀態不出現在後台篩選下拉,且 `?payment_status=<新值>` 會被 pickEnum 白名單靜默丟棄。
//    ⇒ PaymentStatus 每次加值必須手動同步本陣列(M-3 RF2a 的 partiallyRefunded 即為此類)。
export const PAYMENT_STATUS_VALUES: readonly PaymentStatus[] = [
  'paid',
  'unpaid',
  'partiallyPaid',
  'refunded',
  'partiallyRefunded',
];
/**
 * ⚠️ `#484a` A2 起**零生產端** —— 篩選白名單已改用 `ORDER_GOODS_AXIS_VALUES`,
 *    這一份現在只剩 `order-list-view.test.ts` 的「標籤完整性」測試在用。
 * 🔴 **不刪**(對照 A9w2/A9w3 刪 export 的慣例):它是 `FULFILLMENT_STATUS_LABEL` 的窮舉來源,
 *    而那張表還有兩個顯示端(明細頁 / 客戶頁)。刪了那格完整性測試就沒有東西可窮舉。
 */
export const FULFILLMENT_STATUS_VALUES: readonly FulfillmentStatus[] = [
  'notOrdered',
  'ordered',
  'inStock',
  'shipped',
];
export const ORDER_SOURCE_VALUES: readonly OrderSource[] = [
  'web',
  'manual_phone',
  'manual_line',
  'manual_other',
];
export const PAYMENT_CHANNEL_VALUES: readonly PaymentChannel[] = [
  'tappay',
  'bank_transfer',
  'cash',
  'none',
];

// ── 中文標籤(admin 分軸顯示:付款軸 / 出貨軸各自獨立,非會員側合併字串)──
// 會員側 order-display.ts orderStatusLabel 把雙軸合成一句(給客人看);admin 要 granular 分欄查「已付未出」,
// 故付款 / 出貨各自一張表。文案 admin 視角、與會員側刻意不同(L2 hardcode、未來移後台 CMS)。

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: '已付款',
  unpaid: '待付款',
  // 🔴 2026-08-18 Sean 拍板(Q3=「已收訂金」):~~付款確認中~~ 作廢。
  //    病灶(E-711 §1 逐字):enum 語意是 `partially_captured`=**收了一部分、這張單還欠錢**,
  //    而「付款確認中」讀起來是「錢在路上、等一下就好」⇒ **員工不會去催尾款**。
  //    差別不在措辭好不好聽,在**員工會不會去做事**。
  // ⚠️ **客人端那半(`apps/storefront/src/lib/orders/order-display.ts:46`)Sean 還沒答**,
  //    刻意不一起改 —— 兩端各寫一份、沒有 import 關係(E-711 §2),而
  //    `paid` 早就是後台「已付款」/ 客人「處理中」兩個詞(E-711 §3)⇒ **不一致是慣例,不是漏改**。
  //
  // 🔴🔴 **射程限定(code-reviewer 抓到,我原本沒寫,而它會讓人高估這一改的效果)**:
  //    **員工每天看的那個畫面(訂單【列表】)根本印不出這個字面。**
  //    `orders-table.tsx` 零引用 `PAYMENT_STATUS_LABEL`(量法 `grep -c 'PAYMENT_STATUS_LABEL'
  //    apps/admin/src/components/orders/orders-table.tsx` ⇒ 0);列表走的是
  //    `order-status-axes.ts:204 orderPayAxis`,它把 `paid` 以外**全部**收斂成 `unpaid`
  //    ⇒ 列表顯示「未收…」,不分「一毛沒收」與「收了訂金」。
  //    ⇒ 本改動只在**三個**地方生效(出處 = 本檔 `:208-209` 自己記的消費端清單):
  //      ① 篩選下拉 `PAYMENT_STATUS_OPTIONS`(`order-filter-bar.tsx:40`)
  //      ② 訂單明細頁付款狀態欄(`order-detail-summary-cards.tsx:332`)
  //      ③ 客戶明細頁的訂單列(`customer-detail-sections.tsx:89`)
  //    ⇒ 🔴 **「讓員工去催尾款」這個動機,在最常看的畫面上【還沒有】達成** —— 那要另一片
  //      (列表的收款軸要不要從二值長出第三值),而那動的是 `#494` 拍過的狀態八值,不是本片。
  partiallyPaid: '已收訂金',
  refunded: '已退款',
  // M-3 RF2a:部分退款(退了一部分、訂單仍有保留品項)。與會員側 order-display.ts 同字面。
  partiallyRefunded: '已退部分',
};

// ── 狀態膠囊配色(M-4b E10 A11b,2026-08-07:訂單列表付款軸/訂貨軸從純文字改膠囊上色)──
// 出貨軸 A11b 當時不做,理由是「`AdminOrderItemQuantitySummary` 無 shipped 欄」。
// 🔴 **那個理由已於 L0(2026-08-13)失效**:該型別現在**有** `shippedQuantity`,列表投影也撈了。
//    ⇒ 出貨軸現在缺的是**畫法**(狀態八值欄,L3),不是資料。留著舊句會讓人以為前置還沒到。
// 形狀逐字元同 `notes-timeline.tsx:89`(含 `font-medium`);`customer-detail-sections.tsx:23` 那族
// 少一個 `font-medium`、不是同款。Record 驅動配色的先例 =
// `notes-timeline.tsx:15-19`,語彙 = 綠完成 / 琥珀進行中或要注意 / 灰中性或未開始 / 紅要處理。

/** 共用膠囊形狀。桌機與卡片兩份 markup 都套同一顆 class 常數,不各自組一份字串。
 *
 * 🔴🔴 **2026-08-16 Sean 拍板「狀態膠囊 —— 方角」⇒ 拿掉 `rounded-full`。**
 *    在此之前我方**刻意與 OD 不同**(pill),依據是「形狀傳達可不可以互動」——
 *    **那條依據已被他本人推翻**,現在與 OD `:206` 的 `.cap{border-radius:0}` 一致。
 *    📎 OD 全稿唯一圓角的 class 叫 `.legacy`(`:316`),那正是它用來對照的「被換掉的那一版」。
 * ⚠️ **沒有改成 `rounded-none`,而是整個拿掉** —— Tailwind preflight 不設 `border-radius`,
 *    無類別即 0;寫 `rounded-none` 只是多一個等值字面。(片1 也已把 `--radius` 與五階釘死 0。)
 */
export const STATUS_CAPSULE = 'inline-flex px-2 py-0.5 text-xs font-medium';

/* 🏁 **L3 片1(2026-08-14)刪除兩個 export:`PAYMENT_STATUS_CAPSULE` 與 `orderedCapsuleClass`。**
   Sean 拍 Q2=A:訂單列表的付款膠囊與訂貨欄兩個都下架、狀態欄獨扛
   ⇒ 兩支的**唯一** production 消費端(`orders-table.tsx`)同片移除。
   實查(刪之前跑,`git grep` 全 repo、排除 docs/):除了 `orders-table.tsx` 與它的測試,零命中。
   🔴 **不留成沒有消費端的 export**:它們的測試也在同一片被換掉 ⇒ 留著就是「零消費端且零覆蓋」的死碼,
      而下一個人看到它會以為列表還在用這套配色。要找回來 = `git show 025a7e7e:` 那份。
   ⚠️ `PAYMENT_STATUS_LABEL` **不刪** —— 它還有三個消費端(篩選選項 `PAYMENT_STATUS_OPTIONS`、
      `order-detail.tsx:349`、`customer-detail-sections.tsx:80`)。 */

/**
 * 出貨狀態(`orders.fulfillment_status`)的中文標籤。
 *
 * ⚠️ `#484a` A2 起**只剩顯示用**(訂單明細頁「出貨狀態」欄、客戶頁的訂單列)——
 *    篩選那一邊已改用下面的 `GOODS_AXIS_LABEL`。兩張表**刻意保持字面相同**,
 *    因為它們對員工是同一件事;不同的是**資料從哪來**(這一張讀那個從沒被推進過的欄位)。
 */
export const FULFILLMENT_STATUS_LABEL: Record<FulfillmentStatus, string> = {
  notOrdered: '未訂貨',
  ordered: '已向廠商訂貨',
  inStock: '已到貨',
  shipped: '已出貨',
};

/**
 * 貨品軸的中文標籤(`#484a` A2 的篩選下拉)。
 *
 * 🔴 **字面逐字沿用上面那張表**(未訂貨 / 已向廠商訂貨 / 已到貨 / 已出貨):
 *    這一片修的是「選了篩不到」,**不是改文案** —— 員工看到的下拉應該一個字都沒變,
 *    變的是選下去之後真的篩得到。任何文案調整都要另外走 Sean,不夾帶在這一片。
 * ⚠️ 這與狀態膠囊的八值(`order-status-axes.ts` 的 `ORDER_STATUS_LABEL`)**不是同一套詞** ——
 *    那邊是「收款軸 × 貨品軸」相乘後的複合詞(如「未收現貨」),這邊是單軸。
 */
export const GOODS_AXIS_LABEL: Record<OrderGoodsAxis, string> = {
  none: '未訂貨',
  ordered: '已向廠商訂貨',
  instock: '已到貨',
  shipped: '已出貨',
};

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
  web: '網站',
  manual_phone: '電話',
  manual_line: 'LINE',
  manual_other: '其他',
};

export const PAYMENT_CHANNEL_LABEL: Record<PaymentChannel, string> = {
  tappay: '線上刷卡',
  bank_transfer: '銀行轉帳',
  cash: '現金',
  none: '未指定',
};

/**
 * 會員等級標籤(orders.tier_at_checkout;M-4a Slice D-1a 列表「會員等級」欄)。
 *
 * 🔴🔴 **三個字是 Sean 2026-09-13 逐字拍的:「我們還是變成 會員、車行、經銷,三種就好」。**
 * 這張表**不是**唯一的真值來源,而是**後台三張表的共同字面** —— 客戶列表
 * `lib/customers/customer-list-view.ts` 的 `TIER_LABEL` 與稽核
 * `lib/audit/audit-field-label.ts` 的 `tier` 同日一起改成這三個字
 * (「三種就好」= 後台不要三套說法)。改這裡要三張一起改,否則同一位客人在三頁有三個名字。
 *
 * ⛔ ~~2026-09-13 稍早那一版 premiumStore = 'PREMIUM STORE'~~ —— Sean 當天推翻。
 * ⛔ ~~更早那一版 store 與 premiumStore 都印「車行」~~ —— 那讓員工分不出誰是經銷,已是舊裁定。
 *
 * 🛑 **前台那張表【不動】** —— `apps/storefront/src/components/TierBadge.tsx` 仍印
 * 「一般會員 / 店家會員 / PREMIUM STORE」,它是 design 真權威(鐵則 1)、而且是**客人看得到的字**。
 * 「前台要不要跟著改」主視窗 2026-09-13 已另外端給 Sean,**他沒答之前那支一個字不碰**。
 */
export const MEMBER_TIER_LABEL: Record<MemberTier, string> = {
  general: '會員',
  store: '車行',
  premiumStore: '經銷',
};

/**
 * 開票紀錄狀態標籤(`orders.invoice_status`;DB CHECK 三值)。
 *
 * 🔴 **明細與列表共用**(A11a-5 起):原本住在 `order-detail-view.ts`,但該檔檔頭逐字宣告
 * 「列表共用標籤(付款/出貨/來源/管道)仍在 `order-list-view.ts`、本檔不重定義」——
 * 發票欄進列表之後它就成了共用標籤,依那條慣例搬過來。
 * ⇒ **不要在任何一邊另抄一份三態中文**:A11a plan V11 要的是「三態各自可辨識、且 `voided`
 * 不與 `not_issued` 同字面」,共用一個 `Record<InvoiceStatus, string>` 讓這件事結構上成立。
 */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  not_issued: '未開立',
  issued: '已開立',
  voided: '已作廢',
};

function toOptions<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): FilterOption[] {
  return values.map((v) => ({ value: v, label: labels[v] }));
}

export const PAYMENT_STATUS_OPTIONS = toOptions(PAYMENT_STATUS_VALUES, PAYMENT_STATUS_LABEL);
export const GOODS_AXIS_OPTIONS = toOptions(ORDER_GOODS_AXIS_VALUES, GOODS_AXIS_LABEL);
export const ORDER_SOURCE_OPTIONS = toOptions(ORDER_SOURCE_VALUES, ORDER_SOURCE_LABEL);
export const PAYMENT_CHANNEL_OPTIONS = toOptions(PAYMENT_CHANNEL_VALUES, PAYMENT_CHANNEL_LABEL);

/**
 * 日期範圍下拉的選項(#347-3c-2)。
 *
 * 🔴🔴 **區間由 server 算好、連同 label 一起傳給 client** —— client 一個字都不碰時鐘。
 *    理由:①`new Date()` 在 server 與 client 各算一次會 hydration 不一致(而症狀是
 *    「重整之後選中的選項跳掉」這種沒人查得出來的東西)②算得出來才測得到:
 *    這支是純函式、吃 `now`,邊界(月界、跨年)在單測裡構造得出來。
 * 🔴 **沒有「全部」選項**:那是 plan §1-1 認列過的誠實代價 —— 要看更早的單就選「自訂」
 *    給一個很早的起日。沒有逃生口的預設等於把舊單藏起來,所以**自訂與預設必須同片**。
 */
const ORDER_DATE_PRESETS = [
  // 🔴 `months: 0` ⇒ `recentTaipeiMonthsRange` 回 `fromYmd === toYmd === 台北曆面今天`
  //    (`packages/domain/src/order/date-range.ts:140-156`:`target = m-1-0` ⇒ 同月同日)。
  //    ⇒ 這一格**沒有動那支 helper 一個字**,它本來就算得出「今天」。
  //    起因:`#16` 今日對帳的卡片寫「今日新單 N 筆」,而這個下拉最短只到「近一個月」
  //    ⇒ 員工要看那 N 張單得選「自訂」打兩次日期。
  { key: 'd0', label: '今天', months: 0 },
  { key: 'm1', label: '近一個月', months: 1 },
  { key: 'm3', label: '近三個月', months: 3 },
  { key: 'm6', label: '近半年', months: 6 },
  { key: 'y1', label: '近一年', months: 12 },
] as const;

/** 「自訂」那一格的 key —— 它沒有預先算好的區間,由員工自己填兩個日期。 */
export const ORDER_DATE_CUSTOM_KEY = 'custom';

/**
 * 「未選」時的預設 —— Sean Q14=A 逐字「未選預設近半年」。
 * 🔴 它是**下拉的預設選項**(看得見、改得動),不是隱形過濾:
 *    `parseOrderListSearchParams` 套它的同時,`buildOrderListHref` 會把日期寫進 URL、
 *    篩選列也會把「近半年」顯示成選中 ⇒ 員工看得到自己正在看的是哪段期間。
 *    這條的來由與被推翻的舊方案見 plan §1-1 的推翻框。
 */
export const ORDER_DATE_DEFAULT_KEY = 'm6';

export type OrderDatePresetOption = {
  key: string;
  label: string;
  fromYmd: string;
  toYmd: string;
};

/** 把每個預設算成具體的曆面日區間(台北曆面;`now` 由呼叫端注入)。 */
export function buildOrderDatePresetOptions(now: Date): OrderDatePresetOption[] {
  return ORDER_DATE_PRESETS.map(({ key, label, months }) => {
    const { fromYmd, toYmd } = recentTaipeiMonthsRange(now, months);
    return { key, label, fromYmd, toYmd };
  });
}

/**
 * 目前選中的是哪一格 —— 拿當下的 from/to 去比對每個預設算出來的區間。
 *
 * 🔴 **這是「選中的選項」與「生效的區間」之間唯一的連結**:比對不上就顯示「自訂」,
 *    而不是硬選一個 —— 顯示「近半年」卻篩著別的區間,比顯示「自訂」糟得多。
 * ⚠️ 誠實邊界:區間是**相對今天**算的 ⇒ 昨天分享的一條「近半年」網址,今天打開會顯示「自訂」
 *    (因為它的迄日停在昨天)。那是對的:它篩的**確實**不是今天的近半年。
 */
function matchOrderDatePreset(
  options: readonly OrderDatePresetOption[],
  fromYmd: string,
  toYmd: string,
): string {
  return (
    options.find((o) => o.fromYmd === fromYmd && o.toYmd === toYmd)?.key ?? ORDER_DATE_CUSTOM_KEY
  );
}

// ── searchParams 解析(白名單守門 + 分頁頁碼)──

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * 解析 searchParams → { filter(白名單守門後的雙軸+次要), page }。
 * 非法篩選值一律忽略(等同不篩選);多勾選軸(D-1b:來源/管道)收同鍵重複 param、
 * 逐值守門+去重、全非法/缺 → undefined;page 下界 1(parsePage 共用)。
 */
export function parseOrderListSearchParams(
  raw: RawSearchParams,
  options?: {
    /**
     * #347-3c-2「未選預設近半年」用的**現在時刻**。
     *
     * 🔴 **不給就不套預設**(= 3c-1 的行為,不限期間)。刻意做成 opt-in 而不是 `?? new Date()`:
     *    ①本函式是純函式,內建時鐘就測不出邊界;②「有沒有套預設」變成呼叫端明講的事,
     *    而不是某個檔案深處的預設值 —— 這一軸會**藏掉半年前的單**,那個決定要看得見。
     */
    now?: Date;
  },
): {
  filter: AdminOrderFilter;
  page: number;
  /** L3 片4:顯示設定(密度)。**與 filter 分開回傳** —— 它不進 DB 查詢。 */
  display: OrderListDisplayState;
  /** #347-3c-2:日期下拉的選項(server 算好;沒給 `now` 時為空陣列 = 不顯示下拉)。 */
  datePresetOptions: OrderDatePresetOption[];
  /** #347-3c-2:選中的那一格(`custom` = 兩個日期輸入)。 */
  selectedDatePresetKey: string;
} {
  const dateRange = resolveOrderDateRange(raw, options?.now);
  const filter: AdminOrderFilter = {
    paymentStatus: pickEnum(raw[PAYMENT_STATUS_PARAM], PAYMENT_STATUS_VALUES),
    // 🔴 `#484a` A2:`pickEnumMulti` 不是 `pickEnum` —— 型別是陣列(片 B 的 chip UI),
    //    而白名單守門照舊:URL 帶不認得的值 ⇒ 那個值被丟掉,不是整軸 fail-open。
    // 🔴🔴 **但這一片先 clamp 成最多 1 值**(code-reviewer R1 M6 抓到的真分岔):
    //    可見控制項是**單選下拉**(`order-filter-bar.tsx` 取 `?.[0]`),而 `buildOrderListHref`
    //    會把 N 個值原樣帶著走 ⇒ 手工網址 `?goods_axis=ordered&goods_axis=instock` 會造出
    //    「列表篩兩值、下拉只顯示第一個」的狀態,員工一動任何其他篩選,第二個值就**靜默消失**
    //    —— 那正是本檔記過三次的 fail-open 形狀。
    //    ⇒ 在 chip UI(片 B)把第二個 producer 補上之前,**寧可少篩一個值也不要顯示與實際不一致**。
    //    ⚠️ 片 B 要拿掉這個 `.slice(0, 1)`,同時把 `FilterState.goods` 改成陣列 —— 兩件事必須同一片。
    goodsAxes: pickEnumMulti(raw[GOODS_AXIS_PARAM], ORDER_GOODS_AXIS_VALUES)?.slice(0, 1),
    orderSources: pickEnumMulti(raw[ORDER_SOURCE_PARAM], ORDER_SOURCE_VALUES),
    paymentChannels: pickEnumMulti(raw[PAYMENT_CHANNEL_PARAM], PAYMENT_CHANNEL_VALUES),
    // L6:唯一開關值 '1';其餘一律 false(fail-safe 倒向預設隱藏)。
    includeUnpaidCardOrders: firstValue(raw[SHOW_UNPAID_CARD_PARAM]) === SHOW_UNPAID_CARD_ON,
    // `#1` 片1:唯一開關值 '1';其餘一律 false(fail-safe 倒向不篩,同 L6 那顆的既有理由)。
    pendingOnly: firstValue(raw[PENDING_ONLY_PARAM]) === PENDING_ONLY_ON,
    // #347-3c-1:曆面日 → 絕對時刻。形狀不合 ⇒ `undefined`(該側不限)、不是回零筆
    //    —— 日期打錯字只是「這一軸不篩」,其他軸照舊生效,不會造出假的查無
    //    (與已退場的兩個專用單號欄相反 —— 它們是打錯字就回零筆的 fail-closed;
    //    日期這一軸的理由在 domain `date-range.ts`)。
    // 🔴 **#347-3c-2 起這裡有預設了**(3c-1 那句「本片沒有預設」已被推翻,不要照舊讀):
    //    呼叫端給 `options.now` 才套(見 `resolveOrderDateRange`)—— 給不給是呼叫端明講的事,
    //    因為這一軸會**藏掉半年前的單**。可見性由同一份結果的 `selectedDatePresetKey` 保證。
    createdFrom: dateRange.createdFrom,
    createdTo: dateRange.createdTo,
  };
  return {
    filter,
    page: parsePage(raw.page),
    // 🔴 非法值倒向**預設**(同 L6 那條的 fail-safe 方向):`?den=xxx` 不該讓畫面壞掉,
    //    也不該讓它變成「某個沒人選過的密度」。`pickEnum` 是本檔既有的白名單守門。
    display: {
      density: pickEnum(raw[ORDER_DENSITY_PARAM], ORDER_DENSITY_VALUES) ?? ORDER_DENSITY_DEFAULT,
    },
    datePresetOptions: dateRange.options,
    /** 篩選列要把哪一格顯示成選中(= 真正生效的那段期間;兩者同源,不可能對不上)。 */
    selectedDatePresetKey: dateRange.selectedKey,
  };
}

/**
 * 日期軸:URL → 生效區間 + 下拉狀態(#347-3c-2)。
 *
 * 三種狀態,**只有這裡決定**(選中的選項與生效的區間同源 ⇒ 結構上不可能對不上):
 * ① URL 帶了合法日期 ⇒ 用它,選中的格子由 `matchOrderDatePreset` 比對(對不上 = 自訂);
 * ② URL 沒帶、且呼叫端給了 `now` ⇒ **套預設近半年**(看得見:下拉顯示「近半年」、
 *    而 `buildOrderListHref` 會把日期寫進 URL);
 * ③ URL 沒帶、也沒給 `now` ⇒ 不限期間、不顯示下拉(= 3c-1 的行為)。
 *
 * 🔴 **只帶一邊也算「帶了」**:員工用自訂只填起日是合理的(「這天之後的全部」),
 *    那時不得把另一邊補成預設 —— 補了就是「我只設了起日,迄日卻被系統偷偷設成今天」。
 */
function resolveOrderDateRange(
  raw: RawSearchParams,
  now: Date | undefined,
): {
  createdFrom: string | undefined;
  createdTo: string | undefined;
  options: OrderDatePresetOption[];
  selectedKey: string;
} {
  const fromYmd = firstValue(raw[DATE_FROM_PARAM]) ?? '';
  const toYmd = firstValue(raw[DATE_TO_PARAM]) ?? '';
  const fromIso = taipeiDayStartIso(fromYmd);
  const toIso = taipeiDayEndExclusiveIso(toYmd);
  const options = now === undefined ? [] : buildOrderDatePresetOptions(now);

  if (fromIso !== null || toIso !== null) {
    return {
      createdFrom: fromIso ?? undefined,
      createdTo: toIso ?? undefined,
      options,
      selectedKey: matchOrderDatePreset(options, fromYmd, toYmd),
    };
  }
  if (now === undefined) {
    return { createdFrom: undefined, createdTo: undefined, options, selectedKey: ORDER_DATE_CUSTOM_KEY };
  }
  const preset = options.find((o) => o.key === ORDER_DATE_DEFAULT_KEY);
  // 🔴 找不到預設那一格 = `ORDER_DATE_PRESETS` 與 `ORDER_DATE_DEFAULT_KEY` 不同步
  //    ⇒ 不靜默降級成「不限期間」(那會讓預設默默消失、而畫面上沒人說),直接當自訂空區間。
  if (preset === undefined) {
    return { createdFrom: undefined, createdTo: undefined, options, selectedKey: ORDER_DATE_CUSTOM_KEY };
  }
  return {
    createdFrom: taipeiDayStartIso(preset.fromYmd) ?? undefined,
    createdTo: taipeiDayEndExclusiveIso(preset.toYmd) ?? undefined,
    options,
    selectedKey: preset.key,
  };
}


/**
 * 右側面板要開哪一張單(#350c;主視窗 2026-08-10 裁 A 案)。
 *
 * 🔴 面板**不是** intercepting route —— v1 走過那條,真瀏覽器實測「軟導航回列表時面板黏著不放」,
 * 而 Next 文件的兩種標準修法(槽 catch-all、槽精確空頁)實測**皆無效**(`D-403-Q` §①)。
 * 改成 searchParams 驅動之後 **URL 一變槽頁就重算**,黏住問題從根消失。
 *
 * ⚠️ **定義搬到 `order-return-to.ts`**(#350d):那支要拿它比對「`return_to` 指的是不是同一張單」
 * (契約 §6-1),而它不能反向 import 本檔(會成環)。這裡 re-export 讓既有 import 路徑不變 ——
 * 兩邊各寫一份字面才是真的坑。
 */
export { ORDER_PANEL_PARAM, ORDER_OPEN_PARAM } from './order-return-to';

/**
 * 建立日期範圍(#347-3c-1)。URL 上帶的是**曆面日 `YYYY-MM-DD`**(員工看得懂、網址可分享),
 * filter 裡放的是**絕對時刻** —— 兩者的換算只有 `@pcm/domain` 的 `date-range.ts` 一份。
 * 🔴 `date_to` 是**含當天**的結束日(進 filter 時變成下一個台北午夜,見 domain 檔頭)。
 */
export const DATE_FROM_PARAM = 'date_from';
export const DATE_TO_PARAM = 'date_to';

/**
 * 🆕 **P-b:列表要就地展開哪張單**(`?open=<uuid>`)。
 * 非字串 / 重複鍵 / 非 UUID ⇒ `null`(不展開);UUID **正規化成小寫**(R2 F1:`isUuid` 是 `/i`
 * ⇒ 大寫 UUID 過閘,但表單送的 `order_id` 是 `detail.id`(DB 出來一律小寫)⇒ `parseOrderReturnTo`
 * 的 §6-1 比對會判「不同單」⇒ 動作做完**靜默把明細關掉**。觸發只要一條大寫的書籤網址。
 * 在**入口**折平比在比對處放寬安全:後者等於讓兩個不同字串被當成同一張單)。
 *
 * ⛔ 2026-09-13 拆面板:它原本的孿生 `readOpenPanelOrderId`(`?panel=`)連同 `@panel/orders` 一起刪了。
 *    舊書籤 `?panel=<uuid>` 由 `orders/page.tsx` 一進來就導成 `?open=<uuid>`(不是 404)。
 */
export function readOpenOrderId(
  raw: Record<string, string | string[] | undefined>,
): string | null {
  const value = raw[ORDER_OPEN_PARAM];
  return typeof value === 'string' && isUuid(value) ? value.toLowerCase() : null;
}

/**
 * ⛔ 拆面板(2026-09-13)的**唯一相容層**:舊書籤 `?panel=…` 要導去哪。回 `null` = 不用導。
 *
 *   · `panel=<uuid>`(含大寫)⇒ 同一串 query、`panel` 換成 `open=<小寫 uuid>`、`customer` 丟掉
 *     (客人卡連同面板一起拆了;整頁 `/customers/<id>` 是唯一入口)。其餘鍵**逐字保留**(篩選 / 頁碼 / `r`)。
 *   · `panel=new`(舊手動建單面板)⇒ `new=1`(彈窗)。
 *   · 沒帶 / 非 UUID / 重複鍵 ⇒ `null`:頁面照舊渲染、`panel` 當不存在(與拆之前「面板不開」同一個結果)。
 *
 * 🔴 主視窗硬線:舊書籤**不得 404**。這支不打 DB —— 查無此單的話 `open=` 那條路自己會說「找不到」。
 */
export function legacyPanelRedirectHref(
  raw: Record<string, string | string[] | undefined>,
): string | null {
  const value = raw[ORDER_PANEL_PARAM];
  if (typeof value !== 'string') return null;
  const isNew = value === 'new';
  if (!isNew && !isUuid(value)) return null;
  const params = new URLSearchParams();
  for (const [key, v] of Object.entries(raw)) {
    if (key === ORDER_PANEL_PARAM || key === 'customer') continue;
    if (Array.isArray(v)) for (const item of v) params.append(key, item);
    else if (v !== undefined) params.set(key, v);
  }
  if (isNew) params.set('new', '1');
  else params.set(ORDER_OPEN_PARAM, value.toLowerCase());
  return `/orders?${params.toString()}`;
}

/**
 * 建 `/orders?...` 連結(分頁 / 篩選保留;page=1 省略);多勾選軸=同鍵重複 param;走共用 buildListHref。
 *
 * 🔴 **面板連結一定要走本支、不得在元件裡自己拼字串**(#350c):下方那兩條 🔴 註警告的
 * 「漏帶參數 = 搜尋詞被靜默丟掉、列表 fail-open 變全部訂單」對面板連結同樣成立 ——
 * 員工點開一張單就把篩選條件洗掉,是同一個坑的第三次。
 */
/** `buildListHref` 吃的一組 `[param, value]`。 */
type HrefEntry = readonly [string, string | readonly string[] | undefined];

/**
 * `keyword` 那一格的 param 名 —— **一個不存在的鍵**,值恆為 `undefined` ⇒ 永遠不會進 URL。
 * 🔴 用具名常數而不是空字串:讓「為什麼這一軸沒有 param」在 grep 得到的地方留下答案。
 */
const ORDER_KEYWORD_URL_EXCLUDED = '__keyword_lives_in_httponly_cookie__';

/**
 * 「這條連結**刻意**不開面板」(`#742`)。
 *
 * 🔴 用 `Symbol` 是為了**寫不出字面量** —— 呼叫端要表達「刻意」就得 import 這顆,
 *    於是「決定」變成一個**有名字、有出處、數得出來**的東西,而不是一個省略。
 *    病灶原文與五個呼叫點的實測見 `buildOrderListHref` 第 4 參數的 docstring。
 */
/**
 * 🔴🔴 **`/orders` 的 query 鍵 —— 唯一一份【鍵 + 順序】表**(`#742` 殘餘;主視窗 2026-08-20 批)。
 *
 * **為什麼要有這張表**:在它之前,同一條 URL 有**兩份鍵清單**——
 * 本檔的 `buildOrderListHref`,與 `components/orders/order-filter-controls.tsx` 自己那份 `href()`。
 * 兩份會各自演化,而分岔的症狀是「**某個鍵在某條路上消失**」:
 * ```
 * #347-3c-1  日期兩軸      2026-08-10  commit 6bc6545e
 * #484a A2   goods_axis    2026-08-14  commit 81f5b45c
 * #742       四個鍵        2026-08-20  Sean 本人撞到（翻頁把面板關掉）
 * ⇒ 10 天內三次，而第三次是使用者先撞到。它不是架構債，是有復發週期的東西。
 * ```
 * ⇒ **修法不是「讓兩份保持一致」(那需要有人持續維護),是「只留一份」。**
 *
 * 🔴 **順序是行為,不是風格**:`buildListHref` 的 docstring 逐字「entries 順序決定 query 順序」
 *    (`lib/shared/list-params.ts:95`)。而 `#741` 的碰撞判定用
 *    `JSON.stringify(Object.fromEntries(...))` —— 那個字串對鍵順序敏感。
 *    ⚠️ **本表的順序刻意等於本片之前 `buildOrderListHref` 的既有順序** ⇒ server 側輸出**逐字不變**;
 *      改變的只有 client 側(它原本把 4 個鍵**接在尾巴**,現在回到表上的位置)。
 *
 * ⚠️ `keyword` **不在表上**,而那是**刻意**:搜尋詞是 PII、住在 httpOnly cookie
 *    (`#347-2b`,Sean `Q-a=B` 紅線)。它由 `ORDER_KEYWORD_URL_EXCLUDED` 這顆具名哨兵在
 *    `buildOrderListHref` 內部標記「這一軸被做過決定」—— **「刻意不進 URL」不是「還沒決定」。**
 */
const ORDER_LIST_URL_KEYS = [
  PAYMENT_STATUS_PARAM,
  GOODS_AXIS_PARAM,
  ORDER_SOURCE_PARAM,
  PAYMENT_CHANNEL_PARAM,
  SHOW_UNPAID_CARD_PARAM,
  PENDING_ONLY_PARAM,
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  ORDER_DENSITY_PARAM,
  // 🆕 P-b:就地展開的那張單。⛔ 拆面板(2026-09-13)起 `panel` / `customer` 不在表上:
  //    列表不再產它們, 舊書籤 `?panel=<id>` 由 `orders/page.tsx` 導成 `?open=<id>`。
  ORDER_OPEN_PARAM,
] as const;

/**
 * 表上每一格的值。**少一格就 `tsc` 紅** —— 那是本片的整個重點:
 * 新增一個鍵時,**兩個 producer 都會紅**,而不是只有其中一個。
 * ⚠️ 值一律是**已經是 URL 形狀的字串**(不是 domain 值)——
 *    理由見 `orderListHrefEntries` 的 docstring。
 */
export type OrderListUrlValues = Record<
  (typeof ORDER_LIST_URL_KEYS)[number],
  string | readonly string[] | undefined
>;

/**
 * 把表上的值排成 `buildListHref` 吃的 entries(**順序由 `ORDER_LIST_URL_KEYS` 一支決定**)。
 *
 * 🔴 **為什麼共用層畫在「URL 值」而不是「domain 值」**:兩個 producer 的**輸入型別本來就不同** ——
 *    server 拿 `AdminOrderFilter`(日期是**絕對時刻** ISO),client 拿 `FilterState`(日期是**曆面日**)。
 *    共用層若畫在 domain 值,client 就得自己做時區換算 ⇒ **打破「時區換算只有一份」那條既有紀律**,
 *    比現在這個病更貴。⇒ 換算留在各自的 mapper,本支只收已經換算完的字串。
 */
export function orderListHrefEntries(values: OrderListUrlValues): readonly HrefEntry[] {
  return ORDER_LIST_URL_KEYS.map((key) => [key, values[key]] as HrefEntry);
}

export const PANEL_CLOSED = Symbol('panel-closed');

/**
 * 「這條列表連結要開哪張單的面板」的型別;**元件之間傳這個值時一律用這顆別名**,
 * 免得中途有人把它放寬回 `string | undefined`(那就退回 `#742` 的病)。
 */
export type OrderPanelTarget = string | typeof PANEL_CLOSED;

/**
 * 篩選列**不擁有、但不得吃掉**的那幾個鍵(`#742` 的另一半)。
 *
 * 🔴 病灶:`order-filter-controls.tsx` 有**自己那份 `href()`**(本檔之外的第二個 URL builder),
 *    它只列 7 個鍵 ⇒ **改任一篩選就把這四個鍵靜默丟掉**
 *    (面板自己關掉 / 「待收款待訂貨」自己熄掉 / 密度變回預設)。
 *
 * 🔴 **為什麼不逐鍵【重建】語意**:這四個鍵的**真相不在篩選列手上**
 *    (面板開誰是 URL 說了算、密度是工具列說了算)。重建等於在第二個地方複製一份語意,
 *    而本片修的就是「兩份清單各自演化」這個病 —— 再開一份只是把第五次推到以後。
 *
 * ⚠️ ~~**本支只搬運、不驗證**:值的合法性由各自的 reader 負責~~
 *    **這句是我寫的,而它錯了(W6 審查抓到,同片更正)**:本支若「只搬運」,就等於
 *    **自己持有一條規則**(當時是「陣列取第一個」)—— 而那條規則與 reader 的規則**分岔**,
 *    症狀是「改個篩選,面板自己打開了」。⇒ 現在本支**逐鍵呼叫那些 reader 本人**,
 *    **沒有自己的規則可言**。錯法留著,因為「搬運不需要驗證」聽起來非常合理。
 */
/**
 * 從當下的 searchParams 抓出那四個鍵,回成 `a=1&b=2`(沒有就回空字串)。
 * 給 `order-filter-controls` 的 `href()` 直接接在自己那串後面。
 *
 * 🔴🔴 **每一個鍵都走【它自己那支 reader】,本支不自己判一次**(W6 審 `#742` 的 nit)。
 *    原本這裡是一條**通用規則**(「陣列取第一個」),而那讓本支與 `readOpenPanelOrderId` 分岔:
 *    ```
 *    ?panel=a&panel=b（只有手打 / 書籤做得出來）
 *      readOpenPanelOrderId  陣列 ⇒ typeof !== 'string' ⇒ null ⇒ 這次渲染面板是【關】的
 *      本支（舊版）           陣列 ⇒ value[0]          ⇒ 回聲出單一的 ?panel=a
 *      ⇒ 員工改一個篩選 ⇒ **面板自己打開了**
 *    ```
 *    ⇒ `#742` 是「改篩選把面板關掉」,這一格是**它的鏡像**:「改篩選把面板打開」。
 *    ⚠️ 而它**不是理論值**:`readOpenPanelOrderId` 自己的註解記著一次真事故,
 *      逐字「觸發只要**一條大寫的書籤網址**」⇒ 這個 repo 已經被書籤網址咬過一次。
 *
 * 🔴 **W6 那句比 nit 本身值錢,抄在這裡**:舊版**有**測陣列那一格,
 *    而它測的是「本支的行為」,沒測「**兩支對同一個鍵的規則一不一致**」——
 *    **一個契約有兩邊,而斷言只釘了一邊;兩邊各自都對,合起來才錯。**
 *    ⇒ 修法不是在本支補一條 if,是**讓本支沒有自己的規則可言**。
 */
export type OrderListCarriedValues = Pick<
  OrderListUrlValues,
  | typeof PENDING_ONLY_PARAM
  | typeof ORDER_DENSITY_PARAM
  | typeof ORDER_OPEN_PARAM
>;

export function buildCarriedUrlValues(
  raw: Record<string, string | string[] | undefined>,
): OrderListCarriedValues {
  const out: Record<string, string | undefined> = {
    [PENDING_ONLY_PARAM]: undefined,
    [ORDER_DENSITY_PARAM]: undefined,
    [ORDER_OPEN_PARAM]: undefined,
  };

  // `open`:走 reader(非 UUID / 重複鍵 ⇒ `null` = 不展開 ⇒ 不回聲);順帶拿到正規化(小寫)。
  //   ⛔ `panel` 不再回聲(拆面板 2026-09-13):改篩選會把舊書籤上的 `panel` 丟掉, 而那正是要的 ——
  //      它在 `orders/page.tsx` 一進來就被導成 `open` 了, 回聲它等於把一條死路抄回網址。
  const openId = readOpenOrderId(raw);
  if (openId !== null) out[ORDER_OPEN_PARAM] = openId;

  // `den`:與 `parseOrderListSearchParams` 逐字同一條運算式(白名單;非法值倒向預設)。
  //   🔴 **等於預設就不寫進 URL** —— 與 `buildOrderListHref` 對 `den` 的處置一致,
  //      否則每條連結都掛著 `den=loose` 這個雜訊。
  const density = pickEnum(raw[ORDER_DENSITY_PARAM], ORDER_DENSITY_VALUES);
  if (density !== undefined && density !== ORDER_DENSITY_DEFAULT) {
    out[ORDER_DENSITY_PARAM] = density;
  }

  // `pending`:同上,唯一開關值 `'1'`,其餘一律不回聲(fail-safe 倒向不篩)。
  if (firstValue(raw[PENDING_ONLY_PARAM]) === PENDING_ONLY_ON) {
    out[PENDING_ONLY_PARAM] = PENDING_ONLY_ON;
  }

  return out as OrderListCarriedValues;
}

export function buildOrderListHref(
  filter: AdminOrderFilter,
  /**
   * L3 片4:顯示設定。**必填,刻意的**(主視窗 E-424 裁)。
   *
   * 🔴 做成選填會把下面那道窮舉守門的價值**整個**削掉,不是削一半:
   *    那道守門的唯一功能是「漏了會在編譯期叫」;選填 ⇒ 病從「忘了列進表」搬到「忘了帶參數」,
   *    而**新的位置沒有任何東西會叫**。改 7 個呼叫端是機械成本,`tsc` 會逐處指給你看。
   * ⚠️ 位置放在第 2 個而不是主視窗字面說的「第 4 個」:**TypeScript 根本不允許必填參數排在選填之後**
   *    —— 放第 4 個(在 `panelOrderId` 之後)會直接 `error TS1016: A required parameter cannot follow
   *    an optional parameter.`(R 窗 2026-08-14 在自己的 worktree 跑探針實測)。
   *    ⇒ **不是「可以但不安全」,是寫不出來。** 裁決的要求是「必填」這個性質,位置由語言規則決定。
   *    🔴 我原本把理由寫成「語言層擋不住跳過它」——**那是我憑印象寫的、而且是錯的機制**,已更正。
   */
  display: OrderListDisplayState,
  page: number,
  /**
   * 這條連結要把哪張單開進右側面板;`PANEL_CLOSED` = **刻意**不開(列表狀態照舊保留)。
   *
   * 🔴🔴 **`#742`:本參數原本是選填 `panelOrderId?: string`,而那讓「忘了帶」與「刻意不帶」
   *    在型別上長得一模一樣、`tsc` 不會叫。** 實測後果 = 五個 production 呼叫點裡有三個忘了帶
   *    ⇒ **翻頁 / 按 chip / 換密度都會把員工正在看的那張單關掉**,而沒有任何東西會紅。
   *
   * 🔴 **為什麼是 `Symbol` 而不是 `string | null`**:必填的 `null` 只擋得住「忘了帶」那一半,
   *    「刻意」仍然寫成一個裸 `null` ⇒ 讀的人分不出那是決定還是隨手。
   *    `Symbol` **沒有字面量** ⇒ 要用它就**必須 import `PANEL_CLOSED`**
   *    ⇒ 刻意關閉在程式碼上跟「帶著面板」一樣顯眼,而且**數得出來**:
   *    `grep -rn 'PANEL_CLOSED' apps/admin/src` 的每一筆都是一個有出處的決定。
   *    ⇒ **兩半都是機制**:忘了帶 = 編譯不過;刻意 = 有名字、要 import、grep 得到。
   */
  panelOrderId: OrderPanelTarget,
): string {
  // 🔴🔴 **編譯期窮舉守門(#347-3c-1;機制優先律 —— 不是再寫一條「記得列進來」的規則)**:
  //    型別是 `Record<keyof AdminOrderFilter, …>` ⇒ **filter 加一軸而這裡沒列,`tsc` 直接紅**。
  //    在這之前是手抄列舉,而漏列的症狀是「翻頁時那一軸靜默消失、畫面上的選擇還在」——
  //    本檔已為不同的軸記過**兩次**同一個坑(下面兩條 🔴),第三次改用機制擋。
  //    ⚠️ 這道**只保證「每個軸都被做過決定」**,保證不了那個決定是對的:對到錯的 param 名、
  //      或該帶卻寫 `undefined`,型別一樣過。那半靠 `order-list-view.test.ts` 的往返測試。
  const byFilterKey: Record<keyof AdminOrderFilter, HrefEntry> = {
    paymentStatus: [PAYMENT_STATUS_PARAM, filter.paymentStatus],
    goodsAxes: [GOODS_AXIS_PARAM, filter.goodsAxes],
    orderSources: [ORDER_SOURCE_PARAM, filter.orderSources],
    paymentChannels: [PAYMENT_CHANNEL_PARAM, filter.paymentChannels],
    // 🔴 L6 的開關必須帶著走:漏列 = 員工打開「連未付款一起看」之後一翻頁
    //    就被打回預設隱藏,而畫面上的勾還打著 = 顯示與實際篩的東西不一致。
    includeUnpaidCardOrders: [
      SHOW_UNPAID_CARD_PARAM,
      filter.includeUnpaidCardOrders ? SHOW_UNPAID_CARD_ON : undefined,
    ],
    // 🔴 同上:關著時**不留空參數**(網址乾淨),開著才帶 —— 漏列的症狀是
    //    「按了『待收款/待訂貨』、一翻頁就被打回全部,而 chip 還亮著」。
    pendingOnly: [PENDING_ONLY_PARAM, filter.pendingOnly ? PENDING_ONLY_ON : undefined],
    // 🔴🔴 **`keyword` 刻意不進 URL**(#347-2b;Sean Q-a=B 紅線):搜尋詞是 PII
    //    (客人姓名 / 電話 / 地址),它住在 httpOnly cookie 裡。寫在這裡是為了讓
    //    「這一軸被做過決定」留下字面,而不是看起來像漏掉。
    keyword: [ORDER_KEYWORD_URL_EXCLUDED, undefined],
    // #347-3c-1:URL 帶曆面日、filter 帶絕對時刻 ⇒ 這裡換回曆面日(換算只有 domain 一份)。
    createdFrom: [
      DATE_FROM_PARAM,
      // 🔴 走帶 NaN 閘的那支(R1 must-fix 1):`isoBackToTaipeiYmd(new Date(''))` 會擲 RangeError
      //    ⇒ 型別上合法的空字串會把整個 `/orders` 打成 500,而不是這一格失效。
      filter.createdFrom === undefined
        ? undefined
        : (taipeiYmdFromInstantIso(filter.createdFrom) ?? undefined),
    ],
    createdTo: [
      DATE_TO_PARAM,
      filter.createdTo === undefined
        ? undefined
        : (taipeiYmdFromDayEndExclusive(filter.createdTo) ?? undefined),
    ],
  };
  // 🔴🔴 **第二道編譯期窮舉守門(L3 片4)** —— 與上面那道同構、但守的是**顯示軸**。
  //    `OrderListDisplayState` 加一軸而這裡沒列 ⇒ `tsc` 直接紅。
  //    ⚠️ 同樣**只保證「每個軸都被做過決定」**,保證不了那個決定是對的
  //      ⇒ 那半靠 `order-list-view.test.ts` 的三條(帶著走 / 等於預設不寫進 URL / 往返)。
  const byDisplayKey: Record<keyof OrderListDisplayState, HrefEntry> = {
    // 🔴 **等於預設值就不寫進 URL**:否則每條連結都掛著 `den=loose`,而那是雜訊
    //    (同 L6 的 `SHOW_UNPAID_CARD_PARAM` 關著時不留空參數那條)。
    density: [
      ORDER_DENSITY_PARAM,
      display.density === ORDER_DENSITY_DEFAULT ? undefined : display.density,
    ],
  };
  // 🔴🔴 **表上 11 格逐格填**(`#742` 殘餘)。少一格 `tsc` 直接紅 —— 而**另一個 producer
  //    (`order-filter-controls.tsx` 的 `href()`)填的是同一張表**,所以它也會紅。
  //    ⚠️ 上面兩個 Record 仍然是**值的來源**(它們守的是「domain 的每一軸都被做過決定」);
  //      本表守的是另一件事:「**URL 上的每一個鍵**都被做過決定」。兩道守的不是同一件事,都要留。
  const values: OrderListUrlValues = {
    [PAYMENT_STATUS_PARAM]: byFilterKey.paymentStatus[1],
    [GOODS_AXIS_PARAM]: byFilterKey.goodsAxes[1],
    [ORDER_SOURCE_PARAM]: byFilterKey.orderSources[1],
    [PAYMENT_CHANNEL_PARAM]: byFilterKey.paymentChannels[1],
    [SHOW_UNPAID_CARD_PARAM]: byFilterKey.includeUnpaidCardOrders[1],
    [PENDING_ONLY_PARAM]: byFilterKey.pendingOnly[1],
    [DATE_FROM_PARAM]: byFilterKey.createdFrom[1],
    [DATE_TO_PARAM]: byFilterKey.createdTo[1],
    [ORDER_DENSITY_PARAM]: byDisplayKey.density[1],
    // 🆕 P-b:就地展開寫 `open`。參數**名字**還叫 `panelOrderId` —— 那是 7 個呼叫端
    //    與 `PANEL_CLOSED` 那套「刻意 vs 忘了」機制的接口,先不改名。
    //    📌 讀法:`panelOrderId` = 「這條連結要讓哪張單在列表上【展開】」。
    //    ⛔ 2026-09-13 拆面板:`panel` / `customer` 兩格連同右側面板一起拿掉(不再是窮舉表上的鍵)。
    [ORDER_OPEN_PARAM]: panelOrderId === PANEL_CLOSED ? undefined : panelOrderId,
  };
  return buildListHref('/orders', orderListHrefEntries(values), page);
}

// 🔴 **`formatOrderDate` 已於 A9c(2026-08-06)刪除**(主視窗裁定,`E-116-A`)。
// A11a-2 把列表日期格改接 `formatOrderListDate` 之後,它的 production consumer 歸零;
// A11a plan `:185` 保留它的理由「明細頁在用」是**錯的前提** —— 明細頁走的是
// `order-detail-view.ts` 的 `formatOrderDateTime`(到分),從來不是本支(只到日)。
// 會員側 `apps/storefront/src/lib/orders/order-display.ts` 有同名但**另一份**函式,不受影響。

const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Asia/Taipei 曆面的年/月/日(讀 `formatToParts`,不切任何格式化字串 —— 那會在格式一改就靜默切錯)。
 *
 * 🔴 **2026-08-27 由 `function` 改成 `export function`**(`#24` 補審 must-fix):
 *    `order-export.ts` 的 `orderExportFilename` 原本自己用 `getFullYear/getMonth/getDate`
 *    = **機器本機時區**;server TZ=UTC 時,台北 08-27 07:00 匯出的檔名會寫成 `20260826`。
 *    ⇒ 不是再寫一份台北曆面,是**用回本檔這一份** —— 曆面只准有一個來源。
 */
export function taipeiParts(d: Date): { year: string; month: string; day: string } {
  const parts = TAIPEI_YMD.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * formatOrderListDate:**列表專用**日期字面(M-4b E10 A11a-2)。
 * 母 plan §5.1a「改寫 | 日期 → `07/25`」那列逐字:**同年 `07/25`、跨年才補年份**(`2025/06/27`);
 * 完整時間戳仍在 DB。
 *
 * 🔴 A11a-2 新增本支時 plan `:185` 要求「不改 `formatOrderDate`(明細頁在用)」;實查那個前提是錯的,
 * A9c 已依主視窗裁定把 `formatOrderDate` 刪除(見上方註)。本支現為 admin 列表日期的唯一格式化面。
 *
 * 🔴 非法 iso **不 throw**:`formatToParts(Invalid Date)` 會擲 `RangeError`,而本函式在 server component
 * 內呼叫 ⇒ 會把「一格顯示垃圾」升級成「整個 `/orders` 500」。照 `note-timeline.ts:85` 既有慣例原樣回傳。
 *
 * 🔴 `now` 可注入:「同年」是相對**當下**的判斷,綁死真時鐘會讓斷言在跨年那天自己變色,
 * 而且跨年那一格根本構造不出來。production 呼叫端不帶第二參數、走真時鐘。
 * 🔴 年份比較在 **Asia/Taipei 曆面**做、不是拿 UTC 年份比:UTC `2025-12-31T16:30Z` 在台北已是 2026-01-01,
 * 用 UTC 年份會把它誤判成跨年、多印一個 `2025/`。
 */
export function formatOrderListDate(iso: string, now: Date = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const t = taipeiParts(parsed);
  const current = taipeiParts(now);
  return t.year === current.year ? `${t.month}/${t.day}` : `${t.year}/${t.month}/${t.day}`;
}

/** 金額顯示:orders 金額為 integer 元位(非分;migration 20260604120000 註解「金額一律 integer 元位」)→ 千分位。 */
export function formatOrderAmount(amount: number): string {
  return amount.toLocaleString('en-US');
}

/**
 * 收款欄的字面 —— **五個字面的唯一一份**（Sean 2026-09-13 拍甲，三題全甲）。
 *
 * 🔴 **這一欄 2026-08-14 被他自己拿掉過**（拍 Q2=A「狀態欄獨扛」），2026-09-13 又拍回來，
 *    逐字：**「甲 = 要, 照新稿加回來(已收足 / 還差 N / 還沒收)」**。
 *    ⇒ 📌 **兩次都是他拍的，而且第二次是在知道代價之後拍的**（主視窗把「五態降級成兩態」
 *      那段逐字端給他）。**要再翻它，去問他，不要讀舊註解推。**
 *
 * 🔴 他另外兩題（原稿沒有、是實作時挖出來的）也全甲：
 *  · **退過款的單 ⇒ 印「需確認」，不給數字。** 系統算不出應付餘額（退款有兩本帳）
 *    ⇒ **給錯數字比不給更糟**。📎 客人側同一個世界他 2026-09-06 已拍過「請聯絡我們」
 *      （`20260906150000_m4b_order_balance_base_v.sql` 檔頭逐字）—— 這是那一拍在後台的對應形狀。
 *  · **多付的單 ⇒ 印「多收 N」**，與「還差 N」對稱，員工看得出要退錢。
 *
 * 🛑 **字面只有這一份**：測試、元件、未來的 CSV 都從這裡拿，不得另抄一份中文。
 */
export const PAY_COLUMN_LABEL = {
  /** 應付餘額 = 0：剛好付清。**這是具體斷言，不是「沒資料」**。 */
  settled: '已收足',
  /** 應付餘額 = 訂單總額：一毛沒收（含收了又全額沖銷）。 */
  none: '還沒收',
  /** 應付餘額 `null`：這張單有有效退款 ⇒ 算不清楚。**不給數字。** */
  unknown: '需確認',
} as const;

/**
 * 應付餘額 → 收款欄要印的那一行字。
 *
 * 🛑🛑 **本函式【不做任何金額算術】** —— 它只讀 `balanceDue` 的正負與大小。
 *    那條錢的規則住在 `order_balance_base_v`，而它的 `COMMENT` 逐字
 *    「要改應付餘額的算法, 改這裡, 不要在別處再寫一份」。
 *    ⛔ **尤其不准在這裡寫 `total - paidTotal`** —— 理由全文在 `AdminOrderSummary.balanceDue`
 *      （一句話：`paid_total` 不扣退款 ⇒ 那個數會看起來很合理而是錯的）。
 *
 * 🔴 **四個入口互斥且窮盡，順序是承重的**：
 *    `null` 先判 —— 它是「算不出來」，**不是 0**；放到後面會被任何一個數值比較吃掉。
 *
 * ⚠️ `balanceDue === total` 判成「還沒收」而不是「還差（全額）」：兩者的數字一樣，
 *    而員工要做的事不同（催全款 vs 催尾款）。📌 **差別不在措辭，在員工會不會去做事**
 *    —— 同 `PAYMENT_STATUS_LABEL` 那段 2026-08-18 的教訓。
 */
export function orderPayAmbiguous(order: {
  cancelledAt: string | null;
  lines: { quantitySummary: { cancelledQuantity: number } }[];
}): boolean {
  return order.cancelledAt !== null || order.lines.some((l) => l.quantitySummary.cancelledQuantity > 0);
}

/**
 * 🆕 收款欄那格**可不可以點**(= 有沒有收款要做)。Sean 2026-09-13 答甲:
 * 「已收足」/「需確認」/「多收 N」三態不可點;只有「還差 N」與「還沒收」可點。
 * 🔴 與 `formatOrderPayColumn` 同一組輸入、同一套判準 —— 兩支分開是因為一支回字、一支回布林,
 *    而**不可點的理由與印什麼字是同一件事**:算不出來就不給數字,也不給入口。
 */
export function orderPayActionable(balanceDue: number | null, ambiguous: boolean): boolean {
  if (ambiguous) return false;
  if (!Number.isInteger(balanceDue) || balanceDue === null) return false;
  return balanceDue > 0;
}

export function formatOrderPayColumn(
  balanceDue: number | null,
  /**
   * 🔴 **這張單的金額語意算不算得清楚**(`orderPayAmbiguous`)。
   *    `true` ⇒ 一律「需確認」,**不印任何數字**。
   */
  ambiguous: boolean,
  paymentStatus: PaymentStatus,
): string {
  // 🔴🔴 **取消過的單一律「需確認」**(codex R1 must-fix ①,2026-09-13 —— 它是對的)。
  //    `order_balance_base_v` 只擋**退款**(`:99` 那段 CASE),**沒有處理取消**;
  //    而取消 RPC **不調整 `total`**(`20260908060000_m4b_partpaid_cancel_gate.sql:712`)
  //    ⇒ codex 的反例逐字:
  //      · 原單 10,000、收訂金 3,000、**整單取消但還沒退款** ⇒ 印「還差 7,000」
  //        —— **而該做的事是把訂金【退回去】,不是催收 7,000。**
  //      · 付清 10,000、取消其中 4,000 的商品、還沒退款 ⇒ 印「已收足」
  //        —— 剩下的商品與實收之間的差額**整個看不見**。
  //    📌 **⇒ 這正是「印出一張單真實狀況以外的東西」。** 不確定就不給數字,與 Sean Q2 甲同一個判準。
  if (ambiguous) return PAY_COLUMN_LABEL.unknown;
  // 🔴🔴 **runtime guard,而它不是保險絲 —— 它擋的是一個【會讓整頁炸掉】的真實形狀。**
  //    型別說 `number | null`,而**投影退版時整個鍵會消失** ⇒ 執行期拿到 `undefined`
  //    (同 `AdminOrderDetail.customerUserId` 那段記過的機制:`| null` 是型別謊言的解藥,
  //     而 `undefined` 連型別都看不到)。
  //    ⚠️ **第一版沒有這道,而症狀是 `TypeError: Cannot read properties of undefined`**
  //       —— `undefined` 一路落到最後那個 `還差 ${…}` 分支、把 `undefined` 餵進
  //       `toLocaleString()` ⇒ **整個訂單列表頁當場炸掉**。抓到它的是既有的 page 測試,
  //       而它們本來就在用 cast 出來的假 summary(那正是真實的退版形狀)。
  // 📌 **⇒ 不是數字就當「算不出來」** —— 與 `parseBalanceDue`(adapter 那支)同一個判準:
  //    不給數字,不猜、不補 0。
  if (!Number.isInteger(balanceDue)) return PAY_COLUMN_LABEL.unknown;
  if (balanceDue === null) return PAY_COLUMN_LABEL.unknown;
  if (balanceDue < 0) return `多收 ${formatOrderAmount(-balanceDue)}`;
  if (balanceDue === 0) return PAY_COLUMN_LABEL.settled;
  // 🔴🔴 **「還沒收」改由 `paymentStatus` 判,不再用 `balanceDue === total`**
  //    (codex R1 must-fix ②,2026-09-13)。
  //    ⛔ ~~`balanceDue === total`~~ 的毛病:`total` 來自**第一發**查詢、`balanceDue` 來自**第二發**
  //    ⇒ **兩個數字不是同一個快照**。codex 的反例逐字:
  //      第一發讀到總額 10,000 → 另一位員工改成 12,000 並再收 2,000 → 第二發回餘額 10,000
  //      ⇒ 10,000 === 10,000 ⇒ 印「**還沒收**」,而其實已經收到 2,000。
  //    ✅ 改用 `paymentStatus` 之後,**`total` 整個退出本函式** ⇒ 那個反例構造不出來了。
  //    ⚠️ **殘餘的競態沒有消失,只是變窄了**:`paymentStatus`(第一發)與 `balanceDue`(第二發)
  //       仍跨兩個快照 ⇒ 若剛好在兩發之間收到第一筆款,會多印一次「還沒收」。
  //       🛑 **要完全消掉它,兩個值必須來自同一發** —— 而 `order_balance_base_v` 今天**只有兩欄**
  //       (`order_id, balance_due`;拋棄式 PG 實查)⇒ 那要改 view = migration = 鐵則 8 要 Sean 批。
  //       📌 **已知缺口,寫在這裡,不是沒想到。**
  if (paymentStatus === 'unpaid') return PAY_COLUMN_LABEL.none;
  return `還差 ${formatOrderAmount(balanceDue)}`;
}

/**
 * 車款快照 → 列表顯示字面(V-3b「年份廠牌車種」欄;order_items.vehicle_snapshot 直出)。
 * dict=「年 品牌 車型」/ free=「年 自由輸入」;NULL(未帶車款)→ null,顯示端兜「—」。純顯示無價/tier 面。
 */
export function formatOrderItemVehicle(vehicle: OrderItemVehicleSnapshot | null): string | null {
  if (vehicle === null) return null;
  if (vehicle.kind === 'dict') {
    return [vehicle.year, vehicle.brand, vehicle.model].filter(Boolean).join(' ');
  }
  return [vehicle.year, vehicle.raw].filter(Boolean).join(' ');
}
