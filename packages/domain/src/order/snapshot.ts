/**
 * @module @pcm/domain/order/snapshot — 訂單品項商品快照(逐欄白名單 + canonicalize)
 *
 * 🔴 鐵則 12 經銷價零滲入(plan §5 紅線 4):雙語意 —
 * - `createProductSnapshot`(建構路徑 / strip):從可能更寬的來源萃取乾淨 `{title,sku,spec}` 副本。
 * - `assertProductSnapshot`(驗證路徑 / reject):對已組好快照 fail-closed reject 白名單外欄。
 * 兩者封 price_by_tier / price_store / cost 進入 domain Order。
 *
 * 抽自 order.ts(鐵則 6:order.ts >400 行必拆、快照三函式內聚為獨立單元)。
 *
 * @see packages/domain/src/order/order.ts(createOrderItem / canonicalizeOrderItem 使用)
 */

import type { ProductSnapshot } from './types';
import { OrderError } from './errors';

/** ProductSnapshot 合法欄白名單(🔴 鐵則 12:經銷價 / cost 不在其中)。 */
const ALLOWED_SNAPSHOT_KEYS: readonly string[] = ['title', 'sku', 'spec'];

/** 驗 ProductSnapshot 欄位值合法(title/sku 非空字串、spec 為字串 map);不檢查多餘欄。 */
function assertSnapshotFields(snapshot: ProductSnapshot): void {
  const { title, sku, spec } = snapshot;
  if (typeof title !== 'string' || title.length === 0) {
    throw new OrderError(
      'invalid_snapshot',
      'productSnapshot.title must be non-empty string',
    );
  }
  if (typeof sku !== 'string' || sku.length === 0) {
    throw new OrderError(
      'invalid_snapshot',
      'productSnapshot.sku must be non-empty string',
    );
  }
  if (typeof spec !== 'object' || spec === null) {
    throw new OrderError('invalid_snapshot', 'productSnapshot.spec must be an object');
  }
  for (const [key, value] of Object.entries(spec)) {
    if (typeof value !== 'string') {
      throw new OrderError(
        'invalid_snapshot',
        `productSnapshot.spec.${key} must be string, got ${typeof value}`,
      );
    }
  }
}

/**
 * createProductSnapshot:逐欄白名單**複製**商品快照(建構路徑:從可能更寬的來源萃取乾淨快照)。
 *
 * 🔴 鐵則 12(plan §5 紅線 4):**只**取 `title` / `sku` / `spec` 三欄、即使輸入物件帶
 * `price_by_tier` / `price_store` / `cost` 等敏感欄也**不複製**(執行期擋經銷價滲入 Order;
 * 配合 `ProductSnapshot` 型別編譯期擋)。建構路徑用「萃取乾淨副本」語意(strip);驗證路徑用
 * `assertProductSnapshot`(對已組好快照 fail-closed reject 多餘欄)。回傳全新 plain literal、
 * 不沿用輸入物件參照(canonicalize:封隱藏 toJSON / getter 在序列化偷渡)。
 *
 * @throws OrderError code `invalid_snapshot` 若 title / sku 非非空字串、或 spec 值非字串
 */
export function createProductSnapshot(input: ProductSnapshot): ProductSnapshot {
  assertSnapshotFields(input);
  const spec: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.spec)) {
    spec[key] = value;
  }
  // 只回 title / sku / spec 三欄 —— 輸入的任何額外欄(經銷價 / cost)在此被丟棄
  return { title: input.title, sku: input.sku, spec };
}

/**
 * assertProductSnapshot:驗一個**已組好**的快照 — 欄位值合法 **且無白名單外欄**;違反 throw。
 *
 * 🔴 鐵則 12 fail-closed(MUST-FIX-2):用於驗證路徑(assertOrderItemInvariant),對 hand-built
 * 繞過 createOrderItem、帶 `price_store` / `price_by_tier` / `cost` 的快照在 createOrder 邊界
 * **reject(throw)而非靜默 strip** — 經銷價防線在 domain 地基不留繞道。
 *
 * @throws OrderError code `invalid_snapshot` 若有白名單外欄、或欄位值非法
 */
export function assertProductSnapshot(snapshot: ProductSnapshot): void {
  for (const key of Object.keys(snapshot)) {
    if (!ALLOWED_SNAPSHOT_KEYS.includes(key)) {
      throw new OrderError(
        'invalid_snapshot',
        `productSnapshot has disallowed key "${key}" (white-list: title/sku/spec;鐵則 12 經銷價 fail-closed)`,
      );
    }
  }
  assertSnapshotFields(snapshot);
}
