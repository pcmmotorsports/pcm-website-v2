// rpm-preflight.test.ts — P0-A-4a 寫入前安全 gate:F3 bypass 護欄 + F4 handle preflight
//
// F3(不變式 5):禁同帶兩個 --allow-* bypass 旗標。
// F4(不變式 6):handle charset 白名單 + 批內重複 + target 全域唯一,撞鍵/髒字元 → issue 清單(寫入模式 abort)。

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertBypassFlagsExclusive,
  preflightHandles,
  readHandleOwners,
  checkFetchIntegrity,
  checkGroupCountGate,
  summarizeCategoryResolution,
  findNullCategoryProducts,
  type HandleIssue,
} from './rpm-preflight';

describe('M2 checkGroupCountGate(首灌群數指紋、Codex R1 must-fix)', () => {
  it('🔴 首灌 + 寫入 + 未帶指紋 → abort(補 W1 在 target active=0 恆過的洞)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 648, expectedGroupCount: null, targetActiveCount: 0, isWrite: true });
    expect(r.isFirstLoad).toBe(true);
    expect(r.required).toBe(true);
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toMatch(/--expect-groups=648/); // 訊息直接吐出該帶的值
  });
  it('🔴 帶了指紋但來源少抓 → abort(500/648 情境:W1 放行、本閘擋下)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 500, expectedGroupCount: 648, targetActiveCount: 0, isWrite: true });
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toMatch(/500 群 ≠ 預期 648 群/);
  });
  it('指紋相符 → 放行', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 648, expectedGroupCount: 648, targetActiveCount: 0, isWrite: true });
    expect(r.aborted).toBe(false);
  });
  it('多抓也擋(不是只防少、來源混入別家/重複群同樣可疑)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 700, expectedGroupCount: 648, targetActiveCount: 0, isWrite: true });
    expect(r.aborted).toBe(true);
  });
  it('非首灌未帶指紋 → 不強制、不擋(W1 差集已有基線)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 640, expectedGroupCount: null, targetActiveCount: 648, isWrite: true });
    expect(r.isFirstLoad).toBe(false);
    expect(r.required).toBe(false);
    expect(r.aborted).toBe(false);
  });
  it('非首灌帶了指紋不符 → 仍擋(帶了就當基線用)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 640, expectedGroupCount: 648, targetActiveCount: 648, isWrite: true });
    expect(r.aborted).toBe(true);
  });
  it('dry-run 首灌未帶指紋 → 不 required(乾跑就是去把指紋值讀出來的)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 648, expectedGroupCount: null, targetActiveCount: 0, isWrite: false });
    expect(r.required).toBe(false);
    expect(r.aborted).toBe(false);
  });
  it('dry-run 帶指紋不符 → 仍標 aborted(呼叫端 dry-run 只印報告不 throw)', () => {
    const r = checkGroupCountGate({ sourceGroupCount: 500, expectedGroupCount: 648, targetActiveCount: 0, isWrite: false });
    expect(r.aborted).toBe(true);
  });
});

describe('F3 assertBypassFlagsExclusive(不變式 5)', () => {
  it('同帶兩個 bypass 旗標 → throw', () => {
    expect(() => assertBypassFlagsExclusive(true, true)).toThrow(/禁同帶/);
  });
  it('單帶其一或皆不帶 → 不 throw', () => {
    expect(() => assertBypassFlagsExclusive(true, false)).not.toThrow();
    expect(() => assertBypassFlagsExclusive(false, true)).not.toThrow();
    expect(() => assertBypassFlagsExclusive(false, false)).not.toThrow();
  });
});

describe('F4 preflightHandles(不變式 6)', () => {
  const row = (handle: string, external_id: string, supplier_slug = 'rpm') => ({ handle, external_id, supplier_slug });
  const NO_OWNERS = new Map<string, { supplier_slug: string; external_id: string }>();

  it('合法 handle(小寫英數 + 單一 hyphen/底線分隔)全唯一 → 零 issue', () => {
    const rows = [
      row('rpm-aprilia-01', 'APRILIA-01'),
      row('gbracing-gb-001', 'GB-001', 'gbracing'),
      row('bonamici-pu_001', 'PU_001', 'bonamici'), // 🔴 底線合法(Sean 拍 A、bonamici sku PU_001 用底線)
      row('bonamici-pu_001_bk', 'PU_001_BK', 'bonamici'),
    ];
    expect(preflightHandles(rows, NO_OWNERS)).toEqual([]);
  });

  it('charset 髒字元(大寫/空白/slash/前後或連續 hyphen/前後或連續底線/空)全被抓;底線僅作分隔符', () => {
    const dirty = ['RPM-APRILIA-01', 'rpm aprilia', 'rpm/aprilia', '-rpm-x', 'rpm-x-', 'rpm--x', '_rpm', 'rpm_', 'rpm__x', ''];
    const rows = dirty.map((h, i) => row(h, `E${i}`));
    const issues = preflightHandles(rows, NO_OWNERS);
    const charset = issues.filter((i) => i.reason === 'charset');
    expect(charset.map((i) => i.handle)).toEqual(dirty); // 逐一命中、無漏(前後/連續底線仍髒)
  });

  it('批內兩群產出同 handle → batch-duplicate(首見不報、後見報)', () => {
    const rows = [row('rpm-dup', 'A'), row('rpm-dup', 'B'), row('rpm-ok', 'C')];
    const issues = preflightHandles(rows, NO_OWNERS);
    const dup = issues.filter((i) => i.reason === 'batch-duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.externalId).toBe('B'); // 後見那筆報、首見 A 不報
  });

  it('target 已被「別的商品」佔用 → target-collision;同商品 re-upsert → 不算撞', () => {
    const owners = new Map([
      ['rpm-taken', { supplier_slug: 'gbracing', external_id: 'GB-X' }], // 別家佔用
      ['rpm-self', { supplier_slug: 'rpm', external_id: 'SELF' }], // 同商品現存
    ]);
    const rows = [row('rpm-taken', 'RPM-Y'), row('rpm-self', 'SELF'), row('rpm-fresh', 'FRESH')];
    const issues = preflightHandles(rows, owners);
    const collide = issues.filter((i) => i.reason === 'target-collision');
    expect(collide).toHaveLength(1);
    expect(collide[0]!.handle).toBe('rpm-taken'); // 別家佔用才撞
    expect(collide[0]!.externalId).toBe('RPM-Y');
    // rpm-self(同 supplier+external_id)與 rpm-fresh(無擁有者)皆不撞
  });

  it('同一筆可同時中多個 reason(髒字元 + 批內重複)', () => {
    const rows = [row('BAD HANDLE', 'A'), row('BAD HANDLE', 'B')];
    const issues: HandleIssue[] = preflightHandles(rows, NO_OWNERS);
    expect(issues.filter((i) => i.reason === 'charset')).toHaveLength(2); // 兩筆都髒
    expect(issues.filter((i) => i.reason === 'batch-duplicate')).toHaveLength(1); // 第二筆重複
  });
});

describe('readHandleOwners(target 全域唯一資料源)', () => {
  it('把 products(handle→supplier_slug/external_id)組成擁有者 map', async () => {
    const rows = [
      { handle: 'rpm-a', supplier_slug: 'rpm', external_id: 'A' },
      { handle: 'gbracing-b', supplier_slug: 'gbracing', external_id: 'B' },
    ];
    const mockTgt = {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    } as unknown as SupabaseClient;
    const owners = await readHandleOwners(mockTgt, ['rpm-a', 'gbracing-b']);
    expect(owners.get('rpm-a')).toEqual({ supplier_slug: 'rpm', external_id: 'A' });
    expect(owners.get('gbracing-b')).toEqual({ supplier_slug: 'gbracing', external_id: 'B' });
    expect(owners.size).toBe(2);
  });

  it('查詢 error → throw', async () => {
    const mockTgt = {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    } as unknown as SupabaseClient;
    await expect(readHandleOwners(mockTgt, ['x'])).rejects.toThrow(/readHandleOwners/);
  });
});

// target 現存 active(readActiveExternalIds 鏈:from→select→eq→is→order→range)mock
function mockTargetActive(externalIds: string[]): SupabaseClient {
  const rows = externalIds.map((external_id) => ({ external_id }));
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    range: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe('負測:錯配 supplier scope → fetch 完整性 gate 攔(不變式 1、非靜默誤刪)', () => {
  it('fetch=gbracing 的 main_sku 但 target active 傳 rpm scope → ~100% missing + aborted', async () => {
    const target = mockTargetActive(['RPM-1', 'RPM-2', 'RPM-3', 'RPM-4']); // target 現存全 rpm
    const gbracingSource = new Set(['GB-1', 'GB-2']); // 錯把 gbracing 的來源集合拿來對 rpm scope
    const report = await checkFetchIntegrity(target, 'rpm', gbracingSource, 2, {});
    expect(report.missingCount).toBe(4); // rpm 4 筆全不在 gbracing 來源
    expect(report.shrinkRatio).toBe(1); // 100%
    expect(report.aborted).toBe(true); // >5% → abort:錯 scope 被攔、不會靜默把 rpm 全下架
  });

  it('對照:正確 scope(source ⊇ active)→ 零 missing、不 abort', async () => {
    const target = mockTargetActive(['RPM-1', 'RPM-2']);
    const rpmSource = new Set(['RPM-1', 'RPM-2', 'RPM-3']); // 來源含全部現存 + 新品
    const report = await checkFetchIntegrity(target, 'rpm', rpmSource, 3, {});
    expect(report.missingCount).toBe(0);
    expect(report.aborted).toBe(false);
  });

  it('錯 scope 但顯式 --allow-fetch-shrink → 不 abort(放行真實大縮編、留 audit)', async () => {
    const target = mockTargetActive(['RPM-1', 'RPM-2', 'RPM-3', 'RPM-4']);
    const report = await checkFetchIntegrity(target, 'rpm', new Set(['GB-1']), 1, { allowFetchShrink: true });
    expect(report.shrinkRatio).toBe(1);
    expect(report.aborted).toBe(false); // bypass 放行(F3 已擋「同時帶兩 --allow-*」的盲寫組合)
  });
});

describe('#261 summarizeCategoryResolution(per-group 分類解析彙整)', () => {
  it('聚合未對上 major_category_zh × 群數(群數降冪、同數 zh 升冪)', () => {
    const records = [
      { majorCategoryZh: '操控部品', categoryId: 'cat-ops' }, // 對上
      { majorCategoryZh: '車殼外觀', categoryId: null }, // 未對上
      { majorCategoryZh: '車殼外觀', categoryId: null },
      { majorCategoryZh: '引擎部品', categoryId: null },
      { majorCategoryZh: '操控部品', categoryId: 'cat-ops' }, // 對上
    ];
    const s = summarizeCategoryResolution(records);
    expect(s.mappedGroupCount).toBe(2);
    expect(s.unmappedGroupCount).toBe(3);
    expect(s.unmapped).toEqual([
      { majorCategoryZh: '車殼外觀', groupCount: 2 }, // 群數多的在前
      { majorCategoryZh: '引擎部品', groupCount: 1 },
    ]);
  });

  it('全對上 → unmapped 空', () => {
    const s = summarizeCategoryResolution([{ majorCategoryZh: '操控部品', categoryId: 'x' }]);
    expect(s.unmapped).toEqual([]);
    expect(s.unmappedGroupCount).toBe(0);
  });

  it('空 major_category_zh 未對上 → 標「(空 major_category_zh)」', () => {
    const s = summarizeCategoryResolution([{ majorCategoryZh: '', categoryId: null }]);
    expect(s.unmapped).toEqual([{ majorCategoryZh: '(空 major_category_zh)', groupCount: 1 }]);
  });
});

describe('#261 findNullCategoryProducts(寫入前硬 gate 資料源)', () => {
  const p = (external_id: string, category_id: string | null) => ({
    external_id,
    category_id,
    handle: `x-${external_id}`,
    subtitle: 's',
  });

  it('回傳 category_id=null 的商品(依原順序、保留欄位)', () => {
    const rows = [p('A', 'cat-1'), p('B', null), p('C', null), p('D', 'cat-2')];
    expect(findNullCategoryProducts(rows).map((r) => r.external_id)).toEqual(['B', 'C']);
  });

  it('全部對上(fixed/rpm 情境)→ 空、gate 空過', () => {
    expect(findNullCategoryProducts([p('A', 'cat-1'), p('B', 'cat-2')])).toEqual([]);
  });
});
