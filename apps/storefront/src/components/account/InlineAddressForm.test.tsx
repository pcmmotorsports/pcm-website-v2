// @vitest-environment jsdom
//
// InlineAddressForm smoke(g-5b:新增/編輯地址表單)— 前台 regression 安全網。
//
// 驗:
// - render 基本欄(收件人/手機/地址)+ 設預設勾選 + 發票三 tab(個人/公司(三聯式)/捐贈)
// - tab 切換顯對應欄(personal→手機載具 / company→公司抬頭+統一編號 / donate→愛心碼)
// - submit → onSubmit 收正確 shape { isDefault, name, phone, line, invoice:{type,...} }
// - 設預設勾選 → submit payload isDefault=true
// - #181:server 回 fieldErrors.invoice.taxId → 統一編號欄 .auth-field-err 紅字;name 錯 → 收件人欄紅字
// - ok=true → **onSaved()** 被呼叫(2026-08-08 起;~~router.refresh() + onClose()~~ 改由父層收尾,見該條註解)
// - 純 onSubmit 驅動(不寫 design localStorage mock)
//
// mock next/navigation(useRouter().refresh、jsdom 無 router);onSubmit/onClose 由 test 傳 vi.fn()。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { InlineAddressForm, type InlineAddressFormProps } from './InlineAddressForm';
import type { AddAddressActionResult } from '@/app/account/address/actions';
// #378:Email 那格要驗「付款會被拒絕」的警告 —— 上限值 import 常數,**不在測試裡再抄一個 40**。
import { TAPPAY_CARDHOLDER_EMAIL_MAX_LENGTH } from '@pcm/schemas';

// 🔴 2026-08-08 發票欄位「先隱藏」(Sean 拍板):本檔的發票斷言**刻意把開關 mock 成 false**。
//    理由:這些斷言是「發票重開之後該長什麼樣」的規格 —— 刪掉的話重開時沒有東西守著,
//    skip 掉的話它們會靜靜腐爛。mock 成 false 讓它們**照常跑、照常擋回歸**。
//    ⚠️ 「現在到底藏起來了沒」由 `invoice-hidden.test.tsx` 用**真的常數**守(那支不 mock),
//       兩支合起來才是完整的:一支守隱藏態、一支守重開後的行為。
vi.mock('@/lib/invoice-visibility', () => ({ INVOICE_FIELDS_HIDDEN: false }));


beforeEach(() => mockRefresh.mockReset());
afterEach(cleanup);

function renderForm(
  opts: { addr?: InlineAddressFormProps['addr']; result?: AddAddressActionResult } = {},
) {
  const onSubmit = vi
    .fn<InlineAddressFormProps['onSubmit']>()
    .mockResolvedValue(opts.result ?? { ok: true });
  const onClose = vi.fn<() => void>();
  const onSaved = vi.fn<() => void>();
  render(<InlineAddressForm addr={opts.addr ?? { isDefault: false }} onSubmit={onSubmit} onClose={onClose} onSaved={onSaved} />);
  return { onSubmit, onClose, onSaved };
}

// 填必填欄(收件人/地址),使原生 required 驗證放行、form onSubmit 觸發(jsdom 對 required 空欄會擋送出)。
// server zod 仍為權威驗證,required 是 client 層 UX(對齊 design L714/L716);下列 #181/ok 測試驗的是
// 「server 回應 → 渲染」與 ok 流程,不依賴空欄送出,故先填必填欄讓 submit 真的觸發。
function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王小明' } });
  fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北市' } });
  fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: 'a@b.tw' } });
}

describe('InlineAddressForm(g-5b 新增表單)', () => {
  it('render 基本欄 + 設預設 + 發票三 tab + heading「新增地址」', () => {
    renderForm();
    expect(screen.getByText('新增地址')).toBeTruthy();
    expect(screen.getByPlaceholderText('王小明')).toBeTruthy();
    expect(screen.getByPlaceholderText('0912 345 678')).toBeTruthy();
    expect(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓')).toBeTruthy();
    expect(screen.getByText('設為預設地址')).toBeTruthy();
    expect(screen.getByRole('button', { name: '個人' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '公司(三聯式)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '捐贈' })).toBeTruthy();
    // 預設 personal tab:手機載具欄在場;公司/捐贈欄不在
    expect(screen.getByPlaceholderText('/ABCD123')).toBeTruthy();
    expect(screen.queryByPlaceholderText('8 碼數字')).toBeNull();
  });

  it('edit 模式(addr.id)→ heading「編輯地址」', () => {
    renderForm({ addr: { id: 'a1', isDefault: true, name: '王', phone: '09', line: '台北' } });
    expect(screen.getByText('編輯地址')).toBeTruthy();
  });

  it('發票 tab 切換顯對應欄(company→抬頭+統編 / donate→愛心碼)', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '公司(三聯式)' }));
    expect(screen.getByPlaceholderText('例:賓士機車有限公司')).toBeTruthy();
    expect(screen.getByPlaceholderText('8 碼數字')).toBeTruthy();
    expect(screen.queryByPlaceholderText('/ABCD123')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '捐贈' }));
    expect(screen.getByPlaceholderText('例:8585(罕病)、925(伊甸)')).toBeTruthy();
    expect(screen.queryByPlaceholderText('8 碼數字')).toBeNull();
  });

  it('submit → onSubmit 收正確 shape(personal)', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '陳大文' } });
    fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '0911222333' } });
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北市信義區' } });
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: 'chen@mail.tw' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      isDefault: false,
      name: '陳大文',
      phone: '0911222333',
      line: '台北市信義區',
      email: 'chen@mail.tw',
      invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    });
  });

  it('勾設預設 + company tab → onSubmit payload isDefault=true + invoice.type=company', async () => {
    const { onSubmit } = renderForm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '公司(三聯式)' }));
    fireEvent.change(screen.getByPlaceholderText('例:賓士機車有限公司'), { target: { value: '賓士機車' } });
    fireEvent.change(screen.getByPlaceholderText('8 碼數字'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '甲' } });
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北' } });
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: 'a@b.tw' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      isDefault: true,
      name: '甲',
      phone: '',
      line: '台北',
      email: 'a@b.tw',
      invoice: { type: 'company', carrier: '', title: '賓士機車', taxId: '12345678', donateCode: '' },
    });
  });

  it('#181 server 回 fieldErrors.invoice.taxId → 統一編號欄 .auth-field-err 紅字(巢狀)', async () => {
    renderForm({ result: { fieldErrors: { invoice: { taxId: '統編需 8 碼數字' } } } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '公司(三聯式)' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const err = await screen.findByText('統編需 8 碼數字');
    expect(err.classList.contains('auth-field-err')).toBe(true);
  });

  it('#181 server 回 fieldErrors.name → 收件人欄紅字(頂層)', async () => {
    renderForm({ result: { fieldErrors: { name: '請填寫收件人' } } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const err = await screen.findByText('請填寫收件人');
    expect(err.classList.contains('auth-field-err')).toBe(true);
  });

  it('#181 server 回 formError → 頂部 .auth-err、不呼叫 onSaved / onClose', async () => {
    const { onClose, onSaved } = renderForm({ result: { formError: '儲存失敗,請稍後再試' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    const err = await screen.findByText('儲存失敗,請稍後再試');
    expect(err.classList.contains('auth-err')).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // 🔴 2026-08-08(P-205-STOP ③「新增後不刷新」):成功後的收尾**交給父層**,本元件不自己
  //   `router.refresh()` 也不自己 `onClose()` —— 舊寫法那兩行都在本元件的 transition 裡,
  //   而 onClose 會讓父層把本元件 unmount = 發出重讀指令的元件把自己拆掉。
  //   對照組:同頁「刪除」的 transition 掛在父層、元件續存,那條一直是正常的。
  // 突變:把 `onSaved()` 換回 `router.refresh(); onClose();` ⇒ 只紅這條
  it('🔴 ok=true → 只呼叫 onSaved();本元件不得自己 refresh 或 close', async () => {
    const { onClose, onSaved } = renderForm({ result: { ok: true } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // 反面:重讀與收合都不再由本元件發起(父層 onSaved 才是那兩件事的唯一出口)
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('取消鈕 → onClose()(不 submit)', () => {
    const { onSubmit, onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ── #378:錯誤訊息隨輸入清除(2026-08-08 全站掃測 B 級;本張是 7 張裡的最後一張)──────
// 三條判準沿用 auth 片:① 動哪一欄清哪一欄 ② 頂部 formError 一律清 ③ 沒有自己 fieldError 的欄不接。
//
// 🔴🔴 本張與另外六張的差別:**Email 那一欄連著付款**(上限 40 = TapPay `cardholder.email`)。
//    那個位置是兩個通道共用的 —— server 的 `fieldErrors.email` 優先,沒有時才顯 client 算的長度提示。
//    ⇒ 「清掉 server 錯」必須**不會讓付款會被擋的警告消失**。下面那格就是釘這件事的。
describe('#378 錯誤隨輸入清除', () => {
  const ALL_FIELD_ERRS = {
    name: '請填寫收件人',
    phone: '手機格式不正確',
    line: '請填寫地址',
    email: 'Email 格式不正確',
  };

  /** 讓四個頂層欄同時紅 —— 逐欄清那半要有「其他欄的錯留著」可看。 */
  function showAllFieldErrs() {
    const utils = renderForm({ result: { fieldErrors: ALL_FIELD_ERRS } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    return utils;
  }

  async function showAllFieldErrsAwaited() {
    const utils = showAllFieldErrs();
    expect(await screen.findByText('請填寫收件人')).toBeTruthy();
    return utils;
  }

  it('改收件人 → 只清收件人那欄,其餘三欄的錯留著(逐欄清、不是全清)', async () => {
    await showAllFieldErrsAwaited();
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '陳' } });

    expect(screen.queryByText('請填寫收件人')).toBeNull();
    // 🔴 判別力在這三條:改成「動任一欄就 setFieldErrors({})」時只有它們會紅。
    expect(screen.getByText('手機格式不正確')).toBeTruthy();
    expect(screen.getByText('請填寫地址')).toBeTruthy();
    expect(screen.getByText('Email 格式不正確')).toBeTruthy();
  });

  it('改手機 → 只清手機那欄', async () => {
    await showAllFieldErrsAwaited();
    fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '09' } });

    expect(screen.queryByText('手機格式不正確')).toBeNull();
    expect(screen.getByText('請填寫收件人')).toBeTruthy();
  });

  it('改地址 → 只清地址那欄', async () => {
    await showAllFieldErrsAwaited();
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北' } });

    expect(screen.queryByText('請填寫地址')).toBeNull();
    expect(screen.getByText('請填寫收件人')).toBeTruthy();
  });

  // 🔴🔴 本片唯一碰到錢的那一格。
  it('🔴 改 Email 清掉 server 錯之後,「付款會被拒絕」的超長警告**當場接上**、不是消失', async () => {
    const tooLong = `${'a'.repeat(TAPPAY_CARDHOLDER_EMAIL_MAX_LENGTH)}@b.tw`; // 必定超過上限
    const utils = renderForm({ result: { fieldErrors: { email: 'Email 格式不正確' } } });
    fillRequired();
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: tooLong } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('Email 格式不正確')).toBeTruthy();
    // 前提:server 錯在場時,長度警告被它蓋住(兩通道共用同一個位置)。
    expect(screen.queryByText(new RegExp(`已超過 ${TAPPAY_CARDHOLDER_EMAIL_MAX_LENGTH} 字元`))).toBeNull();

    // 再打一個字 —— 仍然超長。
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: `${tooLong}x` } });

    expect(screen.queryByText('Email 格式不正確')).toBeNull();
    // 🔴 這條是整片最重要的斷言:清掉 server 錯之後,客人**沒有**變成看不到「付款會被擋」。
    const warn = screen.getByText(new RegExp(`已超過 ${TAPPAY_CARDHOLDER_EMAIL_MAX_LENGTH} 字元`));
    // 🔴 R1 nit-7:只斷言**文字**沒有判別力 —— 那段文字由同一個 span 無條件提供,
    //    把三元改成恆 `'acc-field-hint'`(警告變灰色中性字)時,只驗文字的版本照樣綠。
    expect(warn.classList.contains('auth-field-err')).toBe(true);

    // 🔴 R1 nit-8 反向對照:縮到上限內 ⇒ 必須換回**中性**提示。
    //    少了這一半,`isEmailTooLong` 恆真(每個正常信箱都掛「付款會被拒絕」)也全綠。
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: 'a@b.tw' } });
    const hint = screen.getByText(new RegExp(`${TAPPAY_CARDHOLDER_EMAIL_MAX_LENGTH} 字元內`));
    expect(hint.classList.contains('auth-field-err')).toBe(false);
    expect(utils.onSubmit).toHaveBeenCalledTimes(1); // 全程只送出過那一次
  });

  it('🔴 改任一欄 → 頂部帳號層級錯(請重新登入)也一起清掉', async () => {
    renderForm({ result: { formError: '請重新登入' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('請重新登入')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '09' } });

    expect(screen.queryByText('請重新登入')).toBeNull();
  });

  // ── 巢狀 invoice 欄(重開旗標後就是客人看得到的欄;測試端 mock 成顯示,見檔頭 :32)────
  it('改手機載具 → 清掉巢狀 invoice.carrier 的錯', async () => {
    renderForm({ result: { fieldErrors: { invoice: { carrier: '載具格式不正確' } } } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('載具格式不正確')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('/ABCD123'), { target: { value: '/X' } });

    expect(screen.queryByText('載具格式不正確')).toBeNull();
  });

  it('改公司抬頭 → 清掉巢狀 invoice.title 的錯', async () => {
    renderForm({ result: { fieldErrors: { invoice: { title: '請填寫抬頭' } } } });
    fillRequired();
    fireEvent.click(screen.getByText('公司(三聯式)'));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('請填寫抬頭')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('例:賓士機車有限公司'), { target: { value: '賓士' } });

    expect(screen.queryByText('請填寫抬頭')).toBeNull();
  });

  it('改愛心碼 → 清掉巢狀 invoice.donateCode 的錯', async () => {
    renderForm({ result: { fieldErrors: { invoice: { donateCode: '愛心碼不存在' } } } });
    fillRequired();
    fireEvent.click(screen.getByText('捐贈'));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('愛心碼不存在')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('例:8585(罕病)、925(伊甸)'), { target: { value: '925' } });

    expect(screen.queryByText('愛心碼不存在')).toBeNull();
  });

  // 🔴 R1 nit-10:`clearInvoiceErr` 裡的 `setFormError(null)` 原本零測試、刪掉全綠。
  //    構造法要繞一下:`submit` 的兩條分支互斥(回 fieldErrors 就清 formError、反之亦然)
  //    ⇒ 「頂部錯」與「invoice 逐欄錯」**同時在場是構造不出來的**。
  //    但 `setFormError(null)` 是**無條件**跑的(bail out 只在 fieldErrors 那半)
  //    ⇒ 正解 = 頂部錯在場時,去動一個**自己沒有錯**的發票欄。
  it('🔴 頂部 formError 在場時改發票欄 → 頂部錯也清掉(巢狀那支的 formError 那半)', async () => {
    renderForm({ result: { formError: '請重新登入' } });
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('請重新登入')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('/ABCD123'), { target: { value: '/X' } });

    expect(screen.queryByText('請重新登入')).toBeNull();
  });

  it('改統一編號 → 只清 invoice.taxId,同 tab 的公司抬頭錯留著(巢狀也是逐欄)', async () => {
    renderForm({
      result: { fieldErrors: { invoice: { title: '請填寫抬頭', taxId: '統編需 8 碼數字' } } },
    });
    fillRequired();
    fireEvent.click(screen.getByText('公司(三聯式)'));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('統編需 8 碼數字')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('8 碼數字'), { target: { value: '12345678' } });

    expect(screen.queryByText('統編需 8 碼數字')).toBeNull();
    expect(screen.getByText('請填寫抬頭')).toBeTruthy();
  });

  // ── 對照組:不是「編輯某一欄」的動作,一律不清 ──────────────────────────────
  // 🔴 R1 nit-6:第一版這格的名字講「**被切走那欄的錯**仍然留著」,但 fixture 裡根本沒有
  //    任何 invoice 錯 ⇒ 名字在講的那件事沒有被斷言,突變「在 setInvType 裡只清 invoice 那組」
  //    照樣綠。改成把 invoice 錯放進 fixture、切走那個 tab 之後再切回來確認它還在。
  it('切發票 tab 不清錯 —— 切 tab 不是編輯,被切走那欄的錯仍然留著(它還擋得住儲存)', async () => {
    renderForm({
      result: { fieldErrors: { name: '請填寫收件人', invoice: { taxId: '統編需 8 碼數字' } } },
    });
    fillRequired();
    fireEvent.click(screen.getByText('公司(三聯式)'));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('統編需 8 碼數字')).toBeTruthy();

    fireEvent.click(screen.getByText('捐贈')); // 切走 ⇒ 統編欄不再渲染
    expect(screen.queryByText('統編需 8 碼數字')).toBeNull(); // 看不到了(欄位不在 DOM),但不代表被清掉
    expect(screen.getByText('請填寫收件人')).toBeTruthy(); // 頂層那欄的錯不受切 tab 影響

    fireEvent.click(screen.getByText('公司(三聯式)')); // 切回來
    // 🔴 這條才是本格的重點:錯**還在 state 裡**,沒有因為切 tab 被清掉。
    expect(screen.getByText('統編需 8 碼數字')).toBeTruthy();
  });

  it('勾「設為預設地址」不清錯(對照組=LoginPage 的「記住我」)', async () => {
    await showAllFieldErrsAwaited();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('請填寫收件人')).toBeTruthy();
    expect(screen.getByText('手機格式不正確')).toBeTruthy();
  });
});
