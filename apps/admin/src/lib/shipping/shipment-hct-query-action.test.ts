import { beforeEach, describe, expect, it, vi } from 'vitest';

// 片 A「向新竹查詢貨號」:只查不送;查到才補記;查無甲乙兩型講不同的話;任何失敗都不動狀態。

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const authorizeAdminMutation = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: () => authorizeAdminMutation() }));
const auditLog = vi.fn();
vi.mock('./shipment-action-audit', () => ({ auditLog: (...a: unknown[]) => auditLog(...a), NO_ACTOR_MESSAGE: '找不到操作者身分' }));
const getHctShipment = vi.fn();
const recordHctSubmit = vi.fn();
vi.mock('./shipment-repository', () => ({
  getHctShipment: (id: string) => getHctShipment(id),
  recordHctSubmit: (a: unknown) => recordHctSubmit(a),
}));
const queryEdelno = vi.fn();
const readHctDepsFromEnv = vi.fn();
const submitTransData = vi.fn();
vi.mock('./hct-client', () => ({
  queryEdelno: (...a: unknown[]) => queryEdelno(...a),
  readHctDepsFromEnv: () => readHctDepsFromEnv(),
  submitTransData: (...a: unknown[]) => submitTransData(...a),
}));

const DEPS = { fetchImpl: fetch, endpoint: 'https://x', account: 'a', password: 'p' };
const PLACEHOLDER_RAW = { placeholder: true, at: '2026-09-15T00:00:00Z', unknownReason: { flowReason: 'network: reset' } };
const REPLIED_RAW = { placeholder: true, at: '2026-09-15T00:00:00Z', unknownReason: { flowReason: 'soap_fault' } };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'sid-1',
  shipmentReference: 'BCDFGH',
  voidedAt: null,
  hctStatus: 'unknown',
  hctRawResponse: PLACEHOLDER_RAW,
  ...over,
});

const load = async () => (await import('./shipment-hct-query-action')).queryHctUnknownAction;

beforeEach(() => {
  vi.clearAllMocks();
  authorizeAdminMutation.mockResolvedValue({ sid: 's', actorId: 'staff_1' });
  readHctDepsFromEnv.mockReturnValue(DEPS);
  getHctShipment.mockResolvedValue(row());
  recordHctSubmit.mockResolvedValue(undefined);
});

describe('queryHctUnknownAction', () => {
  it('沒有操作者 ⇒ 不查', async () => {
    authorizeAdminMutation.mockResolvedValue(null);
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r.ok).toBe(false);
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('新竹帳密缺 ⇒ disabled、不查', async () => {
    readHctDepsFromEnv.mockReturnValue(null);
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'disabled' });
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it.each([
    ['已作廢', { voidedAt: '2026-09-15T01:00:00Z' }],
    ['狀態不是 unknown(submitted)', { hctStatus: 'submitted' }],
    ['狀態不是 unknown(draft)', { hctStatus: 'draft' }],
  ])('%s ⇒ refused、不查', async (_w, over) => {
    getHctShipment.mockResolvedValue(row(over));
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'refused' });
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('查詢開關關著 ⇒ disabled、不寫', async () => {
    queryEdelno.mockResolvedValue({ kind: 'disabled' });
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'disabled' });
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });

  it('查到 ⇒ 用箱號查、補記 submitted + 貨號 + 新竹原文;絕不送單', async () => {
    queryEdelno.mockResolvedValue({ kind: 'found', edelno: '8947081964', raw: [{ success: 'Y' }] });
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toEqual({ ok: true, kind: 'found', edelno: '8947081964' });
    expect(queryEdelno).toHaveBeenCalledWith(DEPS, 'BCDFGH');
    expect(recordHctSubmit).toHaveBeenCalledWith({
      shipmentReference: 'BCDFGH',
      status: 'submitted',
      requestId: '8947081964',
      raw: [{ success: 'Y' }],
    });
    expect(submitTransData).not.toHaveBeenCalled();
  });

  it('兩人同按:補記撞「已經是 submitted」而重讀是同一個貨號 ⇒ 當成查到', async () => {
    queryEdelno.mockResolvedValue({ kind: 'found', edelno: 'E7', raw: {} });
    recordHctSubmit.mockRejectedValue(new Error('已經是 submitted'));
    getHctShipment.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ hctStatus: 'submitted', hctRequestId: 'E7' }));
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toEqual({ ok: true, kind: 'found', edelno: 'E7' });
  });

  it('查到而補記失敗 ⇒ needs_human, 講出貨號與「不要重送」', async () => {
    queryEdelno.mockResolvedValue({ kind: 'found', edelno: 'E1', raw: {} });
    recordHctSubmit.mockRejectedValue(new Error('RPC 爆了'));
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'needs_human' });
    if (!r.ok) expect(r.message).toMatch(/E1.*不要重送/);
  });

  it('甲型查無 ⇒ 不動狀態, 提到打電話與放回草稿, 並標未驗證', async () => {
    queryEdelno.mockResolvedValue({ kind: 'not_found', raw: {} });
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'not_found' });
    if (!r.ok) {
      expect(r.message).toMatch(/打電話/);
      expect(r.message).toMatch(/放回草稿/);
      expect(r.message).toMatch(/還沒對新竹驗證過/);
    }
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });

  it('乙型查無 ⇒ 說新竹回過話、不提放回草稿, 並標未驗證', async () => {
    getHctShipment.mockResolvedValue(row({ hctRawResponse: REPLIED_RAW }));
    queryEdelno.mockResolvedValue({ kind: 'not_found', raw: {} });
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'not_found' });
    if (!r.ok) {
      expect(r.message).toMatch(/回過話/);
      expect(r.message).toMatch(/不放回草稿/);
      expect(r.message).toMatch(/作廢/);
      expect(r.message).toMatch(/重新開一箱/);
      expect(r.message).toMatch(/還沒對新竹驗證過/);
    }
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['查詢回 unknown', () => queryEdelno.mockResolvedValue({ kind: 'unknown', reason: 'unrecognised_query_x' })],
    ['查詢自己 throw', () => queryEdelno.mockRejectedValue(new Error('boom'))],
  ])('%s ⇒ unknown、不動狀態、叫人不要重送', async (_w, arrange) => {
    arrange();
    const r = await (await load())({ shipmentId: 'sid-1' });
    expect(r).toMatchObject({ ok: false, kind: 'unknown' });
    if (!r.ok) expect(r.message).toMatch(/不要重送/);
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });
});
