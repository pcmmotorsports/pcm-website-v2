/**
 * @module @pcm/domain/payment/bank-transaction-id — 3DS charge 前產生唯一 bank_transaction_id(M-3 3DS-5a)
 *
 * 🔴 格式硬約束(TapPay reference.html 逐字、跨收單行最嚴、codex 關卡1 #1):
 *   ≤19 字、純大寫英數 `^[A-Z0-9]{19}$`(無小寫 / 無 hyphen / 無 `_`;滿足中信19 / 國泰僅大寫英數 /
 *   玉山不可含 `_` 全部)。→ `crypto.randomUUID()`(小寫 + hyphen + 36 字)不合格 → 改本產生器。
 *
 * 🔴 用 Web Crypto 全域 `globalThis.crypto.getRandomValues`(**非** node:crypto `randomBytes`、審查側 must-fix):
 *   domain 套件 charter = framework-free 純邏輯,且本 barrel(@pcm/domain index)被 client component
 *   value-import(CartView / CheckoutView / useResolvedCart 都 import FREE_SHIPPING_THRESHOLD 等 runtime 值);
 *   package.json 無 `"sideEffects":false` → 把 node 內建放 barrel 靠 tree-shake 僥倖、不可靠,且 base 的 domain src
 *   零 node: import(本檔為首個)= payment/client-bundle 邊界回歸風險。改用 Node 24 + 瀏覽器通用的 Web Crypto
 *   CSPRNG、**零 node: import** → 放 barrel 安全、不依賴 tree-shake、保 domain isomorphic。
 *
 * 由 5b initiate use-case 在「送 charge 前」呼叫、傳入 adapter payload;adapter 忠實透傳、不自產(可測)。
 * 放 domain 層(use-case 可 import、不違 use-cases→adapters 邊界);DB 端另有 bank_transaction_id UNIQUE
 * 部分索引(5b)+ TapPay「不能與之前重複」雙保險防撞號。
 *
 * @see docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §2.2
 */

/**
 * Crockford base32 字母表(32 字、純大寫英數;已排除易混淆 I / L / O / U)。
 *
 * 🔴 零偏差取樣:`256 % 32 === 0` → `byte & 31`(取低 5 bits)為完全均勻 0-31、無 modulo bias。
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** PCM 來源前綴(便於 log / 對帳辨識;佔 1 字)。 */
const PREFIX = 'P';

/** 亂數段長度(字);PREFIX(1)+ RANDOM_LEN(18)= 19 字總長(滿足跨收單行最嚴 19 上限)。 */
const RANDOM_LEN = 18;

/**
 * 產生唯一 bank_transaction_id:19 字、`^[A-Z0-9]{19}$`、Web Crypto CSPRNG 安全亂數。
 *
 * 熵 ≈ 32^18 ≈ 2^90 → 防撞綽綽有餘(DB UNIQUE 索引 + TapPay 去重為雙保險)。
 */
export function generateBankTransactionId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
  let out = PREFIX;
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += CROCKFORD_ALPHABET[bytes[i]! & 31]!;
  }
  return out;
}
