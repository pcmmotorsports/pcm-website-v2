import { describe, expect, it, vi } from 'vitest';

// order-repository-audit-order.test.ts — `#508` 的**可單元測那一半**。
//
// 🔴🔴 **條目說「排序次鍵那半邊要整合測試才驗得到 —— 那是真的多一階」。**
//    **那句話對【排序行為】成立,對【呼叫形狀】不成立。**
//    `#508` 真正怕的那個回歸,條目自己逐字寫著:
//      「日後有人**順手清理**把第二個 `.order()` 拿掉,**沒有任何守門會叫**。」
//    ⇒ 那件事**不需要真 PostgREST** —— 它只需要一個可觀測的 client 替身。
//    (同型的更正今天發生過一次:`#499` 的「要連線才驗得到」也只對行為成立,對字面不成立。)
//
// ⚠️ **本檔【不】驗排序結果**(那真的要接 PostgREST + 造出 `created_at` 相同的多筆)
//    ⇒ **`.order()` 參數對、但 PostgREST 端行為不如預期**,本檔抓不到。缺口留著,`#508` 條目保留。

const orderSpy = vi.fn();

/** 可鏈式呼叫的最小替身:每一步都回自己,最後 `limit()` 回 `{ data, error }`。 */
function makeClient() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    from: vi.fn(self),
    select: vi.fn(self),
    order: (...args: unknown[]) => {
      orderSpy(...args);
      return chain;
    },
    limit: vi.fn(async () => ({ data: [], error: null })),
  });
  return chain;
}

vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters', () => ({ SupabaseOrderAdapter: class {} }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: () => makeClient() }));

import { getAdminAuditLogReader } from './order-repository';

describe('`#508` 稽核紀錄讀取:同一時刻的兩筆要有穩定次鍵', () => {
  it('🔴 `.order()` 恰兩次,且順序是 created_at → id(兩者都 descending)', async () => {
    orderSpy.mockClear();
    // `getAdminAuditLogReader()` 回的是 reader；它內部的 selector 才會發查詢。
    const reader = getAdminAuditLogReader();
    // 走公開入口(不直接打內部 selector)—— 走內部的話,測到的是我自己的想像,不是這個碼會做的事。
    await reader.listRecent(50);

    expect(orderSpy.mock.calls, '少一次 = 次鍵被「順手清理」掉了,而畫面不會有任何異常').toHaveLength(
      2,
    );
    expect(orderSpy.mock.calls[0]).toEqual(['created_at', { ascending: false }]);
    expect(
      orderSpy.mock.calls[1],
      '🔴 這一行就是 `#508` 說「零測試覆蓋」的那個次鍵',
    ).toEqual(['id', { ascending: false }]);
  });
});
