/**
 * supplier-config — 多供應商上架管線的「每家一組參數」設定檔(Phase 0 P0-A 地基)
 *
 * 背景:同步管線(rpm-fetch → transform → delta → reconcile → preflight)原本兩重寫死
 *   只跑 RPM 一家(supplier scope、brand slug、handle 前綴、分類、描述同步全 hardcode)。
 *   本檔把「逐家不同的那幾個決定」抽成一張表,呼叫端一律經 getSupplierConfig 取用、不再散落常數。
 *   真權威:docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md §2.3 / §2.9 / §4 P0-A。
 *
 * 🔴 RPM 零回歸(不變式 3):rpm 這組值讓管線輸出與現況 byte 等價,**唯一授權偏離 = 副標「碳纖維」→「碳纖維部品」**
 *   (2026-07-03 Sean 拍 A supersede、plan §6-3:副標隨分類名 rawPath;客人可見、下次 rpm --confirm-write 夜跑套用 ~1,117 頁)——
 *   brandSlug='rpm-carbon'、handlePrefix='rpm'(handle=`rpm-${mainSku}`)、
 *   syncDescription=false(rpm 刻意不寫 description、全批一致省欄 → byte-safe)、
 *   categoryStrategy=fixed '碳纖維部品'(副標即由此 rawPath 衍生)。
 *   supplier-config.test.ts + rpm-transform.test.ts byte 回歸鎖逐值釘死,任何改動觸發 CI 紅燈。
 *
 * 範圍:現役三家(rpm + gbracing + bonamici)+ 品牌放量 8+1 家(2026-07-10 kickoff、Sean 預批;
 *   evotech/lightech/cncracing/eazigrip/samco/motogadget/front3d/materya/ebc。
 *   2026-07-11 Sean 批 demo(晨報 Q1=A)後逐家開寫:cncracing/evotech/samco/motogadget/front3d
 *   =writeAllowed=true(乾淨 5 家);lightech(待 #275 https)/eazigrip·materya(待 #274 撞鍵)/
 *   ebc(待 seed db push)仍 false=fail-closed,關卡解除後再逐家翻 true 才可 --confirm-write)。
 *   新 8 家字面值查證(2026-07-10):brandSlug=網站庫 brands 表 MCP 實查(8 家已 seed、僅 ebc 缺列
 *   =待 seed migration);syncDescription=true(view 描述覆蓋 99-100%、繁中,scout 實查);
 *   variantImages='per-variant'(5 多變體家抽群實測 images 各異=每列自己的圖;ebc 群內全同一張、
 *   per-variant 直用等價;單變體家 1:1 天然安全)。未登記的 slug → getSupplierConfig
 *   直接 throw(fail-closed)。
 */

/**
 * 分類策略(逐家不同):
 * - fixed:整批固定一個分類(rpm=碳纖維部品,Q2=A 決策「RPM 分類不動」)。
 * - per-group:逐群依來源 major_category_zh 對應 16 大類(試點 gbracing/bonamici)。
 */
export type CategoryStrategy =
  | { kind: 'fixed'; rawPath: string }
  | { kind: 'per-group' };

/** 變體圖策略(W3;語意見 SupplierConfig.variantImages docstring)。 */
export type VariantImageStrategy = 'sku-prefix-pool' | 'per-variant';

export interface SupplierConfig {
  /** 來源 view supplier_slug 值:fetch/delta/reconcile/preflight 的 scope,一路貫穿(不變式 1 軟下架隔離)。 */
  supplierSlug: string;
  /**
   * 網站 brands.slug。🔴 ≠ supplierSlug(§2.3:來源 slug 與 brand slug 不一致,必對照;
   * rpm→rpm-carbon / gbracing→gb-racing)。brands 表已 seed 21 家(§2.3 MCP 查證、含試點兩家),
   * 故 dry-run resolveId 應恆命中;真對不上 → resolveId **throw**(fail-closed、非靜默 null),無 live 風險。
   */
  brandSlug: string;
  /**
   * handle 命名空間前綴:handle = `${handlePrefix}-${mainSku.toLowerCase()}`。
   * 🔴 rpm 必為 'rpm'(= 現行寫死前綴、亦 = supplierSlug),改動會變動全部 RPM 商品網址 = live 回歸。
   * 試點採 supplierSlug 同名(gbracing / bonamici,無 hyphen、乾淨 SEO key);客人看到的是品牌頁 slug、handle 僅 key。
   */
  handlePrefix: string;
  /**
   * 是否把 view.description 同步進 products.description。
   * 🔴 F2:rpm=false——現行 upsert 刻意省 description 欄(現存英文描述原地保留);
   *   若對 rpm 改 true,每夜 cron 會把 ~1,117 頁英文覆寫成來源繁中(對外可見改動、須走 Q4/鐵則 12)。
   *   試點=true(來源繁中描述搬進網站;來源 null→省欄不寫 null)。
   */
  syncDescription: boolean;
  /**
   * 是否把來源 pdf_urls/video_urls 同步進 products.manuals/video_url(#270 安裝資源)。
   * 🔴 獨立於 syncDescription:安裝資源=實體資產是否存在,與「繁中翻譯是否備妥」正交
   *   (某供應商描述已備但沒影片、或反之)。true → transform 展開 manuals+video_url 兩 key
   *   (供應商級 all-or-nothing、單一 run uniform → 免 partition);false → 省 key → 凍結不碰。
   *   rpm/cncracing=false(rpm 無來源+byte 凍結、cnc 未 writeAllowed);gbracing/bonamici=true(有 PDF 來源且已同步)。
   *   前提:報價單 storefront_catalog_v 已曝露 pdf_urls/video_urls(20260709 報價單側 migration)。
   */
  syncInstallResources: boolean;
  /** 分類策略(見 CategoryStrategy)。 */
  categoryStrategy: CategoryStrategy;
  /**
   * 是否允許 `--confirm-write` 真寫 prod(2026-07-05 codex K2 must-fix 4:「僅乾跑」只有註解、
   * 無 runtime 硬擋 → 誤帶 --confirm-write 會真寫)。false → rpm-import 在任何寫入動作前 throw(fail-closed);
   * dry-run 不受限。cncracing=false(#267 收斂 2026-07-04、未經每日穩定期,Phase 3 放量拍板前不開)。
   */
  writeAllowed: boolean;
  /**
   * 變體圖策略(W3、#267;2026-07-04 報價單 view 實測):
   * - 'sku-prefix-pool':view.images = 全群共用圖池,過濾檔名含 `${sku小寫}-` 前綴的圖。
   *   🔴 rpm 必為此值(現行行為 byte 錨;12K 特殊款 own 空 → [] → 16c fallback 群代表圖)。
   * - 'per-variant':view.images = 該變體自己的圖(bonamici 1 張 URL 含自身 sku 目錄、
   *   cncracing 首張 variante/ 變體圖+群情境照混合、gbracing 單變體),直接全用不過濾。
   *   RPM 前綴規則對這些家永遠 miss(檔名 sku 後跟 / . _ 而非 -)→ 不 per-variant 則選色不換圖。
   */
  variantImages: VariantImageStrategy;
}

/**
 * 供應商設定登記表(key = 來源 supplier_slug)。
 * 🔴 值皆對齊 plan §2.3/§2.9 first-hand 查證;新增一家前先 MCP 查證其 brandSlug 與來源描述語言。
 */
export const SUPPLIER_CONFIGS: Record<string, SupplierConfig> = {
  // 🔴 現役唯一在跑的一家:所有欄位 = 現況鏡射,不變式 3 錨點(改任一值前先跑 byte 回歸)。
  rpm: {
    supplierSlug: 'rpm',
    brandSlug: 'rpm-carbon',
    handlePrefix: 'rpm',
    syncDescription: false,
    syncInstallResources: false, // 🔴 rpm 無安裝資源來源 + byte 凍結:不寫、products.manuals/video_url 維持 DEFAULT
    categoryStrategy: { kind: 'fixed', rawPath: '碳纖維部品' },
    variantImages: 'sku-prefix-pool', // 🔴 byte 錨:群共用圖池+sku 前綴過濾 = 現行行為
    writeAllowed: true, // 現役每日同步(rpm-sync.yml)
  },
  // 試點一:GB Racing。單變體、無 spec、~186 群通用件(無 fitment)。
  gbracing: {
    supplierSlug: 'gbracing',
    brandSlug: 'gb-racing', // 🔴 §2.3 對照(來源 gbracing ≠ brand gb-racing)
    handlePrefix: 'gbracing',
    syncDescription: true,
    syncInstallResources: true, // #270:有 PDF 來源(fetcher gbracing.eu)且已同步 → 寫 manuals/video_url
    categoryStrategy: { kind: 'per-group' },
    variantImages: 'per-variant', // view images=該列自己的圖(單變體家、942 群全單變體)
    writeAllowed: true, // 試點寫入授權(Sean 2026-07-05 拍 gbracing+bonamici 上架)
  },
  // 試點二:Bonamici。色彩變體、spec {color,material}、~439 群通用件。
  bonamici: {
    supplierSlug: 'bonamici',
    brandSlug: 'bonamici', // identity(來源 slug = brand slug)
    handlePrefix: 'bonamici',
    syncDescription: true,
    syncInstallResources: true, // #270:有 PDF 來源(fetcher bonamiciracing.it)且已同步 → 寫 manuals/video_url
    categoryStrategy: { kind: 'per-group' },
    variantImages: 'per-variant', // 每變體 1 張自身圖(URL 含自身 sku 目錄、1710/1710 非空)
    writeAllowed: true, // 試點寫入授權(Sean 2026-07-05 拍 gbracing+bonamici 上架)
  },
  // 品牌放量首家(#267 收尾登記、2026-07-10 放量入列):CNC Racing。
  //   多色變體(spec {color},源頭 2026-07-04 兩輪遷移收斂後 4,376 列/1,978 群)。
  //   值皆 2026-07-04 MCP 查證:brands.slug='cnc-racing'(≠ 來源 slug)、
  //   view description=繁中 description_zh 全 4,376 列非空、major_category_zh 11 類 → per-group。
  cncracing: {
    supplierSlug: 'cncracing',
    brandSlug: 'cnc-racing', // 🔴 來源 slug ≠ brand slug(同 gbracing 型)
    handlePrefix: 'cncracing',
    syncDescription: true,
    syncInstallResources: true, // #270+放量 kickoff §2:Vimeo 影片(55 群)+PDF(1,008 群)confirm-write 時回填
    categoryStrategy: { kind: 'per-group' },
    variantImages: 'per-variant', // 首張 variante/ 變體圖+群情境照(4376/4376 非空)
    writeAllowed: true, // ✅ 2026-07-11 Sean 批 demo(晨報 Q1=A)後開寫
  },

  // ── 品牌放量 8 家(2026-07-10 kickoff;writeAllowed 一律 false=過夜硬擋、Sean 批後逐家開)──
  // 值查證:brandSlug=brands 表 MCP 實查;附件覆蓋=scout 實查(2026-07-10 截面、群級):
  //   evotech PDF/影片 0(嵌入指南稱將填、附件晚到不阻擋)/ lightech PDF 2,019/ eazigrip·samco·
  //   motogadget·front3d·materya 皆 0 / ebc 影片 45(YouTube)。syncInstallResources 一律 true:
  //   view 兩欄全家已曝、來源即真相(空來源寫 []/null 正確語意),附件晚到由每日同步自然補上。
  evotech: {
    supplierSlug: 'evotech',
    brandSlug: 'evotech', // identity(MCP 實查 brands.slug 命中)
    handlePrefix: 'evotech',
    syncDescription: true, // 3,435/3,460 群有繁中描述
    syncInstallResources: true,
    categoryStrategy: { kind: 'per-group' }, // 12 大類
    variantImages: 'per-variant', // 1:1 單變體家(3,460 群=3,460 變體)
    writeAllowed: true, // ✅ 2026-07-11 Sean 批 demo(晨報 Q1=A)後開寫
  },
  lightech: {
    supplierSlug: 'lightech',
    brandSlug: 'lightech', // identity
    handlePrefix: 'lightech',
    syncDescription: true, // 4,553/4,566
    syncInstallResources: true, // PDF 2,019 群;影片截面 0(Vimeo 預期、晚到自然補)
    categoryStrategy: { kind: 'per-group' }, // 10 大類
    variantImages: 'per-variant', // 抽群實測:同群各色各自 1 張圖(0011M04COB/NER 各異)
    writeAllowed: false, // 🔴 過夜零寫入;Sean 批 demo 後開
  },
  eazigrip: {
    supplierSlug: 'eazigrip',
    brandSlug: 'eazi-grip', // 🔴 來源 slug ≠ brand slug(MCP 實查)
    handlePrefix: 'eazigrip',
    syncDescription: true, // 1,740/1,740
    syncInstallResources: true,
    categoryStrategy: { kind: 'per-group' }, // 3 大類
    variantImages: 'per-variant', // 抽群實測:BUNAPR001 四色各自 1 張圖
    writeAllowed: false, // 🔴 過夜零寫入;Sean 批 demo 後開
  },
  samco: {
    supplierSlug: 'samco',
    brandSlug: 'samco', // identity
    handlePrefix: 'samco',
    syncDescription: true, // 1,403/1,403
    syncInstallResources: true,
    categoryStrategy: { kind: 'per-group' }, // 3 大類
    variantImages: 'per-variant', // 抽群實測:AGU-1 19 色各自圖組(BK/RD 檔名各異)
    writeAllowed: true, // ✅ 2026-07-11 Sean 批 demo(晨報 Q1=A)後開寫(⚠ 變體王 14,165、乾跑先驗)
  },
  motogadget: {
    supplierSlug: 'motogadget',
    brandSlug: 'motogadget', // identity
    handlePrefix: 'motogadget',
    syncDescription: true, // 907/912
    syncInstallResources: true,
    categoryStrategy: { kind: 'per-group' }, // 5 大類
    variantImages: 'per-variant', // 1:1 單變體家(912=912)
    writeAllowed: true, // ✅ 2026-07-11 Sean 批 demo(晨報 Q1=A)後開寫
  },
  front3d: {
    supplierSlug: 'front3d',
    brandSlug: 'front3d', // identity
    handlePrefix: 'front3d',
    syncDescription: true, // 108/108
    syncInstallResources: true,
    categoryStrategy: { kind: 'per-group' }, // 3 大類
    variantImages: 'per-variant', // 1:1 單變體家(108=108)
    writeAllowed: true, // ✅ 2026-07-11 Sean 批 demo(晨報 Q1=A)後開寫
  },
  materya: {
    supplierSlug: 'materya',
    brandSlug: 'materya', // identity
    handlePrefix: 'materya',
    syncDescription: true, // 51/54
    syncInstallResources: true,
    categoryStrategy: { kind: 'per-group' }, // 3 大類
    variantImages: 'per-variant', // 抽群實測:MTY001/MTY011 各色各自圖
    writeAllowed: false, // 🔴 過夜零寫入;Sean 批 demo 後開
  },
  ebc: {
    supplierSlug: 'ebc',
    brandSlug: 'ebc', // 🔴 brands 表缺列(MCP 實查 2026-07-10)→ 乾跑 resolveId 會 throw、
    //   屬預期 fail-closed;seed migration 20260710 已備(supabase/migrations)、待 Sean db push 後乾跑才會過
    handlePrefix: 'ebc',
    syncDescription: true, // 68/68
    syncInstallResources: true, // 影片 45 群(YouTube watch 型、scout 實查)
    categoryStrategy: { kind: 'per-group' }, // 1 大類(煞車系統)
    variantImages: 'per-variant', // 抽群實測:群內各變體同一張圖(per-variant 直用等價)
    writeAllowed: false, // 🔴 過夜零寫入;Sean db push seed + 批 demo 後開
  },
};

/**
 * 取供應商設定;未登記 → throw(fail-closed:寧可整條 abort,不讓錯 slug 靜默套到別家 scope)。
 */
export function getSupplierConfig(supplierSlug: string): SupplierConfig {
  // 🔴 fail-closed 用 Object.hasOwn(非 truthy 檢查):防 'constructor'/'toString' 等原型鏈 key
  //    命中繼承成員 → truthy → 靜默略過 throw + cfg.supplierSlug=undefined(F2、Fable 對抗審)。
  //    只認 own key,未登記一律 abort、不讓錯 slug 靜默套到別家 scope。
  if (!Object.hasOwn(SUPPLIER_CONFIGS, supplierSlug)) {
    const known = Object.keys(SUPPLIER_CONFIGS).join(', ');
    throw new Error(
      `未知供應商 slug「${supplierSlug}」;請先在 scripts/supplier-config.ts SUPPLIER_CONFIGS 登記` +
        `(brandSlug / handlePrefix / syncDescription / categoryStrategy)。目前已登記:${known}`,
    );
  }
  return SUPPLIER_CONFIGS[supplierSlug]!;
}
