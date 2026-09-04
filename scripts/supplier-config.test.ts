// supplier-config.test.ts — 多供應商管線設定檔的回歸鎖(Phase 0 P0-A-1)
//
// 最高價值 = 釘死 RPM byte-safety 錨點(不變式 3):brand/handle 前綴/描述同步/固定分類。
// 任何改動這四個值 → CI 紅燈,防止參數化過程靜默回歸 1,117 個線上 RPM 頁。
// 次要 = 試點兩家的對照值(brandSlug ≠ supplierSlug)與 fail-closed throw 路徑。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  // ✅ 2026-08-27 Sean 逐字「灌」批首灌 ⇒ 本條由 false 改 true。**這正是這條斷言存在的用途**:
  //    翻開關的人被迫回到這裡、看見上面那段因果,而不是靜靜地把一個 fail-closed 旗標打開。
  it('gilles:已開放寫入 prod(2026-08-27 Sean 批首灌)', () => {
    expect(getSupplierConfig('gilles').writeAllowed).toBe(true);
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

  it('should register exactly the pilot set + 品牌放量 8 家(2026-07-10)+ akrapovic(07-19)+ extreme/kspeed(07-24)+ dna(08-20)+ gilles(08-27)+ dbk(09-04)+ rizoma(09-04)', () => {
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
    // 2026-09-04 補 rizoma(第 19 家真供應商;supplierSlug=brandSlug='rizoma')
    //   writeAllowed=false 起手 —— **Sean 尚未批首灌**, 零寫入。登記本身不寫任何資料。
    //   🔴 而它有一筆源頭資料是錯的(⟦supply-RIZOMASPECWRONG⟧:兩支紅色變體 spec 寫「黑」),
    //     而那 4 支 is_listed=false ⇒ view 裡 0 列 ⇒ 灌不上去 ⇒ 不擋首灌;
    //     🛑 而擋住它的是【會變的旗標】不是守門。
    // 2026-09-04 補 dbk(第 18 家真供應商;supplierSlug=brandSlug='dbk',拼法未分岔),
    //   ⛔ ~~writeAllowed=false 起手(fail-closed 零寫入)~~ ⇒ 🔴 **2026-09-04 06:xx Sean 逐字
    //   「甲 上」批首灌 ⇒ 已翻 true**(落點 `~/pcm-mailbox/等Sean拍的題-20260903.md:2648`;
    //   授權射程 = 只此一家、只此一次)。**舊字面留著劃掉**, 讓搜「待 Sean 批」的人同一發撞到。
    //   🔬 首灌實測(獨立查網站庫, 非採信腳本自印):dbk 商品 **1,508** / 變體 **3,727** / 落未分類 **0**;
    //     站上 22,804 ⇒ **24,312** · 變體 54,016 ⇒ **57,743** · 有商品的品牌 18 ⇒ **19**。
    //   翻 true 之前 preflight 八格全綠 + 乾跑四格有判別力的
    //   關卡全綠(分類 1508/0 未對上 · handle 批內唯一 · pv_spec 撞鍵 0 · 新品驗價 M1 逐筆相符),
    //   M2 群數指紋 1508 = 1508。
    //   🔴 而「乾跑全綠」照 runbook §3-b 打折:首灌 target=0 ⇒ 價格離群與來源消失對賬【恆綠】
    //   (本次輸出逐字印 `target 現存上架: 0`)、handle 與 pv_spec 對 target 那半無分母。
    //   🟢 負對照當場跑過:`--expect-groups=9999` ⇒ 印 `🔴 ALERT 群數指紋 abort`,而 **rc 兩個世界都是 0**
    //   ⇒ 這道閘要看畫面、不能看 rc(runbook §3-a 復現)。
    // __gated_canary__ = 永久 guard 測試靶(非真供應商、writeAllowed 恆 false);底線排序在字母前。
    expect(Object.keys(SUPPLIER_CONFIGS).sort()).toEqual([
      '__gated_canary__',
      'akrapovic', 'bonamici', 'cncracing', 'dbk', 'dna', 'eazigrip', 'ebc', 'evotech', 'extreme',
      'front3d', 'gbracing', 'gilles', 'kspeed', 'lightech', 'materya', 'motogadget',
      'rizoma', 'rpm', 'samco',
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 supplier-config.ts ↔ rpm-sync.yml 對帳(2026-09-04 線【帳號】立)
//
// 病灶【逐字引自 .github/workflows/rpm-sync.yml】:
//   「dna+gilles 2026-08-27 Sean 拍甲補入 —— 兩家【首灌後漏加】, 顧客站價格凍在首灌快照
//     而來源每天更新;病灶 = 決定寫在 supplier-config.ts 那句『起排入每日班』
//     而沒寫進本檔, **兩支之間零對帳**」
//
// 🎯 那個坑咬過【兩次】, 而兩次都是「灌完之後」漏的 —— 而漏掉時**沒有任何東西會叫**:
//    兩份檔各自都是對的, 壞的是它們【之間】。⇒ 這一格就是那個「叫」。
//
// 🔴 而它為什麼是一道測試而不是一句提醒:提醒要有人記得看, 而首灌那一刻沒有人會回頭看。
//    翻 writeAllowed=true 的那一秒, 這一格就紅 —— 而那正是該補 matrix 的那一秒。
// ══════════════════════════════════════════════════════════════════════════
describe('supplier-config ↔ rpm-sync matrix 對帳', () => {
  /**
   * 🔴 刻意不進每日 matrix 的家, 與**理由**。
   * ⚠️ 這不是「白名單」而是【對帳的另一端】—— 下面用【嚴格相等】比,
   *    所以多一家漏加會紅, **少一家(有人把 extreme 加進 matrix)也會紅**。
   *    ⇒ 這張表自己不會靜靜過期。
   */
  const DELIBERATE_EXCLUSIONS: Record<string, string> = {
    extreme: '靜態一次性 fixture、無每日更新來源(supplier-config.ts 該筆註解 + rpm-sync.yml 逐字「刻意不列」)',
  };

  function matrixSuppliers(): string[] {
    const yml = readFileSync(join(__dirname, '..', '.github', 'workflows', 'rpm-sync.yml'), 'utf-8');
    const m = /supplier:\s*\[([^\]]*)\]/.exec(yml);
    // 自檢:抽不到就是正規式與檔案格式對不上 ⇒ 下面整段會恆真
    expect(m, 'rpm-sync.yml 抽不到 matrix.supplier ⇒ 正規式與檔案格式對不上, 本組會恆真').not.toBeNull();
    const list = m![1]!.split(',').map((x) => x.trim()).filter(Boolean);
    expect(list.length, 'matrix 抽出 0 家 ⇒ 同上, 本組會恆真').toBeGreaterThan(5);
    return list;
  }

  it('🔴 writeAllowed=true 的每一家都要在每日 matrix 裡(漏加 ⇒ 價格凍在首灌快照, 而沒有東西會叫)', () => {
    const wa = Object.values(SUPPLIER_CONFIGS).filter((c) => c.writeAllowed).map((c) => c.supplierSlug);
    const mat = new Set(matrixSuppliers());
    const missing = wa.filter((s) => !mat.has(s)).sort();
    expect(
      missing,
      `這幾家已開寫而不在每日 matrix ⇒ 顧客站價格會凍在首灌快照。` +
        `若是刻意不列, 把它加進 DELIBERATE_EXCLUSIONS 並寫理由;否則補進 rpm-sync.yml。`,
    ).toEqual(Object.keys(DELIBERATE_EXCLUSIONS).sort());
  });

  it('🔴 matrix 裡的每一家都要 writeAllowed=true(否則那個 job 會【天天紅】)', () => {
    // 🔬 量到的:rpm-import.ts:149 `if (CONFIRM_WRITE && !config.writeAllowed) throw`
    //    ⇒ 排進 matrix 而沒開寫 = 每日 job exit 1 ⇒ 一道對常態發的警報, 而它會被關掉。
    const wa = new Set(Object.values(SUPPLIER_CONFIGS).filter((c) => c.writeAllowed).map((c) => c.supplierSlug));
    const extra = matrixSuppliers().filter((s) => !wa.has(s)).sort();
    expect(extra, '這幾家排進了每日 matrix 而 writeAllowed=false ⇒ 那個 job 會天天 exit 1').toEqual([]);
  });

  it('🔴 例外表自己不會過期:每個例外都要仍然存在且仍然 writeAllowed=true', () => {
    for (const [slug, why] of Object.entries(DELIBERATE_EXCLUSIONS)) {
      expect(SUPPLIER_CONFIGS[slug], `例外表列了「${slug}」而它已經不在 SUPPLIER_CONFIGS 裡 ⇒ 刪掉這個例外`).toBeDefined();
      expect(
        SUPPLIER_CONFIGS[slug]!.writeAllowed,
        `例外表列了「${slug}」而它現在 writeAllowed=false ⇒ 它本來就不該進 matrix, 這個例外是多餘的`,
      ).toBe(true);
      expect(why.length, `例外「${slug}」沒有寫理由`).toBeGreaterThan(10);
    }
  });
});
