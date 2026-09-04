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
  // 🔴 `hctSubmitGateOpen()` 現在在 action 裡先判 ⇒ 這兩顆缺一格全紅。
  //    ⚠️ `NODE_ENV=development` 一律當關 ⇒ 測試環境是 'test' 才過得去。
  vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
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

  it('disabled(流程層)⇒ 新竹未開通, 而且【一次 DB 都沒寫】', async () => {
    // ⛔ ~~舊版斷言 `toHaveBeenCalledTimes(1)`, 而標題寫「沒有寫 DB」~~
    // 🔴🔴 **code-reviewer 2026-09-05 MF2:標題與斷言互相矛盾, 而【標題才是對的】。**
    //    那個 1 是佔位那一發 —— 它正是 MF1 那個 bug 的訊號,
    //    ⇒ 📌 **而我寫了一句註解替它辯護, 於是那個訊號被自己的解釋蓋掉了。**
    //    ✅ 修完 MF1 之後閘判定排在佔位之前 ⇒ 這裡應該是 **0**。
    // 🔴🔴 **而這一格第一版我構造了一個【不可能的世界】** ——
    //    送出閘開著 + current=draft 時, 流程**不可能**回 disabled(它只在該用的那道閘關著時回)。
    //    ⇒ 那一版紅了, 而它紅得對:我在測一個到不了的世界。
    //    ✅ 換成真的走得到的那條:**送出閘開、查詢閘關、current=unknown**
    //      ⇒ `decideSubmit` 說 query_first ⇒ `queryEdelno` 撞到自己的閘 ⇒ disabled。
    //      而 current=unknown **本來就不寫佔位**(只有 draft/failed 寫)⇒ 這裡應該是 0。
    getHctShipment.mockResolvedValue({ ...ROW, hctStatus: 'unknown' });
    runHctSubmit.mockResolvedValue({ kind: 'disabled' });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: false, kind: 'disabled' });
    expect(recordHctSubmit).not.toHaveBeenCalled();
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

describe('🔴 MF1:閘關著時, 一列 DB 都不准寫', () => {
  it('HCT_SUBMIT_ENABLED 沒設 ⇒ disabled, 而且【沒有佔位列】', async () => {
    // 🛑 舊版會寫一列 unknown ⇒ 下一次 `admin_record_hct_submit` 對 old=unknown,new=unknown
    //    **RAISE**(`20260904170000:163-169`)⇒ 那一箱卡死要人工改 DB。
    delete (process.env as Record<string, string | undefined>).HCT_SUBMIT_ENABLED;
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: false, kind: 'disabled' });
    expect(recordHctSubmit).not.toHaveBeenCalled();
    expect(runHctSubmit).not.toHaveBeenCalled();
  });
});

describe('🔴 MF3:會被截斷的欄位必須先讓人看到', () => {
  it('有 truncated ⇒ 第一次按【不送】, 回哪幾欄', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { name: 'x'.repeat(80), phone: '0900000000', line: '台北' },
    });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: false, kind: 'needs_confirm' });
    expect(r.ok === false && r.kind === 'needs_confirm' ? r.truncated : []).toContain('ercsig');
    expect(runHctSubmit).not.toHaveBeenCalled();
    expect(recordHctSubmit).not.toHaveBeenCalled();
  });

  it('帶【對的 token】⇒ 才真的送', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { name: 'x'.repeat(80), phone: '0900000000', line: '台北' },
    });
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'submitted', requestId: 'R1', raw: {} });
    const first = await submitShipmentToHctAction({ shipmentId: 's1' });
    const token = first.ok === false && first.kind === 'needs_confirm' ? first.confirmToken : '';
    const r = await submitShipmentToHctAction({ shipmentId: 's1', confirmTruncated: token });
    expect(r).toMatchObject({ ok: true, kind: 'submitted' });
    expect(runHctSubmit).toHaveBeenCalledTimes(1);
  });

  // 🔴🔴 **codex must-fix 的那個攻擊, 做成一格**:第一次就直接帶一個【自己編的】token。
  it('🛑 第一次就硬帶一個編的 token ⇒ 仍然被攔(它證明不了員工看過)', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { name: 'x'.repeat(80), phone: '0900000000', line: '台北' },
    });
    const r = await submitShipmentToHctAction({ shipmentId: 's1', confirmTruncated: 'true' });
    expect(r).toMatchObject({ ok: false, kind: 'needs_confirm' });
    expect(runHctSubmit).not.toHaveBeenCalled();
  });

  // 🔴 **兩次之間資料變了** ⇒ token 對不上 ⇒ 必須再攔一次。
  it('🛑 拿 A 版的 token 去送 B 版的資料 ⇒ 再攔一次', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { name: 'x'.repeat(80), phone: '0900000000', line: '台北' },
    });
    const first = await submitShipmentToHctAction({ shipmentId: 's1' });
    const tokenA = first.ok === false && first.kind === 'needs_confirm' ? first.confirmToken : '';
    // 資料換成「地址也超長」的 B 版 ⇒ 截斷清單變了
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { name: 'x'.repeat(80), phone: '0900000000', line: '台'.repeat(200) },
    });
    const r = await submitShipmentToHctAction({ shipmentId: 's1', confirmTruncated: tokenA });
    expect(r).toMatchObject({ ok: false, kind: 'needs_confirm' });
    expect(runHctSubmit).not.toHaveBeenCalled();
  });

  // 🟢 負對照:沒有超長時不得攔 —— 否則這道保護會把每一次正常送出都變成兩次點擊。
  it('沒有 truncated ⇒ 一次就送', async () => {
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'submitted', requestId: 'R1', raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r).toMatchObject({ ok: true, kind: 'submitted' });
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
