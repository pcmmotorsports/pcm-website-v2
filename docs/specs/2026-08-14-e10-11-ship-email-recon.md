# #11 出貨 Email 通知 — 查證報告(A 窗夜跑,零 code、**不設計**)

> 事實親查於 `pcm-void-readers` @ `6e99ea3c`。🔴 **全部來自 repo 檔案,未對正式庫查詢。**

## §1 🔴 先更正 §1-A 的條目:不是「出貨時零 writer」,是**整條線零 writer**

§1-A 逐字「outbox 在 storefront cron,**出貨時零 writer**」—— 這句讀起來像「建單信會寄、出貨信不會」。**兩個都不會。**

數法:`grep -rn "enqueuePending\|\.enqueue" apps packages --include="*.ts" --include="*.tsx"`
排除 `.test.` / `.next` / `IEmailOutbox.ts` / `SupabaseEmailOutboxAdapter.ts` ⇒ **命中 1 行**,
而那一行是 `packages/adapters/src/email/order-email-assembly.ts:9` 的**註解**,不是呼叫。
⇒ **`IEmailOutbox.enqueue`(`packages/ports/src/IEmailOutbox.ts:199`)零生產呼叫端。**

佐證(不是我推的,是 repo 自己寫的):
- `packages/use-cases/src/sweep-email-outbox.ts:102` 逐字「enqueue 現況**雖只開 order_created**」
  —— 而 `order_created` 的 writer(E3)**本身也沒落地**。
- cron route 檔頭 `apps/storefront/src/app/api/cron/email-sweep/route.ts:11` 逐字把
  「**E3 未落地 → `email_outbox` 零列 → sweep 全零 counts**」列為「route 已 deploy 亦零副作用」的三道天然閘之一。

⇒ **outbox 是完整建好、然後整條休眠的管線。** 這對 `#11` 是好消息(下游全在),但條目字面會誤導排序。

## §2 outbox 的完整鏈(誰寫 / 誰送 / cron 在哪 / 失敗怎麼辦)

| 環 | 現況 | 位置 |
|---|---|---|
| **表** | ✅ 已上線,`event_type` CHECK **已含 `order_shipped`** | `20260717020000_m4a_email_outbox.sql:315` 逐字 `CHECK (event_type IN ('order_created', 'order_shipped'))` |
| **狀態機 adapter** | ✅ `enqueue` / `claimDue` / `claimById` / `markSent` / `markFailed` | `packages/ports/src/IEmailOutbox.ts:189-215`;實作 `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts` |
| **sweeper** | ✅ lease 回收 → CAS 認領 → 逐封寄 → mark | `packages/use-cases/src/sweep-email-outbox.ts` |
| **cron 入口** | ✅ route 在,**但不掛 `vercel.json`** —— 排程走 pg_cron(`*/5`)→ pg_net → 本 route | route 檔頭 `:3-4` 逐字「Hobby cron 一天一次放不了 5 分鐘一輪」 |
| **失敗處理** | ✅ backoff 退避 + lease 回收 + `attempts/max_attempts`;本輪有失敗 → **503 不吞成 200**(檔頭 `:17-19` 逐字「壞掉的 sweeper 靜默不寄 = 客人永遠收不到信、無人知」) | 同上 |
| **告警** | ✅ 刻意**零告警**在 sweeper 內(Sean Q13=A):`:22` 逐字「sweeper 不可自我監看(死時告警一起死)」,五訊號歸獨立管道 | 同上 |
| **writer** | ❌ **只缺這個** | — |

## §3 出貨那一刻現在發生什麼 / 缺什麼

現況:出貨動作 = `admin_mark_shipment_shipped`,唯一呼叫端
`apps/admin/src/lib/shipping/shipment-repository.ts:134`。**該路徑上零 email 相關字面。**

**缺的是「在這一刻寫一列 outbox」**,而它需要三樣東西,其中兩樣已經被 M-4a 的 plan 寫死了:

1. **`dedup_key` 演算法** —— `20260717020000:654` 逐字「`dedup_key` 格式 CHECK = 不做:**`order_shipped` 算法待 E4 偵察後定**」。
   🔴 **這題現在有答案了,而且是 M-4a 當時列的候選②**:該 plan `:267` 的候選②是「引入顯式 shipment/批次概念(較重、可能超鐵則 4)」——
   **`shipments` 表後來真的建了**(`database.types.ts:2588`,有 `shipment_reference` 與 `shipped_at`)
   ⇒ 「一批」= 一張 shipment,`shipment_reference` 是現成的天然鍵。**當時判「較重」的成本已經被別條線付掉了。**
   ⚠️ 同 plan `:153` 的硬約束照舊:`dedup_key` 在同 `event_type` 內**全域唯一(唯一鍵不含 `order_id`)**
   ⇒ 不得用 per-order 序號。
2. **觸發點** —— 同 plan `:259` 逐字「E4 開工前**必須先重定觸發點**,不能照本段字面 grep(會 0 命中)」
   (舊觸發點 `updateOrderItemWorkflowAction` 已被 A9w4a 具名刪除)。**現在的答案就是 `admin_mark_shipment_shipped`。**
3. **語意已拍板**:同 plan `:68` 逐字「**★S2 = B:每出一批寄一封**(接受多封)」⇒ 分批出貨會寄多封,這是拍過的、不用再問。

## §4 🔴 會不會撞 M-4a?會 —— 但撞的不是守門,是**跨 app 邊界**

**不會重造的部分**:表 / 狀態機 / sweeper / cron / 退避 / PII allowlist / at-least-once 全部沿用,`#11` **一行都不該碰它們**。

**真正的衝突**:M-4a plan `:370` 的 **Q7 裁示**逐字「**sweeper 放 storefront**:**E3 寫 outbox 本就在 storefront checkout**(邊界例外躲不掉)」
—— 那個理由的前提是「寫入點在 storefront」。
🔴 **而出貨發生在 `apps/admin`**(§3)。email composition root 現在只在
`apps/storefront/src/lib/email/composition.ts`;`apps/admin/src/lib` 底下**沒有任何 email 組裝**
(`grep -rln email apps/admin/src/lib` 的 4 個命中分別是 customer/shipping-test/note-timeline/note-form,**與寄信無關**)。
⇒ **`#11` 逼出一題 Q7 沒回答的:出貨信的 enqueue 要 (a) 在 admin 複製一份 composition root,還是 (b) admin 只寫表、組裝留給 sweeper?**
**本報告不選**,只指出它是必須先答的岔路。

## §5 鐵則 12 命中(先講明)

| 類 | 命中 | 依據 |
|---|---|---|
| ⑤ 對外不可回收 | 🔴 **是** | 寄信給客人 |
| ②權限 | **是** | 若走 (a),admin 要拿 `service_role` 寫 `email_outbox`(該表含 `recipient_email` = PII,`composition.ts:9` 逐字「anon/authenticated 零權限」) |
| ③DB | **看選項**:沿用既有 `event_type` 值 ⇒ 零 migration;要加 `dedup_key` 格式 CHECK ⇒ 有 migration | `20260717020000:654` |
| ①錢 / ④平台設定 / ⑥`packages/ui` | 否 | 不碰 |

⇒ **命中 ⑤② ⇒ codex 關卡2 不降級。** 另外 M-4a plan `:377` 已把文案定為 **L2 + Sean 過目**
⇒ **出貨信文案寄出前要給 Sean 看**,這是既有拍板、不是新增要求。

## §6 誠實缺口

1. **未對正式庫查詢。** 「CHECK 已含 `order_shipped`」「pg_cron 有排程」都只是 repo 檔案這樣寫;
   **正式庫上 pg_cron 到底有沒有那條排程 = 未確認**,而它決定信會不會真的被送出去。
2. **我沒有讀 sweeper 的實作本體**,只讀了 route 檔頭與 use-case 的一行註解
   ⇒ §2 的「失敗處理 ✅」是**基於檔頭自陳**,不是逐條驗過退避與 lease 真的成立。
3. **我沒有數 M-4a 那條線的守門族有幾格、涵蓋什麼** ⇒ §4「不會重造」是**基於檔案存在**的推論,
   不是「我確認過那些守門會擋住 `#11` 可能犯的錯」。
4. **`#11` 的片數與大小我沒估** —— 因為 §4 的岔路沒答之前,(a) 與 (b) 的檔數差很多。
5. **通知矩陣(Sean 2026-08-09 Q11=A 八事件)與這裡的 2 值 CHECK 對不上** ——
   我**沒有去核**那八個事件是哪八個、也沒查它們是否都要走 outbox。這是一個我看到但沒查的落差。
