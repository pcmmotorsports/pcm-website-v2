import { applyOrderKeywordSearchAction } from '../../lib/orders/keyword-search-action';
// 🔴 欄位名住在 cookie 模組:`'use server'` 檔只能 export async function(見該檔註)。
import {
  ORDER_KEYWORD_FIELD,
  ORDER_KEYWORD_RETURN_TO_FIELD,
} from '../../lib/orders/order-keyword-cookie';

// order-keyword-search.tsx — #347-2b:關鍵字搜尋框 + 「目前搜尋」chip。
//
// 🔴 **本檔沒有 `'use client'`,而且是刻意的**:兩個表單都走 server action + PRG
//    (Q-a=B 紅線:搜尋詞是 PII、不進 URL ⇒ 必須 POST)。做成 client 的話,
//    搜尋詞會經過 client state,而**清除**很容易被順手寫成 `router.replace` 捷徑 ——
//    那就生出第二條沒有人守的路徑(主視窗 2026-08-10 裁決條件①明令不准)。
//
// 🔴 **chip 是 A 案成立的前提,不是裝飾**:搜尋詞既不在 URL、cookie 又是 httpOnly,
//    畫面上沒有它的話,員工看到的只是「列表怎麼少了一堆單」而完全不知道自己正在搜什麼。
//    ⇒ `order-keyword-search-wiring.test.tsx` 有一格釘住「有搜尋詞就一定看得到它 + 一定有清除入口」。

export function OrderKeywordSearch({
  keyword,
  listHref,
  matchCount,
  truncated,
}: {
  /** 目前生效的搜尋詞(來自 httpOnly cookie);`null` = 沒在搜。 */
  keyword: string | null;
  /** PRG 目的地 = 當下列表 URL(page 已歸 1);由 server 端用同一支 builder 算好傳進來。 */
  listHref: string;
  /**
   * 關鍵字命中筆數(非 PII)。`null` = 沒打過 RPC。
   * 🔴 `0` 與 `null` **不可互換**:前者是「查過了、DB 說沒有」,後者是「根本沒查」。
   */
  matchCount: number | null;
  /**
   * 關鍵字命中是否被截斷(前 100 筆)。
   * 🔴 只影響**筆數怎麼寫**:截斷時 `matchCount` 恆等於 100(= `ids.length`),
   * 直接印「命中 100 筆」會與列表上方那條「超過 100 筆」的橫幅互相打臉
   * (code-reviewer 2026-08-10 nit-9)⇒ 截斷時寫 `100+`。
   */
  truncated: boolean;
}) {
  return (
    <div className='flex flex-col gap-1'>
      <form action={applyOrderKeywordSearchAction} className='flex items-end gap-2'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor='order-keyword-search'
            className='text-muted-foreground text-xs font-medium'
          >
            搜尋
          </label>
          {/* 🔴 這一格與旁邊兩軸(單號 / 供應商單號)**故意不同**:那兩軸是 client + URL query,
              本軸是 POST + cookie。原因不是風格不統一,是本軸的搜尋詞會是**客人姓名 / 電話 /
              收件地址片段**(八維度子字串搜尋)⇒ 不得進 URL。 */}
          <input
            id='order-keyword-search'
            type='text'
            name={ORDER_KEYWORD_FIELD}
            autoComplete='off'
            defaultValue={keyword ?? ''}
            placeholder='單號 / 客人 / 料號 / 品名'
            className='border-input bg-background h-9 w-56 rounded-md border px-3 text-sm'
          />
        </div>
        <input type='hidden' name={ORDER_KEYWORD_RETURN_TO_FIELD} value={listHref} />
        <button
          type='submit'
          className='border-input hover:bg-accent h-9 rounded-md border px-3 text-sm'
        >
          搜尋
        </button>
      </form>

      {keyword !== null && (
        <div className='flex items-center gap-2 text-xs'>
          <span className='bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5'>
            {/* 🔴 搜尋詞**只出現在畫面上**,不進 URL、不進 log(migration `:50-74` 明令)。 */}
            目前搜尋:{keyword}
          </span>
          {/* 🔴 ✕ 走**同一支 action**(送空字串)⇒ 同一條 PRG 路徑。
              不做成 client 捷徑(裁決條件①):兩條語意不同的清除路徑,其中一條一定沒人守。 */}
          <form action={applyOrderKeywordSearchAction}>
            <input type='hidden' name={ORDER_KEYWORD_FIELD} value='' />
            <input type='hidden' name={ORDER_KEYWORD_RETURN_TO_FIELD} value={listHref} />
            <button type='submit' className='text-muted-foreground hover:text-foreground underline'>
              清除搜尋
            </button>
          </form>
          {matchCount !== null && (
            // 🔴 這句在**零筆時最重要**:0 筆 + 沒有任何說明 = 員工得到「查無此單」的錯誤結論。
            //    這裡講的是「關鍵字自己命中幾筆」,與畫面上列出幾筆是兩回事(其他篩選會再砍)。
            <span className='text-muted-foreground'>
              關鍵字命中 {truncated ? `${matchCount}+` : matchCount} 筆
            </span>
          )}
        </div>
      )}
    </div>
  );
}
