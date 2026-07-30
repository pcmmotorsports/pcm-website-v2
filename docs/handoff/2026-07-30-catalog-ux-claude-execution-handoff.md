# 商品目錄選車 UX — Claude 執行／Codex 審查交接

> Updated: 2026-07-30 Asia/Taipei
> Repo: `/Users/sean_1/pcm-website-v2`
> Branch: `dev`
> Baseline HEAD: `27fb117633517da306b234a06d702a44726953b9`
> Baseline `origin/dev`: `27fb117633517da306b234a06d702a44726953b9`
> 工作模式: Claude 唯一實作者；Codex 唯讀審查；Sean 產品、push、deploy checkpoint
> 狀態: UI 方向已拍板；可操作預覽已完成但未 commit、未 push、未 deploy

---

## 給 Claude 的完整開工指令

以下整段可直接交給 Claude：

```text
你現在是 pcm-website-v2「商品目錄選車 UX 正式落地」的唯一執行端。
Codex 是唯讀審查端；Sean 是產品、push 與 deploy checkpoint。

Repo 絕對路徑：
/Users/sean_1/pcm-website-v2

一、先讀，不得跳過
1. /Users/sean_1/pcm-website-v2/CLAUDE.md
2. /Users/sean_1/pcm-website-v2/STATUS.md
3. /Users/sean_1/pcm-website-v2/docs/ops/AI_CONTRACT.md
4. /Users/sean_1/pcm-website-v2/docs/handoff/CURRENT.md
5. /Users/sean_1/pcm-website-v2/docs/decisions/0007-catalog-vehicle-selection-ux.md
6. /Users/sean_1/pcm-website-v2/docs/superpowers/specs/2026-07-30-desktop-catalog-ux-preview-design.md
7. /Users/sean_1/pcm-website-v2/docs/superpowers/plans/2026-07-30-mobile-catalog-ux-preview.md
8. /Users/sean_1/pcm-website-v2/docs/superpowers/plans/2026-07-30-desktop-catalog-ux-preview.md
9. 本檔全文

二、Git 起手閘
執行：
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --short --untracked-files=all && git log --oneline -5 && git rev-parse HEAD && git rev-parse origin/dev

預期：
- branch = dev
- HEAD = origin/dev = 27fb117633517da306b234a06d702a44726953b9
- working tree 不是乾淨的；dirty ownership 以本檔「工作樹 ownership」為準

若 HEAD、branch 或 dirty files 出現本檔無法解釋的漂移，立即停止並回報 Sean。
不得 reset、stash、刪除、覆蓋或順手 commit 不明變更。

三、已拍板方向，不得重問或重新設計

桌機：
- 保留正式 /products 的整體 UI、固定內容寬度、左側分類、商品卡、排序與分頁。
- 只優化頂部選車列：廠牌、車型、年份可輸入搜尋，也可下拉捲動選擇；年份最新在前。
- 「我的愛車」維持原本選車列右側與黑白灰膠囊配色。
- 已選車時保留快速「清除車輛」。
- 不做滿版、不另建第二套桌機商品目錄。

手機：
- 正式落地採 /dev-preview/mobile-catalog-ux 已核准的紅白配色、大字與大型輸入欄位方向。
- 選車面板頂部先顯示真實「我的愛車」；每台愛車可直接套用。
- 廠牌、車型、年份每欄都能輸入搜尋，也能展開捲動選擇。
- 開面板不得 autoFocus；鍵盤出現後，作用中欄位仍須留在可視範圍。
- 「可直接選擇，也可輸入搜尋」同列最右側有「清除」；它只清草稿，不取消已套用車輛。
- 已選車摘要提供「更換」與「清除車輛」；清除車輛後回到全部商品，並清掉車輛相關分類。
- 分類、商品篩選、排序是三個獨立入口；排序文字需視覺置中。
- 商品篩選不放選車、不放現貨商品；只處理品牌、價格等商品條件。

四、資料與架構硬邊界
- 正式頁只能使用既有真實 motoBrands taxonomy、cascadeFilterReducer、useVehicleUrlSync、GarageChips、ProductsPage 真商品與真分類。
- /dev-preview/mobile-catalog-ux 的 CBR600RR、MT09、161、36/26/20、假分類與假商品全部只是參考，不得 import 到正式元件。
- 不新增車輛圖片。
- 不動 Supabase、schema、migration、pricing、auth、會員資料格式、next.config、vercel.json 或 env。
- 不讀、不輸出、不修改 .env*。
- 不改商品卡、桌機左側欄、正式資料查詢、URL vehicle query 語意。
- 固定 UI 文案屬 L1；不新增後台 CRUD。

五、實作方式
這是跨 3+ 檔的重大 UI 改動，Sean 已以「給 Claude 動工」批准本交接方向與以下分片；仍須依小 slice 順序做，不得一次大爆改。

Slice A — 鎖正式行為測試
- 先替正式元件補失敗測試，不以預覽測試冒充 production coverage。
- 必須鎖：桌機搜尋式三欄、年份新到舊、我的愛車位置不變、手機無 autoFocus、我的愛車、清草稿、清車輛、分類/篩選/排序責任分離。
- 先跑 targeted test，保留 RED 原因，再實作。

Slice B — 桌機正式落地
- 以目前 CascadeFilterTop 的 query-gated preview 為視覺參考，改成正式桌機輸出。
- 不得讓桌機 markup/CSS 在手機寬度形成三個被壓縮的橫向輸入框。
- 最終正式功能不可依賴 vehicle-ui=preview；該 query 只能是開發過渡，收工前移除或證明無正式語意。
- GarageChips 繼續使用 variant="top" 並保持右側原位置與中性色。

Slice C — 手機正式落地
- 將預覽的互動原則搬到現有 ProductsPage / FilterDrawer / FilterDrawerVehicleTab / GarageChips 等正式路徑。
- 「搬」的是互動與視覺，不是預覽假資料或整個預覽元件。
- 優先重用既有 vehicle-match、garage-chip、cascade action 與 URL 同步；不得建立第二套車款比對邏輯。
- 注意現有 FilterDrawerVehicleTab 已有跨層直搜與無年份車型出口，不能因換 UI 回歸。
- 元件 >400 行必拆、>300 行硬警戒；Hook >200 行需評估拆分。

Slice D — 回歸、整理與交審
- 預覽資料夾先保留作視覺比對，不得自行刪除；是否提交或刪除由 Sean 在審查後決定。
- 更新正式元件 smoke tests、必要文件、STATUS 7 欄與 CURRENT。
- 精準 git add；禁 git add . / git add -A。
- 不 push、不 deploy、不改 production。

六、最低驗證
每個 TS/TSX slice 收工：
pnpm test -- <本 slice targeted tests>
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build

最終另跑：
- 正式 ProductsPage / CascadeFilterTop / FilterDrawer / FilterDrawerVehicleTab / GarageChips 相關測試
- 1365×900、1025×768、1024×768、390×844 肉眼操作
- 390px：開面板不自動跳鍵盤；輸入後欄位可見；三欄可輸入與下拉；清草稿不清背景車；清車輛回全部商品
- 桌機：內容不滿版；我的愛車在右側；三欄可搜尋；年份最新在前；無水平溢出
- 一般 /products URL、vehicle query、分類、商品篩選、排序與分頁不退化

七、Codex 審查停點
Claude 完成 code + tests 後，先不要 commit。
將工作樹凍結，回報「Ready for review」，交給 Codex 唯讀審查。
審查期間 Claude 不得繼續改檔，除非 Codex findings 明確交回。
Codex PASS 後才由 Claude 精準 commit；仍不得 push 或 deploy。

八、第一則回報格式
請先只回：
1. Role：Claude 執行／Codex 審查
2. Git：branch、HEAD、origin/dev、dirty ownership 是否完全相符
3. 讀過的真權威檔案
4. 預計先做的 Slice A 測試檔與 production 元件
5. 是否有 blocker

若沒有 blocker，回報後直接開始 Slice A，不要再問 Sean已拍板的視覺選項。

禁止：
- 不 reset / stash / 清理不明檔
- 不讀寫 .env*
- 不新增假 taxonomy 或第二套車款比對
- 不把 dev-preview 假資料接進正式頁
- 不動 DB / migration / pricing / auth / infra
- 不 push / deploy / merge
- 不在 Codex 審查期間繼續寫檔
— 禁止清單結束 —
```

---

## 已確認的產品決策

1. Sean 認為桌機與現況差異不需要太大；正式方向是保留整體版型，只優化選車列的視覺提示、文字大小、可輸入搜尋與年份排序。
2. 桌機「我的愛車」保留原本右側位置與現有中性配色。
3. Sean 明確喜歡先前手機預覽的配色與 UI；正式手機版沿用該紅白、大欄位、分面板方向。
4. 桌機與手機共享資料與套用邏輯，但採不同外殼，不要求兩端長得一樣。
5. Claude 執行，Codex 唯讀審查。

## 工作樹 ownership

### A. 本次型錄 UX 預覽與桌機 query-gated 參考

Tracked modified：

- `apps/storefront/src/components/CascadeFilterTop.test.tsx`
- `apps/storefront/src/components/CascadeFilterTop.tsx`
- `apps/storefront/src/styles/filter-cascade.css`

Untracked preview：

- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopVehiclePicker.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPrimitives.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/VehiclePickerFields.tsx`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/desktop-catalog-ux.module.css`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/mobile-catalog-ux.module.css`
- `apps/storefront/src/app/dev-preview/mobile-catalog-ux/page.tsx`
- `docs/superpowers/plans/2026-07-30-mobile-catalog-ux-preview.md`
- `docs/superpowers/plans/2026-07-30-desktop-catalog-ux-preview.md`
- `docs/superpowers/specs/2026-07-30-desktop-catalog-ux-preview-design.md`

### B. 本次交接新增

- `docs/decisions/0007-catalog-vehicle-selection-ux.md`
- `docs/handoff/2026-07-30-catalog-ux-claude-execution-handoff.md`
- `docs/handoff/CURRENT.md` 頂部入口更新

以上都屬本次 UX 線，可由 Claude 接手。其餘檔案不在 scope。

## 目前程式事實

- 正式桌機參考網址：`/products?vehicle-ui=preview`。
- 一般 `/products` 仍維持舊選車列。
- query-gated 版本重用正式 taxonomy、reducer、GarageChips 與商品頁，不是第二套假商品頁。
- 隔離 `/dev-preview/mobile-catalog-ux` 同時包含手機與早期桌機預覽；內含假資料，只能作互動與視覺參考。
- 正式手機目前仍使用 `FilterDrawer` + `FilterDrawerVehicleTab`；它已具備跨品牌／車型直搜、無年份車型出口與真實 GarageChips。
- 正式 `GarageChips` 在未登入、讀取失敗或 `garage=[]` 時不顯示。

## 已完成驗證

2026-07-30 預覽階段已實際跑過：

```bash
pnpm test -- apps/storefront/src/components/CascadeFilterTop.test.tsx
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build
```

結果：

- `CascadeFilterTop.test.tsx`：4 tests passed。
- storefront typecheck：exit 0。
- storefront lint：exit 0。
- storefront build：exit 0。
- 本機瀏覽器已操作 Honda → CBR600RR → 2024；`vehicle-ui=preview` 與 vehicle query 同時保留。
- 「清除車輛」已驗證回到 `?vehicle-ui=preview`。
- 一般 `/products` 仍顯示舊選車列。

這些證據只證明預覽目前可操作，不等於正式手機整合已完成。

交接前又以目前工作樹重跑：

```bash
pnpm test -- apps/storefront/src/components/CascadeFilterTop.test.tsx apps/storefront/src/app/dev-preview/mobile-catalog-ux/MobileCatalogUxPreview.test.tsx apps/storefront/src/app/dev-preview/mobile-catalog-ux/DesktopCatalogUxPreview.test.tsx
pnpm --filter @pcm/storefront typecheck
pnpm --filter @pcm/storefront lint
pnpm --filter @pcm/storefront build
```

結果為 3 test files／17 tests passed，typecheck、lint、build 全部 exit 0；build route 包含 `/dev-preview/mobile-catalog-ux` 與 `/products`。

## 尚未執行

- 尚未把核准手機 UI 搬入正式 `FilterDrawer` 路徑。
- 尚未把桌機 query-gated 版本改成正式預設輸出。
- 尚未用登入會員真實愛車肉眼驗收。
- 尚未跑正式整合後的全套 targeted tests、四 viewport 回歸或 axe。
- 尚未 commit、push、deploy。

## Codex 審查範圍

Codex 收到 `Ready for review` 後只做唯讀審查：

1. 正式頁是否誤 import 預覽假資料。
2. 桌機是否維持原頁寬、GarageChips 位置與配色。
3. 手機鍵盤、autoFocus、scroll/fixed action 是否符合拍板。
4. 「清草稿」與「清車輛」是否真正分離。
5. 既有跨層直搜、無年份車型、garage 對應與 URL query 是否回歸。
6. 分類、商品篩選、排序是否責任分離；不得出現現貨商品。
7. 測試是否驗 production 元件，而非只驗 dev-preview。
8. 檔案大小、React hooks、a11y、水平溢出與一般 `/products` regression。

Codex 不修改檔案、不 commit、不 push、不 deploy。

## Rollback

- Claude 開工前可由 Git diff 與 untracked preview 完整辨識此線。
- 正式落地若審查不通過，回退 Claude 新增的 production integration diff，保留目前隔離預覽供重新比較。
- query-gated 桌機參考移除後，應由正式 production tests 鎖定新預設；不得以刪除整個商品頁或回退其他 session commit 作 rollback。
