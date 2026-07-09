# Codex Review Packet — #270 安裝資源資料來源接線(Slice 1 + Slice 2)

> 鐵則 12 觸發:動 schema + 公開 view(products_public)+ 欄級 GRANT + 跨 repo migration + 進度單元收尾。
> 產出時機:Slice 2(feature 收尾)commit 前。**未 push、未 db push、金流 flag 全 false。**
> 真權威 plan:`docs/specs/2026-07-09-install-resources-source-chain-plan.md`(Sean 2026-07-09 批 P1=A/P2=A)。
> **Sean:此 Packet 供你選擇性貼 chatgpt.com/codex 再審一次(第 4 層);Claude 已跑下列 3 層對抗審查全 PASS,可選跳過。**

---

## 0. 已完成的對抗審查(Claude 端、跨模型)

| 層 | 對象 | 結果 |
|---|---|---|
| codex 關卡1(gpt-5.5、跨模型) | plan(動手前) | FAIL 1 must-fix(群級彙整)+ 2 nit → **全折入** |
| code-reviewer(Claude subagent) | Slice 1 diff | PASS |
| ultra 五視角對抗(opus×2 經銷價/NULL-clobber 深證 + sonnet×3) | Slice 1 diff | Lens 1/2/4/5 PASS、**Lens 3 FAIL 1 must-fix**(pickInstallVideo)→ 修 |
| codex 關卡2(跨模型) | Slice 1 diff | PASS(零留痕) |
| code-reviewer + codex 關卡2(跨模型) | Slice 2 diff | PASS(零留痕);stale 註解 nit → 全修 |

**共 2 must-fix(群級彙整、pickInstallVideo 頻道 URL 佔位)+ 多個 nit,全部已修並回歸測試。**

---

## 1. 功能一句話

報價單 `products.pdf_urls/video_urls`(text[]、fetcher 已填)→ 報價單 `storefront_catalog_v` 曝露 → 網站同步管線轉成 `products.manuals`(jsonb `[{label,url}]`)/`video_url`(text)→ `products_public` → adapter → mapper → domain → toUIProduct → 前台 `InstallResources`(#270 已完工)。

## 2. 變更清單

**Slice 1(已 commit `0aa4761`,scope=schemas):**
- 報價單 repo `PCM報價單-V2/supabase/migrations/20260709_storefront_catalog_v_expose_install_resources.sql`(view 末尾 append pdf_urls/video_urls + 欄級 GRANT anon;**待 Sean db push 報價單 DB**)
- `supabase/migrations/20260709120000_products_add_install_resources_expose_view.sql`(products 加 manuals jsonb NOT NULL DEFAULT '[]' + video_url text NULL + products_public 末二欄 + 欄級 GRANT;**待 Sean db push 網站 DB**)
- `scripts/rpm-fetch.ts`(SourceProductRow + VIEW_COLS +2 欄)、`rpm-transform.ts`(normalizeManuals/pickInstallVideo/extractYoutubeId + gate)、`supplier-config.ts`(syncInstallResources gbracing/bonamici=true、rpm/cnc=false)、`rpm-import.ts`(ctx + partition 註解)、`database.types.ts`(手加六處)

**Slice 2(本 commit,scope=storefront):**
- `packages/domain/src/catalog/types.ts`(Product.manuals/videoUrl + ProductManual 型別)
- `packages/adapters/src/supabase/mappers/product.ts`(SupabaseProductRow +2 欄 + load runtime guard + save mapper)
- `packages/adapters/src/supabase/SupabaseProductAdapter.ts`(PRODUCT_SELECT_DETAIL +2 欄)
- `apps/storefront/src/lib/products.ts`(toUIProduct 透傳)
- `docs/design-storefront-manifest.yaml`(installResourcesField override 更新為已接線)
- stale 註解更新(InstallResources.tsx / mock-products.ts)+ 6 fixture 補 manuals + 測試

## 3. 高風險面 + 已驗證結論

| 風險面 | 驗證方法 | 結論 |
|---|---|---|
| 經銷價洩漏 | 兩側 view SELECT 逐欄比對 + toUIProduct strip 回歸網(M-11) | ✅ 只多 manuals/video_url 末欄、price_by_tier/price_store/metadata/delisted_at 全排除、security_invoker 保留 |
| NULL-clobber / rpm byte 凍結 | opus lens 逐 partition 推演 + golden byte 鎖 | ✅ syncInstallResources 供應商級 uniform → 免 partition;rpm 省 key、golden 不含新欄 |
| 群級彙整 | tsx 實測「某變體有 PDF、basis 沒有」 | ✅ variants.flatMap 跨全變體、去重保序 |
| 影片形狀 | tsx 實測頻道 URL | ✅ 取第一支「能解析出 id」的 YouTube(對齊 UI parseYoutubeId、頻道 URL 不佔位) |
| mapper guard | 髒 jsonb 逐案測試 | ✅ 缺 label/url/非物件/sizeKB 非 number → 收斂乾淨 ProductManual[] |

## 4. 規則摘錄(Codex 無需 repo)

- 經銷價鐵律:client 不得見 price_store/price_by_tier;金額禁浮點;tier 驗證在 server。
- 鐵則 8:動 schema/共用 view = 重大改動、Sean 已批 plan。鐵則 12:動 schema/公開 API view = 本 Packet。
- rpm byte 凍結:rpm 供應商同步輸出須與現況逐 byte 一致(golden 鎖);manuals/video_url 對 rpm gate=false 省 key。

## 5. 部署順序(Sean、依序)

1. db push 報價單 migration(`20260709_...install_resources`)→ 報價單 view 有 pdf_urls/video_urls。
2. db push 網站 migration(`20260709120000`)→ products/products_public 有 manuals/video_url(此步後前台商品頁才不會因欄缺失報錯)。
3. 觸發 `--confirm-write --supplier=gbracing` + `=bonamici` → 真資料寫入。
4. 眼驗 gbracing/bonamici 商品頁安裝資源顯示。
