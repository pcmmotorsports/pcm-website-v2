import { describe, it, expect, vi, beforeEach } from 'vitest';

// ⟦b4-MGR0-UI⟧ 2026-08-31 · **防漂**:`getSessionActorWithSource` 與
// `getSessionActorIdWithSource` 各自帶【一份】三層邏輯。
//
// 🔴 **為什麼是兩份而不是一份**:前者跑在**授權路徑**上(`session/authorize.ts:67`、
//    `lib/audit/context.ts:27`),而它有一整套驗收測試釘著。
//    ⇒ 為了加後者去重構前者 = 動 auth 路徑 = 鐵則 12② ⇒ **這一片不動它**。
//
// 🛑 **而兩份會漂** —— 有人日後在其中一支加第四層 / 改 `requireRealIdentity()` 的位置,
//    另一支不會有任何東西叫。**本檔就是那個會叫的東西。**
//    ⇒ 它只釘 `source`(分層的結論), 不釘 `actor` / `id`(那是各自的職能)。
//
// ⚠️ **本檔的天花板**(兩格,第二格是寫這支時當場撞到的):
//   ① 它證的是【同樣的輸入 ⇒ 同樣的 source】, **證不到**兩支各自的回傳值對不對
//      —— 那由 `actor.test.ts` 與 `b5a-identity-acceptance.test.ts` 負責。
//   ② 🔴 **本檔的 cookie 名字對結果沒有影響** —— `verifySession` 是 mock 的,
//      它不看傳進去的值。我第一版把 `ADMIN_SESS_COOKIE` 從 `'./actor'` import
//      (它其實住在 `'./session'`)⇒ 值是 `undefined` ⇒ **本檔照樣全綠**,
//      只有 `typecheck` 紅(TS2459)。
//      📌 ⇒ **這支測試不驗「cookie 讀得對不對」, 而那件事看起來像它在驗。**
//         擋住那個錯的是 typecheck, 不是這裡的任何一格。

const { cookieStore, listStaffRows, verifySession, requireRealIdentity } = vi.hoisted(
  () => ({
    cookieStore: new Map<string, string>(),
    listStaffRows: vi.fn(),
    verifySession: vi.fn(),
    requireRealIdentity: vi.fn(),
  }),
);

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieStore.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));
vi.mock('../staff-repository', () => ({ listStaffRows }));
vi.mock('./session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session')>()),
  verifySession,
  requireRealIdentity,
}));

// 🔴 **codex R4 must-fix**:第一版的 `verifySession` mock **完全不看傳進來的值**
//    ⇒ 有人把 `ADMIN_SESS_COOKIE` 換成 `ACTOR_COOKIE`, 它仍拿到同一張票 ⇒ 測試照樣綠。
//    (我先前宣稱「突變驗過」的那一發演的是 **id 的來源**, 不是 **session cookie 讀哪顆**
//     —— 那是兩種漂法, 而我把它們寫成同一句。codex 指出這一點是對的。)
// ⇒ 改成:mock 只認【那顆 session cookie 的值】, 拿到別的一律回 null。
const SESSION_TOKEN = 'valid-session-token';

import {
  getSessionActorWithSource,
  getSessionActorIdWithSource,
  ACTOR_COOKIE,
} from './actor';
// `ADMIN_SESS_COOKIE` 住在 `./session`(actor.ts 只是 import 它, 沒有再匯出)。
import { ADMIN_SESS_COOKIE } from './session';

describe('⟦b4-MGR0-UI⟧ 兩支分層函式的 source 必須一致(防漂)', () => {
  let ticket: unknown = null;

  beforeEach(() => {
    cookieStore.clear();
    listStaffRows.mockReset().mockResolvedValue([
      { id: 'sean', label: 'Sean', is_active: true, is_manager: true },
    ]);
    verifySession
      .mockReset()
      // 只有拿到那顆 session cookie 的值才回票 —— 讀錯 cookie ⇒ 回 null ⇒ 掉到別的層 ⇒ source 變 ⇒ 紅。
      .mockImplementation((token?: string) =>
        Promise.resolve(token === SESSION_TOKEN ? ticket : null),
      );
    ticket = null;
    requireRealIdentity.mockReset().mockReturnValue(false);
  });

  const worlds: ReadonlyArray<[string, () => void, string]> = [
    [
      '第 1 層 · 票帶身分',
      () => {
        cookieStore.set(ADMIN_SESS_COOKIE, SESSION_TOKEN);
        ticket = { v: 2, sub: { kind: 'user', staff_id: 'sean' } };
      },
      'ticket',
    ],
    [
      '第 1 層 · 共用密碼備援',
      () => {
        cookieStore.set(ADMIN_SESS_COOKIE, SESSION_TOKEN);
        ticket = { v: 2, sub: { kind: 'fallback' } };
      },
      'none',
    ],
    [
      '第 1 層 · 首次建置',
      () => {
        cookieStore.set(ADMIN_SESS_COOKIE, SESSION_TOKEN);
        ticket = { v: 2, sub: { kind: 'bootstrap' } };
      },
      'none',
    ],
    [
      '第 2 層 · 旗標開而票上沒身分',
      () => {
        requireRealIdentity.mockReturnValue(true);
      },
      'stale-ticket',
    ],
    [
      '第 3 層 · 旗標關 · 有自選 cookie',
      () => {
        cookieStore.set(ACTOR_COOKIE, 'sean');
      },
      'self-selected',
    ],
    [
      '第 3 層 · 旗標關 · 沒選',
      () => {},
      'self-selected',
    ],
  ];

  it.each(worlds)('%s ⇒ 兩支都回 %s', async (_label, setup, expected) => {
    setup();
    const viaActor = await getSessionActorWithSource();
    const viaId = await getSessionActorIdWithSource();
    expect(viaActor.source, '舊那支的 source 變了').toBe(expected);
    expect(viaId.source, '🔴 兩支的分層漂開了 —— 有人只改了一邊').toBe(viaActor.source);

    // 🔴 **codex R3 must-fix:只比 source 不夠。**
    //    只比 source 的話,「新出口的 id 永遠回 null」或「第 1 層讀錯成 ACTOR_COOKIE」
    //    這兩種漂法**照樣全綠**, 而它們會讓真管理者被永久判成 `no`。
    // ⇒ 舊那支解得出人的時候(actor 非 null), 新那支的 id 必須就是那個人。
    // 🛑 反過來【不成立】且那是刻意的:停用 / 查無 / DB 失敗時舊那支回 null,
    //    而新那支仍回原始 id —— **那正是這一片要的差異**, 所以只單向釘。
    if (viaActor.actor) {
      expect(
        viaId.id,
        '🔴 舊出口解得出這個人, 而新出口的 id 對不上 ⇒ 兩支讀的不是同一個來源',
      ).toBe(viaActor.actor.id);
    }

    // 🔴 **codex R4 must-fix:單向釘不夠。**
    //    `none`(共用密碼 / 首次建置)與 `stale-ticket`(舊票)這兩層
    //    **結構上就沒有具名 id** ⇒ 新出口在那裡回任何非 null 都是 bug,
    //    而第一版只在 `actor` 非 null 時比 ⇒ 那幾層【怎麼錯都綠】。
    //    失敗情境:新出口在 fallback 世界錯回 'sean' ⇒ 頁面判成可編輯。
    // 🛑 而 `ticket`(停用者)與 `self-selected`(查無)【不釘】——
    //    那兩層舊出口回 null 而新出口仍回原始 id, **那是本片刻意的差異**。
    if (viaId.source === 'none' || viaId.source === 'stale-ticket') {
      expect(
        viaId.id,
        `🔴 ${viaId.source} 這一層結構上沒有具名 id, 而新出口回了東西`,
      ).toBeNull();
    }
  });

  it('🔴 這把尺要分得出兩種世界 —— 而它【自己重跑一次】, 不靠別的測試留下的東西', async () => {
    // ⚠️ codex R3 nit:第一版拿硬編的 expected 算 distinct ⇒ 算的是「我寫了幾種期望」。
    // ⚠️ codex R4 nit:第二版改讀實際輸出, 而它【靠上面那組累積】
    //    ⇒ 單獨跑這一格 / 未來開 shuffle ⇒ 空陣列 ⇒ 假紅。
    // ⇒ 第三版:自己把六個世界重跑一遍, 完全自足。
    const seen: string[] = [];
    for (const [, setup] of worlds) {
      cookieStore.clear();
      ticket = null;
      requireRealIdentity.mockReturnValue(false);
      setup();
      seen.push((await getSessionActorIdWithSource()).source);
    }
    expect(seen.length).toBe(worlds.length);
    expect(
      new Set(seen).size,
      '六個世界只產出一種 source ⇒ 上面那組的 toBe 是恆真的',
    ).toBeGreaterThan(1);
  });
});
