# 商品附件(聲音／影片／PDF)資料鏈現況偵察

> **任務來源**:`E-153-A` ③(主視窗派)= memory `project_product-attachments-relocation-line` 三方協作序**第 1 步**。
> **性質**:唯讀偵察。**零改動 code**、兩 repo 都沒寫入。不做設計、不決定長相。
> **範圍**:`pcm-website-v2`(dev, HEAD `5f323520`)+ 報價單 `/Users/sean_1/API大量上架/PCM報價單-V2`(HEAD `2d72f89`)。
> **方法**:網站端派 sonnet subagent 偵察後**主對話逐條親驗**;報價單端 subagent 因帳號額度中斷,**由主對話自查**(見 §4-1)。

---

## §0 一句話結論

**「未串接」不是網站沒做,是資料沒有流到顧客站這一側。**

聲音檔**早就抓下來了**(依 2026-07-19 截面:648 群中 364 群有 —— ⚠️ **單一來源、我未親自查證**,見 §4-4),
存在 `raw_jsonb` 死角;顧客站的出口 view `storefront_catalog_v` **28 欄裡沒有聲音欄**,
⇒ **顧客站**(anon 路徑)拿不到。

🔴 **但「拿不到」僅限顧客站** —— 報價單站的內部工具**早就在播了**
(`app/quotations/_lib/variants.ts:15-28` 的 `extractSounds()`,server 端直讀 `raw_jsonb`)。
這代表**已有可參考的實作**,也代表「必須動 schema」不是唯一敘事(詳 §1-Q4 補述)。

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
| 供應商 | PDF | 影片 | 出處行 |
|---|---|---|---|
| lightech | **2,019 群** | 0(Vimeo 預期、晚到自然補) | `:164` |
| cncracing | **1,008 群** | **55 群**(Vimeo) | `:138` |
| 🔴 **akrapovic** | **635 群** | 0 | `:236-242`(總群數 648) |
| **kspeed** | 0 | **57 群** | `:272-277` |
| ebc | **0 —— 但這是刻意的,不是缺口** | **45 群**(YouTube) | 見下方 ⚠️ |
| gbracing | 有(數量未載明) | — | `:113` |
| bonamici | 有(數量未載明) | 有 | `:124` |
| evotech | **0**(嵌入指南稱將填、附件晚到不阻擋) | **0** | `:146` |
| eazigrip / samco / motogadget / front3d / materya | **皆 0** | 皆 0 | `:146-147` |
| rpm | — | — | `:102` `syncInstallResources: false`(無來源+byte 凍結) |

⚠️ **EBC 的 PDF 是刻意不給顧客的,不可當成缺口去「修好」。**
報價單 `fetchers/ebc.py:19` 逐字:「★官方 PDF 不給客人★ (不進 datasheet 白名單, pdf_urls=None)」。
⇒ 若日後有人把 EBC 的 `pdf_urls=None` 當成未串接而去補,等於**洩漏本來刻意不放的東西**。

🔴 **akrapovic 是三軸交叉的關鍵一家**:PDF **635** 群 + 聲音 **364** 群 + 影片 **0**,總群數 **648**。
⇒ **同一個商品會同時需要「PDF 區 + 音檔清單」但完全不需要影片區。**
**三種元件不會永遠並存,版面必須容許「有 A 有 C 沒有 B」。**
(反例同時存在:kspeed 只有影片沒有 PDF、gbracing 只有 PDF 沒有影片 ⇒ **不可假設兩兩成對**。)

> **給 OD 的直接答案:要畫 3 種元件**(⚠️ 數量依據見下方保留條款)
> ①PDF 下載(量最大,數千群)②影片播放(YouTube / Vimeo / mp4 直檔**三格式都要吃**)
> ③音檔清單 —— **依目前資料(2026-07-19 截面、單一來源)是 364 群、單群最多 6 段**,
> 故建議做成**清單**而非單一播放器。
> 🔴 **這個「清單 vs 單一播放器」的判斷建立在「單群最多 6 段」這個未經二次驗證的數字上**;
> 若實際普遍只有 1-2 段,清單 UI 可能過度設計 —— **落設計前值得請報價單端跑一次當下的分佈查詢**。

### Q4. 🔴 「部分檔案尚未串接」斷在哪一層?

**答案:斷在③出口 view。分三種斷法,不是同一個原因。**

報價單那份 plan 已經把鏈路畫成五段(`2026-07-19-akrapovic-docs-labels-and-sound-plan.md:94-99`):

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
⇒ 9 種文件全被叫成同一個名字。plan 稱此**錯標涉 5 家**(`:110` 原則 1 括號內)。

**斷法 C — 來源本身就沒有(不是斷點,是沒有)**
evotech(PDF/影片皆 0)、eazigrip/samco/motogadget/front3d/materya(皆 0)、rpm(旗標 false)。
⇒ 這幾家即使搬了版面也不會有東西顯示,**屬上游資料未到位,不是接線問題**。

**斷法 D — 刻意不給(既不是斷點,也不是「沒有」)**
🔴 **EBC 的 PDF**:官方 PDF 存在,但被刻意擋在 datasheet 白名單外(`fetchers/ebc.py:19`)。
⇒ 這是商業決定,**必須與 C 分開歸類**。混為一談的風險是:日後有人把它當缺口補上去 = 洩漏。
> (本條為 2026-08-07 下午補正 —— 原始版本把 EBC 錯誤歸進斷法 C,由 sonnet 補充盤點抓到、我親驗 `ebc.py:19` 原文確認。)

**現況狀態**:該 plan **Fable R2 PASS,但 Sean 尚未批准開工**(報價單 `STATUS.md:705` 逐字)。
plan 也已標明⑤視覺層「**Sean 拍板**;本計畫只保證資料到位」——與本線第 2 步(OD 出稿)**天然接得上**。

🔴 **兩個 repo 都是「REVOKE ALL + 逐欄 GRANT」模型,加欄不授權 = 整批 42501**
(plan `:128`:報價單側漏授 ⇒ anon 讀整支 view 失敗 ⇒ **12 家同步全紅**)。
⇒ 這條線一旦開工,屬鐵則 12 ②權限 + ③DB 結構,**高風險片**。

### 🔴 補述:「沒有出口」只對顧客站成立 —— 報價單站內部**早就在播了**

(2026-08-07 下午 Fable 對抗審查 F1 指出,我親驗確認成立。)

報價單站的內部工具**已經有一條在跑的路徑**,不動任何 schema:
`app/quotations/_lib/variants.ts:15-28` 有 `extractSounds()`,server 端直接從 `raw_jsonb.attachments.sounds`
萃出 `{title,url}[]`(含 `https://` 白名單過濾、title 正規化),註解逐字:
「**無正式欄, 埋在 raw_jsonb, 這裡在 server 端萃出傳前端**」;
`:94-105` 顯示三種附件在報價單站**都已到齊**(`datasheet_urls` / `video_urls` / `sound_clips: extractSounds(raw_jsonb)`)。
走的是 `lib/supabase-server.ts:22` 的 `SERVICE_ROLE_KEY` client,不是 anon。

**這改變了什麼、沒改變什麼(我親驗後的精確表述,與審查者的措辭不同):**

- ✅ **不變**:顧客站(storefront)走 anon + `storefront_catalog_v`,那條路**確實斷在③**。審查者亦未能推翻此點。
- 🔴 **要修正的**:報告原本的「必須先開報價單側的欄與 view」語氣**過強**,把「顧客站的唯一路」寫成了「唯一路」。
- 🔴 **但替代路沒有審查者說的那麼便宜**:顧客站的商品資料來自**網站庫**(rpm 同步),而
  **網站庫的 `products` 沒有 `raw_jsonb`** —— 我 grep `supabase/migrations/` 與 `packages/adapters/src/supabase/` 零命中。
  ⇒ 顧客站**無法照抄「直讀 raw_jsonb」**。替代路要成立,得是「顧客站跨庫直連報價單庫」
  (= 新增一條新的信任邊界,本身是鐵則 12 ②權限)或「同步管線多帶一欄」(= plan 的④,回到原路)。
- ✅ **真正的價值在這裡**:`extractSounds()` 是一個**已經在正式環境跑的參考實作**,
  含 https 白名單與 title 正規化 —— 不論走哪條路,顧客站端都不必從零設計這段。

⇒ **給主視窗**:送 Sean 的決策題**不該只有一個選項**。至少兩案(開欄+view 走同步管線 vs 跨庫唯讀 API),
各自的風險面不同,**但兩案都落在鐵則 12,沒有「便宜的那個」**。

---

## §2 對後續兩步的意涵(供主視窗判斷,非我裁定)

1. **第 2 步(OD 出稿)可以現在就開**:型別數(3 種)已確定,OD 畫稿不需要等資料層完工。
   ⚠️ 但**「音檔 364 群、單群最多 6 段」是 07-19 單一來源**,而它正是「清單 vs 單一播放器」的依據;
   建議 OD 出稿與「請報價單端跑一次當下分佈」並行,不要等,但也不要把那個數字當定案。
2. **第 2 步的「報價單端補洞片」不需要重寫,但也不該只送一個方案給 Sean。**
   那份三週前的 plan(開欄 + GRANT + view + 同步管線)是完整可用的一案;
   🔴 但依 §1-Q4 補述,還存在「顧客站跨庫唯讀取用」的另一案。
   **兩案都落在鐵則 12(②權限 / ③DB 結構),沒有「便宜的那個」** —— 差別在風險面不同,
   應該讓 Sean 在兩案之間選,而不是只看到一條路。
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
4. **聲音檔的 364/648:分母有第二來源了,分子仍是單一來源。**
   分母 648 由 `scripts/supplier-config.ts:236-242` 獨立佐證(akrapovic「1:1 單變體家(648=648)」);
   **分子 364 仍只有 plan `:82` 一個出處**,我沒有親自跑過那個查詢。
   ⇒ 「單群最多 6 段」同樣只有該處單一來源,而它是 OD「清單 vs 單一播放器」判斷的唯一依據。
5. **我沒有讀 `normalizeManuals` / `pickInstallVideo` 的函式本體**(只看呼叫點與型別),
   真要動搬遷邏輯時需另行確認。
6. ~~報價單端只查定向 pattern、沒全面盤點~~ **此缺口已於當日下午補上**:
   派 sonnet 全面盤點,結論=**沒有隱藏的第二張表或第二條管線**。
   `raw_jsonb.attachments` 底下只有 `pdfs` / `videos` / `sounds` 三個 key(`sounds` 僅 akrapovic 寫);
   另確認兩種平鋪寫法(`datasheet_urls` / `video_urls` / `video_url`)由 `fetchers/base.py:607-622` union 收斂;
   `storefront_catalog_v` 逐欄點名 **28 欄無聲音欄**。
   ⚠️ 仍未讀:`BACKUP-*.json` 大檔、少數 fetcher 的完整邏輯(僅 grep 掃過、命中零)。
7. **報價單 repo 零寫入,但它本來就是 dirty 的 —— 兩件事要分清楚。**
   我的操作全唯讀(`grep`/`sed -n`/`ls`/`test -d`/`git log`),未執行任何 `.command` 腳本、未連線寫 DB。
   收工查 `git -C … status --porcelain` 有兩筆既存改動:` M CLAUDE.md` 與 `M  docs/archive/2026-07-29-dna-research/codex_dna_execution_report.md`。
   **非本次造成**,證據=兩檔 mtime 分別是 **Aug 5 01:01** 與 **Jul 30 10:41**,而我第一次碰該 repo 是今天 **13:35** 之後;
   且其中一筆是 staged(`M `)狀態,需要 `git add` 才產生得出來,我全程沒跑過。
   ⚠️ 這兩筆 dirty 屬該 repo 既有狀態,**我沒有動它、也沒有清理它**(不是我的 repo)。
8. 本片輕量(純 docs 偵察):三綠跑 typecheck + lint,build 依鐵則 11 省;未 push;`git add` 精準單檔。
9. ✅ **本片已有跨模型第二意見(初版交付時沒有;當日下午 Fable 恢復可用後補跑)。**
   Fable 對抗審查判 **FAIL / 4 條 must-fix**,**四條我全部親驗成立、全部已修**:
   F1 核心判斷過度斷言(報價單站已有出口)/ F2 **plan 檔三處行號我引錯** /
   F3 Q3 表匿名化藏掉 akrapovic 三軸交叉線索 / F4 hedge 只寫在 §4、沒帶到 §0 與 Q3 使用點。
   🔴 **F2 是我自己的字面錯誤**:引用行號 `117-127` / `143-145` / `135`,實際是 **`94-99` / `128` / `110`**。
   病根=讀那份 plan 時用 `sed` 範圍讀、**憑印象換算行號、沒回頭 grep 驗證**
   —— 與我同日在立法草稿 §5 整理的「字面三來源律」是同一族違反。**記在這裡當實例,不粉飾。**
10. **審查未能推翻的部分**(Fable 誠實列出):`storefront_catalog_v` 無聲音欄、
   anon 對 `products` 的欄級 GRANT 無 `raw_jsonb`、`ProductTabs`/`InstallResources` 行號與
   「兩區塊零關聯」判斷,逐一核對相符 ⇒ **斷點在③的核心判斷(就顧客站路徑而言)成立**。

— E 窗,2026-08-07(初版上午偵察 / 下午經 sonnet 補盤點 + Fable 對抗審查 4 條 must-fix 全修)
