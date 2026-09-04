// @vitest-environment jsdom
//
// RegisterPage smoke test(M-1-14e-f1-b、#181 表單 UX 強化)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + 無社交鈕(D-e、鐵則 1:design L256-308 確無)
//   + 四欄必填 label 全形「（必填）」統一(#181 Q1=B)+「登入」連 /login
//   + client 逐欄 inline error(空欄專屬「請填寫…」、Q2=B)+ server 雙通道(fieldErrors / formError 互不取代、釘死 2)。
// mock '@/app/register/actions':避免載 server action(transitively import server-only / @pcm/adapters/server)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke 慣例)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/register/actions', () => ({
  registerAction: vi.fn(),
}));

import { RegisterPage } from './RegisterPage';
import { registerAction } from '@/app/register/actions';
import { CartProvider } from '@/contexts/CartContext';

const mockRegister = vi.mocked(registerAction);

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

beforeEach(() => mockRegister.mockReset());
afterEach(cleanup);

function renderPage(next?: string) {
  render(<CartProvider><RegisterPage next={next} /></CartProvider>);
}

// 🔴 codex 關卡2 N5:原本永遠以「無 next」渲染 ⇒ 沒釘住編碼 / 惡意值收斂 / 原路徑保存。
describe('RegisterPage · #190 next 往下游傳遞', () => {
  it('有 next → 「登入」連結帶著它(且經過編碼)', () => {
    renderPage('/checkout');
    expect(screen.getByText('登入').getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/checkout')}`);
  });

  it('🔴 惡意 next 被收斂成 /,不是原樣塞進連結', () => {
    renderPage('//evil.example.com');
    expect(screen.getByText('登入').getAttribute('href')).toBe(`/login?next=${encodeURIComponent('/')}`);
    expect(screen.getByText('登入').getAttribute('href')).not.toContain('evil');
  });

  it('無 next → 裸連結,不掛空參數', () => {
    renderPage();
    expect(screen.getByText('登入').getAttribute('href')).toBe('/login');
  });
});

/** 填妥所有必填欄 + 勾同意,使 client 逐欄驗證通過、會呼叫 registerAction。 */
function fillValid() {
  fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王小明' } });
  fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'rider@pcm.com' } });
  fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '0912345678' } });
  fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('RegisterPage', () => {
  it('renders design 字面 without crashing', () => {
    renderPage();
    expect(screen.getByText('加入 PCM')).toBeDefined();
    expect(screen.getByText('建立帳號，享會員價與專屬優惠。')).toBeDefined();
    expect(screen.getByText('N°02 · Sign up')).toBeDefined();
    expect(screen.getByRole('button', { name: '建立帳號' })).toBeDefined();
  });

  it('無社交鈕(D-e、鐵則 1:design L256-308 確無 Google/LINE)', () => {
    renderPage();
    expect(screen.queryByText('使用 Google 登入')).toBeNull();
    expect(screen.queryByText('使用 LINE 登入')).toBeNull();
  });

  it('四欄必填 label 全形「（必填）」統一(#181 Q1=B)', () => {
    renderPage();
    expect(screen.getByText('姓名（必填）')).toBeDefined();
    expect(screen.getByText('Email（必填）')).toBeDefined();
    expect(screen.getByText('手機（必填）')).toBeDefined();
    expect(screen.getByText('密碼（必填）')).toBeDefined();
  });

  it('「登入」連到 /login', () => {
    renderPage();
    const link = screen.getByRole('link', { name: '登入' });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('client 空送出 → 逐欄專屬「請填寫…」+「請同意服務條款」、不呼叫 registerAction(Q2=B)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(screen.getByText('請填寫姓名')).toBeDefined();
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(screen.getByText('請填寫手機')).toBeDefined();
    expect(screen.getByText('請填寫密碼')).toBeDefined();
    expect(screen.getByText('請同意服務條款')).toBeDefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('server 回 formError(此 Email 已註冊)→ 頂部帳號層級通道(釘死 2、不被逐欄取代)', async () => {
    mockRegister.mockResolvedValue({ formError: '此 Email 已註冊' });
    renderPage();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(await screen.findByText('此 Email 已註冊')).toBeDefined();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('server 回 fieldErrors → 對應欄逐欄顯示(Q2=B server 也逐欄)', async () => {
    mockRegister.mockResolvedValue({ fieldErrors: { email: 'Email 格式不正確' } });
    renderPage();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(await screen.findByText('Email 格式不正確')).toBeDefined();
  });

  // ── 錯誤訊息隨輸入清除(2026-08-08 全站掃測 B 級)────────────────────────────
  it('改姓名 → 只清姓名那欄的錯,其餘四欄的錯留著(逐欄清)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(screen.getByText('請填寫姓名')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王' } });

    expect(screen.queryByText('請填寫姓名')).toBeNull();
    // 🔴 判別力在這四條:改成「動任一欄就全清」的話它們會紅。
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(screen.getByText('請填寫手機')).toBeDefined();
    expect(screen.getByText('請填寫密碼')).toBeDefined();
    expect(screen.getByText('請同意服務條款')).toBeDefined();
  });

  it('🔴 勾「同意條款」→ 清掉 agree 那欄的錯(與 LoginPage 的「記住我」相反)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(screen.getByText('請同意服務條款')).toBeDefined();

    fireEvent.click(screen.getByRole('checkbox'));

    // agree 是 RegisterField 的一員、有自己的 fieldErrors.agree ⇒ 這顆 checkbox 要接清除;
    // LoginPage 的「記住我」不是驗證欄 ⇒ 那邊不接。判準是「有沒有自己的錯」不是「是不是 checkbox」。
    expect(screen.queryByText('請同意服務條款')).toBeNull();
    expect(screen.getByText('請填寫姓名')).toBeDefined(); // 其餘欄不受影響
  });
  // ── 手機欄要叫得出數字鍵盤(2026-09-03 `-account` 手機走查發現)────────────────
  // 🔴 這一格【測得到什麼、測不到什麼】要寫清楚, 免得被讀寬:
  //    測得到 = 那三個屬性各自被拿掉時都會紅(三發突變各跑過一次, 見 commit body)。
  //    測不到 = 「iPhone 真的跳出數字鍵盤」—— 那要真機, jsdom 沒有鍵盤。
  //    ⇒ 它守的是【屬性不被無聲刪掉】, 不是行為。
  // ⛔ ~~autoComplete 是 `tel-national` 不是 `tel`:理由在 RegisterPage.tsx 的手機欄~~
  // 🔴🔴 **2026-09-04 換成 `tel`**(主視窗-94 裁;`⟦b4-PHONEREGEXSPLIT⟧`)——
  //    `tel-national` 當初**不是因為它比較好**, 是因為**舊 regex 收不下 `+`**;
  //    Sean 拍甲把那條 regex 拿掉之後, **那個理由就不存在了**。
  // 📌 **而這一格是【那一發沒跑測試】的證據**:改 `.tsx` 而只跑了 typecheck ⇒ 它沒紅在我手上,
  //    紅在推前驗收。⇒ **typecheck 答的是「型別對不對」, 答不了「行為變了沒」。**
  it('手機欄帶 type/inputMode=tel 與 autoComplete=tel(拿掉任一就紅)', () => {
    renderPage();
    const phone = screen.getByPlaceholderText('0912 345 678');
    expect(phone.getAttribute('type')).toBe('tel');
    expect(phone.getAttribute('inputmode')).toBe('tel');
    expect(phone.getAttribute('autocomplete'), '換回 tel-national ⇒ 通訊錄存 +886 的人自動填入又被降級').toBe('tel');
  });
});
