import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// TapPayChargeAdapter 換成建構子探針(真的 new 一個 adapter 不需要、也會把 config 藏進私有欄位);
// tapPayUrlsFor 保持真貨 —— 端點值必須是 @pcm/adapters 那一份,不是測試自帶的字面。
// ⚠️ 精確一點:取的是 `packages/adapters/src/tappay/endpoints` **檔本體**,不是 `@pcm/adapters/server`
//    這個對外面(server.ts 目前是純 re-export、兩者等值;真要釘「barrel 有轉出去」靠上面那條
//    wiring test 的 import-來源 regex)。
const mocks = vi.hoisted(() => ({ ctor: vi.fn() }));
// 🔴 不能 importActual('@pcm/adapters/server'):importActual 會繞過上面那支 server-only mock、
//    直接載到真的 server-only 而 throw。改直接取 endpoints 模組本體(它不 import server-only)。
vi.mock('@pcm/adapters/server', async () => {
  const endpoints = (await vi.importActual(
    '../../../../../packages/adapters/src/tappay/endpoints',
  )) as { tapPayUrlsFor: unknown };
  return {
    tapPayUrlsFor: endpoints.tapPayUrlsFor,
    TapPayChargeAdapter: class {
      constructor(config: unknown) {
        mocks.ctor(config);
      }
    },
  };
});

import { tapPayUrlsFor } from '@pcm/adapters/server';
import { PROD_SUPABASE_HOST, getTapPayAdapter, tapPayEnvPairingViolation } from './composition';

// M-3 RW2b:admin 付款 composition。
// 🔴 誠實邊界:本檔全是行為單元測試 —— 證的是「配對斷言真的擋得住 / 三端點真的來自
//    tapPayUrlsFor」,不是「Vercel 上的 env 設對了」(那是 RW2d 前 Sean 開 dashboard 查證)。

const PROD_URL = `https://${PROD_SUPABASE_HOST}`;
const LOCAL_URL = 'http://127.0.0.1:54321';
const OTHER_PROJECT_URL = 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co';

const ENV_KEYS = [
  'TAPPAY_ENV',
  'TAPPAY_PARTNER_KEY',
  'TAPPAY_MERCHANT_ID',
  'NEXT_PUBLIC_SUPABASE_URL',
] as const;

let saved: Record<string, string | undefined>;

function setEnv(patch: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv({
    TAPPAY_ENV: 'sandbox',
    TAPPAY_PARTNER_KEY: 'partner_TESTKEY',
    TAPPAY_MERCHANT_ID: 'PCM_TEST_MERCHANT',
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
  });
});

afterEach(() => {
  setEnv(saved);
  vi.clearAllMocks();
});

describe('PROD_SUPABASE_HOST — 常數本身', () => {
  it('🔴 逐字釘死,且與 repo 內既有來源對得上(不是用被測常數自己生 fixture)', () => {
    // 🔴 關卡2 codex C4:下面整張配對矩陣的 fixture 都由 PROD_SUPABASE_HOST 生成 ⇒ 把它改成
    //    任意第三個值,矩陣照樣全綠(它比的是「和自己一致」)。故此格獨立釘字面 + 對第二來源。
    expect(PROD_SUPABASE_HOST).toBe('bmpnplmnldofgaohnaok.supabase.co');
    const typesHeader = readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'packages/adapters/src/supabase/database.types.ts'),
      'utf8',
    ).slice(0, 4000);
    expect(typesHeader).toContain('bmpnplmnldofgaohnaok');
  });
});

describe('tapPayEnvPairingViolation — 配對矩陣(純函式)', () => {
  it('同側 = 放行(production×正式帳本 / sandbox×本機帳本)', () => {
    expect(tapPayEnvPairingViolation('production', PROD_URL)).toBeNull();
    expect(tapPayEnvPairingViolation('sandbox', LOCAL_URL)).toBeNull();
  });

  it('🔴 production TapPay × 非正式帳本 = 拒絕(真錢動了、正式站零紀錄)', () => {
    expect(tapPayEnvPairingViolation('production', LOCAL_URL)).toMatch(/TAPPAY_ENV=production/);
    expect(tapPayEnvPairingViolation('production', OTHER_PROJECT_URL)).toMatch(
      /TAPPAY_ENV=production/,
    );
  });

  it('🔴 sandbox TapPay × 正式帳本 = 拒絕(正式訂單被寫進帳本、客人的錢一毛沒退)', () => {
    expect(tapPayEnvPairingViolation('sandbox', PROD_URL)).toMatch(/正式站/);
  });

  it('🔴 URL 解析不出來 = 拒絕(判不出哪一側就不准放行,不是「看不出來就當 sandbox」)', () => {
    expect(tapPayEnvPairingViolation('production', 'not-a-url')).toMatch(/不是合法 URL/);
    expect(tapPayEnvPairingViolation('sandbox', 'not-a-url')).toMatch(/不是合法 URL/);
    expect(tapPayEnvPairingViolation('sandbox', '')).toMatch(/不是合法 URL/);
  });

  it('🔴 port / 路徑 / 大小寫 / FQDN 尾點都不能讓正式站躲過判定', () => {
    expect(tapPayEnvPairingViolation('sandbox', `${PROD_URL}/`)).toMatch(/正式站/);
    expect(tapPayEnvPairingViolation('sandbox', `${PROD_URL}:6543`)).toMatch(/正式站/);
    expect(tapPayEnvPairingViolation('sandbox', `https://${PROD_SUPABASE_HOST.toUpperCase()}`)).toMatch(
      /正式站/,
    );
    // 🔴 `...supabase.co.` 是合法且連得通的 FQDN;差一個字元就繞過整道守門(R1 MF4)。
    expect(tapPayEnvPairingViolation('sandbox', `https://${PROD_SUPABASE_HOST}./`)).toMatch(/正式站/);
    expect(tapPayEnvPairingViolation('production', `https://${PROD_SUPABASE_HOST}.`)).toBeNull();
  });

  it('🔴 解析得過但判不出 host 的 URL 一律拒絕(關卡2 codex C3)', () => {
    // `new URL()` 不 throw ≠ 判得出哪一側:`file:` 的 hostname 是空字串(不擋就當非正式站放行)、
    // `ftp://<正式 host>` 則會挾著正式 host 被當成正式站。兩者都由協定 allowlist 一條擋掉。
    expect(tapPayEnvPairingViolation('sandbox', 'file:///tmp/x')).toMatch(/協定/);
    expect(tapPayEnvPairingViolation('production', 'file:///tmp/x')).toMatch(/協定/);
    expect(tapPayEnvPairingViolation('production', `ftp://${PROD_SUPABASE_HOST}`)).toMatch(/協定/);
    expect(tapPayEnvPairingViolation('sandbox', `ftp://${PROD_SUPABASE_HOST}`)).toMatch(/協定/);
  });

  it('🔴 http://. 這種「剝完尾點就沒 host」的 URL 也要拒(關卡2 codex R2-1)', () => {
    // 協定 allowlist 只蘊含「原始 hostname 非空」;`http://.` 過得了協定那關、hostname='.'、
    // 剝完尾點變空字串 ⇒ 不加這道就會被判成「非正式站」而讓 sandbox 側整個放行。
    expect(tapPayEnvPairingViolation('sandbox', 'http://.')).toMatch(/沒有可判定的 host/);
    expect(tapPayEnvPairingViolation('production', 'https://../x')).toMatch(/沒有可判定的 host/);
  });
});

describe('getTapPayAdapter — 端點來源', () => {
  it('sandbox:三端點逐欄等於 tapPayUrlsFor("sandbox")(值的單一來源在 @pcm/adapters)', () => {
    getTapPayAdapter();
    expect(mocks.ctor).toHaveBeenCalledTimes(1);
    expect(mocks.ctor).toHaveBeenCalledWith({
      partnerKey: 'partner_TESTKEY',
      merchantId: 'PCM_TEST_MERCHANT',
      ...tapPayUrlsFor('sandbox'),
    });
  });

  it('production:三端點逐欄等於 tapPayUrlsFor("production")', () => {
    setEnv({ TAPPAY_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PROD_URL });
    getTapPayAdapter();
    expect(mocks.ctor).toHaveBeenCalledWith({
      partnerKey: 'partner_TESTKEY',
      merchantId: 'PCM_TEST_MERCHANT',
      ...tapPayUrlsFor('production'),
    });
  });
});

describe('getTapPayAdapter — fail-closed', () => {
  // 🔴 每一格都斷言「adapter 沒被建出來」:能動錢的物件不存在,比「有人記得先驗」強。
  const cases: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ['production × 本機帳本', { TAPPAY_ENV: 'production' }, /配對不成立/],
    [
      'sandbox × 正式帳本',
      { NEXT_PUBLIC_SUPABASE_URL: PROD_URL },
      /配對不成立/,
    ],
    ['TAPPAY_ENV 錯字(prod)', { TAPPAY_ENV: 'prod' }, /須為/],
    ['TAPPAY_ENV 缺', { TAPPAY_ENV: undefined }, /TAPPAY_ENV/],
    ['NEXT_PUBLIC_SUPABASE_URL 缺', { NEXT_PUBLIC_SUPABASE_URL: undefined }, /NEXT_PUBLIC_SUPABASE_URL/],
    ['NEXT_PUBLIC_SUPABASE_URL 非法', { NEXT_PUBLIC_SUPABASE_URL: 'nope' }, /配對不成立/],
    ['TAPPAY_PARTNER_KEY 缺', { TAPPAY_PARTNER_KEY: undefined }, /TAPPAY_PARTNER_KEY/],
    ['TAPPAY_MERCHANT_ID 缺', { TAPPAY_MERCHANT_ID: undefined }, /TAPPAY_MERCHANT_ID/],
  ];

  for (const [name, patch, message] of cases) {
    it(`🔴 ${name} → throw 且 adapter 未被建構`, () => {
      setEnv(patch);
      expect(() => getTapPayAdapter()).toThrow(message);
      expect(mocks.ctor).not.toHaveBeenCalled();
    });
  }

  it('空字串 env 視同缺(TapPay 拿空 partner key 只會在 API 那端才炸)', () => {
    setEnv({ TAPPAY_PARTNER_KEY: '' });
    expect(() => getTapPayAdapter()).toThrow(/TAPPAY_PARTNER_KEY/);
    expect(mocks.ctor).not.toHaveBeenCalled();
  });
});
