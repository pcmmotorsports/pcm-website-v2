# Storefront 效能修復 Plan(shop.pcmmotorsports.com 首載/目錄慢)

> 2026-07-08。狀態:K1 round1 FAIL(6 must-fix + 2 nit)逐條修入;round2 核對 round1 修正全過、另抓 2 條新 must-fix(P2 測試防線)亦已修入。按複審硬上限 2 輪紀律不跑 round3,round2 狀態如實列入 Sean 批准資訊。待 Sean 批准。
> 依據:同日五路診斷工作流 + 五路偵察工作流(全 findings 經 fresh opus 驗證者確認)。
> 鐵則 8 適用:動 vercel.json(P1)+ 跨 3+ 檔(P2/P3)。

## 0. 量測結論(root cause,已驗證)

- 首頁 TTFB 8.4-12.2s、/products 5.4-7.2s、詳情頁 2.1-2.4s;/login 0.33s(對照組:基礎設施無辜)。
- 三個相乘的放大器:
  1. **跨區**:Vercel function 在 iad1(美東、預設),Supabase 在 ap-southeast-1(新加坡),每 DB 往返 ~240ms(業界典型值,未從 iad1 實測)。
  2. **零快取**:全站 force-dynamic、4 個資料函式無任何跨請求快取,每個訪客付全額。
  3. **全表撈取**:首頁精選撈全店 3,602 件只取 4 件(products.ts:201 自承 stopgap);/products 每請求重建全店 4.36MB RSC payload、分頁靠前端切;車種選單再掃一輪全表;分類 N+1(17 查詢)。
- 首頁三段資料抓取串行 await(page.tsx:50,53,56),未 Promise.all。

## 1. Slice 拆分(P1→P3 本批;P4 獨立 plan)

### P1(修法 A):vercel.json 加 `"regions": ["sin1"]`

- **改什麼**:vercel.json 頂層加一行 `"regions": ["sin1"]`(新加坡,與 Supabase ap-southeast-1 同城)。語法經官方文件查證(vercel.com/docs/functions/configuring-functions/region:頂層 regions 陣列)。
- **為什麼**:function↔DB 每往返 240ms → 個位數 ms,對所有 DB-bound 路由立即生效(含詳情頁 2.1s→預期 <1s)。
- **影響面**:全部 serverless functions 搬到 sin1,含 2 條金流 cron(settle-sweep/anomaly-alert)——它們打的也是新加坡 Supabase,只會更快。台灣訪客鏈路變 hkg1 edge→sin1(近)。outbound IP 會變:TapPay 官方文件查無 IP allowlist 要求(未確認項,首筆 sandbox 交易可驗)。Hobby 方案允許單一 region(官方:Hobby=Single region);本專案為 Hobby(依 repo handoff 記錄,未經 API 直接確認——若部署失敗再回退)。
- **Rollback**:刪掉該行重新 deploy,回到 iad1 預設。
- **連動**:只解 backlog #65 的「Vercel Functions 預設 region」子項(#65 不關閉——其餘子項含 Railway 字面已被 #105 標過時,#65 的收攏另提);K1 round1 糾正措辭。

### P2(修法 C):首頁抓法修正(只撈 4 件 + 三段並行)

- **改什麼**:
  1. `fetchFeaturedProducts`:棄用 `listAllProducts()+slice(0,4)`,改為帶 limit 的查詢。**現行語意 = 全目錄 id 升冪前 4**(products.ts:182 註解:C4 已解除單一分類;K1 round1 糾正,不用 listByCategory)。實作路徑:`listAllProducts` 加**選用參數** `options?: { limit?: number }`(不動既有呼叫點的相容擴充),Supabase 端 `.order('id').limit(4)`;**in-memory adapter 的 limit 路徑必須先依 id 升冪排序再取 limit**(現況是插入序,K1 round2 抓的分歧點)。
  2. `page.tsx` 三段資料抓取(featured/taxonomy/categories)改 `Promise.all` 並行。
- **為什麼**:首頁最大單一成本(撈 4MB 只用 4 筆)歸零;三段延遲從相加變取最大值。
- **影響面**(K1 round1 補完整):apps/storefront/src/app/page.tsx、apps/storefront/src/lib/products.ts、packages/ports/src/IProductRepository.ts、packages/ports/src/IProductRepository.contract.ts、packages/adapters/src/supabase/SupabaseProductAdapter.ts、packages/adapters/src/in-memory/InMemoryProductRepository.ts(+其測試)——約 7 檔,鐵則 8 成立;port 變更為選用參數、既有簽名不破壞。層級合規:adapters 只 import domain+ports、apps 可 import 全部(eslint boundaries 7 條,見 §3)。
- **Rollback**:git revert 單 commit;無 schema/資料變更。
- **驗證**:驗收 = **查詢語意等價**(全目錄 id 升冪前 4),不承諾肉眼畫面不變(#259 已記載首格為測試商品,屬既有內容問題、本 slice 不碰不解);**補「可執行」測試**(K1 round2:contract 檔現況全 `it.todo`、守不住語意)——`InMemoryProductRepository.test.ts` 加**亂序 seed** 斷言 `listAllProducts({ limit: 4 })` 回 id 升冪前 4,Supabase adapter 側以同語意測試或轉實 contract 斷言擇一落地;pnpm test 全套 + 三綠。

### P3(修法 B):資料層跨請求快取(unstable_cache)

- **改什麼**:資料函式加 `unstable_cache`(Next 16.2.6 查證:仍可用、不需 config flag、force-dynamic 頁面內照樣生效——**實作期雙重驗證**:①原始碼 force-dynamic 只設 workStore.forceDynamic、不動 workStore.fetchCache〔create-component-tree.js:150 / work-store.js:47 / unstable-cache.js:146〕②本地 production server 行為實證 3 條 catalog-tag 快取寫入+讀取、首頁重複請求 0.01s;K2 round1 對此的 must-fix 經雙重證據駁回。**cached 函式紀律:只接純參數、內部不呼叫 cookies()/headers()、不閉包 tier/request 狀態**——皆純 Supabase anon 查詢,合法;`'use cache'` 新模式需開 cacheComponents 翻渲染模型,留作日後 fallback、本批不採):
  - `fetchCategories` / `fetchVehicleTaxonomy`:輸出對所有訪客恆等(偵察驗證過),直接包(實測條目 4KB/28KB)。
  - ⚠️ `fetchCatalogProducts` **豁免不包**(實作期實測發現):全目錄投影 3,816,327 bytes 超過 Next data cache 單條 2MB 上限、寫入被拒(server log 逐字留證)——包了=永無命中還每請求多付 miss+必敗寫入+2 行錯誤 log。/products 快取治本併入 P4(server 分頁後單頁投影 <2MB 自然可快取)。
  - `fetchFeaturedProducts`:⚠️ 輸出隨 tier 變(price/originalPrice/tierLabel 走 computeEffectivePrice)。拆成 `getFeaturedUIProductsCached()`(快取 general UI 投影、實測條目 <1KB、無任何 tier 變體進快取;K2 round2 對齊實作名)+ 外層 catch;**顯示價釘死 general**(K1 round1 糾正:anon 路徑的 store/premiumStore 價本來就是 dummy 0——mappers/product.ts:172,179——把真 tier 傳進 toUIProduct 會顯示 NT$0 錯價;釘 general 與 fetchCatalogProducts 及 account/page.tsx:91,98「禁 tier-aware pricing」既有先例一致)。call sites 全列:app/page.tsx(首頁)、app/account/page.tsx(已固定 general)。
  - revalidate 秒數 = Sean 拍板(見 §4 Q2);加 cache tags 供未來 on-demand 失效。
- **為什麼**:商品資料每天只在台灣時間 12:30 由 GitHub Actions rpm-sync.yml 更新一次(2026-07-22 前為 03:00;15 分快取的理由不受影響)(vercel.json 的 2 條 cron 是金流用途、與商品無關),快取幾分鐘零業務風險;第二個訪客起 DB 成本歸零。
- **影響面**:src/lib/products.ts 為主(+featured 重構牽動 page.tsx、account/page.tsx 呼叫點對齊)。**安全紅線已預先驗證**:四函式打 products_public view(view 級排除 price_store/price_by_tier/metadata)+ anon client(RLS),經銷價欄位雙重擋在快取之外;featured 顯示價釘 general 後,任何 tier 變體皆不進快取、也不再有 dummy 0 錯價路徑。**語意變更明示**:帶 tier cookie 的訪客首頁精選價將從「dummy 資料算出的 tier 價」變為 general 價(現行 tier 價在此路徑無正確資料源,屬修正非退化;真 tier 定價待 #215 server 端 tier 查證後另接)。
- **Rollback**:git revert;快取層是純包裝、拆掉即回原行為。
- **殘餘未確認項**:Vercel 文件的版本對照表未把 unstable_cache 明列在 Next 16+ 列(僅 15 列),跨 instance 共享行為部署後用重複 curl 實測 TTFB 確認;若無共享效果,fallback 是改 'use cache'(需開 cacheComponents,另提 plan)。
- **連動**:#206(詳情頁 ISR 需連動 JSON-LD 價格一致性)不觸發——本 plan 不動詳情頁快取。

### P4(修法 D):/products 改 server 端分頁 —— 獨立 plan、不在本批

偵察確認牽動面遠大於分頁本身:目前車種/分類/品牌/價格/現貨/新品/特價/顏色 8 維篩選 + 排序全部是前端在全量陣列上運算(products-filter-logic.ts),URL 狀態用 history.replaceState 刻意避開 server re-fetch;改 server 分頁 = 篩選/排序全部下推 server + URL 狀態設計反轉 + 兩個測試檔(248+202 行)大改。這正是 backlog #51 的正解範圍,建議:P1-P3 上線量測後,以 #51 為題另提 plan 拆 2-4 個 slice。P1-P3 完成後 /products 預期已 <1s(快取命中),殘餘痛點是 4.36MB payload 的傳輸與 client 解析。

## 2. 預期效果(拆帳依據:驗證者 root cause chain)

| 路由 | 現況 | P1 後 | P1+P2+P3 後(快取命中) |
|---|---|---|---|
| 首頁 | 8.4-12.2s | ~1.5-3s | **<1s**(三段皆快取、本地實測重複請求 0.01s) |
| /products | 5.4-7.2s | ~1.5-2.5s | 同 P1 後(**快取因 2MB 上限豁免**、serialize 3.8MB 為主,P4 治本) |
| 詳情頁 | 2.1-2.4s | **<1s** | 同左(不快取、#206 不觸發) |

數字為估值;每 slice 收工用 curl 三次量測留證。

## 3. 相關既有紀錄與連動面

- backlog **#51**:現載範圍僅「三方法 JSDoc 分頁 TODO 一致性」(K1 round1 糾正——**#51 不是本 plan 的授權依據**);本 plan P2/P4 的實作分頁是自帶 scope、由本 plan 經 Sean 批准授權,#51 屆時引用本 plan 收攏。
- backlog **#65**(部署 region 待 Sean 拍板)= P1 只解 Vercel Functions region 子項、#65 不關閉。
- backlog **#205**(featured 旗標機制 Phase-1 暫緩)= P2 維持現行「全目錄 id 升冪前 4」語意(C4 後現狀)、不動 #205 範圍;**#259**(首格為測試商品)為既有內容問題、本 plan 不碰不解。
- backlog **#206**(詳情頁 ISR 前置評估義務)= 本 plan 不動詳情頁、不觸發。
- backlog **#247**(sitemap 效能輕量列舉待)= 不在本 plan,P4 時順帶評估。
- 商品同步管道:.github/workflows/rpm-sync.yml 每日 UTC 04:30(台灣 12:30;2026-07-22 前為 UTC 19:00 / 台灣 03:00)。
- eslint boundaries 7 條(eslint.config.js:60-;adapters→domain+ports、apps→全部)——P2 動 ports+adapters,K1 審查已附此規則。
- 查無任何「快取/region 禁動」的既有拍板(偵察遍搜 backlog/STATUS/lessons §12/specs/handoff)。

## 4. Sean 拍板(2026-07-08 已拍、對話原文 q1:a / q2:15 / q3:a / q4 等另一邊收工)

- Q1 = **批准**:照修訂版 plan 動工 P1→P2→P3(region 用 vercel.json 落碼)。
- Q2 = **15 分**:P3 revalidate = 900 秒。
- Q3 = **A**:P4(#51 目錄真分頁)待 P1-P3 上線、Sean 開站實測後另提 plan。
- Q4 = **等並行 session 收工**:GBracing 賣點線(#270、scripts/rpm-* + 20260708120000 migration)commit 完、工作樹回乾淨後,本 plan 才開工(避免共用 git index 互掃,見 memory 並行 session 教訓)。

## 5. 內容分級與守門

- L 分級:純程式效能工程、無新內容 → N/A(無 L3 內容)。
- 鐵則 12:P1 動 vercel.json(鐵則 8 重大)→ 本批收尾產 Codex Review Packet。
- 每 slice:三綠 + code-reviewer subagent + 全套 pnpm test(動共用層);P1-P3 各自獨立 commit、可獨立 revert。
