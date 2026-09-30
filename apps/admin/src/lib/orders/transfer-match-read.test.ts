import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./order-repository', () => ({ getAdminOrderRepository: () => ({}) }));
const { loadTransferCandidates } = await import('./transfer-match-read');

// Fable R1 B1(2026-09-30):應付餘額那一發讀不到時, adapter 不丟錯、每張單的 balanceDue 都是 null
// ⇒ 小工具會說「可能少匯或多匯」—— 把系統讀不到講成客人匯錯。候選裡每張都是 null ⇒ 當讀不到。

const repoWith = (balances: (number | null)[]) =>
  ({
    listOrderSummariesForAdmin: vi.fn(async () => ({
      items: balances.map((b, i) => ({ id: `o-${i}`, balanceDue: b })),
      total: balances.length,
    })),
  }) as never;

describe('loadTransferCandidates', () => {
  it('🔴 有候選單而應付餘額全部讀不到 ⇒ null(畫面說載入失敗)', async () => {
    expect(await loadTransferCandidates(new Date('2026-09-30T04:00:00Z'), repoWith([null, null]))).toBeNull();
  });
  it('有讀到的 ⇒ 照常回候選;沒有任何待收款的單 ⇒ 空清單不是讀不到', async () => {
    expect((await loadTransferCandidates(new Date('2026-09-30T04:00:00Z'), repoWith([null, 7000])))!.orders).toHaveLength(4);
    expect((await loadTransferCandidates(new Date('2026-09-30T04:00:00Z'), repoWith([])))!.orders).toEqual([]);
  });
});
