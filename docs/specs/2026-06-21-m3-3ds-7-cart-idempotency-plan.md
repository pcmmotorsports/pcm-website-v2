# M-3 3DS-7 cart_session_id 冪等治本 plan(2026-06-21)

> **一句話:** 把休眠的 `cart_session_id` 冪等去重「叫醒」—— 從「server 每次 `randomUUID()`」改成「client CartContext 穩定 key(購物車生命週期穩定、成交才換新)」,讓既有但 dormant 的 begin dedup(D2/D4)+ settleCharge 裁決真正生效,治本「3DS pending >10 分、時間鎖過期、同意圖重結帳 → 雙扣」。
>
> **鐵則:** 鐵則 8(跨前端 CartContext + client hooks + server action;7d 另動 migration)+ 鐵則 12(payment / 雙扣 / idempotency / 信任 client key)重大改動 → 本 plan 等 Sean 批 + codex K1,才動 code。
>
> **狀態:** prod 結帳 flag-gated 僅 sandbox、零真流量 → 從容做、可在 dev 增量落地。
>
> **前置文件:** handoff `docs/handoff/2026-06-21-3ds-7-idempotency-kickoff.md`、審查報告 `docs/reviews/2026-06-21-payment-flow-multiparty-audit.md`(§三 #1 / §六 top 3)、0b 真權威 `supabase/migrations/20260613130000_m3_3ds_0b_cart_session_dedup.sql`。

---

## §0 規劃前親讀真權威(本 plan 不只信地圖、逐檔驗過)

> 規劃 session 已逐檔親讀以下檔案的實際 code(非僅 handoff 地圖),file:line 為 2026-06-21 dev=0fa9995 實況。

| # | 檔 | 親讀確認 |
|---|---|---|
| A | `apps/storefront/src/contexts/CartContext.tsx`(全 175 行) | items[] + localStorage `pcm-cart-mock-v2`、`isHydrated` gate、**無 session id 概念**;mount effect L119-122 readStorage、L124-126 writeStorage(isHydrated gate) |
| B | `apps/storefront/src/components/ClearCartOnSuccess.tsx`(全 35 行) | L17-19 TODO 3DS-7 明標「isHydrated gate 內 clear() 旁補 regenerateCartSession()」;掛 paid/pending |
| C | `apps/storefront/src/hooks/useChargePayment.tsx` L97-103 | 呼 `chargePaymentAction({addressId,shippingMethod,invoice,lines,prime})`**無 cartSessionId**;L122 paid 後 clear() |
| D | `apps/storefront/src/hooks/usePlaceOrder.tsx` L73-78 | 呼 `placeOrderAction({addressId,shippingMethod,invoice,lines})`**無 cartSessionId**;L88 success 後 clear() |
| E | `apps/storefront/src/app/checkout/charge-actions.ts` L80/L90/L154 | `chargePaymentAction(input:unknown)` → `raw=input` → **L154 `cartSessionId: randomUUID()`**(休眠根因);mapOutcome L237-242 / mapInitiateOutcome L271-273 settlement_required→processing |
| F | `apps/storefront/src/app/checkout/actions.ts` L58/L113 | `placeOrderAction(input:unknown)` → **L113 `cartSessionId: randomUUID()`** |
| G | `packages/use-cases/src/confirm-payment.ts` L48-58 | 同步路徑:begin → `duplicate\|needs_settle` → **`{kind:'settlement_required'}`(丟掉 existing_*)** |
| H | `packages/use-cases/src/initiate-payment.ts` L55-62 | **3DS 路徑(prod-critical)**:begin → 同樣收斂成空殼 `settlement_required`、丟 existing_* |
| I | `packages/use-cases/src/settle-charge.ts`(全 303 行) | 裁決引擎已完備:`settleCharge({orderId, recTradeIdHint?})` → paid/failed/pending/no_attempt;L34 註「**不下 UI/cart 決策、由 action 層映**」 |
| J | `packages/domain/src/payment/types.ts` L280/L326/L336-359 | `ConfirmPaymentOutcome`/`InitiatePaymentOutcome` 的 `settlement_required` 是**空殼**(L278 註「不擴帶 existing_*、留後續」);但 `BeginChargeAttemptResult` L345/L352-359 **已帶** existingOrderId/existingDisplayId/existingRecTradeId/existingPaid |
| K | `packages/adapters/src/payment/PgChargeAttemptAdapter.ts` L215-266 | begin adapter **已 parse** existing_*(D2 L233-241 / D4 L246-266) |
| L | `packages/domain/src/order/types.ts` L206-219 | `PlaceOrderInput.cartSessionId:string`;L207-208 註「option A server 產、3DS-7 改 client」 |
| M | `packages/use-cases/src/place-order.ts` L32-34 | fail-closed `if(!input.cartSessionId) throw`(縱深) |
| N | `packages/adapters/src/supabase/mappers/order.ts` L82 | domain→`p_cart_session_id` 白名單(非價/tier/身分) |
| O | `…/20260613130000_…0b….sql` begin L350-467 / create_order L107-159 | begin dedup D2/D4 三態(advisory lock 內 race-safe、移 user_in_flight 閘前);create_order 5-param null fail-closed |

**結論:骨架幾乎全就位、3DS-7 是「叫醒 + 接線 + 裁決」不是「重建」。** 唯三處 dormant:① client 無穩定 key(A/C/D)② server 丟 client key 改用 randomUUID(E/F)③ use-case 把 dedup context 收斂成空殼(G/H/J)。

---

## §1 親讀發現的 2 個關鍵設計事實(地圖沒提、影響切片安全)

### 事實 1:dedup 在 charge 層(begin)、非建單層(create_order)→ 重試會產生「孤兒未付單」

- 流程實況:`chargePaymentAction` → ① `placeOrder`(`create_order` RPC **先建一張新 order row**、寫 cart_session_id)→ ② `initiatePayment`(`begin` 偵測同 key sibling → needs_settle、**不 charge**)。
- 即:穩定 key 下,**每次重試都建一張新 order(未付)**,begin 在 charge 層擋下扣款,新 order 變孤兒未付單。
- **安全性不受影響**(核心不變量「不雙扣 charge」成立:第二張 order 從未 charge);begin dedup 永遠指回第一張(唯一持 active attempt 的單)、孤兒單無 attempt 不干擾 dedup ORDER BY。
- **這是既有 0b 架構性質、非 3DS-7 引入**;3DS-7 維持此架構(不把 dedup 移到 create_order — 那是更大改動、偏離 0b、超範圍)。孤兒未付單清理列為 **backlog 候選**(見 §6 範圍外)。
- ⚠️ 補(對抗審查 code-accuracy 視角):孤兒單**會燒 order_display_seq 序號**(0b create_order nextval 在 null fail-closed 後)→ 斷號(UX,非雙扣);且**無 `(customer_user_id, cart_session_id)` UNIQUE 約束**(0b L99-100 是 `CREATE INDEX` 非 UNIQUE)→ create_order 對同 key 不報 23505、照建新 row → **孤兒單需 sweeper 清、不能靠 DB 約束擋**(backlog 條目精確化、鐵則 10)。

### 事實 2:7b 啟動 dedup「若不同時做成交 regenerate」會誤擋合法重購 🔴

- 親讀推演:成交後 `ClearCartOnSuccess` 只清品項、**不換 key**(現 CartContext 無 key 概念)。若 7b 啟動穩定 key 但缺 regenerate:
  - 客人 A 完成購買(order#1 paid、key=K)→ 清車但 key 仍 K → 加新商品(key 仍 K)→ 重新結帳 → `create_order` 建 order#2 key=K → begin 找到同 key 的 **已 paid sibling(order#1)** → **D2 duplicate** → 「狀態確認中、勿重複付款」→ **合法新購被誤擋**。
- **結論:7b(啟動 wire)與「成交 regenerate」必須同片落地、不可拆**(拆出的中間態對重購客人是壞的;雖 prod 未開、零真流量,但「每片留下一致狀態」原則優先)。→ 本 plan 把 handoff 原 7d 的 regenerate 併入 7b(見 §3 切片定奪)。
- 🔴 **但 regenerate 範圍是「僅 DB 確定 paid」、非「所有成交清車點」**(對抗審查 must-fix、雙扣視角):模糊態(callback pending / charge unknown / processing — 錢可能已扣但 DB 未確定)**換 key = 讓重購拿到新 key、dedup 失去對既有單把手 → 既有單若其實已扣、重購會真第二次扣款**。權威審查報告 §三 #1(L41)逐字「成功頁才 regenerate」。**保留 key 於模糊態,正是讓 dedup 守住不雙扣的關鍵**(見 §3 7b「clear() 點 × 是否 regenerate」表)。
- ⚠️ **跨分頁機制**(對抗審查 concurrency 視角):CartContext 無 storage 事件監聽(無跨分頁同步)→ A 分頁成交 regenerate 後,B 分頁 in-memory key 仍是舊值、B 送出帶舊 key。**這安全**(舊 key = A 剛成交單的 key → begin 撞已 paid sibling → D2 duplicate「處理中/勿重複付款」、零雙扣);但要寫明這是「舊 key 撞 dedup」的成因、非「分頁會自動同步新 key」。跨分頁 key 同步(消 UX 噪音、安全無虞)列 backlog 可選。

---

## §2 治本設計總覽

```
[7a] CartContext 穩定 cartSessionId(client state + localStorage + 空車首件生 + regenerate())
        │ key 生成但尚未送(零行為變更、可獨立安全落地)
        ▼
[7b] 端到端啟動 + 成交 regenerate(原子安全對)
        │  client hook 送 key(唯一 live=useChargePayment〔C〕、內部讀 useCart().cartSessionId)
        │   → server action 收 client key + uuid 驗 fail-closed(唯一 live=charge-actions〔E〕、取代 randomUUID)
        │  + 🔴 僅「DB 確定 paid」清車點呼 regenerate(useChargePayment paid〔C L122〕+ callback paid〔B〕);
        │     模糊態(pending/processing/unknown)保留 key 讓 dedup 續守(防雙扣)
        ▼  落地後:dedup LIVE + 重購安全 + 雙扣治本達成(前提=key 在 in-flight 全程穩定不換新)
        │  in-flight dup 的 UX = settlement_required → 「處理中、勿重複付款」(安全、但未精緻)
        ▼
[7c] 精準裁決(UX 精緻化、安全基線之上)
        │  domain outcome 擴帶 dedup context(J)+ use-case surface(G/H)
        │  + action 層 settleCharge 即時裁決(needs_settle)→ duplicate顯既有單 / failed放行重刷 / pending短hold
        ▼
[7d] TTL staleness + user_in_flight 時間鎖退場(鐵則 8 動 migration、deferred、獨立 plan)
```

**安全增量敘事:** 7b 落地即達「不雙扣 + 重購安全」(治本核心);7c 是 UX 精緻化、7d 是時間鎖退場與棄單長尾,皆在已安全的基線上疊加。**prod 結帳要安全開放,7a+7b 為必要、7c 強烈建議、7d 為後續。**

---

## §3 子切片定奪(deviation from handoff 4-片草案,附理由)

> handoff §4 草案 = 7a / 7b(wire)/ 7c(adjudication)/ 7d(regenerate+TTL)。**本 plan 調整**:把 regenerate 從 7d 上移併入 7b(理由見 §1 事實 2:wire 無 regenerate 會誤擋重購、必同片),7d 縮為「TTL + 時間鎖退場」。其餘對齊。

### 7a — CartContext 穩定 cartSessionId(純前端)

- **目標:** CartContext 持有購物車生命週期穩定的 `cartSessionId`(uuid),空車加第一件時生成、localStorage 持久化跨重結帳穩定、暴露 `regenerateCartSession()` 供成交換新。**本片不改任何結帳行為**(key 生成但還沒送 server)。
- **L 分級:** **L1**(純 client state、無後台 CRUD、無新 CSS、視覺零變更)。
- **估時:** ~30 分。
- **動到的檔:**
  - `apps/storefront/src/contexts/CartContext.tsx`(A、新增 state + 持久化 + 生成/regenerate;<200 行守鐵則 6)
  - `apps/storefront/src/contexts/CartContext.test.tsx`(smoke test:首件生 key / 重 render 穩定 / regenerate 換新 / SSR 空 / localStorage 還原)
- **設計要點:**
  - `cartSessionId: string | null`(SSR/hydrate 前 null;`isHydrated` 後才有值,對齊既有 hydration pattern L116-122)。
  - 生成時機 = `addItem` 時若 `cartSessionId==null` 則 `crypto.randomUUID()`(瀏覽器原生);**或** mount hydrate 時若 localStorage 無 key 且有品項則補生(還原舊車的相容)。決策 **#4** 影響細節。
  - localStorage:獨立 key `pcm-cart-session-v1`(與品項 key `pcm-cart-mock-v2` 分開,避免動到既有品項序列化契約 / v2→v3 bump)。
  - `useCart()` 介面擴 `cartSessionId` + `regenerateCartSession()`;現有 consumer 零破壞(純新增欄、皆部分解構,context value 物件加欄不破壞)。
  - 🔴 **regenerate / 持久化必 gate `isHydrated`**(對抗審查 concurrency must-check、對齊 ClearCartOnSuccess L31-33 既有 codex must-fix):CartContext 持久化是 effect 驅動(L119-126、寫回被 isHydrated gate);若子元件 effect 早於 provider mount effect 在 hydrate「前」regenerate→setState 新 key,會被隨後 provider mount 的 readStorage **覆寫回舊 key** → 成交未換 key → 下次重購撞 D2 誤擋(正是 §1 事實 2 要防的)。故 `regenerateCartSession()` 與其 localStorage 寫入須與 `clear()` 同紀律、僅 `isHydrated===true` 後生效。
- **鐵則:** 鐵則 1(動 state 非視覺、無 design 來源需 grep);鐵則 6(檔 <200 行;現 175 行、加 state+持久化+生成+regenerate 後空間略緊、仍可守);鐵則 9 L1。
- **rollback:** revert 單檔(CartContext + test);無 server / DB 足跡。
- **驗收(yes/no):** ☐ 加第一件後 `cartSessionId` 非 null 且為合法 uuid ☐ 重 render / 重整頁(localStorage)key 不變 ☐ `regenerateCartSession()` 後 key 改變 ☐ **hydrate 前呼 regenerate 不被 provider mount readStorage 覆寫(新 key 持久)** ☐ 清空再加 → 行為符決策 #4 ☐ SSR(無 window)不炸、hydrate 前 null ☐ smoke test 綠 ☐ 三綠。

### 7b — 端到端啟動 + 成交 regenerate(原子安全對)🔴 鐵則 8/12

- **目標:** live 結帳鏈(useChargePayment → chargePaymentAction)把 7a 的 `cartSessionId` 送進 server action;server action 收 client key + 驗 uuid 格式(沿用 `z.uuid()`)+ 非空 fail-closed(取代 `randomUUID()`);**同片**在「**DB 確定 paid**」清車點旁呼 `regenerateCartSession()`(模糊態保留 key)。落地後 begin dedup 真正生效(治本核心)、且重購不被誤擋、且不引入新雙扣縫。
- **L 分級:** **L2**(改既有 server action 的信任邊界 + payment idempotency 啟動 + client 接線;鐵則 8/12;視覺零變更)。
- **估時:** ~30 分(對抗審查澄清後 scope 縮:live 檔只 useChargePayment + charge-actions + ClearCartOnSuccess + schema;退役檔不計核心工)。
- **🔴 live vs 退役(對抗審查 code-accuracy/completeness must-fix、雙視角 git grep 確認):**
  - **唯一 live 結帳鏈** = `CheckoutView` → `useChargePayment` → `chargePaymentAction`(`CheckoutView.tsx:8` 註「usePlaceOrder 退役、本檔不再呼叫」)。
  - **`usePlaceOrder.tsx` + `placeOrderAction`(actions.ts)已退役、生產零呼叫**(僅自身 + test 引用)→ 它們的 `randomUUID()`(actions L113)+ clear(usePlaceOrder L88)是**死路徑**;改它們對雙扣治本**零功效**。
  - **決策:7b 核心不動退役檔**;`usePlaceOrder` / `placeOrderAction` 標 **backlog 清理候選**(刪除,消「兩條 cartSessionId 來源語意並存」的 bug 追蹤面、鐵則 10)。**不**為退役檔寫 regenerate 接線。
- **動到的檔(live core):**
  - `apps/storefront/src/hooks/useChargePayment.tsx`(C)— 內部 `const {items, clear, cartSessionId, regenerateCartSession} = useCart()`;組 `chargePaymentAction({...})` payload 時加 `cartSessionId`(在 hook 內部、**與 lines 同層,不進 `ChargeArgs` 簽名** — 對抗審查 should:ChargeArgs L35-40 無 lines、key 同樣內部取);L122 paid clear 旁呼 `regenerateCartSession()`(**僅 paid**)。
  - `apps/storefront/src/app/checkout/charge-actions.ts`(E)— L154 改讀 `raw.cartSessionId` + `z.uuid()` 驗 + 非空 fail-closed(取代 `randomUUID()`)。
  - `apps/storefront/src/components/ClearCartOnSuccess.tsx`(B)— **拆「是否 regenerate」**:由 callback variant 控制(paid 傳 `regenerate=true`、pending 傳 `false`),或 callback 把 regenerate 上移到只在 paid 分支掛載的元件;isHydrated gate 內(L31-33)。
  - server zod — 🔴 **不改共用 `CheckoutInput`**(codex K1 should:`placeOrderAction` 也用它、且退役路徑本輪不動)→ 在 charge-actions.ts 內新增**局部** `CartSessionIdInput = z.uuid(...)`(或獨立 `ChargePaymentInput`)驗 `raw.cartSessionId`,與 `addressId`/`variantId` 同款驗證器。
  - 🔴 **測試反轉**(codex K1 should):`charge-actions.test.ts` 現有斷言「client 塞 cartSessionId 被 server 覆蓋」(L204-226)必反轉為「合法 client key 被採用 / 非法·缺失 fail-closed / 金額·userId·tier 仍被忽略」,否則三綠會紅。
  - (退役、本輪不動、列 backlog)`usePlaceOrder.tsx` / `actions.ts`。
- **🔴 clear() 點 × 是否 regenerate(完整表,對抗審查 must-fix:換 key 只在 DB 確定 paid):**

  | clear() 點 | 態 | 錢確定? | regenerate? | 理由 |
  |---|---|---|---|---|
  | `useChargePayment` L122 | paid | DB 確定已扣 | ✅ **是** | 成交完成、換新 key 防重購誤擋 |
  | callback `ClearCartOnSuccess`(paid 分支) | paid | DB 確定已扣 | ✅ **是** | 同上(3DS 路徑) |
  | `useChargePayment` L129 | processing | 可能已扣、未定 | ❌ **否** | 保留 key 讓 dedup 守住既有單、防雙扣 |
  | `useChargePayment` L109 | unknown(回應遺失) | 可能已扣、未定 | ❌ **否** | 同上 |
  | callback `ClearCartOnSuccess`(pending 分支) | pending | 可能已扣、鎖仍持 | ❌ **否** | 同上 |
  | `usePlaceOrder` L88 | success(退役) | 未扣(非刷卡) | — | 退役死路徑、不接線 |

  **原則:regenerate ⟺ DB 確定 paid;一切模糊態保留 key**(保留 key 正是 dedup 防雙扣的把手)。
  🔴 **7c 的 `duplicate` / `needs_settle→settleCharge=paid`(既有單已確定 paid)亦屬「DB 確定 paid」**(codex K1 must-fix)→ 必映 client paid-equivalent 終態 → **clear + regenerate**;否則保留舊 key、下次合法重購又撞 paid sibling 被 D2 擋住。此列由 7c 落實(7b 先把基礎 paid 路徑做對)。
- **設計要點(信任 client key — 決策 #1):**
  - 安全 framing(§4 詳):key 是「非價/非身分/非 tier」純去重子;dedup 在 `customer_user_id` 範圍(begin 從 orders 讀歸屬、RLS own-only)→ 偽造 key 最多影響攻擊者自己的去重(自找麻煩),**無跨用戶攻擊面**。
  - server **仍驗**:`z.uuid()` 格式(泛 uuid、非 v4-only;既有驗證器與 pg `uuid` 欄皆泛 uuid)+ 非空 fail-closed。client 送非法/空 → 既有 `placeOrder` L32-34 + create_order 入口 null fail-closed + pg `uuid` cast 三重擋。
  - **不擴 domain 型別**(`PlaceOrderInput.cartSessionId:string` 已存在、mapper/use-case/RPC 全鏈已穿)——7b 只改「key 從哪來」(client 非 server),不改線契約。
- **落地後狀態:** dedup LIVE;同 key 異單已 paid → settlement_required → mapOutcome/mapInitiateOutcome 現映「處理中、勿重複付款」(MSG.settlementRequired,**安全終態、零本次扣款**)。7c 再精緻化此 UX。
- **鐵則:** 鐵則 8(跨 client hook + server action;先 plan 等批 ✓)、鐵則 12(雙扣 idempotency 啟動 + 信任 client key + tier/價零外洩〔本片不碰價〕)、鐵則 3(前後台同步)。
- **rollback:** revert live core 檔 → 回 option A(server `randomUUID()`、dedup 回 dormant);零 migration、零 DB 足跡 → 乾淨。
- **驗收(yes/no、路徑特定 — 對抗審查 should):**
  - ☐ **dedup 三態驗用 MCP 交易模擬**(對齊 0b migration 已用 BEGIN+synthetic 雙單+ROLLBACK 法):同 user 同 key 異單 → duplicate(paid sibling)/ needs_settle(charged/pending-未-paid)三態正確命中(begin 自然語境下同步 flag-off 成交直接 paid、難產 needs_settle sibling → 模擬最可靠)
  - ☐ server 收空/非法 cartSessionId → fail-closed 拒(零垃圾單)
  - ☐ **成交後 key 已換新且僅在 paid**:useChargePayment paid + callback paid → key 換新、重購不被誤擋;processing/unknown/callback pending → **key 不變、保留 dedup 把手**(逐 clear 點驗上表)
  - ☐ 既有快樂路徑(首次結帳)零回歸、`ChargeArgs` 簽名不變(不破 CheckoutView 呼叫端)
  - ☐ 三綠 + 動前端元件補/更 smoke test ☐(命中鐵則 12)code-reviewer + codex K2。

### 7c — 精準裁決(domain outcome + action settleCharge)🔴 鐵則 12 核心

- **目標:** 把 begin 的 dedup context(existing_*)上帶到 outcome,action 層即時裁決:`duplicate`→顯既有單號;`needs_settle`→鎖外跑 `settleCharge(existingOrderId)`→ paid 顯既有單 / failed 放行重刷 / pending 短 hold。取代 7b 的「一律處理中」粗映射。
- **L 分級:** **L2**(改 domain 型別 + 2 use-case + action;無新後台 CRUD)。
- **估時:** ~40 分(可拆 7c-1 surface / 7c-2 adjudicate;見下)。**建議拆**:
  - **7c-1 — surface existing_*(~25 分):** domain `ConfirmPaymentOutcome`/`InitiatePaymentOutcome` 的 `settlement_required` 擴帶 dedup context(承 `BeginChargeAttemptResult` 已有的 existing_* 形狀,J L345/L352-359);use-case 不再丟(confirm-payment L54-56、initiate-payment L58-60 改上帶 existing_*)+ tests。**安全中性**(只多帶資料、action 暫不消費 → 行為等同 7b)。
  - **7c-2 — action 裁決(~30 分):** charge-actions 把 settlement_required 分流:`existingPaid` → 顯既有單(ok-like 或 duplicate 文案);`needs_settle` → `await settleCharge(getSettleChargeDeps(), {orderId: existingOrderId, recTradeIdHint: existingRecTradeId ?? undefined})` → 依 SettleChargeOutcome 映 UI(決策 #3)。需把 mapOutcome/mapInitiateOutcome 由純函式改為「settlement_required 走 async adjudicate、其餘維持純映」+ tests。
- **動到的檔:**
  - `packages/domain/src/payment/types.ts`(J、擴 settlement_required 形狀)
  - `packages/use-cases/src/confirm-payment.ts`(G、L54-56 上帶)
  - `packages/use-cases/src/initiate-payment.ts`(H、L58-60 上帶)
  - `apps/storefront/src/app/checkout/charge-actions.ts`(E、adjudicate + 接 getSettleChargeDeps)
  - 對應 tests(confirm-payment.test / initiate-payment.test / charge-actions 測 + settleCharge mock)
- **設計要點(決策 #3 — needs_settle 裁決映射):**
  - 🔴 **duplicate(existingPaid)/ settleCharge `paid`(既有單確定 paid)→ client paid-equivalent 終態 → `clear()` + `regenerateCartSession()`**(codex K1 must-fix):顯既有單號 `displayId`(「此筆已完成付款」)、但**必須換 key**(購買意圖已被既有單滿足)。否則保留舊 key、下次合法重購又撞 paid sibling D2 被擋。實作:新增 result kind(如 `duplicate_paid` 帶 displayId)或復用 `ok:true`+既有 displayId,**hook 須明確當 paid-equivalent 處理(clear+regenerate)**。
  - settleCharge `failed` → 既有單已釋鎖 → **放行重刷**(UX:引導客人重新結帳)。🔴 **釋鎖須退出雙閘**(對抗審查 should):markFailed 把 attempt status→failed → 退出 begin dedup 的 `LEFT JOIN ... a.status IN ('pending','charged')`(0b L400-401)**且**退出 user_in_flight 閘(0b L433-442 同綁 active 集)→ 重結帳 begin 對該 sibling **兩閘皆不命中**(非只 dedup);需驗兩閘都過。**此態保留 key**(既有單未成交、key 留著無害、重結帳會建新單)。
  - settleCharge `pending`(record_unreachable / auth_or_pending / record_unverified)→ **短 hold**:既有 3D 可能仍進行中 → 「狀態確認中、請稍候勿重複付款」(沿用 MSG.settlementRequired)、**保留 key**。短 hold 時長 / 文案 / 是否背景輪詢 = 決策 #3 子題。
  - settleCharge `no_attempt` → 既有單無 active attempt(已 markFailed/從未建)→ 視同 failed 放行重刷、保留 key。
  - 🔴 **settleCharge 呼叫必包局部 try/catch**(codex K1 should):`getSettleChargeDeps()` + `settleCharge()` 全包在 adjudication **局部** try/catch,任何 throw → 映 `processing`/`MSG.settlementRequired`(fail-closed hold、保留 key);**絕不可落到 charge-actions 外層 generic catch**(L202-206 回 formError → client 釋鎖允許重試 → 潛在雙扣)。
  - **鎖語意:** needs_settle 時 begin 未取鎖(0b L391-428 在 INSERT 前 return、advisory xact lock 隨交易結束釋)→ action 呼 settleCharge 無持鎖、settleCharge 自管冪等(Record API 權威 + markCharged/confirm `FOR UPDATE` + paid 短路)→ 零雙扣/零雙 settle。
  - `recTradeIdHint: existingRecTradeId ?? undefined` 為 settleCharge **fallback 入口**(對抗審查 nit):settleCharge 對 existingOrderId 重查 attempt、優先用重查到的 rec/bank(buildRecordQuery 優先序),hint 僅都無時用;pending orphan 傳 null/undefined 亦安全(走 order_number 弱識別窗)。
  - `getSettleChargeDeps()` 為 cookieless 主軌(settle-charge.ts L30-31);action 內可直接複用(callback page L124 同款)。existingOrderId 全鏈 server 權威(begin→adapter→action,client 零入口)→ 無 IDOR。
- **🔴 攻擊時序自審表(鐵則 10、對抗審查 should/concurrency — 顯式寫、不留隱性假設;codex K2 必查):**
  1. **failed 放行重刷 vs 客人稍後在舊 3D 頁完成 OTP** —— 結論:`failed` **僅由 Record `record_status ∈ {-1 ERROR, 5 CANCEL}` 終態**驅動(settle-charge classifyRecordStatus L243-245);TapPay 模型下「同交易終態 -1/5」與「後續 OTP 成功」**互斥** → 放行重刷後既有單**不會再成交** → 無雙扣。綁定前提:**Record record_status 終態語意**(未來改 settleCharge 裁決須重核、鐵則 10)。
  2. **callback settleCharge(page L124)× action settleCharge(7c)對同一 existingOrderId 並發** —— 結論:兩條走同一 use-case、讀 Record 同一權威 rec、經 markCharged/confirm `FOR UPDATE` 序列化 → 一條 paid、一條 idempotent no-op → 零雙扣/零雙 settle。
  3. needs_settle × {paid / failed / pending / no_attempt} × 並發逐態,殘餘風險**不自宣接受** → 任一未決 → 決策題。
- **鐵則:** 鐵則 12(payment 裁決核心、最敏感)、鐵則 8(跨 domain+use-case+action)、鐵則 10(攻擊時序自審表如上)。
- **rollback:** revert → 回 7b 的「一律處理中」UX(仍安全、僅不精緻)。
- **驗收(yes/no):** ☐ duplicate(既有 paid)/ needs_settle×settle=paid → 顯既有單號非「失敗」**且 client clear+regenerate(key 換新、重購不被擋)**(codex K1 must-fix) ☐ =failed → 放行重刷且**重結帳 begin 對 sibling dedup + user_in_flight 雙閘皆不命中**、保留 key ☐ =pending → 短 hold 不放行(防雙扣)、保留 key ☐ **settleCharge/getSettleChargeDeps throw → 局部 try/catch 映 processing(不落外層 generic catch、不誤釋鎖)**(codex K1 should) ☐ 攻擊時序自審表 1-3 逐項寫明結論、無未決殘餘風險 ☐ 三綠 + code-reviewer + codex K2。

### 7d — TTL staleness + user_in_flight 時間鎖退場(deferred、獨立 plan)🔴 鐵則 8

- **目標:** ① 棄單 TTL(**Sean 拍 Q2=B:24h staleness 換新**、對齊業界 Stripe;實作面 7d plan 定=begin dedup 加 24h 窗 或 client 棄單 key 24h 換新)② 審查報告 §五結論「3DS-7 落地後連同時間鎖一起廢」→ begin 移除/弱化 user_in_flight 閘(**動 migration → 鐵則 8 + db push + MCP 交易模擬 + codex K2**)。
- **為何 deferred:** ① 時間鎖退場是另一個重大改動、且須先有 7a-7c 落地 + sandbox 3DS E2E 實證 dedup 真擋雙扣後才安全拆鎖(否則拆了鎖、dedup 若有縫 = 裸奔)② TTL 棄單長尾非阻塞 prod 安全開放(棄單多自癒於 settleCharge:舊單 attempt 多已 expire/failed → begin 不命中或 needs_settle→failed→放行)。
- **本輪不實作。** 7a-7c 落地 + E2E 驗證後另開 7d plan(走完整 plan+codex+MCP+Sean 批)。
- **rollback:** N/A(本輪不做)。

---

## §4 安全 framing:信任 client 送的 cart_session_id(決策 #1 給 Sean 信心)

- **現況註解(0b / domain L207-208)** 寫「不信任 client 送值」是因 option A 過渡選擇 server 產;3DS-7 必須改信任 client key,這是設計轉向、非破壞安全。
- **為何安全:**
  1. **key 非敏感子:** 非價、非身分、非 tier、非金額 → 偽造它不洩任何敏感資料、不竄改任何金額/權限(鐵則 12 守線:價/tier/身分全 server `auth.uid()` + RPC 權威,與 key 正交)。
  2. **dedup 範圍鎖在自己:** begin 的 dedup query(0b L402)`WHERE o.customer_user_id = v_order.customer_user_id`(從 orders 讀歸屬、RLS own-only)→ 攻擊者偽造 key 只能影響**自己** customer_user_id 範圍的去重。
  3. **worst case = 自我 DoS:** 偽造/重用 key 最多讓攻擊者自己的訂單被自己的去重擋住(自找麻煩),**無跨用戶攻擊面、無雙扣放大**。
  4. **server 仍縱深驗:** `z.uuid()` 格式(泛 uuid)+ 非空 fail-closed(7b);非法 → 既有 placeOrder L32-34 + create_order 入口 null fail-closed + pg `uuid` cast 三重擋(注入/型別混淆無路:unknown → zod uuid string → typed RPC arg → pg uuid)。
  5. **key 不在任何讀投影、不回 client**(對抗審查 confirmed-sound):`ORDER_LIST_SELECT` / callback 歸屬讀(`.select('display_id')`)/ `findTotal` 皆無 cart_session_id 欄;全 repo 零 SELECT 投影 → key 留 localStorage(自己瀏覽器)+ orders 表(RLS own-only),不外洩給他人重用。
- **🔴 不變量(防未來退化、列 7b/7c code-reviewer + codex K2 必查 — 對抗審查 should):** cart key **只在 create_order 寫入時信 client 一次**(寫進歸屬於 `auth.uid()` 的 order row);此後 begin dedup / settleCharge 一律**讀 DB row 上的 key**(0b begin L367/L404 從 orders 讀)、**永不接受 client 重送的 key 當比對輸入**。若未來有人為「效能」讓 begin 直接信 client 送的 key,則信任模型崩 → 嚴禁。
- **建議拍:信任 client key + server 驗 `z.uuid()` 格式 + 非空**(決策 #1=A)。

---

## §5 決策題(Sean 2026-06-21 拍板)

> **🟢 Sean 拍板:Q1=A / Q2=B / Q3=A / Q4=A / Q5=A。** 下列為各題定案。

1. **#1 信任 client cart_session_id?**(7b 核心)— **A 拍**:信任 + server 驗 `z.uuid()` 格式/非空(§4 framing、業界標準 Stripe idempotency key)。
2. **#2 棄單 TTL?**(**7d、本輪不做**)— **B 拍**:**24h staleness 換新**(對齊業界 Stripe ~24h;棄單隔天當新意圖、體驗較順)。→ 7d 落實:begin dedup 加 24h 時間窗 **或** client 棄單 key 24h 後換新(7d plan 定實作面)。**本輪 7a-7c 不碰、維持 0b 永久去重現況**;7d 才疊 24h。
3. **#3 needs_settle 裁決映射 + 短 hold?**(7c)— **A 拍**:paid→顯既有單+clear+regenerate / failed→放行重刷 / pending→短 hold「狀態確認中」(沿用 MSG.settlementRequired);**本輪不加背景輪詢**(自動偵測留 follow-up)。
4. **#4 key 生成 + clear() 點 key 命運?**(7a/7b)— **A 拍**:regenerate **僅「DB 確定 paid」**(useChargePayment paid + callback paid + 7c duplicate-paid),一切模糊態(processing/unknown/callback pending)保留 key 防雙扣;**手動清車保留 key**(無害最簡)。
5. **#5 切片邊界 + 順序?**— **A 拍**:7a→7b(含 regenerate)→7c(可拆 7c-1/7c-2)→7d(deferred);regenerate 併入 7b、7d 延後。

---

## §6 測試策略 + 範圍外

- **測試:** 每片動前端元件 → 補/更 smoke test(`*.test.tsx`);動 use-case/domain → vitest 單元(mock begin 回 duplicate/needs_settle、mock settleCharge 各態);7b/7c 命中鐵則 12 → code-reviewer + codex K2;dedup 端到端真擋雙扣 = sandbox 3DS E2E(Sean 肉眼驗、7a-7c 後)。**動共用元件後跑完整 vitest**(非子集)。
- **範圍外(明確不做、列此供 codex/Sean 確認已考慮):**
  - 不把 dedup 移到 create_order 層(§1 事實 1;偏離 0b 架構、更大改動)→ 孤兒未付單清理列 **backlog 候選**(無 `(uid,cart_session_id)` UNIQUE 約束 → create_order 不 23505、孤兒單須 sweeper 清非靠 DB 約束;或 create_order 對 key 冪等)。
  - **`usePlaceOrder` / `placeOrderAction` 退役死碼清理列 backlog 候選**(對抗審查 must-fix:刪除,消「兩條 cartSessionId 來源語意並存」的 bug 追蹤面)。
  - **跨分頁 cartSessionId 同步(storage event 監聽)列 backlog 可選**(消 B 分頁對同批商品反覆撞 duplicate 的 UX 噪音;**純 UX、安全無虞** — 現況舊 key 撞 dedup 已防雙扣)。
  - 不在本輪退役 user_in_flight 時間鎖(7d deferred)。
  - 不碰 #243(confirm 綁扣款證據)/ #244(四路 settle lease)— 各自獨立 slice、prod 開放前另排。
  - 不碰價/tier/經銷價(鐵則 12 守線,本治本與金額正交)。

---

## §7 rollback 總體

- 7a / 7b / 7c **皆純 code、零 migration、零 DB 足跡** → 任一片 revert 即回前一安全態(7b revert→option A dormant;7c revert→7b「處理中」UX)。
- 7d(deferred)動 migration → 屆時獨立 plan 附 forward+rollback SQL + db push bundle 紀律。

---

## §8 審查結果

### §8.1 Claude 多視角對抗審查(已完成、findings 已折入本 plan)

> 規劃 session 跑 5 視角對抗審查(雙扣正確性 / 並發時序 / 安全信任 / code 精確性 / 切片完整性),各視角獨立對真 code 驗證。

- 🔴 **must-fix(已折入):**
  1. **regenerate 範圍**:原「所有成交清車點 regenerate」會在模糊態換 key 引入**真雙扣縫** → 改「僅 DB 確定 paid regenerate、模糊態保留 key」(§1 事實 2、§2 圖、§3 7b 表)。
  2. **clear() 點列舉不全**:漏 useChargePayment processing(L129)/unknown(L109)→ 補完整表(§3 7b)。
  3. **退役死碼**:usePlaceOrder/placeOrderAction 已退役、非 live wire 站 → 7b scope 縮為 useChargePayment+charge-actions+ClearCartOnSuccess+schema(§3 7b)。
- 🟡 **should(已折入):** 7a regenerate gate isHydrated;hook 內部讀 useCart() 非改簽名;7c failed 退出 dedup+user_in_flight 雙閘;攻擊時序自審表顯式列 failed-vs-OTP + 並發 settle;§4 加「begin 永讀 DB row key」不變量 + 讀投影零外洩;uuid 措辭泛 uuid 非 v4;跨分頁 desync 機制說明。
- ✅ **confirmed-sound(親讀證實):** 治本骨架(dedup 在 begin 層、永久去重、移 user_in_flight 閘前)、信任 client key 的 self-DoS-only framing、existing_* 已在 adapter+domain 待 surface、settlement_required 空殼、rollback 純 code 零 migration、L 分級/估時/鐵則標記。

### §8.2 codex K1 審查結果(跨模型、read-only、zero-trace 已驗)

> 跑於 main session、`codex exec -s read-only -c service_tier="fast" < /dev/null`、porcelain 跑前後一致(零留痕)。

**round 1 = FAIL(1 must-fix + 3 should + 1 nit),全已折入:**
- 🔴 **must-fix(folded):** 7c `duplicate`/`needs_settle→settle=paid`(既有單確定 paid)未明確接回 regenerate → 保留舊 key 會擋下次重購 → 改映 client paid-equivalent 終態 → clear+regenerate(§3 7b 表 + 7c 設計要點/驗收)。
- 🟡 **should(folded):** ① settleCharge 呼叫包局部 try/catch、不落外層 generic catch(否則釋鎖允許重試→雙扣)② server zod 不改共用 `CheckoutInput`、用局部 `CartSessionIdInput`(退役路徑本輪不動)③ `charge-actions.test.ts` L204-226「client key 被覆蓋」斷言必反轉(否則三綠紅)。
- ⚪ **nit(folded):** 7b L 分級 `L2→L1` 改單一 `L2`。
- ✅ **confirmed(跨模型與 Claude 對抗審查收斂):** D2/D4 dedup 事實、信任 client key framing(begin 讀 DB row 非信 client 重送)、existing_* 已在 domain+adapter、7c failed 前提(僅 Record terminal + charged→failed DB 拒)、退役 usePlaceOrder/placeOrderAction 判斷。

**round 2 = PASS(0 剩餘 must-fix):** 5 項(1 must-fix + 3 should + 1 nit)逐項 RESOLVED、未發現新 must-fix。codex 雙關卡硬上限 2 輪、round2 PASS、收斂。

> **plan 審查結論:Claude 5 視角對抗審查 + codex K1 跨模型雙輪(r1 FAIL→折入→r2 PASS)收斂;治本骨架/安全 framing/切片/rollback 經兩方獨立對真 code 驗證。等 Sean 批 plan + 拍決策題。**

---

## §9 執行交接(六件套草稿;Sean 決策後最終化)

> 7a 為 decision-light(僅受 #4 影響細節)、可先給;7b/7c 受 #1/#3/#4 影響、待 Sean 拍板後最終化參數。完整六件套於決策回來後產(寫審分離:執行 worktree + 審查 session)。

_(六件套於 §3 各片「動到的檔 / 驗收 / 禁止清單」基礎上,Sean 決策後組裝;見本 session 末段提示詞草稿)_

— END —
