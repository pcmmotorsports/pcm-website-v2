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

⚠️ **2026-08-14 補掃(B 窗 nit1;我重跑複驗)**:上面那個掃描**只掃兩個目錄、只掃一種形狀**。
把 `scripts/` 與 raw SQL 一起掃(`grep -rn "email_outbox" apps packages scripts --include="*.ts" --include="*.tsx" --include="*.sql" | grep -iE "insert|enqueue"`)
⇒ 多出 **`scripts/d1t2-seed.ts:133`** 一條 raw `INSERT INTO public.email_outbox`,
逐字帶 `'演練誘餌信'` + `drill-1@example.com` ⇒ **D1 演練用的誘餌列,不是生產路徑**。
**結論不變(零生產 writer),但我的掃描範圍當時不足以支撐那個全稱句。**

⇒ **outbox 是完整建好、然後整條休眠的管線。** 這對 `#11` 是好消息(下游全在),但條目字面會誤導排序。

## §2 outbox 的完整鏈(誰寫 / 誰送 / cron 在哪 / 失敗怎麼辦)

| 環 | 現況 | 位置 |
|---|---|---|
| **表** | ✅ 已上線,`event_type` CHECK **已含 `order_shipped`** | `20260717020000_m4a_email_outbox.sql:315` 逐字 `CHECK (event_type IN ('order_created', 'order_shipped'))` |
| **狀態機 adapter** | 🟡 五支方法齊,**但 `enqueue` 的入參型別只認 `order_created`**(§4)⇒ `#11` 要改它 | `packages/ports/src/IEmailOutbox.ts:189-215`;實作 `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts` |
| **sweeper** | ✅ lease 回收 → CAS 認領 → 逐封寄 → mark | `packages/use-cases/src/sweep-email-outbox.ts` |
| **cron 入口** | 🟡 route 在,**但不掛 `vercel.json`** —— 排程走 pg_cron(`*/5`)→ pg_net → 本 route | route 檔頭 `:3-4` 逐字「Hobby cron 一天一次放不了 5 分鐘一輪」 |
| **失敗處理** | ✅ backoff 退避 + lease 回收 + `attempts/max_attempts`;本輪有失敗 → **503 不吞成 200**(檔頭 `:17-19` 逐字「壞掉的 sweeper 靜默不寄 = 客人永遠收不到信、無人知」) | 同上 |
| **告警** | ✅ 刻意**零告警**在 sweeper 內(Sean Q13=A):`:22` 逐字「sweeper 不可自我監看(死時告警一起死)」,五訊號歸獨立管道 | 同上 |
| **writer** | ❌ 不存在 | — |

⚠️ **本表原本在下面寫「只缺 writer」—— 已作廢**:`enqueue` 的入參型別擋著(§4),
`#11` 除了 writer 還要改 `packages/` 那三支。**「下游全在」是對的,「一行都不用改」是錯的。**

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
   🔴🔴 **但「天然鍵」只在「一箱 = 一張訂單」時成立 —— 見下方 §3-A,那是本片最大的擋點。**
2. **觸發點** —— 同 plan `:259` 逐字「E4 開工前**必須先重定觸發點**,不能照本段字面 grep(會 0 命中)」
   (舊觸發點 `updateOrderItemWorkflowAction` 已被 A9w4a 具名刪除)。**現在的答案就是 `admin_mark_shipment_shipped`。**
3. **語意已拍板(一半)**:同 plan `:68` 逐字「**★S2 = B:每出一批寄一封**(接受多封)」⇒ 分批出貨會寄多封。
   ⚠️ 但那題拍的是「**一單分多批**」,**沒有拍「一箱含多單」** —— 見 §3-A。

## §3-A 🔴🔴 一箱含多張訂單 = 兩張表的鍵直接打架(B 窗 MF1,我開檔複驗成立)

**兩個硬事實,方向相反:**

- `shipments` **刻意沒有 `order_id`**:`20260805170000:169` 逐字「**本表刻意沒有 order_id** —— 一箱可含多張訂單,關聯走 `shipment_items`」。
- `email_outbox.order_id` 是 **NOT NULL**(`20260717020000:300` 逐字 `order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT`),
  而唯一鍵是 `(event_type, dedup_key)`(`:377` `CREATE UNIQUE INDEX email_outbox_event_uniq`)。

**一箱含訂單 X + Y、`dedup_key` 取箱號時,兩條路都破:**

| 走法 | 結果 |
|---|---|
| 每張訂單各寫一列 | 兩列的 `dedup_key` 同為箱號 ⇒ **第二列 unique violation** |
| 只寫一列 | 另一張訂單**沒有出貨信紀錄**(而 `order_id` NOT NULL 逼你選一張) |

⇒ **這不是「鍵怎麼取」的技術題,底下是一題產品題**:

> **Q-11-1:一個箱子裝了同一位客人的兩張訂單,出貨時客人該收到幾封信?**
>
> | 選項 | 內容 | 代價 / 擋不擋後續 |
> |---|---|---|
> | **A 一箱一封** | 信裡列出這箱涵蓋的所有訂單編號 | `dedup_key` = 箱號可用;但 `email_outbox.order_id` NOT NULL **仍要選一張當代表**(或改 schema)⇒ **可能要 migration** |
> | **B 一單一封** | 同一箱寄兩封,各講各的訂單 | `dedup_key` **必須含 order_id**(例:`箱號:訂單id`)⇒ 零 migration;但客人同時收到兩封講同一個包裹的信 |
>
> **我不推薦** —— 這是「客人體驗」與「帳要怎麼對」的取捨,是 Sean 的題。
> ⚠️ 兩案都不影響前面的結論(觸發點、鏈的其餘六環),只影響 `dedup_key` 與要不要 migration。

## §4 🔴 會不會撞 M-4a?會 —— 但撞的不是守門,是**跨 app 邊界**

~~**不會重造的部分**:表/狀態機/sweeper/cron/退避/PII allowlist/at-least-once 全部沿用,`#11` **一行都不該碰它們**。~~
❌ **這句是錯的(B 窗 MF2,我開檔複驗成立)。** `packages/ports/src/IEmailOutbox.ts:152` 逐字
`eventType: 'order_created';` —— **那是字面型別、不是 union**;同檔 `:147-150` 逐字寫著
「目前**只開放** `order_created`…**E4 定案 payload 與 `dedup_key` 算法後,以 discriminated union 增員**」。
⇒ **`#11` 必須改 `packages/` 底下至少三支**(port 的型別 + adapter 的 enqueue 分支 + assembly 的 subject/payload 組裝)。
**repo 自己寫明要改,而我的報告說「不該碰」** —— 片型與鐵則判定跟著變(見 §5)。

### 跨 app 邊界仍是真問題,但**理由要換掉**

~~原理由:要在 (a) admin 複製 composition root /(b) admin 只寫表 之間選。~~
❌ **那是假岔路**(B 窗 MF3):我複驗後的實情是 —— `packages/adapters/src/email/*` **與 app 無關**
(該目錄所有 `import` 只有 `@pcm/ports` / `@supabase/supabase-js` / `server-only` / 同目錄兄弟,零 app 依賴),
而 admin 早就在做同款 wiring(`customer-repository.ts:24` `new SupabaseCustomerAdapter(createSupabaseServiceClient())`)
⇒ **admin 要接一個 adapter 本來就不是架構問題,(a)/(b) 之間沒有真的要選的東西。**
**我拿一個不存在的岔路當「不估片數」的理由,等於白擋一片。**

🔴 **真正的跨 app 問題是一顆常數**:`SupabaseEmailOutboxAdapter` 的假信箱 gate **不複製字面、由 composition 注入**
(`:37` 逐字),而那顆常數住在 **`apps/storefront/src/lib/auth/line.ts:38`**(`'line.pcmmotorsports.local'`),
且 `apps/storefront/src/lib/email/composition.ts:13` 逐字寫著「**packages 不可反向 import app**」。
⇒ admin 要 wiring 就得拿到它,而它**已經被抄過一次**(`apps/storefront/src/lib/auth/field-validation.ts:57`,
該行上方 `:56` 逐字掛著「⚠️ **必與 lib/auth/line.ts 的 `LINE_SYNTHETIC_EMAIL_DOMAIN` 同步**」)。
⇒ **`#11` 若照抄就是第三份**,而這正是這個 repo 記過學費的「同一條規則放兩個地方」形狀。
**這是一個具體的、要在 plan 裡解掉的問題(把常數提到 `packages/`),不是一個要 Sean 選的岔路。**

## §5 鐵則 12 命中(先講明)

| 類 | 命中 | 依據 |
|---|---|---|
| ⑤ 對外不可回收 | 🔴 **是** | 寄信給客人 |
| ②權限 | **是** | admin 要拿 `service_role` 寫 `email_outbox`(該表含 `recipient_email` = PII,`composition.ts:9` 逐字「anon/authenticated 零權限」) |
| ③DB | **看 Q-11-1 怎麼拍**:B 案(一單一封)⇒ 零 migration;A 案(一箱一封)可能要動 `email_outbox.order_id` 的 NOT NULL ⇒ **有 migration** | `20260717020000:300`/`:377`;`:654` |
| ⑥共用元件 | 🔴 **是** | §4:必改 `packages/ports` 的 `EnqueueEmailInput` 型別 + `packages/adapters` 的 enqueue 與 assembly ⇒ **跨 app 共用面的行為改動**,不是純樣式 |
| ①錢 / ④平台設定 | 否 | 不碰 |

⇒ **命中 ⑤②⑥(③看拍板)⇒ codex 關卡2 不降級。**⚠️ 我上一版漏了 ⑥、且把 ② 綁在一個假岔路上。 另外 M-4a plan `:377` 已把文案定為 **L2 + Sean 過目**
⇒ **出貨信文案寄出前要給 Sean 看**,這是既有拍板、不是新增要求。

## §6 誠實缺口

1. **未對正式庫查詢。** 「CHECK 已含 `order_shipped`」「pg_cron 有排程」都只是 repo 檔案這樣寫;
   **正式庫上 pg_cron 到底有沒有那條排程 = 未確認**,而它決定信會不會真的被送出去。
2. **我沒有讀 sweeper 的實作本體**,只讀了 route 檔頭與 use-case 的一行註解
   ⇒ §2 的「失敗處理 ✅」是**基於檔頭自陳**,不是逐條驗過退避與 lease 真的成立。
3. **我沒有數 M-4a 那條線的守門族有幾格、涵蓋什麼** ⇒ §4 講「哪些沿用得到」是**基於檔案存在**的推論,
   不是「我確認過那些守門會擋住 `#11` 可能犯的錯」。
   ⚠️ 而 §4 已更正:**不是全部都沿用** —— `packages/` 那三支必須改。
4. ~~片數沒估,因為 §4 岔路沒答~~ ❌ **那個理由作廢**(§4)。**我現在仍然沒估**,但誠實的理由換成:`packages/` 那三支要改多少取決於 discriminated union 怎麼切,而**我沒有讀 `SupabaseEmailOutboxAdapter.enqueue` 的本體**。⇒ **這是「還沒做」,不是「被擋住」。**
5. **通知矩陣(Sean 2026-08-09 Q11=A 八事件)與這裡的 2 值 CHECK 對不上** ——
   我**沒有去核**那八個事件是哪八個、也沒查它們是否都要走 outbox。這是一個我看到但沒查的落差。
