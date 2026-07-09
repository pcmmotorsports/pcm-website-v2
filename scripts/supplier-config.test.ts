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
    expect(rpm.writeAllowed).toBe(true); // 現役每日同步
    expect(rpm.syncInstallResources).toBe(false); // 🔴 #270:rpm 無安裝資源來源 + byte 凍結
  });

  it('should map GB Racing source slug → gb-racing brand (§2.3 對照)', () => {
    const gb = getSupplierConfig('gbracing');
    expect(gb.brandSlug).toBe('gb-racing'); // 🔴 來源 slug ≠ brand slug
    expect(gb.handlePrefix).toBe('gbracing');
    expect(gb.syncDescription).toBe(true);
    expect(gb.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(gb.variantImages).toBe('per-variant'); // W3:view images=該列自己的圖
    expect(gb.writeAllowed).toBe(true); // 試點寫入授權(Sean 2026-07-05)
    expect(gb.syncInstallResources).toBe(true); // #270:有 PDF 來源且已同步
  });

  it('should map Bonamici with identity brand slug and per-group category', () => {
    const bo = getSupplierConfig('bonamici');
    expect(bo.brandSlug).toBe('bonamici'); // identity
    expect(bo.handlePrefix).toBe('bonamici');
    expect(bo.syncDescription).toBe(true);
    expect(bo.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(bo.variantImages).toBe('per-variant'); // W3:每變體 1 張自身圖(1710/1710 非空)
    expect(bo.writeAllowed).toBe(true); // 試點寫入授權(Sean 2026-07-05)
    expect(bo.syncInstallResources).toBe(true); // #270:有 PDF 來源且已同步
  });

  it('should map CNC Racing source slug → cnc-racing brand (write gated until Sean approves)', () => {
    const cnc = getSupplierConfig('cncracing');
    expect(cnc.brandSlug).toBe('cnc-racing'); // 🔴 來源 slug ≠ brand slug(2026-07-04 MCP 查證)
    expect(cnc.handlePrefix).toBe('cncracing');
    expect(cnc.syncDescription).toBe(true); // view description=繁中 description_zh 全列非空
    expect(cnc.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(cnc.variantImages).toBe('per-variant'); // W3:首張 variante/ 變體圖(4376/4376 非空)
    // 🔴 V1 runtime 硬擋(codex must-fix 4):Sean 批 demo 前 --confirm-write 必 abort;改 true 前先過 Sean
    expect(cnc.writeAllowed).toBe(false);
    // 2026-07-10 放量 kickoff §2:cnc Vimeo/PDF 於 confirm-write 時回填 → 翻 true(supersede 舊「未 writeAllowed 不寫」)
    expect(cnc.syncInstallResources).toBe(true);
  });

  it('🔴 品牌放量 8 家(2026-07-10):對照值 + writeAllowed 過夜硬擋全 false', () => {
    // brandSlug=brands 表 MCP 實查(2026-07-10);唯一非 identity 對照 = eazigrip→eazi-grip。
    expect(getSupplierConfig('eazigrip').brandSlug).toBe('eazi-grip');
    for (const slug of ['evotech', 'lightech', 'samco', 'motogadget', 'front3d', 'materya', 'ebc']) {
      expect(getSupplierConfig(slug).brandSlug).toBe(slug); // identity
    }
    for (const slug of ['evotech', 'lightech', 'eazigrip', 'samco', 'motogadget', 'front3d', 'materya', 'ebc']) {
      const c = getSupplierConfig(slug);
      expect(c.handlePrefix).toBe(slug); // handle 命名空間 = supplierSlug(gbracing 前例)
      expect(c.syncDescription).toBe(true); // view 描述覆蓋 99-100%(scout 實查)
      expect(c.syncInstallResources).toBe(true); // view 兩欄全家已曝、來源即真相
      expect(c.categoryStrategy).toEqual({ kind: 'per-group' });
      expect(c.variantImages).toBe('per-variant'); // 抽群實測(多變體家)/ 1:1(單變體家)
      // 🔴 過夜零 prod 寫入(kickoff 硬規則 1):任何一家翻 true 前先過 Sean(改這行=面對這個問題)
      expect(c.writeAllowed).toBe(false);
    }
  });

  it('should throw fail-closed on unregistered / prototype-chain keys', () => {
    expect(() => getSupplierConfig('unknown-supplier')).toThrow(/未知供應商/);
    // 🔴 原型鏈 key(truthy 繼承成員)也須 throw、不得回繼承物件(F2、Fable 對抗審)
    expect(() => getSupplierConfig('constructor')).toThrow(/未知供應商/);
    expect(() => getSupplierConfig('toString')).toThrow(/未知供應商/);
    expect(() => getSupplierConfig('__proto__')).toThrow(/未知供應商/);
  });

  it('should register exactly the pilot set + 品牌放量 8 家(2026-07-10)', () => {
    // 防呆:誰未查證就多塞一家 → 這條逼他改測試同時面對「已 MCP 查證了嗎」。
    expect(Object.keys(SUPPLIER_CONFIGS).sort()).toEqual([
      'bonamici', 'cncracing', 'eazigrip', 'ebc', 'evotech', 'front3d',
      'gbracing', 'lightech', 'materya', 'motogadget', 'rpm', 'samco',
    ]);
  });
});
