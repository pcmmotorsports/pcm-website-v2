// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ManualCancelNoticeButton } from './manual-cancel-notice-button';

// manual-cancel-notice-button.test.tsx — ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B 的**顯示層**。
//
// 🔵 code-reviewer 2026-09-06 nit:這支元件原本**零測試**, 而它決定
//    「登錄鈕」與「唯一救援鈕」各自出不出現。
// 🔴 **而它與 `manual-cancel-notice-read.test.ts` 守的不是同一件事**:
//    那支證「函式回什麼」, 本檔證**那顆鈕真的畫得出來 / 真的沒畫**——
//    而這一片最貴的錯就是「該出現的鈕沒出現」(客服照 SOP 找不到它 ⇒ 提醒永遠不歸零)。

// server action 在 jsdom 裡不能真的載入 ⇒ 換成標記字串, 只驗「表單指到哪一支」。
vi.mock('@/lib/orders/manual-cancel-notice-actions', () => ({
  recordManualCancelNoticeAction: 'ACTION_RECORD',
  revokeManualCancelNoticeAction: 'ACTION_REVOKE',
}));

afterEach(cleanup);

const ELIGIBLE = { eligible: true, orderId: 'o-1', displayId: 'PCM-2026-0001', suggestedEmail: 'a@b.co' } as const;

describe('登錄鈕', () => {
  it('🟢 合格 ⇒ 畫出登錄鈕與信箱欄,而信箱**預填**訂單上那個', () => {
    render(<ManualCancelNoticeButton orderId='o-1' eligibility={ELIGIBLE} />);
    expect(screen.getByRole('button', { name: /登錄我已人工寄出取消通知/ })).toBeTruthy();
    expect(screen.getByDisplayValue('a@b.co')).toBeTruthy();
  });

  it('🔴 兩個信箱都空 ⇒ 仍然畫得出來,而多一句叫他自己填', () => {
    render(
      <ManualCancelNoticeButton orderId='o-1' eligibility={{ ...ELIGIBLE, suggestedEmail: null }} />,
    );
    expect(screen.getByRole('button', { name: /登錄我已人工寄出取消通知/ })).toBeTruthy();
    expect(screen.getByText(/這張單上沒有留信箱/)).toBeTruthy();
  });

  // 🔴🔴 這一格守的是「讀不到 ≠ 不需要」——**折成不畫的話, 那張單就沒有人救得了它**。
  it('🔴 unreadable ⇒ 不畫鈕,但要**說出來**(不可以一片空白)', () => {
    render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'unreadable' }}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/暫時讀不到/)).toBeTruthy();
  });

  it('🔵 其餘不合格 ⇒ 什麼都不畫(絕大多數訂單都是這一格)', () => {
    const { container } = render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'not_mixed_rail' }}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('撤銷鈕', () => {
  // 🔴🔴 這一格是**唯一救援**:已登錄 + 那一列是人工的 ⇒ 必須畫得出來。
  it('🟢 already_recorded 且 canRevoke ⇒ 畫出撤銷鈕', () => {
    render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'already_recorded' }}
        canRevoke
      />,
    );
    expect(screen.getByRole('button', { name: /撤銷這筆人工登錄/ })).toBeTruthy();
  });

  // 🔴🔴 **系統寄的那一列不給撤銷鈕** —— 畫了就是一顆按下去必定失敗的鈕。
  it('🔴 already_recorded 而 canRevoke=false(系統寄的)⇒ 不畫', () => {
    const { container } = render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'already_recorded' }}
        canRevoke={false}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('🔴 canRevoke 預設是 false(不給就不畫)', () => {
    const { container } = render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'already_recorded' }}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('🔴 撤銷的說明要講【回到人工提醒】,不可以說系統會再寄', () => {
    const { container } = render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'already_recorded' }}
        canRevoke
      />,
    );
    // 🔵 `getByText` 回的是**最內層**那個節點(這裡是 `<strong>按錯了</strong>`)——
    //    我第一版就抓到它, 斷言拿到的只有「按錯了」三個字。⇒ 改讀整個容器。
    const text = container.textContent ?? '';
    expect(text).toMatch(/重新回到提醒/);
    // 🛑 那句「系統會再寄」是錯的(自動寄的 view 永久排除混合單)⇒ 畫面上不准出現。
    expect(text).not.toMatch(/系統.*再寄/);
  });
});
