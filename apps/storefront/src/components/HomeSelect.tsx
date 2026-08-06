// HomeSelect.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a L210 加 ProductCard tier prop、storefront 走 server-side tier 預算 tierLabel conceptually equivalent)
// (N°02 · New Arrivals · 最新商品〔M-4a 前菜 D 授權覆蓋 design「The Selection · 編輯精選」〕、4 ProductCard、main-d 真資料接入點)
//
// d1 階段:用 MOCK_PRODUCTS.slice(0, 4) 對齊 design 字面 window.PCM_DATA.products.slice(0, 4)
// d2 階段:props.featured 真資料(server-side fetch from SupabaseProductAdapter.listByCategory('碳纖維部品'))
//          (category M-1-16b 後 Sean 2026-06-01 拍 A 覆蓋 d2 '操控部品'、RPM 真資料在'碳纖維部品')
//          MOCK_PRODUCTS import 移除、empty / error UI 字面 Sean 2026-05-09 拍板新增
//
// 'use client':本元件用 ProductCard(client component);導航走 href(Next.js Link、SEO 真 anchor)
//   🔴 D5a(2026-08-05)編號重標:OD `README.md`「區塊順序(第 7 步之後)」逐字
//      「編號是位置標記不是內容 id,所以聚焦與服務對調後編號跟著位置走」⇒ 本檔編號隨新位置改。
//      權威字面 = OD `direction-b-layout-01-graphite-ember.html` 裡的 `b-select-title` 那顆 `N°02`。
//      🔴 D5d 順手更正(同族):此處原寫的行號實查已漂掉 —— 該稿當天仍在被改。
//         ⇒ **OD 稿一律不引行號、引逐字字串用 grep 找**;也不補新行號(R3 F4)。
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { FeaturedResult } from '@/lib/products';
import { ProductCard } from './ProductCard';

export type HomeSelectProps = {
  featured: FeaturedResult;
};

export function HomeSelect({ featured }: HomeSelectProps) {
  // d1 階段 tweaks default(對齊 design HomePage tweaks panel default)、d2 / 後續 slice tweaks panel 落地時 hoist
  const tweaks = { showRedPrice: false, badgeStyle: 'minimal' as const };

  // ── H6:橫捲軌道的左右箭頭 ────────────────────────────────────────────────
  // 🔴 **OD 只畫了箭頭、沒有接線**(原型全檔零 JS 命中 `.b-select-arrow`),但它連 `:disabled`
  //    的樣式都寫了 ⇒ 意圖很明確。這裡接起來:不接的話那是兩顆看起來能按、按了沒反應的按鈕。
  //    捲動本身是原生的(`overflow-x` + `scroll-snap`),箭頭只是「捲一格」的便利入口 ——
  //    所以**沒有箭頭也還是能用**(觸控滑動、鍵盤在軌道上按方向鍵),這是刻意的降級順序。
  const trackRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: true });
  /**
   * 軌道到底捲不捲得動。🔴 **R1 M1 抓到的真情境**:正式站 `fetchFeaturedProducts` 只取 4 筆
   * (`lib/products.ts` 的 `limit: 4`),而桌機軌道是 5 格 ⇒ ≥1201px 時內容根本填不滿一頁、
   * `scrollWidth <= clientWidth`。當時的寫法會把**兩顆箭頭都設成 disabled** = 畫兩顆死按鈕。
   * ⇒ 捲不動時整組箭頭**不畫**(同「泛白磚不畫箭頭」那條拍板的精神:沒有去處就不要留 affordance)。
   * ⚠️ 這只治了「按鈕看起來壞掉」那一半;**右側會空一格**是資料面的事(要幾筆是產品決定),
   *    已整成決策題送主視窗,不在本片自行拍板。
   */
  const [scrollable, setScrollable] = useState(false);

  const syncEdge = useCallback(() => {
    const el = trackRef.current;
    if (!el) {
      // R1 nit:軌道消失(切到 empty/error 分支)時要回到「兩端都到底」,否則會留下兩顆按了沒反應的箭頭
      setEdge({ start: true, end: true });
      setScrollable(false);
      return;
    }
    // 2px 容差:`scrollWidth`/`clientWidth` 取整而 `scrollLeft` 是小數,175% 縮放下誤差常 >1px
    const max = el.scrollWidth - el.clientWidth;
    setScrollable(max > 2);
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
  }, []);

  useEffect(() => {
    // 🔴 `syncEdge()` 要在 **early return 之前**跑:軌道消失(切到 empty/error 分支)時
    //    effect 會因為 deps 改變而重跑,若先 return 就不會重算 ⇒ `scrollable` 卡在舊的 true、
    //    箭頭留在畫面上按了沒反應。這是本片自己新增的測試抓到的。
    syncEdge();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', syncEdge, { passive: true });
    // 視窗改變寬度時每格寬度會變 ⇒ 界線也要重算(否則箭頭會停在錯的 disabled 狀態)
    window.addEventListener('resize', syncEdge);
    return () => {
      el.removeEventListener('scroll', syncEdge);
      window.removeEventListener('resize', syncEdge);
    };
  }, [syncEdge, featured.products.length]);

  /** 捲一格 = 一張卡 + 一道間距。用實測的第一張卡寬度,不寫死 —— 每個斷點的格寬都不同。 */
  const nudge = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    // 🔴 gap 的 16 與 `home.css` 的 `.b-carousel { gap: 16px }` 是**同一個數字的兩份**,
    //    守門在 `styles/home.test.ts`(那條同時釘住 gap 與這裡的步進)。
    const first = el.firstElementChild as HTMLElement | null;
    if (!first) return; // 軌道只在有商品時才 render ⇒ 這裡等於防禦;不寫 fallback 假裝有別條路
    el.scrollBy({ left: dir * (first.getBoundingClientRect().width + 16), behavior: 'smooth' });
  };

  // 三條 UI 分支(對齊 Sean 2026-05-09 d2 拍板 Q-empty=b / Q-error=b):
  //   - error → 「載入失敗、請稍後再試」
  //   - empty(error=false 且 products.length===0)→ 「目前沒有商品」
  //   - 正常 → render 4 個 ProductCard
  // empty / error 字面 design-reference 無對應、本 slice 新增、字面源 Sean 拍板。
  // 視覺用 inline style + className `ed-select-empty` hook(未來 design 可加 CSS 規則對齊)、
  // 不修 design 真權威 styles/home.css(對齊 lessons §1.1「直接搬」+ d2 範圍紀律)
  const isError = featured.error;
  const isEmpty = !isError && featured.products.length === 0;

  return (
    <section data-reveal className="b-select">
      {/* 🔴 H6:表頭改 OD 的 `.b-select-head`(標題列 + 右側「查看全部 + 左右箭頭」)。
          ⚠️ **OD 的副標「若有設定愛車,此處顯示該車適用商品」刻意不搬** —— 那句在描述
             「依愛車狀態換標題/換內容」那個功能,而該功能已被 M-4a 業務拍板**凍結**
             (標題恆為 New Arrivals;`D-122-A` Q1=B 逐字「本板只覆蓋版面」)。
             搬進來就是對客人承諾一個站上沒有的行為 = 文案說謊,不是版面。 */}
      <div className="b-select-head">
        <h2 className="b-select-title">
          <span className="ed-mono">N°02</span>
          {/* M-4a 前菜 D:授權覆蓋 design 文案「The Selection · 編輯精選」→「New Arrivals · 最新商品」
              (Sean 2026-07-12 go;本區資料已改最新商品〔created_at 遞減〕、標籤對齊語意 + 既有「查看所有新品」CTA;
              design-reference 未同步、此為業務 override、勿調回,同全站灰字調深(0de825e)override 精神) */}
          <span>New Arrivals · 最新商品</span>
        </h2>
        <div className="b-select-actions">
          {/* 字面維持「查看所有新品」(M-4a 業務 override 的既有字面),不換成 OD 的「查看全部」——
              同上,OD 覆蓋的是版面。 */}
          <Link href="/products?filter=new" className="ed-link ed-link-sm">
            <span>查看所有新品</span>
            <span className="ed-link-arrow" aria-hidden="true">→</span>
          </Link>
          {scrollable && (
          <div className="b-select-nav">
            <button
              type="button"
              className="b-select-arrow"
              aria-label="上一頁商品"
              disabled={edge.start}
              onClick={() => nudge(-1)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="b-select-arrow"
              aria-label="下一頁商品"
              disabled={edge.end}
              onClick={() => nudge(1)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
          )}
        </div>
      </div>
      {isError ? (
        <div
          className="ed-select-empty"
          style={{
            padding: '60px 0',
            textAlign: 'center',
            color: 'var(--c-text-3)',
            fontSize: '13px',
            letterSpacing: '0.04em',
          }}
        >
          載入失敗、請稍後再試
        </div>
      ) : isEmpty ? (
        <div
          className="ed-select-empty"
          style={{
            padding: '60px 0',
            textAlign: 'center',
            color: 'var(--c-text-3)',
            fontSize: '13px',
            letterSpacing: '0.04em',
          }}
        >
          目前沒有商品
        </div>
      ) : (
        // 橫捲軌道:捲動是原生的(`overflow-x` + `scroll-snap`),箭頭只是便利入口。
        // 🔴 `.b-carousel-item` 是**外層包裝**:OD 那一層是 `<a class="b-carousel-item">` 自己,
        //    而本 repo 的 `ProductCard` 已經自帶連結與 `article.pcard` ⇒ 這裡只補軌道用的
        //    flex-basis 那一層,不去動卡片內部結構。
        <div className="b-carousel-wrap">
          {/* 🔴 R1 M2:`tabIndex` / `role` / `aria-label` 三件是**讓檔頭那句「鍵盤也能捲」成真**的東西 ——
              Chrome/Firefox 對可捲容器有「自動可聚焦」的行為,**Safari 沒有** ⇒ 不寫的話
              Safari 的鍵盤使用者在這一區完全動不了(疊上 4 筆商品時箭頭又不畫,就是死路)。 */}
          <div
            className="b-carousel"
            ref={trackRef}
            tabIndex={0}
            role="group"
            aria-label="最新商品橫捲"
          >
            {featured.products.map(p => (
              <div key={p.id} className="b-carousel-item">
                <ProductCard
                  p={p}
                  showRedPrice={tweaks.showRedPrice}
                  badgeStyle={tweaks.badgeStyle}
                  // #5b 修(2026-07-03):原 onClick router.push('/products/'+p.id) 用 hashIdToNumber 雜湊數字、
                  //   非真 slug → 導向不存在網址 → 404(Sean 回報「點進去商品錯誤」);改 href={'/products/'+p.slug}
                  //   對齊 ProductsPage / ProductPage 相關商品的正確 slug 導航。
                  href={`/products/${p.slug}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
