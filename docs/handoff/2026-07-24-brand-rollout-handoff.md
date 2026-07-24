# 交接 — 品牌上架線收工(Lightech / K-SPEED / Extreme + 全站商品圖修正)

> 2026-07-24 Asia/Taipei · branch `brand-rollout`(已全數 merge 回 `main`+`dev`)。
> ⚠️ 本檔為品牌線獨立交接;金流(M-3 TapPay)線的當次入口仍是 `docs/handoff/CURRENT.md`,**未被本檔動到**。
> 現況權威 = 可驗證事實 > `STATUS.md` > memory `project_brand-line-kspeed-extreme-lightech-decisions`(已更新) > 本檔。

## 1. 交接快照(一句話)
三家品牌(Lightech 4566 / K-SPEED 960 / Extreme 664 商品)**圖片、價格、品牌介紹全數上正式站並實測驗過**;連帶修掉一個全站商品圖「爆開」bug + 代修商品上架線遺留的測試/CI 債。**全部已 deploy、無待推、working tree 乾淨。**

## 2. 本 session 做了什麼(commit,皆已在 main+dev)
- `0fcb6bb` feat(schemas): K-SPEED 品牌 seed migration(brands 列;正式庫早已有此列=no-op,Sean 已 db push)。
- `34a5c44` fix(storefront): **全站商品圖 object-fit cover→contain + `--c-surface-2` 灰底 letterbox**(詳情頁 hero + 目錄卡非 trim fallback;trim 去白邊路徑與縮圖刻意不動)。Sean 拍板 Q1=A/Q2。修 K-SPEED 640×855 直式合成圖被裁「爆開」。
- `d730f61` test(scripts): 代修商品上架線遺留=16 家 supplier 全 writeAllowed=true 後 3 個回歸測試變紅 → 加 `__gated_canary__` 永久 guard 測試靶(writeAllowed 恆 false、非真供應商、不入 rpm-sync matrix)+ 校正 supplier-config/rpm-import 測試。
- `786118a` ci(sync): rpm-sync.yml 每日同步 matrix 補 lightech+kspeed(14 家);🔴 **extreme 刻意不列**=靜態一次性 fixture(supplier-config.ts:249)。

## 3. 現況 / 驗證(正式站 shop.pcmmotorsports.com 實測)
- production = `main` `786118a`、Vercel READY;dev = merge `5134bf6`(含全部修正、亦全綠)。
- Lightech:圖從 **Cloudflare R2**(`pub-…r2.dev`、https)實際載出=破圖解決;有價;contain;「為什麼選 LighTech」顯示。
- Extreme:價 NT$ 3,800(不再「—」、報價單側已補);contain;「為什麼選 Extreme Components」顯示。
- K-SPEED:contain 完整不裁;「為什麼選 K-SPEED」顯示(先前 stale cache 已由本次部署清)。
- 桌機 + 手機 390:hero contain、零橫向溢出;gb-racing 無回歸。三綠 + full test 2855 pass + build 全過。

## 4. 待辦 / 剩項(皆非本線、不急)
- 🔴 **Lightech 圖走 R2 的 `r2.dev` 測試網址**(有流量限制、不宜正式站長期大量)→ 建議掛自有網域。**現在運作正常**、屬報價單/匯入線小優化。
- K-SPEED brands.`premium_extra_pct`=0(保守值);Sean 知道實際經銷利差再調一行。
- (cosmetic)dev 的 merge commit `5134bf6` 訊息把註解行吃進去了、醜但無害;要改需重寫歷史+強推、不值得。

## 5. 風險 / 注意
- 本線**未碰金流旗標、未改 DB schema、未動 `.env*`**;付款可用性與部署前相同。
- rpm-sync 每日同步現含 lightech(4566)+kspeed(960)=序列跑更久但各 job 6h 上限內;extreme 不同步(靜態)為刻意。
- graphify 地圖**未刷**(CLAUDE.md:graphify update 走 milestone/每日、非每 session;本線變更已 commit)。

## 6. push / 部署狀態
- **無待推**:本 session 4 commit 全在 origin/main + origin/dev。deploy 已 READY 並驗過。
- 本交接檔(docs-only)在 `brand-rollout`;可隨意併入或留存,不影響正式站。
