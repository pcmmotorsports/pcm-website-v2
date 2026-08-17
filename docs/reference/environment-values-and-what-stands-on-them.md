# 環境值 → 誰站在它上面(「這個值錯了會塌掉幾件事」的可查版)

> **來源**:V 窗 `~/pcm-mailbox/V-027-環境值依賴表.md`(2026-08-17 10:3x)。
> **V 窗是唯讀窗、不落 repo 檔** ⇒ 主視窗裁由 I 窗落檔。**內容一字未改,只重排順序並加本檔頭。**
>
> ## 🔴 這張表【自己就是狀態性資訊】
>
> **每一列的效期只到它「量測時點」那一格為止。**
> ⚠️ **不要因為它進了 repo 就以為它比信箱版新** —— 它會用完全一樣的方式過期,差別只在**這裡有人會回來改**。
>
> 📎 **而「時點」那一欄就是它自己的過期指標**:「量的」四列裡**三列在 48 小時內**、
> `statement_timeout` 是 **8 天前** ⇒ **列了時點,就自帶「該不該重量」的答案。**
> **這正是這張表比散落在各處的註解強的地方。**
>
> ## 🔴 表裡最危險的那一類,形狀是固定的
>
> **後台點一下就能改 / repo 裡查不到 / 零監控** —— 三件同時成立的那幾列,
> 是**別人可以在我們毫不知情的情況下改掉**、而且**改掉之後沒有任何東西會紅**的。
> (本表現有這一類:兩顆 `db-max-rows`、報價單庫的 `db-schemas` 白名單、Auth 的 `Minimum interval per user`。**這個清單只增不會自己減。**)
> 🔴 **而它們的「查得到程度」還分三級,不要混為一談:**
> **①dashboard 打開就看得到**(`db-max-rows`、`Minimum interval`)
> **②DB 裡查不到、只能從錯誤訊息反推**(`db-schemas` ⇒ `PGRST106`)
> **③唯一來源是一張截圖**(`Minimum interval` 目前就是這一級 —— **沒有人親自去 dashboard 看過**)。
> ⇒ **第③級最脆**:圖會過期,而**看圖的人與拍圖的人不是同一個** ⇒ 引用它要同時帶「誰拍的、什麼時候拍的」。
> ⚠️ **數量刻意不寫在標題裡** —— 帶數字的標題沒有人會回頭改(同 `docs/patterns/guard-and-instrument-traps.md` 檔頭的教訓)。
> 📎 判別句:**這個值,是我們 repo 裡的東西,還是別人後台裡的東西?**
> 後者 ⇒ 它的現值**只是一個量測值**,不是一個常數;**引用要帶時點,而且要指得出「誰去看、去哪裡看」。**
>
> ## 📎 它與 `STATUS.md` 那條常設規矩是同一條線的兩端
>
> `STATUS.md` 附屬區「🧭 世界狀態句附量法」:**每一句描述現況的話,旁邊附一條可重跑的量法**。
> **本檔**:把**被很多句話共用的那幾個值**集中起來,免得同一個值在十個地方各附一次量法、而它們會各自過期。
>
> ## ⚠️ 兩條落檔紀律(V 窗立,不要在引用時拿掉)
>
> 1. **「讀來的」不升級成「量的」** —— 表裡標了哪一列是哪一種,**那個標記是結論的一部分**。
> 2. **量不到的寫「量不到」+ 缺哪一道檢查**,不留空白。

---

## 🔴🔴 第一列:**`db-max-rows` 不是一個值,是一個「dashboard 上點一下就能改」的專案設定**

> **它不是這張表的一列,它是這張表的【地基】。**
> V 窗原表把它排在第三列 —— **落檔時提到最前面,免得它被排在中段然後沒有人讀到。**

| | |
|---|---|
| **記載數** | —(它是設定,不是值) |
| **量的還是讀來的** | 讀來的(`order-notes.ts:28` 自文件化「程式裡釘不住它」) |
| **量法** | Supabase dashboard → API settings **親看** |
| **範圍** | 平台設定 |
| **誰站在它上面** | 🔴 **下面 `db-max-rows` 那兩列的【一切】** |

🔴 **為什麼它是地基**:值被調低時 ——

```
所有 `rows.length >= LIMIT` 的截斷旗標    恆 false
fetchAllPaginated 的 PAGE_SIZE 餘裕      歸零
⇒ 而這一切【零機械訊號】：沒有測試會紅、沒有 grep 數會變
```

⚠️ **目前沒有任何守門在監控它的現值。**
⇒ **今晚幾乎每一條與截斷有關的 finding 都站在它上面,而它可以被一次點擊同時作廢。**

### 🔴 而它有【第二顆】—— 在另一個 Supabase 專案上

> 🔴 **引用以 `~/pcm-mailbox/V-038-max-rows全圖一頁定版.md` 為準。**
> 本節初版(commit `46f171c7`)抄的是 `V-031`,那是**中間態**;V 窗隨後把 `V-030` / `V-031` / `V-034` 收斂成一頁定版,本節**已照定版更正**(下面「三族依賴」整段是更正時補的)。
> **`V-030` / `V-031` / `V-034` 三封原信留作推導過程,不要再單獨引用其中任何一封。**

**值是 V 窗量的,不是我(I 窗)量的;我做的是開檔核行號與機制,核到的都對得上。**

| | |
|---|---|
| **在哪** | `scripts/rpm-fetch.ts:22` `PAGE_SIZE = 1000`;`:132-136` 同款「**短頁 = 末頁**」迴圈(`if (rows.length < PAGE_SIZE) break`) |
| **打的是誰** | 🔴 **報價單專案**的 PostgREST ⇒ **另一個 Supabase 專案的 dashboard 設定** |
| **記載數** | **不在本表上、值沒有人量過** |
| **量的還是讀來的** | **兩者皆非** —— 沒人去看過那個專案的 API settings |
| **量法** | 報價單專案 Supabase dashboard → API settings 親看(**本 repo 查不到**) |

🔴 **它與上面那顆的差別要一起帶走,不要只記「這裡也有一個」:**

```
上面那顆   失效【靜默】：截斷旗標恆 false、零測試會紅、零 grep 數會變
這一顆     失效【不靜默】：rpm-import.ts:188-197 的 S5 W1 抓取完整性 gate
                          （來源缺現存上架商品 >5% ⇒ 硬 abort + 非零退出 ⇒ cron 警報）
                          加上 S4 兩條，會把它接住
```

⚠️ **殘餘風險(不是零,兩個口都指得出來)**:
① **≤5% 的縮水帶是刻意放行的**(gate 門檻寫 5%,`rpm-import.ts:190` 註解逐字「抓 5–10% 靜默截斷帶」)
② **gate 可被旗標繞過** —— `ALLOW_FETCH_SHRINK`(`allowFetchShrink` 傳進 `checkFetchIntegrity`)。

📎 **記在這裡的理由不是這顆比較危險,是【它長得跟第一顆一模一樣而後果不同】** ——
下一個人看到 `PAGE_SIZE = 1000` + 短頁即末頁,會直接套用第一顆的結論(「零機械訊號」),**而這一顆是有人在守的**。
**兩顆放在一起,是為了讓「像不像」停止當作判斷依據。**

🔴 **而這是全圖裡【唯一】一個「失效 = 響亮」的**(`V-038` §二末逐字點名這一欄最容易抄漏)。
**其餘每一族都是靜默的** ⇒ **這個對比就是這一節存在的理由,不要壓縮掉。**

### 旋鈕 1 的三族依賴(照 `V-038` §二,含它自己的一條撤回)

**族 B —— 最毒,失效條件最確定(頂層查詢、不吃「內嵌是否受管」那個未確認前提)。「短頁 = 末頁」迴圈,`V-038` 逐字【只剩兩條】:**

| # | 位置 | 誰在上面 | 失效 |
|---|---|---|---|
| 1 | `packages/adapters/src/supabase/helpers/product-query-support.ts:56` / `:91`(`fetchAllPaginated`,PAGE_SIZE=1000 **零餘裕**) | storefront 分類 / 全商品列表 | **靜默**(零錯誤零 log);`1000 → 999` 就中 ⇒ 第一頁被夾短當末頁 |
| 2 | `apps/storefront/src/lib/products.ts:682-718`(`fetchVehicleTaxonomy` 手刻迴圈,零餘裕) | 車輛下拉 | **靜默** |

🔴 **`V-038` 原列有第三條,而它【已撤回】—— 出貨單列印 `SupabaseOrderAdapter.ts:936-966`。**
撤回理由(`V-034` §0):**該迴圈終止於【空頁】、游標按實得筆數前進、撞頂 throw 不回部分 ⇒ 對 max-rows 調小免疫。**
⚠️ **它留在這裡是它的訃聞,不是族 B 的第三列** —— **族 B 是兩條。**
📎 **拿它當負向對照**:誰抄出一個三條的族 B,就是抄到訃聞了。它反而是**寫對的範本**(判別句在 `docs/patterns/pagination-loop-review.md`)。

**族 A —— 六條,前提 = 「內嵌受 max-rows 管」(🔴 該前提【未確認】;前提為假則全族免疫)。`rows.length >= 常數` 截斷旗標:**

    order.ts:873 (200) / order.ts:188,:389 (500) / order-cancellations.ts:99,:142 (200/100)
    order-procurement.ts:158 (50) / order-notes.ts:109 (200)
    🔴 order.ts:699 付款嘗試 verdict (50) —— 錢族；調小到 <50 ⇒ 恆 `'clear'`，失效方向 = 看起來乾淨

**失效 = 靜默** —— 而且是最壞的那種靜默:**旗標本身就是警報器,而警報器先死。**

**族 C —— 兩條,`limit+1` 探針**:`refund-read.ts:72`(200+1)/ `:77`(50+1)。
值調小 ≤ 常數 ⇒ `truncated` 恆 false **且**清單真截斷(漏看卡住的退款)。**失效 = 靜默。**

**不踩的(`V-038` 明列,別抄進來)**:儲值金(餘額 = trigger 快取欄,`SupabaseWalletAdapter.ts:119`)/ 推薦候選(踩的是族 A 餵的 id 集合 = 間接,不獨立成列)。

### 🔴 抄表的人要一起帶走的兩條裁定(`V-038` §三)

1. **修法 plan 有硬前置**:「**內嵌是否受 max-rows 管**」量掉之前**不准出修法 plan** ——
   **前提為假的話,監控會裝在一條不會出事的路上**(那本身是淨負的)。量法 = staging 構造 >1000 內嵌列;執行另派。
2. **`1000` 是量測值不是常數** —— A 窗 2026-08-17 凌晨量的(頂層/anon/production),**引用要帶時點**。
   memory `project_0817-order-line-item-ceiling-is-200` 裡那句「200 之下還有真牆 1000」**同源** ⇒ **旋鈕一動,兩處同時過期。**

---

## 其餘各列(順序照 V 窗原表)

| 值／平台行為 | 記載數 | 量的還是讀來的 | 量法(可重跑) | 範圍標籤 | 誰站在它上面 |
|---|---|---|---|---|---|
| PostgREST `db-max-rows`(**頂層**) | 1000 | **量的**(A 窗) | anon 對 production 任一表不帶 Range 拉一次、數回列 | production／anon／頂層／2026-08-17 凌晨 | `fetchAllPaginated` PAGE_SIZE==1000 零餘裕;F-S3 手刻迴圈;所有 `rows.length >= LIMIT` 截斷旗標的有效性 |
| `db-max-rows` **對內嵌資源** | 「也套用」 | 🔴 **讀來的**(issue #2776 作者敘述;**官方文件沒寫**,C 窗查證) | 要量得構造一張內嵌 >1000 列的單(A 窗自陳:無可寫正式庫的環境,**量不到**)⇒ 缺的檢查=正式庫構造測試單或 staging | **未確認** | embed-truncation 整條線的前提;Q2=甲 的觸發面;itemCount／貨品軸 `.every()` 誤判情境 |
| `statement_timeout` | anon=3s／authenticated·authenticator=8s／service_role=300s | **量的**(08-09 實量,落 `20260809180000` 檔頭;⚠️ repo 註解曾寫錯一次,08-11 更正在 memory `reference_supabase-anon-rpc-verify-generic-plan-timeout`) | 各角色連線跑 `show statement_timeout` | production／各角色／**2026-08-09**(⚠️ 全表最舊的一列) | 車型 view「最終不修」裁定(3047ms>3s);anon RPC 效能驗證方法論;翻頁保留搜尋詞那片 |
| vitest 測試環境 TZ | `Asia/Taipei` 釘死 | **量的**(`vitest.config.ts:64` 逐字＋C 窗 §8.1 探針證明 naive/fixed 在此 TZ 下 960 個整點零差異) | `grep -n "TZ" vitest.config.ts` | repo／CI／測試環境 | **所有時區類守門的判別力**;F-D1 五份 `Asia/Taipei` 複本的測試各自全盲;出貨日那格的假綠機制 |
| pcm-admin 的 production 分支 | `dev` | 讀來的(memory `project_pcm-admin-production-tracks-dev`,多輪引用;**未見有人本輪親看 dashboard**) | Vercel dashboard → pcm-admin → production branch 親看 | 平台設定 | 「push 即上線」全部紀律;「CI 是事後警報」那條 Blocker;收割窗不推的份量 |
| Vercel 方案 | Hobby | 讀來的(memory reference,07-25 實查;**已隔 3 週**) | dashboard 親看 | 平台帳務 | 排程設計禁綁 Vercel cron;部署額度打滿事故的復發條件 |
| GoTrue 設定(Q-AUTH-1 前提③) | 截圖為證 | 🔴 **讀圖的**(B-554 §6:**SQL 原理上查不到**,住 GoTrue config 不在 DB) | 量不到(DB 內無)⇒ 缺的檢查=Supabase Auth dashboard 親看或 Auth admin API | Supabase Auth／截圖時點 | 真登入線甲案前提③ —— B 窗自標「證據是截圖不是機器輸出」 |
| 報價單庫「108 放大倍數」 | 108 | 讀來的(E 窗自標;🔴 **本列是主視窗轉述,V 窗無第一手**) | 出處與量法在 E 窗檔,本表只登記它的證據等級 | 報價單庫 | `#553`／E-694 相關判讀 —— **引用前先去 E 窗檔核出處** |
| PG 版本(正式庫) | 17.6(拋棄式 17.10,同 major) | 讀來的(B-554 引;**本輪未重查**) | `select version()` 唯讀帳號 | production／08-16 | event trigger shared-object 結論的適用性;MAINTAIN 權限存在性;丙案 acldefault 推導集的內容 |
| Supabase Auth `Minimum interval per user` | **60 秒**(同一使用者兩次重設/OTP 請求的間隔下限) | 🔴 **讀圖的** —— **唯一來源是 Sean 2026-08-17 提供的 Dashboard 截圖,E 窗判讀**;**沒有任何人在 DB 或 repo 裡量到它** | Dashboard → Auth → SMTP **親看**(repo 查不到) | 平台設定／截圖時點 2026-08-17 | `finding#4`(login/forgot 輕判)的依據之一。出處 `docs/security/2026-08-17-supabase-recovery-throttle-granularity.md` ✅ **已在 dev 上**(2026-08-17 午後隨 `customers` 收割進來)。⚠️ **本格 2026-08-17 上午一度標成「全樹不存在」** —— 當時 `git ls-files` 零命中是**真的**,而那個檔在 `customers` 分支上、**從沒進過 dev** ⇒ **量法沒錯,錯的是分母**(`git ls-files` = **dev 的全樹**,不是 repo 的全樹)。成因全文 `docs/lessons-learned.md` §12-43;查法已做成 `bash scripts/where-is.sh <path>`。**後台點一下就能改、零監控** ⇒ 同 `db-max-rows` 族 |
| PostgREST `db-schemas` 白名單(**報價單庫**) | `public, graphql_public` | **量的**(🔴 **E 窗 2026-08-17 實打,不是我量的**) | 🔴 **DB 端查不到** —— 它存在 PostgREST/Supabase 設定裡,`pg_db_role_setting` 沒有它 ⇒ **只能從 `PGRST106` 錯誤訊息反推**;出處 `docs/security/2026-08-17-quote-db-round2-*.md` §2 | 報價單庫／平台設定／2026-08-17 | 決定 anon 經 REST 碰得到哪些 schema。**§1#9 與 §5-b「net·pg_stat 外部不可達」整條踩在它上面** ⇒ **把 `net` / `extensions` 加進白名單就漏**。零監控 |

---

## ⚠️ 引用本表時的三個限定

1. **`108` 那一列標著「主視窗轉述、V 窗無第一手」** —— **落檔時沒有拿掉那個限定,引用時也不要拿掉。**
2. **「讀來的」那六列都沒有本輪的第一手量測** —— 其中 `pcm-admin production 分支` 與 `Vercel 方案`
   是**平台 dashboard 的東西,repo 內原理上查不到** ⇒ 要驗只能有人去點開。
3. **`statement_timeout` 是全表最舊的一列(8 天前)** ⇒ **它最該被重量,而那正是「時點」欄的用途。**
