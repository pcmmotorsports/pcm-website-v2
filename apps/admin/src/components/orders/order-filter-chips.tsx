import Link from 'next/link';
import type { AdminOrderFilter, OrderGoodsAxis } from '@pcm/domain';
import { buildOrderListHref, type OrderListDisplayState } from '../../lib/orders/order-list-view';

// order-filter-chips.tsx — 工具列的快速篩選 chip 排(`#484` 片 B-1)。
//
// 真權威 = OD `pcm-admin-order-ui/overview-desktop.html` 的 `.bar .fchip`
// (`:611-614` 面板開 / `:647-649` 面板關,兩處畫的是同一排)。
//
// 🔴 **OD 畫四顆,本片只做兩顆**,另外兩顆各有去處、不是漏做:
//    · `待處理` → `#485`(**Sean 拍板:還沒收錢 = `unpaid` ∪ `partiallyPaid`**
//      —— 出處 commit `4ffda20b` / `a01457be`(兩顆都在 `origin/dev` 上、可達);
//      ~~**實作前要先查 PostgREST 的 OR 語意**…那條沒人查過~~
//      🏁 **2026-08-15 已查完,原句留痕在上、作廢**:出處 `docs/specs/2026-08-15-1-p0-postgrest-or-semantics.md`
//      (commit `b4865c29`)—— **跑起一座丟棄式 PostgREST 實測,不是讀文件推的**。
//      結論:**兩個 `.or()` 疊起來 = AND 且各自括號保住** `(A OR B) AND (C OR D)`;
//      `.or()` 疊 `.in('id',…)` 也是 AND;🔴 **`.or()` 不會自帶 `cancelled_at` 守門,不加就會撈回已取消的單。**)
//      ⚠️ **本行原寫「拍 C = 兩者聯集」,而同一拍板在 commit 記錄裡是 `Q-待處理=B`。**
//      兩份選項清單編號不同、行為描述一致 ⇒ **本檔改引行為與出處,不引字母。**
//      🔴 **通則**:**決策代號(甲/乙/A/B/C)是那一次對話的座標,不是永久識別碼** ——
//      **字母會被拿去查選項表,而選項表可能不是同一份。**(主視窗 2026-08-15 裁定)
//    · `退貨中` → `#500`(**資料面沒有「退款進行中」這個狀態**,而且它要顯示 count = 第二次查詢)
//
// 🔴 **零 JS**:每顆是 `<Link>`,選中態靠**網址**,不靠 client state。
//    ⇒ 它與既有「出貨狀態」下拉**共用同一個 URL 參數**(`goods_axis`),不可能有第二份狀態。
// 🔴 **href 一律走 `buildOrderListHref`**,不自己拼字串 —— 那支有編譯期窮舉守門
//    (`order-list-view.ts` 檔頭為「漏帶參數 = 那一軸靜默消失」記過三次)。

/**
 * 「未到貨」= 哪幾個貨品軸值。**Sean 2026-08-14 拍板甲案**(經主視窗轉達)。
 *
 * 🔴 **`['none', 'ordered']` 不是 `['ordered']`** —— 他是在看過代價之後選的。
 * 🔴🔴 **但我給他的那個代價數字是錯的,更正在此**(R1 must-fix 4 抓到,我重量過):
 *    我當時寫「乙案今天篩出 **0** 筆,13 張單裡沒有 `ordered`」——
 *    **實測 `goods_axis=eq.ordered` = 1 筆**(`PCM-2026-0104`,未取消),
 *    而母 plan `#488` 早就記過那一筆。我把「`in.(ordered,instock,shipped)` = 1」讀成
 *    「三值合計 1、所以 ordered 是 0」,**那 1 筆就是 ordered 本人**。
 *    ⇒ 正確的對照:**乙案 1 筆 / 甲案 8 筆**(甲 = `in.(none,ordered)` 13 筆扣掉 5 張已取消)。
 *    ⚠️ 拍板方向不受影響(1 筆仍遠少於 8,且甲案的語意本來就是「還沒到的全部」),
 *    但**我用錯的數字去要一個拍板**,這件事本身要留在這裡。
 * 🔴 甲案的語意是「**還沒到貨的單全部**」,含「還沒跟廠商訂」——
 *    員工問「什麼還沒到」時要的是一張**待追清單**,而還沒去訂的正是最該追的那種。
 * ⚠️ **本 chip 的筆數會比「全部」少得比想像多**:adapter 在貨品軸有值時**同時排除已取消單**
 *    (`SupabaseOrderAdapter.ts` 的 A1 硬條款)⇒「全部」13 筆、「未到貨」8 筆,
 *    差的 5 筆裡有 5 張是已取消。**這是 Sean 肉眼驗會問的第一句**,寫在這裡免得被當成 bug。
 */
const NOT_ARRIVED_AXES: readonly OrderGoodsAxis[] = ['none', 'ordered'];

/**
 * 🔴🔴 **chip 會設定的欄 —— 這份清單是【單一來源】。**
 *
 * `#1` 片2 之前,「chip 設什麼」與「`isActive` 比什麼」是**兩份分開維護的清單**,
 * 而那正是片1 交出來的那顆定時彈的病根(不是「忘了清」):
 *   按「待處理」→ 再按「全部」⇒ 高亮跳回全部,**清單還是待處理那批** ——
 *   因為「全部」只把 `goodsAxes` 設成 `undefined`,而 `pendingOnly` 被 `...filter` 原封帶過去;
 *   而 `isActive` 當時只比 `goodsAxes`,**`pendingOnly` 根本不在它的比對範圍裡**。
 * ⇒ **修法不是在 `isActive` 補一個 `pendingOnly` 比對** —— 那只會讓現在這一格對,
 *   下一顆 chip 加進來時同一個病再犯。**要的是兩邊由同一個來源產生。**
 *
 * 🔴 **型別層就擋得住**:`ChipFilter` 是 `Partial<Pick<AdminOrderFilter, ChipOwnedKey>>`
 *   ⇒ 某顆 chip 想設一個沒登記在本清單裡的欄,**`tsc` 直接紅**,不是等人發現。
 *   ⚠️ 但型別擋不住「**登記了卻沒被 `isActive` 比對**」—— 那道由下面 `isActive()` 走同一份清單保證,
 *   而**這件事本身有一格測試釘著**(`order-filter-chips.test.tsx` 的「單一來源」那族)。
 */
const CHIP_OWNED_KEYS = ['goodsAxes', 'pendingOnly'] as const;
type ChipOwnedKey = (typeof CHIP_OWNED_KEYS)[number];
/** 一顆 chip 對篩選條件做的事:只准動 `CHIP_OWNED_KEYS` 裡的欄。 */
export type ChipFilter = Partial<Pick<AdminOrderFilter, ChipOwnedKey>>;

type ChipSpec = {
  key: string;
  label: string;
  /** 這顆 chip 生效時的篩選條件;`{}` = 不篩(「全部」)。 */
  filter: ChipFilter;
};

/**
 * 把所有 chip 管的欄清成「不篩」。**從 `CHIP_OWNED_KEYS` 產生,不是手抄第二份。**
 * 🔴 手抄第二份正是這片在修的那個病 —— 兩份清單分開維護,漏一個就是靜默失效。
 */
const CLEARED_CHIP_FILTER: ChipFilter = Object.fromEntries(
  CHIP_OWNED_KEYS.map((key) => [key, undefined]),
) as ChipFilter;

/**
 * 字面逐字取自 OD `:611-613`(`全部` / `未到貨`)。
 * ⚠️ OD 的順序是 `全部 / 待處理 / 未到貨 / 退貨中` —— 本片缺的兩顆進來時要**插回原位**,
 *    不是接在後面(順序也是 OD 字面的一部分)。
 */
const CHIPS: readonly ChipSpec[] = [
  { key: 'all', label: '全部', filter: {} },
  // `#485` 片2:插回 OD 原位(`全部 / 待處理 / 未到貨`),**不是接在後面** —— 順序是 OD 字面的一部分。
  // 定義由片1 落在 `AdminOrderFilter.pendingOnly` 的 docstring(還沒收錢 ∪ 還沒訂貨);
  // 出處 commit `4ffda20b` / `a01457be`。**本檔不重述定義,免得兩處字面各自漂移。**
  { key: 'pending', label: '待處理', filter: { pendingOnly: true } },
  { key: 'not-arrived', label: '未到貨', filter: { goodsAxes: NOT_ARRIVED_AXES } },
];

/**
 * 這顆 chip 是不是「現在生效的那一顆」。
 *
 * 🔴 **比對的是集合,不是「有沒有值」**:`goods_axis=shipped`(從下拉選的)兩顆都不該亮 ——
 *    「全部」不亮是因為有在篩、「未到貨」不亮是因為篩的不是它那組。
 *    只寫 `filter.goodsAxes === undefined` 判「全部」會讓下拉選了別的值時 chip 全暗,那是對的;
 *    但漏了這裡的集合比對,`未到貨` 會在**任何**多值狀態下亮起來。
 * ⚠️ 這裡**排序後比對**,理由只有一個:**順序**。URL 是使用者可以手改的,
 *    `?goods_axis=ordered&goods_axis=none` 與反過來是同一件事。
 *    🔴 **重複值與未知值到不了這裡**(R1 nit 9 更正我上一版講得太寬的理由):
 *    parse 端 `list-params.ts` 的 `pickEnumMulti` 已經逐值白名單 + 去重 + 空折 `undefined`。
 */
function normalizeChipValue(value: ChipFilter[ChipOwnedKey]): string {
  // `undefined` / `false` / 空陣列都是「這一軸沒在篩」—— 三者要正規化成同一個字面,
  // 否則 `pendingOnly: false`(parse 端一律回布林)會與 `undefined` 比不相等,「全部」永遠不亮。
  if (value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.length === 0 ? '' : [...value].sort().join(',');
  return String(value);
}

function isActive(chip: ChipSpec, filter: AdminOrderFilter): boolean {
  // 🔴 **走 `CHIP_OWNED_KEYS`,不是逐欄手寫** —— 這一行就是「兩份清單合成一份」的實作。
  return CHIP_OWNED_KEYS.every(
    (key) => normalizeChipValue(filter[key]) === normalizeChipValue(chip.filter[key]),
  );
}

export function OrderFilterChips({
  filter,
  display,
}: {
  filter: AdminOrderFilter;
  /** 顯示設定要**原樣帶著走**:按 chip 不該把使用者的密度選擇洗掉。 */
  display: OrderListDisplayState;
}) {
  return (
    <div className='flex items-center gap-2'>
      {CHIPS.map((chip) => {
        const active = isActive(chip, filter);
        return (
          <Link
            key={chip.key}
            className='fchip'
            /* 🔴 `page` 固定 **1**:換了篩選條件還停在第 3 頁,常常直接看到空白頁
               (同 `order-keyword-search` 那條 `listHref` 的理由)。 */
            /* 🔴 **先清掉所有 chip 管的欄,再套這顆的** —— 少了 `...CLEARED_CHIP_FILTER`,
               按「全部」時 `pendingOnly` 會被 `...filter` 原封帶過去
               ⇒ 高亮跳回全部、清單還是待處理那批(片1 交出來的那顆定時彈)。 */
            href={buildOrderListHref(
              { ...filter, ...CLEARED_CHIP_FILTER, ...chip.filter },
              display,
              1,
            )}
            /* 🔴 **`aria-current` 不是 OD 的 `aria-pressed`**:`aria-pressed` 的 "Used in roles"
               只有 `button` 一項(MDN 2026-08-14 親讀)⇒ 掛在 `<a>` 上是無效 ARIA,
               螢幕閱讀器不會念出選中態。**只換綁的屬性,不換設計**(值的對應是 token 映射,
               逐項會計寫在 `globals.css` 的 `.fchip` 那段);已登記在 design-brief
               的「OD 內部矛盾」表第 6 列。 */
            aria-current={active ? 'true' : undefined}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
