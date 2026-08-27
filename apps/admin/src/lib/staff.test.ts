import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listStaffRows, getStaffRowById } = vi.hoisted(() => ({
  listStaffRows: vi.fn(),
  getStaffRowById: vi.fn(),
}));

vi.mock('./staff-repository', () => ({ listStaffRows, getStaffRowById }));

import {
  isActiveManager,
  listActiveStaff,
  pickStaff,
  resolveActiveStaffById,
  resolveStaff,
  __resetStaffLogThrottleForTests,
  type StaffActor,
} from './staff';


const FIXED_STAFF: readonly StaffActor[] = [
  { id: 'sean', label: 'Sean(老闆)' },
  { id: 'staff_1', label: '員工 1(占位)' },
  { id: 'staff_2', label: '員工 2(占位)' },
];

beforeEach(() => {
  listStaffRows.mockReset().mockResolvedValue([
    { id: 'sean', label: 'Sean(老闆)', is_active: true },
    { id: 'staff_1', label: '員工 1(占位)', is_active: true },
    { id: 'staff_2', label: '員工 2(占位)', is_active: true },
  ]);
  // 🔴 **本檔【最上層】也要重設節流**(2026-08-26 nit C3 之後):
  //    `listActiveStaff` 的失敗 log 現在有有界去重 ⇒ 前一格先消耗掉窗口
  //    ⇒ 後面那兩格斷言「有記 log」會**永遠看到 0 則**, 而紅的原因與被測的東西無關。
  //    📌 這是同一個病在本檔的第二次:module-level 狀態會跨測試留著。
  __resetStaffLogThrottleForTests();
});

afterEach(() => vi.restoreAllMocks());

describe('staff', () => {
  it('should have at least one staff with unique ids', () => {
    expect(FIXED_STAFF.length).toBeGreaterThan(0);
    const ids = FIXED_STAFF.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should resolve a known id to its StaffActor', () => {
    expect(pickStaff(FIXED_STAFF, 'sean')).toEqual({ id: 'sean', label: 'Sean(老闆)' });
  });

  it('should return null for unknown / empty / nullish id (fail-closed)', () => {
    expect(pickStaff(FIXED_STAFF, 'nope')).toBeNull();
    expect(pickStaff(FIXED_STAFF, '')).toBeNull();
    expect(pickStaff(FIXED_STAFF, null)).toBeNull();
    expect(pickStaff(FIXED_STAFF, undefined)).toBeNull();
  });

  it('should return null when the matching database row is inactive', async () => {
    listStaffRows.mockResolvedValue([
      { id: 'former_staff', label: '已停用員工', is_active: false },
    ]);

    await expect(resolveStaff('former_staff')).resolves.toBeNull();
  });

  it('should return null without throwing when the database query fails', async () => {
    const dbError = new Error('database unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listStaffRows.mockRejectedValue(dbError);

    await expect(resolveStaff('sean')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[admin/staff] 員工名單載入失敗', dbError);
  });

  it('should return an empty list without throwing when the database query fails', async () => {
    const dbError = new Error('database unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listStaffRows.mockRejectedValue(dbError);

    await expect(listActiveStaff()).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('[admin/staff] 員工名單載入失敗', dbError);
  });
});

describe('listActiveStaff 的失敗 log 也走有界去重(nit C3)', () => {
  beforeEach(() => __resetStaffLogThrottleForTests());

  it('🔴 DB 失敗連打兩發 ⇒ 只留一則', async () => {
    // 🔴 **這一格是補的**:我加了節流卻沒有任何一格在看它 ——
    //    2026-08-26 實測「把節流拿掉」⇒ **56 格全綠**。
    //    📌 又一次同款:**加了一道防護, 而沒有東西在看那道防護還在不在。**
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      listStaffRows.mockRejectedValue(new Error('db down'));
      await listActiveStaff();
      await listActiveStaff();
      const hits = err.mock.calls.filter((c) => String(c[0]).includes('員工名單載入失敗'));
      expect(hits, '節流不見了 ⇒ DB 掛掉時每個請求都會印一則').toHaveLength(1);
      // ✅ 正對照:重設窗口之後【又記得到】—— 否則本格在「永遠不記」時也是綠的。
      __resetStaffLogThrottleForTests();
      await listActiveStaff();
      expect(
        err.mock.calls.filter((c) => String(c[0]).includes('員工名單載入失敗')),
      ).toHaveLength(2);
    } finally {
      err.mockRestore();
    }
  });

  it('🔴 兩個 key 互不影響:名單失敗與單筆失敗各有自己的窗口', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      listStaffRows.mockRejectedValue(new Error('db down'));
      getStaffRowById.mockRejectedValue(new Error('db down'));
      await listActiveStaff();
      await resolveActiveStaffById('sean');
      // 兩則不同 key ⇒ 兩則都該留;壓成同一個 key 的話這裡只會有 1。
      expect(err.mock.calls).toHaveLength(2);
    } finally {
      err.mockRestore();
    }
  });
});

// ── resolveActiveStaffById(B5-b 新增;codex R2 must-fix 之後補的直接測試)──────
//
// 🔴 **它在此之前【只被 proxy 測試間接跑到】** —— 而那種覆蓋答得出「擋不擋」,
//    答不出「它自己的回傳語意對不對」。而語意正是這一支最需要守的東西:
//    它與 `resolveStaff` **必須逐條相同**, 一旦漂掉, 讀取閘與寫入閘會對
//    「這個人算不算數」給出不同答案, 而**沒有任何測試會紅**。
describe('resolveActiveStaffById · 與 resolveStaff 的語意必須逐條相同', () => {
  beforeEach(() => {
    getStaffRowById.mockReset();
    __resetStaffLogThrottleForTests();
  });

  it('在職 ⇒ 回 actor,而且【問的是傳進去那個 id】', async () => {
    getStaffRowById.mockResolvedValue({ id: 'amy', label: '艾咪', is_manager: false, is_active: true });
    await expect(resolveActiveStaffById('amy')).resolves.toEqual({ id: 'amy', label: '艾咪' });
    // 🔴 第一個參數是 id;第二個是 AbortSignal(codex R2 must-fix 之後加的)
    //    ⇒ 用 mock.calls 逐格看, 不要用 toHaveBeenCalledWith('amy') —— 那會因為多一個參數而紅,
    //      而紅的原因與被測的事無關。
    expect(getStaffRowById.mock.calls[0]?.[0]).toBe('amy');
    expect(getStaffRowById.mock.calls[0]?.[1], '沒有把 AbortSignal 傳下去 ⇒ 逾時只是不等了, 查詢還在跑')
      .toBeInstanceOf(AbortSignal);
  });

  it('is_active=false ⇒ null(不是回 actor)', async () => {
    getStaffRowById.mockResolvedValue({ id: 'amy', label: '艾咪', is_manager: false, is_active: false });
    await expect(resolveActiveStaffById('amy')).resolves.toBeNull();
  });

  it('查無此人 ⇒ null', async () => {
    getStaffRowById.mockResolvedValue(null);
    await expect(resolveActiveStaffById('nobody')).resolves.toBeNull();
  });

  it('空 id / null / undefined ⇒ null,而且【一次 DB 都沒查】', async () => {
    for (const id of ['', null, undefined]) {
      await expect(resolveActiveStaffById(id)).resolves.toBeNull();
    }
    expect(getStaffRowById).not.toHaveBeenCalled();
  });

  it('🔴 DB 失敗 ⇒ null(fail-closed),不得往上拋', async () => {
    getStaffRowById.mockRejectedValue(new Error('db down'));
    await expect(resolveActiveStaffById('amy')).resolves.toBeNull();
  });

  it('🔴 DB 一直不回應(pending)⇒ 逾時後回 null,而且【真的中止那個查詢】', async () => {
    // codex must-fix:沒有逾時 ⇒ callback 不回 403, 一路等到 Vercel 504,
    // 而那時一次性的 SSO code 已經被兌換掉、也沒有留下任何紀錄。
    //
    // 🔴 **本格【不靠 vitest 自己的 timeout 抓】**(主視窗 2026-08-26 指出):
    //    若只寫 `await expect(p).resolves.toBeNull()`, 拿掉逾時保護之後那個 promise 永遠不 resolve
    //    ⇒ 紅的形狀會是「**測試逾時**」, 在 CI 上讀起來像「這格很慢」而不是「保護不見了」。
    //    ⇒ 改用一個 sentinel 去比, **讓它紅成一句話**。
    vi.useFakeTimers();
    try {
      let captured: AbortSignal | undefined;
      getStaffRowById.mockImplementation((_id: unknown, signal?: AbortSignal) => {
        captured = signal;
        return new Promise(() => {}); // 永遠不 resolve
      });
      const p = resolveActiveStaffById('sean');

      const PENDING = Symbol('still-pending');
      // ✅ 正對照:推進【不夠久】時它必須還在等 —— 否則本格在「立刻回 null」的壞實作上也是綠的
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await Promise.race([p, Promise.resolve(PENDING)]), '2 秒就回了 ⇒ 逾時值不是 3 秒')
        .toBe(PENDING);

      await vi.advanceTimersByTimeAsync(1_500);
      const outcome = await Promise.race([p, Promise.resolve(PENDING)]);
      expect(outcome, '過了逾時仍然沒回 ⇒ 逾時保護不見了(不是「測試很慢」)').not.toBe(PENDING);
      expect(outcome).toBeNull();
      // 🔴 而「不等了」不等於「停止了」:要證明真的送出中止訊號。
      expect(captured?.aborted, '逾時了而查詢沒有被 abort ⇒ 它還在跑、還會重試').toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴 DB 失敗的 log 走【有界去重】—— 連打兩發只留一則(codex R2 must-fix)', async () => {
    // 病:R1 我把 proxy 那則 warn 節流了而【這一則沒有】⇒ codex 逐字「放大面只是搬家了」。
    // 觸發條件一模一樣:DB 掛掉 ⇒ 全公司每個請求都走到這裡。
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      getStaffRowById.mockRejectedValue(new Error('db down'));
      await resolveActiveStaffById('amy');
      await resolveActiveStaffById('amy');
      expect(err.mock.calls).toHaveLength(1);
      // ✅ 正對照:重設窗口之後【又記得到】—— 否則本格在「永遠不記」時也是綠的。
      __resetStaffLogThrottleForTests();
      await resolveActiveStaffById('amy');
      expect(err.mock.calls).toHaveLength(2);
    } finally {
      err.mockRestore();
    }
  });
});

// ── isActiveManager(⟦b4-MGR0⟧ 2026-08-28)──────────────────────────────────
//
// 🔴 **它必須住在這裡,不能住 staff-actions.test.ts** —— 那支檔 mock 掉了
//    `./session/authorize`,所以在那裡寫的「非管理者 ⇒ 拒」斷言的是【那個 mock 的行為】,
//    而不是本函式的邏輯。把 `is_active` 那個條件整條刪掉,那邊照樣全綠。
describe('isActiveManager · 啟用中的管理者才算數', () => {
  beforeEach(() => {
    getStaffRowById.mockReset();
    __resetStaffLogThrottleForTests();
  });

  it('is_manager=true + is_active=true ⇒ true(正對照;少了它,寫成「一律 false」也全綠)', async () => {
    getStaffRowById.mockResolvedValue({ id: 'amy', label: '艾咪', is_manager: true, is_active: true });
    await expect(isActiveManager('amy')).resolves.toBe(true);
    expect(getStaffRowById.mock.calls[0]?.[0]).toBe('amy');
    expect(getStaffRowById.mock.calls[0]?.[1], '沒把 AbortSignal 傳下去 ⇒ 逾時只是不等了, 查詢還在跑')
      .toBeInstanceOf(AbortSignal);
  });

  it('🔴 is_manager=true + is_active=false(停用中的管理者)⇒ false', async () => {
    // 這一格有現實依據:2026-08-28 正式庫真的有這麼一列(test_01)——
    // 一顆【休眠的管理者】。少了 is_active 那半, 任何人把它叫醒就拿到權限。
    getStaffRowById.mockResolvedValue({ id: 'test_01', label: '測試', is_manager: true, is_active: false });
    await expect(isActiveManager('test_01')).resolves.toBe(false);
  });

  it('is_manager=false + is_active=true ⇒ false', async () => {
    getStaffRowById.mockResolvedValue({ id: 'staff_1', label: '員工 1', is_manager: false, is_active: true });
    await expect(isActiveManager('staff_1')).resolves.toBe(false);
  });

  it('查無此人 ⇒ false', async () => {
    getStaffRowById.mockResolvedValue(null);
    await expect(isActiveManager('nobody')).resolves.toBe(false);
  });

  it('空 id / null / undefined ⇒ false,而且【一次 DB 都沒查】', async () => {
    for (const id of ['', null, undefined]) {
      await expect(isActiveManager(id)).resolves.toBe(false);
    }
    expect(getStaffRowById).not.toHaveBeenCalled();
  });

  it('🔴 DB 失敗 ⇒ false(fail-closed),不得往上拋、也不得放行', async () => {
    getStaffRowById.mockRejectedValue(new Error('db down'));
    await expect(isActiveManager('amy')).resolves.toBe(false);
  });

  it('🔴 DB 失敗與「不是管理者」回同一個 false,而【log 上分得開】', async () => {
    // 回傳值刻意複製既有歧義(見 isActiveManager docstring);而值班端要分得出
    // 「資料庫掛了」與「有人在試越權」—— 只有前者留 error。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    getStaffRowById.mockResolvedValue({ id: 'staff_1', label: '員工 1', is_manager: false, is_active: true });
    await expect(isActiveManager('staff_1')).resolves.toBe(false);
    expect(spy, '「不是管理者」不該留 error —— 那會把正常拒絕變成雜訊').not.toHaveBeenCalled();

    getStaffRowById.mockRejectedValue(new Error('db down'));
    await expect(isActiveManager('staff_1')).resolves.toBe(false);
    expect(spy, 'DB 失敗沒有留下任何痕跡 ⇒ 故障會被讀成「他沒權限」').toHaveBeenCalledTimes(1);
  });
});
