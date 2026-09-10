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
const recordHctUnknownReason = vi.fn();

/**
 * 🔴🔴 **這個假貨【帶著 RPC 的規則】—— 而它是本次修法的必要條件, 不是加分。**
 *
 * ⛔ 舊版是 `vi.fn() + mockResolvedValue(undefined)` ⇒ **一個什麼都答應的假貨**
 *    ⇒ 📌 **它在「DB 會擋」與「DB 不會擋」兩個世界印同一個綠。**
 *    ⇒ 🎯 那正是 ⟦ship-UNKNOWNREASONLOST⟧ 躲過三綠與整支測試檔的原因:
 *      `admin_record_hct_submit` 逐字擋 `unknown ⇒ unknown`
 *      (`20260904170000_m4b_hct_record_submit_result.sql:164-170`),
 *      而佔位(`shipment-submit-hct-action.ts:176`)已經把狀態推成 `unknown`
 *      ⇒ **真實世界第二發必 RAISE, 而假貨照樣回 resolve。**
 *
 * ✅ 所以這裡把那條規則搬進假貨:**狀態機由本地變數維護, 違規就 reject。**
 * 🔬 規則來源不是我記的 —— 2026-09-08 對**正式庫**唯讀取 `pg_get_functiondef` 比對過,
 *    body 與那支 migration 逐字相同(1858 字元 · md5 bb651a10c8af188550fb23a63a92cba0)。
 * ⚠️ **它仍然是假貨** —— 它演的是那三條規則, 不是 Postgres。行為的真憑據在拋棄式 PG 那一輪。
 */
let fakeStatus = 'draft';
const applyWriterRules = (a: { status: string }): Promise<void> => {
  if (fakeStatus === 'submitted') {
    return Promise.reject(new Error('admin_record_hct_submit:這張單已經是 submitted, 不得再寫。'));
  }
  if (fakeStatus === 'unknown' && a.status === 'unknown') {
    return Promise.reject(
      new Error('admin_record_hct_submit:這張單已經是 unknown, 再寫一次 unknown 不會讓我們更知道。'),
    );
  }
  fakeStatus = a.status;
  return Promise.resolve();
};
// 🔴 **整支換掉, 不用 `await orig()`** —— 真的那支會 import `@pcm/adapters/server`,
//    而它 import `server-only` ⇒ 單測直接炸在 import,**紅在載入不是紅在斷言**
//    (同一個坑 `shipment-actions.test.ts:22-24` 逐字記過)。
//    ⚠️ 代價:本檔用不到的那些 export 在這裡不存在 ⇒ 若 action 之後多用一支, 這裡要補。
// 🔵 ⟦ship-HCTREMARK⟧ 新增的那一支 —— 而上面那句「若 action 之後多用一支, 這裡要補」
//    今天自己應驗了:action 一接上它, 本檔五格當場全紅(`No "getShipmentRemarkParts" export`)。
//    📌 一個**預言了自己會失效的註解**, 而它失效的時候測試真的紅了 ⇒ 那句話有載體。
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
}));

const runHctSubmit = vi.fn();
vi.mock('./hct-submit-flow', () => ({ runHctSubmit }));

// 🔴 `auditLog` 要能被叫到 throw —— codex R2 must-fix ① 的那一格需要它。
//    ⚠️ 這支檔的其他格**沒有**在斷言 auditLog, 所以換成 mock 不會讓既有的格失去對象;
//    而 `NO_ACTOR_MESSAGE` 是真的常數 ⇒ 照抄字面, 不留 undefined(它會讓「沒有操作者」那格假綠)。
const auditLog = vi.fn();
vi.mock('./shipment-action-audit', () => ({
  auditLog,
  NO_ACTOR_MESSAGE: '找不到操作者身分',
}));

const { revalidatePath } = await import('next/cache');
const { submitShipmentToHctAction } = await import('./shipment-submit-hct-action');

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
  // 🔵 `clearAllMocks` 清呼叫紀錄而**不清 implementation** ⇒ 上一格叫它 throw 會漏到下一格。
  auditLog.mockReset();
  vi.mocked(revalidatePath).mockReset();
  authorizeAdminMutation.mockResolvedValue({ actorId: 'staff1' });
  getHctShipment.mockResolvedValue(ROW);
  // 🔴 每一格都從 `draft` 開始 —— 狀態機是**跨呼叫**的, 不重設會讓上一格污染下一格。
  fakeStatus = 'draft';
  recordHctSubmit.mockImplementation(applyWriterRules);
  // 🔵 窄門只寫 raw ⇒ **不碰狀態機**。這一行本身就是那支 RPC 的契約。
  recordHctUnknownReason.mockResolvedValue(undefined);
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
    expect(r).toEqual({ ok: true, kind: 'submitted', requestId: 'R1', remark: '[PCM] CH6D75 前叉油封 SKU-1234' });
    expect(recordHctSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted', requestId: 'R1' }),
    );
  });

  it('🔴🔴 **員工自己打了貨運備註 ⇒ 一個字都不動, 不預填**', async () => {
    // 🔴 承重:蓋掉他打的字 = 他在紙上看到的不是他寫的東西, 而他不會知道。
    fakeStatus = 'draft';
    getHctShipment.mockResolvedValue({ ...ROW, carrierNote: '易碎品 請小心' });
    runHctSubmit.mockResolvedValue({ kind: 'recorded', status: 'submitted', requestId: 'R3', raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's-1' });
    expect(r).toEqual({ ok: true, kind: 'submitted', requestId: 'R3', remark: '易碎品 請小心' });
    // 🔵 而預填那一支【連叫都不該叫】—— 叫了代表我們算了一個不會用的東西。
    expect(getShipmentRemarkParts).not.toHaveBeenCalled();
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
    expect(r).toEqual({ ok: true, kind: 'recovered', requestId: 'R2', remark: null });
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

  // ═══ ⟦ship-UNKNOWNREASONLOST⟧(2026-09-08)—— **這條路今天零格演過** ═══
  //   🔴 舊測試只演 `record:unknown → submit → record:submitted`(好世界),
  //      而**壞世界 `record:unknown → submit → 結果也是 unknown`** 一格都沒有
  //      ⇒ 那正是那個缺陷躲過整支檔的地方。
  it('🔴 佔位 unknown 之後結果【也是】unknown ⇒ 走窄門記原因, 不再叫 writer', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'unknown',
      requestId: null,
      raw: { flowReason: 'soap_fault' },
    });
    const out = await submitShipmentToHctAction({ shipmentId: 's1' });
    // ① writer 只被叫一次(佔位那一次)—— 叫第二次的話真實 DB 會 RAISE
    expect(recordHctSubmit).toHaveBeenCalledTimes(1);
    expect(recordHctSubmit.mock.calls[0]?.[0]).toMatchObject({ status: 'unknown' });
    // ② 原因走窄門, 而且**原因真的被帶過去**(只驗「有叫」的話, 帶空物件也會綠)
    expect(recordHctUnknownReason).toHaveBeenCalledTimes(1);
    expect(recordHctUnknownReason.mock.calls[0]?.[0]).toMatchObject({
      reason: { flowReason: 'soap_fault' },
    });
    // ③ 🔴 **值班看到的是那句安全提示, 不是一句 SQL 錯誤** —— 這一格才是使用者感受到的東西
    expect(out).toMatchObject({ ok: false, kind: 'unknown' });
    expect(JSON.stringify(out)).toContain('不要重按');
    expect(JSON.stringify(out)).not.toContain('admin_record_hct_submit');
  });

  // ═══ [codex `gpt-6-astra` R1 must-fix ②] 窄門【自己失敗】時, 安全提示不可以又消失 ═══
  //   🔬 codex 用記憶體探針重現過:窄門 throw ⇒ 掉進外層 catch ⇒ 回 `needs_human / PGRST202`,
  //      **沒有「不要重按」** —— 那正是本片要修的病, 只是換了一個觸發點。
  it('🔴 窄門 throw(migration 還沒貼 / 逾時 / 並發)⇒ 安全提示仍要印出來', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'unknown',
      requestId: null,
      raw: { flowReason: 'soap_fault' },
    });
    recordHctUnknownReason.mockRejectedValue(new Error('PGRST202: RPC missing'));
    const out = await submitShipmentToHctAction({ shipmentId: 's1' });
    const text = JSON.stringify(out);
    // ① 安全提示還在 —— 這是這一刻唯一會改變人行為的那句話
    expect(text).toContain('不要重按');
    expect(out).toMatchObject({ ok: false, kind: 'unknown' });
    // ② 🛑 而**不吞掉** —— 「原因沒能記下來」這件事要看得到, 否則沒有人會知道
    expect(text).toContain('PGRST202');
  });

  // 🔴 **[codex R2 must-fix ①]** 稽核自己炸掉時, 安全提示**還是**不可以消失。
  //    🔬 codex 實跑重現:`auditLog` throw ⇒ 掉進外層 catch ⇒ 回 `needs_human / audit sink failed`
  //    ⇒ 📌 **同一個病的第三個觸發點**(前兩個 = writer RAISE、窄門 throw)。
  //    🎯 形狀:**一句安全提示的存活率 = 它後面那串副作用【全部】不出事的機率。**
  it('🔴 窄門 throw 而【稽核也 throw】⇒ 安全提示仍要印出來', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'unknown',
      requestId: null,
      raw: { flowReason: 'soap_fault' },
    });
    recordHctUnknownReason.mockRejectedValue(new Error('PGRST202: RPC missing'));
    // 🔴 **只在【那一個事件】上 throw, 不是一律 throw。**
    //    ⚠️ 我第一版寫成一律 throw ⇒ 它死在 `:96` 那發 `attempt` 稽核, **在送出之前**
    //    ⇒ 📌 那條路**什麼都沒送出去**, 所以「沒有安全提示」是對的, 不是缺陷。
    //    🎯 **一個太粗的 fixture 會證明一件我沒有在問的事** —— 而它紅得很有說服力。
    auditLog.mockImplementation((event: string) => {
      if (event === 'shipment.hct_submit_reason_lost') throw new Error('audit sink failed');
    });
    const out = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(JSON.stringify(out)).toContain('不要重按');
    expect(out).toMatchObject({ ok: false, kind: 'unknown' });
    // ⚪ 負對照:那發稽核**真的被叫到了**(否則這一格在「有擋住」與「根本沒走到」印同一個綠)
    expect(auditLog.mock.calls.some((c) => c[0] === 'shipment.hct_submit_reason_lost')).toBe(true);
  });

  it('🔴 窄門 throw 而【revalidatePath 也 throw】⇒ 安全提示仍要印出來', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'unknown',
      requestId: null,
      raw: { flowReason: 'soap_fault' },
    });
    recordHctUnknownReason.mockRejectedValue(new Error('PGRST202: RPC missing'));
    vi.mocked(revalidatePath).mockImplementation(() => {
      throw new Error('revalidate failed');
    });
    const out = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(JSON.stringify(out)).toContain('不要重按');
  });

  it('⚪ 負對照:窄門【成功】時不可以印那句「連原因都沒能記」(證明上一格不是恆真)', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'unknown',
      requestId: null,
      raw: { flowReason: 'soap_fault' },
    });
    const out = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(JSON.stringify(out)).toContain('不要重按');
    expect(JSON.stringify(out)).not.toContain('沒能記進資料庫');
  });

  // 🔴 **[R3 F5]** 窄門【成功】那條路的副作用炸掉時, 安全提示也不可以消失(第四個觸發點)。
  it('🔴 窄門成功而 revalidatePath throw ⇒ 安全提示仍要印出來', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'unknown',
      requestId: null,
      raw: { flowReason: 'soap_fault' },
    });
    vi.mocked(revalidatePath).mockImplementation(() => {
      throw new Error('revalidate failed');
    });
    const out = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(JSON.stringify(out)).toContain('不要重按');
    expect(out).toMatchObject({ ok: false, kind: 'unknown' });
    // ⚪ 負對照:窄門【成功】了 ⇒ 不可以印那句「連原因都沒能記」
    expect(JSON.stringify(out)).not.toContain('沒能記進資料庫');
  });

  it('⚪ 負對照:結果是 failed ⇒ 走 writer【不】走窄門(狀態要真的翻成 failed)', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'failed',
      requestId: null,
      raw: { ErrMsg: '地址格式不合' },
    });
    await submitShipmentToHctAction({ shipmentId: 's1' });
    // 🔵 `unknown ⇒ failed` 在 writer 那邊是**允許**的 ⇒ 佔位 + 這一發 = 兩次
    expect(recordHctSubmit).toHaveBeenCalledTimes(2);
    expect(recordHctSubmit.mock.calls[1]?.[0]).toMatchObject({ status: 'failed' });
    // 🛑 少了這一格,「unknown 走窄門」會被寫成「凡是失敗都走窄門」而照樣綠
    expect(recordHctUnknownReason).not.toHaveBeenCalled();
  });

  it('🔴 假貨真的帶著規則(否則上面兩格是空過的)⇒ 對它連寫兩次 unknown 必須 reject', async () => {
    await expect(applyWriterRules({ status: 'unknown' })).resolves.toBeUndefined();
    await expect(applyWriterRules({ status: 'unknown' })).rejects.toThrow('已經是 unknown');
    // ⚪ 負對照:同一個假貨對 `unknown ⇒ submitted` 要放行(證明它不是恆拒)
    fakeStatus = 'unknown';
    await expect(applyWriterRules({ status: 'submitted' })).resolves.toBeUndefined();
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

/**
 * ⟦ship-HCTFIELDRULES⟧ **V15 第 11 頁的電話與地址規則 —— 而它們【只提醒不擋】。**
 *
 * 🔴🔴 **這一族守的是一個【拍板被推翻】的形狀,不只是行為。**
 *    Sean 2026-09-09 先拍「擋」,而**他當時不知道後台改不動一張既有訂單的收件人電話**
 *    (改單 RPC 白名單只有出貨方式與發票欄;作廢重建仍讀同一份訂單快照)
 *    ⇒ 擋下來的員工**無事可做**,而不擋的話新竹會拒、單子回 `failed`、他還能再按。
 *    ⇒ 📌 端回去之後他改拍「提醒」。**誰要把「擋」加回來,先解掉那個缺口。**
 *
 * 🔴 第二承重的一格是「不得誤傷不是在送單的那幾條路」(codex R1 must-fix ①):
 *    卡在 `unknown` 的箱走的是 `QueryEDELNO_Json`,而查詢只吃 `epino`
 *    ⇒ 拿收貨人電話去攔它是純粹的誤傷,而那條正是最壞情況的唯一出口。
 */
describe('🟡 電話與地址規則:提醒但送得出去', () => {
  const BAD_PHONE = { ...ROW.recipientSnapshot, phone: '+886912345678' };

  it('🟡 電話帶國碼 ⇒ 第一次按不送、給提醒;帶 token 再按一次就送', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, recipientSnapshot: BAD_PHONE });
    const first = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(first.kind).toBe('needs_confirm');
    expect(first.ok === false && first.message).toContain('國碼');
    expect(first.ok === false && first.message, '要講後果, 不是只講哪裡不對').toContain('可能被退');
    expect(runHctSubmit, '第一次按不准送出去').not.toHaveBeenCalled();
    expect(recordHctSubmit, '被提醒攔下的箱不得留下 unknown 佔位').not.toHaveBeenCalled();

    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'submitted',
      requestId: 'E1',
      raw: {},
    });
    const token = first.ok === false && first.kind === 'needs_confirm' ? first.confirmToken : '';
    const second = await submitShipmentToHctAction({ shipmentId: 's1', confirmTruncated: token });
    expect(second.ok, '看過之後照樣送得出去 —— 這就是「提醒不擋」').toBe(true);
    expect(runHctSubmit).toHaveBeenCalled();
  });

  it.each([
    ['02-2345-6789#123', '分機'],
    ['912345678', '0 開頭'],
  ])('🟡 電話 %s ⇒ needs_confirm 且訊息含「%s」', async (phone, hint) => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { ...ROW.recipientSnapshot, phone },
    });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.kind).toBe('needs_confirm');
    expect(r.ok === false && r.message).toContain(hint);
  });

  it('🟡 地址有「大樓」⇒ 同一個殼, 而第二次【真的】送得出去', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      recipientSnapshot: { ...ROW.recipientSnapshot, line: '台北市中正區某某大樓 5 樓' },
    });
    const first = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(first.kind).toBe('needs_confirm');
    expect(first.ok === false && first.message).toContain('大樓');
    // 🔴 codex nit:只驗第一次提醒 ⇒ 標題說「一樣送得出去」而測試沒證明。補第二次。
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'submitted',
      requestId: 'E3',
      raw: {},
    });
    const token = first.ok === false && first.kind === 'needs_confirm' ? first.confirmToken : '';
    const second = await submitShipmentToHctAction({ shipmentId: 's1', confirmTruncated: token });
    expect(second.ok).toBe(true);
  });

  // 🔴 `failed` 與 `draft` 同屬「要新增託運單」那一側 —— 少了這格, 一個只認 draft 的實作會全綠。
  it('🟡 failed 的箱也走同一個提醒流程(它與 draft 同側)', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctStatus: 'failed', recipientSnapshot: BAD_PHONE });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.kind).toBe('needs_confirm');
  });

  // 🟢 負對照:少了它, 一個「永遠 needs_confirm」的實作會通過上面每一格。
  it('🟢 負對照:乾淨的收件資料 ⇒ 第一次按就直接送', async () => {
    runHctSubmit.mockResolvedValue({
      kind: 'recorded',
      status: 'submitted',
      requestId: 'E0',
      raw: {},
    });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.ok).toBe(true);
    expect(runHctSubmit).toHaveBeenCalled();
  });

  it('🔴 卡在 unknown 的箱 + 壞電話 ⇒ 照樣去查, 不被提醒攔住', async () => {
    getHctShipment.mockResolvedValue({ ...ROW, hctStatus: 'unknown', recipientSnapshot: BAD_PHONE });
    runHctSubmit.mockResolvedValue({ kind: 'recovered', requestId: 'E9', raw: {} });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.kind, '被攔住 ⇒ 那箱的救援路被一支與它無關的電話堵死').not.toBe('needs_confirm');
    expect(runHctSubmit, '查詢那條路必須真的被走到').toHaveBeenCalled();
    // 🔴 codex nit:結果是 mock 給的 ⇒ 光看 kind 證不到「它真的以 unknown 的身分去查」。
    //    把傳下去的 `current` 釘住,否則有人把它寫死成 'draft' 這一格仍然綠。
    expect(runHctSubmit.mock.calls[0]?.[0]).toMatchObject({ current: 'unknown' });
  });

  it('🔴 已送成功(submitted)的箱 + 壞電話 ⇒ 是 refused, 不是先問格式', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      hctStatus: 'submitted',
      recipientSnapshot: BAD_PHONE,
    });
    runHctSubmit.mockResolvedValue({ kind: 'refused', reason: '這張單已經送成功過了。' });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.kind, '先問格式等於叫員工看一支看了也沒用的電話').toBe('refused');
    expect(runHctSubmit.mock.calls[0]?.[0]).toMatchObject({ current: 'submitted' });
  });

  /**
   * 🛑 **開關關著時要說「新竹未開通」** —— 順序寫反的話,
   *    一個根本送不出去的環境會讓員工先去看收件資料。
   */
  it('🔴 開關關著 + 電話也有問題 ⇒ 先講「新竹未開通」', async () => {
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'false');
    getHctShipment.mockResolvedValue({ ...ROW, recipientSnapshot: BAD_PHONE });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.kind).toBe('disabled');
  });

  it('🔴 已作廢的箱 ⇒ refused(狀態的問題比資料的問題先講)', async () => {
    getHctShipment.mockResolvedValue({
      ...ROW,
      voidedAt: '2026-09-09T00:00:00Z',
      recipientSnapshot: BAD_PHONE,
    });
    const r = await submitShipmentToHctAction({ shipmentId: 's1' });
    expect(r.kind).toBe('refused');
  });
});
