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

type ActionResult = { ok: true } | { error: string };
const listFavoriteHandlesAction = vi.fn(async () => ['already-fav']);
// 🔴 第二個參數(expectedUserId)要**原樣轉進去** —— 少了它,守「換帳號那一發」的那格
//   會拿到 undefined 而永遠紅,而病根在測試的 mock、不在 code(2026-08-18 真的踩到)。
const addFavoriteAction = vi.fn(
  async (_h: string, _owner?: string) => ({ ok: true }) as ActionResult,
);
const removeFavoriteAction = vi.fn(
  async (_h: string, _owner?: string) => ({ ok: true }) as ActionResult,
);
vi.mock('@/app/account/favorites/actions', () => ({
  listFavoriteHandlesAction: (...a: []) => listFavoriteHandlesAction(...a),
  addFavoriteAction: (h: string, owner?: string) => addFavoriteAction(h, owner),
  removeFavoriteAction: (h: string, owner?: string) => removeFavoriteAction(h, owner),
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
    expect(addFavoriteAction).toHaveBeenCalledWith('probe-1', 'u-1');
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
    expect(removeFavoriteAction).toHaveBeenCalledWith('already-fav', 'u-1');
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

  it('🔴 must-fix 3-a:同一 tick 連按兩下(開→關)⇒ 淨結果是【沒收藏】,而且【一發都不必送】', async () => {
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click(); // 想要收藏
      heart().click(); // 又不要了
    });
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('false'));
    // 🔴 狀態機比對的是「客人最後的意思」與「server 確認過的狀態」——
    //   兩邊都是「沒收藏」⇒ 根本沒有落差 ⇒ 不送任何請求。
    //   (舊的排隊版會送 add 再送 remove,兩趟網路換一個沒變的結果。)
    expect(addFavoriteAction).not.toHaveBeenCalled();
    expect(removeFavoriteAction).not.toHaveBeenCalled();
  });

  it('🔴 must-fix 3-b:前一發還在路上時再按 ⇒ 第二發要等它結束才送(不得同時在路上)', async () => {
    const order: string[] = [];
    let releaseAdd: (v: { ok: true }) => void = () => {};
    addFavoriteAction.mockImplementation(() => {
      order.push('add-start');
      return new Promise((r) => {
        releaseAdd = (v) => { order.push('add-end'); r(v); };
      });
    });
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
      heart().click(); // add 送出去
    });
    await waitFor(() => expect(order).toEqual(['add-start']));
    await act(async () => {
      heart().click(); // add 還沒回來就再按一次
    });
    expect(order, 'remove 在 add 還沒結束就送出去了 ⇒ 到達順序無保證').toEqual(['add-start']);
    await act(async () => {
      releaseAdd({ ok: true });
    });
    await waitFor(() => expect(order).toEqual(['add-start', 'add-end', 'remove-start']));
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('false'));
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
    removeFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴 R2 must-fix 1:add 失敗、期間客人又按了兩下 ⇒ 畫面不得停在「DB 有、畫面沒有」', async () => {
    // 第一發 add 失敗;失敗的當下,客人已經按到「想要收藏」。
    let failAdd: (v: { error: string }) => void = () => {};
    addFavoriteAction.mockImplementation(
      () => new Promise((r) => { failAdd = r; }),
    );
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      heart().click(); // add(送出)
    });
    await act(async () => {
      heart().click(); // remove(改 desired)
      heart().click(); // add(改 desired)
    });
    expect(heart().getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      failAdd({ error: '存不起來' });
    });
    // 🔴 失敗 ⇒ 畫面拉回【server 確認過的狀態】(沒收藏),不是套某一次的差量。
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByRole('alert').textContent).toContain('收藏沒有存成功');
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴 R2 must-fix 2:換帳號後【還沒送出】的那一發 ⇒ 不得寄到新帳號名下', async () => {
    let releaseAdd: (v: { ok: true }) => void = () => {};
    const seen: (string | undefined)[] = [];
    addFavoriteAction.mockImplementation((_h: string, owner?: string) => {
      seen.push(owner);
      return new Promise((r) => { releaseAdd = r; });
    });
    render(
      <FavoritesProvider>
        <Heart />
      </FavoritesProvider>,
    );
    await login('u-1');
    await act(async () => {
      heart().click();
    });
    await waitFor(() => expect(seen).toHaveLength(1));
    // 🔴 送出去時就帶著 owner ⇒ server 那端還有一道「對不上就拒絕」。
    expect(seen[0], 'action 沒帶 expectedUserId ⇒ server 那道否決不會生效').toBe('u-1');
    await act(async () => {
      heart().click(); // 製造第二發(還沒送)
    });
    await login('u-2'); // 換人
    await act(async () => {
      releaseAdd({ ok: true }); // 第一發現在才回來
    });
    // 第二發不得送出(owner 已經不是 u-1)
    expect(seen, '換帳號後那一發還是送出去了').toHaveLength(1);
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴 R2 must-fix 3:佇列跑完要收乾淨(不得每碰一個新商品就永久多留一條)', async () => {
    const { container } = render(
      <FavoritesProvider>
        <Heart handle="a" />
      </FavoritesProvider>,
    );
    await login();
    await act(async () => {
      container.querySelector('button')!.click();
    });
    await waitFor(() => expect(addFavoriteAction).toHaveBeenCalled());
    // 再按一次同一個 ⇒ 若上一輪沒收乾淨,worker 會以為還在跑而不啟動 ⇒ 這一發永遠不會送。
    addFavoriteAction.mockClear();
    removeFavoriteAction.mockClear();
    await act(async () => {
      container.querySelector('button')!.click();
    });
    await waitFor(() =>
      expect(
        removeFavoriteAction,
        '第二輪沒送出 ⇒ running/desired 沒被收掉,worker 卡住了',
      ).toHaveBeenCalledWith('a', 'u-1'),
    );
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
