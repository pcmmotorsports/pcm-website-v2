// @vitest-environment jsdom
//
// VehiclesTab smoke(g-6a 唯讀列表 + g-6b 新增表單 + g-6c 編輯/刪除/設主車)— 前台 regression 安全網。
//
// 驗:
// - 標題「我的愛車」+ acc-section 殼(data-tab="vehicles")+「＋ 新增車輛」鈕(g-6b)
// - 有車 → 渲染 .acc-bike 卡(h3 車型 + .acc-bike-meta);isPrimary → .acc-bike-primary + Primary/Secondary
// - .acc-bike-stats 條件渲染:km/mods/service 任一有值 → 渲染;全空 → 不渲染
// - 多筆全渲染 / 空清單 → design 空狀態字面「尚未新增愛車 — 新增後可記錄改裝履歷。」
// - g-6b:點「＋ 新增車輛」→ 開 InlineVehicleForm(heading「新增車輛」)
// - g-6c:每卡 .acc-addr-actions「編輯/刪除」鈕;點編輯 → 開編輯模式(heading「編輯車輛」+ 帶入既有值)
// - g-6c:編輯 submit → updateVehicleAction(該筆 id, payload);點刪除 → confirm 確認 deleteVehicleAction、取消則不刪(design L400)
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 愛車)
//
// mock '@/app/account/vehicle/actions'(server action、transitively server-only 在 jsdom 爆)+ next/navigation。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUpdateVehicleAction, mockDeleteVehicleAction } = vi.hoisted(() => ({
  mockUpdateVehicleAction: vi.fn(),
  mockDeleteVehicleAction: vi.fn(),
}));
vi.mock('@/app/account/vehicle/actions', () => ({
  addVehicleAction: vi.fn(),
  updateVehicleAction: mockUpdateVehicleAction,
  deleteVehicleAction: mockDeleteVehicleAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// jsdom 不實作 scrollIntoView(g-6c inline-form 包裹層的開表單 effect 觸發會爆);就地補。
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  mockUpdateVehicleAction.mockReset().mockResolvedValue({ ok: true });
  mockDeleteVehicleAction.mockReset().mockResolvedValue({ ok: true });
  // jsdom confirm 預設未實作;預設放行、單一測試 mockReturnValueOnce(false) 覆寫驗取消。
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  // 開表單捲動修復(2026-08-07):每測試前清空呼叫紀錄,避免跨測試累積污染斷言。
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
});

import { VehiclesTab } from './VehiclesTab';
import type { CustomerVehicle } from '@pcm/domain';

afterEach(cleanup);

function makeVeh(over: Partial<CustomerVehicle> = {}): CustomerVehicle {
  return {
    id: 'v1',
    customerUserId: 'u1',
    isPrimary: false,
    name: 'YAMAHA YZF-R6',
    year: '2022',
    engine: 'RJ27-xxxxx',
    km: '12,340 km',
    mods: '7 件',
    service: '2026-03-12',
    dictBrandName: null,
    dictModelName: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('VehiclesTab(g-6a 唯讀 + g-6b 新增 + g-6c 編輯/刪除)', () => {
  it('標題「我的愛車」+ acc-section 殼 +「＋ 新增車輛」鈕', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(screen.getByText('我的愛車')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="vehicles"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 新增車輛' })).toBeTruthy();
  });

  it('有車 → .acc-bike 卡(車型 + 年份·引擎號 meta)', () => {
    const { container } = render(<VehiclesTab vehicles={[makeVeh()]} />);
    expect(screen.getByText('YAMAHA YZF-R6')).toBeTruthy();
    expect(container.querySelector('.acc-bike-meta')?.textContent).toBe('2022 · 引擎號 RJ27-xxxxx');
  });

  it('isPrimary → .acc-bike-primary class + Primary 標籤;非主車 → Secondary', () => {
    const { container } = render(
      <VehiclesTab vehicles={[makeVeh({ id: 'v1', isPrimary: true }), makeVeh({ id: 'v2', isPrimary: false })]} />,
    );
    const cards = container.querySelectorAll('.acc-bike');
    expect(cards.length).toBe(2);
    expect(cards[0]?.classList.contains('acc-bike-primary')).toBe(true);
    expect(cards[1]?.classList.contains('acc-bike-primary')).toBe(false);
    expect(screen.getByText('Primary')).toBeTruthy();
    expect(screen.getByText('Secondary')).toBeTruthy();
  });

  it('stats 條件渲染:km/mods/service 全空 → 不渲染 .acc-bike-stats', () => {
    const { container } = render(
      <VehiclesTab vehicles={[makeVeh({ km: '', mods: '', service: null })]} />,
    );
    expect(container.querySelector('.acc-bike-stats')).toBeNull();
    expect(screen.getByText('YAMAHA YZF-R6')).toBeTruthy();
  });

  it('空清單 → 空狀態字面(design L613)', () => {
    render(<VehiclesTab vehicles={[]} />);
    expect(screen.getByText('尚未新增愛車 — 新增後可記錄改裝履歷。')).toBeTruthy();
  });

  it('g-6b:點「＋ 新增車輛」→ 開 InlineVehicleForm(heading「新增車輛」)', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(container.querySelector('.acc-inline-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    expect(screen.getByText('新增車輛')).toBeTruthy();
    expect(screen.getByPlaceholderText('YAMAHA YZF-R6')).toBeTruthy();
  });

  it('g-6c 每卡渲染 .acc-addr-actions「編輯/刪除」鈕(design L600-603)', () => {
    render(<VehiclesTab vehicles={[makeVeh()]} />);
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刪除' })).toBeTruthy();
  });

  it('g-6c 點「編輯」→ 開編輯模式(heading「編輯車輛」+ 帶入既有值 車型/年份/引擎號)', () => {
    render(<VehiclesTab vehicles={[makeVeh({ name: '陳大文的 R1', year: '2020', engine: 'RN49-yyyyy' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByText('編輯車輛')).toBeTruthy();
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe('陳大文的 R1');
    expect((screen.getByPlaceholderText('2022') as HTMLInputElement).value).toBe('2020');
    expect((screen.getByPlaceholderText('RJ27-xxxxx') as HTMLInputElement).value).toBe('RN49-yyyyy');
  });

  it('g-6c 編輯 submit → updateVehicleAction(該筆 id, payload)(id 綁 parent closure)', async () => {
    render(<VehiclesTab vehicles={[makeVeh({ id: 'v-77' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.submit(screen.getByText('儲存').closest('form')!);
    await waitFor(() => expect(mockUpdateVehicleAction).toHaveBeenCalledTimes(1));
    expect(mockUpdateVehicleAction.mock.calls[0]![0]).toBe('v-77');
  });

  it('g-6c 點「刪除」→ confirm 確認後 deleteVehicleAction(該筆 id)(對齊 design L400)', async () => {
    render(<VehiclesTab vehicles={[makeVeh({ id: 'v-77' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(mockDeleteVehicleAction).toHaveBeenCalledTimes(1));
    expect(mockDeleteVehicleAction).toHaveBeenCalledWith('v-77');
  });

  it('g-6c 刪除 confirm 取消(回 false)→ 不呼叫 deleteVehicleAction(對齊 design L400)', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<VehiclesTab vehicles={[makeVeh({ id: 'v-77' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(mockDeleteVehicleAction).not.toHaveBeenCalled();
  });

  it('g-6c 同一時間只開一個表單:開新增後點編輯 → 切換為編輯(新增表單收合)', () => {
    const { container } = render(<VehiclesTab vehicles={[makeVeh()]} />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    expect(screen.getByText('新增車輛')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.queryByText('新增車輛')).toBeNull();
    expect(screen.getByText('編輯車輛')).toBeTruthy();
    expect(container.querySelectorAll('.acc-inline-form').length).toBe(1);
  });

  it('純 prop 驅動:空 prop 無任何 .acc-bike 卡(不洩 design mock 愛車)', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(container.querySelectorAll('.acc-bike').length).toBe(0);
  });

  // 手機捲動修復(Sean 08-06 回報「新增/編輯沒有自動捲到表單」)—— 根因是 block:'nearest' 在
  // 元素已露一點點時完全不捲;下面兩條分別鎖住「捲去哪」與「捲完之後誰拿到焦點」,
  // 不是只斷言「有被呼叫過」(那樣把 'start' 改回 'nearest' 照樣綠)。
  it('g-6c 開表單 → scrollIntoView 帶 block:"start"(非 "nearest"),且捲的是 .acc-inline-form 本身', () => {
    render(<VehiclesTab vehicles={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    const spy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    // 🔴 R1 抓到:mock 掛在 Element.prototype 上,只斷言「有人用 start 捲過」的話,
    //    把 ref 移到 .acc-section(整個分頁)照樣綠 —— 捲錯元素但測試看不出來。
    const target = spy.mock.contexts[0] as HTMLElement | undefined;
    expect(target?.className, 'scrollIntoView 捲的不是 .acc-inline-form 包裹層').toContain(
      'acc-inline-form',
    );
  });

  // 🔴 Sean 2026-08-07 拍板 Q1=A:焦點落**容器**、不落輸入欄(與 ADR-0007「手機不會在開面板時
  //    自動跳鍵盤」一致)。正面 + 反面各釘一次,只寫正面的話改成 focus 第一個 input 照樣綠。
  it('g-6c 開表單 → 焦點落 .acc-inline-form 容器(帶 preventScroll),且沒有任何輸入欄被聚焦', () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const { container } = render(<VehiclesTab vehicles={[]} />);
      fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
      const wrap = container.querySelector('.acc-inline-form') as HTMLElement;
      expect(document.activeElement, '焦點不在表單容器上').toBe(wrap);
      // (R2 nit:原本這裡還有一條 `tagName === 'DIV'`,上一行 `toBe(wrap)` 成立時它恆真 ⇒ 刪掉。)
      expect(wrap.getAttribute('tabindex'), '容器沒有 tabindex=-1 ⇒ focus() 是 no-op').toBe('-1');
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

  // 🔴 dict 模式(有字典 = **正式站預設**)另走一條:它的第一欄是 VehicleCombo 不是原生 input。
  //    Q1=A 之下焦點本來就不該碰任何一種輸入欄 —— 這條把「連 combobox 也不准被聚焦」釘死,
  //    否則哪天有人改回「focus 第一個 input」,只有 free 模式那條會紅、dict 這條會漏。
  it('g-6c dict 模式(有字典 = 正式站預設)開表單 → 焦點仍在容器,combobox 不被聚焦', () => {
    const brands = [
      { id: 'yamaha', name: 'YAMAHA', models: [{ id: 'r6', name: 'YZF-R6', years: [2020] }] },
    ];
    const { container } = render(<VehiclesTab vehicles={[]} vehicleBrands={brands} />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    const combos = screen.getAllByRole('combobox');
    expect(combos.length, 'dict 模式沒渲染出 combobox ⇒ 本條前提失效').toBeGreaterThan(0);
    expect(document.activeElement, '焦點跑到 combobox 上了').not.toBe(combos[0]);
    expect(document.activeElement).toBe(container.querySelector('.acc-inline-form'));
  });

  // aria-label 是**在 VehiclesTab 手寫的第二份字面**,真正的標題在 InlineVehicleForm 的 <h4>。
  it('g-6c 容器 aria-label 與表單 <h4> 標題同字面(新增/編輯兩態)', () => {
    const { container } = render(<VehiclesTab vehicles={[makeVeh()]} />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    let wrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(wrap.getAttribute('aria-label')).toBe(container.querySelector('.acc-inline-form h4')?.textContent);
    expect(wrap.getAttribute('aria-label')).toBe('新增車輛');
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    wrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(wrap.getAttribute('aria-label')).toBe(container.querySelector('.acc-inline-form h4')?.textContent);
    expect(wrap.getAttribute('aria-label')).toBe('編輯車輛');
  });

  // 🔴 R1 抓到:上面全走「新增」路徑,但 Sean 回報的症狀含**編輯**,而編輯態的表單是
  //    渲染在該筆卡片底下的**另一個 JSX 節點**(共用同一顆 ref)。編輯路徑要自己一條。
  // 🔴 R2 抓到:本片把焦點從觸發鈕搶走卻沒還 ⇒ 關掉表單後焦點掉到 <body>。
  it('g-6c 關掉表單 → 焦點還給觸發它的那顆鈕(不是掉到 body)', () => {
    render(<VehiclesTab vehicles={[]} />);
    const addBtn = screen.getByRole('button', { name: '＋ 新增車輛' });
    addBtn.focus();
    fireEvent.click(addBtn);
    expect(document.activeElement, '開表單時焦點沒進容器 ⇒ 本條前提失效').not.toBe(addBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.activeElement, '關表單後焦點沒還給「＋ 新增車輛」鈕').toBe(addBtn);
  });

  // 🔴 R2 抓到:`useRevealForm` 的**存在理由**(依賴收 state 物件本身、不是 boolean)原本零覆蓋 ——
  //    把依賴改成 `[!!openState]` 時上面每一條都照樣綠,因為它們全是 `null → 物件`(boolean 也會翻)。
  //    只有「開著編輯 A、直接點編輯 B」才是 `物件 → 另一個物件`,boolean 在那裡不變、effect 不重跑。
  it('g-6c 開著編輯 A 直接點編輯 B → 重新捲到 B 並聚焦 B(依賴收物件、不是 boolean)', () => {
    const spy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const { container } = render(
      <VehiclesTab vehicles={[makeVeh({ id: 'v-1', name: '甲車' }), makeVeh({ id: 'v-2', name: '乙車' })]} />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0]!);
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

  it('g-6c 點「編輯」→ 同樣捲到該筆的 .acc-inline-form 並聚焦容器', () => {
    const spy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const { container } = render(<VehiclesTab vehicles={[makeVeh({ id: 'v-1' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    const wrap = container.querySelector('.acc-inline-form') as HTMLElement;
    expect(spy.mock.contexts[0], '編輯態捲的不是該筆的 .acc-inline-form').toBe(wrap);
    expect(document.activeElement, '編輯態焦點沒落在表單容器上').toBe(wrap);
  });
});
