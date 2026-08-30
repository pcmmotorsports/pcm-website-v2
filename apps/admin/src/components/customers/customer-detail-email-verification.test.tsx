// @vitest-environment jsdom
// customer-detail-email-verification.test.tsx — 板 :437 那一列的【渲染】守門。
//
// 🔴 **這支與 `email-verification.test.ts` 不是重複** —— 那支測【判讀】,這支測
//    【員工眼睛看到什麼】。中間隔著一個 prop,而 prop 接錯不會讓判讀那支紅。
//
// 🔴🔴 **本檔存在的第一理由是主視窗點名的那一發**:
//    「讀不到」那一態要配一發突變 —— **auth 讀失敗 ⇒ 畫面必須印「讀不到」而不是印「未驗證」**。
//    **沒有那一發,三態在碼上存在而在行為上塌成兩態。**
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Customer } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { CustomerDetail } from './customer-detail';
import {
  EMAIL_VERIFICATION_LABEL,
  type EmailVerification,
} from '../../lib/customers/email-verification';

const CUSTOMER: Customer = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'someone@example.com',
  name: '測試客戶',
  phone: '0912345678',
  birthday: null,
  tier: 'general',
  walletBalance: 0,
  totalDeposit: 0,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

function renderDetail(emailVerification?: EmailVerification) {
  return render(
    <CustomerDetail
      customer={CUSTOMER}
      walletEntries={[]}
      walletLoadFailed={false}
      walletTotal={0}
      walletPage={1}
      orders={[]}
      ordersLoadFailed={false}
      addresses={[]}
      addressesLoadFailed={false}
      vehicles={[]}
      vehiclesLoadFailed={false}
      orderHref={(id: string) => `/orders/${id}`}
      emailVerification={emailVerification}
    />,
  );
}

afterEach(() => cleanup());

describe('客人明細 · Email 驗證那一列', () => {
  it('欄位標題在(這一列真的被畫出來了)', () => {
    renderDetail({ kind: 'verified' });
    expect(screen.getByText('Email 驗證')).toBeTruthy();
  });

  it.each([
    ['verified', '已驗證'],
    ['unverified', '尚未驗證'],
    ['line', 'LINE 登入(不需驗證)'],
    ['manual', '後台建立(佔位信箱)'],
    ['synthetic', '系統產生的位址(寄不到客人手上)'],
  ] as const)('%s ⇒ 畫面印「%s」', (kind, text) => {
    renderDetail({ kind } as EmailVerification);
    expect(screen.getByText(text)).toBeTruthy();
  });

  // 🔴🔴 主視窗點名的那一發。
  it('讀不到 ⇒ 畫面印「讀不到」,而【整頁一個「未驗證」都不准出現】', () => {
    const { container } = renderDetail({ kind: 'unknown' });
    // 🔵 **codex must-fix(2026-08-30):不能只讀 `EMAIL_VERIFICATION_LABEL.unknown`。**
    //    ~~原版只斷言「畫面上有那個常數的值」~~ ⇒ 把文案改成「系統正常」也照樣綠
    //    (測試與 UI **共讀同一個常數** ⇒ 兩邊一起變,而斷言不知道)。
    //    ⇒ 加一發**字面**斷言:那一句必須真的含「讀不到」三個字。
    expect(EMAIL_VERIFICATION_LABEL.unknown).toContain('讀不到');
    expect(container.textContent ?? '').toContain('讀不到');
    expect(screen.getByText(EMAIL_VERIFICATION_LABEL.unknown)).toBeTruthy();
    // 負對照式:整個 DOM 的文字裡不得含「未驗證」——
    // 那是客服會照著唸給客人聽的三個字,而它在這一態是錯的。
    expect(container.textContent ?? '').not.toContain('未驗證');
  });

  // 🔴 **沒傳這個 prop 時的預設,是本片最容易寫錯的一格**:
  //    預設成「已驗證」是最自然的寫法(空 = 沒問題),而它會**對每一個沒接線的頁面說謊**。
  it('沒傳 prop ⇒ 也是「讀不到」,不是「已驗證」', () => {
    const { container } = renderDetail(undefined);
    expect(screen.getByText(EMAIL_VERIFICATION_LABEL.unknown)).toBeTruthy();
    expect(container.textContent ?? '').not.toContain('已驗證');
  });

  // 🔴 正對照:證明上面那兩個 not.toContain 是活的 —— 一個永遠印空字串的元件會讓它們全綠。
  it('正對照:verified 那一態,整頁【的確】找得到「已驗證」', () => {
    const { container } = renderDetail({ kind: 'verified' });
    expect(container.textContent ?? '').toContain('已驗證');
  });
});
