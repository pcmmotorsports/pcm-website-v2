// 叫車 action 的防兩台車守門(2026-09-27 出貨流程乙;計畫 ~/pcm-mailbox/計畫-後台出貨流程乙-20260927.md 第二節第 8 項)。
// 🔴 佔位之後、送 HTTP 之前再看一次:離這一次開始超過 30 秒就不送 —— 一個佔位之後卡住的舊請求醒來也不會再叫車。
//    只用這台伺服器自己的時鐘(不跟資料庫比), 佔位函式不改回傳型別(Fable R4 必修 1)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claim: vi.fn(),
  dispatch: vi.fn(),
  record: vi.fn(),
  mark: vi.fn(),
  getRow: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: vi.fn(async () => ({ actorId: 'probe_staff' })) }));
vi.mock('./shipment-action-audit', () => ({ auditLog: vi.fn(), NO_ACTOR_MESSAGE: 'x' }));
vi.mock('../audit/context', () => ({ getRequestId: vi.fn(async () => 'req-1') }));
vi.mock('./shipment-repository', () => ({
  claimHctDispatch: h.claim,
  getDispatchShipment: h.getRow,
  recordHctDispatch: h.record,
  markShipmentShipped: h.mark,
}));
vi.mock('./hct-client', async (orig) => ({
  ...(await orig<typeof import('./hct-client')>()),
  dispatchOrder: h.dispatch,
  hctDispatchGateOpen: () => true,
}));

import { dispatchShipmentAction } from './shipment-dispatch-hct-action';

const ROW = {
  shipmentReference: '9X2ZD7',
  carrierCode: 'hct',
  hctStatus: 'submitted',
  hctRequestId: '8947081999',
  hctDispatchAttemptedAt: null,
  hctDispatchedAt: null,
  shippedAt: null,
  voidedAt: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.stubEnv('HCT_API_ENDPOINT', 'https://hct.example');
  vi.stubEnv('HCT_API_ACCOUNT', 'a');
  vi.stubEnv('HCT_API_PASSWORD', 'p');
  vi.stubEnv('HCT_DISPATCH_EMARK', '派達有限公司');
  h.getRow.mockResolvedValue(ROW);
  h.claim.mockResolvedValue(undefined);
  h.dispatch.mockResolvedValue({ kind: 'answered', raw: {}, rows: [{ kind: 'dispatched', epino: '9X2ZD7', edelno: '8947081999' }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  h.claim.mockReset();
  h.dispatch.mockReset();
});

describe('叫車:佔位之後超過 30 秒就不送', () => {
  it('🔴 佔位花了 31 秒 ⇒ 不呼叫新竹, 回「結果未確認」', async () => {
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    h.claim.mockImplementation(async () => {
      t += 31_000;
    });
    const r = await dispatchShipmentAction({ shipmentId: 's1' });
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, kind: 'needs_human' });
  });

  it('🟢 對照:佔位很快 ⇒ 照常呼叫新竹', async () => {
    const r = await dispatchShipmentAction({ shipmentId: 's1' });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });
});

// 2026-09-28 R1 Fable 建議:新竹已回「叫到車」之後, 記結果或標出貨失敗 ⇒ 要說「車已叫到、不要重新叫車」, 不是只給資料庫原話。
describe('叫到車之後系統沒記下', () => {
  it.each([
    ['記結果失敗', () => h.record.mockRejectedValueOnce(new Error('db down'))],
    ['標出貨失敗', () => h.mark.mockRejectedValueOnce(new Error('P2B26 blocked'))],
  ])('🔴 %s ⇒ needs_human, 句子說車已叫到(帶貨號)、不要重新叫車', async (_n, arrange) => {
    arrange();
    const r = await dispatchShipmentAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: false, kind: 'needs_human' });
    const m = (r as { message: string }).message;
    expect(m).toContain('新竹已回覆叫到車（貨號 8947081999）');
    expect(m).toContain('不要重新叫車');
  });
});
