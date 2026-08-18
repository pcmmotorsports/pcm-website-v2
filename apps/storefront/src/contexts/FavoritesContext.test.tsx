// @vitest-environment jsdom
//
// FavoritesContext 行為守門(M-4b #191)。
//
// 🔴 這支測的四件事,都是「畫面說一套、實際另一套」的形狀:
// ```
// ① 未登入按愛心 ⇒ 帶去 /login?next=<現在這頁>，而且【不得】把它畫成已收藏
// ② 登入後按下去 ⇒ 先變紅（樂觀更新）
// ③ server 回錯 ⇒ 【退回】+ 講出來（只退回不講 = 客人以為自己按錯）
// ④ 登出 ⇒ 收藏清空（否則下一個人會看到上一個人的紅心）
// ```
// ⚠️ 測不到的:server action 本身(那是 `app/account/favorites/actions.ts` 的事)、
//    以及 Next 對 `'use server'` 模組的打包行為(那要真的開伺服器看)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/products/probe-1',
}));

/** 假的 auth：測試自己決定「現在有沒有登入」。 */
let emitAuth: ((session: { user: { id: string } } | null) => void) | null = null;
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        emitAuth = (session) => cb('INITIAL_SESSION', session);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

const listFavoriteHandlesAction = vi.fn(async () => ['already-fav']);
const addFavoriteAction = vi.fn(async (_h: string) => ({ ok: true }) as { ok: true } | { error: string });
const removeFavoriteAction = vi.fn(async (_h: string) => ({ ok: true }) as { ok: true } | { error: string });
vi.mock('@/app/account/favorites/actions', () => ({
  listFavoriteHandlesAction: (...a: []) => listFavoriteHandlesAction(...a),
  addFavoriteAction: (h: string) => addFavoriteAction(h),
  removeFavoriteAction: (h: string) => removeFavoriteAction(h),
}));

import { FavoritesProvider, useFavorites } from './FavoritesContext';

function Heart({ handle = 'probe-1' }: { handle?: string }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  return (
    <button type="button" aria-pressed={isFavorite(handle)} onClick={() => toggleFavorite(handle)}>
      收藏
    </button>
  );
}

const heart = () => screen.getByRole('button', { name: '收藏' });
const login = async (id = 'u-1') => {
  await act(async () => {
    emitAuth!({ user: { id } });
  });
};

beforeEach(() => {
  push.mockClear();
  listFavoriteHandlesAction.mockClear();
  addFavoriteAction.mockClear();
  removeFavoriteAction.mockClear();
  addFavoriteAction.mockResolvedValue({ ok: true });
  removeFavoriteAction.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('FavoritesContext', () => {
  it('🔴 未登入按愛心 → 帶去登入(帶 next),而且不變紅、不打 server', async () => {
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await act(async () => {
      heart().click();
    });
    expect(push).toHaveBeenCalledWith('/login?next=%2Fproducts%2Fprobe-1');
    expect(addFavoriteAction).not.toHaveBeenCalled();
    expect(heart().getAttribute('aria-pressed')).toBe('false');
  });

  it('未登入時不去讀收藏清單(訪客不該多打一趟 server)', async () => {
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    expect(listFavoriteHandlesAction).not.toHaveBeenCalled();
  });

  it('登入後載入既有收藏 → 已收藏的那顆是紅的', async () => {
    render(
      <FavoritesProvider>
        <Heart handle="already-fav" />
      </FavoritesProvider>,
    );
    await login();
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));
  });

  it('登入後按下去 → 樂觀變紅 + 呼 add', async () => {
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click();
    });
    expect(addFavoriteAction).toHaveBeenCalledWith('probe-1');
    expect(heart().getAttribute('aria-pressed')).toBe('true');
  });

  it('🔴 server 回錯 → 愛心退回去,而且客人看得見那行字', async () => {
    addFavoriteAction.mockResolvedValue({ error: '收藏沒有存成功,請再試一次' });
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click();
    });
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByRole('alert').textContent).toContain('收藏沒有存成功');
  });

  it('🔴 取消收藏失敗 → 退回成【已收藏】(不是退回成空)', async () => {
    removeFavoriteAction.mockResolvedValue({ error: '收藏沒有存成功,請再試一次' });
    render(
      <FavoritesProvider>
        <Heart handle="already-fav" />
      </FavoritesProvider>,
    );
    await login();
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));
    await act(async () => {
      heart().click();
    });
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));
    expect(removeFavoriteAction).toHaveBeenCalledWith('already-fav');
  });

  it('🔴 登出 → 清空(下一個人不該看到上一個人的紅心)', async () => {
    render(
      <FavoritesProvider>
        <Heart handle="already-fav" />
      </FavoritesProvider>,
    );
    await login();
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));
    await act(async () => {
      emitAuth!(null);
    });
    expect(heart().getAttribute('aria-pressed')).toBe('false');
  });

  // ── 以下四格來自 codex 對抗審查(2026-08-18 關卡2)抓到的 must-fix ──────────────
  // 🔴 共同形狀:**四件都是「畫面與 DB 不一致,而客人看不出來」** —— 與本片要治的病同族。

  it('🔴 must-fix 1:A 帳號【直接切成】B ⇒ 不得讓 B 看到 A 的紅心', async () => {
    listFavoriteHandlesAction.mockImplementation(async () => ['already-fav']);
    render(
      <FavoritesProvider>
        <Heart handle="already-fav" />
      </FavoritesProvider>,
    );
    await login('u-1');
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));
    // B 的收藏是空的
    listFavoriteHandlesAction.mockImplementation(async () => []);
    // 🔴 中間【沒有登出】—— 舊版存布林時,這一步是 true→true ⇒ effect 不重跑 ⇒ B 看到 A 的紅心
    await login('u-2');
    await waitFor(() =>
      expect(
        heart().getAttribute('aria-pressed'),
        'B 看到了 A 的收藏 ⇒ 換帳號沒有讓清單重新載入',
      ).toBe('false'),
    );
    expect(listFavoriteHandlesAction).toHaveBeenCalledTimes(2);
  });

  it('🔴 must-fix 3:同一顆快速開→關 ⇒ 兩支 action【依序】送出(不得同時在路上)', async () => {
    const order: string[] = [];
    let releaseAdd: () => void = () => {};
    addFavoriteAction.mockImplementation(
      () =>
        new Promise((r) => {
          order.push('add-start');
          releaseAdd = () => {
            order.push('add-end');
            r({ ok: true });
          };
        }),
    );
    removeFavoriteAction.mockImplementation(async () => {
      order.push('remove-start');
      return { ok: true };
    });
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click(); // add
      heart().click(); // remove
    });
    // add 還沒回來 ⇒ remove 不得已經送出去
    expect(order, 'remove 在 add 還沒結束就送出去了 ⇒ 到達順序無保證').toEqual(['add-start']);
    await act(async () => {
      releaseAdd();
      await Promise.resolve();
    });
    await waitFor(() => expect(order).toEqual(['add-start', 'add-end', 'remove-start']));
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
    removeFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴 must-fix 4:回應在【登出之後】才到 ⇒ 不得把上一個人的紅心 rollback 到畫面上', async () => {
    let fail: () => void = () => {};
    addFavoriteAction.mockImplementation(
      () => new Promise((r) => { fail = () => r({ error: '存不起來' }); }),
    );
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click();
    });
    await act(async () => {
      emitAuth!(null); // 登出
    });
    await act(async () => {
      fail(); // 上一個人的失敗這時候才回來
      await Promise.resolve();
    });
    expect(heart().getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.queryByRole('alert'),
      '登出後還把上一個人的失敗訊息貼到畫面上',
    ).toBeNull();
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴 must-fix 5:action 丟出帶內部細節的例外 ⇒ 畫面只准出現固定文案', async () => {
    addFavoriteAction.mockImplementation(async () => {
      throw new Error('Failed to fetch dynamically imported module: http://x/_next/static/chunks/abc.js');
    });
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click();
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text, '內部細節漏到客人畫面上了').not.toContain('_next');
    expect(text, '內部細節漏到客人畫面上了').not.toContain('http');
    expect(text).toContain('收藏沒有存成功');
    expect(heart().getAttribute('aria-pressed'), '失敗了卻沒退回').toBe('false');
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('沒有 Provider 也不炸(愛心只是沒作用)', () => {
    render(<Heart />);
    expect(heart().getAttribute('aria-pressed')).toBe('false');
    expect(() => heart().click()).not.toThrow();
  });
});
