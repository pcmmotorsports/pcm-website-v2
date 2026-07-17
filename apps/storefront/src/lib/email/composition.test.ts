// @vitest-environment node
// composition.test.ts — getSweepEmailOutboxDeps 真 factory 測試(M-4a Email 片 E2a-c)
//
// codex 關卡2 must-fix:route.test 完全 mock 掉本 composition → 證不了 composition 退化(移 server-only /
// env 搬 module-top / 接錯 adapter / 加告警管道,route 的 lazy 與零告警測試仍會綠,因為只檢查測試自造的 DEPS)。
// 本檔載入**真** factory、只 mock adapter 建構子 + createSupabaseServiceClient + LINE 域名,驗:
//   ① lazy:import 本模組零建構、零 env 讀取(env 未設仍載入成功)
//   ② 呼叫後正確建兩 adapter(client cast 注入、syntheticEmailDomain 單源、Resend apiKey/from)
//   ③ 回傳鍵精確 = {outbox, sender}(🔴 零告警管道:Q13=A)
//   ④ 缺 env(RESEND_API_KEY / ORDER_EMAIL_FROM)→ requireEnv throw(route 接 → 503 fail-closed)

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** composition.ts 原始碼(source-contract 斷言用)。 */
const COMPOSITION_SOURCE = readFileSync(new URL('./composition.ts', import.meta.url), 'utf8');

// 🔴 vi.mock 工廠會被 hoist 到檔頂 → 其引用的常數必須走 vi.hoisted(否則 ReferenceError:早於初始化)。
const { outboxCtor, senderCtor, serviceClientSpy, SERVICE_CLIENT, SYNTHETIC_DOMAIN } = vi.hoisted(
  () => ({
    outboxCtor: vi.fn(),
    senderCtor: vi.fn(),
    serviceClientSpy: vi.fn(),
    SERVICE_CLIENT: { __serviceClient: true },
    SYNTHETIC_DOMAIN: 'line.pcmmotorsports.local',
  }),
);

vi.mock('@pcm/adapters/server', () => ({
  SupabaseEmailOutboxAdapter: outboxCtor,
  ResendEmailSenderAdapter: senderCtor,
  createSupabaseServiceClient: serviceClientSpy,
}));
vi.mock('@/lib/auth/line', () => ({ LINE_SYNTHETIC_EMAIL_DOMAIN: SYNTHETIC_DOMAIN }));

import { getSweepEmailOutboxDeps } from './composition';

beforeEach(() => {
  outboxCtor.mockReset();
  senderCtor.mockReset();
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
  it('🔴 回傳鍵精確 = {outbox, sender}(零告警管道、Q13=A)', () => {
    const deps = getSweepEmailOutboxDeps() as Record<string, unknown>;
    expect(Object.keys(deps).sort()).toEqual(['outbox', 'sender']);
    expect(deps.notifiers).toBeUndefined();
    expect(deps.alertNotifier).toBeUndefined();
  });

  it('outbox = SupabaseEmailOutboxAdapter(service_role client cast, {syntheticEmailDomain 單源})', () => {
    getSweepEmailOutboxDeps();
    expect(serviceClientSpy).toHaveBeenCalledTimes(1);
    expect(outboxCtor).toHaveBeenCalledTimes(1);
    const [clientArg, cfgArg] = outboxCtor.mock.calls[0]!;
    expect(clientArg).toBe(SERVICE_CLIENT); // createSupabaseServiceClient() 的回傳注入(cast 只在編譯期)
    expect(cfgArg).toEqual({ syntheticEmailDomain: SYNTHETIC_DOMAIN }); // 單一字面來源 LINE_SYNTHETIC_EMAIL_DOMAIN
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
