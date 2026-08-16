// order-detail-summary-cards.tsx — 訂單明細頁上方的四張摘要卡(客戶 / 收件出貨 / 付款 / 發票)。
//
// 🔴 **為什麼抽出來**(鐵則 6):`order-detail.tsx` 卡在 404 行、距 400 只有 4 行。
//    我在 `#13 片1c-2` 的檔頭立過一條**有期限的**約定:
//    「下一次任何人動 `order-detail.tsx`,**先抽下一塊再改**,不得再走『寫理由』那條路徑。」
//    `#520` 的修法會動那支檔 ⇒ **那條約定生效,所以先做結構、再改行為。**
//
// 🔴🔴 **本檔是【純搬家】:零行為改變。**
//    四張卡的 JSX、`Field`、四個 class 常數逐行照抄,只把縮排往左移兩格
//    (原本多包在 `order-detail.tsx` 的 return 裡一層)。
//    ⚠️ 抽的時候差一點掉一件:那段 `#350c` 的註解**開頭留在原檔、續行被抽走** ——
//       半截註解讓 JSX 直接壞掉。**抽取最容易掉的不是 code,是跨行的註解與 `use client` 邊界。**
//
// ⚠️ **`@container` 的前提沒有變,而它是承重的**:欄數看的是**容器寬度**不是視窗寬度
//    ⇒ **兩個消費者(整頁 / 面板)的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、
//    一律退回 1 欄。那件事釘在 `order-panel-wiring.test.ts`,**本檔沒有把它帶過來,也不該帶** ——
//    它守的是消費者那一側。
//
// 📎 `Field` 與四個常數**只有本檔在用**(抽取前實查:`order-detail.tsx` 內 17 次、
//    全 repo 零外部 import)⇒ 一起搬,不留在原檔當孤兒。

import type { AdminOrderDetail } from '@pcm/domain';

import {
  PAYMENT_STATUS_LABEL,
  GOODS_AXIS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
  INVOICE_STATUS_LABEL, // A11a-5 起共用(原在 order-detail-view.ts,依該檔頭宣告的慣例搬來)
} from '../../lib/orders/order-list-view';
import {
  orderDetailGoodsAxis,
  goodsAxisProgressNote,
  goodsQuantityHeadline,
} from '../../lib/orders/order-status-axes';
import { toPaymentSummary } from '../../lib/orders/payment-list-view';
import type { PaymentListData } from './payment-list';
import { customerEmailDisplay } from '../../lib/customers/customer-list-view';
import {
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';

/* ═══ BMW M 片4a:摘要卡改成 OD 的「髮絲線格」+ 小標字體 ═══════════════════════════
   **逐字搬 OD `overview-desktop-bmw-m.html:251-257` 的 `.specs` / `.spec` / `.spec .l`。**

   🔴 **分隔線是【格線縫隙透出底色】,不是每張卡自己畫框**:
      OD `:251-252` = `gap:1px; background:var(--border); border:1px solid var(--border)`
      + `:253` `.spec{background:var(--surface)}` ⇒ **1px 的縫讓容器底色透出來當線。**
      我方對應 = 容器 `gap-px bg-border border`、每格 `bg-card`(見下方 grid)。
      ⚠️ **這不是「把 gap-4 改小」** —— 舊版是四張**浮著的卡**(各自有框、中間 16px 空隙),
         新版是**一塊被切成四格的面板**。**視覺分組的語意變了**,而那正是 BMW M 的樣子。
   ⚠️ **`rounded-lg` 一併拿掉**:片1 已把 `--radius-lg` 釘成 0 ⇒ **它今天就已經是方角、拿掉零視覺差**;
      留著只會讓下一個人以為這裡還有圓角。**這是清掉一個誤導字面,不是改外觀。**

   🔴 **小標字體 = OD `.spec .l`(`:256-257`),而三件裡一樣只搬得動兩件**:
      OD = `font-size:var(--text-xs); font-weight:700; letter-spacing:1.5px; text-transform:uppercase`。
        ✅ 搬 `font-weight:700`(`font-medium` → `font-bold`)與 `letter-spacing:1.5px`。
        🔴 **不搬 `uppercase`** —— 四個標題全是中文(客戶資訊 / 收件與出貨 / 付款 / 發票),
           **對 CJK 是 no-op**:寫上去畫面一個像素都不會變,卻會留下一行「已照 OD 做大寫」的假字面。
           **與訂單表表頭同一個判斷,不是各自決定的。**
   ✅ **OD `.spec .v` 那個「大數字」已於片4b 落地(見下方 `HeadlineNumbers`)** ——
      上一版這裡寫「沒有做…那是內容決策,已排給 Sean」,**Sean 2026-08-16 已拍板要哪些數字**
      ⇒ 那句話連同「不要順手把 `.v` 補上去」的禁令一起**在他拍板的那一刻就過期了**,
      而它**不會有任何東西紅**。留這行是要讓下一個人知道禁令已解除、不是漏刪。 */
const CARD = 'bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-bold tracking-[1.5px]';
const ROW = 'flex justify-between gap-4 py-1 text-sm';
const ROW_LABEL = 'text-muted-foreground shrink-0';

/* ═══ BMW M 片4b:頭條數字(OD `.spec .v` + `.l`)═══════════════════════════════════
   規格 = `docs/specs/2026-08-16-bmw-m-headline-numbers-spec.md`(Sean 已批內容)。

   🔴 **`.v` 逐字搬 OD `overview-desktop-bmw-m.html` 的 `.spec .v`**(用 grep `\.spec \.v` 找,不給行號):
      `font-size:var(--text-xl)`(= OD `:34` `--text-xl: 24px`)→ `text-2xl`(Tailwind 24px)
      `font-weight:300` → `font-light` / `letter-spacing:var(--tracking-display)`(= `-0.025em`)
      → `tracking-[-0.025em]` / `font-variant-numeric:tabular-nums` → `tabular-nums`
      / `line-height:1.15` → `leading-[1.15]` / `color:var(--fg)` → `text-foreground`
      ⚠️ **不搬 `font-family:var(--font-display)`** —— 我方沒有 `--font-display`(BMWTypeNext 是授權字型)。
         寫上去會靜靜 fallback,留下一行「已照 OD 用 display 字體」的假字面。
   🔴 **`.spec` 的 padding 是 `var(--space-3) var(--space-4)` = 12px 16px ⇒ `px-4 py-3`**,
      **不是**四張卡的 `p-4` —— OD 這兩個值本來就不同,不要為了「看起來一致」抹平。
   🔴 **`.l` 在 `.v` 【下面】**(OD `.spec .l` 帶 `margin-top:var(--space-2)`)——
      與四張卡的 `CARD_TITLE`(`mb-3`、在上面)方向相反,**那是 OD 自己的兩種角色**:
      卡片標題是段落標題、`.l` 是大數字的註腳。⇒ `mt-2`,不共用 `CARD_TITLE`。
   🔴 **一樣不搬 `text-transform:uppercase`** —— 標籤全中文、對 CJK 是 no-op(全檔第三次同一判斷)。

   ⚠️ **「寫數字就好 我們看得懂」(Sean 逐字)講的是【數值呈現】** —— 數字旁不加解釋文字。
      **它不是「拿掉標籤」**:他隔一輪逐字更正「**小標留著**」。兩個讀法都能從同一句話推出來,
      而只有一個是對的。⇒ `.l` 一定要在。 */
const SPEC = 'bg-card px-4 py-3 text-card-foreground';
const SPEC_V = 'text-foreground text-2xl leading-[1.15] font-light tracking-[-0.025em] tabular-nums';
const SPEC_L = 'text-muted-foreground mt-2 text-xs font-bold tracking-[1.5px]';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className='text-right break-all'>{value ?? '—'}</span>
    </div>
  );
}

// #350c:欄數改看**容器寬度**而不是視窗寬度(主視窗 2026-08-10 裁④)。
// 🔴 為什麼非改不可:同一份明細現在有兩個容器 —— 整頁版(~72rem)與右側面板(~36rem)。
// 用 `md:`/`xl:` 這種 viewport 斷點的話,1920 螢幕上的 576px 面板會**硬排四欄**、每欄擠到不能看。
// 容器斷點 `@md`(28rem)/ `@4xl`(56rem)⇒ 面板 2 欄、整頁 4 欄。
// ⚠️ **兩個消費者的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、一律退回 1 欄
// (`order-panel-wiring.test.ts` 有一格把兩邊的 `@container` 釘住)。
/**
 * 🔴 **`GoodsAxisValue` 不是這一片新寫的輔助函式** —— 它是從 `order-detail.tsx` **原封搬過來的**
 *    (2026-08-16 收割 `customers` 分支時,void-readers 把明細抽成本元件 ⇒ 它必須跟著搬)。
 *    **不要因為「這裡只有一個地方用到」就把它就地展開或刪掉** —— 它的守門與 docstring 都認這個名字。
 */
/**
 * 「出貨狀態」那格的值 = 軸的中文 + **一行解釋為什麼是這個字的小字**。
 *
 * 🔴 **為什麼要有這行小字**(Sean 2026-08-15 拍板乙):改讀真相之後,`RCPVVJ` 那張單
 *    上方摘要寫「未訂貨」、品項列寫「訂貨 3/6」—— **兩個都對,而放在一起讓人看不懂**
 *    (軸的定義是「該單所有品項都訂滿才算已訂」,3<6 ⇒ 退回前一階)。
 *    ⚠️ 後果不是美觀問題:**員工可能讀成「還沒下單」而重複下單、同一批貨訂兩次。**
 *    需求檔 `docs/specs/2026-08-12-admin-order-ui-design-brief.md:114` 早就要求
 *    「這個定義要在畫面上讓人看得懂」—— `#514` 只做了改讀真相那半,這片補另一半。
 *
 * 🔴 **軸值本身一個字都不動**(`GOODS_AXIS_LABEL` / `ORDER_GOODS_AXIS_VALUES` / 篩選 chip / adapter
 *    全部沒碰)⇒ 這片不中鐵則 8。小字是**加上去的解釋**,不是新的狀態。
 *
 * 規則與它依賴的三條 DB CHECK 寫在 `goodsAxisProgressNote` 的 docstring,**不在這裡重複一份**
 * (兩份會漂;那條規則的正當性屬於算它的地方)。
 *
 * 🔴 **守門在 `app/orders/[id]/refund-wiring.test.tsx` 的 `describe('出貨狀態的解釋小字')`(六格)。**
 *    **檔名對不上是刻意的**,「為什麼不改名」寫在 `goodsAxisProgressNote` 的 docstring
 *    (E 窗 2026-08-15 `E-629` nit1)。⇒ **動這一格的渲染 = 必跑那六格。**
 */
/* ═══ `itemsTruncated` 閘(2026-08-16 片4c)══════════════════════════════════════════
   🔴🔴 **這一片的範圍比它被登記的樣子大,而那個差別是我實查出來的、不是規格寫的。**

   backlog 登記的是「**那行小字**沒有截斷閘」。實查之後,**軸的標籤本身也沒有** ——
   而**標籤那半嚴重得多**:
     · 小字錯 = 印出一個**少算的分數**(「本單 N 件中已訂 M 件」,N/M 只加總前 200 列)
     · 標籤錯 = 印出一個**錯的狀態**。`goodsAxisOfLines` 三條判定都是 `.every(...)`
       ⇒ **看得見的 200 件全出貨了就答「已出貨」,而沒載進來的那 50 件可能一件都沒出。**
   ⇒ **員工看到「已出貨」會停止動作。** 少算一個數字他還會去查;講錯狀態他不會。
   ⚠️ **字面是「已出貨」不是「出貨完成」**(code-reviewer 2026-08-16 抓到我引錯):
      `出貨完成` 是**列表**八值 `ORDER_STATUS_LABEL.paid.shipped`,**這一格印的是**
      `GOODS_AXIS_LABEL.shipped` = `已出貨`(`order-list-view.ts` 搜 `shipped: '已出貨'`)。
      🔴 我原本那句戲劇性描述,描述的其實是**列表那條軸** —— 而列表那條有它自己的問題(見下)。

   🔴 **截斷是【單向樂觀】—— 不會往保守的方向錯,所以只能 fail-closed。**
      `.every()` 對子集**單調**:全集為真 ⇒ 子集必為真;反之不然。
      ⇒ **子集算出來的階段恆 ≥ 真實階段**,不存在「因為截斷而停在較低階」那個方向。
      ⚠️ **我第一版寫「兩個方向都會錯…軸會停在較低階(保守、無害)」,那句是錯的**
      (code-reviewer 2026-08-16 抓到):我舉的例(沒載進來的已出貨、看得見的沒出)
      **全集算出來也是同一個低階 ⇒ 那根本不是錯誤,是正確答案。**
      🔴 把一個「非錯誤」寫成「錯誤的另一個方向」,會讓下一個人以為這裡有雙向風險要權衡,
         而**真相是單向的、沒有權衡空間**。同檔 `order-status-axes.ts` 搜 `剛好給對答案`
         記過同型教訓:「用錯的分母剛好給對答案,不是它對」。

   ⚠️ **閘只能裝在這裡,不能裝進 `goodsAxisOfLines`** —— 它的參數型別刻意收窄成
      「有 `items`、每件帶 `quantity` 與 `quantitySummary`」,看不到 `itemsTruncated`
      (理由寫在 `orderDetailGoodsAxis` 的 docstring)。這與頭條那格是**同一個結構決定**。

   📎 **文案對齊既有兄弟**:`shipping-doc.tsx` 搜 `品項清單這次沒有完整載入` 與
      `item-procurement-section.tsx` 的 `TruncationWarning` 都是同一句起手。
      **這裡不用 banner** —— 它住在一個 label-value 的窄格裡,banner 會把整張卡撐開。

   ⚠️ **風險已量、代價不對稱(與頭條那格同一組理由)**:
      `ORDER_ITEMS_EMBED_LIMIT = 200`(`packages/adapters/src/supabase/mappers/order.ts`
      搜 `ORDER_ITEMS_EMBED_LIMIT`)⇒ 機車零件單實務上到不了。
      **但讀它的代價只是「截斷時改印未知」,不讀它的代價是【講錯狀態而零訊號】。** */
function GoodsAxisValue({ detail }: { detail: AdminOrderDetail }) {
  if (detail.itemsTruncated) {
    return (
      <>
        未知
        <span className='text-muted-foreground block text-xs'>
          這張單的品項清單這次沒有完整載入,算不出出貨狀態。請重新整理。
        </span>
      </>
    );
  }
  const note = goodsAxisProgressNote(detail.items);
  return (
    <>
      {GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]}
      {note !== null && <span className='text-muted-foreground block text-xs'>{note}</span>}
    </>
  );
}

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
 *       📎 **風險量測與「代價不對稱」的完整論證只寫一處** —— 見本檔上方 `GoodsAxisValue`
 *       前面那段(搜 `ORDER_ITEMS_EMBED_LIMIT`)。**兩處全文會漂**,這裡只留指標。
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
function HeadlineNumbers({
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

  return (
    <div className='grid gap-px border bg-border @md:grid-cols-2'>
      <section className={SPEC}>
        {/* 🔴 **金額不帶 `NT$`**(Sean 2026-08-16 於真路由肉眼驗後逐字:「不用NT」)。
            ⚠️ **這是【呼叫端字面】不是格式化函式** —— `formatOrderAmount` 本身只回數字
            (`order-list-view.ts` 搜 `toLocaleString`),`NT$` 一直是各處自己前綴的。
            ⇒ 本片**沒有動共用函式**,只動這兩行 ⇒ **不中鐵則 12⑥**。
            **數法**:`grep -rn 'formatOrderAmount(' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '.test.' | wc -l`
            ⇒ **27**,其中 1 行是**定義本身**(`order-list-view.ts` 搜 `export function formatOrderAmount`)、
            1 行是**註解**(`customers/customer-detail-view.ts` 搜 `千分位對齊`)⇒ **真消費端 25**。
            (我第一版寫「27 個消費端」—— 那是把定義與註解也算進去,code-reviewer 抓到。**先分類再報數。**)
            📎 **同一個總額在這一頁還印第二次、而那一處仍帶 `NT$`**:
            `order-detail-items-table.tsx` 搜 `總計`。Sean 逐字只指頭條那排 ⇒ **本片不動它**,
            但**同頁同一個數字現在有兩種格式** ⇒ 已列進交件的「請他再看一眼」清單。 */}
        <p className={SPEC_V}>
          {formatOrderAmount(detail.total.amount)} /{' '}
          {payment.kind === 'unknown' ? '未知' : formatOrderAmount(payment.received)}
        </p>
        <p className={SPEC_L}>總額 / 已收</p>
      </section>
      <section className={SPEC}>
        <p className={SPEC_V}>{qty === null ? '未知' : `${qty.ordered} / ${qty.instock}`}</p>
        {/* 🔴🔴 **小標是「件數」不是「品項數」——【這是正確性修正,不是文案調整】。**
            (`Q-A216-F2b` Sean 2026-08-16 拍甲)
            `goodsQuantityHeadline` 加總的是**件數**(每個 line 的 `quantity` 面),
            而「品項數」是**另一個數**:OD 稿自己就把兩者分開寫成「**3 項 · 4 件**」
            (`overview-desktop-bmw-m.html` 搜 `項 ·`)⇒ 一張 3 個品項、共 4 件的單,
            兩個詞的值不同。**用「品項數」會讓員工照字面去對帳,然後對不上。**
            🔴 **不要改回去** —— 這不是「哪個詞好聽」,是那個詞指錯了對象。
            ⚠️ 而「已訂 / 到貨」放小標的理由不變:兩個裸數字掛在一個詞底下分不出誰是誰,
            而後台 UI 常設驗收條款是「不用人教能做對嗎」(2026-08-11 Sean 拍板)。 */}
        <p className={SPEC_L}>件數 已訂 / 到貨</p>
      </section>
    </div>
  );
}

export function OrderSummaryCards({
  detail,
  payments,
}: {
  detail: AdminOrderDetail;
  payments: PaymentListData;
}) {
  return (
    /* 🔴 `-space-y-px` 讓兩塊面板**共用同一條 1px 線**,不是留一道 1px 的縫。
         各自有 `border` ⇒ 直接堆疊會變 2px 粗線;負 1px 把它們疊回一條。
         ⚠️ 這與格內的 `gap-px` 是**兩件不同的事**:`gap-px` 讓容器底色透出來當線(OD `.specs`),
            這裡是把兩個容器的邊框收成一條。不要以為重複了就刪掉其中一個。
         🔴 **這是本 repo 第一個負值 space 工具**,所以「Tailwind 到底編不編得出來」是真問題,不是形式。
            **已量,不是推的**(2026-08-16 對真 build 產物):
              `grep -rho '\.-space-y-px[^}]*}' apps/admin/.next/static`
              ⇒ `.-space-y-px>:not(:last-child)){…margin-block-end:calc(-1px * …)}`
            ⇒ **規則存在** ⇒「沒編出來、兩塊面板中間變 2px 粗線」那個失敗模式**機械上已排除**。
            ⚠️ 但這只證「規則在」,**不證「看起來對」** —— 後者仍要 Sean 的眼睛。 */
    <div className='-space-y-px'>
      <HeadlineNumbers detail={detail} payments={payments} />
      {/* 🔴 `gap-px bg-border border` = OD `.specs` 的髮絲線格(見 `CARD` 上方那段的完整理由)。
       ⚠️ **`gap-px` 與 `bg-border` 是一組,少一個就不成立**:只有 `gap-px` 會變成四格緊貼、
          完全沒有分隔線;只有 `bg-border` 而 gap 是 0 則底色永遠被格子蓋住、看不到。
       ⚠️ **容器斷點(`@md` / `@4xl`)一個字沒動** —— 那條的理由(同一份明細有整頁與面板兩個容器)
          與本片無關,不要順手一起改。 */}
      <div className='grid gap-px border bg-border @md:grid-cols-2 @4xl:grid-cols-4'>
        <section className={CARD}>
          <h2 className={CARD_TITLE}>客戶資訊</h2>
          <Field label='姓名' value={detail.customer.name} />
          <Field label='電話' value={detail.customer.phone} />
          <Field label='Email' value={customerEmailDisplay(detail.customer.email)} />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>收件與出貨</h2>
          <Field label='收件人' value={detail.shippingAddress.name} />
          <Field label='電話' value={detail.shippingAddress.phone} />
          <Field label='地址' value={detail.shippingAddress.line} />
          <Field label='出貨方式' value={shippingMethodLabel(detail.shippingMethod)} />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>付款</h2>
          <Field label='付款狀態' value={PAYMENT_STATUS_LABEL[detail.paymentStatus]} />
          {/* 🔴🔴 `#514`:這一格**改讀貨品軸的真相**,不再讀 `orders.fulfillment_status`。
              那一欄的 COLUMN COMMENT 自己寫著「E10 起停止維護、值為 legacy stale、不得當現況真相」
              (`20260729010000_m4b_e10_d0_display_id_expand.sql:88` 逐字),而**全 migrations 零 writer**
              ⇒ 正式庫 13/13 全是 DEFAULT `notOrdered` ⇒ **這一格從來沒有正確過一次**。
              ⚠️ 那條 COMMENT 防的是「有人拿它做判斷」,**沒防「有人把它畫出來」——`render` 不是判斷**。
              🔴 **文案一個字都沒變**:`GOODS_AXIS_LABEL` 與 `FULFILLMENT_STATUS_LABEL` 字面逐字相同
                 (`order-list-view.ts` 兩張表的 docstring 互相記著這件事)⇒ **變的只有資料從哪來**。
              ⚠️ **修完之後多數單仍顯示「未訂貨」,而那是對的** —— 正式庫多數單還沒採購;
                 要證明它真的改讀了,看**有採購紀錄的那張單**(`order-status-axes.test.ts` 釘了那一格)。 */}
          <Field label='出貨狀態' value={<GoodsAxisValue detail={detail} />} />
          <Field
            label='來源 · 管道'
            value={`${ORDER_SOURCE_LABEL[detail.orderSource]} · ${PAYMENT_CHANNEL_LABEL[detail.paymentChannel]}`}
          />
          <Field
            label='付款時間'
            value={detail.paidAt ? formatOrderDateTime(detail.paidAt) : null}
          />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>發票</h2>
          <Field label='需求型式' value={invoiceTypeLabel(detail.invoiceRequest.type)} />
          {detail.invoiceRequest.taxId && (
            <Field label='統編 / 抬頭' value={`${detail.invoiceRequest.taxId} ${detail.invoiceRequest.title ?? ''}`} />
          )}
          {detail.invoiceRequest.carrier && (
            <Field label='載具' value={detail.invoiceRequest.carrier} />
          )}
          <Field label='開立狀態' value={INVOICE_STATUS_LABEL[detail.invoiceStatus]} />
          <Field label='發票號碼' value={detail.invoiceNumber} />
          <Field
            label='發票金額'
            value={
              detail.invoiceAmount ? `NT$ ${formatOrderAmount(detail.invoiceAmount.amount)}` : null
            }
          />
          </section>
      </div>
    </div>
  );
}
