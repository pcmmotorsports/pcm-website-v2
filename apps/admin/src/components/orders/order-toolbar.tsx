import type { AdminOrderFilter } from '@pcm/domain';
import { buildOrderListHref, type OrderListDisplayState } from '../../lib/orders/order-list-view';
import { OrderDensityToggle } from './order-density-toggle';
import { OrderFilterChips } from './order-filter-chips';

// order-toolbar.tsx — 訂單列表最上面那一列(標題 + 快速篩選 chip + 密度 + 共 N 筆)。
//
// 🔴🔴 **本檔是從 `app/orders/page.tsx` **原封搬出來**的(`#485` 片5a),不是重寫。**
//    搬移的機械證明寫在 `order-toolbar.test.tsx`:JSX 逐字對照 `git show <前一顆>:page.tsx`
//    的那 53 行,**只允許兩種差異**:①整段 dedent 2 格 ②JSX 註解 `{/* */}` 改成一般註解
//    —— **兩者都不進 render 結果**,而那一格直接比對 `renderToStaticMarkup` 的字串。
//
// 🔴 **為什麼要抽**:這一列的正確性(chip 塞不塞得下、觸控命中區)**只有真瀏覽器量得到**,
//    而 `page.tsx` 是會抓資料的 async server component、渲染不動。
//    抽成純元件之後才接得上 `cancel-forms-browser.test.tsx` 那條現成 harness(片5b)。
//    ⚠️ **本片只搬,不加測試以外的任何行為** —— 新的量測是片5b。

export type OrderToolbarProps = {
  filter: AdminOrderFilter;
  display: OrderListDisplayState;
  /** 密度連結要帶**當下這一頁**,不是固定 1(理由在下方註解)。 */
  page: number;
  total: number;
  loadFailed: boolean;
};

export function OrderToolbar({ filter, display, page, total, loadFailed }: OrderToolbarProps) {
    /* 🔴 `#484` 片 B-1:chip 排照 OD `.bar` 的**位置**
        (`overview-desktop.html:609-614`:`<h2>訂單</h2>` 之後緊接四顆 `.fchip`)。
        ⚠️ **只有位置照搬,不是逐字**(R1 nit 7):我方沒搬 `.bar` 本身
        (OD `:91` 34px 高的 bar、`:92` h2 13px),用的是既有的 `h1 text-2xl` + flex。

        🔴🔴 **`#485` 片3:窄版 chip 改排自己一行(主視窗 2026-08-15 裁【甲】)。**
        ⚠️ **OD 只有桌機稿,窄版沒有真權威** —— 這是版面決定,不是搬 design。
        裁定的依據是量到的數,不是偏好(兩案代價各量過一次):
          · 現況 390:三顆 chip 擠不下 ⇒ **字在 chip 裡折兩行**,「待處理」實測 46×**62**、
            「全部」39×**44**,整列 64px。**這不是「有點擠」,是已經壞掉的畫面。**
          · 乙案(窄版藏掉密度鈕)被否掉,因為**密度在卡片模式下是真的有效**:
            實測字級 14→13→12、列高 25→23.5→22(量法做過兩向對照:注入 `!important`
            讓它「不該變」時回報沒變、移除後回報有變 ⇒ 分得出「真沒變」與「我量不到」)。
            **而手機正是最需要它的地方。**
          · 甲案代價 ≈ 0:整列**現在就已經是兩層**,而三顆 chip 單獨一列只要 **184px**,
            窄版可用 **342px**(⚠️ 原寫 358 —— 探針用 `p-4` 且沒扣側欄,真幾何見 `#485` 片4)⇒ 近一倍餘裕。

        🔴 **做法是「讓 chip 那組換到自己一行」,不是給 chip 加 `white-space: nowrap`。**
           `nowrap` 已實測過:它只把擠壓**轉嫁**給右邊那組,總寬需求一點沒少。
        🔴 **也不是加 `padding` 撐觸控區** —— `#466` 的設計是 `::after` 熱區
           (`globals.css` 的 `.orders-grid .col-ops a::after`;**grep 選擇器、不記行號** ——
           行號會被任何一次上游插入靜默推移,`#485` 片5 前實際發生過),
           加 padding 正是那條裁定禁止的做法。

        版面:`flex-wrap` + 右組 `ml-auto`(桌機等同原本的 `justify-between`);
        窄版 chip 組 `order-last basis-full` ⇒ 它自己佔滿一行、被推到第二行。
        斷點取 `md`(768)而非 `sm`(640):768 是驗收要求不得回歸的寬度,取 `md` 讓
        640–767 這段也走窄版排法 —— 那段扣掉側欄之後不保證塞得下整列。
        🔴 **這裡的數字我更正過一次,錯法留著**(2026-08-15,本片剛落地後量候選名字時撞到):
          原句寫「整列自然寬(**477px**)」。**477 這個數不是整列寬,是「整列 + `p-4` 外距 32」**
          —— 出處算式 `244(標題+三顆 chip) + 201(密度鈕+共 N 筆) + 32(外距) = 477`,
          **而 244+201 = 445 才是整列寬**(真瀏覽器對改版前 markup 複量,一致)。
        ⇒ **改版後**(本片加了 `gap-x-3`,chip 組與右組之間多 12px):
          **整列自然寬 = 457**、要不被擠壓的**容器**寬 = 457 + 32 = **489**。
        ⚠️ **裁定不受影響**(640 扣掉側欄與外距後仍 < 457,取 `md` 依然是保守的那一邊),
           **但「量到的東西」與「標籤」不一致就是假字面** —— 這是同一天第二次同型錯
           (前一次:把壓縮後的寬度當成需要的寬度)。
        `gap-y-1`(4px)不是隨手挑的:32(標題列)+ 4 + 26(chip 列)= **62 ≤ 現況 64**。 */
  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
      <h1 className='text-2xl font-semibold'>訂單</h1>
      <div className='order-last basis-full md:order-none md:basis-auto'>
        <OrderFilterChips filter={filter} display={display} />
      </div>
      <div className='ml-auto flex items-center gap-4'>
        {/* L3 片4:密度切換。🔴 `page` 帶**當下這一頁**、不是固定 1 ——
            切密度不是換篩選條件,不該把人踢回第一頁(對照上面搜尋框那條刻意給 1 的理由)。 */}
        <OrderDensityToggle
          current={display.density}
          buildHref={(density) => buildOrderListHref(filter, { density }, page)}
        />
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 筆</p>}
      </div>
    </div>
  );
}
