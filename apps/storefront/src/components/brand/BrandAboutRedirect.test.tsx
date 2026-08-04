// @vitest-environment jsdom
//
// BrandAboutRedirect — backlog #314 的行為守門(D3c-5;2026-08-05)
//
// 🔴 **這支證得了什麼、證不了什麼**(先寫清楚):
//   · 證得了 **決策邏輯**(`resolveBrandAboutTarget`:哪些網址該轉、轉去哪、哪些不准動)。
//   · **證不了** 「瀏覽器真的把 hash 留在 client、而 server 收不到」那一半 ——
//     那是這條 redirect 存在的**唯一理由**,而它只有真瀏覽器量得到。
//     ⇒ 另有一次 production build + 真瀏覽器實測,數字記在 commit body 與收工信。
//   · 也證不了 `router.replace`(而不是 `push`)有沒有真的不留下上一頁 —— 同上,真瀏覽器驗。

import { describe, expect, it } from 'vitest';
import { resolveBrandAboutTarget, BRAND_ABOUT_HASH } from './BrandAboutRedirect';
import { BRAND_CONTENT } from '@/data/brand-content';

// 🔴 測試這一側**可以**直接讀 `BRAND_CONTENT`(node/jsdom,不進 client bundle);
//    正式站則是由 `app/products/page.tsx` 這個 server component 算好傳 prop 下去 ——
//    兩邊的真相同源,而 client 只拿到 20 個短字串(關卡2 R2 must-fix C)。
const SLUGS = BRAND_CONTENT.map((b) => b.slug);
const EMPTY_CATALOG_SLUGS = ['dbk', 'gilles', 'kineo', 'rizoma', 'wrs'];

describe('#314 · 什麼該轉', () => {
  it('🔴 設計稿字面的形狀 → 品牌介紹頁(20 家逐一)', () => {
    for (const slug of SLUGS) {
      expect(
        resolveBrandAboutTarget(`?pbrand=${slug}`, BRAND_ABOUT_HASH, SLUGS),
        slug,
      ).toBe(`/brands/${slug}`);
    }
  });

  it('🔴 目錄零商品那 5 家**照樣轉**(泛白的是入口、不是頁面本身)', () => {
    // 不轉的話,設計稿字面的連結對這 5 家等於壞掉 —— 而它們的介紹頁內容是完整的。
    for (const slug of EMPTY_CATALOG_SLUGS) {
      expect(SLUGS, `${slug} 不在 20 家裡 ⇒ 本條恆真`).toContain(slug);
      expect(resolveBrandAboutTarget(`?pbrand=${slug}`, BRAND_ABOUT_HASH, SLUGS)).toBe(`/brands/${slug}`);
    }
  });

  it('其他 query 參數同時存在時仍認得出來(客人可能帶著排序/分頁進來)', () => {
    expect(resolveBrandAboutTarget('?sort=new&pbrand=akrapovic&page=2', BRAND_ABOUT_HASH, SLUGS))
      .toBe('/brands/akrapovic');
  });
});

describe('#314 · 什麼**不准**動', () => {
  it('🔴 沒有 hash 的 `?pbrand=X` 是正常的目錄篩選 —— 一個字都不能碰', () => {
    // 這條是本片最容易做錯的地方:在 server 端做 redirect 就會把這個正常用法一起劫走。
    for (const slug of SLUGS) {
      expect(resolveBrandAboutTarget(`?pbrand=${slug}`, '', SLUGS), slug).toBeNull();
    }
  });

  it('🔴 別的 hash 不算(只認設計稿那一個字面)', () => {
    for (const hash of ['#top', '#brand', '#brand-about-us', '#Brand-About', '#']) {
      expect(resolveBrandAboutTarget('?pbrand=akrapovic', hash, SLUGS), hash).toBeNull();
    }
  });

  it('🔴 查無的 slug 不轉(留在能正常顯示的目錄頁,不要把客人丟去 404)', () => {
    for (const slug of ['brembo', 'BONAMICI', '', 'akrapovic ']) {
      expect(resolveBrandAboutTarget(`?pbrand=${slug}`, BRAND_ABOUT_HASH, SLUGS), slug).toBeNull();
    }
  });

  // 🔴 這一族在**任何用「查物件的鍵」判斷合法性**的寫法下都會中:`__proto__` / `constructor`
  //    / `toString` 取得到原型鏈上的東西且 truthy(memory `js-index-lookup-hits-prototype-chain`;
  //    本 repo 兩支 result-banner 五個頁面真的中過)。
  //    ⚠️ 現行實作(R2 must-fix C 之後)比對的是**字串陣列的 `includes`** ⇒ 結構上不可能命中;
  //    這條保留當回歸 —— 哪天有人為了「快一點」改回 `Object.hasOwn(map, slug)` 或更糟的
  //    `if (map[slug])`,它仍然是唯一會紅的那一條。
  it('🔴 原型鏈屬性不得被當成品牌', () => {
    for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(resolveBrandAboutTarget(`?pbrand=${evil}`, BRAND_ABOUT_HASH, SLUGS), evil).toBeNull();
    }
  });

  it('沒有 `pbrand` 就沒有目的地;legacy 的 `?brand=` 也不在契約裡', () => {
    expect(resolveBrandAboutTarget('', BRAND_ABOUT_HASH, SLUGS)).toBeNull();
    expect(resolveBrandAboutTarget('?category=排氣系統', BRAND_ABOUT_HASH, SLUGS)).toBeNull();
    // `?brand=` 是 P4 之前的舊 key(`products-url-state.tsx` 仍收它當篩選),
    // 但設計稿產出的是 `?pbrand=` ⇒ 本 redirect 刻意不擴大範圍。
    expect(resolveBrandAboutTarget('?brand=akrapovic', BRAND_ABOUT_HASH, SLUGS)).toBeNull();
  });
});
