import type {
  AdminOrderItemQuantitySummary,
  AdminOrderSummary,
  OrderGoodsAxis,
} from '@pcm/domain';
import { STATUS_CAPSULE } from './order-list-view';

// M-4b OD 訂單列表改版 **L1**(2026-08-13):狀態八值 = 收款軸 × 貨品軸。
//
// 真權威 = OD project `pcm-admin-order-ui` 的 `overview-desktop.html`(第十一/十六輪),
// 需求檔 = `docs/specs/2026-08-12-admin-order-ui-design-brief.md` §0-H(Sean 拍 Q22=A / Q23=A / Q24=A、
// 配色 Q27=B / Q28=A)。字面逐字照 Sean 試算表原詞,**一個字都沒改**。
//
// 🔴 **本檔零消費端** —— 只是純函式 + 配色表,**沒有任何畫面因此顯示狀態八值**。
//    接進列表是 L3 的事(欄序重排 + 訂貨欄與付款膠囊下架,Sean 拍 Q2=A)。
//
// 🔴 **為什麼開新檔、不塞 `order-list-view.ts`**:那個檔已 624 行(鐵則 6 的 >400 警戒線之上),
//    而且 S 窗正在同一個檔加 href 建構 ⇒ 塞進去等於製造跨窗衝突。本檔只**單向 import**
//    `STATUS_CAPSULE`(共用膠囊形狀),不改動它。
//
// 🔴 **八值不是八種狀態,是兩個軸相乘**(需求檔 §0-H 逐字)。貨品軸就是既有的三段進度
//    (訂貨 → 到貨 → 出貨),**不需要任何新資料** —— L0(`54032849`)把第四軸 `shippedQuantity`
//    補進投影之後,四個貨品階段全部算得出來。

/** 收款軸。🔴 **不得寫死成兩值** —— Sean Q22=A:貨到付款(`cod`)是預留的第三值。 */
export type OrderPayAxis = 'unpaid' | 'paid';

/**
 * 貨品軸四階段(未定 → 已定 → 在庫 → 出貨)。
 *
 * 🔴 **`#484a` 起本檔不再自己宣告這個型別,改從 `@pcm/domain` re-export。**
 *    理由:同一組四值現在有**兩個消費者**(本檔的膠囊、migration 的 `admin_order_list_v.goods_axis`),
 *    兩份字面必漂。原本 domain 那邊寫著「唯一權威在這裡、admin 從本檔 re-export」——
 *    **在這一行改掉之前,那句話是假的**(codex 關卡2 抓到;兩份當時只是碰巧相同、沒有任何守門綁著)。
 */
export type { OrderGoodsAxis };

/**
 * 八值字面。**逐字取自 Sean 的試算表原詞**(需求檔 §0-H 的 2×4 表),不是我編的中文。
 *
 * 🔴 `未收出貨` 與 `出貨完成` **刻意是兩個不同的詞**(Q23=A):前者 = 錢沒收、貨已經出去,
 *    是這張表裡**唯一真的會賠錢**的一格,必須被看見、不能跟 `出貨完成` 長得一樣。
 * 🔴 「現貨」在這裡一律指**貨已到、還沒出**(貨在哪),**不是** `#352` 的「自有庫存來源」(貨從哪來)。
 *    主視窗答錯過一次,寫在這裡免得再混。
 * 🔴 收款軸第三值回來時:本表、`PAY_MARK` 各補一列即可,**`GOODS_TONE` 一個字都不用動**
 *    —— 那正是 Q27=B 把「顏色由貨品軸決定」與「收款只是標記」拆開換到的彈性。
 */
export const ORDER_STATUS_LABEL: Record<OrderPayAxis, Record<OrderGoodsAxis, string>> = {
  unpaid: { none: '未收未定', ordered: '未收已定', instock: '未收現貨', shipped: '未收出貨' },
  paid: { none: '已收未定', ordered: '已收已定', instock: '現貨在庫', shipped: '出貨完成' },
  // cod: { none: '貨到未定', ordered: '貨到已定', instock: '貨到在庫', shipped: '—' },
};

/** 已取消不在 2×4 矩陣裡(它不是一個階段,是整張單沒了)。 */
export const ORDER_STATUS_CANCELLED_LABEL = '已取消';

/**
 * 已退款也不在 2×4 矩陣裡(`#494`;**Sean 2026-08-14 拍板 `Q-494-2`=B**)。
 *
 * 🔴🔴 **這是刻意偏離 OD,不是漏做。** OD 後台設計的收款軸只有兩態,本值是第三種**矩陣外**的狀態
 *    —— 與 `已取消` 同一形狀:**這張單不用再做事了**,貨走到哪不再是決策資訊。
 *    偏離的來由與被推翻的那條裁定寫在下面 `orderPayAxis` 的 docstring,**要改先讀那段**。
 */
export const ORDER_STATUS_REFUNDED_LABEL = '已退款';

/**
 * 🔴 **顏色由貨品軸決定,收款只是附加標記**(Sean 拍 Q27=B,推翻前一版)。
 *
 * 前一版是「收款軸在外、貨品軸在內」⇒ 八個狀態只用到四種顏色,而且四個擠在同一個紅
 * ⇒ 掃過去分不出「已收未定」(要去跟供應商下單)與「未收未定」(要去催客人付錢)。
 * 現在的理由是 Sean 的工作流主線是**貨走到哪**,錢收了沒是附加資訊、不該搶走主色。
 */
/* 🔴🔴 **2026-08-16 Sean 拍板「狀態膠囊配色 —— 換成新的配色方式(BMW)」。**
   四顆改吃 `globals.css` 的 `.cap-*`,那裡是 OD `:206-213` 的 `color-mix` 運算式逐字搬。
   🔴 **換的理由是【語言一致】,不是【現在不合規】** —— 改版前那四顆**全部達標**
      (灰 4.63 / 黃 4.51 / 藍 5.17 / 綠 4.84,實算)。**這句不能省**:少了它,
      下一個人會以為我們在修違規,而那會改變他對優先序與風險的判斷。
   ⚠️ **改用 CSS class 而不是 Tailwind 調色盤 utility,是因為值必須留成【運算式】** ——
      `color-mix(...)` 一旦求值成靜態 hex,未來改主色時膠囊不會跟著動,而**沒有守門會紅**
      (設計參照 §5 明文)。`bg-amber-100` 那種調色盤 utility 同樣做不到跟著主色走。
   📎 順帶讓這四顆脫離設計參照標記的「70 處直接寫 Tailwind 調色盤色」那個缺口。 */
const GOODS_TONE: Record<OrderGoodsAxis, string> = {
  none: 'cap-n', // 灰:還沒訂
  ordered: 'cap-y', // 黃:訂了沒到
  instock: 'cap-bl', // 藍:到了沒出
  shipped: 'cap-g', // 綠:出去了
};

/**
 * 未收款的紅框。
 *
 * 🔴 **用 `shadow` 畫、不吃任何寬度** —— 狀態欄寬是凍結值(L3 的 13 欄寬),
 *    加內距或加一個實體紅點都會把四個中文字擠出去。
 * 🔴 **雙層(外深內淡)是刻意的**,逐字照 OD:單層在四種底色上只有灰底看得清楚。
 *    ⚠️ 這串是 Tailwind 任意值(空格要寫成底線),醜但**與 OD 逐像素相同**;
 *    改寫成 `ring-2 ring-destructive` 會是「翻譯」不是「搬」(鐵則 1)。
 */
const PAY_MARK: Record<OrderPayAxis, string | null> = {
  unpaid: 'shadow-[0_0_0_1.5px_var(--destructive),0_0_0_3px_oklch(0.90_0.06_25)]',
  paid: null, // 收到錢了 ⇒ 不加標記
  // cod: '…', // 貨到付款回來時給它自己的標記,不用動 GOODS_TONE 任何一格
};

/**
 * 🔴🔴 **唯一的例外,而且是刻意的**(Sean 拍 Q28=A):`未收出貨` 不遵守「貨品軸決定色」。
 *
 * 錢沒收、貨已經出去 —— 在「出貨」那一欄裡,淡綠加一圈紅框**不足以讓值班停下來**。
 * 改用全檔唯一的**實心深紅**。⚠️ 冗餘訊號:實心 + 白字 + 700 字重是**三個獨立訊號**,
 * 不是只靠色相 ⇒ 色盲或黑白列印時仍然跳得出來。
 * 🔴 **請不要把它「修正」成綠色。**
 */
/* 🔴 **片3b 一併換掉硬寫的 oklch**(同一次拍板:配色換 BMW)。
   舊值 `bg-[oklch(0.52_0.20_25)]` + `ring-[oklch(0.42_0.18_25)]` 是**兩個不吃任何 token 的字面**
   ⇒ 改主色時它們不會跟著動。現在吃 `--destructive`(= OD `:27` 的 M 紅 `#e4002b`),
   與 OD `:214` `.cap.risk{background:var(--danger);color:var(--accent-on)}` 同構。
   **白字對 `#e4002b` 實算 4.85 ✅。**
   ⚠️ **`ring` 拿掉了** —— OD 的 `.cap.risk` 沒有外環;冗餘訊號仍有三個
      (實心底 + 白字 + `font-bold`),那三個是本檔原本就寫下的理由,一個都沒少。
   ⚠️ **OD `:215` 的 `::before{content:"▲"}` 沒有搬** —— 那會多一個字元寬,
      而狀態欄寬是凍結值(L3 的 13 欄寬)⇒ **刻意不搬,不是漏看。** */
const RISK_TONE = 'bg-destructive font-bold text-white';

/** 已取消:與「未定」同樣是灰,靠**虛線外框 + 透明底**分開 —— 灰不能同時代表兩件事。 */
const CANCELLED_TONE = 'border border-dashed border-muted-foreground/50 text-muted-foreground';

/**
 * 已退款(`#494`):同樣是「不用再做事」的灰,靠**實線外框**與已取消的虛線分開
 * —— 沿用本檔既有立場「灰不能同時代表兩件事」,現在是三件。
 * 兩個獨立訊號:①框線樣式(虛 vs 實)②字面本身(已取消 / 已退款)。
 *
 * ⚠️ **這串 class 是我挑的,不是從 OD 搬的**(OD 沒有這一態)⇒ **視覺未經 Sean 或 Design 定稿**,
 *    在列表上跟「未定」的灰底並排到底夠不夠分得出來,**沒有人用眼睛看過**。
 */
const REFUNDED_TONE = 'border border-muted-foreground/50 text-muted-foreground';

export type OrderStatusView = {
  /** 給人看的字面(八值之一,或「已取消」) */
  label: string;
  /** 完整的膠囊 class(含共用形狀),呼叫端直接套、不自己拼字串 */
  capsuleClass: string;
  /** 兩軸的原始值;已取消時為 null(它不在矩陣裡) */
  payAxis: OrderPayAxis | null;
  goodsAxis: OrderGoodsAxis | null;
  cancelled: boolean;
};

/**
 * 收款軸。
 *
 * ⚠️ repo 的 `paymentStatus` 是**五態**(`paid` / `unpaid` / `partiallyPaid` / `refunded` /
 * `partiallyRefunded`),而 OD 只有兩態 ⇒ 本函式照 OD 字面收斂成「`paid` 以外皆 `unpaid`」。
 *
 * 🔴🔴 **拍板歷史(`#494`;不要只讀最後一句就動手)**
 * - **2026-08-13 · 主視窗裁「照 OD 字面做」**:當時已寫明後果 ——「`refunded` 會落進『未收』並吃到紅框」,
 *   並要求測試裡有一格專門釘它落在哪一軸(註解會被讀漏,測試不會)。
 * - **2026-08-14 · Sean 拍 `Q-494-1`=A,知情推翻上面那條裁定。** 起因是他肉眼撞到:
 *   點「未收未定」的單要取消,一律被擋、而訊息說它「已付款」——**同一張單畫面講三句相反的話**。
 *   ⇒ 新規則:**已退款單獨成一態**(`ORDER_STATUS_REFUNDED_LABEL`),由 `orderStatusView` 早退分支處理。
 *
 * 🔴 **本函式自己沒變、也刻意不改**:它是「兩軸相乘」那條路上的收款軸,而 `refunded` 從
 *    `orderStatusView` 就早退了、根本走不到這裡。⇒ **單獨呼叫本函式仍會把 `refunded` 判成 `unpaid`,
 *    那個回傳值不是這張單的狀態** —— 要狀態請用 `orderStatusView`,本函式不是真相的單一來源。
 *    (釘在 `order-status-axes.test.ts` 的兩格:一格釘本函式仍回 `unpaid`、一格釘 `orderStatusView` 不再回「未收未定」。)
 */
export function orderPayAxis(order: AdminOrderSummary): OrderPayAxis {
  return order.paymentStatus === 'paid' ? 'paid' : 'unpaid';
}

/**
 * 貨品軸。**四個階段由品項層的數量摘要彙總到訂單層**。
 *
 * 🔴 **判序不可倒**:`shipped ⊆ instock ⊆ ordered`(Sean 2026-08-05 拍板「出貨必先到貨、無直送」)
 * ⇒ 已出貨的單三個條件同時成立,**先問最遠的那個**才會答對。倒過來寫的話已出貨的單會被判成「在庫」
 * —— 那正是 L0 之前的病(`未收出貨` 顯示成 `未收現貨`,**名字是反的**)。
 *
 * 🔴 「已定 / 在庫 / 出貨」的訂單層定義 = **該單所有品項都到齊**(需求檔 §0-B:85 逐字要求
 * 「訂單層的『已定』要定義成該單所有品項都訂滿」)。差一件就退回前一階段。
 *
 * ⚠️ **空 `lines` 回 `none`,不是 `shipped`**:`[].every()` 恆為 `true` ⇒ 不擋的話一張沒有品項的單
 * 會被判成「出貨完成」。`create_order` 保證 ≥1 品項,但這裡不靠那個保證。
 */
export function orderGoodsAxis(order: AdminOrderSummary): OrderGoodsAxis {
  return goodsAxisOfLines(order.lines);
}

/** `goodsAxisOfLines` 吃的最小形狀 —— 列表側(非 nullable)與明細側(`| null`)都套得進來。 */
type GoodsAxisLine = {
  quantity: number;
  quantitySummary: Pick<
    AdminOrderItemQuantitySummary,
    // 🔴 `#522`:`cancelledQuantity` 是本片加的。**它在型別裡缺席就是那個 bug 的形狀** ——
    //    分母拿不到取消量,判定就只能用原始訂購量。
    'orderedQuantity' | 'instockQuantity' | 'shippedQuantity' | 'cancelledQuantity'
  > | null;
};

/**
 * 判序本體。**兩個呼叫端共用同一份**(`orderGoodsAxis` 走列表、`orderDetailGoodsAxis` 走明細)——
 * 🔴 抽出來不是為了整潔,是因為 `#514` 要在明細頁也顯示這一軸,
 *    而**判序寫兩份的下場已經記過一次**:上面那條「判序不可倒」的病(`未收出貨` 顯示成 `未收現貨`)。
 *
 * 🔴🔴 **`quantitySummary === null` 的政策 = 語意正確,不是 fallback。**
 *    `order_item_quantity_summary` 由 A4a trigger **惰性建列**:一個品項從沒被採購、也沒被取消時,
 *    那一列**根本不存在** ⇒ 對貨品軸而言,「沒有那一列」**就是**「這個品項還沒訂貨」。
 *    ⇒ 所以下面把 null 當三個 0 **不是「找不到就當未訂購」**,是「它本來就是未訂購」。
 * ⚠️ **代價照實寫**(與 `AdminOrderLine.quantitySummary` docstring 記的是同一條):
 *    **「摘要列真的不存在」與「投影壞掉讀不到」在畫面上長得一樣。**
 *    本函式**只供顯示**;house 的分用途裁定是「純顯示補 0 可接受、
 *    **守門/上限/可否取消的判斷絕不可補 0、必須 fail-closed**」——
 *    🔴 **本函式的回傳值不得餵給任何取消/上限判斷**,那類要走明細側的 `| null` 原型。
 */
/**
 * **這一列還需要處理多少件** = 訂購量 − 已取消量。
 *
 * 🔴 **這是【貨品軸】與【它的解釋小字】共用的唯一分母,`#522` 續章把它從區域 const 提到模組層。**
 *    提之前:軸這半扣了取消(`#522` 修的),小字那半自己 `reduce` 加 `l.quantity`、沒扣
 *    ⇒ **同一張畫面上,軸說「已訂貨」而小字說「本單 6 件中已訂 3 件」,兩個分母不是同一個。**
 *    ⇒ 讓兩個消費端吃同一支函式,是為了讓**漂走需要有人刻意繞過它**,而不是改一行就發生。
 *    ⚠️ **它不是保證**(codex 第二輪指出,說得對):任何消費端仍可以改回自行計算,
 *    而共用這件事**本身沒有守門**(釘字面的守門只會在有人改我的字時紅,不在事實變化時紅)。
 *    🔴 **真正的防線是行為測試** —— 見 `order-status-axes.test.ts` 的 `#522` 續章那一族。
 *
 * ⚠️ **不要把它當成通用的數量工具** —— 它的語意窄到只有一句:「**這一列還欠多少**」。
 *    它**不回答**「還能取消多少」(`cancellableQuantity`,扣的是到貨不是取消);
 *    也**不回答**「倉庫現在揀得到幾件」(`pickableQuantity`,= instock − shipped)。
 *    **接第三個消費端之前,先確認它問的是同一個問題。**
 *
 * 🔴 **`quantitySummary === null` ⇒ 已取消當 0**,理由與 `goodsAxisOfLines` 的 `at()` 同一條:
 *    摘要列由 A4a trigger 惰性建立,「**沒有那一列**」就是「**還沒被採購、也沒被取消**」
 *    ⇒ **這是語意正確,不是找不到就補 0 的 fallback。**
 *
 * ⚠️ **`Math.max(0, …)` 在這裡是有作用的,別當裝飾刪掉**:軸那三條判定夾不夾都不改變真假,
 *    **但小字是把每一列相加** —— 一個負數會真的把總件數拉低,而紙面上看不出來。
 *    (`cancelled ≤ quantity` 由 `oiqs_cancelled_le_quantity`(C6)保證
 *     —— `supabase/migrations/20260730150000_m4b_e10_a1_order_item_summary_columns.sql:116`
 *     ⇒ 正常路徑上恆 ≥ 0。⚠️ 本行第一版引錯成 `oiqs_cancelled_shipped_le_quantity`,
 *     那條是 `cancelled + shipped ≤ quantity`、管的是另一件事;codex 對抗審查抓到,已查證更正。)
 */
function lineNeed(l: GoodsAxisLine): number {
  return Math.max(0, l.quantity - (l.quantitySummary?.cancelledQuantity ?? 0));
}

export function goodsAxisOfLines(lines: readonly GoodsAxisLine[]): OrderGoodsAxis {
  if (lines.length === 0) return 'none';
  const at = (l: GoodsAxisLine, k: keyof NonNullable<GoodsAxisLine['quantitySummary']>) =>
    l.quantitySummary?.[k] ?? 0;

  /**
   * 🔴 **`#522`:分母是【還需要處理的量】,不是原始訂購量。**
   *
   * 修之前三條判定都拿 `l.quantity` 當分母,而採購側有守門
   * `SUM(allocated) ≤ quantity − SUM(cancelled)`(`20260803130000:164`)
   * ⇒ **先取消、再採購**的單,`ordered` 在數學上到不了 `quantity` ⇒ 三個 `if` 全 false ⇒ `none`。
   * ⇒ 員工看到「還沒訂貨」,會去**重新採購一批已經出貨的東西**(實體動作,不是顯示瑕疵)。
   *
   * ⚠️ **本段原文寫「只要有任何取消就到不了、100% 復現」—— 那是全稱句而它不成立**
   *    (codex 對抗審查 2026-08-16 舉反例,我查該守門的 COMMENT 逐字確認):
   *    A2b1 那條守門**只守採購側的 INSERT / 調升 / 換 parent**(`20260803130000:164` 該函式 COMMENT),
   *    **它不守取消** ⇒ **先訂滿 6、再取消 3**,會留下 `ordered 6 > quantity − cancelled = 3`,
   *    舊分母 `quantity = 6` 之下 `6 >= 6` 成立 ⇒ 舊 code 在那條路上會答 `ordered`,**不是 `none`**。
   *    🔴 **修正後的講法**:病灶是**分母用錯**(用訂購量而不是還需要處理的量),
   *    **而症狀取決於「先取消還是先採購」**:
   *      · **先取消、再採購** ⇒ 採購側守門把 `ordered` 壓在 `quantity − cancelled` 以下
   *        ⇒ 舊分母到不了 ⇒ **錯成 `none`**(就是 `#522` 那個「部分取消顯示未訂貨」)
   *      · **先採購、再取消** ⇒ `ordered` 留在歷史高點 ⇒ 舊分母**照樣命中** ⇒ 新舊同答 `ordered`
   *        ⇒ 🔴 **那個時點舊 code 的輸出並沒有錯**(codex 第二輪指出,我複驗成立)
   *    ⚠️ **所以「兩條路都錯」也是錯的** —— 本段第一版這樣寫,我把「分母用錯」直接等同於
   *    「輸出一定錯」。**用錯的分母在某些狀態下剛好給出對的答案,那不是它對,是還沒踩到。**
   *
   * 🔴 **整筆取消(`need === 0`)⇒ 該列恆真、不擋整張單**(主視窗 2026-08-16 裁 `Q-522-分母`=A)。
   *    · 與 `shipment-candidates.ts:170` 現行同立場(整筆取消 ⇒ `blockedReason='cancelled'`,
   *      不留在待辦裡),**不多出第二套語意**。
   *    · ⚠️ **A 的失效面已量掉**:「整張單只有一個品項而它整筆取消」會讓本函式回 `shipped`,
   *      但那種單 **`orders.cancelled_at` 已被 A8a2 關單寫入**
   *      (`20260805100000:456` 算 `v_closed`、`:463-467` 真的 `UPDATE orders SET cancelled_at`)
   *      ⇒ `orderStatusView` 早退成「已取消」,**本函式的回傳值到不了使用者**。
   *      🔴 **這條前提若被改掉(有人讓全取消不再關單),`shipped` 就會浮上檯面,而它比原本的
   *      `none` 更毒** —— 前者讓員工多做一次,後者讓員工不做該做的事。
   *
   * ⚠️ **`Math.max(0, …)` 對【本函式】的回傳值沒有作用**(code-reviewer 2026-08-16 抓的,他是對的):
   *    三條判定都是「非負值 `>=` need」,把 need 從負夾成 0 不改變任何一次比較的真假。
   *    ⚠️ **但這句只對【軸】成立** —— 分母提到模組層之後,`goodsAxisProgressNote` 拿它做加總,
   *    那裡一個負數會真的把總數拉低 ⇒ **那個夾在小字那側是有作用的**,見 `lineNeed` docstring。
   *
   * 🔴 **分母的本體已移到模組層的 `lineNeed`** —— 因為**小字那半也要吃同一個分母**。
   *    留在這裡的只有「為什麼分母是這個」的理由;要改算式請改 `lineNeed`,**改一處兩邊一起動**。
   */
  if (lines.every((l) => at(l, 'shippedQuantity') >= lineNeed(l))) return 'shipped';
  if (lines.every((l) => at(l, 'instockQuantity') >= lineNeed(l))) return 'instock';
  if (lines.every((l) => at(l, 'orderedQuantity') >= lineNeed(l))) return 'ordered';
  return 'none';
}

/**
 * `#514`:**明細頁**的貨品軸。
 *
 * 🔴 **這一格取代了 `orders.fulfillment_status`,而那不是重構、是修一個正在騙人的顯示**:
 *    那一欄的 COLUMN COMMENT 自己寫著「E10 起停止維護、值為 legacy stale、不得當現況真相」
 *    (`supabase/migrations/20260729010000_m4b_e10_d0_display_id_expand.sql:88` 逐字),
 *    而**全 migrations 零 writer** ⇒ 正式庫 13/13 全是 DEFAULT `notOrdered`
 *    ⇒ 明細頁那一格**從來沒有正確過一次**。
 * ⚠️ **那條 COMMENT 防的是「有人拿它做判斷」,沒防「有人把它畫出來」——`render` 不是判斷。**
 *
 * ⚠️ **修完之後多數單仍顯示「未訂購」,而那是對的**:正式庫多數單還沒採購。
 *    ⇒ **要證明它真的改讀了,得看一張【有採購紀錄】的單**(那格測試釘的就是這件事)。
 *
 * 🔴 **參數型別刻意收窄成「有 `items`、每件帶 `quantity` 與 `quantitySummary`」,不是 `AdminOrderDetail`**:
 *    本函式只讀那兩個欄,要求整個型別會讓每一格測試都得補齊 8 個不相干的欄
 *    (`id`/`variantSku`/`title`/`spec`/…)—— **那些噪音會讓下一個人以為它們也參與判斷**。
 *    `AdminOrderDetail` 結構上自然滿足這個形狀,呼叫端一個字都不用改。
 */
export function orderDetailGoodsAxis(detail: { items: readonly GoodsAxisLine[] }): OrderGoodsAxis {
  return goodsAxisOfLines(detail.items);
}

/**
 * 貨品軸旁邊那行小字 —— **回答「為什麼是這個字」,不是重述那個字**。
 *
 * 🔴 **需求出處**(這半句一直沒做,`#514` 只做了前半):
 *    `docs/specs/2026-08-12-admin-order-ui-design-brief.md:114` 逐字 ——
 *    「訂單層的『已定』要定義成『該單所有品項都訂滿』,**這個定義要在畫面上讓人看得懂**」。
 *    症狀:同一畫面上方寫「未訂貨」、品項列寫「訂貨 3/6」⇒ 員工以為還沒下單,可能重複下單。
 *    **Sean 2026-08-15 拍板乙:四個軸值一個都不動,旁邊加一行小字。**
 *
 * **規則 = 印出「第一個還沒完成的那一階」的分數**
 *    (分母 = 各品項 `lineNeed` 加總 = **訂購 − 已取消**;🔴 **不是 `quantity` 加總**,見 `#522` 續章):
 *    `none` → 已訂 / `ordered` → 已到貨 / `instock` → 已出貨 / `shipped` → **不印**。
 *    已完成的那幾階印出來恆等於分母(例:軸=`ordered` 時「已訂」必然 = N)⇒ 是廢話,不印。
 *    `shipped` 沒有下一階 ⇒ 沒有人會問「為什麼是已出貨」⇒ 整行不出現。
 *
 * 🔴🔴 **分子逐列夾在該列的 `lineNeed` 之內(`Math.min`),而那不是防禦性寫法,是本式成立的前提。**
 *    **`#522` 續章第一版沒有夾,codex 對抗審查當場舉出反例(2026-08-16),我複驗成立**:
 *    ```
 *    列A quantity 6 / ordered 6 / cancelled 6   ⇒ lineNeed 0，而 orderedQuantity 仍是歷史值 6
 *    列B quantity 4 / ordered 0 / cancelled 0   ⇒ lineNeed 4
 *    軸 = none（列B 一件都沒訂）⇒ stage = 已訂
 *    分母 0+4 = 4  ／  分子 6+0 = 6   ⇒ 🔴「（本單 4 件中已訂 6 件）」= 分子大於分母
 *    ```
 *    ⚠️ **這是「換了分母沒換分子」造出來的** —— 分母改成「還要處理的量」之後,
 *    **整筆取消的列會從分母消失,而它的歷史階段量還留在分子裡。**
 *    ⇒ 夾了之後 `min(6, 0) = 0`,那一列在分子分母同時歸零,**不再參與這個分數**。
 *
 * 🔴 **夾住之後,「分數走到 N/N」與「軸值升級」的等價是【結構上】成立的,不再靠 DB CHECK**:
 *    `Σ min(stageᵢ, needᵢ) = Σ needᵢ` ⟺ 每一列 `min(stageᵢ, needᵢ) = needᵢ` ⟺ 每一列 `stageᵢ ≥ needᵢ`
 *    ⟺ `goodsAxisOfLines` 的那一條 `every()` 成立。**同一個條件,兩邊讀的是同一件事。**
 *    ⚠️ **舊版註解宣稱它依賴三條 CHECK,而那個論證本身有一個洞**(codex 同輪抓的,我查證後成立):
 *    它需要「每一階 ≤ 分母」,而分母換成 `quantity − cancelled` 之後,
 *    · `instock` ≤ 分母 ✅ 有 `oiqs_instock_cancelled_le_quantity`(`…a1_order_item_summary_columns.sql:124`)
 *    · `shipped` ≤ 分母 ✅ 有 `oiqs_cancelled_shipped_le_quantity`(`…s2b_shipped_recompute_wire.sql:89`)
 *    · 🔴 `ordered` ≤ 分母 **沒有任何 CHECK 保證** —— A2b1 那條 `SUM(allocated) ≤ quantity − SUM(cancelled)`
 *      **只守採購側的 INSERT/調升**(該函式 COMMENT 逐字「只守 INSERT/調升/換 parent」),
 *      **先訂滿再取消**就繞過它了 ⇒ 上面那個反例正是這條路產生的。
 *    ⇒ **所以夾是必要的,不是保險。** 拿掉 `Math.min` 就會回到分子大於分母。
 *
 * ⚠️ **夾的代價,照實寫(codex 第二輪提的,我接受但不改)**:
 *    「取消之後採購仍留在高點」(上面那個 `ordered 6 / cancelled 6`)被夾成 `已訂 0`
 *    ⇒ **這行小字不會再透露「我們對一個已全取消的品項訂了 6 件」。**
 *    🔴 **我仍然選擇夾**,理由是這一行的職責只有一個:**解釋軸為什麼停在這一階**。
 *    「訂多了」是**採購對帳**的問題,不該靠一行進度小字被發現 —— 而 `4 件中已訂 6 件`
 *    這種印法既不能解釋軸、也不能拿來對帳,**它只是讓員工兩件事都看不懂**。
 *    ⇒ **登記為缺口,不是登記為已解決**:「取消後採購過量」目前沒有任何地方會叫。
 *
 * 🔴 **`quantitySummary === null` ⇒ 一個數字都不印。**
 *    `goodsAxisOfLines` 把 null 當 0 是**它自己判階段用的**語意裁定(A4a 惰性建列,見上面 docstring);
 *    **那個 `?? 0` 不能跟著搬到「印件數給人看」這個用途上** —— 印「已訂 0 件」會把
 *    「摘要列不存在」與「真的一件都沒訂」講成同一句話。**同一個值,兩種用途,只有一種合法。**
 *
 * 🔴 **本函式的守門住在 `app/orders/[id]/refund-wiring.test.tsx`**,`describe('出貨狀態的解釋小字')`
 *    底下**六格,全部斷言在整頁渲染輸出(`container.textContent`),不是斷言本函式的回傳值**
 *    —— 因為「算得對」不等於「那個畫面有印出來」(`#514` 自己的教訓)。
 *    ⚠️ **檔名對不上是刻意的、不是漏改**(E 窗 2026-08-15 `E-629` nit1):那支檔的實際職責是
 *    **「頁層接線」**(檔頭自述,`procurement-wiring.test.tsx` 同型),檔名綁在首次用途 `refund` 上。
 *    **不改名的理由**:改名要連同型的 `procurement-wiring.test.tsx` 一起改(只改一支會讓兩支
 *    同型檔的命名規則不一致、比現在更難找),而那支是別條線的檔。
 *    ⇒ 改採**指標**:**會來改這行小字的人一定先打開本檔**,寫在這裡比寫在檔名早一步被看到。
 *    🔴 **改本函式的行為 = 必跑那六格。**
 *
 * ✅ **上面那條「已知限制」已於 2026-08-16 結清 —— 本函式與 `goodsAxisOfLines` 都扣已取消數量了。**
 *    原文逐字是「**本函式與 `goodsAxisOfLines` 都不扣已取消數量**」,而它**在收割的那一刻就過期了一半**:
 *    `#522` 先在另一條線上把軸改成扣取消,兩條線併起來之後,那句話的後半變成假的,
 *    **而沒有任何東西會紅** —— 讀到它的人會以為兩邊都還沒修。
 *    🔴 **記法**:那不是「有人忘了改註解」,是**改了前件、後件沒跟著翻**。
 *       原文自己寫著「要修得連軸一起改」,**而軸已經先被改掉了** ⇒ 那句話當場變成放行令。
 *
 *    **現況**:兩者共用 `lineNeed`(= quantity − cancelled)。
 *    6 件裡 3 件取消 + 3 件已訂 ⇒ 軸 `ordered`、小字「本單 3 件中已到貨 0 件」,**兩者一致**。
 *    原文擔心的「小字 3/3 配軸未訂貨」那個新矛盾**前提已消失**(軸不再是 `none`)。
 *    🔴 **改本函式的分母 = 必須連 `goodsAxisOfLines` 一起看** —— 它們現在是同一支函式。
 *
 * ⚠️ **正式庫 2026-08-15 實測 `cancelled_quantity > 0` 為 0 筆(主視窗查)** ⇒ 這個修**現在還沒有真實資料會踩到**。
 *    **那降低急迫性,不降低正確性** —— 而它也表示:**第一次踩到會發生在上線之後。**
 */
export function goodsAxisProgressNote(lines: readonly GoodsAxisLine[]): string | null {
  if (lines.length === 0) return null;
  // 🔴 null 檢查必須在最前面:它是「不知道」,不能被下面任何 `?? 0` 吃掉。
  if (lines.some((l) => l.quantitySummary === null)) return '部分品項數量資料尚未就緒';

  const axis = goodsAxisOfLines(lines);
  if (axis === 'shipped') return null;

  const stage = {
    none: { key: 'orderedQuantity', verb: '已訂' },
    ordered: { key: 'instockQuantity', verb: '已到貨' },
    instock: { key: 'shippedQuantity', verb: '已出貨' },
  } as const satisfies Record<
    Exclude<OrderGoodsAxis, 'shipped'>,
    { key: keyof NonNullable<GoodsAxisLine['quantitySummary']>; verb: string }
  >;

  const { key, verb } = stage[axis];
  // 🔴 分母走 `lineNeed`(= quantity − cancelled),**與貨品軸同一支函式**。
  //    用 `l.quantity` 的話,6 件裡取消 3 件的單會印「本單 6 件中已到貨 0 件」,
  //    而同一張畫面上的軸已經扣掉取消 ⇒ 兩個數字互相矛盾,而**兩邊各自看都對**。
  const total = lines.reduce((sum, l) => sum + lineNeed(l), 0);
  // 🔴 分子逐列夾在該列的 lineNeed 之內 —— **不夾的話分子會大於分母**(反例在上面 docstring,
  //    整筆取消的列從分母消失、歷史階段量卻還留在分子裡)。這個 min 不是保險,是本式成立的前提。
  const done = lines.reduce((sum, l) => sum + Math.min(l.quantitySummary?.[key] ?? 0, lineNeed(l)), 0);
  return `（本單 ${total} 件中${verb} ${done} 件）`;
}

/**
 * 明細頁頭條「**件數**」那格的兩個數字(BMW M 片4b)。
 * 🔴 **是「件數」不是「品項數」**(`Q-A216-F2b` Sean 2026-08-16 拍甲):本函式加總的是
 *    每個 line 的 `quantity` 面,而品項數是 `lines.length` —— **兩個不同的數**
 *    (OD 稿自己寫成「3 項 · 4 件」)。舊 docstring 寫「品項數」是**指錯對象**,已更正。
 */
export type GoodsQuantityHeadline = { readonly ordered: number; readonly instock: number };

/**
 * 頭條「已訂數 / 到貨數」—— **與 `goodsAxisProgressNote` 共用 `lineNeed` 與同一個夾法**。
 *
 * 🔴 **為什麼不在元件裡自己 `reduce` 一次**:分母(`lineNeed` = `quantity − cancelled`)與
 *    分子逐列 `Math.min` 夾住,兩者都是 `#522` 續章折出來的**結構前提**,不是防禦性寫法。
 *    在元件裡重寫一份 ⇒ 哪天 `lineNeed` 再改,頭條會**靜靜地**與軸/小字對不起來,
 *    而**沒有任何東西會紅** —— 那正是 `692849c8` 修掉的那個 bug 的形狀(同一支檔兩個分母,
 *    兩邊各自看都對、合起來互相矛盾)。⇒ 本函式住在**算軸的那支檔**,改算式的人一定會經過它。
 *
 * 🔴 **回 `null` = 「不知道」,不是「是 0」**,兩個觸發條件:
 *    ① 任一 line 的 `quantitySummary === null`。原文逐字(那段警告**就是寫給本片的**,
 *       故在此複述而不是給一個會漂的行號):
 *       「`goodsAxisOfLines` 把 null 當 0 是**它自己判階段用的**語意裁定;
 *        **那個 `?? 0` 不能跟著搬到【印件數給人看】這個用途上** ——
 *        印『已訂 0 件』會把『摘要列不存在』與『真的一件都沒訂』講成同一句話。
 *        **同一個值,兩種用途,只有一種合法。**」
 *    ② `lines.length === 0`。與 `goodsAxisProgressNote` 同一個判斷:一張沒有品項的單印「0 / 0」
 *       讀起來像「都還沒訂」,而它其實是「這張單沒有東西可訂」。
 *
 * ⚠️ **本函式【讀不到】`itemsTruncated`** —— 它在 `AdminOrderDetail` 上,不在 `GoodsAxisLine` 上,
 *    而參數型別收窄的理由寫在 `orderDetailGoodsAxis` 的 docstring(**不為了一個旗標把它放寬**)。
 *    ⇒ **截斷閘由呼叫端把關**,見 `order-detail-summary-cards.tsx` 搜 `itemsTruncated`。
 *    🔴 呼叫端漏掉那道 = 印出一個少算的數而**零訊號**,所以那邊也有一格守門釘住它。
 *
 * 📎 `AdminOrderCancellation.itemsTruncated`(取消列那一處)**不影響本函式** ——
 *    已取消量取自每個 line 自己的 `quantitySummary.cancelledQuantity`,不是從取消列加總來的
 *    (實查:`lineNeed` 只讀 `l.quantitySummary?.cancelledQuantity`)。
 */
export function goodsQuantityHeadline(
  lines: readonly GoodsAxisLine[],
): GoodsQuantityHeadline | null {
  if (lines.length === 0) return null;
  if (lines.some((l) => l.quantitySummary === null)) return null;
  const sumClamped = (key: keyof NonNullable<GoodsAxisLine['quantitySummary']>) =>
    lines.reduce((sum, l) => sum + Math.min(l.quantitySummary?.[key] ?? 0, lineNeed(l)), 0);
  return { ordered: sumClamped('orderedQuantity'), instock: sumClamped('instockQuantity') };
}

/**
 * 訂單的狀態八值 + 膠囊 class。
 *
 * 🔴 已取消**先判**:它不在 2×4 矩陣裡(不是一個階段,是整張單沒了)。
 * 🔴 **已退款第二判**(`#494`):同樣不在矩陣裡。
 *    ⚠️ **「既取消又退款 ⇒ 顯示已取消」是沿用既有行為,不是 `#494` 拍板的內容**
 *    (codex 關卡2 F1 指出我原本把它寫得像已拍板)。取消的早退分支在本片之前就在這裡,
 *    本片只是在它**後面**插一條 ⇒ 那個交集的顯示結果**一個字都沒變**。
 *    我的理由是「取消是整張單沒了、退款只是錢回去了」,但**那是我的判斷、沒有人拍過**
 *    ⇒ 已列進交件的待決項;要改成「已取消・已退款」之類的合併字面請走拍板,不要就地改順序。
 *    (下面那格測試釘的是**現況**,不是宣稱它一定對。)
 * ⚠️ **`partiallyRefunded` 刻意不走這條**(驗收 6):它是「退了一部分」= **還有錢沒結、還有事要做**,
 *    與 `refunded`(全退、結案)不是同一件事 ⇒ 維持落在收款軸的 `unpaid` 那半、照舊吃紅框。
 *    🔴 **正式庫目前零筆 `partiallyRefunded` / `partiallyPaid`** ⇒ 這個判斷**只讀 code 推得,沒有實例驗過**。
 */
export function orderStatusView(order: AdminOrderSummary): OrderStatusView {
  if (order.cancelledAt !== null) {
    return {
      label: ORDER_STATUS_CANCELLED_LABEL,
      capsuleClass: `${STATUS_CAPSULE} ${CANCELLED_TONE}`,
      payAxis: null,
      goodsAxis: null,
      cancelled: true,
    };
  }

  // 🔴 `=== 'refunded'` 而不是「含 refund 字樣」:`partiallyRefunded` 必須**不**進這條(見上方 docstring)。
  if (order.paymentStatus === 'refunded') {
    return {
      label: ORDER_STATUS_REFUNDED_LABEL,
      capsuleClass: `${STATUS_CAPSULE} ${REFUNDED_TONE}`,
      payAxis: null,
      goodsAxis: null,
      cancelled: false,
    };
  }

  const payAxis = orderPayAxis(order);
  const goodsAxis = orderGoodsAxis(order);
  const isRisk = payAxis === 'unpaid' && goodsAxis === 'shipped';
  const mark = PAY_MARK[payAxis];

  return {
    label: ORDER_STATUS_LABEL[payAxis][goodsAxis],
    // 🔴 例外格用它自己那一套就好 —— 實心深紅上再套紅框是紅上加紅、看不出來。
    //    這條寫出來是為了**不靠 class 字串的順序碰巧成立**。
    capsuleClass: isRisk
      ? `${STATUS_CAPSULE} ${RISK_TONE}`
      : [STATUS_CAPSULE, GOODS_TONE[goodsAxis], mark].filter(Boolean).join(' '),
    payAxis,
    goodsAxis,
    cancelled: false,
  };
}
