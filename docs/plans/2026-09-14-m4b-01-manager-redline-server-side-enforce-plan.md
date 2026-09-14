# plan · M-4b-01 員工權限「改金額紅線」server-side enforce —— 2026-09-14

> `docs/PHASE-1-MILESTONES.md:660` M-4b-01「admin 員工權限細節(透明型 + 改金額紅線 server-side enforce)」;驗收 `:675`「員工 API 直接打改金額 endpoint(繞過 UI)、server 拒絕並 log」。主視窗 2026-09-14 派。
> 碰權限 + RPC(鐵則 8 / 12②)⇒ **只寫 plan,不動碼**。
> 不與 0914 五題衝突:側欄 6 項不動;操作紀錄頁(Q2 乙)是**讀**,本 plan 只動**寫**的閘;老闆成本欄(Q3)已是三層齊全,本 plan 拿它當範本。
> 版本號 `20260915040000`(2026-09-14 掃 116 ref / 8 worktree 為空;開工再掃)。

---

## 0. 一句話

後台今天**每一支 server action 都有閘**(`server-action-guard-sweep.test.ts` 釘著:沒有 `authorize*Mutation()` 的 `'use server'` 檔會紅),所以「只有 client 端擋」這件事**在 server action 這一層不存在**。真正的洞在**另外兩處**:
1. **改品項金額(名字叫「紅線」的那件)今天任何員工都能改** —— UI 沒藏、action 用的是一般員工閘、RPC 不看身分。三層**都沒有**紅線。
2. **四支「只有管理者能按」的 RPC,DB 那一層不驗身分** —— 靠 TS 那道閘單獨撐著;拿 service_role 直接打 PostgREST 就過。

本 plan:① 把改金額升成管理者紅線(三層);② 給那四支 RPC 補 DB 層(照 `admin_staff_create` 現成形狀);③ 拒絕要留 server log。其餘碰錢的動作**要不要也升紅線,端 Sean(§6)**,本 plan 不擅自擴。

---

## 1. 現況盤點(2026-09-14 逐檔讀出來)

### 1-a 三層各是什麼

| 層 | 在哪 | 擋得住什麼 |
|---|---|---|
| L1 UI | page / component 用 `ManagePermission` 三態藏鈕(範本 `apps/admin/src/app/settings/fx/page.tsx:46-54`) | 只擋「看得到鈕」;**不是安全邊界**(`order-detail-route.tsx:228` 逐字) |
| L2 server action | `apps/admin/src/lib/session/authorize.ts`:`authorizeAdminMutation()`(session + Origin + 具名 actor)/ `authorizeManagerMutation()`(再加 `isActiveManager`,DB 故障 fail-closed) | 擋「繞過 UI 直接 POST server action」 |
| L3 RPC | `SECURITY DEFINER` 函式內 `SELECT s.is_manager FROM public.staff s WHERE s.id = p_actor AND s.is_active` ⇒ 不是 ⇒ `RAISE EXCEPTION '無權執行此操作'`(範本 `20260912050000_m4b_mgr0_staff_write_rpcs.sql:146-154`) | 擋「拿 service_role key 直接打 PostgREST」與「別的 action 誤呼叫」 |
| RLS | **不適用**:後台走 service_role,RLS 對它不生效;表對 service_role 的直寫已 REVOKE(例 `20260726120000:65` staff、orders 同)⇒ 寫只能走 RPC ⇒ **L3 就是 DB 的最後一道**。 |

### 1-b 管理者專屬動作 × 三層現況

| 動作 | L1 UI | L2 action | L3 RPC | 缺口 |
|---|---|---|---|---|
| 員工新增/改/停用 | ✅ `settings/staff/page.tsx:63-78` | ✅ `staff-actions.ts:92`(manager) | ✅ `admin_staff_create` / `_update_profile` / `_set_active`(`20260912050000:146-154,…`) | 無(範本) |
| 老闆成本欄 | ✅ `orders/page.tsx:220` `canBoss` | ✅ `item-costs-actions.ts:32`(manager) | ✅ `admin_set_order_item_costs`(`20260914010000:152-158`) | 無 |
| 匯率 | ✅ `settings/fx/page.tsx:46-54` | ✅ `fx-rate-actions.ts:22`(manager) | ✅ `admin_fx_rate_set`(`20260913070000:139`) | 無 |
| 死信重排 | ✅ `settings/mail/page.tsx:45-53,137` | ✅ `dead-letter-actions.ts:46`(manager) | ❌ `admin_requeue_dead_email(p_outbox_id)`(`20260831040000:70`)**連 `p_actor` 都沒有** | **L3 缺** |
| 備註收起(soft delete) | ✅ `order-detail-route.tsx:239` | ✅ `note-actions.ts:211` / `note-repository.ts:131`(manager) | ❌ `admin_soft_delete_order_note(…, p_actor, …)`(`20260913020000:163`)有 actor、不驗 | **L3 缺** |
| 手動取消通知 記/撤 | (明細頁) | ✅ `manual-cancel-notice-actions.ts:70`(manager,兩支 action 共用) | ❌ `record_manual_cancel_notice`(`20260906920000:62`)/ `revoke_manual_cancel_notice`(`20260906930000:56`)有 `p_actor`、不驗 | **L3 缺** |
| 操作紀錄頁(讀) | ✅ `settings/audit/page.tsx:98` | —(讀) | — | 無;0914 Q2 乙要開旗標,與本 plan 無關 |
| 🔴 **改品項金額** | ❌ `order-more-section.tsx:104` 對每個員工都掛 `ItemAmountForm` | ❌ `amount-actions.ts:76` 用 `authorizeAdminMutation`(一般員工) | ❌ `admin_update_order_item_amount(…, p_actor, …)`(`20260909080000:122`)只驗 `p_actor` 非空(`:141`),不看 `is_manager` | **三層全缺** —— 而它是 M-4b-01 點名的那條紅線 |

📌 `server-action-guard-sweep.test.ts` 保證的是「有閘」,**不保證「閘的等級對」**。改金額就是「有閘、等級錯」。

### 1-c 今天任何員工都能做、而**碰錢**的其他動作(L2 都是一般員工閘;L3 都不驗身分)

`customers/tier-actions.ts`(換等級)、`customers/wallet-actions.ts`(儲值金)、`payment/manual-refund-actions.ts`(人工退款)、`payment/refund-actions.ts`(刷卡退款)、`payment/refund-correction-actions.ts`、`orders/payment-reverse-actions.ts`(沖銷收款)、`orders/cancel-actions.ts`(取消 ⇒ 自動退款)。
**沒有任何拍板說這些是紅線**(M-4b 規格 `:645` 逐字「Phase 1 階段 1 只分 Sean / 員工兩級」;人工退款已有另一套上限閘 `pcm_manual_refund_rail_cap_guard`)⇒ **本 plan 不動**,列成 §6 Q2 端 Sean。

---

## 2. 該在哪一層擋(結論:L2 + L3 都要,L1 只是禮貌)

- **L2 `authorizeManagerMutation()`**:第一道、給員工看得懂的拒絕(回 `permissionNotice`),擋 99% 的「繞 UI 打 action」。
- **L3 RPC 內驗 `staff.is_manager AND is_active`**:因為 (a) 後台 key 是 service_role,PostgREST 直打**不經過** L2;(b) 同一支 RPC 會被別的 action / cron / 未來的審核 workflow(M-4b-03)呼叫,**閘放在資料進門那一刻才跟著資料走**;(c) `staff.is_manager` 的 COMMENT(`20260829193000:36-37`)已明文「那道閘住在兩層,兩層都要指名」—— 這是既定標準,不是我發明。
- **不做 RLS**:service_role 不吃 RLS;要做得先把後台改成 authenticated + JWT claims,那是「身份認證綁定到 quote 登入帳號」那一包(0913 排上線後),不在這裡。
- **L1**:改金額表單對非管理者**不渲染**、改顯示一句 `NO_PERMISSION_TEXT` 同款文字(`manage-permission.ts`);三態照 `order-detail-route.tsx:216-240` 抄(DB 打嗝 ⇒ `unknown`,不是 `no`)。

**拒絕要 log**(驗收 `:675`「server 拒絕並 log」):
- L2:`authorizeManagerMutation()` 今天在 `isActiveManager` 為 false 時**靜靜回 null**(`authorize.ts` 最後五行)。加一行 `console.warn(JSON.stringify({ evt: 'admin.manager.denied', actorId, at: <action 名> }))`,節流照 `session.ts:670` `consumeAlarmSlot` 的形狀(它的 reason 型別是 `SessionRejectReason`,要嘛加一個值、要嘛用 `log-slot.ts` 的 `consumeLogSlot` —— 實作時挑後者,不動 session 型別)。**不寫 `admin_audit_log`** —— 那張表記「發生了的事」,被擋下的沒發生;而且 audit 寫在 RPC 內同交易,L2 擋下時根本沒進 DB。
- L3:`RAISE EXCEPTION '無權執行此操作'`(與 staff RPC 逐字同句)⇒ action 的 catch 已會記 request_id 進 server log(`amount-actions.ts` ⑤)。

---

## 3. 改什麼(逐點)

### 3-a 改金額升紅線
| 層 | 檔案 | 改法 |
|---|---|---|
| L2 | `apps/admin/src/lib/orders/amount-actions.ts:6,76` | `authorizeAdminMutation` → `authorizeManagerMutation`;拒絕時導回 `permission-denied` 結果碼(既有六碼加一碼,`amount-action-state.ts` 同步)|
| L3 | `20260915040000_m4b_01_manager_redline_rpc_gate.sql` | `admin_update_order_item_amount` **整支**從 `20260909080000:122` 抄(live = newest,7 參簽章不動),在 `4a` 之後、鎖列之前插入 §1-a L3 那 6 行;COMMENT 尾加「管理者限定(M-4b-01)」。 |
| L1 | `order-more-section.tsx:104`、`order-detail-route.tsx`(已算 `canDeleteNotes` 三態,**同一顆值拿來用**,改名 `canManage`,不再多打一次 DB)| 非 `yes` ⇒ 不掛 `ItemAmountForm`,改顯示 `permissionNotice(canManage)` |
| 測試 | `amount-actions.test.ts` 加「非管理者 ⇒ 導 `permission-denied`、RPC 零呼叫」;pgTAP `supabase/tests/database/m4b01_manager_redline.test.sql`:非管理者 actor 打 `admin_update_order_item_amount` ⇒ `throws_ok(…, '無權執行此操作')`、管理者 ⇒ 過、**停用的管理者**(`is_active=false`)⇒ 擋 |

### 3-b 四支 RPC 補 L3
| RPC | 改法 |
|---|---|
| `admin_soft_delete_order_note` | `CREATE OR REPLACE` 整支(`20260913020000:163`),`p_actor` 已在 ⇒ 插 6 行 |
| `record_manual_cancel_notice` / `revoke_manual_cancel_notice` | 同上(`20260906920000:62` / `20260906930000:56`)|
| `admin_requeue_dead_email` | 🔴 **沒有 `p_actor` ⇒ 簽章要改**:`DROP FUNCTION public.admin_requeue_dead_email(uuid)` + `CREATE FUNCTION public.admin_requeue_dead_email(p_outbox_id uuid, p_actor text)`;`dead-letter-actions.ts:123` 呼叫多帶 `p_actor: auth.actorId`;`database.types.ts` 重生。⚠️ **簽章變 = ACL 重做**:REVOKE/GRANT 照原檔尾段逐字搬,貼完 `pcm_acl_approve_latest`(0914 拍甲)。|
| 事後閘(同檔尾) | 五支 `pg_get_functiondef` 都必含 `'無權執行此操作'`;正對照 `admin_staff_create` 含;負對照現造字面不含 |

### 3-c L2 拒絕 log
`authorize.ts` `authorizeManagerMutation()`:`isActiveManager` false ⇒ `console.warn(evt admin.manager.denied)` 再 `return null`。`authorize.test.ts` 加一格「非管理者 ⇒ warn 一次且回 null」。

**影響哪些畫面**:訂單明細「更多」區的改單價表單(非管理者從此看不到、看到一句話);設定 › 郵件 死信重排(行為不變);備註收起(不變);手動取消通知(不變)。**管理者一個字都不會變。**

---

## 4. 分片(每片 ≤45 分、獨立三綠、獨立 commit)

| 片 | 內容 | 三綠 / 測 |
|---|---|---|
| **P1 · L2 + L1(純 TS)** | §3-a L2、L1 + §3-c;`amount-actions.test.ts` / `authorize.test.ts` / `order-detail-route` 既有測試 | `TURBO_FORCE=1 pnpm typecheck && lint && build`;跑 `apps/admin/src/lib/orders/amount-actions.test.ts`、`lib/session/*.test.ts`。**這片先合就已經擋住「繞 UI 打 action」。** |
| **P2 · L3 migration + pgTAP + rollback**(只 .sql) | `20260915040000` 五支 RPC;`supabase/tests/database/m4b01_manager_redline.test.sql`;`supabase/rollbacks/20260915040000-rollback.sql` | 拋棄式 PG(`docs/runbooks/throwaway-postgres-for-migration-verification.md`)依序套 → pgTAP 綠 → **突變**:把 `IF NOT coalesce(v_is_manager,false)` 那行註掉再跑 ⇒ 非管理者那格**必須紅**。**codex 唯讀審**(鐵則 12②)。**寫好不貼。** |
| **P3 · 死信重排簽章接線(TS)** | `dead-letter-actions.ts:123` 多帶 `p_actor`;`database.types.ts` 重生;`dead-letter-actions.test.ts` | 三綠 + 該測試。🔴 **P3 必須與 P2 貼板同一天合**:P3 先上 ⇒ 正式庫還是 1 參版 ⇒ 重排壞掉(PGRST202 找不到函式)。順序:P2 貼 → P3 合。P2 不貼之前 P3 只 commit 不合。 |
| **P4 · 貼板 + 走一遍** | Sean 貼 `20260915040000`;`APPLIED.tsv` 記帳;`pcm_acl_approve_latest`;Sean 用**非管理者**員工身分開一張單 ⇒ 看不到改單價表單、看到那句話;換管理者 ⇒ 表單在、改一次成功 | `bash scripts/is-migration-applied.sh 20260915040000` |

P1 與 P2 互不相依(TS 閘與 DB 閘各自成立);P3 依賴 P2 已貼。

---

## 5. Rollback

`supabase/rollbacks/20260915040000-rollback.sql`:
```sql
BEGIN;
-- ① 四支有 p_actor 的 RPC:CREATE OR REPLACE 貼回上一代【整支】(20260909080000:122 / 20260913020000:163 /
--    20260906920000:62 / 20260906930000:56)—— CREATE OR REPLACE 會把 SET 子句整組換掉, 從原檔整段抄。
-- ② admin_requeue_dead_email:DROP 2 參版 + 貼回 20260831040000:70 的 1 參版 + 原檔尾 REVOKE/GRANT 逐字。
--    🔴 退 ② 之前 P3 那顆 TS commit 要先 revert(不然 action 打 2 參版 ⇒ PGRST202)。
COMMIT;
```
- 回退不動資料;回退後改金額回到「任何員工都能改」(那是今天的狀態,不是新的洞)。
- TS 那半 = `git revert` P1 / P3。

---

## 6. 驗收:怎麼證明「繞過 UI 直接打也被擋」

| 路 | 證法 | 誰跑 |
|---|---|---|
| 繞 UI 打 server action | vitest:偽造非管理者 session 呼叫 `updateOrderItemAmountAction` ⇒ 回 `permission-denied`、`rpc` mock 零呼叫、`console.warn` 一次(`admin.manager.denied`)| P1 三綠時 |
| 繞 action 打 RPC(= 拿 service_role 打 PostgREST)| pgTAP 在拋棄式 PG:`SELECT admin_update_order_item_amount(…, p_actor := '非管理者')` ⇒ `throws_ok '無權執行此操作'`;五支各一格;**突變一發紅**進 commit body | P2 |
| 正式站 | 🛑 **不對正式庫直打 RPC 試擋**(要 service_role key,而且會留稽核列)。改用 `pcm_acl_approve_latest` 後 `pg_get_functiondef` 五支含 `'無權執行此操作'`(唯讀,`~/pcm-mailbox/0905查證/run.sh`)+ Sean 兩個身分走一遍(P4)| 主視窗 / Sean |
| 沒有退步 | `server-action-guard-sweep.test.ts` 綠(閘還在);管理者的改金額 E2E 既有測試綠 | P1 |

---

## 7. 要 Sean 拍的

```
Q1:改品項金額從今天起【只有管理者(你)能改】, 員工按了看到「你沒有權限修改」——
    在 M-4b-03「員工提案 → 你批准」做出來之前, 員工完全不能改單價。可以嗎?
A:甲 可以, 先擋(推薦 —— 紅線先立, 提案流程下一片)
   乙 先不擋, 等 M-4b-03 一起上(那本 plan 只做 §3-b 四支補洞 + log)

Q2:§1-c 那七件碰錢的(換等級 / 儲值金 / 人工退款 / 刷卡退款 / 退款更正 / 沖銷收款 / 取消)
    今天任何員工都能做。要不要也升成管理者限定?
A:甲 都不動, 維持員工能做(推薦 —— 收單到出貨是員工的日常;退款已有上限閘;先上線)
   乙 只把「儲值金」與「換等級」升管理者(它們不是出貨流程的一步)
   丙 全部升管理者(你會變成每一筆退款的瓶頸)
```
Q1 不答照甲;Q2 不答照甲(本 plan 不動)。
