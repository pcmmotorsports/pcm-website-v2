// @vitest-environment jsdom
// shipment-void-button.test.tsx — 片14(2026-08-19)新建。
//
// 🔴 **這支元件在此之前零測試**,而它的收合態字面是員工唯一看得到的入口字。
//    量法:`git grep -l 'shipment-void-button' -- apps/admin/src` ⇒ 只有元件本身與兩個渲染點,
//    沒有 `.test.` ⇒ **改它的字面不會有任何東西紅。**
//
// 🔴 **為什麼不掛在 `shipment-section.test.tsx`**:那一檔把本元件整支 `vi.mock` 成佔位
//    (印「作廢 <箱號>」)⇒ 斷言掛在那裡讀到的是佔位,不是真元件。
//    📌 **兩顆鈕都含「作廢」二字 ⇒ 用關鍵字找會找到錯的那一顆,而它會回綠。**
//
// ⚠️ 它擋不住什麼:只驗**收合態的字面與分支**,不驗作廢行為(那要 server action,另一層)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../lib/shipping/shipment-actions', () => ({
  voidShipmentAction: vi.fn(),
  unvoidShipmentAction: vi.fn(),
}));

import { ShipmentVoidButton } from './shipment-void-button';

afterEach(cleanup);

describe('🔴 片14:作廢鈕的收合態字面', () => {
  it('未作廢時寫「作廢這一箱」,不是舊字面「作廢這箱」', () => {
    const { container } = render(
      <ShipmentVoidButton shipmentId='sh-1' shipmentReference='K7X2MP' voided={false} />,
    );
    // 正向錨:鈕真的渲染了。少了它,下面那條否定式在「元件回 null」時會恆綠。
    expect(container.querySelector('button'), '鈕沒渲染 ⇒ 下面兩條會恆綠').not.toBeNull();
    expect(container.textContent).toBe('作廢這一箱');
    // 🔴 `toBe` 而不是 `toContain`:「作廢這箱」是「作廢這一箱」的**子字串**,
    //    用 `not.toContain('作廢這箱')` 會恆綠(新字面裡沒有連續的「作廢這箱」四字,
    //    但下一次有人寫成「作廢這箱子」它也不會紅)。整串相等才釘得住。
  });

  it('已作廢時是另一顆鈕(負向對照:字面不該在這一支分支出現)', () => {
    const { container } = render(
      <ShipmentVoidButton shipmentId='sh-1' shipmentReference='K7X2MP' voided={true} />,
    );
    expect(container.textContent).toBe('復原作廢');
  });
});
