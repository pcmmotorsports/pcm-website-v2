import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IWalletRepository } from '@pcm/ports';
import type { WalletLedgerEntry } from '@pcm/domain';
import { depositWallet } from './deposit-wallet';

function entry(over: Partial<WalletLedgerEntry> = {}): WalletLedgerEntry {
  return {
    id: 'w1',
    customerUserId: 'me',
    entryDate: '2026-05-24',
    entryType: 'deposit',
    amount: 30000,
    note: '儲值 NT$ 30,000',
    relatedOrderId: null,
    createdAt: 't',
    ...over,
  };
}

function makeRepo(over: Partial<IWalletRepository> = {}): IWalletRepository {
  return {
    listEntries: vi.fn(),
    addEntry: vi.fn().mockResolvedValue(entry()),
    getBalance: vi.fn(),
    ...over,
  } as unknown as IWalletRepository;
}

describe('depositWallet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 鎖系統時間驗 D3 台灣時區:UTC 2026-05-23 20:00 = 台灣 2026-05-24 04:00 → entryDate 應為 2026-05-24(UTC 會是 23)。
    vi.setSystemTime(new Date('2026-05-23T20:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('記一筆 deposit:currentUserId 填 customerUserId、entryType 固定 deposit、relatedOrderId null、回該筆帳(D1b)', async () => {
    const addEntry = vi.fn().mockResolvedValue(entry({ customerUserId: 'session-uid' }));
    const listEntries = vi.fn();
    const getBalance = vi.fn();
    const repo = makeRepo({ addEntry, listEntries, getBalance });

    const res = await depositWallet(repo, 'session-uid', 30000);

    expect(addEntry).toHaveBeenCalledWith({
      customerUserId: 'session-uid',
      entryDate: '2026-05-24',
      entryType: 'deposit',
      amount: 30000,
      note: '儲值 NT$ 30,000',
      relatedOrderId: null,
    });
    expect(res).toEqual(entry({ customerUserId: 'session-uid' }));
    // D1b:只回帳、不另查餘額/清單(不碰 getBalance / listEntries)
    expect(getBalance).not.toHaveBeenCalled();
    expect(listEntries).not.toHaveBeenCalled();
  });

  it('entryDate = 台灣當日(Asia/Taipei、非 UTC):UTC 前一晚 = 台灣已隔日(D3)', async () => {
    const addEntry = vi.fn().mockResolvedValue(entry());
    const repo = makeRepo({ addEntry });

    await depositWallet(repo, 'me', 10000);

    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ entryDate: '2026-05-24' }));
  });

  it('note 由 amount 衍生千分位、對齊 design「儲值 NT$ X」(D2)', async () => {
    const addEntry = vi.fn().mockResolvedValue(entry({ amount: 100000, note: '儲值 NT$ 100,000' }));
    const repo = makeRepo({ addEntry });

    await depositWallet(repo, 'me', 100000);

    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ note: '儲值 NT$ 100,000' }));
  });

  it('最小 guard(D4、只守正整數):0 / 負 / 浮點 拋、不呼 addEntry', async () => {
    const addEntry = vi.fn();
    const repo = makeRepo({ addEntry });

    await expect(depositWallet(repo, 'me', 0)).rejects.toThrow('正整數');
    await expect(depositWallet(repo, 'me', -100)).rejects.toThrow('正整數');
    await expect(depositWallet(repo, 'me', 99.5)).rejects.toThrow('正整數');
    expect(addEntry).not.toHaveBeenCalled();
  });

  it('addEntry 失敗向上拋', async () => {
    const addEntry = vi.fn().mockRejectedValue(new Error('db'));
    const repo = makeRepo({ addEntry });

    await expect(depositWallet(repo, 'me', 30000)).rejects.toThrow('db');
  });
});
