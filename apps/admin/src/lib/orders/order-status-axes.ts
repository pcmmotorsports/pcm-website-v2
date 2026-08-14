import type { AdminOrderSummary, OrderGoodsAxis } from '@pcm/domain';
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
const GOODS_TONE: Record<OrderGoodsAxis, string> = {
  none: 'bg-muted text-muted-foreground', // 灰:還沒訂
  ordered: 'bg-amber-100 text-amber-700', // 黃:訂了沒到
  instock: 'bg-sky-100 text-sky-700', // 藍:到了沒出
  shipped: 'bg-emerald-100 text-emerald-700', // 綠:出去了
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
const RISK_TONE =
  'bg-[oklch(0.52_0.20_25)] font-bold text-white ring-1 ring-[oklch(0.42_0.18_25)] ring-inset';

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
  const lines = order.lines;
  if (lines.length === 0) return 'none';
  if (lines.every((l) => l.quantitySummary.shippedQuantity >= l.quantity)) return 'shipped';
  if (lines.every((l) => l.quantitySummary.instockQuantity >= l.quantity)) return 'instock';
  if (lines.every((l) => l.quantitySummary.orderedQuantity >= l.quantity)) return 'ordered';
  return 'none';
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
