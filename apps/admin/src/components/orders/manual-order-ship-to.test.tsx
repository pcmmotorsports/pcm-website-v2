// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ search: vi.fn(), create: vi.fn(), createOrder: vi.fn(), addresses: vi.fn() }));
// 選客人時讀他的地址簿(20260927120000;Sean 2026-09-27 全甲)。預設空的 ⇒ 既有各格不受影響。
vi.mock('@/lib/customers/manual-order-address-actions', () => ({ loadManualCustomerAddressesAction: mocks.addresses }));
vi.mock('@/lib/customers/manual-customer-actions', () => ({
  searchManualCustomersAction: mocks.search,
  createManualCustomerInlineAction: mocks.create,
}));
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: mocks.createOrder }));

import { ManualOrderFormBody } from './manual-order-form-body';
import { ManualOrderShipTo } from './manual-order-ship-to';

const CUSTOMER_KEY = '33333333-3333-4333-8333-333333333333';
const ORDER_KEY = '11111111-1111-4111-8111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// 🔴 **整張表單一起 render,不是單獨 render 這一支。**
//    (2026-10-01 前的理由)「同上」是**跨兩塊**讀值(客人塊 → 收件塊),而它靠的是 `rootRef.current.form` 走到共同的
//    `<form>` 再 `querySelector` 對面那兩格。單獨 render 這一支 ⇒ 沒有 form、沒有客人塊
//    ⇒ 那顆鈕在測試裡**永遠走「兩格都空」那條路**,而所有複製斷言都量不到東西。
//    📌 形狀:**一個跨元件的行為, 用單元件的 harness 去量, 會量到一個乾淨而無關的結果。**
function renderForm() {
  return render(
    <ManualOrderFormBody
      manualRequestId={ORDER_KEY}
      customerRequestId={CUSTOMER_KEY}
      activeStaff={[{ id: 'alice', label: '小愛' }]}
      staffLoadFailed={false}
    />,
  );
}

const shipName = () => screen.getByLabelText('收件人') as HTMLInputElement;
const shipPhone = () => screen.getByLabelText('收件人電話') as HTMLInputElement;
const shipLine = () => screen.getByLabelText('收件地址') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockResolvedValue({ ok: true, candidates: [], truncated: false, shouldWarnDuplicates: false });
  mocks.addresses.mockResolvedValue({ ok: true, addresses: [] });
});
afterEach(cleanup);

/** 「找客人」收在「換一位客人」裡(2026-10-01, Sean Q24 甲)⇒ 要用之前先打開。 */
function openSearch() {
  const toggle = screen.queryByTestId('manual-customer-change');
  if (toggle) fireEvent.click(toggle);
}
function searchBox() {
  openSearch();
  return screen.getByLabelText('找客人(電話 / 姓名 / Email)');
}
function searchBtn() {
  openSearch();
  return screen.getByRole('button', { name: '找客人' });
}

// ── 送出面:欄名一個字都不准變 ────────────────────────────────────────────────────────
describe('🔴 收件三格搬進 client 元件之後, 送出去的欄名【逐字沒變】', () => {
  it('三個 name 逐字比對(RPC 那一側零改動的依據)', () => {
    const { container } = renderForm();
    expect(container.querySelector('input[name="ship_to_name"]')).toBeTruthy();
    expect(container.querySelector('input[name="ship_to_phone"]')).toBeTruthy();
    expect(container.querySelector('input[name="ship_to_line"]')).toBeTruthy();
    // 🔴 負對照:餵一個**不存在**的欄名 ⇒ 必須是 null。
    //    少了這一格,上面三行在「`querySelector` 對任何字串都回一個東西」的世界也全綠。
    expect(container.querySelector('input[name="ship_to_nope_20260828"]')).toBeNull();
  });

  it('三格都是 required(舊版就是 required, 搬家不得順手放寬)', () => {
    renderForm();
    expect(shipName().required).toBe(true);
    expect(shipPhone().required).toBe(true);
    expect(shipLine().required).toBe(true);
  });
});

// ── 「同上」的行為 ──────────────────────────────────────────────────────────────────
// ── 🔴🔴 codex R1 must-fix:「上」有兩個意思, 選起來的那位優先 ────────────────────────
//  病:上一版只讀「建立新客人」那兩格 —— 而**最常走的路是「搜到既有客人、點起來」**,
//  那條路上那兩格是空的(或還留著他拿來搜尋的那支電話)
//  ⇒ 按「同上」會把收件人清成空的, 或蓋上一支不是收件人的電話。
//  📌 **它不會叫:兩格確實被「帶入」了, 只是帶入的是錯的東西。**
// ── 兩格都空的那個世界 ──────────────────────────────────────────────────────────────
// ── 那顆鈕本身不得送出表單 ──────────────────────────────────────────────────────────
// ⛔ 2026-10-01 拿掉「同上」與「用這份收件人建客人」的測試:兩顆鈕都已拿掉(Sean Q24 甲)。全文在 git log。
// ── ⟦b4-收件即建客⟧「用這份收件人建客人」——【沒有人在聽】那一半 ─────────────────────
//  🔴🔴 成功那一半在 `manual-customer-picker.test.tsx` 量(它要整張表單 + picker 真的收得到)。
//     這裡量的是**相反的世界**:picker 不在同一張 form 上。
//     📌 本檔檔頭自己記著「一顆『按了沒反應』的鈕, 與一顆『按了但我看不出來』的鈕, 在畫面上長一樣」
//     ⇒ 這一格就是那句話的守門:**沒有人接手時, 那顆鈕不准說成功。**
describe('選客人 ⇒ 從他的地址簿帶入收件資料(Sean 2026-09-27:再建單就沒有地址)', () => {
  const RECENT = { id: 'a1', name: '張保元', phone: '0922129301', line: '台中市西屯區 1 號' };
  const OLDER = { id: 'a2', name: '張保元', phone: '0922129301', line: '台北市信義區 2 號' };

  async function pick() {
    mocks.search.mockResolvedValue({
      ok: true,
      candidates: [{ userId: USER_A, name: '永欣重車-張保元', phone: '0922129301', isManual: true }],
      truncated: false,
      shouldWarnDuplicates: false,
    });
    fireEvent.change(searchBox(), { target: { value: '0922129301' } });
    await act(async () => {
      fireEvent.click(searchBtn());
    });
    await act(async () => {
      fireEvent.click(document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement);
    });
  }

  it('🔴 三格是空的 ⇒ 帶入最近用過的那筆;地址簿有兩筆 ⇒ 出現「從地址簿選」', async () => {
    mocks.addresses.mockResolvedValue({ ok: true, addresses: [RECENT, OLDER] });
    renderForm();
    await pick();
    expect(mocks.addresses).toHaveBeenCalledWith(USER_A);
    expect(shipName().value).toBe('張保元');
    expect(shipPhone().value).toBe('0922129301');
    expect(shipLine().value).toBe('台中市西屯區 1 號');
    const select = screen.getByLabelText('從地址簿選') as HTMLSelectElement;
    expect(select.options.length).toBe(3); // 提示那一項 + 兩筆
    // 下拉不送出(沒有 name)
    expect(select.getAttribute('name')).toBeNull();
  });

  it('從下拉換成另一筆 ⇒ 三格換成那一筆', async () => {
    mocks.addresses.mockResolvedValue({ ok: true, addresses: [RECENT, OLDER] });
    renderForm();
    await pick();
    fireEvent.change(screen.getByLabelText('從地址簿選'), { target: { value: 'a2' } });
    expect(shipLine().value).toBe('台北市信義區 2 號');
  });

  it('🔴 員工已經打了收件資料 ⇒ 選客人不自動蓋掉(下拉還是給他用)', async () => {
    mocks.addresses.mockResolvedValue({ ok: true, addresses: [RECENT] });
    renderForm();
    fireEvent.change(shipLine(), { target: { value: '員工自己打的地址' } });
    await pick();
    expect(shipLine().value).toBe('員工自己打的地址');
    expect(screen.getByLabelText('從地址簿選')).toBeTruthy();
  });

  it('🔴 客人被換掉了(新建客人 / 重新搜尋不會觸發 change)⇒ 不從舊客人的地址簿帶入', async () => {
    mocks.addresses.mockResolvedValue({ ok: true, addresses: [RECENT, OLDER] });
    renderForm();
    await pick();
    fireEvent.change(shipLine(), { target: { value: '' } });
    // 模擬「選取被程式換掉」:不發 change 事件, 直接取消勾選
    (document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement).checked = false;
    fireEvent.change(screen.getByLabelText('從地址簿選'), { target: { value: 'a2' } });
    expect(shipLine().value).toBe('');
    expect(screen.queryByLabelText('從地址簿選')).toBeNull();
    expect(screen.getByTestId('manual-order-ship-to-notice').textContent).toContain('客人已經換了');
  });

  it('地址簿是空的 ⇒ 不動、沒有下拉', async () => {
    renderForm();
    await pick();
    expect(shipLine().value).toBe('');
    expect(screen.queryByLabelText('從地址簿選')).toBeNull();
  });

  it('🔴 讀地址簿丟錯(連線中斷)⇒ 講一句, 不留沒人接的錯誤', async () => {
    mocks.addresses.mockRejectedValue(new Error('network'));
    renderForm();
    await pick();
    expect(screen.getByTestId('manual-order-ship-to-notice').textContent).toBe('客人的地址簿載入失敗，請自行填寫收件資料。');
    expect(shipLine().value).toBe('');
  });

  it('讀不到地址簿 ⇒ 講一句, 不動收件資料', async () => {
    mocks.addresses.mockResolvedValue({ ok: false, message: '客人的地址簿載入失敗，請自行填寫收件資料。' });
    renderForm();
    await pick();
    expect(screen.getByTestId('manual-order-ship-to-notice').textContent).toBe('客人的地址簿載入失敗，請自行填寫收件資料。');
    expect(shipLine().value).toBe('');
  });
});

describe('Codex R1 必修:換客人時不能把上一位的地址帶給下一位', () => {
  const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const A_ADDR = { id: 'a1', name: '甲', phone: '0911000000', line: 'A 的地址' };
  const B_ADDR = { id: 'b1', name: '乙', phone: '0922000000', line: 'B 的地址' };

  async function searchBoth() {
    mocks.search.mockResolvedValue({
      ok: true,
      candidates: [
        { userId: USER_A, name: '甲', phone: '0911000000', isManual: true },
        { userId: USER_B, name: '乙', phone: '0922000000', isManual: true },
      ],
      truncated: false,
      shouldWarnDuplicates: false,
    });
    fireEvent.change(searchBox(), { target: { value: '09' } });
    await act(async () => {
      fireEvent.click(searchBtn());
    });
  }
  const choose = async (id: string) => {
    await act(async () => {
      fireEvent.click(document.querySelector(`input[value="${id}"]`) as HTMLInputElement);
    });
  };

  it('🔴 選 A(自動帶入)→ 改選 B ⇒ A 的三格清掉、換成 B 的', async () => {
    mocks.addresses.mockImplementation(async (id: string) => ({ ok: true, addresses: id === USER_A ? [A_ADDR] : [B_ADDR] }));
    renderForm();
    await searchBoth();
    await choose(USER_A);
    expect(shipLine().value).toBe('A 的地址');
    await choose(USER_B);
    expect(shipLine().value).toBe('B 的地址');
    expect(shipName().value).toBe('乙');
  });

  it('🔴 選 A(自動帶入)→ 改選沒有地址的 B ⇒ 三格清空(不留 A 的)', async () => {
    mocks.addresses.mockImplementation(async (id: string) => ({ ok: true, addresses: id === USER_A ? [A_ADDR] : [] }));
    renderForm();
    await searchBoth();
    await choose(USER_A);
    await choose(USER_B);
    expect(shipLine().value).toBe('');
    expect(shipName().value).toBe('');
  });

  it('選 A 之後員工改過收件資料 → 改選 B ⇒ 保留他改的, 並提醒確認', async () => {
    mocks.addresses.mockImplementation(async (id: string) => ({ ok: true, addresses: id === USER_A ? [A_ADDR] : [B_ADDR] }));
    renderForm();
    await searchBoth();
    await choose(USER_A);
    fireEvent.change(shipLine(), { target: { value: 'A 的地址 5 樓' } });
    await choose(USER_B);
    expect(shipLine().value).toBe('A 的地址 5 樓');
    expect(screen.getByTestId('manual-order-ship-to-notice').textContent).toContain('請確認這是這位客人的收件資料');
  });

  it('🔴 A 的地址簿還沒回來就重新搜尋(清單重畫、不發 change)⇒ A 的回應晚到也不帶入', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.addresses.mockImplementation(() => new Promise((res) => { release = res; }));
    renderForm();
    await searchBoth();
    await choose(USER_A);
    // 重新搜尋:清單換成只有 B、沒有人被勾(radio 整批重掛, 不發 change)
    mocks.search.mockResolvedValue({
      ok: true,
      candidates: [{ userId: USER_B, name: '乙', phone: '0922000000', isManual: true }],
      truncated: false,
      shouldWarnDuplicates: false,
    });
    fireEvent.change(searchBox(), { target: { value: '0922' } });
    await act(async () => {
      fireEvent.click(searchBtn());
    });
    await act(async () => {
      release({ ok: true, addresses: [A_ADDR] });
    });
    expect(shipLine().value).toBe('');
    expect(screen.queryByLabelText('從地址簿選')).toBeNull();
  });
});

// ── 貼上整段(Sean 2026-10-01 Q25 甲:貼上就立刻填好三格)──────────────────────────────
describe('貼上整段 ⇒ 拆好填進收件人 / 電話 / 地址', () => {
  const paste = (text: string) =>
    fireEvent.paste(screen.getByTestId('manual-order-ship-to-paste'), { clipboardData: { getData: () => text } });

  it('三樣都認得 ⇒ 三格都填好, 並說「請確認」', () => {
    renderForm();
    paste('王小明 0912-345-678 台北市 中正區 忠孝東路一段 1號5樓');
    expect(shipName().value).toBe('王小明');
    expect(shipPhone().value).toBe('0912345678');
    expect(shipLine().value).toBe('台北市中正區忠孝東路一段1號5樓');
    expect(screen.getByTestId('manual-order-ship-to-paste-note').textContent).toBe('已填入收件人、電話、地址，請確認。');
  });

  it('沒認出地址 ⇒ 地址那格原本的字【不清掉】, 並說哪一格沒認出', () => {
    renderForm();
    fireEvent.change(shipLine(), { target: { value: '原本打好的地址' } });
    paste('王小明 0912345678');
    expect(shipLine().value).toBe('原本打好的地址');
    expect(screen.getByTestId('manual-order-ship-to-paste-note').textContent).toBe(
      '已填入收件人、電話，請確認。沒有認出地址，請自己填。',
    );
  });

  it('兩支電話 ⇒ 填第一支, 第二支講出來', () => {
    renderForm();
    paste('王小明 0912345678 0223456789 台北市中正區忠孝東路一段1號');
    expect(shipPhone().value).toBe('0912345678');
    expect(screen.getByTestId('manual-order-ship-to-paste-note').textContent).toContain('另一支電話 0223456789 沒有填入。');
  });

  it('填值時補發 input 事件(送出鈕與找客人靠它知道值變了)', () => {
    const { container } = renderForm();
    const seen: string[] = [];
    container.querySelector('form')!.addEventListener('input', (e) => seen.push((e.target as HTMLInputElement).name));
    paste('王小明 0912345678 台北市中正區忠孝東路一段1號');
    expect(seen).toEqual(['ship_to_name', 'ship_to_phone', 'ship_to_line']);
  });

  it('框本身沒有 name ⇒ 貼的原文不會被送出', () => {
    renderForm();
    expect(screen.getByTestId('manual-order-ship-to-paste').getAttribute('name')).toBeNull();
  });
});

// ── 2026-10-01 建單簡化(Sean Q1 甲, S4):訂單來源在收件資料最上面, 收件電話上方留蝦皮帳號的位置 ──
describe('收件資料:訂單來源在最上面', () => {
  it('訂單來源在「收件資料」裡, 而且在貼上整段與收件人之前', () => {
    renderForm();
    const group = screen.getByRole('group', { name: '收件資料' });
    const source = screen.getByLabelText('訂單來源');
    expect(group.contains(source)).toBe(true);
    expect(source.compareDocumentPosition(shipName()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(source.compareDocumentPosition(screen.getByTestId('manual-order-ship-to-paste')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // name 與 option 不變
    expect((source as HTMLSelectElement).name).toBe('order_source');
    expect([...(source as HTMLSelectElement).options].map((o) => o.value)).toEqual(['manual_phone', 'manual_line', 'manual_other', 'manual_shopee']);
  });

  it('beforePhone 的位置在收件人與收件電話中間(網站B 的蝦皮帳號之後放這裡)', () => {
    render(
      <form>
        <ManualOrderShipTo beforePhone={<input aria-label='蝦皮帳號' />} />
      </form>,
    );
    const slot = screen.getByLabelText('蝦皮帳號');
    expect(shipName().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(shipPhone()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
