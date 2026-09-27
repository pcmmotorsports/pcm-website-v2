// 「新竹說沒派到車:重新叫車」(2026-09-28 出貨流程乙第 8 項畫面;計畫第二節第 8 項)。
// 資料庫那一道(10 分鐘、次數、訂單可出、只記最新一次)在 migration 20260928010000, 已在拋棄式 PG 實跑;
// 這裡守 action:佔位用新函式、送出前 30 秒期限、叫到了記結果並標出貨、不確定就留著、佔位被拒就原話告訴員工。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claim: vi.fn(),
  record: vi.fn(),
  dispatch: vi.fn(),
  mark: vi.fn(),
  getRow: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: vi.fn(async () => ({ actorId: 'probe_staff', sid: 's' })) }));
vi.mock('./shipment-action-audit', () => ({ auditLog: vi.fn(), NO_ACTOR_MESSAGE: 'x' }));
vi.mock('../audit/context', () => ({ getRequestId: vi.fn(async () => 'req-1') }));
vi.mock('./shipment-repository', () => ({ getDispatchShipment: h.getRow, markShipmentShipped: h.mark }));
vi.mock('./hct-redispatch-repository', () => ({ claimHctRedispatch: h.claim, recordHctRedispatch: h.record }));
vi.mock('./hct-client', async (orig) => ({
  ...(await orig<typeof import('./hct-client')>()),
  dispatchOrder: h.dispatch,
  hctDispatchGateOpen: () => true,
}));

import { redispatchShipmentAction } from './shipment-redispatch-hct-action';

const UNCERTAIN = {
  shipmentReference: '9X2ZD7',
  carrierCode: 'hct',
  hctStatus: 'submitted',
  hctRequestId: '8947081999',
  hctDispatchAttemptedAt: '2026-09-28T01:00:00Z',
  hctDispatchedAt: null,
  shippedAt: null,
  voidedAt: null,
  createdAt: '2026-09-28T00:00:00Z',
};

beforeEach(() => {
  vi.stubEnv('HCT_API_ENDPOINT', 'https://hct.example');
  vi.stubEnv('HCT_API_ACCOUNT', 'a');
  vi.stubEnv('HCT_API_PASSWORD', 'p');
  vi.stubEnv('HCT_DISPATCH_EMARK', '派達有限公司');
  h.getRow.mockResolvedValue(UNCERTAIN);
  h.claim.mockResolvedValue('att-2');
  h.dispatch.mockResolvedValue({ kind: 'answered', raw: {}, rows: [{ kind: 'dispatched', epino: '9X2ZD7', edelno: '8947081999' }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const f of Object.values(h)) f.mockReset();
});

describe('redispatchShipmentAction', () => {
  it('🔴 叫到了 ⇒ 用新函式佔位(帶畫面看到的次數與操作人員)→ 記結果 → 標出貨(鍵綁這一次)', async () => {
    const r = await redispatchShipmentAction({ shipmentId: 's1', expectedAttemptNo: 1 });
    expect(h.claim).toHaveBeenCalledWith({ shipmentReference: '9X2ZD7', edelno: '8947081999', expectedAttemptNo: 1, actor: 'probe_staff' });
    expect(h.record).toHaveBeenCalledWith({ attemptId: 'att-2', edelno: '8947081999' });
    expect(h.mark).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'redispatch:att-2', shipmentId: 's1', trackingNumber: '8947081999' }));
    expect(r).toEqual({ ok: true, kind: 'dispatched', edelno: '8947081999' });
  });

  it('🔴 不是「叫車結果未確認」的箱(沒叫過 / 已叫到 / 已出貨)⇒ 一發都不送', async () => {
    for (const over of [{ hctDispatchAttemptedAt: null }, { hctDispatchedAt: 'x' }, { shippedAt: 'x' }]) {
      h.getRow.mockResolvedValue({ ...UNCERTAIN, ...over });
      const r = await redispatchShipmentAction({ shipmentId: 's1', expectedAttemptNo: 1 });
      expect(r.ok).toBe(false);
    }
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('🔴 資料庫拒絕佔位(不到 10 分鐘 / 次數變了 / 訂單不能出)⇒ 不呼叫新竹, 把原因告訴員工', async () => {
    h.claim.mockRejectedValue(new Error('admin_claim_hct_redispatch:這一箱 9X2ZD7 上一次叫車在 …, 還不到 10 分鐘'));
    const r = await redispatchShipmentAction({ shipmentId: 's1', expectedAttemptNo: 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, kind: 'rejected' });
    expect((r as { message: string }).message).toContain('還不到 10 分鐘');
  });

  it('🔴 佔位後超過 30 秒 ⇒ 不呼叫新竹', async () => {
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    h.claim.mockImplementation(async () => {
      t += 31_000;
      return 'att-2';
    });
    const r = await redispatchShipmentAction({ shipmentId: 's1', expectedAttemptNo: 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, kind: 'needs_human' });
  });

  it('🔴 新竹回覆看不懂 ⇒ 不記結果、不標出貨, 回「結果未確認」', async () => {
    h.dispatch.mockResolvedValue({ kind: 'unknown', reason: 'rtn_code_x' });
    const r = await redispatchShipmentAction({ shipmentId: 's1', expectedAttemptNo: 1 });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.mark).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, kind: 'needs_human' });
  });

  it.each([
    ['記結果失敗', () => h.record.mockRejectedValueOnce(new Error('db down'))],
    ['標出貨失敗', () => h.mark.mockRejectedValueOnce(new Error('P2B26 blocked'))],
  ])('🔴 叫到車之後%s ⇒ needs_human, 說車已叫到、不要重新叫車(否則 10 分鐘後可能叫第二台)', async (_n, arrange) => {
    arrange();
    const r = await redispatchShipmentAction({ shipmentId: 's1', expectedAttemptNo: 1 });
    expect(r).toMatchObject({ ok: false, kind: 'needs_human' });
    const m = (r as { message: string }).message;
    expect(m).toContain('新竹已回覆叫到車（貨號 8947081999）');
    expect(m).toContain('不要重新叫車');
  });
});
