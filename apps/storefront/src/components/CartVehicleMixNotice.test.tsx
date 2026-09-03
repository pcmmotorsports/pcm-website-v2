// @vitest-environment jsdom
//
// CartVehicleMixNotice smoke test —— 兩個世界各問一次。
// 🛑 本檔釘住的字面是**暫定版**(文案待 Sean 拍板, 見元件檔頭)⇒ 改字面時這裡要跟著改,
//    否則這道守門會退化成「有東西就算過」。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CartVehicleMixNotice, type CartMixLine } from './CartVehicleMixNotice';

const r6 = { kind: 'dict', brand: 'Yamaha', model: 'YZF-R6', source: 'picker' } as const;
const duc = { kind: 'dict', brand: 'Ducati', model: 'Panigale V4', source: 'picker' } as const;
const L = (vehicle?: CartMixLine['item']['vehicle'], fitments?: CartMixLine['resolved']['fitments']): CartMixLine =>
  ({ item: { vehicle }, resolved: { fitments } });

afterEach(cleanup);

describe('CartVehicleMixNotice', () => {
  it('🔵 shouldNotice=false ⇒ 什麼都不畫(不是畫一個空殼)', () => {
    const { container } = render(<CartVehicleMixNotice lines={[L(), L()]} />);
    expect(container.innerHTML).toBe('');
  });

  it('🔴 負對照:有 labels 而 shouldNotice=false ⇒ 仍然不畫', () => {
    // 🎯 這一格擋的是「改成看 labels.length 就畫」—— 那會讓抑制條件(已有紅膠囊)失效,
    //    而那個失效在畫面上長得像「橫幅正常運作」。
    // 兩台車 + 其中一列已亮紅膠囊(fitments 列不到它)⇒ 抑制生效 ⇒ 不畫
    const { container } = render(
      <CartVehicleMixNotice lines={[L(r6, [{ motoBrand: 'Ducati', modelCode: 'Panigale V4' }]), L(duc)]} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('🟢 shouldNotice=true ⇒ 畫出台數 + 逐台車名 + 提示句', () => {
    render(<CartVehicleMixNotice lines={[L(r6), L(duc)]} />);
    expect(screen.getByText('這車裡有 2 台車的東西')).toBeDefined();
    expect(screen.getByText('Yamaha YZF-R6 · Ducati Panigale V4')).toBeDefined();
    expect(screen.getByText(/往下逐件看/)).toBeDefined();
    // 🔴 role=status:讓報讀器唸得到(它是新出現的內容, 不是頁面本來就在的字)
    expect(document.querySelector('.cart-mix-notice[role="status"]')).not.toBeNull();
  });

  it('🛑 不是紅色警告 —— 不得掛上隔壁那道紅膠囊的 class', () => {
    // 客人很可能沒做錯任何事(他就是有兩台車)⇒ 分寸與 .cvf-mismatch 刻意不同。
    render(<CartVehicleMixNotice lines={[L(r6), L(duc)]} />);
    expect(document.querySelector('.cvf-mismatch')).toBeNull();
    // 🟢 正對照:本橫幅自己的 class 在(否則上一行對「什麼都沒畫」也會過)
    expect(document.querySelector('.cart-mix-notice')).not.toBeNull();
  });
});
