// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  create: vi.fn(),
  createOrder: vi.fn(),
}));
vi.mock('@/lib/customers/manual-customer-actions', () => ({
  searchManualCustomersAction: mocks.search,
  createManualCustomerInlineAction: mocks.create,
}));
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: mocks.createOrder }));
// 選客人時收件區會讀他的地址簿(20260927120000);這支檔測的是找客人 / 建客人 ⇒ 換成空的地址簿,不跑真的 server action
vi.mock('@/lib/customers/manual-order-address-actions', () => ({
  loadManualCustomerAddressesAction: async () => ({ ok: true, addresses: [] }),
}));

import { ManualCustomerPicker } from './manual-customer-picker';
import { requestManualCustomerCreate } from '@/lib/orders/manual-customer-create-request';
import { ManualOrderFormBody } from './manual-order-form-body';

const CUSTOMER_KEY = '33333333-3333-4333-8333-333333333333';
const ORDER_KEY = '11111111-1111-4111-8111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const hit = (userId: string, name: string) => ({ userId, name, phone: '0912345678', isManual: false });

function found(...cs: ReturnType<typeof hit>[]) {
  return { ok: true as const, candidates: cs, truncated: false, shouldWarnDuplicates: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockResolvedValue(found());
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
/** 客人那一塊放在一張表單裡(它靠所在的表單收「建立客人」的事件)。 */
function renderPicker() {
  return render(
    <form data-testid='f'>
      <ManualCustomerPicker customerRequestId={CUSTOMER_KEY} />
    </form>,
  );
}
/**
 * 建立新客人(2026-10-01 起唯一的入口:按「確認」時用收件人姓名電話建立, Sean Q24 甲)。
 * 🔴 走的是真的事件契約(`requestManualCustomerCreate`), 與「確認」鈕送出的是同一個事件。
 */
async function requestCreate(name: string, phone = '0900000999') {
  let accepted = false;
  await act(async () => {
    accepted = requestManualCustomerCreate(document.querySelector('form'), { name, phone });
  });
  return accepted;
}

async function search(phone = '0912345678') {
  fireEvent.change(searchBox(), { target: { value: phone } });
  await act(async () => {
    fireEvent.click(searchBtn());
  });
}

// ── 🔴🔴 A-1 · 搜尋不得清掉任何已填的值 ────────────────────────────────────────────────
//  這是本片存在的理由本身:舊形狀的搜尋是 GET 導頁 ⇒ 整份表單重建 ⇒ 運費無聲回到 0
//  ⇒ 員工補完必填欄就少收錢(codex R1 must-fix)。
//  ⚠️ **本族在 jsdom 量的是「有沒有被 remount」** —— 非受控 input 的值住在 DOM,
//     重新掛載才會回到 `defaultValue`。真瀏覽器那一層另外驗(驗收條 A-1)。
describe('🔴🔴 A-1:就地搜尋【不得】清掉已經填好的值', () => {
  function renderWholeForm() {
    return render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
  }

  it('填好運費 / 地址 / 品項 ⇒ 按「找客人」⇒ 每一格逐字還在', async () => {
    const { container } = renderWholeForm();
    const fee = container.querySelector('input[name="shipping_fee"]') as HTMLInputElement;
    const line = container.querySelector('input[name="ship_to_line"]') as HTMLInputElement;
    const sku = container.querySelector('input[name="line_sku_0"]') as HTMLInputElement;
    fireEvent.change(fee, { target: { value: '150' } });
    fireEvent.change(line, { target: { value: '台北市中山區某某路 1 號' } });
    fireEvent.change(sku, { target: { value: 'ABC-123' } });

    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    await search();

    // 🔴 重新查一次 DOM(不是用上面那三個變數)—— 若元件被 remount,舊參考還指著已經離場的節點,
    //    那時上面三個變數的 value 仍是舊值 ⇒ 這一格會**假綠**。
    expect((container.querySelector('input[name="shipping_fee"]') as HTMLInputElement).value).toBe('150');
    expect((container.querySelector('input[name="ship_to_line"]') as HTMLInputElement).value).toBe(
      '台北市中山區某某路 1 號',
    );
    expect((container.querySelector('input[name="line_sku_0"]') as HTMLInputElement).value).toBe('ABC-123');
  });

  // 🔴🔴 **上面那格在 jsdom 的判別力有限,而我把它量出來了,不假裝它很強**:
  //    picker 的 state 變化**不會**讓表單本體重新 render(state 住在 picker 裡)
  //    ⇒ 在 jsdom 幾乎沒有世界能讓那三格失敗。
  //    ⇒ 真正會讓病回來的是**有人把候選 state 提到表單本體**(那時整張表單跟著重繪)
  //      或**有人把搜尋改回導頁** —— 兩者都不是這一格量得到的。
  //    ⇒ 所以補下面這一格原始碼層守門:**表單本體必須維持 server component、零 state**。
  //      它是機械的、而且突變得動(把 `useState` 加進去 ⇒ 紅)。
  it('🔴🔴 表單本體不得持有任何 state(病會從「有人把 state 提上去」那條路回來)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'manual-order-form-body.tsx'), 'utf8');
    const code = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toContain("'use client'");
    expect(code).not.toMatch(/useState|useReducer|useTransition/);
    // 🔴 負對照:同一把尺對 picker(它【本來就有】state)⇒ 必須命中,否則這把尺是恆真的。
    const pickerCode = readFileSync(join(__dirname, 'manual-customer-picker.tsx'), 'utf8');
    expect(pickerCode).toMatch(/useState/);
  });

  it('🔴 而搜尋真的做了事(不然上面那格在「按鈕沒接線」的世界也全綠)', async () => {
    renderWholeForm();
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    await search();
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('manual-customer-candidates')).toBeTruthy();
  });
});

// ── 🔴🔴 A-3 · 顯示的客人 = 送出的客人 ────────────────────────────────────────────────
describe('🔴🔴 A-3:選中的客人由【原生 radio】承載, 沒有第二份真相', () => {
  it('候選畫成 radio, name 就是 RPC 收的那一格', async () => {
    renderPicker();
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明'), hit(USER_B, '李小華')));
    await search();
    const radios = Array.from(
      document.querySelectorAll('input[type="radio"][name="customer_user_id"]'),
    ) as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual([USER_A, USER_B]);
  });

  it('🔴 再搜一次而新清單裡沒有他 ⇒ 畫面上沒有任何一顆是選中的(不得留一個看不見的舊選擇)', async () => {
    renderPicker();
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    await search();
    fireEvent.click(document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement);

    mocks.search.mockResolvedValue(found(hit(USER_B, '李小華')));
    await search('0987654321');

    const checked = document.querySelectorAll('input[name="customer_user_id"]:checked');
    // 🔴 若選中的客人存在 state 裡,這裡會留下一顆指著【已經不在畫面上的 A】的值。
    expect(checked.length).toBe(0);
    expect(document.querySelector(`input[value="${USER_A}"]`)).toBeNull();
  });
});

// ── 🔴🔴 查無 ⇒ 就地建 ───────────────────────────────────────────────────────────────
describe('🔴🔴 新客人:用收件人姓名電話建立, 建完自動選起來', () => {
  it('🔴 那句死路文案不得再出現(它指到一個沒有那顆按鈕的頁面)', async () => {
    renderPicker();
    await search('0900000999');
    expect(screen.queryByText(/請先到【客人】頁建立這位客人/)).toBeNull();
  });

  it('🔴 建好之後【自動選起來】', async () => {
    mocks.create.mockResolvedValue({
      ok: true,
      idempotent: false,
      outcome: 'created',
      candidate: { userId: USER_A, name: '新客人', phone: '0900000999', isManual: true },
    });
    renderPicker();
    await requestCreate('新客人');
    await waitFor(() => {
      const radio = document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement | null;
      expect(radio?.checked).toBe(true);
    });
  });

  it('🔴🔴 冪等鍵逐字遞下去 —— 同一份畫面連按兩次要送【同一顆】', async () => {
    mocks.create.mockResolvedValue({
      ok: true,
      idempotent: false,
      outcome: 'created',
      candidate: { userId: USER_A, name: '新客人', phone: '0900000999', isManual: true },
    });
    renderPicker();
    await requestCreate('新客人');
    expect(mocks.create).toHaveBeenCalledWith({ name: '新客人', phone: '0900000999', requestId: CUSTOMER_KEY });
  });

  it('🔴 建失敗 ⇒ 把那一層的訊息原樣印出來, 而【不得】自動選任何人', async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      reason: 'invalid_phone',
      message: '請填寫完整的聯絡電話(至少 8 個數字)',
    });
    renderPicker();
    await requestCreate('新客人');
    expect((await screen.findByTestId('manual-customer-picker-notice')).textContent).toContain('請填寫完整的聯絡電話');
    expect(document.querySelectorAll('input[name="customer_user_id"]').length).toBe(0);
  });

  it('🔴 客人那一塊不在表單裡 ⇒ 沒有人接手, 派發端拿到 false(不得謊報成功)', async () => {
    render(<ManualCustomerPicker customerRequestId={CUSTOMER_KEY} />);
    expect(await requestCreate('新客人')).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

// ── 🔴 兩種「沒有」不得印同一句 ──────────────────────────────────────────────────────
describe('🔴 查【壞了】與查【無】不得印同一個畫面', () => {
  // 🔴 保護本身是明寫的 `searchBroken` state(不是「某個區塊沒畫出來」的副作用)。
  //    2026-10-01 建立區拿掉之後, 本族改成比【建立有沒有真的被擋下來】(mocks.create 有沒有被叫到)。
  it('查壞了 ⇒ 出錯誤訊息, 而且建不了客人 + 說出為什麼(他建下去會開出第二個帳號)', async () => {
    renderPicker();
    mocks.search.mockResolvedValue({ ok: false, reason: 'error' });
    await search();
    expect((await screen.findByTestId('manual-customer-picker-notice')).textContent).toContain('目前無法確認是否已有帳號');
    expect(screen.getByTestId('manual-order-new-customer-blocked').textContent).toContain('目前無法確認是否已有帳號');
    await requestCreate('新客人');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('🔴🔴 登入過期 ⇒ 那句話要叫他【重新登入】, 不得叫他「再找一次」', async () => {
    renderPicker();
    mocks.search.mockResolvedValue({ ok: false, reason: 'denied' });
    await search();
    const t = (await screen.findByTestId('manual-order-new-customer-blocked')).textContent ?? '';
    expect(t).toContain('重新登入');
    expect(t).not.toContain('壞掉');
    expect(t).not.toContain('請先再找一次');
    expect(t).not.toContain('無法確認是否已有帳號');
  });

  it('🔴 登入過期【也要】擋住建立(話錯了不代表鎖錯了 —— 兩件事分開驗)', async () => {
    renderPicker();
    mocks.search.mockResolvedValue({ ok: false, reason: 'denied' });
    await search();
    await requestCreate('新客人');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('manual-customer-picker-notice').textContent).toContain('重新登入');
  });

  it('🔴 對照組:查詢【真的壞了】仍然說重複帳號那個故事', async () => {
    renderPicker();
    mocks.search.mockResolvedValue({ ok: false, reason: 'error' });
    await search();
    const t = (await screen.findByTestId('manual-order-new-customer-blocked')).textContent ?? '';
    expect(t).toContain('無法確認是否已有帳號');
    expect(t).not.toContain('重新登入');
  });

  it('🔴 對照組:真的查無 ⇒ 建得下去(不然上面那幾格恆綠)', async () => {
    renderPicker();
    mocks.search.mockResolvedValue(found());
    await search();
    expect(screen.queryByTestId('manual-order-new-customer-blocked')).toBeNull();
    mocks.create.mockResolvedValue({ ok: false, reason: 'error', message: 'x' });
    await requestCreate('新客人');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 第二對照組:電話打太短【不算】查壞了 ⇒ 仍然建得下去', async () => {
    renderPicker();
    mocks.search.mockResolvedValue({ ok: false, reason: 'too_short' });
    await search();
    expect(await screen.findByTestId('manual-customer-picker-notice')).toBeTruthy();
    mocks.create.mockResolvedValue({ ok: false, reason: 'error', message: 'x' });
    await requestCreate('新客人');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 查壞了之後再找一次而這次成功 ⇒ 解鎖(不然一次網路抖動就鎖死整個下午)', async () => {
    renderPicker();
    mocks.search.mockResolvedValue({ ok: false, reason: 'error' });
    await search();
    await requestCreate('新客人');
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.search.mockResolvedValue(found());
    await search();
    mocks.create.mockResolvedValue({ ok: false, reason: 'error', message: 'x' });
    await requestCreate('新客人');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 還沒搜過 ⇒ 候選清單不出(不然「查無」那格在一進畫面就成立)', () => {
    renderPicker();
    expect(screen.queryByTestId('manual-customer-candidates')).toBeNull();
  });
});

// ── 🔴🔴 R4 折回來的四族(codex 2026-08-28 R4 FAIL 八條)──────────────────────────────
//  📌 這四族的共同點:**它們檢查的那些事,上一輪的測試全部印綠。**
//     上一輪只比了「按鈕的 `type` 字面是不是 `button`」並用滑鼠 click ——
//     而 R4 打破的三條路(鍵盤 Enter、沒選客人、action throw)**一條都不經過滑鼠 click**。

describe('🔴🔴 R4-MF1:在這一塊按 Enter,不得送出整張訂單', () => {
  // ⚠️ **效度限制,先寫在前面**:jsdom **不實作 HTML 的隱式送出**
  //    (在文字框按 Enter → 按下第一顆 submit 按鈕)⇒ 這裡**量不到「表單有沒有真的被送出去」**。
  //    ⇒ 本族量的是那道守門的**機制**:Enter 這一發有沒有被 `preventDefault()`、有沒有改跑搜尋。
  //    🔴 真瀏覽器那一格是**分開的一發**(驗收條 A-1b),**本族綠不代表那一格綠。**
  it('Enter 被擋下來(事件 cancelled),而且改跑「找客人」', async () => {
    renderPicker();
    const input = searchBox();
    fireEvent.change(input, { target: { value: '0912345678' } });

    // `fireEvent` 回 false = 這一發被 `preventDefault()` 掉了 = 瀏覽器不會拿它去送表單。
    let cancelled = false;
    await act(async () => {
      cancelled = !fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(cancelled).toBe(true);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it('🔴 對照組:按【別的鍵】不擋、也不查(不然這道閘就是恆擋、量不出判別力)', async () => {
    renderPicker();
    const input = searchBox();
    let cancelled = false;
    await act(async () => {
      cancelled = !fireEvent.keyDown(input, { key: 'a' });
    });
    expect(cancelled).toBe(false);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  // ⛔ 2026-10-01 拿掉「新增客人那兩格按 Enter」那一格:那兩格已經不存在(新客人改成按「確認」時建立)。
});

describe('🔴🔴 R4-MF3:action 自己 throw(不是回 ok:false)時,不得炸掉整塊', () => {
  // 🔴 為什麼這一族是 must-fix 而不是禮貌:server action 在斷線 / 序列化失敗時**往上拋**,
  //    而拋出來 = 這顆 client component 進 Error Boundary = **重新掛載**
  //    = 員工填好的運費地址(非受控原生控制項)回到預設值。
  //    ⇒ 這一片要修的病,可以**完全不經過導頁**發生。
  it('搜尋 throw ⇒ 出一句「連不上」,而元件還在', async () => {
    mocks.search.mockRejectedValue(new Error('boom'));
    renderPicker();
    await search();
    expect(screen.getByTestId('manual-customer-picker-notice').textContent).toContain('無法連線');
    expect(searchBox()).toBeTruthy();
  });

  it('建客人 throw ⇒ 文案必須叫他【請勿重複建立】(帳號可能已經建出來了)', async () => {
    renderPicker();
    await search();
    mocks.create.mockRejectedValue(new Error('boom'));
    await requestCreate('王小明');
    const text = screen.getByTestId('manual-customer-picker-notice').textContent ?? '';
    expect(text).toContain('請勿重複建立');
    // 🔴 負向:**不得**出現叫他重建的話 —— 那正是 R1 抓到過的那個錯,不要換個地方復發。
    expect(text).not.toContain('再建一次');
  });
});

describe('🔴🔴 R4-MF8:用【真的 FormData】驗,不是比 radio 的 value 字面', () => {
  // 🔴 上一輪那一格只讀了 `input.value` ——**那個值來自我們自己剛剛寫進去的 JSX**,
  //    它在「radio 被 disabled / 被排除送出 / name 打錯」的世界裡照樣印綠。
  //    ⇒ 這裡改成問瀏覽器:**這張表單真的會送出什麼。**
  function renderInForm() {
    return render(
      <form data-testid='f'>
        <ManualCustomerPicker customerRequestId={CUSTOMER_KEY} />
      </form>,
    );
  }

  it('選起來的那一位,就是 FormData 裡的那一位', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '甲'), hit(USER_B, '乙')));
    renderInForm();
    await search();
    fireEvent.click(screen.getByRole('radio', { name: /乙/ }));

    const form = screen.getByTestId('f') as HTMLFormElement;
    expect(new FormData(form).get('customer_user_id')).toBe(USER_B);
  });

  it('🔴 對照組:一個都沒選 ⇒ FormData 裡【沒有】這個欄位(不是空字串)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
    renderInForm();
    await search();
    const form = screen.getByTestId('f') as HTMLFormElement;
    expect(new FormData(form).get('customer_user_id')).toBeNull();
  });

  it('剛建好那位:畫面上打勾的那顆,與 FormData 送的是同一顆', async () => {
    renderInForm();
    await search();
    mocks.create.mockResolvedValue({ ok: true, idempotent: false, outcome: 'created', candidate: hit(USER_A, '王小明') });
    await requestCreate('王小明');
    const form = screen.getByTestId('f') as HTMLFormElement;
    expect((screen.getByRole('radio') as HTMLInputElement).checked).toBe(true);
    expect(new FormData(form).get('customer_user_id')).toBe(USER_A);
  });
});

describe('🔴🔴 R4-MF6:沒有員工時,這一塊也要跟著停用', () => {
  // 🔴 R4 的原話:picker 長在 `disabled` fieldset **外面** ⇒ 「整張表單停用」只停了下半張,
  //    而上半張**還可以建出一個真的 auth 帳號**。而畫面上那個停用態看起來完全正確。
  // 🔴🔴 **量法踩過一次坑,寫下來**:第一版寫 `button.disabled` ⇒ **紅**,而碼是對的。
  //    成因:`disabled` 這個 IDL property **只反映它自己那個屬性**,
  //    「被外層 `<fieldset disabled>` 關掉」是**繼承**來的、不會寫回那顆按鈕的 property。
  //    ⇒ 要問「它現在按不按得下去」得用 `:disabled` 這個選擇器(它算繼承)。
  //    📌 一把量錯的尺,在這裡印的是**紅**;而同一種錯在別的方向會印綠 —— 這次運氣好。
  const canPress = (name: string) => !screen.getByRole('button', { name }).matches(':disabled');

  // 2026-10-01:「找客人」收在「換一位客人」裡 ⇒ 量的是那顆入口按不按得下去
  it('員工名單是空的 ⇒ 換一位客人那顆按不下去', () => {
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[]}
        staffLoadFailed={false}
      />,
    );
    expect(canPress('換一位客人')).toBe(false);
  });

  it('🔴 對照組:有員工 ⇒ 同一顆是可以按的(不然上面那格恆綠)', () => {
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
    expect(canPress('換一位客人')).toBe(true);
  });
});

describe('🔴 客人清單與建立的保護(2026-10-01 前住在「建立區塊無條件渲染」那一族)', () => {
  // ⛔ 拿掉的:建立區塊的形狀、電話預填(R3-MF1)、dirty 換表單(R4-nit)、建立區文案 ——
  //    建立新客人那兩格已經拿掉(Sean 2026-10-01 Q24 甲), 那些格子守的東西不存在了。
  //    留下的是【清單與選取】的保護, 改走真的建立事件(`requestCreate`)。
  describe('🔴🔴 R3-MF2:建立成功之後再搜一次, 那位【不得】被無聲勾回來', () => {
    it('建立甲 ⇒ 改搜別的號碼而清單含甲 ⇒ 甲不得被自動選起來', async () => {
      mocks.create.mockResolvedValue({
        ok: true,
        idempotent: false,
        outcome: 'created',
        candidate: { userId: USER_A, name: '甲', phone: '0912345678', isManual: true },
      });
      renderPicker();
      mocks.search.mockResolvedValue(found());
      await search('0912345678');
      await requestCreate('甲');
      await waitFor(() => {
        expect((document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement).checked).toBe(true);
      });
      // 🔴 改變主意, 搜同市話的另一位 ⇒ 清單 [甲, 乙]
      mocks.search.mockResolvedValue(found(hit(USER_A, '甲'), hit(USER_B, '乙')));
      await search('0912345000');
      expect(document.querySelectorAll('input[name="customer_user_id"]:checked').length).toBe(0);
    });

    it('🔴 對照組:剛建立完那一刻【還是要】自動選起來(不然上面那格把 R7 一起殺了)', async () => {
      mocks.create.mockResolvedValue({
        ok: true,
        idempotent: false,
        outcome: 'created',
        candidate: { userId: USER_B, name: '乙', phone: '0955000111', isManual: true },
      });
      renderPicker();
      mocks.search.mockResolvedValue(found());
      await search('0955000111');
      await requestCreate('乙');
      await waitFor(() => {
        expect((document.querySelector(`input[value="${USER_B}"]`) as HTMLInputElement).checked).toBe(true);
      });
    });
  });

  describe('🔴🔴 R4-MF1:搜尋【拋出】時, 舊清單與舊選取也要清掉', () => {
    it('選了甲 ⇒ 改搜而 action throw ⇒ 清單消失、沒有任何一顆是選中的', async () => {
      mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
      renderPicker();
      await search('0912345678');
      fireEvent.click(document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement);
      expect(document.querySelectorAll('input[name="customer_user_id"]:checked').length).toBe(1);
      // 🔴 舊碼在這條路上什麼都不清 ⇒ 甲還勾著 ⇒ 送出鈕仍亮 ⇒ 單掛給甲。
      mocks.search.mockRejectedValue(new Error('boom'));
      await search('0955000111');
      expect(screen.queryByTestId('manual-customer-candidates')).toBeNull();
      expect(document.querySelectorAll('input[name="customer_user_id"]:checked').length).toBe(0);
    });

    it('🔴 對照組:throw 那句「已填寫的表單內容仍保留」仍然要出(它講的是【表單欄位】不是【客人選取】)', async () => {
      renderPicker();
      mocks.search.mockRejectedValue(new Error('boom'));
      await search('0912345678');
      expect((await screen.findByTestId('manual-customer-picker-notice')).textContent).toContain(
        '已填寫的表單內容仍保留',
      );
    });
  });

  describe('🔴 R4-MF2 的憑據:剛建出來的那一顆要帶 data-just-created', () => {
    it('建立成功那一顆有標記; 而下一次搜尋回來的同一位【沒有】', async () => {
      mocks.create.mockResolvedValue({
        ok: true,
        idempotent: false,
        outcome: 'created',
        candidate: { userId: USER_A, name: '甲', phone: '0912345678', isManual: true },
      });
      renderPicker();
      mocks.search.mockResolvedValue(found());
      await search('0912345678');
      await requestCreate('甲');
      await waitFor(() => {
        expect(
          (document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement).dataset.justCreated,
        ).toBe('1');
      });
      // 🔴 再搜一次 ⇒ 同一位回來了, 而它【不再】是「剛建出來的那一位」
      mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
      await search('0912345678');
      expect(
        (document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement).dataset.justCreated,
      ).toBeUndefined();
    });
  });

  describe('🔴 R3-nit1:一次手誤的 too_short 不得把已搜到的清單丟掉', () => {
    it('搜到人 ⇒ 少打一碼再按 ⇒ 清單還在', async () => {
      mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
      renderPicker();
      await search('0912345678');
      expect(screen.getByTestId('manual-customer-candidates')).toBeTruthy();
      mocks.search.mockResolvedValue({ ok: false, reason: 'too_short' });
      await search('09');
      expect(screen.getByTestId('manual-customer-candidates')).toBeTruthy();
    });

    it('🔴 對照組:denied / error 仍然要清掉(那兩種底下舊清單準不準答不出來 ⇒ fail-closed)', async () => {
      mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
      renderPicker();
      await search('0912345678');
      mocks.search.mockResolvedValue({ ok: false, reason: 'error' });
      await search('0912345678');
      expect(screen.queryByTestId('manual-customer-candidates')).toBeNull();
    });
  });

  it('🔴 每一顆候選 radio 都帶著姓名與電話(收件那塊從地址簿帶入、名字不同的提醒靠它)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderPicker();
    await search();
    const radio = document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement;
    expect(radio.dataset.customerName).toBe('王小明');
    expect(radio.dataset.customerPhone).toBe('0912345678');
  });

  it('🔴 負對照:那兩個 data 屬性不是憑空存在的(拿一個不存在的屬性名 ⇒ undefined)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderPicker();
    await search();
    const radio = document.querySelector(`input[value="${USER_A}"]`) as HTMLInputElement;
    expect(radio.dataset.customerNopeZzz).toBeUndefined();
  });
});

// ── 🔴🔴 R5 折回來的四族(codex 2026-08-28 R5 FAIL 六條)────────────────────────────
//  📌 R5 最重要的一條是**推翻我自己的判斷**:我把 R4 的 MF5 降級成「擋在搜尋那道閘」,
//     而它構造出反例 —— **建立區塊裡的電話欄是可以改的** ⇒ 搜的與建的不是同一個值。
//     ⇒ 判別句:**「先搜再建」讀起來像一條管線,實際上是兩個獨立輸入。**

// ⛔ 2026-10-01 拿掉 R5-F5(新增客人那兩格的 Enter):那兩格已經不存在。

describe('🔴🔴 R5-F3:中文輸入法組字中的那一下 Enter,不算「執行」', () => {
  // 🔴 病:員工打「王小明」,輸入法跳出候選字,他按 Enter **選字** ⇒ 當場去建客人,
  //    而名字只打到一半 ⇒ 系統裡多出一位「王小」。
  //    📌 這條在英數輸入下**永遠不會發生** ⇒ 開發時測不到,而 Sean 的客人全是中文名字。
  it('組字中(isComposing)的 Enter ⇒ 不擋、也不執行', async () => {
    renderPicker();
    const input = searchBox();
    let cancelled = false;
    await act(async () => {
      cancelled = !fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    });
    expect(cancelled).toBe(false);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('🔴 對照組:組字結束後的同一下 Enter ⇒ 照常執行(不然這道閘變成把功能關掉)', async () => {
    renderPicker();
    const input = searchBox();
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
    });
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });
});

describe('🔴🔴 R5-F2:兩發搜尋並行時,慢的舊那發不得蓋掉新結果', () => {
  // 🔴 病不會壞給你看:兩邊都是合法的客人清單,**沒有任何一格會紅** ——
  //    畫面上是舊電話的候選,而搜尋框寫著新電話 ⇒ **員工會選到別人。**
  it('先發的慢、後發的快 ⇒ 畫面留住【後發】那一份', async () => {
    let releaseSlow: (v: unknown) => void = () => {};
    const slow = new Promise((r) => {
      releaseSlow = r;
    });
    mocks.search
      .mockImplementationOnce(async () => {
        await slow;
        return found(hit(USER_A, '舊電話的人'));
      })
      .mockImplementationOnce(async () => found(hit(USER_B, '新電話的人')));

    renderPicker();
    const input = searchBox();
    // 🔴 兩發都用 Enter 發 —— 第一發還在跑時「找客人」那顆是 disabled(顯示「找…」),
    //    而 Enter 這條路**不看 pending** ⇒ 這正是員工真的會做出兩發並行的那條路。
    await act(async () => {
      fireEvent.change(input, { target: { value: '0912345678' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: '0988777666' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText(/新電話的人/)).toBeTruthy();

    // 現在才讓舊的那一發回來 —— 它不准動畫面。
    await act(async () => {
      releaseSlow(null);
      await Promise.resolve();
    });
    expect(screen.queryByText(/舊電話的人/)).toBeNull();
    expect(screen.getByText(/新電話的人/)).toBeTruthy();
  });
});

describe('🔴 R5-F6:候選 radio 帶原生 required(拿掉它,上一輪所有測試仍全綠)', () => {
  it('有候選而一個都沒選 ⇒ 表單原生驗證【不通過】', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
    render(
      <form data-testid='f'>
        <ManualCustomerPicker customerRequestId={CUSTOMER_KEY} />
      </form>,
    );
    await search();
    const radio = screen.getByRole('radio') as HTMLInputElement;
    expect(radio.required).toBe(true);
    expect(radio.validity.valueMissing).toBe(true);
    expect((screen.getByTestId('f') as HTMLFormElement).checkValidity()).toBe(false);
  });

  it('🔴 對照組:選了 ⇒ 原生驗證過(不然上面那格是恆紅、一樣沒判別力)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '甲')));
    render(
      <form data-testid='f'>
        <ManualCustomerPicker customerRequestId={CUSTOMER_KEY} />
      </form>,
    );
    await search();
    fireEvent.click(screen.getByRole('radio'));
    expect((screen.getByRole('radio') as HTMLInputElement).validity.valueMissing).toBe(false);
    expect((screen.getByTestId('f') as HTMLFormElement).checkValidity()).toBe(true);
  });
});

// ── 🔴🔴 R6 折回來的三族 ──────────────────────────────────────────────────────────
import { ManualOrderSubmit } from './manual-order-submit';

describe('🔴🔴 R6:IME 那道要在【兩層一起在場】時量 —— 只 render picker 會漏掉外層那道', () => {
  // 🔴 上一輪那一族只 render picker ⇒ 表單層的 keydown 守門**不在場**
  //    ⇒ 「外層把組字中的 Enter 取消掉」這個真實故障,在那一族裡**全綠**。
  //    📌 **兩道守門各自都對, 而事件會經過兩道 —— 只量一道等於沒量。**
  function renderBoth() {
    return render(
      <form data-testid='f'>
        <ManualCustomerPicker customerRequestId={CUSTOMER_KEY} />
        <ManualOrderSubmit />
      </form>,
    );
  }

  it('組字中的 Enter:兩層都在場時,那一發【不得】被取消,也不得去查', async () => {
    renderBoth();
    const input = searchBox();
    let cancelled = false;
    await act(async () => {
      cancelled = !fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    });
    expect(cancelled).toBe(false);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('🔴 對照組:組字結束的同一發 ⇒ 被取消(不送出)而且有去查', async () => {
    renderBoth();
    const input = searchBox();
    let cancelled = false;
    await act(async () => {
      cancelled = !fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
    });
    expect(cancelled).toBe(true);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });
});

describe('🔴🔴 R6:序號要同時協調【搜尋 vs 建立】,不只是搜尋 vs 搜尋', () => {
  // 🔴 病:一發慢搜尋 + 一次建立 ⇒ 慢搜尋回來把「剛建好而且已經選起來的那位」蓋掉
  //    ⇒ 畫面上那句「幫你選起來了」還在,而**那顆 radio 已經不見了**。
  //    📌 **兩個非同步動作寫同一塊畫面, 只協調其中一對, 等於沒有協調。**
  // ⚠️ **而這個並行【只有鍵盤那條路做得出來】**:兩顆按鈕都吃 `pending`(搜尋中會變灰),
  //    而 `onEnter` 那條**不看 `pending`** ⇒ 用滑鼠的人撞不到,用鍵盤的人撞得到。
  //    ⇒ 這一格若改用 click 就會**構造不出病** —— 那會是一格恆綠。
  it('慢搜尋在建立之後才回來 ⇒ 不得動畫面', async () => {
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => {
      release = r;
    });
    mocks.search
      .mockImplementationOnce(async () => found())
      .mockImplementationOnce(async () => {
        await slow;
        return found(hit(USER_B, '不相干的人'));
      });
    renderPicker();
    await search();

    // 第二發搜尋:慢的,而且用 Enter 發(不看 pending)
    const input = searchBox();
    await act(async () => {
      fireEvent.change(input, { target: { value: '0988777666' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // 搜尋還在飛,而員工按「確認」觸發建立(同樣不看 pending)
    mocks.create.mockResolvedValue({ ok: true, idempotent: false, outcome: 'created', candidate: hit(USER_A, '王小明') });
    await act(async () => {
      // 2026-10-01 起建立的入口是事件(按「確認」時送出), 不是建立區那兩格
      requestManualCustomerCreate(document.querySelector('form'), { name: '王小明', phone: '0900000999' });
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('radio') as HTMLInputElement).checked).toBe(true);

    // 現在才讓那發慢搜尋回來 —— 它不准動畫面。
    await act(async () => {
      release(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText(/不相干的人/)).toBeNull();
    expect((screen.getByRole('radio') as HTMLInputElement).checked).toBe(true);
  });

  // 🔴🔴 **反方向那一半 —— 而我上一版把它寫【反】了,codex R7 抓到。**
  //   ⛔ ~~舊斷言:建立在飛時又發了一次搜尋 ⇒ 建立回來時不得搶回畫面~~
  //   🔴 **那一格把一個 bug 釘成了「正確行為」**:
  //     建立**已經在伺服器產生了一個真的帳號** ⇒ 把它的結果丟掉
  //     ⇒ 員工看不到剛建好的那位 ⇒ **他會再建一個** ⇒ DB 多一個真帳號,而畫面上什麼都沒說。
  //   📌 **搜尋是唯讀的, 丟掉沒有代價;建立有副作用, 丟掉的代價在別的地方付。**
  //      ⇒ 兩者不能共用同一條「舊的就丟」的規則。
  //   ⇒ 正解:**建立永遠贏** —— 結果落地時再推一次序號,把還在飛的搜尋全部作廢。
  it('🔴 建立在飛時又發了一次搜尋 ⇒ 建立回來時【要】搶回畫面(它有真副作用)', async () => {
    let release: (v: unknown) => void = () => {};
    const slowCreate = new Promise((r) => {
      release = r;
    });
    mocks.search
      .mockImplementationOnce(async () => found())
      .mockImplementationOnce(async () => found(hit(USER_B, '後來搜到的人')));
    mocks.create.mockImplementationOnce(async () => {
      await slowCreate;
      return { ok: true, idempotent: false, outcome: 'created', candidate: hit(USER_A, '王小明') };
    });

    renderPicker();
    await search();
    await act(async () => {
      // 2026-10-01 起建立的入口是事件(按「確認」時送出), 不是建立區那兩格
      requestManualCustomerCreate(document.querySelector('form'), { name: '王小明', phone: '0900000999' });
    });

    const input = searchBox();
    await act(async () => {
      fireEvent.change(input, { target: { value: '0988777666' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await act(async () => {
      release(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    // 🔴 剛建好的那位要在畫面上、而且選起來 —— 不得被那一發搜尋洗掉。
    //    (`getByText` 在這裡會同時命中候選那一列與訊息那一句 ⇒ 直接問那顆 radio 的值。)
    const radio = screen.getByRole('radio') as HTMLInputElement;
    expect(radio.value).toBe(USER_A);
    expect(radio.checked).toBe(true);
    expect(screen.queryByText(/後來搜到的人/)).toBeNull();
  });

  // 🔴🔴 **而前一格【仍然量不到「結果落地時再推一次序號」那一行】—— 我連打偏兩次。**
  //   第二次的世界:搜尋在建立【之前】發 ⇒ 建立【開始】時那一推就已經把它作廢了
  //   ⇒ 落地那一推是多餘的 ⇒ 拿掉它照樣全綠。
  //   📌 **同一個判別句用第三次:造出那個病的條件到底是什麼?**
  //      答案是:**搜尋在建立【開始之後】才發, 而且比建立【晚】回來。**
  //      —— 那時它的序號比建立大, 只有「落地再推一次」壓得住它。
  //   🔴 而我前兩次都以為自己在量它。**「我測了那條路」與「我測到那一行」是兩件事。**
  it('🔴 搜尋在建立【開始之後】才發、又比建立【晚】回來 ⇒ 仍不得洗掉剛建好的那位', async () => {
    let releaseCreate: (v: unknown) => void = () => {};
    let releaseSearch: (v: unknown) => void = () => {};
    const slowCreate = new Promise((r) => {
      releaseCreate = r;
    });
    const slowSearch = new Promise((r) => {
      releaseSearch = r;
    });
    mocks.search
      .mockImplementationOnce(async () => found())
      .mockImplementationOnce(async () => {
        await slowSearch;
        return found(hit(USER_B, '後來才回來的人'));
      });
    mocks.create.mockImplementationOnce(async () => {
      await slowCreate;
      return { ok: true, idempotent: false, outcome: 'created', candidate: hit(USER_A, '王小明') };
    });

    renderPicker();
    await search();

    // ① 建立先【開始】(慢)
    await act(async () => {
      // 2026-10-01 起建立的入口是事件(按「確認」時送出), 不是建立區那兩格
      requestManualCustomerCreate(document.querySelector('form'), { name: '王小明', phone: '0900000999' });
    });
    // ② 建立還在飛的時候,員工又發了一發搜尋(也慢)⇒ 它的序號【比建立大】
    const input = searchBox();
    await act(async () => {
      fireEvent.change(input, { target: { value: '0988777666' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    // ③ 建立先落地
    await act(async () => {
      releaseCreate(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((screen.getByRole('radio') as HTMLInputElement).value).toBe(USER_A);
    // ④ 那發搜尋現在才回來 —— 它的序號比建立【開始】時那一推大,
    //    只有「落地再推一次」壓得住它。
    await act(async () => {
      releaseSearch(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    const radio2 = screen.getByRole('radio') as HTMLInputElement;
    expect(radio2.value).toBe(USER_A);
    expect(radio2.checked).toBe(true);
    expect(screen.queryByText(/後來才回來的人/)).toBeNull();
  });
});

describe('🔴🔴 R7:預檢撞到一位很像的人 ⇒ 【不得】自動選起來', () => {
  // 🔴 上一版的處置是「自動選 + 一句警告」,而 codex R7 打掉它:
  //   **警告出現的時候, 客人已經被選好了、送出鈕也已經亮了** ⇒ 員工按下去就掛錯帳。
  //   📌 **一句警告如果沒有把下一步收回來, 它只是在旁邊講話。**
  //   而「同姓名 + 同電話 + 後台開的帳號」**只是一組長得很像的資料, 不是同一個人的證明**
  //   (一家人共用市話 + 剛好同名)⇒ 判得出來的只有人 ⇒ 把那一步交還給他。
  async function createWith(outcome: string) {
    renderPicker();
    await search();
    mocks.create.mockResolvedValue({
      ok: true,
      idempotent: outcome !== 'created',
      outcome,
      candidate: hit(USER_A, '王小明'),
    });
    await requestCreate('王小明');
  }

  it('existing ⇒ 那位出現在候選裡, 而【一顆都沒有被選起來】', async () => {
    await createWith('existing');
    expect(screen.getByRole('radio')).toBeTruthy();
    expect((screen.getByRole('radio') as HTMLInputElement).checked).toBe(false);
    const text = screen.getByTestId('manual-customer-picker-notice').textContent ?? '';
    expect(text).toContain('沒有');
    expect(text).toContain('自己確認');
    expect(text).not.toContain('已經建好');
  });

  it('🔴 對照組:created ⇒ 自動選起來 + 說「已經建好」', async () => {
    await createWith('created');
    expect((screen.getByRole('radio') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('manual-customer-picker-notice').textContent ?? '').toContain('已經建好');
  });

  it('🔴 對照組:idempotent(同一顆鍵重送)⇒ 也自動選起來 —— 那是【同一次操作】的重試', async () => {
    await createWith('idempotent');
    expect((screen.getByRole('radio') as HTMLInputElement).checked).toBe(true);
  });
});

// ── ⟦b4-收件即建客⟧ 收件那一塊 ⇒ 建客人(2026-09-06,plan §2)────────────────────────
//  🔴 **這一族全部走【整張表單】渲染, 不能只 render picker** —— 事件的射程就是那張 form,
//     picker 單獨渲染時 `.form` 是 `null`, 而那個世界的正確行為是「照實說沒接上」(見 ship-to 那支)。
// ⛔ 2026-10-01 拿掉「⟦b4-收件即建客⟧:收件那兩格 ⇒ 建客人」那一族:那顆「用這份收件人建客人」鈕已經拿掉
//    (Sean Q24 甲:改成按「確認」時建立)。它守的幾件事改由別處接手 ——
//    冪等鍵與自動選起來:「新客人:用收件人姓名電話建立」那一族;existing 不自動選:R7;
//    拋出時叫他勿重複建立:R4-MF3;任一格空不建:`manual-order-submit.test.tsx`(送出前先跑解析器)。

// ── ⟦b4-收件即建客⟧ codex 三條 must-fix 的守門(2026-09-06)─────────────────────────
//  🔴 這三格全部是【新入口繞過既有保護】那一族。共同形狀:
//     **保護畫在「舊那條路會經過的東西」上(那顆鈕的 disabled、建立區有沒有字),**
//     **而新入口不經過它們。**
describe('🔴🔴 ⟦b4-收件即建客⟧ MF1:先選了甲, 再建乙而【失敗】⇒ 一顆 radio 都不准是選中的', () => {
  // 病:甲仍被選著 + 建單鈕仍亮 ⇒ 員工以為單掛給乙, 而它會掛給甲。
  // ⛔ 同族的 MF2(搜尋壞掉也要擋)由「查【壞了】與查【無】」那一族接手;MF3(預填電話)隨建立區一起拿掉。
  it('建立失敗 ⇒ 甲被放掉, 確認鈕灰', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
    await search();
    await act(async () => {
      fireEvent.click(document.querySelector('input[type="radio"][name="customer_user_id"]')!);
    });
    expect((document.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(true);
    mocks.create.mockResolvedValue({ ok: false, reason: 'error', message: '建不出來' });
    await requestCreate('陳大文', '0922333444');
    expect(document.querySelector('input[type="radio"]:checked')).toBeNull();
    expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── 用收件電話自動找客人(Sean 2026-10-01 Q24 甲;計畫 ~/pcm-mailbox/計畫-建單收件資料合併-20261001.md 第 2 節)──
describe('收件電話自動找客人', () => {
  function renderWholeForm() {
    return render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
  }
  const shipPhone = () => screen.getByLabelText('收件人電話') as HTMLInputElement;
  const shipName = () => screen.getByLabelText('收件人') as HTMLInputElement;
  /** 打字(發 input), 再離開欄位(發 focusout ⇒ 不等 0.5 秒) */
  async function typeShipPhone(v: string, blur = true) {
    await act(async () => {
      fireEvent.input(shipPhone(), { target: { value: v } });
      if (blur) fireEvent.focusOut(shipPhone());
    });
  }
  const checked = () => document.querySelector('input[name="customer_user_id"]:checked') as HTMLInputElement | null;
  const status = () => screen.getByTestId('manual-customer-auto').textContent;

  it('剛好一位電話相同 ⇒ 自動選起來, 說「老客人, 已連結」', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderWholeForm();
    await typeShipPhone('0912-345-678');
    expect(mocks.search).toHaveBeenCalledWith('0912345678');
    expect(checked()?.value).toBe(USER_A);
    expect(checked()?.dataset.autoLinked).toBe('1');
    expect(status()).toBe('收件電話是老客人「王小明」，已連結。');
  });

  it('只有「包含」相符、數字不完全相同 ⇒ 不連結, 說找不到', async () => {
    mocks.search.mockResolvedValue(found({ ...hit(USER_A, '王小明'), phone: '0912345678' }));
    renderWholeForm();
    await typeShipPhone('12345678');
    expect(checked()).toBeNull();
    expect(screen.queryByTestId('manual-customer-candidates')).toBeNull();
    expect(status()).toBe('新客人：收件電話 12345678 找不到客人。按「確認」送出訂單時，會用收件人姓名和這支電話建立客人帳號。');
  });

  it('同一支電話好幾位 ⇒ 列出來、【不自動選】', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '林大同'), hit(USER_B, '林小美')));
    renderWholeForm();
    await typeShipPhone('0912345678');
    expect(document.querySelectorAll('input[name="customer_user_id"]')).toHaveLength(2);
    expect(checked()).toBeNull();
    expect(status()).toBe('收件電話 0912345678 有 2 位客人，請選一位。');
  });

  it('打字途中少於 9 碼不找;離開欄位時 8 碼就找', async () => {
    renderWholeForm();
    await typeShipPhone('09123456', false);
    expect(mocks.search).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.focusOut(shipPhone());
    });
    expect(mocks.search).toHaveBeenCalledWith('09123456');
  });

  it('打字停下 0.5 秒才找, 不是每打一個字找一次', async () => {
    vi.useFakeTimers();
    try {
      renderWholeForm();
      fireEvent.input(shipPhone(), { target: { value: '091234567' } });
      fireEvent.input(shipPhone(), { target: { value: '0912345678' } });
      expect(mocks.search).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(mocks.search).toHaveBeenCalledTimes(1);
      expect(mocks.search).toHaveBeenCalledWith('0912345678');
    } finally {
      vi.useRealTimers();
    }
  });

  it('自動連結後電話改短 ⇒ 放掉那位(不能留著上一支電話的人)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderWholeForm();
    await typeShipPhone('0912345678');
    expect(checked()?.value).toBe(USER_A);
    await typeShipPhone('0912');
    expect(checked()).toBeNull();
    expect(screen.queryByTestId('manual-customer-auto')).toBeNull();
  });

  it('🔴 員工自己找、選好的客人 ⇒ 收件電話再改也【不換人】(朋友代訂、寄公司)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderWholeForm();
    await search('王小明');
    fireEvent.click(screen.getByRole('radio'));
    mocks.search.mockClear();
    await typeShipPhone('0223456789');
    expect(mocks.search).not.toHaveBeenCalled();
    expect(checked()?.value).toBe(USER_A);
  });

  it('收件人和連結的客人不同名 ⇒ 提醒(不擋)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderWholeForm();
    fireEvent.change(shipName(), { target: { value: '王大明' } });
    await typeShipPhone('0912345678');
    expect(screen.getByTestId('manual-customer-auto-name-differs').textContent).toBe(
      '收件人「王大明」和這位客人的名字不同。如果訂購的不是「王小明」，請改選其他客人。',
    );
  });

  it('🔴 自動找也走同一套 fail-closed:查詢壞掉 ⇒ 不能建立客人', async () => {
    mocks.search.mockResolvedValue({ ok: false, reason: 'error' });
    renderWholeForm();
    await typeShipPhone('0912345678');
    expect(screen.getByTestId('manual-order-new-customer-blocked')).toBeTruthy();
    expect(checked()).toBeNull();
  });

  it('🔴 兩發自動查詢:慢的舊那發晚回來 ⇒ 不能蓋掉新結果', async () => {
    let releaseOld: (v: unknown) => void = () => {};
    mocks.search
      .mockImplementationOnce(() => new Promise((r) => (releaseOld = r)))
      .mockResolvedValueOnce(found(hit(USER_B, '新電話的人')));
    renderWholeForm();
    await typeShipPhone('0911111111');
    await typeShipPhone('0912345678');
    await act(async () => {
      releaseOld(found(hit(USER_A, '舊電話的人')));
    });
    expect(checked()?.value).toBe(USER_B);
  });
});

// 🆕 Sean 2026-10-01 Q24 甲:收件電話找不到客人 ⇒ 按「確認」時建客人, 建好接著送出
describe('新客人:送出時建立', () => {
  function renderWholeForm() {
    return render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
  }
  async function typeShipPhone(v: string) {
    await act(async () => {
      fireEvent.input(screen.getByLabelText('收件人電話'), { target: { value: v } });
      fireEvent.focusOut(screen.getByLabelText('收件人電話'));
    });
  }
  const form = () => document.querySelector('form') as HTMLFormElement;
  async function requestCreateThenSubmit(name = '陳大華', phone = '0423456789') {
    const { requestManualCustomerCreate } = await import('@/lib/orders/manual-customer-create-request');
    let accepted = false;
    await act(async () => {
      accepted = requestManualCustomerCreate(form(), { name, phone, thenSubmit: true });
    });
    return accepted;
  }

  it('找不到客人 ⇒ 畫出「新客人」記號(沒有 name, 不會被送出)', async () => {
    renderWholeForm();
    await typeShipPhone('0423456789');
    const marker = screen.getByTestId('manual-customer-new-pending');
    expect(marker.getAttribute('name')).toBeNull();
  });

  it('🔴 查詢壞掉 ⇒ 不畫記號(送出鈕要維持灰的, 免得替已有帳號的人再開一個)', async () => {
    mocks.search.mockResolvedValue({ ok: false, reason: 'error' });
    renderWholeForm();
    await typeShipPhone('0423456789');
    expect(screen.queryByTestId('manual-customer-new-pending')).toBeNull();
  });

  it('同電話好幾位 ⇒ 按「都不是, 建立新客人」⇒ 清單收掉、改成新客人', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '林大同'), hit(USER_B, '林小美')));
    renderWholeForm();
    await typeShipPhone('0912345678');
    fireEvent.click(screen.getByTestId('manual-customer-auto-none-of-these'));
    expect(document.querySelectorAll('input[name="customer_user_id"]')).toHaveLength(0);
    expect(screen.getByTestId('manual-customer-new-pending')).toBeTruthy();
  });

  it('建好(新建的)⇒ 選起來, 接著送出訂單', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    try {
      mocks.create.mockResolvedValue({ ok: true, idempotent: false, outcome: 'created', candidate: hit(USER_A, '陳大華') });
      renderWholeForm();
      expect(await requestCreateThenSubmit()).toBe(true);
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect((document.querySelector('input[name="customer_user_id"]:checked') as HTMLInputElement).value).toBe(USER_A);
    } finally {
      submit.mockRestore();
    }
  });

  it('🔴 撞到很像的既有帳號 ⇒ 【不送出】, 說訂單還沒送', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    try {
      mocks.create.mockResolvedValue({ ok: true, idempotent: false, outcome: 'existing', candidate: hit(USER_A, '陳大華') });
      renderWholeForm();
      await requestCreateThenSubmit();
      await waitFor(() => expect(screen.getByTestId('manual-customer-picker-notice').textContent).toContain('訂單還沒有送出'));
      expect(submit).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
    }
  });

  it('🔴 建立失敗 ⇒ 不送出, 說訂單沒有送出', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    try {
      mocks.create.mockResolvedValue({ ok: false, reason: 'invalid_phone', message: '電話格式不對。' });
      renderWholeForm();
      await requestCreateThenSubmit();
      await waitFor(() => expect(screen.getByTestId('manual-customer-picker-notice').textContent).toBe('電話格式不對。 訂單沒有送出。'));
      expect(submit).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
    }
  });

  it('🔴 連線中斷 ⇒ 不送出, 提醒帳號可能已建立', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    try {
      mocks.create.mockRejectedValue(new Error('network'));
      renderWholeForm();
      await requestCreateThenSubmit();
      await waitFor(() => expect(screen.getByTestId('manual-customer-picker-notice').textContent).toContain('訂單沒有送出'));
      expect(submit).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
    }
  });

  it('沒有要求接著送出(舊的建立入口)⇒ 建好也【不】自動送出', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    try {
      mocks.create.mockResolvedValue({ ok: true, idempotent: false, outcome: 'created', candidate: hit(USER_A, '陳大華') });
      renderWholeForm();
      const { requestManualCustomerCreate } = await import('@/lib/orders/manual-customer-create-request');
      await act(async () => {
        requestManualCustomerCreate(form(), { name: '陳大華', phone: '0423456789' });
      });
      await waitFor(() => expect(document.querySelector('input[name="customer_user_id"]:checked')).toBeTruthy());
      expect(submit).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
    }
  });
});

describe('新客人:建立還在跑的時候', () => {
  it('🔴 記號留著並標 data-creating ⇒ 確認鈕灰的(不能連按兩次), 會員等級那格仍可用', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.create.mockImplementation(() => new Promise((r) => (release = r)));
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
    const { requestManualCustomerCreate } = await import('@/lib/orders/manual-customer-create-request');
    await act(async () => {
      requestManualCustomerCreate(document.querySelector('form'), { name: '陳大華', phone: '0423456789', thenSubmit: true });
    });
    expect(screen.getByTestId('manual-customer-new-pending').dataset.creating).toBe('1');
    await waitFor(() => expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId('manual-order-tier') as HTMLSelectElement).disabled).toBe(false);
    await act(async () => {
      release({ ok: false, reason: 'error', message: '建立失敗。' });
    });
  });
});

describe('🔴 Fable R1 必修 1:收件電話一改, 上一支電話的判定立刻作廢', () => {
  function renderWholeForm() {
    return render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
  }
  const phoneEl = () => screen.getByLabelText('收件人電話');

  it('A 找不到(新客人)⇒ 改成 B、新查詢還沒回來 ⇒ 「新客人」記號馬上消失, 確認鈕灰', async () => {
    renderWholeForm();
    await act(async () => {
      fireEvent.input(phoneEl(), { target: { value: '0423456789' } });
      fireEvent.focusOut(phoneEl());
    });
    expect(screen.getByTestId('manual-customer-new-pending')).toBeTruthy();
    mocks.search.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      fireEvent.input(phoneEl(), { target: { value: '0423456780' } });
    });
    expect(screen.queryByTestId('manual-customer-new-pending')).toBeNull();
    expect((screen.getByTestId('manual-order-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('A 自動連結甲 ⇒ 改成 B ⇒ 甲馬上被放掉(不能把 B 的單掛給甲)', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    renderWholeForm();
    await act(async () => {
      fireEvent.input(phoneEl(), { target: { value: '0912345678' } });
      fireEvent.focusOut(phoneEl());
    });
    expect(document.querySelector('input[name="customer_user_id"]:checked')).toBeTruthy();
    mocks.search.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      fireEvent.input(phoneEl(), { target: { value: '0912345679' } });
    });
    expect(document.querySelector('input[name="customer_user_id"]:checked')).toBeNull();
  });

  it('按「確認」建立失敗之後, 改收件電話仍會自動找客人(Fable R1 建議 1)', async () => {
    mocks.create.mockResolvedValue({ ok: false, reason: 'error', message: '建立失敗。' });
    renderWholeForm();
    const { requestManualCustomerCreate } = await import('@/lib/orders/manual-customer-create-request');
    await act(async () => {
      requestManualCustomerCreate(document.querySelector('form'), { name: '陳大華', phone: '0423456789', thenSubmit: true });
    });
    mocks.search.mockClear();
    await act(async () => {
      fireEvent.input(phoneEl(), { target: { value: '0423456780' } });
      fireEvent.focusOut(phoneEl());
    });
    expect(mocks.search).toHaveBeenCalledWith('0423456780');
  });
});

// ── 2026-10-01 版面:客人那一塊在收件電話下面, 找客人收在「換一位客人」裡(Sean Q24 甲)──
describe('版面:客人狀態在收件電話下面', () => {
  function renderWholeForm() {
    return render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
  }

  it('客人那一塊在收件電話之後、收件地址之前', () => {
    renderWholeForm();
    const phone = screen.getByLabelText('收件人電話');
    const picker = screen.getByTestId('manual-customer-picker');
    const line = screen.getByLabelText('收件地址');
    expect(phone.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picker.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('一開始看不到找客人的框;按「換一位客人」才出現', () => {
    renderWholeForm();
    expect(screen.queryByLabelText('找客人(電話 / 姓名 / Email)')).toBeNull();
    fireEvent.click(screen.getByTestId('manual-customer-change'));
    expect(screen.getByLabelText('找客人(電話 / 姓名 / Email)')).toBeTruthy();
  });

  it('🔴 舊的建立區、「同上」、「用這份收件人建客人」都不在了', () => {
    renderWholeForm();
    expect(screen.queryByTestId('manual-order-new-customer')).toBeNull();
    expect(screen.queryByRole('button', { name: '建立這位客人' })).toBeNull();
    expect(screen.queryByTestId('manual-order-ship-to-copy')).toBeNull();
    expect(screen.queryByTestId('manual-order-ship-to-create-customer')).toBeNull();
    expect(document.querySelector('[name="new_customer_name"], [name="new_customer_phone"]')).toBeNull();
  });
});

describe('換一位客人 ⇒ 找不到 ⇒ 改用收件電話找客人(Fable 4b R1 建議 1:不能卡死)', () => {
  it('手動找查無 ⇒ 按「改用收件電話找客人」⇒ 用收件電話重找, 找不到就是新客人', async () => {
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('收件人電話'), { target: { value: '0423456789' } });
    mocks.search.mockResolvedValue(found());
    await search('王大同');
    expect(screen.queryByTestId('manual-customer-new-pending')).toBeNull();
    mocks.search.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId('manual-customer-back-to-auto'));
    });
    expect(mocks.search).toHaveBeenCalledWith('0423456789');
    expect(screen.getByTestId('manual-customer-new-pending')).toBeTruthy();
    expect(screen.queryByTestId('manual-customer-search')).toBeNull();
  });

  it('同電話好幾位、還沒選 ⇒ 確認鈕下面叫他【選一位】, 不是叫他填電話', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '林大同'), hit(USER_B, '林小美')));
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
    await act(async () => {
      fireEvent.input(screen.getByLabelText('收件人電話'), { target: { value: '0912345678' } });
      fireEvent.focusOut(screen.getByLabelText('收件人電話'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('manual-order-submit-hint').textContent).toBe('請在收件電話下面選一位客人。'),
    );
  });
});

describe('版面:剛好一位已連結時排成一行(建單簡化 S4)', () => {
  it('名字旁邊寫「已連結」, 狀態句仍給輔助科技讀', async () => {
    mocks.search.mockResolvedValue(found(hit(USER_A, '王小明')));
    render(
      <ManualOrderFormBody
        manualRequestId={ORDER_KEY}
        customerRequestId={CUSTOMER_KEY}
        activeStaff={[{ id: 'alice', label: '小愛' }]}
        staffLoadFailed={false}
      />,
    );
    await act(async () => {
      fireEvent.input(screen.getByLabelText('收件人電話'), { target: { value: '0912345678' } });
      fireEvent.focusOut(screen.getByLabelText('收件人電話'));
    });
    expect(screen.getByTestId('manual-customer-candidates').dataset.compact).toBe('1');
    expect(screen.getByRole('radio', { name: /王小明.*已連結/ })).toBeTruthy();
    expect(screen.getByTestId('manual-customer-auto').className).toContain('sr-only');
  });
});
