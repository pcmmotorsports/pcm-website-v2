# SESSION HANDOFF — 2026-07-04 P0-C 前台去碳全線收工

> **一句話結果**:P0-C 前台去碳三片(a/b1/b2)全做完 + 收工文件,非 RPM 商品頁零寫死碳纖字樣、RPM 頁 byte 不變(live read-back 1118/1118 驗)。**4 commit 已 push origin/dev(未 merge main、Sean 手動)。** 全程非 auto-mode(Sean 逐題拍板)。
> **環境**:repo `pcm-website-v2` · storefront DB `bmpnplmnldofgaohnaok`(唯讀查證)· branch `dev` · mode=engineering。HEAD=`c8a618a`。
> **接手先讀**:`docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`(§4 P0-D / §5 Phase 1)· 本 handoff · 前序 kickoff `docs/handoff/2026-07-04-phase0-p0c-frontend-decarbon-handoff.md` · memory `project_quote-full-import-11-suppliers`。

## 1. 做了什麼(按時序)

- **P0-C-a brandSlug 品牌切換守門**(`5049254`)— `toUIProduct` 加 `brandSlug←product.brand.slug` + `MockProduct` 型別加欄 + 常數 `RPM_CARBON_BRAND_SLUG='rpm-carbon'`;ProductPage `isRpmCarbon` 守門:RPM 才 mount `ProductHighlights`(N°01)/`ProductSwatchWall`(N°02)、傳 `isRpmCarbon` 給 `ProductServices` 做泰國原廠卡級守門;`ProductSpotlight` 加第二道 brandSlug 守門。🔴 **F1**:守門一律用 brandSlug(≠ `brand` 顯示名 'RPM CARBON')。**RPM byte 不變 = code 逐字不變 + live read-back 1118/1118 商品 brand.slug='rpm-carbon' 驗證**(code-reviewer 逐字比對 + adversarial 9 破口全擋、雙審 0 must-fix)。
- **P0-C-b1 保固文案微調 + 全站營業時間 19:00**(`f516bfb`)— Sean 逐字提供保固文案,比對現有(已通用寫法)得 4 處微調:發票→**收據** / 孔位偏差**、超過合理公差範圍** / 走→**加** LINE / 20:00→**19:00**。保固為通用政策不守門(共用單一真相 `rpm-policies.ts` → ProductTabs/ProductFAQ/InfoShippingPage 3 消費端同步)。營業時間為全站單一真相 → Sean Q-hours=A 全站 20:00→19:00 同步(site-config / HomeFooter / rpm-policies / org-jsonld SEO schema 4 處)。haiku read-back 8/8 逐字驗。
- **P0-C-b2 ProductTabs 分頁去碳**(`9fec34a`)— 商品介紹碳纖框架 isRpmCarbon 守門(RPM 原文 byte 不變 / 非 RPM 最小事實);規格碳纖列守門 + 非 RPM 資料驅動 `buildSpecRows`(讀 variant spec key + SPEC_LABEL、值去重、無值/純空白不渲染、未知 key fallback);**安裝分頁全品牌通用去碳(Sean Q2=A:碳纖部品→部品、碳纖斷裂→部品受損、含 RPM=授權偏離非 byte 不變)**;保固 b1 已處理。雙審 0 must-fix,C1(spec=NULL→adapter 500 前提)修註解 + typeof harden + backlog #264(唯讀驗現行 DB null_spec=0)。
- **P0-C 收工**(`c8a618a`)— 純文件(STATUS 7 欄 + backlog #263-265)。**P0-C-c(ProductInfo 變體選擇器泛化)= Sean 拍 A 延 Phase 1 → #265**(非去碳〔ProductInfo 無寫死碳字〕、現無非 RPM 資料可驗、盲改 RPM 選擇器風險高)。

**結論型決策(Sean 拍板)**:① 安裝分頁 RPM 文字一併去碳(Q2=A、授權偏離)② 保固+營業時間全站更新(Q-hours=A)③ P0-C-c 延 Phase 1(拍 A)④ 多品牌上架不進進度地圖藍圖(拍 B、走 backlog 追蹤)。

## 2. Commit 序列(push 狀態)

| commit | 內容 | push |
|---|---|---|
| `5049254` | feat P0-C-a brandSlug 品牌切換守門 | ✅ origin/dev |
| `f516bfb` | chore P0-C-b1 保固文案 + 營業時間 19:00 | ✅ origin/dev |
| `9fec34a` | feat P0-C-b2 ProductTabs 分頁去碳 | ✅ origin/dev |
| `c8a618a` | docs P0-C 收工 + P0-C-c 延 Phase 1 #265 | ✅ origin/dev |

**全 4 支已 push origin/dev(`e9266a2..c8a618a`);未 merge main(Sean 手動 dev→main)。** 工作樹 clean。多 session 共用 dir → 接手先 `git fetch`。

## 3. DB / 部署 / 外部足跡

- **DB 寫入:無。** 全程零 prod 商品寫入、零 migration、零 schema。金流 flag(`TAPPAY_3DS_ENABLED`/`ANOMALY_ALERT_ENABLED`/`CRON_SWEEPER_ENABLED`)全 false。
- **唯讀查證(2026-07-04、storefront DB `bmpnplmnldofgaohnaok`)**:① brand.slug read-back = 1118 live 商品全 `rpm-carbon`(F1 資料層驗)② `product_variants_public` 9283 變體 null_spec=0 / empty_spec=1(#264 現存風險零)。
- **部署:無。** dev server 本機跑 :3001 供 Sean 肉眼驗(session 結束後可能已停)。

## 4. graphify 地圖增量

**未刷(地圖維持 pristine curated 3361 nodes / 5015 links / 0 污染)。原因**:本 session 動 code(9 支 storefront 源檔),但 graphify CLI `update <path>` 只做「整個 repo 全量 re-extract」(實測 `update .` → 3361→**9204** nodes,把 hand-curated 圖炸成全 repo raw dump、含所有 test/packages),**會摧毀既有 curation**、非增量去碳刷圖。已 backup→試 `update .`→node 暴增→**還原 pristine curated 圖**(從 graphify 自身 `graphify-out/2026-07-04/` 備份還原 5 檔、驗 3361/0 污染)。**正確增量 = recipe 手動 additive merge**(extract 變更檔 → 純加法併入 curated 圖 → verify prefix → to_json force=False),需反推 extraction/merge model,**留給專屬工程 session 做**(對齊 recipe「graph 工作在工程 session」)。變更檔清單見第 1 節。

## 5. 開放項(待辦)

- 🔴 **Sean 親自**:① `git merge` dev→main(P0-C 上線可見)② 開站肉眼驗 RPM 商品頁「商品介紹/規格」分頁**無變化**、「安裝」分頁碳纖字改「部品」、保固/footer 時間 19:00。
- ⏳ **接手可做(下一步 = Phase 0 P0-D)**:gbracing/bonamici **乾跑驗證報告交 Sean**(plan §4 P0-D、100% 唯讀零寫入;brand/category 映射、中文描述、無碳纖字、價格 round、缺圖/無 fitment 統計、handle preflight、spec 碰撞群)。本 session 前序已跑過一次可參考(見 kickoff handoff P0-D 段)。
- ⏳ **backlog(Phase 1 試點寫入前 / 上架時)**:#260 描述混批 NULL / #261 category null gate / **#264 變體 spec=NULL→adapter 500**(匯入寫 `{}` 非 NULL)/ **#265 ProductInfo 選擇器泛化**(bonamici 顏色變體 + ProductSwatchPreview 非 RPM 降級)/ #263 非 RPM 服務橫條 3 卡版面(Sean 視覺)。
- 🟢 **graphify 乾淨全量 rebuild**(工程 session):curated 圖現 3361、若要納入近期 code 改動,走 recipe 手動 additive 或工程 session 重建。
- carry-over:M-3 3DS 主線(#252/#253 gate)、#259 prod test 商品待 Sean 清 — 非本 session,見前序 STATUS。

## 6. push 狀態與收尾自檢

- **push**:4 commit 全在 origin/dev、未 merge main。下個 session 進入點:① `git fetch && git log --oneline -6` 對齊 ② 讀 plan §4 P0-D ③ 開跑 P0-D 乾跑報告(唯讀)。
- **收尾自檢**:git status clean ✅ / 無 .env·data·大檔殘檔 ✅ / secret 0 洩漏(diff·commit·本 handoff 全掃無連線字串/key/token)✅ / DB 足跡第 3 節寫齊 ✅ / graphify 未刷+原因已註 ✅ / 三綠 typecheck 7/7·lint 10/10·build 1/1·完整 vitest 153 檔 **1659**(P0-C 期間 +11 測)✅ 驗證留痕 / 雙審每片 PASS-WITH-NITS 0 must-fix ✅。

## 相關 plan / 記憶 / 文件

- plan 真權威:`docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`(§4 P0-D 下一步 / §5 Phase 1)
- 前序 kickoff handoff:`docs/handoff/2026-07-04-phase0-p0c-frontend-decarbon-handoff.md`(P0-D 可參考段)
- backlog:`docs/phase-1-backlog.md` #260-265
- memory:`project_quote-full-import-11-suppliers`(多品牌上架主線)· `feedback_sean-owns-visual-design`(#263 視覺 Sean 拍)· `reference_graphify_codebase_map`(graphify)
- manifest:`docs/design-storefront-manifest.yaml`(ProductPage/ProductServices/ProductSpotlight/ProductTabs/HomeFooter 本 session 更新)
