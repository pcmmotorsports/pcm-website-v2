# Handoff 2026-07-11 — 商品頁版寬撐滿 + UX 一輪(前台視覺體檢落地）

> 真權威落 memory `project_catalog-fullwidth-fonts-2026-07-11.md`(含每項拍板/理由/連動面）。本檔=下一 session 快速進入點。

## 1. 當前狀態
- branch `dev`,**HEAD = `5eed367` == origin/dev(全已 push）**。
- **production `main` = `2969a86`(本 session 未動 — Sean 決定先不上正式站,要繼續改）**。
- 工作樹 clean;唯一未追蹤檔 `docs/handoff/2026-07-10-brand-showcase-premium-content-handoff.md` = **另一 session 的**,非本線、勿動。

## 2. 本 session 做了什麼（3 commits、全已 push origin/dev）
- **`88d14f8` S1**:商品目錄**撐滿版寬** + **自動欄數**（`.pp-grid` auto-fill minmax、gridCols=0 預設自動、3/4/5 手動)+ 全站寬度收共用 token（tokens.css `--shell-max`/`--shell-x`,header/footer/頂部車款列/商品頁一起撐滿)+ 篩選器/車款字放大(35-60 歲友善)+ cascade sticky 偏移 121→132。
- **`31246c8` S2**:商品詳情/結帳/物流頁 → 新 token `--content-max:1600`(內容頁不全撐滿、給可讀上限;product-page.css:22 / checkout.css:18 / pages-shipping.css)。
- **`5eed367` UX 一輪**:
  - 車款選擇器(CascadeFilterTop)招呼式 A:車圖示 + 黑字招呼標題 + 年份 placeholder「—」→「年份」+ 引導句「先選車…」+ select aria-label。
  - 快速 hover 提示:原生 title → 自訂 CSS tooltip(`[data-tip]::after`、0.15s、@media hover、置 header.css 全站可用);會員/搜尋/購物車/排版鈕;header z-index 40→50。
  - 麵包屑字 11/12→13;手機車款下拉 min-height 42px。
  - **立即購買 = addToCart 後 `router.push('/cart')`(加入並跳購物車、非結帳)** — 行為改,碰結帳流程注意。
  - **服務保障(ProductServices)搬進 ProductInfo 右欄買價下方**(原 OD-5 hero 下方全寬 strip 退場);flex 依卡數平均鋪滿、貼兩緣;**恆 4 卡=第 3 張依品牌切換**(RPM→泰國原廠;非 RPM→正品保證/原廠正品進貨,Sean 拍 B、不違去碳)。
  - favicon:補 `public/favicon.png`+`favicon.ico`(品牌 icon)消除外部 /favicon.png 404(無害、清 log)。
  - 測試同步:ProductInfo.test 補 `useRouter` mock;Header/ProductsPage.test 標籤中文化;ProductServices.test 非 RPM 卡數 3→4。

## 3. 部署狀態
- **dev 全已推、Vercel dev preview `5eed367` = READY**(build 綠)。dev 預覽站 = `pcm-website-v2-git-dev-pcm-motorsports.vercel.app`(有 Vercel 登入保護,需 share link;本 session 開的 link 23h 內有效)。
- **已在 dev 預覽驗證**:我的加寬(1600)**沒破 #212 品牌 showcase**(N°01-04 全對齊、圖正常載入、等比變寬);服務 4 卡、車款選擇器、立即購買在真部署上皆正確。
- **⚠️ 未上 production**。上線指令(Sean 手動、對外不可逆):`git push origin dev:main`(FF main→5eed367、Vercel 自動 deploy shop.pcmmotorsports.com)。

## 4. 待辦(給編號讓 Sean 選)
1. **會員「我的最愛」真功能**(Q1=A 已拍要做,尚未 plan/實作)。現況:愛心 = 純本地 `useState`(ProductInfo:184/344、ProductCard),點了只變紅、不存、未接會員。需:①查登入/會員機制(LINE login / account 頁 / 有無 user session)②出 plan(登入判斷 + wishlist 儲存 + 我的最愛頁)③Sean 批後實作。屬獨立較大工程。
2. **Sean 要繼續改其他前台**(待他指定 — 這是他開新視窗的主線)。
3. (可選)**上正式站**:`git push origin dev:main`。
4. (可選)**graphify 地圖刷新**:本 session 動了前台 code 但**未刷地圖**(非 milestone;PCM 07-10 拍板 graphify 走 milestone/每日收工;#274/#276 並行 session 也在動地圖避免撞車)。每日收工可 `/graphify --update`。

## 5. 風險 / 眉角
- **授權偏離 design**:本 session 全部視覺改動 = Sean UI/UX 三鏡頭(design-critique / web-interface-guidelines / design-taste)體檢後**逐項拍板的 business override**,非違鐵則 1;design-reference 未同步。
- **並行 session**:#274(supplier-config/ebc-materya-eazigrip)、#276(分類 taxonomy,引擎在報價單 repo)本日與本線共用 dev,已各自收 dev、線性無衝突;再開並行注意 git index 撞車([[project_parallel-sessions-shared-git-index-collision]])。
- **`scripts/supplier-config.test.ts` 在 dev 有 1 個既有 red**(#274 的 script test,非前台 runtime,不影響 live;上正式站不受影響,Vercel 只跑 next build)。
- 中途誠實移除:原想在詳情右欄補「規格摘要」(#3-A),做出來與 eyebrow SKU/上方選擇器**重複** → 移除,改採 Sean 提的「搬服務卡」方案(較佳)。

## 6. 下一個 session 進入點
1. 開工儀式:`cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5`(預期 dev、clean、HEAD=5eed367 或更新)。
2. 讀:`STATUS.md` +（真權威)memory `project_catalog-fullwidth-fonts-2026-07-11.md`。
3. 若做「我的最愛」:先查登入機制再出 plan(勿直接寫);若 Sean 給新前台改動:照 SOP(grep design 真權威 / 標 L1-L3 / 判鐵則 8）。
4. 本地驗:`cd apps/storefront && pnpm dev`(dev server 本 session 已停);動前台跑三綠 + 完整 vitest(動共用元件)。
