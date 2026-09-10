// products-featured-photo.test.ts — 首頁「最新商品」只挑【有真照片的】(Sean 2026-09-10 拍甲)
//
// 🔬 由來:2026-09-10 走查正式站(訪客)實見 —— 首頁 N°02 那一排 **5 張卡片全部是「暫無照片」**,
//    而它們的圖是 `extreme-components.com/…/noimage.jpg`(供應商自家的佔位圖)。
//
// 🔴 **這支驗的是【行為】不是【原始碼裡有沒有那行字】** ——
//    同日在 `20260910070000` 的事後閘上剛付過學費:文字閘對 `AND false` 那種突變零判別力。
//    ⇒ 所以 `pickFeatured` 被抽成純函式, 這裡直接餵資料進去看它回什麼。

import { describe, expect, it } from 'vitest';
// 🔴 從 `catalog-page` import 而不是 `products` —— 後者帶 `server-only`, 一 import 就爆。
//    那正是把它放在那裡的理由:一段碰不到的邏輯, 只能用文字去驗, 而文字驗不出行為。
import { pickFeatured, type CatalogCardProduct } from './catalog-page';

/** 首頁取數。🔵 這裡寫死 10 是刻意的 —— 真值住在 `products.ts` 的 `FEATURED_LIMIT`
 *  (帶 server-only 取不到), 而那兩個數字綁在一起的守門是 `products-featured-limit.test.ts`。 */
const FEATURED_LIMIT = 10;

// 🔴🔴 **每一格都要【明確傳 limit】, 而這是被咬出來才寫的**:
//    第一版我漏傳 ⇒ `slice(0, undefined)` = 回全部 ⇒ **六格裡有五格照樣綠**,
//    只有「取數上限」那一格紅。⇒ 📌 **五格為了錯的理由而通過, 而它們看起來完全正常。**
//    🎯 那與今天那條母題同形:一個【恰好也成立】的結果, 與【驗到了】長得一樣。

/** 造一張卡 —— 只有 `image` 這一欄對本片有意義, 其餘給最小值。 */
const card = (id: number, image: string | null): CatalogCardProduct =>
  ({ id, slug: `p-${id}`, image }) as unknown as CatalogCardProduct;

// 🔬 **逐字取自正式庫**(2026-09-10 唯讀撈 `products_public.images->>0`)——
//    不是我編的形狀。編一個「看起來像佔位圖」的網址, 這支就只證得了我自己的想像。
const REAL_PLACEHOLDER =
  'https://www.extreme-components.com/components/com_virtuemart/assets/images/vmgeneral/noimage.jpg';
const REAL_PHOTO = 'https://cdn.example.com/parts/adlau-1.jpg';

describe('首頁最新商品:只挑有真照片的', () => {
  it('🔴 供應商自家的 noimage.jpg 要被濾掉(走查那 5 張就是它)', () => {
    const out = pickFeatured([card(1, REAL_PLACEHOLDER), card(2, REAL_PHOTO)], FEATURED_LIMIT);
    expect(out.map((p) => p.id)).toEqual([2]);
  });

  it('🔴 沒有網址 / 空字串也要被濾掉', () => {
    const out = pickFeatured([card(1, null), card(2, ''), card(3, REAL_PHOTO)], FEATURED_LIMIT);
    expect(out.map((p) => p.id)).toEqual([3]);
  });

  it('🟢 正對照:全部有照片 ⇒ 一件都不准少(證明它不是恆濾)', () => {
    const src = [card(1, REAL_PHOTO), card(2, REAL_PHOTO), card(3, REAL_PHOTO)];
    expect(pickFeatured(src, FEATURED_LIMIT).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('🔵 順序不准被動到 —— 它是「最新」那個排序, 濾掉不等於重排', () => {
    const src = [card(1, REAL_PHOTO), card(2, REAL_PLACEHOLDER), card(3, REAL_PHOTO)];
    expect(pickFeatured(src, FEATURED_LIMIT).map((p) => p.id)).toEqual([1, 3]);
  });

  it('🔴 取數上限仍然是 FEATURED_LIMIT —— 濾完不得超過', () => {
    const src = Array.from({ length: FEATURED_LIMIT + 5 }, (_, i) => card(i, REAL_PHOTO));
    expect(pickFeatured(src, FEATURED_LIMIT)).toHaveLength(FEATURED_LIMIT);
  });

  it('🛑 天花板:一整頁都沒照片 ⇒ 回空陣列, 而【畫面會少一整區而沒有東西會叫】', () => {
    // 📌 這一格不是要它不發生, 是要下一個人看得到這個世界存在。
    //    全站 719/26,434 件沒真照片, 而集中在 LIGHTECH 493 · EXTREME 82(2026-09-10 唯讀量)
    //    ⇒ 某家一次上架 50 件無圖新品, 這一頁就會被濾光。那天要多撈一頁, 不是拿掉這道濾網。
    expect(pickFeatured([card(1, REAL_PLACEHOLDER), card(2, null)], FEATURED_LIMIT)).toEqual([]);
  });
});
