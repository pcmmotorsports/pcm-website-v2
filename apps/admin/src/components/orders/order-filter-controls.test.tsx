// @vitest-environment jsdom
// order-filter-controls.test.tsx — D-1b 篩選互動核心(值班台 MF-1 修復驗證:連勾不丟值)。
// 🔴 測試設計:mock 的 useRouter.replace 不觸發任何 re-render/props 更新=模擬 RSC 往返未完成
// (部署延遲數百 ms)的窗;此窗內連續互動若基底取 stale 快照就會互相蓋寫——斷言全數保留。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { OrderFilterControls } from './order-filter-controls';
import { buildOrderListHref, PANEL_CLOSED, ORDER_DENSITY_DEFAULT } from '../../lib/orders/order-list-view';

const replace = vi.fn();
const refresh = vi.fn();
/** 掛載當下瀏覽器網址上的 query(`#741` 的碰撞判定要拿它當「之前」)。逐測可改。 */
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

/** #347-3c-2:server 算好的日期選項(client 不碰時鐘 ⇒ 測試裡就是一組固定值)。 */
const DATE_OPTIONS = [
  { key: 'm1', label: '近一個月', fromYmd: '2026-07-10', toYmd: '2026-08-10' },
  { key: 'm6', label: '近半年', fromYmd: '2026-02-10', toYmd: '2026-08-10' },
];

const PROPS = {
  datePresetOptions: DATE_OPTIONS,
  paymentOptions: [{ value: 'paid', label: '已付款' }],
  // 🔴 **四值都列**(不是只列一個):`<select>` 對「不在 options 裡的 value」會退回第一格,
  //    ⇒ 只列一個值時,「多值誤顯示第一個值」那個突變會**被 React 掩蓋成綠的**(實測過)。
  goodsAxisOptions: [
    { value: 'none', label: '未訂貨' },
    { value: 'ordered', label: '已向廠商訂貨' },
    { value: 'instock', label: '已到貨' },
    { value: 'shipped', label: '已出貨' },
  ],
  sourceOptions: [
    { value: 'web', label: '網站' },
    { value: 'manual_line', label: 'LINE' },
  ],
  channelOptions: [{ value: 'tappay', label: '線上刷卡' }],
  /** `#742`:預設四格皆 undefined = 當下網址沒有那四個鍵;要驗「不得吃掉」的那一格自己覆寫。 */
  carried: { pending: undefined, den: undefined, panel: undefined, customer: undefined },
  initial: { pay: '', goods: [], src: [], ch: [], showUnpaidCard: '', dateFrom: '', dateTo: '', datePreset: 'm6' },
};

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  currentSearch = '';
});
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

// 🔴 `#484` 片 B-1 引入的第一個**多值** producer(chip「未到貨」= none + ordered)。
//    R1 must-fix 2:上一版把它折成單一 string ⇒ 員工改任何其他篩選,兩個值**一起消失**,
//    列表從「未到貨 + 已付款」變成「全部 + 已付款」,而 chip 的反白還亮著、且不會自癒。
describe('#484 B-1 — 多值貨品軸不得被其他篩選洗掉', () => {
  const multi = {
    ...PROPS.initial,
    goods: ['none', 'ordered'] as readonly string[],
  };

  it('🔴 改別的軸時,goods_axis 兩個值都要跟著送出去', () => {
    const { getByLabelText } = render(<OrderFilterControls {...PROPS} initial={multi} />);
    // 動一個**別的**軸(付款狀態)—— 這正是上一版把貨品軸丟掉的那個動作。
    fireEvent.change(getByLabelText('付款狀態'), { target: { value: 'paid' } });
    const href = String(replace.mock.calls.at(-1)?.[0] ?? '');
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.getAll('goods_axis'), '貨品軸的兩個值沒有一起帶出去 = 篩選被靜默清掉').toEqual([
      'none',
      'ordered',
    ]);
    expect(params.get('payment_status')).toBe('paid');
  });

  it('多值時下拉顯示「全部」那一格(畫不出兩個值,選中態由 chip 負責)', () => {
    const { getByLabelText } = render(<OrderFilterControls {...PROPS} initial={multi} />);
    expect((getByLabelText('出貨狀態') as HTMLSelectElement).value).toBe('');
  });
});

describe('OrderFilterControls — `#741` segment cache key 碰撞才補 refresh', () => {
  // 🔴🔴 **這一組的三格是【一組】,不能只留會紅的那一格**:
  //    實驗組證明「該補的補了」,而**兩個對照組證明「不該補的沒補」**。
  //    只留實驗組的話,`if (…) router.refresh()` 改成無條件 `router.refresh()` **會全綠通過** ——
  //    而那正是 memory `reference_nextjs-duplicate-query-key-segment-collision` 明文禁止的做法
  //    (單值軸天然不碰撞,無條件 refresh = 每次操作都多查一次全表)。
  //
  // 🔴 **「最後一個」指的是 query string 上的出現順序**,不是選項在畫面上的順序:
  //    勾選是 `[...list, value]` 追加 ⇒ 先勾「網站」再勾「LINE」⇒ URL 上 LINE 在後。

  it('實驗組:取消【非最後】那個(網站)⇒ key 相同 ⇒ 補一次 refresh', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.click(r.getByLabelText('LINE'));
    expect(refresh).not.toHaveBeenCalled(); // 前兩發都不該補
    fireEvent.click(r.getByLabelText('網站')); // 取消非最後那個
    expect(replace).toHaveBeenLastCalledWith('/orders?order_source=manual_line', {
      scroll: false,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('對照組一:取消【最後】那個(LINE)⇒ key 不同 ⇒ 不補 refresh', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站'));
    fireEvent.click(r.getByLabelText('LINE'));
    fireEvent.click(r.getByLabelText('LINE')); // 取消最後那個
    expect(replace).toHaveBeenLastCalledWith('/orders?order_source=web', { scroll: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('對照組二:單值軸(付款狀態)天然不碰撞 ⇒ 不補 refresh', () => {
    const r = render(<OrderFilterControls {...PROPS} />);
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    expect(replace).toHaveBeenLastCalledWith('/orders?payment_status=paid', { scroll: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  // 🔴🔴 **這一格釘的是「之前」那一側取自哪裡** —— 主視窗 2026-08-20 指定要有。
  //    本檔 `href()` 只列 7 個鍵,而 `/orders` 實際上還有 `panel` / `customer` / `pending` / `den`
  //    ⇒ **`href(state)` 不等於當下網址**(那個不相等本身是另一隻蟲,`#742`)。
  //    若有人把「之前」改回 `href(state)`,下面這一格會紅:那時 before/after 都不含 `panel`
  //    ⇒ 判成碰撞 ⇒ 多補一次沒必要的 refresh。
  //    ⚠️ 它守的不是「多查一次」這件小事,守的是**判定的輸入是不是瀏覽器真的那條網址**。
  it('「之前」取自真實網址:面板開著時取消非最後那個 ⇒ 不補 refresh', () => {
    currentSearch = 'order_source=web&order_source=manual_line&panel=abc';
    const r = render(
      <OrderFilterControls {...PROPS} initial={{ ...PROPS.initial, src: ['web', 'manual_line'] }} />,
    );
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站')); // 取消非最後那個
    expect(replace).toHaveBeenLastCalledWith('/orders?order_source=manual_line', {
      scroll: false,
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('OrderFilterControls — `#742` 篩選列不得吃掉不屬於它的鍵', () => {
  it('`panel` / `den` / `pending` 原樣帶著走(改任一篩選之後仍在網址上)', () => {
    const r = render(
      <OrderFilterControls {...PROPS} carried={{ pending: '1', den: 'tight', panel: 'ord-1', customer: undefined }} />,
    );
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    const url = replace.mock.calls.at(-1)?.[0] as string;
    const qs = new URLSearchParams(url.split('?')[1] ?? '');
    expect(qs.get('payment_status')).toBe('paid'); // 本來就會做的事,先確認沒被我改壞
    expect(qs.get('panel')).toBe('ord-1');
    expect(qs.get('den')).toBe('tight');
    expect(qs.get('pending')).toBe('1');
  });

  it('沒有那些鍵時網址不多一個 `?` 或 `&`(空字串走的是另一條路)', () => {
    const r = render(<OrderFilterControls {...PROPS} carried={{ pending: undefined, den: undefined, panel: undefined, customer: undefined }} />);
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    expect(replace).toHaveBeenLastCalledWith('/orders?payment_status=paid', { scroll: false });
  });
});

describe('`#741` × `#742` — 兩個 producer 的鍵順序必須一致(W6 審查 nit)', () => {
  /**
   * 🔴🔴 **這一格守的不是行為,是兩支函式之間的一個【沒有名字的約定】。**
   *
   * 碰撞判定用 `JSON.stringify(Object.fromEntries(...))`,而那個字串**對鍵順序敏感**:
   * 「之前」那條網址由 `buildOrderListHref` 產、「之後」由本檔的 `href()` 產
   * ⇒ 兩邊的 entries 順序一旦分岔,**去重後鍵值全同也會判成「不碰撞」**
   * ⇒ 不補 refresh ⇒ `#741` 那隻蟲原封不動地回來,而**四格測試全綠**
   *   (它們的 `currentSearch` 起始都是 `''`、「之前」全部由 `href()` 自己產
   *    ⇒ 從來沒有離開過 `href()` 的鍵順序)。
   *
   * ⚠️ **未確認的那一半**:Next 到底怎麼**比較**兩個 cache key —— 那份 memory 只記了 key 怎麼**產**。
   *    若它比的不是字串而是結構,本格就是多餘的保險。要答只能 production build 實測(`#288`)。
   *    ⇒ **在那之前保留本格**:多一條保險的代價是一格測試,少一條的代價是那隻蟲靜默回來。
   */
  it('「之前」用 buildOrderListHref 產、「之後」用 href() 產 ⇒ 仍判得出碰撞', () => {
    currentSearch =
      buildOrderListHref(
        { paymentStatus: 'paid', orderSources: ['web', 'manual_line'] },
        { density: ORDER_DENSITY_DEFAULT },
        1,
        PANEL_CLOSED,
      ).split('?')[1] ?? '';
    const r = render(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, pay: 'paid', src: ['web', 'manual_line'] }}
      />,
    );
    openPanel(r.getAllByRole, 0);
    fireEvent.click(r.getByLabelText('網站')); // 取消非最後那個 ⇒ 應判成碰撞
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('🔴🔴 `#742` 殘餘 — 兩個 producer 現在吃同一張表,輸出必須【逐字相同】', () => {
  /**
   * 本片的**主張本身**,所以要正面斷言,不能只靠「兩邊都沒紅」。
   *
   * 在這之前:`buildOrderListHref` 與本檔的 `href()` 各持一份鍵清單,而
   * `buildListHref` 的 docstring 逐字「**entries 順序決定 query 順序**」
   * ⇒ 兩份清單一分岔,同一組值會產出**不同的 query 字串**。
   * 現在兩支都填 `OrderListUrlValues`、都走 `orderListHrefEntries`
   * ⇒ 同一組值 **必須** 產出同一條網址。
   *
   * ⚠️ 本格刻意**不帶日期**:兩邊的日期輸入型別不同(server 絕對時刻 / client 曆面日),
   *    那一層的換算不在本片的共用範圍內(理由見 `orderListHrefEntries` 的 docstring)。
   */
  it('同一組值 ⇒ buildOrderListHref 與 href() 的 query 逐字相同', () => {
    const r = render(
      <OrderFilterControls
        {...PROPS}
        initial={{ ...PROPS.initial, src: ['web', 'manual_line'] }}
        carried={{ pending: '1', den: 'tight', panel: 'ord-1', customer: 'cus-9' }}
      />,
    );
    fireEvent.change(r.getByLabelText('付款狀態'), { target: { value: 'paid' } });
    const fromClient = replace.mock.calls.at(-1)?.[0] as string;

    const fromServer = buildOrderListHref(
      {
        paymentStatus: 'paid',
        orderSources: ['web', 'manual_line'],
        pendingOnly: true,
      },
      { density: 'tight' },
      1,
      'ord-1',
    );

    // 🔴🔴 **本格的【前提】斷言 —— W6 審 `7e76007f` 的 nit,而它守的是這支測試自己。**
    //
    //   下面那條「逐字相同」之所以抓得到「有人繞過共用表」,靠的是:
    //   `order-filter-controls.tsx` 的物件字面**刻意與 `ORDER_LIST_URL_KEYS` 不同序**,
    //   而**錯位的那兩軸在本格【真的有值】** —— `payment_status`('paid')與
    //   `order_source`(['web','manual_line'])在兩份順序裡的相對位置相反。
    //   ⚠️ **位移最大的日期兩軸在本格刻意不帶** ⇒ 它們對這道守門**零貢獻**
    //     (空值會被 `buildListHref` 略過 ⇒ 順序差異看不出來 —— 實測過:第二版就是這樣沒紅)。
    //
    //   🔴 **所以「這一格為什麼要同時設兩個篩選?拿掉一個吧」= 把這道守門靜靜關掉。**
    //     會做那件事的人打開的是**本檔**,而說明原本只寫在 `.tsx` 的字面旁邊
    //     ⇒ **一道守門的前提若沒寫在會動到它的那個檔裡,那個前提就沒有守護者。**
    expect(fromClient).toContain('payment_status=');
    expect(fromClient).toContain('order_source=');

    // 🔴 server 側刻意不帶 `customer`（列表連結收掉客人卡，那是表上寫著的決定）
    //    ⇒ 拿掉它之後兩邊必須逐字相同。**這一格同時釘住那個決定還在。**
    const clientNoCustomer = fromClient.replace('&customer=cus-9', '');
    expect(clientNoCustomer).toBe(fromServer);
    expect(fromClient).toContain('customer=cus-9');
  });
});
