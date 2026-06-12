# M-3 階段②-② TapPayChargeAdapter + PaymentConfirmerAdapter + confirm-payment use-case — 執行側 plan

> 寫審分離 ROLE=A 執行側。鐵則 8 引入 `pg`(node-postgres)= Sean 2026-06-12 **A1=A 批准(條件式)**(review-log L24-30)。
> 本 plan 在寫 code 前**逐條落實** Sean 批准前置:🔴 BLOCKER(PF-X3 型別洞)+ 3× 🔴 MUST-FIX(server subpath / 孤兒單契約 / cardholder 來源)+ 8× 🟡 SHOULD。審查側 commit 後逐條驗。
> 真權威:`docs/specs/2026-06-04-m3-checkout-plan.md` v6 §7 + `docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md` §7/§3/§3.7 + 本批准 review-log 段。

---

## 0. 範圍 + 子片切法(鐵則 4:每片 15-45 min)

階段②-② = **付款 adapter 層 + 編排 use-case**(無 server action〔②-③〕、無前端〔②-④〕、無 webhook〔②-⑥〕)。為鐵則 4 + codex 關卡2 聚焦,拆兩子片(自然接縫=charge 側 vs confirm+編排側):

- **②-②a(charge 側)**:BLOCKER 型別修 + `TapPayChargeAdapter`(pay-by-prime sandbox、wire→domain、PII mask #16)+ server.ts 匯出 + adapter 單元測。**不含 pg**。
- **②-②b(confirm + 編排側)**:`IPaymentConfirmer` port + confirm 型別 + `PaymentConfirmError` 分類 + `PaymentConfirmerAdapter`(pg、Supabase session pooler + 完整 CA 驗證〔§6 ① 修正、原「直連 5432」作廢〕)+ `confirmPayment` use-case(孤兒單契約 outcome)+ composition root(受控 server subpath 注入)+ `package.json` 加 pg + master plan §3.2 webhook override 更新 + 測。

每片獨立三綠 + code-reviewer + codex 關卡2(鐵則 12 payment),精準 add、STATUS 7 欄同 commit、不 push。

**內容分級**:全 L1(金流型別/adapter/use-case=程式結構、非內容)。鐵則 8 已批(pg)。鐵則 3:本片無前台 UI(adapter+use-case 是後端地基,前端在 ②-④);鐵則 3「前後台同步」對應=本片落 backstop,UI 在後續片,審查可見契約已定。鐵則 5 不適用(無 CSS+TSX)。鐵則 6:各檔目標 <300 行(見 §7)。

---

## 1. 真權威事實(已 grep、file:line)

| 事實 | 來源 |
|---|---|
| `TapPayChargeResult = { status; transactionId; rawResponse }` **無 amount 欄** | `packages/domain/src/payment/types.ts:48-54` |
| `TapPayChargePayload.amount: Money`(非裸整數) | 同上 L35-41 |
| `Money = { amount: MoneyAmount(brand 整數非負); currency: 'TWD' }`;`toMoneyAmount()` 集中守門、**禁 `as MoneyAmount`** | `packages/domain/src/shared/types.ts:17-52` |
| `ITapPayAdapter = { charge; refund }` | `packages/ports/src/ITapPayAdapter.ts:15-18` |
| confirm RPC = `confirm_order_payment(p_order_id uuid, p_amount integer, p_rec_trade_id text) RETURNS jsonb {confirmed,idempotent}`;只 `payment_confirmer` 可呼;業務拒絕單一通用訊息(PF-E、#219) | `supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql:117-211` |
| `/server` subpath 二分法:root barrel=可進 client/RLS-protected;`@pcm/adapters/server`=持密鑰金流敏感(WalletAdapter/AuthAdapter) | `packages/adapters/src/server.ts:20-31` + `package.json` exports |
| eslint `no-restricted-imports` 擋 `apps/storefront/**` import `@pcm/adapters/server`;**唯一受控門**=composition root inline `// eslint-disable-next-line` + 意圖註解 | `eslint.config.js:110-126` + `apps/storefront/src/lib/auth/composition.ts:21-22` |
| adapter 邊界 boundaries 規則:adapters 只可 import domain+ports(外部 SDK 如 pg/server-only 不在 boundaries、不擋) | `eslint.config.js:8,92` |
| domain Error class 慣例:`code` union + `Error` 子類 + `readonly code` + `name`(可測 `err.code`、非比 message 字面) | `packages/domain/src/order/errors.ts:46-54` |
| TapPay pay-by-prime:`POST https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime`、header `x-api-key`+`Content-Type`、body `{partner_key,prime,amount(整數),merchant_id,order_number(訂單識別、若帶不能為空),details,cardholder:{name,email,phone_number 官方標必填(*)}}`、success resp `{status:0,msg,rec_trade_id,bank_transaction_id,amount(整數),currency,card_info,...}` | context7 `/tappay/tappay-web-example`(基本欄)+ WebFetch 官方 `docs.tappaysdk.com/tutorial/zh/back.html`(order_number + cardholder 必填性) |

---

## 2. 🔴 BLOCKER 解 — PF-X3 型別洞(採 option A:擴 `TapPayChargeResult.amount: Money`)

PF-X3(本片唯一在地金額防竄改縱深、webhook 在 ②-⑥)需「charge 實扣 == server total」。現 `TapPayChargeResult` 無 amount → 寫不出來。**採 (A) 擴型別**(比 (B) 在 use-case 解 rawResponse 乾淨:wire↔domain 映射留在 adapter 邊界、對齊既有 ChargeStatus 映射紀律):

- `packages/domain/src/payment/types.ts`:`TapPayChargeResult` 加 `amount: Money`(JSDoc 註明=TapPay 回報實扣金額、供 use-case PF-X3 比對 server total)。
- `TapPayChargeAdapter`:從 wire `amount`(整數)+ `currency` 建 `Money`:`{ amount: toMoneyAmount(wire.amount), currency }` + **🔴 currency 斷言='TWD'**(SHOULD ⑤單位斷言;非 TWD → 視為金額異常、見 §4 charge 失敗映射)。**禁 `result.amount` 對不上型別、禁 `as any`**。
- `confirmPayment` use-case:`charge.amount.currency !== total.currency || charge.amount.amount !== total.amount` → 不 confirm、回孤兒 `amount_mismatch`(§4)。
- TWD 兩側皆元位整數(`shared/types.ts:24` NT$4000→4000;TapPay TWD amount 亦元位整數)、1:1 無換算;整數比對、零浮點。

---

## 3. 🔴 MUST-FIX 1 解 — server subpath 隔離(結構守門、寫進驗收)

`PaymentConfirmerAdapter` 持 `PAYMENT_CONFIRMER_DB_URL`(raw DB credential、敏感度≥service_role)、`TapPayChargeAdapter` 持 Partner Key(server-only secret)→ **兩者皆住 `@pcm/adapters/server` 子路徑、非 root barrel**:

- 兩 adapter 檔頭 `import 'server-only'`(編譯期擋 client import、鏡像 WalletAdapter)。
- 從 `packages/adapters/src/server.ts` 匯出(非 `index.ts` root barrel)。
- composition root(`apps/storefront/src/lib/payment/composition.ts`、新建、`import 'server-only'`)是**唯一受控注入點**:`// eslint-disable-next-line no-restricted-imports` + 意圖註解 import from `@pcm/adapters/server`(鏡像 `auth/composition.ts:21-22` AuthAdapter 前例)。
- **結構守門 = eslint `no-restricted-imports` 擋全部 storefront import、只剩 composition root 顯式 disable**(放 root barrel 則 eslint 不擋=只剩單層 server-only、無 lint 結構守門)。
- **同時解 pg tree-shaking 污染**:`pg` 只在 server subpath adapter import → 不進 root barrel → `lib/products.ts`(import root `@pcm/adapters`)的 module graph 零 pg。
- ✅ **驗收 yes/no(非只靠 grep)**:`PaymentConfirmerAdapter`+`TapPayChargeAdapter` 只從 `@pcm/adapters/server` 匯出、不在 `index.ts`;`pg` 只在 `packages/adapters/src/payment/` import;composition root 為唯一 storefront import 點 + inline eslint-disable + server-only 檔頭;`grep -r "@pcm/adapters/server" apps/storefront` 只命中 composition root(2 檔:auth + payment)。

---

## 4. 🔴 MUST-FIX 2 解 — 孤兒單契約(use-case 回明確 outcome、非 generic 失敗)

`confirmPayment` use-case **回 discriminated union outcome**(禁沿用 placeOrderAction「catch 吞 generic 失敗」;否則使用者再按付款 → PF-X2 雙扣、per-order 鎖在 ②-③ 還沒有):

```ts
// packages/domain/src/payment/types.ts
export type ConfirmPaymentOutcome =
  | { kind: 'paid'; idempotent: boolean }                  // charge ok + 金額符 + confirm ok → 完成頁
  | { kind: 'charge_failed' }                              // charge 業務失敗(卡拒等)、未扣款 → 可安全重試
  | { kind: 'charge_unknown'; orderId: OrderId }           // charge transport 失敗、扣款狀態未知、無 rec_trade_id → 勿重刷
  | {
      kind: 'orphan';
      reason: 'amount_mismatch' | 'confirm_unreachable' | 'confirm_rejected';
      transactionId: string;                               // 🔴 charge 成功當下保住 rec_trade_id(②-⑥ 對帳唯一時點、別等)
      orderId: OrderId;
    };
```

use-case 邏輯(§7 confirm-payment.ts):

1. `charge` transport throw(網路/timeout、TapPay 未回)→ `{ kind: 'charge_unknown', orderId }`(無 rec_trade_id、勿重刷、②-⑥ webhook 經 order 對帳)。
2. `charge.status === 'failed'`(TapPay status≠0、卡拒)→ `{ kind: 'charge_failed' }`(definitively 未扣款、可重試)。
3. PF-X3:`charge.amount` ≠ server total(幣別或數額)→ `{ kind: 'orphan', reason: 'amount_mismatch', transactionId, orderId }`(已扣款、不 confirm)。
4. charge ok + 金額符 → `confirmer.confirm`:
   - 成功 → `{ kind: 'paid', idempotent: result.idempotent }`。
   - throw `PaymentConfirmError('unreachable')`(連線層/timeout、見 §6 SHOULD ③)→ `{ kind: 'orphan', reason: 'confirm_unreachable', transactionId, orderId }`。
   - throw `PaymentConfirmError('rejected')`(RPC RAISE)→ `{ kind: 'orphan', reason: 'confirm_rejected', transactionId, orderId }`。

**②-③ action 映射(本片只定契約、實作在 ②-③)**:`paid`→完成頁;`charge_failed`→「付款失敗、請確認卡片資訊後重試」(可重試);`orphan`/`charge_unknown`→**「付款已收、處理中、請勿重複付款、如有疑問請聯繫客服 LINE」**(非 generic)+ 寫 charge-attempt 紀錄(orphan 帶 transactionId+orderId;charge_unknown 只 orderId)。重試一律走「重呼 confirm 冪等」非重 charge;前端成功真相=`paid`(非 charge.status)。

**TapPay 端對帳回連(②-②a adapter 落地)**:charge body 帶 `order_number = orderId`(TapPay 訂單識別欄、官方 WebFetch 核實);孤兒(charge_unknown 無 rec_trade_id)時 ②-⑥ webhook(notify)+ TapPay Record API 靠 `order_number` 回連 PCM order 自癒,不只靠本地 charge-attempt 紀錄。

---

## 5. 🔴 MUST-FIX 3 解 — cardholder 來源政策(單一來源 + LINE 無 email fallback + PII #16)

`Cardholder = { name; email; phoneNumber }`(三欄皆必填、`domain/payment/types.ts:26-33`)。TapPay 官方標 name/email/phone 必填(*)。本片 use-case/adapter **只透傳** cardholder(不組裝);組裝在 ②-③ server action。**但政策本片定死**:

- **單一來源**:cardholder 由 ②-③ server action 從 **server session(`supabase.auth.getUser()` 的 `user`)** 組裝、client 永不送 cardholder(防竄改、對齊 placeOrder 零信任)。
  - `email` ← `user.email`(Supabase 權威);`name` ← customers.name(profile);`phoneNumber` ← **結帳地址 phone**(恆有、address 必填 phone)。
- **🔴 `Cardholder.phoneNumber` 型別層必填**(②-②a 落地、codex 關卡2 round1 對齊 TapPay 官方 name/email/phone 必填):移除 email/name 必填而 phone 可選之不對稱;adapter 直送不 `?? ''`(官方雖容空字串、但 fail-closed 強制 ②-③ 供真 phone)。
- **🔴 LINE 無 email fallback**:LINE 登入用戶常無真 email(M-1-14e-f2 合成 email `*@line.pcmmotorsports.local`、Q3=A 固定常數網域)。TapPay 只驗 email **格式**(非可達性),合成 email 格式合法 → sandbox 可過。production 真卡前須換真 email = **follow-up backlog(標 ②-④/上線前;sandbox 占位可用合成 email)**。
- **PII #16(本片 adapter 落地)**:`TapPayChargeAdapter` logging **必 mask** cardholder(email/phone/name 不入 log 明文)、`rawResponse` **不直接寫 log**(只記 status + rec_trade_id + 是否成功)。
- ②-③ 組裝 cardholder 時:無 `user.email`(理論不該、合成 email 已保底)→ fail-closed 拒付款(不送空 email 給 TapPay)。本片在 use-case input 型別層要求 `cardholder` 必帶(型別保證 ②-③ 必組)。

---

## 6. 🟡 SHOULD 解(8 條)

1. **連線端點 ~~直連 5432~~ → Supabase session pooler**(🔴 2026-06-12 端到端實測修正、原「直連 5432」作廢):`PAYMENT_CONFIRMER_DB_URL` = `postgresql://payment_confirmer.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:5432/postgres`。**原因**:直連 host `db.<ref>.supabase.co` 為 **IPv6-only(無 A record)**、本機 + Vercel(IPv4)皆 ENOTFOUND → 直連對部署目標根本不可行。**SECDEF 不斷**:先前「pooler 呼 SECDEF 必斷」是 **MCP + SET ROLE** 情境(memory `pooled-mcp-set-role-secdef-terminates`);本 adapter **直接以 payment_confirmer 登入(無 SET ROLE)**、實測 session pooler(5432、非 transaction 6543)呼 confirm SECDEF 正常,且 session 模式無 transaction-pooler prepared-statement 陷阱。**SSL**:adapter `ssl:{ca:Supabase Root 2021 CA, rejectUnauthorized:true, servername:host}` 強制 verify-full(完整鏈+hostname);pooler 憑證 SAN `*.pooler.supabase.com` 涵蓋 host。🔴 **codex 關卡2 修正**:不可把 connectionString + ssl 物件同傳 pg(實測 pg 8.21 連線字串 `sslmode` 會覆蓋/弱化 ssl 物件:`no-verify`→不驗、`disable`→TLS 關、`require`→丟 CA;反向測試 bogus CA + sslmode=no-verify 竟連上=沒驗證)→ adapter 改**解析連線字串為離散欄位 + 剝除所有 SSL query 參數**(buildPgConfig)、唯一指定 CA 驗證,連線字串 sslmode 無法弱化。🔴 **host 釘死 + 顯式 servername 強制**(審查側 codex 追加、MITM 縱深):pg 只對 DNS host(`net.isIP(host)===0`)設 TLS servername、IP/非-pooler host 會使 hostname 驗證未強制(「verify-full」對 IP 不成立的字面vs事實縫)→ buildPgConfig 強制 host 為 `POOLER_HOST_RE`(`aws-<N>-<region>.pooler.supabase.com`、非 IP/非空、否則 throw→unreachable)+ 顯式 `ssl.servername=host`,verify-full 對所有輸入真成立。端到端實測:CA 驗證 + payment_confirmer 登入 + SECDEF RPC + 窄權 全 PASS、零訂單異動;負向測試:bogus CA 必被擋、IP/非-pooler host 必被拒。
2. **PF-A happy-path flip**:RPC happy unpaid→paid 已 migration MCP C1-C8 實證(review-log L34「C1-C8 全綠:happy unpaid→paid」);adapter 單元測用 fake pg client 覆蓋「成功回 JSON→parse {confirmed,idempotent}」路徑。**真 payment_confirmer pg 連線 round-trip 已於 ②-②b-fix 端到端實測 PASS**(2026-06-12 session pooler + 完整 CA 驗證真連線:payment_confirmer 登入〔current_user=payment_confirmer〕+ confirm SECDEF RPC 可執行〔不存在訂單正確 RAISE P0001、零 UPDATE〕+ 窄權〔直查 orders permission denied 42501〕全 PASS;原「MCP SET ROLE+SECDEF 必斷」確認=直接以 payment_confirmer 登入無 SET ROLE 故不適用)。②-③ 只需 charge action 整鏈 smoke + Sean 肉眼驗。
3. **confirm 失敗分類 + finally end()**:`PaymentConfirmerAdapter` 分類連線層(connect/transport/timeout=可重試 confirm)vs RPC RAISE(SQLSTATE `P0001`=孤兒不重 charge);`connectionTimeoutMillis`(8s,對齊 RPC statement_timeout)+ **`finally { await client.end() }` 永遠釋放連線**。
4. **use-case 解讀 confirm outcome 契約**:confirm 回 JSON `{idempotent t/f}`=成功(`paid`);charge 後任何 `PaymentConfirmError`=孤兒處置不重刷(§4)。
5. **grep 結構守門 + pattern 精準**:client bundle grep 用精準 pattern(套件名 `from 'pg'` / env 名 `PAYMENT_CONFIRMER_DB_URL` / `PARTNER_KEY` / host`tappaysdk` 非裸 `'pg'`),避免誤命中。
6. **威脅模型**:plan 寫明「env 洩漏風險已被 DB 窄權吸收」=`payment_confirmer` 無 table 權限、只 EXECUTE confirm RPC、最壞=拿 confirm RPC 當差勁 oracle(問不出 total/存在性/rec、PF-E 通用訊息)(review-log L24)。
7. **Edge Function 持連線方案**:per-request `new Client()` + `end()`(Phase 1 Vercel Fluid Compute 可接受);持久連線池 / Edge Function 常駐連線 **明記 Phase 2**(觸發判據=confirm QPS 高到 per-request 連線握手成瓶頸 / Supabase 連線數逼近上限)。
8. **PF-A prod 操作標記**:②-③ 真連線 round-trip 跑時標 prod 操作 + 跑後驗 `orders` count 不變(synthetic 單 ROLLBACK)。本片 adapter 單元測零碰真 DB。

---

## 7. 逐檔設計(鐵則 6 檔大小目標 <300 行)

**②-②a:**(只 charge 側型別 + adapter;confirm/outcome 型別在 ②-②b 隨消費者落地)
- `packages/domain/src/payment/types.ts`(改):**僅** `TapPayChargeResult` 加 `amount: Money`(BLOCKER PF-X3)+ `Cardholder.phoneNumber` 改必填(對齊 TapPay 官方 name/email/phone 必填、移除不對稱;②-③ 從地址 phone 取)。confirm/outcome 型別(`ConfirmPaymentOutcome`、`ConfirmOrderPaymentInput/Result`、`ConfirmPaymentInput`)**移 ②-②b** 與 port/use-case 同片落地。
- `packages/adapters/src/tappay/wire.ts`(新):TapPay wire resp 型別 + `parseTapPayResponse`(防禦性 narrow:status 整數 / rec_trade_id 字串 / amount 整數 / currency 字串)。
- `packages/adapters/src/tappay/TapPayChargeAdapter.ts`(新、`import 'server-only'`):`implements ITapPayAdapter`。constructor 收 `TapPayChargeConfig { partnerKey; merchantId; payByPrimeUrl }`(env 由 composition root 讀、DI 注入、可測)。`charge`:組 body→`fetch`(x-api-key)→parse→status0?succeeded:failed;succeeded 建 `result.amount=toMoneyAmount(wire.amount)`+currency 斷言;transport error→throw(use-case 映 charge_unknown);PII mask logging。`refund`:Phase 1 未接 → `throw new Error('TapPay refund 未實作(Phase 2)')`(誠實、滿足 interface)。
- `packages/adapters/src/server.ts`(改):加 `export { TapPayChargeAdapter, type TapPayChargeConfig }`。
- 測:`TapPayChargeAdapter.test.ts`(vi.stubGlobal fetch):success→succeeded+amount Money;status≠0→failed;transport throw 傳遞;非 TWD currency→失敗映射;PII 不入 log(spy console);wire parse 防禦。

**②-②b:**
- `packages/domain/src/payment/types.ts`(改):新增 `ConfirmOrderPaymentInput = { orderId: OrderId; amount: Money; recTradeId: string }`、`ConfirmOrderPaymentResult = { confirmed: boolean; idempotent: boolean }`、use-case input `ConfirmPaymentInput = { prime: string; orderId: OrderId; amount: Money; cardholder: Cardholder }`、`ConfirmPaymentOutcome`(§4 discriminated union)。
- `packages/domain/src/payment/errors.ts`(新):`PaymentConfirmErrorCode = 'unreachable' | 'rejected'` + `class PaymentConfirmError extends Error`(鏡像 OrderError)。
- `packages/domain/src/index.ts`(改):export `PaymentConfirmError` + `PaymentConfirmErrorCode`(type)。
- `packages/ports/src/IPaymentConfirmer.ts`(新):`interface IPaymentConfirmer { confirm(input: ConfirmOrderPaymentInput): Promise<ConfirmOrderPaymentResult> }`。
- `packages/ports/src/index.ts`(改):`export type * from './IPaymentConfirmer'`。
- `packages/adapters/src/payment/PaymentConfirmerAdapter.ts`(新、`import 'server-only'`、`import { Client } from 'pg'`):`implements IPaymentConfirmer`。constructor 收 `connectionString` + 可選 `clientFactory`(預設 `(c)=>new Client(buildPgConfig(c))`、測試注 fake `PgClientLike`)。🔴 `buildPgConfig(c)`(codex 關卡2 修正、可測 export):URL 解析成**離散欄位** `{host, port, database, user, password〔decodeURIComponent〕}` + **host 釘死**(`POOLER_HOST_RE=/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/` allowlist + 非空 + `net.isIP(host)!==0` 拒 IP literal、否則 throw〔通用訊息、confirm() try 內 → unreachable〕、MITM 縱深)+ **剝除 SSL query 參數**(sslmode/ssl/sslcert/sslkey/sslrootcert/uselibpqcompat)+ adapter 唯一指定 `ssl:{ca:SUPABASE_ROOT_CA_2021, rejectUnauthorized:true, servername:host}`(顯式 servername 令 hostname 驗證不依賴 pg 隱式 IP 判斷)+ connectionTimeoutMillis 8s + query_timeout 12s;**不傳 connectionString 給 pg**(防 pg 8.21 URL sslmode 弱化 ssl 物件)。`confirm`:`clientFactory`(納入 try、buildPgConfig throw 歸 unreachable)→`connect`→`query('SELECT public.confirm_order_payment($1::uuid,$2::integer,$3::text) AS result',[orderId, amount.amount, recTradeId])`→parse rows[0].result→`{confirmed,idempotent}`;catch 分類(`err.code==='P0001'`→rejected 否則 unreachable)throw `PaymentConfirmError`;`finally`(client 存在才)`end()`。
- `packages/adapters/src/server.ts`(改):加 `export { PaymentConfirmerAdapter }`。
- `packages/adapters/package.json`(改):deps 加 `"pg"` + devDeps 加 `"@types/pg"`(版本見 §8)。
- `packages/use-cases/src/confirm-payment.ts`(新):`confirmPayment(deps: { tappay: ITapPayAdapter; confirmer: IPaymentConfirmer }, input: ConfirmPaymentInput): Promise<ConfirmPaymentOutcome>`(§4 邏輯;薄編排、守 boundary 不 import schemas)。
- `packages/use-cases/src/index.ts`(改):`export { confirmPayment } from './confirm-payment'`。
- `apps/storefront/src/lib/payment/composition.ts`(新、`import 'server-only'`):`getTapPayAdapter()`(讀 `TAPPAY_PARTNER_KEY`/`TAPPAY_MERCHANT_ID`/sandbox url env→`new TapPayChargeAdapter`)+ `getPaymentConfirmer()`(讀 `PAYMENT_CONFIRMER_DB_URL`→`new PaymentConfirmerAdapter`);inline eslint-disable 受控 import from `@pcm/adapters/server`;env 在 factory 內讀(per-request、不 module-top throw)。
- `docs/specs/2026-06-04-m3-checkout-plan.md`(改):§3.2 webhook「不做」移出、記 Sean 2026-06-11 override + 理由(kickoff §3.7 PF-X1 執行側下次 commit 改)。
- 測:`PaymentConfirmerAdapter.test.ts`(fake PgClientLike):happy→{confirmed,idempotent};P0001→rejected throw;connect 失敗→unreachable throw;57014→unreachable;`end()` 永遠呼(含 throw 路徑)。`confirm-payment.test.ts`(fake adapters):6 outcome 全覆蓋(paid/idempotent paid/charge_failed/charge_unknown/amount_mismatch/confirm_unreachable/confirm_rejected)。

---

## 8. pg 版本 + 依賴

- `pg`(node-postgres)最新穩定 major(寫前 `npm view pg version` 確認、釘明確版本非 `^latest` 憑記憶);`@types/pg` 對應。加進 `packages/adapters/package.json`(非 root、非 catalog;adapters 專屬)。`pnpm install` 後驗 lockfile。
- adapter import `from 'pg'`(boundaries 不擋外部 SDK);`server-only` 已在 adapters deps。

---

## 9. 鐵則自檢

- 鐵則 1:無前台 design 元件(adapter+use-case);TapPay 欄位 context7 核實非憑記憶。
- 鐵則 3:本片=金流地基 backstop;前端 ②-④、charge action ②-③(契約本片定)。
- 鐵則 6:各檔 <300 行目標;超 400 拆。
- 鐵則 8:pg 已批(A1=A 條件式)、本 plan 落實條件。
- 鐵則 9:全 L1。
- 鐵則 11:每片三綠(動 .ts → typecheck+lint+build)+ 完整 pnpm test。
- 鐵則 12:payment/RPC/金額 → 每片 codex 關卡2 必跑(硬上限 2 輪)。

## 10. 禁止清單

不改 scope 外檔 / 不變 env·deployment(env 由 Sean 設)/ 不碰 orders·order_items 表結構 / 不開經銷價同步(階段⓪硬 gate、本片恆 general、零價/cost 觸及)/ 不寫死密碼·金鑰(DI 注入、composition root 讀 env)/ 不用 MCP 寫正式庫 / pg 不進 root barrel / 不用 `git add .`·`-A`(精準 add)/ 不自動 push / 不動 `.env*`。
— 禁止清單結束 —
