# KICKOFF — 品牌放量:8+1 家供應商品牌版面(N°02 SOP 化)+ 資料鏈 + 混格式影片嵌入 + demo(2026-07-10 夜)

> Sean 拍板(2026-07-10):**C = 品牌版面做好才上架**;版面由 Claude 照 rpm/gbracing/bonamici 三家經驗(=SOP)分析內容/圖片/擺設**直接製作**、全部做好給 demo 檢查;資料庫連結與文案先接好;非 YouTube 影片(Evotech mp4 / Lightech·CNC Vimeo)嵌入照報價單 repo 指南。
> 本檔=過夜自跑 session 的作業手冊。**鐵則 8 plan 已由 Sean 經 kickoff 預批範圍**;關卡1 改跑 codex-adversary(或 quota 牆時 adversarial-reviewer)折 findings、不等 Sean。

## 0. 過夜硬規則(先讀)
1. **零 prod 寫入**:新 8 家 supplier-config `writeAllowed: false`(F4 護欄天然擋 `--confirm-write`);只乾跑。`--confirm-write` = 早上 Sean 批 demo 後才翻 true 執行。**不 push、不 deploy、不動金流 flag、不動 .env**。
2. **單家卡關 2 輪 → 記錄、跳下一家**(per-brand 隔離、不讓一家卡整夜);全域性卡death → 寫晨報停。
3. 每批 slice:三綠 + 完整 vitest;code-reviewer 每 2-3 家一輪(fresh);字面 vs 事實照鐵則 11。
4. 品牌**圖片授權紀律**:showcase 只用報價單庫既有商品圖 URL(與商品頁同授權基礎);品牌 logo/官方形象照 = Sean 授權 gate → 先用**文字 lockup**(對齊直角美學)、晨報列每家「待 Sean 補圖清單」。GB/Bonamici 前例:真圖都是 Sean 提供才上。
5. 信任狀/年份/數字:**官方網站來源 URL 佐證才用**(派 sonnet subagent 逐家查、T4 範本、顯式 model);查無 → 質性文案不編數字。記 #271 型 L2(hardcode+TODO)。
6. 文案:繁中、台灣買家語氣(怕買錯/裝不上/退不掉,見 memory `project_tw-marketplace-copy-conventions`);全形標點(#223 override);N°01 lead 精簡兩行(Sean 拍板、勿長)。

## 1. 供應商清單與 slug 對照(2026-07-10 實查 storefront_catalog_v;中文名 100% 已備)
| quote slug | brand slug(website、已 seed) | 群 | 變體 | PDF | 影片 | 備註 |
|---|---|---|---|---|---|---|
| evotech | evotech | 3,460 | 3,460 | 0* | 0* | 1:1 最單純;*指南稱 2026-07-10 已填(mp4/S3 PDF)、開工重查 |
| lightech | lightech | 4,566 | 8,788 | 2,403 | 0* | 最大;Vimeo 預期 |
| cncracing | cnc-racing | 1,978 | 4,376 | 2,748 | 150(Vimeo×162) | config 已在、補 syncInstallResources |
| eazigrip | eazi-grip | 1,740 | 5,273 | 0 | 0 | 變體多(顏色) |
| samco | samco | 1,403 | **14,165** | 0 | 0 | 變體王、留最後 |
| motogadget | motogadget | 912 | 912 | 0 | 0 | |
| front3d | front3d | 108 | 108 | 0 | 0 | |
| materya | materya | 54 | 90 | 0 | 0 | |
| ebc | **❌ brands 無此列** | 68 | 112 | 0 | 54(YouTube 類) | 準備 seed migration 待 Sean db push、demo 照做、寫入延後 |

## 2. 工作順序(建議整夜排程)
1. **開工儀式**(branch=dev/樹淨;若 Sean 尚未推 dev 上 2-3 支 docs commit=正常、不阻擋)→ 讀本檔 + `docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md` + memory `project_quote-full-import-11-suppliers`、`project_brand-showcase-gb-bonamici`。
2. **混格式影片嵌入**(全品牌共用地基、先做):照 `/Users/sean_1/API大量上架/PCM報價單-V2/docs/INSTALL_RESOURCES_EMBED_GUIDE.md`——
   - `resolveVideo` 三分流(youtube/vimeo/file):UI `InstallResources` 由 YouTube-only facade 擴為三型(youtube/vimeo=iframe facade 點擊載入;mp4=`<video controls preload="metadata" playsInline>`)。
   - 管線 `rpm-transform.pickInstallVideo` 由「第一支 YouTube」放寬為「第一支可解析的任意型」(`products.video_url` 維持單支 text、免 migration;多支=follow-up 記 backlog)。
   - 影響回填:bonamici(29 源影片現只落 15)/cncracing(Vimeo×162)在早上 confirm-write 時自然補上。
   - CSP:查 next.config/vercel.json 現況——無 CSP 則免動;有則放行 frame-src youtube/player.vimeo、media-src cdn.shopify/*.amazonaws。
   - 測試:三型 embed 各補 vitest;指南 §5 驗收案例照做(乾跑/fixture 層)。
3. **信任狀研究**(可與 4 並行):8+1 家官方網站 → 每家「品牌一句話定位 / 2-4 個可佐證事實(附 URL)/ 產品線 3-5 類」,subagent sonnet、回報合約 ≤80 行/家。
4. **品牌版面 SOP 化製作**(核心、逐家):照三家前例(`GbRacingShowcase.tsx`/`BonamiciShowcase.tsx`/RPM 三件套)——
   - 每家一元件(#212 Q1=C)、重用 pd-feature 骨架 + pd-gb/pd-bona 既有 CSS 模式;品牌色進 tokens.css(不覆 --c-gold);`BrandShowcase` dispatcher 加 case。
   - 結構:N°01「為什麼選 X」三卡 + N°02 品牌大版面(工程血統/產線巡禮/信任狀/有影片則 facade);內容密度依品牌規模伸縮(小品牌 front3d/materya 可精簡版=N°01+短 N°02、不硬撐)。
   - 商品圖:從報價單 view 該品牌實際 image_url 選用(原生 <img>、對齊 swatch 慣例)。
   - 鐵則 6 檔案上限;每家 smoke test(`*.test.tsx`)。
5. **資料管線接線**(逐家):supplier-config 8 家新 entry(slug 對照如 §1、brand_id 開工時由 brands 表實查、category 走 16 大類 mapping)+ ebc seed migration 檔(不 push)→ **逐家乾跑** `pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=<slug>`,報告存檔;盯:分類未對上清單 / handle charset(#266 型)/ **離群價**(D001R 千分位 bug 同源風險、歐系供應商特別盯;任何離群=晨報決策題、絕不視為雜訊)。新品牌無既有 target → 無 #272 deadlock 問題。
6. **Demo**:`/dev-preview/brands` 索引 + 每家 `/dev-preview/brands/<slug>` 用**報價單 view 真資料 snapshot fixture**(寫個小腳本拉 view 存 fixture、含該家代表商品 3-5 件)渲染完整 showcase;production build + `PORT=3000 pnpm start` + cloudflared tunnel;URL 逐家列進晨報。
7. **收尾**:STATUS 7 欄 + manifest(新元件登錄)+ memory 拍板落檔 + handoff;commit 照 slice 切、精準 add、**不 push**。

## 3. 晨報格式(Sean 醒來第一眼)
- 上層白話:每家一行狀態表(版面✅/乾跑✅/demo URL/待決策)+ 一句「今晚做到哪」。
- 決策題批次(prose code block、multi-select):①逐家 demo 批准與否 ②離群價/分類未對上 triage ③ebc seed migration db push ④品牌補圖清單(logo/形象照)⑤批准後執行順序(翻 writeAllowed → confirm-write × N → Sean push dev+main → deploy 驗證)。
- 全程未 push、未寫 prod 聲明 + 證據(git log / 乾跑報告路徑)。

## 4. 已知風險與前置事實
- evotech/lightech 附件今日截面 0、指南稱已填 → 開工先重查 view 覆蓋,以實查為準(附件晚到不阻擋版面與管線工作)。
- 變體選擇器:bonamici 多變體已 live 可對照;eazigrip/samco 變體更多 → vitest fixture 驗 + 晨報標「寫入後真頁驗收」;若發現選擇器不支援 → 記 #265、該家標「版面好但寫入延後」。
- samco 14,165 變體:乾跑耗時可能長、放最後;超時就標 deferred。
- 報價單 fetcher 千分位 bug 未修(D001R 前例):所有乾跑離群清單一律晨報、零自行放行。
- codex 月牆(memory)→ 關卡審查用 adversarial-reviewer(model:fable)+ code-reviewer。
- 相關 backlog:#265(選擇器)/ #266(handle charset)/ #271(信任狀後台化)/ #272(F3 deadlock、本輪不撞)。

## 5. 參考檔
- 版面前例:`apps/storefront/src/components/GbRacingShowcase.tsx`、`BonamiciShowcase.tsx`、`ProductHighlights.tsx`、`BrandShowcase.tsx`、`product-page.css`(pd-gb-*/pd-bona-*/pd-feature)
- 管線:`scripts/supplier-config.ts`、`scripts/rpm-import.ts`、`scripts/rpm-transform.ts`(normalizeManuals/pickInstallVideo)
- 嵌入指南:`/Users/sean_1/API大量上架/PCM報價單-V2/docs/INSTALL_RESOURCES_EMBED_GUIDE.md`
- 前情:`docs/handoff/2026-07-10-full-launch-ops-handoff.md`、memory `project_install-resources-manuals-video-270`
