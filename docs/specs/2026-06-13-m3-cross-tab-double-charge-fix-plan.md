# M-3 cross-tab 雙扣修 — slice plan(2026-06-13、執行 session 自驅;鐵則 8+12、等 Sean 批)

> **v2 路 2 改版**(Sean 拍):判別子改 **cart-instance idempotency key(cart_session_id)**,
> **取代** v1 的「內容指紋 + N 分鐘窗」(誤殺合法連買 + 時間窗皆消除)。codex 兩輪挖的
> 「三態已扣款證據(charged / order-paid / orphan-pending)」**照搬、改 keyed on cart_session_id、
> 拿掉時間窗**。
> 觸發:審查側挖到第二條真雙扣 = cross-tab / 多開視窗;同分頁(f0c359b)已三方 PASS 不退。
> 命中鐵則 8(跨 client→DB 多層 / 動 orders schema·create_order·begin RPC·CartContext)+ 鐵則 12
> → **本文件 = plan,等 Sean 批,再實作**;codex 關卡1 重審 key 段 race-free 後給 Sean。

---

## 1. 問題確認(審查側已證實 real)

同會員開兩個 checkout 分頁(同一 cart):每次 `chargePaymentAction` 都 `placeOrder` 建新單
(Tab A=單A、Tab B=單B、order_id 不同)。Tab A 刷卡 paid;切到 Tab B(殘留 step3、同 cart)按付款 →
建單B、**第二次扣款**。根因(begin RPC `20260612150000` 的 per-user 閘 L210 `o.payment_status <> 'paid'`
故意排除已付款單)→ 單A 一旦 paid 就不再擋 B 的新單;per-order UNIQUE 鎖只防同一張單;CartContext 無跨
分頁同步。**同分頁 100% 安全**(inFlightRef/primeBusyRef/unknown 終態/per-order 鎖);非 f0c359b 引入。

---

## 2. cart-instance idempotency key 設計(路 2 核心)

- **client(CartContext、localStorage)**:`cart_session_id` = UUID,在「**空車 → 第一件**」時生成、
  與 items 同存 localStorage;`clear()` 時一併刪除 → 下次購物第一件生**新 UUID**(清車重買 = 新 key、
  **不擋**、誤殺消失)。checkout 送出時帶上(用 **React state 的 key**、非送出時重讀 localStorage)。
  - **適用範圍(codex r1 🟡#3 收斂)**:保證「**同 storage partition + 同一已建立 cart_session_id 的 cart**」
    跨分頁共用。**不保證**:隱私/無痕視窗(獨立 partition)、不同瀏覽器、localStorage 寫入失敗退化
    session-only、兩分頁**同時**對空車首加商品(各生 key 的競態、罕見)。這些邊角**不弱化防線**
    (server dedup 仍以實際送出的 key 為準;最壞退化 = 該次無共用 key、回退到 per-user 閘 + 同分頁防線、
    不雙扣只是少一層);非「保證一致」而是「儘量共用、server 為準」。
- **server**:`cart_session_id` 存 **orders**(create_order RPC 寫);begin RPC(advisory lock 內)
  dedup =「同 user 是否已有『此 key』的 **charged / order-paid / orphan-pending** 單」→ 撞 → 回
  duplicate + existingDisplayId(+ existing_paid 供 D2 照實顯示)。
- **判別子優勢 vs v1 指紋**:同 key = 同一車實例(精確、非內容近似)→ 合法連買同款(新車/新 key)零誤殺;
  **時間窗整個拿掉**(同 key 永久去重直到清車;不需 N、無 created_at/N 邊界 edge)。
- **竄改面**(Sean 確認、標準 idempotency):client 送 key,改 key 只自害(自己雙扣自己)、per-user 範圍
  (dedup 限 same user、不能用他人 key 干擾);安全。

---

## 3. 攻擊時序自審(keyed on cart_session_id;memory adversarial-timeline)

advisory xact lock(per-user)序列化同會員 begin;dedup 三態查「同 user + 同 cart_session_id + 異單」。
**無時間窗**(同 key 永久去重)。

| # | 時序 | 結果 |
|---|---|---|
| T1 | 真同時:A.begin 插 attempt_a(order_a 同 key、pending)→ B.begin(lock 等)查 per-user 閘見 attempt_a pending+單A未paid | **in_flight 擋 B** ✓ |
| T11① | A markCharged 成功 + confirm 成功(attempt charged、order_a paid) | dedup 支1(同 key 之 charged)擋 ✓ |
| T11② | 🔴 A markCharged 雙軌全敗但 confirm 成功(attempt 留 **pending**、order_a 翻 **paid**;②-③c fail-open) | dedup 支2(同 key 之 order paid)擋 ✓(codex r1 🔴#1) |
| T11③ | 🔴 A markCharged 全敗 + confirm 也失敗(orphan:attempt **pending**、order_a **unpaid**、錢可能已扣) | dedup 支3(同 key、attempt pending、order 未 paid)擋 ✓(codex r2 🔴;**無時間窗 → per-user 閘過期後仍擋**) |
| T2 | 清車重買(新車 → 新 key) | dedup 查無同 key → **不擋** ✓(誤殺消失) |
| T3 | A charge 失敗 → markFailed **成功**(attempt failed),同車重試(同 key、新 order_b) | failed 不在三態 → 不擋 → **B 正常扣**(合法、A 沒扣到) ✓ |
| T3' | 🔴 A charge **失敗** → markFailed **全敗**(recordPersisted:false、attempt 留 **pending**、order unpaid、**未扣款**),同車重試 | 支3(pending+unpaid)**誤擋**(把未扣款當 orphan)→ codex r1 🔴#1 → **D4 決策**(↓§7) |
| T4 | 合法連買**不同**商品(新車、新 key) | 不同 key → 不擋(硬約束 b) ✓ |
| T5 | client 竄改 key 繞 dedup 自我雙扣 | 自害、per-user 範圍 → 非威脅 ✓ |
| T6 | true concurrent 兩者都過 dedup | 不可能:advisory lock 序列化 begin、後者必見前者 attempt(落 T1/T11) ✓ |

**race-free 證明**:dedup 在 begin 的 advisory xact lock 內(per-user 序列化)→ B.begin 必見 A.begin 已插
的 attempt + order(同 key);三態涵蓋全部「已扣款/扣款中」事實(charged 或 order-paid 或 pending-unpaid)。
同 key 永久去重 → 無 v1 的「N 分鐘後同物再現」窗(清車才換 key)。

🔴 **支3 的不可區分性(codex r1 🔴#1、待 D4)**:支3「pending+unpaid」想擋 **orphan-pending**(charge 成功
但 markCharged+confirm 全敗 = **錢可能已扣**);但它**也吃到** charge **失敗** + markFailed 全敗
(recordPersisted:false = **未扣款**)的 pending —— 兩者在 DB **完全同狀態**(pending + unpaid + 無 rec、
confirm-payment 故障下都寫不進區分標記;備軌不可釋鎖故 markFailed 無備援)→ **DB 層無法區分**。
永久擋 → 誤殺後者的合法重試(現 ②-③e charge_failed_wait 承諾「未扣款、稍候再試」)。**D4 拍。**

---

## 4. 改檔清單(單一 vertical slice:cart_session_id 維度 client→DB 貫穿;不拆)

### 4.1 新 migration `20260613xxxxxx_m3_s2_cart_session_dedup.sql`(orders/attempts 皆 0 row、見 §6 rollout)
1. `ALTER TABLE public.orders ADD COLUMN cart_session_id uuid`(nullable=相容;新流程 create_order 必寫)。
2. dedup index:`CREATE INDEX ... ON public.orders (customer_user_id, cart_session_id)
   WHERE cart_session_id IS NOT NULL`。
3. **DROP `create_order(jsonb,uuid,text,jsonb)` + CREATE `create_order(jsonb,uuid,text,jsonb,uuid)`**
   (加 `p_cart_session_id uuid`、INSERT 寫 orders.cart_session_id;舊 4-參數版必 DROP=防殘留不寫 key 後門)。
   - 🔴 **null key fail-closed(codex r1 🟡#4)**:5-參數版在**任何 nextval / INSERT 之前**
     `IF p_cart_session_id IS NULL THEN RAISE`(防舊/惡意 client 製造無 key unpaid 垃圾單 + 燒 display_id seq)。
   - 🔴 **GRANT 硬化(codex r1 🔴#2;memory supabase-service-role-execute-default-grant)**:Supabase 對新函式
     **預設給 service_role EXECUTE**、只 REVOKE PUBLIC/anon 不夠 → 顯式
     `REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid) FROM PUBLIC, anon, service_role, payment_confirmer`
     + `GRANT EXECUTE ... TO authenticated`;末 DO assert 驗 `authenticated=true / anon=service_role=payment_confirmer=false`。
4. **CREATE OR REPLACE `begin_charge_attempt(uuid)`**(簽名**不變** — key 從 orders 讀、非 client 傳給 begin
   → 無 v1 NULL 軟繞過面):
   - begin 既有 `SELECT ... FROM orders WHERE id=p_order_id` **加讀 `cart_session_id`**;
     **fail-closed**:`IF v_order.cart_session_id IS NULL THEN RAISE`(新流程訂單必有 key)。
   - advisory lock 後、per-user 閘**之後**,加 dedup(三態、**無時間窗**):
     ```sql
     SELECT o.display_id, (o.payment_status = 'paid'::public.payment_status)
       INTO v_dup_display, v_dup_paid
       FROM public.orders o
       LEFT JOIN public.payment_charge_attempts a ON a.order_id = o.id
      WHERE o.customer_user_id   = v_order.customer_user_id
        AND o.id                 <> p_order_id
        AND o.cart_session_id    = v_order.cart_session_id
        AND (
          a.status = 'charged'                                          -- 支1 markCharged 成功(實扣)
          OR o.payment_status = 'paid'::public.payment_status           -- 支2 confirm 成功(attempt 可能 pending)
          OR (a.status = 'pending'                                      -- 支3 orphan/卡住 pending
            AND o.payment_status <> 'paid'::public.payment_status)
        )
      ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC, o.created_at DESC
      LIMIT 1;
     IF FOUND THEN
       RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'duplicate',
                'existing_display_id', v_dup_display, 'existing_paid', v_dup_paid);
     END IF;
     ```
5. 末加 `has_function_privilege` fail-closed assert(begin 對 payment_confirmer=true / 其餘 false;
   create_order 矩陣見上)+ 斷言舊 `create_order(jsonb,uuid,text,jsonb)` 4-參數版已 DROP
   (`to_regprocedure('public.create_order(jsonb,uuid,text,jsonb)') IS NULL`、防後門)。
6. **不動** per-user 閘原 predicate(硬約束①②:paid-exclusion 不拿掉、現有 in_flight/order_locked/
   not_unpaid 路徑原封不動;dedup 為 advisory lock 內**獨立新增**)。

### 4.2 跨層 plumb
| 層 | 檔 | 改 |
|---|---|---|
| client | `contexts/CartContext.tsx` | 生成/存/clear cart_session_id(localStorage、空車→第一件生 UUID、clear 刪);暴露給 checkout 送出 |
| domain | `payment/types.ts` | 新 outcome `{ kind:'duplicate'; existingDisplayId:string; paid:boolean }`;`BeginChargeAttemptResult` +`{ acquired:false; reason:'duplicate'; existingDisplayId:string; existingPaid:boolean }`;`PlaceOrderInput` +`cartSessionId: string` |
| schemas | `schemas/src/index.ts` | checkout input +`cartSessionId`(zod `.uuid()`) |
| ports | `IChargeAttemptStore.ts` / `IOrderRepository` | begin parse duplicate;create 傳 cartSessionId |
| adapters | `PgChargeAttemptAdapter.ts` | begin parse `existing_display_id`+`existing_paid`(duplicate 缺值 throw) |
| adapters | `SupabaseOrderAdapter.ts` | create_order 傳 `p_cart_session_id` |
| use-cases | `placeOrder` / `confirm-payment.ts` | placeOrder 透傳 cartSessionId;begin `!acquired`+duplicate → `{ kind:'duplicate', existingDisplayId, paid }` |
| delivery | `charge-actions.ts` | 收 client cartSessionId(zod)→ placeOrder;`mapOutcome` duplicate → paid? `{ok:true,displayId}`(成功頁) : processing(勿重複付款)、displayId=existingDisplayId(**不 fallback**) |

(v1 的 `lib/payment/cartFingerprint.ts` **不建**;begin 簽名不變、無新 fp 工具。)

---

## 5. 硬約束逐一對應(Sean 指令)
- **①不拿掉 paid-exclusion** → ✓ per-user 閘原封不動,dedup 為 advisory lock 內獨立新增。
- **②不弱化同分頁防線** → ✓ inFlightRef/primeBusyRef/unknown/per-order 鎖全不動。
- **③不改已套用舊 migration** → ✓ 新 migration:orders ALTER + create_order DROP/CREATE + begin CREATE OR REPLACE;舊檔零改。
- **④金額整數·經銷零洩·密鑰 server-only** → ✓ cart_session_id 不碰金額/價;begin/create_order 只 GRANT 既有角色;displayId 已 client 可見。

---

## 6. rollout(✅ 零殘洞;MCP 唯讀實查 2026-06-13)
prod 現狀:`orders` 0 row、`payment_charge_attempts` 0 row、無 cart_session_id 欄、create_order 在 prod。
→ 階段② **未上線、零真實付款流量**;cross-tab migration 在 0-row 表上 ALTER/改 RPC → **無舊 row 缺 key 殘洞**
(v1 揭示的切換期問題在編號法 + 0-row 下一樣消失)。Sean db push 後、肉眼驗才開放刷卡、屆時 migration 已上。

---

## 7. D 決策
- **D1 時間窗** = ❌ 取消(Sean 已拍、編號法不需要)。
- **D2 照實顯示既有單**(Sean 已拍):dedup 回 existing_paid → paid → 成功頁「訂單已成立」+ 既有單號;
  未 paid → 「處理中、勿重複付款」+ 既有單號。
- **D3 client BroadcastChannel** = ❌ 本片不做、列 **backlog #227**(Sean 已拍;server dedup 為主防線)。

### 🔴 D4(新、待 Sean 拍)— 支3 誤殺 failed-pending(codex r1 🔴#1)
支3「同 key pending+unpaid 永久擋」無法區分 orphan-pending(錢可能扣了、該擋)vs charge 失敗+markFailed
全敗(未扣款、現承諾可重試)。兩者 DB 同狀態(§3 揭示)。前提:兩者皆**罕見**(markFailed 全敗 = 主軌
pg ×3 全死);選一:
```
D4 同 key 的 pending+unpaid(已知未扣款 vs 可能已扣款不可分)怎麼處置
   A =(推薦、對齊「寧卡單勿雙扣」)支3 永久擋 + 把 charge_failed_wait 文案改誠實終態
       「這筆訂單尚在確認中,如需協助請聯繫客服 LINE」(不再承諾自助重試);使用者出路 = **清車重買**
       (新 key 不擋)或客服。代價:主軌全死的罕見使用者要清車或找客服、不能原車重試。
   B = 支3 不擋 pending(只留 charged + order-paid 兩支)→ failed-pending 可原車重試(UX 不變),
       但 orphan-pending(T11③)在 ②-⑥ webhook 補成 paid 前的窗口**可能 cross-tab 雙扣**(極罕見:
       三重故障 + webhook 延遲 + 此刻 cross-tab);靠 ②-⑥ 對帳兜底。
   C = 支3 保留但加「僅當 attempt 有 orphan 證據才擋」—— ❌ 不可行(markCharged 全敗時 DB 無 rec、
       confirm-payment 故障下寫不進任何區分標記、備軌不可釋鎖 → 技術上無 durable 區分點)。
```
（A=寧卡勿雙扣偏安全；B=寧可重試偏體驗、接受極罕見雙扣靠對帳。C 已論證不可行、列出供完整。）

---

## 8. 收工驗收(鐵則 12 → 全跑)
- [ ] 新 migration MCP 交易模擬(BEGIN+synthetic 兩單同 key+DO 斷言+ROLLBACK、零留痕):
      T1 / T11①(charged→支1)/ T11②(pending+paid→支2)/ T11③(pending+unpaid→支3)/ T2(異 key 不擋)/
      T3(failed 不擋)+ create_order 寫 cart_session_id + begin fail-closed(本單 key null → RAISE)+
      has_function_privilege 矩陣 + 舊 create_order(4-參數)已 DROP(pg_proc 查不可呼)。
- [ ] adapter begin parse duplicate(existing_display_id+existing_paid;缺值 throw)+ create_order 傳 key 單元測。
- [ ] confirm-payment duplicate → `{kind:'duplicate',...}` 測;charge-actions cartSessionId 流 + mapOutcome
      paid→成功頁 / 未 paid→processing 測;CartContext(codex r1 🟡#3):hydrate 非空 cart 有 key /
      clear 後下一次 add 產**新** key / submit 用 React state key(非重讀 localStorage)/ 空車首加生 key。
- [ ] 三綠 + 完整 pnpm test + client bundle grep(server keys 零命中)。
- [ ] code-reviewer + codex 關卡2(雙扣修必跑、≤2 輪)+ 審查側哨兵 zero-residue 複驗。
- [ ] STATUS 7 欄同 commit;新 migration 待 Sean db push(角色既存、零新密鑰/env)。

— 禁止清單:不改舊 migration / 不拿掉 paid-exclusion / 不弱化同分頁防線 / 不動 ②-⑤ stash /
  金額整數·經銷零洩·密鑰 server-only / 精準 add / 不自動 push —
— 禁止清單結束 —

---

## 9. codex 關卡1 收斂紀錄
**v1(內容指紋版、已被 Sean 路 2 取代但邏輯沿用)**:r1 FAIL 5 條(🔴 T11② race 漏窗 / 🔴 NULL 軟繞過 /
🟡 時間欄 / 🟡 existingDisplayId 必填 / 🟡 fingerprint 聚合)+ r2 FAIL 1 真漏(🔴 T11③ orphan-pending)
+ 2 補強 — 全採納。**三態已扣款證據(charged/order-paid/orphan-pending)= v1 codex 兩輪的核心產出、路 2 照搬**。
**路 2 改 key 後消除的 v1 問題**:時間窗/N 邊界(T9 誤殺)、fingerprint 聚合竄改面、NULL 軟繞過
(key 從 orders 讀非 client 傳 begin)、rollout 舊 row(0-row 實證)。
**v2 路 2 codex 關卡1 r1**(FAIL → 修):
- 🔴#1 支3 誤殺 failed-pending(orphan vs failed DB 不可分)→ **升 D4 決策題**(§7、§3 揭示;待 Sean 拍)。
- 🔴#2 GRANT 不夠硬(Supabase 預設給 service_role EXECUTE)→ §4.1 create_order 顯式 REVOKE 四方 + DO 矩陣 assert。
- 🟡#3 localStorage 共用敘述過滿 → §2 收斂適用範圍 + §8 補 CartContext 具體測試。
- 🟡#4 create_order null key 未 fail-closed → §4.1 nextval 前 RAISE。
→ #2/#3/#4 已修進 plan;**#1 = D4 需 Sean 拍**(決策岔路、一次性上游問)。Sean 拍 D4 後 plan 定型,
  再 codex 關卡1 r2 確認(或直接實作 + 鐵則 12 關卡2)。**race-free 主結構(advisory lock 內三態 keyed
  dedup)codex 未否定、僅支3 的 pending 語意需 D4 收尾。**
