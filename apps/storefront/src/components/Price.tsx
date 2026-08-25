// app/components/Price.tsx — 價格顯示元件(基本型 props)
//
// 對齊 PRD §3.5 Q3=A:不接 product / tier / brand object、走 price + originalPrice + tierLabel 三個值
// 防三 tier 物件進 client bundle(Q4=C 防洩漏精神)、testability + 防洩漏雙贏
//
// 視覺對齊 design-reference/components/Pricing.jsx isMember 分支結構(L56-95)
// 三分支判定改走 tierLabel 非 null:
//   tierLabel !== null → isMember 分支(劃線 originalPrice + tier 價 + tierLabel pill)
//   tierLabel === null && hasRetailDiscount → retail discount 分支(劃線 origPrice + sale 價)
//   else → 純價分支
//
// sub 6 範圍:本 sub 僅新建元件、無 caller 消費點(留 sub 7 ProductCard 接)

import type { ReactNode } from 'react';
import type { TierLabel } from '@/data/mock-products';

/**
 * 🔴🔴 **一個「可以印給客人看」的價格 = 有限的正數。**
 *
 * ── 為什麼要有這個判斷(不是防禦性程式設計,是這個 repo 自己記過的病)──────
 * 「NT$ 0」在本 repo 是**具名的錯價**,至少五處註解在講怎麼避開它:
 *   `lib/products.ts:226` 「取 general 防 NT$0」
 *   `lib/products.ts:280` 「會顯『NT$ 0』錯價」
 *   `lib/products.ts:335` 「(codex 16c-3 k1 must-fix 2)」← **它曾被判 must-fix**
 *   `app/account/page.tsx:105`、`lib/recommendations/rule-based-engine.ts:36` 同旨
 * ⇒ 全 repo 的緩解方式是同一句:**「一律走 `general` 公開價就不會是 0」**。
 *
 * 🔴 **而 `general` 自己可以是 null。**
 *   `lib/catalog-page.ts:64` `price: row.price_general ?? 0`
 *   `CatalogListRow.price_general` 型別 = `number | null`(產生檔 `database.types.ts:2908`)
 *   ⇒ **那五處註解一致指向的那條安全路,終點正好生出它們在避開的那個 0。**
 *   ⇒ 而這件事**一顆測試都沒有在守**;它靠的是「資料剛好都有值」。
 *
 * ⚠️ **本守門的射程(不要讀成「NT$ 0 不會再出現」)**
 *   ① 只守**這個元件**。`ProductInfo.tsx:243` / `ProductPage.tsx:324` /
 *      `account/tabs/FavoritesTab.tsx:66` 各自有自己的 `NT$ {x.toLocaleString()}`,**本守門看不到**。
 *   ② 它**不修** `catalog-page.ts:64` 那個 `?? 0` —— 造假的那一步還在,
 *      本守門只是不讓那個假值變成一個看起來正常的價格。
 *      (不修的理由:`MockProduct.price` 宣告為 `number`,改成 `number | null` 會擴散到約 20 個消費點,
 *       超出本片範圍。**這是縮範圍,不是判斷它不用修。**)
 *   🔴🔴 **③ 而那個假 `0` 不只會被印出來 —— 它會被【當成 0 元拿去算】。**
 *      2026-08-25 codex R1 指出、我當場量到:
 *      `components/products-filter-logic.ts:22` 價格桶第一格 = `[0, 3000]`
 *      ⇒ **一個「查不到價格」的商品會出現在「NT$ 0 – 3,000」這個篩選結果裡。**
 *      本守門對這條路**完全無效**(它只管畫面上那串字)。
 *      📌 對照:`lib/catalog-query.ts` 那條走 DB 的篩選**不受影響**
 *         (SQL 裡 `null >= 0` 為 unknown ⇒ 該列直接落選),
 *         **兩條篩選路徑對同一件事的行為不同** —— 這一格沒有人在守。
 *   ④ 它**不保證**結帳金額正確 —— 下單金額由 server 端重算,**本片沒有量過那條路**。
 *
 * 🔴🔴 **`> 0` 這個門檻的已知代價:若真有「贈品 / 0 元品」,本守門會【誤擋】它 —— 而我沒有證明它不存在。**
 *   ⚠️ 我唯一量到的是:全 storefront **原始碼**(含測試)`price` 為 0 的**字面** 0 命中(2026-08-25)。
 *   🔴 **那不是「沒有 0 元商品」** —— 價格來自 DB,而 0 元商品在原始碼裡本來就不會有字面。
 *      (2026-08-25 codex R1 逐字戳破:「以原始碼『0 命中』推論目前沒有 0 元商品不成立」。)
 *   ⇒ 寫下這段時這一格是**沒量**。**2026-08-25 已由主視窗補上,而【兩發的證據等級不同】:**
 *
 *   ```
 *   ✅ 量到  select count(*) from products where price_general is null;  ⇒ 0
 *            ⇒ **今天線上沒有客人看得到 NT$ 0。本守門是【防未來】,不是救火。**
 *   🟡 口頭  「有沒有 0 元商品(贈品/全額折抵)?」⇒ Sean 答【沒有】
 *            🔴 **這一格是【人講的】,不是查出來的。** 我沒有看過 `price_general = 0` 的 count。
 *               ⇒ 現在可以說「本守門不會藏到合法價格」,而那句話的來源是一個人的記憶。
 *   ```
 *   ⚠️ **而 `?? 0` 這個洞【沒有】因為 count=0 而消失** ——
 *      `price_general` 欄位**沒有 NOT NULL 約束**,下一次匯入照樣可能塞 NULL 進來。
 *      **洞還在,只是今天沒有人踩到。**(主視窗 2026-08-25 已把這句當面講給 Sean。)
 *   📌 來源座標:`lib/products.ts:486` 把 RPC `search_catalog_by_vehicle` 的列
 *      餵進 `catalogRowToUIProduct`;RPC 內部實際查哪張表**我沒讀過**(在 migration 裡)。
 */
function isRenderablePrice(v: number | null | undefined): v is number {
  // 🔴 三層各自擋不同的東西,**每一層都有自己的測試格與突變證明**(見 Price.test.tsx):
  //   `Number.isFinite`  擋 `Infinity`(它 `> 0` 為真、會被印成「NT$ ∞」)。
  //     ⚠️ `NaN` 本來就過不了 `> 0` ⇒ **不要拿 NaN 那一格去證明 finite 這層有受測**
  //        (codex R1 抓到的:第一版沒有 Infinity ⇒ 拿掉 `Number.isFinite` 照樣全綠)。
  //   `Number.isInteger` 擋小數。**本 repo 金額規則是「整數元位」**
  //     (`catalog-page.ts` 註解 / CLAUDE.md Server 端鐵則「金額用整數或 Decimal、禁用 number」)
  //     ⇒ 一個小數價格**本身就已經違反規則**,把它照原樣印給客人不是「保守」,是把壞資料當成價格。
  //     🔴 這一層是 codex 連兩輪判 must-fix 才加的。我第一版的理由是「加了會放大誤擋風險」——
  //        **那個理由站不住**:小數價格在本 repo 沒有合法身分,擋掉它不叫誤擋。
  //   `v > 0`            擋 0(本案主因)、負數。
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0;
}

export type PriceProps = {
  /**
   * 🔴 只放寬到 `| null`(=「上游老實承認拿不到」),**刻意不收 `undefined`**:
   *   收了 `undefined`,任何呼叫端漏傳 prop 都會安靜地變成「—」而型別檢查不吭聲
   *   (codex R1 must-fix:「會讓所有呼叫端的資料缺漏通過型別檢查並被靜默遮蔽」)。
   *   ⇒ 型別層嚴、執行期寬:`isRenderablePrice` 仍然擋得住 runtime 溜進來的 `undefined`。
   */
  price: number | null;
  originalPrice?: number | null;
  tierLabel?: TierLabel;
  showSavedTag?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  layout?: 'inline' | 'stack';
  className?: string;
};

export function Price({
  price,
  originalPrice = null,
  tierLabel = null,
  showSavedTag = false,
  size = 'md',
  layout = 'inline',
  className = '',
}: PriceProps): ReactNode {
  // 🔴 **最先判、在任何分支之前**:拿不到價格 ⇒ **拒絕變成一個數字**。
  //   ⚠️ design-reference 對「價格未提供」這個狀態 **0 命中**(2026-08-25 全目錄 grep:
  //      `洽詢|價格未定|敬請|price-na|price-unknown` 皆無)⇒ **稿上沒有畫過這一格。**
  //      這裡的 `—` 沿用 repo 內既有慣例(`app/dev-preview/brands/[slug]/page.tsx:99`
  //      對 `price != null` 為否時就是印 `—`),**不是我新編的文案**。
  //   🔴🔴 **2026-08-25 這一格【仍然沒有拍板】,而它長得很像已經拍了。**
  //      端出去的是「甲『—』/ 乙『價格請洽詢』/ 丙 整張卡片隱藏」,**Sean 沒有選任何一個** ——
  //      他反問「不應該有沒價錢的卡片吧?」⇒ 那是一個**更好的問題**
  //      (而 `price_general is null` 的 count 正好 = 0,回答了他),
  //      **但它不是甲乙丙裡的任何一個。**
  //   ⇒ 這裡維持 `—` 是**現行實作**,不是拍板結果。**要改隨時可以改,不必回頭找誰授權。**
  if (!isRenderablePrice(price)) {
    return (
      <span className={`price-wrap price-${size} price-${layout} ${className}`}>
        <span className="price-main" aria-label="價格未提供">
          —
        </span>
      </span>
    );
  }

  const isMember = tierLabel !== null;
  /**
   * 三條件 AND:
   * (1) !isMember — 訪客 / 一般會員、無 dealer 價
   * (2) originalPrice 本身是個可印的價格(🔴 原為 `!== null`,而 `0` 通得過那個判斷)
   * (3) originalPrice > price — 真有折扣、非 originalPrice <= price 異常狀態
   * 三條件互斥於 isMember 分支(dealer 不顯示 retail discount)
   */
  const hasRetailDiscount = !isMember && isRenderablePrice(originalPrice) && originalPrice > price;

  // isMember:劃線 originalPrice + tier 價 + tierLabel pill
  if (isMember) {
    return (
      <span className={`price-wrap price-${size} price-${layout} is-dealer ${className}`}>
        {/* 🔴 原為 `originalPrice !== null` ⇒ `originalPrice = 0` 會印出一條劃掉的「NT$ 0」。
            這一格與上面 `price` 那格是**同一個病的第二個出口**,同一把尺一起收。 */}
        {isRenderablePrice(originalPrice) && (
          <span className="price-orig price-strike">NT$ {originalPrice.toLocaleString()}</span>
        )}
        <span className="price-main">NT$ {price.toLocaleString()}</span>
        <span className="price-tag-dealer ap-mono">{tierLabel}</span>
      </span>
    );
  }

  // retail discount(general + sale):劃線 origPrice + sale 價
  if (hasRetailDiscount && isRenderablePrice(originalPrice)) {
    return (
      <span className={`price-wrap price-${size} price-${layout} ${className}`}>
        <span className="price-orig price-strike">NT$ {originalPrice.toLocaleString()}</span>
        <span className="price-main is-sale">NT$ {price.toLocaleString()}</span>
        {showSavedTag && (
          <span className="price-tag-save ap-mono">省 NT$ {(originalPrice - price).toLocaleString()}</span>
        )}
      </span>
    );
  }

  // 純價
  return (
    <span className={`price-wrap price-${size} price-${layout} ${className}`}>
      <span className="price-main">NT$ {price.toLocaleString()}</span>
    </span>
  );
}
