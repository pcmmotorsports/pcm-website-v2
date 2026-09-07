/**
 * 從外部讀進來的值,**只有這一支負責判它是什麼**。
 *
 * 🔴 **為什麼要集中一支**(2026-09-07 `-auth`,主視窗 B 裁「這是載體問題」):
 *   同一族的 finding 連三輪:①`NaN` ②`count` 回 `null` 而非 0 ③`amount` 是字串 `"555"`。
 *   **每一輪我都只補了那一種形狀**,而下一輪又掉出另一種。
 *   ⇒ 📌 **散在各呼叫點各擋各的 = 每個點都要記得全部形狀** ⇒ 一定會漏。
 *   ⇒ ✅ 收成一支 + 一張**形狀表**(每一種形狀一格測試),漏的那一種在表上看得見。
 *
 * 🔵 **形狀表的分母錨在【型別語意】, 不錨在「我想得到幾種」**(主視窗 B 2026-09-07:
 *   「把形狀表錨到型別語意 …… 『漏的那一種』就有地方可查, 不再只靠你我想得到」)——
 *
 *   | 來源 | 傳輸層 | JS 端**實際**會拿到的形狀 |
 *   |---|---|---|
 *   | 上游 PG `numeric` / `bigint` | `pg`(node-postgres) | **`string \| null`** —— `pg` 對這兩類**不轉數字**(怕精度掉), 所以 `"554.60"` / `"5.55e2"` / PG 的 `NaN` 會原樣變成字串 `"NaN"` |
 *   | 上游 PG `int4` | `pg` | `number \| null` |
 *   | `products.price_by_tier` 內的 `store.amount` | PostgREST → `jsonb` | **任何 JSON 型別** —— `number` / `string` / `boolean` / `null` / 物件 / 陣列 / **鍵不存在**(⇒ `undefined`);jsonb **存什麼就回什麼**, 沒有欄位型別在把關 |
 *   | `{ count }`(PostgREST `count: 'exact'`) | PostgREST | **`number \| null`** —— `null` 代表**沒算出來**, 不是零筆 |
 *
 *   ⇒ 📌 **這張表就是 `dealer-price-parse.test.ts` 的分母**:那裡每一格對應這裡的一種形狀。
 *   ⇒ 🛑 **要新增一條讀入之前, 先在這張表上找它的來源那一列** —— 沒有那一列 ⇒ 先把它加進來。
 *   ⚠️ **本表答不出的**:上游正式庫**實際**會不會回這些形狀, `-auth` **沒有量過** ——
 *     這張表講的是**型別允許什麼**, 不是**資料現在長什麼樣**。兩者不同, 而前者是後者的上界。
 *
 * 🛑 **判準只有一句**:**「沒有值」與「值是 0」必須分得開** ——
 *   前者代表「這一列本來就沒有經銷價」,後者是 2026-08-25 拍板的**合法贈品價**。
 */

/** 一個外部數值的解讀結果。🔴 三態,不是兩態。 */
export type ParsedNumber =
  /** 讀到一個合法的整數金額(含 0)。 */
  | { readonly kind: 'value'; readonly value: number }
  /** **這一列沒有值** —— `null` / `undefined` / 缺 key / 空字串。與「值是 0」不同。 */
  | { readonly kind: 'absent' }
  /** **讀到了而它不能用** —— 非數字字串 / `NaN` / 負 / 超出 int4。🛑 不得當成 `absent`。 */
  | { readonly kind: 'invalid'; readonly why: 'not_a_number' | 'negative' | 'overflow' };

const INT4_MAX = 2147483647;

/**
 * 解讀一個金額欄。**所有從 DB / view / jsonb 讀進來的金額都要走這裡。**
 * 🔵 形狀表(每一種在 `dealer-price-parse.test.ts` 各有一格):
 *   `null` · `undefined` · 缺 key · 數字 · 字串數字 `"555"` · 非數字字串 `"abc"` ·
 *   空字串 · `0` · `"0"` · 負數 · 超出 int4 · 小數 · `NaN` · 布林 · 物件
 */
export function parseAmount(raw: unknown): ParsedNumber {
  if (raw === null || raw === undefined) return { kind: 'absent' };
  if (typeof raw === 'string' && raw.trim() === '') return { kind: 'absent' };
  // 🛑 布林在 `Number()` 之下會變成 0/1 —— 那是**型別意外**不是金額,擋掉。
  if (typeof raw !== 'number' && typeof raw !== 'string') return { kind: 'invalid', why: 'not_a_number' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { kind: 'invalid', why: 'not_a_number' };
  // 🛑 **值域驗【原值】, 不驗四捨五入後的值** —— codex 2026-09-07 合成資料實測:
  //   `-0.01` 經 `Math.round` 變成 **`-0`**, 而 **`-0 < 0` 是 `false`** ⇒ 一個負的上游價
  //   會被判成「合法的 0 元」(2026-08-25 拍板的贈品價)⇒ **商品經銷價寫成 0**。
  //   🔴 病灶不是少擋一種形狀, 是**我拿轉換後的值去驗轉換前的條件**。
  if (n < 0) return { kind: 'invalid', why: 'negative' };
  if (n > INT4_MAX) return { kind: 'invalid', why: 'overflow' };
  const r = Math.round(n); // 🔵 與 `price_general` 同一個轉法
  // 🔵 進位跨過上界(`2147483647.6`)⇒ 仍然擋掉, 寧可整批不收也不要讓 DB 拒。
  if (r > INT4_MAX) return { kind: 'invalid', why: 'overflow' };
  return { kind: 'value', value: r };
}

/**
 * 解讀 `count`(`{ count, error }` 那一族)。
 * 🔴 **`count === null` 而 `error === null` 不是「零筆」,是【沒讀到】** ——
 *   當成 0 會略過整個讀取迴圈**而且通過守門**(got 0 = expected 0)。
 */
export function parseCount(count: unknown, error: unknown): { ok: true; count: number } | { ok: false } {
  if (error) return { ok: false };
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return { ok: false };
  return { ok: true, count };
}
