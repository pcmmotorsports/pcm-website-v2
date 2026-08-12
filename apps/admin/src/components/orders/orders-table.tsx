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
//    (2026-08-12:操作欄由 A13 落地 ⇒ **現為 13 欄**;四欄裡只剩**出貨欄 A11a-6 仍缺席**。)
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
//    🔴 **2026-08-12 更新:A13 操作欄已落地,而到期日「還沒到」—— 那是刻意繞開的,不是解決了。**
//    做法 = 那一欄**只放連結**(`…#cancel`,零 client 狀態)⇒ 重複的只是一個 `<a>`,
//    沒有重複表單、沒有重複 state,上面那句話描述的情形因此沒有發生。
//    ⚠️ **代價照收**:那一欄的每一條紀律都要寫兩遍(`relative z-10` / 已取消不給入口 /
//    目的地各自沿用同槽),靠 `orders-table.test.tsx` 的 A13 那組 + `shipping-selection.test.tsx`
//    的 z-10 分類格兩邊各釘一次才擋得住。
//    ⇒ **下一個帶互動控件的欄位(按鈕/表單)才是真正的到期日**,那時這段話原封成立。
//    重構本身已立案 = **backlog #447**(含鐵則 6 的拆檔:拆檔就是在決定兩份 markup 怎麼切)。
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

function OrderGroup({
  order,
  buildPanelHref,
}: {
  order: AdminOrderSummary;
  buildPanelHref: (orderId: string) => string;
}) {
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
          // 🔴 2026-08-09 Sean 實測要求「整列可點進詳情」。做法是 **stretched link**:
          //    列設 `relative`,單號那個 <Link> 用 `after:absolute after:inset-0` 把命中區撐滿整列。
          //    **零 JS、表格本體維持 server component**,而且它是**真的連結** ——
          //    鍵盤 Tab、中鍵開新分頁、右鍵複製網址都正常(用 onClick 做這些全都沒有)。
          //    勾選格另外設 `relative z-10` 浮在覆蓋層上面 ⇒ 點勾選不會誤觸進詳情。
          className={`hover:bg-muted/40 relative ${i === 0 ? 'border-t' : 'border-t border-dashed'}`}
        >
          {i === 0 && (
            <td className={`${TD} relative z-10 align-top`} rowSpan={rowSpan}>
              {/* 2b-1:訂單層勾選。放 rowSpan 合併格 ⇒ **一訂單一個框**;
                  放品項列的話,一張三品項的訂單會冒出三個框。
                  🔴 `relative z-10` 是承重的:整列被 stretched link 的覆蓋層蓋住,
                  沒有它就**點不到勾選框**(會變成點哪裡都進詳情)。 */}
              <OrderShipCheckbox orderId={order.id} customerUserId={order.customerUserId} />
            </td>
          )}
          {i === 0 && (
            <td className={TD} rowSpan={rowSpan}>
              {/* #350c:桌機改開右側面板(`/orders?…&panel=<id>`)。
                  🔴 仍然是**真的 `<Link href>`**,不是 onClick ⇒ 上面那段註解講的
                  「零 JS、鍵盤 Tab、中鍵開新分頁、右鍵複製網址」**一條都沒有失去**
                  —— 新分頁開的是帶面板的列表頁,不是詳情整頁,但仍是可分享的網址。 */}
              <Link
                href={buildPanelHref(order.id)}
                className='font-medium after:absolute after:inset-0 hover:underline'
              >
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
          {/* A13 操作欄(**訂單層** rowSpan:取消是整單的入口,不是逐品項 —— 放品項列的話
              一張三品項的單會冒出三個「取消」,同勾選格那條教訓)。
              🔴🔴 **`relative z-10` 是承重的,不是排版**:整列被單號那個 stretched link 的
              覆蓋層蓋滿(`:123-127`),沒有它這顆連結**點不到** —— 而且點下去畫面**確實有反應**
              (整列連結把人帶進面板),看起來像「功能好了」⇒ 這種錯不會被肉眼驗抓到,
              守門釘在 `orders-table.test.tsx`(拿掉 z-10 就紅)。
              🔴 **目的地刻意與同槽的單號連結一致**(桌機=面板 `buildPanelHref`,手機=整頁)——
              兩槽本來就不同(`:145` vs `:284`,#350c 的動線決定),**不要為了「一致性」統一它**。
              🔴 已取消的單顯示「—」:這只是「明顯不該出現時不出現」,**不是權威閘** ——
              能不能取消由明細端 `buildOrderCancelView` / `cancelFormsAllowed` 判(fail-closed),
              這裡不重算一份(重算一份就會漂;同 `order-cancel-block.tsx` 檔頭紀律)。 */}
          {i === 0 && (
            <td className={`${TD} relative z-10 text-xs`} rowSpan={rowSpan}>
              {cancelled ? (
                <span className='text-muted-foreground'>—</span>
              ) : (
                <Link href={`${buildPanelHref(order.id)}#cancel`} className='hover:underline'>
                  取消
                </Link>
              )}
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

  // 🔴 手機卡片**必須跟桌機一起做**(2b-1 那次的教訓:只改一邊、另一邊全綠)。
  //    註解放 `return` 外面 —— 放進 JSX 子節點位置的 `//` 會被當成文字渲染出來。
  return (
    <li className='hover:bg-muted/40 relative p-3'>
      {/* 第一行:主標(單號)+ 靠右(金額 / 發票)—— §4-1「主要欄位加粗置頂、金額/狀態靠右」 */}
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-2 font-medium'>
          {/* 🔴 2b-1:手機這份**必須跟桌機一起加**。只改桌機的話,手機上根本沒得勾,
              而桌機測試全綠 —— Sean 常用手機看後台。守門兩處都釘。 */}
          {/* 🔴 `relative z-10`:同桌機,沒有它勾選框會被整卡的 stretched link 蓋住。 */}
          <span className='relative z-10 pt-0.5'>
            <OrderShipCheckbox orderId={order.id} customerUserId={order.customerUserId} />
          </span>
          <Link
            href={`/orders/${order.id}`}
            className='after:absolute after:inset-0 hover:underline'
          >
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
          {/* A13 操作欄的手機版:桌機是一欄,手機放靠右槽**一次**(§4-1「金額/狀態靠右」)。
              🔴 **必須跟桌機一起加**(2b-1 那次的教訓逐字寫在 `:277-279`:只改桌機的話
              手機上根本沒得按、而桌機測試全綠;Sean 常用手機看後台)。
              🔴 `relative z-10` 同勾選格:沒有它會被整卡的 stretched link 蓋住(`:283`)。
              🔴 目的地 = `/orders/<id>#cancel`(**整頁**版),與同卡單號連結同槽同去處;
              桌機那槽走面板 —— 兩槽不同是 #350c 的動線決定,不要統一。 */}
          {!cancelled && (
            <Link
              href={`/orders/${order.id}#cancel`}
              className='relative z-10 shrink-0 text-xs hover:underline'
            >
              取消
            </Link>
          )}
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

export function OrdersTable({
  orders,
  buildPanelHref,
}: {
  orders: AdminOrderSummary[];
  /**
   * #350c:桌機單號連結要導去哪(= `/orders?…&panel=<id>`,開右側面板)。
   *
   * 🔴 **由呼叫端注入、不在本檔拼字串**:面板連結必須帶著當下的篩選與頁碼一起走
   * (`order-list-view.ts` 的 `buildOrderListHref` 是唯一落點),否則點開一張單就把篩選洗掉。
   * 🔴 **手機卡片不吃這個 prop**(主視窗 2026-08-10 裁③、Q5):小螢幕沒有分割空間,
   * 照舊整頁進 `/orders/[id]`。守門把「桌機走注入 href、手機仍是字面路徑」兩邊釘住。
   */
  buildPanelHref: (orderId: string) => string;
}) {
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
            {/* A13(訂單列表操作欄):plan `2026-08-06-e10-a11a-list-rebuild-plan.md:108` 第 13 欄。
                🔴 **與 backlog #372 的 OP-A13(沖銷入口)是兩件事**,別靠字面認親。 */}
            <th className={TH}>操作</th>
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup key={order.id} order={order} buildPanelHref={buildPanelHref} />
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
