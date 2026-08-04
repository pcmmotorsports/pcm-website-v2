// BrandPageCategories.tsx — 品牌介紹頁的「代表分類」chips(D2e-1;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1447-1458、組裝 :2016-2018、CSS :690-712、RWD :906 與 :923)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// ⚠️ 骨架 :1447-1450 的抬頭逐字:「這裡**刻意不放件數**。這一列的工作是『篩選』不是『報數』,
//    各品牌在各分類的實際分佈沒有資料,不編。要顯示件數的話由後台帶,不要寫死。」
//    ⇒ 順手加一個 `(12)` 就是編數字,不要做。
//
// 實測資料形狀(2026-08-04,對 20 家求值):52 筆 / 12 種分類名 / 每家 **1 到 7 個**
// (1個6家、2個4家、3個7家、4個1家、6個1家、7個1家)⇒ 版面要吃得下單一 chip 到七個,
// 所以 `.bp-chips` 是 flex-wrap、不是固定欄數。

import Link from 'next/link';
import type { BrandContent } from '@/data/brand-content-types';
// bp-* 樣式與 `.bp-page` scope 由 `BrandPageRoot.tsx` 一併提供(D3a 收斂;理由見該檔檔頭)。
import { brandCatalogueUrl } from '@/lib/brand-url';

export function BrandPageCategories({ brand }: { brand: BrandContent }) {
  return (
    <section className="bp-cats">
      <div className="bp-cats-inner">
        <div className="bp-sec-label">Categories</div>
        {/* 這層沒有 class 的 div 是骨架 :1454 就有的 —— 沒有它,`.bp-chips` 會直接變成
            grid item 排在第二欄,單獨一個子元素時看不出差別,但它是整頁一致的兩欄結構。 */}
        <div>
          <div className="bp-chips">
            {brand.categories.map(([name, colorIndex]) => (
              // 🔴 `colorIndex === 0` 時**不掛 data-cat**(組裝 :2016-2017 逐字:
              //    「0 = 不在首頁那 11 類裡,不掛 data-cat,吃 .bp-chip 預設的中性灰」)。
              //    寫成 `data-cat="0"` 的話會落到一條不存在的 `[data-cat="0"]` 規則上 ——
              //    畫面**看起來一樣**(仍吃基礎規則的 --cat-8),所以這個錯改不改都沒症狀,
              //    直到哪天有人補了 `[data-cat="0"]` 才會突然變色。實測 52 筆中 2 筆為 0。
              // 🔴 分類名是**純文字**:設計稿對它走 esc()(:2018),不過 BrandRichText。
              //    實測 12 種名稱零標記。
              // 設計稿是裸 `<a>`;正式站一律走 next/link(同 D2b 把麵包屑與兩顆 CTA
              // 換成 `<Link>` 的處理)—— route adaptation、不是 design 偏離。
              <Link
                className="bp-chip"
                key={name}
                href={brandCatalogueUrl(brand.slug, name)}
                {...(colorIndex ? { 'data-cat': String(colorIndex) } : {})}
              >
                {name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
