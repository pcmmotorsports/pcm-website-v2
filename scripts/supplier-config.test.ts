// supplier-config.test.ts — 多供應商管線設定檔的回歸鎖(Phase 0 P0-A-1)
//
// 最高價值 = 釘死 RPM byte-safety 錨點(不變式 3):brand/handle 前綴/描述同步/固定分類。
// 任何改動這四個值 → CI 紅燈,防止參數化過程靜默回歸 1,117 個線上 RPM 頁。
// 次要 = 試點兩家的對照值(brandSlug ≠ supplierSlug)與 fail-closed throw 路徑。

import { describe, it, expect } from 'vitest';
import { getSupplierConfig, SUPPLIER_CONFIGS } from './supplier-config';

describe('getSupplierConfig', () => {
  it('🔴 should keep RPM byte-safe (brand/handle/description/category anchors)', () => {
    const rpm = getSupplierConfig('rpm');
    expect(rpm.supplierSlug).toBe('rpm');
    expect(rpm.brandSlug).toBe('rpm-carbon'); // = 現行 BRAND_SLUG(rpm-import.ts:55)
    expect(rpm.handlePrefix).toBe('rpm'); // = 現行 handle `rpm-${sku}`(rpm-transform.ts:146)
    expect(rpm.syncDescription).toBe(false); // 現行刻意不寫 description(F2、rpm-transform.ts:93,149)
    expect(rpm.categoryStrategy).toEqual({ kind: 'fixed', rawPath: '碳纖維部品' }); // = CATEGORY_RAW_PATH
  });

  it('should map GB Racing source slug → gb-racing brand (§2.3 對照)', () => {
    const gb = getSupplierConfig('gbracing');
    expect(gb.brandSlug).toBe('gb-racing'); // 🔴 來源 slug ≠ brand slug
    expect(gb.handlePrefix).toBe('gbracing');
    expect(gb.syncDescription).toBe(true);
    expect(gb.categoryStrategy).toEqual({ kind: 'per-group' });
  });

  it('should map Bonamici with identity brand slug and per-group category', () => {
    const bo = getSupplierConfig('bonamici');
    expect(bo.brandSlug).toBe('bonamici'); // identity
    expect(bo.handlePrefix).toBe('bonamici');
    expect(bo.syncDescription).toBe(true);
    expect(bo.categoryStrategy).toEqual({ kind: 'per-group' });
  });

  it('should throw fail-closed on an unregistered supplier slug', () => {
    expect(() => getSupplierConfig('unknown-supplier')).toThrow(/未知供應商/);
  });

  it('should register exactly the Phase 0 pilot set (rpm + 2 pilots)', () => {
    // 防呆:誰未查證就多塞一家 → 這條逼他改測試同時面對「已 MCP 查證了嗎」。
    expect(Object.keys(SUPPLIER_CONFIGS).sort()).toEqual(['bonamici', 'gbracing', 'rpm']);
  });
});
