'use client';

// SearchOverlayProducts.tsx — 搜尋疊層的「商品」那一區(⟦搜尋-第2刀⟧ 拆檔;2026-09-03 線 `-front`)
//
// 🔴 **為什麼從 `SearchOverlay.tsx` 搬出來**:那支檔接上品牌/分類兩區之後是 **426 行**,
//    過了鐵則 6 的 400 硬線。而鐵則 6 逐字寫著**不得以壓縮/刪減註解作為降行手段**
//    ⇒ 只能拆,而拆點是該檔檔頭自己寫的那一句(render 那幾支結果區塊)。
// 🛑 **本檔內容【逐字搬移】,零行為改動** —— 只做兩件機械改寫:
//    · `view.items` ⇒ `items`(props 化)
//    · `navigateToCatalog(router, …); close();` ⇒ `onNavigate(…)`(把 router/close 留在呼叫端)
//    ⇒ 🎯 而下面那段 `<img>` 的註解是**跟著它解釋的那段碼一起搬過來的**,不是我重寫的。

import type { SearchOverlayItem } from '@/lib/search-shape';

export type SearchOverlayProductsProps = {
  items: SearchOverlayItem[];
  /** 點了要導去哪 —— 由呼叫端給,本檔不碰 router(純畫,與 `SearchOverlayFacets` 同款)。 */
  onNavigate: (href: string) => void;
};

export function SearchOverlayProducts({ items, onNavigate }: SearchOverlayProductsProps) {
  return (
      <section className="search-overlay-section">
        <div className="search-overlay-h">商品 · {items.length}</div>
        <div className="search-overlay-products">
          {items.map((p) => (
            <button
              key={p.slug}
              type="button"
              className="search-overlay-product"
              onClick={() => onNavigate(`/products/${p.slug}`)}
            >
              <div className="sop-thumb">
                {/* 🔴 用原生 `<img>` 是本 repo 的慣例(`ProductImage.tsx:132/152/172` 三處皆是),
                    而**不要**加 `eslint-disable-next-line @next/next/no-img-element` ——
                    本 repo 的 eslint **沒有註冊那條規則** ⇒ 加了 disable 反而 lint 紅
                    (`Definition for rule ... was not found`)。
                    ⚠️ 這個坑 `ComingSoon.tsx:161` 與 `OrdersTab.tsx:149` 已經各記過一次,
                       而我今天是第三次踩 —— 📌 記在兩個地方,擋不住第三個人。 */}
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : null}
              </div>
              <div className="sop-meta">
                <div className="sop-brand">{p.brand}</div>
                <div className="sop-name">{p.name}</div>
                {/* 🔴 `null` 印「—」不是「NT$ 0」:0 元是贈品、查不到價格是另一件事。 */}
                <div className="sop-price">{p.price === null ? '—' : `NT$ ${p.price.toLocaleString()}`}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
  );
}
