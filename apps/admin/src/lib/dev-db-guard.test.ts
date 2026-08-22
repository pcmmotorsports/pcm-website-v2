import { afterEach, describe, expect, it } from 'vitest';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import nextConfig from '../../next.config';
import {
  DB_KEY_PATTERN,
  PCM_PROD_PROJECT_REF,
  PROD_DB_BYPASS_ENV,
  checkProdDbInDev,
  describeProdDbInDev,
} from './dev-db-guard';

// 🔴 **這支測試的存在理由 = 那道閘要能【該紅的紅、該綠的綠】。**
//    只驗「指向正式庫會擋」= 只證明它會擋,沒證明它不是【恆擋】——
//    一個恆擋的閘會讓所有人在所有工作樹上都跑不起來,而它在稽核裡長得跟「有效」一樣。

// 🔴 **這個字面刻意【重打一次】,不從 PCM_PROD_PROJECT_REF 組**(codex R1 must-fix-5):
//    原本寫 `https://${PCM_PROD_PROJECT_REF}.supabase.co` ⇒ 常數被改壞時測資跟著壞成同一個錯值
//    ⇒ **10 案照樣全綠,而正式庫判定已經安靜失效。** 兩份獨立字面才擋得住。
const PROD_REF_LITERAL = 'bmpnplmnldofgaohnaok';
const PROD_URL = 'https://bmpnplmnldofgaohnaok.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';

describe('PCM_PROD_PROJECT_REF', () => {
  it('常數本身要等於那個字面(改壞常數 ⇒ 這一案紅)', () => {
    expect(PCM_PROD_PROJECT_REF).toBe(PROD_REF_LITERAL);
  });
});

describe('checkProdDbInDev', () => {
  it('該紅:值含正式庫 ref ⇒ blocked,理由 prod-ref', () => {
    const v = checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL });
    expect(v).toEqual({
      kind: 'blocked',
      bypassRefused: false,
      matches: [{ key: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'prod-ref' }],
    });
  });

  // 🔴 R1 must-fix-1:只比對 ref 是 fail-open —— 正式庫換自訂網域就靜靜放行。
  it('該紅:DB 類變數指向【非本機】主機(不含 ref)⇒ 仍然 blocked,理由 remote-db', () => {
    const v = checkProdDbInDev({ SUPABASE_URL: 'https://db.pcmmotorsports.com' });
    expect(v).toEqual({
      kind: 'blocked',
      bypassRefused: false,
      matches: [{ key: 'SUPABASE_URL', reason: 'remote-db' }],
    });
  });

  it('🔴 該綠:指向拋棄式 PG ⇒ ok(證明它不是恆擋)', () => {
    expect(checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL })).toEqual({ kind: 'ok' });
  });

  it('🔴 該綠:非 DB 類的遠端網址不算(否則正常 dev 會被莫名其妙擋住)', () => {
    expect(checkProdDbInDev({ NEXT_PUBLIC_SITE_URL: 'https://shop.pcmmotorsports.com' })).toEqual({
      kind: 'ok',
    });
  });

  // 🔴 R2 nit:原版 hostOf 對方括號 IPv6 與無 scheme 的 libpq DSN 回 null = fail-open;
  //    LOCAL_HOSTS 的 '::1' 曾是永遠到不了的死項。下面四案是那個洞的正反對照。
  it('該紅:URL 裡的方括號 IPv6 遠端 ⇒ blocked(原版對它 fail-open)', () => {
    const v = checkProdDbInDev({ DATABASE_URL: 'postgresql://user@[2001:db8::1]:5432/x' });
    expect(v).toEqual({
      kind: 'blocked',
      bypassRefused: false,
      matches: [{ key: 'DATABASE_URL', reason: 'remote-db' }],
    });
  });

  it('該綠:方括號 [::1] ⇒ ok(LOCAL_HOSTS 那一項現在到得了)', () => {
    expect(checkProdDbInDev({ DATABASE_URL: 'postgresql://[::1]:5432/x' })).toEqual({ kind: 'ok' });
  });

  it('該紅:libpq DSN(無 scheme)host= 遠端 ⇒ blocked', () => {
    const v = checkProdDbInDev({ DATABASE_URL: 'host=db.remote.example port=5432 dbname=x' });
    expect(v.kind).toBe('blocked');
  });

  it('該綠:libpq DSN host=localhost / host=unix socket 路徑 ⇒ ok', () => {
    expect(checkProdDbInDev({ DATABASE_URL: 'host=localhost port=5432' })).toEqual({ kind: 'ok' });
    expect(checkProdDbInDev({ DATABASE_URL: 'host=/tmp/pg-sockets port=5432' })).toEqual({
      kind: 'ok',
    });
  });

  // 🔴 codex R1 must-fix-2:三種合法寫法原本都 fail-open。
  it('該紅:authority 留空、host 塞 query 的合法 URI ⇒ blocked', () => {
    expect(checkProdDbInDev({ DATABASE_URL: 'postgresql:///db?host=db.remote.example' }).kind).toBe(
      'blocked',
    );
  });

  it('該紅:hostaddr= 遠端 IP ⇒ blocked;host=localhost 同時給 hostaddr ⇒ hostaddr 優先、仍 blocked', () => {
    expect(checkProdDbInDev({ DATABASE_URL: 'hostaddr=203.0.113.1 port=5432' }).kind).toBe(
      'blocked',
    );
    expect(
      checkProdDbInDev({ DATABASE_URL: 'host=localhost hostaddr=203.0.113.1 port=5432' }).kind,
    ).toBe('blocked');
  });

  // 🔴 R2 nit:key 清單會漂 —— 加寬後的名字要真的在分母裡(該紅),兜底仍是 ref 規則。
  it('該紅:PG_URL / CONNECTION_STRING 這類名字也在第二道分母裡', () => {
    expect(checkProdDbInDev({ PG_URL: 'https://db.example.com' }).kind).toBe('blocked');
    expect(checkProdDbInDev({ CONNECTION_STRING: 'postgres://db.example.com/x' }).kind).toBe(
      'blocked',
    );
  });

  it('空 env / 空字串 ⇒ ok', () => {
    expect(checkProdDbInDev({})).toEqual({ kind: 'ok' });
    expect(checkProdDbInDev({ SUPABASE_URL: '' })).toEqual({ kind: 'ok' });
  });

  it('ref 出現在【任何】變數名底下都要抓到,不只是 DB 類具名的那幾支', () => {
    const v = checkProdDbInDev({ SOME_FUTURE_THING: `postgres://${PROD_REF_LITERAL}.x/db` });
    expect(v.kind).toBe('blocked');
  });

  // 🔴 R1 nit:多個命中時只回報第一個 ⇒ 可能指到無關的變數,真正的設定沒被列出來。
  it('多個命中 ⇒ 全部列出,不是只列第一個', () => {
    const v = checkProdDbInDev({ A_SUPABASE_URL: PROD_URL, B_DATABASE_URL: 'https://x.example.com' });
    expect(v.kind).toBe('blocked');
    if (v.kind !== 'blocked') return;
    expect(v.matches.map((m) => m.key).sort()).toEqual(['A_SUPABASE_URL', 'B_DATABASE_URL']);
  });

  it('逃生門 =1 ⇒ bypassed(放行),而仍然列出命中的 key', () => {
    const v = checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, [PROD_DB_BYPASS_ENV]: '1' });
    expect(v).toEqual({
      kind: 'bypassed',
      matches: [{ key: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'prod-ref' }],
    });
  });

  // 🔴 逃生門只認 '1'。'true'/'yes'/'0' 都不放行 —— 否則「我以為我關掉了」變成沉默的開著。
  it.each(['true', 'yes', '0', ''])('逃生門 =%s ⇒ 仍然 blocked', (value) => {
    const v = checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, [PROD_DB_BYPASS_ENV]: value });
    expect(v.kind).toBe('blocked');
  });

  // 🔴 R1 must-fix-3:逃生門寫進 .env 檔 = 下一個人不知情地繼承一個永久放行。
  it('逃生門 =1 但來自 .env 檔 ⇒ 拒絕放行,且標明 bypassRefused', () => {
    const v = checkProdDbInDev(
      { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, [PROD_DB_BYPASS_ENV]: '1' },
      { bypassFromEnvFile: true },
    );
    expect(v).toEqual({
      kind: 'blocked',
      bypassRefused: true,
      matches: [{ key: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'prod-ref' }],
    });
  });
});

describe('describeProdDbInDev', () => {
  it('訊息要列出【每一個】命中的變數與【下一步做什麼】', () => {
    const msg = describeProdDbInDev(
      [
        { key: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'prod-ref' },
        { key: 'DATABASE_URL', reason: 'remote-db' },
      ],
      false,
    );
    expect(msg).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(msg).toContain('DATABASE_URL');
    expect(msg).toContain(PCM_PROD_PROJECT_REF);
    expect(msg).toContain(PROD_DB_BYPASS_ENV);
  });

  it('bypassRefused ⇒ 訊息要講清楚為什麼那個 =1 沒有生效', () => {
    const msg = describeProdDbInDev([{ key: 'SUPABASE_URL', reason: 'prod-ref' }], true);
    expect(msg).toContain('.env');
    expect(msg).toContain('不放行');
  });
});

// 🔴🔴 **接線測試(codex R1 must-fix-4)** —— 上面那些全綠,而把 `next.config.ts` 裡那三行
//    guard 呼叫整段刪掉,它們【一案都不會紅】。⇒ 測到的是判定,不是那道閘真的裝在路上。
describe('next.config 真的呼叫了那道閘', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  // R2 C-4:shell 若全域 export 逃生門或 DB 變數,「該 throw」案會假紅 ⇒ 先清(同 storefront 版)。
  function scrubDbEnv(): void {
    delete process.env[PROD_DB_BYPASS_ENV];
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && (DB_KEY_PATTERN.test(k) || v.includes(PROD_REF_LITERAL))) {
        delete process.env[k];
      }
    }
  }

  it('dev server phase + 正式庫 ref ⇒ next.config 本身要 throw', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).toThrowError(/next dev 已停止/);
  });

  it('🔴 build phase + 同一組 env ⇒ 不得 throw(Vercel / next build 不能被擋掉)', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).not.toThrow();
  });
});
