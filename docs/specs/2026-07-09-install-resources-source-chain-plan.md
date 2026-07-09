# 安裝資源(說明書 PDF + 安裝影片)資料來源接線 — 端到端 Plan

> 狀態:**✅ Sean 2026-07-09 批准**(P1=A 照 plan 三 slice 依序做 / P2=A Claude 代寫報價單 migration、Sean db push)。鐵則 8 動 schema + 跨 repo + 共用 view。
> 審查:codex 關卡1(plan、跨模型)FAIL 1 must-fix(群內彙整)+ 2 nit **全折入**;Slice 1 三層審查(code-reviewer + ultra 五視角 opus×2 + codex 關卡2)→ 經銷價/NULL-clobber/byte凍結/migration DDL/types 全 PASS,2 must-fix 全修:①plan 狀態字面同步(本行)②pickInstallVideo 改「取第一支能解析出 id 的 YouTube」(頻道 URL 不佔位)+ URL 驗證改 new URL()。
> 相關:memory `project_install-resources-manuals-video-270`(UI 已上、資料未接)、`project_gbracing-highlights-sync`(同型範本)。
> 真權威範本 = `supabase/migrations/20260708120000_products_add_highlights_expose_view.sql`(上週剛做完的 highlights 鏈,本 plan 照抄手法)。
> 偵察來源 = 2026-07-09 三線唯讀 workflow(reconA 報價單側 / reconB highlights 鏈 / reconC UI 合約)。

---

## 0. TL;DR(一句話)

報價單的 `products` 表**早已有 `pdf_urls text[]` / `video_urls text[]`、爬蟲自動在填**;唯一缺口是報價單的 `storefront_catalog_v` view 沒把這兩欄擺出來。補這一步(照抄上週 highlights)+ 網站端整條鏈照抄 highlights,就能讓「有來源的商品」在商品頁顯示安裝資源。**前台 UI/安全/測試全就緒,真正的新工作只有「同步管線把裸連結轉成 UI 要的形狀」。**

---

## 1. 背景與 Sean 拍板

- #270 商品頁「安裝資源」(說明書 PDF 下載鈕 + YouTube facade 影片)UI 已於 `ebfadba`(dev、未 push)完工,但 `toUIProduct` 未填 `manuals/videoUrl` → 正式站暫不顯(零風險:未接=未渲染,非顯錯資料)。
- **來源 = B**:報價單那邊存 → 網站讀(不做過渡 mapping 表)。
- **顆粒度 = 每商品**(偵察證實:報價單 `products.pdf_urls/video_urls` 逐列、爬蟲逐商品填,不需品牌×分類共用)。
- **2026-07-09 決策(Sean「依照推薦」)**:
  - **D1=A** — 說明書按鈕標題統一「安裝說明書」,多份用「安裝說明書 1 / 2 / 3」;檔案大小(sizeKB)來源沒有 → 省略(UI 支援 optional)。
  - **D2=A** — 影片取第一支能解析的 YouTube;Vimeo/其餘先不顯(Vimeo 支援列 follow-up)。
  - **D3=A** — 接受現覆蓋率先上線(僅 gbracing/bonamici 有 PDF 來源、其餘空白自動不顯),之後有來源自動長出。

---

## 2. 現況與缺口(偵察證據)

### 2.1 報價單側(reconA)
| 項目 | 現況 | 證據 |
|---|---|---|
| 儲存欄 | `products.pdf_urls text[]` / `video_urls text[]` **已存在** | PCM報價單-V2 `supabase/migrations/20260626_phase1_s1_group_code_column.sql:17-19` |
| 填料 | **爬蟲自動填**(白名單域名清洗、非人工) | `fetchers/base.py:515-547`;PDF 來源 = lightech/cncracing/gbracing/bonamici;video 白名單含 vimeo/youtube/youtu.be;ebc 只有 video |
| 已被消費 | 報價單自己的客人頁已讀這兩欄顯示 | `app/_lib/quote-safe-dto.ts:40-46,77-84`(活範例) |
| **缺口** | `storefront_catalog_v` **未投影** pdf_urls/video_urls、anon 無欄級 GRANT | grep 三顆 view migration 均無此兩欄字樣 |

### 2.2 網站側(reconB / reconC)
- 前台**全就緒**:`InstallResources.tsx`(124 行)、`ProductManual{label,url,sizeKB?}`(`mock-products.ts:84-88`)、`MockProduct.manuals?/videoUrl?`(`mock-products.ts:160-174`)、`ProductTabs.tsx:271` 已無條件傳入、`ProductTabs.test.tsx:246-310` render 分支測試已寫。
- 安全層已就緒:`parseYoutubeId` host 白名單(youtu.be/youtube.com/m.youtube.com)+ id `^[\w-]{6,}$`(`InstallResources.tsx:22-41`)、PDF href `^https?://` 白名單(`:54-55`)、`target=_blank rel=noopener noreferrer download`(`:100-106`)。
- **唯一斷點**:`toUIProduct`(`apps/storefront/src/lib/products.ts:107-175`)整個 return 物件沒有 `manuals/videoUrl` 兩鍵 → `product.manuals/videoUrl` 恆 undefined → InstallResources `hasDocs/hasVideo` 恆 false → 整區 `return null`。

### 2.3 形狀落差(本 plan 的真正新工作)
| | 報價單存 | UI 要 | 轉換責任 |
|---|---|---|---|
| 說明書 | `pdf_urls text[]`(裸 URL、**無標題、無大小**) | `ProductManual[] = {label,url,sizeKB?}` | transform 生成 label(D1)、sizeKB 省略 |
| 影片 | `video_urls text[]`(**多支、可能含 Vimeo**) | `videoUrl?: string`(**單支、僅 YouTube**) | transform 挑第一支 YouTube host(D2) |

---

## 3. 資料形狀決策落實

> 🔴 **群內彙整鐵律(codex 關卡1 must-fix)**:`transformGroup` 是「多個變體列 `SourceProductRow[]` 合成一個商品列」。安裝資源必須**跨全部變體彙整**、**不可**只取 `basis`/第一列(否則「群內某變體有 PDF、basis 沒有」會漏顯)。照抄 highlights `variants.map(...).find(...)` 的群級彙整精神,但因 pdf/video 要「合併多支」而非「取代表值」,用 `flatMap` + 去重保序。

- **label 規則(D1=A)**:`normalizeManuals(variants.flatMap(v => v.pdf_urls ?? []))` → 過濾 `^https?://` 合法 URL → **去重保序**(同群多變體常帶重複 URL)→ 依數量生成 label
  - 1 份:`{ label: '安裝說明書', url }`
  - ≥2 份:`{ label: '安裝說明書 1', url }`、`{ label: '安裝說明書 2', url }`…
  - `sizeKB` 不帶(來源無;UI optional)。**label 於 transform 時烘焙進 DB**(照抄 highlights「DB 存最終形狀」慣例);若日後改字(如「安裝手冊」)= 改一行程式碼 + 夜間 cron 自然重寫,24h 內生效(已知取捨,非 blocker)。
- **影片規則(D2=A)**:`pickInstallVideo(variants.flatMap(v => v.video_urls ?? []))` → 回**第一支能解析出 videoId** 的 YouTube URL → 存 `video_url text`(單值);無則 `null`。
  - `extractYoutubeId`(transform 內)**逐字對齊 UI `parseYoutubeId`**:host 去 `www.` 後 ∈ {youtu.be, youtube.com, m.youtube.com}、抽 `watch?v=` / `embed|shorts` / `youtu.be` 路徑、id 需合 `^[\w-]{6,}$`;transform 多一道 `protocol` http(s) 守衛。
  - 🔴 **取「能解析出 id 的」而非只 host 符合**(ultra/codex 關卡2 must-fix):頻道/播放清單 URL(host 符合但無 id)**不佔位、續試下一支**,避免靜默吃掉後面真影片。改 `extractYoutubeId`/UI 一邊須同步另一邊(未抽跨 package 共用 helper,以「邏輯逐字對齊 + 雙方測試」防漂移)。
- **供應商 gate**:`SupplierConfig` 新增獨立布林 `syncInstallResources`(**不搭 syncDescription 便車**——安裝資源=實體資產是否存在,與「繁中翻譯是否備妥」正交)。
  - 預設:rpm=`false`(無來源、byte 凍結)、cncracing=`false`(未寫入授權)、**gbracing=`true`、bonamici=`true`**(有 PDF 來源且已在網站同步)。
  - 寫入式:`...(ctx.syncInstallResources ? { manuals, video_url } : {})`(照抄 highlights 展開式)。
- **NULL-clobber:本欄天生免 partition**(比 highlights 更簡單)。理由:gate=true 時 `manuals`(恆具體陣列、可 `[]`)+ `video_url`(恆具體值、可 `null`)**兩 key 恆出現、單一 run 內 uniform**;且來源即真相(來源無 PDF ⇒ 網站該顯空 ⇒ 寫 `[]`/`null` 是**正確語意**,非誤覆寫),不需 `partitionByKeyPresence`。gate=false 時兩 key 皆省 → 凍結。

---

## 4. 端到端資料流

```
[報價單 DB dllwkkfanaebrsuyuedy]  products.pdf_urls / video_urls  ← fetchers 白名單爬取(已在跑)
    │  ▶ Slice 0(報價單 repo migration):storefront_catalog_v 末欄 append pdf_urls, video_urls + 欄級 GRANT anon
    ▼
  storefront_catalog_v.pdf_urls / video_urls   (曝露給網站讀)
════════════════════════════════════════════════════════════════
[網站 pcm-website-v2]
  ▶ Slice 1(後端,無前台可見改動):
    scripts/rpm-fetch.ts    VIEW_COLS += pdf_urls, video_urls;SourceProductRow += pdf_urls/video_urls: string[]|null
    scripts/rpm-transform.ts  normalizeManuals() + pickInstallVideo() + gate 展開
    scripts/supplier-config.ts  SupplierConfig += syncInstallResources(rpm/cnc=false、gb/bonamici=true)
    scripts/rpm-import.ts    (無需改 partition;加註解說明本欄天生 uniform)
    supabase/migrations/2026xxxx_products_add_install_resources_expose_view.sql
       products ADD manuals jsonb NOT NULL DEFAULT '[]' + video_url text NULL
       GRANT SELECT (manuals, video_url) TO anon, authenticated
       products_public 末欄 append manuals, video_url
    database.types.ts  手加 products / products_public 的 manuals(Json)+ video_url(string|null)Row/Insert/Update
    ▼(Sean db push 網站 DB + 觸發 gbracing/bonamici --confirm-write)
  網站 products.manuals / video_url 有值
════════════════════════════════════════════════════════════════
  ▶ Slice 2(讀取鏈,UI 點亮):
    packages/domain .../types.ts       Product += manuals: ProductManual[](恆陣列)+ videoUrl?: string;ProductManual 型別入 domain
    packages/adapters SupabaseProductAdapter.ts  PRODUCT_SELECT_DETAIL += 'manuals, video_url'
    packages/adapters mappers/product.ts  load guard(manuals 逐項 {label,url} 檢查、video_url→optional string)+ save mapper
    apps/storefront lib/products.ts  toUIProduct += manuals: product.manuals, videoUrl: product.videoUrl(2 行透傳)
    ▼
  ProductTabs → InstallResources(已就緒)→ 有來源的商品顯示安裝資源
```

---

## 5. Slice 切分 + 排序

> 依 highlights 前例:2 個網站 slice(後端 / 讀取)+ 1 個報價單 slice。每個 15-45 分鐘可中斷、可肉眼驗。

### Slice 0 —— 報價單 view 加欄(跨 repo)
- **內容**:PCM報價單-V2 新 migration,`CREATE OR REPLACE VIEW storefront_catalog_v` 末尾 append `pdf_urls, video_urls` + `GRANT SELECT (pdf_urls, video_urls) ON products TO anon`(照抄該 repo `20260708_storefront_catalog_v_expose_summary_highlights.sql` 手法、遵該 repo 命名慣例)。
- **跨 repo 註記**:此為**另一個 repo** 的改動。批准本 plan = 授權;實作方式二選一(Slice 0 開工時確認):**(a)** 我代寫 migration 檔(照抄他們自家 highlights 那顆)、你 db push;**(b)** 你用報價單那邊的 `pcm-migration-generator` 產。
- **依賴**:必須**最先** db push(否則網站 rpm-fetch 讀 view 撞 contract-drift / column missing)。

### Slice 1 —— 網站後端(migration + 同步管線)
- **內容**:§4 網站 Slice 1 全部(migration + database.types + rpm-fetch/transform/supplier-config/import + 單元測試)。
- **測試**:normalizeManuals(空/裸 URL/非法 scheme 濾除/1 份 vs 多份 label/**跨變體 flatMap 去重保序**/**第一列空第二列有資源仍收**)、pickInstallVideo(youtube 命中/`www.youtu.be` normalize/vimeo 跳過/全空→null/**跨變體多支取第一**)、gate byte 凍結(rpm 省 key)、RPM golden byte 回歸鎖不動。
- **DB 動作(Sean)**:db push 網站 migration → 觸發 `--confirm-write --supplier=gbracing` + `=bonamici`(順序:報價單 view 先 push 才能跑)。
- **無前台可見改動**(後端管線)。

### Slice 2 —— 網站讀取鏈(UI 點亮)
- **內容**:§4 網站 Slice 2 全部(domain 型別 + ProductManual 入 domain + adapter select + mapper guard + toUIProduct 2 行 + 讀取測試)。
- **測試**:mapper load guard(髒 jsonb 濾除、缺 label/url 剔除、video_url 空字串→undefined)、toUIProduct 透傳、經銷價零洩漏斷言(輸出無 price_store/price_by_tier)、InstallResources 端到端(有 manuals 顯示 / 全空不顯)。
- **驗收**:Sean 肉眼驗 gbracing/bonamici 商品頁安裝資源顯示(PDF 下載鈕 + 影片 facade)、rpm 商品維持不顯(byte 不變)。

### 排序總表
1. Slice 0 報價單 migration → **Sean db push 報價單 DB**
2. Slice 1 網站 code + migration(commit)→ **Sean db push 網站 DB** → **Sean 觸發 gbracing/bonamici 同步**
3. Slice 2 網站讀取 code(commit)→ deploy → **Sean 肉眼驗**
- 三個 slice 的 code 可連續實作,DB push / 同步 / deploy 由 Sean 依上序執行(我不碰 prod DB、不 push、不 deploy)。

---

## 6. 安全考量

- **經銷價零新增洩漏面**:manuals/video_url 是**公開客人可見內容**(說明書/影片連結)、非價格。兩側 view 的 SELECT 只多末欄、**絕不碰** price_by_tier / price_store / metadata / delisted_at;security_invoker=true 維持。
- **注入防護**:PDF href `^https?://` 白名單(transform + UI 雙層)、YouTube host 白名單 + id regex(UI)。transform 生成的 manuals 只收 http(s) URL。
- **RPM byte 凍結**:rpm `syncInstallResources=false` → transform 省 key → rpm products.manuals/video_url 維持 DEFAULT `[]`/`null` 不變;golden byte 回歸鎖驗證。

## 7. 影響面 + Rollback

- **影響面**:報價單 view +2 末欄(additive、既有消費者不受影響);網站 products +2 欄、products_public +2 末欄、adapter select +2、types +2、mapper +guard、domain +2 欄、toUIProduct +2 行;前台已就緒。跨 3+ 檔 + 動 schema + 共用 view + 跨 repo = **鐵則 8**;動公開 API view = **鐵則 12**(commit 前產 Codex Packet)。
- **Rollback**:每顆 migration 檔尾附 forward-only rollback SQL(DROP COLUMN + view 還原 + REVOKE,照抄 highlights 檔尾);code 改動 git revert;DB 已寫入的 manuals/video_url 為公開內容、留存無害(rollback view 即隱藏)。

## 8. 驗收條件(逐條 yes/no)

- [ ] 報價單 `storefront_catalog_v` 曝露 pdf_urls/video_urls、anon 讀得到(SET LOCAL ROLE anon 驗、比照 highlights 檔 37-42)。
- [ ] 網站 migration 交易模擬 BEGIN→驗→ROLLBACK 零留痕;anon 讀得到 manuals/video_url、經銷欄仍不可見。
- [ ] gbracing/bonamici 同步後,DB products.manuals/video_url 有值;rpm 該兩欄維持 `[]`/`null`(byte 回歸鎖綠)。
- [ ] **群內彙整驗證(codex must-fix)**:同群多變體的 pdf_urls/video_urls 有正確 flatMap 去重(專測:第一列空/第二列有資源→仍顯;多變體重複 URL→去重)。
- [ ] **database.types 手加驗證(codex nit)**:Sean db push 後跑 `supabase gen types`,diff 只剩 manuals/video_url(或無差異);若冒出 create_order 等無關漂移 → 另案處理、不混本 slice。
- [ ] 三綠(typecheck/lint/build)+ 完整 vitest 綠(新增測試涵蓋 §5 各 slice)。
- [ ] code-reviewer PASS;鐵則 12 Codex Packet 產出(commit 前)。
- [ ] Sean 肉眼驗:gbracing/bonamici 商品頁顯示安裝資源、rpm 不顯、空來源商品優雅不顯。

## 9. 內容分級(鐵則 9)判定

安裝資源連結 = **供應商爬蟲自動更新、走同步管線**(等同 L2/L3 內容的「管線/後台管理」正解,**非 hardcode**)。與 highlights/description 同型。合規。
- **未涵蓋商品的人工補值**(某商品官網無公開 PDF、想手貼)= 目前**無後台 CRUD 介面**(reconA gaps);屬未來獨立決策,不在本 plan(D3=A 已決:先不做人工填、有來源自動長)。

## 10. 未決 / follow-up

- Vimeo / 多支影片支援(D2 選 A 的延後項)。
- 人工補安裝資源後台(D3 選 A 的延後項;若做需另立內容分級 PRD)。
- database.types 既有 create_order 型別漂移(memory 已記)——本 plan 採**手加**目標欄避免全量 regen 拉進無關漂移;全量 regen 另案處理。
- transform 與 UI 的 YouTube host 白名單抽共用常數(nit)。
