# 2026-06-20 M-3 3DS 結算「授權即成立」重新設計（設計決策包）

> **文件性質**：審查 session（寫審分離 ROLE=A）整理的**設計決策包 = 規劃輸入**，非 slice plan。
> 來源 = 2026-06-20 sandbox 3DS 端到端實測的發現 + Sean 當日拍板。
> **未動 code、未 commit。** 後續由執行 session 據此寫正式 slice plan、審查側跑 codex 雙關卡、Sean 批准才動手（鐵則 8 + 12）。

---

## 1. 今天的測試成果：sandbox 3DS E2E 全鏈驗通 ✅

**環境**：本機 `next start`（production build，非 dev — dev bundle 經 tunnel 互動失效）+ cloudflared/ngrok tunnel（公開 https）+ sandbox merchant `pcmmoto_NCCC_AE_Only`（唯一 3DS2.0）+ TapPay 官方 AMEX 測試卡 `3454 5465 4604 563`。

**驗通全鏈**（PCM-2026-0015 / rec_trade_id D20260620FWJUJX）：
preflight → 建單(create_order) → `initiateThreeDSCharge` status=0 + payment_url → client 整頁跳轉 TapPay 3D 驗證頁 → OTP → callback `?status=0` → **backend_notify webhook 進 durable inbox（payment_webhook_events 0→1）** → settleCharge 反查。

**過程踩坑（皆已解，記錄供 runbook）**：
- `.env.local` 的 `NEXT_PUBLIC_SITE_URL` 變數名被貼兩次 → preflight throw → 零建單。
- merchant 卡別不符 → status **10039**「此商家不支援此卡別」（此 merchant 僅 AMEX）。
- dev bundle 經 tunnel hydration 失效（互動全死）→ 必用 production build 驗互動。

---

## 2. 揭露的核心問題：5 個現象、1 個根

**根 = 3DS 異步結算的「成立門檻」太高 +「收尾層」未到位。**

| # | 現象 | 性質 |
|---|---|---|
| ① | 已授權（客人收到刷卡簡訊）但網站顯示「處理中」 | UX 落差 |
| ② | 訂單記錄看不到 pending 單，客人關頁就失聯 | 真問題 |
| ③ | 成立後無通知客人 | 真問題 |
| ④ | **交易停「已授權」未請款 → 按現設計永遠不 paid** | 🔴 核心（auth/capture） |
| ⑤ | pending 沒收斂 → 10 分鐘 in-flight 鎖擋住客人後續下單 | 真問題 |

> 底層 3DS 機制（啟動/跳轉/OTP/callback/webhook）今天**全驗通、是好的**。要解的是「成立判定」與「收尾層」。

---

## 3. Sean 決策（2026-06-20 拍板）

- **授權即成立**：銀行授權成功（有 Auth Code）→ 訂單**成立**。理由 = 對齊 PCM 既有刷卡連結慣例（一向授權成功即成交）。
- **請款自動**：TapPay／收單行自動批次請款，**網站不做 capture**（不呼叫請款 API、不做後台請款按鈕）。
- **成立後狀態**：暫用現有 `orders.payment_status = paid`（不分兩段；未來若要帳務精準可再引入 `authorized`/`captured` 兩段，現階段對齊既有慣例從簡）。

---

## 4. 核心改動：settleCharge 成立門檻

**現狀**（`classifyRecordStatus`，record_status 官方 7 值已親核釘死）：

| record_status | 現判定 |
|---|---|
| 1 OK + is_captured=true | paid |
| **1 OK + is_captured=false** | **pending（auth_or_pending）** ← 卡住 |
| **0 AUTH 授權未請款** | **pending（auth_or_pending）** ← 卡住 |
| 4 PENDING 待付款 | pending |
| -1 ERROR / 5 CANCEL | failed |
| 2 PARTIALREFUNDED / 3 REFUNDED | refund_anomaly |

**改成（授權即成立）**：`record_status 0 (AUTH)` 或 `1 (OK)` → **成立（paid_candidate）**，不再要求 `is_captured`。其餘維持不變。

🔴 **審查把關（動手時必守）**：
- 放寬成立門檻**不得弱化** `recordMatchesOrder` 的金額/識別比對閘（order_number/rec/bank/amount/currency + 弱識別時間窗）—— 防誤命中誤結他單。
- 須確認 `record_status=0 (AUTH)` 確為「授權成功」（有 Auth Code）而非「授權處理中」。實測這筆有 Auth Code 573326，方向成立。
- `4 PENDING 待付款`（尚未授權）維持 pending；`-1/5` 維持 failed；退款態維持。

---

## 5. 收尾層必補清單（對應 5 現象）

1. **callback 自動輪詢**：Record API 有同步延遲（實測 callback 當下 `queryStatus=2` 查無）→ 前端停「處理中」時背景 poll 訂單狀態，成立後自動跳成功頁（客人通常等幾秒、無感）。 🔴 **supersede（2026-06-21 querystatus-fix）**：此「`queryStatus=2` 查無」歸因經真刷實證（PCM-2026-0018）釐清為 settle-charge.ts L85 把查詢成功態 status=2 誤殺、**非純同步延遲**；真因與修法見 `docs/specs/2026-06-21-m3-3ds-settle-querystatus-fix-plan.md`。輪詢機制仍保留作 webhook/sweeper/實際延遲後備。
2. **in-flight 鎖收斂/釋放**：成立後立即釋放鎖；檢視現「10 分鐘 user_in_flight 窗口 + stale pending 不自動釋鎖」對「授權即成立」是否仍恰當（成立變快後窗口應大幅縮短）。
3. **訂單列表顯示付款狀態**：會員中心訂單能看到「付款確認中／已成立／失敗」，客人關頁也找得到（接續上一輪 OrdersTab 0c78bfb）。
4. **webhook + sweeper 即時收斂**：生產須跑 sweeper cron（`CRON_SWEEPER_ENABLED`）；本機沒跑是測試假象，但生產的收斂時效要實測。
5. **通知客人**：訂單成立 email/通知；「處理中」頁文案安撫（已收到付款、銀行授權成功為正常、勿重複付款）。

---

## 6. 待釐清 / 待驗證（規劃前先解）

- **Record API 同步延遲**：callback `queryStatus=2 → 0` 要多久？決定輪詢策略與「成立有多即時」。 🔴 **supersede（2026-06-21 querystatus-fix）**：`queryStatus=2` 本身即查詢成功態（已無更多分頁、非「等它變 0」），原「2→0 要多久」前提不成立；卡 pending 真因=L85 誤殺已修。是否仍有殘餘真實同步延遲待 fix plan §8 實證。
- **sandbox 停「已授權」是測試特性還是 merchant 設定**；生產是否真自動請款（Sean 經驗：自動，過幾天入帳）。
- **webhook 能否比 callback 更快確認授權**（backend_notify 帶 status，但 PCM 設計 Record API 為唯一權威 → 仍需反查）。

---

## 7. slice 拆解建議（草案，待正式規劃定序）

| Slice | 內容 | 鐵則 |
|---|---|---|
| S1 | settleCharge 成立門檻改（授權即成立）+ 完整 record_status 回歸測 | 🔴 12 核心，必 codex 雙關卡 |
| S2 | callback 自動輪詢 + 處理中文案安撫 | 前端 |
| S3 | 訂單列表顯示付款狀態（pending/成立/失敗） | 前端 + 讀路徑 |
| S4 | in-flight 鎖逾時/釋放策略檢視 | 12 |
| S5 | 訂單成立通知（email） | 後端 |
| S6 | 部署 sweeper cron（生產 `CRON_SWEEPER_ENABLED`）+ 收斂時效實測 | 部署 |

---

## 8. 風險 + 紀律

- **鐵則 8（重大改動）+ 鐵則 12（payment/結算/order/RLS）**：每個動結算的 slice 必 plan + codex 雙關卡 + Sean 拍板，不得隨手改。
- **rollback**：forward 改、可 flag 控；S1 結算門檻改務必保留識別/金額閘。
- **prod checkout 仍一律不可開**，直到本重設計 + sandbox 全情境驗 + Sean 肉眼驗。

## 9. 順帶發現的獨立 UX bug（今天測出、非本重設計範圍、另記 backlog）

- 結帳「我已閱讀並同意服務條款」**未勾選也能按確認付款、無提醒** → 需補前端驗證。
- **Google 登入失敗**：OAuth redirect 指向舊 `localhost:3001`，與現網域不符 → 上線前須設正確 redirect（sandbox 測試用一般會員登入繞過）。

---

*整理者：審查 session（寫審分離 ROLE=A）／2026-06-20*
