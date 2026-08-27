// 🔴🔴 這支檔【不得】加 vi.mock('../staff')。
//    加了 ⇒ authorizeManagerMutation 的管理者查核退回 mock 層,而 ⟦b4-MGR0⟧ 的核心突變
//    (把 `if (!(await isActiveManager(...))) return null` 改成不看回傳值)會【全綠通過】。
//    要造假資料就 mock '../staff-repository' 那一層,不要 mock '../staff'。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock next/headers cookies()+headers():就地 vi.mock + vi.hoisted(對齊 actor.test.ts 慣例)。
const { cookieGet, headerGet, verifySessionDetailed, getSessionActor, isAllowedOrigin, getStaffRowById } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  headerGet: vi.fn(),
  verifySessionDetailed: vi.fn(),
  getSessionActor: vi.fn(),
  isAllowedOrigin: vi.fn(),
  getStaffRowById: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
  headers: async () => ({ get: headerGet }),
}));
// 🔴 `consumeAlarmSlot` 也要 mock:它是【有副作用】的(記下時間),真的跑進來會讓
//    這幾格互相污染 —— 而症狀是「單獨跑綠、整批跑紅」。回 false = 本檔不驗告警,
//    告警由 env-binding.test.ts 那一組專門釘。
vi.mock('./session', () => ({
  ADMIN_SESS_COOKIE: 'sess',
  verifySessionDetailed,
  consumeAlarmSlot: () => false,
}));
vi.mock('./actor', () => ({ getSessionActor }));
vi.mock('../orders/workflow-form', () => ({ isAllowedOrigin }));
// 🔴 mock 到【repository】那一層, 不是 '../staff' —— 見檔頭第一段。
//    這樣 authorizeManagerMutation → isActiveManager → lookupWithTimeout 這條鏈是【真的】。
vi.mock('../staff-repository', () => ({
  getStaffRowById,
  listStaffRows: vi.fn().mockResolvedValue([]),
}));

import { authorizeAdminMutation, authorizeManagerMutation } from './authorize';

// E8-A1 補:這道閘的三層(session / Origin / 具名 actor)在此之前**零測試覆蓋**。
// 缺口由 2026-07-26 codex 關卡2 對抗審查指出:第三層(actor)現在會打 DB,
// 未來重構若把 `if (!actor) return null` 拿掉或改成 fail-open,既有測試全綠、抓不到。
// 🔴 本檔鎖的是「任一層失敗 → 回 null」,不是各層自己的邏輯(那在各自的測試檔)。

const okSession = { sid: 'sid-1' };

beforeEach(() => {
  vi.clearAllMocks();
  cookieGet.mockReturnValue({ value: 'token' });
  headerGet.mockReturnValue('https://admin.example');
  // 🔴 2026-08-19 片 1:呼叫端改用 verifySessionDetailed ⇒ 回傳形狀從 payload|null
  //    變成 { ok, payload } | { ok:false, reason }。**斷言的意圖一字未改**,只跟著改形狀。
  verifySessionDetailed.mockResolvedValue({ ok: true, payload: okSession });
  isAllowedOrigin.mockReturnValue(true);
  getSessionActor.mockResolvedValue({ id: 'sean', label: 'Sean' });
});

describe('authorizeAdminMutation — 三層閘任一失敗都必須 fail-closed', () => {
  it('should return sid and actorId when all three gates pass', async () => {
    await expect(authorizeAdminMutation()).resolves.toEqual({ sid: 'sid-1', actorId: 'sean' });
  });

  // 🔴🔴 codex 2026-08-16 must-fix:上面那格只驗「回了 sid/actorId」,
  //    **不驗閘去讀的是哪一顆 cookie、哪一個 header**。
  //    ⇒ 有人把 `cookies().get('sess')` 改成讀別的名字、或把 Origin 檢查餵成 Referer,
  //      這裡與 action 那邊會**各自全綠,而中間那段契約沒有人在守**。
  it('🔴 要讀的是 admin session cookie,而且把它的值交給驗證函式', async () => {
    await authorizeAdminMutation();
    expect(cookieGet, '沒去讀 cookie').toHaveBeenCalledWith('sess');
    expect(verifySessionDetailed, '讀到的 cookie 值沒交給驗證函式 ⇒ 中間掉了一段').toHaveBeenCalledWith('token');
  });

  it('🔴 Origin 檢查吃的是 origin header,而且真的把它交給 isAllowedOrigin', async () => {
    await authorizeAdminMutation();
    expect(headerGet, '沒去讀 origin(改讀 referer 的話 CSRF 那道就形同虛設)').toHaveBeenCalledWith('origin');
    // 第二個參數是 devBypass 旗標(`authorize.ts:31`)⇒ 用 objectContaining 不寫死它的值,
    // 但**第一個參數必須是讀到的那個 origin**,那才是本格要守的東西。
    expect(isAllowedOrigin, '讀到的 origin 沒交給檢查 ⇒ 檢查在看別的東西').toHaveBeenCalledWith(
      'https://admin.example',
      expect.objectContaining({ devBypass: expect.any(Boolean) }),
    );
  });

  // 🔴 **哨兵值(codex 對抗審查 must-fix,2026-08-27)**:原本 mock 與期望都寫 `'localhost:3011'`
  //    ⇒ **把碼改成寫死 `host: 'localhost:3011'`(不讀 header)那格照樣綠**
  //    ⇒ 「真的讀 header」與「寫死一個常見的 dev 埠」兩個世界印同一個綠。
  //    真伺服器跑在 3000 時,那個寫死會把**同源**的 mutation 錯拒。
  //    ⇒ 用一個沒有人會寫死的埠。
  const DEV_SENTINEL_HOST = 'localhost:59087';

  it('🔴 `#948` 也真的把 host header 交下去(不是讀 x-forwarded-host、不是漏傳)', async () => {
    // 為什麼要單獨一格:上面那格用 objectContaining 只釘 `devBypass` ⇒ **把 `host:` 整個拿掉,
    // 上面那格照樣綠**。而 `host` 缺席時 `isAllowedOrigin` 的 dev 分支是 fail-closed ——
    // 真實後果是「dev 全部進不去」,那會很吵;**吵的錯不可怕,可怕的是有人為了不吵而把它改回選填**。
    headerGet.mockImplementation((name: string) =>
      name === 'host' ? DEV_SENTINEL_HOST : 'https://admin.example',
    );
    await authorizeAdminMutation();
    expect(headerGet, '沒去讀 host ⇒ 跨埠比對沒有第二個運算元').toHaveBeenCalledWith('host');
    expect(isAllowedOrigin, '讀到的 host 沒交給檢查').toHaveBeenCalledWith(
      'https://admin.example',
      expect.objectContaining({ host: DEV_SENTINEL_HOST }),
    );
    // 🔴 **這裡原本有一行「負對照」,已刪除 —— 而刪它的過程比它本身有用,所以記下來:**
    //    ① code-reviewer(2026-08-27)判它 **must-fix:恆真**。它比的是 `'localhost:4001'`,
    //       而那個字串在本檔的 mock 值域裡**根本不存在** ⇒ 把 `host:` 整鍵刪掉、改讀
    //       `x-forwarded-host`、傳 `undefined`,它照樣綠。**而它上面逐字寫著「確認本格分得出兩個世界」。**
    //    ② 我改成比對一個**真的會流過**的值(origin 那個),然後**去突變驗它**:
    //       在拋棄式 worktree 把 `host: headerStore.get('host')` 接成 `('origin')` ⇒ 紅了。
    //    ③ 🔴 **而我再把負對照改回舊的恆真版、突變留著 ⇒ 它【還是紅的】**
    //       ⇒ 抓到突變的是**上面那句正對照**,不是負對照。**我的「修好版」只是從恆真變成多餘。**
    //    📌 **一個永遠不會單獨紅的負對照,不是對照,是裝飾** ⇒ 刪掉。
    //       上面那句 `toHaveBeenCalledWith(..., objectContaining({ host: 'localhost:3011' }))`
    //       已經釘住「讀到的 host 有交下去」,而它有判別力(②證過)。
  });

  it('🔴 cookie 完全不存在時,交給驗證函式的是 undefined(不是空字串或別的東西)', async () => {
    // ⚠️ 這格**不能**斷言「回 null」—— `verifySessionDetailed` 在本檔是 mock,它無條件回成功,
    //    所以那樣寫等於在測 mock。本格守的是**契約**:沒有 cookie 時傳下去的值長什麼樣。
    cookieGet.mockReturnValue(undefined);
    await authorizeAdminMutation();
    expect(verifySessionDetailed, '沒 cookie 時傳了別的東西下去 ⇒ 真的驗證函式可能誤判成有票').toHaveBeenCalledWith(undefined);
  });

  it('should return null when the admin session cookie fails verification', async () => {
    verifySessionDetailed.mockResolvedValue({ ok: false, reason: 'sig_invalid' });
    await expect(authorizeAdminMutation()).resolves.toBeNull();
  });

  it('should return null when the Origin header is not allowed', async () => {
    isAllowedOrigin.mockReturnValue(false);
    await expect(authorizeAdminMutation()).resolves.toBeNull();
  });

  it('should return null when no named actor resolves (deactivated staff / unknown id / DB error)', async () => {
    // 🔴 E8-A1 之後這條路徑會打 DB:員工被停用、id 不在名單、或 DB 讀取失敗
    //    都會讓 getSessionActor 回 null ⇒ 這裡必須擋下,不得以未知身分寫稽核。
    getSessionActor.mockResolvedValue(null);
    await expect(authorizeAdminMutation()).resolves.toBeNull();
  });

  it('should not consult the actor gate when the session gate already failed', async () => {
    // 順序守門:session 無效時不該再去打 DB 查 actor(省一次查詢,也避免無謂的 server log)。
    verifySessionDetailed.mockResolvedValue({ ok: false, reason: 'sig_invalid' });
    await authorizeAdminMutation();
    expect(getSessionActor).not.toHaveBeenCalled();
  });
});

// ── authorizeManagerMutation(⟦b4-MGR0⟧ 2026-08-28)──────────────────────────
//
// 🔴🔴 **這一組是這片的核心守門,而它必須跑到【真的】 authorizeManagerMutation。**
//    code-reviewer 2026-08-28 MF1 造過這一發突變:
//      把 authorize.ts 的 `if (!(await isActiveManager(base.actorId))) return null;`
//      改成 `await isActiveManager(base.actorId); return base;`  ← 閘完全失效, 而它還是有呼叫
//    在那一發之下, staff.test.ts 的 isActiveManager 那組【全綠】(它本身沒被改壞),
//    staff-actions.test.ts 那組也【全綠】(它 mock 掉了 ./session/authorize)。
//    📌 **每一格都正確運作 —— 而它們檢查的那個東西, 不是被突變的那個東西。**
//    ⇒ 只有本組會紅。**不要把它搬去別的層, 也不要 mock '../staff'(見檔頭)。**
describe('authorizeManagerMutation — 只有【啟用中的管理者】過得了', () => {
  beforeEach(() => {
    getStaffRowById.mockReset();
  });

  it('管理者 ⇒ 回 { sid, actorId }', async () => {
    getStaffRowById.mockResolvedValue({ id: 'sean', label: 'Sean', is_manager: true, is_active: true });
    await expect(authorizeManagerMutation()).resolves.toEqual({ sid: 'sid-1', actorId: 'sean' });
  });

  it('🔴 接線斷言:它拿【base 的 actorId】去查,而且真的走到 repository', async () => {
    // 這一格擋的是兩件事:
    //  ① 有人在本檔補了 vi.mock('../staff') ⇒ 那條鏈整段不跑 ⇒ getStaffRowById 零呼叫 ⇒ 紅
    //  ② 有人把 isActiveManager(base.actorId) 寫成 isActiveManager(base.sid)
    //     ⇒ 後果是全員鎖死, 而上面那格會紅得像「權限壞了」;本格直接指出【傳錯 id】
    getStaffRowById.mockResolvedValue({ id: 'sean', label: 'Sean', is_manager: true, is_active: true });
    await authorizeManagerMutation();
    expect(getStaffRowById, "沒查到 repository ⇒ 那條鏈被 mock 掉了(是不是加了 vi.mock('../staff')?)")
      .toHaveBeenCalled();
    expect(getStaffRowById.mock.calls[0]?.[0], '查的不是 actorId ⇒ 傳錯 id, 後果是全員鎖死或全員放行')
      .toBe('sean');
  });

  it('非管理者 ⇒ null(而基礎閘三層都是通的)', async () => {
    getStaffRowById.mockResolvedValue({ id: 'sean', label: 'Sean', is_manager: false, is_active: true });
    await expect(authorizeManagerMutation()).resolves.toBeNull();
  });

  it('🔴 停用中的管理者 ⇒ null(正式庫真的有這麼一列)', async () => {
    getStaffRowById.mockResolvedValue({ id: 'sean', label: 'Sean', is_manager: true, is_active: false });
    await expect(authorizeManagerMutation()).resolves.toBeNull();
  });

  it('🔴 DB 失敗 ⇒ null(fail-closed;故障不得被讀成放行)', async () => {
    getStaffRowById.mockRejectedValue(new Error('db down'));
    await expect(authorizeManagerMutation()).resolves.toBeNull();
  });

  it('基礎閘先失敗時,不該再去查管理者(順序守門,省一次 DB)', async () => {
    verifySessionDetailed.mockResolvedValue({ ok: false, reason: 'sig_invalid' });
    await expect(authorizeManagerMutation()).resolves.toBeNull();
    expect(getStaffRowById).not.toHaveBeenCalled();
  });
});
