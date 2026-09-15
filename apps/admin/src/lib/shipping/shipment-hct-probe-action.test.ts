import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 片 B 臨時驗證 action:管理者 + 開關才動;正對照比貨號、負對照挑不存在的箱號;零寫入。

vi.mock('server-only', () => ({}));
const authorizeManagerMutation = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: () => authorizeManagerMutation() }));
vi.mock('./shipment-action-audit', () => ({ auditLog: vi.fn() }));
const getHctReferenceState = vi.fn();
vi.mock('./shipment-repository', () => ({ getHctReferenceState: (r: string) => getHctReferenceState(r) }));
const queryEdelno = vi.fn();
const readHctDepsFromEnv = vi.fn();
vi.mock('./hct-client', () => ({
  queryEdelno: (...a: unknown[]) => queryEdelno(...a),
  readHctDepsFromEnv: () => readHctDepsFromEnv(),
}));

const DEPS = { fetchImpl: fetch, endpoint: 'https://x', account: 'a', password: 'p' };
const load = async () => (await import('./shipment-hct-probe-action')).probeHctQueryAction;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HCT_QUERY_PROBE_ENABLED = 'true';
  authorizeManagerMutation.mockResolvedValue({ sid: 's', actorId: 'mgr' });
  readHctDepsFromEnv.mockReturnValue(DEPS);
  getHctReferenceState.mockImplementation(async (r: string) =>
    r === 'S9FC6P' ? { hctStatus: 'submitted', hctRequestId: '8947081964' } : null,
  );
});
afterEach(() => {
  delete process.env.HCT_QUERY_PROBE_ENABLED;
});

describe('probeHctQueryAction', () => {
  it('不是管理者 ⇒ 不查', async () => {
    authorizeManagerMutation.mockResolvedValue(null);
    const r = await (await load())({ which: 'positive' });
    expect(r.ok).toBe(false);
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('開關沒開 ⇒ 不查', async () => {
    delete process.env.HCT_QUERY_PROBE_ENABLED;
    const r = await (await load())({ which: 'positive' });
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(/HCT_QUERY_PROBE_ENABLED/);
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('新竹帳密缺 ⇒ 不查', async () => {
    readHctDepsFromEnv.mockReturnValue(null);
    const r = await (await load())({ which: 'positive' });
    expect(r.ok).toBe(false);
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('正對照:查 S9FC6P, 貨號相同 ⇒ 通過', async () => {
    queryEdelno.mockResolvedValue({ kind: 'found', edelno: '8947081964', raw: {} });
    const r = await (await load())({ which: 'positive' });
    expect(queryEdelno).toHaveBeenCalledWith(DEPS, 'S9FC6P');
    expect(r).toMatchObject({ ok: true, reference: 'S9FC6P' });
  });

  it('正對照:貨號不同 ⇒ 不通過並講出兩個號碼', async () => {
    queryEdelno.mockResolvedValue({ kind: 'found', edelno: '1111', raw: {} });
    const r = await (await load())({ which: 'positive' });
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(/1111.*8947081964/);
  });

  it('正對照:前提不成立(S9FC6P 不是已送成功)⇒ 不查', async () => {
    getHctReferenceState.mockResolvedValue({ hctStatus: 'unknown', hctRequestId: null });
    const r = await (await load())({ which: 'positive' });
    expect(r.ok).toBe(false);
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('負對照:挑 shipments 裡沒有的箱號, 新竹查無 ⇒ 通過', async () => {
    getHctReferenceState.mockImplementation(async (r: string) => (r === 'ZZZZZZ' ? { hctStatus: 'draft', hctRequestId: null } : null));
    queryEdelno.mockResolvedValue({ kind: 'not_found', raw: {} });
    const r = await (await load())({ which: 'negative' });
    expect(queryEdelno).toHaveBeenCalledWith(DEPS, 'YYYYYY');
    expect(r).toMatchObject({ ok: true, reference: 'YYYYYY' });
    expect(r.verdict).toMatch(/要正對照也通過/);
  });

  it('負對照:新竹說有 ⇒ 不通過', async () => {
    queryEdelno.mockResolvedValue({ kind: 'found', edelno: '9', raw: {} });
    const r = await (await load())({ which: 'negative' });
    expect(r.ok).toBe(false);
  });

  it('負對照:候選全都存在 ⇒ 不查', async () => {
    getHctReferenceState.mockResolvedValue({ hctStatus: 'draft', hctRequestId: null });
    const r = await (await load())({ which: 'negative' });
    expect(r.ok).toBe(false);
    expect(queryEdelno).not.toHaveBeenCalled();
  });

  it('查詢開關沒開(disabled)⇒ 不通過', async () => {
    queryEdelno.mockResolvedValue({ kind: 'disabled' });
    const r = await (await load())({ which: 'positive' });
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(/HCT_QUERY_ENABLED/);
  });
});
