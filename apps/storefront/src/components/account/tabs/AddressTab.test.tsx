// @vitest-environment jsdom
//
// AddressTab smoke(g-5a 唯讀列表 + g-5b 新增表單 + g-5c 編輯/刪除)— 前台 regression 安全網。
//
// 驗:
// - 標題「收件地址」+ acc-section 殼(data-tab="address")+「＋ 新增地址」鈕(g-5b)
// - 有地址 → 渲染 .acc-addr 卡(name/phone/line);isDefault → 顯「預設」標籤、非預設不顯
// - 多筆全渲染 / 空清單 → design 空狀態字面「尚未新增地址 — 新增後結帳可直接帶入。」
// - g-5b:點「＋ 新增地址」→ 開 InlineAddressForm(.acc-inline-form);新增表單預填會員姓名(defaultName)
// - g-5c:每卡 .acc-addr-actions「編輯/刪除」鈕;點編輯 → 開 InlineAddressForm 編輯模式(heading「編輯地址」+ 帶入既有值)
// - g-5c:編輯 submit → updateAddressAction(該筆 id, payload);點刪除 → confirm 確認後 deleteAddressAction(該筆 id)、confirm 取消則不刪(對齊 design L362-363)
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)
//
// mock '@/app/account/address/actions'(AddressTab import server action、transitively 拉 server-only 在 jsdom 爆、
// 同 RegisterPage.test 處置)+ next/navigation(InlineAddressForm / AddressTab useRouter)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUpdateAddressAction, mockDeleteAddressAction } = vi.hoisted(() => ({
  mockUpdateAddressAction: vi.fn(),
  mockDeleteAddressAction: vi.fn(),
}));
vi.mock('@/app/account/address/actions', () => ({
  addAddressAction: mockAddAddressAction,
  updateAddressAction: mockUpdateAddressAction,
  deleteAddressAction: mockDeleteAddressAction,
}));
const { mockRefresh, mockAddAddressAction } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockAddAddressAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// jsdom 不實作 scrollIntoView(g-5c inline-form 包裹層的開表單 effect 觸發會爆);本 repo 無全域 setupFiles、就地補。
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  mockUpdateAddressAction.mockReset().mockResolvedValue({ ok: true });
  mockDeleteAddressAction.mockReset().mockResolvedValue({ ok: true });
  // jsdom confirm 預設回 false(且未實作);預設放行、單一測試 mockReturnValueOnce(false) 覆寫驗取消。
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  // 開表單捲動修復(2026-08-07):每測試前清空呼叫紀錄,避免跨測試累積污染斷言。
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
});

import { AddressTab } from './AddressTab';
import type { CustomerAddress } from '@pcm/domain';

afterEach(cleanup);

function makeAddr(over: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: 'a1',
    customerUserId: 'u1',
    isDefault: false,
    name: '王小明',
    phone: '0912345678',
    line: '台北市信義區市府路 1 號',
    invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function renderTab(addresses: CustomerAddress[], defaultName = '') {
  return render(<AddressTab addresses={addresses} defaultName={defaultName} />);
}

describe('AddressTab(g-5a 唯讀列表 + g-5b 新增 + g-5c 編輯/刪除)', () => {
  it('標題「收件地址」+ acc-section 殼 +「＋ 新增地址」鈕', () => {
    const { container } = renderTab([]);
    expect(screen.getByText('收件地址')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="address"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
    expect(container.querySelector('.acc-add')).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 新增地址' })).toBeTruthy();
  });

  it('有地址 → 渲染卡 name/phone/line', () => {
    const { container } = renderTab([makeAddr()]);
    expect(container.querySelector('.acc-addr')).toBeTruthy();
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText('0912345678')).toBeTruthy();
    expect(screen.getByText('台北市信義區市府路 1 號')).toBeTruthy();
  });

  it('isDefault → 顯「預設」標籤;非預設不顯', () => {
    const { container, rerender } = renderTab([makeAddr({ isDefault: true })]);
    expect(container.querySelector('.acc-addr-tag')).toBeTruthy();
    expect(screen.getByText('預設')).toBeTruthy();
    rerender(<AddressTab addresses={[makeAddr({ isDefault: false })]} defaultName="" />);
    expect(screen.queryByText('預設')).toBeNull();
  });

  it('多筆地址全渲染', () => {
    const { container } = renderTab([makeAddr({ id: 'a1', name: '甲' }), makeAddr({ id: 'a2', name: '乙' })]);
    expect(container.querySelectorAll('.acc-addr').length).toBe(2);
    expect(screen.getByText('甲')).toBeTruthy();
    expect(screen.getByText('乙')).toBeTruthy();
  });

  it('空清單 → design 空狀態字面(表單未開時)', () => {
    const { container } = renderTab([]);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(screen.getByText('尚未新增地址 — 新增後結帳可直接帶入。')).toBeTruthy();
    expect(container.querySelector('.acc-addr')).toBeNull();
  });

  it('g-5b:點「＋ 新增地址」→ 開 InlineAddressForm(.acc-inline-form);空清單時空狀態與表單並存(對齊 design L650-657)', () => {
    const { container } = renderTab([]);
    expect(container.querySelector('.acc-inline-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    expect(container.querySelector('.acc-inline-form')).toBeTruthy();
    expect(screen.getByText('新增地址')).toBeTruthy();
    expect(screen.getByRole('button', { name: '儲存' })).toBeTruthy();
    // design L650-657:空狀態與新增表單獨立條件、空清單開表單時兩者並存(不收起空狀態)。
    expect(screen.getByText('尚未新增地址 — 新增後結帳可直接帶入。')).toBeTruthy();
    expect(container.querySelector('.acc-empty')).toBeTruthy();
  });

  it('g-5b:新增表單預填會員姓名(defaultName、對齊 design L628)', () => {
    renderTab([], '王大明');
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    expect((screen.getByPlaceholderText('王小明') as HTMLInputElement).value).toBe('王大明');
  });

  it('g-5c 每卡渲染 .acc-addr-actions「編輯/刪除」鈕(design L638-641)', () => {
    const { container } = renderTab([makeAddr()]);
    expect(container.querySelector('.acc-addr-actions')).toBeTruthy();
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刪除' })).toBeTruthy();
  });

  it('g-5c 點「編輯」→ 開 InlineAddressForm 編輯模式(heading「編輯地址」+ 帶入既有值)', () => {
    const { container } = renderTab([
      makeAddr({ name: '陳大文', phone: '0911222333', line: '台北市信義區松壽路 9 號' }),
    ]);
    expect(container.querySelector('.acc-inline-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(container.querySelector('.acc-inline-form')).toBeTruthy();
    // 編輯模式 heading(非「新增地址」)
    expect(screen.getByText('編輯地址')).toBeTruthy();
    expect(screen.queryByText('新增地址')).toBeNull();
    // 既有值帶入(收件人/手機/地址)
    expect((screen.getByPlaceholderText('王小明') as HTMLInputElement).value).toBe('陳大文');
    expect((screen.getByPlaceholderText('0912 345 678') as HTMLInputElement).value).toBe('0911222333');
    expect((screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓') as HTMLInputElement).value).toBe(
      '台北市信義區松壽路 9 號',
    );
  });

  it('g-5c 編輯 toggle:再點同卡「編輯」收合表單', () => {
    const { container } = renderTab([makeAddr()]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(container.querySelector('.acc-inline-form')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(container.querySelector('.acc-inline-form')).toBeNull();
  });

  it('g-5c 編輯 submit → updateAddressAction(該筆 id, payload)(id 綁 parent closure)', async () => {
    renderTab([makeAddr({ id: 'a-99', name: '陳大文', line: '台北市信義區松壽路 9 號' })]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    // 既有值已帶入(name/line 必填已滿足)、email 為新必填欄需補填才能送出
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: 'a@b.tw' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(mockUpdateAddressAction).toHaveBeenCalledTimes(1));
    const [addressId, payload] = mockUpdateAddressAction.mock.calls[0]!;
    expect(addressId).toBe('a-99');
    expect(payload).toMatchObject({ name: '陳大文', line: '台北市信義區松壽路 9 號' });
  });

  it('g-5c 點「刪除」→ confirm 確認後 deleteAddressAction(該筆 id)(對齊 design L362-363)', async () => {
    renderTab([makeAddr({ id: 'a-77' })]);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(mockDeleteAddressAction).toHaveBeenCalledTimes(1));
    expect(mockDeleteAddressAction).toHaveBeenCalledWith('a-77');
  });

  it('g-5c 刪除 confirm 取消(回 false)→ 不呼叫 deleteAddressAction(對齊 design L363)', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    renderTab([makeAddr({ id: 'a-77' })]);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(mockDeleteAddressAction).not.toHaveBeenCalled();
  });

  it('g-5c 同一時間只開一個表單:開新增後點編輯 → 切換為編輯(新增表單收合)', () => {
    const { container } = renderTab([makeAddr()]);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    expect(screen.getByText('新增地址')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    // 單一 addrEdit state:切到編輯、新增 heading 消失、只剩一個 inline form
    expect(screen.queryByText('新增地址')).toBeNull();
    expect(screen.getByText('編輯地址')).toBeTruthy();
    expect(container.querySelectorAll('.acc-inline-form').length).toBe(1);
  });

  it('純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 地址)', () => {
    const { container } = renderTab([]);
    expect(container.querySelectorAll('.acc-addr').length).toBe(0);
  });

  // 手機捲動修復(Sean 08-06 回報「新增/編輯沒有自動捲到表單」)—— 根因是 block:'nearest' 在
  // 元素已露一點點時完全不捲;下面兩條分別鎖住「捲去哪」與「捲完之後誰拿到焦點」,
  // 不是只斷言「有被呼叫過」(那樣把 'start' 改回 'nearest' 照樣綠)。
  it('g-5c 開表單 → scrollIntoView 帶 block:"start"(非 "nearest"),且捲的是 .acc-inline-form 本身', () => {
    renderTab([]);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    const spy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    // 🔴 R1 抓到:mock 掛在 Element.prototype 上,只斷言「有人用 start 捲過」的話,
    //    把 ref 移到 .acc-section(整個分頁)照樣綠 —— 捲錯元素但測試看不出來。
    //    contexts[0] = 第一次呼叫的 this,釘住捲的到底是誰。
    const target = spy.mock.contexts[0] as HTMLElement | undefined;
    expect(target?.className, 'scrollIntoView 捲的不是 .acc-inline-form 包裹層').toContain(
      'acc-inline-form',
    );
  });

  // 🔴 Sean 2026-08-07 拍板 Q1=A:焦點落**容器**、不落輸入欄(與 ADR-0007「手機不會在開面板時
  //    自動跳鍵盤」一致)。下面這條同時釘正面(容器拿到焦點、帶 preventScroll)與**反面**
  //    (沒有任何輸入欄拿到焦點)—— 只寫正面的話,改成 focus 第一個 input 照樣綠。
  it('g-5c 開表單 → 焦點落 .acc-inline-form 容器(帶 preventScroll),且沒有任何輸入欄被聚焦', () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const { container } = renderTab([]);
      fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
      const wrap = container.querySelector('.acc-inline-form') as HTMLElement;
      expect(document.activeElement, '焦點不在表單容器上').toBe(wrap);
      // (R2 nit:原本這裡還有一條 `tagName === 'DIV'`,但上一行 `toBe(wrap)` 成立時它恆真、
      //  零額外判別力 ⇒ 刪掉。真正擋住「焦點落輸入欄」的就是上一行。)
      // 容器要真的可程式聚焦,否則 focus() 是 no-op、上面兩條會靠 body 以外的巧合成立。
      expect(wrap.getAttribute('tabindex'), '容器沒有 tabindex=-1 ⇒ focus() 是 no-op').toBe('-1');
      // preventScroll 與「誰被 focus」釘成同一次呼叫(toHaveBeenCalledWith 任一次符合即過、太鬆)。
      const idx = focusSpy.mock.contexts.indexOf(wrap);
      expect(idx, '容器從來沒被 focus() 呼叫過').toBeGreaterThanOrEqual(0);
      expect(
        focusSpy.mock.calls[idx]?.[0],
        'focus 容器的那一次沒帶 preventScroll ⇒ 會與 smooth 捲動打架',
      ).toMatchObject({ preventScroll: true });
    } finally {
      focusSpy.mockRestore();
    }
  });

  // aria-label 是**在 AddressTab 手寫的第二份字面**,真正的標題在 InlineAddressForm 的 <h4>。
  // 兩處不同步時讀屏會念到與畫面不符的東西,而且沒有任何型別或 lint 會抓 ⇒ 用測試釘住。
  it('g-5c 容器 aria-label 與表單 <h4> 標題同字面(新增/編輯兩態)', () => {
    const { container } = renderTab([makeAddr()]);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增地址' }));
    let wrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(wrap.getAttribute('aria-label')).toBe(container.querySelector('.acc-inline-form h4')?.textContent);
    expect(wrap.getAttribute('aria-label')).toBe('新增地址');
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    wrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(wrap.getAttribute('aria-label')).toBe(container.querySelector('.acc-inline-form h4')?.textContent);
    expect(wrap.getAttribute('aria-label')).toBe('編輯地址');
  });

  // 🔴 R1 抓到:上面全走「新增」路徑,但 Sean 回報的症狀含**編輯**,而編輯態的表單是
  //    渲染在該筆卡片底下的**另一個 JSX 節點**(共用同一顆 ref)。編輯路徑要自己一條。
  // 🔴 R2 抓到:本片把焦點從觸發鈕搶走卻沒還 ⇒ 關掉表單後焦點掉到 <body>,
  //    鍵盤使用者得從文件頂端重新 Tab。改動**之前**焦點本來就留在觸發鈕上,這是本片新造的退步。
  it('g-5c 關掉表單 → 焦點還給觸發它的那顆鈕(不是掉到 body)', () => {
    renderTab([]);
    const addBtn = screen.getByRole('button', { name: '＋ 新增地址' });
    addBtn.focus();
    fireEvent.click(addBtn);
    expect(document.activeElement, '開表單時焦點沒進容器 ⇒ 本條前提失效').not.toBe(addBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.activeElement, '關表單後焦點沒還給「＋ 新增地址」鈕').toBe(addBtn);
  });

  // 🔴 R2 抓到:`useRevealForm` 的**存在理由**(依賴收 state 物件本身、不是 boolean)原本零覆蓋 ——
  //    把依賴改成 `[!!openState]` 時上面每一條都照樣綠,因為它們全是 `null → 物件`(boolean 也會翻)。
  //    只有「開著編輯 A、直接點編輯 B」才是 `物件 → 另一個物件`,boolean 在那裡不變、effect 不重跑。
  it('g-5c 開著編輯 A 直接點編輯 B → 重新捲到 B 並聚焦 B(依賴收物件、不是 boolean)', () => {
    const spy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const { container } = renderTab([
      makeAddr({ id: 'a-1', name: '甲' }),
      makeAddr({ id: 'a-2', name: '乙' }),
    ]);
    const editButtons = screen.getAllByRole('button', { name: '編輯' });
    fireEvent.click(editButtons[0]!);
    const firstWrap = container.querySelector('.acc-inline-form') as HTMLElement;
    const callsAfterA = spy.mock.contexts.length;
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[1]!);
    const secondWrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(secondWrap, 'A→B 之後表單容器沒有換成新的節點 ⇒ 本條前提失效').not.toBe(firstWrap);
    expect(
      spy.mock.contexts.length,
      'A→B 沒有再捲一次 ⇒ effect 沒重跑(依賴退化成 boolean 了)',
    ).toBeGreaterThan(callsAfterA);
    expect(spy.mock.contexts.at(-1), '最後一次捲的不是 B 的表單容器').toBe(secondWrap);
    expect(document.activeElement, 'A→B 之後焦點沒跟到 B 的表單容器').toBe(secondWrap);
  });

  it('g-5c 點「編輯」→ 同樣捲到該筆的 .acc-inline-form 並聚焦容器', () => {
    const spy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const { container } = renderTab([makeAddr({ id: 'a-1' })]);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    const wrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(spy.mock.contexts[0], '編輯態捲的不是該筆的 .acc-inline-form').toBe(wrap);
    expect(document.activeElement, '編輯態焦點沒落在表單容器上').toBe(wrap);
  });
});

// 🔴 2026-08-08(P-205-STOP ③):存檔成功的收尾**由本層做**,且順序是「先關表單、再重讀」——
//    `setAddrEdit(null)` 把表單 unmount 之後,`router.refresh()` 由**存活的本元件**發出,
//    與同檔已知正常的「刪除」路徑同形。舊寫法兩件事都在表單自己的 transition 裡 =
//    發出重讀指令的元件把自己拆掉。
// ⚠️ **順序不是契約、也守不到**:`setAddrEdit(null)` 是 setState、不是同步 unmount ⇒ 兩行對調在
//    React 語意下等價,突變實測(R3)**零測試會紅,而那是正確的**、不是守門缺口。
//    本族真正守得住的是「子層不自己 refresh(R1/R2)」與「父層有 refresh(R4)」;
//    「這樣改就修好了那個 bug」**要真瀏覽器**(本 worktree 無 env ⇒ 主視窗認領驗證)。
describe('存檔成功由父層收尾(新增後不刷新的修法)', () => {
  it('🔴 表單回報 onSaved → 表單收合 + router.refresh() 被呼叫', async () => {
    mockRefresh.mockClear();
    mockAddAddressAction.mockResolvedValue({ ok: true });
    renderTab([]);
    fireEvent.click(screen.getByText('＋ 新增地址'));
    expect(document.querySelector('.acc-inline-form'), '前提:表單要真的開了').not.toBeNull();

    // 欄位選取沿用 InlineAddressForm.test 的既有慣例(placeholder,非 label)
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王小明' } });
    fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '0912345678' } });
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), {
      target: { value: '台北市信義區信義路五段7號' },
    });
    fireEvent.change(screen.getByPlaceholderText('example@mail.com'), { target: { value: 'a@b.tw' } });
    fireEvent.click(screen.getByText('儲存'));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    // 表單已收合(= 父層 setAddrEdit(null) 有跑)
    expect(document.querySelector('.acc-inline-form')).toBeNull();
  });
});
