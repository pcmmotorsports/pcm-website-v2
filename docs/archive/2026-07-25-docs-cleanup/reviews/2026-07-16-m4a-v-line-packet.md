# Codex Review Packet — M-4a V 線(愛車/車款 context 全站串線)九 commit 補審

Mode: 唯讀審查,不要修改檔案。只回 findings / 風險 / 是否可繼續。

Repo: /Users/sean_1/pcm-website-v2(你無需 repo 存取,本包自帶重點 diff 與規則摘錄)

## 1. Slice / 目標

M-4a「V 線」= 會員愛車與車款 context 的全站串線,2026-07-15 晚一夜九個 commit(範圍 `0011f87..74535fe`、皆已過 code-reviewer + Fable 值班台逐片複核):

| Commit | 內容 |
|---|---|
| 0011f87 | V-1e 型錄「我的愛車」鈕(決策腦抽 lib/garage-chip、桌機+手機兩掛載點 dispatch 進 cascade) |
| 5705608 | V-2a 購物車車款欄(CartItem 判別式 vehicle union、四帶入路徑、setItemVehicle/setAllItemsVehicle) |
| 447bf10 | V-2a nit:CartVehicleField commit 移出 setState updater(純度) |
| c7581fa | V-1f 手機車輛 tab 跨層直搜+置頂 sticky 群組+無年份出口 |
| ea32dc4 | V-2b 商品頁「是否適用我的車」§7 保守比對(matchFitmentYear 升 domain、checkFitment 四態) |
| e686d71 | V-2a2 購物車料號恆顯(ResolvedCartLine 加 sku)+車款欄文字顯眼化 |
| 26b3d8e | V-2c 急件:選車 context 鏡過期修復(URL 第一真相、型錄同步鏡、PDP 優先 URL) |
| 241f57b | V-2e 購物車車款不符紅膠囊(ResolvedCartLine 加 fitments 公開投影、client 判定) |
| 74535fe | V-2d 手機 UX 批次(首頁 chips 捲條/PDP 收合殼/點選收鍵盤) |

內容分級: L1(純功能 UI + client 狀態,無內容模型、無 schema)
重大改動判定: 命中鐵則 8(跨 3+ 檔、動共用元件、domain 升層)+鐵則 12「進度單元收尾」(V 線收整)。
⚠️ 誠實揭示:本包為**代推後補審**(偏離「commit 前產包」慣例)——M-4a 值班台體制下每片已由 code-reviewer(fresh context)+Fable 值班台雙層審查後 OPS 授權代推 dev;Sean 問及 codex 後補此包作跨模型第三眼。dev→main(正式站)尚未推、等本包 findings 與 Sean 拍板=最終 gate 仍在。

## 2. 目前狀態
```
dev
## dev...origin/dev
 M .gitignore
?? admin-orders.png
?? docs/handoff/2026-07-13-email-notification-slice-plan.md
?? docs/handoff/2026-07-13-issue-215-tier-server-auth-plan.md
74535fe fix(storefront): V-2d 手機 UX 批次首頁愛車捲條+PDP 收合+收鍵盤 [m-4a]
241f57b feat(storefront): V-2e 購物車車款不符顯紅膠囊可能不適用 [m-4a]
26b3d8e fix(storefront): V-2c 選車 context 鏡過期修復 URL 第一真相 [m-4a]
e686d71 feat(storefront): V-2a2 購物車料號恆顯 + 車款欄文字顯眼化 [m-4a]
ea32dc4 feat(storefront): V-2b 商品頁「是否適用我的車」§7 保守適用比對 [m-4a]
c7581fa feat(storefront): V-1f 手機車輛 tab 跨層直搜+置頂群組+無年份出口 [m-4a]
447bf10 fix(storefront): V-2a nit 純度修 CartVehicleField commit 移出 setSel updater [m-4a]
5705608 feat(storefront): V-2a 購物車車款欄(判別式 vehicle union+四帶入路徑) [m-4a]
0011f87 feat(storefront): V-1e 型錄「我的愛車」鈕(共用決策腦、dispatch 進 cascade) [m-4a]
57ee31a chore(git): 接回 main 單挑止血歷史(8ff8d0a)供 FF 推正式 [m-4a]
```

## 3. Changed files(九 commit 聯集)

```
STATUS.md
apps/storefront/src/app/cart/actions.test.ts
apps/storefront/src/app/cart/actions.ts
apps/storefront/src/app/cart/page.tsx
apps/storefront/src/app/layout.tsx
apps/storefront/src/app/products/[slug]/page.tsx
apps/storefront/src/app/products/page.tsx
apps/storefront/src/components/CartVehicleField.test.tsx
apps/storefront/src/components/CartVehicleField.tsx
apps/storefront/src/components/CartView.test.tsx
apps/storefront/src/components/CartView.tsx
apps/storefront/src/components/CascadeFilterTop.tsx
apps/storefront/src/components/CheckoutStep3.test.tsx
apps/storefront/src/components/CheckoutView.test.tsx
apps/storefront/src/components/FilterDrawer.tsx
apps/storefront/src/components/FilterDrawerVehicleTab.test.tsx
apps/storefront/src/components/FilterDrawerVehicleTab.tsx
apps/storefront/src/components/GarageChips.test.tsx
apps/storefront/src/components/GarageChips.tsx
apps/storefront/src/components/ProductFitmentCheck.test.tsx
apps/storefront/src/components/ProductFitmentCheck.tsx
apps/storefront/src/components/ProductInfo.test.tsx
apps/storefront/src/components/ProductInfo.tsx
apps/storefront/src/components/ProductPage.tsx
apps/storefront/src/components/ProductsPage.tsx
apps/storefront/src/components/VehicleFinder.tsx
apps/storefront/src/components/VehicleSelect.test.tsx
apps/storefront/src/components/VehicleSelect.tsx
apps/storefront/src/components/products-url-state.tsx
apps/storefront/src/components/use-vehicle-url-sync.test.tsx
apps/storefront/src/contexts/CartContext.test.tsx
apps/storefront/src/contexts/CartContext.tsx
apps/storefront/src/lib/fitment-match.test.ts
apps/storefront/src/lib/fitment-match.ts
apps/storefront/src/lib/garage-chip.test.ts
apps/storefront/src/lib/garage-chip.ts
apps/storefront/src/lib/vehicle-context.test.ts
apps/storefront/src/lib/vehicle-context.ts
apps/storefront/src/styles/cart-vehicle.css
apps/storefront/src/styles/cart.css
apps/storefront/src/styles/filter-cascade.css
apps/storefront/src/styles/filter-drawer.css
apps/storefront/src/styles/home.css
apps/storefront/src/styles/product-page.css
docs/design-storefront-manifest.yaml
packages/adapters/src/supabase/helpers/fitment.ts
packages/domain/src/catalog/year-range.test.ts
packages/domain/src/catalog/year-range.ts
packages/domain/src/index.ts
```

```
 apps/storefront/src/styles/home.css                |  24 +++
 apps/storefront/src/styles/product-page.css        |  85 ++++++++
 docs/design-storefront-manifest.yaml               |  64 ++++--
 packages/adapters/src/supabase/helpers/fitment.ts  |  27 +--
 packages/domain/src/catalog/year-range.test.ts     |  50 +++++
 packages/domain/src/catalog/year-range.ts          |  34 ++++
 packages/domain/src/index.ts                       |   2 +-
 49 files changed, 2702 insertions(+), 205 deletions(-)
```

## 4. 重點 diff(review-critical 面、聯集;CSS/測試/STATUS/manifest 略、檔名見上)

```diff
diff --git a/apps/storefront/src/lib/fitment-match.ts b/apps/storefront/src/lib/fitment-match.ts
new file mode 100644
index 0000000..fa81edb
--- /dev/null
+++ b/apps/storefront/src/lib/fitment-match.ts
@@ -0,0 +1,55 @@
+// fitment-match.ts — 商品頁「是否適用我的車」§7 保守比對核心(V-2b;純函式、node 單測)。
+//
+// 🔴 §7 正確性紅線:錯誤的「✓ 適用」比空白更糟(買錯裝不上=信任毀)。規則:
+//  - slug 同源橋接:slugify(fitment.motoBrand/modelCode) vs 消費者 brandId/modelId(皆 taxonomy slug、
+//    與 URL/context 同空間;重用 lib/vehicle-taxonomy.slugify、同 ProductPage vehiclePill 先例;
+//    禁混空間直接比、禁自寫正規化)。
+//  - 年份判定一律呼 domain matchFitmentYear / isYearUnrestricted(年份語意單一來源;storefront 禁自寫
+//    任何年份判定行=S4 語意分叉教訓)。使用者單年=退化區間 {yearStart:Y, yearEnd:Y}。
+//  - 車種鐵律:零模糊/相似度/AI 猜;查無=保守方向('no-match' ✗ 未列,非 undetermined)。
+//  - display-only:呼叫端只顯示、不寫庫、不擋加入購物車。
+
+import { matchFitmentYear, isYearUnrestricted } from '@pcm/domain';
+import { slugify } from '@/lib/vehicle-taxonomy';
+import type { UIFitment } from '@/data/mock-products';
+
+/** 消費者選車(dict=slug 空間,來自 vehicle-context;free=自由輸入/車庫舊自由文字)。 */
+export type FitmentCheckVehicle =
+  | { kind: 'dict'; brandId: string; modelId?: string; year?: number }
+  | { kind: 'free' };
+
+/**
+ * 判定四態(§7):
+ * - match       車型+年份命中(或車型命中且含不限年份 fitment)→「✓ 適用」
+ * - no-match    車型未列 / 車型列了但該年份不合 →「✗ 未列」
+ * - qualified   車型命中、但命中 fitments 皆年份受限而使用者未給年份 → 禁 bare ✓、顯「請確認年份」
+ * - undetermined 自由輸入 / brandId·modelId 不齊 → 不自動判定、走「人工確認」
+ */
+export type FitmentCheckStatus = 'match' | 'no-match' | 'qualified' | 'undetermined';
+
+export function checkFitment(fitments: UIFitment[], v: FitmentCheckVehicle): FitmentCheckStatus {
+  // 自由輸入 → 不判定(§7:人工確認)
+  if (v.kind === 'free') return 'undetermined';
+  // REQUIRED-2:brandId 且 modelId 齊全才判定;缺 modelId(brand-only/選車中途)禁 brand-level ✓
+  if (!v.brandId || !v.modelId) return 'undetermined';
+
+  // slug 同源橋接:車型層命中的 fitments(brand+model 皆 slug 相等)
+  const modelHits = fitments.filter(
+    (f) => slugify(f.motoBrand) === v.brandId && slugify(f.modelCode) === v.modelId,
+  );
+  if (modelHits.length === 0) return 'no-match'; // 車型未列(安全方向 ✗)
+
+  if (v.year !== undefined) {
+    // 使用者給年:退化區間呼 domain matchFitmentYear(不自寫年份比較)
+    const actual = { yearStart: v.year, yearEnd: v.year };
+    // 🔴 yearEnd 直傳(null=開放式 2025+ 語意;禁 ?? undefined 塌成單年);matchFitmentYear 收 number|null|undefined
+    const anyYear = modelHits.some((f) =>
+      matchFitmentYear(actual, { yearStart: f.yearStart, yearEnd: f.yearEnd }),
+    );
+    return anyYear ? 'match' : 'no-match'; // 車型列了但年份不合=✗(REQUIRED-3 反向)
+  }
+
+  // 使用者年份未知:唯有命中含不限年份 fitment(domain 判定)才可 bare ✓;否則保守 qualified
+  const hasUnrestricted = modelHits.some((f) => isYearUnrestricted(f));
+  return hasUnrestricted ? 'match' : 'qualified';
+}
diff --git a/apps/storefront/src/lib/garage-chip.ts b/apps/storefront/src/lib/garage-chip.ts
new file mode 100644
index 0000000..79a7e0d
--- /dev/null
+++ b/apps/storefront/src/lib/garage-chip.ts
@@ -0,0 +1,116 @@
+// garage-chip.ts — 愛車 chip 點擊決策(V-1c/V-1d 邏輯單一來源)。
+// 首頁 VehicleFinder(V-1c)+ 型錄「我的愛車」鈕(V-1e)共用同一顆決策腦、外殼依掛載點變形。
+//
+// 🔴 車種鐵律:只做字面正規化比對(NFKC/prefix/substring,經 vehicle-match),零模糊/相似度/AI 猜。
+// 分支順序逐字對齊原 VehicleFinder.onGarageChip(18877be):
+//   dict 精確 lookup 快路徑 → REQUIRED-2 唯一精確命中(全名→車型名雙鍵)→ 多/零命中建議清單。
+// 年份閘門(車庫 year=自由文字 → 僅四位數字且在字典年份內才帶入)一併收進本函式,
+//   外殼不得自行 parse year(值班台 nit-1:回傳 year 恆為已通過閘門的 number | undefined)。
+
+import type { MockMotoBrand, MockMotoModel } from '@/data/mock-moto-brands';
+import { filterVehicleOptions, uniqueExactMatch, vehicleLabel } from '@/lib/vehicle-match';
+
+/** 愛車 chip 決策所需的車庫最小面(序列化收窄、無 PII)。 */
+export type GarageVehicleInput = {
+  name: string;
+  year: string;
+  dictBrandName: string | null;
+  dictModelName: string | null;
+};
+
+/** 套用結果:已解析的品牌/車型名稱字面 + 已通過閘門的年份。 */
+export type GarageChipApply = {
+  kind: 'apply';
+  brand: string;
+  model: string;
+  year: number | undefined;
+};
+
+/** 多/零命中:展開建議清單讓客人明選(entries=字典 label 字面)。 */
+export type GarageChipSuggest = {
+  kind: 'suggest';
+  query: string;
+  entries: string[];
+  garageYear: number | undefined;
+};
+
+export type GarageChipResult = GarageChipApply | GarageChipSuggest;
+
+/** 攤平字典一項:每車型 brand+model 與「品牌 車型」label(跨層搜尋/建議清單共用字面空間)。 */
+export type FlatVehicleEntry = { brand: MockMotoBrand; model: MockMotoModel; label: string };
+
+/**
+ * 攤平字典:每車型一項(brand+model 與「品牌 車型」label)。
+ * 愛車 chip 建議清單(本檔)+ 手機抽屜跨層直搜(FilterDrawerVehicleTab、V-1f)共用同一顆——
+ * 打字在「品牌 車型」字面空間跨層命中(打 r6 直達車款),車種鐵律零猜、字典字面直出。
+ */
+export function flattenVehicleModels(motoBrands: MockMotoBrand[]): FlatVehicleEntry[] {
+  return motoBrands.flatMap((b) =>
+    b.models.map((m) => ({ brand: b, model: m, label: vehicleLabel(b.name, m.name) })),
+  );
+}
+
+/** 車庫 year=自由文字 → 僅四位數字才為候選年份、其餘 undefined(零猜)。 */
+function parseGarageYear(raw: string): number | undefined {
+  const t = raw.trim();
+  return /^\d{4}$/.test(t) ? Number(t) : undefined;
+}
+
+/** 已定 brand/model + 車庫候選年份 → 年份僅在字典 years 內才帶入。 */
+function resolveApply(
+  brand: MockMotoBrand,
+  model: MockMotoModel,
+  garageYear: number | undefined,
+): GarageChipApply {
+  const year = garageYear != null && model.years.includes(garageYear) ? garageYear : undefined;
+  return { kind: 'apply', brand: brand.name, model: model.name, year };
+}
+
+/**
+ * 愛車 chip 點擊 → 套用 or 建議清單(決策腦、無 React/DOM 依賴 → node 單測)。
+ */
+export function resolveGarageChip(
+  motoBrands: MockMotoBrand[],
+  garage: GarageVehicleInput,
+): GarageChipResult {
+  const entries = flattenVehicleModels(motoBrands);
+  const garageYear = parseGarageYear(garage.year);
+
+  // V-1d 分流:dict 欄有值(存車時 server 已驗)→ 名稱字面精確 lookup 直套(零比對);
+  // lookup 查無(字典演化:改名/下架)→ 降級走下方 REQUIRED-2 字面比對流、零猜不硬配。
+  if (garage.dictBrandName !== null && garage.dictModelName !== null) {
+    const brand = motoBrands.find((b) => b.name === garage.dictBrandName);
+    const model = brand?.models.find((m) => m.name === garage.dictModelName);
+    if (brand && model) {
+      return resolveApply(brand, model, garageYear);
+    }
+  }
+
+  // 唯一精確命中(正規化=trim/大小寫/全形半形)才自動套用:先比「品牌 車型」全名、再比車型名。
+  const exact =
+    uniqueExactMatch(entries, garage.name, (e) => e.label) ??
+    uniqueExactMatch(entries, garage.name, (e) => e.model.name);
+  if (exact) return resolveApply(exact.brand, exact.model, garageYear);
+
+  // 多/零命中 → 建議清單(字典字面經正規化 substring 過濾;客人明選=零猜)。
+  const hits = filterVehicleOptions(entries, garage.name, (e) => e.label);
+  return {
+    kind: 'suggest',
+    query: garage.name,
+    entries: hits.slice(0, 12).map((e) => e.label),
+    garageYear,
+  };
+}
+
+/**
+ * 建議清單點選:label(字典字面)→ entry → apply(garageYear 同閘門帶入)。
+ * label 查無(理論不達:entries 恆源自 flattenVehicleModels)→ null,呼叫端不套用。
+ */
+export function resolveSuggestionLabel(
+  motoBrands: MockMotoBrand[],
+  label: string,
+  garageYear: number | undefined,
+): GarageChipApply | null {
+  const entry = flattenVehicleModels(motoBrands).find((e) => e.label === label);
+  return entry ? resolveApply(entry.brand, entry.model, garageYear) : null;
+}
diff --git a/apps/storefront/src/lib/vehicle-context.ts b/apps/storefront/src/lib/vehicle-context.ts
index 6298469..5f83e0e 100644
--- a/apps/storefront/src/lib/vehicle-context.ts
+++ b/apps/storefront/src/lib/vehicle-context.ts
@@ -14,6 +14,11 @@ export type VehicleContextValue = {
   year?: number;
   /** 顯示 label(字典字面組合;僅顯示用、比對一律回字典) */
   label: string;
+  // V-2a REQUIRED-3(值班台):字典名稱字面 additive optional 欄——寫入點本手握名稱、供購物車
+  // 自動帶入(路徑1)組 CartItem kind:'dict' 用(避免 label 反解析=脆)。舊 context 缺此欄
+  // → 讀回為 undefined → 消費端不自動帶入(零猜);不 bump KEY=非 breaking、防禦讀取容缺欄。
+  brandName?: string;
+  modelName?: string;
   savedAt: number;
 };

@@ -63,11 +68,16 @@ export function readVehicleContext(
     if (o.modelId !== undefined && typeof o.modelId !== 'string') return null;
     if (o.year !== undefined && !Number.isInteger(o.year)) return null;
     if (typeof o.label !== 'string' || typeof o.savedAt !== 'number') return null;
+    // additive 名稱字面欄:present 必為 string、缺欄=undefined(舊 context 相容、不擋整筆)
+    if (o.brandName !== undefined && typeof o.brandName !== 'string') return null;
+    if (o.modelName !== undefined && typeof o.modelName !== 'string') return null;
     return {
       brandId: o.brandId,
       modelId: o.modelId as string | undefined,
       year: o.year as number | undefined,
       label: o.label,
+      brandName: o.brandName as string | undefined,
+      modelName: o.modelName as string | undefined,
       savedAt: o.savedAt,
     };
   } catch {
diff --git a/packages/adapters/src/supabase/helpers/fitment.ts b/packages/adapters/src/supabase/helpers/fitment.ts
index d2ec64f..965ef2f 100644
--- a/packages/adapters/src/supabase/helpers/fitment.ts
+++ b/packages/adapters/src/supabase/helpers/fitment.ts
@@ -1,4 +1,4 @@
-import { resolveEnd, type FitmentSpec } from '@pcm/domain';
+import { type FitmentSpec } from '@pcm/domain';

 /**
  * fitment 結構化 helpers(對齊 docs/specs/M-1-03-main-b-PRD.md §5.2 / §5.3 / §5.5
@@ -104,25 +104,8 @@ export function parseWireFitment(str: string): FitmentSpec {
 }

 /**
- * 年份範圍重疊判定(規則 3、對齊 InMemoryProductRepository.matchFitment 重構後等價)。
- *
- * 規則:
- * - 任一邊 yearStart undefined → return true(無年份限制 = 不限年份)
- * - 否則:actualEnd / specEnd 用 resolveEnd 解析
- *   (actual / spec 兩端對稱處理 yearEnd null/undefined、對齊 backlog #94)
- * - 範圍重疊判定:actual.start ≤ spec.end 且 spec.start ≤ actual.end
- *
- * **使用前提:** 本 helper 只負責年份範圍判定、**不**比對 motoBrand / modelCode。
- * 預期搭配 listByFitment SQL `.contains('fitments', [{motoBrand, modelCode}])` server-side
- * prefilter 後使用;若孤立呼叫(例 InMemory 走規則 1+2+3 全部 in-memory、見其 matchFitment private),
- * 必須上游自行處理 motoBrand / modelCode 配對、否則回傳 true 不代表整體 match。
- *
- * @see resolveEnd(packages/domain/src/catalog/year-range.ts)
- * @see packages/adapters/src/in-memory/InMemoryProductRepository.ts matchFitment 規則 3
+ * 年份範圍重疊判定(V-2b 起升 domain=年份語意單一來源;本處改 re-export、既有呼叫零漂移)。
+ * 語意/簽名逐字不變(actual/spec 只判年份、不比 motoBrand/modelCode)。
+ * @see packages/domain/src/catalog/year-range.ts matchFitmentYear
  */
-export function matchFitmentYear(actual: FitmentSpec, spec: FitmentSpec): boolean {
-  if (actual.yearStart === undefined || spec.yearStart === undefined) return true;
-  const actualEnd = resolveEnd(actual.yearStart, actual.yearEnd);
-  const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);
-  return actual.yearStart <= specEnd && spec.yearStart <= actualEnd;
-}
+export { matchFitmentYear } from '@pcm/domain';
diff --git a/packages/domain/src/catalog/year-range.ts b/packages/domain/src/catalog/year-range.ts
index 413b7e8..144bb10 100644
--- a/packages/domain/src/catalog/year-range.ts
+++ b/packages/domain/src/catalog/year-range.ts
@@ -31,3 +31,37 @@ export function resolveEnd(
   if (yearEnd === undefined) return yearStart;
   return yearEnd;
 }
+
+/**
+ * 年份範圍重疊判定(V-2b 起升 domain=年份語意單一來源;原 adapters/helpers/fitment.ts、
+ * 該處改 re-export 保既有呼叫零漂移)。actual/spec 皆 FitmentSpec 年份區間。
+ *
+ * 規則(逐字對齊原 adapters 版、byte 等價):
+ * - 任一邊 yearStart undefined → return true(無年份限制=不限年份)
+ * - 否則 actualEnd/specEnd 用 resolveEnd 解析(兩端對稱處理 yearEnd null/undefined)
+ * - 範圍重疊:actual.start ≤ spec.end 且 spec.start ≤ actual.end
+ *
+ * 🔴 只判年份、**不**比對 motoBrand/modelCode(呼叫端自理配對)。使用者單年查詢=退化區間
+ * `{yearStart:Y, yearEnd:Y}`;storefront §7 比對禁自寫年份判定、一律呼本顆(S4 語意分叉教訓)。
+ *
+ * @see resolveEnd
+ * @see packages/adapters/src/in-memory/InMemoryProductRepository.ts matchFitment 規則 3
+ */
+export function matchFitmentYear(
+  actual: { yearStart?: number; yearEnd?: number | null },
+  spec: { yearStart?: number; yearEnd?: number | null },
+): boolean {
+  if (actual.yearStart === undefined || spec.yearStart === undefined) return true;
+  const actualEnd = resolveEnd(actual.yearStart, actual.yearEnd);
+  const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);
+  return actual.yearStart <= specEnd && spec.yearStart <= actualEnd;
+}
+
+/**
+ * fitment 是否不限年份(yearStart 未定義=該車型全年份適用)。
+ * V-2b §7:使用者年份未知時,唯有命中此類 fitment 才可顯無條件「✓ 適用」,否則保守顯 qualified。
+ * 抽 domain=年份語意單一來源(storefront 禁自寫 `yearStart === undefined` 判定行)。
+ */
+export function isYearUnrestricted(spec: { yearStart?: number }): boolean {
+  return spec.yearStart === undefined;
+}
```
```diff
diff --git a/apps/storefront/src/app/cart/actions.ts b/apps/storefront/src/app/cart/actions.ts
index c481049..52c940a 100644
--- a/apps/storefront/src/app/cart/actions.ts
+++ b/apps/storefront/src/app/cart/actions.ts
@@ -22,6 +22,7 @@
 //   - 找不到商品 / 變體已不存在(舊 cart stale)→ found:false,client 不顯示該行、不計入小計。

 import { fetchProductByHandle } from '@/lib/products';
+import type { UIFitment } from '@/data/mock-products';

 /** client 傳入的 line key(僅 productId + 選用 variantId;qty 由 client 自管、不影響單價解析)。 */
 export type CartLineInput = {
@@ -48,12 +49,27 @@ export type ResolvedCartLine = {
   image: string | null;
   /** 適用車款衍生字串(design cart-item-vehicle「適用 X」) */
   fits: string;
-  /** 變體識別字串(spec 值合併 / fallback sku;無變體商品為 null) */
+  /** 變體識別字串(**純規格** spec 值合併;spec 空 or 無變體 → null;V-2a2 起不再 fallback sku) */
   variantLabel: string | null;
+  /** 料號(V-2a2:變體=variant.sku;無變體商品無料號欄 → null;公開識別、無價格面) */
+  sku: string | null;
   /** 🔴 general 公開單價(整數元位 NT$);**唯一價格欄、無 priceByTier/store/cost** */
   unitPrice: number;
+  /** V-2e:適用車款(UIFitment 公開欄白名單投影、與 PDP 同 shape;client 對 line vehicle 跑
+   *  checkFitment 顯「可能不適用」;🔴 判定在 client=cart vehicle 不出站紅線不動)。 */
+  fitments: UIFitment[];
 };

+/** V-2e:UIFitment 公開欄白名單投影(逐欄重建、不透傳整物件;yearEnd null=開放式語意保留、禁塌)。 */
+function projectFitments(fitments: UIFitment[] | undefined): UIFitment[] {
+  return (fitments ?? []).map((f) => ({
+    motoBrand: f.motoBrand,
+    modelCode: f.modelCode,
+    ...(f.yearStart !== undefined ? { yearStart: f.yearStart } : {}),
+    ...(f.yearEnd !== undefined ? { yearEnd: f.yearEnd } : {}),
+  }));
+}
+
 // 品項上限:對齊 create_order RPC「品項≤200」fail-closed(防 client 送超量 line 打爆查詢)。
 const MAX_LINES = 200;
 // 單欄長度上限(public server action input、防超長字串濫用打 DB;productId=slug 約 ≤128、
@@ -61,14 +77,13 @@ const MAX_LINES = 200;
 const MAX_PRODUCT_ID_LEN = 256;
 const MAX_VARIANT_ID_LEN = 64;

-/** 把變體 spec 物件壓成顯示字串(值合併、去空);無有效值回 null。 */
-function variantLabelFromSpec(spec: Record<string, string>, fallbackSku: string): string | null {
+/** 把變體 spec 物件壓成**純規格**顯示字串(值合併、去空);無有效值回 null。
+ *  V-2a2:不再 fallback sku(料號改獨立 sku 欄恆顯,避免規格空時料號被塞進規格行=雙顯/語意混淆)。 */
+function variantLabelFromSpec(spec: Record<string, string>): string | null {
   const values = Object.values(spec)
     .map((v) => (typeof v === 'string' ? v.trim() : ''))
     .filter((v) => v.length > 0);
-  if (values.length > 0) return values.join(' · ');
-  // spec 全空(理論罕見)→ fallback 顯料號(至少能辨識變體);料號也空 → null。
-  return fallbackSku.trim().length > 0 ? fallbackSku.trim() : null;
+  return values.length > 0 ? values.join(' · ') : null;
 }

 /**
@@ -116,13 +131,16 @@ export async function resolveCartLines(lines: unknown): Promise<ResolvedCartLine
         image: null,
         fits: '',
         variantLabel: null,
+        sku: null,
         unitPrice: 0,
+        fitments: [], // found:false 不渲染、無判定需求
       });
       continue;
     }

     let unitPrice: number;
     let variantLabel: string | null = null;
+    let sku: string | null = null; // V-2a2:變體=variant.sku、無變體=null
     if (variantId) {
       const variant = (product.variants ?? []).find((v) => v.id === variantId);
       if (!variant) {
@@ -137,13 +155,16 @@ export async function resolveCartLines(lines: unknown): Promise<ResolvedCartLine
           image: product.image ?? null,
           fits: product.fits,
           variantLabel: null,
+          sku: null,
           unitPrice: 0,
+          fitments: [],
         });
         continue;
       }
       // 🔴 變體單價取 UIVariant.price(= priceByTier.general、唯一真值;toUIProduct 已 strip)。
       unitPrice = variant.price;
-      variantLabel = variantLabelFromSpec(variant.spec, variant.sku);
+      variantLabel = variantLabelFromSpec(variant.spec);
+      sku = variant.sku.trim().length > 0 ? variant.sku.trim() : null; // 料號恆顯(獨立行)
     } else if ((product.variants?.length ?? 0) > 0) {
       // 🔴 有變體商品卻未帶有效 variantId(省略 / 空字串 / 空白)→ fail-closed found:false。
       //   不退化成群代表價(群價 = 群內最低、回該價 = 錯價;對齊 round1 / 非-string variantId 同類)。
@@ -157,7 +178,9 @@ export async function resolveCartLines(lines: unknown): Promise<ResolvedCartLine
         image: product.image ?? null,
         fits: product.fits,
         variantLabel: null,
+        sku: null,
         unitPrice: 0,
+        fitments: [],
       });
       continue;
     } else {
@@ -175,7 +198,9 @@ export async function resolveCartLines(lines: unknown): Promise<ResolvedCartLine
       image: product.image ?? null,
       fits: product.fits,
       variantLabel,
+      sku,
       unitPrice,
+      fitments: projectFitments(product.fitments), // V-2e:白名單投影(client 判「可能不適用」)
     });
   }
   return out;
diff --git a/apps/storefront/src/components/CartVehicleField.tsx b/apps/storefront/src/components/CartVehicleField.tsx
new file mode 100644
index 0000000..c09d4df
--- /dev/null
+++ b/apps/storefront/src/components/CartVehicleField.tsx
@@ -0,0 +1,221 @@
+'use client';
+
+// CartVehicleField.tsx — 購物車「給哪台車用」車款欄(V-2a;真權威 spec §2)。
+// 一個欄同時支援 §2 四帶入路徑的手動端:①愛車快選(登入會員 garage chips、共用 resolveGarageChip
+// 決策腦)②打字 typeahead + ③三層 combobox(VehicleSelect、字典字面)④自由輸入 fallback(字典沒有
+// 照打照存=kind:'free')。頂部欄=整車套用、單列欄=覆寫,兩處共用本元件(外殼同、onChange 去向不同)。
+// 🔴 車種鐵律:picker/typeahead/garage 命中恆字典字面(kind:'dict');自由輸入明標 kind:'free'、零猜。
+// §7 商品頁比對只認 kind:'dict';free 恆走「人工確認」路(不在本元件、在 V-2b)。
+
+import { useState } from 'react';
+import type { MockMotoBrand } from '@/data/mock-moto-brands';
+import type { CartItemVehicle } from '@/contexts/CartContext';
+import type { UIFitment } from '@/data/mock-products';
+import type { GarageChipItem } from './GarageChips';
+import { VehicleSelect } from './VehicleSelect';
+import { vehicleLabel } from '@/lib/vehicle-match';
+import { resolveGarageChip, resolveSuggestionLabel } from '@/lib/garage-chip';
+import { checkFitment, type FitmentCheckStatus } from '@/lib/fitment-match';
+import { slugify } from '@/lib/vehicle-taxonomy';
+
+/** 車款欄顯示字面(dict=品牌車型+年;free=raw+年)。 */
+export function formatCartVehicle(v: CartItemVehicle): string {
+  if (v.kind === 'dict') {
+    return [v.year, vehicleLabel(v.brand, v.model)].filter(Boolean).join(' ');
+  }
+  return [v.year, v.raw].filter(Boolean).join(' ');
+}
+
+/** V-2e:cart line 車款 vs 商品 fitments 判定(重用 §7 checkFitment 同一顆腦、零新比對邏輯)。
+ *  只判 kind:'dict'(slugify(名稱字面)=同源 slug 空間);free/無 fitments/無值 → null=不顯示判定
+ *  (自由輸入=人工確認路、不誤嚇;§7 保守方向:僅 no-match 亮紅)。 */
+export function cartVehicleFitStatus(
+  fitments: UIFitment[] | undefined,
+  v: CartItemVehicle | undefined,
+): FitmentCheckStatus | null {
+  if (!v || v.kind !== 'dict' || !fitments || fitments.length === 0) return null;
+  return checkFitment(fitments, {
+    kind: 'dict',
+    brandId: slugify(v.brand),
+    modelId: slugify(v.model),
+    year: v.year,
+  });
+}
+
+const SOURCE_NOTE: Record<CartItemVehicle['source'], string> = {
+  search: '來自你的搜尋',
+  garage: '來自你的車庫',
+  picker: '',
+  freetext: '自由輸入 · 我們會人工確認',
+};
+
+type LocalSel = { brand: string; model?: string; year?: number } | null;
+
+export function CartVehicleField({
+  value,
+  onChange,
+  motoBrands,
+  garage = [],
+  label,
+  hint,
+  fitments,
+}: {
+  value: CartItemVehicle | undefined;
+  /** null=清除本欄 */
+  onChange: (v: CartItemVehicle | null) => void;
+  motoBrands: MockMotoBrand[];
+  garage?: GarageChipItem[];
+  /** 欄標題(頂部=「給哪台車用(套用全部)」;單列=「這件給哪台車」) */
+  label: string;
+  /** 提示文案(非強制;§2「建議填寫車款…」) */
+  hint?: string;
+  /** V-2e:該商品適用車款(單列欄傳入=不符顯紅膠囊;頂部整車欄不傳=跨商品無單一判定對象) */
+  fitments?: UIFitment[];
+}) {
+  const [editing, setEditing] = useState(false);
+  // V-2e:不符=紅膠囊+「可能不適用」(§7 保守方向:僅 no-match 亮紅;qualified/free/undetermined
+  // 中性不誤嚇);display-only 不擋結帳。頂部整車欄不傳 fitments=恆 null 不判。
+  const fit = cartVehicleFitStatus(fitments, value);
+  // picker 本地選態(brand→model→year;model 選定即 commit kind:'dict')
+  const [sel, setSel] = useState<LocalSel>(null);
+  const [freetext, setFreetext] = useState('');
+  const [suggest, setSuggest] = useState<{ entries: string[]; garageYear: number | undefined; raw: string } | null>(null);
+
+  const commitDict = (
+    brand: string,
+    model: string,
+    year: number | undefined,
+    source: 'search' | 'garage' | 'picker',
+  ) => {
+    onChange({ kind: 'dict', brand, model, year, source });
+  };
+
+  const startEdit = () => {
+    // 進編輯:dict 值回填 picker、free 值回填 freetext
+    if (value?.kind === 'dict') setSel({ brand: value.brand, model: value.model, year: value.year });
+    else setSel(null);
+    setFreetext(value?.kind === 'free' ? value.raw : '');
+    setSuggest(null);
+    setEditing(true);
+  };
+
+  const done = () => {
+    setEditing(false);
+    setSuggest(null);
+  };
+
+  const onGarageChip = (g: GarageChipItem) => {
+    const r = resolveGarageChip(motoBrands, g);
+    if (r.kind === 'apply') {
+      commitDict(r.brand, r.model, r.year, 'garage');
+      done();
+    } else {
+      // 多/零命中:多=建議清單明選;零=提供「以自由輸入記下」(honor 車庫車、不猜 dict)
+      setSuggest({ entries: r.entries, garageYear: r.garageYear, raw: g.name });
+    }
+  };
+
+  const onPickSuggestion = (label2: string, garageYear: number | undefined) => {
+    const applied = resolveSuggestionLabel(motoBrands, label2, garageYear);
+    if (applied) {
+      commitDict(applied.brand, applied.model, applied.year, 'garage');
+      done();
+    }
+  };
+
+  const submitFreetext = () => {
+    const raw = freetext.trim();
+    if (raw === '') return;
+    onChange({ kind: 'free', raw, source: 'freetext' });
+    done();
+  };
+
+  return (
+    <div className="cvf">
+      <div className="cvf-label">{label}</div>
+      {value && !editing ? (
+        <div className="cvf-current">
+          <span className="cvf-chip" data-kind={value.kind} data-fit={fit ?? undefined}>
+            {formatCartVehicle(value)}
+          </span>
+          {fit === 'no-match' && (
+            <span className="cvf-mismatch" role="status">可能不適用 · 下單前我們會與你確認</span>
+          )}
+          {SOURCE_NOTE[value.source] && <span className="cvf-note">{SOURCE_NOTE[value.source]}</span>}
+          <button type="button" className="cvf-link" onClick={startEdit}>更改</button>
+          <button type="button" className="cvf-link" onClick={() => onChange(null)}>清除</button>
+        </div>
+      ) : editing ? (
+        <div className="cvf-edit">
+          {garage.length > 0 && (
+            <div className="cvf-garage">
+              <span className="cvf-garage-label">我的愛車</span>
+              {garage.map((g) => (
+                <button key={g.id} type="button" className="cat-garage-chip" onClick={() => onGarageChip(g)}>
+                  {[g.year, g.name].filter(Boolean).join(' ')}
+                </button>
+              ))}
+            </div>
+          )}
+          {suggest && (
+            <div className="cvf-suggest" role="listbox" aria-label="車款建議清單">
+              {suggest.entries.length > 0 ? (
+                <>
+                  <span className="cvf-note">「{suggest.raw}」可能是:</span>
+                  {suggest.entries.map((s) => (
+                    <button key={s} type="button" className="cat-garage-chip" role="option" aria-selected={false}
+                      onClick={() => onPickSuggestion(s, suggest.garageYear)}>
+                      {s}
+                    </button>
+                  ))}
+                </>
+              ) : (
+                <button type="button" className="cvf-link"
+                  onClick={() => { onChange({ kind: 'free', raw: suggest.raw, source: 'garage' }); done(); }}>
+                  以自由輸入記下「{suggest.raw}」(下單後人工確認)
+                </button>
+              )}
+            </div>
+          )}
+          <div className="cvf-picker">
+            <VehicleSelect
+              motoBrands={motoBrands}
+              vehicle={sel}
+              onPickBrand={(name) => setSel({ brand: name })}
+              onPickModel={(name) => {
+                // commit 移出 setSel updater=純函式(值班台 nit:updater 內呼 onChange 於 StrictMode 雙跑)
+                if (!sel) return;
+                setSel({ brand: sel.brand, model: name });
+                commitDict(sel.brand, name, undefined, 'picker'); // 選到車型即帶入(年份可後補)
+              }}
+              onPickYear={(year) => {
+                if (!sel?.model) return;
+                setSel({ ...sel, year });
+                commitDict(sel.brand, sel.model, year, 'picker');
+              }}
+              onClearBrand={() => setSel(null)}
+              onClearModel={() => setSel((v) => (v ? { brand: v.brand } : v))}
+              onClearYear={() => setSel((v) => (v ? { brand: v.brand, model: v.model } : v))}
+            />
+          </div>
+          <div className="cvf-free">
+            <input
+              type="text"
+              className="cvf-free-input"
+              placeholder="找不到?直接輸入車款(例:2017 R6)"
+              aria-label="自由輸入車款"
+              value={freetext}
+              onChange={(e) => setFreetext(e.target.value)}
+              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitFreetext(); } }}
+            />
+            <button type="button" className="cvf-link" onClick={submitFreetext} disabled={freetext.trim() === ''}>記下</button>
+          </div>
+          <button type="button" className="cvf-link cvf-done" onClick={done}>完成</button>
+        </div>
+      ) : (
+        <button type="button" className="cvf-add" onClick={startEdit}>+ 選擇車款</button>
+      )}
+      {hint && !value && !editing && <div className="cvf-hint">{hint}</div>}
+    </div>
+  );
+}
diff --git a/apps/storefront/src/components/ProductFitmentCheck.tsx b/apps/storefront/src/components/ProductFitmentCheck.tsx
new file mode 100644
index 0000000..0df43bf
--- /dev/null
+++ b/apps/storefront/src/components/ProductFitmentCheck.tsx
@@ -0,0 +1,207 @@
+'use client';
+
+// ProductFitmentCheck.tsx — 商品頁「是否適用我的車」§7 保守適用比對(V-2b;掛 ProductFitments 段首)。
+// 讀全站選車 context(vehicle-context;首頁/型錄選車寫入=§6 全站連動)→ checkFitment(product.fitments,…)
+// 顯四態:match「✓ 適用」/ no-match「✗ 未列」+ 聯絡 / qualified「請確認年份」/ undetermined 不判定。
+// 無 context 車款 → 現選入口(愛車快選 chips + VehicleSelect;選定寫 context=全站連動)。
+//
+// 🔴 §7 正確性紅線(錯誤 ✓ 比空白更糟):判定一律走 lib/fitment-match.checkFitment(domain
+// matchFitmentYear/isYearUnrestricted 年份單一來源+slugify 同源橋接);車種鐵律零猜。display-only:
+// 不寫庫、不擋加入購物車。context.brandId/modelId=taxonomy slug(與 slugify(fitment) 同空間、by
+// construction 一致);picker 選定用 slugify(name) 組 context slug(等於 taxonomy id)。
+
+import { useEffect, useState } from 'react';
+import type { MockMotoBrand } from '@/data/mock-moto-brands';
+import type { UIFitment } from '@/data/mock-products';
+import { checkFitment, type FitmentCheckStatus, type FitmentCheckVehicle } from '@/lib/fitment-match';
+import { readVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
+import { slugify } from '@/lib/vehicle-taxonomy';
+import { resolveGarageChip, resolveSuggestionLabel } from '@/lib/garage-chip';
+import { vehicleLabel } from '@/lib/vehicle-match';
+import { VehicleSelect } from './VehicleSelect';
+import type { GarageChipItem } from './GarageChips';
+
+/** context/picker 選定的車款(顯示名 + slug + 年;供比對與顯示) */
+type Chosen = { brandName: string; modelName: string; year?: number };
+
+/** V-2c:URL `?vehicle=` 解析後的名稱字面(route 端 parseVehicleFromUrl 對照 taxonomy 解出)。 */
+export type PdpUrlVehicle = { brandName: string; modelName?: string; year?: number };
+
+function toCheckVehicle(c: Chosen): FitmentCheckVehicle {
+  return { kind: 'dict', brandId: slugify(c.brandName), modelId: slugify(c.modelName), year: c.year };
+}
+function chosenLabel(c: Chosen): string {
+  return [c.year, vehicleLabel(c.brandName, c.modelName)].filter(Boolean).join(' ');
+}
+
+export function ProductFitmentCheck({
+  fitments,
+  motoBrands,
+  garage = [],
+  urlVehicle = null,
+}: {
+  fitments: UIFitment[];
+  motoBrands: MockMotoBrand[];
+  garage?: GarageChipItem[];
+  /** V-2c:URL `?vehicle=` 恆為第一真相 — 有值時優先於 context 鏡、掛載即回寫同步鏡。 */
+  urlVehicle?: PdpUrlVehicle | null;
+}) {
+  // V-2c:初始 chosen 優先序=URL vehicle > context 鏡(useState initializer 讀 prop、SSR 同繪零分歧;
+  // 鏡只能在 client effect 讀)。URL 車款名稱齊(brand+model)才可判定;brand-only 走現選入口。
+  const [chosen, setChosen] = useState<Chosen | null>(() =>
+    urlVehicle?.modelName
+      ? { brandName: urlVehicle.brandName, modelName: urlVehicle.modelName, year: urlVehicle.year }
+      : null,
+  );
+  const [editing, setEditing] = useState(false);
+  const [sel, setSel] = useState<{ brand: string; model?: string; year?: number } | null>(null);
+  const [suggest, setSuggest] = useState<{ entries: string[]; garageYear: number | undefined } | null>(null);
+  // V-2d③(Sean 07-15 真機:「手機放直的很不好看」):手機預設收合=單顆入口鈕+愛車 chips 在前,
+  // 點開才展三層選單(CSS ≤1023px 生效;桌機恆展開、.pfc-expand 不顯)。§7 判定/文案四態零動、只動殼。
+  const [pickerOpen, setPickerOpen] = useState(false);
+
+  // V-2c mount:URL `?vehicle=` 恆第一真相 —
+  // - 有 URL vehicle → 不讀鏡(過期鏡=Sean 07-15 實測「顯上一台車」bug 本體)、掛載即
+  //   writeVehicleContext 回寫同步(brand-only 也寫=鏡恆跟隨;banner/addToCart 讀到同源、不再分家。
+  //   名稱不齊時兩消費端本就零猜不動作)。冪等:重進同 URL 重寫同值無害。
+  // - 無 URL vehicle → 照舊讀鏡(REQUIRED-3 防禦讀取;名稱字面欄齊全才判定=零猜)→ 再無 → 現選入口。
+  // mount-only:urlVehicle 為 server 每繪新物件,若列 deps、重繪會把使用者「更改車款」後的選擇/鏡
+  // 蓋回 URL 車款(鏡與 banner 分家)→ 依 react-nextjs-rules.md mount-only 合法寫法 disable。
+  useEffect(() => {
+    if (urlVehicle) {
+      writeVehicleContext({
+        brandId: slugify(urlVehicle.brandName),
+        modelId: urlVehicle.modelName ? slugify(urlVehicle.modelName) : undefined,
+        year: urlVehicle.year,
+        label: [urlVehicle.brandName, urlVehicle.modelName, urlVehicle.year].filter(Boolean).join(' '),
+        brandName: urlVehicle.brandName,
+        modelName: urlVehicle.modelName,
+      });
+      return;
+    }
+    const ctx = readVehicleContext();
+    if (ctx && ctx.brandName && ctx.modelName) {
+      setChosen({ brandName: ctx.brandName, modelName: ctx.modelName, year: ctx.year });
+    }
+    // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, []);
+
+  // 無 fitments(通用款/無資料)→ 整段不渲染(同 ProductFitments 空狀態)
+  if (!fitments || fitments.length === 0) return null;
+
+  const commit = (c: Chosen) => {
+    setChosen(c);
+    setEditing(false);
+    setSuggest(null);
+    setSel(null);
+    setPickerOpen(false); // 下次進 picker(更改以外路徑)回收合預設
+
+    // 寫 context=全站連動(brandId/modelId 用 slugify(name)=taxonomy slug 空間;附名稱字面欄)
+    writeVehicleContext({
+      brandId: slugify(c.brandName),
+      modelId: slugify(c.modelName),
+      year: c.year,
+      label: chosenLabel(c),
+      brandName: c.brandName,
+      modelName: c.modelName,
+    });
+  };
+
+  const onGarageChip = (g: GarageChipItem) => {
+    const r = resolveGarageChip(motoBrands, g);
+    if (r.kind === 'apply') commit({ brandName: r.brand, modelName: r.model, year: r.year });
+    else setSuggest({ entries: r.entries, garageYear: r.garageYear });
+  };
+
+  const status: FitmentCheckStatus | null = chosen ? checkFitment(fitments, toCheckVehicle(chosen)) : null;
+
+  return (
+    <div className="pfc">
+      {chosen && !editing ? (
+        <div className={`pfc-result pfc-${status}`} role="status">
+          <span className="pfc-badge" aria-hidden="true">
+            {status === 'match' ? '✓' : status === 'no-match' ? '✗' : '?'}
+          </span>
+          <div className="pfc-msg">
+            {status === 'match' && <><b>適用你的 {chosenLabel(chosen)}</b></>}
+            {status === 'no-match' && (
+              <>
+                <b>{chosenLabel(chosen)} 未列於適用清單</b>
+                <span className="pfc-sub">不確定?<a href="/info/shipping">聯絡我們確認</a></span>
+              </>
+            )}
+            {status === 'qualified' && (
+              <>
+                <b>此商品適用 {vehicleLabel(chosen.brandName, chosen.modelName)},但有年份限制</b>
+                <span className="pfc-sub">請確認你的年份是否在下方適用車款表範圍內</span>
+              </>
+            )}
+            {status === 'undetermined' && (
+              <>
+                <b>已記下你的車款</b>
+                <span className="pfc-sub">下單後我們會人工為你確認是否適用</span>
+              </>
+            )}
+          </div>
+          {/* 更改車款=明確要改 → 直接展開選單(V-2d③ 收合入口只擋首見的高牆) */}
+          <button type="button" className="pfc-link" onClick={() => { setSel(null); setSuggest(null); setPickerOpen(true); setEditing(true); }}>更改車款</button>
+        </div>
+      ) : (
+        <div className={`pfc-picker${pickerOpen ? ' pfc-picker-open' : ''}`}>
+          <div className="pfc-picker-label">確認是否適用你的車</div>
+          {garage.length > 0 && (
+            <div className="pfc-garage">
+              <span className="pfc-garage-label">我的愛車</span>
+              {garage.map((g) => (
+                <button key={g.id} type="button" className="cat-garage-chip" onClick={() => onGarageChip(g)}>
+                  {[g.year, g.name].filter(Boolean).join(' ')}
+                </button>
+              ))}
+            </div>
+          )}
+          {suggest && (
+            <div className="pfc-garage" role="listbox" aria-label="車款建議清單">
+              {suggest.entries.length > 0 ? (
+                suggest.entries.map((label) => (
+                  <button key={label} type="button" className="cat-garage-chip" role="option" aria-selected={false}
+                    onClick={() => {
+                      const a = resolveSuggestionLabel(motoBrands, label, suggest.garageYear);
+                      if (a) commit({ brandName: a.brand, modelName: a.model, year: a.year });
+                    }}>
+                    {label}
+                  </button>
+                ))
+              ) : (
+                <span className="pfc-sub">無法對應此車款,請用下方選單選擇</span>
+              )}
+            </div>
+          )}
+          {/* V-2d③ 手機收合入口(≤1023px 未展開才顯、桌機 CSS 藏);點開展下方三層選單 */}
+          <button type="button" className="pfc-expand" onClick={() => setPickerOpen(true)}>
+            選擇車款,確認是否適用
+          </button>
+          <div className="pfc-select">
+            <VehicleSelect
+              motoBrands={motoBrands}
+              vehicle={sel}
+              onPickBrand={(name) => setSel({ brand: name })}
+              onPickModel={(name) => {
+                if (!sel) return;
+                setSel({ brand: sel.brand, model: name });
+                commit({ brandName: sel.brand, modelName: name }); // 選到車型即比對(年份可後補)
+              }}
+              onPickYear={(year) => {
+                if (!sel?.model) return;
+                setSel({ ...sel, year });
+                commit({ brandName: sel.brand, modelName: sel.model, year });
+              }}
+              onClearBrand={() => setSel(null)}
+              onClearModel={() => setSel((v) => (v ? { brand: v.brand } : v))}
+              onClearYear={() => setSel((v) => (v ? { brand: v.brand, model: v.model } : v))}
+            />
+          </div>
+        </div>
+      )}
+    </div>
+  );
+}
diff --git a/apps/storefront/src/components/products-url-state.tsx b/apps/storefront/src/components/products-url-state.tsx
index 8fcd89c..24ab2d2 100644
--- a/apps/storefront/src/components/products-url-state.tsx
+++ b/apps/storefront/src/components/products-url-state.tsx
@@ -23,6 +23,7 @@ import {
 } from '@pcm/ui';
 import type { MockMotoBrand } from '@/data/mock-moto-brands';
 import type { ProductExtraFilters } from './filter-state';
+import { clearVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
 // 🔴 R3:SearchParamsLike + parseVehicleFromUrl 抽到無 hooks 的 @/lib/vehicle-url(供詳情頁 Server
 //   Component 共用、本檔含 hooks 不可被 server import);本檔 re-export parseVehicleFromUrl 保 back-compat。
 import { parseVehicleFromUrl, type SearchParamsLike } from '@/lib/vehicle-url';
@@ -255,6 +256,8 @@ export function useCatalogFilterUrlSync(
  * - vehicle 清除 → 刪 `vehicle` key;長版遺留 key(?brand=&model=&year= 書籤)在兩方向皆一併清
  *   (`brand` 僅在與 `model` 同在=車輛長版語意時清;?brand= 單獨=商品品牌 filter、不可誤刪)。
  * - URL 無變化即 no-op(mount 還原波、StrictMode 雙跑安全);與現值比對後才 replace。
+ * - V-2c:寫 URL 同一時機同步 vehicle-context 鏡(鏡恆跟隨 URL 真相;真清除才清鏡、
+ *   mount 無車不清 — 詳 effect 內註解)。
  */
 export function useVehicleUrlSync(
   vehicle: CascadeFilterState['vehicle'],
@@ -280,7 +283,7 @@ export function useVehicleUrlSync(
     let next: string | null = null;
     if (vehicle) {
       const brandObj = motoBrands.find((b) => b.name === vehicle.brand);
-      if (!brandObj) return; // taxonomy 查無(清單空/資料缺)→ 保守不動 URL
+      if (!brandObj) return; // taxonomy 查無(清單空/資料缺)→ 保守不動 URL(鏡同、不寫不清)
       const modelObj =
         vehicle.model != null ? brandObj.models?.find((m) => m.name === vehicle.model) : null;
       if (vehicle.model != null && !modelObj) return;
@@ -290,6 +293,24 @@ export function useVehicleUrlSync(
         if (vehicle.year != null) segs.push(String(vehicle.year));
       }
       next = segs.join(':');
+      // V-2c R2:鏡恆跟隨 URL 真相 — 與寫 URL 同一時機單點寫鏡(避免雙寫競態);修「型錄換車/
+      // 清車不寫鏡 → PDP §7 顯舊車+購物車帶錯車」。名稱字面自 taxonomy(brandName/modelName=
+      // V-2a REQUIRED-3 additive 欄);brand-only 也寫(鏡跟 URL、消費端名稱不齊自然零猜)。
+      // deep-link 入站水合同輪重寫同值=冪等無害(URL 本為真相)。
+      writeVehicleContext({
+        brandId: brandObj.id,
+        modelId: modelObj?.id,
+        year: modelObj != null && vehicle.year != null ? vehicle.year : undefined,
+        label: [brandObj.name, modelObj?.name, modelObj != null ? vehicle.year : undefined]
+          .filter((s) => s != null)
+          .join(' '),
+        brandName: brandObj.name,
+        modelName: modelObj?.name,
+      });
+    } else if (pendingRestoreRef.current === false) {
+      // V-2c R2:真清除(本 mount 曾有車、使用者清車)→ 清鏡。mount 無車(ref 仍 null)不清:
+      // 直接逛 /products 不得洗掉首頁/他頁寫的鏡(URL 無車≠使用者清車)。
+      clearVehicleContext();
     }
     const hadLongVehicle = params.get('brand') != null && params.get('model') != null;
     if (next !== null) params.set('vehicle', next);
diff --git a/apps/storefront/src/contexts/CartContext.tsx b/apps/storefront/src/contexts/CartContext.tsx
index ae2eca3..d6b2c45 100644
--- a/apps/storefront/src/contexts/CartContext.tsx
+++ b/apps/storefront/src/contexts/CartContext.tsx
@@ -61,8 +61,20 @@ export type CartLineKey = {
   variantId?: string;
 };

+// V-2a「給哪台車用」(值班台 REQUIRED-1 判別式形狀):
+//   kind:'dict' = 來自字典(picker/typeahead/搜尋帶入/車庫 dict 對非 null)、brand/model 為字典名稱字面
+//     → §7 商品頁比對只判此類;
+//   kind:'free' = 自由輸入 or 車庫舊自由文字(dict 對雙 null)、只有 raw 原字串 → §7 恆走「人工確認」路。
+// 🔴 freetext 不得偽造 dict 對(車種鐵律零猜);vehicle 非 line key discriminator=同品同變體不因車款分裂兩列。
+// 純 client(localStorage)、不送價/不寫 DB;V-3 才落 order_items.vehicle_snapshot。
+export type CartItemVehicle =
+  | { kind: 'dict'; brand: string; model: string; year?: number; source: 'search' | 'garage' | 'picker' }
+  | { kind: 'free'; raw: string; year?: number; source: 'garage' | 'freetext' };
+
 export type CartItem = CartLineKey & {
   qty: number;
+  /** V-2a:此列適用車款(選填;§2 帶入優先序;無=未填、不擋結帳) */
+  vehicle?: CartItemVehicle;
 };

 export type CartContextValue = {
@@ -74,6 +86,10 @@ export type CartContextValue = {
   addItem: (item: CartItem) => void;
   removeItem: (key: CartLineKey) => void;
   updateQty: (key: CartLineKey, qty: number) => void;
+  /** V-2a:設/清單列適用車款(null=清)。vehicle 非 line key、不動去重/session。 */
+  setItemVehicle: (key: CartLineKey, vehicle: CartItemVehicle | null) => void;
+  /** V-2a:整車套用——一次帶入全列(§2「不造成選擇負擔」;覆蓋各列既有值)。 */
+  setAllItemsVehicle: (vehicle: CartItemVehicle | null) => void;
   clear: () => void;
   /** 成交後換新 key(7b 僅在「DB 確定 paid」呼;模糊態保留 key=dedup 防雙扣把手)。 */
   regenerateCartSession: () => void;
@@ -93,6 +109,25 @@ function clampQty(qty: unknown): number {
   return Math.min(floored, MAX_QTY);
 }

+/** V-2a:CartItem.vehicle 讀回逐 kind 分驗(壞資料→undefined 丟棄、絕不 throw;鏡像既有逐欄防禦)。 */
+function readVehicle(v: unknown): CartItemVehicle | undefined {
+  if (!v || typeof v !== 'object') return undefined;
+  const o = v as Record<string, unknown>;
+  const year = typeof o.year === 'number' && Number.isInteger(o.year) ? o.year : undefined;
+  if (o.kind === 'dict') {
+    if (typeof o.brand !== 'string' || o.brand.length === 0) return undefined;
+    if (typeof o.model !== 'string' || o.model.length === 0) return undefined;
+    if (o.source !== 'search' && o.source !== 'garage' && o.source !== 'picker') return undefined;
+    return { kind: 'dict', brand: o.brand, model: o.model, year, source: o.source };
+  }
+  if (o.kind === 'free') {
+    if (typeof o.raw !== 'string' || o.raw.length === 0) return undefined;
+    if (o.source !== 'garage' && o.source !== 'freetext') return undefined;
+    return { kind: 'free', raw: o.raw, year, source: o.source };
+  }
+  return undefined;
+}
+
 function readStorage(): CartItem[] {
   if (typeof window === 'undefined') return [];
   try {
@@ -109,7 +144,8 @@ function readStorage(): CartItem[] {
       // v2:只認 variantId(string 非空 → 帶、否則無變體 undefined);舊 v1 的 color/size 不解析、自然丟棄。
       const variantId =
         typeof x.variantId === 'string' && x.variantId.length > 0 ? x.variantId : undefined;
-      out.push({ productId: x.productId, qty, variantId });
+      const vehicle = readVehicle(x.vehicle); // V-2a:選填、壞資料丟棄不擋整筆
+      out.push({ productId: x.productId, qty, variantId, ...(vehicle ? { vehicle } : {}) });
     }
     return out;
   } catch {
@@ -201,6 +237,33 @@ export function CartProvider({ children }: { children: ReactNode }) {
     });
   }, []);

+  // V-2a:設/清單列車款(不變 qty/session/去重;null=移除該欄)。以 line key 定位。
+  const setItemVehicle = useCallback((key: CartLineKey, vehicle: CartItemVehicle | null) => {
+    setItems((prev) =>
+      prev.map((p) => {
+        if (!sameLine(p, key)) return p;
+        if (vehicle === null) {
+          const { vehicle: _drop, ...rest } = p;
+          return rest;
+        }
+        return { ...p, vehicle };
+      }),
+    );
+  }, []);
+
+  // V-2a:整車套用(全列同一車款;null=全清)。頂部車款欄一次填=§2 預設路。
+  const setAllItemsVehicle = useCallback((vehicle: CartItemVehicle | null) => {
+    setItems((prev) =>
+      prev.map((p) => {
+        if (vehicle === null) {
+          const { vehicle: _drop, ...rest } = p;
+          return rest;
+        }
+        return { ...p, vehicle };
+      }),
+    );
+  }, []);
+
   const clear = useCallback(() => setItems([]), []);

   // 成交換新 key(7b 僅「DB 確定 paid」呼)。hydrate 前呼也安全:mount 讀用 prev ?? 不覆寫、持久化 gate isHydrated。
@@ -220,10 +283,12 @@ export function CartProvider({ children }: { children: ReactNode }) {
       addItem,
       removeItem,
       updateQty,
+      setItemVehicle,
+      setAllItemsVehicle,
       clear,
       regenerateCartSession,
     }),
-    [items, totalQty, isHydrated, cartSessionId, addItem, removeItem, updateQty, clear, regenerateCartSession]
+    [items, totalQty, isHydrated, cartSessionId, addItem, removeItem, updateQty, setItemVehicle, setAllItemsVehicle, clear, regenerateCartSession]
   );

   return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
```

## 5. 已跑驗證

- 每 commit 各自三綠(typecheck / lint / build,動 .tsx 全含 build)——各 commit body 有記錄。
- 最終態 full vitest:**212 檔 2249 綠**(V-2d 收尾時);domain 升層片(ea32dc4)當時 adapters 25 檔既有測全綠=零回歸。
- 值班台逐片親跑受影響測試檔(不採信執行端自報):V-1e 27 測/V-2a 78 測/V-1f 32 測/V-2b 86 測(含 adapters 兩檔升層零漂移)/V-2a2 49 測/V-2c 44 測/V-2e 46 測/V-2d 39 測,全綠。
- 每 commit code-reviewer(fresh context)R1;V-2d 曾 R1 FAIL(CSS cascade source-order 死碼)→修→R2 PASS。

## 6. 相關規則摘錄(供你無 repo 對照)

- **鐵則 1(design 真權威)**:storefront 對齊 design-reference;偏離需授權=business_override 落 manifest。本包偏離皆有授權紀錄(typeahead/garage chips/字級=Sean 口述或裁量委任)。
- **鐵則 6(檔案上限)**:元件 >400 行必拆。已知:ProductPage.tsx 恰 400 行(V-2c informational、下次動必拆)。
- **鐵則 12 / server 端鐵則(本包最重紅線)**:經銷價(price_store/priceByTier/cost)絕不進非 admin client;cart 線只存 {productId,variantId,qty,vehicle?} 不送價;resolveCartLines 唯一價欄=unitPrice(general);金額整數。
- **車種鐵律**:AI/程式不做車種模糊猜測;比對只認字典字面(NFKC 正規化);多/零命中一律建議清單明選;自由輸入明標、不判定。
- **§7 適用比對紅線(spec 2026-07-15-order-item-vehicle-capture-design v0.2)**:錯誤「✓ 適用」比空白更糟;年份未知+年份受限 fitment 禁 bare ✓(qualified);查無=「✗ 未列」安全方向;free 恆人工確認。
- **vehicle-context 契約**:URL `?vehicle=` 恆第一真相、sessionStorage 只是鏡;鏡恆跟隨(V-2c 修復本體)。
- **年份語意單一來源**:domain resolveEnd/matchFitmentYear/isYearUnrestricted(V-2b 升層);yearEnd null=開放式(2025+)、undefined=單年;storefront 禁自寫年份判定行。

## 7. Manifest 異動摘要(本包期間)

### business_overrides(新增/更新)
- ProductsPage/VehicleFinder.garageChipsAndTypeahead:補型錄掛載點註記(V-1e;非新增 override 種類)
- CartPage.cartVehicleField:購物車車款欄(V-2a;design 零先例、Sean 需求直建)
- ProductPage.fitmentApplicabilityCheck:§7 適用比對(V-2b;design 零先例、spec 授權)
- typeaheadVehicleSelect:V-1f/V-2d 掛載面同步(既有 override 補註)

### open_drifts
- 無新增未解決偏離;visual 細節(紅膠囊配色/收合鈕樣式)=Sean 開站裁量層。

### last_modified_commit 同步
- 各條目依「記可達祖先」寫法逐 commit 同步(0011f87→…→241f57b);validator 24+ commit 可達 OK。
- 已知 validator 警告:ProductPage.related_storefront 的 `[slug]` 動態路由 token 無法 glob=known limitation、檔案實存。

## 8. 想請 Codex 重點看

1. **§7 保守比對有無任何「錯誤 ✓」路徑**(fitment-match.ts + ProductFitmentCheck + V-2e cartVehicleFitStatus):slug 同源橋接、年份退化區間、qualified 分支、V-2c URL/鏡優先序——特別是狀態組合我們沒想到的路。
2. **cart 資料流紅線**:CartItem.vehicle(localStorage)是否在任何路徑進了 server payload(useResolvedCart/resolveCartLines);ResolvedCartLine 新欄 sku/fitments 是否引入敏感面。
3. **domain 升層 byte 等價**:matchFitmentYear 從 adapters 搬 domain+re-export,語意/簽名是否零漂移;新 isYearUnrestricted 是否與既有語意一致。
4. **鏡同步競態**(V-2c products-url-state):useVehicleUrlSync 寫 URL+寫鏡同 effect、pendingRestoreRef 三態守衛(null/false)、StrictMode 雙跑——有無清錯鏡/寫錯鏡的時序窗。
5. 是否符合上述規則摘錄;有無該補的 backlog(尤其 ProductPage 400 行、PDP 同 slug 換 searchParams 不重跑 mount effect 兩個已知殘餘)。

## 9. Claude 端自評

- 可繼續;dev 已代推(值班台 OPS 授權)、**dev→main 正式站未推**=本包 findings+Sean 拍板為最終 gate。
- findings 回來:值班台 triage(must-fix 進佇列立修、nit 併下片)、修完回報。

— 產包:Fable 值班審查台(2026-07-16 00:1x);貼給 Codex 時請整包貼上並附一句:「請唯讀審查這包,不要改 code,只回 findings / 風險 / 是否可繼續。」
