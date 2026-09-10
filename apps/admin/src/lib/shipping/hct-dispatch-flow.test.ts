import { describe, expect, it } from 'vitest';
import { canDispatch, planFromDispatch } from './hct-dispatch-flow';
import { HCT_DISPATCH_MAX_ROWS } from './hct-client';

// hct-dispatch-flow.test.ts — ⟦ship-DISPATCHORDER⟧ 片二的守門。
// 🛑 零 DB、零網路、零寄信 —— 輸入是 client 的回答,輸出是「這一箱要做什麼」。

const NOW = new Date('2026-09-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1_000);
const box = (o: Partial<Parameters<typeof canDispatch>[0][number]> = {}) => ({
  epino: 'E1',
  hctStatus: 'submitted' as const,
  submittedAt: daysAgo(1),
  alreadyDispatched: false,
  ...o,
});

describe('⟦ship-DISPATCHORDER⟧ 逐箱各自結算 —— 失敗方向要是【可補】的那一個', () => {
  it('🔴🔴 **部分成功 ⇒ 成功那箱標出貨, 失敗那箱原封不動**', () => {
    expect(
      planFromDispatch({
        kind: 'answered',
        raw: {},
        rows: [
          { kind: 'dispatched', epino: 'E1', edelno: '8947081964' },
          { kind: 'rejected', epino: 'E2', errMsg: '超過 30 天' },
        ],
      }),
    ).toEqual({
      kind: 'plan',
      rows: [
        { action: 'mark_shipped', epino: 'E1', edelno: '8947081964' },
        { action: 'leave_alone', epino: 'E2', message: '超過 30 天' },
      ],
    });
  });

  it('🔴 拒絕而【沒給原因】⇒ 說得出「它沒說」, 不留一個空白', () => {
    // 🔴 承重:空白會被讀成「沒問題」。
    expect(
      planFromDispatch({ kind: 'answered', raw: {}, rows: [{ kind: 'rejected', epino: 'E1', errMsg: '' }] }),
    ).toEqual({ kind: 'plan', rows: [{ action: 'leave_alone', epino: 'E1', message: '新竹拒絕了這一箱, 而它沒有給原因' }] });
  });

  it('🔴🔴 **那一箱不確定 ⇒ `needs_human`, 而【不是】leave_alone** —— 拒絕是答案, 不確定不是', () => {
    expect(
      planFromDispatch({ kind: 'answered', raw: {}, rows: [{ kind: 'unknown', epino: 'E1', reason: 'epino_mismatch' }] }),
    ).toEqual({ kind: 'plan', rows: [{ action: 'needs_human', epino: 'E1', reason: 'epino_mismatch' }] });
  });

  it('🛑 整包不確定 ⇒ 一箱都不動, 而它【不代表沒有一箱叫到車】', () => {
    expect(planFromDispatch({ kind: 'unknown', reason: 'rtn_code_0' })).toEqual({
      kind: 'all_unknown',
      reason: 'rtn_code_0',
    });
    // 🔵 有原文就要留著 —— 那是事後唯一能回頭看的東西。
    expect(planFromDispatch({ kind: 'unknown', reason: 'soap_fault', evidence: '<Fault>' })).toEqual({
      kind: 'all_unknown',
      reason: 'soap_fault',
      evidence: '<Fault>',
    });
  });

  it('🔴 閘關著 ⇒ disabled, 而【不是】一個空的計畫', () => {
    // 🔴 承重:空計畫會被呼叫端讀成「跑完了, 沒有一箱要動」。
    expect(planFromDispatch({ kind: 'disabled' })).toEqual({ kind: 'disabled' });
  });
});

describe('⟦ship-DISPATCHORDER⟧ 按下去【之前】就要知道叫不叫得動', () => {
  it('🟢 正常的一箱 ⇒ ok', () => {
    expect(canDispatch([box()], NOW)).toEqual({ ok: true });
  });

  it('🔴🔴 **已經叫過車的擋住** —— 再叫一次會怎樣我們沒問過新竹', () => {
    expect(canDispatch([box({ alreadyDispatched: true })], NOW)).toEqual({
      ok: false,
      message: '箱 E1 已經叫過車了 —— 再叫一次會怎樣我們沒有問過新竹, 所以擋住',
    });
  });

  it('🔴 託運單還沒在新竹建好 ⇒ 擋, 而訊息說得出現在是哪一態', () => {
    for (const st of ['draft', 'failed', 'unknown'] as const) {
      const r = canDispatch([box({ hctStatus: st })], NOW);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.message).toContain(st);
    }
  });

  it('🔴🔴 **超過 30 天擋住, 而邊界取嚴的那一邊**', () => {
    // 🔵 29 天 ⇒ 過;31 天 ⇒ 擋。兩個一起寫, 否則「永遠擋」也會通過上面那格。
    expect(canDispatch([box({ submittedAt: daysAgo(29) })], NOW)).toEqual({ ok: true });
    expect(canDispatch([box({ submittedAt: daysAgo(31) })], NOW).ok).toBe(false);
  });

  it('🔴 沒有建檔時間 ⇒ 擋 —— 判不出 30 天就不要放行', () => {
    expect(canDispatch([box({ submittedAt: null })], NOW).ok).toBe(false);
  });

  it('🔴 一次最多 20 箱, 而 0 箱也擋', () => {
    expect(canDispatch([], NOW).ok).toBe(false);
    const many = Array.from({ length: HCT_DISPATCH_MAX_ROWS + 1 }, (_v, i) => box({ epino: `E${String(i)}` }));
    expect(canDispatch(many, NOW).ok).toBe(false);
    // 🔵 正對照:剛好 20 箱要過得去。
    expect(canDispatch(many.slice(0, HCT_DISPATCH_MAX_ROWS), NOW)).toEqual({ ok: true });
  });

  it('🔴 一批裡只要有一箱不合格, 整批擋 —— 不偷偷少送那一箱', () => {
    // 🔴 承重:「跳過壞的那箱繼續送」會讓員工以為 5 箱都叫了, 而只叫了 4 箱。
    expect(canDispatch([box({ epino: 'A' }), box({ epino: 'B', alreadyDispatched: true })], NOW).ok).toBe(false);
  });
});
