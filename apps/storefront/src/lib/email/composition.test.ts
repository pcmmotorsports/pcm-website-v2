// @vitest-environment node
// composition.test.ts — getSweepEmailOutboxDeps 真 factory 測試(M-4a Email 片 E2a-c)
//
// codex 關卡2 must-fix:route.test 完全 mock 掉本 composition → 證不了 composition 退化(移 server-only /
// env 搬 module-top / 接錯 adapter / 加告警管道,route 的 lazy 與零告警測試仍會綠,因為只檢查測試自造的 DEPS)。
// 本檔載入**真** factory、只 mock adapter 建構子 + createSupabaseServiceClient + LINE 域名,驗:
//   ① lazy:import 本模組零建構、零 env 讀取(env 未設仍載入成功)
//   ② 呼叫後正確建兩 adapter(client cast 注入、假信箱【判斷式】單源、Resend apiKey/from)
//   ③ 回傳鍵精確 = {outbox, sender}(🔴 零告警管道:Q13=A)
//   ④ 缺 env(RESEND_API_KEY / ORDER_EMAIL_FROM)→ requireEnv throw(route 接 → 503 fail-closed)

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** composition.ts 原始碼(source-contract 斷言用)。 */
const COMPOSITION_SOURCE = readFileSync(new URL('./composition.ts', import.meta.url), 'utf8');

/**
 * 切出**一支 factory 的函式本體**(從 `export function <名稱>` 到第一行單獨的 `}`)。
 *
 * 🔴 **原本這兩格是 `.slice(indexOf(...))` —— 一路切到【檔尾】。**
 *    ⇒ 它的名字說「本 factory 一顆 env 都不讀」,而它實際問的是
 *      「**這支 factory 以下的所有東西**都沒有出現 requireEnv / process.env」。
 *    ⇒ 2026-08-30 片3b 在下面新增一支 factory,它的**註解**解釋了為什麼不共用那支會
 *      `requireEnv` 的 deps ⇒ **那個字出現在註解裡,這一格就紅了。**
 *    📌 **⇒ 一個切到檔尾的 source-contract,量的是它後面每一個人的行為。**
 *      而它今天是**假紅**;明天同樣的形狀會是**假綠**(有人把讀 env 的碼放在被切範圍外)。
 * ⚠️ 射程:靠「第一行單獨的 `}`」斷句 ⇒ 只適用本檔這種**平坦的 factory**(無巢狀區塊在頂層)。
 */
function factoryBody(name: string): string {
  const start = COMPOSITION_SOURCE.indexOf(`export function ${name}`);
  expect(start, `找不到 factory:${name}`).toBeGreaterThan(-1);
  const rest = COMPOSITION_SOURCE.slice(start);
  const end = rest.indexOf('\n}\n');
  expect(end, `切不出 ${name} 的函式尾`).toBeGreaterThan(-1);
  return rest.slice(0, end + 2);
}

// 🔴 vi.mock 工廠會被 hoist 到檔頂 → 其引用的常數必須走 vi.hoisted(否則 ReferenceError:早於初始化)。
const {
  outboxCtor,
  senderCtor,
  scannerCtor,
  ineligibleScannerCtor,
  shippedContextCtor,
  shippedScannerCtor,
  paidContextCtor,
  serviceClientSpy,
  SERVICE_CLIENT,
} =
  vi.hoisted(() => ({
    outboxCtor: vi.fn(),
    senderCtor: vi.fn(),
    scannerCtor: vi.fn(), // 🔴 B-5:掃描式 enqueue 的 adapter
    ineligibleScannerCtor: vi.fn(), // 🔴 E2a-2(W3-G):寄送前 ineligible gate 的 adapter
    shippedContextCtor: vi.fn(), // 🔴 E4-b(2026-08-22):出貨信的寄送時讀取 adapter
    shippedScannerCtor: vi.fn(), // 🔴 片3b(2026-08-30):出貨線掃描式 enqueue 的 adapter
    paidContextCtor: vi.fn(), // 🔴 2026-09-01:付款信 HTML 的寄送時讀取 adapter(Sean 拍甲)
    serviceClientSpy: vi.fn(),
    SERVICE_CLIENT: { __serviceClient: true },
  }));

vi.mock('@pcm/adapters/server', () => ({
  SupabaseEmailOutboxAdapter: outboxCtor,
  ResendEmailSenderAdapter: senderCtor,
  SupabasePaidOrderScannerAdapter: scannerCtor,
  SupabaseIneligibleOrderEmailScannerAdapter: ineligibleScannerCtor,
  SupabaseShippedEmailContextAdapter: shippedContextCtor,
  SupabaseShippedOrderScannerAdapter: shippedScannerCtor,
  SupabasePaidEmailContextAdapter: paidContextCtor,
  createSupabaseServiceClient: serviceClientSpy,
}));

import { isSyntheticEmailDomain } from '@pcm/schemas';
import {
  getApplyOrderIneligibleGateDeps,
  getEnqueueOrderCreatedDeps,
  getEnqueueOrderShippedDeps,
  getSweepEmailOutboxDeps,
} from './composition';

beforeEach(() => {
  outboxCtor.mockReset();
  senderCtor.mockReset();
  scannerCtor.mockReset();
  ineligibleScannerCtor.mockReset();
  // 🔴 這一行是刻意加的:`shippedContextCtor` 沒有被 reset(只靠 afterEach 的 clearAllMocks),
  //    而 `toHaveBeenCalledTimes(1)` 這種斷言在「上一格漏清」時會安靜地變成累加。
  paidContextCtor.mockReset();
  serviceClientSpy.mockReset().mockReturnValue(SERVICE_CLIENT);
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.ORDER_EMAIL_FROM = 'orders@test.example';
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.ORDER_EMAIL_FROM;
  vi.clearAllMocks();
});

describe('composition — 🔴 source-contract(server-only)', () => {
  // codex 關卡2 R2 must-fix:vi.mock('server-only') 只提供空模組、**不要求** composition.ts 真的 import 它 →
  // 刪掉 composition.ts 的 `import 'server-only'`,行為測試仍全綠 = 假綠。故直接讀原始碼斷言頂層 import 存在
  // (server-only = service_role/Resend key 絕不進 client bundle 的編譯期防線,不可被無聲移除)。
  it("composition.ts 頂層必有 `import 'server-only'`(擋「移除 server-only」突變)", () => {
    expect(COMPOSITION_SOURCE).toMatch(/^import 'server-only';/m);
  });
});

describe('getSweepEmailOutboxDeps — lazy(module-top 零副作用)', () => {
  it('🔴 import + resetModules 重載本模組:零建構、零 env 讀取(env 未設仍載入成功、不 throw)', async () => {
    vi.resetModules();
    outboxCtor.mockClear();
    senderCtor.mockClear();
    serviceClientSpy.mockClear();
    delete process.env.RESEND_API_KEY;
    delete process.env.ORDER_EMAIL_FROM;
    // 重載模組:module-top 僅 import + function def、零呼叫 → 建構子/serviceClient 皆不觸發、requireEnv 不跑。
    await expect(import('./composition')).resolves.toBeDefined();
    expect(serviceClientSpy).not.toHaveBeenCalled();
    expect(outboxCtor).not.toHaveBeenCalled();
    expect(senderCtor).not.toHaveBeenCalled();
  });
});

describe('getSweepEmailOutboxDeps — 呼叫後建 deps', () => {
  it('🔴 回傳鍵精確 = {outbox, sender, shippedContext, ineligibleScanner}(零告警管道、Q13=A)', () => {
    // 🔴 **2026-08-22(E4-b)這一格的期望值改過,而改動本身要被讀到**:
    //    ~~`['outbox', 'sender']`~~ ⇒ 多了 `shippedContext`(出貨信的寄送時讀取)。
    //
    // ⚠️ **而這一格守的東西沒有變**:它守的是「**告警管道不得被注進 sweeper**」
    //    (Sean `Q13`=A 零告警:sweeper 死時它自己發的告警會一起死 = 沒有監看)。
    //    `shippedContext` 是**讀取**不是**發送**,不觸犯那條;
    //    而下面兩行對 `notifiers` / `alertNotifier` 的斷言**一個字都沒動** —— 那才是這格的本體。
    // 🔴 判別句:改期望值之前先問「這格原本在擋什麼」。擋的東西沒變 ⇒ 可以改;變了 ⇒ 不可以。
    //
    // 🔴 **2026-08-30(Sean 拍「Q2 取消信縫 = 甲 搬」)第二次改期望值,照上面那句判過再改**:
    //    ~~`['outbox', 'sender', 'shippedContext']`~~ ⇒ 多了 `ineligibleScanner`。
    //    ⚠️ 判別:它是**讀取**(查那張單現在合不合格),**不是發送管道**
    //    ⇒ 這格原本擋的東西(告警管道被注進 sweeper)**一個字都沒變**,
    //      下面兩行對 `notifiers` / `alertNotifier` 的斷言照舊 —— 那才是本體。
    //
    // 🔴 **2026-09-01(Sean 拍甲「付款信接上 HTML 版本」)第三次改期望值,照上面那句判過再改**:
    //    ~~`['ineligibleScanner', 'outbox', 'sender', 'shippedContext']`~~ ⇒ 多了 `paidContext`。
    //    ⚠️ 判別:它是**讀取**(查那張單的金額與品項),**不是發送管道**
    //    ⇒ 這格原本擋的東西(告警管道被注進 sweeper)一個字都沒變。
    //    🔴 **而它與前兩次【有一個地方不同,寫下來免得被同一個直覺讀過去】**:
    //      前兩次接上去不會改變任何一封信;**這一次接上去,下一輪 cron 的真客人就收到 HTML 信**
    //      (`sweep-email-outbox.ts` 那個 `const html = paid !== null` 的呼叫點早就在,
    //       缺的一直是這個 dep;**座標用 grep 不用行號** —— 落檔那一小時它就從 `:870` 漂到 `:913`)。
    const deps = getSweepEmailOutboxDeps() as Record<string, unknown>;
    expect(Object.keys(deps).sort()).toEqual([
      'ineligibleScanner',
      'outbox',
      'paidContext',
      'sender',
      'shippedContext',
    ]);
    expect(deps.notifiers).toBeUndefined();
    expect(deps.alertNotifier).toBeUndefined();
  });

  /**
   * 🔴 codex 2026-08-30 must-fix:**只補鍵名不夠**。
   *    `Object.keys` 那一格只證得了「有這一把鑰匙」,證不了「它接到對的孔」——
   *    接成錯的 client、或接成一個恆回空的 fail-open scanner,那一格照樣綠。
   *    ⇒ 而這道閘的全部價值就在「它真的查得到那張單」上 ⇒ 這一格必須存在。
   */
  it('🔴 ineligibleScanner = SupabaseIneligibleOrderEmailScannerAdapter,注入【同一個】 service_role client', () => {
    getSweepEmailOutboxDeps();
    expect(ineligibleScannerCtor).toHaveBeenCalledTimes(1);
    expect(ineligibleScannerCtor).toHaveBeenCalledWith(SERVICE_CLIENT);
    // 🔴 而「同一個」是承重的:本 factory 有一格既有測試釘住 createSupabaseServiceClient
    //    在這裡【只被呼叫一次】(不偷偷多開一條連線)⇒ 這一行與那一格互相支撐。
    expect(serviceClientSpy).toHaveBeenCalledTimes(1);
  });

  it('🔴 shippedContext = SupabaseShippedEmailContextAdapter,注入 service_role client', () => {
    getSweepEmailOutboxDeps();
    expect(shippedContextCtor).toHaveBeenCalledTimes(1);
    expect(shippedContextCtor.mock.calls[0]![0]).toBe(SERVICE_CLIENT);
  });

  /**
   * 🔴 同 codex 2026-08-30 那條 must-fix 的理由:`Object.keys` 那一格只證得了「有這把鑰匙」。
   *    而這一把的爆炸半徑比前兩把大 —— 接錯 client ⇒ 讀不到 ⇒ `unavailable` ⇒ **fail-closed 不寄**
   *    ⇒ 📌 **客人不是收到壞掉的信,是【一封都收不到】,而畫面上只有 `errors++`。**
   */
  it('🔴 paidContext = SupabasePaidEmailContextAdapter,注入【同一個】 service_role client', () => {
    getSweepEmailOutboxDeps();
    expect(paidContextCtor).toHaveBeenCalledTimes(1);
    expect(paidContextCtor.mock.calls[0]![0]).toBe(SERVICE_CLIENT);
    // 🔴 「同一個」承重:本 factory 那格「createSupabaseServiceClient 只被呼叫一次」與這行互相支撐。
    expect(serviceClientSpy).toHaveBeenCalledTimes(1);
  });

  it('outbox = SupabaseEmailOutboxAdapter(service_role client cast, {假信箱判斷式 單源})', () => {
    getSweepEmailOutboxDeps();
    expect(serviceClientSpy).toHaveBeenCalledTimes(1);
    expect(outboxCtor).toHaveBeenCalledTimes(1);
    const [clientArg, cfgArg] = outboxCtor.mock.calls[0]!;
    expect(clientArg).toBe(SERVICE_CLIENT); // createSupabaseServiceClient() 的回傳注入(cast 只在編譯期)
    // 🔴 `#858` 片0-a:注入的**必須是 `@pcm/schemas` 那一份函式本人**(用 `toBe` 比參考,不是比長得像)。
    //    這一格就是「三處共用同一份規則」的機械證明 —— 有人把它換成本地實作,這裡當場紅。
    expect(cfgArg).toEqual({ isSyntheticEmail: isSyntheticEmailDomain });
    expect((cfgArg as { isSyntheticEmail: unknown }).isSyntheticEmail).toBe(isSyntheticEmailDomain);
  });

  it('sender = ResendEmailSenderAdapter({apiKey: RESEND_API_KEY, from: ORDER_EMAIL_FROM})', () => {
    getSweepEmailOutboxDeps();
    expect(senderCtor).toHaveBeenCalledTimes(1);
    expect(senderCtor.mock.calls[0]![0]).toEqual({
      apiKey: 'test-resend-key',
      from: 'orders@test.example',
    });
  });
});

describe('getSweepEmailOutboxDeps — 缺 env fail-closed(route 接 → 503)', () => {
  it('缺 RESEND_API_KEY → throw(缺少必要環境變數)', () => {
    delete process.env.RESEND_API_KEY;
    expect(() => getSweepEmailOutboxDeps()).toThrow(/RESEND_API_KEY/);
  });

  it('缺 ORDER_EMAIL_FROM → throw(缺少必要環境變數)', () => {
    delete process.env.ORDER_EMAIL_FROM;
    expect(() => getSweepEmailOutboxDeps()).toThrow(/ORDER_EMAIL_FROM/);
  });
});

// ── 🔴 M-4a B-5 plan §3.1:enqueue 的 deps **刻意不共用** sweeper 的 ──
describe('getEnqueueOrderCreatedDeps — 不吃 Resend env(這是它存在的全部理由)', () => {
  it('🔴🔴 #8 `RESEND_API_KEY` / `ORDER_EMAIL_FROM` 都不存在 ⇒ **仍然建得出 deps、不 throw**', () => {
    // 病的形狀:若 enqueue 共用 getSweepEmailOutboxDeps(),那支會 requireEnv 兩顆 Resend env、
    // 缺就 throw ⇒ route 503 ⇒ **Resend 還沒設好的那段期間,連「把信排進 outbox」都不會發生**。
    // 而那正是今天的狀態(那兩顆 env 在正式站的現值 repo 側量不到)。
    delete process.env.RESEND_API_KEY;
    delete process.env.ORDER_EMAIL_FROM;

    const deps = getEnqueueOrderCreatedDeps();

    expect(Object.keys(deps).sort()).toEqual(['outbox', 'scanner']); // 🔴 沒有 sender
    expect(senderCtor).not.toHaveBeenCalled();
    expect(outboxCtor).toHaveBeenCalledWith(SERVICE_CLIENT, { isSyntheticEmail: isSyntheticEmailDomain });
    expect(scannerCtor).toHaveBeenCalledWith(SERVICE_CLIENT);
  });

  it('對照組:同樣缺 env 時 `getSweepEmailOutboxDeps()` **會** throw(證上面那格不是恆真)', () => {
    // 🔴 沒有這一格,上面那格在「requireEnv 整個壞掉」的世界裡也會綠。
    delete process.env.RESEND_API_KEY;
    delete process.env.ORDER_EMAIL_FROM;
    expect(() => getSweepEmailOutboxDeps()).toThrow(/RESEND_API_KEY/);
  });

  it('🔴 lazy 契約:本 factory 一顆 env 都不讀(source-contract)', () => {
    const fn = factoryBody('getEnqueueOrderCreatedDeps');
    expect(fn).not.toContain('requireEnv');
    expect(fn).not.toContain('process.env');
  });
});

// ── 🔴 M-4a E2a-2(W3-G 拆出):gate 的 deps 也刻意不共用 sweeper 的 ──
describe('getApplyOrderIneligibleGateDeps — 不吃 Resend env(同 enqueue 的理由:本片不寄信)', () => {
  it('🔴 `RESEND_API_KEY` / `ORDER_EMAIL_FROM` 都不存在 ⇒ 仍然建得出 deps、不 throw', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.ORDER_EMAIL_FROM;

    const deps = getApplyOrderIneligibleGateDeps();

    expect(Object.keys(deps).sort()).toEqual(['outbox', 'scanner']); // 🔴 沒有 sender
    expect(senderCtor).not.toHaveBeenCalled();
    expect(outboxCtor).toHaveBeenCalledWith(SERVICE_CLIENT, { isSyntheticEmail: isSyntheticEmailDomain });
    expect(ineligibleScannerCtor).toHaveBeenCalledWith(SERVICE_CLIENT);
  });

  it('🔴 lazy 契約:本 factory 一顆 env 都不讀(source-contract)', () => {
    const fn = factoryBody('getApplyOrderIneligibleGateDeps');
    expect(fn).not.toContain('requireEnv');
    expect(fn).not.toContain('process.env');
  });
});

// ── 🔴 M-4b E4 片3b:出貨線 enqueue 的 deps 也刻意不共用 sweeper 的 ──
describe('getEnqueueOrderShippedDeps — 不吃 Resend env(而在出貨線上這件事更貴)', () => {
  it('🔴 `RESEND_API_KEY` / `ORDER_EMAIL_FROM` 都不存在 ⇒ 仍然建得出 deps、不 throw', () => {
    // 🔴 **為什麼這一格特別重要**:共用的話,Resend 沒設好的期間連「把出貨信排進 outbox」
    //    都不會發生,而那些箱子的 `shipped_at` 會落在 cutoff 之後、**永遠不會再被掃到一次**
    //    (掃描是 anti-join「還沒排過的」,不是「還沒寄成功的」)⇒ 那幾封信永久消失、零訊號。
    delete process.env.RESEND_API_KEY;
    delete process.env.ORDER_EMAIL_FROM;

    const deps = getEnqueueOrderShippedDeps();

    expect(Object.keys(deps).sort()).toEqual(['outbox', 'scanner']); // 🔴 沒有 sender
    expect(senderCtor).not.toHaveBeenCalled();
    expect(outboxCtor).toHaveBeenCalledWith(SERVICE_CLIENT, { isSyntheticEmail: isSyntheticEmailDomain });
    expect(shippedScannerCtor).toHaveBeenCalledWith(SERVICE_CLIENT);
  });

  it('🔴 用的是【出貨】那支 scanner,不是訂單成立那支(兩支長得一樣、掃的表不一樣)', () => {
    getEnqueueOrderShippedDeps();
    expect(shippedScannerCtor).toHaveBeenCalledTimes(1);
    expect(scannerCtor).not.toHaveBeenCalled();
  });

  it('🔴 lazy 契約:本 factory 一顆 env 都不讀(source-contract)', () => {
    const fn = factoryBody('getEnqueueOrderShippedDeps');
    expect(fn).not.toContain('requireEnv');
    expect(fn).not.toContain('process.env');
  });
});
