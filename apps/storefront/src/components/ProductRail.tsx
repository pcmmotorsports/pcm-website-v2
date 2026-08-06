// ProductRail.tsx — 商品橫捲軌道(N°02 的機制抽出來、三區共用)
//
// 由來:Sean 2026-08-07 拍板「品牌頁『熱門商品』+ 會員中心『為你推薦』都改成首頁 N°02 同款
// 橫向滑動一列」,並要求**復用整套、不寫第二套**(主視窗 `D-156-A`)。
// 原本這整套機制寫死在 `HomeSelect.tsx` 裡,區塊專屬字面(標題、連結、aria-label、空/錯文案)
// 也一起寫死 ⇒ 直接複製給另外兩區就是三份幾乎一樣、各自維護的 JSX+CSS,正是「不寫第二套」要避免的。
// ⇒ 這一片(R-1)只做「抽出來 + 首頁接回去」,**首頁的輸出一個字都不能變**
//   (驗收:`HomeSelect.test.tsx` / `home.test.ts` / `products-featured-limit.test.ts` 三支一字不改仍綠)。
//
// 🔴 CSS 沿用既有的 `.b-select*` / `.b-carousel*`,**沒有搬檔、沒有改任何一條規則**:
//    `home.css` 本來就由 `app/layout.tsx` 全域 import ⇒ 那些 class 在每一頁都拿得到。
//    ⚠️ 但那些規則吃 7 個 `--ed-*` token,而 token 只定義在 **`.ed-page`**(首頁專屬作用域,
//    `home.css` 開頭那塊)。品牌頁與會員中心都沒有 `.ed-page`
//    (`app/brands/[slug]/page.tsx` 的註解已逐字記過為什麼刻意不掛)⇒ 那些宣告會**整條失效而且無聲**
//    (未定義的 custom property 讓宣告在計算值階段作廢)。
//    也**不能拿全域 token 硬換**:`--ed-c-ink: #0a0a0a` ≠ `--c-text: #121214`、
//    `--ed-c-rule-control` 全域沒有對應,而 `--c-surface` / `--c-surface-2` 帶暗色模式覆寫、
//    換過去等於給首頁沒有的行為。
//    ⇒ 非首頁的用法要**另給一層 token 作用域 class**(純加法、不動現有規則),那部分留 R-2 有真消費者時再加。
//    (原本 plan 提的是「加 fallback `var(--ed-gutter, 48px)`」——**不可行**:`home.test.ts` 斷言的是
//     `scroll-padding-left: var(--ed-gutter)` 的字面,加了 fallback 那條正規式就不匹配,
//     等於自己打破自己訂的「首頁零變更」驗收。)
// 🔴 design 真權威:`.b-select*` / `.b-carousel*` 的字面來源記在 `styles/home.css` 的
//    「05 · SELECT」段落開頭(OD `direction-b-layout-01-graphite-ember.html`;grep `b-select-title`)。
//    抽檔之後鐵則 1 的追溯線不能只剩 CSS 那一條 ⇒ 這裡留指標。
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MockProduct } from '@/data/mock-products';
import { ProductCard } from './ProductCard';

export type ProductRailProps = {
  products: MockProduct[];
  /** 取數/查詢失敗。與「取到 0 筆」是兩件事、文案不同(對客人的意思不一樣)。 */
  error?: boolean;
  /** 標題左側的編號標(首頁 N°02 用;其他區不給就不畫)。 */
  eyebrow?: string;
  title: string;
  viewAllHref: string;
  viewAllLabel: string;
  /** 軌道的 `aria-label`。各區內容不同,讀屏要念得出是哪一區的橫捲。 */
  ariaLabel: string;
  /**
   * 0 筆時要對客人說什麼。**刻意可省**:不給就整區不渲染。
   * 🔴 品牌頁現行是 `products.length === 0 → return null`,而且註解逐字寫過理由
   * (「不留空骨架、也不自己編一句『目前沒有商品』—— 對客人說什麼是文案決策」,backlog #315 未拍)。
   * 必填的話 R-2 會被迫替它編一句文案 = 替 Sean 拍板。
   */
  emptyText?: string;
  errorText: string;
  /**
   * 捲動進場揭示。**opt-in**,不是預設。
   * 🔴 原本 `data-reveal` 寫死在這顆 section 上,但品牌頁 Sean 2026-08-04 拍板 C
   * 「捲動揭示先不做」(backlog #316,`styles/brand-page.test.ts` 有記)⇒ 寫死的話 R-2 會在
   * 品牌頁種一個與拍板反向的屬性,而且三綠不會紅。
   */
  reveal?: boolean;
  /** 透傳給 `ProductCard` 的外觀旋鈕(首頁 N°02 有自己的一組)。 */
  showRedPrice?: boolean;
  /**
   * 🔴 **刻意不給預設值**:給了就是 `ProductCard` 預設之外的第二份,ProductCard 改預設時
   * 三區 rail 會靜默停在舊值、與站上其他呼叫點分岔。`undefined` 直接落到 ProductCard 自己的預設。
   */
  badgeStyle?: 'minimal' | 'pill' | 'corner' | 'none';
};

// 空/錯狀態的 inline style。原本在 HomeSelect 裡寫了兩份一模一樣的字面,抽出來共用一份。
// 🔴 文案編號是 Sean 2026-05-09 拍板的(Q-empty=b / Q-error=b);**刻意用 inline style + 只留
//    `ed-select-empty` 當 hook**,不去改 design 真權威 `styles/home.css` —— 這兩個狀態是 design
//    沒畫的業務 override,寫進 CSS 檔會讓下一個人以為它是稿上有的東西。
const STATE_STYLE = {
  padding: '60px 0',
  textAlign: 'center',
  color: 'var(--c-text-3)',
  fontSize: '13px',
  letterSpacing: '0.04em',
} as const;

export function ProductRail({
  products,
  error = false,
  eyebrow,
  title,
  viewAllHref,
  viewAllLabel,
  ariaLabel,
  emptyText,
  errorText,
  reveal = false,
  showRedPrice,
  badgeStyle,
}: ProductRailProps) {
  // ── 橫捲軌道的左右箭頭 ────────────────────────────────────────────────
  // 🔴 **OD 只畫了箭頭、沒有接線**(原型全檔零 JS 命中 `.b-select-arrow`),但它連 `:disabled`
  //    的樣式都寫了 ⇒ 意圖很明確。這裡接起來:不接的話那是兩顆看起來能按、按了沒反應的按鈕。
  //    捲動本身是原生的(`overflow-x` + `scroll-snap`),箭頭只是「捲一格」的便利入口 ——
  //    所以**沒有箭頭也還是能用**(觸控滑動、鍵盤在軌道上按方向鍵),這是刻意的降級順序。
  const trackRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: true });
  /**
   * 軌道到底捲不捲得動。🔴 真情境:取數若少於桌機軌道格數(5),`scrollWidth <= clientWidth`,
   * 兩顆箭頭會雙雙 disabled = 畫兩顆死按鈕。
   * ⇒ 捲不動時整組箭頭**不畫**(同「泛白磚不畫箭頭」那條拍板的精神:沒有去處就不要留 affordance)。
   * ⚠️ 這只治了「按鈕看起來壞掉」那一半;**右側會空一格**是資料面的事(要幾筆是產品決定)。
   */
  const [scrollable, setScrollable] = useState(false);

  const syncEdge = useCallback(() => {
    const el = trackRef.current;
    if (!el) {
      // 軌道消失(切到 empty/error 分支)時要回到「兩端都到底」,否則會留下兩顆按了沒反應的箭頭
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
    //    箭頭留在畫面上按了沒反應。(守門在 `HomeSelect.test.tsx` 的 rerender→empty 那條。)
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
  }, [syncEdge, products.length]);

  /** 捲一格 = 一張卡 + 一道間距。用實測的第一張卡寬度,不寫死 —— 每個斷點的格寬都不同。 */
  const nudge = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    // 🔴 這個 16 與 `home.css` 的 `.b-carousel { gap: 16px }` 是**同一個數字的兩份**,
    //    守門在 `styles/home.test.ts`(那條同時釘住 gap 與這裡的步進)——
    //    否則改 gap 會讓箭頭步進靜默錯位(每按一次偏 n px),而三綠全綠。
    const first = el.firstElementChild as HTMLElement | null;
    if (!first) return; // 軌道只在有商品時才 render ⇒ 這裡等於防禦;不寫 fallback 假裝有別條路
    el.scrollBy({ left: dir * (first.getBoundingClientRect().width + 16), behavior: 'smooth' });
  };

  const isEmpty = !error && products.length === 0;
  // 0 筆而呼叫端沒給空狀態文案 ⇒ 整區不渲染(見 `emptyText` 的 doc:替客人編一句文案是拍板,不是實作)。
  if (isEmpty && emptyText === undefined) return null;

  return (
    // `data-reveal` 走 opt-in:寫死的話 R-2 會在「拍板先不做捲動揭示」的品牌頁種下反向屬性。
    <section {...(reveal ? { 'data-reveal': true } : {})} className="b-select">
      {/* 表頭 = OD 的 `.b-select-head`(標題列 + 右側「查看全部 + 左右箭頭」)。 */}
      <div className="b-select-head">
        <h2 className="b-select-title">
          {eyebrow ? <span className="ed-mono">{eyebrow}</span> : null}
          <span>{title}</span>
        </h2>
        <div className="b-select-actions">
          <Link href={viewAllHref} className="ed-link ed-link-sm">
            <span>{viewAllLabel}</span>
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
      {error ? (
        <div className="ed-select-empty" style={STATE_STYLE}>{errorText}</div>
      ) : isEmpty ? (
        <div className="ed-select-empty" style={STATE_STYLE}>{emptyText}</div>
      ) : (
        // 橫捲軌道:捲動是原生的(`overflow-x` + `scroll-snap`),箭頭只是便利入口。
        // 🔴 `.b-carousel-item` 是**外層包裝**:OD 那一層是 `<a class="b-carousel-item">` 自己,
        //    而本 repo 的 `ProductCard` 已經自帶連結與 `article.pcard` ⇒ 這裡只補軌道用的
        //    flex-basis 那一層,不去動卡片內部結構。
        <div className="b-carousel-wrap">
          {/* 🔴 `tabIndex` / `role` / `aria-label` 三件是**讓「鍵盤也能捲」成真**的東西 ——
              Chrome/Firefox 對可捲容器有「自動可聚焦」的行為,**Safari 沒有** ⇒ 不寫的話
              Safari 的鍵盤使用者在這一區完全動不了(疊上箭頭又不畫時,就是死路)。 */}
          <div
            className="b-carousel"
            ref={trackRef}
            tabIndex={0}
            role="group"
            aria-label={ariaLabel}
          >
            {products.map((p) => (
              <div key={p.id} className="b-carousel-item">
                <ProductCard
                  p={p}
                  showRedPrice={showRedPrice}
                  badgeStyle={badgeStyle}
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
