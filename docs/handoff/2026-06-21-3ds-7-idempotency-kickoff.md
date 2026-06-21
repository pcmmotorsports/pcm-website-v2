# 3DS-7 cart_session_id 冪等治本 — kickoff handoff(2026-06-21)

> **給接手 session(fresh context)。** 任務 = 規劃 3DS-7(把休眠的 cart_session_id 冪等去重叫醒、治本 3DS pending 雙扣)。
> **先走完整起手**(讀 STATUS「下一步」+ 本檔 + 真權威 grep);**這是鐵則 8 + 12 重大改動 → 先寫 plan + codex K1 + Sean 批,才動 code。**
> **本 session 不寫 code、只規劃。** 動手實作走寫審分離(執行 worktree + 審查 session)。

---

## §0 一句話 + 當前 git 狀態

**3DS-7 = 把 `cart_session_id` 從「server 每次 randomUUID(休眠)」改成「client CartContext 穩定 key(購物車生命週期內穩定、成交才換新)」**,讓既有但休眠的 begin dedup(D2/D4)+ settleCharge 裁決真正生效 → 治本「3DS pending >10 分、時間鎖過期、同意圖重結帳 → 雙扣」。修好後可廢除傷轉換率的 user_in_flight 時間鎖。

- **branch:** dev,**HEAD=`7c0af81`**(金流四方審查 docs)。
- **未 push:** dev 領先 origin/dev(`50aa20f`)**7 commit**,全待 Sean 手動推(含 queryStatus-fix 6 + audit 1)。**接手 session 別自己 push。**
- **工作樹:** 乾淨(本 handoff commit 後)。
- **prod 結帳:** 仍 flag-gated 僅 sandbox、未開放、零真流量 → 3DS-7 從容做、不急。

---

## §1 怎麼走到這裡(脈絡)

1. M-3 3DS「授權即成立」結算重設計做到 S2b;真刷暴露 settleCharge `queryStatus=2` 誤判 → 修復 + 真刷 PCM-2026-0019 驗證通過(已 merge dev=bbe87e5)。
2. 下一片本要做 S4「縮 in-flight 時間鎖 10→3 分」。Sean 退一步問「業界怎麼解 3DS 雙扣」。
3. **金流交易流程四方安全審查**(Claude 親讀 + Codex 跨模型 + Gemini 業界 + Stripe/Adyen 基準)→ 報告 `docs/reviews/2026-06-21-payment-flow-multiparty-audit.md`。
4. **結論:業界靠 idempotency key 不靠時間鎖;PCM cart_session_id 雛形休眠 → S4 縮窗是治標、治本=3DS-7。** Sean 拍 **Q1=A 暫停 S4 縮窗、改做治本 3DS-7**(S4 plan 已加「暫停」banner)。
5. 審查也抓到 2 個 prod 開放前要補的縱深項:**backlog #243**(confirm RPC 綁扣款證據)、**#244**(四路共用 settle lease)—— 非 3DS-7 範圍、各自獨立 slice、prod 開放前排。

---

## §2 3DS-7 治本目標 + 既有「休眠骨架」(關鍵:大半骨架已就位、3DS-7 是叫醒不是重建)

**現況**:前端每次結帳 `randomUUID()` → 同購物車重複結帳也是不同 key → begin 的 cart-instance dedup 永遠 0 sibling → 去重休眠 → 只剩 user_in_flight 10 分鐘時間鎖擋雙扣。

**既有已就位的骨架(不要重做、要接上):**
- ✅ `orders.cart_session_id` 欄 + dedup index(migration 0b、已 prod)。
- ✅ `begin_charge_attempt` 的 **cart-instance dedup(D4)** 完整邏輯已寫好(0b、已 prod):同 user 同 key 異單三態 → `duplicate`(sibling 已 paid)/ `needs_settle`(charged 或 pending 未 paid、交 settleCharge 裁決)。**現在因 key 不穩定而 dormant。**
- ✅ `create_order` 5-param 寫 cart_session_id + null fail-closed(已 prod)。
- ✅ domain/use-case/mapper 鏈已穿 cartSessionId(option A:server 產)。
- ✅ `settlement_required` outcome + UI「狀態確認中」文案已預留(charge-actions L237-242)。
- ✅ settleCharge 對帳脊椎(record_status 0/1→成立、識別/金額/時間窗三重縱深)已完備。

**3DS-7 要補的(治本 4 件、= 待規劃拆子切片):**
1. **CartContext 持有穩定 cartSessionId** —— 空車→第一件生 UUID、持久化(localStorage)、跨重結帳穩定。
2. **server action 改用 client 送的 key**(現 randomUUID server 產)—— ⚠️ 涉及「信任 client 送 key」的安全 framing(見 §5 決策題)。
3. **成交/清車後 regenerate key**(換新、避免成交後同 key 再被去重)—— ClearCartOnSuccess TODO 已標位置(L17-19)。
4. **action 層完整消費 D2/D4** —— `duplicate`→顯既有單;`needs_settle`→lock 外跑 settleCharge 即時裁決(paid→duplicate / 明確失敗→放行重刷 / 模糊→短 hold)。現只映 settlement_required(dormant)。

---

## §3 cart_session_id 全鏈現況地圖(file:line、接手直接用、不必重跑偵察)

| 項 | file:line | 機制 |
|---|---|---|
| **A1** 前端產生(placeOrderAction) | `apps/storefront/src/app/checkout/actions.ts:113` | `cartSessionId: randomUUID()` 每次新產(休眠根因) |
| **A2** 前端產生(chargePaymentAction) | `apps/storefront/src/app/checkout/charge-actions.ts:154` | `cartSessionId: randomUUID()` 同上 |
| **A3** CartContext(無 sessionId 概念) | `apps/storefront/src/contexts/CartContext.tsx:58-65` | CartItem={productId,variantId?,qty};無狀態 id |
| **A3b** localStorage key | `apps/storefront/src/contexts/CartContext.tsx:45` | `'pcm-cart-mock-v2'`;無 session 標記 |
| **B1** domain 型別 | `packages/domain/src/order/types.ts:218` + 註 L206-208 | PlaceOrderInput.cartSessionId:string(註明 option A 過渡、3DS-7 改 client 產) |
| **B2** use-case fail-closed | `packages/use-cases/src/place-order.ts:32-34` | `if(!input.cartSessionId) throw` |
| **B3** mapper wire | `packages/adapters/src/supabase/mappers/order.ts:82` | domain→`p_cart_session_id` 白名單 |
| **B4** RpcArgs 型別 | `packages/adapters/src/supabase/mappers/order.ts:41` | `p_cart_session_id:string`(5-param) |
| **C1** dormant dedup 分支 | `packages/use-cases/src/confirm-payment.ts:52-56` | begin{duplicate/needs_settle}→settlement_required(註:option A 下 dormant) |
| **C2** UI 映射 | `apps/storefront/src/app/checkout/charge-actions.ts:237-242` | settlement_required→「狀態確認中」(非 charge_failed) |
| **D1** 清車元件 + TODO | `apps/storefront/src/components/ClearCartOnSuccess.tsx:17-19, 28-34` | 清品項;**TODO 3DS-7:此 isHydrated gate 內 clear() 旁補 regenerateCartSession()** |
| **D2** callback paid 流 | `apps/storefront/src/app/checkout/callback/page.tsx:134-140` | 掛 ClearCartOnSuccess(無 regenerate) |
| **D3** callback pending 流 | `…/callback/page.tsx:155-161` | 掛 ClearCartOnSuccess + 輪詢(無 regenerate) |
| **D4** callback no_attempt/failed | `…/callback/page.tsx:130-133, 149-150` | **不清車**(車保留) |
| **DB** begin dedup D4 全文 | `supabase/migrations/20260613130000_m3_3ds_0b_cart_session_dedup.sql:391-428` | 三態 dedup、ORDER BY paid→charged→最近、移 user_in_flight 閘前;**已 prod、已就位、休眠中** |
| **DB** create_order 5-param | 同檔 `:107-339` | 寫 cart_session_id + null fail-closed |

**3DS-7 註記散落 7 處**(全 grep `3DS-7` 命中,接手可逐一對齊):order/types.ts L206-208、payment/types.ts L275-277、actions.ts L111-113、charge-actions.ts L152-154 + L241、confirm-payment.ts L52-53、ClearCartOnSuccess.tsx L17-19。

---

## §4 規劃任務(接手 session 要產出的東西)

1. **起手檢查**(branch=dev / 樹乾淨;⚠️ HEAD=7c0af81 領先 origin 7 為已知狀態、非異常,別「修復」)。讀 STATUS「下一步」第 1 條 + 本檔 + 審查報告 §五/§六 + 0b migration 真權威(已在 §3 給座標)。
2. **寫 3DS-7 plan**(`docs/specs/2026-06-21-m3-3ds-7-cart-idempotency-plan.md` 或當日日期):
   - 拆**子切片**(建議草案見下、接手自行定奪):
     - **7a** CartContext 穩定 cartSessionId(state + localStorage + 空車首件生 + regenerate hook;純前端 state、L1)
     - **7b** server action 改用 client key(actions/charge-actions 取 client 送值取代 randomUUID;含信任模型 framing;鐵則 12)
     - **7c** action 層完整消費 D2/D4(duplicate→顯既有單、needs_settle→lock 外 settleCharge 裁決;最重、鐵則 12 payment 核心)
     - **7d** 成交 regenerate + TTL 策略(ClearCartOnSuccess 補 regenerate;TTL 24h 落點決策)
   - 每片標 **L1/L2/L3**、估時 15-45 分(超出再拆)、列**動到的檔**(用 §3 座標)、**鐵則 8/12** 標記、**rollback**。
   - **CSS+TSX 同 slice、前後台同步**(7a/7b 前端為主、7c 跨 use-case/action)。
3. **codex K1 審 plan**(鐵則 8 重大改動 → 必跑;main session、`-s read-only`、`< /dev/null`、`-c service_tier="fast"`、porcelain 零留痕)。餵 plan + 0b dedup 真權威 + eslint boundaries(跨層 import,見 memory `codex-k1-feed-boundaries-config`)。findings 折入(硬上限 2 輪)。
4. **決策題批次交 Sean**(prose multi-select、白話、見 §5 種子)。

---

## §5 已知設計岔路(plan 裡要 framing 給 Sean 的決策題種子)

> 這些是規劃時會撞到、需要 Sean 拍的點。接手別自己決定、用 prose multi-select 問。

1. **信任 client 送的 cart_session_id?**(7b 核心)
   - 現 0b 註解寫「不信任 client 送值」(option A 才 server 產)。3DS-7 必須改成信任 client key。
   - **安全 framing(已分析、給 Sean 信心):** key 是「非價/非身分/非 tier」的純去重子;dedup 在 `customer_user_id` 範圍內(begin 從 orders 讀歸屬、RLS own-only)→ **偽造 key 最多影響攻擊者自己的去重(自找麻煩),無跨用戶攻擊面**。worst case = 自我 DoS 自己訂單。建議拍「信任、但仍 server 驗 uuid 格式 + 不可空」。
2. **TTL 24h 怎麼落?**
   - 0b 現設計「無時間窗、同 key 永久去重直到清車換新」。靠 regenerate(成交時)換新 → 已完成購買的去重會自然失效。
   - 但**棄單(abandoned cart)**不會 regenerate → 同 key 永久。要不要加「24h staleness → 換新 key」讓棄單隔天當新意圖?還是維持永久(更安全防雙扣、但棄單客人隔天回來會被當同意圖)?
3. **needs_settle 在 action 層怎麼裁決?**(7c 核心、payment 最敏感)
   - 0b 設計:lock 外跑 settleCharge → paid→duplicate(顯既有單)/ 明確失敗→markFailed 放行立即重刷 / 模糊(pending)→短 hold。
   - 「短 hold」要 hold 多久?顯什麼文案?與既有 settlement_required UI 文案怎麼接?
4. **regenerate 時機**:只成交(paid/pending)regenerate,還是手動清車也 regenerate?no_attempt/failed(車保留)時 key 留不留?
5. **子切片邊界 + 順序**:7a→7b→7c→7d 還是合併?7c 沒有穩定 key 無法真測 → 是否 7a+7b 先落、7c+7d 接?

---

## §6 session 拓樸建議

- **本接手 session = 規劃腦**(寫 plan + codex K1 + framing 決策題)。單 session、不分。
- **Sean 批 plan + 拍決策題後** → 開**執行 session(worktree 隔離**,memory `concurrent-session-git-index-contamination`/`feedback_execution-review-session-split`)實作子切片;**這個規劃 session(或另開審查 session)轉審查**(fresh-context 重驗 + codex K2 + sign-off)。
- 並行多 session 必用獨立 git worktree(防共用 index 撞車)。

---

## §7 鐵則/紀律提醒

- **鐵則 8**:跨前端+server+(可能)migration → 先 plan 等批。**鐵則 12**:payment/雙扣/idempotency → codex K1+K2、MCP 交易模擬(若動 DB)。
- **鐵則 1**:寫前端對齊 design 先 grep 真權威(7a CartContext 動 state 非視覺、design 影響小,但若動結帳頁 UI 文案要 grep)。
- **不 push、不 merge、不替 Sean 拍板**;**精準 git add**(禁 `.`/`-A`);**不碰 .env\***;**決策走 prose multi-select 不走 AskUserQuestion**;**繁體中文**。
- **金額禁浮點 / 經銷價零外洩 / tier server 驗**(3DS-7 不碰價,但守住)。
- codex 只 main session 跑、`-s read-only`、跑前後 porcelain 零留痕比對。

---

## §8 參考檔

- 審查報告:`docs/reviews/2026-06-21-payment-flow-multiparty-audit.md`(§五 S4 重定位 / §六 top 3 / §三 #1 cart_session_id)。
- 0b dedup 真權威:`supabase/migrations/20260613130000_m3_3ds_0b_cart_session_dedup.sql`(begin dedup L348-467、create_order 5-param L107-339)。
- master plan v5:`docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §2/§4(D4 override、3DS-7 位置)。
- cross-tab plan:`docs/specs/2026-06-13-m3-cross-tab-double-charge-fix-plan.md` §3.1/§4.1(cart-instance idempotency 原始設計)。
- S4 暫停 plan:`docs/specs/2026-06-21-m3-3ds-s4-inflight-lock-window-plan.md`(banner 說明為何治標)。
- backlog #243/#244:`docs/phase-1-backlog.md`(prod 開放前縱深項、非 3DS-7 範圍)。
- memory:`project_m3-3ds-querystatus-fix-execution-session` / `project_3ds-db-push-bundle-blocked-until-cart-session-integration` / `project_cart-session-codex-k2-pending`(option A 整合史)。

— END —
