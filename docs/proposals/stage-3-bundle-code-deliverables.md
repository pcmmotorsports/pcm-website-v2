# Stage 3 終版 v4 — Bundle Code Deliverables(字面源)

> **產出者:** Cowork
> **位置:** outputs/ Cowork scratchpad、Code 跑階段 0 onboarding 時 Read
> **內容:** 4 個 code 類 deliverable 完整字面
>   - §C `docs/design-storefront-manifest.yaml`
>   - §D `scripts/design-mirror.mjs`
>   - §E `.claude/agents/code-reviewer.md`
>   - §F `.claude/settings.json`

---

## §C `docs/design-storefront-manifest.yaml`(第一版字面)

```yaml
# PCM 設計 ↔ 現場 對照清單 v1.0
#
# 用途:Cowork / Code 動 storefront 元件前 Read 此檔、知道對應 design 字面源 + 業務拍板偏離 + 同步狀態
# 維護:Cowork 寫第一版、後續 slice 結束 amend 對應元件 last_modified_commit / date 段
#       新元件 / 新業務 override 在對應 slice 寫前 amend
#       重大改動跑 PRD-reviewer 級 audit(對齊 docs/patterns/cowork-review-chain.md §1)
#
# 排除規則:
#   - design-reference/components/explorations/ 整個目錄 exclude(設計探索用、storefront 不對齊)
#   - design-reference/styles/*.v1.css 標 deprecated_in_design: true(舊版本、storefront 不需對齊)
#
# 衝突仲裁:本 manifest > storefront 既有 code、但 business_overrides 段內偏離合法、不誤判
#
# 字面 vs 事實:
#   - last_modified_commit 寫 PENDING_HASH 用於 slice 內 amend 占位、commit 後 git commit --amend 補真 hash
#   - design_value 段引用 design-reference 字面、不憑記憶(對齊 working-style 第 11 條)

version: "1.0"

last_global_sync:
  design_submodule_commit: "637dafc"
  design_submodule_date: "2026-05-21"
  audited_at: "2026-05-22"
  audited_by: "Cowork(M-1-13H session 結束時對齊)"

components:
  # ---- 商品系列(M-1-13H 改版完成、M-1-13I 修 3 bug 範圍) ----

  ProductsPage:
    storefront:
      component: "apps/storefront/src/components/ProductsPage.tsx"
      css: "apps/storefront/src/styles/products-page.css"
      last_modified_commit: "1b61a9d"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/ProductsPage.jsx"
      css: "design-reference/styles/products-page.css"
      data_mock: "design-reference/data/products.js"
    related_storefront:
      - "apps/storefront/src/components/VehicleFinder.tsx"
      - "apps/storefront/src/components/ProductCard.tsx"
      - "apps/storefront/src/components/CascadeFilterTop.tsx"
      - "apps/storefront/src/components/FilterSide.tsx"
      - "apps/storefront/src/components/FilterDrawer.tsx"
      - "apps/storefront/src/components/Pagination.tsx"
      - "apps/storefront/src/components/ActiveChips.tsx"
    business_overrides:
      - field: "outOfStockUI"
        design_value: "顯示庫存數字"
        storefront_value: "4 處 disabled + 補貨中字面、不顯庫存數字"
        decided_at: "2026-05-21"
        decision_source: "STATUS L24 (#161 M-1-13e-pre-3 起延伸)"
        backlog: "#161"
        reason: "Sean 業務拍板、Phase 1 不顯庫存"
    open_drifts:
      - field: "vehicleStatePersistenceCrossPage"
        note: "M-1-13I 待修 bug 1:ProductsPage 不讀 URL ?vehicle=、車種跨頁丟失"
        plan: "handoff/2026-05-22-end-of-session.md §5 Q1+Q2 待 Sean 拍板"
        backlog: "#151 + #152"

  VehicleFinder:
    storefront:
      component: "apps/storefront/src/components/VehicleFinder.tsx"
      css: "apps/storefront/src/styles/vehicle-drawer.css"
      last_modified_commit: "(未動於本輪 session)"
      last_modified_date: "(待 amend)"
    design:
      component: "design-reference/components/HomePage.jsx"  # VehicleFinder 在 design 是 HomePage 內元素
      css: "design-reference/styles/vehicle-drawer.css"
    related_storefront:
      - "apps/storefront/src/components/ProductsPage.tsx"
      - "apps/storefront/src/components/ProductPage.tsx"
    business_overrides: []
    open_drifts:
      - field: "urlFormatInconsistency"
        note: "M-1-13I 待修 bug 1:VehicleFinder push ?brand=X&model=Y&year=Z(3 param) vs ProductsPage/ProductPage 用 ?vehicle=brand:model:year(1 param)"
        plan: "handoff §5 Q1 拍 URL 格式統一、推薦 A=1 param"
        backlog: "#151"

  ProductPage:
    storefront:
      component: "apps/storefront/src/components/ProductPage.tsx"
      css: "apps/storefront/src/styles/product-page.css"
      last_modified_commit: "1b61a9d"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/ProductPage.jsx"
      reference: "design-reference/components/explorations/VariantCFull.jsx"  # M-1-13H 改版真權威字面源、explorations 屬例外(對齊 STATUS L24 Q6 待刪)
      css: "design-reference/styles/product-page.css"
      explorations_css: "design-reference/styles/explorations.css"  # 同上
      handoff_doc: "design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md"
    related_storefront:
      - "apps/storefront/src/components/ProductGallery.tsx"
      - "apps/storefront/src/components/ProductInfo.tsx"
      - "apps/storefront/src/components/ProductServices.tsx"
      - "apps/storefront/src/components/ProductHighlights.tsx"
      - "apps/storefront/src/components/ProductSpotlight.tsx"
      - "apps/storefront/src/components/ProductTabs.tsx"
      - "apps/storefront/src/components/ProductCard.tsx"  # Related grid 用既有元件
      - "apps/storefront/src/components/Price.tsx"
    business_overrides:
      - field: "freeShippingThreshold"
        design_value: "NT$4,000 (VariantCFull L85) / NT$3,000 (L97) — 同檔內已不一致"
        storefront_value: "NT$5,000"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md §2 Q1"
        backlog: "#161"
        reason: "Sean 業務拍板永久化、屬鐵則 1 例外(價格 = 業務邏輯)"
      - field: "mobileBarColor"
        design_value: "黑/灰系(對齊新版商品頁全 mono)"
        storefront_value: "紅色加入購物車保留"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md §2 Q3"
        reason: "Sean Q3=B 業務拍板、轉換率考量、HANDOFF #17『保留不動』解讀 = 行為 + 色系全保留"
      - field: "relatedGridComponent"
        design_value: ".vcf-related-card hardcoded(demo 用)"
        storefront_value: "用既有 <ProductCard> 元件"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md §2 Q4"
        reason: "對齊 lessons §12-37、不複製 demo hardcoded"
      - field: "dealerPriceTag"
        design_value: "L527-532 字面(13e-b 已對齊)"
        storefront_value: "tag 字面對齊但 mock product.price 仍 retail、tier='store'/'premiumStore' 顯 tag 但未真經銷化"
        decided_at: "2026-05-20"
        decision_source: "STATUS L24 + ADR-0006"
        backlog: "#161 + 待 M-1-16"
        reason: "M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分、Phase 1 hardcoded 對沖"
      - field: "hasSpotlightField"
        design_value: "design 無此欄位"
        storefront_value: "MockProduct schema 加 hasSpotlight: boolean、3 件 hardcoded true"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md §2 Q2"
        reason: "Phase 1 業務指定、Phase 2 接 Supabase product_spotlights 欄位名一致對應"
    open_drifts:
      - field: "vehiclePillButton"
        note: "M-1-13I 待修 bug 3:vehiclePill 整個 button onClick={handleClearVehicle}、應拆 pill 本體導航 + × 清除兩層"
        plan: "handoff §5"
      - field: "crumbsHrefMissingVehicle"
        note: "M-1-13I 待修 bug 2:商品頁麵包屑點回商品目錄、href 不帶 vehicle 參數、車種清空"
        plan: "handoff §5"

  ProductHighlights:
    storefront:
      component: "apps/storefront/src/components/ProductHighlights.tsx"
      css: "apps/storefront/src/styles/product-page.css"  # 共用、無獨立 css
      last_modified_commit: "56ccb5c"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/explorations/VariantCFull.jsx"  # M-1-13H 才新加、design 端尚無對應正式檔
    business_overrides:
      - field: "highlightsContent3Cards"
        design_value: "explorations 3 卡 demo 內容"
        storefront_value: "Phase 1 hardcoded 3 卡通用"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md slice-4"
        reason: "L3 對沖(業務拍板 Phase 2 supabase product_highlights 表)、Phase 1 hardcoded"
        phase_2_supabase_table: "product_highlights"

  ProductSpotlight:
    storefront:
      component: "apps/storefront/src/components/ProductSpotlight.tsx"
      css: "apps/storefront/src/styles/product-page.css"
      last_modified_commit: "56ccb5c"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/explorations/VariantCFull.jsx"
    business_overrides:
      - field: "spotlightContent4Sections3Stats"
        design_value: "explorations 4 段 + 3 stats demo"
        storefront_value: "Phase 1 hardcoded、3 件商品標 hasSpotlight true"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md slice-4"
        reason: "L3 對沖、Phase 2 supabase product_spotlights 接"
        phase_2_supabase_table: "product_spotlights"

  ProductTabs:
    storefront:
      component: "apps/storefront/src/components/ProductTabs.tsx"
      css: "apps/storefront/src/styles/product-page.css"
      last_modified_commit: "1d4b4e8"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/explorations/VariantCFull.jsx"
    business_overrides:
      - field: "tabsContent4Panels"
        design_value: "explorations 4 panel demo"
        storefront_value: "Phase 1 hardcoded(specs/install/warranty/description)"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md slice-5"
        reason: "L3 對沖、Phase 2 supabase product_specs / product_installs / site_policies 表接"
        phase_2_supabase_tables: ["product_specs", "product_installs", "site_policies"]

  ProductServices:
    storefront:
      component: "apps/storefront/src/components/ProductServices.tsx"
      css: "apps/storefront/src/styles/product-page.css"
      last_modified_commit: "eb1e90f"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/explorations/VariantCFull.jsx"
    business_overrides:
      - field: "servicesContent4Conditions"
        design_value: "explorations 4 條服務承諾 demo"
        storefront_value: "Phase 1 hardcoded、免運門檻 NT$5,000(對齊 ProductPage freeShippingThreshold)"
        decided_at: "2026-05-21"
        decision_source: "docs/specs/M-1-13H-product-page-overhaul-plan.md slice-3"
        reason: "Phase 2 supabase site_services 表接"
        phase_2_supabase_table: "site_services"

  ProductCard:
    storefront:
      component: "apps/storefront/src/components/ProductCard.tsx"
      css: "apps/storefront/src/styles/product-card.css"
      last_modified_commit: "(M-1-13H 期間未獨立改、引用上游動)"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/ProductCard.jsx"
      css: "design-reference/styles/product-card.css"
    related_storefront:
      - "apps/storefront/src/components/ProductsPage.tsx"
      - "apps/storefront/src/components/ProductPage.tsx"  # Related grid
    business_overrides: []

  ProductGallery:
    storefront:
      component: "apps/storefront/src/components/ProductGallery.tsx"
      css: "apps/storefront/src/styles/product-page.css"
      last_modified_commit: "a8f5a01"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/explorations/VariantCFull.jsx"
      reference: "design-reference/components/ProductPage.jsx"
    business_overrides: []

  ProductInfo:
    storefront:
      component: "apps/storefront/src/components/ProductInfo.tsx"
      css: "apps/storefront/src/styles/product-page.css"
      last_modified_commit: "79f89bc"
      last_modified_date: "2026-05-22"
    design:
      component: "design-reference/components/explorations/VariantCFull.jsx"
    business_overrides:
      - field: "tierPropPassthrough"
        design_value: "design 無明示 tier 三 tier 渲染邏輯"
        storefront_value: "tier prop 傳遞鏈 ProductPage → ProductInfo、tier='general'/'store'/'premiumStore' 條件渲染經銷 tag"
        decided_at: "2026-05-20"
        decision_source: "STATUS L24 (#130 + M-1-13e-pre-1 Q1=B + M-1-13e-a)"
        reason: "業務拍板抽 tier helper、Phase 1 mock"

  # ---- 共用 / 首頁系列 ----

  Header:
    storefront:
      component: "apps/storefront/src/components/Header.tsx"
      css: "apps/storefront/src/styles/header.css"
      last_modified_commit: "7f99033"
      last_modified_date: "(M-1-04 期間)"
    design:
      component: "design-reference/components/Header.jsx"
      css: "design-reference/styles/header.css"
    business_overrides:
      - field: "handleNavFallback"
        design_value: "design 無 fallback"
        storefront_value: "保留 onNav fallback 對齊 HeaderProps 合約(對齊 lessons §12-28)"
        decided_at: "2026-05-11"
        decision_source: "lessons §12-28"
        reason: "鐵則 11 事實 > 字面允許範圍、commit body 已揭示"

  HomeHero:
    storefront:
      component: "apps/storefront/src/components/HomeHero.tsx"
      css: "apps/storefront/src/styles/home.css"
      last_modified_commit: "(早於 M-1-13H)"
      last_modified_date: "(待 amend)"
    design:
      component: "design-reference/components/HomePage.jsx"
      css: "design-reference/styles/home.css"
    business_overrides: []

  # ---- 會員系列(M-1-14 / M-1-15 待動範圍) ----

  AccountPages:
    storefront:
      component: "(M-1-15 待新建、拆 LoginPage + RegisterPage)"
      css: "(待新建)"
      last_modified_commit: "(未建)"
      last_modified_date: "(待 M-1-15)"
    design:
      component: "design-reference/components/AccountPages.jsx"
      css: "design-reference/styles/account.css"
    business_overrides: []
    open_drifts:
      - field: "loginRegisterPageSplit"
        note: "M-1-15 待新建、design AccountPages.jsx 內含 Login + Register、storefront 拆成兩頁(對齊 Next.js App Router 慣例)"
        plan: "M-1-15 milestone PRD(Cowork 待寫)"

  CheckoutPage:
    storefront:
      component: "(未新建、Phase 1 後期動)"
      last_modified_commit: "(未建)"
    design:
      component: "design-reference/components/CheckoutPage.jsx"
      css: "design-reference/styles/checkout.css"
    business_overrides: []

  # ---- 其他元件(規範段) ----

  # 規範:其他 ~20 個元件條目在後續 slice 觸到才填、避免第一版過大難維護
  # 觸到時必先 grep STATUS / backlog / specs / handoff、不憑記憶(對齊 docs/patterns/cowork-review-chain.md §6)
  # 候選列表(供 Cowork 後續查):
  #   - BrandIndex / CategoryGrid / FeatureEditorial / HomeFooter / HomeSelect / HomeStatement
  #   - FilterDrawer / FilterSide / FilterTop / CascadeFilterTop / ActiveChips / Pagination
  #   - Price(共用)
  #   - SearchOverlay / StorePickerModal / TierComponents / WalletTab(Phase 2 範圍)
  #   - LegalPage / ErrorPage / OrderCompletePage / Pages / Pricing(Phase 1 後期)
```

---

## §D `scripts/design-mirror.mjs`(完整字面)

```javascript
#!/usr/bin/env node
// design-mirror.mjs - PCM 設計 ↔ 現場 對照工具
//
// 用途:
//   Cowork / Code 動 storefront 元件前 Read manifest、列對應 design + 業務 override + 連動檔 + 同步狀態
//   commit pre-check hook 也用此工具寫 .claude/scratch/{slice-id}/inspect.json 證明跑過
//
// 對齊:
//   - rules: 鐵則 8 重大改動先 plan(超 3 檔連動觸發提議)
//   - lessons §12-25 字面內嵌義務(manifest 對照表本身就是字面源、Cowork/Code 不憑記憶)
//   - working-style 第 27 條(純 code 題 Cowork 自決、不丟 Sean、本工具屬此範圍)
//
// 使用:
//   node scripts/design-mirror.mjs --target apps/storefront/src/components/ProductsPage.tsx [--slice-id <id>]
//   node scripts/design-mirror.mjs --validate
//   node scripts/design-mirror.mjs --diff-against-storefront
//   node scripts/design-mirror.mjs --update-sync <ComponentName> --commit-hash <hash>
//   node scripts/design-mirror.mjs --update-global-sync
//
// 依賴: yaml ^2.6.0 (devDep)

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ---- 常數 ----
const REPO_ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(REPO_ROOT, 'docs/design-storefront-manifest.yaml');
const SCRATCH_BASE = resolve(REPO_ROOT, '.claude/scratch');
const RULE_BIG_CHANGE = 3; // 鐵則 8 連動檔 ≥ N 觸發 plan 提議

// ---- 參數解析 ----
const { values, positionals } = parseArgs({
  options: {
    target: { type: 'string' },
    'slice-id': { type: 'string' },
    validate: { type: 'boolean' },
    'diff-against-storefront': { type: 'boolean' },
    'update-sync': { type: 'string' },
    'commit-hash': { type: 'string' },
    'update-global-sync': { type: 'boolean' },
    help: { type: 'boolean' },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`design-mirror.mjs - PCM 設計 ↔ 現場 對照工具

Usage:
  node scripts/design-mirror.mjs --target <storefront-file> [--slice-id <id>]
    inspect 模式:列對應 design + 業務 override + 連動檔 + 同步狀態
    若 --slice-id 提供、寫 .claude/scratch/{slice-id}/inspect.json 供 hook 用

  node scripts/design-mirror.mjs --validate
    驗 manifest 內 storefront / design 對應檔路徑都存在
    
  node scripts/design-mirror.mjs --diff-against-storefront
    對齊 design submodule update 後跑、列「design 端有改但 storefront 沒跟」、寫進 manifest open_drifts

  node scripts/design-mirror.mjs --update-sync <ComponentName> --commit-hash <hash>
    slice 結束後跑、amend 對應 component 的 last_modified_commit + date

  node scripts/design-mirror.mjs --update-global-sync
    design submodule update 後跑、更 last_global_sync 段
`);
  process.exit(0);
}

// ---- Manifest 讀寫 ----
function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  return parseYaml(readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, stringifyYaml(manifest, { lineWidth: 120 }), 'utf8');
}

// ---- 工具 ----
function findComponentByStorefrontPath(manifest, storefrontPath) {
  // 對齊 storefront 字面、不憑記憶
  const norm = (p) => p.replace(/^\.\//, '').replace(/^\//, '');
  for (const [name, entry] of Object.entries(manifest.components || {})) {
    if (norm(entry.storefront?.component || '') === norm(storefrontPath)) {
      return { name, entry };
    }
  }
  return null;
}

function checkFileExists(relPath) {
  return existsSync(resolve(REPO_ROOT, relPath));
}

// ---- --validate ----
function cmdValidate() {
  const manifest = loadManifest();
  let issues = 0;
  for (const [name, entry] of Object.entries(manifest.components || {})) {
    const storefrontComp = entry.storefront?.component;
    const designComp = entry.design?.component;
    // storefront 可能標未建
    if (storefrontComp && !storefrontComp.startsWith('(') && !checkFileExists(storefrontComp)) {
      console.error(`❌ [${name}] storefront file missing: ${storefrontComp}`);
      issues++;
    }
    if (designComp && !designComp.startsWith('(') && !checkFileExists(designComp)) {
      console.error(`❌ [${name}] design file missing: ${designComp}`);
      issues++;
    }
  }
  if (issues === 0) {
    console.log(`✅ Manifest validated, all ${Object.keys(manifest.components || {}).length} components OK`);
    process.exit(0);
  } else {
    console.error(`❌ Found ${issues} broken link(s)`);
    process.exit(1);
  }
}

// ---- --target ----
function cmdTarget(targetPath, sliceId) {
  const manifest = loadManifest();
  const found = findComponentByStorefrontPath(manifest, targetPath);
  if (!found) {
    console.error(`❌ No manifest entry for ${targetPath}`);
    console.error(`提示:若此檔該入 manifest、請 Cowork amend; 若 Phase 2 範圍、加 --skip-manifest-check 略過(待實作)`);
    process.exit(1);
  }
  const { name, entry } = found;
  const lines = [];
  lines.push(`📋 動到的 storefront 元件: ${name}`);
  lines.push(`   檔案: ${entry.storefront.component}`);
  if (entry.storefront.css) lines.push(`   CSS: ${entry.storefront.css}`);
  lines.push(``);
  lines.push(`🎨 對應 design 字面源:`);
  lines.push(`   元件: ${entry.design.component}`);
  if (entry.design.css) lines.push(`   CSS: ${entry.design.css}`);
  if (entry.design.reference) lines.push(`   參考: ${entry.design.reference}`);
  if (entry.design.handoff_doc) lines.push(`   Handoff: ${entry.design.handoff_doc}`);
  lines.push(``);

  const related = entry.related_storefront || [];
  lines.push(`🔗 連動 storefront 檔: ${related.length}`);
  related.forEach((p) => lines.push(`   - ${p}`));
  lines.push(``);

  const overrides = entry.business_overrides || [];
  lines.push(`✅ 業務 override(以下偏離合法、勿當誤翻譯): ${overrides.length}`);
  overrides.forEach((o) => {
    lines.push(`   - ${o.field}`);
    lines.push(`     design: ${o.design_value}`);
    lines.push(`     現場: ${o.storefront_value}`);
    lines.push(`     拍板: ${o.decided_at} ← ${o.decision_source}`);
    if (o.backlog) lines.push(`     backlog: ${o.backlog}`);
    if (o.reason) lines.push(`     reason: ${o.reason}`);
  });
  lines.push(``);

  const drifts = entry.open_drifts || [];
  lines.push(`⚠️  未解決偏離(可能要動 Claude Design / Cowork 寫 PRD): ${drifts.length}`);
  drifts.forEach((d) => {
    lines.push(`   - ${d.field}: ${d.note}`);
    if (d.plan) lines.push(`     plan: ${d.plan}`);
    if (d.backlog) lines.push(`     backlog: ${d.backlog}`);
  });
  lines.push(``);

  lines.push(`🕐 最近設計同步: ${manifest.last_global_sync.design_submodule_commit} (${manifest.last_global_sync.design_submodule_date})`);
  lines.push(`🕐 最近現場修改: ${entry.storefront.last_modified_commit} (${entry.storefront.last_modified_date})`);
  lines.push(``);

  // 鐵則 8 連動檔 ≥ 3 觸發 plan 提議
  if (related.length >= RULE_BIG_CHANGE) {
    lines.push(`⚠️  本 slice 連動 ${related.length} 檔(≥ ${RULE_BIG_CHANGE})、屬鐵則 8 重大改動、Cowork 必先寫 plan 等 Sean 拍`);
  }

  console.log(lines.join('\n'));

  // 寫 inspect.json 供 hook 用
  if (sliceId) {
    const scratchDir = resolve(SCRATCH_BASE, sliceId);
    mkdirSync(scratchDir, { recursive: true });
    const inspectPath = resolve(scratchDir, 'inspect.json');
    writeFileSync(inspectPath, JSON.stringify({
      slice_id: sliceId,
      target: targetPath,
      component_name: name,
      related_count: related.length,
      overrides_count: overrides.length,
      open_drifts_count: drifts.length,
      timestamp: new Date().toISOString(),
      manifest_global_sync: manifest.last_global_sync,
    }, null, 2));
    console.log(`\n📝 寫入 ${inspectPath} 供 commit pre-check hook 檢驗`);
  }
}

// ---- --update-sync ----
function cmdUpdateSync(componentName, commitHash) {
  const manifest = loadManifest();
  if (!manifest.components[componentName]) {
    console.error(`❌ Component "${componentName}" not in manifest`);
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  manifest.components[componentName].storefront.last_modified_commit = commitHash;
  manifest.components[componentName].storefront.last_modified_date = today;
  saveManifest(manifest);
  console.log(`✅ Updated ${componentName} last_modified_commit=${commitHash} date=${today}`);
}

// ---- --update-global-sync ----
function cmdUpdateGlobalSync() {
  const manifest = loadManifest();
  // 從 design-reference submodule 抽當前 commit hash
  const { execSync } = require('node:child_process');
  let hash;
  try {
    hash = execSync('git -C design-reference rev-parse HEAD').toString().trim().slice(0, 7);
  } catch (e) {
    console.error(`❌ Failed to read design-reference submodule HEAD`);
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  manifest.last_global_sync.design_submodule_commit = hash;
  manifest.last_global_sync.design_submodule_date = today;
  manifest.last_global_sync.audited_at = today;
  saveManifest(manifest);
  console.log(`✅ Updated last_global_sync: ${hash} (${today})`);
}

// ---- --diff-against-storefront ----
function cmdDiffAgainstStorefront() {
  // TODO: 對齊 design submodule 當前 vs manifest last_global_sync 差異、列「design 端有改但 storefront 沒跟」
  //       Phase 1 簡化實作:提醒人工檢查、不自動 diff
  console.log(`⚠️  --diff-against-storefront: 簡化實作、提醒人工檢查`);
  console.log(`   1. 跑 git -C design-reference log --oneline ${loadManifest().last_global_sync.design_submodule_commit}..HEAD`);
  console.log(`   2. 看哪些元件改了`);
  console.log(`   3. 在 manifest 對應元件 open_drifts 段加紀錄、等對應 slice 處理`);
  console.log(`   4. 跑 --update-global-sync 更 last_global_sync 段`);
}

// ---- main ----
if (values.validate) {
  cmdValidate();
} else if (values['diff-against-storefront']) {
  cmdDiffAgainstStorefront();
} else if (values['update-sync']) {
  if (!values['commit-hash']) {
    console.error(`❌ --update-sync requires --commit-hash`);
    process.exit(1);
  }
  cmdUpdateSync(values['update-sync'], values['commit-hash']);
} else if (values['update-global-sync']) {
  cmdUpdateGlobalSync();
} else if (values.target) {
  cmdTarget(values.target, values['slice-id']);
} else {
  console.error(`❌ No mode specified. Use --help`);
  process.exit(1);
}
```

---

## §E `.claude/agents/code-reviewer.md`(完整字面)

```markdown
---
name: code-reviewer
description: PCM Code Review subagent (階段 C). 抓 PCM 鐵則 1-12 違反 / 字面 vs 事實偏離 / manifest 同步紀錄不正確 / commit message 對齊實際 diff. fresh context 對抗審查、由 main session 用 Task tool spawn、reviewer 唯讀不修.
tools: Read, Grep, Glob, Bash
---

# code-reviewer

你是 PCM 工作流的階段 C code-reviewer subagent。fresh context、唯讀、對抗審查 main session implementer 剛寫的字面。

## 你的職責

對 main session 即將 commit 的字面、抓:
1. **PCM 鐵則 1-12 違反**(下方 §A 摘錄、避免你看不到 CLAUDE.md)
2. **字面 vs 事實偏離**(commit body 聲稱 X、實際 diff 做 Y)
3. **manifest 同步紀錄正確**(動 storefront 元件、manifest 該元件 last_modified_commit 該 amend)
4. **commit message 格式**(對齊 `type(scope): subject [optional milestone-id]` + 繁中祈使句 + ≤72 字元)
5. **業務 override 紀錄不誤判**(從 manifest 讀對應元件 business_overrides 段、prompt 帶過來、若 diff 內偏離已在 overrides、不報)

## 你不做的事

- 不修 code、不 commit、不 push、不改 manifest
- 不審視覺(對齊 Sean Q2=B 階段 E 肉眼驗)
- 不審 milestone 級風險(階段 D Codex Review 範圍)
- 不審通用 N+1 / 邊界 case / a11y(/slice-checkpoint 之後 skill audit 可選範圍)

## 你的輸入(由 main session prompt 帶來)

main session spawn 你時、必帶以下字面:
- 本 slice 的 slice 指令字面(六件套)
- git diff --staged 完整字面
- 對應元件 manifest 段(business_overrides + open_drifts)
- 本 slice 預期 commit message subject(草稿)
- 動到的檔案清單

## 你的輸出格式

```
[code-reviewer report]
PASS | FAIL

Findings:
- [Critical / Important / Minor] 議題 1 描述、行號、修法建議
- ...

manifest_sync_check: ✅ / ❌(說明)
commit_message_check: ✅ / ❌(說明)
business_override_check: ✅ / ❌(說明)
鐵則 1-12 違反: 列違反的鐵則編號 + 具體位置
```

PASS 條件:
- 0 個 Critical
- 鐵則 1-12 無違反
- manifest 同步紀錄正確
- commit message 對齊實際 diff

FAIL 時:
- main session 讀你的 findings、main session 自修 ≤2 輪、再 spawn 你一次新 fresh context 驗
- 你不修、main session 修

---

## §A PCM 鐵則 1-12 摘錄(對齊 CLAUDE.md / AGENTS.md、避免你看不到原檔)

1. **直接搬 design、不翻譯、不重寫** — 寫前台元件前必先 grep design-reference 字面;slice 禁「翻譯 / 對齊 / 重寫」字眼;不畫預覽 / 不憑想像
2. **後台對應 design**(M-1-13H 之後改 Supabase schema 對應、廢 Medusa)
3. **前後台同步、不分階段** — 動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit
4. **Slice 15-45 分鐘可中斷** — 超過必拆
5. **CSS + TSX 雙檔聯動單一 slice** — 同元件不拆兩 slice
6. **檔案大小硬上限** — 元件 >400 行必拆 / >300 硬警戒 / Hook >200 注意
7. **Orchestrator 永久禁用** — 複雜工作用單 session 順序執行
8. **重大改動前先提 plan** — 跨 3+ 檔 / 動 schema·API·共用元件·config / 影響部署 / 影響資料遷移
9. **L1/L2/L3 內容分級** — L3 強制停 slice 寫 PRD(發現業務拍板對沖、見 manifest business_overrides)
10. **三視角檢查** — 擴充性 / 可維護性 / bug 追蹤性
11. **Slice 收工三綠 + 字面 vs 事實** — typecheck + lint + 條件 build 全綠才 commit / commit body 對齊實際內容、偏離寫揭示段
12. **重大改動 / 進度結束產 Codex Review Packet** — security / RLS / migration / pricing / order / milestone 結束

## §B 跟其他 review 層的分工

- 你是「slice 級、fresh context、PCM 專屬鐵則 + 字面 vs 事實」
- /slice-checkpoint 跑工具(typecheck / lint / build / manifest sync schema)、你跑邏輯審
- skill audit(可選)= 通用 N+1 / a11y / 邊界 case、補你看不到的
- Codex Review = milestone 級、跨 slice 一致性、Sean 貼外部 AI
- Sean 肉眼驗 = 視覺 / 操作 / 業務流程

不重抄、不擴張你的範圍。

— END —
```

---

## §F `.claude/settings.json`(完整字面)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "comment_for_humans": "PCM 工作流 hook 配置。對齊 Stage 3 終版 v4 self-audit §7+§9+§13. settings.local.json 是個人設定不入 repo, 本檔是 repo 共享設定入 git.",

  "permissions": {
    "deny": [
      "Bash(cat .env*)",
      "Bash(cat ~/.env*)",
      "Bash(*>.env*)",
      "Bash(*>>.env*)"
    ]
  },

  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "comment": "封 .env.local 寫(對齊 working-style 第 25 條 + lessons §12-15)",
        "hooks": [
          {
            "type": "command",
            "command": "node -e 'const p=process.env.CLAUDE_TOOL_INPUT_FILE_PATH||\"\";if(/\\.env(\\.|$)/.test(p)){console.error(\".env* 受保護、改 dashboard 或 Sean Terminal 操作\");process.exit(1)}'"
          }
        ]
      },
      {
        "matcher": "Edit",
        "comment": "封 .env.local 改",
        "hooks": [
          {
            "type": "command",
            "command": "node -e 'const p=process.env.CLAUDE_TOOL_INPUT_FILE_PATH||\"\";if(/\\.env(\\.|$)/.test(p)){console.error(\".env* 受保護、改 dashboard 或 Sean Terminal 操作\");process.exit(1)}'"
          }
        ]
      },
      {
        "matcher": "Bash",
        "comment": "commit pre-check: 動 storefront 必有 design-mirror.mjs 跑過(.claude/scratch/{slice-id}/inspect.json 存在 + 時間戳 < 1 小時)",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/hooks/pre-commit-check.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "comment": "守 code-reviewer 沒跑就不允許 commit. 實作:檢查最近 spawn 的 subagent 名稱、若 implementer 跑了但 code-reviewer 未跑、攔 git commit 工具呼叫",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/hooks/subagent-stop-check.mjs"
          }
        ]
      }
    ]
  },

  "_implementation_notes": [
    "scripts/hooks/pre-commit-check.sh 跟 scripts/hooks/subagent-stop-check.mjs 是輔助腳本、Stage 3 落地時 Code 一併建(精簡版、純 bash + node)",
    "若 hook 機制在 Claude Code 2026-05 語法有差、Code 跑前 web_search 確認、不憑記憶",
    "settings.local.json(個人設定)不動、本檔是 repo 共享、進 git"
  ]
}
```

> **註:** 本檔含 `scripts/hooks/pre-commit-check.sh` 和 `scripts/hooks/subagent-stop-check.mjs` 兩個輔助腳本路徑、Code 落字面時一併寫(精簡版、字面對齊上方 comment 說明、Code 自決細節)。

— END(bundle-code、4 個 code 類 deliverable 完整字面)—
