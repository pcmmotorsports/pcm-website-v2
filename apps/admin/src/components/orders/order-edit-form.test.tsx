// @vitest-environment jsdom
//
// order-edit-form:**開票狀態三態中文只能有一份來源** 的守門(2026-08-21 W9e 建)。
//
// 🔴 **這一檔守得到什麼、守不到什麼(先講,因為它決定你能拿它說什麼)**:
//   ✅ 守得到:①渲染出來的三個 option 與 `INVOICE_STATUS_LABEL` **逐項相同**(值、字面、順序)
//             ②本元件原始碼裡**不再出現**那三個中文字面
//   ❌ 守不到:有人用**別的方式**把中文帶進來 —— 自建一份 const、字串拼接、
//             或 import 另一個 label map。②只認那三個字面本身。
//   ⇒ 它擋的是**最可能發生的那一種**(直接把 `<option>未開立</option>` 寫回去),
//     不是所有可能。**不要把它讀成「這裡不可能再硬寫」。**
//
// 為什麼要兩種斷言、少一種都不夠:
//   · 只有①(渲染)⇒ 有人硬寫**一模一樣的三個字**,渲染結果完全相同 ⇒ **①永遠是綠的**。
//   · 只有②(掃原始碼)⇒ 有人接了共用來源但接錯欄位(例如接成付款狀態那份)⇒ **②看不到**。
//   ⇒ 兩個各自都有一個對方看得見而自己看不見的世界。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminOrderDetail } from '@pcm/domain';
import { INVOICE_STATUS_LABEL } from '../../lib/orders/order-list-view';
import { INVOICE_STATUS_FIELD } from '../../lib/orders/workflow-form';

vi.mock('../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: async () => {},
}));

const { OrderEditForm } = await import('./order-edit-form');

const detail = {
  id: 'ord-1',
  version: 1,
  shippingMethod: 'home',
  invoiceStatus: 'issued',
  invoiceNumber: null,
  invoiceAmount: null,
} as unknown as AdminOrderDetail;

afterEach(cleanup);

describe('開票狀態:三態中文只有一份來源', () => {
  it('🔴 渲染出來的三個 option = INVOICE_STATUS_LABEL 逐項相同(值/字面/順序)', () => {
    const { container } = render(<OrderEditForm detail={detail} returnTo='/orders/ord-1' />);
    const select = container.querySelector(`select[name="${INVOICE_STATUS_FIELD}"]`);
    expect(select, '開票狀態那個 select 不見了 ⇒ 下面的斷言會恆綠').not.toBeNull();

    const rendered = [...(select as HTMLSelectElement).options].map((o) => [o.value, o.textContent]);
    const expected = Object.entries(INVOICE_STATUS_LABEL);
    expect(rendered).toEqual(expected);
  });

  it('🔴 本元件原始碼裡沒有硬寫的三態中文(硬寫回去要當場紅)', () => {
    // 🔴 讀原始碼、不讀渲染結果 —— 因為「硬寫一模一樣的字」在渲染結果上與接了共用來源【完全相同】。
    const src = readFileSync(join(__dirname, 'order-edit-form.tsx'), 'utf8');

    // 只掃 `<option ...>中文</option>` 這個形狀,不掃整支檔 ——
    // 🔴 檔內註解**刻意**提到「未開立」等字面來解釋為什麼不能硬寫;
    //    掃整支檔的話,那段解釋自己會把守門打紅(而那正是本 repo 記過的「偵測字串自命中」)。
    const optionLiterals = [...src.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g)]
      .map((m) => m[1])
      .filter((t): t is string => t !== undefined);

    // 正向對照:量具真的抓到 <option> 了。抓到 0 個時下面那條會恆綠。
    expect(optionLiterals.length, '一個 <option> 字面都沒抓到 ⇒ 這支尺沒在量東西').toBeGreaterThan(0);

    for (const label of Object.values(INVOICE_STATUS_LABEL)) {
      const hit = optionLiterals.find((t) => t.includes(label));
      expect(
        hit,
        `<option> 裡出現硬寫的「${label}」⇒ 三態中文又有第二份副本了。` +
          '接 INVOICE_STATUS_LABEL(照同檔出貨方式那格的 Object.entries 形狀)。',
      ).toBeUndefined();
    }
  });
});
