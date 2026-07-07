# Storefront 效能修復 P1-P3 Codex Review Packet

> 對齊鐵則 12:P1 動 vercel.json(鐵則 8 重大、影響部署)+ P3 動 pricing/tier 顯示路徑 + 進度單元收尾 → 必產 Packet 給 Sean 貼 Codex 唯讀審查。
> 真權威 plan:`docs/specs/2026-07-08-storefront-perf-fix-plan.md`(K1 codex 兩輪審過;Sean 2026-07-08 拍 Q1 批准/Q2 15 分/Q3 P4 另提/Q4 序後 #270)。

## 1. 範圍

- 本 packet 範圍:commit 2 個(P1 `93492a9`、P2 `64616ee`)+ P3(產 packet 時為 staged、隨後以精準 pathspec commit,含本 packet 共 8 檔)。
- branch:dev;基底 `b080e79`(#270 S2)。
- ⚠️ 並行 session 提示:#270 線與本批**交錯 commit**——`60996fb`(賣點 pd-list fix、Sean 肉眼驗)落在 P2 與 P3 之間,不屬本批審查範圍;P3 parent=`60996fb`。

## 2. Commit 序列

| # | hash | subject | 重點 |
|---|---|---|---|
| 1 | `93492a9` | perf(config): Vercel function region 搬 sin1 貼齊新加坡 DB [perf/P1] | vercel.json 頂層 `"regions": ["sin1"]` 一行;function(原 iad1 美東)貼齊 Supabase ap-southeast-1;含 plan 檔入 repo |
| 2 | `64616ee` | perf(storefront): 首頁 featured limit 4 下推 DB + 三段查詢並行 [perf/P2] | port `listAllProducts(options?.limit)` + 兩 adapter 實作與測試;featured `{limit:4}` 免撈全表;首頁三段 Promise.all |
| 3 | `af6d9f2` | perf(storefront): 型錄資料層 unstable_cache 900s + featured 釘 general [perf/P3] | featured/categories/taxonomy 快取(catalog 因 2MB 上限豁免);fetchFeaturedProducts 去 tier 參數 |

## 3. 字面 vs 事實揭示

- **P1**:TapPay 官方文件查無 outbound IP allowlist 要求(未確認、首筆 sandbox 交易可驗);本專案 Hobby 方案之判定來自 repo handoff 記錄非 API 直查(Hobby=單 region 合規,若部署失敗即回退)。生效需 push dev→main deploy。
- **P2**:驗收=查詢語意等價(全目錄 id 升冪前 4),不承諾肉眼畫面不變(#259 首格測試商品為既有內容問題、本批不碰)。契約落地擇「兩 adapter 可執行測試」非轉實 contract 檔(plan §P2 二擇一)。
- **P3 語意變更(plan 明示、Sean 批准)**:帶 tier cookie 的訪客首頁精選價由「dummy 資料算出的 tier 價」變 general 價——anon 路徑 store/premiumStore 價本為 dummy 0(mappers/product.ts:172,179),傳真 tier 會顯 NT$0 錯價,釘 general=修正非退化;真 tier 定價待 #215。
- **P3 快取豁免(實作期實測發現、與 plan 原字面偏離)**:`fetchCatalogProducts` **不包快取**——全目錄投影 3,816,327 bytes 超過 Next data cache 單條 2MB 上限、寫入被拒(本地 production server log 逐字:「items over 2MB can not be cached (3816327 bytes)」);/products 快取治本併 P4。plan §P3/§2 已同步校正。
- **P3 機制驗證**:「force-dynamic 頁面內 unstable_cache 照樣生效」經雙重驗證——①Next 16.2.6 原始碼(create-component-tree.js:150 只設 forceDynamic、work-store.js:47 fetchCache 僅來自 segment export、unstable-cache.js:146 只檢查 fetchCache)②本地 production server 行為實證(3 條 tags=['catalog'] revalidate=900 條目寫入、首頁重複請求 TTFB 0.010-0.014s)。K2 round1 相反主張經此證據駁回、round2 PASS。

## 4. Manifest 異動摘要

- `AccountView` 條目 `last_modified_commit` → `64616ee`(可達祖先;本批真改僅檔頭註解對齊新簽名)。
- `HomeSelect` `featuredDataSource` override:校正雙重過時描述(tier 參數已除;listByCategory 自 C4/#205 起已改 listAllProducts、當時漏同步)。
- `AccountPages` `featuredProductsViaSupabase` override:同步 fetchFeaturedProducts() 新簽名與快取描述(K2 round2 nit)。
- `node scripts/design-mirror.mjs --validate`:26 元件 / 24 last_modified_commit 可達 OK。

## 5. 風險殘餘(誠實列出、未自宣接受)

1. unstable_cache 於 **Vercel 部署上的跨 instance 共享**:Vercel runtime-cache 文件版本對照表未把 unstable_cache 明列於 Next 16+ 列(僅 15 列)——本地已證機制有效;跨 instance 行為部署後以重複 curl TTFB 驗,若無共享效果 fallback 為 'use cache'(另提 plan)。
2. /products 在本批後仍每請求全表撈取+序列化 3.8MB RSC(快取豁免)——P1 後預估 1.5-2.5s、非 <1s;治本=P4(#51、Sean 已拍上線實測後另提)。
3. cron(settle-sweep/anomaly-alert)隨 function 搬 sin1:打同區 Supabase 應更快;部署後首次 cron 執行留意 log。
4. 快取 staleness 上限 15 分鐘(Sean 拍 Q2);人工改 DB 後最壞 15 分鐘生效,revalidateTag('catalog') 主動失效鉤子本批未接。

## 6. Rollback 方式

- P3:`git revert af6d9f2`(快取層純包裝、拆掉即回 P2 行為;featured 簽名 revert 連動兩呼叫點同 commit 內)。
- P2:`git revert 64616ee`(port 選用參數、無 schema/資料變更)。
- P1:刪 vercel.json `"regions"` 行再 deploy、回 iad1 預設。
- 全批反序 revert 即回 `b080e79` 基線;零 DB 寫入、零 migration、金流 flag 全 false。

## 7. 相關規則摘錄(Codex 無 repo 存取、自帶上下文)

- **Server 端鐵則(PCM CLAUDE.md)**:會員等級驗證必在 server 端重查;client component 不得 import 洩漏經銷價模組;**經銷價絕不傳到一般會員瀏覽器**;金額整數/Decimal、禁 number 浮點(本批不動金額型別)。
- **鐵則 8**:vercel.json/跨 3+ 檔=重大改動,plan 先批准(已走:plan + K1 兩輪 + Sean Q1)。
- **鐵則 11**:每 slice 三綠(typecheck/lint/build)+ 完整 vitest;不 disable/skip。
- **鐵則 12**:本 packet 即其產物;commit 前產、不 push、findings 回來再決定。
- **經銷價資料鏈背景**:storefront 只打 `products_public` view(view 級排除 price_store/price_by_tier/metadata)+ anon client(RLS);mapper 對 store/premiumStore 填 dummy 0;故任何被快取內容皆為 general 公開投影、無經銷欄位。

## 8. 預計後續 slice / milestone 範圍

- Sean push dev→main → Vercel deploy → **驗證三件**:①`x-vercel-id` 落 `sin1` ②首頁重複 curl TTFB(快取命中應 <1s)③首筆 cron/金流 sandbox 正常。
- Sean 開站實測(後端驗收關卡)後 → 另提 **P4 plan**(#51:/products server 分頁 + 列表輕量投影 + 單頁 <2MB 恢復快取;牽動 8 維前端篩選下推、獨立 2-4 slice)。
- 可選 follow-up:revalidateTag('catalog') 接到每日同步完成點(主動失效、消 15 分 staleness)。
