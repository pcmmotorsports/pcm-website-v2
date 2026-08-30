// OrderDetailView.tsx — 會員訂單明細頁的版面(`#240`;/account/orders/<displayId>)
//
// 🔴 直接搬 OD 稿 `pcm-home-redesign/order-detail-page.html`(305 行)的字面與 class,不翻譯、不重寫:
//   .od-back / .od-head(.od-status + h1 + .od-head-meta)/ .od-steps / .od-line / .od-sums /
//   .od-info(Shipping | Payment)/ .od-help
//   樣式住在 OD 的 `pcm-account.css:1167` 起「訂單詳情」段(與會員中心共用 .acc-main / .acc-section)。
//
// 🔴 **稿上有、而本片【刻意不做】的東西**(每一個都是「沒有資料來源」,不是漏做):
//   ⛔ ~~· 「下載訂單 PDF」鈕 —— 稿註解要求真站接 /account/orders/<id>/statement.pdf 由後端產;
//     後端不存在 ⇒ **做出來就是第二顆死鈕**,而本片存在的理由正是消滅第一顆。~~
//   ✅ **2026-08-30 片 C:那顆鈕接上了**(板 `:416` ⟦b4-CUSTPDF1⟧;片 A 路由+授權、片 B 紙面已落地)。
//     🔴 **而它的 URL 是 `/account/orders/<displayId>/statement`,【沒有 `.pdf`】** ——
//        稿 `:288` 寫的是 `statement.pdf`,而那句話**假設的是伺服器產檔**;
//        Sean 的選型走甲案(客人自己的瀏覽器按列印/儲存成 PDF)⇒ 那條路沒有 `.pdf` 這個網址。
//        ⇒ **照稿抄那一行的話, 這顆鈕會 404** —— 而稿 `:286` 自己逐字警告的正是那件事
//          (「不假裝下載成功、也不給一個會 404 的 href」)。**稿在同一段裡同時給了陷阱與警告。**
//     ⚠️ **一個【我沒有自己決定】的字**:鈕上的字照稿是「下載訂單 PDF」,而**點下去不會下載一個檔**,
//        是打開一頁可以列印的明細(那一頁自己的鈕才寫「列印 / 儲存成 PDF」)。
//        ⇒ 客人的目的達得到, 而「下載」這兩個字比實際多說了一點點。
//        ⇒ **照鐵則 1 先搬稿的字面, 並把這一格交給 Sean 拍**(文案調性是他的板, 不是我的)。
//        🔴 **而稿那個字面本身就是一板**:稿 `:193` 逐字帶著「**(2026-08-07 Sean 拍板)**」
//           ⇒ 動它 = 動一板, 而唯一可以偏離稿字面的理由是**另一板推翻它**。
//        🔴🔴 **落點**:板 `docs/launch-todo.md:416` ⟦b4-CUSTPDF1⟧ 尾端「待 Sean 拍」那一格
//           (第 3 題 `Q-明細鈕文案`)。**寫在那裡而不是只寫在這裡** ——
//           一句「交給 Sean 拍」如果沒有落點, **session 結束它就消失, 而鈕已經上線了**。
//           (code-reviewer 2026-08-30 抓:同檔另兩處待拍都寫了落點, 只有這一處沒有。)
//   · 物流(courier / trackingNo / trackingUrl / 物流歷程)與進度軸後兩階 ——
//     稿 :167-175 自己就寫著「需要第 2 批【包裹真相】」,且逐字警告
//     **「fulfillment_status 是 stale 出貨軸,拿它點亮『已出貨』等於對客人說謊」**。
//     ⇒ 後兩階畫成未完成的空心點,**這是稿指定的誠實狀態**,不是缺工。
//   · etaLabel / discountLabel —— 零資料來源。
//
// 🔴 狀態字面**一律呼叫 orderStatusLabel()**、不照抄稿上那串三元運算:
//   稿是 2026-08-07 的,而 Sean 2026-08-18 拍 Q06=甲 把 partiallyPaid 從「付款確認中」改成
//   「已收訂金」⇒ **逐字搬稿會把一個被推翻的字面搬回線上**。tone 才照稿(spec 附錄 B-5)。

import Link from 'next/link';
import type { MemberOrderDetail, MemberOrderDetailItem, OrderItemVehicleSnapshot, PaymentStatus } from '@pcm/domain';
import { ProductImage } from '@/components/ProductImage';
import { formatOrderDate, orderStatusLabel, orderStatusTone } from '@/lib/orders/order-display';
import { ORDER_DETAIL_ITEMS_TRUNCATED_NOTE } from '@/lib/account-order-copy';

/**
 * 付款軸 → 徽章三檔(spec 附錄 B-5;來源 = OD 稿 `order-detail-page.html:150-156` 的 tone)。
 *
 * 🔴 **稿另有 `已出貨`(progress)/ `已送達`(done)兩檔吃 `order.shipStage`** —— 那需要第 2 批
 * 「包裹真相」,而 `orderStatusLabel()` 現在**完全不讀出貨軸**(A9f:paid 一律固定「處理中」)
 * ⇒ **第 1 批那兩檔永遠不會出現,不要為它們寫分支。**
 */
/**
 * 金額欄的標題字面(codex 關卡2 must-fix,2026-08-23)。
 *
 * 🔴 **原本是 `paid ? '實付金額' : '應付金額'` 的二元式,而它對三個狀態說了假話**:
 *    `refunded` / `partiallyRefunded` / `partiallyPaid` 全都會印成
 *    **「應付金額 + 原始總額」** ⇒ **一個已經退款的客人,會被告知他還欠全額。**
 * ⚠️ 那個二元式是**從 OD 稿逐字搬來的**(稿 `:247` / `:271`)——
 *    **稿是視覺權威,不是金額語意的權威。**
 * 🔴🔴 ~~`unpaid` 在這一頁**到不了**(adapter 端 `.neq('payment_status','unpaid')`、`#249`);
 *    列出來是因為 `Record` 要窮盡,**不是因為它會出現**。~~
 *    **⇒ 2026-08-24 起這句話是假的** —— `#249` 拆掉了那道濾網,`unpaid` **現在天天會出現**
 *    (刷卡卡住的單、等匯款的單、以及所有已取消的單 —— 取消不動 `payment_status`)。
 *    ⇒ 而它的「應付金額」對**取消單**是錯的 ⇒ 元件內另有一道 `cancelled ? '訂單金額' : …` 蓋掉它。
 *    ⚠️ **對「真的還付得了的 unpaid 單」,「應付金額」仍然是對的** ⇒ 這一格不動。
 * 🔴 三個非 `paid` 的可達狀態一律用中性的「訂單金額」—— 它在那三種狀態下都為真。
 *    **而這個字面是我選的,不是稿上的、也不是 Sean 拍過的** ⇒ 已列給主視窗送他過目。
 */
const AMOUNT_LABEL: Record<PaymentStatus, string> = {
  paid: '實付金額',
  unpaid: '應付金額',
  partiallyPaid: '訂單金額',
  refunded: '訂單金額',
  partiallyRefunded: '訂單金額',
};

// 🔴 ~~這裡原本有一份自己的 `STATUS_TONE`~~ ⇒ **2026-08-29 刪除**(codex 對抗審查 must-fix):
//    它與 `OrdersTab` 那份【對 `partiallyPaid` 給出不同答案】⇒ 同一個客人在列表與明細
//    看到同一張單的兩種顏色。⇒ 改吃 `orderStatusTone()` 這個唯一來源。
//    📌 修法不是把兩份對齊 —— 對齊過的兩份下次還會再分岔一次。

/** 金額字面(整數 Money → `NT$ 1,234`);與 OrdersTab 的既有寫法一致。 */
function nt(amount: number): string {
  return `NT$ ${amount.toLocaleString()}`;
}

/**
 * 車款快照 → 稿上 `.od-line-fits` 那一行的字面。
 *
 * ⚠️ **「稿的 `it.fits` 就是 vehicle_snapshot」是【推的】** —— 形狀吻合而稿沒寫來源
 * (見 `MemberOrderDetailItem.vehicle` 的 docstring)。缺 → null ⇒ 那一行不印。
 */
function formatVehicle(v: OrderItemVehicleSnapshot | null): string | null {
  if (!v) return null;
  const year = v.year === undefined ? '' : ` ${v.year}`;
  return v.kind === 'dict' ? `${v.brand} ${v.model}${year}` : `${v.raw}${year}`;
}

function OrderLine({ item }: { item: MemberOrderDetailItem }) {
  const fits = formatVehicle(item.vehicle);
  return (
    <div className="od-line">
      <div className="od-line-img">
        {/* 🔴 取圖與 fallback 走既有 ProductImage(spec 附錄 B):它自帶
            onError → 站內佔位圖 → 漸層 的三層退化,而 **onError 記在 state、不改 src**
            (改 src 會再觸發 load ⇒ 佔位圖也載不到時變成無限迴圈)。不另發明一條取圖路徑。
            ⚠️ imageUrl 為 null 的兩個成因(商品無圖 / **商品已下架 join 不到**)在這裡
               長得一樣,而兩者都該退到佔位圖 ⇒ 不分流。 */}
        <ProductImage image={item.imageUrl} label={item.title ?? item.variantSku} />
      </div>
      <div>
        {/* 🔴 品牌 null ⇒ **整行不印**(不印「—」)——判準來自 AdminOrderDetailItem.brand 的
            docstring:「缺值本身算不算一個需要被看見的事實」。品牌缺值不是異常。 */}
        {item.brand !== null && <div className="od-line-brand">{item.brand}</div>}
        <div className="od-line-name">{item.title ?? item.variantSku}</div>
        {fits !== null && <div className="od-line-fits">{fits}</div>}
      </div>
      <div className="od-line-r">
        <div className="od-line-unit">
          {nt(item.unitPrice.amount)} × {item.quantity}
        </div>
        <div className="od-line-sum">{nt(item.lineTotal.amount)}</div>
      </div>
    </div>
  );
}

export type OrderDetailViewProps = {
  order: MemberOrderDetail;
};

export function OrderDetailView({ order }: OrderDetailViewProps) {
  const paid = order.paymentStatus === 'paid';
  // 🔴🔴 **`#249`(2026-08-24):這一頁對【已取消 / 已逾期】的單從今天起才走得到。**
  //    在此之前 adapter 的 `.neq('payment_status','unpaid')` 把它們全濾掉了
  //    ⇒ **下面三格是「一段從來沒有人走過的路」被點亮之後才暴露出來的**,不是新做的功能:
  //    ① `tone`:`STATUS_TONE.unpaid = 'action'` = **催客人去付款**的那一檔顏色 ⇒ 取消單一律改 `done`
  //    ② `amountLabel`:`AMOUNT_LABEL.unpaid = '應付金額'` ⇒ **會告訴一個取消單的客人他還欠錢** ⇒ 改中性
  //    ③ 取消原因那一格:自動失效寫進去的是**英文機器碼** `payment_expired` ⇒ 不得原樣印(見下)
  //    📌 形狀:**拆掉一道濾網,等於把它背後所有沒被走過的路一次點亮 —— 而那些路沒有人驗過。**
  const cancelKind = order.cancelKind;
  const cancelled = cancelKind !== 'none';
  const tone = orderStatusTone(order.paymentStatus, order.fulfillmentStatus, cancelKind);
  // 稿的四階進度軸。前兩階有來源;後兩階在第 1 批一律未完成(見檔頭)。
  const steps = [
    { t: '訂單成立', d: formatOrderDate(order.createdAt), ok: true },
    // 🔴 日期只能用 `paidAt`(codex 關卡2 must-fix):延後付款或重試成功時,下單日與付款日
    //    可以差好幾天 ⇒ 拿 `createdAt` 冒充等於**印一個我們自己編的付款日**,而客人沒有第二個來源可以對。
    //    `paidAt` 為 null ⇒ **那一階不印日期**(狀態仍可標完成),不要退回 createdAt。
    { t: '付款完成', d: order.paidAt === null ? '' : formatOrderDate(order.paidAt), ok: paid },
    { t: '已出貨', d: '', ok: false },
    { t: '已送達', d: '', ok: false },
  ];
  const nowIdx = steps.reduce((n, s, i) => (s.ok ? i : n), 0);
  // 🔴 取消單一律走中性字面(見上面 ②)。`'訂單金額'` 是這張表裡既有的中性值,不是新造的字。
  const amountLabel = cancelled ? '訂單金額' : AMOUNT_LABEL[order.paymentStatus];
  // 收件三欄缺值印 `—`:**這裡缺值是異常、要看得出來**(與品牌那格刻意相反)。
  const dash = (v: string | null) => (v === null || v === '' ? '—' : v);

  return (
    <>
      <Link className="od-back" href="/account?tab=orders" data-od-id="order-back">
        <span>訂單記錄</span>
      </Link>

      <div className="od-head" data-od-id="order-head">
        <div>
          <span className={`od-status is-${tone}`}>
            {orderStatusLabel(order.paymentStatus, order.fulfillmentStatus, order.cancelKind)}
          </span>
          <h1>{order.displayId}</h1>
          <div className="od-head-meta">
            {formatOrderDate(order.createdAt)} 成立
            {/* 🔴 itemsTruncated ⇒ 件數不可信。**不印 0、不留空**(逐字沿用 OrderListItem
                :196 的紀律):印「?」= 我們也不確定,而下一步寫在下面看得見的說明裡。 */}
            {order.itemsTruncated ? ' · 共 ? 件商品' : ` · 共 ${order.itemCount} 件商品`}
          </div>
        </div>
        {/* 片 C:稿 `:196-197` 的 `.od-head-actions` > `.acc-btn-ghost`。
            **class 與位置都照稿**,CSS 早就在(`order-detail.css:96`)、不新寫。
            🔴 用 `<Link>` 不是 `<button>`:稿用 button 是因為原型不產檔、要就地換字;
               而我們**真的有一頁可以去** ⇒ 它是一個導覽,不是一個動作。
               (用 button + onClick 導頁會失去中鍵開新分頁、右鍵複製網址與鍵盤可及性。)
            🔴 `encodeURIComponent` 沿用 `components/account/tabs/OrdersTab.tsx:189` 的既有慣例 ——
               而**下游那一頁刻意【不再解一次碼】**(Next 的動態路由段進來就已解碼,
               再解一次遇到 `%` 會拋 `URIError` 而整頁 500)。兩端要對得起來。 */}
        <div className="od-head-actions">
          {/* 🔴 **開新分頁 —— Sean 2026-08-30 在正式站看過之後直接下的。**
              他的原話逐字:「**有但是直接取代整個頁面, 我要可以跳新分頁或者直接下載PDF,
              可以直接下載PDF最好**」。
              ⇒ 「直接下載 PDF」那一半是 `-30` 的 `:412`(伺服器產檔), 不在這一片;
                 而**「跳新分頁」他明確接受, 且今天就做得到** ⇒ 先做這半。
              🔴 `rel="noopener noreferrer"` **不是可選的**:`target="_blank"` 會把
                 `window.opener` 交給新分頁 —— 那一頁是我們自己的沒錯, 而**這條紀律不看目的地**
                 (下一個人改 href 時不會回來補它)。
              ⚠️ **可及性缺口, 照實寫**:鈕上的字沒有講「會開新分頁」——
                 而**那個字面是 Sean 的板**(稿 `:193` 帶著「(2026-08-07 Sean 拍板)」)
                 ⇒ 我不自己加。已與鈕文案那題一起列在板 `:416` 等他。 */}
          <Link
            className="acc-btn-ghost"
            href={`/account/orders/${encodeURIComponent(order.displayId)}/statement`}
            target="_blank"
            rel="noopener noreferrer"
            data-od-id="order-statement-link"
          >
            下載訂單 PDF
          </Link>
        </div>
      </div>

      <div className="od-steps" data-od-id="order-steps">
        {steps.map((s, i) => (
          <div
            key={s.t}
            className={`od-step${s.ok ? ' is-done' : ''}${i === nowIdx ? ' is-now' : ''}`}
          >
            <div className="od-step-t">{s.t}</div>
            <div className="od-step-d">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="acc-section" data-od-id="order-items">
        <div className="acc-section-head">
          <h2>商品明細</h2>
        </div>
        {order.itemsTruncated && (
          <p className="acc-order-note">{ORDER_DETAIL_ITEMS_TRUNCATED_NOTE}</p>
        )}
        {order.items.map((item) => (
          <OrderLine key={item.id} item={item} />
        ))}

        <div className="od-sums" data-od-id="order-sums">
          <div className="od-sum">
            <span>商品小計</span>
            <b>{nt(order.subtotal.amount)}</b>
          </div>
          <div className="od-sum">
            <span>運費</span>
            <b>{order.shippingFee.amount === 0 ? '免運' : nt(order.shippingFee.amount)}</b>
          </div>
          {order.discountTotal.amount > 0 && (
            <div className="od-sum od-sum-off">
              <span>折扣</span>
              <b>− {nt(order.discountTotal.amount)}</b>
            </div>
          )}
          {/* 稿註解逐字:**未付款的訂單不能寫「實付」——那是還沒發生的事。** */}
          <div className="od-sum od-sum-total">
            <span>{amountLabel}</span>
            <b>{nt(order.total.amount)}</b>
          </div>
        </div>
      </div>

      <div className="acc-section" data-od-id="order-info">
        <div className="acc-section-head">
          <h2>收件與付款</h2>
        </div>
        <div className="od-info">
          <div>
            <h3>Shipping</h3>
            <dl>
              <dt>收件人</dt>
              <dd>{dash(order.shippingAddress.name)}</dd>
              <dt>手機</dt>
              <dd>{dash(order.shippingAddress.phone)}</dd>
              <dt>地址</dt>
              <dd>{dash(order.shippingAddress.line)}</dd>
            </dl>
          </div>
          <div>
            <h3>Payment</h3>
            <dl>
              <dt>付款方式</dt>
              {/* paymentMethod 為 null = 尚無成功請款(不是「資料缺失」)⇒ 仍印 `—`,
                  與收件那三格同理:這一格空著是**看得出來比較好**的那種空。 */}
              <dd>{dash(order.paymentMethod)}</dd>
              <dt>{amountLabel}</dt>
              <dd>{nt(order.total.amount)}</dd>
            </dl>
          </div>
        </div>
      </div>

      {cancelled && (
        <div className="acc-section" data-od-id="order-cancelled">
          <div className="acc-section-head">
            {/* 🔴 兩種取消對客人是**兩件事**:一件是我們關的,一件是他自己沒付而過期。
                字面沿用 Sean 2026-08-24 那一板的原字(「已取消」/「已逾期」),不另造詞。 */}
            <h2>{cancelKind === 'expired' ? '訂單已逾期' : '訂單已取消'}</h2>
          </div>
          {/* 🔴🔴 **這一格【不再印 `cancelledReason`】—— codex must-fix,2026-08-24。**
              ~~原本寫「`cancelledReason` = 可對客文案」~~ **那句話是錯的**:
              `p_reason_code = 'other'` 那條路寫進去的是**員工當場打的原文**
              (`20260804180000_..._admin_cancel_order.sql:135-136`)——
              員工打「供應商欠款 / 內部失誤」都會原樣進那一欄,而沒有任何一層把它變成對客文案。
              🔴 **而在 `#249` 之前沒有人看得到它** ⇒ 那不是既有缺陷,是**這一片親手打開的那扇門**。
              ⇒ 紀律:**客人端只渲染枚舉映射出來的固定字串,永遠不渲染自由文字。**
                 現在連原文都**到不了這一層**(mapper 端就收斂掉了)⇒ 這是型別閘,不是自律。
              ⚠️ **代價照實寫**:客人看不到「為什麼被取消」。要接回來的正確做法是從
                 取消原因的**七值枚舉欄**映一張**固定文案表**,而那張表的字要 Sean 定。
                 🔴 **這裡刻意不寫那張表的字面名** —— `scripts/storefront-projection-leak-guard.test.ts`
                    掃 storefront 原始碼時**不剝 `*` 開頭的註解行**(該檔 `:146-148` 逐字寫了理由:
                    剝了會讓 template literal 裡的跨行 raw SQL 隱形)⇒ 寫在這裡會讓那道守門【假紅】。
                    ⚠️ **改的是這句話的寫法, 不是那道守門** —— 它偏保守是刻意的, 不要去鬆它。
                    要查那個欄位:`grep -rn reason_code supabase/migrations/`(枚舉定義在建表 migration)。
              📌 下面兩句是我寫的、不是稿上的、也不是 Sean 拍過的 ⇒ 已列進送他過目的文案清單。 */}
          <div className="acc-empty-sub">
            {cancelKind === 'expired'
              ? '這張訂單超過付款期限,已自動取消。想再買一次的話,重新下單即可。'
              : '這張訂單已經取消,不需要付款。想知道原因或要重新訂購,請與我們聯絡。'}
          </div>
        </div>
      )}

      <div className="od-help" data-od-id="order-help">
        <div>
          <div className="od-help-t">這筆訂單有問題?</div>
          <div className="od-help-d">
            商品若有瑕疵,收到後請直接用 LINE 傳照片給我們,我們會安排換貨。
            非瑕疵的商品恕不接受退換 —— 下單前不確定裝不裝得上,先問我們最快。
          </div>
        </div>
        <a
          className="acc-btn-ghost"
          href="https://lin.ee/R6QZUH2"
          target="_blank"
          rel="noopener noreferrer"
        >
          用 LINE 詢問這筆訂單
        </a>
      </div>
    </>
  );
}
