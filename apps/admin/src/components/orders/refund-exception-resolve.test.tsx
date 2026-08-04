// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  VERDICT_MESSAGES,
  resolveFailure,
  type RefundJudgeState,
  type RefundResolveState,
} from '../../lib/payment/refund-recovery-state';
import type { RefundRecoveryVerdict } from '../../lib/payment/refund-judgment';

// M-3 A7c RW4:異常清單列操作元件的接線測試(語意層在 refund-recovery-actions.test.ts)。
// 🔴 mock 掉 server action 模組(transitively 拉 next/cache / composition / server-only)。

const judgeMock =
  vi.fn<(prev: RefundJudgeState, form: FormData) => Promise<RefundJudgeState>>();
const resolveMock =
  vi.fn<(prev: RefundResolveState, form: FormData) => Promise<RefundResolveState>>();
vi.mock('../../lib/payment/refund-recovery-actions', () => ({
  judgeRefundExceptionAction: (prev: RefundJudgeState, form: FormData) => judgeMock(prev, form),
  resolveRefundExceptionAction: (prev: RefundResolveState, form: FormData) =>
    resolveMock(prev, form),
}));
const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { RefundExceptionResolve } from './refund-exception-resolve';

const REFUND_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';

function judged(verdict: RefundRecoveryVerdict, over: Record<string, unknown> = {}): RefundJudgeState {
  return {
    status: 'judged',
    message: VERDICT_MESSAGES[verdict],
    verdict,
    baseline: 100,
    refundedNow: 100,
    delta: 0,
    refundAmount: 250,
    ledgerConfirmedSum: 120,
    ledgerMatchesRecord: true,
    confirmedMissingRefundId: 0,
    judgedAtIso: '2026-08-04T05:00:00.000Z',
    ...over,
  } as RefundJudgeState;
}

function mount() {
  return render(<RefundExceptionResolve refundId={REFUND_ID} serverToken={TOKEN} />);
}

async function runJudge(container: HTMLElement, settledText: string) {
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(judgeMock.mock.calls.length).toBe(1));
  // useActionState 的 state flush 在 pending 結束後;等到判定文字上畫面才往下斷言。
  await waitFor(() => expect(container.textContent).toContain(settledText));
}

beforeEach(() => {
  judgeMock.mockReset();
  resolveMock.mockReset();
  routerRefresh.mockReset();
  judgeMock.mockResolvedValue({ status: 'idle' });
  resolveMock.mockResolvedValue({ status: 'idle', requestToken: TOKEN });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RefundExceptionResolve — RW4', () => {
  it('[1] 初始:只有「執行對帳判定」;零結案按鈕、零 DR 欄(判定成立前不給任何動錢入口)', () => {
    const { container, getByRole } = mount();
    expect(getByRole('button', { name: '執行對帳判定' })).toBeTruthy();
    expect(container.textContent).not.toContain('標記失敗');
    expect(container.textContent).not.toContain('恢復結案');
    expect(container.querySelector('input[name="dr_code"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[name="refund_id"]')?.value,
    ).toBe(REFUND_ID);
  });

  it('[2] 判定=not_executed:顯讀數+只開「標記失敗」;確認碼欄必在、值進 FormData(opus C3)', async () => {
    judgeMock.mockResolvedValue(judged('not_executed'));
    const { container, getByRole } = mount();
    await runJudge(container, VERDICT_MESSAGES.not_executed);
    expect(container.textContent).toContain('NT$ 250');
    // RF8 讀數在畫面(codex nit4:刪 RF8 顯示區這格要紅)。
    expect(container.textContent).toContain('帳本已登記(confirmed)合計');
    expect(container.textContent).toContain('NT$ 120');
    const markButton = getByRole('button', { name: /標記失敗/ });
    expect(container.textContent).not.toContain('恢復結案');
    const form = markButton.closest('form')!;
    expect(
      form.querySelector<HTMLInputElement>('input[name="resolution"]')?.value,
    ).toBe('mark_failed');
    expect(form.querySelector<HTMLInputElement>('input[name="request_token"]')?.value).toBe(TOKEN);
    const confirm = form.querySelector<HTMLInputElement>('input[name="confirm_code"]')!;
    expect(confirm).not.toBeNull();
    fireEvent.change(confirm, { target: { value: '0087' } });
    fireEvent.submit(form);
    await waitFor(() => expect(resolveMock.mock.calls.length).toBe(1));
    const sent = resolveMock.mock.calls[0]![1];
    expect(sent.get('refund_id')).toBe(REFUND_ID);
    expect(sent.get('resolution')).toBe('mark_failed');
    expect(sent.get('request_token')).toBe(TOKEN);
    expect(sent.get('confirm_code')).toBe('0087');
  });

  it('[3] 判定=executed:只開「恢復結案」+ DR 欄;送出帶員工輸入的 Portal 碼', async () => {
    judgeMock.mockResolvedValue(judged('executed', { refundedNow: 350, delta: 250 }));
    const { container, getByRole } = mount();
    await runJudge(container, VERDICT_MESSAGES.executed);
    expect(container.textContent).not.toContain('標記失敗');
    const recoverButton = getByRole('button', { name: /恢復結案/ });
    const form = recoverButton.closest('form')!;
    const dr = form.querySelector<HTMLInputElement>('input[name="dr_code"]')!;
    fireEvent.change(dr, { target: { value: 'DR20260803gvcV5i' } });
    fireEvent.submit(form);
    await waitFor(() => expect(resolveMock.mock.calls.length).toBe(1));
    const sent = resolveMock.mock.calls[0]![1];
    expect(sent.get('resolution')).toBe('recover_confirmed');
    expect(sent.get('dr_code')).toBe('DR20260803gvcV5i');
  });

  it('[4] 🔴 判定=停+告警五碼(含 evidence_contradiction,opus M1):零結案按鈕(按鈕不存在=結構上按不下去)', async () => {
    for (const verdict of [
      'evidence_contradiction',
      'delta_mismatch',
      'other_in_flight',
      'record_shape_bad',
      'record_state_bad',
    ] as const) {
      judgeMock.mockReset();
      judgeMock.mockResolvedValue(
        judged(verdict, {
          ledgerMatchesRecord: null,
          ...(verdict.startsWith('record_') ? { refundedNow: null, delta: null } : {}),
        }),
      );
      const { container } = mount();
      await runJudge(container, VERDICT_MESSAGES[verdict]);
      expect(container.textContent, verdict).not.toContain('標記失敗');
      expect(container.textContent, verdict).not.toContain('恢復結案');
      cleanup();
    }
  });

  it('[4b] RF8 告警兩則:對帳不一致(ledgerMatchesRecord=false)與缺對帳碼(>0)都要上畫面', async () => {
    judgeMock.mockResolvedValue(
      judged('delta_mismatch', {
        delta: 30,
        refundedNow: 130,
        ledgerMatchesRecord: false,
        confirmedMissingRefundId: 2,
      }),
    );
    const { container } = mount();
    await runJudge(container, VERDICT_MESSAGES.delta_mismatch);
    expect(container.textContent).toContain('帳本合計與 Record 累計不一致');
    expect(container.textContent).toContain('2 筆已完成退款缺 TapPay 對帳碼');
  });

  it('[4c] 負差額顯示為 -NT$ X(不讓負號黏進金額;opus nit)', async () => {
    judgeMock.mockResolvedValue(
      judged('delta_mismatch', { delta: -50, refundedNow: 50, ledgerMatchesRecord: null }),
    );
    const { container } = mount();
    await runJudge(container, VERDICT_MESSAGES.delta_mismatch);
    expect(container.textContent).toContain('-NT$ 50');
  });

  it('[5] resolve 失敗:訊息上畫面、DR 輸入帶回、token 改用 state 那把', async () => {
    judgeMock.mockResolvedValue(judged('executed', { refundedNow: 350, delta: 250 }));
    const failedToken = '11111111-2222-4333-8444-555555555555';
    resolveMock.mockResolvedValue({
      ...resolveFailure('evidence_mismatch', failedToken, { drCode: 'DR_TYPED', confirmCode: '' }),
    });
    const { container, getByRole } = mount();
    await runJudge(container, VERDICT_MESSAGES.executed);
    const form = getByRole('button', { name: /恢復結案/ }).closest('form')!;
    fireEvent.change(form.querySelector('input[name="dr_code"]')!, {
      target: { value: 'DR_TYPED' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(container.textContent).toContain('受理證據不一致'));
    expect(
      container.querySelector<HTMLInputElement>('input[name="dr_code"]')?.value,
    ).toBe('DR_TYPED');
    expect(
      container.querySelector<HTMLInputElement>('input[name="request_token"]')?.value,
    ).toBe(failedToken);
  });

  it('[6] bfcache 還原 → router.refresh(絕不 client 換鍵;refund-section MF1 同紀律)', () => {
    mount();
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it('[7] 🔴 finalize_unknown 凍結(codex R2 nit):舊判定與所有按鈕消失、只剩告警(「確認前什麼都別做」不能與畫面打架)', async () => {
    judgeMock.mockResolvedValue(judged('not_executed'));
    resolveMock.mockResolvedValue({
      ...resolveFailure('finalize_unknown', TOKEN, { drCode: '', confirmCode: '0087' }),
    });
    const { container, getByRole } = mount();
    await runJudge(container, VERDICT_MESSAGES.not_executed);
    const form = getByRole('button', { name: /標記失敗/ }).closest('form')!;
    fireEvent.change(form.querySelector('input[name="confirm_code"]')!, {
      target: { value: '0087' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(container.textContent).toContain('結案結果不明'));
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).not.toContain('執行對帳判定');
    // codex R3 nit:過期讀數也要消失(只藏按鈕、留舊讀數=下一個誤導源)。
    expect(container.textContent).not.toContain('Record 對帳讀數');
    expect(container.textContent).not.toContain(VERDICT_MESSAGES.not_executed);
  });
});
