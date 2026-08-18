import Link from 'next/link';
import {
  KEYWORD_PARAM,
  SET_BY_PARAM,
  buildProductListHrefResetPage,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';

// product-keyword-search.tsx — `#661`:後台商品的料號 / 商品名搜尋框。
//
// 🔴 **零 JS 的 `<form method="get">`,不是 POST + cookie —— 而這與 orders / customers 相反,是刻意的。**
//    那兩面用 POST + cookie + PRG,**整套機制的前提是「搜尋詞是 PII」**
//    (`lib/customers/customer-keyword-search.tsx:58-59` 逐字:「本軸的搜尋詞會是
//     **客人姓名 / Email / 電話** ⇒ 不得進 URL」)。
//    **商品搜尋打的是料號 / 商品名 / 品牌 —— 不是 PII,那個前提不成立。**
//    而網址派**本來就是這一頁自己的模型**(`product-filter-chips.tsx` 逐字「選中態靠網址不靠 state」)。
//    ⇒ 換來的是:可加書籤、可分享、上一頁能用、少約 170 行(估,看那兩面的行數推的)。
//
// ⚠️🔴 **解除條件(這個決定的出口,不要刪)**:
//    若日後這個框要支援「**用客人姓名 / 電話反查他買過什麼**」⇒ **那一刻起搜尋詞就是 PII**
//    ⇒ 必須改回 POST + cookie(照 customers 那一面)。
//    **判別句:這個輸入框收得到人名或電話嗎?**
//
// 🔴 **版面位置抄 customers 那一面**:搜尋框在標題列與篩選列**之間**、自成一塊
//    (`app/customers/page.tsx:80` 的 `<CustomerKeywordSearch>` 就在 `<CustomerFilterBar>` 上面)。
//    這樣員工的視線順序是「這一頁是什麼 → 我要找什麼 → 再細分」。

export function ProductKeywordSearch({ filter }: { filter: AdminProductFilter }) {
  return (
    <div className='flex flex-col gap-1'>
      {/* 🔴 `method='get'` + `action='/products'` ⇒ 送出後網址就是 `/products?q=…`。
          **不要**加 `page` 的 hidden input:換搜尋詞本來就該回第 1 頁,
          而「沒有那個欄位」就是最省的做法(同 `buildProductListHrefResetPage` 的理由)。 */}
      <form method='get' action='/products' className='flex items-end gap-2'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor='product-keyword-search'
            className='text-muted-foreground text-xs font-medium'
          >
            搜尋
          </label>
          <input
            id='product-keyword-search'
            type='text'
            name={KEYWORD_PARAM}
            autoComplete='off'
            defaultValue={filter.keyword ?? ''}
            /* 🔴 提示文字寫出 `*` —— 它【本來就是】萬用字元(PostgREST 把 `*` 當 `%` 的別名,
               2026-08-19 對正式庫實測:`bremb*o` 與 `brembo` 同為 35 件),而本層擋不掉它
               (理由見 `lib/products/product-repository.ts` 的 buildProductKeywordOrFilter 檔頭)。
               ⇒ 寫出來讓它從「意外」變成「功能」;不寫的話員工會在不知情下拿到萬用字元行為。 */
            placeholder='料號 / 商品名稱(可用 * 當萬用字元)'
            className='border-input bg-background h-9 w-56 rounded-md border px-3 text-sm'
          />
        </div>

        {/* 🔴🔴 **把當下的分類篩選帶著走。** 沒有這一格,員工按「手動」之後再搜尋,
            分類會被洗掉 —— 而畫面看起來完全正常(chip 高亮跳回「全部」、清單也真的變了)。
            那正是這一頁改版前就有的病,只是換了個觸發點
            (改版前是分頁連結漏帶 `set_by`,見 `lib/products/product-list-view.ts` 檔頭)。 */}
        {filter.setBy !== undefined && (
          <input type='hidden' name={SET_BY_PARAM} value={filter.setBy} />
        )}

        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm'
        >
          搜尋
        </button>
      </form>

      {/* 🔴 有搜尋才畫「清除」——而它是 `<Link>` 不是第二個 form:
          清除就是「回到沒有 `q` 的那個網址」,那本來就是一條連結。
          ⚠️ 清除**只拿掉搜尋詞、保留分類**:員工按「手動」再搜尋再清除,
          預期是回到「手動」那一批,不是回到全部商品。 */}
      {filter.keyword !== undefined && (
        <p className='text-muted-foreground text-xs'>
          目前搜尋:「{filter.keyword}」
          <Link
            href={buildProductListHrefResetPage({ ...filter, keyword: undefined })}
            className='text-primary ml-2 underline'
          >
            清除搜尋
          </Link>
        </p>
      )}
    </div>
  );
}
