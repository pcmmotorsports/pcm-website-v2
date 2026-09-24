import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// B2B 計畫 §9.9 片 D4:後台建經銷帳號 / 重設密碼信(20260925020000)。
// 行為(拋棄式 PG 實跑:建立 / 重按 ALREADY_DONE / 經銷不降級 / 壞統編零寫入 / 60 秒內 TOO_SOON /
// 兩個請求同時進來各只成功一個 / authenticated 叫不動 / 退回再貼)記在 commit 訊息;這支守檔案形狀。
const code = readFileSync(
  new URL('../supabase/migrations/20260925020000_m4b_dealer_account_staff_create.sql', import.meta.url),
  'utf8',
)
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

function body(fn: string): string {
  const start = code.indexOf(`CREATE FUNCTION public.${fn}(`);
  return code.slice(start, code.indexOf('$fn$;', start));
}

describe('後台建經銷帳號 / 重設密碼信 migration(20260925020000)', () => {
  it('🔴 兩支函式只給 service_role 執行', () => {
    for (const sig of [
      'admin_dealer_account_create(uuid, text, text, text, text, text, text, text, text, text, text)',
      'admin_password_reset_claim(uuid, text, text)',
    ]) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
      expect(code).not.toMatch(new RegExp(`GRANT[^;]*${sig.split('(')[0]}[^;]*TO[^;]*(anon|authenticated)`));
    }
  });

  it('🔴 建帳號:先鎖 customers 再查「做過了沒」(同時按只成功一個), 經銷不降級, 改等級走 admin_set_customer_tier', () => {
    const b = body('admin_dealer_account_create');
    const lock = b.indexOf('FOR UPDATE');
    expect(lock).toBeGreaterThan(-1);
    expect(b.indexOf("RETURN 'ALREADY_DONE'")).toBeGreaterThan(lock);
    expect(b).toContain("a.source = 'staff' AND a.status = 'approved'");
    expect(b).toContain("RETURN 'WOULD_DOWNGRADE'");
    expect(b).toMatch(/public\.admin_set_customer_tier\(\s*p_user_id, 'store'/);
  });

  it('🔴 重設信:先鎖 customers, 60 秒用 clock_timestamp 算(不用交易開始時間)', () => {
    const b = body('admin_password_reset_claim');
    expect(b.indexOf('FOR UPDATE')).toBeGreaterThan(-1);
    expect(b.indexOf('FOR UPDATE')).toBeLessThan(b.indexOf("RETURN 'TOO_SOON'"));
    expect(b).toContain("pg_catalog.clock_timestamp() - interval '60 seconds'");
    expect(b).not.toMatch(/\bnow\(\)/);
    // Codex R1:寫入也要是實際時間(欄位預設 now() = 交易開始, 等鎖的那一筆會被記早)
    expect(b).toMatch(/source_app, created_at\)\s*VALUES \([\s\S]*'admin', pg_catalog\.clock_timestamp\(\)\);/);
  });

  it('🔴 退回檔:已有員工建立的紀錄就拒絕執行(刪 source 欄會讓重貼後的冪等失效)', () => {
    const rollback = readFileSync(new URL('../supabase/rollbacks/20260925020000-rollback.sql', import.meta.url), 'utf8')
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    // 整支在同一個交易裡:鎖到 DROP 完才放
    expect(rollback.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(rollback.indexOf('COMMIT;')).toBeGreaterThan(rollback.indexOf('DROP COLUMN source'));
    expect(rollback).toMatch(/IF v_n > 0 THEN\s*RAISE EXCEPTION/);
    // Codex R2:先鎖表再數, 否則還沒提交的建帳號看不到
    expect(rollback.indexOf('LOCK TABLE public.dealer_applications IN ACCESS EXCLUSIVE MODE;')).toBeGreaterThan(-1);
    expect(rollback.indexOf('LOCK TABLE public.dealer_applications')).toBeLessThan(rollback.indexOf("WHERE source = 'staff'"));
  });

  it('source 只收 customer / staff, 預設 customer', () => {
    expect(code).toContain("ADD COLUMN source text NOT NULL DEFAULT 'customer'");
    expect(code).toContain("CHECK (source IN ('customer', 'staff'))");
  });
});
