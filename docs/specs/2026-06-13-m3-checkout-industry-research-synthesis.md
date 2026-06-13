# M-3 結帳 — 業界紮根研究 synthesis(2026-06-13)

> 三個並行研究 workflow 合一:**全球金流**(Stripe/Shopify/Adyen)+ **台灣金流**(TapPay/綠界/藍新 + 蝦皮/PChome/meepshop)
> + **PCM 全面稽核**(讀實際程式碼、84 findings、對抗驗證)。目的:把 3DS 重設計的決策從「憑印象」改成「業界紮根」。
> 觸發:Sean「你這些決策有先去收集 shopify/amazon… 台灣 meepshop/蝦皮/pchome… 整個購物車邏輯/安全/防呆/漏洞都要一次看」。
>
> **研究覆蓋誠實標**:全球 WF1 7 維度有 6 個被暫時性 server 限流打掛(三 workflow 併發過載、非用量上限),
> 僅 webhook 維度存活;但台灣 WF2(5/5 完整、TapPay 官方逐字)+ 稽核 WF3(6/6 完整、84 findings)已覆蓋實質,
> 且與 WF1 webhook 維在核心點**收斂一致**。唯一薄弱處 = 全球庫存 reservation 模式(決策 6,Sean 已拍 Phase 1 不做)。

---

## Part A — 我的 6 決策,業界判定(全球 × 台灣交叉)

| # | 決策 | 判定 | 依據(來源)+ 修正 |
|---|---|---|---|
| 1 | 3DS 兩路(callback + webhook) | 🟡 **partial → 修措辭** | TapPay back.html/advanced.html 逐字定義此架構,綠界/藍新同構。但**兩路權重不同**:webhook=成交權威、callback **僅觸發查證**;redirect「可被偽造」(TapPay 官方逐字)。決策 1 措辭從「兩路回結果」改為「**webhook 定成交、callback 觸發查證渲染**」。 |
| 2 | webhook 升主路徑 + Record API 查證 | ✅ **confirms(最強)** | TapPay 逐字:「前端跳轉資料可能被偽造,建議實做後端通知,若後端通知失敗請使用 Record API 反查詢」。綠界「以 ReturnURL 為主」、藍新「NotifyURL 才是交易成立可靠依據」。Stripe/Shopify/Adyen 同。**status=0 為唯一權威**。 |
| 3 | idempotency = cart_session_id | 🟡 **partial → 修鍵語意(重要)** | 🔴 TapPay `order_number` 官方**「允許重複」、不做冪等** → 別當綠界 MerchantTradeNo 全域唯一硬鎖。三鍵分工:**`rec_trade_id`=結算主鍵(DB UNIQUE,PCM 已有 `rec_unique_idx` ✓)**、`order_number`=自家可讀單號(可重試對單)、`bank_transaction_id`=每次嘗試唯一(否則 error 421 無法向銀行查單)。`cart_session_id` **降為前段防雙擊/跨分頁**,非結算層主鎖。全球 WF1 亦獨立指「最終去重用 provider 穩定 id」=收斂。 |
| 4 | 六態拆「啟動 + 結算」 | ✅ **confirms** | TapPay status:0 成功 / **4 PENDING 待付款** / 5 CANCEL / -1 ERROR;3D 可停 pending、TapPay 10-20 分鐘反查。SHOPLINE temp→pending→completed。補:結算 handler 對**亂序 + 重送免疫**(webhook 不保證晚於 begin 到達)、狀態從事件自身資料推導。 |
| 5 | 完成頁 callback 查證後渲染 | ✅ **confirms** | TapPay 逐字:顯示結果頁「之前」以 rec_trade_id 打 Record API 反查、status=0 才算成功。綠界同。補:webhook 未到時顯示「**處理中**」中間態、不直接判失敗(三態而非二態樂觀)。 |
| 6 | 庫存 Phase 1 無超賣防護 | ⬜ **gap(金流不可裁決)** | 可接受 Sean 業務取捨(低單量 + LINE 人工攔)。**但**:庫存扣減(若有)須對 `order_number` 冪等,否則 webhook 重送虛減(綠界明文「重送同筆只認一次、不可重複扣庫存」)。 |

---

## Part B — 🔴 最大缺口:對帳層完全缺位(三份一致最強訊號)

- **WF1(全球)**:reconciliation gap —「delivery isn't guaranteed, apps shouldn't depend only on webhooks」,要跑主動回查 job。
- **WF2(台灣)**:TapPay 自己建單後 10-20 分鐘向銀行反查(每筆最多 2 次)+ Record API 隔日對帳(≤90 天)+ notify 重送 1/2/4/8/16 分鐘最多 5 次。
- **WF3(稽核)PAY-03(high gap、對抗驗證 confirm real)**:②-⑥ webhook(TapPay notify)+ Record API 反查 + stale-pending sweeper **全 repo 零實作**(實 grep)。

→ **所有 fail-closed「寧卡單勿雙扣」兜底承諾,全押在這個尚未建的層上。** 上線真實刷卡前**硬前置**。
   3DS 一旦上線,這層同時是「3DS 主成交路徑」(非兜底)—— 兩件事必須綁一起做。

---

## Part C — PCM 結帳安全姿態(WF3 稽核、84 findings)

### 強項(already-ok、21 條覆蓋,核心正確性姿態很強)
金額 server 權威重算 + client 永不送價(整數零浮點、單一來源 read-back 貫穿 charge+confirm)/ 經銷價三層 backstop 零外洩 /
IDOR / CSRF(Origin vs Host)/ 密鑰 server-only 零進 bundle / PII 零落地 + 卡資料 PCI SAQ-A / RLS 窄權 payment_confirmer /
錯誤 oracle 封死 / 同分頁雙擊 + 並發三方 PASS / replay(prime 一次性 + confirm 冪等樹 + rec_trade_id 跨單唯一)/
回應遺失層防雙扣 / 付款結果三態 + 重整不重扣 / 下單快照凍結 / coupon 面(discount 恆 0 無入口)。

### Phase 1 必修(mustfix)
| id | 嚴重度 | 項目 | 狀態 |
|---|---|---|---|
| PAY-02 | high vuln(驗證 confirm) | cross-tab 雙扣(同 cart 兩分頁各扣) | 修 plan 成形、待 D4 + db push;上線前 migration 必落地 |
| PAY-03 | high gap(驗證 confirm) | 對帳層(webhook+Record+sweeper)零實作 | 上線刷卡前硬前置;或明確接受人工逐筆監看 |
| PAY-04 | high partial | tier 尚未 server 重查(H-1) | 階段① general-only 非即時漏洞;**接 tier-aware 定價前**必改 server join customers.tier |
| PAY-01 | high→**下修 medium**(驗證 lower) | orphan-pending vs failed-pending DB 不可分 | **單請求內 TapPay 同步可分**(已扣→processing、未扣→charge_failed_wait);不可分只咬 cross-tab dedup + 對帳層;D4 待拍、②-⑥ 解 |

### Phase 1 should(該做不擋)
價格變動提示(CART-01)/ 下架靜默消失提示(CART-02)/ 地址 phone 格式驗 + 必填(CART-03)/ session 過期回填(CART-05)/
建單冪等鍵(PAY-05、cross-tab fix 一併解)/ 請款 velocity rate-limit 防卡測試(PAY-06)/ stale-pending sweeper(PAY-08、與 PAY-03 同根)。

### Phase 2 backlog
3DS liability(PAY-07、Sean 拍延後但上線前須明確風控成本:CNP 盜刷退單 100% 落 PCM、Visa VAMP 2026/04 詐欺門檻降 1.5%)/
結構化地址 + 離島運費/可送達(CART-04)/ 庫存超賣數量級防護(INV-01)/ 訪客車合併(CART-06)/ cart TTL(CART-07)。

---

## Part D — 🆕 台灣必補(全球研究不會講、上線前實務)

1. **電子發票**(法定、B2C 雲端發票/載具/捐贈/統編)—— 通常付款成功 webhook 後觸發開立 + 失敗重試。6 決策無此觸發點。
2. **退款 / 部分退款狀態機**(rec_trade_id 串接、refunding/refunded/partial)—— 六態只談成交。
3. **ATM 虛擬帳號 / 超商代碼 二段式**(取號=訂單成立但「待繳費」≠「已付款」)—— Phase 1 只信用卡單段;日後並存須區分。
4. **Record API rate limit 節流**(綠界打太快 403 等 30 分;TapPay filter ≤90 天)—— 反查要有頻率上限 + 隔日批次對帳。
5. **金額比對**用整數(分/元)+ 核 currency(呼應金額整數鐵則,決策層釘死)。
6. **COD 貨到付款**(若客群有需求)—— 不走 3DS/webhook 成交鏈、獨立「出貨後收款」狀態機。
7. **TapPay notify 全失敗寄信**人工兜底 —— 接進對帳/告警流程(最罕見 webhook 全失敗案例)。
8. **驗章方式**:TapPay 走 **Record API 反查**(非綠界 CheckMacValue / 藍新 TradeSha 字串驗章)—— 別誤套 CheckMacValue 式驗章到 TapPay。

---

## Part E — 修正後方向 + TapPay 實作坑

### 決策淨修正
- 決策 1:措辭改「webhook 定成交、callback 觸發查證」。
- 決策 3:**結算層去重鎖 = `rec_trade_id` DB UNIQUE(PCM 已有 ✓)**;`cart_session_id` 降為前段防雙擊;每次 charge 帶唯一 `bank_transaction_id`;`order_number` 不當唯一硬鎖。→ **好消息:webhook 重送雙建單其實已被現有 `rec_unique_idx` 擋住**,cross-tab 修補的結算層風險比原本評估低。
- 決策 4/5:補 pending=正常中間態(status=4)、亂序/重送冪等、webhook 未到顯示「處理中」。
- **對帳層升級**:②-⑥ 從「兜底」升為「3DS 主成交路徑 + 所有 fail-closed 的依託」= 最高優先,與 3DS 綁一起上。
- **D4 重新框定**:PAY-01 下修後,live 風險較低(單請求可分);D4 仍要拍,但主要為 cross-tab dedup + 對帳收斂服務,非「立即雙扣」。

### TapPay 實作坑(官方明列、master plan 必納)
- backend_notify 要 HTTPS 443 + 回 HTTP 200,否則重送 5 次 → handler **冪等**。
- payment_url timeout 建議 30 秒(尖峰銀行延遲)。
- 測 3DS **必用未被瀏覽器記住的新卡**(記住的卡跳過 3D、誤判沒觸發)。
- pending 由 TapPay 10-20 分鐘自動反查(每筆最多 2 次)→ 部分 orphan 自動收斂,**減輕 D4=A 誤殺範圍**。

---

## 來源
- 全球 WF1 `wqyvdzmgp`(webhook 維存活;6 維限流):Stripe webhooks、Shopify best-practices、Adyen handle-webhook-events。
- 台灣 WF2 `w9bjgws0m`(5/5、31 來源):TapPay back.html/advanced.html、綠界 developers.ecpay.com.tw、藍新、SHOPLINE/meepShop。
- 稽核 WF3 `wfdcab41e`(6/6、84 findings、對抗驗證 3 條):讀 PCM 實際程式碼 file:line。
