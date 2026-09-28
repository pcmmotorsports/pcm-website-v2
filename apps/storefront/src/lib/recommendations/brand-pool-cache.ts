import 'server-only';

import type { BrandPoolKey } from '@pcm/ports';

/**
 * 同品牌推薦的候選名單快取(伺服器程式記憶體,每台實例各一份)。
 * 計畫:`~/pcm-mailbox/計畫-同品牌推薦瘦身-20260928.md` §3 甲.3(Sean 2026-09-28 Q1 甲、Q2 甲 1 小時)。
 *
 * 🔴 **為什麼不用 `unstable_cache`**:推薦結果外層已經包了一層 `unstable_cache`
 *    (`fetch-recommendations.ts`),Next 16.3.6 在裡面再呼叫一層時會略過裡層的讀取
 *    ⇒ 每個商品算推薦仍會重查品牌池。模組層的 Map 不受這個限制。
 * - 到期就重查,不先回舊值。
 * - 同一個鍵同時有多個請求,只查一次(進行中的查詢也存著);查詢失敗就移除,不存結果。
 * - 超過筆數上限時丟掉最久沒用的(Map 依插入順序,命中時移到最後)。
 * 🔴 測試每個案例要 new 一份新的,不要共用正式程式那一份。
 */
export class BrandPoolCache {
  private readonly entries = new Map<string, { at: number; pool: Promise<BrandPoolKey[]> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 600,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<BrandPoolKey[]>): Promise<BrandPoolKey[]> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.pool;
    }
    const entry = { at: this.now(), pool: load() };
    entry.pool.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return entry.pool;
  }
}

/** 快取鍵:沒有指定分類時用 `*`,不用空字串(避免和「分類名稱是空字串」混在一起)。 */
export function brandPoolKey(brandId: string, categoryRaw: string | undefined, poolLimit: number): string {
  return `${brandId}|${categoryRaw ?? '*'}|${poolLimit}`;
}
