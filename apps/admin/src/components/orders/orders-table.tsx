import Link from 'next/link';
import { OrderShipCheckbox } from './shipping-selection';
import type { AdminOrderSummary } from '@pcm/domain';
import {
  INVOICE_STATUS_LABEL,
  MEMBER_TIER_LABEL,
  PAYMENT_STATUS_CAPSULE,
  PAYMENT_STATUS_LABEL,
  STATUS_CAPSULE,
  formatOrderAmount,
  formatOrderItemVehicle,
  formatOrderListDate,
  orderedCapsuleClass,
} from '../../lib/orders/order-list-view';

// M-4a Slice D-1a 訂單列表(server-render;每商品一列、同單分組)。
// 需求(Sean):一張訂單多商品 → 拆多列(各商品到貨時間不同、要個別看);同單分組 = 訂單層欄
//   (單號 / 日期 / 客戶)以 rowSpan 合併、品項層欄(品牌 / 料號 / 品名 / 車種 / 數量)逐列。
//
// 🔴 **M-4b E10 A11a-1(2026-08-06;plan `docs/specs/2026-08-06-e10-a11a-list-rebuild-plan.md`、
//    Sean 十題全拍 A)**:九碼三群(整單彙總 badge / per-item 狀態 cell / 表層 props 與衍生)已下架,
//    這是**列表側最後一個九碼消費端**。同批移除「來源 · 管道」欄(母 plan §5.1a:明細頁已有、
//    不是每天要看的資訊)、單價與總金額合併為「金額」、會員等級併入客戶格小字。
//    ⇒ A11a-1 收工為 **9 欄**;訂貨 / 出貨 / 發票 / 操作四欄依 plan 分屬 A11a-4/-6/-5 與 A13。
//
// 🔴 **A11a-2(2026-08-06)**:付款軸小字進訂單編號格、日期改接 `formatOrderListDate`
//    (同年 `07/25` / 跨年 `2025/06/27`)。**兩者都塞進既有格、該片收工時欄數仍是 9**(plan 逐字)。
//
// 🔴 **A11a-4(2026-08-06)**:加「訂貨」欄(**品項層**,逐列 `n/m`)⇒ **現為 10 欄**。
//    前置 = A9c(三軸進投影 + mapper 正規化成非 nullable)。膠囊與上色屬 A11b、本片只做純文字。
//
// 🔴 **A11a-5(2026-08-06)**:加「發票」欄(**訂單層** rowSpan)⇒ **現為 11 欄**。
//    Sean Q2b=A:**只顯示 `invoice_status` 三態、不顯示載具別** —— 載具別在 `orders.invoice` jsonb
//    (`carrier`/`type`),拉進列表會破壞「列表投影零 PII」那條邊界,A9c 也刻意沒把它放進投影。
//
// 🔴 **A11c(2026-08-06):手機卡片版**(plan `docs/specs/2026-08-06-e10-a11c-mobile-card-plan.md`;
//    Q1=A 主視窗裁、槽位分法 Sean 拍 A)。真權威 = 通用 UI 規範
//    `docs/specs/2026-07-25-admin-backend-rebuild-spec.md:427` 逐字:「**手機版列表一律轉卡片**,
//    不做橫向捲動表格。主要欄位加粗置頂、次要副行、金額/狀態靠右。(Sean 常用手機遠端操作;
//    **現行訂單列表 13 欄在手機上不可用**)」—— 那個括號點名的就是本表。
//
//    做法 = 桌機表格 `hidden md:block` + 手機卡片 `md:hidden`,**純 CSS 斷點、零 JS、零視窗偵測**,
//    斷點與槽位語彙(主標 / 靠右 / 副行 / 最小字)逐字照抄 `shared/admin-data-table.tsx:101,135-156`。
//    🔴 **刻意不接 `AdminDataTable` 本體**:它是**扁平列模型**(一列一 `<tr>`),而本表是
//    **兩層**(一訂單一 `<tbody>`、訂單層欄 rowSpan 合併)⇒ 今天接不上,除非改它的列模型
//    (= 動 3 個消費端的共用元件)。遷移歸 A12a,屆時以本片實查為前提重裁。
//
// 🔴🔴 **雙 markup 的到期日**(承接 `shared/admin-data-table.tsx:16-22` 的警告,本檔是**第二個**
//    踩進來的地方,不能只留在共用元件檔裡等人自己發現):桌機列與手機卡各渲染一次 cell、共兩份 DOM。
//    今天安全,因為**本檔零互動、零 client 邊界**。但 **A13 的操作欄(取消鈕)一落地就會重現
//    重複表單與重複 client 狀態** ⇒ 屆時改成單一 markup + CSS reflow,或讓帶互動的欄位
//    只在主標/靠右槽出現一次。**動 A13 前先回來讀這段。**
//
// 🔴 鐵則 12:金額 + 會員等級同列 = 經銷價脈絡,全 server-render → 敏感值不序列化進 client bundle;
//    SSO 閘後 admin-only。**本片拆掉唯一的 client 元件(狀態欄下拉)後,本檔已無任何 client 邊界。**
//    ⇒ 卡片版**同樣零 client 邊界**(純 server component、零 `use*`、零 `'use client'`)。
//
// 🔴 **2026-08-09 片 2b-1 更正上面那句:本檔已經不是「零 client 邊界」了。**
//    出貨動線需要勾選狀態 ⇒ 引入**第一個** client 邊界,但做成 **island**:
//    只有 `<OrderShipCheckbox>`(`shipping-selection.tsx`)是 client,**表格與卡片本體仍是 server component**。
//    🔴 鐵則 12 的護欄**沒有鬆動**:那顆 checkbox 的 props **只有 `orderId` / `customerUserId` 兩個純量**,
//    `AdminOrderSummary` 整包(帶 `total` 金額與 `tierAtCheckout` 會員等級)**絕不進 client props** ——
//    否則那兩個敏感值會被序列化進 RSC payload。⚠️ **使用者看不到 ≠ 沒送出去**(payload 在 network 面板是純文字)。
//    這條由 `shipping-selection.test.tsx` 的守門釘住,不是只寫在這段註解。
//
// 🔴 **A11b(2026-08-07)**:付款軸與訂貨軸從純文字改膠囊(pill)上色,配色表在 `order-list-view.ts`
//    (`PAYMENT_STATUS_CAPSULE` / `orderedCapsuleClass`)。**A11b 只落這兩軸,出貨軸不做**
//    ——沒有資料來源(`AdminOrderItemQuantitySummary` 無 shipped 欄),前置 = A11a-6。
// V-3b:「年份廠牌車種」= order_items.vehicle_snapshot 逐品項直出、formatOrderItemVehicle 顯示
//    (dict 年 品牌 車型 / free 年 raw);未帶車款/佔位列 → 「—」。純顯示無價/tier 面。

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap align-top';

/**
 * 金額欄要不要合併成整單總額(母 plan §5.1a 逐字)。
 *
 * 🔴 **條件是「品項列 >1 **或** 任一列 `quantity` >1」,兩條缺一不可**:
 * 只寫 `quantity > 1` 那半條會讓**多品項單看不到整單總額**(母 plan 該列自陳這是 v1 的錯);
 * 只寫 `lines.length > 1` 則會讓「單品項但買 3 件」的單顯示成單價脈絡。
 *
 * 🔴🔴 **已知語意落差,照母 plan 字面實作、不自行改規格(R1 code-reviewer 抓到)**:
 * 合併態顯示 `order.total`,而 `total = subtotal + shippingFee − discountTotal`
 * (`packages/domain/src/order/types.ts:131` 逐字);非合併態顯示該列 `lineTotal`,**不含運費與折扣**。
 * ⇒ 單品項且買 1 件的單只要有運費,同一個「金額」欄在不同單之間的**語意就不一樣**
 * (一邊是品項的錢、一邊是訂單的錢)。母 plan §5.1a 只規定了「什麼時候顯示整單總額」,
 * 沒規定非合併態顯示什麼 ⇒ 這是規格缺口,已交棒為決策題。
 *
 * 🏁 **Sean 2026-08-06 拍 B:維持現狀、兩種語意並存=知情接受**(E-115-A)。
 * ⇒ **這不是 bug,勿順手「統一」** —— 要統一得先重拍(改哪一邊、含不含運費/折扣都會動到肉眼驗基準)。
 */
function shouldMergeAmount(order: AdminOrderSummary): boolean {
  return order.lines.length > 1 || order.lines.some((l) => l.quantity > 1);
}

/**
 * 付款軸膠囊 class(A11b S4:桌機與卡片**共用本支**,不各自拼字串 —— 兩份 markup
 * 拿到的 class 字串因此結構上保證相等,不是靠肉眼對照兩處常數維持一致)。
 */
function paymentCapsuleClass(status: AdminOrderSummary['paymentStatus']): string {
  return `${STATUS_CAPSULE} ${PAYMENT_STATUS_CAPSULE[status]}`;
}

function OrderGroup({ order }: { order: AdminOrderSummary }) {
  const cancelled = order.cancelledAt !== null;
  // 品項展開;空陣列(理論不發生,create_order 保證 ≥1 line)→ 兜一列 null 佔位、顯示「—」。
  const rows = order.lines.length > 0 ? order.lines : [null];
  const rowSpan = rows.length;
  const mergeAmount = shouldMergeAmount(order);

  return (
    <tbody>
      {rows.map((line, i) => (
        <tr
          key={line ? line.id : 'empty'}
          className={i === 0 ? 'border-t' : 'border-t border-dashed'}
        >
          {i === 0 && (
            <td className={`${TD} align-top`} rowSpan={rowSpan}>
              {/* 2b-1:訂單層勾選。放 rowSpan 合併格 ⇒ **一訂單一個框**;
                  放品項列的話,一張三品項的訂單會冒出三個框。 */}
              <OrderShipCheckbox orderId={order.id} customerUserId={order.customerUserId} />
            </td>
          )}
          {i === 0 && (
            <td className={TD} rowSpan={rowSpan}>
              <Link href={`/orders/${order.id}`} className='font-medium hover:underline'>
                {order.displayId}
              </Link>
              {cancelled && (
                <span className='bg-destructive/10 text-destructive ml-2 inline-flex rounded-full px-2 py-0.5 text-xs'>
                  已取消
                </span>
              )}
              {/* A11a-2:付款軸小字。母 plan §5.1a 三軸落點**整句**逐字 = 「付款 = 訂單層(rowSpan
                  合併格內小字,『待付款』紅 = design token `--c-red`(#dc2626,`tokens.css:16`)」。
                  形狀同客戶格的等級小字、**不另立欄**。

                  🔴 **顏色刻意偏離該句字面,理由實查如下(鐵則 11:偏離要寫在字面上)**:
                  ① `--c-red` 是 **storefront** 的 token,`apps/admin/src/app/globals.css` 全檔無此顆;
                  ② 它現值已不是 #dc2626 —— `apps/storefront/src/styles/tokens.css:79` 逐字
                     `--c-red: #f26722`(D 線改成亮熔橘),母 plan 引的 `:16` 行號也已漂掉;
                  ③ admin 的網站 token 是 `--destructive`(`globals.css:27` → `:91 --color-destructive`)。
                  ⇒ 照該句的**用意**(用網站 token、不照抄外部 hex)走 admin 自己那顆,不把 `--c-red` 搬進來。

                  🏁 **A11b(2026-08-07)加色**:五態改膠囊,`refunded` / `partiallyRefunded` 不再與
                  `paid` 同灰(訊號塌陷解除)。配色表 `PAYMENT_STATUS_CAPSULE`(`order-list-view.ts`),
                  桌機/卡片共用 `paymentCapsuleClass`,同輸入必同 class(S4 一致性)。 */}
              <div className='mt-1'>
                <span className={paymentCapsuleClass(order.paymentStatus)}>
                  {PAYMENT_STATUS_LABEL[order.paymentStatus]}
                </span>
              </div>
            </td>
          )}
          {/* Q2=A(07-16 晨拍板):日期欄(created_at 已在投影、訂單層 rowSpan)
              A11a-2:改接 `formatOrderListDate`(同年 `07/25`、跨年 `2025/06/27`)。
              ⚠️ 這曾是 admin `formatOrderDate` 的唯一 production 呼叫端;改接後那支歸零,
              已於 **A9c** 刪除(plan 說的「留給明細頁」是錯的:明細頁走 `formatOrderDateTime`)。 */}
          {i === 0 && (
            <td className={`${TD} text-muted-foreground text-xs`} rowSpan={rowSpan}>
              {formatOrderListDate(order.createdAt)}
            </td>
          )}
          <td className={TD}>{line?.brand ?? '—'}</td>
          <td className={`${TD} font-mono text-xs`}>{line?.variantSku ?? '—'}</td>
          <td className={TD}>{line?.title ?? '—'}</td>
          {/* V-3b:年份廠牌車種(order_items.vehicle_snapshot 直出;未帶車款/佔位列→「—」) */}
          <td className={`${TD} text-muted-foreground text-xs`}>
            {(line && formatOrderItemVehicle(line.vehicle)) || '—'}
          </td>
          <td className={`${TD} text-right tabular-nums`}>{line ? line.quantity : '—'}</td>
          {/* 金額:合併態 = 訂單層 rowSpan 顯示整單總額;非合併態 = 逐列顯示該列小計(見 shouldMergeAmount) */}
          {mergeAmount
            ? i === 0 && (
                <td className={`${TD} text-right tabular-nums`} rowSpan={rowSpan}>
                  NT$ {formatOrderAmount(order.total.amount)}
                </td>
              )
            : (
                <td className={`${TD} text-right tabular-nums`}>
                  {line ? `NT$ ${formatOrderAmount(line.lineTotal.amount)}` : '—'}
                </td>
              )}
          {/* 客戶:名字 + 會員等級小字(A11a-1 起等級不再單獨成欄) */}
          {i === 0 && (
            <td className={TD} rowSpan={rowSpan}>
              {order.customerName ?? '—'}
              <div className='text-muted-foreground text-xs'>
                {MEMBER_TIER_LABEL[order.tierAtCheckout]}
              </div>
            </td>
          )}
          {/* 訂貨(A11a-4 純文字 → A11b 加膠囊上色):**品項層**、逐列顯示 `已訂/買了`。`n/m` 那一段
              與明細頁 `ItemAxisCell` 同源;明細那格另有「訂貨」標籤、到貨列與已取消列,列表只取分數本身。
              🏁 A11b:三段完成度配色(灰/琥珀/綠)由 `orderedCapsuleClass` 算,佔位列(`line` 為 null)
              維持純文字「—」、不套膠囊(它不是一個可辨識的完成度)。
              🔴 **UI 端零 `?? 0`、零 join**(V9):`quantitySummary` 是 A9c 已正規化的**非 nullable** 型別,
              缺列補 0 的責任在 adapter mapper。這裡拿到 nullable 就是 A9c 沒做完,退回去、不要在這補。
              ⚠️ 代價(A9c commit body 與型別 docstring 已記):列表補 0 之後「資料損壞」與「真的還沒訂」
              長得一樣;明細頁那格才會顯示「數量資料尚未就緒」。**取消入口(A13)不得吃本欄。** */}
          <td className={TD}>
            {line ? (
              <span
                className={`${orderedCapsuleClass(line.quantitySummary.orderedQuantity, line.quantitySummary.quantity)} tabular-nums`}
              >
                {line.quantitySummary.orderedQuantity}/{line.quantitySummary.quantity}
              </span>
            ) : (
              '—'
            )}
          </td>
          {/* 發票(A11a-5):**訂單層** rowSpan(開票是整單的事,不是逐品項)。
              🔴 字面**複用** `INVOICE_STATUS_LABEL` —— 明細頁的「開立狀態」欄用的是同一份。
              不另抄一份三態中文:兩份字面必然漂,而 V11 要的正是「三態各自可辨識、且 `voided`
              不與 `not_issued` 同字面」,共用一個 `Record<InvoiceStatus, string>` 讓它**結構上**成立。
              (A11a-5 把該常數從 `order-detail-view.ts` **搬到** `order-list-view.ts` —— 前者檔頭
              逐字宣告「列表共用標籤仍在 order-list-view.ts、本檔不重定義」,照那條慣例搬。)
              🔴 **Q2b=A:不顯示載具別** —— 載具別在 `orders.invoice` jsonb,A9c 刻意沒放進列表投影
              (零 PII 邊界)⇒ 這裡連拿都拿不到,不是「有資料但選擇不畫」。 */}
          {i === 0 && (
            <td className={`${TD} text-xs`} rowSpan={rowSpan}>
              {INVOICE_STATUS_LABEL[order.invoiceStatus]}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  );
}

/**
 * A11c 手機卡片:**一張訂單一張卡**(不是一個品項一張卡)。
 *
 * 🔴 為什麼單位是訂單:§4-1 說「主要欄位加粗置頂」⇒ 主標 = 訂單編號。一品項一張卡的話,
 *    3 品項的單會把單號 / 日期 / 客戶**重複三次**,比它要取代的橫捲表更糟。
 *    ⇒ 卡片本身也是**兩層**(卡頭 = 訂單層、卡內清單 = 品項層),與桌機 rowSpan 是同一個
 *    資訊結構的兩種畫法 —— 這正是接不上扁平 `AdminDataTable` 的原因。
 *
 * 槽位分法 = Sean 2026-08-06 拍 A(plan §4.1)。
 */
function OrderCard({ order }: { order: AdminOrderSummary }) {
  const cancelled = order.cancelledAt !== null;
  // 與桌機同一條:空 lines(理論不發生)→ 兜一列 null 佔位、顯示「—」。
  const lines = order.lines.length > 0 ? order.lines : [null];
  // 🔴 **共用** shouldMergeAmount,不在卡片重寫一份金額規則 —— 那條有 Sean `E-115-A` 拍板的
  //    語意落差(合併態=訂單的錢、非合併態=品項的錢),兩份實作必然漂。
  const mergeAmount = shouldMergeAmount(order);

  return (
    <li className='p-3'>
      {/* 第一行:主標(單號)+ 靠右(金額 / 發票)—— §4-1「主要欄位加粗置頂、金額/狀態靠右」 */}
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-2 font-medium'>
          {/* 🔴 2b-1:手機這份**必須跟桌機一起加**。只改桌機的話,手機上根本沒得勾,
              而桌機測試全綠 —— Sean 常用手機看後台。守門兩處都釘。 */}
          <span className='pt-0.5'>
            <OrderShipCheckbox orderId={order.id} customerUserId={order.customerUserId} />
          </span>
          <Link href={`/orders/${order.id}`} className='hover:underline'>
            {order.displayId}
          </Link>
          {cancelled && (
            <span className='bg-destructive/10 text-destructive ml-2 inline-flex rounded-full px-2 py-0.5 text-xs'>
              已取消
            </span>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2 text-right text-sm'>
          {mergeAmount && (
            <span className='tabular-nums'>NT$ {formatOrderAmount(order.total.amount)}</span>
          )}
          <span className='text-muted-foreground text-xs'>
            {INVOICE_STATUS_LABEL[order.invoiceStatus]}
          </span>
        </div>
      </div>

      {/* 副行:訂單層的其餘欄(桌機用 rowSpan 合併的那幾格) */}
      <div className='text-muted-foreground mt-1 text-sm'>
        {formatOrderListDate(order.createdAt)}
        <span className='px-1.5'>·</span>
        {order.customerName ?? '—'}
        <span className='px-1.5'>·</span>
        {MEMBER_TIER_LABEL[order.tierAtCheckout]}
        <span className='px-1.5'>·</span>
        {/* 付款軸(A11b):與桌機同一支 `paymentCapsuleClass`,五態膠囊上色、訊號塌陷解除。 */}
        <span className={paymentCapsuleClass(order.paymentStatus)}>
          {PAYMENT_STATUS_LABEL[order.paymentStatus]}
        </span>
      </div>

      {/* 卡內:品項層逐列 */}
      <ul className='mt-2 space-y-2 border-t pt-2'>
        {lines.map((line) => {
          // 料號之外的次要欄:缺值就整段不出現(同 `admin-data-table.tsx:52-61` joinNodes 的語意)
          const rest = [line?.brand, line ? formatOrderItemVehicle(line.vehicle) : null].filter(
            (v): v is string => typeof v === 'string' && v !== '',
          );
          return (
            <li key={line ? line.id : 'empty'} className='text-sm'>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 font-medium'>{line?.title ?? '—'}</div>
                {!mergeAmount && (
                  <div className='shrink-0 tabular-nums'>
                    {line ? `NT$ ${formatOrderAmount(line.lineTotal.amount)}` : '—'}
                  </div>
                )}
              </div>
              <div className='text-muted-foreground text-xs break-all'>
                <span className='font-mono'>{line?.variantSku ?? '—'}</span>
                {rest.length > 0 && <span className='px-1.5'>·</span>}
                {rest.join(' · ')}
              </div>
              <div className='text-muted-foreground text-xs tabular-nums'>
                數量 {line ? line.quantity : '—'}
                <span className='px-1.5'>·</span>
                訂貨{' '}
                {/* A11b:與桌機同一支 `orderedCapsuleClass`,佔位列維持純文字「—」。 */}
                {line ? (
                  <span
                    className={`${orderedCapsuleClass(line.quantitySummary.orderedQuantity, line.quantitySummary.quantity)} tabular-nums`}
                  >
                    {line.quantitySummary.orderedQuantity}/{line.quantitySummary.quantity}
                  </span>
                ) : (
                  '—'
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export function OrdersTable({ orders }: { orders: AdminOrderSummary[] }) {
  if (orders.length === 0) {
    // 空狀態**只有一份 markup**,桌機手機共用(不複製第二份)。
    return (
      <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
        目前沒有符合條件的訂單。
      </div>
    );
  }

  return (
    <>
      {/* 桌機(md 以上):既有表格**逐字元未動**,只在外框 class 加 hidden md:block。 */}
      <div className='hidden overflow-x-auto rounded-lg border bg-card md:block'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            {/* 2b-1:勾選欄(訂單層)。**刻意沒有全選框** —— 全選必然跨客人,而跨客人裝同一箱
                一定被 DB 退件;不提供一個「按了一定失敗」的按鈕。 */}
            <th className={`${TH} w-8`} aria-label='選取' />
            {/* Q6=A(Sean 2026-08-06):欄名改短字面 —— 商品品牌→品牌、物品名稱→品名、客戶名稱→客戶。 */}
            <th className={TH}>訂單編號</th>
            <th className={TH}>日期</th>
            <th className={TH}>品牌</th>
            <th className={TH}>料號</th>
            <th className={TH}>品名</th>
            <th className={TH}>年份廠牌車種</th>
            <th className={`${TH} text-right`}>數量</th>
            <th className={`${TH} text-right`}>金額</th>
            <th className={TH}>客戶</th>
            {/* A11a-4:訂貨欄(品項層)。plan §1.2 目標欄序 = …客戶 / **訂貨** / 出貨 / 發票 / 操作 */}
            <th className={TH}>訂貨</th>
            {/* A11a-5:發票欄(訂單層)。出貨欄(A11a-6)前置在第 2 批,故本表暫時是訂貨→發票相鄰。 */}
            <th className={TH}>發票</th>
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup key={order.id} order={order} />
        ))}
      </table>
      </div>

      {/* 手機(md 以下):卡片。§4-1「一律轉卡片,不做橫向捲動表格」。 */}
      <ul className='divide-y rounded-lg border bg-card md:hidden'>
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </ul>
    </>
  );
}
