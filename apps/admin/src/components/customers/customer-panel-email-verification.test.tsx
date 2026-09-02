// @vitest-environment jsdom
// customer-panel-email-verification.test.tsx — 板 :437 的【接線】守門。
//
// 🔵🔵 **這支檔是 code-reviewer must-fix 1 逼出來的,而它的成因值得寫下來:**
// ```
// 我把那一列做好了、把三態測好了、把渲染測好了 —— 而【面板版沒有把值傳下去】
// ⇒ CustomerDetail 走預設 {kind:'unknown'} ⇒ 每一個客人在訂單面板都印「讀不到」
// ⇒ ⇒ 而那個值其實已經算好了，只是沒有人接
// 🔴 而整組測試對它【完全隱形】——因為【沒有任何一支測試渲染 CustomerPanel】
// ```
// 📌 **⇒ 一個「安全的預設值」會把【沒接線】偽裝成【真的讀不到】,
//    而兩者在畫面上是同一句話 ⇒ 沒有人會發現線斷了。**
// ⇒ 所以這支測的不是「面板長得對」,是**那一個 prop 真的走完了整條路**。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Customer } from '@pcm/domain';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CustomerPanel } from './customer-panel';
import type { CustomerDetailData } from '../../lib/customers/load-customer-detail';
import { EMAIL_VERIFICATION_LABEL } from '../../lib/customers/email-verification';

const CUSTOMER: Customer = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'someone@example.com',
  name: '測試客戶',
  phone: '0912345678',
  birthday: null,
  gender: null,
  tier: 'general',
  walletBalance: 0,
  totalDeposit: 0,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

function data(kind: CustomerDetailData['emailVerification']['kind']): CustomerDetailData {
  return {
    customer: CUSTOMER,
    customerFailed: false,
    walletEntries: [],
    walletLoadFailed: false,
    walletTotal: 0,
    walletPage: 1,
    orders: [],
    ordersLoadFailed: false,
    addresses: [],
    addressesLoadFailed: false,
    vehicles: [],
    vehiclesLoadFailed: false,
    emailVerification: { kind } as CustomerDetailData['emailVerification'],
  };
}

function renderPanel(kind: CustomerDetailData['emailVerification']['kind']) {
  return render(
    <CustomerPanel
      data={data(kind)}
      backHref='/orders?panel=1'
      fullPageHref='/customers/1'
      orderHref={(id: string) => `/orders?panel=${id}`}
    />,
  );
}

afterEach(() => cleanup());

describe('訂單面板的客人卡 · Email 驗證那一列', () => {
  // 🔴 這一格就是 must-fix 1 的守門:斷線 ⇒ 這裡會印 unknown 的那句話 ⇒ 紅。
  it('unverified 的客人,面板要印「尚未驗證」——【不是】「讀不到」', () => {
    const { container } = renderPanel('unverified');
    expect(screen.getByText('尚未驗證')).toBeTruthy();
    expect(container.textContent ?? '').not.toContain(EMAIL_VERIFICATION_LABEL.unknown);
  });

  it('verified 的客人,面板要印「已驗證」', () => {
    expect(renderPanel('verified').container.textContent ?? '').toContain('已驗證');
  });

  // 正對照:面板【真的】畫得出 unknown 那一句 —— 否則上面的 not.toContain 是恆真的。
  it('正對照:真的讀不到時,面板的確印得出那一句', () => {
    expect(renderPanel('unknown').container.textContent ?? '').toContain(
      EMAIL_VERIFICATION_LABEL.unknown,
    );
  });
});
