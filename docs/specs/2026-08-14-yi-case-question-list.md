# 乙案問題清單 · 「鎖做在報價單側」要先問清楚什麼

> 這是**問題清單,不是設計**。用途:Sean 明天可以直接拿去問、或交辦給報價單那條線。
> 只在 Sean 選乙(或想比較兩案真實成本)時才需要;選甲的話整張作廢。
> 🔴 來源:報價單 repo 的 **`origin/main`**(本機 clone 落後 16 顆);**我沒有動那個 repo 任何東西,只讀**。
> ⚠️ 不等於 mac mini 正本 —— 下面每一題都要以那邊的實況為準,我的引用只是「問題怎麼問」的依據。

## A. 身分:我們的後台要用什麼身分寫進報價單?(**最硬的一題**)

**現況**:報價單所有 admin API 都走 `requireAdmin()`(`lib/auth-server.ts:50-67`)=
**瀏覽器 cookie session + SESSION_SECRET 驗章 + 2FA 開啟時拒純密碼 session**。
我掃了 `app/api/*` 與 `lib/*` 找機器對機器的入站驗證(`api_key|bearer|x-api-key|service token`),
命中的 `Bearer` 是**出站**打 Supabase 的 service-role key(如 `gbracing-pricing/route.ts:380`),**不是**入站機器身分。
⇒ **據我所讀,報價單目前沒有「另一個系統呼叫我」的驗證方式,只有「人用瀏覽器登入」。**(未確認 mac mini 正本是否已有)

1. 我們的 admin 要以什麼身分呼叫?(a) 新開一組機器用 API key (b) 共用 Sean 的 session (c) 不呼叫 API、直接連 B 庫
2. 若 (c) 直接連庫:要開哪個角色、只給哪幾張表哪幾欄的 UPDATE?(現行我們拿的是 **anon publishable key、唯讀**)
3. 🔴 報價單的 2FA 是**全公司一組**(memory `project_m4b-real-auth-line-decisions`)⇒ 機器身分要怎麼繞過 2FA 而**不**把 2FA 變成擺設?這題是安全題,不是接線題。

## B. 鎖本身:要鎖的欄和現有的鎖對不對得上?

**現況**:兩把鎖都只保護**報價單自己的欄**不被**它自己的 fetcher** 覆寫 ——
`translation_locked` 保 `product_name_zh / category_zh / description_zh`(`baseline_schema.sql:2417`)、
`manually_corrected` 保 fitment 那組(`:2372-2375`)。

4. Sean 說的「內文」= 報價單的 `description_zh`,還是我們網站 `products.description`?兩者經同步相連但**不是同一欄**。
5. 若是 `description_zh` ⇒ 🔴 **他今天就能在 `/translations` 改並上鎖,乙案的這一半等於已經做完** —— 要先確認他知不知道、以及那個畫面夠不夠用。
6. 我們還想鎖 `title` / `subtitle` / `images` / `availability` 嗎?這幾欄**沒有**對應的既有鎖,是真的要新增的部分。
7. 上鎖是**逐列**還是**逐供應商**?(我們這邊現有的 `syncDescription` 是**逐供應商**、all-or-nothing)

## C. 傳遞:鎖狀態要不要讓我們看得見?

**現況**:`storefront_catalog_v` **沒有投影** `translation_locked` / `manually_corrected`
⇒ 我們這邊連「這一欄有沒有被鎖」都讀不到。

8. view 要不要加投影這兩欄(或一個彙總的 `locked_fields`)?這是報價單側的 migration。
9. 我們的 admin 要不要**顯示**鎖狀態給員工看?(不顯示的話員工會改了才發現沒生效)
10. ⚠️ 我手上的 view 定義是 **2026-07-15 快照**且**已知至少兩處過期**(欄名 `price_general`→`price_retail`、v3 起多了 `delisted_at`)⇒ **現行欄位清單要重新拉一次**,不要拿我的引用當現況。

## D. 責任邊界

11. 這條線由誰做?報價單那條線的人、還是我們?(正本在 **mac mini**,不在這台)
12. 兩邊 schema 改動要不要同一天上?(我們這邊有硬規矩:應用層不得先於 migration 上線)
13. 報價單專案自己的鐵則 12 寫「**手改 = 人工值神聖**」(`app/api/translations/update/route.ts:5` 逐字)——
    我們送過去的「鎖」算不算人工值?**如果算,誰有權解鎖?**

## E. 我沒查的(別把這張清單當完整盤點)
- mac mini 正本(以上全部讀 `origin/main`)。
- 報價單側做這件事的**工時**——我只盤了「要問什麼」,沒盤「要做多久」。
- 報價單是否已有我沒找到的機器身分機制(我掃的是 `app/api/*` 與 `lib/*` 兩個範圍,pattern 見 §A)。
- **甲案的對應問題清單我沒寫** —— 這張只覆蓋乙。若 Sean 傾向甲,要另開一張。
