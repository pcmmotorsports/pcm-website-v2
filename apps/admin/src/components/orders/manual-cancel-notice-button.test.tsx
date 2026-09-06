// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ManualCancelNoticeButton, PhoneNotifiedButton } from './manual-cancel-notice-button';

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
  markPhoneNotifiedAction: 'ACTION_PHONE',
}));

afterEach(cleanup);

const ELIGIBLE = {
  eligible: true,
  orderId: 'o-1',
  displayId: 'PCM-2026-0001',
  suggestedEmail: 'a@b.co',
  // 🔵 `false` = 「我真的讀到了」。讀失敗那一格另外造。
  customerEmailReadFailed: false,
} as const;

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

describe('已電話通知(⟦mail-PHONEONLYNOTIFY⟧)', () => {
  /**
   * 🔴🔴 **標記過就把鈕換成一行事實** —— 那種單**不會出現在通知信那一區**
   * (它根本沒有 outbox 列)⇒ 這一行是客服**唯一看得到的痕跡**。
   */
  it('🟢 已標記 ⇒ 畫出「已電話通知 · 誰 · 何時」', () => {
    render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={ELIGIBLE}
        phoneNotified={{ actor: 'staff-1', at: '2026-09-06T02:00:00Z' }}
      />,
    );
    expect(screen.getByText(/已電話通知/)).toBeTruthy();
    expect(screen.getByText(/staff-1/)).toBeTruthy();
  });

  /**
   * 🔴🔴 **已標記那一行【不可以】把別的鈕吃掉**(code-reviewer important ⑤)。
   * ⛔ 我第一版直接 `return` 那一行 ⇒ 標記之後**登錄鈕沒了、撤銷鈕也沒了**,
   *    而四處字面都寫著「按錯的後果**只是那張單不再被提醒**」
   *    ⇒ 📌 **那句話比實際行為窄** —— 它同時永久收掉了那張單的兩個入口。
   * ⇒ 這一格釘住:那一行**與**撤銷鈕可以同時在。
   */
  it('🔴 已標記【而且】有得撤 ⇒ 兩個都要在(那一行不吃掉撤銷鈕)', () => {
    render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ eligible: false, blocker: 'already_recorded' }}
        canRevoke
        phoneNotified={{ actor: 'staff-1', at: '2026-09-06T02:00:00Z' }}
      />,
    );
    expect(screen.getByText(/已電話通知/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /撤銷這筆人工登錄/ })).toBeTruthy();
  });

  it('🔴 已標記【而且】仍然合格 ⇒ 那一行與登錄鈕同時在', () => {
    render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={ELIGIBLE}
        phoneNotified={{ actor: 'staff-1', at: '2026-09-06T02:00:00Z' }}
      />,
    );
    expect(screen.getByText(/已電話通知/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /登錄我已人工寄出取消通知/ })).toBeTruthy();
  });

  /**
   * 🔴 **這一格守的是「不要重蹈撤銷鈕那次的覆轍」**:
   * 標記過的單資格會回**各種** blocker, 若把那一行綁在某一個 blocker 上
   * ⇒ 資格一漂那一行就消失(codex 對撤銷鈕的 must-fix ② 就是這個形狀)。
   */
  it('🔴 已標記 ⇒ 不管資格是哪一種 blocker,那一行都要在', () => {
    for (const blocker of ['not_mixed_rail', 'not_card_refunded', 'unreadable'] as const) {
      cleanup();
      render(
        <ManualCancelNoticeButton
          orderId='o-1'
          eligibility={{ eligible: false, blocker }}
          phoneNotified={{ actor: 'staff-1', at: '2026-09-06T02:00:00Z' }}
        />,
      );
      expect(screen.getByText(/已電話通知/), `blocker=${blocker} 時那一行不見了`).toBeTruthy();
    }
  });

  it('🔵 沒標記 ⇒ 照常畫登錄鈕', () => {
    render(<ManualCancelNoticeButton orderId='o-1' eligibility={ELIGIBLE} phoneNotified={null} />);
    expect(screen.getByRole('button', { name: /登錄我已人工寄出取消通知/ })).toBeTruthy();
  });

  it('🟢 電話通知鈕:show=true ⇒ 畫得出來', () => {
    render(<PhoneNotifiedButton orderId='o-1' show />);
    expect(screen.getByRole('button', { name: /我是用電話通知的/ })).toBeTruthy();
  });

  // 🔴 有信箱的單**不該**給這顆 —— 給了會讓紀錄變糊(該走寄信那條路)。
  it('🔴 show=false ⇒ 什麼都不畫', () => {
    const { container } = render(<PhoneNotifiedButton orderId='o-1' show={false} />);
    expect(container.textContent).toBe('');
  });

  it('🔴 沒信箱時,登錄表單要提示【打電話的別填這裡】', () => {
    const { container } = render(
      <ManualCancelNoticeButton orderId='o-1' eligibility={{ ...ELIGIBLE, suggestedEmail: null }} />,
    );
    expect(container.textContent ?? '').toMatch(/打電話通知的/);
  });
});

/**
 * 🔴🔴 code-reviewer 2026-09-06 **important ④**:`suggestedEmail === null` 背了兩個意思 ——
 * 「真的沒有信箱」與「讀 `customers` 失敗」。而「已電話通知」那顆鈕**不可撤銷**
 * ⇒ 🛑 一次瞬時讀取失敗就讓它出現在**有信箱**的單上, 而按下去那張單**永久離開提醒**。
 */
describe('讀失敗 ≠ 沒有信箱', () => {
  it('🔴 讀失敗 ⇒ 電話鈕【不出現】,而且要說出來(不可以一片空白)', () => {
    render(<PhoneNotifiedButton orderId='o-1' show={false} emailReadFailed />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/暫時讀不到/)).toBeTruthy();
    // 🔵 那句話要說「不是這張單不需要」—— 否則客服會以為它處理完了。
    expect(screen.getByText(/不是這張單不需要/)).toBeTruthy();
  });

  it('🟢 正對照:沒讀失敗而 show=true ⇒ 照常出鈕(證明上面那格不是恆不出)', () => {
    render(<PhoneNotifiedButton orderId='o-1' show emailReadFailed={false} />);
    expect(screen.getByRole('button', { name: /我是用電話通知的/ })).toBeTruthy();
  });

  it('🔵 讀失敗時【登錄鈕照舊出現】—— 它的行為沒變,只是少了預填', () => {
    render(
      <ManualCancelNoticeButton
        orderId='o-1'
        eligibility={{ ...ELIGIBLE, suggestedEmail: null, customerEmailReadFailed: true }}
      />,
    );
    expect(screen.getByRole('button', { name: /登錄我已人工寄出取消通知/ })).toBeTruthy();
  });
});
