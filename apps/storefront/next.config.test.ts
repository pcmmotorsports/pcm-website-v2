import { afterEach, describe, expect, it } from 'vitest';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import nextConfig from './next.config';
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
