// 多張單一次各建一箱(2026-09-27 出貨流程乙第 7 項;Sean 答 Q1 甲)。
// 計畫 ~/pcm-mailbox/計畫-後台出貨流程乙-20260927.md 第二節第 7 項:按訂單分組、各自讀自己的品項與地址、各自一把重試鍵;
// 快照與鍵存在 sessionStorage, 成功才清;結果不明時用同一把鍵、同一份快照重送(Codex R3 必修 3)。
import { describe, expect, it, vi } from 'vitest';
import { createBoxForOrder, type BulkBoxDeps } from './bulk-box';

const CANDIDATES = {
  items: [
    { orderId: 'o1', orderItemId: 'i1', orderDisplayId: '8KT5XZ', variantSku: 'A', title: 'A', remaining: 2, blockedReason: null },
    { orderId: 'o1', orderItemId: 'i2', orderDisplayId: '8KT5XZ', variantSku: 'B', title: 'B', remaining: 0, blockedReason: 'not_arrived' },
    { orderId: 'o1', orderItemId: 'i3', orderDisplayId: '8KT5XZ', variantSku: 'C', title: 'C', remaining: 1, blockedReason: null },
  ],
  customerUserId: 'cu-1',
  recipient: { name: '流程車行', phone: '0912000927', line: '新北市新莊區化成路736巷18號' },
  balanceWarning: null,
};

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

function deps(over: Partial<BulkBoxDeps> = {}) {
  const storage = memoryStorage();
  const d: BulkBoxDeps = {
    fetchCandidates: vi.fn(async () => CANDIDATES) as unknown as BulkBoxDeps['fetchCandidates'],
    submit: vi.fn(async () => ({ ok: true, shipmentReference: 'K7X2MP', shipmentId: 's1', shipped: false })) as unknown as BulkBoxDeps['submit'],
    storage,
    newKey: vi.fn(() => 'key-1'),
    ...over,
  };
  return { d, storage };
}

describe('createBoxForOrder', () => {
  it('🔴 只送勾到而且可出的品項(數量 = 可出件數)、新竹、只建箱不出貨;成功後清掉快照', async () => {
    const { d, storage } = deps();
    const r = await createBoxForOrder('o1', ['i1', 'i2'], d);
    expect(d.submit).toHaveBeenCalledWith({
      idempotencyKey: 'key-1',
      recipient: CANDIDATES.recipient,
      carrierCode: 'hct',
      items: [{ orderItemId: 'i1', quantity: 2 }],
      markShipped: false,
    });
    expect(r).toEqual({ orderId: 'o1', label: '8KT5XZ', ok: true, text: '已建箱 K7X2MP' });
    expect(storage.m.size).toBe(0);
  });

  it('🔴 上一次結果不明(送出時斷線)⇒ 快照留著;重按用同一把鍵、同一份快照, 不重新讀品項', async () => {
    const first = deps({ submit: vi.fn(async () => { throw new Error('network'); }) as unknown as BulkBoxDeps['submit'] });
    const r1 = await createBoxForOrder('o1', ['i1'], first.d);
    expect(r1.ok).toBe(false);
    expect(r1.text).toContain('建箱結果不明');
    expect(first.storage.m.size).toBe(1);
    const sent1 = (first.d.submit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];

    const submit2 = vi.fn(async () => ({ ok: true, shipmentReference: 'K7X2MP', shipmentId: 's1', shipped: false }));
    const fetch2 = vi.fn();
    const r2 = await createBoxForOrder('o1', ['i1', 'i3'], {
      ...first.d,
      submit: submit2 as unknown as BulkBoxDeps['submit'],
      fetchCandidates: fetch2 as unknown as BulkBoxDeps['fetchCandidates'],
      newKey: () => 'key-2',
    });
    expect(fetch2).not.toHaveBeenCalled();
    expect(submit2).toHaveBeenCalledWith(sent1);
    expect(r2.ok).toBe(true);
    expect(first.storage.m.size).toBe(0);
  });

  it('勾到的都沒有可出的 ⇒ 不建箱、不留快照', async () => {
    const { d, storage } = deps();
    const r = await createBoxForOrder('o1', ['i2'], d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.text).toContain('沒有可出的數量');
    expect(storage.m.size).toBe(0);
  });

  it('收件資料不完整 ⇒ 不建箱', async () => {
    const { d } = deps({
      fetchCandidates: vi.fn(async () => ({ ...CANDIDATES, recipient: { name: '', phone: null, line: null } })) as unknown as BulkBoxDeps['fetchCandidates'],
    });
    const r = await createBoxForOrder('o1', ['i1'], d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(r.text).toContain('收件資料不完整');
  });

  it('伺服器回失敗而有箱號(建箱成功、掛品項失敗)⇒ 快照留著、叫他打開那張單看箱子', async () => {
    const { d, storage } = deps({
      submit: vi.fn(async () => ({ ok: false, message: '掛品項失敗', shipmentReference: 'K7X2MP', code: 'P2B27' })) as unknown as BulkBoxDeps['submit'],
    });
    const r = await createBoxForOrder('o1', ['i1'], d);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('K7X2MP');
    expect(r.text).toContain('打開這張單');
    expect(storage.m.size).toBe(1);
  });
});
