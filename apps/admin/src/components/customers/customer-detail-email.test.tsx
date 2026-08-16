// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Customer } from '@pcm/domain';

// 🔴 元件的相依鏈裡有 `server-only`(明細頁是 server component)⇒ 不 mock 的話
//    整支檔在 import 階段就炸(症狀是「no tests」,不是某一格紅 —— 那兩者長得很不一樣)。
vi.mock('server-only', () => ({}));

import { CustomerDetail } from './customer-detail';

// customer-detail-email.test.tsx — 客戶【明細頁】的 Email 欄:LINE 合成位址不外顯
// (Sean 2026-08-16 拍板乙)。
//
// 🔴🔴 **這支檔為什麼在 2026-08-16 才補**:
//    那條拍板有**三個顯示點**,而當時只有兩個被守住:
//    ```
//    components/customers/customers-table.tsx:28    ✅ app/customers/page.test.tsx 蓋到
//    components/orders/order-detail.tsx:390         ✅ app/orders/[id]/refund-wiring.test.tsx:569 蓋到
//    components/customers/customer-detail.tsx:162   🔴 零守門 ← 本檔補的就是這個
//    ```
//    ⚠️ **而它是被【一次錯誤的指認】撈出來的**:同儕窗回報「訂單明細那處沒有守門」,
//    量法是 `git grep -l "customerEmailDisplay|LINE_NO_EMAIL_LABEL" -- '*.test.*'` ⇒ 訂單那支沒命中。
//    🔴 **但那支【有】守門** —— 它斷言的是**渲染出來的字面**(`'LINE 帳號登入,無 Email'`),
//    **不是函式名或常數名** ⇒ **掃描字集比宣稱窄**,同一族的錯今晚第二次。
//    ✅ **而順著那個分母查下去,真正沒守門的是【客戶明細頁】** —— 指錯了一格,但撈對了東西。
//
// 🔴 **本檔斷言【渲染結果】而不是「有沒有呼叫 customerEmailDisplay」**:
//    後者釘的是實作(換個等價寫法就紅),前者釘的是**員工眼睛看到什麼** ——
//    而拍板管的是後者。
//
// ⚠️ **本檔守不到的**:只驗這個元件。**若日後有人把 Email 欄整段抽成新元件並漏掉那層轉換,
//    本格會紅**(渲染結果變了)—— 那個紅是**要的**,正確處置是把轉換加回新元件,不是改本格。

const SYNTHETIC = 'line_u5877604cab5e67badac879d777bf702e@line.pcmmotorsports.local';

function customer(email: string): Customer {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email,
    name: '測試客戶',
    phone: '0912345678',
    birthday: null,
    tier: 'general',
    walletBalance: 0,
    totalDeposit: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

/** 明細頁的四個附屬區塊本測試不關心 ⇒ 一律空陣列 + 未失敗。 */
function renderDetail(email: string) {
  return render(
    <CustomerDetail
      customer={customer(email)}
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
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('客戶明細頁 Email 欄:LINE 合成位址不外顯', () => {
  it('🔴 合成位址 → 顯示替代字面,原字串不出現', () => {
    const { container } = renderDetail(SYNTHETIC);
    expect(container.textContent).toContain('LINE 帳號登入,無 Email');
    // 🔴 兩段都要不出現:`line_u` 是內部識別碼、`.local` 是內部網域,
    //    只擋其中一段的話,另一段照樣把內部細節送到客服眼前。
    expect(container.textContent).not.toContain('line_u');
    expect(container.textContent).not.toContain('pcmmotorsports.local');
  });

  it('真 Email 仍原樣顯示(正向對照)', () => {
    // 🔴 沒有這一格,把整個 Email 欄刪掉也會讓上一格「通過」——
    //    那正是「什麼都沒有被讀成檢查過了」。
    const { container } = renderDetail('sean@example.com');
    expect(container.textContent).toContain('sean@example.com');
  });
});
