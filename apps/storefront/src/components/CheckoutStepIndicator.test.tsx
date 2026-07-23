// @vitest-environment jsdom
//
// CheckoutStepIndicator test(M-3 兩步結帳 U1)。
// 驗:
// ① 只渲染兩步(收件資料 / 發票與付款)、不存在第三步入口。
// ② step=1:第一步 is-active、第二步 disabled(未完成不可跳)。
// ③ step=2:第一步 is-done(✓)可回點 → onStepChange(1);第二步 is-active、點自己不觸發。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CheckoutStepIndicator } from './CheckoutStepIndicator';

afterEach(cleanup);

function renderIndicator(step: 1 | 2) {
  const onStepChange = vi.fn();
  const utils = render(<CheckoutStepIndicator step={step} onStepChange={onStepChange} />);
  return { ...utils, onStepChange };
}

describe('CheckoutStepIndicator(M-3 兩步結帳 U1)', () => {
  it('① 只有兩步:收件資料 / 發票與付款,無第三步入口', () => {
    const { container } = renderIndicator(1);
    const steps = container.querySelectorAll('.co-step');
    expect(steps.length).toBe(2);
    expect(Array.from(steps).map((s) => s.querySelector('.co-step-label')?.textContent)).toEqual([
      '收件資料',
      '發票與付款',
    ]);
    // 三步時代的第三步字面不得殘留於步驟列
    expect(container.textContent).not.toContain('確認訂單');
    expect(container.querySelector('.co-step-num')?.textContent).toBe('01');
  });

  it('② step=1:第一步 is-active(當前步驟)、第二步未完成 → disabled 不可跳', () => {
    const { container, onStepChange } = renderIndicator(1);
    const steps = container.querySelectorAll<HTMLButtonElement>('.co-step');
    expect(steps[0]!.className).toContain('is-active');
    expect(steps[1]!.disabled).toBe(true);
    fireEvent.click(steps[1]!);
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('③ step=2:第一步 is-done(✓)可回點;第二步 is-active、disabled 且點自己不觸發', () => {
    const { container, onStepChange } = renderIndicator(2);
    const steps = container.querySelectorAll<HTMLButtonElement>('.co-step');
    expect(steps[0]!.className).toContain('is-done');
    expect(steps[0]!.querySelector('.co-step-num')?.textContent).toBe('✓');
    expect(steps[0]!.disabled).toBe(false); // 已完成 → 可回點
    expect(steps[0]!.getAttribute('aria-disabled')).toBeNull();
    expect(steps[1]!.className).toContain('is-active');

    fireEvent.click(steps[0]!);
    expect(onStepChange).toHaveBeenCalledWith(1);

    onStepChange.mockClear();
    fireEvent.click(steps[1]!); // 當前步驟 → 不重複導覽
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('🔴 ⑥ a11y:當前步驟保持可聚焦 + aria-current="step" + aria-disabled;未完成步驟才原生 disabled', () => {
    const { container } = renderIndicator(1);
    const steps = container.querySelectorAll<HTMLButtonElement>('.co-step');
    // 當前步驟:可聚焦(才朗讀得到「目前在這一步」)、但標示為此刻不可動作
    expect(steps[0]!.getAttribute('aria-current')).toBe('step');
    expect(steps[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(steps[0]!.disabled).toBe(false); // 🔴 不可用原生 disabled:會移出 tab 順序且多數 SR 不朗讀
    // 未完成步驟:真的不可用
    expect(steps[1]!.getAttribute('aria-current')).toBeNull();
    expect(steps[1]!.disabled).toBe(true);

    cleanup();
    const second = renderIndicator(2).container.querySelectorAll<HTMLButtonElement>('.co-step');
    expect(second[1]!.getAttribute('aria-current')).toBe('step');
    expect(second[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(second[1]!.disabled).toBe(false);
    // 已完成步驟:可回點、非 current、非 aria-disabled
    expect(second[0]!.getAttribute('aria-current')).toBeNull();
    expect(second[0]!.getAttribute('aria-disabled')).toBeNull();
    expect(second[0]!.disabled).toBe(false);
  });

  it('④ 步驟編號固定兩碼(02)、label 與 design co-step 結構一致', () => {
    const { container } = renderIndicator(1);
    const nums = Array.from(container.querySelectorAll('.co-step-num')).map((n) => n.textContent);
    expect(nums).toEqual(['01', '02']);
    expect(container.querySelector('.co-steps')).toBeTruthy();
  });

  it('⑤ 未完成步驟不得被點進(step=1 時點第二步不改 state)', () => {
    const { container, onStepChange } = renderIndicator(1);
    const second = container.querySelectorAll<HTMLButtonElement>('.co-step')[1]!;
    second.disabled = false; // 繞過 disabled 直接派事件,驗 handler 自身也有守門
    fireEvent.click(second);
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('🔴 U5 locked(付款中)→ 點已完成步驟不觸發 onStepChange(縱深守門、Fable F1)', () => {
    const onStepChange = vi.fn();
    const { container } = render(
      <CheckoutStepIndicator step={2} onStepChange={onStepChange} locked />,
    );
    const steps = container.querySelectorAll<HTMLButtonElement>('.co-step');
    // 已完成的第一步:非 locked 時可回點(見 ③);locked(付款中)時 handler no-op、不退回 Step 1。
    fireEvent.click(steps[0]!);
    expect(onStepChange).not.toHaveBeenCalled();
  });
});
