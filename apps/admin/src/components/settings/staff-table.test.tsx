// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../lib/staff-actions', () => ({
  createStaffAction: vi.fn(),
  updateStaffProfileAction: vi.fn(),
  setStaffActiveAction: vi.fn(),
}));

import { StaffCreateForm } from './staff-create-form';
import { StaffTable } from './staff-table';

const ROWS = [
  {
    id: 'sean',
    label: 'Sean(老闆)',
    is_manager: true,
    is_active: true,
  },
  {
    id: 'staff_2',
    label: '離職員工',
    is_manager: false,
    is_active: false,
  },
];

afterEach(cleanup);

describe('StaffTable', () => {
  it('should render the five desktop columns and declared mobile slots', () => {
    const { container } = render(<StaffTable rows={ROWS} />);
    const headers = [...container.querySelectorAll('th')].map(
      (node) => node.textContent,
    );
    expect(headers).toEqual([
      '顯示名',
      '代碼(id)',
      '管理者標記',
      '狀態',
      '操作',
    ]);

    const mobileCards = [...container.querySelectorAll('ul li')];
    expect(mobileCards).toHaveLength(2);
    expect(mobileCards[0]?.textContent).toContain('Sean(老闆)');
    expect(mobileCards[0]?.textContent).toContain('sean');
    expect(mobileCards[0]?.textContent).toContain('啟用中');
  });

  it('should render independent profile and active forms inside every mobile card', () => {
    const { container } = render(<StaffTable rows={ROWS} />);
    const inactiveCard = container.querySelectorAll('ul li')[1];
    if (!inactiveCard) throw new Error('缺少第二張員工手機卡片');
    const forms = inactiveCard.querySelectorAll('form');

    expect(forms).toHaveLength(2);
    expect(forms[0]?.querySelector('input[name="label"]')).toBeTruthy();
    expect(forms[0]?.querySelector('input[name="is_manager"]')).toBeTruthy();
    expect(forms[0]?.querySelector('input[name="is_active"]')).toBeNull();
    expect(forms[1]?.querySelector('input[name="is_active"]')).toBeTruthy();
    expect(forms[1]?.querySelector('input[name="label"]')).toBeNull();
    expect(forms[1]?.querySelector('input[name="is_manager"]')).toBeNull();
    expect(forms[1]?.querySelector('button')?.textContent).toContain('啟用');
  });

  it('should identify an inactive row with text instead of color alone', () => {
    const { getAllByText } = render(<StaffTable rows={ROWS} />);
    expect(getAllByText('已停用').length).toBeGreaterThanOrEqual(2);
  });

  it('should show the required empty-state copy', () => {
    const { getByText, container } = render(<StaffTable rows={[]} />);
    expect(
      getByText('目前沒有員工。用下方表單新增。'),
    ).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('should not expose an editable id field in row forms', () => {
    const { container } = render(<StaffTable rows={ROWS} />);
    expect(container.querySelector('input[type="text"][name="id"]')).toBeNull();
    expect(container.textContent).toContain('代碼不可修改');
  });

  it('should present manager as a non-enforcing marker instead of a role', () => {
    const { container } = render(<StaffTable rows={ROWS} />);
    expect(container.textContent).toContain('是');
    expect(container.textContent).toContain('否');
    expect(container.textContent).not.toContain('管理員');
  });
});

describe('StaffCreateForm', () => {
  it('should expose the specified create fields and immutable-id hint', () => {
    const { container } = render(<StaffCreateForm />);
    const idInput = container.querySelector<HTMLInputElement>(
      'input[name="id"]',
    );
    const labelInput = container.querySelector<HTMLInputElement>(
      'input[name="label"]',
    );

    expect(container.querySelector('h2')?.textContent).toBe('新增員工');
    expect(idInput?.pattern).toBe('[a-z0-9_]{1,64}');
    expect(idInput?.required).toBe(true);
    expect(idInput?.placeholder).toBe('staff_3');
    expect(labelInput?.maxLength).toBe(32);
    expect(labelInput?.required).toBe(true);
    expect(container.textContent).toContain('代碼之後不可修改');
    expect(container.textContent).toContain('管理者(標記用,尚未生效)');
    expect(container.textContent).toContain(
      '此標記目前不影響任何權限;成本報表上線後才會生效。',
    );
  });
});
