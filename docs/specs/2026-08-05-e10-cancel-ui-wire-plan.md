# M-4b E10 · 取消後台 UI 接線 plan v2(A9g / A9d2-2 / A13a / A13b)

> 視窗 A · worktree `/Users/sean_1/pcm-refund-wire`(branch `refund-wire`,基底 `a5a1e0f`)
> DAG 真權威:`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.0(`:263-275`)
> RPC 契約真權威:`supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql`(已 apply 正式站)
> 狀態:**待批准**。批准前零程式碼改動。
> v2 = 折入關卡1 codex(`gpt-5.6-sol`)R1 的 16 must-fix + 1 nit(R1 判定 FAIL;§8 逐條對帳)。

---

## §0 兩個範圍事實(先講,因為它們改變片數與可否開工)

### 0.1 不是一片,是 4 片

指令寫「訂單明細頁取消訂單 UI」。實查後片界不對:
`docs/specs/2026-08-01-admin-completion-map.md:72`(第 19 列)逐字列 **8 片** =
`A8c1/A8c2/A8a1/A8a2`(DB,✅ 已 apply)+ **`A9g / A9d2-2 / A13a / A13b`**(UI 側,未動)。
`:106` 把 **A9d2-2 列在高風險 9 片**內。

### 0.2 🔴 **A13a/A13b 不在 DAG 的當前位置**(K1 finding 1;開工前必須解決)

§5.0 唯一 DAG(`master-plan-v2.md:263-275`)逐字:

```
A9a/A9b2/A9c/A9d1/A9d2/A9g/A9h (A)
  ↓
A9e/A9f (U) → A9s/A9r (A)
  ↓
A9w1/A9w2 (U) → A9w3 (A) → A9w4a/A9w4b/A9w4c (A)
  ↓
A10a/A10b/A10c2/A11a-c (U 主建設前段)
  ↓
A9v (M)
  ↓
A12a-b/A13a-b/A14a-c (U 主建設後段; R19 與片表統一 = A10/A11 → A9v → A12-A14)
```

⇒ **A9g 與 A9d2-2 在第一組(可立即開工)**;**A13a/A13b 在最後一組**,前面隔著
A9e/f、A9s/r、A9w1-4c、A10/A11、A9v。母 plan `:221` 明文「順序**只寫在這裡**」。

**本 plan 因此切成兩期**:

| 期 | 片 | 可否現在開工 |
|---|---|---|
| **Phase 1** | 片 0-5(A9g + A9d2-2) | ✅ **合 DAG 序,批准即可開工** |
| **Phase 2** | A13a / A13b(UI) | ⛔ **需 Sean 明文改序批准**(見 §9 Q0) |

Phase 1 做完的狀態是**誠實的**:讀模型與 action 齊備、有測試、無任何畫面入口
⇒ 員工看不到取消按鈕,不會有「畫面可按、送出必失敗」的風險。

---

## §1 RPC 契約(逐字自 migration;此節 K1 判 PASS)

簽章(`20260805100000:80-87`):

```sql
admin_cancel_order(p_order_id uuid, p_idempotency_key uuid, p_actor text,
                   p_reason_code text, p_reason_detail text, p_items jsonb DEFAULT NULL)
```

- `p_items IS NULL` = 整單取消;`p_items = [{order_item_id, quantity}, …]` = 品項部分取消(`:8-9`)。
- ACL = **service_role only**(`:496-497`)⇒ server action → repository → RPC,client 不可直呼。

### 1.1 🔴 沒有回傳碼(與 A9d2-1 的 14 碼形狀根本不同)

COMMENT 逐字(`:493`):**「業務拒絕=通用訊息;輸入類=具體訊息」**。

| 結果 | 形狀 |
|---|---|
| 成功 | jsonb `{cancelled, cancellation_id, idempotent, closed}`(`:334-335` 冪等重放、`:487-488` 首次;**全函式僅有的兩處 `RETURN`**)|
| 隔離級不對 | `RAISE` + `ERRCODE='P8C01'`(`:111-113`)|
| 輸入類 | `RAISE` 預設 `P0001` + **具體**訊息(11 處)|
| 通用訊息類 | `RAISE` 預設 `P0001` + **通用**訊息 `admin_cancel_order: 取消失敗`(**29 處**)。🔴 **不只業務拒絕** —— 同一句還涵蓋冪等 hash/actor 不符(`:206-208`)與帳本病理(`:342-352`),三者逐字相同、呼叫端分不出來 |

⇒ `feedback_null-dispatch-rpc-silently-downgrades` 的「全集斷言」在這支上的對應物 =
**成功 payload 的形狀全集**(§4),不是字串碼集合。

### 1.2 取消必被拒的條件(**全部第一手讀自 migration;UI 事先擋掉的清單**)

| # | 條件 | 出處 | UI 動作 |
|---|---|---|---|
| 1 | `payment_status <> 'unpaid'` | `:360-361` | 已付款單不給入口,顯示「取消需退款,退款線第 3 批開通」(row 65 `:412` 逐字) |
| 2 | 存在任何非 `failed` 的 `payment_charge_attempts` | `:361-364` | **需 A9g 投影 attempts**(K1-4);有在途扣款即不給入口 |
| 3 | `cancelled_at IS NOT NULL` | `:339-341` | 已取消單不給入口 |
| 4 | 帳本病理(`cancelled_reason` 殘留 / Σci>quantity / 零明細 header) | `:342-352` | 偵測到即**停用取消並顯示異常**,不給按(K1-5) |
| 5 | 整單取消時**任一**品項有到貨 | `:410-416` | 有到貨 ⇒ **關掉「整單取消」**,只留逐品項 |
| 6 | 逐品項增量 > `quantity − instock − cancelled` | `:395-406` | 每項輸入上限 = 該式 |
| 7 | 真相非零但摘要列缺失 | `:377-387` | **fail-closed:停用該單取消**(K1-6;不是只給提示) |
| 8 | `actor` 非 `staff.is_active` | `:355-357` | (授權閘已保證具名 actor,仍列為已知拒因) |

🔴 **K1-7 更正(我 v1 寫過頭了)**:「已到貨品項不可取消」**不對**。
`:395-406` 的式子是 `增量 ≤ quantity − instock − cancelled` ——
買 5、到貨 2、已取消 0 ⇒ **剩下 3 仍可取消**。UI 必須把
**已到貨量**(不可取消、指路退貨)與**尚可取消量**(可勾)分開顯示,不可把整個品項標成不可取消。
母 plan row 65 的「已到貨品項顯示不可取消」是**寬鬆措辭**,migration 是權威。

### 1.3 摘要表是惰性快取,只准顯示

母 plan row 37(`:384`):`instock`/`cancelled` 在惰性建立的非權威快取
`order_item_quantity_summary`,缺列時 `COALESCE→0` 會放行超量。RPC 已 fail-closed(`:377-387`)。
呼叫端立場(memory `feedback_guard-reads-non-authoritative-cache`):
**摘要只用於顯示與輸入上限;缺列 ⇒ 停用取消(1.2 #7),不得當成「到貨 0、取消 0」的事實**。

### 1.4 🔴 品項清單被截斷時不得取消(K1-8)

`AdminOrderDetail.itemsTruncated`(`packages/domain/src/order/types.ts:584-589`)為 true 時,
品項清單**可能不完整** ⇒ A13a 的「影響範圍」是漏的。
⇒ `itemsTruncated === true` ⇒ **停用取消入口**,顯示「品項過多無法安全複核,請聯絡系統維護」。

---

## §2 形狀慣例(照 A9d2-1 / A10b,逐層對位)

| 層 | 本片新檔 | 對位前例 |
|---|---|---|
| 授權閘 | (共用) | `lib/session/authorize.ts:24-35` |
| state + token(client-safe、零 import) | `lib/orders/cancel-action-state.ts` | `lib/orders/note-action-state.ts:1-4, 104-145` |
| 純解析器 | `lib/orders/cancel-form.ts` | `lib/orders/note-form.ts:79` |
| repository(RPC 唯一呼叫端) | `lib/orders/cancel-repository.ts` | `lib/orders/note-repository.ts:86-120` |
| action | `lib/orders/cancel-actions.ts` | `lib/orders/note-actions.ts:82-163` |
| UI | `components/orders/cancel-*.tsx` | `components/orders/refund-section.tsx` |

沿用的硬慣例(皆有前例行號):

1. **授權閘絕對第一**(`note-actions.ts:86-95`)。
2. **成功的 `redirect()` 必須在 try 之外**(`note-actions.ts:28-30, 161-162`)。
3. **失敗路徑也 `revalidatePath`**(`note-actions.ts:133-135`)。
4. **逐欄具名送、不 spread**(`note-repository.ts:83-84`)。
5. token 形狀驗證 `import { isUuid } from './note-action-state'` ——
   不另養一份字面相同的正規式(`note-action-state.ts:63-64` 記錄的關卡2 抓過的漂移面)。

### 2.1 🔴 冪等 token 與 payload **綁定**(K1-13;本 plan 最容易寫錯的一條)

`v_hash` 涵蓋 `p_order_id + p_reason_code + reason_detail + (整單 `:full` / 部分 canonical 品項串)`
(`:195-198`);冪等格對 `payload_hash` 或 `actor` 不符 ⇒ 通用 RAISE(`:206-208`)。

⇒ **照 note 片「失敗一律原樣帶回同一顆 token」會出事**:員工在 `error` 後改了數量或原因再送,
同 token **必定** hash 不符 ⇒ 吃一個看不懂的通用拒絕。

本片定案(**取代 note 片的無條件帶回**):

🔴 判準用「**有沒有送到 RPC**」切,不是用失敗碼切(2026-08-05 關卡2 更正:v2 只凍結
`retry`/`bug`,漏了 `rejected`/`error` —— 那兩支同樣已經送達 RPC,就地改值重送一樣撞 hash):

- **沒送到 RPC**(`denied` 授權閘、`invalid` 解析器擋下)⇒ 保留輸入、**換新 token**、表單可編輯。
  舊 token 從未送出、沒有冪等價值,換新的可避免日後撞 hash。
- **已送到 RPC**(`rejected` / `retry` / `bug` / `error` **四支全部**)⇒ **凍結表單**
  (`fieldset disabled`),只給「重新整理本單」一條路,**不給就地編輯後重送**。理由:
  ①這四支都可能已 commit(`rejected` 也可能是 hash 不符 = 前一次其實成功了)
  ②就地改值 + 同 token 必撞 hash,而撞 hash 吐的又是同一句通用訊息 ⇒ 員工會以為「再改改看就會過」,
  實際上永遠過不了。
- 員工重新整理後 = 全新 server token + 依最新真相重算的上限 ⇒ 乾淨重來。
- **payload 完全未變的重送**才帶回同一顆 token —— 但在上面的凍結設計下,這條只發生在
  「員工什麼都沒改就按了第二次」,由 RPC 回 `idempotent:true` 吸收。
- 員工重新整理後 = 全新 server token + 依最新真相重算的上限 ⇒ 乾淨重來。
- **可修輸入型失敗**(解析器擋下、根本沒送到 RPC)⇒ 保留輸入 + **換新 token**
  (沒送出過,舊 token 沒有冪等價值,換新的可避免日後撞 hash)。

---

## §3 拆片

> Phase 1 = 片 0-5,合 DAG 序;Phase 2 = A13a/A13b,等 Q0。
> 每片獨立三綠 + R1 code-reviewer。**片 0-5 全部命中鐵則 12(①錢 / ②權限)⇒ commit 前跑 codex 關卡2**。

### Phase 1(批准即可開工)

| # | 片 | 內容 | 驗收(可 yes/no) | 片型 |
|---|---|---|---|---|
| **0** | **型別重生** | `admin_cancel_order` **不在** `packages/adapters/src/supabase/database.types.ts`(實查:全檔零命中,對照 `admin_append_order_note` 在 `:2241`)⇒ 先重生型別 + 依檔頭慣例(`:5, :39`)手工校正 **`p_reason_detail` 一處**的 `\| null`。🔴 **`p_items` 不校正** —— 生成型別 `Json` 的聯集本身已含 `null`(關卡2 nit 更正 v2 這一格的舊字面) | `.rpc('admin_cancel_order', …)` 能通過 typecheck;檔頭「新增函式」清單同步 | 高風險(平台/型別來源) |
| **1** | **A9g-1** | `ADMIN_ORDER_DETAIL_SELECT`(`SupabaseOrderAdapter.ts:115-116`)內嵌 `order_item_quantity_summary`;`AdminOrderDetailItem`(`types.ts:439-474`)加 `quantitySummary`;mapper | 逐品項讀得到 instock/cancelled;**洩漏守門測試**對「加進 storefront 投影」的突變轉紅 | **高風險**(K1-14:改既有明細查詢+投影 service-role-only 資料) |
| **2** | **A9g-2** | 內嵌 `payment_charge_attempts`(1.2 #2 要用)投影非 `failed` 筆數 | 有在途扣款的單能被畫面識別 | 高風險 |
| **3** | **A9g-3** | 內嵌 `order_cancellations(… order_cancellation_items(…))` 歷程 + 型別 + mapper。🔴 **必配 `.order()` + limit + `id` 次鍵 + `truncated` 旗標**(K1-10;`SupabaseOrderAdapter.ts:355-370` 的既有慣例逐字) | 截斷邊界確定;`actor`(staff id)= 內部資料,守門測試同時盯三條 storefront 投影 | 高風險 |
| **4** | **A9d2-2a** | `cancel-action-state.ts`(欄位常數、token、失敗碼聯集、`Record<Code,string>` 訊息表 §4.2)+ `cancel-form.ts` 純解析器(含**取消原因七碼 enum + `other` 說明欄**,K1-3) | 訊息表與碼一對一(漏寫在型別層轉紅);解析器逐形狀測試 | 高風險 |
| **5** | **A9d2-2b+c** | `cancel-repository.ts`(§4.1 形狀全集斷言 + §4.3 錯誤分流)+ `cancel-actions.ts`(閘→解析→repository→失敗 state / 成功 PRG) | 形狀全集逐形狀測試;錯誤分流測試**帶真實 `PostgrestError.code` 欄**(否則恆綠,前例 `note-repository.test.ts:94-114`);§2 五條慣例逐條有測試 | 高風險 |

### Phase 2 ⛔ **等 DAG,拍板 2026-08-05 Q0=A —— 本期一行不動**

> Sean Q0=A:照母 plan DAG 序,本期只做 Phase 1。**A13a/A13b 零行**。
> 🔴 下面三題答案**已拍板但本期零落地** —— 記在這裡是為了 A13 開工時不用重問,
> **不是**授權現在順手做一半(主視窗 A-24 附註 1 逐字)。
> - **Q1=A**:不解讀 RPC 通用字串,統一文案 + 畫面事先擋。
>   🔴 本期只交付 **action/讀模型層**的分流與上限計算;「UI 要怎麼用這些值」寫成契約註解留給 A13,
>   **不寫 UI code**(附註 2)。
> - **Q2=A**:同頁兩段式展開複核(照退款區塊慣例),不另開路由、不用 Modal。
> - **Q3=B**:**不用**「訂單號末 4 碼」人因閘,勾選 + 紅色按鈕即可。
>   與退款不一致是 Sean 知情的選擇(取消未動錢)。

| # | 片 | 內容 |
|---|---|---|
| 6 | **A13a** | 唯讀複核:歷次取消、逐品項**已到貨量 vs 尚可取消量**、1.2 的八條拒因逐條文案、`itemsTruncated` 停用 |
| 7 | **A13b-1** | 取消表單骨架:整單/部分模式、原因七碼 + `other` 說明、確認碼、`useActionState`、危險操作沉底紅框 |
| 8 | **A13b-2** | 逐品項勾選 + 數量上限 + §2.1 的凍結/換鍵流程 |
| 9 | **接線** | `result-banner` 加成功碼 + 頁層 wiring 測試(仿 `app/orders/[id]/refund-wiring.test.tsx`) |

片 6-9 分開的理由:`refund-section.tsx` 209 行、`item-procurement-form.tsx` 354 行都是前例,
合成一片會直接撞鐵則 6(>400 行預設拆)。

---

## §4 repository 合約

### 4.1 成功 payload 形狀全集(K1 判 PASS,原樣保留)

```
① 是 object 且非 null 非陣列
② 鍵集合恰為 {cancelled, cancellation_id, idempotent, closed}(多一鍵少一鍵都算漂移)
③ cancelled === true(RPC 只在成功路徑 RETURN,false 不是它的產物)
④ typeof cancellation_id === 'string' 且過 isUuid
⑤ typeof idempotent === 'boolean' && typeof closed === 'boolean'
任一不符 → OrderCancelCallerBugError
```

②的「恰等」而非「包含」是刻意的:RPC 日後加鍵要**轉紅讓人來看**,不是靜默忽略。

### 4.2 失敗碼聯集與訊息表(K1-12:v1 把這段推給 mail,無法施工;此處定案)

**UI 分支不解析訊息文字**——理由見 §9 Q1。

🔴🔴 **但要誠實寫下這條的代價**(2026-08-05 片 0 R1 must-fix 抓到、連帶修正本節):
`P0001` **同時**是通用訊息類(29 處 —— 業務拒絕 + hash/actor 不符 + 帳本病理,三者逐字相同)
**與輸入類錯誤**(11 處具體訊息,
`20260805100000:117/129/138/142/149/154/159/164/170/174/178`)的 SQLSTATE ——
全函式只有隔離閘 `:112` 顯式帶 `P8C01`。⇒ **SQLSTATE 分不出「單子不能取消」與「我們送了畸形參數」**。
若只做 UI 分支而不做別的,呼叫端 bug 會被靜默吞成「這張單目前不能取消」。

⇒ **補償(必做,不是選配)**:repository/action 在 P0001 路徑上**必須把 `error.message` 記進 log**
(照 `note-actions.ts:144-152` 的既有寫法:只記 `code` 與 `message` 前 200 字,
**不得**記 `details`/`hint` —— PG 的 DETAIL 會帶整列內容進 Vercel log)。
判別器不是被丟掉,是從**UI 分支**移到**營運可觀測面**。
驗收要有一條測試釘住:P0001 路徑一定呼叫了 logger 且帶到 message。

| 碼 | 來源 | 員工看到 |
|---|---|---|
| `denied` | 授權閘 | 沒有權限或登入已失效,取消沒有送出。 |
| `invalid` | 解析器 | 表單內容不正確,取消沒有送出。 |
| `rejected` | `P0001` | 這張單目前不能取消(狀態可能剛變動)。請重新整理本單確認後再決定,不要重複按。 |
| `bug` | `P8C01` / `42501` / `PGRST202` / `23514` / `22003` / payload 形狀不符 | 系統狀態異常,取消**可能已經寫進去了**。請重新整理確認,並通知系統維護,不要重複按。 |
| `retry` | `55P03` / `40P01` | 系統忙碌,這次沒完成。請重新整理本單確認後再送一次。 |
| `error` | 其他 throw | 取消**可能已經寫進去了**。請重新整理本單確認之後再決定要不要重送。 |

🔴 `bug`/`error`/`retry` 一律叫他「重新整理確認」而**不是**「稍後再試」——
取消帳本 append-only(`20260805100000:17` 對 `order_cancellation_items` 零 UPDATE/DELETE),
同 `note-action-state.ts:101-103` 的理由。

### 4.3 錯誤分流依據(K1-11:v1 只列 4 個 SQLSTATE,漏了三個)

| SQLSTATE | 來源 | 分類 |
|---|---|---|
| `P8C01` | 隔離閘 `:111-113` | `bug`(部署面設定錯,重按不會好) |
| `P0001` | RPC 全部 `RAISE` | `rejected` |
| `55P03` | `SET lock_timeout='5s'` `:92` | `retry` |
| `40P01` | 死結(取消線已知面,memory `project_m4b-a8-cancellation-line-decisions`) | `retry` |
| `23514` | 寫 items 觸發 A4a 重算 → A1 CHECK(`20260803140000`) | `bug`(資料面,重按不會好) |
| `22003` | 數值溢位 | `bug` |
| `42501` | ACL 被撤(權限不足) | `bug`(部署面) |
| `PGRST202` | **簽章漂移 / 找不到函式**(PostgREST schema cache;**不是** 42501 —— 關卡2 更正 v2 把兩者混為一談) | `bug`(部署面) |

---

## §5 三視角(鐵則 10)

- **擴充性**:第 3 批開通已付款取消時,改動面 = 1.2 #1/#2 的文案與入口條件,repository/action 契約不動。
- **可維護性**:失敗碼聯集 + `Record<Code,string>` ⇒ 加碼漏訊息在型別層轉紅。
- **bug 可追蹤性**:action 記 `request_id` + `request_token` 兩個 id(同 `note-actions.ts:105-107`);
  **不記** `details`/`hint`(PG 23514 的 DETAIL 會帶整列內容進 log,`note-actions.ts:144-145`)。

## §6 分級、rollback、紅線

- 內容分級 **L1**(取消原因七碼是 RPC 寫死的 enum `:119-127`,非後台 CRUD 內容)。
- 片型:**片 0-5 全部高風險**(K1-14 更正 v1 把片 1/2 列標準片)⇒ 對抗審查不降級。
- 鐵則 8:跨 3+ 檔且動共用讀模型 ⇒ 已提 plan 等批(本檔)。
- 🔴 **rollback 只能逆 DAG 回退**(K1-16 更正 v1 的「每片可獨立 revert」):
  後片 import 前片的型別與 action,單獨 revert 前片會編譯壞。回退序 = 片 5→4→3→2→1→0。
- 🔴 **`shipped_quantity` 合約債**(K1-15;母 plan `:384` 逐字,對本線有約束力):
  第 2 批建包裹模型時,**同一片**要把可取消量改成 `quantity − instock − cancelled − shipped`
  ⇒ 屆時 **A9g 投影與 UI 上限同步要改**,不是只有第 3 批才動。現況 `shipped` 欄不存在 ⇒ 完整式退化,**不是不需要**。
- 紅線:不 push、不動 STATUS/CURRENT、不 apply migration、不碰 `.env*`、`git add` 精準路徑。

## §7 誠實邊界(不做的事,具名承接)

- **refund job 狀態投影**(母 plan row 43 `:390` 列為 A9g 的第三項):第 1 批
  `order_refund_jobs` 恆為空集合。🔴 K1-9 更正:v1 說「投影照建」卻沒有任何片承接。
  **本 plan 明文不做**,承接點 = 第 3 批 R17 結案操作鏈(`master-plan-v2.md:552`)。
  ⇒ Phase 1 收工**不得宣稱 A9g 完成**,只完成 A9g 的取消側(建議記為 `A9g-cancel`)。
- **已付款取消**:第 1 批 fail-closed,UI 只顯示指路文案(row 65)。
- **部分取消未閉環**:部分取消後 A8c 封鎖該單卡收款,剩餘品項應收重算在第 3 批
  (母 plan `:308`、`:384`)⇒ A13a 必須明示。

## §8 關卡1 對帳(codex `gpt-5.6-sol`,R1 = FAIL,16 must-fix + 1 nit)

跑前後 `git status --porcelain` 比對零留痕 ✅。逐條處置:

| # | 處置 |
|---|---|
| 1 DAG 略序 | ✅ 折入 §0.2,切 Phase 1/2,升為 Q0 待 Sean 拍板 |
| 2 型別無此函式 | ✅ 新增**片 0**(已親驗:全檔零命中) |
| 3 缺原因七碼 | ✅ 片 4 解析器 + 片 7 表單 |
| 4 缺 attempts 投影 | ✅ 新增**片 2** |
| 5 缺 cancelledAt/帳本病理 | ✅ §1.2 #3/#4 |
| 6 摘要缺列只提示 | ✅ 改 fail-closed,§1.2 #7 |
| 7 已到貨寫過頭 | ✅ §1.2 更正段(已到貨量 vs 尚可取消量) |
| 8 itemsTruncated | ✅ §1.4 |
| 9 refund-job 無承接 | ✅ §7 明文不做 + 具名承接點 + 不得宣稱 A9g 完成 |
| 10 歷程缺序/limit/次鍵 | ✅ 片 3 驗收 |
| 11 漏 23514/22003/42501 | ✅ §4.3 |
| 12 P0001 分流未定案 | ✅ §4.2 表定案 |
| 13 同 token 撞 hash | ✅ §2.1 凍結/換鍵流程 |
| 14 A9g 非純加法 | ✅ 片 1-3 改列高風險 |
| 15 shipped 合約債 | ✅ §6 |
| 16 revert 不可獨立 | ✅ §6 逆 DAG |
| 17 nit 片數措辭 | ✅ §0.1 改寫、片號重編 0-5 |

## §9 拍板紀錄(2026-08-05,Sean 經主視窗 A-24;零待決)

| 題 | 拍板 | 本期是否落地 |
|---|---|---|
| **Q0** 畫面現在做嗎 | **A** 照 DAG 序,只做 Phase 1 | ✅ 本 plan 的施工範圍 = 片 0-5 |
| **Q1** 錯誤訊息多細 | **A** 不解讀 RPC 通用字串,統一文案 + 畫面事先擋 | 🟡 **一半**:action 層分流與上限計算落地;UI 擋的那半屬 A13 |
| **Q2** 複核頁形態 | **A** 同頁兩段式展開 | ⛔ Phase 2 |
| **Q3** 末 4 碼人因閘 | **B** 不用,勾選 + 紅色按鈕 | ⛔ Phase 2 |

## §10 關卡2 對帳(codex `gpt-5.6-sol`,審片 0 的 diff)

| 輪 | 結果 | 內容 |
|---|---|---|
| R1 | **FAIL** 3 must-fix + 3 nit | ①通用訊息 29 處**不全是業務拒絕**(還含 hash 不符 `:206-208`、帳本病理 `:342-352`,三者逐字相同)②凍結範圍漏 `rejected`/`error` ③`42501` 與 `PGRST202` 混為一談;nit:`p_items` 校正字面殘留 / 「必須送 NULL」說太滿 / 舊數字未標「當時」 |
| R2 | **FAIL**(僅殘留字面) | MF2・MF3・nit1・nit3 已消解;**MF1 與 nit2 我只改了看到的那一段,另有四處舊字面沒同步** —— 正是 memory `feedback_claimed-sync-but-only-patched-touched-lines` 那條(已復發 9+ 次) |
| 收斂 | **機械驗證** | 已 grep 全兩檔建立舊字面清單並逐處修完;現況:`約 30 處` 零命中、`必須.*送 NULL` 零命中、殘留 `業務拒絕` 全是**逐字引用 DB COMMENT** 或**「不只/不全是業務拒絕」的更正句**、`42501` 每處都與 `PGRST202` 分列 |

🔴 **誠實邊界**:關卡2 兩輪判定皆 FAIL;最終狀態**未再經第三輪 LLM 覆審**,
是以上述 grep 清單機械驗證收斂的。理由:R2 的殘留屬「同一主張在別處沒同步」這一**可機械窮舉**的類別,
grep 比再開一輪對抗審查更能證明「全樹都改到了」。此判斷屬流程題、依主視窗 A-24 附註 3「流程題自裁」自行決定。
