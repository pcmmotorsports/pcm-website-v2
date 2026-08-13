import Link from 'next/link';
import { ORDER_DENSITY_VALUES, type OrderDensity } from '../../lib/orders/order-list-view';

// L3 片4:列表密度切換(寬鬆 / 標準 / 緊湊)。Sean 拍 Q3=A —— 走 **URL 參數**,不走 cookie / localStorage。
//
// 🔴 **零 client 邊界**:三顆是真的 `<Link>`,不是 button + onClick。
//    ⇒ 鍵盤 Tab、中鍵開新分頁、右鍵複製網址、重新整理後狀態還在,一條都沒有失去;
//    而且訂單列表整片維持 server-render(`orders-table.tsx` 檔頭那條鐵則 12 紀律)。
// 🔴 **`aria-pressed` 而不是只有底色**:密度是「哪一檔生效」的狀態,不是導覽 ——
//    只有底色的話,螢幕閱讀器與高對比模式的使用者看不出哪一檔是選中的。
//    (`:current` 那類 CSS 選擇器在這裡不適用:它們認的是 URL,而密度是 URL 的一部分、不是路徑。)
// ⚠️ **不用 `denbtn` 那組 OD class 名**:那是 OD demo 的字面,本 repo 走 Tailwind;
//    形狀(淡底、選中反白)照 OD `overview-desktop.html:174-178`,class 名不照抄。

const LABEL: Record<OrderDensity, string> = {
  loose: '寬鬆',
  std: '標準',
  tight: '緊湊',
};

const BASE =
  'rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted hover:text-foreground';
const ON = 'bg-foreground text-background border-foreground font-semibold';
const OFF = 'bg-card text-muted-foreground';

export function OrderDensityToggle({
  current,
  buildHref,
}: {
  current: OrderDensity;
  /**
   * 產生「切到這一檔」的連結。
   * 🔴 由呼叫端注入、**不在本檔拼字串**:密度連結必須把當下的篩選與頁碼一起帶走
   * (`buildOrderListHref` 是唯一落點),否則切個密度就把篩選洗掉 —— 同單號連結那條紀律。
   */
  buildHref: (density: OrderDensity) => string;
}) {
  return (
    <div className='flex items-center gap-1' role='group' aria-label='列表密度'>
      {ORDER_DENSITY_VALUES.map((d) => (
        <Link
          key={d}
          href={buildHref(d)}
          aria-pressed={d === current}
          data-den-option={d}
          className={`${BASE} ${d === current ? ON : OFF}`}
        >
          {LABEL[d]}
        </Link>
      ))}
    </div>
  );
}
