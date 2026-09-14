// hct-label-refetch-action.test.ts — ⟦ship-HCTLABEL⟧ 乙型救回的箱「重新取得標籤」的 server action
//
// 🔴 這支 action 對外發的是 TransData(同日同單號 = 更正), 所以它守的東西跟「送新竹」一樣重:
//    ① 沒送成功 / 已作廢 / 已有圖 ⇒ **連新竹都不碰**;
//    ② 新竹回了【別的貨號】⇒ **一個字都不寫**(那是事故, 不是資料);
//    ③ 同貨號 + 有圖 ⇒ 只走窄門 `recordHctLabelRaw`, 不走 `recordHctSubmit`(那支對 submitted 一律擋)。
// ⚠️ 假貨演的是 action 的分支;窄門 RPC 自己的規則(狀態 / 貨號 / 有圖)在拋棄式 PG 那一輪真跑過。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeAdminMutation = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeAdminMutation }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./shipment-candidates', () => ({ loadShipmentCandidates: vi.fn() }));

const getHctShipment = vi.fn();
const recordHctSubmit = vi.fn();
const recordHctUnknownReason = vi.fn();
const recordHctLabelRaw = vi.fn();
const getShipmentRemarkParts = vi.fn(() =>
  Promise.resolve({
    orderDisplayIds: ['CH6D75'],
    firstItemName: '前叉油封',
    firstItemSku: 'SKU-1234',
    itemCount: 1,
    ordersMaybeIncomplete: false,
  }),
);
vi.mock('./shipment-repository', () => ({
  getHctShipment,
  getShipmentRemarkParts,
  recordHctSubmit,
  recordHctUnknownReason,
  recordHctLabelRaw,
}));
vi.mock('./hct-submit-flow', () => ({ runHctSubmit: vi.fn() }));

const submitTransData = vi.fn();
vi.mock('./hct-client', async (orig) => {
  const real = await orig<typeof import('./hct-client')>();
  return { ...real, submitTransData };
});

const auditLog = vi.fn();
vi.mock('./shipment-action-audit', () => ({ auditLog, NO_ACTOR_MESSAGE: '找不到操作者身分' }));

const { refetchHctLabelAction } = await import('./shipment-submit-hct-action');

// 真的 1×1 PNG(extractHctLabelImage 會看魔術位元組 + 解得出來, 8 個位元組的簽名不夠)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ROW = {
  id: 's1',
  shipmentReference: 'QTK2WT',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: null,
  shippedAt: null,
  voidedAt: null,
  hctStatus: 'submitted',
  hctRequestId: '1001734834',
  hctSubmittedAt: '2026-09-14T02:00:00Z', // 台北 09-14 10:00;時鐘釘在同一天 12:00(codex R2 nit:不用真時鐘)
  // 乙型救回:QueryEDELNO 那 4 欄, 沒有 image
  hctRawResponse: [{ epino: 'QTK2WT', edelno: '1001734834', success: 'Y', errmsg: '' }],
  recipientSnapshot: { name: '甲', phone: '0900000000', line: '台北市中正區' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T04:00:00Z'));
  authorizeAdminMutation.mockResolvedValue({ actorId: 'staff1' });
  getHctShipment.mockResolvedValue(ROW);
  recordHctLabelRaw.mockResolvedValue(undefined);
  vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
  vi.stubEnv('HCT_API_ENDPOINT', 'https://example.invalid/hct');
  vi.stubEnv('HCT_API_ACCOUNT', 'test');
  vi.stubEnv('HCT_API_PASSWORD', 'x');
});

afterEach(() => {
  vi.useRealTimers();
});

const notTouched = () => {
  expect(submitTransData, '沒資格重取的箱【不得】碰新竹').not.toHaveBeenCalled();
  expect(recordHctLabelRaw).not.toHaveBeenCalled();
  expect(recordHctSubmit, '這條路永遠不走 recordHctSubmit').not.toHaveBeenCalled();
};

describe('① 連新竹都不碰的世界', () => {
  it('沒有操作者 ⇒ needs_human', async () => {
    authorizeAdminMutation.mockResolvedValue(null);
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect(r).toEqual({ ok: false, kind: 'needs_human', message: '找不到操作者身分' });
    notTouched();
  });
  it('閘沒開 ⇒ disabled', async () => {
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'false');
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect(r.ok).toBe(false);
    expect((r as { kind: string }).kind).toBe('disabled');
    notTouched();
  });
  it('已作廢 ⇒ refused', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, voidedAt: '2026-09-14T00:00:00Z' });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('refused');
    notTouched();
  });
  it('還不是 submitted(unknown)⇒ refused', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctStatus: 'unknown', hctRequestId: null });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('refused');
    notTouched();
  });
  it('🔴🔴 不是今天送的(台北)⇒ refused, 連新竹都不碰 —— 隔天同單號重傳是新單, 撤不回來', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctSubmittedAt: '2026-09-13T02:00:00Z' });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('refused');
    expect((r as { message: string }).message).toContain('不是今天');
    notTouched();
  });
  it('🔴 台北 23:56(離午夜不到 5 分鐘)⇒ refused, 不碰新竹(送到新竹時可能已經是明天)', async () => {
    vi.setSystemTime(new Date('2026-09-14T15:56:00Z'));
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('refused');
    notTouched();
  });
  it('🔴 不知道哪天送的(NULL)⇒ refused, 不賭', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctSubmittedAt: null });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('refused');
    notTouched();
  });
  it('🔴 已經有圖 ⇒ refused(有圖的箱按它等於白送一次更正)', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctRawResponse: [{ ...ROW.hctRawResponse[0], image: PNG }] });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('refused');
    notTouched();
  });
});

describe('② 新竹回來之後', () => {
  it('🔴🔴 回了別的貨號 ⇒ needs_human, 一個字都不寫', async () => {
    submitTransData.mockResolvedValue({ kind: 'submitted', edelno: '1001734999', raw: [{ image: PNG }] });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect(r.ok).toBe(false);
    expect((r as { kind: string }).kind).toBe('needs_human');
    expect((r as { message: string }).message).toContain('1001734999');
    expect((r as { message: string }).message).toContain('1001734834');
    expect(recordHctLabelRaw).not.toHaveBeenCalled();
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });
  it('unknown ⇒ kind unknown, 沒寫任何東西, 訊息說得出「等一下再按」', async () => {
    submitTransData.mockResolvedValue({ kind: 'unknown', reason: 'timeout' });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('unknown');
    expect((r as { message: string }).message).toContain('等一下再按一次');
    expect(recordHctLabelRaw).not.toHaveBeenCalled();
  });
  it('rejected ⇒ failed, 帶新竹的 ErrMsg', async () => {
    submitTransData.mockResolvedValue({ kind: 'rejected', errMsg: '資料不全', raw: {} });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('failed');
    expect((r as { message: string }).message).toContain('資料不全');
    expect(recordHctLabelRaw).not.toHaveBeenCalled();
  });
  it('✅ amended + 同貨號 + 有圖 ⇒ 走窄門寫 raw, ok', async () => {
    const raw = [{ epino: 'QTK2WT', edelno: '1001734834', success: 'R', image: PNG }];
    submitTransData.mockResolvedValue({ kind: 'amended', edelno: '1001734834', raw });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect(r).toEqual({ ok: true, requestId: '1001734834' });
    expect(recordHctLabelRaw).toHaveBeenCalledWith({ shipmentReference: 'QTK2WT', edelno: '1001734834', raw });
    expect(recordHctSubmit).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith('shipment.hct_label_refetch', { actorId: 'staff1' }, 'ok', { shipment_id: 's1' });
  });
  it('🔴 同貨號但那一包的 image 解不開(非空字串而不是圖)⇒ failed, 不寫(寫了會蓋掉原本那包而還是印不出來)', async () => {
    submitTransData.mockResolvedValue({ kind: 'amended', edelno: '1001734834', raw: [{ image: 'zzzz-not-an-image' }] });
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('failed');
    expect((r as { message: string }).message).toContain('解不開');
    expect(recordHctLabelRaw).not.toHaveBeenCalled();
  });
  it('送出去的內容跟「送新竹」同一套:epino = 箱號, 備註同一支', async () => {
    submitTransData.mockResolvedValue({ kind: 'amended', edelno: '1001734834', raw: [{ image: PNG }] });
    await refetchHctLabelAction({ shipmentId: 's1' });
    const fields = submitTransData.mock.calls[0]![1] as Record<string, string>;
    expect(fields['epino']).toBe('QTK2WT');
    expect(fields['emark']).toBe('[PCM] CH6D75 前叉油封 SKU-1234');
  });
  it('窄門 RPC RAISE(例如 DB 那邊發現貨號對不上)⇒ needs_human 帶那句話', async () => {
    submitTransData.mockResolvedValue({ kind: 'amended', edelno: '1001734834', raw: [{ image: PNG }] });
    recordHctLabelRaw.mockRejectedValue(new Error('admin_record_hct_label_raw:新竹回的貨號與這箱記著的不同'));
    const r = await refetchHctLabelAction({ shipmentId: 's1' });
    expect((r as { kind: string }).kind).toBe('needs_human');
    expect((r as { message: string }).message).toContain('admin_record_hct_label_raw');
  });
});
