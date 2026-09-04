// hct-submit-action.test.ts — ⟦ship-HCTAPI⟧ 步驟② 的 server action
//
// 🔴 **測試分母照 plan(Sean 2026-09-05 拍甲):5 種 FlowResult 各一格 + 佔位/覆寫時序一格。**
//    而**時序那一格是這支檔存在的主要理由** —— 它守的是一個【單向門】:
//    送出成功而寫 DB 之前掛掉 ⇒ 新竹收到了而我們沒紀錄 ⇒ 下次會重送。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeAdminMutation = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeAdminMutation }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./shipment-candidates', () => ({ loadShipmentCandidates: vi.fn() }));

const getHctShipment = vi.fn();
const recordHctSubmit = vi.fn();
// 🔴 **整支換掉, 不用 `await orig()`** —— 真的那支會 import `@pcm/adapters/server`,
//    而它 import `server-only` ⇒ 單測直接炸在 import,**紅在載入不是紅在斷言**
//    (同一個坑 `shipment-actions.test.ts:22-24` 逐字記過)。
//    ⚠️ 代價:本檔用不到的那些 export 在這裡不存在 ⇒ 若 action 之後多用一支, 這裡要補。
vi.mock('./shipment-repository', () => ({ getHctShipment, recordHctSubmit }));

const runHctSubmit = vi.fn();
vi.mock('./hct-submit-flow', () => ({ runHctSubmit }));

const { submitShipmentToHctAction } = await import('./shipment-actions');

const ROW = {
  id: 's1',
  shipmentReference: 'BCDFGH',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: null,
  shippedAt: null,
  voidedAt: null,
  hctStatus: 'draft',
  recipientSnapshot: { name: '甲', phone: '0900000000', line: '台北市中正區' },
};

beforeEach(() => {
  vi.clearAllMocks();
  authorizeAdminMutation.mockResolvedValue({ actorId: 'staff1' });
  getHctShipment.mockResolvedValue(ROW);
  recordHctSubmit.mockResolvedValue(undefined);
  vi.stubEnv('HCT_API_ENDPOINT', 'https://example.invalid/hct');
  vi.stubEnv('HCT_API_ACCOUNT', 'test');
  vi.stubEnv('HCT_API_PASSWORD', 'x');
});

describe('五種 FlowResult 各一格', () => {
  it('recorded/submitted ⇒ ok + 寫回 submitted', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'submitted', requestId: 'R1', raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toEqual({ ok: true, kind: 'submitted', requestId: 'R1' });
    expect(recordHctSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted', requestId: 'R1' }),
    );
  });

  it('recorded/failed ⇒ 不 ok, 而訊息說得出「可以再按」', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'failed', requestId: null, raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ kind: 'failed' });
    expect(r.ok === false ? r.message : '').toContain('再按');
  });

  it('recorded/unknown ⇒ 訊息必須逐字含「不要重按」', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'unknown', requestId: null, raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: false, kind: 'unknown' });
    // 🔴 這一格不是文案潔癖:`unknown` 的語意就是「不得重送」, 而畫面是唯一告訴人的地方。
    expect(r.ok === false ? r.message : '').toContain('不要重按');
  });

  it('recovered ⇒ 寫回 submitted 並帶查回來的 id', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'recovered', requestId: 'R2', raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toEqual({ ok: true, kind: 'recovered', requestId: 'R2' });
    expect(recordHctSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'submitted', requestId: 'R2' }),
    );
  });

  it.each([
    ['refused', '這張單已經送成功過了'],
    ['needs_human', '要人去看'],
  ])('%s ⇒ 原樣把 reason 端出來(那些字是寫給人看的)', async (kind, reason) => {
    runHctSubmit.mockResolvedValue({ kind, reason });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toEqual({ ok: false, kind, message: reason });
  });

  it('disabled ⇒ 新竹未開通, 而且【沒有】寫 DB', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'disabled' });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: false, kind: 'disabled' });
    // 佔位那一發仍會發生(它在送出之前), 而結果那一發不得發生。
    expect(recordHctSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 佔位 / 覆寫的【時序】', () => {
  it('draft ⇒ 送出【之前】先寫一列 unknown, 而且不帶 request_id', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'submitted', requestId: 'R1', raw: {} });
    const order: string[] = [];
    recordHctSubmit.mockImplementation((a: { status: string }) => {
      order.push(`record:${a.status}`);
      return Promise.resolve();
    });
    runHctSubmit.mockImplementation(() => {
      order.push('submit');
      return Promise.resolve({ kind: 'recorded', status: 'submitted', requestId: 'R1', raw: {} });
    });
    await submitShipmentToHctAction({ shipmentId: 's1' });
    // 🔴 順序本身就是斷言 —— 佔位若跑在送出【之後】, 那個單向門原封不動。
    expect(order).toEqual(['record:unknown', 'submit', 'record:submitted']);
    expect(recordHctSubmit.mock.calls[0]?.[0]).toMatchObject({ status: 'unknown', requestId: null });
  });

  it('已經是 submitted 的箱 ⇒ 不寫佔位(否則會把成功狀態推回 unknown)', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctStatus: 'submitted' });
    runHctSubmit.mockResolvedValue({ kind: 'refused', reason: '已送過' });
    await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });
});

describe('fail-closed', () => {
  it.each(['HCT_API_ENDPOINT', 'HCT_API_ACCOUNT', 'HCT_API_PASSWORD'])(
    '缺 %s ⇒ disabled, 而且【連 runHctSubmit 都沒被呼叫】',
    async (name) => {
      vi.stubEnv(name, '');
      // vi.stubEnv 給空字串仍是 defined ⇒ 用 delete 才是「沒有這顆」
      delete (process.env as Record<string, string | undefined>)[name];
      const r = await submitShipmentToHctAction({ shipmentId: 's1' });
      expect(r).toMatchObject({ ok: false, kind: 'disabled' });
      expect(runHctSubmit).not.toHaveBeenCalled();
      expect(getHctShipment).not.toHaveBeenCalled();
    },
  );
});
