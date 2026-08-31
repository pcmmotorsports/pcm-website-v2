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
import { permissionNotice } from './staff-edit-row';

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

// ── ⛔ 舊的那組三個世界(2026-08-31 上半場)已由上面那組取代 ────────────────
//
// 🔴 **舊版逐字寫著「`unknown` **不灰**:讓他按, 由 server 那道閘擋」** ——
//    那是我的第一版設計, 理由是「灰了他會以為自己被降權」。
// ✅ **而 Sean 2026-08-31 拍甲把它推翻了**:`unknown` **也停用**,
//    差別在【那句話】(「暫時無法確認你的權限」)。
//    ⇒ 📌 我原本的顧慮是對的, 而**解法選錯了** —— 該解的是「他不知道為什麼」,
//      而我解成「那就讓他按」。**一句話比一個可按的鈕便宜。**
//
// 🛑 舊測試已刪(留不得:它與新規格【互相矛盾】, 兩套同時在會有一套恆紅)。
//    而它的職能沒有消失 —— 上面那組用【掃出來的每一個可互動元素】當分母, 涵蓋更寬。

// ── ⟦b4-MGR0-UI⟧ 整組唯讀(Sean 2026-08-31 拍甲;codex R2 那四條是規格)────────
//
// ⛔ **舊的那組(2026-08-31 上半場)已刪** —— 它逐字寫著
//    「`unknown` **不灰**:讓他按, 由 server 那道閘擋」, 那是我的第一版設計。
// ✅ Sean 拍甲把它推翻:`unknown` **也停用**, 差別在【那句話】。
//    📌 我原本的顧慮(灰了他會以為被降權)是對的, 而**解法選錯了** ——
//       該解的是「他不知道為什麼」, 而我解成「那就讓他按」。**一句話比一個可按的鈕便宜。**
//    🛑 舊測試留不得:它與新規格【互相矛盾】, 兩套同時在會有一套恆紅。
//
// 🔴 **分母刻意是【畫面上所有可互動元素】, 不是一份清單。**
//    codex R2 逐字:「`no` 世界只灰送出鈕, 顯示名、管理者勾選框與新增欄位仍可編輯」
//    ⇒ 若寫成「檢查這 5 個」, 有人加第 6 個輸入框時它照樣綠。
//    ⇒ 改成「**掃出來的每一個**都要 disabled」—— 新元素一出生就在射程裡。
// 🛑 `type='hidden'` 排除:它們載的是 id, 停用它們會讓表單送不出正確的值。
const interactive = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    'input:not([type="hidden"]), button, select, textarea',
  ),
];

describe('⟦b4-MGR0-UI⟧ no / unknown ⇒ 整組唯讀 + 一句話', () => {
  it.each([['no' as const], ['unknown' as const]])(
    'canManage=%s ⇒ 表格裡每一個可互動元素都停用',
    (mode) => {
    const { container } = render(<StaffTable rows={ROWS} canManage={mode} />);
    const els = interactive(container);
    expect(els.length, '掃到 0 個可互動元素 ⇒ 這把尺沒接上, 不是通過').toBeGreaterThan(0);
    expect(
      els.filter((el) => !el.disabled).map((el) => el.getAttribute('name') ?? el.textContent),
      `這些元素在 ${mode} 之下還可以動 ⇒ 沒權限的人可以把表填完才發現存不了`,
    ).toEqual([]);
    // 🔴 codex R3 must-fix:那句話【不由元件印】—— 放進列元件會變成 N 位員工 N 段紅字。
    // ⚠️ codex R4 nit:第一版硬編舊片語 ⇒ 文案改字之後這裡會【假綠】
    //    (提示被搬回列元件而字變了 ⇒ 舊片語抓不到)。
    // ⇒ 改成拿 `permissionNotice()` 的【實際輸出】比 —— 文案改字它跟著改。
    expect(container.textContent).not.toContain(permissionNotice(mode));
    expect(container.querySelectorAll('[role="status"]').length).toBe(0);
    },
  );

  it.each([['no' as const], ['unknown' as const]])(
    'canManage=%s ⇒ 新增表單同樣整組停用',
    (mode) => {
    const { container } = render(<StaffCreateForm canManage={mode} />);
    const els = interactive(container);
    expect(els.length, '掃到 0 個可互動元素 ⇒ 這把尺沒接上').toBeGreaterThan(0);
    expect(
      els.filter((el) => !el.disabled).map((el) => el.getAttribute('name') ?? el.textContent),
      `這些元素在 ${mode} 之下還可以動`,
    ).toEqual([]);
    expect(container.textContent).not.toContain(permissionNotice(mode));
    expect(container.querySelectorAll('[role="status"]').length).toBe(0);
    },
  );

  it('🔴 那兩句話【不一樣】—— 合併成一句, 使用者分不出「我沒權限」與「系統查不到」', () => {
    // 文案由頁面印, 而【那兩句必須不同】這件事在這裡釘 —— 它是純函式, 不必渲染。
    expect(permissionNotice('no')).not.toBe(permissionNotice('unknown'));
    expect(permissionNotice('no')).toContain('你沒有權限');
    expect(permissionNotice('unknown')).toContain('暫時無法確認');
    expect(permissionNotice('yes')).toBeNull();
  });

  it("canManage='yes' ⇒ 除了救援帳號那顆, 其餘都能動, 而且【不顯示】那兩句話", () => {
    const table = render(<StaffTable rows={ROWS} canManage='yes' />);
    const els = interactive(table.container);
    expect(els.length).toBeGreaterThan(0);
    const disabled = els.filter((el) => el.disabled);
    expect(disabled.length).toBeGreaterThan(0); // 救援帳號那顆本來就灰
    expect(
      disabled.every((el) => el.textContent?.includes('救援帳號不可停用')),
      "canManage='yes' 之下有非救援元素被停用",
    ).toBe(true);
  });
});
