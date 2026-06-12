# M-3 階段②-③ charge server action — 執行 plan v6(2026-06-12、codex 關卡1 round1-5 全收斂 + Sean 拍板)

> round5 收斂:MF1 markFailed 主軌 ×3 重試、全敗 → charge_failed(recordPersisted:false)→ 新 charge_failed_wait 回傳態(誠實「未扣款 + 請稍候」、不誘導立即重試、不謊稱已收)/ MF2 token hash 規格釘死(migration 私有 helper 單一真相、64 lower-hex CHECK、PG17 builtin sha256)/ MF3 RPC 數量字面校正(4 支 = 3 主軌 + 1 備軌)/ MF4 ACL 驗收逐角色拆明(service_role 表 SELECT=true 其餘 false、與 §2 矩陣一字不差)。

> round4 收斂:MF1 備軌 request-scoped(`getChargeAttemptStore` 改 async、注入 cookie JWT client;否則備軌 auth.uid()=null 靜默退化單軌)/ MF2 備軌加 **server-only fallback token**(begin 產生、DB 存 sha256 hash、明文只在 server 記憶體;無 token 任何 authenticated 直呼全拒 → 偽造/誤鎖面關死)/ C 重試次數與退避入驗收(主 ×3、備 ×2、tests 鎖死)。

> round2 收斂:MF1 per-user 閘補 charged-未-paid 視窗 / MF2 → **Sean 駁回「殘餘風險接受」、改完整修(v4 雙軌寫入、§3)** / C1 ②-⑥ 正名 webhook 主 + Record API 輔 / C2 ②-③c 拆兩 commit、②-③a 維持單片(migration 原子性、鏡像 ②-① 前例)/ NIT cardholder profile 讀取路徑入 §5+§10。
> round3(Sean D1=B 授權)收斂:MF「markCharged 敗 + confirm 成功 → pending 誤卡 per-user 閘」+「amount_mismatch 跳過 confirm 分支漏列」→ 閘 predicate 統一 join orders + 雙軌寫入 + confirm 成功後收斂重試(§2/§3/§6)/ C「locked 對未扣款新單說錯話」→ begin 回 reason、新 in_flight 回傳態不帶 displayId(§7)。
> Sean 指令(2026-06-12):「我要完整修好,不能簡單 pass」→ PF-X1 麵包屑從「殘餘風險接受」升級為**每條失敗分支皆有確定性 DB-或-TapPay-durable 紀錄 + 恢復路徑**(§3)。

> 真權威:kickoff `docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md` §7 ②-③ + §3.7 PF-X1/X2/X3
> + ②-② plan `docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md` §4(孤兒契約)§5(cardholder 政策)
> + Sean 2026-06-12 ②-③ 開工指令(六件套、鐵則 12 六條 + 禁止清單)。
> 鐵則 8 命中(新 schema migration + 跨 3+ 檔 + payment)→ 本 plan 過 codex 關卡1(round1 FAIL→v2)。
> 前序地基(已 sign-off、origin/dev=6e484b5):TapPayChargeAdapter / PaymentConfirmerAdapter(pooler+CA+host 釘死)/ confirmPayment(孤兒契約)/ composition root。

---

## 0. 拍板紀錄(2026-06-12 Sean、prose multi-select;codex 不得再列為缺決策)

- **Q1=A**:付款簿記 RPC(begin/mark)鑰匙 = **沿用 `payment_confirmer`**(窄權範圍演進:從「只 confirm」→「付款軌 RPC = confirm + 3 簿記」;仍零 table 權限、create_order 仍不授、Sean 零新 env)。否決 C(authenticated 可呼 = 會員可自干擾鎖/偽造 rec_trade_id、codex round1 F1)與 B(第二把鑰匙、ops 加倍)。
- **Q2=A**:加 **per-user in-flight 閘**(同一會員同時只一筆 pending 付款、10 分鐘自動過期)擋「重按產生兩張單各扣一次」(codex round1 F3);過期僅重開「能否開新付款」、不解任何 per-order 鎖(已刷訂單重刷之門不開)。
- **Q3=B**:cardholder **級聯補位**:name 空→收件人姓名、phone 空→會員資料手機;兩邊皆空才 fail-closed 擋下;全欄 trim 後 min(1)(codex round1 F4 normalizer 一併落)。
- 既有拍板不重問:前端契約 `{ checkout input, lines, prime }`、cardholder 不收 client 值;金額單一來源 = server read-back orders.total;成功真相 = confirm 成功;catch 吞 error 通用字面(Q2=A 沿用)。

## 1. 子片切分(codex round1 F6:重切 5 片、各 15-45 min、各自三綠 + code-reviewer + codex 關卡2)

內容分級(鐵則 9、round6 consider):**全 L1**(金流程式結構/安全控制、非可變營運內容;無 L2/L3)。

| 子片 | 內容 |
|---|---|
| ②-③a | migration `m3_s2d_charge_attempts.sql`:表 + 4 RPC(3 支 payment_confirmer 主軌 + 1 支 authenticated 備軌)+ token hash helper + per-user 閘 + ACL 終態 + MCP 交易模擬(**維持單片**:單一 migration 檔須原子 db push、不可半套;鏡像 ②-① 同形前例;round2 C2 已評) |
| ②-③b | domain types(BeginChargeAttemptResult、outcome 加 locked)+ `IChargeAttemptStore` port + `PgChargeAttemptAdapter`(server subpath、複用 buildPgConfig)+ tests |
| ②-③c | **兩 commit**(round2 C2):c-1 `IOrderRepository.findTotal` 窄讀 + SupabaseOrderAdapter 實作 + tests;c-2 `confirmPayment` 鎖/紀錄編排擴 + tests |
| ②-③d | `@pcm/schemas` TapPayPrimeInput + cardholder server 組裝 helper(級聯 Q3=B)+ tests |
| ②-③e | `chargePaymentAction` + composition factory + tests + client-bundle grep |

## 2. 🔴 PF-X2 鎖機制設計(Sean Q1=A / Q2=A 落定)

**`payment_charge_attempts` 表 + partial UNIQUE = per-order 鎖;per-user pending 閘 = 跨單重按防線。**

```sql
CREATE TABLE public.payment_charge_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.orders(id),
  customer_user_id  uuid NOT NULL,   -- 自 orders 反正規化(per-user 閘查詢;RPC 內從 orders 讀、零信任參數)
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','charged','failed')),
  rec_trade_id      text,
  fallback_token_hash text NOT NULL CHECK (fallback_token_hash ~ '^[0-9a-f]{64}$'),  -- sha256 hex(server-only 備軌 token);明文只在 server 記憶體(round4 MF2;hash 規格 round5 MF2)

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'charged' OR rec_trade_id IS NOT NULL)
);
CREATE UNIQUE INDEX payment_charge_attempts_order_lock_idx
  ON public.payment_charge_attempts (order_id) WHERE status IN ('pending','charged');
CREATE INDEX payment_charge_attempts_user_active_idx
  ON public.payment_charge_attempts (customer_user_id, created_at) WHERE status IN ('pending','charged');
CREATE UNIQUE INDEX payment_charge_attempts_rec_unique_idx  -- round6 nit:對帳簿早抓跨單重複 rec(orders.tappay_rec_trade_id UNIQUE 之前哨)
  ON public.payment_charge_attempts (rec_trade_id) WHERE rec_trade_id IS NOT NULL;
```

- **per-order 鎖語意**:每 order 至多一筆 active(pending|charged)attempt;佔鎖 = `INSERT ... ON CONFLICT (order_id) WHERE status IN ('pending','charged') DO NOTHING RETURNING id`(原子、跨請求、撞鎖回 `acquired:false` 非 exception)。生命週期:`pending`(charge 進行中/結果未知)→ `charged`(成功、補 rec_trade_id、**永久持鎖**)或 `failed`(TapPay 明確拒、未扣款、**釋鎖**可重試)。
- **🔴 stale pending fail-closed 不自動釋鎖**(per-order):transport 未知 → 鎖續持;處置歸 ②-⑥(Record API 對帳後標 failed)。寧卡單勿雙扣。
- **per-user in-flight 閘(Q2=A;round2 MF1 + round3 MF 統一修)**:begin RPC 內 ① `pg_advisory_xact_lock(hashtextextended(customer_user_id::text, 0))` 序列化同會員並發 begin(xact 鎖、RPC 交易結束即釋、不跨 HTTP)② 查「**未解決付款**」統一 predicate(join orders):`EXISTS(attempt 屬同會員 且 order_id <> p_order_id 且 created_at > now()-'10 min' 且 status IN ('pending','charged') 且 該 attempt 之 orders.payment_status <> 'paid')` → `acquired:false, reason:'user_in_flight'`。🔴 涵蓋兩個視窗:charged-未-paid(round2 MF1)+ **pending-但-order-已-paid 不誤卡**(round3 MF:markCharged 敗而 confirm 成功 → attempt 停 pending、join orders 後 paid 即放行、會員不被誤卡 10 分鐘)。10 分鐘過期只影響「開新付款」;per-order 鎖不受影響。
- **begin 回傳帶 reason(round3 C 修)**:`{acquired:false, reason:'user_in_flight'|'order_locked'|'not_unpaid'}`(order_locked=同單已有 active attempt;not_unpaid=order 非 unpaid)。reason 供 action 區分文案(§7):user_in_flight 的「新單」零扣款、不得回「付款已收」語意。
- **權限軌(Q1=A、codex round1 F1 修;round5 MF3 字面校正:共 4 支 RPC)**:主軌 3 支(begin/mark_charged/mark_failed)SECURITY DEFINER **只 GRANT payment_confirmer**(server-only rail;anon/authenticated/service_role/PUBLIC 全 REVOKE + has_function_privilege 矩陣 assert)→ 主軌 PostgREST 面零曝露、會員 JWT 不可呼、不可自釋鎖/偽 rec_trade_id;第 4 支 = authenticated 備軌 fallback(token 三重護欄、見 RPC 4)。
  - **信任模型(誠實記)**:RPC 無 auth.uid()(payment_confirmer 直連)→ 歸屬檢查改為「呼叫端 = 持 PAYMENT_CONFIRMER_DB_URL 的 server code;p_order_id 為 action 內 placeOrder 自產、永不收 client orderId」;RPC 內仍驗 order 存在 + `payment_status='unpaid'`(非 unpaid → acquired:false,與撞鎖同文案、不洩狀態)+ customer_user_id 從 orders 讀(非參數)。
  - **payment_confirmer 窄權演進註記**:migration 頭註解記 Q1=A(付款軌 = confirm + begin/mark_charged/mark_failed 四支;仍零 table/column 權限 → ②-① role-hygiene assert 不破;create_order 仍不可呼)。
  1. `begin_charge_attempt(p_order_id uuid) RETURNS jsonb`:`{acquired bool, attempt_id?, reason?, fallback_token?}`;order 不存在 → RAISE 通用(PF-E)。**fallback_token(round4 MF2;hash 規格釘死 round5 MF2)**:RPC 內 `gen_random_uuid()` 產生、DB 只存 hash、明文 token 只回給 server 呼叫端(payment_confirmer rail → use-case 記憶體)、**絕不回 client、絕不入 log**;備軌 RPC 憑 token 驗 server 出處。**hash 算法單一真相** = migration 內私有 helper `public.charge_attempt_token_hash(p_token uuid) RETURNS text`(IMMUTABLE、schema-qualified 全內部識別子):`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token::text, 'UTF8')), 'hex')`(uuid canonical text → UTF8 bytes → sha256 → lower hex 64 字;PG17 builtin sha256、零 pgcrypto 依賴);begin 與 fallback **同呼此 helper**(不可能算法不一致);helper REVOKE ALL FROM PUBLIC/anon/authenticated/service_role/payment_confirmer(只 owner 經 SECDEF 內部呼)。MCP 驗:hash 為 64 lower-hex、明文不在 DB、正 token 過、錯/缺 token 拒。
  2. `mark_charge_attempt_charged(p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text) RETURNS void`:pending→charged + rec_trade_id(非空驗);**charged 且同 rec → 冪等 no-op**(雙軌重試安全);非 pending(其餘)/ 不存在 → RAISE 通用。**雙鍵驗(round6 consider)**:WHERE `id=p_attempt_id AND order_id=p_order_id`(縮 server bug「錯 attempt 寫錯 rec」半徑)。
  3. `mark_charge_attempt_failed(p_attempt_id uuid, p_order_id uuid) RETURNS void`:pending→failed(釋鎖);非 pending / 不存在 → RAISE 通用;雙鍵驗同上。
  4. **`mark_charge_attempt_charged_fallback(p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text, p_fallback_token uuid) RETURNS void`(雙鍵驗同 RPC 2)(備軌、Sean「完整修好」、§3 雙軌;round4 MF2 token 版)**:語意同 2 但 **GRANT authenticated**(PostgREST HTTPS 第二 transport)+ 三重護欄:① **token 驗證**:`sha256(p_fallback_token)` 對 `attempts.fallback_token_hash` 比對,不符 → RAISE 通用(token 只存在 server 記憶體 → 會員「只有 attempt_id + 假 rec」**寫不進去**、偽造面關死)② `auth.uid()` 對 attempt→orders.customer_user_id 歸屬重查(anon/他人/無 cookie → RAISE 通用)③ **僅 pending→charged 緊縮轉移**(charged 且同 rec → 冪等 no-op;永不釋鎖、永不 →failed、永不動 begin)+ rec 格式驗(非空 + 長度上限)。**攻擊時序自審**:無 token → 任何 authenticated 呼叫全拒(假 charged 誤鎖路徑已關、round4 MF2);有 token 者 = 處理該筆請求的 server action 本身(同持該會員 JWT)→ 與主軌等信任;serverless 中途死 → token 隨記憶體消失、備軌對該 attempt 失效 = 等同雙軌全死分支(§3 webhook 恢復)。**無任何路徑**翻 paid / 釋鎖 / 觸他人單 → Q1=A 核心(鎖與釋放控制權在 server)不被破壞。
  - 紀律鏡像 ②-①:`SET search_path=''` + 全識別子 schema-qualified + RAISE 通用訊息 + 檔尾 rollback 註 + 頭註解記 MCP 模擬實證。
- **ACL 終態矩陣(codex round1 F5 修;migration assert 逐項驗)**:

| 主體 | 表直接權限 | RPC EXECUTE |
|---|---|---|
| anon | 零(RLS enable、零 policy、零 GRANT) | 零(REVOKE + assert) |
| authenticated | 零(同上) | **僅** `mark_charge_attempt_charged_fallback`(備軌、緊縮-only;其餘 3 支 REVOKE + assert) |
| payment_confirmer | 零(維持 ②-① role-hygiene assert:role_table_grants=0) | **僅** confirm + begin/mark_charged/mark_failed 3 簿記(assert;fallback 不授、不需) |
| service_role | 寫權 REVOKE(INSERT/UPDATE/DELETE/TRUNCATE;default-privilege re-grant 須顯式收)、**保 SELECT**(對齊 orders 紀律、admin/對帳唯讀;rec_trade_id 與 orders.tappay_rec_trade_id 同敏感度、一致) | 零(4 支全顯式 REVOKE + assert) |
| PUBLIC | 零 | 零(REVOKE) |
| 寫入路徑 | **唯一** = SECURITY DEFINER RPC(owner postgres) | — |

- **與 confirm RPC 分工**:本鎖序列化「charge 動作」(per-order + per-user);confirm RPC PF-B/PF-D 序列化「翻 paid」。兩層獨立、皆 fail-closed。

## 3. 🔴 PF-X1 紀錄完整修(Sean 2026-06-12「完整修好、不能簡單 pass」;取代 v3「殘餘風險接受」框架)

**目標:每條失敗分支都有確定性的「DB-或-TapPay-durable」紀錄 + 恢復路徑,零「只剩 log」死角。**

- **寫入前置**:pending attempt(order_id+customer_user_id+created_at)落 DB **先於** charge —— DB 死則根本不 charge(begin 失敗 → 上拋 → 零扣款)。任何成功的 charge 必然已有 DB row。
- **TapPay 側 durable 連結**:charge payload 的 `order_number = orderId`(②-②a 已實作)→ **charge 成功的瞬間**,`orderId ↔ rec_trade_id` 已永久存在於 TapPay 側(notify webhook 會推回、Record API 可查)—— 與我方 DB 健康度無關。我方 DB 的 rec_trade_id 是「本地快取」、不是唯一真相。
- **🔴 markCharged 雙軌寫入(完整修核心)**:charge 成功 → confirm 前:
  1. **主軌**:`mark_charge_attempt_charged`(payment_confirmer pg rail)× **重試 3 次**(短退避 100/300ms)。
  2. 仍敗 → **備軌**:`mark_charge_attempt_charged_fallback`(authenticated **PostgREST HTTPS** rail、§2 RPC 4;憑 begin 發的 server-only fallback token + 本人 cookie JWT、round4 MF1/MF2)× 重試 2 次。兩 transport 獨立(②-②b 實測過 pooler TCP 與 Supabase API「一死一活」的真實分歧:IPv6/ENOTFOUND 事件)→ 單一通道故障不再丟麵包屑。
  3. 兩軌全敗(= begin 成功後數秒內 Supabase pg+HTTPS **雙雙全死**)→ `console.error` critical(監控訊號、非對帳依據)+ 續走 confirm;此時 DB 仍有 pending row(order_id+時間)、TapPay 仍有 order_number↔rec 連結 → ②-⑥ **webhook notify 自癒(主)+ Record API 掃 pending attempts 以 order_number 反查(輔、列 ②-⑥ 驗收硬項)** = 恢復確定性、非寄望。
- **confirm 成功後收斂(round3 MF)**:若先前 markCharged 雙軌皆敗而 confirm 成功(orders 已有權威 rec)→ use-case **再補一次 markCharged**(best-effort、log only):attempt 狀態收斂 charged、對帳零分歧;即使不成,per-user 閘已 join orders(paid 即放行、§2)、會員不被誤卡。
- **markCharged 敗的全分支枚舉(round3 MF:含 confirm 被跳過)**:
  | 後續 | DB 紀錄 | 恢復 |
  |---|---|---|
  | confirm 成功 | `orders.tappay_rec_trade_id`(權威)+ 收斂重試補 attempt | 無需(已 paid) |
  | PF-X3 amount_mismatch(confirm 被跳過) | 備軌通常已落 attempts.rec;雙軌全敗 = pending row + TapPay 連結 | ②-⑥ webhook/Record API |
  | confirm 失敗(unreachable/rejected) | 同上 | ②-⑥ webhook 自癒(冪等 confirm) |
- **不選「markCharged 敗即不 confirm」**:棄 confirm = 把「或許可完成的付款」變必然孤兒;confirm 成功路徑本身就落權威麵包屑 → 續走嚴格較優。
- `charge_unknown`(transport 未知、無 rec 可記)不標記:pending 本身即「結果未知」紀錄;TapPay 側若實際成功,webhook notify 會推回補正。

## 4. server read-back orders.total(單一金額來源)

`create_order` 回傳刻意零價(`{order_id, display_id}`)、`findById` 未實作(讀路徑延 stage③ #217)→ 開窄讀:

- `IOrderRepository.findTotal(id: OrderId): Promise<Money | null>`(JSDoc 限付款編排 server read-back;查無/非本人〔RLS own-only〕→ null → action fail-closed 拒)。
- `SupabaseOrderAdapter`:authenticated client `select('total').eq('id', id).maybeSingle()` → `{ amount: toMoneyAmount(row.total), currency: 'TWD' }`(integer 元位、零浮點)。
- 此 Money 同時餵 charge 與 confirm p_amount;client 永不送價;TapPay `result.amount` 只供 PF-X3 比對、永不作金額來源。

## 5. cardholder server 組裝(MUST-FIX 3;Q3=B 級聯 + trim normalizer)

新檔 `apps/storefront/src/lib/payment/cardholder.ts`(server-only):

- 全欄 **`trim()` 後驗 min(1)**(codex round1 F4:`"   "` 不得送 TapPay)。
- `email` ← `user.email`(LINE 合成 email 已保底);trim 後空 → **fail-closed 拒**。
- `name` ← `customers.name`;空 → **收件人 `address.name`**(zod min(1) 恆有);仍空 → 拒。
- `phoneNumber` ← 結帳地址 `address.phone`(zod default('') 可空);空 → **`customers.phone`**;仍空 → 拒(fieldErrors 引導補手機)。
- **profile 讀取路徑(round2 NIT)**:`getCustomerRepo().findById(user.id)`(authenticated RLS own-only、CustomerId=user_id 既有慣例);**查無 row(null)→ fail-closed 拒**(不視為「name/phone 皆空」靜默級聯);tests 覆蓋 profile 缺 row / 空白 name / 空白 phone 級聯 / 全空拒。
- 地址:`getAddressRepo().listByCustomer(user.id)` 過濾 `addressId`(RLS own-only;查無 = 非本人 → 拒,先於建單)。
- 組裝**先於** placeOrder(PII 缺失不產垃圾單);組裝結果不入 log(#16)。

## 6. use-case 擴:`confirmPayment` 織入鎖 + 紀錄(單一編排真相)

deps 加 `attempts: IChargeAttemptStore`、outcome 加 `{ kind: 'locked'; reason }`:

```
1. attempts.begin(orderId)   — throw(infra)→ 上拋(action catch 通用字面;零 charge、安全)
   !acquired                 → { kind: 'locked', reason }(user_in_flight|order_locked|not_unpaid、§2)
2. tappay.charge             — throw → charge_unknown(不標記、pending 續持鎖)
3. status='failed'           → markFailed(釋鎖)主軌 ×3 重試(備軌不可釋鎖、不走);
   全敗(round5 MF1)→ { kind: 'charge_failed', recordPersisted: false }:「已知未扣款」未 durable
   落地 + pending 鎖殘留 → action 不得回「立即重試」文案(§7;誠實告知未扣款 + 請稍候再試;
   per-user 閘 10 分鐘自動過期、殭屍 pending 列 ②-⑥ 清);成功 → recordPersisted: true(可立即重試)
4. charge 成功 → 🔴 markCharged 雙軌(§3:主軌×3 → 備軌×2)、先於 PF-X3/confirm;
   雙軌全敗 → log critical、續走(錢已扣不棄單;鎖仍 pending 擋重刷;②-⑥ 確定性恢復)
5. PF-X3 金額比對 / 6. confirm — 既有邏輯不動(orphan/paid 路徑不變)
7. confirm 成功 且 步驟 4 曾全敗 → 補一次 markCharged(收斂、best-effort、log only;round3 MF)
```

簿記失敗「重試→雙軌→log→不斷流」原則:bookkeeping 失敗不可讓已扣款交易死在中途;鎖以 partial index 語意天然 fail-closed(殘留=擋重刷、非開門)。雙軌實作:`IChargeAttemptStore` 單一 port;`begin` 回 `{acquired, attemptId, fallbackToken, reason}`、`markCharged({attemptId, orderId, recTradeId, fallbackToken})`、`markFailed({attemptId, orderId})`(雙鍵驗對齊 migration、codex 關卡2 r1;主軌忽略 token、備軌必帶;token 不入 log);composition 注入 `ChargeAttemptStoreWithFallback`(adapters server subpath 複合 adapter:begin/markFailed = 主軌 only〔備軌不可釋鎖〕;markCharged = 主軌 ×3〔退避 100/300ms〕→ 備軌 ×2〔退避 100ms〕;重試/退避策略釘死於複合 adapter、tests 鎖次數;round4 C)。**🔴 備軌 request-scoped(round4 MF1)**:備軌 adapter 需使用者 cookie JWT → `getChargeAttemptStore()` 為 **async factory**(`await createServerSupabaseClient()` 注入備軌、PAYMENT_CONFIRMER_DB_URL 注入主軌);action 登入 gate 後 await 取得;否則備軌 auth.uid()=null 永敗 = 靜默退化單軌(round4 抓)。

## 7. delivery:`chargePaymentAction`(新檔 `app/checkout/charge-actions.ts`)

- input `{ addressId, shippingMethod, invoice, lines, prime }`:`CheckoutInput` + `PlaceOrderLinesInput` 雙 safeParse(鏡像 placeOrderAction 五層信任邊界);`TapPayPrimeInput = z.string().trim().min(1).max(512)`(@pcm/schemas)。
- 流程:登入 gate → 雙 safeParse → 組 cardholder(§5、fail-closed)→ `placeOrder` → `findTotal(orderId)`(null → 通用字面拒)→ `confirmPayment({tappay, confirmer, attempts}, {...})` → outcome 映 UI。
- 回傳契約(codex round1 F7 修:`message` 常數欄入型別、單一文案真相在 server):

```ts
export type ChargePaymentActionResult =
  | { fieldErrors?: CheckoutFieldErrors; formError?: string }                        // 驗證/登入/建單失敗(零扣款)
  | { ok: true; displayId: string }                                                  // paid(含冪等)→ ②-⑤ 完成頁
  | { ok: false; payment: 'charge_failed'; displayId: string; message: string }      // 卡拒未扣款 + 紀錄已落(recordPersisted:true):「付款未成功,請確認卡片資訊後重試」
  | { ok: false; payment: 'charge_failed_wait'; displayId: string; message: string } // 卡拒未扣款 + markFailed 全敗(round5 MF1):「付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試」— 🔴 誠實告知未扣款(非「已收」)、不誘導立即重試(pending 鎖殘留、per-user 閘 10 分鐘自動過期)
  | { ok: false; payment: 'processing';    displayId: string; message: string }      // charge_unknown/orphan/locked(order_locked|not_unpaid):「付款已收或處理中,請勿重複付款,客服 LINE 將協助確認」
  | { ok: false; payment: 'in_flight';     message: string }                         // locked(user_in_flight):「您有一筆付款正在處理中,請稍候再試」— 🔴 不帶 displayId(round3 C:此請求的新單零扣款、不得以「付款單號/已收」呈現)
```

- 映射:`paid`→ok / `charge_failed(recordPersisted:true)`→charge_failed / `charge_failed(recordPersisted:false)`→charge_failed_wait(round5 MF1)/ `charge_unknown`+`orphan(全 reason)`+`locked(order_locked|not_unpaid)`→processing / `locked(user_in_flight)`→in_flight(成功真相=confirm 成功;重試走 ②-⑥ 冪等 confirm 非重 charge;文案禁誘導重刷)。
- catch 全吞通用字面(零 RPC RAISE/adapter error 透傳)。
- composition:`lib/payment/composition.ts` 加 `getChargeAttemptStore(): Promise<IChargeAttemptStore>`(**async request-scoped、round4 MF1**:主軌 PgChargeAttemptAdapter〔PAYMENT_CONFIRMER_DB_URL〕+ 備軌 SupabaseChargeAttemptFallbackAdapter〔`await createServerSupabaseClient()` cookie JWT〕→ ChargeAttemptStoreWithFallback;走 @pcm/adapters/server、Q1=A 同鑰匙、複用既有受控 eslint-disable import 行)。
- `placeOrderAction` 不動(②-④ 才切流程)。

## 8. 檔案清單

| 檔 | 動作 | 子片 |
|---|---|---|
| `supabase/migrations/<ts>_m3_s2d_charge_attempts.sql` | 新 | a |
| `packages/domain/src/payment/types.ts` | 改:BeginChargeAttemptResult、ConfirmPaymentOutcome 加 locked | b |
| `packages/ports/src/IChargeAttemptStore.ts` + `index.ts` | 新/改 | b |
| `packages/adapters/src/payment/PgChargeAttemptAdapter.ts`(+test;server.ts 加 export) | 新 | b |
| `packages/adapters/src/payment/SupabaseChargeAttemptFallbackAdapter.ts`(備軌 markCharged-only、authenticated client)+ `ChargeAttemptStoreWithFallback.ts`(複合)(+tests;server.ts 加 export) | 新 | b |
| `packages/ports/src/IOrderRepository.ts` | 改:findTotal | c |
| `packages/adapters/src/supabase/SupabaseOrderAdapter.ts`(+test) | 改:findTotal | c |
| `packages/use-cases/src/confirm-payment.ts`(+test) | 改:§6 織入 | c |
| `packages/schemas/src/index.ts`(+test) | 改:TapPayPrimeInput | d |
| `apps/storefront/src/lib/payment/cardholder.ts`(+test) | 新 | d |
| `apps/storefront/src/lib/payment/composition.ts` | 改:getChargeAttemptStore | e |
| `apps/storefront/src/app/checkout/charge-actions.ts`(+test) | 新 | e |

(每檔 <400 行鐵則 6;use-cases 不 import schemas;PgChargeAttemptAdapter 只 import domain+ports+pg;boundaries 不變。)

## 9. 威脅模型 / 殘餘風險(誠實記)

1. **雙單雙扣**:Q2=A per-user 10 分鐘閘(含 charged-未-paid、round2 MF1)正面擋「重按/短窗重送」;殘餘 = 10 分鐘後 deliberate 重走 tokenize 再送(視為新交易)→ ②-⑥ **webhook 自癒(主)+ Record API 對帳(輔)** 退款處置。緩解疊加:prime 一次性 + ②-④ 鈕 disable + 文案。
2. **stale pending**:per-order 永鎖(該單)、per-user 10 分鐘自動過期(會員不被永久卡結帳)。→ backlog:「per-order stale pending 須 ②-⑥(webhook 主 + Record API 輔)對帳解鎖;不修會痛 = 卡單客訴須人工 SQL 解鎖」。
3. **卡拒重試產生 unpaid 殭屍單**(每次重送=新單):Phase 1 接受(無庫存佔用)→ backlog:「不修會痛 = admin 訂單列表雜訊 + 報表失真;M-4a 前補清理/標記」。
4. **markCharged 麵包屑(已完整修、§3 雙軌;非「接受」項)**:不可約剩餘 = begin 成功後數秒內 pg pooler + PostgREST HTTPS **雙 transport 同時全死**(= Supabase 整體中斷);此情境下 confirm 亦必死(同 DB)→ 訂單停 unpaid + pending row 在 DB + orderId↔rec 連結在 TapPay 側 → ②-⑥ webhook 自癒(主)/ Record API 掃 pending 反查(輔)= **恢復確定性**。物理極限:無任何設計能寫入完全斷線的 DB;本修法已把「資料遺失」變為零(TapPay durable)、把「恢復」變為確定程序。
5. **備軌偽造面(§2 RPC 4)— 已以 token 關死(round4 MF2)**:無 fallback_token(只存 server 記憶體、DB 只有 hash)→ 任何 authenticated 直呼全拒;round4 抓的「會員搶先假 charged → 真卡拒後 markFailed 失敗 → 誤鎖 + 誤導文案」路徑不存在。殘餘 = 零(authenticated 對 attempts 的有效寫入面 = 持有 token 的 server action 本身)。attempts.rec ≠ orders.rec 分歧偵測仍列 ②-⑥(防 bug 非防攻擊)。
6. per-user 閘 advisory lock 為 xact 內(微秒級)、不跨外部 HTTP;非 per-order 鎖機制(那是 partial unique、崩潰安全)。

## 10. 驗收(yes/no、逐子片)

**②-③a**:表+3 index+4 RPC 建成;begin 原子佔鎖(ON CONFLICT)+ reason 三值 + per-user 10min 閘(advisory xact 序列化、統一 predicate join orders)+ 非 unpaid → acquired:false;mark 三支狀態機守 + rec_trade_id 非空驗 + markCharged 同 rec 冪等;fallback RPC 三重護欄(token hash 比對 + auth.uid() 歸屬 + 僅 pending→charged、anon/他人/無 token 拒、不可釋鎖);ACL 終態逐角色 assert(round5 MF4 拆明、與 §2 矩陣一字不差):payment_confirmer = 表零權 + EXECUTE 僅 confirm+3 簿記;authenticated = 表零權 + EXECUTE 僅 fallback;anon = 表/RPC 全零;service_role = 表 SELECT=true、INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER=false(REVOKE ALL+GRANT SELECT)、4 支 RPC EXECUTE 全 false;PUBLIC 全零;表寫入唯 SECURITY DEFINER owner;token hash helper 任何角色 EXECUTE=false;RAISE 通用訊息;MCP 交易模擬:佔鎖/撞鎖/failed 後可重佔/charged 永鎖/已 paid 拒/per-user 閘(同會員第二單 pending 10min 內拒、**A 單 charged 而 orders 未 paid → B 拒〔round2 MF1〕、A 單 pending 而 orders 已 paid → B 放行〔round3 MF〕、A 單 confirm paid 後 B 放行**、過期可)/fallback 安全矩陣(**帶正確 token + 本人 JWT** pending→charged 可、同 rec+token 冪等、**只有 attempt_id+假 rec 無 token 拒〔round4 MF2〕**、token 錯拒、異 rec 拒、charged→failed 不可、他人/anon 拒)/anon·authenticated·service_role 不可呼 3 簿記/payment_confirmer 不可呼 create_order 與 fallback/ROLLBACK 零留痕。
**②-③b**:port 型別對 §2(含 reason + fallbackToken;token 不入 log);PgChargeAttemptAdapter 複用 buildPgConfig(CA+host 釘死)+ connect/end 每呼叫 + RPC 參數正確;備軌 adapter(markCharged-only、cookie JWT client 注入)+ 複合 ChargeAttemptStoreWithFallback(begin/markFailed 主軌 only、markCharged **主軌 ×3〔退避 100/300ms〕→ 備軌 ×2〔退避 100ms〕、tests 鎖死次數與順序〔round4 C〕**);tests 含 begin acquired/不 acquired(各 reason)/throw、markCharged 主軌成功不碰備軌/主軌敗 3 次切備軌/雙軌敗 throw(計次驗 3+2)/markFailed 不走備軌、token 透傳備軌不透傳 log。
**②-③c**(兩 commit):c-1 findTotal 窄讀(null fail-closed、整數→Money);c-2 confirmPayment 織入順序對(begin→charge→markCharged 雙軌→PF-X3→confirm→收斂補記)+ locked(reason)outcome + markX 全敗不斷流 + **confirm 成功且步驟4曾敗 → 補記一次(round3 MF)**;完整 pnpm test 綠。
**②-③d**:cardholder 級聯 Q3=B + 全欄 trim min(1) + fail-closed 先於建單 + **profile 查無 row → 拒**;tests 覆蓋 profile 缺 row/空 name/空 phone 級聯/全空拒;TapPayPrimeInput。
**②-③e**:action 鏈(登入 gate 後 `await getChargeAttemptStore()`、round4 MF1 async request-scoped)+ 五態映射(含 in_flight 不帶 displayId、round3 C)+ message 常數;client 零送價/cardholder/orderId/token;build 後 grep client bundle 零 Partner Key/pg/PAYMENT_CONFIRMER/經銷價;完整 pnpm test 綠。MCP/實測補:備軌「有 cookie JWT + token 成功、anon/無 cookie 失敗」(round4 MF1 驗收)。
**每片**:三綠 + code-reviewer + codex 關卡2(≤2 輪)+ 精準 add + STATUS 7 欄同 commit + 不 push。

## 11. 禁止清單(承 Sean 指令)

不改 scope 外檔 / 不開經銷價同步(階段⓪硬 gate、恆 general)/ 不寫死密鑰 / cardholder 不收 client 值 / 金額不從 client 或 TapPay result 取(server read-back 單一源)/ 不用 git add .·-A / 不自動 push / 不動 .env*。
— 禁止清單結束 —
