import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// B2B 計畫 §9 片 A:經銷商申請表(20260925010000)。
// 行為(拋棄式 PG 實跑:壞資料 11 種全擋、送出/重送/修改/他人不可改/核准/STALE/降級/婉拒/重申請、退回再貼)
// 記在 commit 訊息;這支守的是檔案內容不被改回危險的形狀。
const migration = readFileSync(
  new URL('../supabase/migrations/20260925010000_m4b_dealer_applications.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(new URL('../supabase/rollbacks/20260925010000-rollback.sql', import.meta.url), 'utf8');
const code = migration
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

describe('經銷商申請表 migration(20260925010000)', () => {
  it('🔴 客人對表零權限:沒有任何 GRANT 給 anon / authenticated 的表權限(欄級也沒有)', () => {
    expect(code).toContain('REVOKE ALL ON TABLE public.dealer_applications FROM PUBLIC, anon, authenticated, service_role;');
    expect(code).not.toMatch(/GRANT[^;]*ON TABLE public\.dealer_applications[^;]*TO[^;]*(anon|authenticated)/);
    expect(code).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE)\s*\(/); // 欄級 GRANT(ACL 快照看不到)
    expect(code).toContain('GRANT SELECT ON TABLE public.dealer_applications TO service_role;');
  });

  it('🔴 客人三支函式的身分只取 auth.uid(), 不收 user_id 參數', () => {
    for (const fn of ['dealer_application_submit', 'dealer_application_update_mine', 'dealer_application_mine']) {
      const m = new RegExp(`CREATE FUNCTION public\\.${fn}\\(([^)]*)\\)`).exec(code);
      expect(m, fn).not.toBeNull();
      expect(m![1]).not.toMatch(/user/);
    }
    expect(code.match(/v_uid uuid := auth\.uid\(\);/g)).toHaveLength(3);
  });

  it('🔴 修改只限本人而且審核中;讀自己不回 decide_note / decided_by', () => {
    expect(code).toMatch(/WHERE id = p_id\s+AND user_id = v_uid\s+AND status = 'pending';/);
    const mine = code.slice(code.indexOf('CREATE FUNCTION public.dealer_application_mine'), code.indexOf('CREATE FUNCTION public.admin_dealer_application_decide'));
    expect(mine).not.toMatch(/decide_note|decided_by/);
  });

  it('🔴 核准與改等級在同一支函式:鎖住申請、比對畫面上的等級、不降級、只給 store', () => {
    const decide = code.slice(code.indexOf('CREATE FUNCTION public.admin_dealer_application_decide'));
    expect(decide).toMatch(/FROM public\.dealer_applications WHERE id = p_application_id FOR UPDATE/);
    expect(decide).toContain("IF v_app.status <> 'pending' THEN");
    expect(decide).toContain("RETURN 'STALE';");
    expect(decide).toContain("RETURN 'WOULD_DOWNGRADE';");
    expect(decide).toMatch(/public\.admin_set_customer_tier\(\s*v_app\.user_id, 'store'/);
    expect(decide).toContain("IF p_decision = 'reject' AND v_note = '' THEN");
    // Codex R1:核准的必須是員工看過的那一版(客人事後改內容 ⇒ STALE)
    expect(decide).toMatch(/p_expected_updated_at timestamptz\s*\)/);
    expect(decide).toContain('IF p_expected_updated_at IS DISTINCT FROM v_app.updated_at THEN');
  });

  it('🔴 空白一律用完整字元集剝(全形空白 / tab 不得騙過必填與婉拒原因)', () => {
    expect(code.match(/v_ws constant text := /g)).toHaveLength(3);
    const btrimLines = code.split('\n').filter((l) => l.includes('pg_catalog.btrim('));
    expect(btrimLines.length).toBeGreaterThan(15);
    expect(btrimLines.filter((l) => !l.includes('v_ws'))).toEqual([]);
    expect(code).toContain("U&'\\3000'");
  });

  it('🔴 資料約束:統編 8 碼、縣市白名單 22 個、一人一筆審核中、決定欄位配對', () => {
    expect(code).toContain("CHECK (tax_id ~ '^[0-9]{8}$')");
    const regions = /region IN \(([\s\S]*?)\)\)/.exec(code)![1]!.match(/'[^']+'/g)!;
    expect(regions).toHaveLength(22);
    expect(regions.join('')).not.toContain('台');
    expect(code).toMatch(/CREATE UNIQUE INDEX dealer_applications_one_pending\s+ON public\.dealer_applications \(user_id\) WHERE status = 'pending';/);
    expect(code).toContain("CHECK ((status = 'pending') = (decided_at IS NULL))");
    expect(code).toContain("CHECK ((status = 'pending') = (decided_by IS NULL))");
    expect(code).toContain("CHECK (status <> 'rejected' OR decide_note <> '')");
  });

  it('四支都是 DEFINER + search_path 空字串;EXECUTE 客人三支給 authenticated、員工那支給 service_role', () => {
    expect(code.match(/SECURITY DEFINER\s+SET search_path = ''/g)).toHaveLength(4);
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz) TO service_role;');
    expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_dealer_application_decide\([^)]*\) TO authenticated/);
  });

  it('退回檔:四支函式與表都拿掉, 第一行帶 lock_timeout', () => {
    expect(rollback.split('\n')[0]).toContain('lock_timeout');
    for (const s of ['admin_dealer_application_decide', 'dealer_application_mine', 'dealer_application_update_mine', 'dealer_application_submit']) {
      expect(rollback).toContain(`DROP FUNCTION public.${s}(`);
    }
    expect(rollback).toContain('DROP FUNCTION public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz);');
    expect(rollback).toContain('DROP TABLE public.dealer_applications;');
  });
});
