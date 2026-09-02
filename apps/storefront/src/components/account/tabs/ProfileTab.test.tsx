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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

const PROFILE: AccountProfile = { name: '王小明', phone: '0912345678', birthday: '1990-05-20', gender: '' };

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
    expect(mockUpdate).toHaveBeenCalledWith({ name: '王小明', phone: '0912345678', birthday: '1990-05-20', gender: '' });
  });

  it('編輯姓名後 submit 送出更新值(controlled state)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    renderTab();
    fireEvent.change(screen.getByDisplayValue('王小明'), { target: { value: '陳大文' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await screen.findByText('✓ 已儲存');
    expect(mockUpdate).toHaveBeenCalledWith({ name: '陳大文', phone: '0912345678', birthday: '1990-05-20', gender: '' });
  });

  it('#196 unmount 清未觸發的 saved-timer(防切 tab 卸載後 setState-after-unmount 洩漏)', async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    // 成功分支 → saved=true → useEffect([saved]) 排 1800ms 復原 timer
    await screen.findByText('✓ 已儲存');
    // passive effect 在 commit 後跑、可能晚於 findByText → waitFor 等 1800ms timer 真排定再斷言(消時序 race)
    await waitFor(() => {
      expect(setTimeoutSpy.mock.calls.some((c) => c[1] === 1800)).toBe(true);
    });
    const idx = setTimeoutSpy.mock.calls.findIndex((c) => c[1] === 1800);
    const savedTimerId = setTimeoutSpy.mock.results[idx]!.value;
    // 卸載(模擬切 tab)→ effect cleanup 應 clearTimeout 該 timer、計時器永不在卸載後觸發 setSaved
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(savedTimerId);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
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

// ── #378:錯誤訊息隨輸入清除(2026-08-08 全站掃測 B 級;auth 四張 + 愛車表單已修,本張是第六張)──
// 三條判準沿用 auth 片:① 動哪一欄清哪一欄 ② 頂部 formError 一律清
// ③ 沒有自己 fieldError 的欄不接(本張的對照組 = **disabled 的 Email 欄**)。
describe('#378 錯誤隨輸入清除', () => {
  /** 讓三欄同時紅 —— 逐欄清那半要有「其他欄的錯留著」可看,否則改成全清也照樣綠。 */
  async function showAllFieldErrs() {
    mockUpdate.mockResolvedValue({
      fieldErrors: { name: '請填寫姓名', phone: '手機格式不正確', birthday: '生日格式不正確', gender: '' },
    });
    const utils = renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    expect(await screen.findByText('請填寫姓名')).toBeTruthy();
    return utils;
  }

  it('改姓名 → 只清姓名那欄,手機與生日的錯留著(逐欄清、不是全清)', async () => {
    await showAllFieldErrs();
    fireEvent.change(screen.getByDisplayValue('王小明'), { target: { value: '陳' } });

    expect(screen.queryByText('請填寫姓名')).toBeNull();
    // 🔴 這兩條才是判別力所在:改成「動任一欄就 setFieldErrors({})」時只有它們會紅。
    expect(screen.getByText('手機格式不正確')).toBeTruthy();
    expect(screen.getByText('生日格式不正確')).toBeTruthy();
  });

  it('改手機 → 只清手機那欄', async () => {
    await showAllFieldErrs();
    fireEvent.change(screen.getByDisplayValue('0912345678'), { target: { value: '09' } });

    expect(screen.queryByText('手機格式不正確')).toBeNull();
    expect(screen.getByText('請填寫姓名')).toBeTruthy();
    expect(screen.getByText('生日格式不正確')).toBeTruthy();
  });

  it('改生日 → 只清生日那欄', async () => {
    await showAllFieldErrs();
    fireEvent.change(screen.getByDisplayValue('1990-05-20'), { target: { value: '1991-01-01' } });

    expect(screen.queryByText('生日格式不正確')).toBeNull();
    expect(screen.getByText('請填寫姓名')).toBeTruthy();
    expect(screen.getByText('手機格式不正確')).toBeTruthy();
  });

  it('🔴 改任一欄 → 頂部帳號層級錯(請重新登入)也一起清掉', async () => {
    mockUpdate.mockResolvedValue({ formError: '請重新登入' });
    const { container } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    expect(await screen.findByText('請重新登入')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('0912345678'), { target: { value: '09' } });

    expect(screen.queryByText('請重新登入')).toBeNull();
    expect(container.querySelector('.auth-err')).toBeNull();
  });

  // 對照組:Email 欄 `disabled` 且**沒有自己的 fieldError** ⇒ 判準③ 不接。
  // 🔴 這一格釘的是「不要順手把 clearErr 掛到每一個 input 上」——
  //    掛上去的突變會讓下面這條紅(jsdom 對 disabled 欄的 fireEvent.change 仍會叫到 onChange)。
  it('Email 欄是 disabled 且無自己的錯 ⇒ 不接清除(判準③)', async () => {
    await showAllFieldErrs();
    const emailInput = screen.getByDisplayValue('wang@example.com') as HTMLInputElement;
    expect(emailInput.disabled).toBe(true);
    fireEvent.change(emailInput, { target: { value: 'other@example.com' } });

    expect(screen.getByText('請填寫姓名')).toBeTruthy();
    expect(screen.getByText('手機格式不正確')).toBeTruthy();
    expect(screen.getByText('生日格式不正確')).toBeTruthy();
  });

  // ══ 🔴🔴 性別那一格(2026-09-01)══════════════════════════════════════════
  //   這一段測的是【送代碼、顯示中文】那條契約 —— 它壞掉的方式是**畫面完全正常**:
  //   下拉上仍然寫著「男」,而送出去的是 '男' ⇒ DB 的 CHECK 擋掉 ⇒ 整筆 UPDATE 被拒
  //   ⇒ 使用者看到「儲存失敗,請稍後再試」,而**看不出是哪一欄害的**。
  describe('性別(`:573` 會員中心那一片)', () => {
    it('🔴 下拉顯示中文而【送出代碼】—— 兩者不是同一個字', async () => {
      mockUpdate.mockResolvedValue({ ok: true });
      renderTab({ name: '王', phone: '', birthday: '', gender: '' });
      const sel = screen.getByDisplayValue('不選擇') as HTMLSelectElement;
      // 畫面上是中文
      const labels = [...sel.querySelectorAll('option')].map((o) => o.textContent);
      expect(labels).toEqual(['不選擇', '男', '女', '不透露']);
      // 而 value 是代碼
      const values = [...sel.querySelectorAll('option')].map((o) => o.getAttribute('value'));
      expect(values).toEqual(['', 'male', 'female', 'undisclosed']);

      fireEvent.change(sel, { target: { value: 'female' } });
      fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
      await screen.findByText('✓ 已儲存');
      // 🔴 判別力在這一行:送出去的必須是 'female'，不是 '女'
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ gender: 'female' }),
      );
    });

    it('🟢 正對照:profile 帶進來的代碼要選得起來(不是永遠停在「不選擇」)', () => {
      renderTab({ name: '王', phone: '', birthday: '', gender: 'undisclosed' });
      expect((screen.getByDisplayValue('不透露') as HTMLSelectElement).value).toBe('undisclosed');
    });

    // 🔵 codex R1 nit:上一版只驗「錯誤會顯示」,沒驗「改選項後會清掉」
    //    ⇒ 刪掉 `clearErr('gender')` 仍全綠。這一格補那個方向。
    it('🔴 改選項後那一欄的紅字要清掉(刪掉 clearErr 就會紅)', async () => {
      mockUpdate.mockResolvedValue({ fieldErrors: { gender: '性別選項不正確', name: '請填寫姓名' } });
      renderTab({ name: '王', phone: '', birthday: '', gender: '' });
      fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
      expect(await screen.findByText('性別選項不正確')).toBeTruthy();
      // 改性別 ⇒ 只清性別那一欄
      fireEvent.change(screen.getByDisplayValue('不選擇'), { target: { value: 'male' } });
      expect(screen.queryByText('性別選項不正確')).toBeNull();
      // 🔵 正對照:姓名那一欄的錯【要留著】—— 不然「逐欄清」與「全清」分不開
      expect(screen.getByText('請填寫姓名')).toBeTruthy();
    });

    it('🔴 server 回 fieldErrors.gender ⇒ 那一欄自己顯紅字(不是變成 formError)', async () => {
      mockUpdate.mockResolvedValue({ fieldErrors: { gender: '性別選項不正確' } });
      renderTab({ name: '王', phone: '', birthday: '', gender: '' });
      fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
      expect(await screen.findByText('性別選項不正確')).toBeTruthy();
    });
  });
});

describe('ProfileTab 手機欄輸入法屬性', () => {
  // ── 手機欄要叫得出數字鍵盤(2026-09-03 `-account` 手機走查發現)────────────────
  // 🔴 這一格【測得到什麼、測不到什麼】要寫清楚, 免得被讀寬:
  //    測得到 = 那三個屬性各自被拿掉時都會紅(三發突變各跑過一次, 見 commit body)。
  //    測不到 = 「iPhone 真的跳出數字鍵盤」—— 那要真機, jsdom 沒有鍵盤。
  //    ⇒ 它守的是【屬性不被無聲刪掉】, 不是行為。
  // 🔵 autoComplete 是 `tel-national` 不是 `tel`:理由在 RegisterPage.tsx 的手機欄註解。
  it('手機欄帶 type/inputMode=tel 與 autoComplete=tel-national(拿掉任一就紅)', () => {
    renderTab();
    const phone = screen.getByText('手機').closest('label')?.querySelector('input');
    expect(phone).toBeTruthy();
    expect(phone!.getAttribute('type')).toBe('tel');
    expect(phone!.getAttribute('inputmode')).toBe('tel');
    expect(phone!.getAttribute('autocomplete')).toBe('tel-national');
  });
});
