# SESSION HANDOFF — 2026-07-10 全量上線 ops(V1 版面上 production + 三家資料同步 + bonamici #267 合併落地)

> 一句話結果:**#270 全系列(20 commit)上 production 且 live 驗過;gbracing/bonamici 安裝資源同步 live;bonamici 1252→590 群合併落地;D001R 4 筆錯價(NT$100)被乾跑閘攔下、Sean 報價單側修復後才寫入。** push 狀態:main=dev=e8a3c15 已推;本機 dev 領先 2 支 docs commit 待推。
> 環境:pcm-website-v2 · branch dev · Supabase 網站庫 bmpnplmnldofgaohnaok + 報價單庫 dllwkkfanaebrsuyuedy · production=shop.pcmmotorsports.com(Vercel、main)。HEAD=見 §2。
> 接手先讀:STATUS.md 最後更新前 2 條 + memory `project_install-resources-manuals-video-270` / `project_midsection-b-accordion-full-width-270` / `project_variant-model-unification-267` + backlog #272。

## 1. 做了什麼(按時序)
1. **#270 中段 V1 slice 收尾** — 四段收合手風琴 + V1 整合式左條版面(Sean 看 4 版比較 artifact 拍 V1)+ 內文字級對齊品牌 .pd-lead + LINE_REMINDER 改交期諮詢文案(Sean 授權)。code-reviewer 兩輪(R1 5 stale 註解/R2 commit msg 2 處)全修。commit `e8a3c15`、Sean 肉眼驗 OK 後授權推 dev。
2. **報價單 view migration 手動套用** — `20260709_storefront_catalog_v_expose_install_resources.sql`(pdf_urls/video_urls 曝露+anon 欄級 GRANT)。🔴 `supabase db push` 在報價單 repo 卡 migration 歷史漂移=**常態**(view migration 一律 Sean 手動 SQL Editor 套、勿跑 CLI 建議的 `migration repair`/`db pull`)。套用後唯讀驗:view 兩欄在、anon 可讀、1481 gb/bona 列有資料。
3. **gbracing 同步** — 乾跑全綠(0 變價/0 下架/0 離群)→ `--confirm-write`:942 商品/942 變體,網站庫 724 個有說明書。
4. **D001R 錯價攔截** — bonamici 乾跑離群閘抓到 4 筆 54,400→100(-99.8%):報價單源頭 €1.25 應為 €1,249(義大利千分位解析 bug)。**Sean 報價單側修復**(€1249/1469/1649/1869)→ 乾跑 round2 全綠才寫。🔴 報價單 fetcher 千分位 bug 未修(那邊 repo);錯價若再現、本 repo 乾跑離群閘會再攔。
5. **bonamici 同步 = #267 合併落地** — 報價單已把 1252 頁合併成 590 群(663 重複頁 is_listed=false、抽樣 6 筆全驗證=刻意合併非抓取殘缺)。同步分兩步:`--allow-fetch-shrink` 寫入(590 群、428 說明書、15 影片)→ **F3 雙旗標互斥 deadlock**(backlog **#272**)→ 一次性腳本(scratchpad、複用 `computeDelist`/`applyDelist` + 硬斷言 590/663)軟下架 663。
6. **production 部署** — `git push origin dev:main`(8d84271..e8a3c15、FF、20 commit)→ Vercel 自動 deploy。live 驗證:首頁 200(TTFB 1.8s、效能修復生效)、GB 商品頁 V1+安裝資源+新文案指紋全中、bonamici 合併頁 200 / 下架頁 404。
7. **RPM** — 乾跑 0 delta(每日 cron 03:00 matrix 已保持最新),無需寫。

## 2. Commit 序列(push 狀態寫死)
| commit | 內容 | push |
|---|---|---|
| `e8a3c15` | feat(storefront): 商品頁中段收合手風琴 + V1 整合式左條版面 [#270](8 檔) | ✅ 已推 dev + main(production live) |
| `cddc88d` | docs: 全量上線 ops 紀錄 + backlog #272(STATUS+backlog) | ⏳ 未推 |
| (本檔) | docs: handoff | ⏳ 未推 |

## 3. DB / 部署 / 外部足跡(git 看不到)
- **報價單庫(dllwkkfanaebrsuyuedy)**:`storefront_catalog_v` REPLACE(+pdf_urls/video_urls 末二欄)+ `grant select (pdf_urls,video_urls) on products to anon` — Sean SQL Editor 手動、migration 檔在報價單 repo、**未進該庫 CLI migration 歷史**(該庫慣例)。rollback 段在檔尾註解。
- **網站庫(bmpnplmnldofgaohnaok)products/product_variants**:gbracing upsert 942/942;bonamici upsert 590 群/1006 變體 + **軟下架 663**(delisted_at=2026-07-10、可回復);安裝資源欄 manuals/video_url 填入(gb 724 說明書;bona 428 說明書+15 影片)。終態:bonamici listed 590/delisted 663、gb-racing 942/0、rpm-carbon 1117/291(歷史)。
- **部署**:Vercel production ← main `e8a3c15`(自動);無 env 變更;金流 flag 維持 false。
- **每日 cron** rpm-sync.yml(03:00 matrix rpm/gbracing/bonamici):bonamici 自本次同步後 baseline=590、不再 preflight abort。

## 4. graphify 地圖增量
動了 code(e8a3c15)→ 已刷:**3361→3398 nodes / 5015→5082 links / 314 communities**、新增異常前綴 0。🔴 眉角:**本 repo 圖的 extract 根=`apps/storefront/src`**(節點 id `components_*`/`lib_*`/`data_*`),不是 repo 根——第一次用 repo 根跑出 34 個 `apps_storefront_src_*` 孤兒、已 rollback 重跑乾淨版。圖內既存 109 個 `apps_storefront_*` 舊污染(早期 run 遺留、有乾淨雙胞胎)=已知漂移、待一次性清理。備份:`graphify-out/graph.json.bak-20260710`。

## 5. 開放項(待辦)
- 🔴 **Sean**:推 dev 2 支 docs commit(一鍵:`git push origin dev`)。
- 🔴 **報價單 repo**:fetcher 義大利千分位解析 bug(€1.250→1.25;D001R 已人工修值、根因未修,lightech 等歐系來源同險)。
- ⏳ **下一 milestone:報價單全供應商寫入(#212 方向3 放量、Sean 2026-07-10 口頭指定 eazigrip/evotech 等)** — 見 §6 決策點。來源現況(storefront_catalog_v、中文名 100%):lightech 4,566 群(2,403 PDF)/ evotech 3,460 / cncracing 1,978(2,748 PDF+150 影片、config 已在但 writeAllowed=false)/ eazigrip 1,740(5,273 變體)/ samco 1,403(**14,165 變體**)/ motogadget 912 / front3d 108 / ebc 68(54 影片)/ materya 54。supplier-config 目前只註冊 rpm/gbracing/bonamici/cncracing 四家。
- ⏳ **#272** rpm-import F3 deadlock 官方化(0.5-1 天;下次「既有品牌大改組」才會撞,新品牌首次上架不會)。
- ⏳ **#265** 變體選擇器泛化(P0-C-c 延 Phase 1)— eazigrip/samco 變體極多,放量前後要對齊。
- carry-over:#257 RPM 33 缺圖(Sean 補圖)/ #259 test 商品 live 首頁(待 Sean 點頭刪)/ database.types 落後 live(rec-engine 後另做)/ gbracing 9 料號缺車型(報價單補後 re-sync)。

## 6. push 狀態與收尾自檢 + 下一步進入點
- push:main=origin/dev=`e8a3c15`(production live);本機 dev 領先 2 支 docs 待推。working tree clean、無 secret 足跡(對話與本檔皆無 key/token 字面)。
- **放量 milestone 開工前的關鍵拍板(擋在最前)**:既有拍板「Q1=A 嚴格 N°02 到位才可見」(2026-07-03 multibrand kickoff)——9 家新品牌若逐家做 N°02 品牌大版面=重工作量;是否對小品牌放寬(通用版面/無 N°02 先上)需 Sean 重拍。次要:每家 brand row seed、supplier-config 註冊、handle charset 乾跑 gate(同 #266 型)、fitment 車種覆蓋驗證。
- 進入點:①讀本檔 §5 來源現況 ②讀 `docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`(地基已全數完工)③向 Sean 提放量 plan(含 N°02 gate 重拍決策題)→ 逐家乾跑→寫入。

## 相關 plan / 記憶 / 文件
- `docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`(Phase 0 地基、放量前提)
- `docs/specs/2026-07-09-install-resources-source-chain-plan.md`(安裝資源鏈、已全上線)
- `docs/specs/2026-07-04-variant-model-unification-plan.md`(#267、bonamici 網站側已落地)
- memory:`project_install-resources-manuals-video-270`、`project_midsection-b-accordion-full-width-270`、`project_variant-model-unification-267`、`project_quote-full-import-11-suppliers`
- backlog:#272(F3 deadlock)、#265(選擇器泛化)、#266(handle charset)
