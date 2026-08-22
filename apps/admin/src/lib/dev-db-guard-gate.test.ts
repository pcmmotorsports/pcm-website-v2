import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROD_DB_BYPASS_ENV } from './dev-db-guard';
import { assertDevDbGate, bypassWrittenInEnvFile } from './dev-db-guard-gate';

// 🔴 **這支測試的存在理由(R2 MF-2)**:逃生門的檔面檢查原本【零測試讀真檔】——
//    把 bypassWrittenInEnvFile 改成恆 return false,18 案照樣全綠(兩條 R2 獨立量到同一突變點)。
//    下面每一案都寫【真檔】進 temp 目錄,不注入布林。

// 獨立字面(同 must-fix-5 慣例:不從常數組,常數改壞時這裡才會紅)。
const PROD_URL = 'https://bmpnplmnldofgaohnaok.supabase.co';

let dirs: string[] = [];
function makeDir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'ddg-gate-'));
  dirs.push(d);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(d, name), content);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  vi.restoreAllMocks();
});

describe('bypassWrittenInEnvFile(讀真檔,不是注入布林)', () => {
  it('該紅:.env.local 寫 =1 ⇒ true', () => {
    const d = makeDir({ '.env.local': `${PROD_DB_BYPASS_ENV}=1\n` });
    expect(bypassWrittenInEnvFile(d)).toBe(true);
  });

  it('該紅:.env 寫 export KEY="1"(帶引號 / export 前綴)⇒ true', () => {
    const d = makeDir({ '.env': `export ${PROD_DB_BYPASS_ENV}="1"\n` });
    expect(bypassWrittenInEnvFile(d)).toBe(true);
  });

  it('該綠:空目錄 / 檔在但沒有那個 key ⇒ false', () => {
    expect(bypassWrittenInEnvFile(makeDir())).toBe(false);
    expect(bypassWrittenInEnvFile(makeDir({ '.env.local': 'OTHER=1\n' }))).toBe(false);
  });

  it('該綠:寫 =0 / =true ⇒ false(檔面沒有授權;R2 nit:原版連 =0 都當「檔裡有 =1」拒絕)', () => {
    expect(bypassWrittenInEnvFile(makeDir({ '.env.local': `${PROD_DB_BYPASS_ENV}=0\n` }))).toBe(
      false,
    );
    expect(bypassWrittenInEnvFile(makeDir({ '.env.local': `${PROD_DB_BYPASS_ENV}=true\n` }))).toBe(
      false,
    );
  });

  it('該綠:被註解掉的 # KEY=1 ⇒ false', () => {
    const d = makeDir({ '.env.local': `# ${PROD_DB_BYPASS_ENV}=1\n` });
    expect(bypassWrittenInEnvFile(d)).toBe(false);
  });

  it('該綠:不成對引號 ="1\' ⇒ false(codex R1 nit;runtime 解析它的值也不會是 1)', () => {
    const d = makeDir({ '.env.local': `${PROD_DB_BYPASS_ENV}="1'\n` });
    expect(bypassWrittenInEnvFile(d)).toBe(false);
  });

  it('四支檔名(.env.local/.env.development.local/.env.development/.env)都在分母裡', () => {
    for (const name of ['.env.local', '.env.development.local', '.env.development', '.env']) {
      const d = makeDir({ [name]: `${PROD_DB_BYPASS_ENV}=1\n` });
      expect(bypassWrittenInEnvFile(d), name).toBe(true);
    }
  });
});

describe('assertDevDbGate(接線層本體)', () => {
  it('該紅:正式庫 ref、無逃生門 ⇒ throw,訊息含「next dev 已停止」', () => {
    const d = makeDir();
    expect(() => assertDevDbGate(d, { NEXT_PUBLIC_SUPABASE_URL: PROD_URL })).toThrowError(
      /next dev 已停止/,
    );
  });

  it('該紅:env 逃生門 =1 但同值寫在該目錄 .env 檔 ⇒ 仍 throw 且訊息講明不放行', () => {
    const d = makeDir({ '.env.local': `${PROD_DB_BYPASS_ENV}=1\n` });
    expect(() =>
      assertDevDbGate(d, { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, [PROD_DB_BYPASS_ENV]: '1' }),
    ).toThrowError(/不放行/);
  });

  it('該綠:逃生門 =1 且檔面乾淨 ⇒ 不 throw,但要印警告(放行不能是無聲的)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = makeDir();
    expect(() =>
      assertDevDbGate(d, { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, [PROD_DB_BYPASS_ENV]: '1' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('該綠:本機 DB ⇒ 不 throw、不警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = makeDir();
    expect(() =>
      assertDevDbGate(d, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
