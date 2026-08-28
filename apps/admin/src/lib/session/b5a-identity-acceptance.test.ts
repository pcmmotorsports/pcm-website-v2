// b5a-identity-acceptance.test.ts — `B5-a`「後台去讀票上的身分」的**驗收 16 格**。
//
// ════════════════════════════════════════════════════════════════════════════
// 🔴 這一片改掉了什麼(一句話)
// ════════════════════════════════════════════════════════════════════════════
// 改動前:「操作者是誰」的唯一來源是**使用者自己從下拉挑的那顆 cookie**。
// 改動後:票(session)上帶得動身分了,而 `getSessionActor` 在票是 `v:2` 時**只認票**。
//
// 🔴🔴 **而整片是暗著出的 —— 而【暗的原因是上游還沒送 `sub`】,不是旗標。**
//    ⚠️ **2026-08-24 更正(codex B1-2)**:~~原句把兩個原因並列成好像旗標也擋得住~~。
//    真值表(`[16c]` 釘住它):**旗標關 + v:2 票 ⇒ 照樣用簽章過的 `sub`。**
//    ⇒ 旗標只管「拿不到 v:2 時怎麼辦」,**不管「拿到 v:2 時要不要用它」**
//    ⇒ 🔴 **它不是 kill switch**:上游一開始送 sub,關著旗標也擋不住這條路。
//    ⇒ 本檔的 `[17]` 是那個回歸格的**一半**。
//    🔴 **2026-08-24 收窄(codex B1-8)**:~~原句「它紅 = 這一片弄壞了現況」~~ **太寬** ——
//       `[17]` 沒有執行登入、沒有呼叫 callback,它只涵蓋**讀取端**(actor cookie 那條路)。
//       **寫入端**(callback 會不會誤簽 v:2)由 `app/api/sso/callback/route.test.ts` 顧。
//       ⇒ 兩支都綠才等於「現況沒被弄壞」;只看本檔會漏掉一半。
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ 本檔【量不到】什麼(照實寫,不要把它讀成比它大)
// ════════════════════════════════════════════════════════════════════════════
//  · **不驗「那個人在不在職」** —— `resolveStaff` 在本檔是 mock。真名單在 A 庫,
//    而我沒有正式庫 access ⇒ 那一格只能在測試層構造。
//  · **不驗 login event 那一本帳** —— `admin_sso_login_events` **這張表沒有身分欄**
//    (`20260818190000_m4b_admin_sso_login_events.sql:72-90` 逐欄讀過)⇒ 接它要一支 migration
//    = 鐵則 12③,不在本片。⚠️ **2026-08-24 更新:那一半【已經接了】**(另一片)——
//    migration `20260824030000` + `login-event.ts` 接線,驗收在 `lib/sso/login-event.test.ts`。
//    (原本守它的 `login-event-identity-drop-fuse` 已 **2026-08-24 依它自己的退場條款刪除**(原文 `git show 952c0c42:apps/admin/src/lib/sso/login-event-identity-drop-fuse.test.ts`,189 行)。)
//    🔴 **而那支 migration 仍未 apply** ⇒ 那兩欄在正式庫還不存在。
//  · **不驗 proxy / 讀取閘** —— `#17`(讀取閘要不要真的查 A 庫)仍未解,而它只擋件 4。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { cookieStore, listStaffRows, actorCookieReads } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  listStaffRows: vi.fn(),
  actorCookieReads: { n: 0, explode: false },
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        // 🔴 **格 [16] 的量具就在這裡** —— 見下面那一格為什麼不能用回傳值驗。
        if (name === 'pcm_admin_actor') {
          actorCookieReads.n += 1;
          if (actorCookieReads.explode) {
            throw new Error('ACTOR_COOKIE 被讀了 —— 第 2 層不得回退去讀它');
          }
        }
        const value = cookieStore.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

vi.mock('../staff-repository', () => ({ listStaffRows }));

import { getSessionActor, getSessionActorWithSource, ACTOR_COOKIE } from './actor';
import {
  ADMIN_SESS_COOKIE,
  buildAdminSession,
  signSession,
  verifySessionDetailed,
  type AdminSessionSub,
} from './session';

const SECRET = 'x'.repeat(32);
const AUTH_TIME = 1_700_000_000;

/** 簽一張真的票並放進 cookie(不是手捏字串 —— 手捏的東西驗簽就死,那會讓格子紅錯理由)。 */
async function issueTicket(sub?: AdminSessionSub, maxAgeSec?: number) {
  const token = await signSession(buildAdminSession(['pwd'], AUTH_TIME, sub, { maxAgeSec }));
  expect(token, '簽不出票 ⇒ 下面每一格都會紅錯理由(是 secret 沒設,不是驗證失敗)').not.toBeNull();
  cookieStore.set(ADMIN_SESS_COOKIE, token as string);
  return token as string;
}

beforeEach(() => {
  cookieStore.clear();
  actorCookieReads.n = 0;
  actorCookieReads.explode = false;
  vi.stubEnv('ADMIN_SESSION_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', '');
  listStaffRows.mockReset().mockResolvedValue([
    { id: 'sean', label: 'Sean(老闆)', is_active: true },
    { id: 'staff_2', label: '小明', is_active: true },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

// ════════════════════════════════════════════════════════════════════════════
// §A 票的形狀與版本政策(格 1-8)
// ════════════════════════════════════════════════════════════════════════════
describe('B5-a §A · 票的形狀與版本政策', () => {
  it('[1] v:1 票 + 旗標關 ⇒ 收(🔴 回歸格:它紅 = 本片弄壞了現況)', async () => {
    const token = await issueTicket();
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(true);
    expect(r.ok && r.payload.v).toBe(1);
  });

  it('[2] v:1 票 + 旗標開 ⇒ 拒,而 reason 是 `version_rejected`(不是 `shape`)', async () => {
    const token = await issueTicket();
    vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', '1');
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(false);
    // 🔴 為什麼釘住 reason:壓進 `shape` 之後,開旗標當天的「全員被登出」
    //    看起來會像「大家的 cookie 都壞了」,而那兩件的處置完全相反。
    expect(r.ok === false && r.reason).toBe('version_rejected');
  });

  it('[3] v:2 + sub.kind=user + 合法 staff_id ⇒ 收,而 sub 逐字帶回來', async () => {
    const token = await issueTicket({ kind: 'user', staff_id: 'sean' });
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(true);
    expect(r.ok && r.payload.v === 2 && r.payload.sub).toEqual({ kind: 'user', staff_id: 'sean' });
  });

  it('[4] v:2 而缺 sub ⇒ runtime 拒(型別層它構造不出來,所以這裡要手捏)', async () => {
    // ⚠️ 這一格**必須繞過 `buildAdminSession`** —— 那支的型別讓「v:2 而沒有 sub」不存在。
    //    要驗 runtime 的那道閘,只能自己簽一顆型別上不合法的 payload。
    const bad = { v: 2, sid: 'a'.repeat(32), iat: AUTH_TIME, exp: AUTH_TIME + 9_999_999_999, amr: ['pwd'], auth_time: AUTH_TIME };
    const token = await signSession(bad as never);
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('shape');
  });

  it('[5] v:2 + sub.kind=fallback ⇒ 收', async () => {
    const r = await verifySessionDetailed(await issueTicket({ kind: 'fallback' }));
    expect(r.ok).toBe(true);
  });

  it('[6] 🔴 v:2 + sub.kind=bootstrap ⇒ 收(缺它 ⇒ 首次建置的人登不進來)', async () => {
    const r = await verifySessionDetailed(await issueTicket({ kind: 'bootstrap' }));
    expect(r.ok).toBe(true);
  });

  it('[7] v:3 / v 缺 ⇒ 拒', async () => {
    for (const v of [3, 0, '2', undefined]) {
      const bad = { v, sid: 'a'.repeat(32), iat: AUTH_TIME, exp: AUTH_TIME + 9_999_999_999, amr: ['pwd'], auth_time: AUTH_TIME };
      const r = await verifySessionDetailed(await signSession(bad as never));
      expect(r.ok, `v=${String(v)} 竟然被收了`).toBe(false);
    }
  });

  it('[8] sub.kind=user 而 staff_id 是空字串 ⇒ 拒(空字串與「沒有身分」在下游長得一樣)', async () => {
    const token = await signSession(buildAdminSession(['pwd'], AUTH_TIME, { kind: 'user', staff_id: '' }));
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('shape');
  });

  // 🔴🔴 [8b] 2026-08-24 codex B1-1 打出來的:**[8] 只測了 `''`,沒測 `'   '`**。
  //    `'   '.length === 3 > 0` ⇒ 舊寫法簽得出一張「具名員工、而名字是空白」的可信 v:2 票。
  //    📌 母題:**一個壞世界被擋,不代表同一族的其他壞世界也被擋** ——
  //       而沒被擋的那個,就住在上面那一格的正隔壁。
  //    ⚠️ 這一格與 migration `20260824030000_…_actor.sql` 的 `②-b6` 是**同一件事的兩層**;
  //       改任一層要同時看另一層(該層用 `btrim(x) <> ''`)。
  // 🔴 2026-08-24 codex R2-2 之後擴表:加了 **JS `trim()` 抓不到的那兩個**(U+200B / U+FEFF)。
  //    📏 實測:`'\u200B'.trim() === ''` ⇒ **false** ⇒ 舊寫法對它是**放行**的。
  it.each([
    ['三個半形空白', '   '],
    ['tab', '\t'],
    ['換行', '\n'],
    ['全形空白', '\u3000'],
    ['NBSP', '\u00A0'],
    ['em space', '\u2003'],
    ['🔴 零寬空白 U+200B(trim 抓不到)', '\u200B'],
    ['🔴 BOM U+FEFF', '\uFEFF'],
    ['零寬 + 全形混合', '\u200B\u3000'],
  ])('[8b] sub.kind=user 而 staff_id 看不見(%s)⇒ 拒', async (_label, blank) => {
    const token = await signSession(
      buildAdminSession(['pwd'], AUTH_TIME, { kind: 'user', staff_id: blank }),
    );
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('shape');
  });

  // ✅ 正對照:少了它,一個「恆拒 user」的 isSub 也會讓上面兩格全綠。
  it('[8c] 正對照:staff_id 前後有空白但中間有字 ⇒ **收**(它是格式問題,不是空身分)', async () => {
    const token = await signSession(
      buildAdminSession(['pwd'], AUTH_TIME, { kind: 'user', staff_id: ' sean ' }),
    );
    const r = await verifySessionDetailed(token);
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §B 身分【進票】的那一段(格 9-12)
//
// 🔴🔴 **2026-08-24 更正(codex B1-7)—— 這一節【不呼叫 callback】。**
//    ~~原標題「callback 把上游的身分接進票裡」~~ 是假的:下面每一格都直接餵
//    `buildAdminSession` / trace,**沒有任何一格走過 `app/api/sso/callback/route.ts`**。
//    📏 量到的(本窗實跑,同日):把 `route.ts:81` 的 `result.sub` 改成 `undefined`
//    ⇒ **本檔 24 格全綠**,一格都不紅。
//
// ✅ **而接線【有】被守住 —— 在另一支檔**(同一發突變,量到的):
//    `apps/admin/src/app/api/sso/callback/route.test.ts` ⇒ **3 格紅**:
//      · 「exchange 回了 sub ⇒ 票是 v:2 且 sub 逐字帶進去」
//      · 「上游送 fallback ⇒ 逐字是 fallback」
//      · 「世界③:接好了 ⇒ 不得留那一行痕」
//    ⇒ 🔴 **要改 `route.ts` 那一行接線的人,去看那支檔** —— 本檔看不到你改壞了。
//
// 📌 母題:**兩層各自驗「我收到什麼就做什麼」,合起來仍然可以整條斷掉。**
//    本檔驗的是「builder 收到 sub 會放進票」,route.test 驗的是「callback 真的把 sub 交出去」。
//    **少了後者,前者全綠也證不出登入時身分會進票。**
describe('B5-a §B · buildAdminSession 收到 sub 之後把它放進票裡(不經過 callback)', () => {
  it('[9] 上游送了 sub ⇒ 簽出 v:2,而 sub 逐字相同', async () => {
    const sub: AdminSessionSub = { kind: 'user', staff_id: 'staff_2' };
    const p = buildAdminSession(['pwd'], AUTH_TIME, sub);
    expect(p.v).toBe(2);
    expect(p.v === 2 && p.sub).toEqual(sub);
  });

  it('[10] 上游沒送 sub(今天的每一次登入)⇒ 簽出 v:1,且物件上【沒有】sub 這個鍵', async () => {
    const p = buildAdminSession(['pwd'], AUTH_TIME);
    expect(p.v).toBe(1);
    // 🔴 用 `in` 不用 `?.` —— `sub: undefined` 與「沒有 sub」在 `?.` 底下是同一個答案,
    //    而它們在 JSON 序列化之後也一樣;但在型別與後續 spread 上不一樣。
    expect('sub' in p).toBe(false);
  });

  it('[11] 🔴 世界③:sub 進了 session ⇒ identity-drop-trace 安靜(它「會自己退場」的唯一支撐)', async () => {
    const { identityDropTrace } = await import('../sso/identity-drop-trace');
    const sub: AdminSessionSub = { kind: 'user', staff_id: 'sean' };
    const session = buildAdminSession(['pwd'], AUTH_TIME, sub);
    expect(identityDropTrace(sub, [{ name: 'session cookie', payload: session, identityKey: 'sub' }])).toBeNull();
  });

  it('[12] 🔴 對照組:上游送了而【沒有】放進 session ⇒ trace 必須留痕(否則格 [11] 沒有判別力)', async () => {
    const { identityDropTrace } = await import('../sso/identity-drop-trace');
    const sub: AdminSessionSub = { kind: 'user', staff_id: 'sean' };
    const sessionWithout = buildAdminSession(['pwd'], AUTH_TIME); // 故意不帶
    const trace = identityDropTrace(sub, [{ name: 'session cookie', payload: sessionWithout, identityKey: 'sub' }]);
    expect(trace, '上游送了身分而 session 沒帶,trace 卻安靜 ⇒ 那道守門是死的').not.toBeNull();
    // 🔴 PII:痕裡不得出現 staff_id(callback 那裡逐字釘過同一件事)
    expect(trace).not.toContain('sean');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §C actor.ts 三層(格 14-17)
// ════════════════════════════════════════════════════════════════════════════
describe('B5-a §C · getSessionActor 的三層', () => {
  it('[14] 🔴 票說是 sean,而瀏覽器帶著【別人的】 pcm_admin_actor ⇒ 回 sean', async () => {
    await issueTicket({ kind: 'user', staff_id: 'sean' });
    cookieStore.set(ACTOR_COOKIE, 'staff_2'); // 使用者自己挑的那顆,現在不算數了
    expect(await getSessionActor()).toEqual({ id: 'sean', label: 'Sean(老闆)' });
  });

  it('[15] v:2 + fallback ⇒ null(而 null 的意思是「沒有具名身分」,不是「未登入」)', async () => {
    await issueTicket({ kind: 'fallback' });
    cookieStore.set(ACTOR_COOKIE, 'sean');
    expect(await getSessionActor()).toBeNull();
  });

  it('[15b] v:2 + bootstrap ⇒ null(而它【不得】靜默走到 user 那一支)', async () => {
    await issueTicket({ kind: 'bootstrap' });
    cookieStore.set(ACTOR_COOKIE, 'sean');
    expect(await getSessionActor()).toBeNull();
  });

  // 🔴🔴 [16c] 2026-08-24 codex B1-2 打出來的那一格 —— **旗標關,新身分路徑照樣生效**。
  //    這一格存在的理由是**擋住一句話**,不是擋住一個 bug:
  //    「這一片由旗標控制、關著就等於沒上線」**是假的**,而那句話會被拿去做 rollback 決策。
  //    ⇒ 它紅 = 有人把旗標改成了真的總開關(那也許是好事,但**不得靜悄悄發生**)。
  it('[16c] 🔴 旗標【關】+ v:2 票 ⇒ 仍然用簽章過的 sub(旗標不是 kill switch)', async () => {
    vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', ''); // 關
    await issueTicket({ kind: 'user', staff_id: 'staff_2' });
    cookieStore.set(ACTOR_COOKIE, 'sean'); // 自選 cookie 指向【別人】
    // 🔴 判別點:回傳的是票上那個人(staff_2),不是 cookie 那個人(sean)
    expect(await getSessionActor()).toEqual({ id: 'staff_2', label: '小明' });
  });

  it('[16] 🔴 無 v:2 + 旗標開 ⇒ null,而且【一次都沒讀】 ACTOR_COOKIE', async () => {
    // 🔴🔴 **這一格為什麼不能用回傳值驗**(規格自己標的假驗法):
    //    「沒讀 cookie」與「讀了 cookie 但那個人不在名單」——**回傳值都是 null**。
    //    ⇒ 量具必須是【被讀到就會爆】的 cookie store。
    await issueTicket(); // v:1
    cookieStore.set(ACTOR_COOKIE, 'sean');
    vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', '1');
    actorCookieReads.explode = true;

    await expect(getSessionActor()).resolves.toBeNull();
    expect(actorCookieReads.n, '第 2 層回退去讀了 ACTOR_COOKIE').toBe(0);
  });

  it('[16b] ✅ 正對照:同一把量具在第 3 層【真的會爆】—— 否則格 [16] 是恆綠的', async () => {
    await issueTicket(); // v:1
    cookieStore.set(ACTOR_COOKIE, 'sean');
    vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', ''); // 旗標關 ⇒ 應該走第 3 層去讀它
    actorCookieReads.explode = true;

    await expect(getSessionActor()).rejects.toThrow(/ACTOR_COOKIE 被讀了/);
  });

  // ⚠️ **2026-08-24 收窄(codex B1-8)**:本格**沒有執行登入,也沒有呼叫 callback** ——
  //    它只驗「沒有票的時候,`getSessionActor()` 仍然讀 actor cookie」。
  //    ⇒ 🔴 **不得讀成「今天每一次登入的行為都沒變」** —— callback 就算誤簽 v:2,本格照樣綠。
  //    那個世界由 `app/api/sso/callback/route.test.ts` 顧(見 §B 檔頭那段的量測)。
  it('[17] 回歸格(**只涵蓋讀取端**):無 v:2 + 旗標關 ⇒ actor cookie 那條路逐字未變', async () => {
    cookieStore.set(ACTOR_COOKIE, 'staff_2');
    expect(await getSessionActor()).toEqual({ id: 'staff_2', label: '小明' });
  });

  it('[17b] 回歸格續:完全沒有票、沒有 actor cookie ⇒ null(今天的訪客)', async () => {
    expect(await getSessionActor()).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §C-2 `source` —— 四個世界各自回哪一個值(`:247` 後台首頁文案的地基,2026-08-29 線F)
//
// 🔴 **為什麼這一節不能省**:首頁那三句話全部掛在 `source` 上,而 §C 既有的每一格
//    驗的都是 **actor 是誰**。`source` 標錯時 **actor 仍然完全正確** ⇒ §C 全綠。
//    ⇒ 「回對了人」與「說對了那個人打哪來」是**兩個宣稱**,而 §C 只量得到第一個。
//
// ⚠️ **本節的天花板**:它驗的是 `getSessionActorWithSource` 這一層。
//    文案有沒有接對 `source`,由 `app/page.test.tsx` 那五格顧;**兩層都要綠才算數。**
// ════════════════════════════════════════════════════════════════════════════
describe('B5-a §C-2 · source 標對了沒(文案的地基)', () => {
  it('[18] v:2 + user ⇒ ticket(而 actor 同時要是票上那個人)', async () => {
    await issueTicket({ kind: 'user', staff_id: 'sean' });
    cookieStore.set(ACTOR_COOKIE, 'staff_2');
    expect(await getSessionActorWithSource()).toEqual({
      actor: { id: 'sean', label: 'Sean(老闆)' },
      source: 'ticket',
    });
  });

  // 🔴🔴 **這一格就是【我原本准的那個改法會印錯】的那個世界。**
  //    旗標關著,而身分【是驗證過的】⇒ source 必須是 ticket、不得是 self-selected。
  //    它紅 = 有人把 source 改成照旗標算 ⇒ 首頁會對這個人說「這個身分是你自己選的」,而那是假的。
  it('[19] 🔴 旗標【關】+ v:2 票 ⇒ 仍是 ticket(source 不是旗標的函數)', async () => {
    vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', '');
    await issueTicket({ kind: 'user', staff_id: 'staff_2' });
    const r = await getSessionActorWithSource();
    expect(r.source).toBe('ticket');
    expect(r.actor).toEqual({ id: 'staff_2', label: '小明' });
  });

  it('[20] v:2 + fallback ⇒ none(共用密碼 = 有身分而無具名操作者,不是「未登入」)', async () => {
    await issueTicket({ kind: 'fallback' });
    cookieStore.set(ACTOR_COOKIE, 'sean');
    expect(await getSessionActorWithSource()).toEqual({ actor: null, source: 'none' });
  });

  it('[20b] v:2 + bootstrap ⇒ none', async () => {
    await issueTicket({ kind: 'bootstrap' });
    expect((await getSessionActorWithSource()).source).toBe('none');
  });

  // 🔴 **`stale-ticket` 不是 `none`**(codex 關卡2 R3「災難當天」):這個人**重登就會拿到新票**,
  //    而 `none`(共用密碼 / 首次建置)重登沒有用 ⇒ 首頁要對兩邊講不同的復原步驟。
  //    翻面條件:有人把第 2 層改回 `none` ⇒ 紅,而**畫面上只會少一句正確的指示,不會壞掉** ——
  //    那正是為什麼它需要一格測試而不是一句註解。
  it('[21] 無 v:2 + 旗標【開】⇒ stale-ticket(不是 none:這個人重登會拿到新票)', async () => {
    await issueTicket(); // v:1
    cookieStore.set(ACTOR_COOKIE, 'sean');
    vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', '1');
    expect(await getSessionActorWithSource()).toEqual({ actor: null, source: 'stale-ticket' });
  });

  // 🔴🔴 **codex 關卡2 R3 角度B 抓到的兩個漏網葉世界** —— 它們原本只在 `page.test.tsx` 裡
  //    **被 mock 出來**,而 mock 出來的世界不證明**真的接線**會產生它。
  //    📌 判別句:**「首頁在那個世界印對了話」與「那個世界真的到得了」是兩個宣稱。**
  it('[24] 🔴 v:2 + user 而那個人不在啟用名單(停用/查無)⇒ { actor:null, source:ticket }', async () => {
    listStaffRows.mockResolvedValue([{ id: 'sean', label: 'Sean(老闆)', is_active: true }]);
    await issueTicket({ kind: 'user', staff_id: 'staff_2' }); // staff_2 不在名單裡
    // 這個組合就是首頁 `ticket-unresolved` 那句話的來源 —— 它到得了,不是理論上的。
    expect(await getSessionActorWithSource()).toEqual({ actor: null, source: 'ticket' });
  });

  it('[25] 🔴 第 3 層【真的選到人】⇒ { actor:那個人, source:self-selected }', async () => {
    cookieStore.set(ACTOR_COOKIE, 'staff_2');
    // 對照 [22](沒有 cookie ⇒ actor null):兩格合起來才分得開
    //「還沒選」與「選了而選到人」—— 而首頁對這兩者印**不同**的話。
    expect(await getSessionActorWithSource()).toEqual({
      actor: { id: 'staff_2', label: '小明' },
      source: 'self-selected',
    });
  });

  // 🔴 **`none` 與 `self-selected` 的分界,是首頁那兩句話唯一的判準** ——
  //    兩者的 `actor` 都可以是 `null`,而它們該說的話**完全不同**:
  //    這一格是「還沒選,那顆選單是活的」;上一格是「選了不會生效」。
  //    ⇒ 少了這一格,把 `none` 全寫成 `self-selected` 也照樣綠。
  it('[22] 🔴 無票 + 旗標關 + 沒有 actor cookie ⇒ self-selected 而 actor=null(是「還沒選」,不是「選了沒用」)', async () => {
    expect(await getSessionActorWithSource()).toEqual({ actor: null, source: 'self-selected' });
  });

  // 🔴🔴 **codex 關卡2 must-fix:原本這一格只比【兩次獨立呼叫的回傳值】** ——
  //    而薄殼若多讀一次 cookie、多驗一次票、或把某條路走兩遍,**回傳值一模一樣 ⇒ 它照樣綠**。
  //    ⇒ 補一個**副作用**判準:同一個世界裡,薄殼讀 `ACTOR_COOKIE` 的次數必須與底層【相同】。
  //    ⚠️ **天花板照實寫(codex R2 nit 指出我原本說得太寬)**:它守的**只有 `ACTOR_COOKIE` 的讀取次數**。
  //    **守不到**:① microtask 層的時序差(薄殼比舊版晚一個 `await` settle,裁決見 commit body)
  //    ② 多驗一次票 / 多呼叫底層一次 —— **那些路徑上 `ACTOR_COOKIE` 兩邊都是 0,這把尺不會動。**
  //    📌 **一把只數一種副作用的尺,對別種副作用回的 0 是「不在射程裡」,不是「沒發生」。**
  it('[23] 回歸格:薄殼與底層回傳相同,而且【副作用次數也相同】', async () => {
    await issueTicket({ kind: 'user', staff_id: 'sean' });
    const viaShell = await getSessionActor();
    const shellReads = actorCookieReads.n;

    actorCookieReads.n = 0;
    const viaCore = await getSessionActorWithSource();
    const coreReads = actorCookieReads.n;

    expect(viaShell).toEqual(viaCore.actor);
    expect(shellReads, '薄殼比底層多走了一趟 cookie').toBe(coreReads);
  });

  // ✅ **正對照:上面那把「次數」尺真的會動** —— 否則 `0 === 0` 讓它恆綠。
  //    ⚠️ **它證明的只有「計數器在會讀 cookie 的那條路上會動」**(codex R2 nit:別讀得更大)——
  //    **不證明** [23] 那個世界(v:2 票)裡它也會動;那個世界兩邊本來就是 0,
  //    ⇒ [23] 在那裡守的是「**沒有多出來的讀取**」,而那是一個比較弱、但仍然為真的宣稱。
  it('[23b] ✅ 正對照:次數這把尺在會讀 cookie 的世界裡不是 0', async () => {
    cookieStore.set(ACTOR_COOKIE, 'staff_2');
    actorCookieReads.n = 0;
    await getSessionActor();
    expect(actorCookieReads.n).toBeGreaterThan(0);
  });
});
