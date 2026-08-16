import { applyCustomerKeywordSearchAction } from '../../lib/customers/keyword-search-action';
// 🔴 欄位名住在 cookie 模組:`'use server'` 檔只能 export async function(見該檔註)。
import {
  CUSTOMER_KEYWORD_FIELD,
  CUSTOMER_KEYWORD_RETURN_TO_FIELD,
} from '../../lib/customers/customer-keyword-cookie';

// customer-keyword-search.tsx — `#525`:客戶關鍵字搜尋框 +「目前搜尋」chip。
//
// 🔴 **本檔沒有 `'use client'`,而且是刻意的**:兩個表單都走 server action + PRG
//    (搜尋詞是 PII、不進 URL ⇒ 必須 POST)。做成 client 的話,搜尋詞會經過 client state,
//    而**清除**很容易被順手寫成 `router.replace` 捷徑 —— 那就生出第二條沒有人守的路徑。
//
// 🔴 **chip 是本設計成立的前提,不是裝飾**:搜尋詞既不在 URL、cookie 又是 httpOnly,
//    畫面上沒有它的話,員工看到的只是「客戶怎麼少了一堆」而完全不知道自己正在搜什麼。
//    ⚠️ **而且 cookie 是跨分頁共用的** —— 在 A 分頁搜了「王」,B 分頁的客戶列表也會被篩掉,
//    B 分頁的員工**完全沒有線索**。chip 就是那個線索,`✕` 就是出口。
//
// 🔴 形狀逐字對齊訂單側 `order-keyword-search.tsx`:兩條線的搜尋在員工眼裡要是同一個東西。
//    ⚠️ **唯一的實質差異在 `truncated` 的處理** —— 見下方 `truncated` 參數註。

export function CustomerKeywordSearch({
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
   * 關鍵字**自己**命中的人數(非 PII)。`null` = 沒打過 RPC。
   * 🔴 `0` 與 `null` **不可互換**:前者是「查過了、DB 說沒有」,後者是「根本沒查」。
   */
  matchCount: number | null;
  /**
   * 命中是否被 RPC 截斷(前 100 筆)。
   *
   * 🔴 **`true` 時【一律】顯示警語,包含 0 筆的情況** —— migration `COMMENT` 逐字要求。
   * **0 筆 + 沒有警語 = 員工得到「查無此人」的錯誤結論**,而真相可能是
   * 「符合的人整批落在那 100 筆之外」。⚠️ 這是本元件與訂單側**唯一**的實質差異:
   * 訂單側把截斷寫進筆數(`100+`),本側**額外**給一行明確的行動指示,
   * 因為客戶搜尋的使用者常常只是想找一個人 —— 「100+」看起來像成功,不像「你該打更精確」。
   */
  truncated: boolean;
}) {
  return (
    <div className='flex flex-col gap-1'>
      <form action={applyCustomerKeywordSearchAction} className='flex items-end gap-2'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor='customer-keyword-search'
            className='text-muted-foreground text-xs font-medium'
          >
            搜尋
          </label>
          {/* 🔴 這一格與旁邊的會員等級**故意不同**:等級是 client + URL query,本軸是 POST + cookie。
              原因不是風格不統一,是本軸的搜尋詞會是**客人姓名 / Email / 電話** ⇒ 不得進 URL。 */}
          <input
            id='customer-keyword-search'
            type='text'
            name={CUSTOMER_KEYWORD_FIELD}
            autoComplete='off'
            defaultValue={keyword ?? ''}
            placeholder='姓名 / Email / 電話'
            className='border-input bg-background h-9 w-56 rounded-md border px-3 text-sm'
          />
        </div>
        <input type='hidden' name={CUSTOMER_KEYWORD_RETURN_TO_FIELD} value={listHref} />
        <button
          type='submit'
          className='border-input hover:bg-accent h-9 rounded-md border px-3 text-sm'
        >
          搜尋
        </button>
      </form>

      {keyword !== null && (
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2 text-xs'>
            <span className='bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5'>
              {/* 🔴 搜尋詞**只出現在畫面上**,不進 URL、不進 log(migration 檔頭明令)。 */}
              目前搜尋:{keyword}
            </span>
            {/* 🔴 ✕ 走**同一支 action**(送空字串)⇒ 同一條 PRG 路徑。
                不做成 client 捷徑:兩條語意不同的清除路徑,其中一條一定沒人守。 */}
            <form action={applyCustomerKeywordSearchAction}>
              <input type='hidden' name={CUSTOMER_KEYWORD_FIELD} value='' />
              <input type='hidden' name={CUSTOMER_KEYWORD_RETURN_TO_FIELD} value={listHref} />
              <button
                type='submit'
                className='text-muted-foreground hover:text-foreground underline'
              >
                清除搜尋
              </button>
            </form>
            {matchCount !== null && (
              // 🔴 這句在**零筆時最重要**:0 筆 + 沒有任何說明 = 員工得到「查無此人」的錯誤結論。
              //    這裡講的是「關鍵字自己命中幾人」,與畫面上列出幾人是兩回事(會員等級會再砍)。
              <span className='text-muted-foreground'>
                關鍵字命中 {truncated ? `${matchCount}+` : matchCount} 位
              </span>
            )}
          </div>
          {truncated && (
            // 🔴 **`truncated` 為真就一定要出現,與筆數無關(含 0 筆)** —— migration `COMMENT` 的合約。
            //    ⚠️ 放在 chip **下面自成一行**、不是塞進那排小字:
            //    它是**行動指示**(你要重打),不是狀態描述(命中幾筆)。
            <p className='text-amber-700 dark:text-amber-500'>
              結果太多,請輸入更精確的關鍵字(目前只看得到最新的 100 位)。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
