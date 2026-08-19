import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock next/headers cookies()+headers():就地 vi.mock + vi.hoisted(對齊 actor.test.ts 慣例)。
const { cookieGet, headerGet, verifySessionDetailed, getSessionActor, isAllowedOrigin } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  headerGet: vi.fn(),
  verifySessionDetailed: vi.fn(),
  getSessionActor: vi.fn(),
  isAllowedOrigin: vi.fn(),
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

import { authorizeAdminMutation } from './authorize';

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
