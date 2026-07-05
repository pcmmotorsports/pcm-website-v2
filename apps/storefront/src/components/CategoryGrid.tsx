// CategoryGrid.tsx — N°03 · Categories · 部品分類(首頁精選分類格)
//
// 版面/CSS 字面對齊 design-reference/components/HomePage.jsx @ 25d3a2a(ed-cats/ed-cat-grid/ed-cat)。
// M-1-04 刀 1b2:'use client' → server component + onNav stub → <Link href>。
//
// Q4-S5(2026-07-05):分類卡「真資料化」修死連結 —— 原本 8 個寫死假分類(id=exhaust/brake…)
//   link `?category=${假id}`、但假 id 對不上真分類、且 /products 原不讀 category 參數 → 點了無過濾。
//   修:改吃 server 傳入的真 categories(fetchCategories→buildCategoryTree,只列有商品分類)、
//   link `?category=${真分類名}`(= products-url-state.parseCategoryFromUrl 比對鍵 = matchesCategory 鍵);
//   取前 8 大(依 sortOrder=群數,保留 design 8 卡格版面)、「查看全部」→ /products 側欄完整分類。
//   🔴 圖片:真分類無專屬圖 → 沿用 design 的裝飾圖池(依序位指派、與分類語意無關、Sean 後續掌舵替換);
//   空(fetch 失敗 / 尚無分類)→ 不渲染整段(勝過假卡或空格)。多品牌寫入後分類自動長出。
// 🔴 視覺變更(Sean 階段 E 對齊):刪 design 原 ed-cat-en 英文副標(真 MockCategory 無 en 欄、留=翻譯反鐵則1);
//   count padStart(3) 對 4 位數群數(如碳纖維部品~1406)顯 4 位「1406」不截斷。

import Link from 'next/link';
import type { MockCategory } from '@/data/mock-categories';

// 裝飾圖池(design 原 8 張 Unsplash 佔位圖、與真分類無對應關係;Sean 後續替換為每類專屬圖)。
const DECOR_IMAGES = [
  'photo-1568772585407-9361f9bf3a87',
  'photo-1580310614729-ccd69652491d',
  'photo-1558981285-6f0c94958bb6',
  'photo-1558981806-ec527fa84c39',
  'photo-1609630875171-b1321377ee65',
  'photo-1558981001-792f6c0d5068',
  'photo-1558981403-c5f9899a28bc',
  'photo-1571068316344-75bc76f77890',
] as const;

const HOME_GRID_MAX = 8; // 首頁精選卡數(保留 design 8 卡格版面;完整分類在 /products 側欄)

export function CategoryGrid({ categories }: { categories: MockCategory[] }) {
  // 依 count 遞減取前 8(buildCategoryTree 已按 sortOrder=群數排序,再保守排一次)。
  const cats = [...categories].sort((a, b) => b.count - a.count).slice(0, HOME_GRID_MAX);
  if (cats.length === 0) return null; // 空 → 整段不渲染(不顯假卡/空格)

  return (
    <section className="ed-cats">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°03</span>
          <span>Categories · 部品分類</span>
        </div>
        <Link href="/products" className="ed-link ed-link-sm">
          <span>查看全部分類</span>
          <span className="ed-link-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="ed-cat-grid">
        {cats.map((c, i) => (
          <Link key={c.id} href={`/products?category=${encodeURIComponent(c.name)}`} className="ed-cat">
            <div className="ed-cat-media">
              <img
                src={`https://images.unsplash.com/${DECOR_IMAGES[i % DECOR_IMAGES.length]}?w=700&q=75&auto=format&fit=crop`}
                alt=""
              />
            </div>
            <div className="ed-cat-foot">
              <div className="ed-cat-name">
                <span>{c.name}</span>
                <span className="ed-cat-count ed-mono">{String(c.count).padStart(3, '0')}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
