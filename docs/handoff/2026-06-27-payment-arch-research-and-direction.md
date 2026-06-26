# 交接:金流架構研究 + 3DS UX 方向重定調(2026-06-27)

> 本檔 = 新 session 接手包。研究(Gemini + 5 路 web 引用查證)已完成,**結論重新定調了 A2/A3 方向**。
> 🔴 **開工第一步 = 跟 Sean 確認下方「方向決策」**(pivot 與否),再依結論走。
>
> 🟢 **2026-06-27 更新(pivot 已執行):Sean 拍板 A(整頁 redirect 桌機+手機)。** Q1=A `git reset --hard 26bc93f` 拆 A1 popup commit `089c220`(退出主歷史、reflog 留存)→ code 落回 3DS-6b 整頁 redirect;Q2=A 本輪做階段 0(canonical 整頁化)+ P1(拆 popup)+ P2(#239 手動鈕)+ P3(in-flight 防呆),P4 抽 PaymentMethodAdapter 地基另開獨立 plan。**現行真權威 = canonical v10(§6/§2.3/§9/§14/附錄 B ㉗)+ STATUS**;本檔 §1 以下為**研究當下快照**(HEAD `089c220` = reset 前狀態、已退出主歷史),保留供研究脈絡、非現行狀態。

---

## 1. 現況(2026-06-27)
- worktree `/Users/sean_1/pcm-3ds-yi-r1`、branch `m3-3ds-yi-r1`、HEAD `089c220`(A1)。**未 push / 未 merge / 未 db push、`TAPPAY_3DS_ENABLED` 全程 false**。backup `origin/m3-3ds-yi-r1`=`26bc93f`(W1;A1 089c220 ahead 1 未推)。
- **A1 已完成 + commit**(089c220):3DS 桌機 popup + opener=null + CheckoutPendingThreeDS 等待輪詢 + redirect outcome 補 orderId/displayId + 抽 usePaymentStatusPoll/CheckoutChargeTerminal。三綠 + vitest 1485 + code-reviewer PASS + adversarial-reviewer PASS-WITH-NITS。Sean 真機 4 情境驗收通過。
- 🔴 **真機發現真雙扣 bug**:結帳開 3D popup(訂單 #1 pending)→ 不關 popup、回網站**重整**、再結帳 → 第二個 popup(訂單 #2)→ 兩個都輸 OTP → **兩張都 paid(0072 + 0073、各 17,300)**。
  - 根因:重整後 cart_session_id 不變 → preflight **有找到** #1,但 #1 的 3D 只到 PENDING(Record status 4 auth_or_pending)→ canonical §2.3「立即重刷」設計**釋放 #1 + 放行 #2**(= 客人喜歡的「關窗後馬上重刷」同一條路)。釋放後 #1 popup 仍活 → 兩個都完成 → 雙扣。
  - **安全網有作動**:已驗 `payment_double_charge_anomalies` 有 **open anomaly:old_order=PCM-2026-0072 / 配對 paid=PCM-2026-0073 / released_at+charged_at 皆有**(R1b1c released→charged genesis 生效)→ W1 報表列出 → 退 0072。**0072 待 Sean 用 W1 流程退款**。
- 之前已和 Sean 對話拍板過一版 A2/A3 設計(桌機 popup+遮罩+popup.close 防呆 / 手機整頁 / in-flight 記號 / W1 兜底)——**但下方研究結論建議推翻這版,改走更簡單更穩的全整頁**。

---

## 2. 研究結論(Gemini 廣度 + 5 路 web 引用查證;正確性已 Claude triage)
研究產物:Gemini 輸出 `scratchpad/gemini-out.txt`;web workflow 結果 `tasks/wg7ppfx1y.output`(5 topic、含 Stripe/Adyen/Braintree/Checkout.com/EMVCo/Apple/LINE Pay/TapPay 官方引用)。

**Q1 我們的 popup 是否合現代最佳實務?→ 不合,popup 已過時。**
- 現代主流 = **① in-page iframe modal**(Stripe/Braintree/Adyen native 都這樣;ACS 頁嵌在原頁 modal iframe、postMessage + server 端複查完成)→ **② 整頁 redirect**(fallback、Checkout.com integrated auth 用此)。**window.open 分頁/popup 沒有任何主流 PSP SDK 在用**(被 popup blocker 擋、難關閉、手機 tab-juggling 斷 postMessage)。
- **手機最穩 = 整頁 redirect**(手機 + LINE/FB 內建瀏覽器開 popup/分頁極不可預測、掉 session)。
- 🔴 **決定性事實:TapPay 3DS 是 redirect-only**——payment_url「只支援整個視窗 top-level navigation,不支援 iframe 內嵌 / popup」。所以**「iframe modal」對我們不可行**(TapPay 不給包)。
- 👉 **對我們的唯一現代-正確選擇 = 整頁 redirect(桌機+手機都是)**。這也是 A1 之前的 `CheckoutRedirecting`(window.location.assign)本來就有的東西。整頁 = 單一 context = **結構上消滅「兩視窗二刷」** + 不需要 popup.close/遮罩/跨視窗同步那一整套防呆。

**Q2 Apple Pay / LINE Pay 是否同處理?→ 三種本質不同,不可共用同一套互動。**
- **信用卡+3DS**:inline tokenize(TapPay Fields)→ Prime → 條件式 **整頁 redirect** 3DS。
- **LINE Pay**:`TPDirect.linePay.getPrime` → payment_url → `TPDirect.redirect` → 桌機整頁跳 LINE Pay web、**手機 deep-link 喚醒 LINE App** → 回 confirmUrl。= **redirect/deep-link 型**,跟 3DS **共用同一組 return-handler + backend_notify**。
- **Apple Pay(及 Google Pay)**:`TPDirect.paymentRequestApi`(Apple Pay JS / Payment Request)→ **OS 原生付款表單 + 生物辨識**、**無 3DS、無 redirect、無 popup** → 直接拿 Prime 打後端。新增基建 =(a)server 端 merchant-validation 端點(放 Merchant Identity 憑證、proxy validationURL)(b)Apple 商戶上線:Merchant ID + 2 張憑證 + `/.well-known/apple-developer-merchantid-domain-association.txt` 網域驗證(上線 checklist)。

**Q3 好地基?→ strategy/adapter 分層(業界標準、TapPay「Prime 不分付款方式」原生支援)。**
- **共用層(method-agnostic、~90%、我們大多已有)**:order/intent 狀態機 + `settleCharge` 對帳脊椎 + payment_charge_attempts + 雙扣 anomaly/event + backend_notify ingestion(唯一真相)+ Record API(rec_trade_id)對帳 + idempotency(cart_session_id/begin-dedup)。**絕不信任 client redirect。**
- **各方法層(每個一個 adapter,`PaymentMethodAdapter` 共同介面 present()/collect()/initiate())**:① Card+3DS = redirect-shaped ② LINE Pay = redirect/deep-link-shaped(共用 return-handler)③ Apple/Google Pay = sheet-shaped(讓 TapPay 當 merchant-of-record 解密、回同一條 Pay-by-Prime,**勿自己解密=勿造第二條結算路徑**)+ `canMakePayments` 裝置 gating。**每個新方法 flag-gated、15-45 分切片、零動結算/webhook/對帳**。

---

## 3. 🔴 方向決策(新 session 開工先問 Sean 確認)
**推薦 = 把信用卡 3DS 從「桌機 popup」改為「桌機+手機都整頁 redirect」(= 復用既有 CheckoutRedirecting,等於精簡掉 A1 的 popup 那套)。** 理由:TapPay 不能 iframe + popup 過時 + 整頁從結構上消滅這次的二刷 + 大幅簡化(免 popup.close/遮罩/跨視窗/in-flight 那套複雜防呆)。

```
Q(新 session 先跟 Sean 確認):信用卡 3DS 互動改採?
  A = 整頁 redirect(桌機+手機)= 復用 CheckoutRedirecting、精簡掉 A1 popup(推薦:現代-正確 given TapPay redirect-only、消滅二刷、最簡)
  B = 維持 A1 桌機 popup + 做防呆那套(已知 popup 過時、需維護跨視窗防呆、二刷只能靠 W1 退款兜底)
  C = 其他(Sean 指定)
```
- 選 A → 後續見「§4 若 pivot A」。Sean 之前喜歡「跳出視窗」的體驗,但研究顯示代價(過時 + 二刷 + 複雜防呆)>> 效益;務必讓 Sean 知情再決定(Sean 改主意是常態、用證據對齊)。

---

## 4. 若 pivot A(整頁 redirect)後續切片(全 flag-gated、前端為主、文案 L2、每片三綠 + adversarial-reviewer + code-reviewer、codex K2 順延 ~7/25)
- **P1 整頁化**:CheckoutView 送出時**不開 popup、一律走 redirect outcome → CheckoutRedirecting**(window.location.assign);移除 A1 的 popup 開啟 / pending_threeds / CheckoutPendingThreeDS / markPendingPaid / usePaymentStatusPoll(回 callback 頁的 PollOrderStatus 已涵蓋返回輪詢);redirect outcome 是否還需 orderId/displayId 重新評估(整頁不需原頁輪詢)。= 大幅 revert A1。
- **P2 #239 整頁 fallback 硬化**:CheckoutRedirecting 加「未自動跳轉請點此」按鈕(非只 auto-href)、callback paid/failed/pending 各自足 CTA。
- **P3 再結帳防呆(剩餘二刷向量)**:整頁後唯一殘餘 = 客人**自己另開分頁**再結帳 → in-flight localStorage 記號(任何結帳前檢查、跳「你有付款進行中」)+ 既有 preflight + W1 兜底。
- **P4(地基)抽 PaymentMethodAdapter 介面**:把現有 card+3DS 重構成第一個 adapter,前後端共用層/方法層分離(為 Apple Pay / LINE Pay 鋪路)。**這片是「良好地基」的核心**,建議獨立 plan + Sean 批(鐵則 8)。
- **canonical 修訂**:§6.1/§6.2/§6.4 popup 假設改整頁;§2.3 立即重刷「釋放+放行」的二刷風險 + 整頁如何降低,寫清楚。

> 若 Sean 選 B(維持 popup):走之前對話拍板的 A2/A3(桌機遮罩 + popup.close on 回購物車/beforeunload + 手機整頁 + in-flight 記號 + W1),設計細節見本 session 對話(桌機 popup.close 可靠、手機整頁、跨分頁 localStorage 記號)。

---

## 5. 關鍵檔 / 真權威
- canonical plan:`docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(§2.3 立即重刷 / §6 塊A 前端 / §7 W1 / §9 / §14)。
- PRD:`docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD.md`(過 prd_review)。
- 程式:`apps/storefront/src/app/checkout/charge-actions.ts`(redirect/preflight 接線)、`hooks/useChargePayment.tsx`、`components/CheckoutView.tsx` / `CheckoutRedirecting.tsx` / `CheckoutPendingThreeDS.tsx` / `CheckoutChargeTerminal.tsx`、`app/checkout/callback/page.tsx` + `PollOrderStatus.tsx`、`packages/use-cases/src/{initiate-payment,preflight-release-sibling,settle-charge}.ts`。
- 研究產物:`scratchpad/gemini-out.txt`、`tasks/wg7ppfx1y.output`(5 topic 引用)。

## 6. 守線 / 紀律
- 只動 worktree;**不 push / 不 merge / 不 db push / 不開 flag / 不碰 .env\***;真機驗收用 production build(memory `reference_pcm-mobile-device-verify-dev-vs-prod`)= Sean。
- 金流片 = 鐵則 12 + security_review_required + code_review_required;**codex K2 月牆 ~7/25 順延**,本月以 adversarial-reviewer + code-reviewer 當審查關卡、記順延補審。
- 鐵則 8 重大改動(改 canonical / 抽 adapter / 跨多檔)→ 動手前先 plan 等 Sean 批。
- **0072 雙扣**:Sean 用 W1 流程退款(已在 open anomaly 清單)。

## 7. 開 prod flag 前 backlog gate
#252(R3 gating 中間態驗 begin-dedup 兜底)/ #250(雙扣 anomaly 主動告警)/ #241(同意 checkbox server 驗)/ #239(redirect fallback button-not-href)/ #251(DB reason allowlist 補 released_failure_observed)。
