// CartVehicleMixNotice.tsx — 購物車頂部「這一車混了兩台車」中性橫幅。
//
// plan:`docs/specs/2026-09-03-cart-vehicle-mix-notice-plan.md`(主視窗-87 2026-09-03 批准動工)。
// 判準全在 `lib/cart-vehicle-mix.ts`(純函式、可單測);本檔只負責畫,零判斷。
//
// 🔴 **為什麼另立一支檔而不是塞進 `CartView.tsx`**:`CartView.tsx` 動手前實測 **300 行**,
//   正好踩在鐵則 6 的「>300 警戒」線上 ⇒ 把橫幅塞進去會把它推過線(plan §4 已寫)。
//
// 🛑 **文案是 Sean 的品味(鐵則 R6)** —— 本檔的字面是**待他拍板的暫定版**,不是定稿。
//   端他的時候要附兩個世界的實物:一台車的購物車(不出現)vs 兩台車的(出現)。
//   ⚠️ 改字面時**同時改 `CartVehicleMixNotice.test.tsx` 釘住的那幾句**,否則那道守門會變成
//   「有東西就算過」。
//
// 🔵 **刻意不做的三件(對齊既有那道警語的分寸)**:
//   ①不是紅色 —— 客人很可能沒做錯任何事(他就是有兩台車)
//   ②**不擋結帳** —— 對齊 `CartVehicleField.tsx:74` 逐字「display-only 不擋結帳」
//   ③**不自動改任何一列的車** —— 那是拿猜的條件去動他的東西(車種鐵律零猜)

import type { CartItem } from '@/contexts/CartContext';
import type { UIFitment } from '@/data/mock-products';
import { cartVehicleFitStatus } from '@/components/CartVehicleField';
import { cartVehicleMix } from '@/lib/cart-vehicle-mix';

/** CartView 的一列(只取本元件要的兩欄;`resolved` 是 server 解析後的商品)。 */
export type CartMixLine = { item: Pick<CartItem, 'vehicle'>; resolved: { fitments?: UIFitment[] } };

/**
 * 🔴 **`map` 與 `cartVehicleFitStatus` 刻意放在本元件裡, 不放在 `CartView`**(code-reviewer R1 nit 9):
 *   放在 CartView 時那段接線**沒有任何測試碰得到** —— 實測把 `item.vehicle` 換成 `undefined`、
 *   或讓 `fitStatus` 恆傳 `null`(抑制整個失效), **32 格全綠**(R1 finding 3)。
 *   ⇒ 搬進來之後,接線與畫面在同一支檔、由 `CartVehicleMixNotice.test.tsx` 一起守。
 * 🔵 連帶:`CartView.tsx` 從 316 行回到 ~308(而那是副作用, 不是理由 —— 理由是【接線變得測得到】)。
 * 🟢 判準本身仍是 `lib/cart-vehicle-mix.ts` 的純函式(無 React/DOM 依賴), 這裡只負責接線與畫。
 */
export function CartVehicleMixNotice({ lines }: { lines: readonly CartMixLine[] }) {
  const mix = cartVehicleMix(
    lines.map(({ item, resolved }) => ({
      vehicle: item.vehicle,
      fitStatus: cartVehicleFitStatus(resolved.fitments, item.vehicle),
    })),
  );
  if (!mix.shouldNotice) return null;
  return (
    <div className="cart-mix-notice" role="status">
      <span className="cart-mix-notice-head">這車裡有 {mix.labels.length} 台車的東西</span>
      <span className="cart-mix-notice-list">{mix.labels.join(' · ')}</span>
      {/* 🔴 **本句 2026-09-03 訂正(R1 nit 7)。**
          ~~原句「每一件下面都寫著它是給哪台車的」~~ —— **對未填車的列不成立**:
          那些列渲染的是「+ 選擇車款」(`CartVehicleField.tsx:204`),而混車情境常常是
          幾件填了、幾件沒填 ⇒ 原句會讓 Sean 照著一句假話拍板。 */}
      <span className="cart-mix-notice-hint">往下逐件看，每件都可以各自指定或修改車款。</span>
    </div>
  );
}
