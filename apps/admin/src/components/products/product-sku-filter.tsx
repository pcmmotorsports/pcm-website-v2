import {
  BRAND_PARAM,
  CATEGORY_PARAM,
  DEFAULT_PAGE_SIZE,
  KEYWORD_PARAM,
  MAX_SKU_CHARS,
  MAX_SKU_COUNT,
  SET_BY_PARAM,
  SIZE_PARAM,
  SKU_PARAM,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';

// product-sku-filter.tsx — 後台商品列表的「貼料號」篩選。
//
// 來由:設計稿 `pcm-product-admin-4dir/product-admin-4dir.html`(本機快取 mtime 2026-08-15 16:51)
//   逐字「一行一個,**可以直接從 Excel 整欄貼進來**」。
//   🔴 那句話的重量:它不是篩選器的花樣,是**有人手上真的有一份 Excel** 才會被畫進稿裡。
//   ⚠️ 而那份稿有【四個互相打架的版本】(檔內逐字「四軸互動形態刻意不同」),
//      **沒有人裁過哪一版是權威** ⇒ 本片只取「貼料號」這一軸,不取它的版面。
//
// 🔴 零 JS 的 `<form method='get'>`,抄同頁既有的 `product-keyword-search.tsx`。
//   ⚠️ **本表單刻意【不】接 `AutoApplySubmit`**,理由在那支元件自己的檔頭逐字寫著:
//      「表單裡若哪天加了 `<input type='text'>`,它 blur 時也會發 `change` ⇒ 會送出。
//        要加文字欄位進來的人,先讀這一段。」
//      ⇒ `<textarea>` 同樣在 blur 發 `change`。貼到一半點去別處 = 送出半份清單 + 整頁導航
//        (那支元件走 `form.requestSubmit()` ⇒ 捲軸回頂、焦點回 document)。
//      ⇒ **一顆明確的鈕在這裡是對的,不是遺漏。**
//
// 🔴 上限兩道,**都是量出來的**(2026-08-19 正式庫 51,645 個 variant):筆數 100 / 字元 2000。
//   100 個【典型】料號 = 1,216 字元;100 個【最長】= 5,472 字元
//   ⇒ 只限筆數的話,某些人的貼上會把網址撐爆而他不會知道為什麼。
//   ⚠️ 超過上限是【截斷】不報錯 —— 而截斷**必須看得見**:下方 chip 顯示實際套用了幾個。

export function ProductSkuFilter({
  filter,
  size,
}: {
  filter: AdminProductFilter;
  /** 🔴 必須帶著走,理由同 `ProductTaxonomyFilter`:不帶的話員工選的「每頁 500」會靜靜消失。 */
  size: number;
}) {
  const applied = filter.skus ?? [];
  return (
    <form method='get' action='/products' className='flex flex-col gap-1'>
      {size !== DEFAULT_PAGE_SIZE && <input type='hidden' name={SIZE_PARAM} value={String(size)} />}

      {/* 🔴🔴 把另外四軸帶著走。少一格,那一軸就會在貼料號的瞬間靜靜消失,而畫面看起來完全正常
          —— 那正是 `lib/products/product-list-view.ts` 檔頭記的那個病。
          ⚠️ `page` 刻意不帶:換篩選本來就該回第 1 頁。 */}
      {filter.setBy !== undefined && (
        <input type='hidden' name={SET_BY_PARAM} value={filter.setBy} />
      )}
      {filter.keyword !== undefined && (
        <input type='hidden' name={KEYWORD_PARAM} value={filter.keyword} />
      )}
      {filter.brandId !== undefined && (
        <input type='hidden' name={BRAND_PARAM} value={filter.brandId} />
      )}
      {filter.categoryPath !== undefined && (
        <input type='hidden' name={CATEGORY_PARAM} value={filter.categoryPath} />
      )}

      <label htmlFor='product-sku-filter' className='text-muted-foreground text-xs font-medium'>
        貼料號
      </label>
      {/* 🔴 框裡用換行分隔(人貼進來的就是一欄);網址那一端用逗號,見 `buildProductListHref`。
          兩邊的解析都收 —— 而**全表 0 筆料號含逗號或換行**,所以來回不會走樣(量法見 `parseProductSkus`)。 */}
      <textarea
        id='product-sku-filter'
        name={SKU_PARAM}
        defaultValue={applied.join('\n')}
        rows={3}
        maxLength={MAX_SKU_CHARS}
        placeholder={'一行一個，可以直接從 Excel 整欄貼進來（最多 ' + MAX_SKU_COUNT + ' 個）'}
        className='border-input bg-background w-72 rounded-md border px-2 py-1 text-sm'
      />

      <div className='flex items-center gap-2'>
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
        >
          用料號篩選
        </button>
        {applied.length > 0 && (
          // 🔴 這一格是【截斷看得見】的唯一出口:貼 300 個而只套用 100 個時,這裡會寫 100。
          //    沒有它,員工會以為 300 個都在篩,而清單少了東西他不會知道為什麼。
          <span className='text-muted-foreground text-xs'>已套用 {applied.length} 個料號</span>
        )}
      </div>
    </form>
  );
}
