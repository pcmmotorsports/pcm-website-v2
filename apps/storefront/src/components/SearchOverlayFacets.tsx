'use client';

// SearchOverlayFacets.tsx — 搜尋疊層的「品牌 / 分類」兩區(⟦搜尋-第2刀⟧;2026-09-03 線 `-front`)
//
// 🔴 **為什麼是一支獨立的檔**:`SearchOverlay.tsx` 動手前 396 行 / 鐵則 6 的 400 硬線,
//    而這兩區約 +50 行 ⇒ 必過線。拆點是該檔檔頭自己寫的那一句(render 那幾支結果區塊)。
//    ⇒ 🛑 **註解跟著它解釋的那段碼搬**(鐵則 6 逐字:不得以壓縮/刪減註解作為降行手段)。
//
// 🔴 **稿是權威,而版面逐字抄它**(`design-reference/components/SearchOverlay.jsx`):
//    · 區塊順序 商品 → 品牌 → 分類 → 車款   `:125` `:148` `:162` `:176`
//    · 標題字面 `品牌` / `分類`(**只有商品那一區帶數字**)`:149` `:163`
//    · 版面 `search-overlay-section` > `search-overlay-h` + `search-overlay-tagrow` > `search-overlay-tag`
//    · 🔴 **空區不畫** —— 稿三處逐字都是 `{results.X.length > 0 && (…)}`(`:147` `:161` `:175`)
//    🟢 那四個 class **全部已存在**(第一刀搬 CSS 時整支搬過)⇒ **本片零新增 CSS。**
//    ⚠️ **而本檔實際用了【五個】class**(R1 nit 10):第五個是 `search-overlay-nores-hint`,
//      它在 `styles/search-overlay.css:240` 也存在 ⇒ **「零新增 CSS」的結論不變**,
//      而那句列舉把自己的分母寫窄了一格 —— 📌 **列舉式的宣稱正是下一個人拿去當清單的東西。**
//    ⚠️ **而它第一次離開父容器使用**(R1 nit 11):既有碼裡它只出現在 `.search-overlay-noresults`
//      裡面(帶置中與上下留白),這裡直接掛在 `.search-overlay-section` 底下 ⇒ **沒有那兩樣**。
//      **視覺歸 Sean(階段 E)** —— 這裡只記「它是一個稿裡沒有的組合」,不判好壞。
//
// ⚠️ **一處【與稿不同】,而它是授權偏離不是自創**:稿的分類導頁用 `c.id`(`:167`),
//    而**我們的 `?category=` 吃的是【名稱】** —— 落點 `lib/brand-products.test.ts:20-22`
//    逐字 `/products?pbrand=akrapovic&category=輪框與傳動` ⇒ 本檔用 `c.name`。
//
// ═══════════════════════════════════════════════════════════════════════════════
// 🔴🔴 **車款那一區【刻意不畫】—— 這不是漏做,是一個等 Sean 拍的題(題 21)**
//
//   `/api/search` **今天就回車款**(2026-09-03 production 實打 `R6` ⇒ `vehicles` **6 筆**,
//   而前三個名字是),而畫出來的是:
//     **Honda CBR600 · CBR600F · CBR600FS** —— 因為 `cbr600` 這串字裡**含有 `r6`**。
//   成因在 `lib/search-facets.ts:43-44` 的 `match()` = `includes()`,車款用它在 `:96`;
//   而該檔 `:42` 註解逐字寫著**那是照稿 `SearchOverlay.jsx:32` 搬的** ⇒ **改它是偏離鐵則 1。**
//
//   🛑 **⇒ 所以這一區不是「還沒做」,是「做了會讓客人以為網站壞了」** ——
//      而**改比對規則要 Sean 拍**(一支檔一個函式,不是大工程,但那是他的決定不是我們的)。
//   📎 **題目落點**:`~/pcm-mailbox/等Sean拍的題-20260903.md` **題 21**(答案卡與內文各一處)。
//   ✅ **轉開的條件**:那一題拍了乙(改成詞邊界 / 型號前綴)之後,把 `vehicles` 那一區接上來。
//
//   ⚠️ **而「刻意不畫」與「空區不畫」在畫面上長得一模一樣** ⇒ 這段註解是唯一分得出來的東西。
//      **下一個看到「vehicles 有資料而沒畫」的人:那不是 bug,先去讀題 21。**
// ═══════════════════════════════════════════════════════════════════════════════

import type { SearchFacets } from '@/lib/search-facets';

export type SearchOverlayFacetsProps = {
  facets: SearchFacets;
  /** 點了之後要導去哪 —— 由呼叫端給,本檔不自己碰 router(純畫)。 */
  onNavigate: (href: string) => void;
};

export function SearchOverlayFacets({ facets, onNavigate }: SearchOverlayFacetsProps) {
  return (
    <>
      {/* 🔴 `failed` 與「沒有符合的」要畫成兩種東西 —— 而它們的資料層已經分開了
          (`lib/search-facets.ts:35-39` 逐字:三個旗標各自一格、不合成一個)。
          少了這一格,一次讀取失敗會告訴客人「沒有這個品牌」。
          🛑 **文案是暫用的** —— 抄站上既有的中性字面「搜尋暫時無法使用」那一族,
             等 Sean 拍(與題 21 一起端)。 */}
      {facets.failed.brands && (
        <section className="search-overlay-section">
          <div className="search-overlay-h">品牌</div>
          <div className="search-overlay-nores-hint" role="status">這一區暫時讀不到</div>
        </section>
      )}

      {!facets.failed.brands && facets.brands.length > 0 && (
        <section className="search-overlay-section">
          <div className="search-overlay-h">品牌</div>
          <div className="search-overlay-tagrow">
            {facets.brands.map((b) => (
              <button
                key={b.id}
                type="button"
                className="search-overlay-tag"
                onClick={() => onNavigate(`/products?pbrand=${encodeURIComponent(b.id)}`)}
              >
                {b.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {facets.failed.categories && (
        <section className="search-overlay-section">
          <div className="search-overlay-h">分類</div>
          <div className="search-overlay-nores-hint" role="status">這一區暫時讀不到</div>
        </section>
      )}

      {!facets.failed.categories && facets.categories.length > 0 && (
        <section className="search-overlay-section">
          <div className="search-overlay-h">分類</div>
          <div className="search-overlay-tagrow">
            {facets.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="search-overlay-tag"
                onClick={() => onNavigate(`/products?category=${encodeURIComponent(c.name)}`)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
