# 商品管理線 · 開線前調研(2026-08-14 夜 · B 窗)

> **這不是實作 plan**,是線路圖 + 一個必須先拍板的岔路。
> 本檔的數字附 §0 的數法命令或 `檔案:行號`;沒附的逐字標「未驗 / 未查」(§1 末、§2 末、§3 末各一處)。
> 編號說明:`#20/#21/#22` = **員工的一天 33 項**的項次(`docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1-A),**不是 backlog 號**。

## 0. 重數範圍(對得上,不需更正條目)

數法逐條可重跑,在 `/Users/sean_1/pcm-products` 下:

1. products route 零命中 — `find apps/admin/src/app -type d | grep -i product` → exit=1、輸出 0 行。
   分母:`ls apps/admin/src/app/` = 8 項(`@panel api customers globals.css layout.tsx orders page.tsx settings`)。
2. Storage 未接 — `grep -rn "\.storage\.from(\|supabase\.storage\|StorageClient" --include=*.ts --include=*.tsx --include=*.sql . | grep -v node_modules` → 0 行。
   pattern 涵蓋三種變體;分母 = 本 repo 全 .ts/.tsx/.sql。
3. `save()` 零生產呼叫端 — `grep -rn "\.save(" --include=*.ts --include=*.tsx apps/ packages/ scripts/ | grep -v node_modules` → **3 行**,逐行為
   `packages/adapters/src/in-memory/InMemoryProductRepository.test.ts:53 / :258 / :260`(`const saved = await repo.save(product);` 等),**皆 in-memory 測試**。

## 1. 可照抄的骨架(四層,以 suppliers 線為樣板)
| 層 | 檔案:行號 | 抄什麼 |
|---|---|---|
| route | `apps/admin/src/app/settings/suppliers/page.tsx:21,32-43` | server component + `force-dynamic` + `searchParams` 只取字串形態(`:28-30`) |
| 授權 | `apps/admin/src/lib/session/authorize.ts:24-35` | 三閘(session 自驗 / Origin fail-closed / 具名 actor)一行呼叫直接重用 |
| action | `apps/admin/src/lib/supplier-actions.ts:1,43-46,86-100` | `'use server'` → 授權閘 → 純解析器 → repository → PRG redirect;寫死站內常數(零 open-redirect 面) |
| repository | `apps/admin/src/lib/supplier-repository.ts:26-33` | `'server-only'` + `createSupabaseServiceClient()`;排序/篩選放 JS 不放 SQL(`:5-11` 說明為何) |
| 結果碼 | `supplier-result-messages.ts` + `components/settings/settings-result-banner.tsx` | `?r=` 查表、`?q=` 只當過濾字串,兩者**永不直接渲染成文字** |

**不該照抄的三處**
1. `apps/admin/src/app/settings/staff/page.tsx:47-55` 讀取失敗仍渲染新增表單 —— suppliers 頁 `:84-87` 明文標為「刻意偏離」。
2. `@/` alias:`vitest.config.ts:28` 的 `@` 指向 **storefront**,admin 無自己的 alias ⇒ admin 頁面一律**相對 import**,否則頁面層 render 不起來、測不到(`suppliers/page.tsx:14-19` 逐字)。
3. suppliers 的「唯一寫入路 = RPC」是**它自己的約束**:`20260801140000_m4b_e10_s1a_suppliers.sql:129,133` 對 `suppliers` REVOKE ALL 後只 GRANT SELECT 給 service_role。`products` **沒有**同款 REVOKE(所有 REVOKE 都指 `anon, authenticated`,如 `20260519031049:38`)⇒ 商品線**不必**照抄 RPC-only,可直接走表寫。⚠️ service_role 對 `products` 的實際 grant 我**沒有對正式庫查證**(無 DB 存取),落地前必實查。

## 2. 🔴 `save()` 能不能直接用:**不能,而且問題不在欄位**
零呼叫端 / 零測試(`SupabaseProductAdapter.test.ts` 對 `save` **0 命中**;`IProductRepository.contract.ts:41-56` 整份 `it.todo`、無真斷言)。

**(a) 欄位缺口**(`mappers/product.ts:368-408` 逐欄看):不寫 `delisted_at`(⇒ **上下架無路徑**)、不寫 `supplier_slug`、不寫 `sound_clips` / `cardImageTrim`、`price_by_tier` 只寫 general+store(**premiumStore 掉了**)、`metadata: {}` 每次覆寫(`:404`)、**variants 完全不寫**;回讀無 embed ⇒ `variantCount` 恆 0(adapter `:453-456` 自陳)。

**(b) 真正的擋路者 —— `products` 是每日同步的目標表,不是本 repo 的主檔**
- `products.supplier_slug NOT NULL DEFAULT 'rpm'`(`20260602135934:34`)+ mapper 不寫該欄 ⇒ **後台新建的商品會落進 `'rpm'` scope**。
- `.github/workflows/rpm-sync.yml:48` 每日 cron;`scripts/rpm-reconcile.ts:66-73` 的 `computeDelist` = 「target active 集合減 source 集合」⇒ 後台新建的商品隔天被**軟下架**。10% abort gate(`:76`)對單筆不會擋。
- 價格:`scripts/rpm-transform.ts:284,339` 每輪 `price_general ← view.price_retail` ⇒ **後台改的價格隔天被沖掉**。
- 上下架:`rpm-transform.ts:356` 逐字「下架權威 = 來源側單一裁判(合約 §10)」。

⇒ **#22 不是「補畫面」,#20 也不是「開個 route」。** 先拍板 Q-B1 才有片可切。
⚠️ 未驗:PostgREST upsert 對 payload 缺席欄在 ON CONFLICT 分支是否保留原值(我依語意推論「保留」,**沒實測**)。這決定 save() 是否會順手清掉 `sound_clips`。

## 3. #21 上傳圖片:連底層都沒接,盤到需要六件事
現況 `images` 也來自來源 view(`rpm-transform.ts:46-49,61-63`)⇒ **同步商品的圖片同樣每輪被覆寫**,與 Q-B1 是同一題。
`packages/domain/src/catalog/types.ts:277` 寫「來源含廠商 URL 與 Supabase Storage 上傳(M-1-13 / M-1-16 **落地**)」—— 那句「落地」是**假字面**,零命中。
要接需要:① bucket 名稱與 public/private ② `storage.objects` 的 RLS policy ③ 上傳路徑慣例(建議 `products/<product_id>/<uuid>.<ext>`)④ 上傳身分(admin service_role 直傳 vs 簽名 URL)⑤ 刪圖策略(改圖後舊檔誰清)⑥ 檔案型別/大小閘。
另:`apps/storefront/next.config.ts` **無 `images.remotePatterns`**(grep 零命中)⇒ 新網域要不要進白名單我沒查渲染端,**誠實申報未驗**。

## 4. 線路圖(片數 · 依賴 · 鐵則)
```
Q-B1 拍板(價格/上下架權威歸屬)     ← 硬前置,沒拍板下面全部不能開
   ├─ #20 新增編輯商品
   │    片1 唯讀商品列表 + 詳情(route + repository 讀路徑)   標準片,不命中 8/12
   │    片2 編輯表單(文案類欄位:名稱/副標/描述/賣點)        標準片
   │    片3 save 路徑補欄 + 寫入面測試                        命中鐵則 12③(寫 products)
   ├─ #22 改價格 / 上下架   → 片數取決於 Q-B1,A 案 1 片 / B 案 3 片 + 1 支 migration
   │                          B 案命中鐵則 8 + 12①③(動 schema + 錢)
   └─ #21 上傳圖片
        片1 bucket + policy migration                          命中鐵則 8 + 12③④
        片2 上傳元件 + save images 接線                        標準片
```
`#20` 片1(唯讀商品列表 + 詳情)**不依賴 Q-B1** —— 它只讀不寫,不碰價格權威。
上圖 6 片裡我判「不需 Q-B1 就能開」的只有這 1 片(判法 = 逐片問「它會不會寫 `products` 的 price/delisted 欄」;
片2 雖只改文案欄,仍會經過同一支 `save()` ⇒ 撞 §2(a) 的欄位缺口,故仍排在 Q-B1 之後)。
⚠️ 這一句的判定**不是 grep 數出來的**,是對上圖 6 片人工逐片判、**未經第二人複核**。

## 5. 停在這裡的原因
Q-B1 是產品/資料題且不可逆(選 B 要動 schema),依夜跑規則 **不替 Sean 拍板**;選項與推薦寫在 `B-001-STOP`。
