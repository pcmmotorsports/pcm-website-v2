# M-3 線:TapPay 正式化 + 黑洞即時對帳 + 1 元真刷 — 實作計畫(真權威)

> 2026-07-23 建立。設計輸入 = memory `project_tappay-production-blackhole-settle-line`;架構事實已對照 code 驗證(見 §9 附錄 file:line)。
> **狀態:Sean 2026-07-23 已批准開工(「做」)。S1a 實作中(見 §5、四層審查進行);S2 以後未動。仍不 push;碰 DB/flag/env 一律停下交 Sean 手動。**
> 全線片型 = **高風險金流片**(鐵則 12 ①錢 + ②權限 service_role + ③DB 寫入):四層審查不降級 + codex 金流背書 + DB 動作交易模擬(BEGIN→模擬→驗→ROLLBACK 零留痕)。

---

## 0. 目標

正式站打通刷卡(Sean 軟上線開始接單)→ 刷不成時客人即時知道 → 背景兜底 → Sean 用 1 元商品真刷驗收 → 退款(手動)。

## 1. Sean 已拍板(2026-07-23,鎖定)

- **Q1a=B 軟上線**:開起來就是開始接單,不是測完就關 → 法律頁(#291 / L1)不能省、列為並行必交項。
- **Q1b=A 法律頁**:Claude 照台灣官方框架起草 PCM 專屬服務條款+隱私政策草稿、填 `site-config.ts` 真實聯絡資訊,交 Sean(選配律師)核准。**7 天鑑賞採「合法條件式退貨 + 客製品例外」**,不寫會被判無效的「一律不退」;超出法律允許的排除一律標記給 Sean/律師。
- **Q2=A 訂單只標記不刪**:確認失敗只 `markFailed`(標記 failed/cancelled)、保留紀錄,永不物理刪(對齊「孤兒單不硬刪」)。
- **Q3=A 黑洞即時對帳範圍**:兩張安全網(webhook 接線 + sweeper 打開)為主 + 補「送出超時出口」修 F5 + 補「by-cartSessionId 反查」給回應遺失邊角。
- **Q4=A sweeper 搬 Supabase pg_cron** 做分鐘級(不綁 Vercel 方案)。
- **Q5=A anomaly-alert(雙扣告警)這次一起打開。**

## 2. 金流不變量(每片必守;違反 = 立即停、回報)

1. **只有 TapPay 明確回 failed(record_status −1/5)才動訂單為 failed**;查不到 / pending / HTTP 異常 / 退款態 / 未知碼 → 一律保留、不動訂單(現有 `settleCharge` 已如此,見 §9)。**重用 `settleCharge`、不新增任何訂單狀態寫入或刪除邏輯。**
2. **「訂單不成立」= 標記 failed/cancelled、保留紀錄,非物理刪**(Q2=A)。
3. **模糊態(processing/unknown/回應遺失)保留 `cart_session_id`、不 regenerate**、不釋放雙扣鎖(現有政策,見 §9 useChargePayment)。
4. **經銷價/金額 server 權威**、client 不送價;敏感金鑰只在 server env、不入 client bundle、不進 git、不貼對話。
5. **DB 動作先交易模擬**(BEGIN→模擬→驗→ROLLBACK)、零留痕;正式 schema 走 Sean 手動 `db push`,不用 MCP 直寫。

## 3. 開正式站刷卡 = 一組開關同時對(go-live 硬清單)

> 缺一即「開一半更危險」:flag 開了但 webhook 網域錯 / sweeper 沒開 → 客人中途離開 3D 頁 = 訂單永久卡 pending、無兜底。

| # | 項目 | 由誰 | 現況 |
|---|---|---|---|
| a | `TAPPAY_3DS_ENABLED=true` | Sean(Vercel env) | 未設(false) |
| b | `TAPPAY_ENV=production` **且** `NEXT_PUBLIC_TAPPAY_ENV=production`(兩處各自獨立讀) | Sean | 待設 |
| c | 正式 `TAPPAY_PARTNER_KEY` / `TAPPAY_MERCHANT_ID`(強制 3D 真 merchant) | Sean | 待換(現為免 3D 測試 merchant) |
| d | 正式 `NEXT_PUBLIC_TAPPAY_APP_ID` / `NEXT_PUBLIC_TAPPAY_APP_KEY` | Sean | 待設 |
| e | `TAPPAY_NOTIFY_PATH_SECRET`(≥32,webhook 路徑;缺會 throw) | Sean | 待設 |
| f | `NEXT_PUBLIC_SITE_URL` = 正式網域(redirect / notify URL 基底) | Sean | 需確認指向正式站 |
| g | migration `20260624120001`(find_active_sibling_own)、`20260621120000`+`20260624120009`(claim_order_poll_settle 最終 released 版)已 db push（S1b 重用、零新增) | Sean | 需確認正式站已 apply |
| h | `CRON_SWEEPER_ENABLED=true`(S2 後) | Sean | false |
| i | `ANOMALY_ALERT_ENABLED=true`(Q5) | Sean | false |
| j | TapPay 後台已登記 backend notify URL 指向正式 webhook 路徑 | Sean(TapPay Portal) | 待確認 |
| k | 法律頁 L1 已上線(軟上線 Sean 選 B → 必須) | 本線 L1 | #291 BLOCKED |

## 4. 片序與依賴

```
S1a(②)送出超時出口 ✅ 收工(b73e9cb、四層審過)   ← code only
S1b(②)reconcileCartSession 即時反查              ← code only、**零 migration**(Q1a=A 重用既有 RPC);拆 S1b-1 後端 + S1b-2 前端
S2(③)sweeper 搬 pg_cron 打開 + anomaly-alert 開    ← DB/平台；安全網
S3    sandbox 3DS 全鏈實測                          ← 真刷前必經 gate（STATUS Blocker 明列）
S4(①)正式環境金鑰 + §3 一組開關同時開              ← Sean 操作為主；解除「不可開」
S5(④)1 元商品上架                                  ← Sean 真刷
S6(⑤)退款手動 SOP                                  ← 文件 + Sean 手動
L1    法律頁 /terms /privacy（#291）                ← 與 S1–S3 並行；軟上線前必上、且是 S4 前置(§3-k)
```

並行:L1(法律頁)可與 S1–S3 並行推進(不同檔、無 code 衝突);但 **S4 開 flag 前 L1 必須先上**(Q1a=B 軟上線,真客人會勾到同意條款)。

## 5. 逐片規格

### S1(②)送出超時出口 + by-cartSessionId 即時反查

**為什麼**:①修 U5 遺留 F5(overlay 蓋 `submitting`、`chargePaymentAction` 無 timeout → 網路黑洞永久鎖死);②把回應遺失 `catch`→`unknown` 死路升級成「盡力給客人真實結果」。
**改什麼**:
- **S1a〔已收工 `b73e9cb`〕**:`useChargePayment.tsx` `chargePaymentAction` 呼叫包 `withSubmitTimeout`(90s provisional)。逾時 → reject → 落既有 `catch` 的 `unknown` 終態(clear + 保留 cart_session_id 不 regenerate + 不釋鎖 + 勿重複付款文案);overlay 因離開 `submitting` 自動掀開 → 客人有出口。🔴 **Q1b=A:逾時只落 `unknown`、不做 best-effort 自動反查**(反查改由 S1b 的手動按鈕觸發)。
- 🔴 **S1 已拆並更正設計(2026-07-23、S1b v3 plan 為真權威 = `docs/specs/2026-07-23-m3-s1b-reconcile-cart-session-plan.md`)**:S1a〔逾時出口〕已收工(`b73e9cb`);Q1b=A 逾時只落 `unknown`、**不做 best-effort 自動反查**。
- 新 server action `reconcileCartSession(cartSessionId)`(S1b):own-only `find_active_sibling_own` 取 orderId → 既有 by-orderId `claim_order_poll_settle` 節流 → `settleCharge`(重用、零新寫入/刪除/release)→ 回 paid/failed/pending;掛在 `unknown` 態「查詢付款結果」按鈕。
- 🔴 **Q1a=A:零新 migration**——經查 `find_active_sibling_own` 取 orderId 後既有 by-orderId 節流即可覆蓋,**不新建 by-cartSessionId RPC**(縮範圍、降風險、Sean 不需 db push)。
**影響面**:結帳付款鏈(client)+ 1 支新 server action(S1b `reconcileCartSession`)+ **0 支新 RPC**(Q1a=A 重用既有 `find_active_sibling_own` + `claim_order_poll_settle`)。付款安全契約(getPrime/charge/3DS/inflight/終態鎖)**不改語意**;S1a 只加逾時分支、S1b 只加 `unknown` 態按鈕與新全頁 failed 態。
**驗收**:逾時→掀 overlay 有出口(agent-browser 實測);reconcile own-only(他人 cartSessionId 回 none)、節流生效、settleCharge 對 pending/查不到不動訂單(窮舉單元測試);三綠。
**Rollback**:逾時分支(S1a)+ reconcile action/按鈕(S1b)皆純新增,移除即回舊行為;**零新 DB 物件**(重用既有 RPC)、charge 鏈不依賴 reconcile。

### S2(③)sweeper 搬 Supabase pg_cron + 打開 + anomaly-alert

**為什麼**:Vercel 現況每日一次(且方案有頻率上限)→ 黑洞漏 webhook 時最久卡一天;Q4=A 改 pg_cron 分鐘級。Q5 一起開雙扣告警。
**改什麼**:
- pg_cron 排程呼既有 `/api/cron/settle-sweep` route(對齊 Email 線 pg_cron 先例;**S2 開工前先查 Email 線 pg_cron→route 的實作與鑑權方式對齊**,route 需接受 pg_cron 呼叫的共享密鑰鑑權)。頻率待定(見決策附註)。
- Sean 設 `CRON_SWEEPER_ENABLED=true` + `ANOMALY_ALERT_ENABLED=true`(+ 告警管道 env,否則 ENABLED=true 會 fail-closed throw)。
- Vercel `vercel.json` 兩支每日 cron 去留 = S2 內決定(避免雙跑;建議 sweeper 交 pg_cron 後移除 Vercel 該支,anomaly-alert 同理或保留每日)。
**影響面**:平台排程 + DB(pg_cron)+ route 鑑權。
**驗收**:pg_cron 按頻率觸發、route 非 no-op(flag on)、掃 stuck attempt + webhook inbox 各對 settleCharge、對帳只標記不刪(交易模擬);告警管道實發一次驗證。
**Rollback**:`CRON_SWEEPER_ENABLED=false` 即 route no-op;pg_cron job 可停用。

### S3 sandbox 3DS 全鏈實測(真刷前 gate)

**為什麼**:STATUS Blocker 明列「真刷卡待 sandbox 3DS E2E」;prod 一律 3D、不能拿 prod 當首測。
**做什麼**:staging/preview 部署(sandbox env + 3DS-capable sandbox merchant)跑:加購 → 3DS OTP(TapPay 測試卡)→ callback → settle → paid;+ 黑洞情境(中途離開 → webhook / sweeper 收斂)+ S1 逾時出口 + reconcile。**非本地 LAN**(Sean:本地測結帳沒意義)。
**影響面**:僅 staging env;不動正式。
**驗收**:full 3D happy-path 綠 + 至少一條黑洞→兜底綠 + F5 出口綠。**此片全綠才准進 S4。**

### S4(①)正式環境金鑰 + 一組開關同時開

**為什麼**:解除「prod checkout 不可開」。
**做什麼**:Sean 依 §3 硬清單逐項設定(env / 換正式 merchant / 確認 migration apply / TapPay 後台 notify URL)→ 最後才翻 `TAPPAY_3DS_ENABLED=true` + `CRON_SWEEPER_ENABLED=true` + `ANOMALY_ALERT_ENABLED=true`。**前置 L1 必須已上(§3-k)。**
**影響面**:正式站付款全面啟用(對所有客人)。
**驗收**:§3 逐項 yes;正式站真能進 3D。**Claude 不代設 env、不代 push、不代翻 flag** —— 全 Sean 手動(R3 不可逆對外)。
**Rollback**:三 flag 翻回 false = 立即停止收單(sync 在 prod 本就 status 75、等於關)。

### S5(④)1 元商品上架

**做什麼**:建一個 1 元測試商品供 Sean 真刷。**S5 開工前確認建立路徑**(admin 手動建 vs 目錄同步;需查)。軟上線下商品公開可見 → 建議用不易猜 slug、不進主分類/搜尋、測完下架。
**驗收**:Sean 能在正式站看到並加入購物車、完成一次真 3D 刷卡 = paid。
**Rollback**:下架 / 隱藏該商品。

### S6(⑤)退款手動 SOP

**為什麼**:`TapPayChargeAdapter.refund()` 硬 throw「未實作(Phase 2)」;退款只能 TapPay 後台手動,且退款後 `settleCharge` 對退款態判 anomaly、**不自動改本地狀態**。
**做什麼**:寫 SOP 文件:①Sean 登入 TapPay Portal 退該筆 1 元 ②手動更新本地 `orders.payment_status`(提供精確 SQL,Sean 手動或走 admin)③記錄。**無自動化 code**(依 07-17 拍板)。
**驗收**:文件可照做;1 元退款後本地狀態一致。

### L1 法律頁 /terms /privacy(#291,並行)

**為什麼**:Q1a=B 軟上線 → 真客人會勾同意條款,#291 是 S4 前置。
**做什麼**:①Claude 依台灣官方框架(定型化契約應記載/不得記載事項 + 通訊交易解除權合理例外準則 + 個資法第 8 條)起草 PCM 專屬服務條款+隱私政策草稿(7 天=合法條件式 + 客製品例外;真實聯絡資訊取自 `site-config.ts`;不抄襲、不杜撰、超法定排除標記)②Sean(選配律師)核准 ③建 `/terms`、`/privacy` route、bump `CURRENT_TERMS_VERSION` + hash + `legal_terms_versions` row 三者一致、結帳同意連結由 `href="#"` 改真連結(`target=_blank rel=noopener noreferrer`,兩消費端 CheckoutStep2 + RegisterPage)。
**紅線**:AI 不自撰充當權威(Sean 核准才生效)、不得複製 design LegalPage.jsx 草稿與其假聯絡資訊、migration forward-only。
**驗收**:#291 acceptance 十條;Sean 核准渲染後 payload。

## 6. 每片審查 gate(高風險不降級)

每片:三綠(typecheck+lint+動 .ts/.tsx 加 build)→ code-reviewer(opus)→ codex 關卡2 對抗審 diff + **金流背書** → Fable 盲審;動前台 TSX/CSS 收工前 agent-browser 真瀏覽器驗;DB 片交易模擬。plan 層 codex 關卡1 審本 plan(高風險六類命中)。輪次:R1 PASS 收工、R1 FAIL 才 R2、上限 2 輪。

## 7. 全線 Rollback 總則

翻三 flag(3DS/sweeper/anomaly)回 false = 全線回到今日「不可刷卡」態;**S1b reconcile 重用既有 RPC、零新物件**、S2 pg_cron 為新物件、不啟用即無影響;訂單一律只標記不刪 → 無資料破壞可回滾。

## 8. 待 Sean 手動(Claude 不代做)

db push(L1 migration;**S1b 零新 migration**、既有 RPC〔find_active_sibling_own / claim_order_poll_settle〕正式站 apply 見 §3-g go-live)/ 設 env / 換正式 merchant / TapPay 後台登記 notify URL / 翻 flag / push / deploy 正式站 / TapPay 後台退款。

## 9. 附錄:架構事實 file:line(已對照 code 驗證)

- flag:`isThreeDSEnabled()` = `TAPPAY_3DS_ENABLED==='true'`(`lib/payment/three-ds-flag.ts:18-20`);flag off 在 prod 非可營運態(status 75、`:12-14`)。
- 分岔:`charge-actions.ts:187`(threeDSConfig)、`:194-210`(preflightReleaseSibling)、`:261-278`(initiatePayment→redirect)、`:280-294`(flag-off 同步 confirmPayment);外層 catch `:295-300` 全零扣款路徑回 formError。
- 黑洞:client `catch`→`unknown` 靜態文案、不查不 poll(`useChargePayment.tsx:124-133`);九態 union `:50-66`。
- 引擎:`settleCharge(deps,{orderId,recTradeIdHint?})`(`packages/use-cases/src/settle-charge.ts:45`);只 explicit_failed(−1/5)才 markFailed、其餘 pending 不動(`:52-138`、`:124-131`)。
- 查交易:`TapPayChargeAdapter.recordQuery`(`TapPayChargeAdapter.ts:224`);`recordQueryUrl` 由 `TAPPAY_ENV` 決定 sandbox/prod(`composition.ts:66-69,76`)。
- 反查:`find_active_sibling_own(p_cart_session_id uuid)` own-only auth.uid()、GRANT authenticated(migration `20260624120001`);只接在 3DS preflight、sync 未接。
- 節流:`claim_order_poll_settle(p_order_id,p_throttle_seconds)` by-orderId(基線 migration `20260621120000`、**最終定義 = `20260624120009` released 繞閘版**);🔴 **Q1a=A:S1b 反查取 orderId 後重用此 by-orderId 版、零新建**(原「無 by-cartSessionId 版 → 需新建」已作廢)。
- caller:callback page / adjudicateSettlement(`charge-actions.ts:418`)/ payment-status poll / tappay-notify webhook / cron settle-sweep / reconfirm-expired-orphans 全在。
- cron:`vercel.json` `settle-sweep 0 0 * * *`、`anomaly-alert 0 1 * * *`;`CRON_SWEEPER_ENABLED`/`ANOMALY_ALERT_ENABLED` 嚴格認 `'true'`、現況 no-op。
- 退款:`TapPayChargeAdapter.refund()` 硬 throw;退款態 record_status 2/3 判 refund_anomaly、不自動改狀態。

## 10. 兩個開工前待定(不阻擋批准、S1/S2 起手時定)

- **A. client 送出逾時秒數**(S1a F5 出口):**S1a 採保守 90s provisional**(codex 關卡2 must-fix:未驗證的緊門檻不進金流 → 取遠高於正常「數秒」延遲、不誤傷 90s 內的慢成功〔真 >90s 才降級 unknown=安全方向〕;Vercel effective maxDuration 未實查〔repo 無設定、Hobby 視 Fluid 而定〕→ S3 併驗)。**S3 sandbox 3DS E2E 實測 charge/redirect 真延遲後定案,才進 S4 prod。**
- **B. sweeper pg_cron 頻率**(S2):建議每 2–5 分鐘(webhook 為即時主力、sweeper 為兜底)。S2 起手對齊 Email 線 pg_cron 實作後定值。
