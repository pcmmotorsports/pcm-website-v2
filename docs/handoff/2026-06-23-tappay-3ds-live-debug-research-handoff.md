# TapPay 3DS 實機卡關 + 官方文件研究 — 交接(2026-06-23)

> **給新視窗 session:** 這是一次**正式金流實機測試的卡關診斷 + 官方文件研究交接**。對話過長,Sean 開新視窗續。
> **一句話現況:** 我們的 code 正確地要求 3DS;但正式環境刷卡 3 筆全卡在「待付款 / Direct Pay / 沒跳 3D 頁」,反查 Record API 回 `915 系統錯誤`。**這是 TapPay 側商家/憑證設定問題,不是我們 code 的 bug。** Sean 要研究官方範例 + 文件確認我們的整合對不對。

---

## 0. 兩條線索別搞混

| 線 | 狀態 |
|---|---|
| **A. 乙路「放棄交易立即重刷」設計 plan** | **parked**、等 Sean 拍 Auth&Capture(Void vs 退款)。真權威 `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §14 + handoff `docs/handoff/2026-06-23-3ds-yi-immediate-recharge-codex-round2-handoff.md`。codex 4 輪 + gemini 已收斂、方向確認可行。**這條沒變、先擱著。** |
| **B. 正式環境實機測試卡關(本次)** | 🔴 **進行中、卡住**。Sean 要實測「客人關掉 3D 頁→網址能否重開完成 OTP」來決定設計要不要砍一半,但**連 3D 頁都跳不出來**。本交接主要講這條。 |

**為什麼 B 卡住會擋住一切:** 不先讓 3D 頁正常跳出來,Sean 就測不了那個關鍵問題,乙路設計也定不了稿。所以 B 是當前最高優先。

---

## 1. 本次實機測試發生什麼(時序)

1. Sean 改 env 把金流導向**正式環境**、建了 1 元測試商品實刷。
2. **第一輪:`status 10039`**(`此商家不支援此卡別`)— Sean 用非 AMEX 卡刷舊商家 `pcmmoto_NCCC_AE_Only`(AMEX only)。→ Sean 改 merchant id。
3. **第二輪(現在):改成 `tppf_pcmmoto_5803001`(PCM重機零件販售)** → 刷 3 筆 1 元:
   - TapPay 後台**有 3 筆紀錄**:`D20260623NIgiav` / `lzDDLM` / `BLQ6ws`,全部 **待付款**、付款方式 **Direct Pay**、是否開啟 3D 驗證 **是**、但**驗證方式空白 / 是否使用身份驗證 否 / 銀行驗證碼空白**、發卡行 中國信託(CTBC)。
   - **網頁:沒跳 3D 驗證頁、顯示「付款處理中」。**
   - **server log:** `[TapPayChargeAdapter] recordQuery { recTradeId: 'D20260623e8lbpG', status: 915, numberOfTransactions: 0 }`。

---

## 2. 診斷(已用 code + 官方文件雙向查證)

### 2.1 我們的 code 是對的(已親讀驗證)
- `packages/adapters/src/tappay/TapPayChargeAdapter.ts:155-209` `initiateThreeDSCharge` **有**送 `three_domain_secure: true` + `result_url: { frontend_redirect_url, backend_notify_url }` + `x-api-key: partner_key`。
- L196-201:**只有** `status === 0 && payment_url && rec_trade_id` 三者齊全才回 `pending_3ds`(帶 payment_url 給前端跳 3D 頁);**否則 throw** → use-case 映 `charge_unknown` → action 映 `{ payment: 'processing' }` →網頁「付款處理中」。
- 所以「沒跳 3D 頁」= **TapPay 沒回 status0+payment_url**(回了非 0、或回 0 但缺 payment_url)→ 我們 throw → 付款處理中。**符合預期防線、不是 bug。**
- `recordQuery`(同檔 L224-267)反查回 `status 915`;`packages/use-cases/src/settle-charge.ts:91-102` `isQuerySucceeded` 白名單只 `{0,2}` → 915 不在內 → `record_unverified` → `pending`(fail-closed HOLD,不誤標 paid 也不釋鎖)。→ 訂單卡死。**也是對的防線。**

### 2.2 官方文件親讀(verbatim、來自 Sean 本機抓的 `/Users/sean_1/Desktop/tappay_docs_zh_full_crawler`)
- `output/tappay_docs_zh_all.md:2001`:`three_domain_secure | Boolean | 是否開啟 3D 驗證，預設為 false。**此欄位僅應用於 Direct Pay**，支援銀行請參考 Direct Pay 支援銀行` → **後台顯示「Direct Pay」是正確的、就是我們的刷卡 pay-by-prime**,3DS 是它上面的開關,不是別的產品。
- `:1977 / :2186-2187`:官方**建議收到 frontend redirect 後打 Record API 反查**確認交易狀態(我們有做)。
- `:3205 / 3301 / 3390 / 3620`:`915 | 系統錯誤，請聯繫 TapPay`(= Sean 給的值,官方就這一句、**沒有任何觸發原因說明**)。
- 憑證不符在官方有**專屬錯誤碼**(由前一個 research agent 從官方 error 表抓):`11 無此 App ID / 12 App name 不符 / 16 App key 不符 / 61 無此商家 / 80 不合法的 x-api-key 或 app key / 81 找不到此 Partner / 84 Partner 未授權`。**乾淨的憑證不符通常報這些、不是 915。** 915 對一筆「後台真的存在」的交易反查失敗,比較像 TapPay 內部狀態不一致 → 官方訊息叫你直接聯繫他們。

### 2.3 最可能根因(兩個 lead,需 Sean/TapPay 確認)
1. **憑證不成套(最強 lead):** Sean 自述「只改了 merchant id」。但 TapPay 一套憑證 = `NEXT_PUBLIC_TAPPAY_APP_ID` + `NEXT_PUBLIC_TAPPAY_APP_KEY`(前端 SDK 拿 prime)+ `TAPPAY_PARTNER_KEY`(後端 x-api-key)+ `TAPPAY_MERCHANT_ID`,**四個必須是同一個 TapPay 帳戶/商家下的成套**。只換 merchant_id、app_id/partner_key 還是舊帳戶 → 三元組跨帳戶 → 反查 915 + 拿不到 payment_url。
2. **新商家的收單行不支援 3DS:** `tppf_` 前綴 = 不同收單。官方「Direct Pay 支援銀行」表分「一般授權」「3D 驗證」兩欄,有些收單行**只有一般授權沒有 3D**。若 `5803001` 背後收單不支援 3DS → 要 3DS 但跳不出挑戰頁。

> 兩者都指向同一動作:**確認 `tppf_pcmmoto_5803001` 的成套憑證 + 其收單行支援 3DS**,並拿 `rec_trade_id`(如 `D20260623NIgiav`)直接問 TapPay 客服 915 原因。

---

## 3. Sean 新給的研究資源(本交接重點之一)

### 3.1 官方完整文件本機抓檔
`/Users/sean_1/Desktop/tappay_docs_zh_full_crawler/output/`
- `tappay_docs_zh_all.md`(63,075 行,全部串一起)、`tappay_docs_complete.md`(71,697 行)。
- `pages/`:每個產品分頁(`*__zh__back.md` = 後端 API、`*__zh__error.md` = 錯誤碼、`*__zh__front.md/web__front.md` = 前端、`*__zh__reference.md` = 欄位規格)。我們要看的是**信用卡 Direct Pay** 那組(看 all.md 即可,下面有座標)。
- **座標(all.md 行號):** 3DS pay-by-prime + result_url 欄位 `~1975-2102` 與 `2436`;Record API(反查)整段 `2300` 起;請款/退款 `~2259/2388`;錯誤碼 915 `3205/3301/3390/3620`;getPrime card 物件 `749`。

### 3.2 官方範例 repo(已 clone 到 /tmp,**重開機會消失、要重 clone**)
- `https://github.com/TapPay/tappay-web-example` → `/tmp/tappay-web-example/`
  - 🟢 **`TapPay_Fields/`** = **跟我們一樣**的前端(TPDirect.card.setup 三個 iframe 欄位 number/expiry/ccv = 我們 `apps/storefront/src/hooks/useTapPayCard.tsx`)。
  - 🟢 **`Direct_Pay_iframe/`** = Direct Pay 刷卡(= 我們的交易類型)。
  - `Cardholder/` = 3DS 持卡人欄位範例。
  - 其餘(Line_Pay/JKO/Apple/Google/AFTEE…)= 別的支付方式、**跟我們無關**。
- `https://github.com/TapPay/tappay-agentic-commerce` → `/tmp/tappay-agentic-commerce/`
  - `SKILL.md` + `references/integrated-checklist.md` + `references/tappay-payment-iframe.md` + `references/playbook/`。
  - 這是給 **AI agent 驅動結帳**的整合指南/skill,**不是我們的標準 storefront 流程**;但 `integrated-checklist.md` 可當「整合是否漏東西」的檢查表參考。

### 3.3 哪個範例適合我們(Sean 的問題)
**`TapPay_Fields`(前端) + 後端 pay-by-prime 3DS(`three_domain_secure`+`result_url`+Record API 反查)就是我們現在的做法、而且我們已正確實作。** 不需要換整合方式。卡關是**設定/憑證/收單行**,不是整合架構。`tappay-agentic-commerce` 當參考檢查表即可,不必照搬。

---

## 4. 本次已產出/已知座標(給新 session 省事)

- **測試商品(MCP 已建,正式庫 `bmpnplmnldofgaohnaok`):** product `f619b122-dc3e-42e8-ba70-a144ec094abd` / variant `d5f8fbb2-bb68-4c88-bd51-e26a0e568d8d` / handle `test-1nt-payment` / sku `TEST-1NT` / price_general 1。**清理 SQL:** `DELETE FROM public.product_variants WHERE sku='TEST-1NT'; DELETE FROM public.products WHERE external_id='TEST-1NT-PAYMENT';`
- **卡住的孤兒單:** PCM-2026-0029~0033(及本次 3 筆 1 元待付款 attempt)。**清理需 Sean 明確授權**(classifier 擋未授權的正式金流紀錄 mutation,已踩過一次、不要繞)。
- **四個 TapPay env 變數名(已親讀 code 確認):** 後端 `TAPPAY_ENV` / `TAPPAY_PARTNER_KEY` / `TAPPAY_MERCHANT_ID`(`apps/storefront/src/lib/payment/composition.ts`);前端 `NEXT_PUBLIC_TAPPAY_APP_ID` / `NEXT_PUBLIC_TAPPAY_APP_KEY` / `NEXT_PUBLIC_TAPPAY_ENV`(`apps/storefront/src/hooks/useTapPayCard.tsx`)。

---

## 5. 新 session 下一步(建議順序)

1. **(Sean 動作)解 B 卡關 = 讓 3D 頁正常跳出來。** 確認 `tppf_pcmmoto_5803001` 的**四個憑證成套同帳戶** + 該收單行**支援 3D 驗證**(查官方 Direct Pay 支援銀行表);拿 `rec_trade_id` 問 TapPay 客服 915。Claude 不碰 .env、只能讀 code/文件協助判斷。
2. **(Sean 動作)3D 頁跳出來後**,做關鍵實測:**關掉 3D 頁 → 把網址貼回瀏覽器重開 → 能不能輸 OTP 完成?**
   - **不能重開** → 大幅簡化乙路(砍 released/A1/雙扣偵測)。
   - **能重開** → 保留乙路 + A1。
3. 依結果定稿乙路 plan → codex round3 PASS → MCP DB 交易模擬 → 實作 → 三綠+code-reviewer+codex K2 → commit(**不 push**)。

## 6. 守線(不變)
- Claude **不碰 `.env*`**(Sean 自己改)、**不 push / 不 db push**(Sean 終端)、**核心金流 code 未 codex round3 PASS 不動**。讀檔/診斷/查文件 OK。
- 金流狀態碼/enum **親讀官方逐字**、不信小模型萃取(915/10039 都已逐字核過)。
- **未 commit / 未 push**:本交接 + 乙路 plan/handoff 皆 untracked 設計檔。
