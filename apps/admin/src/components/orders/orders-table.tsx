import Link from 'next/link';
import type { ReactNode } from 'react';
import { OrderShipCheckbox } from './shipping-selection';
import { OrdersCutoffNotice } from './orders-cutoff-notice';
import type { AdminOrderSummary } from '@pcm/domain';
import {
  formatOrderPayColumn,
  orderPayActionable,
  orderPayAmbiguous,
  INVOICE_STATUS_LABEL,
  MEMBER_TIER_LABEL,
  ORDER_DENSITY_DEFAULT,
  ORDER_SOURCE_LABEL,
  formatOrderAmount,
  formatOrderItemVehicle,
  formatOrderListDate,
  type OrderDensity,
} from '../../lib/orders/order-list-view';
// L3 片1:狀態八值的字面與配色**全部**由 L1(`f745e04e`)那支純函式算,本檔不自己拼 class。
import { orderNextStep, orderStatusView } from '../../lib/orders/order-status-axes';
import type { NextStepDo } from '../../lib/orders/order-return-to';

// M-4a Slice D-1a 訂單列表(server-render;每商品一列、同單分組)。
// 需求(Sean):一張訂單多商品 → 拆多列(各商品到貨時間不同、要個別看);同單分組 = 訂單層欄
//   (單號 / 日期 / 客戶)只在該單的第一列出值、其餘列留空格,靠 `<tbody>` 分組。
//
// 🔴🔴 **2026-08-13 L2(backlog #447)—— 雙 markup 已收斂成一份,本檔結構因此變了兩件事。**
//    交辦 = OD 訂單列表改版 E 窗(主視窗 `MAIN-901-A-E`;視覺真權威 = OD project
//    `pcm-admin-order-ui` 的 `overview-desktop.html`)。以下兩條是**刻意的**,不是重構失手:
//
//    **(1) `OrderCard`(手機卡片版)整支刪除。** 桌機表格與手機卡片不再各渲染一次 cell ——
//    現在只有一份 `<table>`,手機由 CSS 把同一份 DOM 攤成卡片
//    (`app/globals.css` 的 `.orders-grid` 區塊)。
//    ⇒ 「每加一欄要寫兩遍」那個到期日(收斂前本檔 `:49-61` 的警告)**到此結清**。
//
//    **(2) `rowSpan` 全數拆除。** 訂單層欄改成「只有該單第一列出值、其餘列渲染空 `<td>`」。
//    🔴 **這不是順手改的,是收斂的必要條件**:`rowSpan` 是 `<table>` 專屬的跨列合併,
//    一旦 `<tr>` 在手機被 `display:flex` 攤成縱向卡片,合併格的語意**不存在**
//    (實查:OD 那份成品 `grep -ic rowspan overview-desktop.html` = 0,本檔收斂前 = 19)。
//    ⇒ 桌機視覺代價:合併格 → 空格 + `tbody` 分組線。**這是 Sean 肉眼看得到的改變**,
//    故本片自成一顆 commit(回退面獨立)、交件附「收斂前/收斂後」1440 全寬截圖對比。
//
//    ⚠️ **空格必須是真的空**(`<td className={…} />`,不是 `<td> </td>`):手機那份 CSS 靠
//    `td:empty{display:none}` 把訂單層欄從第二列之後藏掉,一個空白字元就會讓它失效、
//    卡片裡冒出一排空標籤。守門釘在 `orders-table.test.tsx`。
//
// 🔴 **本片刻意不動的兩件**(範圍 = 主視窗定的「L2 欄位不動」):
//    ① **欄集合與欄序原封不動**(13 欄)。欄序重排 / 單價欄 / 狀態八值欄、以及
//       **訂貨欄與付款膠囊下架**(Sean 2026-08-13 拍 Q2=A:狀態欄獨扛)全屬 **L3**。
//       ⇒ 本檔現存的訂貨欄與付款膠囊是**已知將被 L3 移除的過渡態**,不是本片的主張。
//    ② **斷點機制維持視窗 `md`(CSS 寫 range 語法 `width < 48rem`),沒有換成 container query。**
//       🔴 用 `rem` 是承重的(code-reviewer M2):Tailwind 的 `md` = **`48rem`**,
//       只有 root font-size = 16px 時才等於 768px。使用者調瀏覽器字級(標準無障礙操作)之後
//       兩者會分家 ⇒ 出現「卡片模式 + 桌機面板連結」的錯配。OD 那份用的是
//       `container-type:inline-size` + 900/520 兩段,但那組斷點是**欄位收起規則**的載體(L3 的事);
//       本片若一併換掉,「面板開著時列表寬度掉到 520 以下」會讓桌機也變卡片
//       ⇒ **就不再能宣稱「桌機視覺與收斂前一致」**,而那正是本片唯一的驗收條件。
//       ⇒ container query 留給 L3 與欄寬一起換。
//
// 🔴 **A11a 系列既有紀律(仍然成立,只是換了載體)**:
//    A11a-1 九碼三群下架、來源·管道欄移除、單價與總金額合併為「金額」、會員等級併入客戶格小字;
//    A11a-2 付款軸小字進訂單編號格、日期接 `formatOrderListDate`;
//    A11a-4 訂貨欄(品項層 `n/m`);A11a-5 發票欄(訂單層,Q2b=A 不顯示載具別);
//    A11b 付款軸與訂貨軸膠囊上色;A13 操作欄(取消入口)。
//
// 🔴 鐵則 12:金額 + 會員等級同列 = 經銷價脈絡,全 server-render → 敏感值不序列化進 client bundle;
//    SSO 閘後 admin-only。本檔唯一的 client 邊界是 `<OrderShipCheckbox>` island
//    (`shipping-selection.tsx`),它的 props **只有 `orderId` / `customerUserId` 兩個純量**,
//    `AdminOrderSummary` 整包(帶 `total` 金額與 `tierAtCheckout` 會員等級)**絕不進 client props**
//    —— 否則那兩個敏感值會被序列化進 RSC payload。⚠️ **使用者看不到 ≠ 沒送出去**(payload 在
//    network 面板是純文字)。這條由 `shipping-selection.test.tsx` 的守門釘住,不是只寫在這段註解。
// V-3b:「年份廠牌車種」= order_items.vehicle_snapshot 逐品項直出、formatOrderItemVehicle 顯示
//    (dict 年 品牌 車型 / free 年 raw);未帶車款/佔位列 → 「—」。純顯示無價/tier 面。

/* ⛔ **操作欄(A13 / `#486` 的 ⋯ 鈕)2026-09-13 整欄退場,DOM 一起拿掉。**
   它 FIX-34 之後就是 `display:none`(員工是整列點進去的),`OPS_LINK_GLYPH` / `OPS_LINK_LABEL` 與那兩槽的
   `#cancel` 連結是死碼;取消入口住在展開區(`OrderDetailRoute` 的 `order-cancel-block`)。
   📌 `#486` 那段「為什麼不是彈出選單」的 hit test 紀錄(3/3 點不到、零 JS `<details>` 證偽)留在 git:
   `git show 822df305d:apps/admin/src/components/orders/orders-table.tsx` 第 74-102 行。 */

/* 🔴 **表頭字體(片3)—— 搬 OD `overview-desktop-bmw-m.html:167`,但【三件只搬得動兩件】。**
   OD 原規則 = `font-size:var(--text-xs); font-weight:700; letter-spacing:1.5px; text-transform:uppercase`。
     ✅ **搬了**:`font-weight:700`(`font-medium` → `font-bold`)、`letter-spacing:1.5px`(`tracking-[1.5px]`)。
     🔴 **沒搬 `uppercase`,而且【不能】把它寫上去充數** —— 13 個表頭**全是中文**
        (單號/日期/車種/廠牌/料號/物品名稱/數量/單價/金額/客戶/狀態/發票/操作),
        **`uppercase` 對 CJK 是 no-op**:寫上去畫面一個像素都不會變,
        但檔案裡會留下一行「已照 OD 做大寫」的字面,而下一個人會相信它。
        ⇒ **「宣稱 ≠ 能力」的又一個形狀,只是這次代價是零視覺、純誤導。**
   ⚠️ **`letter-spacing` 在 CJK 上的意思與拉丁不同**(拉丁=字母間距、CJK=字距):
      1.5px 在 12px 中文上會把字明顯拉開。**值是照抄 OD 的,不是我挑的**,
      但它是**看得出來的改動** ⇒ 已列進「要請 Sean 肉眼看」的項目。
   ⚠️ 顏色**沒動**:OD 用 `var(--fg-2)`(#334155),我方沒有這顆 token;
      補它會連帶改到 `td` 內文色(OD `:171` 也吃它)= 整張表的文字色 ⇒ **超出本片,沒做。** */
/* 🔴 **片5:`text-muted-foreground` 拿掉,改吃容器繼承的 `--fg-2`**(OD `:167` 的 `th` 就是它)。
   舊值 `--muted-foreground`(#606e85)比 OD 淡;`--fg-2`(#334155)對卡片 10.35、對 hover 底 9.28。
   ⚠️ **是「拿掉」不是「換成 `text-fg-2`」** —— 理由寫在 `globals.css` 的 `.orders-grid` 那段:
      同特異性的 utility 對撞由編譯順序決定,而繼承沒有這個問題。 */
/* 🔴🔴 **下面這兩串裡有幾個 utility 是【死的】—— `.orders-grid` 的 CSS 蓋過它們。**
   一個要算欄寬 / 算列高 / 算字級的人,最可能就是從這兩行讀值,然後算出一張對不上的表。
   **我(線 E)2026-08-22 就是這樣算錯的**:我從 `px-3` 讀到 24px,真值是 16。

   | 這裡寫的 | 實際生效 | 誰蓋的(全在 `apps/admin/src/app/globals.css`) |
   |---|---|---|
   | `px-3`(24) | **16**(左右各 8) | `.orders-grid th,td { padding-left/right: .5rem }` |
   | `py-2`(8) | **0**(列高改吃 `--od-row-h`) | `.orders-grid th,td { padding-top/bottom: 0 }` |
   | `text-sm`(TD) | **`--od-fs`**(密度三檔) | `.orders-grid th,td { font-size: var(--od-fs) }` |
   | `text-xs`(TH) | **`--od-fs-sm`** | `.orders-grid th.text-xs`(這條是**刻意接手**,不是被蓋掉) |
   | `align-top` | top,**但 `col-status` 是 middle** | `.orders-grid td.col-status { vertical-align: middle }` |
   | `px-3` 在 `col-ops` | **2px**,不是 8 | `.orders-grid td.col-ops,th.col-ops { padding: .125rem }` |

   ✅ **仍然生效的**:`text-left`、`font-bold`、`tracking-[1.5px]`、`whitespace-nowrap`
      (desktop 那幾條 CSS 沒有設這些屬性;卡片模式 `@container (max-width:520px)` 才另外設)。

   ⚠️ **上表是【讀 CSS + 特異性規則推出來的】,不是在真瀏覽器量到的 computed style。**
      (量測用的測試機當時「共 0 筆」,連 `<th>` 都沒渲染。)⇒ 真 DOM 一有資料就要對帳一次。
   ⚠️ 判別句:**要拿這裡的值去算東西之前,先去 `globals.css` grep `.orders-grid th`。** */
const TH = 'px-3 py-2 text-left text-xs font-bold tracking-[1.5px] whitespace-nowrap';
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
 *
 * 🔴🔴 **`itemsTruncated` 為什麼是第一個判準**(2026-08-18 A 窗,收 codex must-fix `§7:268`)
 *
 * **這個函式是「由半份資料決定要印哪一種語意」的分支** —— 而它讀的 `order.lines`
 * 在 `itemsTruncated` 時**本身就是半份的**(`ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT = 500`,
 * `mappers/order.ts:428`)。壞世界:截斷後只剩 1 列且該列 `quantity === 1`
 * ⇒ 舊式翻 `false` ⇒ **同一張單,資料載全與沒載全,那一欄印的是兩個【不同語意】的數字**
 * (整單的錢 vs 品項的錢)。而 Sean 已知情接受兩種語意並存 ⇒ **畫面上沒有任何差別可看。**
 *
 * 🔴 **這是套用既有拍板 `Q-EMBED-2`(2026-08-16 Sean 拍甲:資料不完整就不要印算出來的值),
 *    不是新規格** —— 與狀態欄印「未知」、與「共 N 筆」那條同一條線。**不需要新拍板。**
 *
 * ⚠️ **今天的實際影響面 = 零,而這【不是】不做它的理由**:
 *    今天截斷恆發生在 500 ⇒ `lines.length > 1` 恆真 ⇒ 舊式今天到不了危險的那一半。
 *    (實測佐證:加上這一行之後,本檔既有 86 格**一格都沒紅**。)
 *    🔴 **但那個安全條件是「截斷上限 > 1」,而它從來沒有被寫下來過。**
 *    同一支 mapper 的註解自己留了口子(`order.ts:425-426` 逐字):
 *    「若專案 `max-rows` 日後被設到低於本值,截斷會發生在那個更低的數字上而**本判定看不見**」
 *    ⇒ **現在這一行讓那個依賴消失,而不是讓它繼續隱形。**
 *    ⚠️ 原 plan `§7` 以「今天構造不出來」豁免這條;codex 判 must-fix:**fixture 明明構造得出來**。
 *    守門在 `orders-table.test.tsx`(那組雙向格)。
 */
function shouldMergeAmount(order: AdminOrderSummary): boolean {
  return order.itemsTruncated || order.lines.length > 1 || order.lines.some((l) => l.quantity > 1);
}

/**
 * 手機卡片模式的欄位排序與標籤,由 `<td>` 上的 `col-*` class 與 `data-l` 承載
 * (CSS 在 `app/globals.css` 的 `.orders-grid` 區塊)。
 *
 * 🔴 `data-l` **只給手機卡片用** —— 桌機有表頭,再印一次欄名是雜訊。
 *    沒有 `data-l` 的格(勾選 / 單號 / 品名 / 操作)在卡片上是主標或純控件,不掛標籤;
 *    CSS 用 `td:not([data-l])::before{display:none}` 讓它們不長出標籤欄。
 */
/**
 * `#631` 甲:訂單列表每張單**最多畫前 3 個品項**,其餘收成一列「另有 …,點進去看」。
 *
 * 🔴 **來源是 Sean 2026-08-18 拍板逐字「訂單列表【最多顯示前 3 項 + 『另有 N 項，點進去看』】」** ——
 *    而我(W7)**沒有看到他的原始訊息**:W4 與主視窗**兩條獨立轉述路徑字面一致**,我依此動手。
 *    這個限定寫在這裡,不是寫在信裡 —— 信會被捲走,而下一個想改這個 3 的人會先看到這裡。
 * ⚠️ 這個數字**不是版面算出來的**(不是「3 列剛好塞得下」),是他挑的 ⇒ **要改它得再問他一次。**
 *
 * 🔴 **這句話的兩半,守門強度不一樣(誠實缺口,codex R1 逼出來的)**:
 *    · `orderStatusView` **有守門**:`orders-table.test.tsx` 的「前 3 列全出貨、第 4 列沒出貨」那格
 *      —— 把切過的 lines 餵給它會紅(實測突變一發:唯一紅那格就是它)。
 *      它守的是那個真病:`.every(...)` 在子集上會答「出貨完成」,而員工看到就不再動作。
 *    · `shouldMergeAmount` **守不了,而且是【構造不出反例】不是我懶**:
 *      它 = `itemsTruncated || lines.length > 1 || some(q > 1)`,
 *      而「有東西被收起來」⇒ 至少 4 列 ⇒ 切到 3 之後 `length > 1` 仍成立
 *      ⇒ **切與不切的輸出恆等**。實測:把 `slice` 餵給它,97 格**一格都沒紅**。
 *      ⇒ 這裡沒有守門格,不是漏做;要有反例得先把 `MAX_VISIBLE_LINES` 降到 1。
 */
const MAX_VISIBLE_LINES = 3;

/**
 * 🔴 `#475`(2026-08-18)起 **export**:卡片模式的縱向順序守門要拿它當**單一真相源**,
 * 而不是在測試檔裡硬寫一份 14 個字串的清單(硬寫的那份會與本表各自漂,而漂掉時不會紅)。
 * ⚠️ 只有測試在用這個 export;元件內用法一行沒變。
 */
export const CELL = {
  pick: 'col-pick',
  // 🔴 **`oid` 於 P3(2026-09-13)移除 —— 單號併進日期格,不再是一欄。**
  //    格子裡那行單號小字用 `oid-sub`(**刻意不以 `col-` 開頭**):
  //    `col-*` 是「這是一欄」的標記,而卡片模式的守門會掃 `\.col-[a-z]+` 要求每個都有 `order`
  //    ⇒ 留著 `col-` 前綴會讓一個**不是欄**的東西被當成欄來守。
  date: 'col-date',
  brand: 'col-brand',
  sku: 'col-sku',
  title: 'col-title',
  vehicle: 'col-vehicle',
  qty: 'col-qty',
  // 🆕 L3 片2:單價(品項層、成交價)。
  unit: 'col-unit',
  amount: 'col-amount',
  customer: 'col-customer',
  // L3 片1:`ordered`(訂貨,品項層)已下架,原槽換成 `status`(狀態八值,**訂單層**)。
  // 🔴 兩者的層級不同,不是換個名字 —— 訂貨是逐列各有值,狀態只在該單第一列出值。
  status: 'col-status',
  // 🆕 P4(稿 v19):來源(**訂單層** —— 一張單從哪來,不是逐品項)。
  //
  // 🔴🔴 **定案位置是【左塊第 4 格】(客戶之後、收款之前),不是這裡的位置。**
  //    真值 = 稿 v19 的 `ORDER=['ck','d','who','src','pay','veh','brand','sku','name','qty','unit','amt','stc','nx']`
  //    = 勾 · 日期 · 客戶 · **來源** · 收款 ‖ 車種 · 廠牌 · 料號 · 品名 · 數量 · 單價 · 金額 · 狀態 ‖ 下一步(14 格)。
  //    ⇒ **本片刻意不搬到那裡** —— 欄序統一由 P2 處理,這一輪只讓這一欄存在。
  //    📌 **不要照這一輪的位置以為那就是定案。**
  //
  // ⚠️⚠️ **我第一版把位置理由寫成「稿 v19 的表頭順序是 … 狀態 · 來源 · 下一步 · 客戶」,那是錯的。**
  //    那份稿的欄序是**載入時由 JS 重排**的(上面那個 `ORDER=`)⇒ 我解靜態 HTML 抓到的表頭
  //    是**重排的輸入**,不是輸出。🔴 **而它不會報錯** —— 它回一串真的表頭字面,
  //    看起來完整、而且一定會被相信。
  //    ⇒ **量那批 OD 稿一律用真瀏覽器**,或先 grep 有沒有 `ORDER=` 這種載入期重排;
  //      解靜態 HTML 只對「沒有 JS 參與版面」的稿成立。
  source: 'col-source',
  // 🆕 收款(**訂單層**;定案欄序左塊第 5,來源之後)。Sean 2026-09-13 拍甲「要,照新稿加回來」。
  //    🔴 **它 2026-08-14 被他自己拿掉過**(拍 Q2=A「狀態欄獨扛」)⇒ 這是【翻回來】不是新增。
  pay: 'col-pay',
  // ⛔ `invoice: 'col-invoice'` 2026-09-13 移除:發票改成客戶格裡的第三層 tag,不再是一欄。
  // ⛔ `ops: 'col-ops'` 2026-09-13 移除:操作欄 DOM 退場(它 FIX-34 起就是 display:none)。欄數 15 → 14。
  // 🆕 P8:下一步(**訂單層**)。定案欄序的最後一格。
  next: 'col-next',
} as const;

/**
 * 🆕 P-b:就地展開那一列的 `colSpan` = **表頭有幾格**。
 * 🔴 從 `CELL` 數出來、不寫死 —— 這張表 2026-09-13 一天翻了六次欄數,寫死的話每次都要有人記得改,
 *    而漏改的症狀是「展開列比表窄一格」,**看起來像排版小瑕疵**,沒有東西會紅。
 * ⚠️ 前提:`CELL` 的每一個鍵都對應【恰一個】 `<th>`。目前成立(`orders-table.test.tsx` 的
 *    `EXPECTED_HEADERS` 與 `CELL` 鍵數同步守著);哪天有欄不進 `CELL`,這裡要跟著改。
 */
const EXPANDED_COLSPAN = Object.keys(CELL).length;

/** `buildNextHref` 的測試用預設(不帶篩選)。production 由 page 注入帶篩選的那支,見 prop docstring。 */
const defaultNextHref = (orderId: string, action: NextStepDo) => `/orders?next=${orderId}&do=${action}`;
const defaultPayHref = (orderId: string) => `/orders?pay=${orderId}`;
/** `buildInvoiceHref` 的測試用預設(不帶篩選)。production 由 page 注入帶篩選的那支。 */
const defaultInvoiceHref = (orderId: string) => `/orders?invoice=${orderId}`;


function OrderGroup({
  order,
  buildOpenHref,
  selectedOrderId,
  expanded,
  buildNextHref,
  buildPayHref,
  buildInvoiceHref,
}: {
  order: AdminOrderSummary;
  buildOpenHref: (orderId: string) => string;
  /** 🆕 P-b:這一組要不要在品項列底下多畫一列「就地展開的明細」。`null` = 不展開。 */
  expanded: ReactNode | null;
  /** 🆕 P-e-1:「下一步」那顆鈕要導去哪(`?next=<id>&do=<動作>`,帶著當下篩選與頁碼)。 */
  buildNextHref: (orderId: string, action: NextStepDo) => string;
  /** 🆕 收款欄可點:「還差 N」/「還沒收」要導去哪(`?pay=<id>`,帶著當下篩選與頁碼)。 */
  buildPayHref: (orderId: string) => string;
  /** 🆕 入口二(2026-09-13, Sean 拍甲「點 tag 就開, 一步到位」):發票 tag 導去哪(`?invoice=<id>`, 帶篩選與頁碼)。 */
  buildInvoiceHref: (orderId: string) => string;
  /**
   * 現在被右側面板打開的那張單(= 網址上的 `panel=<id>`);沒開面板時是 `null`。
   * 🔴 **只用來畫「這一組是選中的」那個色塊,不參與任何資料查詢或篩選。**
   */
  selectedOrderId: string | null;
}) {
  // 品項展開;空陣列(理論不發生,create_order 保證 ≥1 line)→ 兜一列 null 佔位、顯示「—」。
  const rows = order.lines.length > 0 ? order.lines : [null];
  // `#631` 甲:只畫前 `MAX_VISIBLE_LINES` 列,其餘收成一列連結(見常數 docstring)。
  const visibleRows = rows.slice(0, MAX_VISIBLE_LINES);
  const hiddenCount = rows.length - visibleRows.length;
  /**
   * 🔴🔴 **截斷態【不印數字】** —— 不是「數字會差一點」,是**那個數字不存在**。
   *
   * `itemsTruncated` 的意思是 `order.lines` **本身就是半份的**
   * (`ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT = 500`)⇒ `rows.length - 3` 算的是
   * 「**載進來的**那半還剩幾項」,而畫面上那句話講的是「這張單還有幾項」。
   * 501 項的單會印「另有 497 項」而真值是 498 —— **而它讀起來完全正常。**
   * ⇒ 與同一支檔既有的那條紀律同源(截斷態狀態欄印「未知」、**不得印 0、不得留空**):
   *   **「不知道」與「知道是某個值」不可以長得一樣。**
   *
   * 🔴 **2026-08-18 收斂紀錄(兩個窗做了同一件事)**:`#631 甲`(`66fe671b`,先進 dev)與
   * `07=甲`(G2 `39a95189`)是 **Sean 同一個拍板派給了兩個窗**,兩版都寫完了。
   * 收斂時**以 dev 那版為基準**(它多了兩件真的比較好的東西:那一列**可點**、
   * 而且有 `data-l` ⇒ 手機卡片上不是無標籤孤兒),只從 G2 那版接回一樣東西:
   *   **截斷態的字面加上「(數量未知)」** —— 原本兩版都只寫「另有多項」,
   *   而「多項」讀起來像「我知道有幾項只是懶得講」,「數量未知」才是事實。
   * 🔴 **G2 那版還有一個東西【刻意不接回來】**:它把說明放在 `title=` 屬性裡。
   *   `#639` 這個 backlog 條目講的正好就是「說明掛在 `title` 上 ⇒ 手機一段都讀不到」
   *   ⇒ 接回來等於在同一天親手複製一次已經立案的缺陷。
   */
  const hasMoreLines = hiddenCount > 0 || order.itemsTruncated;
  const moreLinesLabel = order.itemsTruncated
    ? '另有多項(數量未知)，點進去看'
    : `另有 ${hiddenCount} 項，點進去看`;
  /**
   * 🔴🔴 **截斷態的【理由】,`#639 甲` 之後的家(2026-08-18)。**
   *
   * 這段話原本是狀態欄那顆「未知」膠囊的 `title=`,而 `#639` 立案的就是那個載體
   * (`title` 是 hover-only)。拆掉 `title` 的第一版,我在 commit body 裡寫「理由由那一列承載」——
   * 🔴 **codex 判 must-fix,而它是對的:那一列只寫「另有多項(數量未知),點進去看」,
   *    原本三句「500 筆固定限制 / 這一格不能拿來判斷進度 / 聯絡負責人」一句都沒了。
   *    那不是搬家,那是刪掉。**
   * ⇒ 這一行把三句補回**畫面上**。字短是刻意的(表格一格塞不下 112 字的段落),
   *   但**三件事都在**:是固定限制、狀態這一格不可信、找誰。
   * ⚠️ 這與顧客站那兩處**放法不同**(那邊是整段 112 字):客人一頁只有幾張卡,員工一頁有幾十列。
   */
  const truncatedReason = order.itemsTruncated
    ? '這張單的品項太多、系統一次載不完(固定限制,不會自己好)。左邊那格的狀態不能拿來判斷這張單的進度,請找負責人。'
    : null;
  const mergeAmount = shouldMergeAmount(order);
  // L3 片1:整張單算一次(它只在第一列用得到,但算在 map 外面才不會逐列重算同一份)。
  const status = orderStatusView(order);

  return (
    // 🔴 **無障礙:拆掉 `rowSpan` 掉了什麼,精確版**(模糊版「分組語意變純視覺」不可測、不要用):
    //    收斂前 `<td rowspan="3">` 的訂單編號格**屬於它跨到的每一列** ⇒ 螢幕閱讀器逐列讀
    //    第 2、3 個品項時走得到單號;收斂後那些位置是空格 ⇒ **讀不到這是哪一張單**。
    //
    //    ⚠️ **本行是緩解、不是修好,兩種強度不得合併成一句**:
    //    ① **規範允許**(親讀 WAI-ARIA 1.2 §5.2.8.4 `https://www.w3.org/TR/wai-aria-1.2/#rowgroup`:
    //       `rowgroup` 在「Roles Supporting Name from Author」清單、無 `(name required)`;
    //       §5.2.8.6「Name prohibited」清單**沒有**它)。
    //    ② **實作支援未確認、未實測** —— 查不到「NVDA / VoiceOver 會不會念 `tbody` 的 aria-label」
    //       的權威測試資料;反面線索是 NVDA 至今仍有「不念 `th` 的 aria-label」的開放 issue
    //       (`nvaccess/nvda#17213`)⇒ 表格元素上的 aria-label 支援度本來就參差。
    //       **這是搜尋的陰性結果,不等於「確認不支援」。**
    //
    //    🔴 為什麼不用更直覺的 `sr-only` 塞進空格:**與卡片模式的 `td:empty` 直接衝突** ——
    //    `sr-only` 是視覺隱藏、元素仍有子節點 ⇒ `:empty` 不成立 ⇒ 手機卡片冒出一排
    //    「只有標籤沒有值」的空行(正是 V3 那組特地釘住的病)。要走那條得先換掉整套隱藏機制。
    //    🔴 **這一行原本寫「缺口已立 backlog」—— R3 實查 `docs/phase-1-backlog.md` 的 #447
    //       並沒有這個缺口,那句話是錯的字面**(宣稱有追蹤而實際沒有,同 M3 那族)。
    //       正確狀態:條目本文已寫進 STOP 信、號碼由主視窗發(backlog 檔在別的 worktree、我不得直接改)。
    //       ⇒ 號一發下來就把編號補進本行;在那之前**不得**宣稱已有追蹤項。
    /* 🔴 **`data-selected` 只在「這一組就是面板打開的那張單」時【存在】,否則整個屬性不出現。**
       CSS 選的是 `[data-selected]` 的**存在性**(`globals.css` 的 `.orders-group[data-selected]`)——
       寫成 `data-selected={false}` 或 `'false'` 會讓**每一組都命中**,而畫面上「每一列都被選中」
       看起來像壞掉、不像沒生效,**反而比較容易被發現**;但寫 `undefined` 才是對的:React 對
       `undefined` 是**不渲染這個屬性**。
       ⚠️ 面板沒開時 `selectedOrderId` 是 `null` ⇒ 恆不相等 ⇒ 一組都不亮。**那是正確狀態,不是沒生效。** */
    <tbody
      className='orders-group'
      aria-label={`訂單 ${order.displayId}`}
      data-selected={order.id === selectedOrderId ? '' : undefined}
    >
      {visibleRows.map((line, i) => {
        const first = i === 0;
        // R2 F5:`formatOrderItemVehicle` 原本在同一列被呼叫兩次(一次判 `data-empty`、一次印值)。
        // 算一次存起來 —— 兩次呼叫之間沒有任何狀態變化,重算純粹是浪費,而且**兩處字面會漂**。
        const vehicleText = (line && formatOrderItemVehicle(line.vehicle)) || null;
        return (
          <tr
            key={line ? line.id : 'empty'}
            // 🔴 2026-08-09 Sean 實測要求「整列可點進詳情」。做法是 **stretched link**:
            //    列設 `relative`,單號那個 <Link> 用 `after:absolute after:inset-0` 把命中區撐滿整列。
            //    **零 JS、表格本體維持 server component**,而且它是**真的連結** ——
            //    鍵盤 Tab、中鍵開新分頁、右鍵複製網址都正常(用 onClick 做這些全都沒有)。
            //    勾選格 / 下一步 / 收款那幾顆另外設 `relative z-10` 浮在覆蓋層上面 ⇒ 點它們不會誤觸進詳情。
            //
            //    🔴🔴 **收斂前後不一樣,原本這裡寫「收斂前後同樣」是錯的(code-reviewer M4)**:
            //    「第二列之後沒有 stretched link」**只有桌機成立**。收斂前手機是獨立的
            //    `<li className='relative p-3'>` 包住整張卡 ⇒ 覆蓋層蓋滿整卡,**每個品項都點得到**。
            //    收斂後 `relative` 在 `<tr>` 上,卡片模式下覆蓋層只蓋第一段
            //    ⇒ 多品項單第 2、3 個品項在手機上點下去**沒有反應**。
            //    ⇒ 修法在 `globals.css`:卡片模式把定位脈絡抬到 `tbody.orders-group`、`tr` 改 `static`。
            //    ⚠️ 這個病**桌機看不到、截圖也看不到**(截圖不會告訴你哪裡可點)。
            /* 🔴 **片3:兩級分隔線 + 全強度 hover(逐字搬 OD `:167-176`)。**
               ① **列 hover 由 `bg-muted/40` 改成 `bg-muted`(全強度)** ——
                  OD `:176` 是 `background:var(--surface-warm)`,**沒有透明度**。
                  `/40` 疊回白底是 `#f8fafc`、對卡片對比 **1.02** ⇒ **滑過去幾乎看不出來**,
                  而這張表的整列可點,hover 是「我現在會點到哪一列」的唯一訊號。
               ② **同一張單的品項列:`border-dashed` 改成 `border-border-soft`(淺實線)** ——
                  這是 `--border-soft` 的**第一個消費端**,兩級的來源是 OD `:310-312`
                  (`th` 深 `--border` / `td` 淺 `--border-soft`)。
                  🔴 **群組首列仍是 `border-t`(深、實線),沒有動** ⇒ 「換一張單」與「同一張單的下一個品項」
                     的區分**還在**,只是從「實線 vs 虛線」變成「深線 vs 淺線」。
                  ⚠️ **BMW M 全稿沒有任何虛線分隔**(唯一的虛線是 `:220` `.cap.is-dead` 的已取消膠囊外框,
                     那顆**照抄、沒動**)⇒ 拿掉這裡的虛線是往 OD 靠,不是我改設計。
               ⚠️ **這兩項都是看得出來的視覺改動**,已列進「要請 Sean 肉眼看」的項目。 */
            className={`hover:bg-muted relative ${first ? 'border-t' : 'border-t border-border-soft'}`}
          >
            {/* 2b-1:訂單層勾選。**一訂單一個框**(放品項列的話,一張三品項的訂單會冒出三個框)。
                🔴 `relative z-10` 是承重的:整列被 stretched link 的覆蓋層蓋住,
                沒有它就**點不到勾選框**(會變成點哪裡都進詳情)。
                🔴 **刻意沒有全選框** —— 全選必然跨客人,而跨客人裝同一箱一定被 DB 退件;
                不提供一個「按了一定失敗」的按鈕。 */}
            {first ? (
              <td className={`${TD} ${CELL.pick} relative z-10`}>
                <OrderShipCheckbox orderId={order.id} customerUserId={order.customerUserId} />
              </td>
            ) : (
              <td className={`${TD} ${CELL.pick}`} />
            )}

            {/* Q2=A(07-16 晨拍板):日期欄(created_at,訂單層)。
                A11a-2:接 `formatOrderListDate`(同年 `07/25`、跨年 `2025/06/27`)。
                ⚠️ 這曾是 admin `formatOrderDate` 的唯一 production 呼叫端;改接後那支歸零,
                已於 **A9c** 刪除(plan 說的「留給明細頁」是錯的:明細頁走 `formatOrderDateTime`)。

                🏁🏁 **P3(2026-09-13):單號併進本格** —— 稿 v19 的
                `<td class="d muted">09/01<br><span class="oid mono">XJ2YMV</span></td>`。
                ⇒ `col-oid` 那一欄**整個消失**,欄數 15 → 14。

                🔴🔴 **單號的字樣【刻意偏離 v19 稿】—— Sean 2026-09-13 裁乙,逐字理由:**
                   **「找單的時候看的是單號,不是日期」。**
                   ⇒ 排版照稿(日期在上、單號在下面小字),**而單號保留主文字色 + 等寬粗體**,只把字級降到 12。
                   稿 v19 是 `.oid{font-size:12px;color:var(--mut)}`(灰色)。
                   📌 **兩份 OD 稿在這一格互相矛盾**:舊稿 `overview-desktop.html:181`
                      `table.g td.oid{color:var(--fg)}`(主文字色)/ v19 灰色小字 ⇒ **他裁舊稿那一份算。**
                   ⚠️ **證據**:探針七張單的日期**全是 09/13**,而真實資料裡日期也常整批同一天
                      ⇒ 那一欄的主識別實際上是單號,壓淡它會讓員工掃列表找單變慢。
                   🟢 **而保留粗體【不用付任何寬度代價】**(實測):等寬字型的字元 advance 與字重無關
                      ⇒ 12px 粗體與 12px 一般**同寬 93.9px**。
                      📌 **下一個想「省寬度」把它改回細字的人:省不到,那一格是免費的。**

                🔴 **量它有多寬的時候不要用 `td.textContent`** —— 底下那兩個 `<Link>`(桌機 panel /
                   手機 page)**兩份都在 DOM**、由 CSS 決定顯示哪一個 ⇒ `textContent` 把單號算**兩遍**,
                   我第一次量到「26 碼」。要取 `td.querySelector('a').textContent`。
                   📌 **沒發現的後果**:會給這一格一個**兩倍寬**的值,**而畫面上看起來完全正常。** */}
            {first ? (
              <td className={`${TD} ${CELL.date} text-muted-foreground text-xs`} data-l='下單'>
                {formatOrderListDate(order.createdAt)}
                {/* #350c:桌機開右側面板(`/orders?…&panel=<id>`)、手機走整頁 `/orders/[id]`。
                    🔴 **兩個目的地是拍板過的,收斂 markup 不得順手統一它**(主視窗 2026-08-10 裁③、Q5:
                    小螢幕沒有分割空間)⇒ 這是全表**唯一**保留雙份 DOM 的地方(操作格 2026-09-13 退場後)。
                    🔴🔴 **L3 片3 起分流不在本檔** —— 顯隱由 `app/globals.css` 用
                    `a[data-nav='inline'|'page']` 與卡片化**同一條規則**決定(主視窗 E-419 裁 B)。
                    ⚠️ **在本檔看不出哪顆會顯示** —— 那是這個做法的代價,故留這段指回 CSS。
                    🔴 兩個都是**真的 `<Link href>`**、不是 onClick ⇒ 鍵盤 Tab、中鍵開新分頁、
                    右鍵複製網址一條都沒有失去。

                    🔴🔴 **`after:absolute after:inset-0` 是那條 stretched link —— 它是承重的。**
                    **Sean 2026-08-09 實測要求「整列可點進詳情」**(`:335` 原註解),做法是讓這顆 `<a>`
                    的偽元素撐滿整列的命中區。
                    ⚠️ **它的定位基準是 `<tr>`(列設 `relative`),不是這一格** ⇒ P3 把它從單號欄
                       搬進日期格**不影響那個機制**,而那件事是**真瀏覽器實測過的**,不是推的。 */}
                <span className='oid-sub'>
                  <Link
                    href={buildOpenHref(order.id)}
                    data-nav='inline'
                    className='after:absolute after:inset-0 hover:underline'
                  >
                    {order.displayId}
                  </Link>
                  <Link
                    href={`/orders/${order.id}`}
                    data-nav='page'
                    className='after:absolute after:inset-0 hover:underline'
                  >
                    {order.displayId}
                  </Link>
                </span>
              </td>
            ) : (
              <td className={`${TD} ${CELL.date}`} />
            )}

            {/* 客戶:**三層** = 名字 / 會員等級 / 發票 tag(Sean 2026-09-13 拍板)。
                他看完 3031 的第一句逐字:「發票應該是要放 tag 在會員 tag 下方吧?不是放在最右邊」
                ⇒ 原本的 `col-invoice` 整欄退場(欄數 14 → 13),字面搬進這一格。

                🔴 **三態的字面仍然複用 `INVOICE_STATUS_LABEL`** —— 與原本那一欄同一份,
                   明細頁的「開立狀態」也是它。三處共用一個 `Record<InvoiceStatus, string>`,
                   不在這裡抄第二份中文(兩份字面必然漂)。

                🔴🔴 **`invoiceRequested` 為 false ⇒ 什麼都不印**(Sean 逐字:「不開發票的就連顯示不都顯示」)
                   —— 連「不開立」三個字都不要。
                   ⚠️ **這件事非要 `invoiceRequested` 不可**:`invoiceStatus` 三態(Q2b=A)
                      **沒有**「不需開立」⇒ 一張不開發票的單在那一欄上印的是 `not_issued`
                      = 與「要開而還沒開」同一個字面。本片為此把該欄拉進列表投影
                      (理由與代價寫在 `packages/domain/src/order/types.ts` 的 `invoiceRequested`)。

                🔴 **底色三態各一個,而第三態【刻意不是 Sheet 色】**(設計窗挑、Sean 答「可以接受」):
                   · 未開立 = Sheet「已收已定」那格(對比 18.91)
                   · 已開立 = Sheet「出貨完成」那格(對比 4.53)
                   · 已作廢 = **透明 + 虛線框**,借稿上既有終止態的形狀 —— 虛線框本身就分得出來,
                     **不要為它配新色**(配色的真值在 `app/globals.css` 的 `.inv-tag--*`)。

                🏁 **入口二(2026-09-13):tag 可點了 —— Sean 拍甲「點 tag 就開, 一步到位」。**
                   ⛔ ~~「已裁而未做」~~:發票小抄彈窗已在(`?invoice=<id>`, `invoice-cheatsheet-dialog.tsx`)。
                   🔴 **網址驅動, 不是 onClick**:本檔零 `use client` / 零 hook(有守門)⇒ 「阻止冒泡」不能用
                      事件;做法 = `<Link>` + `relative z-10` **掛在 Link 上**(不是 td 上)—— 與「下一步」
                      那顆(`data-next-do`)同一套。Link 浮在整列 stretched link 之上, 其餘格子照舊進明細。
                   🔴 `shipping-selection.test.tsx` 那格 z-10 容器分類:第四種 = `data-invoice-open`。

                ⚠️ **td 本身仍然不加 `relative z-10`**(見上面日期格那段):z-10 只給 tag 那一小塊,
                   否則會在整格挖出一個點不進明細的洞。 */}
            {first ? (
              <td className={`${TD} ${CELL.customer}`} data-l='客戶'>
                <span className='cust-name'>{order.customerName ?? '—'}</span>
                <span className='cust-tag text-muted-foreground text-xs'>
                  {MEMBER_TIER_LABEL[order.tierAtCheckout]}
                </span>
                {order.invoiceRequested ? (
                  <Link
                    href={buildInvoiceHref(order.id)}
                    className={`cust-tag inv-tag inv-tag--${order.invoiceStatus} relative z-10`}
                    data-invoice-open
                    title='開發票小抄'
                  >
                    {INVOICE_STATUS_LABEL[order.invoiceStatus]}
                  </Link>
                ) : null}
              </td>
            ) : (
              <td className={`${TD} ${CELL.customer}`} />
            )}

            {/* 🆕 P4:來源(**訂單層** —— 一張單從哪來)。做法與狀態 / 發票同一套:
                **只在該單第一列出值,其餘列渲染真的空 `<td>`**(空格必須真的空,
                否則卡片模式的 `td:empty{display:none}` 不成立)。

                🔴 **字面複用 `ORDER_SOURCE_LABEL`,不在這裡拼第二份** —— 那份
                (`order-list-view.ts:254`)已經是明細頁摘要卡與篩選下拉的共用來源
                ⇒ 列表自己抄一份中文,三處必然各自漂。

                ⚠️ **稿與現況的值域不是一對一,而這不是做錯**:
                  · 稿 v19 印 `LINE`(88) / `蝦皮`(25) / `其他`(4) / `IG`(1),
                    而**蝦皮與 IG 被稿自己標了** `class="nw" title="系統目前沒有這個來源(新功能)"`
                    ⇒ 現況資料沒有它們,本欄不做。
                  · 反過來,現況的 `web`(網站)與 `manual_phone`(電話)**稿上沒印**,
                    但資料真的有這兩個值 ⇒ 照 `ORDER_SOURCE_LABEL` 印。
                  ⇒ **列表會出現稿上看不到的「網站」與「電話」。那是真資料,不是 bug。** */}
            {first ? (
              <td className={`${TD} ${CELL.source} text-xs`} data-l='來源'>
                {ORDER_SOURCE_LABEL[order.orderSource]}
              </td>
            ) : (
              <td className={`${TD} ${CELL.source}`} />
            )}
            {/* 🆕 收款（**訂單層** —— 錢是整張單的事，不是逐品項）。Sean 2026-09-13 拍甲：
                逐字「**甲 = 要, 照新稿加回來(已收足 / 還差 N / 還沒收)**」。
                🔴 **這是【翻回】2026-08-14 他自己拍的「狀態欄獨扛、付款膠囊下架」** ——
                   而他是**在知道代價之後**翻的（主視窗把「五態降級成兩態」那段逐字端給他）。
                   ⇒ 要再翻它，去問他，不要讀舊註解推。

                🛑🛑 **字面來自 `formatOrderPayColumn`，而那是【五個字面的唯一一份】** ——
                   不在這裡拼中文、不在這裡做金額算術。
                   ⛔ **尤其不准寫 `order.total.amount - paidTotal`**：`paid_total` **不扣退款**
                      （退款有兩本帳）⇒ 那個數會**看起來很合理而是錯的**，而三綠全綠、畫面正常。
                      📎 理由全文在 `AdminOrderSummary.balanceDue` 的 docstring。

                🔴 兩個他另外拍的（原稿沒有、實作時挖出來的，也都甲）：
                   · 退過款的單 ⇒ 「需確認」，**不給數字**（給錯的比不給更糟）
                   · 多付的單   ⇒ 「多收 N」，與「還差 N」對稱，員工看得出要退錢

                ⚠️ 做法與狀態 / 來源同一套：**只在該單第一列出值，其餘列渲染真的空 `<td>`**
                   （空格必須真的空，否則卡片模式的 `td:empty{display:none}` 不成立）。 */}
            {first ? (
              (() => {
                const ambiguous = orderPayAmbiguous(order);
                const text = formatOrderPayColumn(order.balanceDue, ambiguous, order.paymentStatus);
                /* 🏁 **收款欄可點(2026-09-13,Sean 答甲)**:「還差 N」/「還沒收」變連結 ⇒ `?pay=<id>`
                   開「新增收款」彈窗(復用明細頁收款分頁那份 `PaymentRecordForm`,同一支 action)。
                   🔴 「已收足」/「需確認」/「多收 N」**不可點** —— 沒有收款要做;需確認更不能給入口:
                      算不出餘額的單,員工照著一個不存在的「還差」去收款,那是錯的錢。
                   🔴 取消過的單一律「需確認」(codex R1 must-fix ①,理由同上一段)⇒ 也不可點。
                   🔴 `relative z-10` 承重(同下一步 / 勾選那兩種):沒有它被整列 stretched link 蓋住。
                   🔴 仍是 `<Link>`、零 client JS ⇒ 本檔零 use client 那條守門不動。 */
                return (
                  <td className={`${TD} ${CELL.pay} text-xs`} data-l='收款'>
                    {orderPayActionable(order.balanceDue, ambiguous) ? (
                      <Link
                        href={buildPayHref(order.id)}
                        className='text-primary relative z-10 underline underline-offset-2'
                        data-pay-open=''
                      >
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })()
            ) : (
              <td className={`${TD} ${CELL.pay}`} />
            )}


            {/* 🔴 `data-empty` 只給**卡片模式**用(CSS `td[data-empty]{display:none}`):
                桌機要印 `—`(欄位在、值是空),但卡片上「車種 —」是一行純噪音,而 Sean
                第 5/6 輪連續抱怨手機太鬆。收斂前這件事是 `OrderCard` 用 `.filter()` 在 JS 層做的。
                ⚠️ 只有 vehicle 與 brand 兩欄這樣做(= 舊版真正過濾的那兩個)。

                🔴 **V-3b:本欄的「車種」= `order_items.vehicle_snapshot` 直出的「年份 車廠 車型」整串**
                   (未帶車款/佔位列→「—」)。L3 片2 起欄名從「年份廠牌車種」縮成「車種」,**內容一個字沒改**。
                ⚠️ **名詞陷阱(需求檔 §0-B:115 逐字):系統裡有兩個「廠牌」** ——
                   下一格的 `brand` 是**零件品牌**(WRS / EaziGrip),本欄裡出現的廠牌是**車廠**(Honda / Yamaha)。
                   兩者必須是各自獨立、標題不同的欄,**不得合併、不得共用同一個詞**。
                🔴 **本片把車種提到廠牌之前 —— 這是整片唯一真正搬家的一件事**(`design-brief` §0-B:1
                   逐字「車種 廠牌 料號」)。⚠️ 卡片模式的 `order` **不用動**:`col-vehicle`(11)本來就在
                   `col-brand`(12)之前,與 OD `overview-desktop.html:161-166` 一致 ⇒ 只有桌機要對調。 */}
            <td
              className={`${TD} ${CELL.vehicle} text-muted-foreground text-xs`}
              data-l='車種'
              {...(vehicleText ? {} : { 'data-empty': '' })}
            >
              {vehicleText ?? '—'}
            </td>
            <td
              className={`${TD} ${CELL.brand}`}
              data-l='廠牌'
              {...(line?.brand ? {} : { 'data-empty': '' })}
            >
              {line?.brand ?? '—'}
            </td>
            <td className={`${TD} ${CELL.sku} font-mono text-xs`} data-l='料號'>
              {line?.variantSku ?? '—'}
            </td>
            <td className={`${TD} ${CELL.title}`}>{line?.title ?? '—'}</td>
            <td className={`${TD} ${CELL.qty} text-right tabular-nums`} data-l='數量'>
              {line ? line.quantity : '—'}
            </td>
            {/* 🆕 L3 片2:單價(**品項層**、該單成交價)。佔位列(`line` 為 null)→「—」,與同列其他品項欄一致。
                🔴 **不自己算**:`unitPrice` 是下單當下 server 算好凍結的值,`lineTotal = unitPrice × quantity`
                   由 domain 守門(`packages/domain/src/order/order.ts:90` 逐字)。UI 端**不得**用
                   `lineTotal / quantity` 反推 —— 那會在有折扣或未來出現部分退款時給出不存在的數字。
                🔴 **不掛 `data-empty`**:它是品項的識別欄之一,空了要在手機上看得見「這裡沒有」
                   (同料號/品名/數量,只有車種與廠牌那兩欄收)。 */}
            {/* 🔴 **幣別只印一次, 在欄名上**(Sean 2026-09-10 拍甲)——
                每一格重複印 `NT$ ` 要吃掉 **35px**, 而單價欄可用內容寬只有 48px
                ⇒ 「NT$ 3,670」需要 77px ⇒ **切**。實測 18 格被切, 拿掉之後 0 格。
                🔵 理由不是省空間:**一欄裡每一格都寫同一個幣別, 那個字沒有在分辨任何東西。**
                🔴 **而 `data-l` 也要帶** —— 手機卡片【沒有表頭】, 欄名就是 `data-l`
                   (`globals.css:1473` `content: attr(data-l)`)⇒ 只改桌機表頭的話,
                   **手機上會變成一個沒有幣別的數字。** */}
            <td className={`${TD} ${CELL.unit} text-right tabular-nums`} data-l='單價 NT$'>
              {line ? formatOrderAmount(line.unitPrice.amount) : '—'}
            </td>
            {/* 金額:合併態 = 訂單層(只在第一列出值);非合併態 = 逐列該列小計(見 shouldMergeAmount)。
                ⚠️ 兩態的 `data-l` 刻意不同(金額 / 小計)—— 手機卡片沒有表頭,
                標籤是那格語意的唯一載體,而這兩態的語意本來就不同(整單的錢 / 品項的錢)。 */}
            {mergeAmount ? (
              first ? (
                <td className={`${TD} ${CELL.amount} text-right tabular-nums`} data-l='金額 NT$'>
                  {formatOrderAmount(order.total.amount)}
                </td>
              ) : (
                <td className={`${TD} ${CELL.amount}`} />
              )
            ) : (
              <td className={`${TD} ${CELL.amount} text-right tabular-nums`} data-l='小計 NT$'>
                {line ? formatOrderAmount(line.lineTotal.amount) : '—'}
              </td>
            )}

            {/* 🏁 **L3 片1:狀態八值欄上場,原地換掉訂貨欄**(Sean 拍 Q2=A)。

                🔴 **層級變了,不只是換個欄名**:訂貨是**品項層**(逐列各有 `n/m`),
                   狀態是**訂單層**(整張單走到哪)⇒ 改成「只在第一列出值、其餘列渲染真的空 `<td>`」,
                   與單號 / 日期 / 客戶 / 發票 同一套。⚠️ 空格必須是真的空(`<td className={…} />`),
                   否則卡片模式的 `td:empty{display:none}` 不成立、卡片會冒出一排空標籤。

                🔴 **字面與 class 全部由 `orderStatusView` 算,本檔不自己拼**
                   —— L1(`f745e04e`)那支已把八值字面、貨品軸配色、未收紅框、已取消虛線框
                   全部收在 `order-status-axes.ts`;在這裡再拼一次就是第二份會漂的字面。
                   ⚠️ 它回傳的 `capsuleClass` **已含**共用膠囊形狀 `STATUS_CAPSULE`,不要再串一次。

                ⚠️ **訂貨的資訊沒有消失、只是離開列表**:品項層的 `n/m` 仍在明細頁
                   (`ItemAxisCell`),而狀態欄的貨品軸是**整單彙總**(所有品項都到齊才進下一階段,
                   `orderGoodsAxis` docstring 逐字)⇒ 兩者不是同一個數字,**不要拿列表這格去對明細那格**。 */}
            {/* 🔴🔴 **`itemsTruncated` ⇒ 不印狀態,改印「未知」**(2026-08-16,`Q-EMBED-2` Sean 拍**甲**)。
                **這不是保守,是那個值真的算錯了**:`goodsAxisOfLines` 三條判定都是 `.every(...)`,
                而 `.every()` 對子集**單調** ⇒ **子集算出來的階段恆 ≥ 真實階段**
                ⇒ 看得見的全出貨了就答「出貨完成」,而沒載進來的可能一件都沒出。
                ⇒ **員工看到「出貨完成」就不再動作** —— 他做對了,但結果是錯的。
                🔴 **不得印 0、不得留空** —— 兩者都會被讀成「就是沒有」,而語意是「我們不知道」。
                ⚠️ **閘裝在顯示端、不裝進 `orderStatusView`**:那支的參數是 `AdminOrderSummary`,
                   理論上讀得到旗標,但它同時服務**明細側**(`order-status-axes.ts` 搜 `orderDetailGoodsAxis`
                   那組刻意收窄的型別)⇒ 在算式裡混進「資料完不完整」會讓那支函式同時回答兩個問題。
                   **與頭條數字、出貨狀態那兩格是同一個結構決定。** */}
            {first ? (
              <td className={`${TD} ${CELL.status}`} data-l='狀態'>
                {order.itemsTruncated ? (
                  /* 🔴 **`#639` 甲的第三處(2026-08-18)。** 這裡原本把整段理由掛在 `title=` 上,
                     而 `#639` 立案的正是那個載體 —— G1 收割時撈到這一處、主視窗釘死「不能還是 title」。
                     ⚠️ **放法與顧客站那兩處【不同】,理由寫在這裡**:
                       · 顧客站是**一張卡**,塞得下 79 字的段落;這裡是**表格的一格**,
                         塞進去會把整列撐爛,而且**每一張截斷的單都會重複同一段**。
                       · 而這段話要講的事,**同一列已經有一個看得見的家** ——
                         下面那一列「另有多項(數量未知),點進去看」。
                     ⇒ 這一格只留「未知」兩個字(它自己就是訊號),**理由由那一列承載**
                        (那一列的 `truncatedReason`,見上面那段 docstring)。
                     🔴 **第一版我只做了半件事** —— 拆掉 `title` 卻沒有把三句理由補到那一列上,
                        codex 判 must-fix:**那不是搬家,那是刪掉**。現在三句都在畫面上了。
                     🔴 `hasMoreLines` 在 `itemsTruncated` 為真時**恆為真**(見上面那個 `||`)
                        ⇒ **只要這一格印「未知」,那一列就一定在。** 兩者不會各自出現。
                        守門:`orders-table.test.tsx` 釘住「截斷態 ⇒ 那一列在,且三件事都在畫面上」。 */
                  <span className={status.capsuleClass}>未知</span>
                ) : (
                  /* 🎨 `data-st` = 稿 v22 `.cap[data-st="<八值字面>"]` 的鉤子:八色(Sean 的 Sheet 色)住在 `globals.css` 的
                     `--st-*` token,**用字面選色、不另拼 class** —— 字面本來就是 `orderStatusView` 算出來的唯一真相。
                     形狀(方角 / 12px / 700)照舊走 `.cap-*`。「未知」那一格不帶 data-st ⇒ 灰。 */
                  <span className={status.capsuleClass} data-st={status.label}>{status.label}</span>
                )}
              </td>
            ) : (
              <td className={`${TD} ${CELL.status}`} />
            )}

            {/* ⛔ **發票欄(A11a-5)2026-09-13 整欄退場** —— Sean 拍板搬進客戶格當第三層 tag
                (理由與三態配色寫在上面那一格)。欄數 14 → 13。
                🔴 **它不是被刪掉,是被搬走了** —— `INVOICE_STATUS_LABEL` 的唯一列表消費點現在在客戶格。
                ⚠️ 下一個要加欄的人:`CELL` 裡**已經沒有** `invoice` 這個鍵了,別照舊檔的記憶寫。 */}

            {/* ⛔ 操作欄 `<td>`(A13)2026-09-13 退場 —— 見檔頭那段。 */}
            {/* 🆕 **P8 下一步**（訂單層）。Sean 2026-09-13 拍甲，逐字
                「**讓員工【不必進明細】就能在列表上按下一步**」。
                規格：`~/pcm-mailbox/0912-後台UX/規格-下一步欄-v1.md`。

                🔴🔴 **這一輪【只印字，不可點】，而那是一條界線不是偷懶。**
                   規格 §2 的結論逐字：「**這一欄沒有「一鍵就完成」的動作**。每一顆都要輸入
                   ⇒ 下一步那顆鈕的行為一律是『開彈窗』」——而彈窗要 client JS，
                   🛑 **本檔全檔零 `use client` / 零 hook**（`orders-table.test.tsx` 有一格守著它）
                      ⇒ 在這裡掛 `onClick` 會當場破一條守著的不變式。
                   ⚠️ **而「本表整體沒有 client bundle 風險」那句話是【假的】** —— 勾選框那顆
                      是既有的 client island（住 `shipping-selection.tsx`）。兩件事不要混：
                      **本檔沒有 client 碼** ≠ **這張表沒有互動**。
                   ⇒ 📌 **「按下去開什麼」是下一片的事，而它要先決定容器**（而容器改版正在設計中）。
                   ⚠️ 主視窗的硬線也指同一邊：「那顆鈕真的會**寫入**就碰狀態機
                      ⇒ 這一片不要接寫入。**一顆在列表上就能按的寫入鈕，誤按的成本比在明細裡高。**」

                🔴 **只看貨的狀態，不看錢**（稿 `build-v10.py:30-34` 逐字）——
                   收款是訂單層的事，它在**收款欄**自己講。把收款併進來 = 同一件事在同一列講兩次。

                🔴 三種顯示各有各的意思，**不得互相兜底**：
                   · 還有事要做 ⇒ 印動詞（跟供應商下訂 / 到貨登記 / 出貨）
                   · 做完了     ⇒ 印「完成」**灰字**（規格 §1 逐字「灰字，不是鈕」）
                   · 已取消 / 已退款 ⇒ **整格空白**
                     ⚠️ **不要改成「—」** —— 這一欄其他格印的是動詞，一個破折號讀起來像「沒資料」。
                     📌 「沒有下一步了」與「這張單不在流程裡了」是兩件事。 */}
            {first ? (
              (() => {
                const next = orderNextStep(status);
                if (next.kind === 'none') return <td className={`${TD} ${CELL.next}`} data-l='下一步' />;
                if (next.kind === 'done') {
                  return (
                    <td className={`${TD} ${CELL.next} text-muted-foreground text-xs`} data-l='下一步'>
                      {next.label}
                    </td>
                  );
                }
                /* 🏁 **P-e-1(2026-09-13,Sean 批 P-e 甲):action 態從灰字變【連結】。**
                   🔴 它開的是【表單】不是動作:`?next=<id>&do=<動作>` 由 server 端渲染一個彈窗殼
                      (`next-step-dialog.tsx`),寫入只發生在他按「確認」那一刻(P-e-3)。
                      **貼這條網址不會寫進任何東西。**
                   🔴 `relative z-10` **是承重的**:整列被 stretched link 蓋住,沒有它這顆連結點不到 ——
                      而點下去畫面**確實有反應**(整列把人帶進展開),看起來像功能好了。同勾選格那條教訓。
                   🔴 仍是 `<Link>`、零 client JS ⇒ 本檔「全檔零 use client / 零 hook」那條守門不動。 */
                return (
                  <td className={`${TD} ${CELL.next} text-xs`} data-l='下一步'>
                    {/* 🎨 長相照稿 v22 `.act`(2026-09-14 凌晨,主視窗轉 Sean):描邊小鈕,不是藍色底線連結 ——
                        `border:1px solid var(--line);background:var(--card);color:var(--fg2);border-radius:7px;
                         padding:3px 9px;font-size:12px;min-height:24px`。圓角走 token(`rounded-lg` = 8;7 不是 token,守門禁裸值)。
                        🔴 內距取稿的另一版 `padding:3px 8px`:`col-next` 內容盒 90(104 − 7×2),六字鈕 72+16+2 = 90 剛好;
                           9px 會多 2px ⇒ td 的 `text-overflow:ellipsis` 在鈕右邊畫出一顆「.」(1440 真瀏覽器撞到)。
                        字面照 `規格-下一步欄-v1.md` 不動;仍是 `<Link>`、零 client。 */}
                    <Link
                      href={buildNextHref(order.id, next.do)}
                      className='border-border bg-card relative z-10 inline-flex min-h-6 items-center rounded-lg border px-2 py-[3px] text-[12px] leading-[1.4] whitespace-nowrap text-(--fg-2)'
                      data-next-do={next.do}
                    >
                      {next.label}
                    </Link>
                  </td>
                );
              })()
            ) : (
              <td className={`${TD} ${CELL.next}`} />
            )}

          </tr>
        );
      })}
      {/* 🔴 `#631` 甲的那一列。**它需要自己的連結** —— stretched link 只鋪在【第一列】
          (單號那個 `<Link>` 的 `after:inset-0`,而 `relative` 在 `<tr>` 上)⇒ 第二列之後
          點下去本來就沒反應。Sean 那句逐字是「**點進去看**」⇒ 不能只是一段文字。
          🔴🔴 **而它【不需要】`relative z-10`** —— 我第一版加了,是照抄勾選格的做法,
             **抄錯了理由**:那兩格需要浮起來,是因為它們與 stretched link 在**同一個 `<tr>`** 裡;
             而覆蓋層是 `after:inset-0`、`relative` 在 `<tr>` 上 ⇒ **它只蓋得到第一列**,
             本列是另一個 `<tr>`,根本沒有東西壓在上面。
             ⇒ 抓到它的是 `shipping-selection.test.tsx` 那格「每個 z-10 容器都真的裝著那兩種東西之一」
               —— 我多出來的兩個 z-10 讓它從 2 變 4。**守門在替我擋「我以為我需要它」。**
          🔴 雙目的地(`data-nav='inline' | 'page'`)照本檔既有慣例:桌機開面板、手機走整頁,
             顯隱由 `globals.css` 與卡片化**同一條容器斷點**決定 —— 不要在這裡自己判斷置。
          ⚠️ `colSpan` 用 `Object.keys(CELL).length` **算出來**,不寫字面 14:
             這張表加減欄時,寫死的 14 不會紅、而版面會歪掉。
          ⚠️ `data-l` 要給 —— 卡片模式靠它印欄名,沒有的話手機上這一列是個沒有標籤的孤兒。 */}
      {hasMoreLines && (
        <tr className='hover:bg-muted border-border-soft relative border-t'>
          <td
            className={`${TD} text-muted-foreground text-xs`}
            colSpan={Object.keys(CELL).length}
            data-l='其餘品項'
          >
            <Link href={buildOpenHref(order.id)} data-nav='inline' className='hover:underline'>
              {moreLinesLabel}
            </Link>
            <Link href={`/orders/${order.id}`} data-nav='page' className='hover:underline'>
              {moreLinesLabel}
            </Link>
            {/* 🔴 理由印在連結**旁邊**、不進連結文字:連結的名字要短(螢幕閱讀器會逐條唸連結),
                而理由是給看畫面的人讀的。守門在 `orders-table.test.tsx`(截斷時這三件必須在畫面上)。 */}
            {truncatedReason !== null && (
              <span className='ml-2 opacity-90'>{truncatedReason}</span>
            )}
          </td>
        </tr>
      )}
      {/* 🆕 **P-b(2026-09-13):訂單明細【就地展開】,右側面板退場。**
          Sean 逐字:「那切掉原因是因為左邊側欄還用原本…右邊訂單明細也還在關係,新版就沒這問題」
          + 他更早拍的「要跳脫現有『右側面板』框架」。
          規格 `規格-側欄與訂單明細容器-v1.md` §3-d:點一列 ⇒ 明細**就在那一列正下方**,
          表格寬度不變;再點一次那一列就收(他拍過「不要 ✕ 關閉鈕」)。

          🔴 **這一列是【一整張明細】,不是摘要** —— 節點由呼叫端用 `OrderDetailRoute` 產
             (與 `@panel/orders/page.tsx` 今天渲染進面板的**同一支**),本檔只負責擺在對的位置。
             ⇒ 明細裡的每一顆鈕 / 表單 / return_to 都跟面板版一樣能用,不是另一份精簡版。
          🔴 `colSpan` 吃**表頭的格數**,不寫死數字 —— 這張表今天已經翻過六次欄數。
          ⚠️ **它不是「訂單層欄」**(不在 `ORDER_LEVEL_COLUMNS` 那張清單裡):它是一整列,不是一格。
             那些「第二列之後必須是真的空」的守門數的是 `td.col-*`,本列的 td 沒有 `col-` class,
             刻意不讓它們互相踩。
          ⚠️ **手機卡片模式**:`.orders-grid td{display:flex}` 那套會把這一列也攤成卡片 ——
             `globals.css` 給它 `.orders-expanded` 自己的規則,不吃 `col-*` 那些。 */}
      {expanded !== null && (
        <tr className='orders-expanded' data-testid='order-expanded'>
          <td colSpan={EXPANDED_COLSPAN}>{expanded}</td>
        </tr>
      )}
    </tbody>
  );
}

export function OrdersTable({
  orders,
  buildOpenHref,
  buildNextHref = defaultNextHref,
  buildPayHref = defaultPayHref,
  buildInvoiceHref = defaultInvoiceHref,
  selectedOrderId = null,
  density = ORDER_DENSITY_DEFAULT,
  expanded = null,
}: {
  orders: AdminOrderSummary[];
  /**
   * 🆕 **P-b:就地展開的那張單 + 要擺進去的明細節點。** `null` = 沒有任何一張展開。
   *
   * 🔴 **由呼叫端產節點、本檔只擺位置**:節點來自 `OrderDetailRoute`(async server component),
   *    本檔零 client、零 hook,**不能也不該**自己去 await 一張明細。
   * 🔴 `orderId` 與 `selectedOrderId` **今天是同一個值**(展開的那一組就是選中色塊那一組),
   *    分成兩個 prop 是因為它們**守的東西不同**:一個決定畫哪一組的色塊,一個決定在哪一組底下塞明細。
   */
  expanded?: { orderId: string; node: ReactNode } | null;
  /**
   * 🆕 P-e-1:「下一步」連結要導去哪。**由呼叫端注入、不在本檔拼字串**(同 `buildOpenHref` 的理由:
   * 要帶著當下篩選與頁碼走,`buildOrderListHref` 是唯一落點)。
   * ⚠️ **有預設值是為了測試裡上百處 render 不必逐一補**,不是為了讓 production 可以不傳:
   *    漏傳的症狀是「按下一步之後篩選被洗掉」—— 由 `page.test.tsx` 釘住 page 真的傳了帶篩選的那支。
   *    (同 `density` / `selectedOrderId` 那兩個預設值的取捨。)
   */
  buildNextHref?: (orderId: string, action: NextStepDo) => string;
  /** 🆕 收款欄可點。預設值只給測試用(同 `buildNextHref` 那條的取捨);production 由 page 注入帶篩選的那支。 */
  buildPayHref?: (orderId: string) => string;
  /** 🆕 入口二:發票 tag 導去哪。測試預設不帶篩選;page 注入帶篩選的那支。 */
  buildInvoiceHref?: (orderId: string) => string;
  /**
   * 片 A-1:面板打開的是哪一張單 —— **拿來畫「選中色塊」,別無他用**。
   * Sean 2026-08-17 逐字:「我在點擊訂單時候,跳出左邊側邊欄位後,**左邊訂單列會有色塊指示是在哪一個訂單**」。
   *
   * 🔴 **值的唯一來源是網址上的 `panel=<id>`**(`readOpenPanelOrderId`),呼叫端已經在讀它 ——
   *    本 prop **沒有新增任何查詢、投影或狀態**,只是把一個原本被丟掉的值接上畫面。
   * ⚠️ **預設 `null` 是為了呼叫端漏傳時「不亮任何一組」**,不是為了讓它可以不傳:
   *    漏傳的症狀是「點開面板左邊沒反應」= 回到改版前的樣子,**看起來像沒做,而不是像壞掉**
   *    ⇒ 守門在 `orders-table.test.tsx`(選中那組有 `data-selected`、其餘沒有;兩個世界都餵)。
   */
  selectedOrderId?: string | null;
  /**
   * L3 片4:列高與字級三檔(Sean 拍 Q3=A 走 URL 參數)。
   * 🔴 **本檔只把它標成 `data-den`,三檔的實際數值全在 `globals.css`** ——
   *    值是視覺規格(OD `overview-desktop.html:171-173`),不該有第二份落在元件裡。
   * ⚠️ 有預設值是為了**呼叫端漏傳時倒向 Sean 拍的預設(寬鬆)**,不是為了讓它可以不傳;
   *    真正防漏傳的是 `buildOrderListHref` 那道必填 + 窮舉守門(連結才是密度會掉的地方)。
   */
  density?: OrderDensity;
  /**
   * #350c:桌機單號連結要導去哪(= `/orders?…&open=<id>`,就地展開;⛔ 2026-09-13 拆面板前叫 `buildPanelHref` / 開右側面板)。
   *
   * 🔴 **由呼叫端注入、不在本檔拼字串**:面板連結必須帶著當下的篩選與頁碼一起走
   * (`order-list-view.ts` 的 `buildOrderListHref` 是唯一落點),否則點開一張單就把篩選洗掉。
   * 🔴 **手機那份連結不吃這個 prop**(主視窗 2026-08-10 裁③、Q5):小螢幕沒有分割空間,
   * 照舊整頁進 `/orders/[id]`。守門把「桌機走注入 href、手機仍是字面路徑」兩邊釘住。
   */
  buildOpenHref: (orderId: string) => string;
}) {
  if (orders.length === 0) {
    // 空狀態**只有一份 markup**,桌機手機共用(不複製第二份)。
    //
    // ── 🔴 2026-08-22:補上規範要求的②③(`docs/design/admin-design-system.md` §6.5.5)──
    //   那一節逐字要求每個空狀態回答三件事:
    //     ① 現在為什麼是空的 ② 他可以做什麼 ③ **做不了的話找誰**
    //   原文只有「目前沒有符合條件的訂單。」= **只有①,而且①還是三種成因裡最含糊的那一句**。
    //   ⚠️ 同一節的警告逐字:「**『篩選篩掉了』寫成『目前沒有資料』會讓員工以為系統壞了**」——
    //   而這一格幾乎一定是篩選造成的(訂單表不會真的空)。
    //
    //   🔴 **③ 這裡不是「找系統維護」** —— 那句話在這裡是錯的:
    //      沒有任何東西壞掉,員工自己就解得開。**照抄格式而不看情境,會做出一個把人推去騷擾維護的空狀態。**
    //      ⇒ ③ 給的是「**還是找不到就這樣做**」:清掉條件重看一次。
    //   📌 「清除」是畫面上真的存在的那顆按鈕(篩選區右下,真瀏覽器實查),不是我編的名字。
    return (
      <div className='text-muted-foreground bg-card flex flex-col gap-1.5 rounded-lg border p-10 text-center text-sm'>
        <p>目前沒有符合條件的訂單 —— 通常是被上面的篩選條件濾掉了,不是系統出問題。</p>
        <p>試著放寬日期範圍,或把付款/出貨狀態改回「全部」。</p>
        <p>還是找不到 ⇒ 按篩選區的「清除」把條件全部清掉,再重新找一次。</p>
      </div>
    );
  }

  return (
    // 🔴 `orders-grid` 是手機卡片 CSS 的唯一掛勾(`app/globals.css` 同名區塊)。
    //    class 名改了要同批改 CSS —— 兩處由 `orders-table.test.tsx` 的
    //    「L2 — `globals.css` 卡片化區塊」那組釘在一起(它**真的讀** `globals.css`)。
    //    ⚠️ 這句話在 R1 時是**錯的字面**:當時測試從頭到尾沒讀過 `globals.css`,
    //    「有守門」是宣稱不是事實(code-reviewer M3、鐵則 11)。守門已於同批補上。
    // 🔴 凍結表頭(2026-09-13):≥1400 時 `globals.css` 把 `.orders-grid` 的 overflow-x 換成 `clip`
    //    (auto 會讓這個 div 變成捲動容器、thead 的 sticky 貼不到視窗)。理由與斷點算式在 globals 那條旁邊;
    //    ⚠️ 不能用 Tailwind utility 寫(`.orders-grid{overflow-x:auto}` 不在 @layer,永遠壓過 utilities —— 實測 `lg:overflow-x-clip` 無效)。
    <div
      className='orders-grid bg-card overflow-x-auto rounded-lg border'
      data-den={density}
      // 🔴 **這裡刻意【沒有】 `tabIndex` / `role` / `aria-label` / `aria-describedby`。**
      //    它們由 `<OrdersCutoffNotice />` 在量到溢出時**動態掛上、沒溢出時拿掉**。
      //    理由(codex R4 must-fix):寫死在這裡的話,**沒有溢出的螢幕也會多一個 Tab 停點,
      //    而且那一區的名字還宣稱「可左右捲動」** —— 對 1728 的使用者那是一句錯的指示。
      //    ⇒ **只有量得到溢出的那一方,才有資格宣告「這裡可以捲」。**
    >
      {/* 11=丙(Sean 2026-08-18 中午):右邊被切掉的欄要在【看不到的人的螢幕上】講出來。
          🔴 它掛在這裡而不是表格外面,是因為**它要 sticky 在這個捲動容器裡** ——
             捲到右邊時這句話自己捲走的話,它就沒在提醒任何人。
          🔴 觸發條件是**真的溢出**(逐欄比「`<th>` 右緣 vs 容器右緣」,配 `ResizeObserver` 與 `scroll`),
             **不是視窗斷點** —— 側邊欄收合 / 瀏覽器縮放 / 字級變大都會改可視寬而視窗寬沒動。
          ⚠️ 這是本表**唯一**的 client component 邊界(勾選欄那顆 `OrderShipCheckbox` 之外);
             表格本體仍是 server component。 */}
      <OrdersCutoffNotice />
      <table className='w-full border-collapse'>
        {/* 🔴 凍結表頭:sticky 在工具列底下(`top` = `OrdersStickyOffset` 量出來的工具列高;沒量到 = 0)。
            `bg-card` 不透明(列捲上來不能透出字);z-20 在列的 `relative z-10` 之上、工具列 z-30 之下。 */}
        <thead className='bg-card sticky z-20' style={{ top: 'var(--orders-sticky-top, 0px)' }}>
          <tr>
            {/* 2b-1:勾選欄(訂單層)。**刻意沒有全選框** —— 理由見 OrderGroup 內同格註解。 */}
            <th className={`${TH} ${CELL.pick}`} aria-label='選取' />
            {/* 🏁 **L3 片2:欄序與四個欄名逐字照 `design-brief` §0-B:1(Sean 2026-08-12 口述的那張清單)。**
                逐字 = `單號 / 日期 / 車種 / 廠牌 / 料號 / 物品名稱 / 數量 / 單價 / 金額 / 客戶 / 狀態 / 發票`
                (勾選與操作是功能欄,不在他那張清單裡、照第二輪處理保留)。

                🔴🔴 **~~Q6=A(Sean 2026-08-06)欄名改短字面 —— 商品品牌→品牌、物品名稱→品名、客戶名稱→客戶~~
                   的「訂單編號 / 品名」兩項已於 2026-08-14 被 Sean 拍 Q3=B 推翻**,逐字選項
                   「以 08-12 為準 —— 改成『單號』『物品名稱』」,而且他是在**選項裡寫明「那等於推翻 08-06 那次拍板」**
                   的前提下選的。⇒ 上面那行舊註解是過期字面,本片一併更正、不留著讓下一個人以為還有效。
                   ⚠️ **`客戶名稱→客戶` 那一項沒有被推翻**(§0-B 那張清單裡也是「客戶」)⇒ Q6=A 只有欄名的前兩項失效。

                ⚠️ **本片只改訂單列表的欄名。** 別的畫面出現的「訂單編號」字面
                   (`app/orders/page.tsx` 搜尋分支說明、`shipment-dialog` 出貨對話框、
                   `refund-exception-resolve` 的 placeholder)是**別的語意**,主視窗明文裁不動。

                🔴 **真正搬家的只有一件:車種與廠牌對調**(車種提到廠牌之前)。其餘欄的位移全是被
                   新增的「單價」推的連帶,不是各自搬家 —— 讀 diff 時別把連帶當成重排。 */}
            {/* 🏁 **P3:日期格同時裝單號**(日期在上、單號在下小字)⇒ 表頭只留「日期」,欄數 15 → 14。
                ⚠️ **欄名沒有改成「日期 / 單號」之類的複合字面** —— 稿 v19 的 `<th class="d">` 逐字就是「日期」,
                   而單號的字面由格子裡那行小字自己帶。 */}
            <th className={`${TH} ${CELL.date}`}>日期</th>
            <th className={`${TH} ${CELL.customer}`}>客戶</th>
            {/* 🆕 P4:來源欄(訂單層)。**欄名逐字「來源」取自稿 v19 的 `<th class="src">`。**
                ⚠️ `orders-table.test.tsx` 原本有一格逐字斷言「表頭**無**『來源 · 管道』」
                —— 那一格翻面的原因只有這一個:**這一欄是刻意加上來的**。 */}
            <th className={`${TH} ${CELL.source}`}>來源</th>
            {/* 🆕 收款(訂單層)。Sean 2026-09-13 拍甲。
                🔴 **欄名是「收款」不是「付款」** —— `orders-table.test.tsx` 有一格逐字釘「**無『付款』欄**」,
                   而那格守的是 2026-08-14 下架的**付款軸五態膠囊**(`PAYMENT_STATUS_LABEL`),
                   與本欄是**兩個不同的東西**(本欄印的是應付餘額的四種字面)。
                   ⇒ 那格改成【雙向釘】:無「付款」欄 **而**「收款」欄在。**不是把它刪掉。** */}
            <th className={`${TH} ${CELL.pay}`}>收款</th>
            <th className={`${TH} ${CELL.vehicle}`}>車種</th>
            <th className={`${TH} ${CELL.brand}`}>廠牌</th>
            <th className={`${TH} ${CELL.sku}`}>料號</th>
            <th className={`${TH} ${CELL.title}`}>物品名稱</th>
            <th className={`${TH} ${CELL.qty} text-right`}>數量</th>
            {/* 🆕 L3 片2 新欄:單價(**品項層**、成交價)。
                🔴 **零資料層工作** —— `unitPrice` 早就在投影裡:型別 `packages/domain/src/order/types.ts:384`、
                   mapper `packages/adapters/src/supabase/mappers/order.ts:334`、
                   投影常數含 `unit_price`(由 `SupabaseOrderAdapter.test.ts:319` 釘著)。本片只是把它畫出來。
                🔴 **鐵則 12② 不中標,但理由要寫下來**:這是**該單成交價**(下單當下實際賣價),
                   不是經銷價表(`price_by_tier` / `price_store` / `cost` 型別層本來就沒有,
                   `mappers/order.ts:129` 逐字「永不夾帶」)。同一列本來就在顯示 `lineTotal`(金額)
                   ⇒ **不新增任何洩漏面**;admin 全 server-render、SSO 閘後。
                ⚠️ 名字很像但**不是**同一個常數:`ORDER_LIST_SELECT`(會員端 own-only)有一條
                   byte-equal 白名單明文**零 `unit_price`**(`SupabaseOrderAdapter.test.ts:175`);
                   後台走的是 `ADMIN_ORDER_LIST_SELECT`。**兩者只差前綴,不看清楚會誤判成違規。** */}
            {/* 🔴 幣別在欄名上講一次(Sean 2026-09-10 拍甲)—— 每一格不再重複印 `NT$ `。
                🛑 **不要寫成「單價(NT$)」** —— 括號會把剛省下來的欄寬吃回去。 */}
            <th className={`${TH} ${CELL.unit} text-right`}>單價 NT$</th>
            <th className={`${TH} ${CELL.amount} text-right`}>金額 NT$</th>
            {/* 🏁 L3 片1:**狀態**(訂單層,八值 = 收款軸 × 貨品軸)原地換掉 A11a-4 的訂貨欄。
                欄名逐字取自 `design-brief` §0-B:1 那張 Sean 給的欄序清單(`…客戶 / 狀態 / 發票`)。 */}
            <th className={`${TH} ${CELL.status}`}>狀態</th>
            {/* 🆕 P8:下一步(訂單層)。定案欄序的最後一格。 */}
            <th className={`${TH} ${CELL.next}`}>下一步</th>
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup
            key={order.id}
            order={order}
            buildOpenHref={buildOpenHref}
            selectedOrderId={selectedOrderId}
            expanded={expanded !== null && expanded.orderId === order.id ? expanded.node : null}
            buildNextHref={buildNextHref}
            buildPayHref={buildPayHref}
            buildInvoiceHref={buildInvoiceHref}
          />
        ))}
      </table>
    </div>
  );
}
