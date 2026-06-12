# M-3 階段②-④ 前端 TapPay Fields — slice plan(2026-06-12、執行 session 自驅)

> 真權威:kickoff `docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md` §7 ②-④ + design
> `design-reference/components/CheckoutPage.jsx` L386-447(N°04 付款方式、co-card-form 字面、已 grep)
> + ②-③ plan v6 §7(chargePaymentAction 六態契約)。
> 關卡1:master plan v6 已過兩輪(本階段不需新關卡1、kickoff §1);本片命中鐵則 12(payment)→
> 每 commit 前 code-reviewer + codex 關卡2。SDK 機制經 context7 對 TapPay 官方 example 確認(2026-06-12):
> `https://js.tappaysdk.com/sdk/tpdirect/v5.19.2`、`TPDirect.setupSDK(appId, appKey, env)`、
> `TPDirect.card.setup({fields:{number,expirationDate,ccv},styles,…})`、`onUpdate(update.canGetPrime/
> status.number|expiry|ccv〔0=valid/1=empty/2=error/3=typing〕)`、`getPrime(result→status===0、result.card.prime)`、
> 容器 class `.tpfield` + focus 注入 `tappay-field-focus`。

內容分級:全 L1(金流前端結構;文案/placeholder 來自 design 字面)。

## 0. 設計拍板沿用(不重問)

- 卡欄落點 = **Step3**(階段① Step2 已拍偏離:co-card-form 占位 + note「最後一步以 TapPay 安全欄位輸入」;
  design 原把卡欄放 Step2 co-pay 內 — 本片照既拍偏離、卡欄插 Step3 review 區塊後、同意條款前)。
- 🔴 **卡資料零進 React state / 零進我方 DOM input**(kickoff §3 ①):design mock 的 `<input value={card.number}>`
  以 TapPay Fields iframe 容器(`div.tpfield`)取代 = 安全 override(manifest/commit body 揭示);
  design 的 label 結構(`auth-field`、span 卡號/有效期/CVV)與 placeholder 字面(`•••• •••• •••• ••••`/
  `MM / YY`/`•••`)照搬。
- ATM 不做(plan §3.2、階段① 已拍);儲值金/優惠券不做(#202)。

## 1. 子片(各 15-45min、各自三綠 + code-reviewer + codex 關卡2)

| 子片 | 內容 |
|---|---|
| ②-④a | SDK 整合層:`types/tappay.d.ts`(TPDirect 窄全域型別)+ `hooks/useTapPayCard.tsx`(script 單次載入、setupSDK、card.setup、onUpdate→state、getPrime promise 化+timeout、StrictMode 雙掛載防重)+ `components/TapPayCardFields.tsx`(design 字面結構 + tpfield 容器)+ `styles/checkout.css` 加 `.tpfield` 段 + tests |
| ②-④b | `hooks/useChargePayment.tsx`(鏡像 usePlaceOrder:同步原子鎖、呼 chargePaymentAction、六態→client state、清車政策)+ `CheckoutView` Step3 接線(卡欄+canGetPrime 守門+getPrime→charge)+ `CheckoutSuccess` 擴(paid/processing 變體)+ tests + bundle grep |

## 2. 關鍵設計

- **env(client)**:`NEXT_PUBLIC_TAPPAY_APP_ID` / `NEXT_PUBLIC_TAPPAY_APP_KEY` / `NEXT_PUBLIC_TAPPAY_ENV`
  (**fallback 'sandbox' fail-safe** — 缺值絕不誤打 production;APP_ID/KEY 缺 → 卡欄區渲染「付款模組未設定」
  錯誤態、不掛頁)。NEXT_PUBLIC_* 本就進 client bundle = 設計內(public keys);server keys(Partner Key/
  PAYMENT_CONFIRMER)bundle grep 維持零命中。
- **SDK 載入**:`useTapPayCard` 內 dynamic `<script>` 注入(id 防重、Promise 化 onload;只在結帳頁掛載時載)。
  React StrictMode 雙掛載:setup 前清容器 innerHTML + ref 守(重 setup 取代殘留 iframe)。
- **getPrime promise 化**:`canGetPrime` false → 不送出(鈕 disabled 鏡像官方 example);getPrime
  `result.status !== 0` → 友善錯誤(不洩 result.msg 原文、log 僅 status code);15s timeout 兜底。
- **useChargePayment 六態 → client state**:`idle/submitting/error(可重試)/wait(charge_failed_wait,
  不誘導立即重試)/processing(勿重複付款+displayId)/in_flight(稍候再試)/paid(displayId)`。
- **清車政策**(我設計、commit body 揭示):`paid` → clear(既有慣例);`processing` → **clear + 終態畫面**
  (錢可能已扣、訂單已建;殘留 cart 誘導重買重刷;②-⑥ webhook 收斂);`in_flight`/`charge_failed`/
  `charge_failed_wait`/驗證錯 → 保留 cart 可修正重試。
- **鎖**:鏡像 usePlaceOrder inFlightRef 同步原子鎖(client 第一道;真防線 = server per-order 鎖 + per-user 閘)。
  `paid`/`processing` 終態保持上鎖;`error`/`wait`/`in_flight` 釋放(wait/in_flight 文案已告知稍候)。
- **鐵則 6**:CheckoutView 369 行 → Step3 付款區(卡欄+錯誤+鈕群)抽 `CheckoutStep3Payment` 子元件、
  View 淨增 ≤30 行;超 400 即再拆。
- **placeOrderAction/usePlaceOrder 不刪**(②-③ 拍:②-④ 切流程 = CheckoutView 改用 useChargePayment;
  舊 hook 留待 ②-⑤ 收尾清或標 deprecated — 字面 vs 事實:本片 View 已不再呼叫它)。

## 3. 驗收(yes/no)

- [ ] 卡欄三 iframe 掛載(design 字面 label/placeholder;`.tpfield` 容器;零 `<input>` 收卡資料、
      零卡號/CVV 進 React state/我方 DOM — grep 驗)。
- [ ] canGetPrime gate:欄位未齊 → 確認付款鈕 disabled(桌機 co-btn-pay + mobile buybar 雙鈕一致)。
- [ ] getPrime 失敗/timeout → 友善錯誤、可重試、零 prime 外洩 log。
- [ ] charge 六態全映 UI(paid→成功頁含 displayId;processing→終態+displayId+勿重複付款;
      in_flight 無 displayId;wait 誠實未扣款;error 可重試)+ 清車政策如 §2。
- [ ] env fail-safe(缺 → 錯誤態不掛頁;ENV fallback sandbox)。
- [ ] smoke tests(SDK mock:TPDirect stub)+ 完整 pnpm test 綠 + 三綠 + bundle grep(server keys 零命中)。
- [ ] Sean 肉眼驗 checkpoint:`:3001` sandbox 測試卡實刷(階段② 末、②-⑤ 後一起)。

— 禁止清單(承 ②-③):不改 scope 外檔 / 不動 .env* / 卡資料零進 state / 金額零 client / 不自動 push —
— 禁止清單結束 —

## 4. 實作註記(完工後對 plan 字面的偏離揭示、code-reviewer Important 2)

1. §2「Step3 付款區抽 CheckoutStep3Payment 子元件」→ 實作改:右側摘要抽 `CheckoutSummaryAside`(更大塊、
   View 382 行 <400)+ 卡欄以 `CheckoutStep3.paymentSlot` prop 注入(不另立子元件;鈕群留 View 因依賴
   total/goBack)。
2. §0「卡欄插 Step3 review 區塊後、同意條款前」→ 實作:插於**付款方式複查 block body 內**(語意更聚合、
   緊貼「信用卡 · TapPay」行;Step2 佔位 note 字面「最後一步以 TapPay 安全欄位輸入」仍成立)。
3. §1「②-④a / ②-④b 各自 commit」→ 合一 commit:SDK hook 與接線互依(a 單獨無消費者、無法獨立肉眼驗),
   審查(code-reviewer + codex 關卡2)一次覆蓋全 diff,拆開無獨立驗證價值。
