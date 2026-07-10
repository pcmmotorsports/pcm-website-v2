# SESSION HANDOFF — 2026-07-10 品牌放量 8+1 家過夜自跑(#212 方向3)

> 一句話結果:**9 家品牌版面+混格式影片+資料鏈+乾跑+demo 全數完工,11 commit 未 push、全程零 prod 寫入;Sean 晨起已表示「有很多細節要修改」→ 下一 session 主線=接 Sean 的細節修改清單改版面。**
> 環境:pcm-website-v2 · branch dev · engineering mode · 網站庫 bmpnplmnldofgaohnaok(唯讀)+ 報價單庫 dllwkkfanaebrsuyuedy(anon 唯讀)。HEAD=`0784aff`。
> 接手先讀:晨報 `docs/handoff/2026-07-10-brand-rollout-morning-report.md`(決策題 Q1-Q6)+ kickoff `docs/handoff/2026-07-10-brand-rollout-kickoff.md`(硬規則)+ memory `project_brand-rollout-8plus1-overnight`。

## 1. 做了什麼(按時序)

1. **混格式影片三分流** — InstallResources youtube/vimeo(facade、unlisted 帶 ?h=)/mp4;管線 `pickInstallVideo` 放寬為「第一支可解析任意型」(supersede D2=A、kickoff 授權);直檔=副檔名白名單 fail-closed。`9032663`
2. **9 家品牌 showcase** — batch A `b9a4805`(evotech/lightech/cnc-racing + pd-bs 共用骨架+tokens 品牌色)、batch B `6d7ff36`(eazi-grip/samco/motogadget)、batch C `528fb83`(front3d/materya/ebc 精簡版)。每家 N°01 三卡+N°02 信任狀/產品線、smoke test、dispatcher case。信任狀=9 subagents 親讀官網、URL 佐證於檔頭、**查無不寫**(front3d 產地/samco MotoGP/motogadget Red Dot/ebc 1983·ISO 全棄用;Sean 拍板紀律)。
3. **資料鏈** — supplier-config +8 家(brandSlug MCP 實查;**writeAllowed 全 false 硬擋**)+ cncracing syncInstallResources→true + ebc seed migration `20260710120000`(未 push)。`c99379d`
4. **逐家乾跑**(唯讀)— 6 家全淨、9 家離群/異常全 0、分類 100% 對上;eazigrip handle 1 筆+eazigrip/materya spec 撞鍵 42 群(#274);ebc fail-closed(預期)。log=session scratchpad `dryruns/*.log`(⚠ scratchpad 隨 session 清、細節已摘進 #274 條目)。
5. **demo** — `/dev-preview/brands` 索引+9 單頁(fixtures=view 真資料 snapshot)。`543c9c2`;真跑截圖抓到 pd-css 未載(product-page.css 在 ProductPage.tsx 才 import、非全域)→ 補 import `78d945e`。
6. **審查鏈** — code-reviewer R1 FAIL(lightech http 圖 mixed content→修 `b6fc9b1`)→R2 PASS(佐證 3 修 `68d45ab`);adversarial-reviewer(fable)PASS-with-comments、F1-F7 全 triage(`7f1b73c`;F4 實查 bonamici 影片替換=0)。
7. **收尾 docs** — STATUS 7 欄/manifest(9 元件登錄+installResourcesField 混格式)/backlog #273-275/晨報。`0784aff`
8. **Sean 晨起訊息**:「handoff,我有很多細節要修改」→ **版面細節修改清單即將到來、尚未給出**;Q1-Q6 決策題也尚未回。

## 2. Commit 序列(push 狀態寫死)

`9032663 → b9a4805 → 6d7ff36 → b6fc9b1 → 528fb83 → c99379d → 68d45ab → 543c9c2 → 78d945e → 7f1b73c → 0784aff`(11 支)+ 本 handoff docs commit → **全數未 push**;origin/dev=`6a5d99c`(kickoff、Sean 睡前推)、origin/main=`e8a3c15`(production)。每批三綠+build+完整 vitest(終態 1863 全綠)。

## 3. DB / 部署 / 外部足跡(非 git)

- **零 DB 寫入**:兩庫全程唯讀(乾跑+MCP SELECT);ebc migration 僅 repo 檔案未套用;金流 flag、env、部署全未動。
- demo production server(:3000)與 cloudflared tunnel **已隨前一個 session 進程死掉**;晨報 §0 有重啟兩指令(`PORT=3000 pnpm start` + `cloudflared tunnel --url http://localhost:3000`,tunnel URL 每次隨機、重開後要重貼給 Sean)。
- 外部讀取:9 家官網(subagent 研究)、EBC 官方 logo.svg 下載(Sean 過夜訊息授權、晨報 Q4 再確認)。

## 4. graphify 地圖增量

已刷(本 session 動 code):**3398→3526 nodes / 5082→5273 links**、新增 128 nodes/191 edges(9 家 showcase+tests、BrandShowcase、InstallResources 新符號、demo 三檔、scripts/supplier-config+rpm-transform 家族首次入圖)。前綴驗證過(app_dev_preview_*/components_*/scripts_*、零新污染);敏感節點 0。backup=`graphify-out/graph.json.bak-20260710b`。
⚠ 兩個誠實註記:①社群**重編號**(306 個;`remap_communities_to_previous` API 簽名不合、沿用新編號——查詢按主題仍正常、只是社群 id 與上次 314 組不可對照)②本 repo 圖=**混根**:storefront 子樹 extract 根=`apps/storefront/src`、scripts/packages 用 repo 根——本次照此雙根跑、下次照抄(腳本留 session scratchpad、做法已寫進本節)。既有 192+109 顆污染節點(前 session 已知)未動、待一次性清理。

## 5. 開放項(待辦)

- 🔴 **Sean:回晨報 Q1-Q6**(逐家批准/撞鍵 triage #274/ebc db push/補圖/lightech http 圖 #275/上線順序)。
- 🔴 **Sean:給版面細節修改清單**(晨起已預告「很多細節要修改」)→ 下一 session 主線;改版面時注意:9 家共用 pd-bs 骨架(改一處動九家)、信任狀動字面要對檔頭佐證 URL、全形標點 #223、lead 兩行精簡拍板。
- 🔴 **Sean:push 決策**(11+1 commit;push dev 不影響 production,dev→main 才部署)。
- ⏳ 接手可做:#274 撞鍵 triage 實作(Sean 拍方向後)/ #275 lightech 圖(同)/ ebc db push 後重乾跑驗綠 / #273 多支影片(低優先)。
- carry-over:#272 F3 deadlock 官方化 / #265 選擇器泛化(eazigrip/samco 上線後驗)/ 圖污染節點一次性清理 / evotech·lightech 附件來源=0 待報價單側確認。

## 6. push 狀態與收尾自檢(接手第一眼)

- push:**12 支未推**(11+本 handoff commit)、樹 clean、無 secret 足跡(handoff/對話/diff 掃過、demo fixtures 無經銷欄)。
- 進入點:①讀晨報等 Sean 回 Q1-Q6+細節清單 ②有清單後逐項改(小改直接做、跨 3+ 檔提 plan)③改完重 build+重開 demo 給 Sean 複驗。
- 驗證留痕:vitest 1863 全綠(0784aff 前實跑)、乾跑 log 摘要在 #274/晨報、demo 9 頁 curl 200+桌機/手機截圖驗過(前 session)。

## 相關 plan / 記憶 / 文件

`docs/handoff/2026-07-10-brand-rollout-morning-report.md`(決策題)/ `docs/handoff/2026-07-10-brand-rollout-kickoff.md`(硬規則)/ memory `project_brand-rollout-8plus1-overnight`、`project_quote-full-import-11-suppliers`、`project_brand-showcase-gb-bonamici` / backlog #273 #274 #275 / `docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md`。
