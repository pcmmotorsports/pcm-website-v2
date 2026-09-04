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
  // 🔴 2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 2 步:本 fixture 用 `as unknown as` 繞過型別
  //    ⇒ 少一欄不會被 typecheck 抓到, 而**少了它整組會走進「此單不開發票」那一枝**
  //    ⇒ 上面那幾格測的是【正常那一格】, 所以這裡必須明寫 `true`。
  //    📌 **而那正是 `as unknown as` 的代價** —— 它把「這個型別要什麼」這件事變成人要記得的。
  invoiceRequested: true,
} as unknown as AdminOrderDetail;

/** 決定【不開發票】的那張單。 */
const notRequested = { ...detail, invoiceRequested: false } as unknown as AdminOrderDetail;

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

describe('🔴🔴 決定不開發票的單:那三格不出現(⟦b4-INVOICE5PCT⟧ 第 2 步)', () => {
  // 🎯 這一組不是 UX —— 它是那道 DB 鎖的【另一半】。
  //    鎖擋得住錯的資料, **而擋不住員工在財政部平台按下去那個動作** ——
  //    而讓他按下去的正是「開立狀態:未開立」這句話(它與真的在等開票的單逐字相同)。
  it('🔴 false ⇒ 開立狀態 / 發票號碼 / 發票金額 三個 input 都不在', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    for (const name of [INVOICE_STATUS_FIELD, 'invoice_number', 'invoice_amount']) {
      expect(container.querySelector(`[name="${name}"]`), `${name} 不該被渲染`).toBeNull();
    }
  });

  it('🔴 而它要【說出為什麼】—— 一格空白與「這張單不開發票」是兩件事', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    expect(container.textContent).toContain('此單不開發票');
    expect(container.textContent).toContain('作廢重開');
  });

  it('🔴 而它【不得】出現「未開立」—— 那正是會讓員工去開一張真發票的那句話', () => {
    const { container } = render(<OrderEditForm detail={notRequested} returnTo='/x' />);
    expect(container.textContent).not.toContain('未開立');
  });

  it('🟢 正對照:true 的單那三格【原樣都在】—— 否則上面三格只證明它什麼都不渲染', () => {
    const { container } = render(<OrderEditForm detail={detail} returnTo='/x' />);
    for (const name of [INVOICE_STATUS_FIELD, 'invoice_number', 'invoice_amount']) {
      expect(container.querySelector(`[name="${name}"]`), `${name} 應該在`).not.toBeNull();
    }
  });
});
