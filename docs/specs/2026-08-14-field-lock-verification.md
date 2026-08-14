# 逐欄鎖查證報告 · Q-B1 追問(2026-08-14 夜 · B 窗)

> 交辦 = `主-B-002-DISPATCH` §3。零 code、零 migration 版本號。
> 🔴 結論先講:**Sean 那句「等於我們這個功能=報價單後台編輯鎖住功能」是字面精確的,不是比喻。**
> 報價單**已經有兩套逐欄鎖在跑**,我們的同步腳本**也已經有逐欄跳過的能力**。

## 1. 報價單那邊有沒有鎖?**有,兩套,都在跑**
🔴 **更正主視窗一處**:它說 home 底下沒有報價單 repo —— **找到了**,
`/Users/sean_1/API大量上架/PCM報價單-V2`(掃 `~/*/` 掃不到、它在第二層),
remote = `pcmmotorsports/pcm-quote-v2`,**本機 clone 落後 `origin/main` 16 顆**
(`git rev-list --count HEAD..origin/main`)⇒ 下面全讀 `origin/main`。⚠️ 仍不等於 mac mini 正本。

| 鎖 | 欄 | 保護哪些欄 | 誰設 | 證據 |
|---|---|---|---|---|
| fitment 校正鎖 | `products.manually_corrected` | `brand/model/year_start/year_end/fitment_parsed` | Sean 在 `/audit` accept | `baseline_schema.sql:2372-2375` COMMENT 逐字 |
| 翻譯鎖 | `products.translation_locked` | `product_name_zh / category_zh / description_zh` | Sean 在 `/translations` 手改後 | `baseline_schema.sql:2417` COMMENT 逐字 |

COMMENT 逐字:「fetcher 與翻譯 backfill 重跑時**不覆蓋這些欄**。與 manually_corrected(fitment 校正鎖)**獨立**。」
實作在 `fetchers/base.py:463-510`、`:1386` `fetch_translation_locked_skus()`;UI 在 `app/translations/`(有勾選、有鎖圖示,`translation-table.tsx:226`)。
⇒ **Sean 講的「後台」= 報價單後台。他已經有一個手改 + 上鎖的地方,而且已經在用。**

## 2. 我們的同步腳本有沒有逐欄跳過能力?**有,而且已經在用**
`rpm-transform.ts:328-338` 五欄**條件寫入**(旗標關掉 ⇒ 整個 key 不進 payload ⇒ 不覆寫):
`description` + `highlights` 由 `syncDescription` 控;`manuals` / `video_url` / `sound_clips` 由 `syncInstallResources` 控。

**每輪必覆寫、無法跳過的欄**(`rpm-transform.ts:322-375` 逐行):`supplier_slug`(`:323`)、`external_id`(`:324`)、
`handle`(`:325`)、`title`(`:326`)、`subtitle`(`:327`)、`price_general`(`:339`)、`price_store`(`:340`)、
`price_by_tier`(`:341`)、`fitments`(`:346`)、`images`(`:347`)、`availability`(`:348`)、
`brand_id`(`:351`)、`category_id`(`:352`)、`metadata`(`:353`)、`delisted_at`(`:367`)、`updated_at`(`:374`)。

**現況旗標分佈**(`supplier-config.ts`,逐行 grep):真供應商 **15 家**,`syncDescription`:**rpm=false、其餘 14 家=true**
(第 16 筆 `__gated_canary__:318` 是測試 fixture、不算)。⇒ **內文被沖掉的問題只發生在那 14 家**,rpm 早就凍結了。

🔴 **順帶結掉我上一封的誠實缺口 #2**(PostgREST upsert 缺席欄語意)—— `rpm-load.ts:47-58` 有**親驗**答案,
而且和我原本的推論**不一樣**:`.upsert(陣列)` 的 `?columns` 取**全批 key 聯集**+`defaultToNull=true`
⇒ **同批混「有 key」與「省 key」兩種列時,省 key 的列會被寫 NULL、不是保留現值**(親驗 postgrest-js v2.105.3
`PostgrestQueryBuilder.ts:1359-1362`)。解法是 `groupByKeySignature()`(`:70`)把 key 集合相同的列分同一批。
⇒ **「省 key = 保留現值」只在整批 key 一致時成立。** 這條直接決定 §4 甲案的難度,不是細節。

## 3. 鎖若做在報價單側,我們寫得進去嗎?**寫不進去**
`rpm-import.ts:4-5` 逐字:來源「**唯讀、絕不寫**」,用 **anon publishable key**
(`:149-150` `QUOTE_SUPABASE_URL` + `QUOTE_SUPABASE_PUBLISHABLE_KEY`);目標才用 `SUPABASE_SECRET_KEY`(`:157`)。
且來源是 **view** `storefront_catalog_v`,不是表。
🔴 而且該 view **沒有投影 `manually_corrected` / `translation_locked`**(`docs/reviews/2026-07-15-storefront-catalog-v-livedef.sql`
欄位清單逐欄看過)⇒ **我們這邊連「這欄有沒有被鎖」都看不到。**
⚠️ 那份是 **2026-07-15 快照**,而 `rpm-import.ts:26` 提到「view v3 起投影 delisted_at」、欄名也已從 `price_general` 改 `price_retail`
⇒ **快照已過期,現行 view 欄位清單未確認**。要確定得對 B 庫實查(我沒有該庫連線)。

## 4. 特價那套「網站額外機制」存在嗎?**UI 殼在,資料面零**
掃 6 變體(`特價|sale_price|discount|promotion|compare_at|原價`)over `apps/ packages/ supabase/ scripts/`,分母 **1275 檔**:
命中全在 storefront **前端**(`FilterDrawer.tsx:340` chip、`ProductCard.tsx:127` 徽章、`Price.tsx:9` 劃線價分支);
`isSale` **非測試**賦值 **0 處**;DB 端 `products` **無** sale/discount 欄(`discount_total` 屬 `orders` / `admin_order_list_v`)。
`ProductBreadcrumb.tsx:65` 逐字「2026-08-11 移除(#269-a;**Sean:特價概念還不存在**)」
⇒ 他那句「除非特價(我們網站額外機制)」講的是**未來**,不是現況。

## 5. 兩案比較

**先回答他那句「價錢應該以後台為主」:🔴 現況已經是了。**
`price_general` 每輪由 `view.price_retail` 覆寫(`rpm-transform.ts:284,339`)⇒ **價錢的權威今天就在報價單後台。**
⇒ **價錢這一半不需要做任何事。** 要做的只有「內文手改不被沖掉」那一半(+ 上下架,他沒提)。

| | **甲:鎖做在我們這邊** | **乙:鎖做在報價單那邊,admin 只當介面** |
|---|---|---|
| 動什麼 | `products` 加逐欄鎖欄 + `rpm-transform` 讀鎖決定要不要展開 key + 逐列 key 集合變動 ⇒ 靠 `groupByKeySignature` 吸收(§2 那條) | 報價單側擴 `translation_locked` 模式到我們要鎖的欄;view 投影鎖欄;我們的 admin 呼叫報價單的 API |
| 哪個專案 / 機器 | 只有本 repo、這台 | **兩個 repo**,報價單正本在 **mac mini** |
| 鐵則 | **8 + 12③**(schema + migration) | 本 repo 側 8;報價單側走**它自己**的規矩 |
| 價錢權威落在誰 | 🔴 **落在我們這邊**(我們可以鎖住價格欄不被同步覆寫)⇒ **與 Sean「價錢以後台為主」相反** | **留在報價單後台** ⇒ **與 Sean 原話一致** |
| 內文權威 | 我們的 admin | 報價單 `/translations`(**已經存在、他已經在用**) |
| Sean 明天要做什麼 | 批准 plan + 之後批 apply | ①確認「後台」是不是指報價單 ②開 mac mini 那邊的施工窗 ③決定 admin 要不要寫得進報價單庫(現在是 anon 唯讀 ⇒ **要開權限**) |

**推薦乙,附但書。** 理由:Sean 兩句原話都指向乙,且乙要的鎖**有一半已存在**(`translation_locked` 保護 `description_zh`);
甲會把價錢權威搬到我們這邊、和他講的相反。**但書**:乙要 admin 寫進報價單庫,而現行連線是 **anon 唯讀**(§3)
⇒ 不是「只做一個介面」那麼輕,要在報價單側開寫入 API + 權限,**該成本我沒量**(見缺口 3)。

## 6. 誠實缺口
1. 報價單 **mac mini 正本未讀** —— 以上全部讀 `origin/main`(比本機 clone 新 16 顆,但不保證等於 mac mini)。
2. **現行 `storefront_catalog_v` 欄位清單未確認**(手上快照是 2026-07-15、已知至少兩處過期,§3)。
3. **乙案在報價單側的施工成本未量** —— 我沒盤該專案現有的 admin 寫入 API / 權限模型。
4. 上一封的缺口 1(service_role 對 `products` 的 grant)**仍未查證**,Sean 答 B 不會讓它消失。
5. Sean 沒講**上下架**歸誰。我沒問也沒假設 —— 現況權威在來源側(`rpm-transform.ts:356`)。列為待問。
