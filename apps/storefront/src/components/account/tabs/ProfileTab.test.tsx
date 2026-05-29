// @vitest-environment jsdom
//
// ProfileTab smoke(g-4b:真 form session-write)— 前台 regression 安全網。
//
// 驗:
// - design 字面 render(個人資料 / 姓名·Email·手機·生日 4 欄 / 儲存變更 按鈕)+ acc-section 殼 + 真 form(g-1a stub 退場)
// - 初值來自 profile prop(name/phone/birthday)
// - submit → 呼叫 updateProfileAction(name/phone/birthday)、ok=true → 按鈕切「✓ 已儲存」(Q3=A)
// - #181 雙通道:server 回 fieldErrors → 該欄 .auth-field-err 逐欄;server 回 formError → 頂部 .auth-err 帳號層級
// - LINE 用戶(email='')Email 欄空 + 替代字面 placeholder「LINE 帳號登入,無 Email」、disabled 不可編輯(Q2-1=b)
// - 一般用戶 Email 顯真值、disabled
// - 不洩 design mock:submit 走 server action、不寫 design SPA localStorage 'pcm-user'(design L418 mock 行為)
//
// mock '@/app/account/profile/actions':避免載 server action(transitively import server-only / supabase server client)。
// AccountProfile 為 import type(編譯期擦除、runtime 不載 AccountView / Header)、無需 CartProvider / matchMedia。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/account/profile/actions', () => ({
  updateProfileAction: vi.fn(),
}));
// g-4c:ProfileTab 改 useRouter().refresh()(存檔後重讀 server component);jsdom 無 next router →
// mock 掉避免 useRouter undefined。vi.hoisted 讓 mockRefresh 在 vi.mock 工廠(被提升至檔頂)可用、且可捕捉呼叫。
const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { ProfileTab } from './ProfileTab';
import { updateProfileAction } from '@/app/account/profile/actions';
import type { AccountProfile } from '@/components/account/AccountView';

const mockUpdate = vi.mocked(updateProfileAction);

const PROFILE: AccountProfile = { name: '王小明', phone: '0912345678', birthday: '1990-05-20' };

beforeEach(() => {
  mockUpdate.mockReset();
  mockRefresh.mockReset();
});
afterEach(cleanup);

function renderTab(profile: AccountProfile = PROFILE, email = 'wang@example.com') {
  return render(<ProfileTab profile={profile} email={email} />);
}

describe('ProfileTab(g-4b 真 form)', () => {
  it('render design 字面 + acc-section 殼 + 真 form(stub 退場)', () => {
    const { container } = renderTab();
    expect(screen.getByText('個人資料')).toBeTruthy();
    expect(screen.getByText('姓名')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('手機')).toBeTruthy();
    expect(screen.getByText('生日')).toBeTruthy();
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="profile"]')).toBeTruthy();
    expect(container.querySelector('.acc-profile')).toBeTruthy();
    expect(container.querySelector('form')).toBeTruthy();
    // g-1a stub 字面退場
    expect(container.querySelector('.acc-stub')).toBeNull();
    expect(screen.queryByText('(本段於 g-4b 接入)')).toBeNull();
  });

  it('初值來自 profile prop(name/phone/birthday)', () => {
    renderTab();
    expect(screen.getByDisplayValue('王小明')).toBeTruthy();
    expect(screen.getByDisplayValue('0912345678')).toBeTruthy();
    expect(screen.getByDisplayValue('1990-05-20')).toBeTruthy();
  });

  it('submit → 呼叫 updateProfileAction(name/phone/birthday)、ok=true → 按鈕切「✓ 已儲存」(Q3=A)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    expect(await screen.findByText('✓ 已儲存')).toBeTruthy();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ name: '王小明', phone: '0912345678', birthday: '1990-05-20' });
  });

  it('編輯姓名後 submit 送出更新值(controlled state)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    renderTab();
    fireEvent.change(screen.getByDisplayValue('王小明'), { target: { value: '陳大文' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await screen.findByText('✓ 已儲存');
    expect(mockUpdate).toHaveBeenCalledWith({ name: '陳大文', phone: '0912345678', birthday: '1990-05-20' });
  });

  it('g-4c:ok=true → router.refresh() 被呼叫(重讀 server component 解 staleness)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await screen.findByText('✓ 已儲存');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('g-4c:server 回 fieldErrors / formError 時不呼叫 router.refresh(只成功才刷新)', async () => {
    mockUpdate.mockResolvedValue({ formError: '儲存失敗,請稍後再試' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await screen.findByText('儲存失敗,請稍後再試');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('#181 server 回 fieldErrors.name → 姓名欄 .auth-field-err 逐欄紅字', async () => {
    mockUpdate.mockResolvedValue({ fieldErrors: { name: '請填寫姓名' } });
    const { container } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    const err = await screen.findByText('請填寫姓名');
    expect(err.classList.contains('auth-field-err')).toBe(true);
    // 逐欄錯不走頂部帳號層級通道
    expect(container.querySelector('.auth-err')).toBeNull();
  });

  it('#181 server 回 formError → 頂部 .auth-err 帳號層級通道', async () => {
    mockUpdate.mockResolvedValue({ formError: '儲存失敗,請稍後再試' });
    const { container } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    const err = await screen.findByText('儲存失敗,請稍後再試');
    expect(err.classList.contains('auth-err')).toBe(true);
    expect(container.querySelector('.auth-field-err')).toBeNull();
  });

  it('LINE 用戶(email=\'\')Email 欄空 + 替代字面 placeholder、disabled 不可編輯(Q2-1=b)', () => {
    renderTab(PROFILE, '');
    const emailInput = screen.getByPlaceholderText('LINE 帳號登入,無 Email') as HTMLInputElement;
    expect(emailInput).toBeTruthy();
    expect(emailInput.value).toBe('');
    expect(emailInput.disabled).toBe(true);
  });

  it('一般用戶 Email 顯真值、disabled', () => {
    renderTab(PROFILE, 'wang@example.com');
    const emailInput = screen.getByDisplayValue('wang@example.com') as HTMLInputElement;
    expect(emailInput.disabled).toBe(true);
    // 一般用戶不顯 LINE 替代字面
    expect(screen.queryByPlaceholderText('LINE 帳號登入,無 Email')).toBeNull();
  });

  it('不洩 design mock:submit 走 server action、不寫 design SPA localStorage pcm-user', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await screen.findByText('✓ 已儲存');
    expect(mockUpdate).toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalledWith('pcm-user', expect.anything());
    setItem.mockRestore();
  });
});
