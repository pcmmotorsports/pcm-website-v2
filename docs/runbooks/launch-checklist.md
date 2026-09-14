# runbook · 上線前 checklist(M-6-08)

> 2026-09-14 設計窗建。來源 = `docs/plans/2026-09-14-m6-launch-checklist-plan.md` 的「部署環境」那格 + `docs/PHASE-1-MILESTONES.md:730`(M-6-08 原文四項)。
> **怎麼讀**:每一項有 ① 怎麼驗(可複製的命令或動作)② 誰驗 ③ 現值(落筆當下的量測,附出處)。
> 🔴 **「現值」只寫親測到的東西。** 我(設計窗)看不到 Vercel 主控台 ⇒ 那些格一律寫「未量(要主視窗 / Sean 開面板)」,**不寫「應該有」**。
> 🛑 **本檔不印任何 env 的【值】**,只印**名稱**與**形狀**(長度 / 允許字面)。`cat .env*` 不在對話裡跑。

---

## A. Vercel env vars(M-6-06)

兩個 Vercel 專案:**storefront**(顧客站 `www.pcmmotorsports.com`,分支 `main`)與 **admin**(後台,分支 `dev`)。

### 怎麼驗

主視窗 / Sean 在各專案根目錄跑(**只會印名稱與所在環境,不印值**):

```bash
vercel env ls production
```

把印出來的名字跟下面兩張表對。**表上有、`vercel env ls` 沒有 ⇒ 那一格打叉。**

### A-1 storefront 專案

名單產法(2026-09-14):`grep -rhoE "process\.env\.[A-Z0-9_]+" apps/storefront/src` 併 `requireEnv('…')` 的字面,去重。

| env 名稱 | 必填? | 沒設會怎樣 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | **必填** | canonical / sitemap / OG / JSON-LD **全部休眠**(`lib/site-url.ts` 檔頭:prod 未設一律不吐,寧缺勿錯)⇒ 站在線上而 Google 看不到地圖 |
| `NEXT_PUBLIC_SUPABASE_URL` | **必填** | 整站讀不到資料 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **必填** | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | **必填** | 下單 / 寄信 / cron 全掛(`packages/adapters/src/supabase/client.ts:63`) |
| `TAPPAY_ENV` | **必填** | 刷卡整條路 throw(見 §C) |
| `TAPPAY_PARTNER_KEY` | **必填** | 同上 |
| `TAPPAY_MERCHANT_ID` | **必填** | 同上 |
| `NEXT_PUBLIC_TAPPAY_APP_ID` | **必填** | 卡欄不出現(client SDK 起不來) |
| `NEXT_PUBLIC_TAPPAY_APP_KEY` | **必填** | 同上 |
| `NEXT_PUBLIC_TAPPAY_ENV` | **必填** | 缺值 / 非法值 ⇒ **fail-safe 退 `sandbox`**(`hooks/useTapPayCard.tsx:83`)⇒ 🔴 **正式站刷卡會安靜地打到 sandbox,畫面完全正常** |
| `RESEND_API_KEY` | **必填** | 一封信都寄不出去 |
| `ORDER_EMAIL_FROM` | **必填** | 同上 |
| `ALERT_EMAIL_FROM` / `ALERT_EMAIL_TO` | 必填(告警路) | 異常告警信寄不出 |
| `CRON_SECRET` | **必填** | cron 路由沒有守門 |
| `PAYMENT_CONFIRMER_DB_URL` | 必填(對帳路) | 付款確認器跑不動 |
| `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` / `LINE_REDIRECT_URI` / `LINE_WEBHOOK_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ALERT_TO` | LINE 那條線要 | LINE 綁定 / 推播不動 |
| `HEALTHCHECKS_PING_URL_PCM_EMAIL_SWEEP` / `_SETTLE_SWEEP` / `_CAPTURE_RECHECK` / `_ANOMALY_ALERT` / `_ORDER_INELIGIBLE_GATE` | 建議 | cron 沒跑不會有人知道 |
| 開關類(**沒設 = 關,fail-closed**):`BANK_TRANSFER_CHECKOUT_ENABLED` `CHECKOUT_NOTIFICATION_EMAIL_ENABLED` `CRON_SWEEPER_ENABLED` `ANOMALY_ALERT_ENABLED` `TAPPAY_3DS_ENABLED` `LINE_PUSH_ENABLED` `BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED` | 看要開哪些 | 功能靜悄悄不動作 |
| 時間閘類:`B4_DEPLOY_CUTOFF` `BANK_ORDER_CREATED_EMAIL_CUTOFF` `CANCELLED_EMAIL_CUTOFF` `SHIPPED_EMAIL_CUTOFF` `PARTIAL_REFUND_EMAIL_CUTOFF` `CAPTURE_RECHECK_CUTOFF_DAYS` | 看那批信要不要補寄 | 舊單會被當成新單重寄 / 或該寄的不寄 |
| `TAPPAY_NOTIFY_PATH_SECRET` | 3DS 要 | TapPay 回呼打不進來 |
| ⛔ **正式站不該有**:`PCM_DEV_TIER_OVERRIDE` `PCM_ALLOW_PROD_DB_DEV` `FLAKE_HARNESS` `FLAKE_N` `PCM_PIXEL_MEASURE` `PCM_TAXSHOT_DIR` `PCM_E2E_BASE_URL` `PCM_E2E_SHARE_TOKEN` | — | 這幾支是開發 / 測試用的旁路,**在 production 出現就要拔** |

- [ ] A-1 全對完
- **誰驗**:主視窗跑 `vercel env ls production`,Sean 看一眼。
- **現值**:未量(我看不到面板)。🔵 **間接證據**:`NEXT_PUBLIC_SITE_URL` **一定有設** —— 2026-09-14 curl www 站,canonical / sitemap / OG 都吐絕對網址,沒設會全部休眠成空。其餘每一支都沒有間接證據,**一支一支對**。

### A-2 admin 專案

| env 名稱 | 必填? | 沒設會怎樣 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **必填** | 後台讀不到資料;而且它同時是 §C 那道 TapPay 配對閘的判準 |
| `SUPABASE_SERVICE_ROLE_KEY` | **必填** | 後台整個掛 |
| `ADMIN_SESSION_SECRET` | **必填** | 登入 session 簽不出來 |
| `PCM_QUOTE_SSO_BASE` / `PCM_SSO_EXCHANGE_SECRET` | **必填** | 從報價站登入進後台那條路斷掉 |
| `TAPPAY_ENV` / `TAPPAY_PARTNER_KEY` / `TAPPAY_MERCHANT_ID` | **必填**(退款要) | 退款按不動 |
| `HCT_API_ENDPOINT` / `HCT_API_ACCOUNT` / `HCT_API_PASSWORD` / `HCT_DISPATCH_EMARK` | 新竹物流要 | 出貨打不出單 |
| 開關類(沒設 = 關):`HCT_SUBMIT_ENABLED` `HCT_QUERY_ENABLED` `HCT_DISPATCH_ENABLED` `REFUND_UI_ENABLED` `REFUND_BACKFILL_UI_ENABLED` `AUDIT_UI_ENABLED` `ADMIN_CUSTOMER_GENDER_FILTER` | 看要開哪些 | 那些頁 / 鈕不出現 |
| ⛔ 正式站不該有:`ADMIN_DEV_BYPASS` | — | ⚠️ **它在 production 本來就無效** —— 碼裡兩處都先看 `NODE_ENV !== 'production'`(`apps/admin/src/app/api/session/renew/route.ts:79`、`proxy.ts:17` 逐字「prod 永遠擋、bypass 無效」)。⇒ 📌 **它不是一個免登入後門,而是一個不該出現在 production 的開發旗標** —— 有就拔,但**不要因為它在就宣告後台被打開了** |
| ⛔ 正式站不該有:`ADMIN_SHOT` `PCM_ALLOW_PROD_DB_DEV` `PCM_PIXEL_MEASURE` `PCM_TAXSHOT_DIR` | — | 開發旁路 |
| `ADMIN_REQUIRE_REAL_IDENTITY` | 應為開 | 關著時稽核的「操作者」是使用者自己選的。🔵 `apps/admin/src/app/settings/audit/page.tsx:151` 記著 2026-08-25(B5-a)起已經是 `=1` ⇒ **對一下它還在不在**,不是從頭設 |

- [ ] A-2 全對完
- [ ] `ADMIN_DEV_BYPASS` 在 production 不存在(有就拔;而它在 production 本來就無效,見上表)

### A-3 🔵 2026-09-14 實核之後補的三支(admin production 上有、而 A-2 表上沒有)

主視窗 2026-09-14 跑 `vercel env ls production` 對完 A-1 / A-2,兩邊「缺的」都只有本檔標「不該有」的開發旗標,**加兩顆開關**(storefront `BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED`、admin `REFUND_BACKFILL_UI_ENABLED`,要不要開端 Sean)。而 admin 上**多出三支**,逐支查過還有沒有人讀:

| env 名稱 | 還有人讀嗎 | 判定 |
|---|---|---|
| `ADMIN_E10_ORDER_NUMBER_SEARCH` | **零程式讀取** —— `grep -rn … apps packages --include="*.ts*"` 去掉註解後 0 命中;`apps/admin/src/app/orders/page.tsx:175` 逐字寫著它「連同搜尋欄一起退場」(#347-B,能力併進 `admin_search_orders` 的關鍵字分支) | ✅ **可刪** |
| `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH` | 同上,同一行退場 | ✅ **可刪** |
| `SHIPPED_EMAIL_CUTOFF` | ⚠️ **在 admin 沒人讀**(`grep -rn … apps/admin/src` ⇒ 0),**但它在 storefront 是活的**:`apps/storefront/src/app/api/cron/email-sweep/route.ts:669` 與 `api/cron/anomaly-alert/route.ts:306` 都讀 | ⚠️ **只刪 admin 那一份**。🔴 **千萬不要連 storefront 那份一起拔** —— 拔掉那支,email-sweep 會走 `skipped_no_cutoff`,**整段出貨信 enqueue 不跑**,而 cron 照樣回成功 |

- [ ] admin production 刪 `ADMIN_E10_ORDER_NUMBER_SEARCH`
- [ ] admin production 刪 `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH`
- [ ] admin production 刪 `SHIPPED_EMAIL_CUTOFF`(🔴 **storefront 那一份留著**)
- [ ] `BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED`(storefront)要不要開 —— 端 Sean
- [ ] `REFUND_BACKFILL_UI_ENABLED`(admin)要不要開 —— 端 Sean

⚠️ **誠實邊界**:上面「零程式讀取」是對**這個 repo** 掃的。如果有人在 Vercel 的 build command、cron 設定或別的 repo 裡讀它,我掃不到。刪之前主視窗順手看一眼那兩處。
- **誰驗**:主視窗 + Sean。
- **現值**:未量。

---

## B. Production build 綠(M-6-06)

- **怎麼驗**:Vercel 兩個專案各看最新一次 production deployment 是 Ready、不是 Error。
- **誰驗**:主視窗。
- **現值**:🟢 storefront **是綠的** —— 2026-09-14 curl `https://www.pcmmotorsports.com` 的 `/` `/products` `/brands` `/products/dbk-gr06` `/brands/akrapovic` `/stores` `/info/shipping` `/search` `/privacy` `/terms` `/install` `/robots.txt` `/sitemap.xml` **全部 200**,apex 308 轉 www。admin **未量**(後台入口在 quote 站,curl 一律 429,見 memory `reference_admin-cannot-be-verified-by-curl`)。
- [ ] storefront production deployment = Ready
- [ ] admin production deployment = Ready

---

## C. 🔴 TapPay 現在是 sandbox 還是 production

**這是上線當天最容易錯、而且錯了不會叫的一格。**

### C-1 判法(不印值)

| 專案 | env 名 | 允許的字面 | 形狀 |
|---|---|---|---|
| storefront + admin(server 端) | `TAPPAY_ENV` | 只接 `sandbox` 或 `production`,**其他一律 throw** | 純小寫英文字,7 或 10 個字元 |
| storefront(client) | `NEXT_PUBLIC_TAPPAY_ENV` | `production` 才是正式;**其他任何值(含缺值、拼錯)都退 `sandbox`** | 同上 |
| storefront(client) | `NEXT_PUBLIC_TAPPAY_APP_ID` | 正整數 | sandbox 那組是 6 位數字(2026-09-14 storefront-probe 印的長度) |
| storefront(client) | `NEXT_PUBLIC_TAPPAY_APP_KEY` | — | 64 字元(同上) |
| 兩邊 | `TAPPAY_PARTNER_KEY` / `TAPPAY_MERCHANT_ID` | — | **形狀看不出 sandbox / production**(TapPay 的 partner key 沒有環境標記) |

**真正的檢查(兩步,缺一不可):**

1. `vercel env ls production` 看 `TAPPAY_ENV` 與 `NEXT_PUBLIC_TAPPAY_ENV` **兩支都在**;
2. Sean 到 Vercel 面板把這兩支的值**目視**確認是 `production`(值不要貼進對話)。

🔴 **為什麼第 2 步不能省**:`TAPPAY_ENV` 設錯會當場 throw(看得見);但 `NEXT_PUBLIC_TAPPAY_ENV` 設錯 / 漏設是**靜默退 sandbox**(`apps/storefront/src/hooks/useTapPayCard.tsx:83` 逐字 `rawEnv === 'production' ? 'production' : 'sandbox'`)⇒ **客人刷得過、畫面跟平常一模一樣,而錢沒有真的進來。**

### C-2 程式自帶的一道閘(它擋什麼、擋不到什麼)

`apps/admin/src/lib/payment/composition.ts:71` 的 `tapPayEnvPairingViolation()`:**TapPay 環境**必須與**帳本 DB** 同一側,不成立就拒絕建立退款 adapter。判準是寫死的正式站 host(`PROD_SUPABASE_HOST`,`:48`)——刻意不做成 env,因為「把判準交給 env,設錯 env 的那一刻判準也一起錯」。

🔴 **它擋不到的(該檔自己寫的誠實邊界,照抄)**:
- 同一側**但金鑰是別的商戶** —— partner key 沒有環境形狀標記,機械判不出來;
- 非正式站的 Supabase 專案裡裝的是**正式資料複本** ⇒ 會被當 sandbox 側放行;
- 日後正式站改用**自訂網域**連 Supabase ⇒ 判定整個反過來(誤擋會當場炸,**誤放不會**)。

⇒ 📌 **所以 C-1 第 2 步那個人眼確認是必要的,不能靠這道閘。**

- [ ] `TAPPAY_ENV` = production(Sean 目視)
- [ ] `NEXT_PUBLIC_TAPPAY_ENV` = production(Sean 目視)
- [ ] `TAPPAY_PARTNER_KEY` / `TAPPAY_MERCHANT_ID` 是**正式商戶**那一組(Sean 對 TapPay 後台)
- [ ] 上線後**第一筆真刷**:Sean 自己刷一筆小額,到 TapPay 正式後台看得到那筆,再退掉

---

## D. M-6-07 Railway —— 🛑 作廢,不是待辦

- **怎麼驗**:`ls railway.json railway.toml nixpacks.toml Dockerfile` + `ls apps/`。
- **現值**(2026-09-14 實跑):repo **零個** Railway 設定檔;`apps/` = `admin` / `api` / `storefront` / `sync-engine`,**Medusa 早已不在**;而 `CLAUDE.md` 逐字「`dev` = 後台 admin 的 production」⇒ **後台也在 Vercel。**
- ⇒ 📌 這一片的前提(後台跑在 Railway 上的 Medusa)已經不存在。**標作廢,不要排工。**
- [x] 已判定作廢(2026-09-14 設計窗量,理由同步寫進 plan §M-6-07)

---

## E. M-6-08 原文那四項

| 項 | 怎麼驗 | 誰驗 | 現值 |
|---|---|---|---|
| lessons-learned 規範 | 讀 `docs/` 有沒有那份、有沒有人在用 | 主視窗 | **未量** |
| 連續一週 lint / typecheck / build 三綠 | 看 CI 一週的紀錄 | 主視窗 | **未量**(repo 裡沒有這個紀錄)。🔵 單點證據:2026-09-14 設計窗在 `agent/design-1` 跑 `TURBO_FORCE=1 pnpm typecheck / lint / build` **三綠**,storefront 全套 343 檔 5,704 綠 0 紅 —— 那是**一天**,不是一週 |
| Supabase Pro 升級驗證 | Supabase 面板看方案 | Sean | **未量**(不在 repo 裡) |
| search 切 tsvector + pg_jieba | 看顧客站商品搜尋走哪條 | 主視窗 | **未量**。⚠️ 陷阱:`supabase/migrations/20260809180000_m4b_347_1_admin_search_orders.sql` **有** tsvector,但那是**後台訂單搜尋**,不是顧客站商品搜尋 —— 拿它當證據會判錯 |

- [ ] 四項各有結論(不是各有猜測)

---

## F. 排上線工序前先讀這一條

`docs/launch-todo.md` 有一條 **open** 的 ⟦f3-TWELVEUNPROVABLE1⟧,逐字:「端給 Sean 的那個『12 件擋上線』機械上不可複現 —— 而它最可能被拿去排上線工序」。

⇒ 🛑 **排工序時不要拿那份「12 件」當清單。** 要一份可信的擋上線清單,現在只有 `docs/launch-todo.md` 的態欄本身。
