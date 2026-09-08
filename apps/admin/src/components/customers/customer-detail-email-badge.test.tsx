// @vitest-environment jsdom
// customer-detail-email-badge.test.tsx — 最上面那一列 Email 旁邊那個短標的守門。
//
// 🔴🔴 **起因是 Sean 2026-09-09 做的一件事,而它不是誤操作**:
//    他在**最上面**那個 Email 問「這個客人的信箱能不能改」,而答案住在**整頁最底下**,
//    中間隔著姓名/電話/生日表單 → 儲存鈕 → 會員等級 → 變更等級鈕。⇒ 他捲下去了,
//    然後回報「沒出現」—— 而那被讀成「功能沒做」讀了兩個晚上。
//    ⇒ Sean 拍甲:短標搬到他問問題的那一列旁邊。
//
// 🔴 **本檔測的是【員工眼睛看到什麼】, 不是判讀** —— 判讀那一支是
//    `email-change-state` 自己的測試;中間隔著一個 prop 與一次字串拼接,
//    而 **prop 接錯不會讓判讀那支紅**(家法逐字取自
//    `customer-detail-email-verification.test.tsx` 檔頭)。
//
// 🔴🔴 **三個世界是量出來的分母, 不是我挑的**(正式庫唯讀實測 2026-09-09, 15 個客人):
//    `line 6 / email 4 / google 4 / manual 1` ⇒ **11 個是改不了的**。
//    ⇒ 主視窗原本只列了「密碼 / Google」兩個世界, **而 LINE 那 6 個是最大的一群**。
//    ⚠️ 那四個數是**那一刻**的;客人會長, 而本檔的三個世界不因此失效。
//
// 🛑 **本檔驗不到什麼**:
//    · 不驗那個短標**排版上真的在同一列**(那要真瀏覽器 —— 同片另一支
//      `customer-submit-buttons-fit-browser.test.tsx` 才做得到那種事)。
//    · 不驗資格閘判得對不對 —— 那是 `emailChangeEligibility` 自己的事,
//      本檔只證「畫面印的就是它回的那個 badge」。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Customer } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { CustomerDetail } from './customer-detail';
import { emailChangeEligibility } from '../../lib/customers/email-change-state';
import type { EmailVerification } from '../../lib/customers/email-verification';

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

function renderDetail(
  emailVerification?: EmailVerification,
  emailAuthProviders?: readonly string[] | null,
) {
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
      emailAuthProviders={emailAuthProviders}
    />,
  );
}

afterEach(() => cleanup());

describe('最上面那一列 Email 旁邊的短標', () => {
  it('分母:短標真的被畫出來了(找不到 ⇒ 下面每一格都是恆真)', () => {
    renderDetail({ kind: 'verified' }, ['email']);
    expect(screen.getByText(/〔.+〕/)).toBeTruthy();
  });

  // ── 三個世界, 各印不同的東西 ────────────────────────────────────────
  it('世界一 · 信箱密碼註冊(15 人裡的 4 個)⇒ 可以改', () => {
    renderDetail({ kind: 'verified' }, ['email']);
    expect(screen.getByText('〔可以改 ↓〕')).toBeTruthy();
  });

  it('世界二 · Google 登入(15 人裡的 4 個)⇒ 印出 provider 的名字, 不能改', () => {
    renderDetail({ kind: 'verified' }, ['google']);
    expect(screen.getByText('〔google 登入 · 不能改〕')).toBeTruthy();
  });

  it('世界三 · LINE(15 人裡的 6 個, 最大的一群)⇒ 不能改', () => {
    renderDetail({ kind: 'line' }, null);
    expect(screen.getByText('〔LINE 登入 · 不能改〕')).toBeTruthy();
  });

  // 🔴 **這一格與上面三格【刻意分開】** —— 「先不改」不是「不能改」:
  //    原文逐字「這不代表不能改」⇒ 共用同一個詞就是把三態塌成兩態。
  it('讀不到的時候印的是【先不改】不是【不能改】(三態不得塌成兩態)', () => {
    renderDetail(undefined, null);
    expect(screen.getByText('〔讀不到 · 先不改〕')).toBeTruthy();
    expect(screen.queryByText('〔讀不到 · 不能改〕')).toBeNull();
  });

  // 🔴🔴 **這一格才是本檔最承重的**:上面那個短標與下面那一區
  //    **必須是同一支函式回的同一個值** —— 兩邊各判一次的話它們有機會各說各話,
  //    而 diff 上看不出來(今晚同族:兩把尺在錯的軸上一致)。
  it('短標與資格閘是同一個來源(畫面上那串 = 函式回的 badge)', () => {
    const worlds: { v?: EmailVerification; p: readonly string[] | null }[] = [
      { v: { kind: 'verified' }, p: ['email'] },
      { v: { kind: 'verified' }, p: ['google'] },
      { v: { kind: 'line' }, p: null },
      { v: undefined, p: null },
    ];
    for (const w of worlds) {
      cleanup();
      renderDetail(w.v, w.p);
      const expected = emailChangeEligibility((w.v ?? { kind: 'unknown' }).kind, w.p).badge;
      expect(screen.getByText(`〔${expected}〕`), `這個世界對不上:${expected}`).toBeTruthy();
    }
  });
});
