# CURRENT HANDOFF — pcm-website-v2

> **2026-09-09 下午改版:三窗分派上線清單。** 上午的減法版仍有效(舊版 `docs/handoff/archive/CURRENT-20260909-pre-cut.md`;上午版可用 `git log -p docs/handoff/CURRENT.md` 撈)。
> 本檔由主視窗維護。**壓縮後、換 session 後、任何時候不確定要做什麼 ⇒ 先讀這一支。**

## 🔴 壓縮後第一件事(主視窗自己看)
1. `git branch --show-current && git status --short && git rev-list --count origin/dev..HEAD`
2. `ListAgents` 找三個施工窗,對照下面「三窗現況」那節。
3. 讀本檔「三窗分派」那節,把還沒做完的接下去。**不要重新盤點板子** —— 分派已經做過了,結果就在下面。
4. 每次有窗回報做完一片 ⇒ 回來更新本檔「三窗現況」那節。**這是存檔點。**

---

## 這一輪在做什麼

**目標 = 把 `docs/launch-todo.md` 裡真正擋上線的東西做完。**
2026-09-09 下午主視窗把該檔 102 列「⟨已量 2026-09-09 · B⟩ 且標⟨擋⟩」的列逐列讀過一次,分三堆:

| 堆 | 列數 | 處置 |
|---|---|---|
| A 真的還擋著 | **≈62** | 分給三個窗做(下面) |
| B 已做掉 / 已證偽 | ≈15 | 不做。標題還在但事情不成立 |
| C 不該擋上線 | ≈26 | 不做。制度 / 量具 / 板子健康 / 另一個 repo(`pcm-quote-v2`) |

⚠️ **這個三分堆是主視窗【讀出來的判斷】,不是量出來的。** 做的時候撞到分錯堆的,回報主視窗改分派,不要硬做。
⚠️ `docs/launch-todo.md` **凍結唯讀** —— 只能 grep 找錨,不准改它。

## 每一列的做法(三個窗都一樣,不准跳)
1. 讀那一列原文,列出它宣稱什麼。
2. **對正式庫唯讀量一次,確認今天還成立**(`bash scripts/readonly-prod-sql.sh <你的.sql>`)。⟨已量 2026-09-09⟩ 是那天早上量的,不是現在。
3. 不成立 ⇒ 回報主視窗「這列已不成立,證據是 X」,**不修**。成立 ⇒ 才動手。

---

## 三窗分派

### 窗 A — 前台 / 搜尋 / 經銷會員(12 列)
worktree `~/pcm-shop`,branch `agent/shop`,鑽機 `bash scripts/storefront-probe/up.sh`(3020)
```
⟦f3-PDPSKUSTATIC⟧        商品頁「原廠料號」不跟著選的規格變
⟦f3-FITSTALE1⟧           車款搜尋的資料停更了,沒有人會知道
⟦f3-HALFWRITE1⟧          供應商同步失敗留下半寫入中間態,不是整批回捲
⟦auth-DEALERTIERPRICING⟧ 經銷會員登入看不到經銷價(兩層都關著)
⟦b4-DEALERSIGNUPUNSEEN⟧  經銷會員登錄那條路沒有人驗收過
⟦db-DEALERCATALOGRPC93⟧  經銷客目錄的篩選/排序/筆數要走經銷價
⟦db-SEARCHFACETMUTEX⟧    關鍵字路與 facet 路互斥,客人一點篩選字就被丟掉
⟦search-TAXONOMY2MB⟧     車輛對照表 2.68MB 塞不進 cache,/products 每發重撈 12,197 列
⟦search-TAXONOMYTIMEOUT⟧ 車款查詢逾時而靜默降級,客人拿到殘缺下拉
⟦db-TAXONOMYVIEW⟧        顧客站切分類要 3 秒的真兇
⟦f3-FWBYPASSORDER⟧       Vercel 防火牆規則必須排在放行規則下面,沒有東西守
⟦auth-PROBENEXTRED⟧      跑完後台鑽機再跑三綠,typecheck 紅在沒人改過的檔
```
🔴 經銷那三列碰錢 ⇒ codex 唯讀審。做完這 12 列再做【手機版走查】(375px / 414px 全流程,板子上沒有這批,是主視窗加的)。

### 窗 B — 錢與訂單(26)+ 出貨與新竹(3)
worktree `~/pcm-ops`,branch `agent/ops`,鑽機 `bash scripts/admin-probe/up.sh`(3011)
```
錢與訂單:
⟦b4-BANKCHARGESCARD⟧        🔴🔴 翻開匯款開關那刻會拿客人的卡去扣匯款單的錢
⟦b4-BANKORDERINVISIBLE⟧     🔴🔴 匯款單在 DB 眼裡不存在 ⇒ 客人兩邊都付
⟦mail-PAYMENTNOCAP⟧         🔴🔴 收款可填任意金額 ⇒ 灌假現金收款撐大退款上限
⟦0a-CARDCANCELNOREFUND⟧     🔴🔴 取消刷卡單,沒有東西會自動退那筆錢
⟦b4-PARTPAIDCOUPONNEVER⟧    分次付清的訂單優惠券永不扣、沒有聲音
⟦b4-PAIDTHENOVERPAID⟧       已付款的單被多匯一次
⟦b4-NCPCRONRACE⟧            逾期 cron 先鎖單、收款才落帳 ⇒ 已取消而錢在裡面
⟦b4-MANREFUNDNOAUDIT⟧       人工退款零稽核紀錄
⟦b4-MGR0-RPC⟧               稽核記「管理者 A 做的」而 A 當下已不是管理者
⟦b4-INVOICE5PCT⟧            手動建單「開發票」勾了 +5%(Sean 09-04 拍,預設不勾)
⟦b4-PRICECOPYTAX⟧           建單畫面教員工「單價填含稅」與上一列衝突
⟦b4-MANUALORDERDEADEND⟧     手動建單走得完而走完出不了貨
⟦b4-PARTCANCELTAX⟧          未稅單算「多收」算出太大的數字(錢往外)
⟦b4-PENDINGRECONCARDRF⟧     待退款對帳沒扣掉已退的卡片退款
⟦b4-CARDALREADYREFUNDED⟧    卡那半已退成功的混合單登記不了
⟦b4-ZEROREMAININGSHOWSFORM⟧ 未登記額 0 的單照樣顯示登記表單
⟦b4-REFUNDID1⟧ (#906)       退款 ID 在傳遞途中被丟掉
⟦b4-CAPRACE1⟧               閘在防一件它防不到的事,修好它會讓帳更錯
⟦b4-PAYCONCUR1⟧             兩筆收款同時進來 ⇒ 實收 1000 卻停在部分付款
⟦b4-CUTOFFWRONGCOLUMN⟧      契約寫 cancelled_at 而真正決定取消信的是 created_at
⟦b4-AUDITNULLAMBIG⟧         稽核 before 分不出「沒有那列」與「我讀不到」
⟦f3-PAIDCANCELRACE1⟧        取消狀態只讀一次 ⇒ 讀完才被取消的單照樣收付款成功信
⟦f3-PAIDAMOUNTDRIFT1⟧       表頭金額與品項是兩次查詢,沒人驗它們相等
⟦c7-LEDGERGATEREFUSES⟧      Sean 退了現金而系統不讓他記
⟦auth-PAIDAMOUNTNOTFROZEN⟧  付款信金額是寄出當下重查的
⟦auth-PARTIALREFUNDCANCELGAP⟧ 取消而只退一部分的單,兩條寄信線都不寄

出貨與新竹:
⟦ship-CANCELQTYTOSTOREFRONT⟧ 顧客站算不出「這件出完了沒」(拿不到已取消量)
⟦ship-HCTUNKNOWNREAD⟧        新竹回了而我們讀不懂 ⇒ 卡 unknown
⟦ship-UNKNOWNREASONLOST⟧     unknown 的原因永遠寫不進庫
```
🔴 **這一窗幾乎每一列都碰錢 ⇒ 每片 commit 前 codex 唯讀審。**

### 窗 C — 權限與資料庫(15)+ 信件(6)
worktree `~/pcm-mob`,branch `agent/mob`
```
權限與資料庫(先做第一列,疑似真的安全洞):
⟦tidy-NETPUBLICALL⟧        🔴🔴 anon 對 net 兩張表有 SELECT/INSERT/UPDATE/DELETE/TRUNCATE
⟦db-RLSHARDENZEROROWS⟧     RLS 收緊那天唯讀授權會安靜變零列,每道尺還是綠的
⟦b9-RLSHARDEN⟧             拿掉 BYPASSRLS 那天「客戶列表有、每人訂單數 0」
⟦b9-ACLDRIFT5⟧             路⑤ dashboard / SQL Editor 手動改權限完全沒人守
⟦db-ACLVALUEPROVENANCE⟧    沒有尺在問「線上這個權限值是不是那支 migration 給的」
⟦auth-GRANTGATEBLIND⟧      部署時序閘對純 GRANT 的 migration 是瞎的
⟦auth-HALFREVOKEDTRIGGERS⟧ 三支 trigger 的 REVOKE 只收了 PUBLIC,三個角色仍在
⟦f3-ADPNARROWER1⟧          被當成根治的 ALTER DEFAULT PRIVILEGES 射程比報的窄
⟦f3-SVCROLEUNVERIFIED1⟧    service_role 讀得到那兩張表只在 mock 驗過
⟦5b-AUDITGRANTEXPIRY⟧      稽核表 SELECT 權限的到期日不是日期是事件
⟦db-ORDERDELETENOTRACE⟧    訂單被直接 SQL 刪掉,系統沒有任何地方記下
⟦b9-UNTRACKEDGRANT⟧        版控外的角色 + 版控外的 GRANT,重放建不出來
⟦db-SAMETRIGGERNAME⟧       兩支未貼 migration 建同名 trigger 同表同事件
⟦b9-SRVMIN⟧                service_role 例外的範圍是不是最小
(無錨)                      storefront 5 道 service_role 例外,4 道說不出是誰批的

信件:
⟦mail-TXNMAILSPAM⟧         🔴🔴 交易信落客人的垃圾郵件匣 = 等於沒寄
⟦b4-MAILRENDER1⟧           付款成功信沒有一格是在真的信箱裡看過的
⟦f3-RECIPIENTBIND1⟧        寄件信箱與信件內容沒有「同一張單」的不變式
⟦mail-SKIPKEYNORETIRE⟧     skip 的列放回掃描面 ≠ 那封信排得進去(dedup_key 沒退休)
⟦mail-DEADMAILREQUEUE⟧     一支 migration 把「死信怎麼救」交給一個板上不存在的錨
⟦auth-MANUALORDERLIMITBURN⟧ 手動單「看過而沒有收件人」的列不留痕,永久佔住名額
```
🔴 **全部碰權限或寄信 ⇒ 每片 commit 前 codex 唯讀審。動 schema/GRANT/RLS ⇒ 先寫 plan 等 Sean 批,SQL 由主視窗代貼(Sean 2026-09-08 常設授權),前置閘紅就停。**

---

## 三窗現況(每次有窗回報就更新這一節)

| 窗 | session 名 | branch | 未推 | 做到哪 |
|---|---|---|---|---|
| A 前台 | `pcm-website-v2-2f` | `agent/shop` | 2 | 09-09 下午:搜尋線做完(首頁同步/標題排序/變體料號/車款簡稱/建議框/車款區)、購物車走查完。**待接上面 12 列** |
| B 後台 | `pcm-website-v2-ac` | `agent/ops` | 4 | 09-09 下午:出貨線走完、8 封信掃淨、出貨面板摺疊版、新竹 V15 對帳完。**手上:電話上限 15→20、送出前格式檢查。之後接上面 29 列** |
| C 權限信件 | (未開) | `agent/mob` | 0 | worktree 已建。**等 Sean 開窗** |

`origin/dev` = `069813e7e`(2026-09-09 下午推,12 顆)。`main` 未動,顧客站仍 coming-soon。

## 新竹物流:第一箱還缺兩格(都在 Sean 手上)
1. 去 Vercel 看 `HCT_API_ENDPOINT` 的值路徑裡**有沒有 `_test`** —— V15 PDF 第 5 頁:有 `_test` = 練習場,沒有 = 正式會真的出貨。
2. 正式站現在 **0 箱可送**(3 箱全作廢),要先建一張新箱。
已確認:`HCT_SUBMIT_ENABLED=true`(閘是開的)、`HCT_QUERY_ENABLED=true`(Sean 09-09 下午設)。
🔴 **送出去之後沒有 API 可以作廢** —— V15 七支服務沒有一支取消已上傳的託運單,只能打電話。`cancel-shipment-warning.ts:74` 那句「新竹攔得了」是過度宣稱,待改。
✅ `QueryEDELNO` 我們的實作對帳過是**對的**(方法名/參數/形狀全一致)。

## 欠著、要等正式站或上線前才驗得了的
1. anon 能不能**直接**讀 `product_variants_public`(沒人量過;沒開 ⇒ 變體料號回查安靜不生效,fail-soft)
2. 側欄 facet counts 的 fan-out 在正式站穩不穩(「件數暫時無法顯示」;鑽機必壞,那裡量到的都是假的)
3. 車款那一腿在 3,818 台 / 66 廠牌下的真實代價(只有鑽機 3 台車的 44ms)

## Sean 2026-09-09 下午拍過的板
```
· 推 dev(12 顆已推)· 缺貨商品維持不顯示(甲)· 購物車頁改「N 種商品 · 共 M 件」(甲)
· 出貨面板用摺疊版(乙)· 送新竹說明文字前半跟著出貨狀態走(甲)
· 新竹重量計價,固定申報 2kg(甲)· 送出前加格式檢查(甲)· 開 HCT_QUERY_ENABLED(甲)
· 搜尋建議的車款區重新打開(推翻 09-04「車款區不顯示」那板)
· 板子 102 列改由主視窗三分堆後分派三窗(丙)
```

## 做完就停
分到的列做完、或每一條都卡在別人手上 ⇒ 停,回報。**不去量東西、不寫規則、不加閘、不加腳本、不記事故、不整理板子、不改 `docs/launch-todo.md`。**
判別句:這件做完,客人的體驗或 Sean 的操作會不一樣嗎?不會 ⇒ 不做。
