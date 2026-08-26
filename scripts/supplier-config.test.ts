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
    // ✅ 2026-07-11 Sean 批 demo(晨報 Q1=A)後開寫(乾淨家、乾跑 1,978 群全綠)
    expect(cnc.writeAllowed).toBe(true);
    // 2026-07-10 放量 kickoff §2:cnc Vimeo/PDF 於 confirm-write 時回填 → 翻 true(supersede 舊「未 writeAllowed 不寫」)
    expect(cnc.syncInstallResources).toBe(true);
  });

  it('🔴 品牌放量 8 家(2026-07-10):對照值 + writeAllowed 逐家 gate(2026-07-24 全 8 家皆開寫)', () => {
    // brandSlug=brands 表 MCP 實查(2026-07-10);唯一非 identity 對照 = eazigrip→eazi-grip。
    expect(getSupplierConfig('eazigrip').brandSlug).toBe('eazi-grip');
    for (const slug of ['evotech', 'lightech', 'samco', 'motogadget', 'front3d', 'materya', 'ebc']) {
      expect(getSupplierConfig(slug).brandSlug).toBe(slug); // identity
    }
    // ✅ 2026-07-11~12 全開 7 家:evotech/samco/motogadget/front3d(晨報 Q1=A 乾淨家、已匯入 prod)
    //   + eazigrip/materya/ebc(#274 源頭治本後上 prod、Sean --confirm-write:eazigrip view 去重、
    //   materya 分群、ebc 填 spec)。
    //   ✅ 2026-07-24 lightech 亦開寫首灌(#275 商品圖 12k 轉存 R2、0 mixed-content、乾跑 4566/4566
    //   分類零未分類、Sean 批首灌 commit 4fb424a)→ 本 8 家全開。翻 true 前先過 Sean(改這行=面對這個問題)。
    const writeOpened = new Set(['evotech', 'lightech', 'samco', 'motogadget', 'front3d', 'eazigrip', 'materya', 'ebc']);
    for (const slug of ['evotech', 'lightech', 'eazigrip', 'samco', 'motogadget', 'front3d', 'materya', 'ebc']) {
      const c = getSupplierConfig(slug);
      expect(c.handlePrefix).toBe(slug); // handle 命名空間 = supplierSlug(gbracing 前例)
      expect(c.syncDescription).toBe(true); // view 描述覆蓋 99-100%(scout 實查)
      expect(c.syncInstallResources).toBe(true); // view 兩欄全家已曝、來源即真相
      expect(c.categoryStrategy).toEqual({ kind: 'per-group' });
      expect(c.variantImages).toBe('per-variant'); // 抽群實測(多變體家)/ 1:1(單變體家)
      expect(c.writeAllowed).toBe(writeOpened.has(slug));
    }
  });

  it('🔴 上架第三批 akrapovic(2026-07-19 Sean 拍板 Q1=A):對照值 + writeAllowed 硬鎖 false', () => {
    // 值皆 2026-07-19 MCP 實查(plan = docs/handoff/2026-07-19-akrapovic-onboarding-plan.md)。
    const ak = getSupplierConfig('akrapovic');
    expect(ak.brandSlug).toBe('akrapovic'); // identity;brands 表已有列(0 商品)
    expect(ak.handlePrefix).toBe('akrapovic');
    expect(ak.syncDescription).toBe(true); // 642/648
    expect(ak.syncInstallResources).toBe(true); // PDF 635 群;video 0
    expect(ak.categoryStrategy).toEqual({ kind: 'per-group' }); // 10 對
    expect(ak.variantImages).toBe('per-variant'); // 1:1 單變體家(648=648)
    // ✅ 2026-07-19 Sean 批首灌後翻 true。前置四關全過:乾跑全綠 / Codex R1 四 must-fix 清完
    //    (M1 新品驗價 M2 群數指紋 M3 首灌 runbook M4 CLI 行為測試)/ 報價單側 648 筆商品名定案
    //    寫入(最終格式=不帶車款)/ Sean 明確點頭。首灌=監控式手動執行,rpm-sync.yml matrix
    //    待寫後驗證通過才加(runbook §1:排程先不含它,免首灌沒收拾完就被下一次排程再跑一次
    //    〔台灣 12:30 表訂;2026-07-22 前為 03:00。首灌在 12:30 前失敗的話「下一次」就是當天〕)。
    expect(ak.writeAllowed).toBe(true);
  });

  it('should throw fail-closed on unregistered / prototype-chain keys', () => {
    expect(() => getSupplierConfig('unknown-supplier')).toThrow(/未知供應商/);
    // 🔴 原型鏈 key(truthy 繼承成員)也須 throw、不得回繼承物件(F2、Fable 對抗審)
    expect(() => getSupplierConfig('constructor')).toThrow(/未知供應商/);
    expect(() => getSupplierConfig('toString')).toThrow(/未知供應商/);
    expect(() => getSupplierConfig('__proto__')).toThrow(/未知供應商/);
  });

  // 🔴 must-fix(code-reviewer R1 #2、2026-08-27):**「今晚刻意不開寫」這件事原本零守門。**
  //   實查:把 gilles.writeAllowed 改成 true,整個測試套件**沒有任何一格會紅**——
  //   主閘 brand-showcase-coverage 因為 case 已補齊而綠、上面那條 keys 測試不看值、
  //   rpm-import-cli 的授權對照組是寫死的 ['rpm','akrapovic']。
  //   而「writeAllowed=false」正是本片最吃重的宣稱(它擋的是寫進正式顧客站、不可逆的 1,817 列)。
  //   ⇒ 釘住它。Sean 批首灌時**本來就要改這裡**,那時這條紅 = 正確的摩擦,不是誤報。
  it('gilles:過夜 fail-closed —— writeAllowed 必須是 false(Sean 批首灌後才改這裡與本條)', () => {
    expect(getSupplierConfig('gilles').writeAllowed).toBe(false);
  });

  // 逐值釘死(同 rpm/gbracing/bonamici/akrapovic 等家的慣例):值皆 2026-08-27 報價單庫實查。
  it('gilles:其餘欄位逐值釘死(改任一值 = 對匯入行為的改動,必須連這條一起面對)', () => {
    const cfg = getSupplierConfig('gilles');
    expect(cfg.supplierSlug).toBe('gilles');
    expect(cfg.brandSlug).toBe('gilles'); // 來源 slug == brand slug(不像 kspeed→k-speed 分岔)
    expect(cfg.handlePrefix).toBe('gilles'); // 登記表 18/18 區塊 handlePrefix == supplierSlug、零例外
    expect(cfg.syncDescription).toBe(true); // 1,817/1,817 繁中 description 全有
    expect(cfg.syncInstallResources).toBe(false); // 實查 pdf_urls / video_urls 兩欄 1,817 筆全 0
    expect(cfg.appendManualFilename).toBe(false); // 新供應商預設(零附件時無作用)
    expect(cfg.categoryStrategy).toEqual({ kind: 'per-group' });
    expect(cfg.variantImages).toBe('per-variant'); // 222 群多變體、最大群 7
  });

  it('should register exactly the pilot set + 品牌放量 8 家(2026-07-10)+ akrapovic(07-19)+ extreme/kspeed(07-24)+ dna(08-20)+ gilles(08-27)', () => {
    // 防呆:誰未查證就多塞一家 → 這條逼他改測試同時面對「已 MCP 查證了嗎」。
    // 2026-07-24 品牌上架第三批補 extreme(第 15 家、commit 9a2f62a/d756651)+ kspeed(第 16 家、
    //   commit 2b5cba1;supplierSlug='kspeed'、brandSlug='k-speed' 拼法分岔)並開寫首灌。
    // 2026-08-20 補 dna(第 17 家;supplierSlug=brandSlug='dna',拼法未分岔),writeAllowed=false
    //   起手(過夜零寫入,乾跑全綠 + Sean 批首灌後才開,見同片 supplier-config.ts 該筆註解)。
    // 2026-08-27 補 gilles(GILLES TOOLING、盧森堡 Grevenmacher;supplierSlug=brandSlug='gilles',
    //   拼法未分岔),writeAllowed=false 起手(過夜零寫入,乾跑五關全綠、待 Sean 批首灌後才開)。
    // 🔴 本檔既有的「第 N 家」序數把 __gated_canary__ 也數進去了(extreme=15/kspeed=16/dna=17),
    //   而 supplier-config.ts 那側的註解數的是【真供應商】⇒ 同一家會有兩個編號。
    //   實量(2026-08-27):登記表總鍵數 18 / 真供應商 17 / gilles 是第 17 家真供應商。
    //   ⇒ 要引用數量請用這三個量到的數字,不要用序數。
    // __gated_canary__ = 永久 guard 測試靶(非真供應商、writeAllowed 恆 false);底線排序在字母前。
    expect(Object.keys(SUPPLIER_CONFIGS).sort()).toEqual([
      '__gated_canary__',
      'akrapovic', 'bonamici', 'cncracing', 'dna', 'eazigrip', 'ebc', 'evotech', 'extreme',
      'front3d', 'gbracing', 'gilles', 'kspeed', 'lightech', 'materya', 'motogadget', 'rpm', 'samco',
    ]);
  });
});
