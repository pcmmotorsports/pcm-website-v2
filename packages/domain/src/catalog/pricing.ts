import type { Product } from './types';
import type { MemberTier, Money } from '../shared/types';
import { toMoneyAmount } from '../shared/types';

/**
 * computeEffectivePrice: tier-aware 顯示價計算(catalog 層 pure function)。
 *
 * **角色:** server-side dispatch、storefront 內算好 effective price、防經銷價洩漏 client bundle
 * (對齊 docs/architecture/supabase-schema-design.md §6.1 priceByTier 不洩漏鐵則 +
 * docs/specs/M-1-03-main-a-刀-4-PRD.md §1.1 Q2=C + Q4=C 拍板)。
 *
 * **字面源(真權威):**
 * - `design-reference/components/Pricing.jsx` L27-42(getPriceForTier 三 tier dispatch + premium_extra_pct fallback 0%)
 * - `docs/architecture/supabase-schema-design.md` §3.1 brands 表 L167 註解(`store × (1 - premium_extra_pct / 100)`)
 * - `docs/architecture/supabase-schema-design.md` §5.1 PriceByTier 設計 L257(`premiumStore` 由 storefront 動態算)
 * - `packages/domain/src/catalog/types.ts` Brand L29 JSDoc(`premium 顯示價 = round(priceByTier.store.amount × (1 - premium_extra_pct / 100))`)
 *
 * **公式:**
 * - `'general'` → `priceByTier.general`
 * - `'store'` → `priceByTier.store`
 * - `'premiumStore'` → `{ amount: Math.round(store.amount × (1 - brand.premium_extra_pct / 100)), currency: store.currency }`
 *
 * **邊界(對齊 design L37-39):** `premium_extra_pct` 非 number 時 fallback 0%、即 premiumStore 顯示價 = store 價。
 *
 * **字面 vs 事實揭示:**
 * 1. design 公式吃 number、本實作收 Product 物件 + 返 Money brand(toMoneyAmount guard)、currency 對齊 store tier
 * 2. design L29 `if (!pbt) return product.price || 0; // legacy fallback` 不採:domain Product.priceByTier 必存、無 legacy 路徑
 * 3. design L114 `Object.assign(window, ...)` prototype 路徑不採、本實作 ES module export
 * 4. design L33 tier 字面 `'premium_store'` snake_case、本實作 `'premiumStore'` camelCase(對齊 shared/types.ts MemberTier enum)
 *
 * @param product Product entity(含 brand + priceByTier)
 * @param tier MemberTier enum(`'general'` | `'store'` | `'premiumStore'`)
 * @returns Money(tier-aware 顯示價、currency 對齊 store tier)
 *
 * 🔴 **而回傳值的【單位隨 tier 而變】,而型別不變** —— `general` 回的是【含稅】,
 * `store` 與 `premiumStore` 回的是【未稅】。三者都是 `Money`,呼叫端分不出來。
 * ⇒ 完整論證與來源:`packages/domain/src/catalog/types.ts` 的 `PriceByTier` 上方。
 *
 * @example
 * computeEffectivePrice(product, 'general')      // → product.priceByTier.general
 * computeEffectivePrice(product, 'store')        // → product.priceByTier.store
 * computeEffectivePrice(product, 'premiumStore') // → { amount: round(store × (1 - brand.premium_extra_pct / 100)), currency: 'TWD' }
 *
 * @see design-reference/components/Pricing.jsx L27-42
 * @see docs/architecture/supabase-schema-design.md §3.1 + §5.1
 * @see packages/domain/src/catalog/types.ts Brand.premium_extra_pct
 */

export function computeEffectivePrice(product: Product, tier: MemberTier): Money {
  if (tier === 'general') return product.priceByTier.general;
  if (tier === 'store') return product.priceByTier.store;
  // tier === 'premiumStore'
  const storePrice = product.priceByTier.store;
  const discounted = premiumAmountOrNull(storePrice.amount, product.brand.premium_extra_pct);
  const resultAmount = discounted ?? storePrice.amount;
  return {
    amount: toMoneyAmount(resultAmount),
    currency: storePrice.currency,
  };
}

/**
 * premiumStore 折後價 —— **全程整數**,而它自己驗前提。
 *
 * 🔵 **為什麼放在 `computeEffectivePrice` 【下面】**:放上面時,那支 exported 函式的
 *    主 JSDoc 會被這一段隔開而變成孤兒註解(codex R2 nit 抓到)。
 *    函式宣告會 hoist ⇒ 放下面不影響呼叫。
 *
 * 🔴 **為什麼要抽成具名函式而不是寫在呼叫點**(codex 對抗審查 2026-09-02 R1 #5):
 *    這一段的正確性【依賴三個前提】,而那三個前提在型別上看不出來
 *    (`premium_extra_pct` 的 TS 型別是 `number`,而 `number` 裝得下 16.4 與 -10)。
 *    ⇒ 前提要與算式住在一起,否則下一個呼叫端不會知道有前提。
 *
 * 🛑 **舊寫法錯在哪**:`Math.round(amount * (1 - pct / 100))` 先算出一個【浮點中間值】,
 *    而 IEEE 754 會讓恰好落在 .5 的那些組變成 .4999999999999 ⇒ `Math.round` 往下 ⇒ **少一元**。
 *    實例:1075 × (1 − 0.06) ⇒ 1010.4999999999999 ⇒ 1010,而規則要的是 1011。
 *    🔴 **而少的那一元是【賣方】的** —— 經銷商付得比規則少,承擔差額的是 PCM。
 *    (~~原句寫「受害者是經銷商」~~ ⇒ 方向寫反了,codex R1 #4 抓到;留舊字面讓搜它的人撞到這裡。)
 *
 * 🔵 **捨入規則沒有改**:仍是四捨五入(逢半進位)。來源見 `computeEffectivePrice` 檔頭 ——
 *    `design-reference/components/Pricing.jsx` L38 `Math.round(...)` + 本套件 `types.ts` Brand JSDoc。
 *    ⇒ 本次只是【讓那個規則真的做到】,不是換一個規則。
 * 🛑 而 design 那一份用的是同一個浮點形狀 ⇒ **它也有這個錯**;逐字搬會把錯搬回來。
 *
 * ⚠️ **不合前提時回 `null`** —— 呼叫端退回 store 原價(= 0% 加碼),
 *    與 design L37-39「`premium_extra_pct` 非 number ⇒ fallback 0%」同一個方向。
 *    🔴 **不 throw**:一筆壞的品牌資料不該讓整個商品頁掛掉;而 0% 是「不給折扣」= 安全側。
 */
function premiumAmountOrNull(amount: number, pct: unknown): number | null {
  // 前提①:折扣是【整數百分比】且在 DB CHECK 的值域內(brands.premium_extra_pct CHECK 0..30)。
  //   🔴 非整數會破壞下面那行的整數性:`100 - 16.4` 本身就是浮點
  //      ⇒ 375 / 16.4% 舊算法與新算法都給 313,而精確值是 314(codex R1 #1)。
  if (typeof pct !== 'number' || !Number.isInteger(pct) || pct < 0 || pct > 30) return null;
  // 前提②:金額是【安全整數】且非負。`toMoneyAmount` 只保證整數與非負,不保證 safe
  //   ⇒ 而乘法要精確,兩端與乘積都必須在 2^53 之內(codex R1 #2)。
  //
  // 🔴 **這一道【殺不死】—— 而那不是測試沒寫,是它在現行值域下是重複的**
  //    (突變實測 2026-09-02:單獨拿掉這一行,32 格測試【全綠】)。
  //    成因:`pct <= 30` ⇒ `numerator = amount × (100 − pct) >= amount × 70 >= amount`
  //    ⇒ amount 不 safe ⇒ numerator 必定也不 safe ⇒ **下面那道一定先抓到**。
  //    🔵 留著它是【深度防禦】:哪天 pct 的上限放寬到 100(那時 numerator 可能小於 amount),
  //       這一道就變成唯一擋得住的。⇒ 而那一天它才會有自己的測試。
  //    🛑 ⇒ 所以【不要】因為「沒有測試釘住它」而刪掉它,也不要宣稱它被測過。
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const numerator = amount * (100 - pct);
  if (!Number.isSafeInteger(numerator + 50)) return null;
  // 前提都成立時,這一行是精確的:乘積是精確整數;`+50` 精確;
  // 而 `/100` 之後取 floor —— 真值離整數邊界至少 0.01,遠大於 double 的相對誤差。
  // 🟢 已用 BigInt 當第三方逐組比對:金額 1..300,000 × pct 0..30 共 9,300,000 組零不一致。
  //    ⚠️ 而那個數字是【當時那個值域】的快照(codex R1 #3):值域變了它會靜靜過期
  //    ⇒ 要重算跑 `pricing.test.ts` 那一族,不要引用這個數字。
  return Math.floor((numerator + 50) / 100);
}
