// @vitest-environment jsdom
//
// app/logout/page.tsx 的證人 — `#883`(2026-08-23,cf)
//
// 🔴 這一頁曾經【斷言一個它自己沒有造成的狀態】:直接輸入 `/logout` 網址 ⇒ 印「您已登出」,
//   而 auth cookie 還在、`/account` 照樣進得去(真瀏覽器實測)。
//   ⇒ 修法是三態:`signedOut` / `signedIn` / **`unknown`(讀不到 ⇒ 兩句都不說)**。
//
// ⚠️ **本檔的射程**:它驗的是「哪一句話會被印出來」。
//   它**不驗**「那顆按鈕按下去真的會登出」—— 那要真瀏覽器(或至少一發 server action 實跑),
//   本檔只斷言那顆按鈕**接的是與會員中心同一支 `logoutAction`**(見最後一格)。
//   🔴 **不要把本檔全綠讀成「登出功能驗過了」。**
//   🔴 而**本片沒有任何一道會紅的尺覆蓋「登出真的生效」** —— 那件事今天只有
//     2026-08-23 那一發真瀏覽器量過(按下去 cookie 消失、`/account` 被導去 `/login`),
//     而**那一發不會自己重跑**。下一個人改這頁時,那個保證不會替他成立。
//
// ⚠️ **另一個射程限制(R1 nit N11,實查)**:本檔**被 eslint ignore**
//   (`npx eslint …/page.test.tsx` ⇒ `File ignored because of a matching ignore pattern`)
//   ⇒ **三綠裡的 lint 那一綠,對本檔零判別力。** 不要把「lint 過了」讀成「這支測試審過了」。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const cookieRows: { name: string }[] = [];
let getUserResult: { data: { user: { id: string } | null }; error: unknown } = {
  data: { user: null },
  error: { message: 'no session' },
};
let getUserThrows = false;

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => cookieRows }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => {
        if (getUserThrows) throw new Error('auth server 掛了');
        return getUserResult;
      },
    },
  }),
}));
// 🔴 server action 換成一個**可辨識的替身**:本檔要斷言的是「那顆按鈕接的是它」,
//   而不是它做了什麼。用真的那一支會把 auth 拉進 jsdom。
const logoutSpy = vi.fn();
vi.mock('@/app/account/actions', () => ({ logoutAction: logoutSpy }));
// Header / Footer 在 server render 下會拉進一票 client hook,與本檔要驗的東西無關。
vi.mock('@/components/Header', () => ({ Header: () => <div data-testid="hdr" /> }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <div data-testid="ftr" /> }));

const { default: LogoutPage } = await import('./page');

const AUTH_COOKIE = 'sb-probe-auth-token';

async function renderPage() {
  cleanup();
  render(await LogoutPage());
}

beforeEach(() => {
  cookieRows.length = 0;
  getUserThrows = false;
  logoutSpy.mockClear(); // codex must-fix 4:要數「被呼叫幾次」,每格就得從 0 開始
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://probe.supabase.co';
  getUserResult = { data: { user: null }, error: { message: 'no session' } };
});

describe('#883 /logout 只說它讀得到的那句話', () => {
  // 🔴 該綠那格排第一:這是**今天每一次真實登出**都會走的路,誤紅的代價最大。
  it('確定沒有 session ⇒ 照樣印「您已登出」,而且不出現登出按鈕', async () => {
    await renderPage();
    expect(screen.getByText('您已登出')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '登出' })).toBeNull();
  });

  it('還登著 ⇒ 印「您目前仍在登入中」+ 一顆登出按鈕', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserResult = { data: { user: { id: 'u-1' } }, error: null };
    await renderPage();
    expect(screen.getByText('您目前仍在登入中')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();
  });

  // 🔴 負對照:上一格若只斷言「有那句新的」,一個【兩句都印】的錯實作會全綠。
  it('還登著時【不得】出現「您已登出」那五個字', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserResult = { data: { user: { id: 'u-1' } }, error: null };
    await renderPage();
    expect(screen.queryByText('您已登出')).toBeNull();
  });

  it('讀不到(有 cookie 但 getUser 回 error)⇒ 兩句斷言都不說,但按鈕在', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserResult = { data: { user: null }, error: { message: '網路抖' } };
    await renderPage();
    expect(screen.queryByText('您已登出')).toBeNull();
    expect(screen.queryByText('您目前仍在登入中')).toBeNull();
    expect(screen.getByText('尚未確認您的登入狀態')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();
  });

  // 🔴🔴 codex R1 must-fix ×2:同一件事在畫面上**不只一個出口**,而我只改了我當時在想的那兩個。
  //   判別句(交接檔也寫了):**這個頁面上還有哪幾處在【說同一件事】?**
  //   —— 不是「我改了哪個元件」,是「這件事在畫面上有幾個出口」。
  it('🔴 讀不到時,那個小標籤【不准】說 STILL SIGNED IN', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserResult = { data: { user: null }, error: { message: '網路抖' } };
    await renderPage();
    expect(screen.queryByText('N°ACCOUNT · STILL SIGNED IN')).toBeNull();
    expect(screen.getByText('N°ACCOUNT · STATUS UNKNOWN')).toBeTruthy();
  });

  it('負對照:真的還登著 ⇒ 那個標籤【要】說 STILL SIGNED IN', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserResult = { data: { user: { id: 'u-1' } }, error: null };
    await renderPage();
    expect(screen.getByText('N°ACCOUNT · STILL SIGNED IN')).toBeTruthy();
  });

  it('🔴 頁籤標題【不准】固定寫「已登出」—— 那是另一個出口', async () => {
    const { metadata } = await import('./page');
    expect(String(metadata.title)).not.toContain('已登出');
    expect(String(metadata.title)).toContain('登出'); // 仍要說得出這是哪一頁
  });

  it('getUser 直接丟例外 + 有 cookie ⇒ 一樣是「讀不到」,不是「已登出」', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserThrows = true;
    await renderPage();
    expect(screen.queryByText('您已登出')).toBeNull();
    expect(screen.getByText('尚未確認您的登入狀態')).toBeTruthy();
  });

  // 🔴 沒有 cookie ⇒ 就算 getUser 壞掉,也是【確定沒人】—— 否則真正登出的人會看到「尚未確認」。
  it('沒有 auth cookie + getUser 丟例外 ⇒ 仍判「已登出」', async () => {
    getUserThrows = true;
    await renderPage();
    expect(screen.getByText('您已登出')).toBeTruthy();
  });

  // 🔴🔴 **這一格 2026-08-23 重寫過,而原版是【恆綠】的**(R1 must-fix,實測確認):
  //   ~~`const { logoutAction } = await import(…); expect(logoutAction).toBe(logoutSpy)`~~
  //   —— 那行比的是 **mock 跟它自己**,與 `page.tsx` 渲染出什麼**完全無關**。
  //   實測:把 `<form action={logoutAction}>` 換成 `<form action={async () => { 'use server'; }}>`
  //   (= **複製第二份登出路徑**,正是這格宣稱要抓的事)⇒ **7 格照樣全綠。**
  //   📌 形狀:**一個「取得 → 比對」的動作,兩端都來自我自己擺的東西時,它不通往被驗物。**
  //   ⇒ 改成讀**原始碼字面**。
  // ⚠️ **天花板**:這是字面比對。改成 `action={LOGOUT}`(先 alias)或動態組出來,它都掃不到。
  //   ⇒ 它守的是「有沒有人把 form 換成另一份 action」這個**最可能的退化**,不是所有寫法。
  it('那顆按鈕的 form 綁的是【與會員中心同一支】logoutAction,不是複製的第二份', async () => {
    cookieRows.push({ name: AUTH_COOKIE });
    getUserResult = { data: { user: { id: 'u-1' } }, error: null };
    await renderPage();
    expect(screen.getByRole('button', { name: '登出' }).closest('form')).toBeTruthy();

    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    // 🔴 自檢:剝完之後那一行還要在,否則下面那個斷言是在一份被剝爛的字串上跑(恆綠的另一種長相)。
    expect(src, '剝註解剝過頭 ⇒ 下面的斷言沒有判別力').toContain('logoutAction');
    expect(src, 'form 的 action 不是那一支共用的 logoutAction ⇒ 有人複製了第二份登出路徑').toMatch(
      /<form\s+action=\{logoutAction\}\s*>/,
    );
    // 🔴🔴 codex 對抗審查 must-fix 3(2026-08-24,**真 runner 覆驗過才修**):
    //   上面兩條可以**分別**被滿足 —— 攻擊形狀是
    //     ① 可見的那顆按鈕改綁**第二份** action(`<form action={async () => {'use server'}}>`)
    //     ② 另外放一個**空的**誘餌 `<form action={logoutAction}></form>`
    //   ⇒ `closest('form')` 由 ① 滿足、字面 regex 由 ② 滿足,**兩條都綠而登出路徑是錯的**。
    //   實跑覆驗(不是照抄 codex 的推理):
    //     只做 ①(不放誘餌)     ⇒ Test Files 1 failed · Tests 1 failed | 9 passed · exit=1
    //     ①+② 一起(誘餌非自閉合)⇒ Test Files 1 passed · Tests 10 passed      · exit=0  ← 真的瞎了
    //   📌 而我第一次的重現**失敗了**:誘餌寫成自閉合 `<form action={logoutAction} />`,
    //     regex 的 `\s*>` 對不上那個 `/` ⇒ 紅了。**「重現不出來」曾經差點被我讀成「這條不成立」。**
    //   ⇒ 堵法:這一頁**只准有一個 form**。誘餌一放進來,數量就從 1 變 2。
    const formOpenTags = src.match(/<form\b/g) ?? [];
    expect(
      formOpenTags.length,
      '/logout 只該有【一個】form(那顆登出按鈕的)。多出來的那個是誘餌:' +
        '它讓「字面有 logoutAction」與「按鈕外面有 form」變成兩件可以分開滿足的事。',
    ).toBe(1);
  });

  // 🔴🔴 codex 對抗審查 must-fix 4(2026-08-24,**真 runner 覆驗過才修**)。
  //   攻擊形狀:在 `LogoutPage()` 的 **render 階段**插一行 `await logoutAction()`
  //   ⇒ GET、prefetch、RSC render 都會**誤登出**(客人只是滑過一個連結就被登出)。
  //   實跑覆驗:插入那一行之後 ⇒ **Tests 10 passed · exit=0** —— 本檔十格**一格都沒紅**。
  //   成因:本檔全檔**零**「spy 被呼叫幾次」的斷言 ⇒ 那件事沒有任何一雙眼睛在看。
  //   🔴 而它特別打臉:**丙案的理由就是「擋 prefetch 誤登出」** —— 宣稱擋掉的東西,守它的尺不存在。
  describe('render 只准是唯讀的 —— 光是打開這一頁不得登出任何人', () => {
    // ⚠️ 三個世界都要驗,因為「render 階段誤登出」可以只寫在其中一條分支裡。
    it.each([
      ['確定沒有 session', () => {}],
      ['還登著', () => {
        cookieRows.push({ name: AUTH_COOKIE });
        getUserResult = { data: { user: { id: 'u-1' } }, error: null };
      }],
      ['讀不到', () => {
        cookieRows.push({ name: AUTH_COOKIE });
        getUserResult = { data: { user: null }, error: { message: '網路抖' } };
      }],
    ])('%s ⇒ render 期間 logoutAction 一次都不准被呼叫', async (_label, setup) => {
      setup();
      await renderPage();
      expect(
        logoutSpy,
        'render 階段呼叫了 logoutAction ⇒ GET / prefetch / RSC render 都會把客人登出',
      ).not.toHaveBeenCalled();
    });

    // 🔴 對照組:沒有這一格,上面三格在「spy 根本沒接上」的世界也會全綠 ——
    //   而那個世界與「render 是唯讀的」印同一句話。
    it('對照組:直接呼叫那支 action ⇒ spy 真的數得到(否則上面三格是恆真的)', async () => {
      const { logoutAction } = await import('@/app/account/actions');
      await logoutAction();
      expect(logoutSpy).toHaveBeenCalledTimes(1);
    });
  });
});
