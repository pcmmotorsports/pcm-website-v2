# M-3 3DS — cart_session_id TS 5-param 整合 plan(option A:server per-call randomUUID 橋接)

> **狀態:** plan 就緒 — codex 關卡1 r1 FAIL → 修 → **r2 PASS**(2026-06-17、兩輪零留痕)。Sean 拍 **option A**。
> **鐵則:** 8(跨 domain/use-cases/adapters/delivery 5+ 檔 + 對齊 RPC 契約 + 動建單/付款共用契約)+ 12(order/payment/dedup 路徑)。
> **本 session 紀律:** 只寫 code、**不 db push、不 push git**;0a/0b/0c/1b/#214a + 本 TS 整合是同一 bundle、由 Sean 一次手動 db push + 同次部署。
> **對應真權威:** master plan v5(`docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §2/§7 Phase I/II 邊界、三鍵分工)、cross-tab plan(`docs/specs/2026-06-13-m3-cross-tab-double-charge-fix-plan.md`、cart_session_id 設計為 client 產)、0b migration(`supabase/migrations/20260613130000_m3_3ds_0b_cart_session_dedup.sql`)、memory `project_3ds-db-push-bundle-blocked-until-cart-session-integration`、backlog #3DS-7。

## 目標
把「3DS db push bundle」的 TS 側補成 push-safe:在 domain→use-case→port→adapter→mapper→delivery 全鏈接上 cart_session_id(對齊 0b 的 5-param create_order),server 端 placeOrderAction/chargePaymentAction 內用 `crypto.randomUUID()` 產 cart_session_id(**option A**,Sean 已拍),並讓 begin_charge_attempt 的新 outcome(duplicate/needs_settle)能被 parse 不 throw。完成後整 bundle 才能由 Sean 一次 db push。

## option A 是什麼 + 為什麼安全(codex 關卡1 + MCP 實證)
- option A = `placeOrderAction`/`chargePaymentAction` 內**每次呼叫** `crypto.randomUUID()` 產一個全新 cart_session_id 傳給 5-param create_order(**不動 CartContext、不拉前 3DS-7 client**)。
- 對 0b **不破壞既有**:dedup index 是 NOT UNIQUE partial(INSERT 新 UUID 不觸衝突);begin dedup SELECT(同 user+同 key+異單)在 per-call 新 key 下恆 0 row → duplicate/needs_settle 路徑到不了;null fail-closed 反被滿足。
- **唯一代價 = cross-tab 同車去重此階段 dormant(=0),非 regression**(現役本就無 cart_session_id、無去重);雙扣防線仍靠 per-user advisory lock + 10 分 user_in_flight 閘 + per-order ON CONFLICT。
- 🔴 殘餘敞口(登 #3DS-7):per-call key 下 cross-tab 去重=0;且 **paid-after gap**(Tab A 付完後 Tab B 同車再刷,`user_in_flight` 只擋 10 分內未 paid、擋不住此情境)。完整 per-cart-instance 去重屬 Phase II 3DS-7(client 產 key)。

## Sub-slices(3 commit)

### Commit 1 = S1 + S2(domain 加欄 + mapper 5-param + adapter call-site cast)
- **檔:** `packages/domain/src/order/types.ts`、`packages/use-cases/src/place-order.ts`、`packages/adapters/src/supabase/mappers/order.ts`、`packages/adapters/src/supabase/SupabaseOrderAdapter.ts` + 對應 test(`mappers/order.test.ts`、`SupabaseOrderAdapter.test.ts`、`place-order.test.ts`)。
- **S1:** `PlaceOrderInput` 加 `cartSessionId: string`(必填、uuid 字串;JSDoc 明示 cross-tab idempotency key、非價/非身分/非 tier、option A 階段 server 產)。`place-order.ts` 純 passthrough + 補 fail-closed guard `if (!input.cartSessionId) throw`(對齊既有空車 guard 縱深)。boundary:純資料欄零 import。
- **S2:** `CreateOrderRpcArgs`(mapper local type = **wire 權威**)加 `p_cart_session_id: string`(放 p_invoice 後對齊 SQL 第 5 參);`mapPlaceOrderToCreateOrderArgs` 逐欄白名單加 `p_cart_session_id: input.cartSessionId`(維持 L67-68 紅線、不夾帶 price/tier/userId)。
  - 🔴 **codex must-fix 1:不手改 generated `database.types.ts`**(它代表 LIVE 4-param prod schema、手改=db push 前說謊)。改:只在 `SupabaseOrderAdapter.placeOrder` 的 `.rpc('create_order', …)` call-site 做窄 cast `as unknown as Database['public']['Functions']['create_order']['Args']` + 前置註解標 db-push-pending + 撤除條件;**測試鎖 mapper 輸出 `Object.keys(args)` 恰 5 鍵 = 真正守門**(typecheck 對「多加鍵」是盲區、不可當哨兵)。
  - db push 後(Sean)→ `supabase gen types typescript --project-id bmpnplmnldofgaohnaok > …/database.types.ts` 重 gen → Args 變 5-param → **移除 call-site cast**、恢復「少鍵」正向 drift 偵測。

### Commit 2 = S3(delivery server actions 注入 cart_session_id)
- **檔:** `apps/storefront/src/app/checkout/actions.ts`、`apps/storefront/src/app/checkout/charge-actions.ts` + `actions.test.ts` + 🔴 **`charge-actions.test.ts`(codex must-fix 3 補觸點:真 charge path)**。
- 兩檔各 `import { randomUUID } from 'node:crypto'`(server-only、'use server' Node runtime);placeOrderInput 字面在 invoice 後加 `cartSessionId: randomUUID()`。
- 🔴 **測試**:mock `randomUUID()` 回固定 server 值;斷言 ① placeOrderInput.cartSessionId = 該 server 值;② **client 夾帶的 cartSessionId 不被採用**(來源恆=server)。不改 schemas(option A 不過 client cartSessionId)。

### Commit 3 = S4 + S5 + S6(begin 新 outcome parse + 消費端收斂)
- **檔:** `packages/domain/src/payment/types.ts`、`packages/adapters/src/payment/PgChargeAttemptAdapter.ts`、`packages/use-cases/src/confirm-payment.ts` + 對應 test。
- **S4:** `BeginChargeAttemptResult` 的 `acquired:false` 改 discriminated union,加 `duplicate`(existingDisplayId/existingPaid:true)、`needs_settle`(existingOrderId/existingDisplayId/existingRecTradeId:string|null/existingBankTransactionId:string|null)兩變體;**`ChargeLockReason`(3 值)不動**、不污染 locked outcome。
- **S5:** `parseBeginResult` 在既有 3-reason 前加 2 分支(snake→camel、existing_rec_trade_id/existing_bank_transaction_id 走 nullable 慣例容忍 0b-only 缺欄);形狀不符 throw ChargeAttemptParseError;未知 reason 仍 throw。
- **S6:** 🔴 **codex must-fix 2:duplicate/needs_settle 不得 alias 成 `{kind:'locked',reason:'order_locked'}`**(會 silent drift)。**拍定:加獨立 outcome `kind:'settlement_required'`(非 locked 非 paid)**,`charge-actions` 映成「**狀態確認中、請勿重複付款**」類文案(非「付款失敗」、不走 generic catch);掛 `TODO(3DS-1b settleCharge):option A per-call key 下 dormant/unreachable、client cart key 整合後由 settleCharge 完整消費 D2/D4`。不擴帶 existing_* 結構(留 3DS-1b)。掃 consumer:confirm-payment / charge-actions mapOutcome / ChargeAttemptStoreWithFallback。

## Risk register(codex r2 PASS)
- **部署順序破窗(半套部署=PGRST202/404 結帳全壞)** → 整 bundle 必同一 commit 群 + Sean 一次 db push+部署;本 session 不 db push/不 push git。
- **typecheck 假綠盲區**(postgrest .rpc 對多帶一鍵不報錯;#106 drift 偵測對「多加鍵」盲)→ 守門靠「測試鎖 5 鍵」+ 部署紀律 + 落地實證,**不把三綠當破窗哨兵**;db push 後重 gen 恢復正向偵測。
- **option A per-call UUID** → 對 0b 不破壞既有、cross-tab 去重 dormant(非 regression);殘餘敞口登 #3DS-7。
- **信任邊界** → cart_session_id 是 idempotency key(非權威安全欄);跨 user blast radius=0(begin dedup 限 same user、改自己 key 只自害);不碰價/經銷價/tier(create_order 仍 server 取 price_general + tier 硬寫 general + return DTO 只 {order_id,display_id})。
- **discriminated union 擴展** → 與 ChargeLockReason 隔離、consumer 掃齊;S4+S5+S6 同 commit 避免中途 typecheck 紅;跑完整 pnpm test。

## Rollout runbook(db push 落地時、Sean 執行;codex consider 1)
1. 結帳維持關閉/maintenance(現況 Phase I 對外未開、prod orders/attempts 0 row)。
2. Sean 手動 `supabase db push` 整 bundle(0a→0b→0c→1b→#214a→4a-1→4a-2)。
3. 等 PostgREST schema cache 更新 + 以真 authenticated session 跑一筆 create_order 實證**非 PGRST202**、回 {order_id,display_id}、orders.cart_session_id 非 null、begin 對該單回 acquired:true。
4. 確認後再放部署/流量。
5. db push 後重 gen `database.types.ts`(#106)→ 移除 S2 call-site cast。
6. 未來若有流量再做此類遷移 → 改兩階段相容 migration(先加 5-param 相容 overload、後 DROP 4-param),避免非原子切換窗。

## Test plan
- cart_session_id 傳遞鏈(use-case passthrough / mapper camel→snake 映射正確)。
- server 產不信任 client(mock randomUUID 固定值、client 偽造不採用、schemas 不含 cartSessionId)。
- 不洩價/經銷價(mapper 輸出鍵集合恰 5 鍵、無 price/tier/userId;return 只 {orderId,displayId})。
- begin outcome parse(duplicate/needs_settle happy + nullable rec_trade_id/bank_transaction_id 缺欄 + 形狀不符 throw + 既有 3-reason 回歸 + 未知 reason throw)。
- exhaustive narrowing(confirm-payment 對 duplicate/needs_settle 走 settlement_required、不映 paid/locked)。
- 每 commit 前 /slice-checkpoint 三綠(動 .ts 加 build)+ 完整 pnpm test(非單檔子集);commit 前 codex-adversary 關卡2(鐵則 12)。

## Discipline / 禁止清單
- 不 db push、不 push git(等 Sean)。
- server 產 key(option A 過渡解、登 #3DS-7);不碰價/經銷價/tier;boundary domain⊥adapter、依賴方向不變。
- cast 走 #106 documented 範式(call-site 窄 cast + 撤除條件註解);**不手改 database.types.ts**;禁裸 as / @ts-ignore。
- 精準 add(禁 git add . / -A);不動 .env*/next.config/vercel.json/Medusa/Prisma/GRANT 矩陣。
- commit 字面 vs 事實一致;STATUS 7 欄同 commit 自更(含校正 push 行 + CRON_SECRET 已設、3DS-4d 前置① 解);busboy-end。

## Backlog 登錄
- **#3DS-7** cart_session_id 前端 CartContext 整合(client 產 key、空車首件生、24h TTL、clear/成交 regenerate):🔴 不修會痛 = option A per-call key 下 cross-tab 同車去重=0、且 **paid-after gap**(Tab A 付完 Tab B 同車再刷,user_in_flight 擋不住)→ 兩 tab 各建單各扣款。
