# 商品附件(聲音／影片／PDF)資料鏈現況偵察

> **任務來源**:`E-153-A` ③(主視窗派)= memory `project_product-attachments-relocation-line` 三方協作序**第 1 步**。
> **性質**:唯讀偵察。**零改動 code**、兩 repo 都沒寫入。不做設計、不決定長相。
> **範圍**:`pcm-website-v2`(dev, HEAD `5f323520`)+ 報價單 `/Users/sean_1/API大量上架/PCM報價單-V2`(HEAD `2d72f89`)。
> **方法**:網站端派 sonnet subagent 偵察後**主對話逐條親驗**;報價單端 subagent 因帳號額度中斷,**由主對話自查**(見 §4-1)。

---

## §0 一句話結論

**「未串接」不是網站沒做,是資料在報價單庫裡出不來。**

聲音檔**早就抓下來了**(648 群中 364 群有),但它存在 `raw_jsonb` 死角、
出口 view `storefront_catalog_v` 的 28 欄裡**沒有聲音欄** ⇒ 網站端連拿都拿不到。

而且這件事**三週前就有人查清楚並寫成 plan 了**(`2026-07-19`,Fable R2 PASS),
卡在**尚未獲 Sean 批准開工**(報價單 `STATUS.md:705`)。

---

## §1 四題

### Q1. 檔案存在哪?

**三種型別全部是「只存 URL、不存檔案本身」** —— 沒有任何一種進 R2 或 Supabase Storage。

| 型別 | 存放形式 | 實際檔案在誰家 | 出處 |
|---|---|---|---|
| **PDF 說明書** | 報價單 `products.pdf_urls text[]`,**裸網址** | 供應商官網(fetcher 直接抓連結) | 報價單 `supabase/migrations/20260730000000_baseline_schema.sql:2332`;欄註解 `:2452` 逐字「官方說明書 PDF 連結 (text[]); fetcher 直接填」 |
| **影片** | 報價單 `products.video_urls text[]` | **混格式**:YouTube / Vimeo / `.mp4` 直檔(供應商 CDN,如 cdn.shopify、S3) | 同上 `:2333`,註解 `:2459`;網站端三分流見 `apps/storefront/src/components/InstallResources.tsx:26-29` |
| **聲音檔(mp3)** | 🔴 報價單 `raw_jsonb.attachments.sounds`,**無正式欄位** | Akrapovic 官方 API | 報價單 `fetchers/akrapovic.py:487-495` 逐字:`attachments["sounds"] = sound_links  # 先存 raw_jsonb (無正式欄; UI 露出待 Sean 拍板)` |

> 意涵:搬遷不涉及任何檔案搬移或儲存成本,**全是連結**。這件事比想像中輕。

### Q2. 資料模型有沒有「附件」這個概念?

**沒有獨立的附件表,也沒有塞在描述 HTML 裡。是 products 表上的具名欄位,逐層透傳。**

**報價單端(上游)**
- `products.pdf_urls text[]` / `products.video_urls text[]`(`baseline_schema.sql:2332-2333`)
- `raw_jsonb.attachments.sounds` —— 聲音的**唯一**落腳處,非正式欄(`fetchers/akrapovic.py:487-495`)
- 出口 view `storefront_catalog_v`:**28 欄,有 `pdf_urls`/`video_urls`,無 sounds**

**網站端(下游)**,鏈路完整、逐層有名:

| 層 | 欄位/型別 | 出處 |
|---|---|---|
| DB | `products.manuals jsonb NOT NULL DEFAULT '[]'` + `products.video_url text NULL` | `supabase/migrations/20260709120000_products_add_install_resources_expose_view.sql:11-12` |
| 曝露 | 欄位級 `GRANT SELECT` + `products_public` 末欄 append | 同檔 `:13`、`:16` |
| Adapter | `manuals: unknown[] \| null` / `video_url: string \| null` guard | `packages/adapters/src/supabase/mappers/product.ts:57-59` |
| Domain | `Product.manuals: ProductManual[]`(恆陣列)、`videoUrl?: string` | `packages/domain/src/catalog/types.ts:254-257` |
| UI 型別 | `ProductManual = { label, url, sizeKB? }` | `apps/storefront/src/data/mock-products.ts:86-90` |
| 同步 | `manuals = normalizeManuals(v.pdf_urls)` / `videoUrl = pickInstallVideo(v.video_urls)` | `scripts/rpm-transform.ts:376-377,390-392` |

🔴 **網站端整條鏈完全沒有 audio 概念**。我親驗過(不只是 subagent 說):
pattern `audio|音檔|聲音|聲浪|排氣聲|\.mp3|\.wav` 在 `InstallResources.tsx`、`mock-products.ts`、
`packages/domain/src/catalog/types.ts`、`scripts/rpm-transform.ts` 四個核心檔**零命中**。

### Q3. 哪些商品有檔案、共幾種型別?

**型別共 3 種(PDF / 影片 / 聲音),但網站端只支援 2 種。**

**聲音**(唯一來源 Akrapovic):
- 🔴 **648 群中 364 群有聲音檔,單群最多 6 段**(報價單 `docs/superpowers/plans/2026-07-19-akrapovic-docs-labels-and-sound-plan.md:82`)
- 標題品質好、可直接轉中文,例:`Stock exhaust; BMW R 1250 R` / `Slip-On with insert; BMW F 800 GS`(同檔 `:83-84`)
  ⇒ 有「原廠聲 vs 改裝聲、含不含消音塞」的語意,**天然適合做成可比較的播放清單**

**PDF 與影片**(來源:`scripts/supplier-config.ts` 各家註解,scout 2026-07-10 截面、群級):

| 供應商 | PDF | 影片 | 出處行 |
|---|---|---|---|
| lightech | **2,019 群** | 0(Vimeo 預期、晚到自然補) | `:164` |
| cncracing | **1,008 群** | **55 群**(Vimeo) | `:138` |
| (PDF 大戶) | **635 群** | 0 | `:241` |
| ebc | 0 | **45 群**(YouTube watch 型) | `:229`、`:147` |
| (影片家) | 0 | **57 群** | `:271`、`:277` |
| gbracing / bonamici | 有(數量未載明) | — | `:113`、`:124` |
| evotech | **0**(嵌入指南稱將填、附件晚到不阻擋) | **0** | `:146` |
| eazigrip / samco / motogadget / front3d / materya | **皆 0** | 皆 0 | `:146-147` |
| rpm | — | — | `:102` `syncInstallResources: false`(無來源+byte 凍結) |

> **給 OD 的直接答案:要畫 3 種元件** —— ①PDF 下載(量最大,數千群)②影片播放(YouTube/Vimeo/mp4 三格式都要吃)③**音檔播放器(364 群、單群最多 6 段 ⇒ 需要「清單」而不是單一播放器)**。

### Q4. 🔴 「部分檔案尚未串接」斷在哪一層?

**答案:斷在③出口 view。分三種斷法,不是同一個原因。**

報價單那份 plan 已經把鏈路畫成五段(`2026-07-19-akrapovic-docs-labels-and-sound-plan.md:117-127`):

```
官方 API(有 TypeId、有 Sounds.Title)
  └─① fetchers/akrapovic.py      ← TypeId 丟棄;sounds 存進 raw_jsonb 死角
       └─② products.pdf_urls(text[] 裸網址)/ raw_jsonb.attachments.sounds
            └─③ storefront_catalog_v(28 欄:有 pdf_urls、無文件類型、無 sounds)
                 └─④ rpm-fetch VIEW_COLS → rpm-transform normalizeManuals
                      └─⑤ 商品頁 InstallResources
```

**斷法 A — 聲音檔:抓到了,但沒有出口(最主要的那個「未串接」)**
資料在②、卡在③。我親驗網站端下游確認這條鏈今天仍斷著:
`scripts/rpm-fetch.ts:80-83` 的 `VIEW_COLS` 逐字只有 `…highlights_zh, pdf_urls, video_urls, delisted_at`,**沒有任何聲音欄**。
⇒ 就算網站前台改好版面,**也拿不到聲音資料**。必須先開報價單側的欄與 view。
> plan 原文對此有一句話很值得帶給 Sean(`:86`):
> 「Sean 原本以為『這是網站設計』**只對一半**:資料在報價單庫,但沒開窗口給網站。」

**斷法 B — PDF 標籤錯置:有資料,但標錯名字**
Akrapovic 的 PDF 有 9 種 TypeId(安裝說明書/噪音認證/型式認證/馬力曲線/型錄/分解圖/適用車型表…),
但①爬蟲**把 TypeId 丟棄**、②只存裸網址,④`normalizeManuals` 只能「按數量硬編標籤」
⇒ 9 種文件全被叫成同一個名字。plan 稱此**錯標涉 5 家**(`:135` 原則 1 括號內)。

**斷法 C — 來源本身就沒有(不是斷點,是沒有)**
evotech(PDF/影片皆 0)、eazigrip/samco/motogadget/front3d/materya(皆 0)、rpm(旗標 false)。
⇒ 這幾家即使搬了版面也不會有東西顯示,**屬上游資料未到位,不是接線問題**。

**現況狀態**:該 plan **Fable R2 PASS,但 Sean 尚未批准開工**(報價單 `STATUS.md:705` 逐字)。
plan 也已標明⑤視覺層「**Sean 拍板**;本計畫只保證資料到位」——與本線第 2 步(OD 出稿)**天然接得上**。

🔴 **兩個 repo 都是「REVOKE ALL + 逐欄 GRANT」模型,加欄不授權 = 整批 42501**
(plan `:143-145`:報價單側漏授 ⇒ anon 讀整支 view 失敗 ⇒ **12 家同步全紅**)。
⇒ 這條線一旦開工,屬鐵則 12 ②權限 + ③DB 結構,**高風險片**。

---

## §2 對後續兩步的意涵(供主視窗判斷,非我裁定)

1. **第 2 步(OD 出稿)可以現在就開**:型別數(3 種)與量(音檔 364 群、單群最多 6 段)都已確定,
   OD 畫稿不需要等資料層完工。
2. **第 2 步的「報價單端補洞片」= 那份三週前的 plan**,不需要重寫,**只需要 Sean 批准開工**。
   ⇒ 建議把它整成決策題問 Sean,而不是重新規劃一次。
3. **第 3 步(網站端搬區塊)有隱藏依賴**:目前 `InstallResources` 掛在「安裝須知」分頁側欄
   (`apps/storefront/src/components/ProductTabs.tsx:302`),而「商品介紹」是另一個獨立
   `<details id="pd-sec-description">` 區塊(同檔 `:125-176`),兩者**目前零關聯**。
   搬遷會動到 `hasInstallResources` / `showResources` 目前綁定的分欄邏輯
   (`InstallResources.tsx:129-132`、`ProductTabs.tsx:117,275,299-303`)。

---

## §3 順帶發現(不在四題內,但屬同一條鏈)

**`rpm-fetch.ts:79` 的註解已過期。** 逐字寫「`syncInstallResources` gate(**gbracing/bonamici 才寫**)」,
但 `scripts/supplier-config.ts` 現況有十幾家為 `true`(lightech/cncracing/ebc/materya… 見 §1-Q3 表)。
⇒ 註解停留在 #270 剛做完的兩家試點時期。**不影響行為**(gate 讀的是設定不是註解),但會誤導下一個讀它的人。

---

## §4 誠實邊界

1. 🔴 **報價單端不是 subagent 查的。** 我派的報價單偵察 agent **因帳號 session limit 中斷**
   (`resets 6pm Asia/Taipei`),報價單端全部由主對話自查。網站端 agent 有完成,但其結論我**逐條親驗過**
   (audio 零命中、`syncInstallResources` 設定本體、`VIEW_COLS` 現況三條都自己重跑)。
2. 🔴 **`E-153-A` ③ 給的報價單路徑 `/Users/sean_1/PCM_Quote` 不存在。**
   實際位置 `/Users/sean_1/API大量上架/PCM報價單-V2`(`test -d` 驗過、`git log` HEAD `2d72f89`),
   路徑來自 memory `feedback_cross-repo-crossing-criteria` 等檔,非猜測。
3. 🔴 **§1-Q3 的所有數字都是「文件裡記載的實查值」,不是我當下查 DB 得到的。**
   來源=`supplier-config.ts` 各家註解(標註 scout **2026-07-10** 截面)+ plan(**2026-07-19** 實查)。
   ⇒ 距今近一個月,**新上架商品的附件不在這些數字裡**。要精確值須連線查 DB,我沒有連線也沒有權限。
4. **聲音檔的 364/648 我只有 plan 的單一來源**(`:82`),沒有第二個來源交叉驗證,也沒有親自跑過那個查詢。
5. **我沒有讀 `normalizeManuals` / `pickInstallVideo` 的函式本體**(只看呼叫點與型別),
   真要動搬遷邏輯時需另行確認。
6. **報價單端我只查了四題所需的定向 pattern**,沒有全面盤點該 repo;
   `BACKUP-*.json` 那批大檔完全沒讀。若聲音/PDF 另有第二條管線,我這輪看不到。
7. **報價單 repo 零寫入,但它本來就是 dirty 的 —— 兩件事要分清楚。**
   我的操作全唯讀(`grep`/`sed -n`/`ls`/`test -d`/`git log`),未執行任何 `.command` 腳本、未連線寫 DB。
   收工查 `git -C … status --porcelain` 有兩筆既存改動:` M CLAUDE.md` 與 `M  docs/archive/2026-07-29-dna-research/codex_dna_execution_report.md`。
   **非本次造成**,證據=兩檔 mtime 分別是 **Aug 5 01:01** 與 **Jul 30 10:41**,而我第一次碰該 repo 是今天 **13:35** 之後;
   且其中一筆是 staged(`M `)狀態,需要 `git add` 才產生得出來,我全程沒跑過。
   ⚠️ 這兩筆 dirty 屬該 repo 既有狀態,**我沒有動它、也沒有清理它**(不是我的 repo)。
8. 本片輕量(純 docs 偵察):三綠跑 typecheck + lint,build 依鐵則 11 省;未 push。
   🔴 **本片無跨模型第二意見**(Fable 不可用、codex 額度 08-08 恢復;唯讀偵察非高風險)。

— E 窗,2026-08-07
