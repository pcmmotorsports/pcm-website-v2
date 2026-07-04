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
    expect(rpm.brandSlug).toBe('rpm-carbon'); // = 現行 rpm-import.ts BRAND_SLUG 常數
    expect(rpm.handlePrefix).toBe('rpm'); // = 現行 handle `rpm-${sku}`(rpm-transform.ts:146)
    expect(rpm.syncDescription).toBe(false); // 現行刻意不寫 description(F2、rpm-transform.ts:93,149)
    expect(rpm.categoryStrategy).toEqual({ kind: 'fixed', rawPath: '碳纖維部品' }); // = CATEGORY_RAW_PATH
    expect(rpm.variantImages).toBe('sku-prefix-pool'); // 🔴 W3 byte 錨:群圖池+前綴過濾=現行行為
  });

  it('should map GB Racing source slug → gb-racing brand (§2.3 對照)', () => {
    const gb = getSupplierConfig('gbracing');
    expect(gb.brandSlug).toBe('gb-racing'); // 🔴 來源 slug ≠ brand slug
    expect(gb.handlePrefix).toBe('gbracing');
    expect(gb.syncDescription).toBe(true);
    expect(gb.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(gb.variantImages).toBe('per-variant'); // W3:view images=該列自己的圖
  });

  it('should map Bonamici with identity brand slug and per-group category', () => {
    const bo = getSupplierConfig('bonamici');
    expect(bo.brandSlug).toBe('bonamici'); // identity
    expect(bo.handlePrefix).toBe('bonamici');
    expect(bo.syncDescription).toBe(true);
    expect(bo.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(bo.variantImages).toBe('per-variant'); // W3:每變體 1 張自身圖(1710/1710 非空)
  });

  it('should map CNC Racing source slug → cnc-racing brand (dry-run only until Phase 3)', () => {
    const cnc = getSupplierConfig('cncracing');
    expect(cnc.brandSlug).toBe('cnc-racing'); // 🔴 來源 slug ≠ brand slug(2026-07-04 MCP 查證)
    expect(cnc.handlePrefix).toBe('cncracing');
    expect(cnc.syncDescription).toBe(true); // view description=繁中 description_zh 全列非空
    expect(cnc.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(cnc.variantImages).toBe('per-variant'); // W3:首張 variante/ 變體圖(4376/4376 非空)
  });

  it('should throw fail-closed on unregistered / prototype-chain keys', () => {
    expect(() => getSupplierConfig('unknown-supplier')).toThrow(/未知供應商/);
    // 🔴 原型鏈 key(truthy 繼承成員)也須 throw、不得回繼承物件(F2、Fable 對抗審)
    expect(() => getSupplierConfig('constructor')).toThrow(/未知供應商/);
    expect(() => getSupplierConfig('toString')).toThrow(/未知供應商/);
    expect(() => getSupplierConfig('__proto__')).toThrow(/未知供應商/);
  });

  it('should register exactly the Phase 0 pilot set + cncracing dry-run entry', () => {
    // 防呆:誰未查證就多塞一家 → 這條逼他改測試同時面對「已 MCP 查證了嗎」。
    // cncracing = #267 收尾登記(2026-07-04 MCP 查證、Phase 3 前僅乾跑)。
    expect(Object.keys(SUPPLIER_CONFIGS).sort()).toEqual(['bonamici', 'cncracing', 'gbracing', 'rpm']);
  });
});
