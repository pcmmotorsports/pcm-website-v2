import { afterEach, describe, expect, it } from 'vitest';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
// 測自己這個 app 的根 `next.config`(同 admin 那支)。
// 🔴 **2026-08-29 codex must-fix:原寫的理由是錯的** —— 實跑訊息逐字是
//    「apps/storefront → apps/storefront 沒有一條規則允許」⇒ **成因是「app 讀自己」,不是型別。**
// 🔴 **重判時機**:`boundaries/dependencies` 多一條允許「app 讀自己」⇒ 下面那行 disable 就該刪。
// eslint-disable-next-line boundaries/dependencies
import nextConfig from './next.config';
// 🔴 **這是真的跨 app import,而它是刻意的。**
// 下面那段註解(接線測試 MAIN-127 ④)逐字說明為什麼:**判定層的測試在 `apps/admin/src/lib/`,
// 這裡只驗「真的裝在路上」** —— storefront 是量到「實際打過正式庫」痕跡的那個入口。
// 🔴 **重判的時機(這是一把尺,不是一句「請相信我」)**:
// 哪一天 `DB_KEY_PATTERN` 不再住在 `apps/admin/src/lib/dev-db-guard`(判定層搬家 / 抽進
// `packages/`)⇒ **下面那行 disable 與這個 import 都要重判**,而那時正確的做法多半是
// 把它抽成共用,不是繼續跨過來拿。
// 🔴🔴 **2026-08-29 codex 對【這一行豁免本身】投了 FAIL,而我保留它 —— 理由要寫下來**:
//    codex 逐字:「這是真正的跨 app 匯入,卻把新啟用的 `boundaries/dependencies` 警報壓掉…
//    修法:將 `DB_KEY_PATTERN`/guard 抽到共用 `packages/`,兩個 app 分別匯入,並刪除豁免。」
//    ✅ **它是對的,而那是一個【搬碼】的改動** —— 本片的界是「讓 lint 掃測試檔」,
//    而不給豁免的代價是**全隊 `pnpm lint` 立刻紅**,那道閘會被關掉(今晚量過那個下場)。
//    ⇒ **保留豁免 = 刻意的技術債,不是判它沒問題。** 已登記進工作池。
// eslint-disable-next-line boundaries/dependencies
import { DB_KEY_PATTERN } from '../admin/src/lib/dev-db-guard';

// 🔴 **接線測試(MAIN-127 ④,與 admin 的同型)**:storefront 是量到「實際打過正式庫」痕跡的
//    那個入口,而它原本沒接閘。判定層的測試在 apps/admin/src/lib/;這裡只驗「真的裝在路上」——
//    把 next.config.ts 裡的 gate 呼叫刪掉,下面該紅的兩案一案都不會紅,正是要防的形態。

// 獨立字面(同 must-fix-5 慣例)。
const PROD_URL = 'https://bmpnplmnldofgaohnaok.supabase.co';

describe('storefront next.config 真的呼叫了那道正式庫閘', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  // vitest 不載 .env*,但開發者 shell 可能全域 export DB 類變數 ⇒ 先清乾淨,
  // 「該綠」那案才有判別力(否則外洩的遠端變數會把它變成假紅)。
  function scrubDbEnv(): void {
    // 逃生門也要清(codex R1 nit):shell 若全域 export =1,「該擋」案會靜默變放行。
    // key 清單直接用 guard 的 DB_KEY_PATTERN(R2 N-3:兩份復刻會各自漂)。
    delete process.env.PCM_ALLOW_PROD_DB_DEV;
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && (DB_KEY_PATTERN.test(k) || v.includes('bmpnplmnldofgaohnaok'))) {
        delete process.env[k];
      }
    }
  }

  it('dev phase + 正式庫 ref ⇒ next.config 本身要 throw', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).toThrowError(/next dev 已停止/);
  });

  it('🔴 build phase + 同一組 env ⇒ 不得 throw(Vercel / next build 不能被擋掉)', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).not.toThrow();
  });

  it('🔴 dev phase + 只有本機 DB ⇒ 不 throw(證明不是恆擋)', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
  });
});
