/**
 * Sean 2026-10-02 Q33 / Q34 甲:網站下架連動報價單。
 * plan:~/pcm-mailbox/計畫-網站下架連動報價單-20261002.md
 *  - Q33:報價單整群停產(過了 view 的 7 天寬限 ⇒ 每個規格都帶 delisted_at)⇒ 網站在架的那張卡自動下架。
 *  - Q34:網站上沒有這張卡、而報價單那一群已整群停產 ⇒ 不新建。
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  planAutoDelist,
  applyAutoDelist,
  shouldSkipNewDiscontinued,
  AUTO_DELIST_RATIO_ABORT,
  AUTO_DELIST_HARD_CAP,
  type SiteListing,
} from './rpm-reconcile';

const listing = (externalId: string, listingSetBy: string | null = 'sync'): SiteListing => ({
  id: `id-${externalId}`,
  externalId,
  listingSetBy,
});
const active = (n: number): SiteListing[] => Array.from({ length: n }, (_, i) => listing(`G${i}`));

describe('planAutoDelist(Q33)', () => {
  it('只下架報價單整群停產、而網站還在架上的卡', () => {
    const plan = planAutoDelist(active(100), new Set(['G1', 'G2', 'NOT-ON-SITE']), { allowLargeDelist: false });
    expect(plan.aborted).toBe(false);
    expect(plan.toDelist.map((l) => l.externalId)).toEqual(['G1', 'G2']);
  });

  it('員工手動上架的卡(listing_set_by=staff)不動,另外列出來', () => {
    const site = [...active(50), listing('KEEP', 'staff')];
    const plan = planAutoDelist(site, new Set(['G3', 'KEEP']), { allowLargeDelist: false });
    expect(plan.toDelist.map((l) => l.externalId)).toEqual(['G3']);
    expect(plan.skippedStaff.map((l) => l.externalId)).toEqual(['KEEP']);
  });

  it('同一家這一輪要下架的超過在架卡數 10% ⇒ 整家這一輪不下架', () => {
    const site = active(20);
    const plan = planAutoDelist(site, new Set(['G0', 'G1', 'G2']), { allowLargeDelist: false }); // 3/20 = 15%
    expect(AUTO_DELIST_RATIO_ABORT).toBe(0.1);
    expect(plan.aborted).toBe(true);
    expect(plan.toDelist).toEqual([]);
    expect(plan.abortReason).toMatch(/15\.0%/);
  });

  it('剛好 10% 不擋;帶 --allow-large-delist 放行並標記', () => {
    expect(planAutoDelist(active(20), new Set(['G0', 'G1']), { allowLargeDelist: false }).aborted).toBe(false);
    const plan = planAutoDelist(active(20), new Set(['G0', 'G1', 'G2']), { allowLargeDelist: true });
    expect(plan.aborted).toBe(false);
    expect(plan.largeBypassed).toBe(true);
    expect(plan.toDelist).toHaveLength(3);
  });

  it('超過 50% ⇒ 帶參數也不放行(view 哪天整家都帶 delisted_at 時不會整家下架;R1 建議 2)', () => {
    expect(AUTO_DELIST_HARD_CAP).toBe(0.5);
    const plan = planAutoDelist(active(10), new Set(['G0', 'G1', 'G2', 'G3', 'G4', 'G5']), { allowLargeDelist: true });
    expect(plan.aborted).toBe(true);
    expect(plan.toDelist).toEqual([]);
    expect(plan.abortReason).toMatch(/50%.*不能放行/);
    // 剛好 50% 帶參數仍放行
    expect(planAutoDelist(active(10), new Set(['G0', 'G1', 'G2', 'G3', 'G4']), { allowLargeDelist: true }).aborted).toBe(false);
  });

  it('沒有要下架的 ⇒ 不擋、空清單', () => {
    const plan = planAutoDelist(active(5), new Set(), { allowLargeDelist: false });
    expect(plan).toMatchObject({ aborted: false, toDelist: [], skippedStaff: [] });
  });
});

describe('applyAutoDelist(Q33 寫入)', () => {
  it('每張卡走後台同一支 admin_set_product_listing,actor=sync、request_id 帶供應商與 external_id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'UPDATED', error: null });
    const tgt = { rpc } as unknown as SupabaseClient;
    const tally = await applyAutoDelist(tgt, 'dna', [listing('AK-1'), listing('AK-2')]);
    expect(tally).toEqual({ UPDATED: 2 });
    expect(rpc).toHaveBeenCalledWith('admin_set_product_listing', {
      p_product_id: 'id-AK-1',
      p_delisted: true,
      p_note: expect.stringContaining('Q33'),
      p_actor: 'sync',
      p_request_id: 'rpm-auto-delist:dna:AK-1',
    });
  });

  it('RPC 回錯 ⇒ throw(不吞掉,讓 cron 叫)', async () => {
    const tgt = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) } as unknown as SupabaseClient;
    await expect(applyAutoDelist(tgt, 'dna', [listing('AK-1')])).rejects.toThrow(/AK-1.*boom/);
  });
});

describe('shouldSkipNewDiscontinued(Q34)', () => {
  const site = new Set(['ON-SITE']);
  it('網站上沒有、而整群停產 ⇒ 不新建', () => {
    expect(shouldSkipNewDiscontinued('NEW', true, site)).toBe(true);
  });
  it('網站上已經有(在架或已下架都算)⇒ 照常同步,不跳過', () => {
    expect(shouldSkipNewDiscontinued('ON-SITE', true, site)).toBe(false);
  });
  it('沒有整群停產 ⇒ 照常新建', () => {
    expect(shouldSkipNewDiscontinued('NEW', false, site)).toBe(false);
  });
});
