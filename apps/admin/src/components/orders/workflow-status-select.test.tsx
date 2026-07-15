// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { WorkflowStatusSelect } from './workflow-status-select';
import { WF_CLEAR_VALUE } from '../../lib/orders/workflow-form';

const OPTIONS = [
  { value: WF_CLEAR_VALUE, label: '未設定', color: null, textColor: null },
  { value: 'paid', label: '已收款', color: '#FBE4A6', textColor: 'dark' as const },
  { value: 'shipped', label: '出貨完成', color: '#2F4F3E', textColor: 'light' as const },
];

afterEach(cleanup);

describe('WorkflowStatusSelect', () => {
  it('should render closed select colored by the currently saved value', () => {
    const { getByRole } = render(
      <WorkflowStatusSelect
        name='workflow_status'
        defaultValue='paid'
        options={OPTIONS}
        ariaLabel='商品狀態'
      />,
    );
    const select = getByRole('combobox', { name: '商品狀態' }) as HTMLSelectElement;
    expect(select.value).toBe('paid');
    expect(select.style.backgroundColor).toBe('rgb(251, 228, 166)');
    expect(select.style.color).toBe('rgb(39, 39, 42)');
  });

  it('should stay neutral (no inline colors) for 未設定', () => {
    const { getByRole } = render(
      <WorkflowStatusSelect
        name='workflow_status'
        defaultValue={WF_CLEAR_VALUE}
        options={OPTIONS}
        ariaLabel='商品狀態'
      />,
    );
    const select = getByRole('combobox') as HTMLSelectElement;
    expect(select.style.backgroundColor).toBe('');
  });

  it('should recolor immediately on change before saving', () => {
    const { getByRole } = render(
      <WorkflowStatusSelect
        name='workflow_status'
        defaultValue='paid'
        options={OPTIONS}
        ariaLabel='商品狀態'
      />,
    );
    const select = getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'shipped' } });
    expect(select.value).toBe('shipped');
    expect(select.style.backgroundColor).toBe('rgb(47, 79, 62)');
    expect(select.style.color).toBe('rgb(250, 250, 250)');
  });
});
