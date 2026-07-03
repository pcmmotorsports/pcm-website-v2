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
 * 範圍:Phase 0 只登記試點會用到的三家(rpm + gbracing + bonamici)。
 *   其餘 8-9 家留 Phase 3 放量時登記(屆時各自 MCP 查證 brandSlug / syncDescription,
 *   不預先臆測未查證的字面值)。未登記的 slug → getSupplierConfig 直接 throw(fail-closed)。
 */

/**
 * 分類策略(逐家不同):
 * - fixed:整批固定一個分類(rpm=碳纖維部品,Q2=A 決策「RPM 分類不動」)。
 * - per-group:逐群依來源 major_category_zh 對應 16 大類(試點 gbracing/bonamici)。
 */
export type CategoryStrategy =
  | { kind: 'fixed'; rawPath: string }
  | { kind: 'per-group' };

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
  /** 分類策略(見 CategoryStrategy)。 */
  categoryStrategy: CategoryStrategy;
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
    categoryStrategy: { kind: 'fixed', rawPath: '碳纖維部品' },
  },
  // 試點一:GB Racing。單變體、無 spec、~186 群通用件(無 fitment)。
  gbracing: {
    supplierSlug: 'gbracing',
    brandSlug: 'gb-racing', // 🔴 §2.3 對照(來源 gbracing ≠ brand gb-racing)
    handlePrefix: 'gbracing',
    syncDescription: true,
    categoryStrategy: { kind: 'per-group' },
  },
  // 試點二:Bonamici。色彩變體、spec {color,material}、~439 群通用件。
  bonamici: {
    supplierSlug: 'bonamici',
    brandSlug: 'bonamici', // identity(來源 slug = brand slug)
    handlePrefix: 'bonamici',
    syncDescription: true,
    categoryStrategy: { kind: 'per-group' },
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
