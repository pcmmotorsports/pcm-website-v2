import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 後台刪除 / 停用會員(20260926100000–100200;計畫 ~/pcm-mailbox/計畫-後台刪除停用會員-20260926.md 第 8 版)。
// 行為在拋棄式 PG17 上實跑(底 = 正式庫 2026-09-26 唯讀 pg_dump 的 public 結構 + 三支 migration):
//   supabase/tests/database/customer_disable_delete_behavior.sql(檔頭寫了怎麼跑)。這支守檔案形狀與兩件行為測試量不到的事:
//   ① 參照會員的表多了一張, 刪除條件沒跟著改 ② 經銷三支函式鎖的先後(並行測試分辨不出舊順序, 見行為測試檔頭)。
const dir = new URL('../supabase/migrations/', import.meta.url);
const strip = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const main = readFileSync(new URL('20260926100000_m4b_customer_disable_delete.sql', dir), 'utf8');
const code = strip(main);
const rb = readFileSync(new URL('../supabase/rollbacks/20260926100000-rollback.sql', import.meta.url), 'utf8');

const fn = (name: string) => {
  const start = code.indexOf(`FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  // 從正式庫取出的定義以 `$function$` 結尾, 新寫的以 `$fn$` 結尾
  const ends = ['$function$\n;', '$fn$;'].map((d) => code.indexOf(d, start)).filter((i) => i > -1);
  return code.slice(start, Math.min(...ends));
};

// 每支 migration 裡「REFERENCES customers / auth.users」那一行屬於哪張表:往上找最近的 CREATE TABLE / ALTER TABLE。
function tablesReferencingMembers(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const lines = strip(readFileSync(new URL(f, dir), 'utf8')).split('\n');
    lines.forEach((l, i) => {
      if (!/REFERENCES\s+(public\.)?customers\b|REFERENCES\s+auth\.users\b/i.test(l)) return;
      for (let j = i; j >= 0; j--) {
        const m = (lines[j] ?? '').match(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: ONLY)?)\s+(?:public\.)?([a-z_]+)/i);
        if (m?.[1]) {
          out.add(m[1].toLowerCase());
          return;
        }
      }
      out.add(`?(${f})`);
    });
  }
  return out;
}

describe('刪除 / 停用會員 migration(20260926100000)', () => {
  it('🔴 參照會員的表都有歸類:多一張就紅(計畫第三節「清單會過期」)', () => {
    // 有紀錄就不能刪(要在 pcm_customer_delete_blockers 裡)
    const blockers = ['orders', 'shipments', 'coupon_redemptions', 'customer_wallet_ledger', 'dealer_applications', 'dealer_brand_discounts'];
    // 隨帳號一起刪的:地址、車款、收藏;customers 本身指向 auth.users
    const cascadeOk = ['customer_addresses', 'customer_vehicles', 'customer_favorites', 'customers'];
    expect([...tablesReferencingMembers()].sort()).toEqual([...blockers, ...cascadeOk].sort());
    const b = fn('pcm_customer_delete_blockers');
    for (const t of blockers) expect(b, t).toContain(`FROM public.${t} t WHERE`);
    // 沒有外鍵、但存會員編號的兩張付款表(計畫第三節)
    expect(b).toContain('FROM public.payment_charge_attempts t WHERE t.customer_user_id');
    expect(b).toContain('FROM public.payment_double_charge_anomalies t WHERE t.user_id');
    // Q20 甲:經銷等級與儲值金餘額也算紀錄
    expect(b).toContain("t.tier <> 'general'::public.member_tier");
    expect(b).toContain('t.wallet_balance <> 0 OR t.total_deposit <> 0');
  });

  it('🔴 鎖的順序一律先會員列、再申請列(Codex R5 必修:反過來會死結)', () => {
    const decide = fn('admin_dealer_application_decide');
    const cust = decide.indexOf('FROM public.customers c WHERE c.user_id = v_uid FOR UPDATE;');
    const app = decide.indexOf('FROM public.dealer_applications WHERE id = p_application_id FOR UPDATE;');
    expect(cust).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(cust);
    expect(decide.match(/FOR UPDATE/g)).toHaveLength(2);
    // 取會員編號那一句不加鎖
    expect(decide).toMatch(/SELECT a\.user_id INTO v_uid FROM public\.dealer_applications a WHERE a\.id = p_application_id;/);
    expect(decide.indexOf("RETURN 'CUSTOMER_DISABLED'")).toBeGreaterThan(decide.indexOf("IF p_decision = 'approve' THEN"));

    const submit = fn('dealer_application_submit');
    expect(submit.indexOf('FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;')).toBeGreaterThan(-1);
    expect(submit.indexOf('INSERT INTO public.dealer_applications')).toBeGreaterThan(submit.indexOf('FOR SHARE;'));
    const upd = fn('dealer_application_update_mine');
    expect(upd.indexOf('FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;')).toBeGreaterThan(-1);
    expect(upd.indexOf('UPDATE public.dealer_applications')).toBeGreaterThan(upd.indexOf('FOR SHARE;'));
  });

  it('🔴 建單與手動建單在鎖住會員列後擋停用;手動建單放在冪等早退之後', () => {
    const co = fn('create_order');
    expect(co).toContain('SELECT c.tier, c.disabled_at INTO v_tier, v_disabled_at FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;');
    expect(co.indexOf('pcm_customer_disabled')).toBeGreaterThan(co.indexOf('FOR SHARE;'));
    const mo = fn('admin_create_manual_order');
    const lock = mo.indexOf('WHERE c.user_id = p_customer_user_id FOR SHARE;');
    expect(lock).toBeGreaterThan(mo.indexOf('pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_user_id::text, 0))'));
    expect(lock).toBeGreaterThan(mo.indexOf('G6.5'));
  });

  it('🔴 刪除用 FOR UPDATE(不能 NO KEY UPDATE)、鎖後重新檢查、稽核留 email 與姓名', () => {
    const del = fn('admin_delete_customer');
    expect(del).toMatch(/FROM public\.customers c WHERE c\.user_id = p_customer_user_id FOR UPDATE;/);
    expect(del).not.toMatch(/NO KEY UPDATE/);
    expect(del.indexOf('pcm_customer_delete_blockers')).toBeGreaterThan(del.indexOf('FOR UPDATE;'));
    expect(del).toContain("pg_catalog.jsonb_build_object('email', v_row.email, 'name', v_row.name");
    expect(del).toContain('DELETE FROM auth.users u WHERE u.id = p_customer_user_id;');
    expect(del).toContain('GET DIAGNOSTICS v_n = ROW_COUNT;');
  });

  it('🔴 停用與恢復用版本號比對(Codex 加審必修),停用時刪登入工作階段', () => {
    for (const name of ['admin_disable_customer', 'admin_enable_customer']) {
      const f = fn(name);
      expect(f, name).toContain('<> p_expected_version THEN');
      expect(f, name).toContain('disabled_version = v_');
      expect(f, name).not.toMatch(/p_expected_disabled_at/);
    }
    expect(fn('admin_disable_customer')).toContain('DELETE FROM auth.sessions s WHERE s.user_id = p_customer_user_id;');
  });

  it('🔴 搜尋函式先 DROP 舊簽章再建新的(只留一版, 否則 PGRST203)', () => {
    expect(code).toContain('DROP FUNCTION public.admin_search_customers(text, integer);');
    expect(code.match(/CREATE (OR REPLACE )?FUNCTION public\.admin_search_customers\(/g)).toHaveLength(1);
    expect(code).toContain("p_status text DEFAULT 'active'::text");
  });

  it('🔴 權限:會員只多讀 disabled_at;四支新函式只給 service_role', () => {
    expect(code.match(/GRANT [^;]* ON public\.customers TO authenticated;/g)).toEqual(['GRANT SELECT (disabled_at) ON public.customers TO authenticated;']);
    for (const sig of [
      'admin_customer_delete_eligibility(uuid)',
      'admin_disable_customer(text, uuid, integer, text, text)',
      'admin_enable_customer(text, uuid, integer, text, text)',
      'admin_delete_customer(text, uuid, text, text)',
    ]) {
      expect(code, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM anon, authenticated;`);
      expect(code, sig).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it('🔴 退回檔:DROP view 後照 12 欄重建、五支函式回到改動前、指紋與 migration 前置閘相同', () => {
    expect(rb).toContain('DROP VIEW public.admin_customer_list_v;');
    expect(rb).not.toMatch(/c\.disabled_at\s+AS disabled_at/);
    for (const n of ['create_order', 'dealer_application_submit', 'dealer_application_update_mine', 'admin_dealer_application_decide', 'admin_create_manual_order']) {
      expect(rb, n).toContain(`CREATE OR REPLACE FUNCTION public.${n}(`);
    }
    for (const fp of main.match(/'[0-9a-f]{32}'/g) ?? []) expect(rb, fp).toContain(fp);
  });
});
