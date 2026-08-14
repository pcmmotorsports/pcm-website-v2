# 乙案問題清單 · 「鎖做在報價單側」要先問清楚什麼

> 這是**問題清單,不是設計**。用途:Sean 明天可以直接拿去問、或交辦給報價單那條線。
> 只在 Sean 選乙(或想比較兩案真實成本)時才需要;選甲的話整張作廢。
> 🔴 來源:報價單 repo 的 **`origin/main`**(本機 clone 落後 16 顆);**我沒有動那個 repo 任何東西,只讀**。
> ⚠️ 不等於 mac mini 正本 —— 下面每一題都要以那邊的實況為準,我的引用只是「問題怎麼問」的依據。

## A. 身分:我們的後台要用什麼身分寫進報價單?

> 🔴 **2026-08-14 夜訂正 —— 本節原本的答案是錯的。**
> 原文寫「報價單沒有『另一個系統呼叫我』的驗證方式,只有人用瀏覽器登入」。**不成立。**
> 錯因:當時跑 `git grep -l ... | head -10`(只給檔名 + 被截斷),再**只開其中 1 支**看,
> 就把單一樣本推成全稱句 —— 分母 66 支 API 我只看了 1 支。
> 訂正依據與全量重數見 `2026-08-14-quote-project-readthrough.md` §0。

**現況(重數後)**:66 支 API 中 —— `requireAdmin`/`requireFull2FA` **26 支**、`CRON_SECRET` **3 支**、
兩者皆無 **37 支**(那 37 支靠什麼保護**未逐支確認**)。
報價單**已有兩套 server-to-server 驗證**:`CRON_SECRET`(三支 cron)與
`PCM_SSO_EXCHANGE_SECRET`(`/api/sso/exchange`,檔頭逐字「server-to-server, 無 cookie」、`timingSafeEqual` 常數時間比對)。
`middleware.ts:16-19,38-41` 逐條放行 `/api/line/*`、`/api/quote/*`、`/api/sso/exchange`。
🔴 **而且第二套就是我們兩個專案之間的、已經在跑**:`apps/admin/src/lib/sso/config.ts:24` 讀該 secret、
`lib/sso/exchange.ts` 正在 POST `quote/api/sso/exchange`。

1. 新的寫入端點要沿用哪一套?**(a) 比照 `/api/sso/exchange` 另開一支共享 secret 的 server-to-server 端點**
   **(b) 不走 API、直接連 B 庫**(現行我們拿的是 **anon publishable key、唯讀**)
   **答 (a) ⇒ 報價單側多一支端點 + 一顆 secret,我們這側只寫呼叫;答 (b) ⇒ 報價單側零改動,但要開 DB 角色與欄級授權(見第 2 題)。**
   > ⚠️ **原本還列了「(c) 掛在既有 SSO 通道上」,我讀完那支本體後自己刪掉(A 窗 N2)**:
   > `app/api/sso/exchange/route.ts:11-13` 逐字是「**原子消耗**: 單一 `UPDATE … WHERE used_at IS NULL …` RETURNING
   > → 標記已用並回傳」、回的是 `{ ok, amr, auth_time }` —— 它是**一次性授權碼兌換**端點,
   > 掛資料寫入進去會讓認證端點多一個職責、且那支**每次呼叫都會消耗一個碼**。**不是真選項,不該送到 Sean 桌上。**
2. 若走 (b) 直接連庫:要開哪個角色、只給哪幾張表哪幾欄的 UPDATE?
   **答「開專用受限角色」⇒ 報價單側要一支 migration(欄級 GRANT);答「用現成 service_role」⇒ 等於把整庫寫權交出去,安全上不可接受。**
3. 🔴 2FA 那題**縮小但沒消失**:既有 server-to-server 端點是**繞過 cookie session 的正門**(`middleware.ts:22` 逐字說明
   `/api/sso/authorize` 刻意**不**放行)⇒ 新開一支寫入端點等於**多一個不受 2FA 保護的入口**。
   要不要?誰能呼叫?這仍是安全題,不是接線題 —— 只是**已有前例可循**,不是從零發明。

## B. 鎖本身:要鎖的欄和現有的鎖對不對得上?

**現況**:兩把鎖都只保護**報價單自己的欄**不被**它自己的 fetcher** 覆寫 ——
`translation_locked` 保 `product_name_zh / category_zh / description_zh`(`baseline_schema.sql:2417`)、
`manually_corrected` 保 fitment 那組(`:2372-2375`)。

4. Sean 說的「內文」= 報價單的 `description_zh`,還是我們網站 `products.description`?兩者經同步相連但**不是同一欄**。
5. 若是 `description_zh` ⇒ 🔴 **他今天就能在 `/translations` 改並上鎖,乙案的這一半等於已經做完** —— 要先確認他知不知道、以及那個畫面夠不夠用。
6. 我們還想鎖 `title` / `subtitle` / `images` / `availability` 嗎?這幾欄**沒有**對應的既有鎖,是真的要新增的部分。
7. 上鎖是**逐列**還是**逐供應商**?(我們這邊現有的 `syncDescription` 是**逐供應商**、all-or-nothing)
   **答「逐列」⇒ 沿用報價單既有的逐列剝欄機制、零新發明;答「逐供應商」⇒ 更簡單,但員工無法只鎖某一件商品。**

## C. 傳遞:鎖狀態要不要讓我們看得見?

**現況**:`storefront_catalog_v` **沒有投影** `translation_locked` / `manually_corrected`
⇒ 我們這邊連「這一欄有沒有被鎖」都讀不到。

8. view 要不要加投影這兩欄(或一個彙總的 `locked_fields`)?這是報價單側的 migration。
9. 我們的 admin 要不要**顯示**鎖狀態給員工看?(不顯示的話員工會改了才發現沒生效)
10. ⚠️ 我手上的 view 定義是 **2026-07-15 快照**且**已知至少兩處過期**(欄名 `price_general`→`price_retail`、v3 起多了 `delisted_at`)⇒ **現行欄位清單要重新拉一次**,不要拿我的引用當現況。

## D. 責任邊界

11. 這條線由誰做?報價單那條線的人、還是我們?(正本在 **mac mini**,不在這台)
    **答「報價單那條線」⇒ 我們只出規格與呼叫端、要跨機器排程;答「我們」⇒ 要先解決 mac mini 的存取,今晚這條就卡在這。**
12. 兩邊 schema 改動要不要同一天上?(我們這邊有硬規矩:應用層不得先於 migration 上線)
13. 報價單專案自己的鐵則 12 寫「**手改 = 人工值神聖**」(`app/api/translations/update/route.ts:5` 逐字)——
    我們送過去的「鎖」算不算人工值?**如果算,誰有權解鎖?**

## D-2. 🔴 14.(A 窗 M3 補,兩張清單原本都漏)員工在「我們的」後台改了內文,會怎樣?
乙案的鎖只保護**報價單自己的欄**不被**報價單自己的 fetcher** 覆寫;
而我們這側 `products.description` 由同步依 `syncDescription` 寫入(`rpm-transform.ts:330` 逐字條件展開;
欄位語意見 `rpm-fetch.ts:42` 註解)⇒ **乙案落地後,`syncDescription=true` 的那 14 家,
員工若在我們後台改內文,下一輪同步照樣蓋掉、而且沒有人會收到通知。**
⇒ **做完乙案之後,我們後台那個欄位要改成唯讀,還是要導去報價單改?**
**答「唯讀」⇒ 員工要學會「內文去報價單改」,我們這側要加導引文案;答「照改」⇒ 必須同時做「改了會被蓋掉」的警示,否則是靜默資料遺失。**
⚠️ **這是操作面決定,不是接線題。** 乙案不解這題就落地,員工的每一次編輯都會安靜消失。

## E. 我沒查的(別把這張清單當完整盤點)
- mac mini 正本(以上全部讀 `origin/main`)。
- 報價單側做這件事的**工時**——我只盤了「要問什麼」,沒盤「要做多久」。
- ~~報價單是否已有我沒找到的機器身分機制~~ **這條當時就該是紅的,而它確實漏了(見 §A 訂正)。**
  現況已重數:66 支逐支分類過。**新的未讀面 = 那 37 支「兩者皆無」的 route 靠什麼保護**,尚未逐支開檔。
- **甲案的對應問題清單我沒寫** —— 這張只覆蓋乙。若 Sean 傾向甲,要另開一張。
