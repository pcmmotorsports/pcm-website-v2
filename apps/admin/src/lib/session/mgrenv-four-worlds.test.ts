import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ⟦b4-MGRENV1⟧ 2026-09-01 · **特徵測試(characterization)**:把「那顆 env 與 `NODE_ENV`
// 的四個組合各自回什麼」釘下來。
//
// 🔴 **為什麼它現在就該存在, 而不是等修法拍板**:板上那一列說的病是
//    「有人把 `ADMIN_REQUIRE_REAL_IDENTITY` 拿掉的那一天, 這道閘會安靜地退化成裝飾,
//     而三綠全綠」(`docs/launch-todo.md:583`)。
//    ⇒ **而在本檔之前, 那四格【沒有任何一格被量過】** —— 現有測試一律 `vi.mock` 掉
//      `requireRealIdentity`(見 `actor-source-parity.test.ts:46`), 所以它們證的是
//      「拿到 true/false 之後怎麼分層」, **不是「那顆 env 會不會變成 true/false」**。
//    📌 **⇒ 那正是這一列能存在三天沒人撞到的原因:尺從來沒有接到被量的那個東西上。**
//
// ⚠️ **本檔【不主張】現況是對的** —— 它主張的是「現況是這樣」。
//    修法(甲=production fail-closed / 乙=首頁紅字)拍板後,
//    **只有下面那一格標 🔴 的期望值會翻**, 其餘三格必須一個字都不動。
//    ⇒ 那讓審查的人看得出「這次改動只動了它該動的那一格」。
//
// 🛑 **本檔不 mock `requireRealIdentity`, 也不 mock `IS_PROD`** —— 那兩個正是被測對象。
//    ⇒ 改 `NODE_ENV` 之後必須 `vi.resetModules()` 再動態 import, 因為
//      `IS_PROD`(`session.ts:113`)是**模組載入當下**算出來的常數。
//      直接改 `process.env.NODE_ENV` 而不重載模組 ⇒ **四格全部量到同一個世界, 而它會全綠。**

const { cookieStore, listStaffRows } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  listStaffRows: vi.fn(),
}));

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

// 🔴 **用 `vi.stubEnv` 不用 `process.env.X = …`** —— 後者 `typecheck` 紅(TS2540:
//    `NODE_ENV` 在型別上是 readonly), **而 vitest 那一發是綠的**。
//    📌 ⇒ 又一次「vitest 不做型別檢查」:五格全過而 typecheck 兩條紅。**綠的那個不是尺。**

/**
 * 在指定的世界裡載入一份**全新的** `actor.ts` 並問它一次。
 *
 * 🔴 沒有票(不設 session cookie)⇒ 一定會走到第 2 / 第 3 層, 也就是這一列講的那個岔路。
 *    而**選了一顆 actor cookie** ⇒ 第 3 層若真的被走到, `actor` 會是那個人(不是 null)
 *    ⇒ 「退化成可冒名」這件事在回傳值上**看得見**, 不只看 source。
 */
async function askInWorld(nodeEnv: string, flag: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', flag);

  const { getSessionActorWithSource, ACTOR_COOKIE } = await import('./actor');
  cookieStore.clear();
  cookieStore.set(ACTOR_COOKIE, 'sean');
  return getSessionActorWithSource();
}

describe('⟦b4-MGRENV1⟧ 那顆 env × NODE_ENV 的四個世界, 現在各回什麼', () => {
  beforeEach(() => {
    listStaffRows.mockReset().mockResolvedValue([
      { id: 'sean', label: 'Sean', is_active: true, is_manager: true },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('🔴 production + 旗標【未設】⇒ 今天會退化成「使用者自己挑的那個人」', async () => {
    const { actor, source } = await askInWorld('production', undefined);
    // 🔴 **這一格就是 ⟦b4-MGRENV1⟧ 本身。** 修法拍板後只有它會翻。
    expect(source).toBe('self-selected');
    // 而 actor 不是 null ⇒ 冒名【已經成立】, 不只是「少了一道檢查」。
    expect(actor?.id).toBe('sean');
  });

  it('production + 旗標 = 1 ⇒ 不回退(今天正式站就是這一格)', async () => {
    const { actor, source } = await askInWorld('production', '1');
    expect(source).toBe('stale-ticket');
    expect(actor).toBeNull();
  });

  it('🟢 正對照 · development + 旗標【未設】⇒ 仍回退(dev 那條路不得被動到)', async () => {
    const { actor, source } = await askInWorld('development', undefined);
    expect(source).toBe('self-selected');
    expect(actor?.id).toBe('sean');
  });

  it('development + 旗標 = 1 ⇒ 不回退', async () => {
    const { actor, source } = await askInWorld('development', '1');
    expect(source).toBe('stale-ticket');
    expect(actor).toBeNull();
  });

  it("🔵 負對照 · 旗標 = '0' / 'true' / 'yes' 一律【不算開】(形狀是 === '1')", async () => {
    for (const v of ['0', 'true', 'yes', '']) {
      const { source } = await askInWorld('production', v);
      expect(source, `旗標 = ${JSON.stringify(v)} 時`).toBe('self-selected');
    }
  });
});
