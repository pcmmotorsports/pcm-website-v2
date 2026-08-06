import Link from 'next/link';
import type { AdminOrderSummary } from '@pcm/domain';
import {
  MEMBER_TIER_LABEL,
  PAYMENT_STATUS_LABEL,
  formatOrderAmount,
  formatOrderItemVehicle,
  formatOrderListDate,
} from '../../lib/orders/order-list-view';

// M-4a Slice D-1a 訂單列表(server-render;每商品一列、同單分組)。
// 需求(Sean):一張訂單多商品 → 拆多列(各商品到貨時間不同、要個別看);同單分組 = 訂單層欄
//   (單號 / 日期 / 客戶)以 rowSpan 合併、品項層欄(品牌 / 料號 / 品名 / 車種 / 數量)逐列。
//
// 🔴 **M-4b E10 A11a-1(2026-08-06;plan `docs/specs/2026-08-06-e10-a11a-list-rebuild-plan.md`、
//    Sean 十題全拍 A)**:九碼三群(整單彙總 badge / per-item 狀態 cell / 表層 props 與衍生)已下架,
//    這是**列表側最後一個九碼消費端**。同批移除「來源 · 管道」欄(母 plan §5.1a:明細頁已有、
//    不是每天要看的資訊)、單價與總金額合併為「金額」、會員等級併入客戶格小字。
//    ⇒ 現為 **9 欄**;訂貨 / 出貨 / 發票 / 操作四欄依 plan 分屬 A11a-4/-6/-5 與 A13,本片不預埋。
//
// 🔴 **A11a-2(2026-08-06)**:付款軸小字進訂單編號格、日期改接 `formatOrderListDate`
//    (同年 `07/25` / 跨年 `2025/06/27`)。**兩者都塞進既有格、欄數仍是 9**(plan `:480` 逐字)。
//
// 🔴 鐵則 12:金額 + 會員等級同列 = 經銷價脈絡,全 server-render → 敏感值不序列化進 client bundle;
//    SSO 閘後 admin-only。**本片拆掉唯一的 client 元件(狀態欄下拉)後,本檔已無任何 client 邊界。**
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

                  🔴 只有 `unpaid` 上紅是照真權威字面(它只點名「待付款」)。`refunded` / `partiallyRefunded`
                  目前與 `paid` 同灰 = **訊號塌陷**,已列交棒決策題、不在本片自行加色。 */}
              <div
                className={`text-xs ${order.paymentStatus === 'unpaid' ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {PAYMENT_STATUS_LABEL[order.paymentStatus]}
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
        </tr>
      ))}
    </tbody>
  );
}

export function OrdersTable({ orders }: { orders: AdminOrderSummary[] }) {
  if (orders.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
        目前沒有符合條件的訂單。
      </div>
    );
  }

  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
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
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup key={order.id} order={order} />
        ))}
      </table>
    </div>
  );
}
