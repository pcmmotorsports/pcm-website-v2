import Link from 'next/link';
import { OrderShipCheckbox } from './shipping-selection';
import type { AdminOrderSummary } from '@pcm/domain';
import {
  INVOICE_STATUS_LABEL,
  MEMBER_TIER_LABEL,
  ORDER_DENSITY_DEFAULT,
  formatOrderAmount,
  formatOrderItemVehicle,
  formatOrderListDate,
  type OrderDensity,
} from '../../lib/orders/order-list-view';
// L3 片1:狀態八值的字面與配色**全部**由 L1(`f745e04e`)那支純函式算,本檔不自己拼 class。
import { orderStatusView } from '../../lib/orders/order-status-axes';

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

/**
 * `#486` 乙案(2026-08-14 Sean 拍板):操作欄從「取消」兩個字改成 OD 的 **⋯**。
 *
 * 🔴 **只換外觀與入口語意,不換目的地** —— 仍然是 `#cancel`(`order-cancel-block.tsx:73` 的錨點)。
 *    理由:今天訂單層**只有取消一個動作**,那個區塊就是「操作區」本身。
 *    ⚠️ **退款 / 沖銷 / 重寄通知進來的那一天,錨點要改成那個區塊的通用 id、不是繼續指 `#cancel`**
 *    —— 否則員工按 ⋯ 會被丟到「取消訂單」的表單前面,那是全部動作裡最危險的一個。
 *
 * 🔴 **為什麼不是彈出選單**(OD `:1052` 的 `<details class="km">`):2026-08-14 動手前 hit test
 *    證偽了「零 JS `<details>` 彈出選單」—— 現況 3/3 點不到,最後一列還會被 `.orders-grid`
 *    自己的 overflow 夾掉(`#486` 條目有量測表)。甲案要破零 JS、丙案遠超估時
 *    ⇒ Sean 在知道「OD 的意圖不會兌現」之後選乙。**不要在後續片裡「順手」往甲/丙靠攏。**
 *
 * ⚠️ **`⋯` 是 U+22EF(MIDLINE HORIZONTAL ELLIPSIS),逐字取自 OD `:985`**,不是三個句點、
 *    也不是 `…`(U+2026 水平省略號,那顆的基線在下面、在方框裡看起來是沉的)。
 *    ⚠️ **本檔刻意不寫方鈕的尺寸** —— 尺寸只准住 `globals.css`。
 *    🔴 **但不要以為有守門在擋**(R1 F7 更正我原本的說法):密度值單一來源那道守門
 *    只從 CSS 抽 `--od-row-h` 的三個值再反掃本檔 ⇒ 把 `36px`/`15px` 寫進來**完全不會紅**,
 *    只有**桌機那個尺寸**會、而且是**巧合**(它剛好也是 tight 檔的列高)。**這條靠紀律,不靠機制。**
 *    ⚠️ 連這句話裡都不能寫出那個數字 —— 守門是純字串掃描,寫在註解裡照樣紅(我剛剛就撞了一次)。
 */
const OPS_LINK_GLYPH = '⋯';
/**
 * 🔴 **無障礙必要,不是可選** —— `⋯` 對螢幕閱讀器是「midline horizontal ellipsis」這種念不出意思的字。
 *    `title` 同時給滑鼠使用者一個 tooltip:員工第一次看到這一格時,**不用人教也要知道它是什麼**
 *    (Sean 2026-08-11 定調的「操作直覺化」常設準則)。
 */
const OPS_LINK_LABEL = '訂單操作';

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
const TH =
  'px-3 py-2 text-left text-xs font-bold tracking-[1.5px] text-muted-foreground whitespace-nowrap';
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
 * 手機卡片模式的欄位排序與標籤,由 `<td>` 上的 `col-*` class 與 `data-l` 承載
 * (CSS 在 `app/globals.css` 的 `.orders-grid` 區塊)。
 *
 * 🔴 `data-l` **只給手機卡片用** —— 桌機有表頭,再印一次欄名是雜訊。
 *    沒有 `data-l` 的格(勾選 / 單號 / 品名 / 操作)在卡片上是主標或純控件,不掛標籤;
 *    CSS 用 `td:not([data-l])::before{display:none}` 讓它們不長出標籤欄。
 */
const CELL = {
  pick: 'col-pick',
  oid: 'col-oid',
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
  invoice: 'col-invoice',
  ops: 'col-ops',
} as const;

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
    <tbody className='orders-group' aria-label={`訂單 ${order.displayId}`}>
      {rows.map((line, i) => {
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
            //    勾選格與操作格另外設 `relative z-10` 浮在覆蓋層上面 ⇒ 點它們不會誤觸進詳情。
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

            {first ? (
              <td className={`${TD} ${CELL.oid}`}>
                {/* #350c:桌機開右側面板(`/orders?…&panel=<id>`)、手機走整頁 `/orders/[id]`。
                    🔴 **兩個目的地是拍板過的,收斂 markup 不得順手統一它**(主視窗 2026-08-10 裁③、Q5:
                    小螢幕沒有分割空間)⇒ 這一格是全表**唯二**保留雙份 DOM 的地方(另一處是操作格)。
                    代價講明白:兩個 `<a>` 各渲染一次。
                    🔴🔴 **L3 片3 起分流不在本檔** —— 舊做法是 `hidden md:inline` / `md:hidden`(**視窗**斷點),
                    而片3 把卡片化換成**容器**斷點(`@container (max-width: 520px)`)⇒ 兩者會在
                    「面板開著、容器 <520 但視窗很寬」時錯配(卡片模式配桌機面板連結),**而且沒有東西會叫**。
                    ⇒ 顯隱改由 `app/globals.css` 用 `a[data-nav='panel'|'page']` 與卡片化**同一條規則**決定
                    (主視窗 E-419 裁 B:同一條規則 ⇒ 不可能不一致 = 機制,不是慣例)。
                    ⚠️ **在本檔看不出哪顆會顯示** —— 那是這個做法的代價,故留這段指回 CSS。
                    **這與 #447 要解的問題不是同一件** —— #447 是「13 欄的 cell 各寫兩遍」,
                    這裡是「1 個 href 有兩個目的地」;收斂欄位並不會讓兩個目的地變成一個。
                    🔴 兩個都是**真的 `<Link href>`**、不是 onClick ⇒ 鍵盤 Tab、中鍵開新分頁、
                    右鍵複製網址一條都沒有失去。 */}
                <Link
                  href={buildPanelHref(order.id)}
                  data-nav='panel'
                  className='font-medium after:absolute after:inset-0 hover:underline'
                >
                  {order.displayId}
                </Link>
                <Link
                  href={`/orders/${order.id}`}
                  data-nav='page'
                  className='font-medium after:absolute after:inset-0 hover:underline'
                >
                  {order.displayId}
                </Link>
                {/* 🏁 **L3 片6(2026-08-14):「已取消」小膠囊在此下架**(Sean 拍 `Q-E1` = A)。
                    🔴 **理由是重複、不是不重要**:L3 片1 的狀態八值欄**已經**把已取消畫成一顆膠囊
                    (`order-status-axes.ts` 的早退分支 + `CANCELLED_TONE` 虛線框)⇒ 同一張單原本講兩次。
                    🔴 **觸發它下架的是量測、不是潔癖**:這一格多一顆膠囊 ⇒ 已取消的**舊格式**單號
                    實測需要 **190px**,而欄寬只有 132(片5 的值)⇒ 那筆單的單號**被截**。
                    兩條出路是「加寬 58px(再從只剩 1 個字餘裕的品名扣)」或「拿掉重複的那顆」,Sean 選後者。
                    ⚠️ **手機卡片模式沒有損失**:狀態格帶 `data-l='狀態'`,不在 `@container` 收起的那組欄裡
                    ⇒ 已取消在窄畫面照樣看得到,只是換一個位置。
                    ⚠️ **`cancelled` 變數不要跟著刪** —— 下面操作欄還用它決定顯示「—」。 */}
                {/* 🏁 **L3 片1:A11a-2 / A11b 的付款軸小字膠囊已於此下架**(Sean 拍 Q2=A:狀態欄獨扛)。
                    收款軸沒有消失,它變成狀態八值的**前半**(`orderPayAxis`);
                    「未收」的訊號改由狀態膠囊上那圈紅框帶(`order-status-axes.ts` 的 `PAY_MARK`)。
                    🔴 **這是刻意的資訊減量,不是漏掉**:原本一張單同時有「付款膠囊 + 訂貨膠囊 + 已取消 badge」
                    三個訊號,Sean 要的是**一欄看完**;片6 把最後那顆也收掉了。 */}
              </td>
            ) : (
              <td className={`${TD} ${CELL.oid}`} />
            )}

            {/* Q2=A(07-16 晨拍板):日期欄(created_at,訂單層)。
                A11a-2:接 `formatOrderListDate`(同年 `07/25`、跨年 `2025/06/27`)。
                ⚠️ 這曾是 admin `formatOrderDate` 的唯一 production 呼叫端;改接後那支歸零,
                已於 **A9c** 刪除(plan 說的「留給明細頁」是錯的:明細頁走 `formatOrderDateTime`)。 */}
            {first ? (
              <td className={`${TD} ${CELL.date} text-muted-foreground text-xs`} data-l='下單'>
                {formatOrderListDate(order.createdAt)}
              </td>
            ) : (
              <td className={`${TD} ${CELL.date}`} />
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
            <td className={`${TD} ${CELL.unit} text-right tabular-nums`} data-l='單價'>
              {line ? `NT$ ${formatOrderAmount(line.unitPrice.amount)}` : '—'}
            </td>
            {/* 金額:合併態 = 訂單層(只在第一列出值);非合併態 = 逐列該列小計(見 shouldMergeAmount)。
                ⚠️ 兩態的 `data-l` 刻意不同(金額 / 小計)—— 手機卡片沒有表頭,
                標籤是那格語意的唯一載體,而這兩態的語意本來就不同(整單的錢 / 品項的錢)。 */}
            {mergeAmount ? (
              first ? (
                <td className={`${TD} ${CELL.amount} text-right tabular-nums`} data-l='金額'>
                  NT$ {formatOrderAmount(order.total.amount)}
                </td>
              ) : (
                <td className={`${TD} ${CELL.amount}`} />
              )
            ) : (
              <td className={`${TD} ${CELL.amount} text-right tabular-nums`} data-l='小計'>
                {line ? `NT$ ${formatOrderAmount(line.lineTotal.amount)}` : '—'}
              </td>
            )}

            {/* 客戶:名字 + 會員等級小字(A11a-1 起等級不再單獨成欄) */}
            {first ? (
              <td className={`${TD} ${CELL.customer}`} data-l='客戶'>
                {order.customerName ?? '—'}
                <div className='text-muted-foreground text-xs'>
                  {MEMBER_TIER_LABEL[order.tierAtCheckout]}
                </div>
              </td>
            ) : (
              <td className={`${TD} ${CELL.customer}`} />
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
            {first ? (
              <td className={`${TD} ${CELL.status}`} data-l='狀態'>
                <span className={status.capsuleClass}>{status.label}</span>
              </td>
            ) : (
              <td className={`${TD} ${CELL.status}`} />
            )}

            {/* 發票(A11a-5):**訂單層**(開票是整單的事,不是逐品項)。
                🔴 字面**複用** `INVOICE_STATUS_LABEL` —— 明細頁的「開立狀態」欄用的是同一份。
                不另抄一份三態中文:兩份字面必然漂,而 V11 要的正是「三態各自可辨識、且 `voided`
                不與 `not_issued` 同字面」,共用一個 `Record<InvoiceStatus, string>` 讓它**結構上**成立。
                🔴 **Q2b=A:不顯示載具別** —— 載具別在 `orders.invoice` jsonb,A9c 刻意沒放進列表投影
                (零 PII 邊界)⇒ 這裡連拿都拿不到,不是「有資料但選擇不畫」。 */}
            {first ? (
              <td className={`${TD} ${CELL.invoice} text-xs`} data-l='發票'>
                {INVOICE_STATUS_LABEL[order.invoiceStatus]}
              </td>
            ) : (
              <td className={`${TD} ${CELL.invoice}`} />
            )}

            {/* A13 操作欄(**訂單層**:取消是整單的入口,不是逐品項 —— 放品項列的話
                一張三品項的單會冒出三個「取消」,同勾選格那條教訓)。
                🔴🔴 **`relative z-10` 是承重的,不是排版**:整列被單號那個 stretched link 的
                覆蓋層蓋滿,沒有它這顆連結**點不到** —— 而且點下去畫面**確實有反應**
                (整列連結把人帶進面板),看起來像「功能好了」⇒ 這種錯不會被肉眼驗抓到,
                守門釘在 `orders-table.test.tsx`(拿掉 z-10 就紅)。
                🔴 **目的地刻意與同槽的單號連結一致**(桌機=面板 `buildPanelHref`、手機=整頁)——
                兩槽本來就不同(#350c 的動線決定),**不要為了「一致性」統一它**
                ⇒ 同單號格,這裡也是雙份 `<a>` 由斷點分流,是全表僅有的兩處之一。
                🔴 已取消的單顯示「—」:這只是「明顯不該出現時不出現」,**不是權威閘** ——
                能不能取消由明細端 `buildOrderCancelView` / `cancelFormsAllowed` 判(fail-closed),
                這裡不重算一份(重算一份就會漂;同 `order-cancel-block.tsx` 檔頭紀律)。 */}
            {first ? (
              <td className={`${TD} ${CELL.ops} relative z-10 text-xs`}>
                {cancelled ? (
                  <span className='text-muted-foreground'>—</span>
                ) : (
                  <>
                    <Link
                      href={`${buildPanelHref(order.id)}#cancel`}
                      data-nav='panel'
                      aria-label={OPS_LINK_LABEL}
                      title={OPS_LINK_LABEL}
                    >
                      {OPS_LINK_GLYPH}
                    </Link>
                    {/* 🔴 **手機槽刻意不給 `title`**(R1 F12):觸控裝置沒有 hover ⇒ tooltip 永遠不顯示,
                        而 `aria-label` + `title` 同值會讓部分螢幕閱讀器**把「訂單操作」念兩次**
                        (name 取 aria-label、description 取 title)。桌機那槽留著,因為滑鼠 hover 真的看得到。 */}
                    <Link
                      href={`/orders/${order.id}#cancel`}
                      data-nav='page'
                      aria-label={OPS_LINK_LABEL}
                    >
                      {OPS_LINK_GLYPH}
                    </Link>
                  </>
                )}
              </td>
            ) : (
              <td className={`${TD} ${CELL.ops}`} />
            )}
          </tr>
        );
      })}
    </tbody>
  );
}

export function OrdersTable({
  orders,
  buildPanelHref,
  density = ORDER_DENSITY_DEFAULT,
}: {
  orders: AdminOrderSummary[];
  /**
   * L3 片4:列高與字級三檔(Sean 拍 Q3=A 走 URL 參數)。
   * 🔴 **本檔只把它標成 `data-den`,三檔的實際數值全在 `globals.css`** ——
   *    值是視覺規格(OD `overview-desktop.html:171-173`),不該有第二份落在元件裡。
   * ⚠️ 有預設值是為了**呼叫端漏傳時倒向 Sean 拍的預設(寬鬆)**,不是為了讓它可以不傳;
   *    真正防漏傳的是 `buildOrderListHref` 那道必填 + 窮舉守門(連結才是密度會掉的地方)。
   */
  density?: OrderDensity;
  /**
   * #350c:桌機單號連結要導去哪(= `/orders?…&panel=<id>`,開右側面板)。
   *
   * 🔴 **由呼叫端注入、不在本檔拼字串**:面板連結必須帶著當下的篩選與頁碼一起走
   * (`order-list-view.ts` 的 `buildOrderListHref` 是唯一落點),否則點開一張單就把篩選洗掉。
   * 🔴 **手機那份連結不吃這個 prop**(主視窗 2026-08-10 裁③、Q5):小螢幕沒有分割空間,
   * 照舊整頁進 `/orders/[id]`。守門把「桌機走注入 href、手機仍是字面路徑」兩邊釘住。
   */
  buildPanelHref: (orderId: string) => string;
}) {
  if (orders.length === 0) {
    // 空狀態**只有一份 markup**,桌機手機共用(不複製第二份)。
    return (
      <div className='text-muted-foreground bg-card rounded-lg border p-10 text-center text-sm'>
        目前沒有符合條件的訂單。
      </div>
    );
  }

  return (
    // 🔴 `orders-grid` 是手機卡片 CSS 的唯一掛勾(`app/globals.css` 同名區塊)。
    //    class 名改了要同批改 CSS —— 兩處由 `orders-table.test.tsx` 的
    //    「L2 — `globals.css` 卡片化區塊」那組釘在一起(它**真的讀** `globals.css`)。
    //    ⚠️ 這句話在 R1 時是**錯的字面**:當時測試從頭到尾沒讀過 `globals.css`,
    //    「有守門」是宣稱不是事實(code-reviewer M3、鐵則 11)。守門已於同批補上。
    <div className='orders-grid bg-card overflow-x-auto rounded-lg border' data-den={density}>
      <table className='w-full border-collapse'>
        <thead>
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
            <th className={`${TH} ${CELL.oid}`}>單號</th>
            <th className={`${TH} ${CELL.date}`}>日期</th>
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
            <th className={`${TH} ${CELL.unit} text-right`}>單價</th>
            <th className={`${TH} ${CELL.amount} text-right`}>金額</th>
            <th className={`${TH} ${CELL.customer}`}>客戶</th>
            {/* 🏁 L3 片1:**狀態**(訂單層,八值 = 收款軸 × 貨品軸)原地換掉 A11a-4 的訂貨欄。
                欄名逐字取自 `design-brief` §0-B:1 那張 Sean 給的欄序清單(`…客戶 / 狀態 / 發票`)。 */}
            <th className={`${TH} ${CELL.status}`}>狀態</th>
            {/* A11a-5:發票欄(訂單層)。出貨欄(A11a-6)前置在第 2 批,故本表暫時是訂貨→發票相鄰。 */}
            <th className={`${TH} ${CELL.invoice}`}>發票</th>
            {/* A13(訂單列表操作欄)。
                🔴 **與 backlog #372 的 OP-A13(沖銷入口)是兩件事**,別靠字面認親。 */}
            <th className={`${TH} ${CELL.ops}`}>操作</th>
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup key={order.id} order={order} buildPanelHref={buildPanelHref} />
        ))}
      </table>
    </div>
  );
}
