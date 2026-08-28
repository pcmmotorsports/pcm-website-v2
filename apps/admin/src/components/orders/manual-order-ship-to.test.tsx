// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ search: vi.fn(), create: vi.fn(), createOrder: vi.fn() }));
vi.mock('@/lib/customers/manual-customer-actions', () => ({
  searchManualCustomersAction: mocks.search,
  createManualCustomerInlineAction: mocks.create,
}));
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: mocks.createOrder }));

import { ManualOrderFormBody } from './manual-order-form-body';

const CUSTOMER_KEY = '33333333-3333-4333-8333-333333333333';
const ORDER_KEY = '11111111-1111-4111-8111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// 🔴 **整張表單一起 render,不是單獨 render 這一支。**
//    「同上」是**跨兩塊**讀值(客人塊 → 收件塊),而它靠的是 `rootRef.current.form` 走到共同的
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
const copyBtn = () => screen.getByTestId('manual-order-ship-to-copy');

function fillCustomer(name: string, phone: string) {
  fireEvent.change(screen.getByLabelText('客人姓名'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('電話'), { target: { value: phone } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockResolvedValue({ ok: true, candidates: [], truncated: false, shouldWarnDuplicates: false });
});
afterEach(cleanup);

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
describe('🔴🔴 「同上」:只複製兩格, 而地址那一格【不准動】', () => {
  it('按下去 ⇒ 姓名與電話從客人那一塊帶過來', () => {
    renderForm();
    fillCustomer('王小明', '0912345678');
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('王小明');
    expect(shipPhone().value).toBe('0912345678');
  });

  // 🔴🔴 **本檔最重要的一格。**
  //    實作是「換 `key` ⇒ 重新掛載 ⇒ 吃新的 `defaultValue`」——
  //    而 `key` 一旦**順手也掛到地址那一格**(讀起來很一致),
  //    按「同上」就會把員工已經打好的地址**清成空的**,
  //    而畫面上只是一格變空、沒有任何錯誤、上面兩格還正確地填好了。
  //    📌 **一致性在這裡等於資料遺失, 而它與「寫得很整齊」在 diff 上長一樣。**
  it('🔴 按下去 ⇒ 已經打好的【地址】原封不動', () => {
    renderForm();
    fireEvent.change(shipLine(), { target: { value: '台北市中山區某某路 1 號' } });
    fillCustomer('王小明', '0912345678');
    fireEvent.click(copyBtn());
    expect(shipLine().value).toBe('台北市中山區某某路 1 號');
    // 對照:同一發裡上面兩格**確實被改了** ⇒ 證明這顆鈕真的執行了
    //(少了這兩行,「地址沒變」在「鈕根本沒接線」的世界也全綠)。
    expect(shipName().value).toBe('王小明');
    expect(shipPhone().value).toBe('0912345678');
  });

  it('🔴 連按兩次而中間手改過收件人 ⇒ 第二次仍然蓋得回去', () => {
    renderForm();
    fillCustomer('王小明', '0912345678');
    fireEvent.click(copyBtn());
    // 員工手改了收件人(客人那兩格**沒有變**)
    fireEvent.change(shipName(), { target: { value: '改成別人' } });
    fireEvent.click(copyBtn());
    // 🔴 若 `key` 綁的是「值」而不是「序號」,兩次的值相同 ⇒ key 相同 ⇒ **不重新掛載**
    //    ⇒ 這一格會停在「改成別人」,而員工按了那顆鈕、以為蓋回去了。
    expect(shipName().value).toBe('王小明');
  });

  // ⛔ ~~原本這一格比的是「只有姓名有值 ⇒ 電話【跟著變成空的】」~~
  // 🔴 **2026-08-28 Fable R3 nit2 推翻**:那個行為會把員工自己打的收件電話清掉。
  //    📌 **我把「來源是空的」讀成「他要它變空」—— 而它其實是「這裡沒有東西可以給你」。**
  //       兩者在 code 上都是 `''`。
  it('🔴 只有姓名有值 ⇒ 姓名帶過去, 而收件電話【維持原樣不被清空】', () => {
    renderForm();
    fireEvent.change(shipPhone(), { target: { value: '0987654321' } });
    fireEvent.change(screen.getByLabelText('客人姓名'), { target: { value: '王小明' } });
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('王小明');
    expect(shipPhone().value).toBe('0987654321');
  });

  it('🔴 對照組:收件電話本來就空的 ⇒ 仍然是空的(不然上面那格在「永遠不覆蓋」的世界也全綠)', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('客人姓名'), { target: { value: '王小明' } });
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('王小明');
    expect(shipPhone().value).toBe('');
  });

  it('🔴 來源有值時【照樣覆蓋】(不覆蓋只針對【空的來源】, 不是不覆蓋)', () => {
    renderForm();
    fireEvent.change(shipName(), { target: { value: '舊的收件人' } });
    fillCustomer('王小明', '0912345678');
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('王小明');
  });
});

// ── 🔴🔴 codex R1 must-fix:「上」有兩個意思, 選起來的那位優先 ────────────────────────
//  病:上一版只讀「建立新客人」那兩格 —— 而**最常走的路是「搜到既有客人、點起來」**,
//  那條路上那兩格是空的(或還留著他拿來搜尋的那支電話)
//  ⇒ 按「同上」會把收件人清成空的, 或蓋上一支不是收件人的電話。
//  📌 **它不會叫:兩格確實被「帶入」了, 只是帶入的是錯的東西。**
describe('🔴🔴 codex R1:選了既有客人 ⇒ 「同上」帶【那位】, 不是帶建立區那兩格', () => {

  async function searchAndPick() {
    mocks.search.mockResolvedValue({
      ok: true,
      candidates: [{ userId: USER_A, name: '王小明', phone: '0912345678', isManual: false }],
      truncated: false,
      shouldWarnDuplicates: false,
    });
    fireEvent.change(screen.getByLabelText('客人電話'), { target: { value: '0912345678' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '找客人' }));
    });
    fireEvent.click(document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement);
  }

  it('帶入選起來那位的姓名與電話', async () => {
    renderForm();
    await searchAndPick();
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('王小明');
    expect(shipPhone().value).toBe('0912345678');
  });

  it('🔴 就算建立區那兩格有字, 也以【選起來的那位】為準(不然兩個來源會靜靜地打架)', async () => {
    renderForm();
    await searchAndPick();
    fireEvent.change(screen.getByLabelText('客人姓名'), { target: { value: '不該被帶入的乙' } });
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('王小明');
    expect(shipName().value).not.toBe('不該被帶入的乙');
  });

  // 🔴🔴 codex R4 must-fix:**「不覆蓋」只在 fallback 生效** —— 我上一輪把 Fable nit2 折錯了。
  //  病:收件電話已經是乙的 ⇒ 選一位【沒有電話的甲】⇒ 按同上 ⇒ **姓名甲 + 電話乙**。
  //  📌 **一個「保護資料不被清掉」的修法, 做出了一份比清空更危險的資料** ——
  //     清空看得出來;拼起來的那一份**每一格都有值、看起來完全正常**。
  it('🔴🔴 選了一位【沒有電話】的客人 ⇒ 收件電話要跟著變空, 不得留著上一位的', async () => {
    renderForm();
    fireEvent.change(shipPhone(), { target: { value: '0987654321' } });
    mocks.search.mockResolvedValue({
      ok: true,
      candidates: [{ userId: USER_A, name: '沒有電話的甲', phone: null, isManual: false }],
      truncated: false,
      shouldWarnDuplicates: false,
    });
    fireEvent.change(screen.getByLabelText('客人電話'), { target: { value: '0912345678' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '找客人' }));
    });
    fireEvent.click(document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement);
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('沒有電話的甲');
    // 🔴 這一格是本族的重點:**不得**是 '0987654321'(那會做出一個兩個人拼起來的收件人)
    expect(shipPhone().value).toBe('');
  });

  it('🔴 對照組:沒有選任何人時, 仍然讀建立區那兩格(不然上面兩格是靠「永遠讀 radio」過的)', () => {
    renderForm();
    fillCustomer('新客人乙', '0955000111');
    fireEvent.click(copyBtn());
    expect(shipName().value).toBe('新客人乙');
    expect(shipPhone().value).toBe('0955000111');
  });
});

// ── 兩格都空的那個世界 ──────────────────────────────────────────────────────────────
describe('🔴 客人那一塊兩格都空 ⇒ 不複製、而且要說話', () => {
  it('不覆蓋收件人已經打好的字, 並出現一句說明', () => {
    renderForm();
    fireEvent.change(shipName(), { target: { value: '李小華' } });
    fireEvent.change(shipPhone(), { target: { value: '0987654321' } });
    // 客人那兩格一個字都沒打
    fireEvent.click(copyBtn());
    // 🔴 直接複製的話,這兩格會被清成空的 —— 那是「按一下弄丟資料」,
    //    而畫面上只是兩格變空,沒有任何錯誤。
    expect(shipName().value).toBe('李小華');
    expect(shipPhone().value).toBe('0987654321');
    expect(screen.getByTestId('manual-order-ship-to-notice').textContent).toContain('沒有東西可以帶過來');
  });

  it('🔴 對照組:有值的世界【不出】那句話(不然它是恆真的)', () => {
    renderForm();
    fillCustomer('王小明', '0912345678');
    fireEvent.click(copyBtn());
    expect(screen.queryByTestId('manual-order-ship-to-notice')).toBeNull();
  });

  it('🔴 說過話之後再按一次而這次有值 ⇒ 那句話要消失(否則它會一直掛在那裡誤導人)', () => {
    renderForm();
    fireEvent.click(copyBtn());
    expect(screen.getByTestId('manual-order-ship-to-notice')).toBeTruthy();
    fillCustomer('王小明', '0912345678');
    fireEvent.click(copyBtn());
    expect(screen.queryByTestId('manual-order-ship-to-notice')).toBeNull();
  });
});

// ── 那顆鈕本身不得送出表單 ──────────────────────────────────────────────────────────
describe('🔴 「同上」不得送出整張表單', () => {
  it("type 逐字是 button(預設的 submit 會把整張單送出去 ⇒ PRG ⇒ 值全清)", () => {
    renderForm();
    expect(copyBtn().getAttribute('type')).toBe('button');
  });
});
