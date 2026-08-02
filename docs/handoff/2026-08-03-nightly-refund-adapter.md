# 2026-08-03 夜跑交接:TapPay refund() adapter(停在關卡1)+ A9f 縱切(收工)

> 執行環境:git worktree `/Users/sean_1/pcm-nightly-refund`、branch `nightly/refund-adapter`(自 dev@2c53322)。
> 紅線遵守實況:**零真 API 請求**(全程 mock、codex 兩輪零留痕已比對)/ **未 push** / **未 apply** /
> `STATUS.md`、`docs/handoff/CURRENT.md` **未動**(主視窗管)/ busboy-end 未跑(worktree=印表機、無 STATUS 責任)。

## 0. TL;DR(給早上的 Sean)

1. **第一片 refund():零實作 code,停在關卡1。** 審查鏈 = ultracode 三 lens 對抗面板(3 FAIL、14 must-fix)
   → plan v2 → codex 關卡1 R1(`gpt-5.6-sol`)FAIL 15 must-fix → 親驗折入 → plan v3 → **R2 仍 FAIL 10 must-fix**
   ⇒ 觸發你指令的停損線「**關卡1 兩輪不收斂 → 停、寫 handoff 等早上**」。沒有寫任何一行 adapter code、
   worktree 內 `packages/` 零改動。v4 處置提案已備好(§4),等你拍 §6 決策題即可快速重啟。
2. **第二片 A9f:收工、獨立 commit。** 顧客訂單顯示 paid 一律固定「處理中」,其餘四值文案一字不動
   (master plan v2 §5.1 row47、你 08-03 Q2=B 核准縱切)。三綠 + 全套測試綠。
3. **兩條重要證據更正**(審查鏈的最大收穫,已寫進 plan v3 §0):
   - `10024`(未請款不能部分退)**已在 sandbox 四次實測乾淨擋下**(STATUS.md 08-01 段、交易 pcmmoto_CTBC)——
     我和三個面板 lens 原本都以為未實測,codex R1 抓到、我親驗屬實。
   - **全額退款(不帶 amount)已實測**:不受未請款限制、即時生效(`amount`→0、`record_status`=3)。
     (⚠️「即時生效」是 sandbox 實測觀察;營運規則仍維持 Sean F2 拍板「全額當日、部分隔日」的
     保守口徑,**不拿實測去放寬**。)
   - 連動:`docs/reference/tappay-reference.md` §2.3a 尚未補這兩條(見 §5 沒做什麼)。

## 1. 第一片做了什麼(全部是規劃與審查)

- Plan v1→v3:v3 全文 = 附錄 A(契約 = discriminated payload `kind full|partial`、`bankRefundId` 必填
  ^[A-Za-z0-9_-]{1,20}$、rejected allowlist {10051,10024}、`TapPayRefundNotSentError` 分型、預設
  `AbortSignal.timeout(30_000)`、attempt log 先於 fetch、endpoints 抽純模組)。
- 審查三道:面板 3 lens 23 findings / codex R1 20 條 / codex R2 13 條(壓縮原文 = 附錄 B)。
- 主對話親驗過的一手來源(審查者宣稱逐條對過,全數屬實):
  - `STATUS.md` 08-01 段(10024 四次實測、全額退實測、中信 18:00 送批 20:00 可確認)
  - `scripts/tappay-sandbox-refund-probe.py:123-129`(probe 從未送全額退、從未送 bank_refund_id)
  - `packages/domain/src/index.ts:19-22`(barrel `export type *` ⇒ 新 const/class 需顯式 value export,
    比照既有 `AuthError` 前例;實作時必補,否則 typecheck 紅)
  - `supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql:108-110`(bank_refund_id 只限長度
    1-20、無字元集限制)、`:133-140`(tappay_refund_id partial UNIQUE WHERE NOT NULL ⇒ 多筆 processing 可並存)
  - `supabase/migrations/20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:342-348`(P7C10:processing
    期間禁填 tappay_refund_id、轉 confirmed 那次 UPDATE 才寫)
  - `scripts/a7c-verify.sh:112-115`(seed 慣例 `BRID-SEED-01` 含連字號 ⇒ 我原 regex ^[A-Z0-9]{1,20}$ 過嚴)
  - `docs/handoff/2026-08-01-a7c-night-run-handoff.md`(拍板 2/6:退款後台同步發起、**無 worker、
    `order_refund_jobs` 整張表不需要** ⇒ plan v1/v2 引用的 refund_jobs 流程是我編的,已改)

## 2. 第二片 A9f 驗了什麼

改動 5 檔(row47 只列 3 個消費點,實際多 3 個測試檔鎖舊文案,grep 抓出):

| 檔 | 改動 |
|---|---|
| `apps/storefront/src/lib/orders/order-display.ts` | paid 分支固定回「處理中」、刪 `PAID_FULFILLMENT_LABEL`;簽章雙參數保留(`_fulfillment`;契約收縮=A9s 片) |
| `apps/storefront/src/lib/orders/order-display.test.ts` | 20 組矩陣 paid 四列改「處理中」(四列全留=釘「任意 fulfillment 皆同值」) |
| `AccountView.test.tsx` / `OverviewTab.test.tsx` / `OrdersTab.test.tsx` | 各 1 處 `商品寄出`→`處理中` |

- 其餘四值(已退款/待付款/付款確認中/已退部分)grep 驗證零觸碰;`refunded`/`unpaid` 等斷言原樣全綠。
- 目標 4 測試檔 54/54 綠;全套 `pnpm test` + `turbo typecheck` 8/8 + lint + build 綠(見 commit)。
- ⚠️ 環境備註:worktree 根層 `node_modules/.bin` 沒有 `tsc` link(root package.json 無 typescript 直依賴;
  主樹有是 hoist 殘留)⇒ 根層腳本第二段 `tsc -p tsconfig.scripts.json` 以
  `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc -p tsconfig.scripts.json --noEmit`
  等價直跑、綠。非 code 問題、主樹不受影響。

## 3. 沒做什麼(誠實邊界)

- refund() 的 8 檔(types/ports/wire/adapter/endpoints/composition/兩測試)**一行都沒改**。
- sandbox probe 未跑(紅線:本夜零真請求);`bank_refund_id` 的格式接受度/重複鍵行為依然未證。
- `docs/reference/tappay-reference.md` §2.3a 未補 10024/全額退新證據(跨片改文件留給第一片重啟時一併,
  避免本夜多開改動面)。
- 未 push、未動 STATUS/CURRENT、未跑 busboy-end。

## 4. 第一片 v4 處置提案(codex R2 的 10 must-fix + 3 nit,逐條;等 §6 Q1 拍板後執行)

| R2# | 處置 |
|---|---|
| 1(10024 應獨立態) | 採納:Result 加第三態 `status:'deferred'`(=10024、「還不能做」、請款後可重試同一意圖),rejected 只剩 10051 ⇒ 呼叫端 switch 天然分流,不會把 10024 寫成 failed(§6 Q2 請拍) |
| 2(refundId 遺失窗) | 接線債(§7-1):adapter 無法解;v4 在 ITapPayAdapter JSDoc 明文「confirmed 回填失敗時以 Record API 重取比對」+ 驗收條件要求接線片先解 |
| 3(多 processing 並存) | 接線債(§7-2):v4 JSDoc 明文呼叫端必須 same-order single-flight;DB 層約束屬 schema 改動、需 Sean 另拍(本夜不碰 schema) |
| 4(同鍵重試未證) | 併入 sandbox 硬閘 probe 劇本(§7-3):帶 bank_refund_id + 10024→請款→同鍵重試 + 保存 refund_amount 值 |
| 5(domain barrel) | 採納:`index.ts` 補 `export { TAPPAY_REFUND_STATUS, TapPayRefundNotSentError }`(比照 AuthError 前例) |
| 6(payload runtime 型別) | 採納:pre-flight 先驗 payload 為物件、兩 ID 為 string、amount 為物件+amount 為 number,再進格式守門;全部 NotSentError |
| 7(currency 執行期驗) | 採納:partial 加 `amount.currency !== 'TWD'` → NotSentError + fetch 零呼叫測試 |
| 8(composition 接線) | 採納:endpoints 模組改出 `tapPayUrlsFor(env)` 回三 URL 物件、composition 用展開注入 ⇒ 接錯欄位在型別層即不可能;單元測試釘 `tapPayUrlsFor` 的 env↔host↔path |
| 9(regex 邊界測試) | 採納:補正向(小寫+底線+連字號、恰 20 字)與負向(21 字)案例 |
| 10(log 誘餌不足) | 採納:誘餌加 partnerKey canary(config 塞唯一字串,斷言 log 不含)+ rawResponse canary |
| n11(refundId 前後空白) | 採納:含前後空白即拒(throw 格式異常),不做靜默 trim |
| n12(attempt 命名) | 採納:outcome 名改 `attempt_started`(誠實:證明「開始送」非「已送達」) |
| n13(abort 測試鏈) | 採納:沿 A15 自檢式 mock(監聽真 init.signal 才 reject)+ `rejects.toBe(reason)` 驗身分 |

## 5. 建議的重啟路徑(下個 session)

1. Sean 拍 §6 → 照 v4 改 plan(半小時內)→ **關卡1 R3 換角度**(00-work-rules §5 輪次紀律:第 3 輪起
   必須換角度換模型 ⇒ 用 adversarial-reviewer `model:fable` 審 v4,codex 只覆核 R2 十條是否關閉)。
2. R3 過 → 實作 8 檔 → 三綠 + 全套測試 → 關卡2 codex 審 diff → commit(body 寫零呼叫端 + 未證清單)。
3. sandbox 硬閘 probe(§7-3)= **接線片(讓任何人呼叫 refund())前的硬前置**,不是本 adapter 片的前置。

## 6. 決策題(✅ 08-03 早 Sean 已拍板:**Q1=A / Q2=A / Q3=A**;拍板落檔 memory
`project_m3-refund-adapter-gate1-0803-decisions`;工作於同 session 續行 —— plan v4 + 關卡1 R3
換角度〔fable 主審 + codex 覆核〕後實作。以下保留原題供脈絡)

```text
Q1(方向):refund 第一片下一步?
A. 照 §4 v4 處置全採納,下個 session 直接改 plan + R3(fable 換角度)後實作(推薦;R2 十條全部
   有明確修法,無僵局)
B. 你先親自看過附錄 B 的 R2 findings 再放行
C. 這片先擱置,先做別的

Q2(契約):10024「未請款不能部分退」在結果型別怎麼表達?
A. 第三態 status:'deferred'(還不能做、請款後重試;rejected 只剩 10051)(推薦;codex R2#1,
   呼叫端不可能誤標 failed)
B. 維持兩態,10024 併在 rejected、靠 wireStatus 區分(呼叫端要自己記得查)

Q3(sandbox 硬閘 probe):帶 bank_refund_id 的受控 probe(含 10024→請款完成→同一鍵重試、
保存 refund_amount 值以定案語意;全程 sandbox、金額 1-6 元、單視窗持有)
A. 核准,排在 refund 接線片(第一個真呼叫端)之前跑(推薦)
B. 你自己跑(我提供劇本)
C. 先不跑(則 bank_refund_id 冪等與 refund_amount 語意維持「未證、不得依賴」)
```

## 7. A7c 接線債(高風險、接任何呼叫端前必解;來源=codex R1 F4/F5/F10 + R2#2/#3/#4,已親驗)

1. **refundId 遺失窗**:P7C10 禁止 processing 列預填 `tappay_refund_id`,轉 confirmed 才寫 ⇒ accepted 拿到的
   refundId 在「TapPay 受理 → 隔日 confirmed」之間只活在記憶體;行程死掉就沒了 ⇒ 接線片必須定
   「以 Record API 重取比對」的覆核路徑(隔日覆核 RF8 本來就要做,把 refundId 比對納入)。
2. **同單雙擊雙退**:`order_refunds` 多筆 processing 可並存(partial UNIQUE 只鎖非 NULL tappay_refund_id)
   + 併發重複退未實測 ⇒ 接線片要 same-order single-flight(advisory lock 或 UI + server 雙層),
   DB 約束若要加=schema 高風險片另拍。
3. **sandbox 硬閘 probe**(§6 Q3):bank_refund_id 從未被送過;格式接受度、重複鍵行為、10024 後同鍵
   重試、refund_amount 語意(本次 vs 累計)四件事一發 probe 全定案。

---

## 附錄 A:plan v3 全文(關卡1 R2 的受審版)

(自 scratchpad 原樣收錄;§7 對照表所指 R1 編號見附錄 B 前段說明)

### A.0 證據分級

已證(sandbox 真打 API;兩個獨立 probe session):多次部分退款(各自 refund_id、refunded_amount 累加)/
10051 超額退乾淨擋下零副作用(兩組獨立邊界)/ 10024 四次全擋零副作用(pcmmoto_CTBC;A7b-T 拍板:
必須認成「還不能做」非「失敗」)/ 全額退款已實測(不受未請款限制、即時生效)。

未證(設計不得依賴):①bank_refund_id 從未被送過(冪等/格式/重複鍵全未證)⇒ 接線前 sandbox 硬閘
②併發重複退(只證過序列)③refund_amount 語意(本次 vs 累計;#301 同型坑)④生效時點營運規則維持
「部分退隔日、全額當日」(Sean F2 拍板、刻意保守、不拿實測放寬)。

呼叫端真實形狀(A7c 拍板 08-01):後台同步發起、無 worker、無 order_refund_jobs;帳本 order_refunds
先 INSERT processing 列(含 bank_refund_id)再呼叫;tappay_refund_id 轉 confirmed 才寫(P7C10)。

### A.1 契約

```ts
export const TAPPAY_REFUND_STATUS = {
  OUT_OF_RANGE_AMOUNT: 10051,   // 超額退;實證零副作用
  NOT_CAPTURED_PARTIAL: 10024,  // 未請款不能部分退;實證零副作用;「還不能做」非「失敗」
} as const;
export type TapPayRefundRejectedCode =
  (typeof TAPPAY_REFUND_STATUS)[keyof typeof TAPPAY_REFUND_STATUS];

/** pre-flight 拒絕=確定未送出;其他一切 throw=unknown-state、絕不自動重發。 */
export class TapPayRefundNotSentError extends Error { name = 'TapPayRefundNotSentError' }

export type TapPayRefundPayload =
  | { kind: 'full'; transactionId: string; bankRefundId: string }
  | { kind: 'partial'; transactionId: string; amount: Money; bankRefundId: string };
// bankRefundId 必填=呼叫前 durable 歸屬鍵(帳本先寫後呼);非冪等保證;^[A-Za-z0-9_-]{1,20}$

export type TapPayRefundResult =
  | { status: 'accepted'; refundId: string; refundAmount: MoneyAmount /* 語意未證、不得入帳本推算 */;
      isCaptured?: boolean; bankRefundId: string; rawResponse: unknown }
  | { status: 'rejected'; wireStatus: TapPayRefundRejectedCode; msg: string;
      bankResultCode?: string; rawResponse: unknown };
// (R2#1 → v4 擬拆第三態 'deferred' 給 10024,見本檔 §4/§6 Q2)
```

Port:`refund(payload, options?: TapPayRefundOptions)`;`TapPayRefundOptions = { signal?: AbortSignal }`;
未給 signal → 預設 `AbortSignal.timeout(30_000)`(與 recordQuery 刻意不同,理由:動真錢的同步呼叫
hang 住=值班重按=重複退窗;官方建議 30s);ITapPayAdapter.ts:69-79 過時交辦段同步改寫。

### A.2 檔案面(8 檔)

domain/payment/types.ts(契約)/ ports/ITapPayAdapter.ts(簽章+JSDoc)/ adapters/tappay/wire.ts
(parseTapPayRefundResponse 白名單:status/msg/refund_id/refund_amount/is_captured/bank_result_code;
bank_result_msg 刻意不解析;is_captured typeof boolean)/ adapters/tappay/TapPayChargeAdapter.ts
(config.refundUrl + refund())/ **新** storefront lib/payment/tappay-endpoints.ts(env→host 單一綁定
+ 三端點;治 sandbox/prod 對調全綠)/ **新** tappay-endpoints.test.ts / composition.ts(改 import +
注入)/ TapPayChargeAdapter.test.ts + wire.test.ts。
波及面:Refund 型別零外部構造點;use-case mocks 全 `refund: vi.fn()`;`new TapPayChargeAdapter(`
只有 composition + 測試。⚠️ 另需 domain/src/index.ts 補 value export(R2#5)。

### A.3 實作順序(fail-closed)

①pre-flight(全部 NotSentError、fetch 零呼叫):kind runtime 守門 / transactionId ^\S{1,20}$ /
bankRefundId 格式 / partial 金額正整數(不信 brand)②attempt log(fetch 前)③body:kind 判斷帶
amount、非 truthy ④fetch(30s 預設 signal)⑤!ok→throw;parse:status 非 number→throw
⑥status=0→**先 outcome log** →缺 refund_id(含全空白)或 refund_amount→throw /格式異常/(訊息帶
refundId)→accepted ⑦allowlist 碼→rejected ⑧其餘非 0→log 後 throw。
log 只記 recTradeId/outcome/wireStatus/refundId/bankRefundId/bankResultCode/kind/amount。
不做:自動重試 / refund_amount===請求額斷言(語意未證,累計值會誤殺第二次部分退)/ 生效輪詢 /
generateBankRefundId。

### A.4 測試矩陣(25 組;每格 fetch 次數斷言)

送出面 5(全額退無 amount 鍵+headers、部分退、accepted 全鍵 toEqual、is_captured 缺/false 兩格)/
rejected 3(10051、10024、非 allowlist 421+99999→throw 不得 rejected)/ unknown 6(HTTP、transport
+attempt log 已落、非物件、缺 refund_id、全空白 refund_id、缺 refund_amount+log 已含 refundId)/
pre-flight 4(非法 kind、transactionId 邊界、bankRefundId UUID/空白、amount 0/-50/1.5;全部
NotSentError+fetch 零呼叫)/ signal 4(自帶、spy AbortSignal.timeout(30000)、自訂 reason 原樣、
TimeoutError 原樣)/ log-PII 3(accepted/rejected/unknown 各埋誘餌)/ wire 直測 / endpoints 對調即紅。

### A.5 驗收 + rollback

三綠 + 全套 vitest + 既有測試零改動零紅;grep 零真端點;commit body 寫未證清單。
worktree 獨立 branch 不合併=零影響;無 schema/env/部署面。

## 附錄 B:codex 關卡1 R2 findings 原文壓縮(10 must-fix + 3 nit)

R1 20 條的處置對照 codex 判定:17 已解、3 部分解(部分解=F4/F5 接線債與 F11/F14 的殘餘,均已併入下列)。

1. 10024 回 rejected 易被呼叫端寫成 failed、違反「還不能做」拍板 → 應獨立 deferred 態【must-fix】
2. refundId 遺失窗(P7C10 processing 禁填)只丟 handoff 無驗收 → 接線片硬前置【must-fix】
3. 多筆 processing 並存 + 併發未測,「需 single-flight」無可執行約束【must-fix】
4. 單次帶鍵 probe 證不了「10024 後請款完成同鍵重試」;若 10024 已消耗該鍵,安全重試失效【must-fix】
5. domain barrel `export type *`,新 const/class 匯不出 → typecheck 必紅;plan 未列 index.ts【must-fix】
6. pre-flight 缺 runtime 型別檢查:null payload 拋原生 TypeError、數字 ID 過 RegExp 隱式轉字串被送出【must-fix】
7. 只驗 amount.amount 不驗 currency:{amount:100,currency:'USD'} 照送【must-fix】
8. endpoints 純模組測試證不了 composition 真的把 refundUrl 接到 refund 欄【must-fix】
9. bankRefundId 測試缺正向(小寫/底線)與 20/21 邊界,實作寫錯字元集或上限抓不到【must-fix】
10. log 誘餌缺 partnerKey/rawResponse canary,request body 誤入 attempt log 測不到【must-fix】
11. ' DR123 ' 通過並原樣入帳,與查回值比不穩 → 拒前後空白【nit】
12. fetch 前 log 只證「開始嘗試」,命名 attempt_started 防事故誤讀【nit】
13. abort 測試應監聽真 init.signal 才 reject + rejects.toBe(reason) 驗身分【nit】
