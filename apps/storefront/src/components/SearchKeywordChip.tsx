'use client';

// SearchKeywordChip.tsx — `/products?search=` 那個關鍵字的膠囊 + 一句提示
// (⟦搜尋-落點換 /products⟧ 2026-09-03)。
//
// 🔵 **Sean 逐字**:「我以為搜尋會直接在我們商品目錄顯示誒」
//    ⇒ 搜尋送出的落點從 `/search` 換成 `/products`,而那讓他拿到左側分類、排序、密度、分頁。
//
// 🔴🔴 **這支存在的唯一理由是【誠實】,不是裝飾。**
//    `/products` 的商品平常走 RPC `search_catalog_by_vehicle`,而**那支沒有關鍵字參數**
//    (10 個 migration 定義檔掃 `p_(keyword|search|q)`/`ILIKE` ⇒ 全 0;
//     🟢 正對照 `p_vehicle|p_brand|p_category` ⇒ 3~25 命中 ⇒ 尺是活的)。
//    ⇒ 有關鍵字時 route 走**另一條路**(`lib/search.ts` 的 ILIKE),而**那條路吃不到 facet**。
//    ⇒ 📌 沒有這支元件的話,客人看到的是一個「篩選條件都排在那裡、點了卻不會變」的目錄頁
//      —— 而**那是安靜的錯**。2026-09-02 拍板逐字:
//      **「一個看得見的缺,永遠優於一個安靜的錯」**(`lib/search.ts` 檔頭)。
//
// 🛑 **稿上沒有這一顆 —— 而那不是我偏離,是稿自己漏了。**
//    `design-reference/components/FilterTop.jsx:413-455` 的 `ActiveChips` 逐一列出
//    vehicle / category / brands / price / inStock / isNew / isSale / colors,
//    **沒有 `search`** ⇒ 在稿裡關鍵字**濾了但看不見、沒有 ✕**;
//    而它的「清除全部」是 `setFilters({ brands: [] })` ⇒ **連關鍵字一起靜靜清掉**。
//    ⇒ 🔴 主視窗 2026-09-03 明批:**「不要因為『稿沒有』就不做」**。
//    ⇒ ⚠️ 所以這一顆的**視覺**拿不到稿的背書 ⇒ 沿用既有 `.ac-*` 樣式、不自創外觀,
//      等 Sean 定稿。**改樣式前先問他,不要自己畫。**

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export function SearchKeywordChip({
  keyword,
  unmatchedWords,
  matchedBrandNames,
}: {
  keyword?: string;
  /** 解析器沒有用到的字。🔴 **不參與過濾** —— 見 `parse-search-facets.ts`。 */
  unmatchedWords?: string;
  /**
   * 🔴 **解析器【認出來並且真的在過濾】的那些品牌名**(已解成顯示名, 不是 slug)。
   *   Sean 2026-09-06 逐字拍【甲】:那行字改成「**已用品牌篩選**」的說法。
   *   ⚠️ **而它可能是空的** —— 解析器認出來的也可能是**分類**而不是品牌;
   *      那時印「已用品牌篩選」是**假的** ⇒ 見下方那個 fallback。
   */
  matchedBrandNames?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 🔴 **無條件呼叫完 hooks 才 early-return** —— React hooks 規則:
  //    return 寫在 hooks 前面的話,`keyword` 一有一無就會改變 hook 數量 ⇒ 整頁炸。
  // 🔴 兩種模式:①`keyword` = 整句都當關鍵字(一顆膠囊都沒解析出來)
  //              ②`unmatchedWords` = 解析出了膠囊, 而這幾個字沒被用到
  //    ⇒ 兩者**互斥**(route 只會給其中一個), 而兩個都沒有就整區不畫。
  if (
    (keyword === undefined || keyword === '') &&
    (unmatchedWords === undefined || unmatchedWords === '')
  ) {
    return null;
  }
  if (keyword === undefined || keyword === '') {
    // 🔴🔴 **「丟掉的字要看得見」的那一半**(⟦search-CAPSULEPARSE⟧)。
    //    走到這裡 ⟺ 解析器**認出了東西**(所以沒有 `keyword`),而這幾個字它認不得。
    //    ⇒ 認得的那些**已經以膠囊的形式在畫面上**(`ActiveChips` 畫),所以這裡只講認不得的。
    //    🛑 少了它, 客人看到的是「我打了五個字, 而畫面只認了兩個」——
    //      而他**不知道剩下三個字有沒有在過濾**。
    //    ⇒ 📌 **一個「懂了一半」的系統, 比「完全沒懂」的更難用** —— 他不知道要重打哪一段。
    // ⚠️ **這段註解原本掛在下面那個 `keyword` 分支上,而那是錯的**
    //    (code-reviewer 2026-09-04 minor):那個分支**永遠不畫 `unmatchedWords`** ——
    //    它只在「整句都沒解析出東西」時出現。
    //    ⇒ 🎯 **一段描述與它所掛的分支對不上, 下一個維護者會照那段描述去改錯的地方。**
    return (
      <div className="ac-bar">
        {/* 🔴🔴 **2026-09-06 Sean 逐字拍【甲】** ——
            ⛔ ~~「🔍 這幾個字沒有用到:「…」—— 上面的篩選條件是我們認得的那部分。」~~
            🛑 **舊字面錯在哪**:它**是誠實的而讀起來像失敗** —— 客人打「GILLES TOOLING」,
               結果是對的(50/50 全是那個品牌), 而畫面說「有幾個字沒有用到」
               ⇒ 📌 **他會以為沒搜到。**(2026-09-06 正式站實走量到的就是這一格。)
            ✅ 改成講**做了什麼**而不是**沒做什麼**。
            ⚠️ **而 fallback 不可省**:解析器認出來的**也可能是分類**(`parse-search-facets`
               同時回 `brandIds` 與 `categories`)⇒ 那時印「已用品牌篩選」是**假的**
               ⇒ 🔴 **沒有品牌名時退回舊句** —— Sean 拍的是他看到的那一格,
                  而**那一格以外的世界他沒有看過**, 我不替他延伸。 */}
        <span className="ac-note">
          {matchedBrandNames
            ? `🔍 已用品牌篩選:「${matchedBrandNames}」—— 其餘的字沒有用到:「${unmatchedWords}」。`
            : `🔍 這幾個字沒有用到:「${unmatchedWords}」—— 上面的篩選條件是我們認得的那部分。`}
        </span>
      </div>
    );
  }

  const clear = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('search');
    // 🔴 **`page` 一起清掉。** 客人可能停在關鍵字結果的第 3 頁,✕ 掉關鍵字之後
    //    分母整個換了(關鍵字幾百件 ⇒ 全目錄兩萬多件),第 3 頁指的不是同一批東西。
    //    ⇒ 留著它不會報錯,只會讓他落在一個**看起來像壞掉**的位置。
    next.delete('page');
    const qs = next.toString();
    router.push(qs === '' ? pathname : `${pathname}?${qs}`);
  };

  return (
    <div className="ac-bar">
      <button className="ac-chip" onClick={clear} aria-label={`移除關鍵字 ${keyword}`}>
        {/* 🔵 帶「搜尋:」前綴 —— 沒有它,這顆與旁邊的品牌/分類膠囊長得一模一樣,
            而它們的意思完全不同(那些是篩選,這顆是**這批商品的來源**)。 */}
        搜尋:{keyword}
        <span className="ac-x">×</span>
      </button>
      {/* 🔴🔴 **這句話是本片的驗收核心,不是補充說明。**
        * 它要同時講三件事,少一件就會誤導:
        *   ① 現在看到的是什麼 ② 為什麼左邊點了沒用 ③ 他可以怎麼辦
        * ⛔ 只寫「關鍵字搜尋結果」= 標籤,不是宣稱 —— 那句話在「facet 有效」與
        *    「facet 無效」兩個世界裡是同一個字串。 */}
      <span className="ac-note">
        目前顯示「{keyword}」的關鍵字結果;左側篩選與排序要先移除關鍵字才會生效。
      </span>
    </div>
  );
}
