# Checklist — 正式站開真刷卡(1 元商品 + Sean 真信用卡)2026-07-24

> Sean 2026-07-24 拍板:**不走 sandbox,直接正式站開 1 元商品用自己的卡真刷**
> (memory `project_sean-real-payment-verify-via-1nt-product` 2026-07-24 段;
> 舊 sandbox 路線 `2026-07-24-m3-s3-sandbox-3ds-e2e-runbook.md` 已作廢)。
> 本檔 = **Sean 手動執行**的步驟表。Claude 不碰金鑰、不開 flag、不推 main、不部署。
> 所有欄位名與 URL 格式**皆自程式碼實查**(檔案:行號附註),非憑記憶。

---

## 🔴 步驟 0(最容易漏、漏了會出事):先把 `dev` 推上 `main`

**正式站 storefront 追 `main`**(memory `project_deploy-topology-main-stale-dev-live`)。
2026-07-24 實查:`origin/main` = `3bfee6b`、**落後本地 `dev` 11 個 commit**。

`main` 目前**缺**這三道正好是為真刷做的保護:

| 缺的 commit | 缺了會怎樣 |
|---|---|
| `b73e9cb` S1a 付款送出逾時出口 | 🔴 真刷時網路黑洞 → 付款遮罩**永久鎖死**、客人只能重整,而畫面又叫他別關(U5 遺留的 F5) |
| `43c0d6d` + `7289808` S1b 黑洞「查詢付款結果」 | 卡在 unknown 時**沒有自助反查按鈕**,只能找客服 |
| `a5d7619` S2 sweeper 搬 pg_cron | 背景兜底網的設定(另需 DB apply,見步驟 5) |

⇒ **真刷前必須先 `git push origin dev:main`**(fast-forward)。
⚠️ 這是 Sean 的手動動作;推之前確認 `dev` 三綠且你接受這批內容上正式站。

---

## 步驟 1:去 TapPay 拿正式商店資料

需要三樣(填進步驟 2):
- **Partner Key**(正式)
- **Merchant ID**(正式、**必須是會強制 3D 驗證那組**——prod 4 個 merchant 全強制 3D)
- 確認 TapPay 端是否需要**登記回呼網域**(見步驟 3 的說明)

## 步驟 2:在 Vercel「storefront 正式站專案」設環境變數

欄位名**逐字如下**(打錯會 fail-closed 擋下、不會扣款,但你會看到通用錯誤訊息):

| 變數名 | 值 | 硬性限制(程式實查) |
|---|---|---|
| `TAPPAY_ENV` | `production` | 只接 `sandbox` / `production`,其餘 throw(`composition.ts:76-79`) |
| `TAPPAY_PARTNER_KEY` | TapPay 正式 Partner Key | `composition.ts:81` |
| `TAPPAY_MERCHANT_ID` | TapPay 正式 Merchant ID | `composition.ts:82` |
| `TAPPAY_3DS_ENABLED` | `true` | 🔴 **只認字面 `true`**,空/其他一律當關(`three-ds-flag.ts:20`) |
| `TAPPAY_NOTIFY_PATH_SECRET` | 自己產一組亂碼 | 🔴 **≥32 字元、只能 `A-Z a-z 0-9 _ -`**(`notify-secret.ts:15-23`) |
| `NEXT_PUBLIC_SITE_URL` | 例 `https://shop.pcmmotorsports.com` | 🔴 **必須是乾淨 https origin**:不能有路徑/查詢字串/`#`、不能 http、不能帶帳密(`three-ds-urls.ts:35-57`)。多半已設(SEO 用),**但要確認格式合規**,否則 3DS 一律走不了 |

產 secret 的方法(你的終端機跑一次,把輸出貼進 Vercel):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 步驟 3:TapPay 要回呼的兩個網址

程式**每筆交易自動送**這兩個網址給 TapPay(`three-ds-urls.ts:85-86`),你不用手動組:

- 付款完導回客人:`<NEXT_PUBLIC_SITE_URL>/checkout/callback?order=<訂單id>`
- 後端通知(webhook):`<NEXT_PUBLIC_SITE_URL>/api/checkout/tappay-notify/<TAPPAY_NOTIFY_PATH_SECRET>`

⚠️ **誠實揭示**:因為是每筆交易隨請求送出,理論上不需要另外在 TapPay 後台登記;
但先前規劃(S4)寫過「TapPay 後台登記 notify URL」——**我無法從程式碼確認 TapPay 端是否另有網域白名單要求**。
→ 拿 merchant 時**順便問 TapPay 客服**:「backend_notify_url 隨交易帶,是否還需在後台登記網域?」
若需要,登記上面第二條(⚠️ 那串含 secret,登記等於把 secret 存在 TapPay 後台)。

## 步驟 4:開 1 元商品(並藏好)

- 正式站目錄是公開的,**沒有「只有我看得到」機制**。
- 建議:用不好猜的商品網址、不放進分類/搜尋曝光、**測完立刻下架**。

## 步驟 5(選配、背景兜底):S2 sweeper

要讓「客人跑掉但錢扣了」的單有背景自動收斂,需另外做 S2 的 DB 套用
(runbook 見 `docs/specs/2026-07-23-m3-s2-sweeper-pgcron-plan.md` §11:設 CRON_SECRET → 啟用 pg_cron+pg_net
→ SQL Editor 存 2 個 vault secret → db push → 驗連通)+ 開 `CRON_SWEEPER_ENABLED`。
**第一次真刷可以先不做**(你人就在現場、可以自己看結果),但正式營運前要補。

## 步驟 6:⚠️ 法律頁(#291)——待你決定

結帳頁「我同意服務條款」連結目前是**死的**,`/terms`、`/privacy` 不存在。
付款一開 + 1 元商品公開 → 萬一有真客人買到,他勾同意卻讀不到條款。
- **A**:先把條款掛上(草稿已備:`docs/specs/2026-07-23-pcm-legal-terms-privacy-draft.md`,你看過點頭我就做)
- **B**:先不管,只測自己的卡、商品藏好、測完下架,風險自負

## 🔴 步驟 6.5:刷之前的兩項硬檢查(沒過別刷)

> 來源:2026-07-24 3DS 鏈首刷前對抗審查(opus),總判 **NO-GO → 這兩項綠才降為 GO**。
> ⚠️ **F1 是本檢查表初版漏掉的**(初版只寫了 S2 sweeper、沒寫 3DS RPC 是否已 apply)。

**檢查 A:正式站 DB 是否已 apply 3DS 那批 RPC(缺了 → 每次結帳都卡死、零扣款)**
到 Supabase SQL Editor 跑:

```
select proname from pg_proc where proname in
 ('find_active_sibling_own','mark_charge_attempt_released_for_user',
  'record_charge_bank_txn','record_charge_pending_rec','get_active_charge_attempt',
  'record_webhook_event','begin_charge_attempt','mark_charge_attempt_charged') order by 1;
```

**要回 8 支,少任何一支就別刷**(先補 db push)。
缺了的症狀:每次按付款都回「訂單付款狀態確認中,請勿重複付款」、**畫面不會告訴你原因**(錯誤被吞成通用字面),零建單零扣款。

**檢查 B:`NEXT_PUBLIC_SITE_URL` 是否逐字等於客人瀏覽的那個網域(🔴 唯一「看起來正常但其實會掉錢」的設定)**
程式只驗**格式**(https、無路徑/查詢),**不驗它是不是這台站**(`three-ds-urls.ts:35-57`)。
若正式站跑在 `shop.pcmmotorsports.com` 但這個變數填成 `www.pcmmotorsports.com`(或反過來):
格式檢查全過 → 3D 正常跳轉 → **客人 OTP 完成、錢真的扣掉** → TapPay 把人導到錯的網域(404)、
webhook 也打到錯的網域 → **我方訂單永遠不會變成已付款,而且沒有任何兜底會救它**。

用瀏覽器開這個網址(把 `<...>` 換成你設的值):
`<NEXT_PUBLIC_SITE_URL>/checkout/callback?order=00000000-0000-0000-0000-000000000000`
**必須看到「處理中」之類的頁面,不能是 404、網址列不能跳去別的網域。**

## 步驟 7:真刷測試(照這個順序)

1. **正常付款**:加購 1 元商品 → 結帳 → 填卡 → 應跳 3D 驗證 → 完成 → **顯示訂單編號**。
   ☐ 後台看訂單 `payment_status=paid`、只有一筆(沒雙扣)。
2. **黑洞測試**(重要):走到 3D 驗證頁時**直接關掉分頁** → 回結帳 → 按「查詢付款結果」
   → 應正確回報(未完成就說未完成,**絕不會假報成功**)。
3. **逾時出口**:若途中卡住 >90 秒,應自動跳出「付款狀態未知」畫面而不是永久轉圈。
   ☐ 順便記下真實 3D 流程要多久 → 之後把 90 秒這個暫定值改成合適的定值。
4. **退款**:目前**手動**——去 TapPay 後台退,再手動改訂單狀態。
   (自動退款正在規劃:`docs/specs/2026-07-24-refund-automation-line-prd.md`)

⚠️ **測黑洞時不要把 3D 驗證頁留在另一個分頁「等一下再完成」**——那是**設計上允許雙扣的窗**
(舊單被 release 後放行建新單,舊分頁稍後完成 OTP → 兩筆都扣;系統會記錄但不阻止,
而告警 cron 現在沒開 = 沒人通知你)。要測黑洞就**直接關掉那個分頁**。

## 步驟 7.5:刷的時候開三個視窗盯

① Vercel → storefront 專案 → Logs(即時) ② TapPay 後台交易紀錄 ③ Supabase SQL Editor。
按下付款後照順序看:

- Log 有沒有 `initiateThreeDSCharge { status: 0 }` → **沒有 = 根本沒送出去**(回頭看檢查 A / flag)。
- 有沒有跳到 3D 驗證頁 → **沒跳 = payment_url 被擋**(多半是檢查 B 沒過)。
- OTP 完成後有沒有 `recordQuery { status: …, numberOfTransactions: 1 }`
  → 🔴 **有這行、但訂單還是「處理中」= 最可能第一次就中的那個 bug**
  (成交判定閘從沒跑過真實 TapPay 回應;`settle-charge.ts:217` 硬要求 `currency==='TWD'`,
  但回應的 currency 是選填 → 若真回應沒帶,會永遠停 pending)。
  **把那行完整輸出留下來給 Claude,照真回應改閘即可。錢在、可退、不會誤報成功。**

## 步驟 8:出事怎麼辦(三種處置)

1. **畫面「處理中」但 TapPay 顯示已授權**(錢在、單沒成立):
   用**同一個帳號**在瀏覽器開 `<站台>/api/orders/<訂單UUID>/payment-status`
   → 它會主動再跑一次結算。還是不行 = 上面那個 bug,要改 code。
2. **要立刻止血**:把 `TAPPAY_3DS_ENABLED` 改成非 `true` → 重新部署 → 付款路徑即關;1 元商品下架。
   已扣的款走 TapPay 後台退。
3. **懷疑雙扣**:查 `payment_double_charge_anomalies` 有沒有 open 的列(系統自己記的雙扣證據)。
   🔴 **告警 cron 沒開 → 不會有人通知你,只能自己查。**

## ⚠️ 首刷期間「背景兜底是關的」(誠實揭示)

S2 的 sweeper 與雙扣告警**都還沒 apply 到 DB**,`vercel.json` 也已無 crons
→ 現存唯一自動兜底 = **TapPay webhook 重送**(官方 1/2/4/8/16 分、最多 5 次)。
且 webhook 是「收件匣落地就回 200、結算丟背景 best-effort」——背景那段失敗的話 TapPay 不會再送、
**目前沒有任何東西會重跑它**。首刷你人在現場可接受,但**正式營運前要把 S2 補上**。

---

## 🔴 先講清楚的三件事

1. **第一次真刷 = 有史以來第一次 3D 全鏈實測**(跳過 sandbox 的代價)。可能第一次就卡住 → Claude 抓 bug 修完你再刷。
2. **90 秒逾時是暫定值**,原訂在 sandbox 定案、現改由你這次真刷實測後定。
3. **退款目前是手動的**,自動退款是一條多片的線(要動資料庫、要你 db push),還沒做。
