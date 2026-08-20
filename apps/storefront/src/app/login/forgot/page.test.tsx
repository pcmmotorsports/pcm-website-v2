// app/login/forgot/page.test.tsx — 忘記密碼 route 的 next 傳遞 + 渲染語意(codex 關卡2 N7)
//
// 🔴 為什麼這支存在:#190 把本 route 從【同步、靜態】改成【async + 讀 searchParams】。
//   讀 searchParams 會讓這一頁變成**每次請求都跑的動態渲染**,不再預渲染成靜態 HTML。
//   那個代價當時**沒有測試也沒有寫進驗收** ⇒ 下一個人看不出它是刻意的還是手滑。
//   ⇒ 這裡把兩件事都釘住:①next 真的傳到元件 ②沒有 next 時傳的是 undefined、不是空字串或 '/'。
//
// ⚠️ 這支**證不到**「Next 真的把它標成 dynamic」—— 那是框架行為、要在 build 產物裡看。
//   本片實測 `pnpm build` 通過,而 /login/forgot 的渲染標記未逐字核對 ⇒ **未確認**,
//   缺的那道檢查 = 讀 build 輸出的 route 表。權衡:這一頁本來就沒有快取價值(表單頁、無資料),
//   而帶 next 是客人拿得到的收益 ⇒ 接受動態。

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/components/ForgotPasswordPage', () => ({
  ForgotPasswordPage: (props: { next?: string }) => props,
}));

import ForgotPasswordRoute from './page';

async function run(sp: { next?: string }) {
  return (await ForgotPasswordRoute({ searchParams: Promise.resolve(sp) })) as {
    props: { next?: string };
  };
}

describe('/login/forgot route · #190 next 傳遞', () => {
  it('有 next → 原樣傳給元件(白名單在元件/sink 端套,不在 route)', async () => {
    const el = await run({ next: '/checkout' });
    expect(el.props.next).toBe('/checkout');
  });

  it('🔴 惡意 next 也【原樣】傳下去 —— 收斂責任在 sink,不在這裡重複一份', async () => {
    // 對齊 app/login/page.tsx:21 逐字「next 原樣傳給 client(同源白名單在 sink 端套用、非此處)」。
    // 兩個地方各驗一次 = 兩份權威,而權威只能有一個。
    const el = await run({ next: '//evil.example.com' });
    expect(el.props.next).toBe('//evil.example.com');
  });

  it('無 next → undefined(不是空字串、也不是 /)', async () => {
    // 🔴 這一格釘住「不掛空參數」那個行為的上游:傳 '' 或 '/' 下去,連結會變成 /login?next=%2F。
    const el = await run({});
    expect(el.props.next).toBeUndefined();
  });
});
