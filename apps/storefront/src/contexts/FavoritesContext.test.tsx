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
const listFavoriteHandlesAction = vi.fn(async () => ({ handles: ['already-fav'] }) as { handles: string[] } | { error: true });
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
    listFavoriteHandlesAction.mockImplementation(async () => ({ handles: ['already-fav'] }));
    render(
      <FavoritesProvider>
        <Heart handle="already-fav" />
      </FavoritesProvider>,
    );
    await login('u-1');
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));
    // B 的收藏是空的
    listFavoriteHandlesAction.mockImplementation(async () => ({ handles: [] }));
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
    // 🔴 印的是 **server 回的那一句**(`MAIN-036`,Sean 拍板要分兩句:下架 vs 其他)——
    //   統一成一句就等於把他的裁定丟掉。這裡用 mock 回的字面驗「有照著印」。
    expect(screen.getByRole('alert').textContent).toContain('存不起來');
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
    expect(text).toContain('請再試一次');
    expect(heart().getAttribute('aria-pressed'), '失敗了卻沒退回').toBe('false');
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴🔴 R3:舊帳號的 worker 收尾時,不得把【新帳號】的 desired 清掉(會無限連發 remove、刪掉新帳號真實收藏)', async () => {
    // GR(Fable,R3)讀碼推演出來的路徑。本格是「構造它」那一步。
    // ```
    // 換帳號時 confirmed/handles 換【新物件】，而 desired/running 用 .clear() 留【同一個物件】
    //   ⇒ 舊 worker 的 finally 清掉的是【新帳號正在用的那一份】
    //   ⇒ 新 worker 的 while 條件把 undefined 讀成「有落差」(undefined !== false)
    //   ⇒ next=undefined ⇒ 走 remove ⇒ 而 confirmed 永遠不會再變 ⇒ 【無限連發 remove】
    // ```
    // 🔴 **要撞上這一格，時序必須是「舊 worker 的 finally 落在新 worker 正 await 的那個空檔」** ——
    //    第一版我讓新 worker 先跑完才放舊的，**測試綠、而 bug 還在**（構造失敗看起來跟沒有 bug 一樣）。
    let releaseOldAdd: (v: { ok: true }) => void = () => {};
    addFavoriteAction.mockImplementation(
      () => new Promise((r) => { releaseOldAdd = r; }),
    );
    let releaseRemove: (v: { ok: true }) => void = () => {};
    // 🔴 `removeSettled` 存在的唯一理由:把本格的【時序前提】變成一道會紅的斷言(見下)。
    let removeSettled = false;
    removeFavoriteAction.mockImplementation(
      () => new Promise((r) => {
        releaseRemove = (v) => { removeSettled = true; r(v); };
      }),
    );

    render(
      <FavoritesProvider>
        <Heart handle="shared" />
      </FavoritesProvider>,
    );
    await login('u-1');
    await act(async () => {
      heart().click(); // u-1 的 add 送出去，卡在路上
    });
    await waitFor(() => expect(addFavoriteAction).toHaveBeenCalledTimes(1));

    // u-2 進來，而且 u-2 本來就收藏了 shared
    listFavoriteHandlesAction.mockImplementation(async () => ({ handles: ['shared'] }));
    await login('u-2');
    await waitFor(() => expect(heart().getAttribute('aria-pressed')).toBe('true'));

    // u-2 按一下想取消 ⇒ 新 worker 送出 remove，然後【停在 await 上】
    removeFavoriteAction.mockClear();
    await act(async () => {
      heart().click();
    });
    await waitFor(() => expect(removeFavoriteAction).toHaveBeenCalledTimes(1));

    // 🔴🔴 **本格的時序前提,現在是一道【會紅的斷言】,不再只是註解**(GR 確認輪的 nit)。
    //   這一格能抓到東西,靠的是「舊 worker 的收尾**落在新 worker 正 await 的那個空檔**」。
    //   ⇒ 若新 worker 的那一發【已經回來了】，這個空檔就不存在，
    //     整格會**靜默退化**成我第一版那種「測試綠、而 bug 還在」。
    //   ⇒ 所以先斷言那個空檔真的存在,再放舊的。
    expect(
      removeSettled,
      '新 worker 的 remove 已經回來了 ⇒ 本格要構造的那個空檔【不存在】' +
        ' ⇒ 這一格此刻沒有判別力,不要相信它的綠(先回去看 worker 收尾是不是引入了真計時器)',
    ).toBe(false);

    // 🔴 就是現在:舊 worker 收尾（finally 動到誰的 map?）
    // ⚠️ 仍然未斷言的那一半(誠實寫著):下面那個 20ms 之所以夠,是因為舊 worker 的收尾走
    //   microtask。**日後若那條路徑引入真的計時器(retry backoff / 動畫),20ms 可能不夠** ——
    //   上面那道斷言擋得住「空檔不存在」,擋不住「空檔在、而舊 worker 還沒跑完」。
    //   ⇒ 動 worker 收尾路徑的人:先確認這一格【對壞版本仍然會紅】,再相信它。
    await act(async () => {
      releaseOldAdd({ ok: true });
      await new Promise((r) => setTimeout(r, 20));
    });
    // 新 worker 的那一發這才回來 ⇒ 它接下來會重新判斷 while 條件
    await act(async () => {
      releaseRemove({ ok: true });
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(
      removeFavoriteAction.mock.calls.length,
      `remove 被連發 ${removeFavoriteAction.mock.calls.length} 次 ⇒ 舊 worker 的 finally 清掉了新帳號的 desired`,
    ).toBe(1);
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
    removeFavoriteAction.mockImplementation(async () => ({ ok: true }));
    listFavoriteHandlesAction.mockImplementation(async () => ({ handles: ['already-fav'] }));
  });

  it('🔴 MAIN-036(Sean 拍板):server 說「這件商品已下架」⇒ 畫面要照印,不得統一成通用文案', async () => {
    addFavoriteAction.mockImplementation(async () => ({ error: '這件商品已下架' }));
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
    expect(text).toContain('這件商品已下架');
    expect(text, '兩種失敗被統一成一句 ⇒ Sean 拍的「分兩句」被丟掉了').not.toContain('請再試一次');
    addFavoriteAction.mockImplementation(async () => ({ ok: true }));
  });

  it('🔴 GR §4:載入中按了【一顆】⇒ 不得把整份清單丟掉(其他商品的紅心全滅)', async () => {
    // 客人面症狀:網路慢、清單還在載入時他手快按了一顆
    //   ⇒ 他原本收藏的【其他】商品紅心全部消失，要重整才回來。
    //   資料沒掉，但他會以為收藏被弄丟了 ——「DB 有、畫面沒有」的窄觸發版。
    let release: (v: { handles: string[] }) => void = () => {};
    listFavoriteHandlesAction.mockImplementation(
      () => new Promise<{ handles: string[] }>((r) => { release = r; }),
    );
    const { container } = render(
      <FavoritesProvider>
        <Heart handle="他按的那顆" />
        <Heart handle="他本來就收藏的" />
      </FavoritesProvider>,
    );
    const [pressed, existing] = [...container.querySelectorAll('button')];
    await login();
    // 清單還在路上，他先按了第一顆
    await act(async () => {
      pressed!.click();
    });
    // 現在清單回來了，裡面有【另一顆】他本來就收藏的
    await act(async () => {
      release({ handles: ['他本來就收藏的'] });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(pressed!.getAttribute('aria-pressed'), '他剛按的那顆不該被清單蓋掉').toBe('true');
    expect(
      existing!.getAttribute('aria-pressed'),
      '他本來就收藏的那顆滅了 ⇒ 整份清單被丟掉了(按一顆害到全部)',
    ).toBe('true');
    listFavoriteHandlesAction.mockImplementation(async () => ({ handles: ['already-fav'] }));
  });

  it('沒有 Provider 也不炸(愛心只是沒作用)', () => {
    render(<Heart />);
    expect(heart().getAttribute('aria-pressed')).toBe('false');
    expect(() => heart().click()).not.toThrow();
  });
});
