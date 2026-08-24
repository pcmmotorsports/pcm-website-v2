// @vitest-environment node
// route.test.ts — /api/cron/anomaly-alert GET handler 測試(M-3 #250)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(checkAnomalyAlerts)/ @/lib/payment/composition(getAnomalyAlertDeps)。
// 驗:① GET-only 契約 + runtime/maxDuration/dynamic ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401)
//     ③ ANOMALY_ALERT_ENABLED gate(預設/false/TRUE/whitespace→200 no-op 不建 deps、嚴格 'true'→跑)
//     ④ enabled+errors=0→200 計數、errors>0→503 不偽 200、deps/factory throw→503 ⑤ options 注入
//     (refundingStuckSeconds=86400)⑥ 零 PII(log counts only)。

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { checkSpy, getDepsSpy } = vi.hoisted(() => ({
  checkSpy: vi.fn(),
  getDepsSpy: vi.fn(),
}));

vi.mock('@pcm/use-cases', () => ({ checkAnomalyAlerts: checkSpy }));
vi.mock('@/lib/payment/composition', () => ({ getAnomalyAlertDeps: getDepsSpy }));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/** 乾淨結果(alerted=false、errors=0;Phase I 無流量常態)。 */
const CLEAN_RESULT = {
  alerted: false,
  openCount: 0,
  refundingCount: 0,
  refundingStuckCount: 0,
  attemptManualReviewCount: 0,
  releasedStuckCount: 0,
  pendingDoubleChargeCandidateCount: 0,
  // 🔴 F-004:這三欄**必須明寫**,不能靠「fixture 沒有它 ⇒ undefined ⇒ falsy ⇒ 剛好走 200」。
  //    那種過關是**假的**:route 讀的是 `result.orderRefundsStuckUnknown`,
  //    而一個缺欄位的 fixture 與「查得到而且沒事」在這裡印同一個結果 ——
  //    ⇒ 下面那兩格(unknown ⇒ 503 / 非 unknown ⇒ 200)就是為了讓這兩個世界分得開。
  orderRefundsStuckCount: 0,
  orderRefundsStuckOvernightCount: 0,
  orderRefundsManualFailedCount: 0,
  orderRefundsStuckUnknown: false,
  oldestOpenAgeSeconds: null,
  notifiersTotal: 0,
  notifiersFailed: 0,
  errors: 0,
};

const DEPS = { reader: {}, notifiers: [{}] };

function makeReq(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['authorization'] = authorization;
  return new Request('http://localhost:3000/api/cron/anomaly-alert', { method: 'GET', headers });
}

const bearer = (s: string = SECRET) => `Bearer ${s}`;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.ANOMALY_ALERT_ENABLED = 'true'; // 多數 run 測試預設 enabled;gate 測試顯式覆蓋
  checkSpy.mockReset().mockResolvedValue({ ...CLEAN_RESULT });
  getDepsSpy.mockReset().mockReturnValue({ ...DEPS });
  resetCronRateLimit(); // #254 限流器 module scope 狀態跨測試存活 → 每測試前全清隔離
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.ANOMALY_ALERT_ENABLED;
  vi.clearAllMocks();
});

describe('GET /api/cron/anomaly-alert — 契約 + route 段設定', () => {
  it('只 export GET、不 export POST(Vercel cron 走 GET)', () => {
    expect(typeof GET).toBe('function');
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });

  it('runtime=nodejs / dynamic=force-dynamic / maxDuration=60', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });
});

describe('GET anomaly-alert — 認證(CRON_SECRET Bearer 硬驗)', () => {
  it('無 Authorization → 401、不建 deps、不跑', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(checkSpy).not.toHaveBeenCalled();
    expect(getDepsSpy).not.toHaveBeenCalled();
  });

  it('錯 Bearer → 401', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('裸 secret 無 "Bearer " 前綴 → 401', async () => {
    const res = await GET(makeReq(SECRET));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 未設 → 500 fail-closed(即使 enabled)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(500);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET <32 → 500', async () => {
    process.env.CRON_SECRET = 'short';
    const res = await GET(makeReq(bearer('short')));
    expect(res.status).toBe(500);
  });
});

describe('GET anomaly-alert — ANOMALY_ALERT_ENABLED sequencing gate', () => {
  it('未設 → 認證過後 200 no-op、不建 deps、不跑', async () => {
    delete process.env.ANOMALY_ALERT_ENABLED;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false, skipped: 'anomaly_alert_disabled' });
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it("='false' → 200 no-op", async () => {
    process.env.ANOMALY_ALERT_ENABLED = 'false';
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it("='TRUE'(大小寫)→ 200 no-op(只認字面 'true')", async () => {
    process.env.ANOMALY_ALERT_ENABLED = 'TRUE';
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it("='true' → 跑 checkAnomalyAlerts", async () => {
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  // 鎖嚴格 `!== 'true'` 契約:whitespace/alias/截斷值一律 disabled(防未來誤加 trim/lowercase/寬鬆 parse)。
  it.each([' true', 'true ', ' true ', '1', 'yes', 'True', 'enabled', 'on'])(
    "=%j → 200 no-op(非字面 'true' 一律 disabled)",
    async (val) => {
      process.env.ANOMALY_ALERT_ENABLED = val;
      const res = await GET(makeReq(bearer()));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: false });
      expect(checkSpy).not.toHaveBeenCalled();
    },
  );
});

describe('GET anomaly-alert — enabled 執行 + 結果映射', () => {
  it('errors=0 → 200 + ok:true + 計數摘要(零 PII counts)', async () => {
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, alerted: true, openCount: 2, notifiersTotal: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: true, alerted: true, openCount: 2, errors: 0 });
  });

  it('🔴 errors>0(管道推播失敗)→ 503 + ok:false、**不偽 200**', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, alerted: true, openCount: 1, notifiersTotal: 2, notifiersFailed: 1, errors: 1 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, enabled: true, errors: 1 });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('"errors":1');
    errSpy.mockRestore();
  });

  it('🔴 getAnomalyAlertDeps throw(env 缺 / 零管道)→ 503 fail-closed、不跑、log 固定 reason code 零洩漏', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw new Error('ANOMALY_ALERT_ENABLED=true 但未設定任何告警管道(LINE/Email)');
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(checkSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('deps_or_unexpected_throw');
    expect(logged).not.toContain(SECRET);
    errSpy.mockRestore();
  });

  it('🔴 checkAnomalyAlerts throw(reader throw 上拋)→ 503 fail-closed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockRejectedValue(new Error('reader down'));
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
  });
});

describe('GET anomaly-alert — options 注入(不採信外部輸入)', () => {
  it('checkAnomalyAlerts 收 route 端常數 refundingStuckSeconds=86400 + pending 雙扣窗 12h/卡住 10min', async () => {
    await GET(makeReq(bearer()));
    expect(checkSpy).toHaveBeenCalledWith(expect.anything(), {
      refundingStuckSeconds: 86400,
      pendingDoubleChargeWindowSeconds: 43200,
      pendingDoubleChargeStuckSeconds: 600,
    });
  });

  it('deps = getAnomalyAlertDeps() 注入', async () => {
    await GET(makeReq(bearer()));
    expect(getDepsSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy.mock.calls[0]![0]).toMatchObject({ reader: expect.anything(), notifiers: expect.anything() });
  });
});

describe('GET anomaly-alert — 應用層限流(#254 縱深 hardening)', () => {
  it(`認證後前 ${CRON_RATE_MAX_HITS} 次放行、超限 → 429`, async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect((await GET(makeReq(bearer()))).status).toBe(200);
    }
    expect((await GET(makeReq(bearer()))).status).toBe(429);
  });

  it('限流在認證「後」:錯 Bearer 的 flood(仍 401)不佔額度、真 secret 首打即放行', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS + 1; i++) {
      expect((await GET(makeReq(bearer('b'.repeat(48))))).status).toBe(401);
    }
    expect((await GET(makeReq(bearer()))).status).toBe(200); // 401 flood 未消耗額度
  });

  it('429 在 enabled gate / deps 之前:不建 deps、不跑 checkAnomalyAlerts', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) await GET(makeReq(bearer()));
    getDepsSpy.mockClear();
    checkSpy.mockClear();
    const limited = await GET(makeReq(bearer()));
    expect(limited.status).toBe(429);
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });

  // 釘死排序「認證 → 限流 → enabled gate」:disabled 時仍先過限流。若限流被移到 gate 後,disabled 會在限流前
  // 短路成 200 no-op、第 6 次不會是 429 → 本測試會紅(codex/adversarial should-fix、真鎖排序)。
  it('429 在 enabled gate「前」:disabled(未設)時 flood 超限仍回 429', async () => {
    delete process.env.ANOMALY_ALERT_ENABLED;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect((await GET(makeReq(bearer()))).status).toBe(200); // disabled no-op、但仍過限流消耗額度
    }
    expect((await GET(makeReq(bearer()))).status).toBe(429); // 限流在 gate 前 → 超限優先於 disabled no-op
    expect(getDepsSpy).not.toHaveBeenCalled();
  });
});

describe('catch 的 errorName — 讓「程式錯誤 ≠ 設定錯誤」抵達觀察者(J-003 MF-1)', () => {
  // 🔴 J-003 MF-1:composition-alert-failclosed.test.ts 斷言那個分辨【分得開】,
  //    而在裸的 catch{} + 只記固定碼之下,它在 route 這一層就消失了 ⇒ 那格守門沒有消費者。
  //    下面兩格就是它的消費者:兩個世界必須印不同的字。
  //    ⚠️ 射程:只證明分辨抵達 console.error。**沒有人驗過那行在 Vercel log 出得來**(J-003 MF-3)。
  // ✅ 兩發突變都表演過該紅的那一發(2026-08-21 實跑,shasum 比對還原):
  //    D 把 `errorName` 從 payload 拿掉(= J 報的那個世界)⇒ 3 failed
  //    E `err.name` 改成 `err.message`(= 把洩漏面打開)  ⇒ 2 failed
  const CONFIG_MSG = 'ANOMALY_ALERT_ENABLED=true 但未設定任何告警管道(LINE/Email)';
  const BUG_MSG = 'someFn is not a function';

  // 🔴 codex F:手動 `errSpy.mockRestore()` 寫在斷言【之後】⇒ 任一前置斷言失敗就跳過清理,
  //    而全域 afterEach 只 clear、不還原 console 實作 ⇒ 一發紅會讓後面的測試吃到被 mock 掉的 console。
  //    ⇒ 清理放這裡,不放 happy path 上。
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['設定錯誤(env 缺 / 零管道)', new Error(CONFIG_MSG), 'Error', CONFIG_MSG],
    ['程式錯誤(有人把 code 改壞)', new TypeError(BUG_MSG), 'TypeError', BUG_MSG],
  ])('%s ⇒ errorName=%s,而 message 不進 log', async (_label, thrown, expectedName, secretMsg) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw thrown;
    });
    expect((await GET(makeReq(bearer()))).status).toBe(503);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain(`"errorName":"${expectedName}"`);
    expect(logged).toContain('deps_or_unexpected_throw'); // 固定碼沒有被換掉
    expect(logged).not.toContain(secretMsg); // 🔴 補的是類別名,不是 message
    errSpy.mockRestore();
  });

  it.each([
    ['實例自帶 name', () => Object.assign(new Error('boom'), { name: SECRET })],
    ['自訂子類的 name', () => { class E extends Error { override name = SECRET; } return new E('boom'); }],
    // 🔴 codex R2:這兩格的 Proxy trap **要自己帶著 SECRET** —— 前一版 trap 丟的是 'proxy trap',
    //    那底下的 `not.toContain(SECRET)` 在那一列是【恆綠】的(密鑰根本沒進過那條路)。
    //    ⇒ 恆綠的斷言不是保護,是裝飾。讓它帶著密鑰,那格才有牙齒。
    ['讀 name 就爆的 Proxy', () => new Proxy(new Error('boom'), { get(t, k, r) {
      if (k === 'name') throw new Error(`trap ${SECRET}`); return Reflect.get(t, k, r); } })],
    // 🔴🔴 codex R2 要我補「`instanceof` 就爆的 Proxy」(getPrototypeOf trap,與讀 `.name` 是不同的 trap)。
    //    **我構造不出來,而這一格寫的是【構造不出來】,不是【驗過了】。**
    //    量到的:
    //      · 純 node 裡它成立 —— `throw p` 之後 `e === p` 為 true、`e instanceof Error` 丟 TRAP-FIRED。
    //      · 但**穿過 `vi.fn()` 的 mock 之後就不成立**:route 的 catch 收到的是一個【普通 Error】。
    //        探針(暫時塞進 safeErrorName、跑完已還原)實印:
    //          typeof=object / Object.prototype.toString=[object Error] / (err instanceof Error)="true"
    //        ⇒ trap 在抵達 catch **之前**就被觸發過一次,而它丟出的那個普通 Error 取代了 Proxy。
    //    ⇒ 所以下面這一列斷言的是**真的會發生的那件事**,不是我希望發生的那件事:
    //      trap 丟出的 Error 抵達 catch ⇒ errorName='Error'、**而 trap 訊息裡的 SECRET 不得進 log**
    //      (那一格有牙齒:實作若改成記 err.message,這一列就會紅)。
    //    🔴 未覆蓋:「`instanceof` 在 safeErrorName 裡面爆」那個世界,**從 route 邊界構造不出來**
    //      ⇒ 實作那邊的 try 仍然包著它(便宜且正確),而**它沒有回歸守門**。這是缺口,不是已驗。
    [
      'getPrototypeOf trap(而 trap 的 Error 會先取代它)',
      () => new Proxy(new Error('boom'), { getPrototypeOf() { throw new Error(`trap ${SECRET}`); } }),
      'Error',
    ],
    ['根本不是 Error', () => SECRET],
  ])(
    '🔴 %s ⇒ 密鑰進不了 log、而且照樣 503(codex A-1/A-2/G-2)',
    async (_label, make, expectedName = 'other') => {
      // 🔴 這四格是 codex 對抗審查逼出來的,而第一格他【當場表演給我看】:
      //    `name` 是可寫欄位 ⇒ 我原本「類別名是封閉集合、永遠不含密鑰」那句話是假的。
      //    修法不是相信它,是**由 safeErrorName 自己造出那個封閉集合**。
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      getDepsSpy.mockImplementation(() => {
        throw make();
      });
      // 🔴 Proxy 那格同時釘住:catch 自己不得 throw —— 它 throw ⇒ 變 500 且零 log,比修之前更糟。
      expect((await GET(makeReq(bearer()))).status).toBe(503);
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).toContain(`"errorName":"${expectedName}"`);
      expect(logged).not.toContain(SECRET);
      expect(logged).toContain('deps_or_unexpected_throw');
    },
  );

  it('🔴 兩個世界【真的印不同的字】—— 不然上面兩格可以同時綠而分辨仍然是死的', async () => {
    const names: string[] = [];
    for (const thrown of [new Error(CONFIG_MSG), new TypeError(BUG_MSG)]) {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      getDepsSpy.mockImplementation(() => {
        throw thrown;
      });
      await GET(makeReq(bearer()));
      names.push(JSON.stringify(errSpy.mock.calls));
      errSpy.mockRestore();
    }
    expect(names[0]).not.toEqual(names[1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-001 MF-1/MF-2 修法的守門(2026-08-21,告警信線)
//
// 🔴 J-001 量到的形狀:route.ts 檔頭裡【被本片改到的檔】的 檔案:行號 引用 4/4 全壞,
//    【沒被改到的】1/1 全對。⇒ 病不是「數字寫錯」,是【拿行號當錨】。
//    而修法若只是更新數字,下一輪折完它會再壞一次,**而壞掉時沒有任何東西會紅**。
// ⇒ 所以錨改成【字面】(那行 code 本身),並由下面兩格讓「錨斷掉」變成一發紅。
//
// 🔴 本守門的射程(不要讀成「所有失效引用都擋得住」):
//    擋得住 ① 檔案:行號 形式的新引用 ② 反引號包住的裸行號 `:123`
//           ③ 註解宣稱的四個錨,任何一個從目標檔消失
//    擋不住 ① 裸寫的「與 :234」這種形式(J-001 自己的 regex 也漏掉它,方向是少報)
//           ② 🔴 **把目標檔那行 code【註解掉】** —— 字面還在,五格照樣綠(codex B-2)。
//              ⇒ 這道守門管的是【引用指得到東西】,**不管行為還在不在**。行為由目標檔自己的
//                測試守(`LineAlertNotifierAdapter.test.ts` / `EmailAlertNotifierAdapter.test.ts`
//                斷言非 2xx 會 throw)。兩件事分開,不要把這裡讀成「行為有人守」。
//           ③ 反過來的誤報:反引號包住的**連接埠**(例如 `:3000`)會被第二格判成行號(codex C-2)。
//              現況全檔零命中;哪天真要寫,那一發是**大聲的紅**、不是安靜的漏 ⇒ 不為它加聰明。
//    ⇒ 這三格靠人,不靠這支測試。寫在這裡是為了讓下一個人知道分母到哪為止。
//
// ✅ 三發突變都表演過【該紅的那一發】(2026-08-21 實跑,改完 shasum 比對還原):
//    A 在 route.ts 補一行 `composition.ts:999`            ⇒ 1 failed
//    B composition.ts 的 `to: requireEnv('LINE_ALERT_TO'),` 改名 ⇒ 1 failed
//    C LineAlertNotifierAdapter 的 `if (!res.ok) {` 改寫法 ⇒ 1 failed
//    D(意外的一發)反引號裸行號那格,在我自己寫說明時就當場紅了一次。
//    🔴 而 B 的第一版【沒紅】—— 錨當時只寫 `requireEnv('LINE_ALERT_TO')`,
//       它在 composition.ts 的**註解裡**也命中 ⇒ 突變改到註解、code 沒動,守門照樣綠。
//       ⇒ 錨要落在【只有 code 會長成的形狀】上,這就是為什麼上面帶著 `to:` 前綴。
// ─────────────────────────────────────────────────────────────────────────────
const ROUTE_SOURCE = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const REPO_ROOT = new URL('../../../../../../../', import.meta.url); // → repo 根(路徑錯會 ENOENT 大聲死,不會安靜過)

/** route.ts 註解宣稱的跨檔錨:[目標檔, 那段 code 的字面]。字面同時要在 route.ts 與目標檔裡。 */
const CROSS_FILE_ANCHORS: ReadonlyArray<readonly [string, string, string]> = [
  // [目標檔, 目標檔裡那行 code 的字面, route.ts 裡指向它的【那一格獨有】的字串]
  // 🔴 第三欄是 codex B-1 逼出來的:LINE 與 Email 的 code 錨【是同一個字串】
  //    ⇒ route.ts 那半只用 code 錨的話,刪掉 Email 那句引用、留著 LINE 的,Email 那格照樣綠。
  //    ⇒ 兩格共用一個字面 = 那兩格其實只有一格。
  [
    'packages/adapters/src/payment/LineAlertNotifierAdapter.ts',
    'if (!res.ok) {',
    'LineAlertNotifierAdapter.ts',
  ],
  [
    'packages/adapters/src/payment/EmailAlertNotifierAdapter.ts',
    'if (!res.ok) {',
    'EmailAlertNotifierAdapter.ts',
  ],
  // 🔴 錨帶著 `to:` 前綴 —— 光是 `requireEnv('LINE_ALERT_TO')` 在 composition.ts 的【註解裡】也命中
  //    (實測:突變只改註解那處,守門照樣綠)⇒ 錨必須落在【只有 code 會長成的形狀】上。
  [
    'apps/storefront/src/lib/payment/composition.ts',
    "to: requireEnv('LINE_ALERT_TO'),",
    "to: requireEnv('LINE_ALERT_TO'),",
  ],
  [
    'apps/storefront/src/lib/payment/composition.ts',
    "to: requireEnv('ALERT_EMAIL_TO'),",
    "to: requireEnv('ALERT_EMAIL_TO'),",
  ],
  [
    'supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql',
    "cron.schedule('pcm-anomaly-alert', '0 1 * * *'",
    "cron.schedule('pcm-anomaly-alert', '0 1 * * *'",
  ],
];

describe('route.ts 檔頭的跨檔引用 — 錨在字面、不在行號(J-001 MF-1/MF-2)', () => {
  it('全檔零「檔案:行號」引用 —— 行號會漂,而漂掉時沒有訊號', () => {
    // 🔴 這個 pattern 換過三次,而**前兩次都是同一個錯法:我在猜副檔名的字集。**
    //    v1 `ts|tsx|json|sql|md`         ⇒ codex C-1:js / mjs / css / sh / yaml / 大寫全漏
    //    v2 `[A-Za-z][A-Za-z0-9]{0,4}`   ⇒ codex R2:`.svelte` / `.prisma` / `.graphql` 仍漏
    //    ⇒ **相同錯法第二次 = 換路,不是再猜一次。**(`00-work-rules` R4)
    //    v3 不列舉副檔名了 —— 判準改成【那個 token 裡有沒有一個點】,
    //       因為「檔名.任何副檔名」共同的形狀是**點**,而點不會過期。
    //    ⚠️ 已知誤報:帶埠號的網域(`admin.example.com:3000`)會中。現況全檔零命中;
    //       真要寫的那天它是**大聲的紅**,不是安靜的漏 ⇒ 方向是對的,不為它加聰明。
    const hits = ROUTE_SOURCE.match(/[\w./-]*\.[\w-]+:L?\d+/g) ?? [];
    expect(hits).toEqual([]);
  });

  it('全檔零反引號裸行號(`:123` / `:123-125`)—— 同一個病,換一種寫法', () => {
    // 🔴 只認【反引號包住】的形式 —— 我試過把裸寫的「與 :234」也一起抓,
    //    而那個 pattern 與時刻(`21:20`)、JSON(`"errors":0`)反覆互撞,三版都沒收斂。
    //    ⇒ 停手:裸寫那一種**明寫在上面的射程裡、交給人**,不硬做一個會誤報的量具。
    //      (誤報會把人趕出守門的視野,而那個代價比這一格漏掉更貴。)
    const hits = ROUTE_SOURCE.match(/`:L?\d+(?:-\d+)?`/g) ?? [];
    expect(hits).toEqual([]);
  });

  it.each(CROSS_FILE_ANCHORS)(
    '錨「%s / %s」在 route.ts 與目標檔裡都還在',
    (file, anchor, routeMention) => {
      // 兩邊都要:目標檔沒了 ⇒ 引用死掉;route.ts 沒了 ⇒ 這格守門失去消費者。
      expect(readFileSync(new URL(file, REPO_ROOT), 'utf8')).toContain(anchor);
      expect(ROUTE_SOURCE).toContain(routeMention);
    },
  );
});

/**
 * F-004:退款計數那支 RPC 還沒 apply 的**部署窗口**。
 *
 * 🔴 為什麼走 route 503 而不是寄信(codex 關卡1 R2):
 *    進 `shouldAlert` ⇒ DB 一直沒 apply 就**每天寄一封「尚未啟用」給老闆** ⇒ 久了變例行雜訊
 *    ⇒ 那是**把沉默換成無限重寄**,同一個病的另一面。
 *    ⇒ 「DB 函式沒 apply」是**部署問題**,該吵的對象是看 cron 的人。
 *
 * ⚠️ 而 503 **不代表信沒寄** —— 上面那封信(若本來就要寄)照常送出,只是多帶一行「今天查不到」。
 *    兩件事不要讀成同一件。
 */
describe('GET anomaly-alert — F-004 退款 RPC 尚未 apply', () => {
  it('🔴 orderRefundsStuckUnknown=true → 503(不是 200,也不是靠寄信告訴老闆)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockResolvedValue({
      ...CLEAN_RESULT,
      orderRefundsStuckCount: null,
      orderRefundsStuckOvernightCount: null,
      orderRefundsStuckUnknown: true,
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, orderRefundsStuckUnknown: true });
    // 訊息要講得出是哪一支函式 —— 值班的人照著這行去查。
    expect(errSpy.mock.calls.flat().join(' ')).toContain('get_order_refunds_stuck_summary');
    errSpy.mockRestore();
  });

  it('🔴 對照:unknown=false 且其餘乾淨 → 200(證明上一格是這個欄位造成的,不是別的)', async () => {
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, orderRefundsStuckUnknown: false });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('🔴 計數 0 與 unknown 是兩個世界:0 筆照樣 200', async () => {
    checkSpy.mockResolvedValue({
      ...CLEAN_RESULT,
      orderRefundsStuckCount: 0,
      orderRefundsStuckOvernightCount: 0,
      orderRefundsStuckUnknown: false,
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });
});
