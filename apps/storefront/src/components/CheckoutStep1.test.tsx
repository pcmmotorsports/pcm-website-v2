// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerAddress } from '@pcm/domain';
import { CheckoutStep1 } from './CheckoutStep1';

// 2026-08-08 結帳頁就地改地址:`CheckoutStep1` 從此 import 三個 server action。
// 在 client 元件 import server action 是站上既有 pattern(`AddressTab` 同樣做),但 vitest 不走
// Next 的轉換、會直接載入 server 模組並撞 `server-only` ⇒ 照 `AddressTab.test` 的既有慣例 mock 掉。
// `CheckoutStep1` 自 2026-08-08 起用 `useRouter().refresh()` 重讀地址清單(收尾由本層做,
// 見 InlineAddressForm 的 onSaved 註解)⇒ jsdom 無 app router,照站上慣例 mock。
const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
}));

const { mockAddAddress, mockUpdateAddress, mockDeleteAddress } = vi.hoisted(() => ({
  mockAddAddress: vi.fn(),
  mockUpdateAddress: vi.fn(),
  mockDeleteAddress: vi.fn(),
}));
vi.mock('@/app/account/address/actions', () => ({
  addAddressAction: mockAddAddress,
  updateAddressAction: mockUpdateAddress,
  deleteAddressAction: mockDeleteAddress,
}));


afterEach(cleanup);

const ADDR = {
  id: '00000000-0000-4000-8000-000000000001',
  isDefault: true,
  name: '測試會員',
  phone: '0900000000',
  line: '測試市測試路 1 號',
} as unknown as CustomerAddress;

function renderStep1(
  notificationEmailEnabled: boolean,
  opts: {
    balancePaymentCheckout?: boolean;
    shipping?: number;
    addresses?: CustomerAddress[];
    shippingAddrId?: string;
  } = {},
) {
  const onNotificationEmailChange = vi.fn();
  const onNext = vi.fn();
  const onBack = vi.fn();
  const onShippingAddressChange = vi.fn();

  render(
    <CheckoutStep1
      addresses={opts.addresses ?? [ADDR]}
      shippingAddrId={opts.shippingAddrId ?? ADDR.id}
      onShippingAddressChange={onShippingAddressChange}
      shipping={opts.shipping ?? 0}
      balancePaymentCheckout={opts.balancePaymentCheckout ?? false}
      notificationEmailEnabled={notificationEmailEnabled}
      notificationEmail="Member@EXAMPLE.COM"
      notificationEmailError={null}
      onNotificationEmailChange={onNotificationEmailChange}
      onBack={onBack}
      onNext={onNext}
      nextDisabled={false}
    />,
  );

  return { onNotificationEmailChange, onNext, onBack, onShippingAddressChange };
}

describe('CheckoutStep1', () => {
  it('一般結帳:配送區顯宅配 + 滿額免運提示', () => {
    renderStep1(false);
    expect(screen.getByText('貨運宅配')).toBeTruthy();
    expect(screen.getByText(/滿 NT\$ 5,000 免運/)).toBeTruthy();
    expect(screen.queryByText('補款專用')).toBeNull();
  });

  it('補差額結帳:配送區顯「補款專用・免運」、不顯宅配滿額提示', () => {
    renderStep1(false, { balancePaymentCheckout: true });
    expect(screen.getByText('補款專用')).toBeTruthy();
    expect(screen.getByText('免運')).toBeTruthy();
    expect(screen.getByText(/補差額 \/ 運費差額付款專用,免運費/)).toBeTruthy();
    expect(screen.queryByText('貨運宅配')).toBeNull();
    expect(screen.queryByText(/滿 NT\$ 5,000 免運/)).toBeNull();
  });

  it('flag off 時完全不顯示 Email 欄與揭露文案', () => {
    renderStep1(false);
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByText('此信箱也可能用於信用卡付款驗證')).toBeNull();
  });

  it('flag on 時顯示預填 Email、揭露文案，並回傳使用者輸入', () => {
    const { onNotificationEmailChange } = renderStep1(true);
    const input = screen.getByLabelText('Email') as HTMLInputElement;

    expect(input.value).toBe('Member@EXAMPLE.COM');
    expect(screen.getByText('此信箱也可能用於信用卡付款驗證')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'new@example.com' } });
    expect(onNotificationEmailChange).toHaveBeenCalledWith('new@example.com');
  });

  it('沿用地址、配送與上下步驟操作', () => {
    const { onNext, onBack } = renderStep1(false);
    expect(screen.getByText('測試會員')).toBeTruthy();
    expect(screen.getByText('貨運宅配')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /返回購物車/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  // ── 2026-08-08 結帳頁就地改地址(Sean 第二件交辦:不把客人帶離購物車)────────────────
  describe('就地新增 / 修改 / 刪除', () => {
    beforeEach(() => {
      // jsdom 的 confirm 未實作、預設 falsy ⇒ 刪除會直接早退。照 AddressTab.test 的既有慣例放行。
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockDeleteAddress.mockReset();
      mockAddAddress.mockReset();
      mockUpdateAddress.mockReset();
      mockRefresh.mockReset();
    });

    const ADDR2 = { ...ADDR, id: 'addr-2', name: '第二人', isDefault: false } as CustomerAddress;

    // 突變:把「＋ 新增收件人地址」改回 <Link href="/account"> ⇒ 只紅這條
    it('🔴 底部入口是就地開表單的按鈕,不是連去會員中心的連結', () => {
      renderStep1(false);
      const add = screen.getByText('＋ 新增收件人地址');
      expect(add.tagName, '必須是 <button>(<a> = 會把客人帶離結帳)').toBe('BUTTON');
      expect(add.closest('a'), '不得包在連結裡').toBeNull();
      // 舊字面不得殘留
      expect(screen.queryByText('＋ 到會員中心新增 / 管理收件地址')).toBeNull();
    });

    // 🔴 主視窗裁定「新增後自動選中」——我實作了卻**忘了寫這條**,突變 C6 零判別力才發現。
    // 突變:拿掉 handleSaved 裡的 `if (result.id) onShippingAddressChange(result.id)` ⇒ 只紅這條
    it('🔴 新增成功 → 自動選中剛新增的那張(action 回傳的 id)', async () => {
      mockAddAddress.mockResolvedValue({ ok: true, id: 'addr-new' });
      const { onShippingAddressChange } = renderStep1(false);
      fireEvent.click(screen.getByText('＋ 新增收件人地址'));
      fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王小明' } });
      fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '0912345678' } });
      fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), {
        target: { value: '台北市信義區信義路五段7號' },
      });
      fireEvent.click(screen.getByText('儲存'));
      await waitFor(() => expect(onShippingAddressChange).toHaveBeenCalledWith('addr-new'));
    });

    // 編輯不回 id ⇒ 選取不得被動(反向守門)
    it('編輯成功 → 選取不變(update 不回 id)', async () => {
      mockUpdateAddress.mockResolvedValue({ ok: true });
      const { onShippingAddressChange } = renderStep1(false);
      fireEvent.click(document.querySelector('.co-addr-actions button')!);
      fireEvent.click(screen.getByText('儲存'));
      await waitFor(() => expect(mockUpdateAddress).toHaveBeenCalled());
      expect(onShippingAddressChange).not.toHaveBeenCalled();
    });

    it('點「＋ 新增收件人地址」→ 就地展開表單(頁面上出現新增地址表單)', () => {
      renderStep1(false);
      expect(document.querySelector('.co-addr-form')).toBeNull();
      fireEvent.click(screen.getByText('＋ 新增收件人地址'));
      expect(document.querySelector('.co-addr-form')).not.toBeNull();
      expect(screen.getByText('新增地址')).toBeTruthy();
    });

    // ⚠️ **誠實降級**:兩顆鈕在 `<label>` 內,真瀏覽器不 `preventDefault` 會連帶把那張地址選起來,
    //    但 **jsdom 不模擬 label activation** ⇒ 拿掉 `preventDefault` 這條**照樣綠**
    //    (突變 C2 實測零判別力)。⇒ 本條實際守到的只有「點修改會開該筆的編輯表單」;
    //    「不連帶選中」那半**沒有自動守門、要真瀏覽器**,已在 STOP 申報、不假裝守住了。
    it('點「修改」→ 開該筆編輯表單(⚠️「不連帶選中」那半 jsdom 測不到)', () => {
      const { onShippingAddressChange } = renderStep1(false, {
        addresses: [ADDR, ADDR2],
        shippingAddrId: ADDR.id,
      });
      const cards = document.querySelectorAll('.co-addr');
      const editBtn = cards[1]!.querySelector('.co-addr-actions button')!;
      fireEvent.click(editBtn);
      expect(screen.getByText('編輯地址')).toBeTruthy();
      // 這行留著當回歸偵測(真瀏覽器行為由人驗);它在 jsdom 下對 preventDefault 沒有判別力
      expect(onShippingAddressChange).not.toHaveBeenCalled();
    });

    // 🔴 結帳頁**獨有**的邊界:會員中心沒有「當前選中」的概念。
    // 突變:拿掉 handleDelete 裡的 `if (id === shippingAddrId)` 那段 ⇒ 只紅這兩條
    // 🔴 fixture 要讓「預設那張」**不是**剩下的第一張,否則「看不看 isDefault」分不出來
    //    ——第一版就是這個形狀:刪完只剩一張,兩種寫法都取到它 ⇒ 突變 C4 零判別力(當場抓到)。
    it('🔴 刪掉當前選中的地址 → 落回其餘地址的**預設**那張(不是剩下的第一張)', async () => {
      mockDeleteAddress.mockResolvedValue({ ok: true });
      const PLAIN2 = { ...ADDR2, id: 'addr-2', isDefault: false } as CustomerAddress;
      const DEFAULT3 = { ...ADDR2, id: 'addr-3', isDefault: true } as CustomerAddress;
      const { onShippingAddressChange } = renderStep1(false, {
        // 刪掉第一張之後 rest = [PLAIN2, DEFAULT3] ⇒ 取第一張會拿到 PLAIN2、取預設才是 DEFAULT3
        addresses: [ADDR, PLAIN2, DEFAULT3],
        shippingAddrId: ADDR.id,
      });
      const del = document.querySelectorAll('.co-addr')[0]!.querySelectorAll('.co-addr-actions button')[1]!;
      fireEvent.click(del);
      await waitFor(() => expect(onShippingAddressChange).toHaveBeenCalledWith(DEFAULT3.id));
    });

    it('🔴 刪掉唯一一張地址 → 選取清空(讓 nextDisabled 擋住下一步)', async () => {
      mockDeleteAddress.mockResolvedValue({ ok: true });
      const { onShippingAddressChange } = renderStep1(false);
      const del = document.querySelectorAll('.co-addr')[0]!.querySelectorAll('.co-addr-actions button')[1]!;
      fireEvent.click(del);
      await waitFor(() => expect(onShippingAddressChange).toHaveBeenCalledWith(''));
    });

    // 刪的不是選中那張 ⇒ 選取不動(反向守門:防「刪任何一張都重設選取」)
    it('刪掉**非**當前選中的地址 → 選取不動', async () => {
      mockDeleteAddress.mockResolvedValue({ ok: true });
      const { onShippingAddressChange } = renderStep1(false, {
        addresses: [ADDR, ADDR2],
        shippingAddrId: ADDR.id,
      });
      const del = document.querySelectorAll('.co-addr')[1]!.querySelectorAll('.co-addr-actions button')[1]!;
      fireEvent.click(del);
      await waitFor(() => expect(mockDeleteAddress).toHaveBeenCalledWith(ADDR2.id));
      expect(onShippingAddressChange).not.toHaveBeenCalled();
    });

    // 刪除失敗不得偽裝成功(對齊 AddressTab:不刷新、卡片留著)
    it('刪除失敗 → 不動選取、不重讀', async () => {
      mockDeleteAddress.mockResolvedValue({ formError: '刪除失敗' });
      const { onShippingAddressChange } = renderStep1(false);
      const del = document.querySelectorAll('.co-addr')[0]!.querySelectorAll('.co-addr-actions button')[1]!;
      fireEvent.click(del);
      await waitFor(() => expect(mockDeleteAddress).toHaveBeenCalled());
      expect(onShippingAddressChange).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });
});
