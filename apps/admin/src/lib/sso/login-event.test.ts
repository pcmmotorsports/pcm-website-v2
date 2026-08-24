// @vitest-environment node
// login-event.test.ts — M-4b 登入紀錄寫入端(plan §7.5 的 #1/#2/#3/#7 四格)。
//
// ⚠️ **本檔【不是】schema 守門**(codex 關卡2 R1 高5 收窄我原本寫的~~「唯一的守門」~~):
//    下面那格比對的是「生產碼的字串」對「測試裡另一份手寫的字串」,**兩邊都是我寫的**
//    ⇒ 我把兩邊一起改成 `requestid`,它照樣全綠,而正式 INSERT 仍然會失敗。
//    ⇒ 它能稱的只有「**防止單邊意外改字**」。真正的 schema 守門是**生成型別**
//      (`admin_sso_login_events` 還不在 `database.types.ts` 裡,因為表還沒 apply)⇒ 見 backlog `#652`。
import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { insertSpy, fromSpy, serviceClientSpy } = vi.hoisted(() => {
  // 🔴 **參數要寫出來**:寫成 `vi.fn(async () => …)` 時 TS 推出的 `mock.calls` 是 `[][]`
  //    ⇒ `calls[0]?.[0]` 直接 TS2493(長度 0 的 tuple 沒有索引 0)。
  //    ⚠️ 而那個錯**只有 typecheck 抓得到,測試照樣綠** —— 我踩過這一發。
  const insertSpy = vi.fn(
    async (_row: Record<string, unknown>): Promise<{ error: unknown }> => ({ error: null }),
  );
  const fromSpy = vi.fn(() => ({ insert: insertSpy }));
  return { insertSpy, fromSpy, serviceClientSpy: vi.fn(() => ({ from: fromSpy })) };
});

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: serviceClientSpy }));

import { extractClientIp, recordSsoLogin } from './login-event';

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

beforeEach(() => {
  insertSpy.mockClear().mockResolvedValue({ error: null });
  fromSpy.mockClear();
  serviceClientSpy.mockClear();
});

describe('extractClientIp — 取哪一段是 app 層的決定', () => {
  it('優先序 x-vercel-forwarded-for > x-forwarded-for > x-real-ip', () => {
    expect(
      extractClientIp(
        headers({
          'x-vercel-forwarded-for': '1.1.1.1',
          'x-forwarded-for': '2.2.2.2',
          'x-real-ip': '3.3.3.3',
        }),
      ),
    ).toBe('1.1.1.1');
    expect(extractClientIp(headers({ 'x-forwarded-for': '2.2.2.2', 'x-real-ip': '3.3.3.3' }))).toBe('2.2.2.2');
    expect(extractClientIp(headers({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('一串的話取【第一段】並 trim(proxy 後面常常是 `client, proxy1, proxy2`)', () => {
    expect(extractClientIp(headers({ 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1 ' }))).toBe('9.9.9.9');
  });

  it('🔴 不是合法 IP ⇒ null(寧可少一個欄位,不要少一整列)', () => {
    // `ip` 欄是 inet,PG 解析失敗會讓【整個 INSERT 失敗】⇒ 連 outcome 都沒了。
    // 🔴 前三個是【字元全合法而語法錯】的 —— 舊版只檢查字元集合,它們會通過(codex 關卡2 R1 高3)。
    for (const bad of [
      '999.999.999.999',
      '::::',
      '1.2.3',
      'not-an-ip',
      "1.1.1.1'; DROP TABLE x;--",
      '',
      '   ',
      'x'.repeat(50),
    ]) {
      expect(extractClientIp(headers({ 'x-forwarded-for': bad }))).toBeNull();
    }
    expect(extractClientIp(headers())).toBeNull(); // 一個標頭都沒有
  });

  it('負對照:合法的 IPv4 / IPv6 必須放行(證明上一格不是「全部擋掉」)', () => {
    expect(extractClientIp(headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(extractClientIp(headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});

describe('🔴 source-contract:callback route 只准走這一個入口', () => {
  it('route 不得【直接】import `logSsoLogin` —— 那條路只寫 console、不寫 DB', () => {
    // 病的形狀:下一個人加第六條失敗路徑,照舊寫法叫 `logSsoLogin`
    // ⇒ Vercel log 有那一筆、DB 沒有那一列,而**不會有任何東西紅**(那一小時之後就查不到了)。
    //
    // ⚠️ **這一格的天花板要先講**(codex 關卡2 R1 高4):它**只算原始碼字串**,
    //    證不了「五個控制流分支各自都會呼叫一次」—— 死程式碼、註解裡的字面、
    //    集中在同一分支、`import * as` 繞過,它全部看不出來。
    // ✅ **而那件事已經有人守了**:`app/api/sso/callback/route.test.ts` 逐一驅動
    //    五條路徑(success / state-mismatch×3 / exchange-failed / config-missing / sign-failed-config)
    //    並對**每一條**斷言它印出的結構化 log(`:122,141,179,216,239,259`)。
    // ⇒ **本格與那支是分工**:那支證「五條路徑都有寫紀錄」,本格證「入口沒有被繞過」。
    //    兩者都不是單獨足夠的。
    const source = readFileSync(
      new URL('../../app/api/sso/callback/route.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("import { recordSsoLogin } from '@/lib/sso/login-event'");
    expect(source).not.toMatch(/^import \{[^}]*logSsoLogin[^}]*\} from/m);
    // 每一條路徑都要 await(不 await 的話 serverless 可能在寫入完成前就結束了)
    const calls = source.match(/recordSsoLogin\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5); // 4 條失敗 + 1 條成功
    expect(source.match(/await recordSsoLogin\(/g) ?? []).toHaveLength(calls.length);
  });
});

describe('recordSsoLogin — 兩半一起做', () => {
  it('#1 成功 ⇒ 落一列 outcome=success,欄名逐字對(⚠️ 只防單邊改字,不是 schema 守門,見檔頭)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordSsoLogin(
      'success',
      { requestId: 'req-1', amr: ['pwd', 'totp'] },
      headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0' }),
    );

    // 負對照:成功那一發必須回 'ok' —— 否則上面那些 'log_only' 斷言可能只是「永遠 log_only」
    expect(await recordSsoLogin('success', { requestId: 'req-ok' }, headers())).toBe('ok');
    expect(fromSpy).toHaveBeenCalledWith('admin_sso_login_events');
    expect(insertSpy).toHaveBeenCalledWith({
      outcome: 'success',
      reason: null,
      amr: 'pwd+totp',
      request_id: 'req-1',
      source_app: 'quote',
      ip: '203.0.113.7',
      user_agent: 'Mozilla/5.0',
      // 🔴 **B5-a 加的兩欄**。這一發沒帶身分(上游還沒送)⇒ 兩欄都是 `null`,**而它們必須在**:
      //    這是**完整物件比對**,少列一欄它就紅 —— 那正是本格的用途
      //    (⚠️ 而它仍然只防「單邊改字」,不是 schema 守門,見檔頭)。
      actor_kind: null,
      actor_staff_id: null,
    });
    // ⚠️ ~~另一格單獨檢查 `occurred_at` 不存在~~ 已刪:上面的**完整物件比對**通過之後它必然通過,
    //    那是一格「不可能紅」的冗餘守門(codex 關卡2 R1 指出)。
    infoSpy.mockRestore();
  });

  it('🔴 #2 失敗 ⇒ outcome=fail 且 reason 非空', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordSsoLogin('fail', { requestId: 'req-2', reason: 'state-mismatch' }, headers());

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'fail', reason: 'state-mismatch', amr: null }),
    );
    warnSpy.mockRestore();
  });

  it.each([
    ['reject(連線層炸了)', () => insertSpy.mockRejectedValue(new Error('db down'))],
    // 🔴🔴 **這一格才是主要失敗路徑**(codex 關卡2 R1 高2):supabase-js 的 `.insert()`
    //    失敗時**回傳 `{ error }`、不會 reject** ⇒ 表不存在 / 權限不對 / PostgREST 回錯,
    //    `await` 全部正常完成、`catch` 一次都不會跑。舊版完全沒檢查回傳值 ⇒ 那條路是無聲的。
    ['🔴 resolve 成 { error }(表不存在 / 權限不對 —— 主要失敗路徑)', () =>
      insertSpy.mockResolvedValue({ error: { message: 'relation does not exist' } })],
  ])('🔴 #3 DB 失敗(%s)⇒ 不 throw,而且 console 那半照樣寫了', async (_label, arrange) => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    arrange();

    // 🔴 斷言**回傳值**,不是「沒 throw」——「有檢查 `{ error }`」與「沒檢查」在外部
    //    看起來一模一樣(實測:把那道檢查拿掉,整份測試全綠)⇒ 沒有可觀測差異的檢查,測試必然恆綠。
    await expect(recordSsoLogin('success', { requestId: 'req-3' }, headers())).resolves.toBe('log_only');
    expect(infoSpy).toHaveBeenCalled(); // 🔴 DB 那半死了,一小時軌跡那半仍然要有
    infoSpy.mockRestore();
  });

  it('🔴 DB 永遠不 settle ⇒ 逾時放行(不讓寫紀錄把登入卡到平台殺掉)', async () => {
    // 失敗情境:連線一直不結束 ⇒ 五條路徑全卡在 await ⇒ 成功路徑即使 session cookie 已簽好,
    // response 也送不出去(codex 關卡2 R1 高1)。
    vi.useFakeTimers();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    insertSpy.mockImplementation(() => new Promise(() => {})); // 永不 settle
    try {
      const pending = recordSsoLogin('success', { requestId: 'req-t' }, headers());
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toBe('log_only');
    } finally {
      vi.useRealTimers();
      infoSpy.mockRestore();
    }
  });

  it('🔴 console 那半自己 throw ⇒ 也不得中斷登入(它原本在 try 外)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('stdout gone');
    });
    try {
      await expect(recordSsoLogin('success', { requestId: 'req-c' }, headers())).resolves.toBe('ok');
      expect(insertSpy).toHaveBeenCalled(); // console 死了,DB 那半仍然要試
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('🔴 #7 console 那半【不得】出現 IP 或 UA 原值(PII 只進 DB 那一列)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordSsoLogin(
      'success',
      { requestId: 'req-4' },
      headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'SecretAgent/9' }),
    );

    const printed = JSON.stringify(infoSpy.mock.calls);
    expect(printed).not.toContain('203.0.113.7');
    expect(printed).not.toContain('SecretAgent/9');
    expect(printed).toContain('sso.login'); // 正向對照:它真的印了東西,不是「什麼都沒印所以不含」
    infoSpy.mockRestore();
  });

  // ════════════════════════════════════════════════════════════════════════
  // 🔴🔴 2026-08-24:本格從【數次數】改成【驗內容】(主視窗 Q1 裁准,附硬條件)
  // ════════════════════════════════════════════════════════════════════════
  // **舊版**:失敗時 console 呼叫次數不得超過 baseline。
  // **問題**:它的**用意**是「不准印 error 物件」(DB 錯誤訊息夾帶那一行的 IP / UA),
  //          **機制**卻是「一行都不准多印」⇒ 連零 PII 的固定字串也擋。
  // 🔴 **而它今天就已經在放行一個它照字面該擋的東西**:
  //    退回成功時印的 `IDENTITY_DROP_PREFIX` 也是「多印的一行」,
  //    舊守門量不到它 —— 因為舊守門的情境是兩發都錯,**從沒走到退回成功那條**。
  //    ⇒ 一道守門若已經在放行它宣稱要擋的東西,它守的就不是它宣稱的那件事。
  //
  // **新版守的是【內容】**,四條:
  //   ① 每一行要嘛是 security-log 那行 JSON,要嘛**開頭命中固定前綴白名單**
  //   ② 任何一行都不得出現 IP / UA / staff_id
  //   ③ 任何一行都不得出現 DB error 的 message / details 內容
  //   ④ 每次 console 呼叫**只准一個參數** —— 擋 `console.warn('失敗了', result.error)`
  //      (它前綴合法、而第二個參數就是那顆夾帶 PII 的 error 物件)
  //
  // ⚠️ **白名單寫死在測試裡,不從 source import** —— import 的話,
  //    改 source 的前綴會讓白名單跟著動,守門就永遠對齊現況。
  const ALLOWED_FAILURE_PREFIXES = [
    '[sso.login] 登入事件寫成了,但【沒有身分】—— ',
    '[sso.login] 登入事件【整列都沒寫成】—— ',
    '[sso.login] 登入事件的 DB 那半整段拋出或逾時 —— ',
  ];

  it('🔴 DB 寫入失敗時 console 只准出現【白名單固定字串】,且不得夾帶 error 物件 / IP / UA', async () => {
    const ALL = ['error', 'warn', 'log', 'info', 'debug'] as const;
    const spies = ALL.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const IP = '203.0.113.7';
    const UA = 'SecretAgent/9';
    const DB_MSG = `row ${IP} ${UA} failed`;
    try {
      const h = headers({ 'x-forwarded-for': IP, 'user-agent': UA });

      const collect = () =>
        spies.flatMap((sp, si) =>
          sp.mock.calls.map((c) => ({ method: ALL[si], argc: c.length, text: String(c[0]) })),
        );
      const ok = (t: string) =>
        t.includes('"evt":"sso.login"') || ALLOWED_FAILURE_PREFIXES.some((p) => t.startsWith(p));

      // 正向對照:它真的會印東西(否則下面每一條都對著空陣列成立)
      insertSpy.mockResolvedValue({ error: null });
      await recordSsoLogin('success', { requestId: 'req-base' }, h);
      expect(collect().length).toBeGreaterThan(0);

      // 失敗①:reject(連線層炸了)
      insertSpy.mockRejectedValue(new Error(DB_MSG));
      await recordSsoLogin('success', { requestId: 'req-5' }, h);
      // 🔴 失敗②:resolve 成 { error } —— **主要失敗路徑**(codex 關卡2 R2 中6)
      insertSpy.mockResolvedValue({ error: { message: DB_MSG, details: DB_MSG } });
      await recordSsoLogin('success', { requestId: 'req-6' }, h);
      // 失敗③:第一發錯、退回成功 ⇒ 這條會合法地多印一行(白名單那行)
      insertSpy
        .mockResolvedValueOnce({ error: { code: 'PGRST204', message: DB_MSG } })
        .mockResolvedValueOnce({ error: null });
      await recordSsoLogin(
        'success',
        { requestId: 'req-7', actorKind: 'user', actorStaffId: 'sean' },
        h,
      );

      const calls = collect();
      // ① 每一行都要在白名單上
      const strays = calls.filter((c) => !ok(c.text)).map((c) => `${c.method}: ${c.text}`);
      expect(strays).toEqual([]);
      // ④ 每次呼叫只准一個參數(擋 console.warn(msg, result.error))
      expect(calls.filter((c) => c.argc !== 1)).toEqual([]);
      // ②③ 內容:IP / UA / staff_id / DB 訊息一個都不准出現
      const printed = JSON.stringify(calls);
      expect(printed).not.toContain(IP);
      expect(printed).not.toContain(UA);
      expect(printed).not.toContain('sean');
      expect(printed).not.toContain(DB_MSG);
      // console.error 一次都不該被叫(印 error 物件的人通常用它)
      expect(calls.filter((c) => c.method === 'error')).toEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔴 `B5-a` 接線:身分要真的被寫進 `admin_sso_login_events`
// ════════════════════════════════════════════════════════════════════════════
// **這一組回答的是主視窗問的那句:「接上之後,誰會第一個發現它沒接?」**
//
// 🔴 而它取代了 `login-event-identity-drop-fuse.test.ts`(**2026-08-24 依它自己的退場條款刪除**;
//    原文 `git show 952c0c42:apps/admin/src/lib/sso/login-event-identity-drop-fuse.test.ts`,189 行)。那支守的是「insert 寫了而表沒欄」——
//    兩個訊號現在都成立 ⇒ 它自己說「屆時刪掉本檔,不要留著當紀念」。
// ⚠️ **而它守不到的正是這一組要守的**:「**根本沒接**」那個世界,它的訊號 A 恆假 ⇒ 一聲不叫。
//
// 📌 **順手記一個【量出來的】坑**(它差點讓那支 fuse 安靜地失效):
//    那支的字集是 `/\bstaff_id\b/`,而 B5-a 的欄位叫 `actor_staff_id`。
//    `node -e "/\bstaff_id\b/.test('actor_staff_id')"` ⇒ **false**(`_` 是 word 字元)。
//    ⇒ **一個守門的字集,是照它寫成那天的命名訂的;而命名會變。**
describe('🔴 B5-a:登入事件要帶著身分寫進 DB', () => {
  it('sub.kind=user ⇒ insert 帶 actor_kind 與 actor_staff_id(沒接線的話這格紅)', async () => {
    await recordSsoLogin(
      'success',
      { requestId: 'r-1', amr: ['pwd'], actorKind: 'user', actorStaffId: 'sean' },
      headers(),
    );
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({ actor_kind: 'user', actor_staff_id: 'sean' });
  });

  it('sub.kind=fallback ⇒ actor_kind 有值而 actor_staff_id 是 null(對齊 DB 的配對 CHECK)', async () => {
    await recordSsoLogin('success', { requestId: 'r-2', amr: ['pwd'], actorKind: 'fallback' }, headers());
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({ actor_kind: 'fallback', actor_staff_id: null });
  });

  it('✅ 對照組:上游沒送身分(今天)⇒ 兩欄都是 null,而其餘欄照舊', async () => {
    await recordSsoLogin('success', { requestId: 'r-3', amr: ['pwd'] }, headers());
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      actor_kind: null,
      actor_staff_id: null,
      request_id: 'r-3',
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 🔴🔴 部署時序空窗:migration 還沒 apply 的那段時間
  // ════════════════════════════════════════════════════════════════════════
  // 不接這一段的話,那個空窗裡**每一次登入都會整列不見**(本檔 catch 的註解逐字:
  // 「表還沒 apply、權限不對、DB 掛掉、逾時,症狀都一樣」)
  // ⇒ 我們會拿「沒有身分」換成「連紀錄都沒有」,而**那比接線前更糟**。
  describe('🔴 空窗保護:帶身分的 insert 被拒 ⇒ 退回不帶身分那版,並【出聲】', () => {
    it('退回之後那一列仍然寫進去了,而回傳值說得出「沒有身分」', async () => {
      insertSpy
        .mockResolvedValueOnce({ error: { message: 'column "actor_kind" does not exist' } })
        .mockResolvedValueOnce({ error: null });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const r = await recordSsoLogin(
        'success',
        { requestId: 'r-4', amr: ['pwd'], actorKind: 'user', actorStaffId: 'sean' },
        headers(),
      );

      // 🔴 **在 mockRestore 之前把要驗的東西全部取出來** —— restore 之後 `warn.mock` 就沒了,
      //    而讀到的 `undefined` 會讓斷言紅在「量具已收攤」而不是「行為不對」。(我踩過這一發。)
      const lines = warn.mock.calls.map((c) => String(c[0]));
      const argCounts = warn.mock.calls.map((c) => c.length);
      warn.mockRestore();
      expect(r).toBe('ok_without_identity');
      expect(insertSpy).toHaveBeenCalledTimes(2);
      // 退回那一發【不得】再帶身分欄(否則它會被同一個原因再拒一次)
      expect(insertSpy.mock.calls[1]?.[0]).not.toHaveProperty('actor_kind');
      // 而那一列的其他欄位一個都不能少 —— 這才是這段存在的理由
      expect(insertSpy.mock.calls[1]?.[0]).toMatchObject({ request_id: 'r-4', outcome: 'success' });
      // 🔴 出聲:值班 grep 得到。(~~「apply 之後永遠不再出現」~~ 已證偽 ⇒ 見下面分類那三格。)
      expect(lines.filter((l) => l.includes('沒有身分')).length).toBe(1);
      // 🔴 零 PII:那一行不得帶 staff_id,也不得帶 DB 的 error 物件
      expect(lines.join('\n')).not.toContain('sean');
      expect(argCounts[0]).toBe(1);
    });

    it('✅ 對照組:第一發就成功 ⇒ 只打一次、不出聲、回 ok', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await recordSsoLogin(
        'success',
        { requestId: 'r-5', amr: ['pwd'], actorKind: 'user', actorStaffId: 'sean' },
        headers(),
      );
      const lines = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
      expect(r).toBe('ok');
      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(lines.filter((l) => l.includes('沒有身分')).length).toBe(0);
    });

    it('🔴 兩發都失敗 ⇒ 回 log_only,而【不得】謊稱寫成了', async () => {
      insertSpy.mockResolvedValue({ error: { message: 'boom' } });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await recordSsoLogin(
        'success',
        { requestId: 'r-6', amr: ['pwd'], actorKind: 'user', actorStaffId: 'sean' },
        headers(),
      );
      const lines = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
      expect(r).toBe('log_only');
      // 🔴🔴 codex B2-4:這個世界原本**一聲都不叫**,而它比只丟身分嚴重(整列不見)。
      //    (2026-08-24 主視窗 Q1 裁准把守門改成驗內容之後才裝得上。)
      expect(lines.filter((l) => l.includes('整列都沒寫成')).length).toBe(1);
      expect(lines.join('\n')).not.toContain('sean');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴🔴 DB 那半整段 throw / 逾時 ⇒ 也要出聲(2026-08-24 codex B2-4)
  // ══════════════════════════════════════════════════════════════════════════
  describe('🔴 throw / 逾時那條路不得靜默', () => {
    it('insert 拋出 ⇒ 回 log_only,而且【出聲】', async () => {
      insertSpy.mockRejectedValue(new Error('boom'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await recordSsoLogin('success', { requestId: 'r-t1' }, headers());
      const lines = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
      expect(r).toBe('log_only');
      expect(lines.filter((l) => l.includes('整段拋出或逾時')).length).toBe(1);
    });

    it('🔴 那一行不得謊稱「那一列不在」—— 逾時未取消底層請求,它可能稍後才寫成', async () => {
      insertSpy.mockRejectedValue(new Error('boom'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await recordSsoLogin('success', { requestId: 'r-t2' }, headers());
      const text = warn.mock.calls.map((c) => String(c[0])).join('\n');
      warn.mockRestore();
      expect(text).toContain('也可能稍後才寫成');
    });

    it('✅ 對照組:成功時【不】出現這一行', async () => {
      insertSpy.mockResolvedValue({ error: null });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await recordSsoLogin('success', { requestId: 'r-t3' }, headers());
      const lines = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
      expect(lines.filter((l) => l.includes('整段拋出或逾時')).length).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴🔴 錯因分類(2026-08-24 codex B2-3 / B2-5)
  // ══════════════════════════════════════════════════════════════════════════
  // 原本退回路徑**無條件**印「最可能的原因:migration 還沒 apply」——
  // 而本窗在拋棄式 PG + 真 PostgREST 上量到:migration **已 apply** 的世界裡,
  // 三種不合法的身分形狀**都**走到退回路徑、**都**印那句話 ⇒ 值班被指去查一件做完的事。
  // ⇒ 🔴 **只有 `error.code` 分得出是哪個世界。**
  describe('🔴 退回時要說得出【是哪一個世界】,不能一律說「還沒 apply」', () => {
    const shoot = async (error: Record<string, unknown>) => {
      insertSpy.mockResolvedValueOnce({ error }).mockResolvedValueOnce({ error: null });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await recordSsoLogin(
        'success',
        { requestId: 'r-c', amr: ['pwd'], actorKind: 'user', actorStaffId: 'sean' },
        headers(),
      );
      const lines = warn.mock.calls.map((c) => String(c[0]));
      warn.mockRestore();
      return { r, text: lines.join('\n') };
    };

    it('PGRST204(找不到欄)⇒ 說「最可能尚未 apply」,**而且要講出第二個來源**', async () => {
      const { r, text } = await shoot({ code: 'PGRST204', message: 'x' });
      expect(r).toBe('ok_without_identity');
      expect(text).toContain('尚未 apply');
      expect(text).not.toContain('契約 bug');
      // 🔴 2026-08-24 codex R2-3:這個碼**不只一個來源** —— 已 apply 但 schema cache 沒刷新也回它。
      //    少了這一句,值班查完 apply 狀態(= 已 apply)就會卡住,而真因是 cache。
      expect(text, 'PGRST204 的第二個來源沒講出來 ⇒ 值班會查錯方向').toContain('schema cache');
      // 🔴 而它**不得**再說「apply 之後不再出現」—— 那句話今天被證偽兩次了
      expect(text).not.toContain('不再出現');
    });

    it('🔴 23514(CHECK 被拒)⇒ 說「應用層契約 bug」,**不得**說「還沒 apply」', async () => {
      const { r, text } = await shoot({ code: '23514', message: 'x' });
      expect(r).toBe('ok_without_identity');
      expect(text).toContain('契約 bug');
      expect(text).not.toContain('尚未 apply');
    });

    it('其餘錯誤碼 ⇒ 說「未分類」,**不得**冒充知道原因', async () => {
      const { r, text } = await shoot({ code: '42501', message: 'x' });
      expect(r).toBe('ok_without_identity');
      expect(text).toContain('未分類');
      expect(text).toContain('42501');
      expect(text).not.toContain('尚未 apply');
      expect(text).not.toContain('契約 bug');
    });

    it('✅ 對照組:三句話互斥 —— 沒有 code 時走「未分類」而不是靜默', async () => {
      const { text } = await shoot({ message: 'no code at all' });
      expect(text).toContain('未分類');
    });

    it('🔴 零 PII 不因分類而放寬:那幾行不得帶 staff_id,也不得帶 message', async () => {
      const { text } = await shoot({ code: '23514', message: 'staff_id=sean 違反 CHECK' });
      expect(text).not.toContain('sean');
      expect(text).not.toContain('違反 CHECK');
    });
  });
});
