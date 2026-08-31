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
    const { container } = render(<StaffTable rows={ROWS} canManage='yes' />);
    const headers = [...container.querySelectorAll('th')].map(
      (node) => node.textContent,
    );
    expect(headers).toEqual([
      '顯示名',
      '代碼(id)',
      '管理者',
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
    const { container } = render(<StaffTable rows={ROWS} canManage='yes' />);
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
    const { getAllByText } = render(<StaffTable rows={ROWS} canManage='yes' />);
    expect(getAllByText('已停用').length).toBeGreaterThanOrEqual(2);
  });

  it('should show the required empty-state copy', () => {
    const { getByText, container } = render(<StaffTable rows={[]} canManage='yes' />);
    expect(
      getByText('目前沒有員工。用下方表單新增。'),
    ).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('should not expose an editable id field in row forms', () => {
    const { container } = render(<StaffTable rows={ROWS} canManage='yes' />);
    expect(container.querySelector('input[type="text"][name="id"]')).toBeNull();
    expect(container.textContent).toContain('代碼不可修改');
  });

  it('should present manager as a non-enforcing marker instead of a role', () => {
    const { container } = render(<StaffTable rows={ROWS} canManage='yes' />);
    expect(container.textContent).toContain('是');
    expect(container.textContent).toContain('否');
    expect(container.textContent).not.toContain('管理員');
  });
});

describe('StaffCreateForm', () => {
  it('should expose the specified create fields and immutable-id hint', () => {
    const { container } = render(<StaffCreateForm canManage='yes' />);
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
    expect(container.textContent).toContain('管理者');
    expect(container.textContent).toContain(
      '管理者才能新增員工、改員工資料,以及授予或收回管理者權限、停用 / 重新啟用員工。',
    );
  });
});

// ── ⟦b4-MGR0-UI⟧ 三個世界(2026-08-31,Sean 逐字「要灰」)──────────────────
//
// 🔴 **這一組真正要釘死的是第三個世界**:`unknown` **不灰**。
//    最容易被寫反的就是它 —— 有人「順手把三態收成布林」時,`unknown` 會掉進 `no` 那一邊,
//    而畫面上看起來完全正常:一顆灰鈕,沒有人分得出它是「你沒權限」還是「我們查不到」。
//    (為什麼不能灰:`isActiveManager` 在 DB 故障時回 false ⇒ 沿用它會讓真管理者以為自己被降權。
//     詳 staff-edit-row.tsx 的 `ManagePermission` docstring。)
//
// 🛑 而 server 那道 `authorizeManagerMutation` 一個字都沒動 ⇒ 安全面不靠這一組。
describe('⟦b4-MGR0-UI⟧ 沒權限的鈕要灰 —— 而【查不到】不算沒權限', () => {
  const submitButtons = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];

  it("canManage='no' ⇒ 表格與新增表單的送出鈕【全部】灰掉", () => {
    const table = render(<StaffTable rows={ROWS} canManage='no' />);
    const tableButtons = submitButtons(table.container);
    expect(tableButtons.length).toBeGreaterThan(0); // 先證明尺撈得到東西
    expect(tableButtons.every((b) => b.disabled)).toBe(true);
    cleanup();

    const form = render(<StaffCreateForm canManage='no' />);
    const formButtons = submitButtons(form.container);
    expect(formButtons.length).toBeGreaterThan(0);
    expect(formButtons.every((b) => b.disabled)).toBe(true);
  });

  it("canManage='yes' ⇒ 只有 break-glass 那顆灰(其餘都能按)", () => {
    const { container } = render(<StaffTable rows={ROWS} canManage='yes' />);
    const disabled = submitButtons(container).filter((b) => b.disabled);
    // sean 那列的「停用員工」是救援帳號保護 ⇒ 它本來就灰,而且與 canManage 無關。
    expect(disabled.length).toBeGreaterThan(0);
    expect(
      disabled.every((b) => b.textContent?.includes('救援帳號不可停用')),
    ).toBe(true);
  });

  it("🔴 canManage='unknown' ⇒ 【不灰】—— 讓他按, 由 server 那道閘擋", () => {
    const { container } = render(<StaffTable rows={ROWS} canManage='unknown' />);
    const disabled = submitButtons(container).filter((b) => b.disabled);
    expect(
      disabled.every((b) => b.textContent?.includes('救援帳號不可停用')),
      'unknown 被當成 no 了 ⇒ DB 打嗝時真管理者會以為自己被降權',
    ).toBe(true);
    cleanup();

    const form = render(<StaffCreateForm canManage='unknown' />);
    const formButtons = submitButtons(form.container);
    expect(formButtons.length).toBeGreaterThan(0);
    expect(
      formButtons.some((b) => b.disabled),
      'unknown 之下新增表單的鈕不該灰',
    ).toBe(false);
  });
});
