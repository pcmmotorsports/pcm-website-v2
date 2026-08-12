// @vitest-environment jsdom
// order-filter-controls.test.tsx — D-1b 篩選互動核心(值班台 MF-1 修復驗證:連勾不丟值)。
// 🔴 測試設計:mock 的 useRouter.replace 不觸發任何 re-render/props 更新=模擬 RSC 往返未完成
// (部署延遲數百 ms)的窗;此窗內連續互動若基底取 stale 快照就會互相蓋寫——斷言全數保留。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { OrderFilterControls } from './order-filter-controls';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

/** #347-3c-2:server 算好的日期選項(client 不碰時鐘 ⇒ 測試裡就是一組固定值)。 */
const DATE_OPTIONS = [
  { key: 'm1', label: '近一個月', fromYmd: '2026-07-10', toYmd: '2026-08-10' },
  { key: 'm6', label: '近半年', fromYmd: '2026-02-10', toYmd: '2026-08-10' },
];

const PROPS = {
  datePresetOptions: DATE_OPTIONS,
  paymentOptions: [{ value: 'paid', label: '已付款' }],
  fulfillmentOptions: [{ value: 'shipped', label: '已出貨' }],
  sourceOptions: [
    { value: 'web', label: '網站' },
    { value: 'manual_line', label: 'LINE' },
  ],
  channelOptions: [{ value: 'tappay', label: '線上刷卡' }],
  initial: { pay: '', ful: '', src: [], ch: [], showUnpaidCard: '', dateFrom: '', dateTo: '', datePreset: 'm6' },
};

beforeEach(() => replace.mockClear());
afterEach(cleanup);

function nthButton(getAllByRole: ReturnType<typeof render>['getAllByRole'], index: number) {
  const el = getAllByRole('button')[index];
  if (!el) throw new Error(`button[${index}] 不存在`);
  return el;
}

function openPanel(getAllByRole: ReturnType<typeof render>['getAllByRole'], index: number) {
  fireEvent.click(nthButton(getAllByRole, index));
}

describe('OrderFilterControls — MF-1 連勾不丟值(props 凍結窗內)', () => {
  // 🔴 A9w2:這一組原本拿「商品狀態」軸當載具,而那個軸隨九碼退場已下架。
  //    被測的行為(多勾選軸的連勾競態、被超越回音不採用)**仍然活著**於來源/管道兩軸
  //    ⇒ 改用來源軸重寫,不是刪掉 —— 刪掉會讓 MF-1 那條修復從此無人看守。
  //    移除後觸發鈕只剩 [來源, 管道](單選軸無 button)⇒ index 0=來源、1=管道。
  it('同軸快速連勾兩項 → 第二次 replace 帶兩值、兩 checkbox 皆勾(無回彈)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.click(r.getByLabelText('LINE'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?order_source=web&order_source=manual_line',
      { scroll: false },
    );
    expect((r.getByLabelText('網站') as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText('LINE') as HTMLInputElement).checked).toBe(true);
  });

  it('跨軸交錯(來源→付款單選→管道)→ 最終 replace 三軸俱在、URL 無 page/r', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    openPanel(r.getAllByRole, 1);
    fireEvent.click(r.getByLabelText('線上刷卡'));
    expect(replace).toHaveBeenLastCalledWith(
      '/orders?payment_status=paid&order_source=web&payment_channel=tappay',
      { scroll: false },
    );
  });

  it('取消勾選 → 該值移除;全清 → 乾淨 /orders', () => {
    const r = render(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, src: ['web'] }} />,
    );
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    expect(replace).toHaveBeenLastCalledWith('/orders', { scroll: false });
  });

  it('已勾數 badge:未勾顯「全部」、勾 2 顯 2', () => {
    const r = render(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, src: ['web', 'manual_line'] }}
      />,
    );
    expect(nthButton(r.getAllByRole, 0).textContent).toContain('2');
    r.unmount();
    const clean = render(<OrderFilterControls {...PROPS} />);
    expect(nthButton(clean.getAllByRole, 0).textContent).toContain('全部');
  });

  it('nit-1:push 後餵舊回音 props → state 不回退;最終收斂回音 → 採用(no-op)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.click(r.getByLabelText('LINE'));
    // 被超越舊導航的 RSC 仍被 commit=舊回音(只含第一勾)→ 不採、B 不掉勾
    r.rerender(<OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, src: ['web'] }} />);
    expect((r.getByLabelText('LINE') as HTMLInputElement).checked).toBe(true);
    // 最終推送的收斂回音 → 採用(內容相同=no-op)
    r.rerender(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, src: ['web', 'manual_line'] }}
      />,
    );
    expect((r.getByLabelText('網站') as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText('LINE') as HTMLInputElement).checked).toBe(true);
  });

  it('🔴 A9w2:商品狀態軸真的不見了(下架後不得再渲染那個面板)', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    expect(r.queryByText('商品狀態')).toBeNull();
    // 觸發鈕只剩兩顆多勾選軸(來源 / 管道);多一顆 = 有人把九碼軸掛回來了。
    expect(r.getAllByRole('button').length).toBe(2);
  });
});

// ── #347-B(Sean 拍板 Q-347-B1=B):A10c1 單號搜尋框與 A10c2 供應商單號搜尋框,
//    連同它們的 flag、草稿 state、競態與 form 送出入口的整組測試(三個 describe)**已刪除**。
//    兩者的能力併入關鍵字搜尋(`admin_search_orders` 的 #1 新單號 / #12 舊單號 / #11 供應商單號)。
// 🔴 本元件自此**沒有任何文字輸入框** ⇒「打字中的草稿不得被回音清空」那一族坑
//    也隨之消失,不是被略過不測。

describe('🔴 M-4b 生命週期 L6 — 「顯示刷卡未付款」勾選框(client 端 href 是第二份實作,要自己的測試)', () => {
  // code-reviewer important 4:本片原本只測了 server 端的 buildOrderListHref,
  // 而這個元件裡的 href() 是**獨立的第二份**實作 —— 四個突變(刪掉 href entry / onChange 寫錯值 /
  // checked 判斷放寬 / 整個 checkbox 不 render)當時全綠。以下三條就是釘那份。
  it('L6-C1 預設沒勾(= 隱藏生效)', () => {
    const { getByLabelText } = render(<OrderFilterControls {...PROPS} />);
    expect((getByLabelText(/顯示刷卡未付款/) as HTMLInputElement).checked).toBe(false);
  });

  it('L6-C2 勾起來 → URL 帶 show_unpaid_card=1', () => {
    const { getByLabelText } = render(<OrderFilterControls {...PROPS} />);
    fireEvent.click(getByLabelText(/顯示刷卡未付款/));
    expect(replace.mock.calls[0]?.[0]).toContain('show_unpaid_card=1');
  });

  it("🔴 L6-C4 state 是 truthy 但不是 '1'(例如 'true')→ 勾**不得**打勾", () => {
    // 與 parser 的 fail-safe 同一條規則:只有字面 '1' 算開。
    // 沒有這條的話,把 checked 放寬成 Boolean(state.showUnpaidCard) 的突變會存活(實測過)。
    const { getByLabelText } = render(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, showUnpaidCard: 'true' }} />,
    );
    expect((getByLabelText(/顯示刷卡未付款/) as HTMLInputElement).checked).toBe(false);
  });

  it('🔴 L6-C3 勾起來之後再改其他篩選,開關不得被丟掉', () => {
    const { getByLabelText, getAllByRole } = render(<OrderFilterControls {...PROPS} />);
    fireEvent.click(getByLabelText(/顯示刷卡未付款/));
    replace.mockClear();
    const paySelect = getAllByRole('combobox')[0];
    if (!paySelect) throw new Error('付款狀態 select 不存在');
    fireEvent.change(paySelect, { target: { value: 'paid' } });
    expect(replace.mock.calls[0]?.[0]).toContain('show_unpaid_card=1');
  });
});

describe('#347-3c-1 日期兩軸的 state 透傳(第二個 URL builder 的守門)', () => {
  // 🔴🔴 **為什麼這一組必須存在**:`buildOrderListHref` 的編譯期窮舉守門**管不到本檔** ——
  //    本檔的 `href()` 是**第二個 URL builder**,自己列 param。R1 抓到的就是這個缺口:
  //    分享一條 `/orders?date_from=…` 的網址,使用者一動任何下拉 ⇒ `router.replace(href(state))`
  //    ⇒ 日期**靜默消失**,而畫面上什麼提示都沒有(本檔頭已為別的軸記過兩次同一個坑)。
  // ⚠️ 本片**沒有可見控制項**(下拉是 3c-2);這裡守的是「進得來、出得去」。
  const WITH_DATES = {
    ...PROPS,
    initial: { ...PROPS.initial, dateFrom: '2026-02-10', dateTo: '2026-08-10' },
  };

  it('🔴 改別的篩選軸時,日期兩軸原封帶著走', () => {
    // 突變:把 `href()` 裡的 DATE_FROM_PARAM / DATE_TO_PARAM 兩列刪掉 ⇒ 這格紅。
    const { getAllByRole } = render(<OrderFilterControls {...WITH_DATES} />);
    fireEvent.change(getAllByRole('combobox')[0]!, { target: { value: 'paid' } });
    const url = replace.mock.calls.at(-1)?.[0] as string;
    const qs = new URLSearchParams(url.split('?')[1] ?? '');
    expect(qs.get('payment_status'), '前提:這次改的是付款軸').toBe('paid');
    expect(qs.get('date_from')).toBe('2026-02-10');
    expect(qs.get('date_to')).toBe('2026-08-10');
  });

  it('沒有日期時不憑空長出參數(空字串不進 URL)', () => {
    const { getAllByRole } = render(<OrderFilterControls {...PROPS} />);
    fireEvent.change(getAllByRole('combobox')[0]!, { target: { value: 'paid' } });
    const url = replace.mock.calls.at(-1)?.[0] as string;
    expect(url).not.toContain('date_from');
    expect(url).not.toContain('date_to');
  });
});

describe('#347-3c-2 日期下拉(選中的選項 == 生效的區間)', () => {
  const withPreset = (datePreset: string, dateFrom = '', dateTo = '') => ({
    ...PROPS,
    initial: { ...PROPS.initial, datePreset, dateFrom, dateTo },
  });

  it('🔴 選一個預設 ⇒ URL 直接帶上**那一格 server 算好的區間**', () => {
    // 突變:`applyDatePreset` 只寫 `datePreset` 而不寫 `dateFrom/dateTo` ⇒ 這格紅,
    // 而症狀正是「下拉顯示近一個月、列表卻還是舊區間」。
    const { container } = render(<OrderFilterControls {...withPreset('m6')} />);
    const select = container.querySelector('#order-date-preset') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'm1' } });
    const qs = new URLSearchParams((replace.mock.calls.at(-1)?.[0] as string).split('?')[1] ?? '');
    expect(qs.get('date_from')).toBe('2026-07-10');
    expect(qs.get('date_to')).toBe('2026-08-10');
  });

  it('🔴🔴 「自訂」是逃生口:**在畫面上真的選它**就出現兩個日期輸入', () => {
    // 🔴 R1 must-fix 2:第一版是 `rerender` 換 prop —— 那證的是「prop 說 custom 就渲染輸入框」,
    //    **不是**「員工選得到自訂」。真實路徑走的是 select 的 onChange → 本地 state。
    //    預設會藏掉半年前的單,逃生口到不到得了是這一片最要緊的事,不能只靠 prop 證。
    //    突變:`applyDatePreset` 對 `custom` 那條 early return 拿掉 ⇒ 這格紅。
    const { container } = render(<OrderFilterControls {...withPreset('m6', '2026-02-10', '2026-08-10')} />);
    expect(container.querySelector('#order-date-from'), '非自訂時不該出現輸入框').toBeNull();
    fireEvent.change(container.querySelector('#order-date-preset') as HTMLSelectElement, {
      target: { value: 'custom' },
    });
    expect(container.querySelector('#order-date-from'), '選了自訂卻沒有輸入框 = 逃生口不通').not.toBeNull();
    expect(container.querySelector('#order-date-to')).not.toBeNull();
  });

  it('🔴🔴 自訂把兩格都清空 ⇒ **當場退回近半年**(不得留下畫面空白、列表卻篩近半年的分岔)', () => {
    // 🔴 R1 must-fix 1 構造出來的真分岔:兩格皆空 ⇒ URL 不帶日期 ⇒ server 重套近半年,
    //    而 client 回音被 prop-sync 拒絕 ⇒ 畫面停在「自訂 + 空白」= 員工讀成不限期間,
    //    列表卻篩著近半年,而且**永不自癒**。⇒ 在 client 端就把這個歧義態消掉。
    //    突變:拿掉 `applyCustomDate` 的兩格皆空分支 ⇒ 這格紅。
    const { container } = render(<OrderFilterControls {...withPreset('custom', '2020-01-01', '')} />);
    fireEvent.change(container.querySelector('#order-date-from') as HTMLInputElement, {
      target: { value: '' },
    });
    const url = replace.mock.calls.at(-1)?.[0] as string;
    const qs = new URLSearchParams(url.split('?')[1] ?? '');
    // 退回預設 = URL 帶著近半年那組日期(而不是裸 /orders)。
    expect(qs.get('date_from')).toBe('2026-02-10');
    expect(qs.get('date_to')).toBe('2026-08-10');
    // 而且下拉會**看得見地**跳回近半年(state 與 URL 同一次寫入)。
    expect((container.querySelector('#order-date-preset') as HTMLSelectElement).value).toBe('m6');
  });

  it('只清空其中一格 ⇒ 那一側不限、不觸發退回(「這天之後的全部」是合理需求)', () => {
    const { container } = render(<OrderFilterControls {...withPreset('custom', '2020-01-01', '2026-08-10')} />);
    fireEvent.change(container.querySelector('#order-date-to') as HTMLInputElement, {
      target: { value: '' },
    });
    const qs = new URLSearchParams((replace.mock.calls.at(-1)?.[0] as string).split('?')[1] ?? '');
    expect(qs.get('date_from')).toBe('2020-01-01');
    expect(qs.has('date_to')).toBe(false);
  });

  it('🔴 自訂改起日 ⇒ 直接生效(而且不會把迄日一起洗掉)', () => {
    const { container } = render(<OrderFilterControls {...withPreset('custom', '2020-01-01', '2026-08-10')} />);
    fireEvent.change(container.querySelector('#order-date-from') as HTMLInputElement, {
      target: { value: '2019-06-01' },
    });
    const qs = new URLSearchParams((replace.mock.calls.at(-1)?.[0] as string).split('?')[1] ?? '');
    expect(qs.get('date_from')).toBe('2019-06-01');
    expect(qs.get('date_to')).toBe('2026-08-10');
  });

  it('🔴 選單被設成不存在的值(jsdom 下 value 變空字串)⇒ **維持現況**,不得靜默清掉日期', () => {
    // ⚠️ 名稱精確化(R1 nit 7):HTML 規範下把 `<select>.value` 設成不存在的選項會讓它變 `''`,
    //    所以 handler 實際收到的是空字串。斷言仍有判別力(拿掉 guard 會 throw),但別讓名字說謊。
    // server/client 不同步時,「悄悄變成不限期間」比「什麼都不做」危險得多。
    const { container } = render(<OrderFilterControls {...withPreset('m6', '2026-02-10', '2026-08-10')} />);
    fireEvent.change(container.querySelector('#order-date-preset') as HTMLSelectElement, {
      target: { value: 'no-such-key' },
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('沒有選項時整塊不渲染(3c-1 的呼叫端還沒給 options)', () => {
    const { container } = render(
      <OrderFilterControls {...PROPS} datePresetOptions={[]} />,
    );
    expect(container.querySelector('#order-date-preset')).toBeNull();
  });
});
