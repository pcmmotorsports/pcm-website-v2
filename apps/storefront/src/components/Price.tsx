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
 * 🔴🔴 **一個「可以印給客人看」的價格 = 有限的非負整數(含 0)。**
 *   ~~原文寫「有限的**正數**」~~ ⇒ 2026-08-25 Sean 拍板 0 是合法價格(贈品)之後已失效。
 *
 * ── 為什麼要有這個判斷(不是防禦性程式設計,是這個 repo 自己記過的病)──────
 * 「NT$ 0」在本 repo 有**兩個完全不同的來路**,2026-08-25 拍板只翻掉其中一個:
 *   ✅ **仍然是錯價**:`store` / `premiumStore` 的 dummy 0(經銷結構不進 client bundle 而塞的假值)
 *      —— 下面五處註解講的正是這個, **它們今天依然成立, 不要當成過期字面拿掉**(codex 片B R2 nit)。
 *   🔄 **不再是錯價**:商品本身真的賣 0 元(贈品 / 買一送一的那個「送」/ 試用品)。
 *   ⇒ 正確的分法是**看那個 0 是誰生的**, 不是看它長什麼樣 —— 兩者在畫面上一模一樣。
 *   `lib/products.ts:226` 「取 general 防 NT$0」
 *   `lib/products.ts:280` 「會顯『NT$ 0』錯價」
 *   `lib/products.ts:335` 「(codex 16c-3 k1 must-fix 2)」← **它曾被判 must-fix**
 *   `app/account/page.tsx:105`、`lib/recommendations/rule-based-engine.ts:36` 同旨
 * ⇒ 全 repo 的緩解方式是同一句:**「一律走 `general` 公開價就不會是 0」**。
 *
 * 🔴 **而 `general` 自己可以是 null。**
 *   `lib/catalog-page.ts` 原本寫 `price: row.price_general ?? 0`
 *   ⚠️ **那一行 2026-08-25(`e31f22ae`)已經被拆掉了, 現在是 `?? null`** —— 下面 ② 那段的
 *      「造假的那一步還在」**已經不成立**, 留著是為了讓這段歷史讀得懂。
 *   `CatalogListRow.price_general` 型別 = `number | null`(產生檔 `database.types.ts:2908`)
 *   ⇒ **那五處註解一致指向的那條安全路,終點正好生出它們在避開的那個 0。**
 *   ~~⇒ 而這件事一顆測試都沒有在守;它靠的是「資料剛好都有值」。~~
 *   ✅ **已不成立**(codex 片B R2 nit):`e31f22ae` 在 `lib/catalog-page.test.ts` 補了三格
 *      (`price_general = null ⇒ price 必須是 null` / `= 0 ⇒ 必須是 0` / 正對照),
 *      而那一行 `?? 0` 也已經拆掉。
 *
 * ⚠️ **本守門的射程(不要讀成「NT$ 0 不會再出現」)**
 *   ① 只守**這個元件**。`ProductInfo.tsx:243` / `ProductPage.tsx:324` /
 *      `account/tabs/FavoritesTab.tsx:66` 各自有自己的 `NT$ {x.toLocaleString()}`,**本守門看不到**。
 *   ② ~~它**不修** `catalog-page.ts` 那個 `?? 0`~~ ⇒ **`e31f22ae` 已經修了。**
 *      做法不是放寬 `MockProduct.price`(那是約 10 支檔),而是新增
 *      `CatalogCardProduct = Omit<MockProduct,'price'> & { price: number | null }` 走卡片那條路。
 *      ⇒ **現在 `null` 會原封走到這裡**,不再變成 0。
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
 * 🔴🔴 **這段的結論在 2026-08-25 被推翻了。原文留著,因為【它錯的方式】比它的結論有用。**
 *
 *   ~~`> 0` 的已知代價:若真有「贈品 / 0 元品」,本守門會誤擋它 —— 而我沒有證明它不存在。~~
 *   ~~🟡 口頭「有沒有 0 元商品(贈品/全額折抵)?」⇒ Sean 答【沒有】(這一格是人講的,不是查出來的)~~
 *
 *   ✅ **同日稍晚 Sean 正式拍板【乙:會, 偶爾有】**(贈品 / 買一送一的那個「送」/ 試用品)
 *      ⇒ **0 是合法價格, 要印成「NT$ 0」。判準因此改成 `>= 0` 並拆成兩支。**
 *      落點 memory `project_0825-sean-zero-price-is-real-print-ntd-zero`。
 *   📌 **那個「誤擋」不是假設, 它是真的** —— 只是解法不是「證明贈品不存在」,而是「讓它印出來」。
 *
 *   ✅ 量到(2026-08-25 anon 對正式站實測, 而**數字要帶著它的世界走**):
 *   ```
 *   products_list_public    20,668 筆  price_general is null ⇒ 0 · = 0 元 ⇒ 0
 *   product_variants_public 51,666 筆  同上
 *   尺的雙向證明: products_public.video_url is.null ⇒ 18,955 · description ⇒ 199
 *                ⇒ is.null 不是恆回 0
 *   ```
 *   ⚠️ **而 0 元【還不能上線】** —— 它被擋在另外兩個地方(皆活庫實比):
 *      上架 `sync_product_variant_group` 拒 `price_general <= 0` ·
 *      結帳 `create_order` 拒 `unit_price <= 0`。
 *      **本檔只管顯示層, 而顯示層是三道關卡裡最後一道。**
 *   📌 來源座標:`lib/products.ts` 的 `result.rows.map(...)`(**別記行號, 它已漂過一次**)把
 *      RPC `search_catalog_by_vehicle` 的列
 *      餵進 `catalogRowToUIProduct`;RPC 內部實際查哪張表**我沒讀過**(在 migration 裡)。
 */
/**
 * 一個可以印給客人看的**顯示價**。
 *
 * 🔴🔴 **`>= 0` 是拍板結果, 不是筆誤**(Sean 2026-08-25 拍「乙:會, 偶爾有」——
 *   贈品 / 買一送一的那個「送」/ 試用品 ⇒ **0 是合法價格, 要印成「NT$ 0」**)。
 *   ⚠️ **不要「順手」改回 `> 0`。** 那會安靜地把贈品變成一條槓,而畫面上只是少一個數字。
 *   守它的那一格:`Price.test.tsx` 的「🔴 `0` 是合法價格(贈品)⇒ 要印出 NT$ 0」。
 *
 * 🔴 **而它與 `isRenderableOriginalPrice` 對【同一個值 0】要的答案是相反的** ——
 *   這正是本片拆成兩支的理由。實測(2026-08-25,先只改判準、一個測試都不動):
 *   把單一判準的 `> 0` 改成 `>= 0` ⇒ `Price.test.tsx` **紅兩格**,
 *   第二格是「經銷分支 `originalPrice=0` ⇒ 不得印出劃掉的假原價」。
 *   ⇒ **同一個判準被兩個要求相反的用途共用 ⇒ 判準在說謊。**
 *   (姊妹句在 `lib/catalog-page.ts`:同一個型別被兩條保護程度不同的路共用 ⇒ 型別在說謊。)
 */
function isRenderablePrice(v: number | null | undefined): v is number {
  // 🔴 **四層**(~~原文寫「三層」~~,`Object.is` 那層是片B 加的)。而下面第一層的自述曾經是假的:
  //   `Number.isFinite`  🔴🔴 **它今天是冗餘的, 而檔內原本寫著「只有它擋得住 Infinity」。**
  //     實測(2026-08-25 片B,node + 突變兩發):
  //       `Number.isInteger(Infinity)` / `(-Infinity)` / `(NaN)` ⇒ **三個都是 false**
  //       把 `Number.isFinite(v)` 整句拿掉 ⇒ `Price.test.tsx` **31 格全綠, 一格都沒紅**
  //     ⇒ **那句自述活過了兩輪 codex 對抗審查, 而它是錯的。**(codex 片B R2 nit 抓到)
  //     ⇒ 留著它是**意圖標記**不是行為需要:哪天有人放寬 `Number.isInteger`(例如要收小數),
  //       `Infinity` 會立刻從那個缺口進來。**執行期冗餘、意圖承重 —— 兩件事。**
  //   `Number.isInteger` 擋小數。**本 repo 金額規則是「整數元位」**
  //     (`catalog-page.ts` 註解 / CLAUDE.md Server 端鐵則「金額用整數或 Decimal、禁用 number」)
  //     ⇒ 一個小數價格**本身就已經違反規則**,把它照原樣印給客人不是「保守」,是把壞資料當成價格。
  //     🔴 這一層是 codex 連兩輪判 must-fix 才加的。我第一版的理由是「加了會放大誤擋風險」——
  //        **那個理由站不住**:小數價格在本 repo 沒有合法身分,擋掉它不叫誤擋。
  //   `v >= 0`           擋負數。**不擋 0** —— 0 是贈品的合法價格(Sean 2026-08-25)。
  //     ~~原文:「`v > 0` 擋 0(本案主因)、負數」~~ ⇒ 那是拍板前的世界。
  //   `!Object.is(v, -0)` 擋負零。🔴 **這一層是 `>= 0` 帶進來的新破口**(codex 片B R1 must-fix):
  //     舊寫法 `v > 0` 天然擋掉 `-0`(`-0 > 0` 為 false),換成 `>= 0` 之後它通了。
  //     實測(node,2026-08-25):`Number.isFinite(-0)`=true · `Number.isInteger(-0)`=true ·
  //     `-0 >= 0`=true · **`(-0).toLocaleString()` ⇒ `"-0"`** ⇒ 畫面會印「NT$ -0」。
  //     `JSON.parse('-0')` 保留 `-0`(而 `JSON.stringify(-0)` 是 `0`)⇒ 反序列化這條路進得來。
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && !Object.is(v, -0);
}

/**
 * 一個可以印成**劃掉的原價**的值。
 *
 * 🔴 **這裡是 `> 0`,而上面那支是 `>= 0` —— 兩者刻意不同。**
 *   「原價 NT$ 0」沒有意義:它不是一個客人曾經要付的金額,而 `0` 又通得過
 *   舊寫法的 `originalPrice !== null`(那正是本檔 isMember 分支上方那段註解擋掉的東西;
 *   ~~原本寫 `:144`~~ ⇒ **行號會漂, 改用字面錨**)。
 *   ⇒ 贈品的顯示價可以是 0;**贈品的「原價」不可以是 0**。
 *
 * 🔴🔴 **而它在執行期【也是冗餘的】—— 這一格是本檔第二個同款(2026-08-25 收工後量到)。**
 *   三個呼叫點**都**跟著一個 `originalPrice > price`,而顯示價本身已被上面那支限成 `>= 0`
 *   ⇒ `originalPrice = 0` 時 `0 > price` 對任何**合法的** price 都是 false ⇒ 它先被那個比較擋掉。
 *   突變實測(在 `0ed3cf16` 這份碼上跑的):
 *   ```
 *   把本函式的 `v > 0` 改成 `v >= 0`                       ⇒ 31 格全綠, 0 紅
 *   把 isMember 那個呼叫換成寬的 isRenderablePrice(保留 `> price`) ⇒ 31 格全綠, 0 紅
 *   ```
 *   ⚠️ **而交件時我報的是「2 failed | 29 passed」** —— 那一發是真的,
 *      **只是它跑在【加上 `originalPrice > price` 之前】的碼上, 而我沒有在修完之後重跑它。**
 *      ⇒ 每一句話當時都為真, 而**證物不再撐得起結論**。這一格由 cc 收包時的獨立突變抓到。
 *   ⇒ 處置與上面 `Number.isFinite` 那層相同:**留著**(哪天有人拿掉那個 `> price` 比較,
 *     它就是唯一擋住「原價 NT$ 0」的東西),**而自述必須說實話**。
 *   ⚠️ 誠實邊界:「全綠」是量到的;「構造不出反例」是**推的** —— 我沒有證明它不可達。
 *
 * ⚠️ 不要把這支併回 `isRenderablePrice` —— 它們對 `0` 要的答案相反,合併等於挑一個犧牲。
 */
function isRenderableOriginalPrice(v: number | null | undefined): v is number {
  return isRenderablePrice(v) && v > 0;
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
  //   ✅ **2026-08-25 這一格【已經拍了】** —— ~~原文寫「仍然沒有拍板」,同日稍晚失效。~~
  //      第一次端出「甲『—』/ 乙『價格請洽詢』/ 丙 整張卡片隱藏」時他**沒有選**,
  //      而是反問「不應該有沒價錢的卡片吧?」。
  //      ⇒ 主視窗帶著**新資訊**回去問(卡片不出現的話,「共 N 件」不會跟著少 ⇒ 數字與畫面對不起來):
  //        甲 還是不要出現, 數字對不起來我可以接受 / 乙 卡片留著, 價格那格印一條槓「—」
  //        **A ⇒ 【乙】。** 也就是**這裡現在的行為**。
  //      ⚠️ 而他面前有兩個理由(數字對不起來 / 藏起來就再也不知道有幾筆缺價格),
  //         **我們不知道他是因為哪一個。** 不得寫成「Sean 同意『藏起來沒訊號』的說法」。
  //   ⇒ 這裡的 `—` 現在**是拍板結果**, 不再是「現行實作」。要改要回去問。
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
  const hasRetailDiscount = !isMember && isRenderableOriginalPrice(originalPrice) && originalPrice > price;

  // isMember:劃線 originalPrice + tier 價 + tierLabel pill
  if (isMember) {
    return (
      <span className={`price-wrap price-${size} price-${layout} is-dealer ${className}`}>
        {/* 🔴 原為 `originalPrice !== null` ⇒ `originalPrice = 0` 會印出一條劃掉的「NT$ 0」。
            這一格與上面 `price` 那格是**同一個病的第二個出口**,同一把尺一起收。 */}
        {/* 🔴 `originalPrice > price` 是承重的(codex 片B R1 must-fix):
            少了它, `price=5000 / originalPrice=1000 / tierLabel="P價"` 會把**比較低的 1000**
            劃掉, 畫面上讀起來像「原價 1,000 → 現在 5,000」= 暗示一個不存在的折扣。
            下面 retail 分支的 `hasRetailDiscount` 本來就含這個比較, 而這一支漏了。 */}
        {isRenderableOriginalPrice(originalPrice) && originalPrice > price && (
          <span className="price-orig price-strike">NT$ {originalPrice.toLocaleString()}</span>
        )}
        <span className="price-main">NT$ {price.toLocaleString()}</span>
        <span className="price-tag-dealer ap-mono">{tierLabel}</span>
      </span>
    );
  }

  // retail discount(general + sale):劃線 origPrice + sale 價
  if (hasRetailDiscount && isRenderableOriginalPrice(originalPrice)) {
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
      {/* ⚠️ `toLocaleString()` **沒有指定 locale**(codex 片B R2 nit):在 `ar-EG` 這類環境
          它會印出非 ASCII 數字(例如 `NT$ ٠`)。⇒ 測試斷言的「逐字等於 `NT$ 0`」只在
          執行環境的預設 locale 下成立;**能保證的是「值為零」, 不是「畫面上那三個字元」。**
          全檔其他 `toLocaleString()` 同此邊界 —— 要釘死就得統一傳 locale, 那是另一片。 */}
      <span className="price-main">NT$ {price.toLocaleString()}</span>
    </span>
  );
}
