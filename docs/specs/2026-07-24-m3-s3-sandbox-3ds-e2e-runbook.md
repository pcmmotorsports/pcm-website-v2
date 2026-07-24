# Runbook — M-3 S3「sandbox 3DS 全鏈實測」(2026-07-24 草稿)

> # 🔴🔴 已作廢 —— Sean 2026-07-24 拍板「不走 sandbox、直接正式站真刷」
>
> Sean 過夜批次 **Q2/Q3 = 來真的**:放棄 sandbox/staging 3DS 測試,改為
> **正式站開 1 元商品 + 他自己的真信用卡直接刷**驗收(拍板見 memory
> `project_sean-real-payment-verify-via-1nt-product` 2026-07-24 段)。
> ⇒ **本檔的 §1 兩個前置(staging 部署管道、3DS sandbox merchant)與 §3 sandbox 腳本全部不執行。**
> 仍有價值、已移轉到真刷路徑的部分:§3 的**測試情境清單**(3DS happy-path / 三條黑洞兜底 /
> S1a 逾時出口)與 **§3-C 的 90s SUBMIT_TIMEOUT 定案方法**——這些改在**真刷**時驗。
> 真刷 go-live 步驟改見 `docs/specs/2026-07-24-m3-go-live-real-charge-checklist.md`。
> 本檔僅留作歷史追溯,**不得據此規劃或執行**。

> ⚠️ **Claude 過夜自主起草的測試程序草稿。S3 主體=Sean 手動在 staging 操作(非寫 code)。**
> 上位真權威=`docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md`(S3 段 §「S3」)。
> S1a/S1b/S2 code 已收工;S3 只**驗**、不改 code(除非跑出 bug 需修 → 那才回頭 code)。
> **本片全綠才准進 S4(換正式金鑰+開 prod flag)。**

## 0. 為什麼 S3 存在

prod 4 個 merchant **全強制 3D**(`three-ds-flag.ts:12-14`),不能拿 prod 當首測。
現況 STATUS Blocker 明列「真刷卡待 sandbox 3DS E2E」。S3 = 在能強制 3D 的 sandbox 環境,
把「加購 → getPrime → charge → 3DS OTP 跳轉 → callback → settle → paid」整鏈 + 三條黑洞兜底 + 逾時出口
真的跑一遍,證明正式化前的引擎(S1/S1b/S2)在真 3DS 下不破。

## 1. 🔴 Sean 須先拍/先查(卡開工)

- **S3-Q1(待查+可能待拍)staging 部署管道**:S3 要一個「sandbox env + 3DS-capable merchant」的部署。
  選項:①Vercel preview branch(推?env 從哪灌—Vercel preview env 還是 branch-specific?)②專用 staging 專案。
  🔴 recon 未能確定既有 staging 部署方式 → **Sean 確認 staging 如何部署 + env 來源**(這不是本地 LAN,Sean 已明示本地測結帳沒意義)。
- **S3-Q2(待拍)3DS-capable sandbox merchant**:dev 現用「免 3D 測試 merchant」(上位 plan `:38`)。
  S3 需換一組**能強制 3D 的 sandbox merchant key**(與 S4 換正式 merchant 同類、不同組)。
  🔴 **Sean 去 TapPay 後台取得 sandbox 3DS merchant 的 APP_ID / APP_KEY / partner_key + 登記 notify URL**。
- 上述兩項就緒後,Sean 在該 staging 設 `TAPPAY_3DS_ENABLED=true`(**僅 sandbox 範圍**;prod flag 仍 false、S4 才碰)。

## 2. 全鏈涉及檔(跑出 bug 時對照)

`useChargePayment.tsx`(submit/withSubmitTimeout/getPrime)→ `charge-actions.ts:187,261`
(`isThreeDSEnabled()?resolveThreeDSConfig():null` → initiatePayment/redirect)→
`app/checkout/callback/page.tsx`(3DS 導回、IDOR 歸屬閘 + settleCharge cookieless)→
`app/api/checkout/tappay-notify/[secret]/route.ts`(backend webhook 快路徑)→
`packages/use-cases/src/settle-charge.ts:45`(settleCharge 唯一成交權威)。
黑洞自助:`useReconcilePayment.tsx`(S1b 反查)+ sweeper(S2 已建、flag 留 S4——S3 若要驗 sweeper 兜底,須在 staging 一併開 `CRON_SWEEPER_ENABLED`)。

## 3. 測試腳本(Sean 逐條跑、逐條記綠/紅)

### A. 3DS happy-path(必過)
1. staging 登入 → 加購 1 件 → 進結帳 → 填卡(TapPay 測試卡 `4242 4242 4242 4242`、任意未來到期日、任意 CVV)。
2. 按確認付款 → 應**跳出 U5 付款中遮罩** → 導向 TapPay 3DS OTP 頁 → 輸入 sandbox OTP。
3. 導回 `/checkout/callback` → settleCharge → **成交終態 paid + 顯示訂單編號**。
   ☐ 驗:orders.payment_status=paid、charge_attempts 有成功紀錄、無雙扣(同 cart_session_id 只一筆成交)。

### B. 黑洞兜底(至少一條必過)
4. **B1 中途離開**:走到 3DS OTP 頁後直接關分頁/不完成 → 回結帳,按 S1b「查詢付款結果」→ 應正確回 pending/failed(**絕不誤報 paid**)。
5. **B2 webhook 收斂**:完成 3DS 但前端 callback 沒回(可模擬:callback 前關頁)→ backend notify webhook 應收斂該單。
6. **B3 sweeper 兜底**(若 staging 開 `CRON_SWEEPER_ENABLED`):留一筆 initiated 未結單 → sweeper 分鐘級掃到 → 收斂。

### C. S1a 逾時出口 + F5(必過)
7. 模擬 charge 送出後 >90s 無回應(可用網路節流/中斷)→ 應觸發 `withSubmitTimeout` → 落 `unknown` 終態
   → 遮罩掀開給出口、清車、保留 cart_session_id、不誤報成交。
   ☐ 這條同時**定案 90s**:記錄真實 3DS charge/redirect 延遲分佈 + 查 Vercel effective maxDuration
   → 兩者對照後把 `useChargePayment.tsx:99 SUBMIT_TIMEOUT_MS` 從 provisional 90s 改定值(**此步是 code 改動、Claude 可代做、須 Sean 給實測數據**)。

## 4. 驗收(全綠才進 S4)

- ☐ A 3DS happy-path 綠(paid、無雙扣)。
- ☐ B 至少一條黑洞→兜底綠(pending/failed 正確、絕不誤報 paid)。
- ☐ C S1a 逾時出口綠 + 90s 定案值寫回程式。
- ☐ 全程零真金(sandbox);跑出的任何 bug 先修再重跑。

## 5. 卡 Sean 手動之處(彙整)

①staging 部署(S3-Q1)②3DS sandbox merchant + notify URL 登記(S3-Q2)③staging 設 flag ④實際跑卡+OTP+觀察。
Claude 可代做:跑出 bug 的修復、90s 定案值寫回程式、把本 runbook 補成 Sean 執行後的結果紀錄。

## 6. 未解/待查

- staging 部署管道(S3-Q1)= recon 未能確定,須 Sean 或下次 session 查 Vercel 專案設定後補進本檔。
- 3DS sandbox OTP 的實際輸入方式(TapPay sandbox 測試環境的 OTP 是固定值還是任意)= 依 TapPay sandbox 文件,Sean 取 merchant 時一併確認。
