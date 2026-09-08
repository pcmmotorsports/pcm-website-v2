# Plan · **稽核表補三個洞**(`admin_audit_log`)

> 線【帳號】`account` 2026-09-08 · **plan 而已, 一行碼都沒動**
> 🔬 座標:`origin/dev = 06cf1ff3f` · 分支 `agent/line-account-cardcancel`
> 🔴 **鐵則 12③ 命中**(資料正確性 + schema)⇒ **codex 對抗審查不降級 + Sean 拍板才動。**
> 🛑 **標題刻意寫「三個洞」不是「補 before 欄」** —— 主視窗 A 逐字:
>    **「標題會決定下一個人以為範圍多大。」**

---

## 0. 為什麼合成一份

```
⟦b4-AUDITNULLAMBIG⟧  before 分不出【沒有那一列】與【我讀不到】
⟦b4-MGR0-RPC⟧        沒有欄位記【那一刻他有沒有權】
(第三個)             actor 存的是身分字串, 而【權限狀態沒有快照】
⇒ 三個都在同一張 admin_audit_log
```
🔴 **分兩次做 = 為同一張表開兩次 migration, 而第二次會撞第一次剛加的欄。**
(主視窗 A 2026-09-08 裁:合成一份, 不開兩份。)

---

## 1. 三個洞 —— 每個都附今天的讀數

### 洞① `before` 分不出「沒有那一列」與「我讀不到」

`apps/admin/src/lib/orders/manual-cancel-notice-read.ts:96` 的
`readManualCancelNoticeRowForAudit()` 三條 `return null`:

| # | 世界 | 行 | 留痕 |
|---|---|---|---|
| ① | `res.error`(DB / RLS 出錯) | `:106` | 🔴 **沒有** |
| ② | 真的沒有那一列 | `:110` | — |
| ③ | `catch` 丟出來 | `:121` | 🔴 **沒有** |

被寫成 `actions.ts:233` / `:405` 的 `before: { order_cancelled_outbox_row: null }`。

```
🔬 正式庫唯讀(2026-09-08):那兩個 action 的稽核列 ⇒ **0 列**
🟢 正對照 A 整張表 119 列 · 正對照 B 21 個相異 action 逐個列出,
            🔴 而【沒有一個是 email.order_cancelled.*】⇒ 那個 0 不是 LIKE 問錯
⚪ 負對照 現造 action 名 ⇒ 0
```
✅ **⇒ 這個洞【還沒有寫壞任何一列】** ⇒ 修法只要防未來, **不必處理舊資料**。

### 洞② 沒有欄位記「那一刻他有沒有權」

```
🔬 admin_audit_log 十個欄逐個印:
   id / actor / action / target / before / after / reason / request_id / source_app / created_at
🔴 【沒有任何一欄記權限】—— 沒有 role、沒有 is_manager、沒有 permission 快照
```
📌 **那不是「寫漏了一個值」, 是【schema 裡沒有那個問題的位置】。**
⇒ 🛑 所以 `⟦b4-MGR0-RPC⟧` 那句「**『A 做的』≠『A 當時有權』**」**今天無法在事後回答** ——
   不是查得慢, 是**查不到**。

### 洞③ 權限狀態沒有快照 —— 🔵 **而它比我先前報的【輕一級】, 我自己訂正**

```
⛔ ~~我先前報:「actor 存的是人名字串不是 id ⇒ 改名/換人之後舊列指向誰也答不出來」~~

🔬 而我去查了 staff 表:
   staff.id 的型別是 **text**, 值是 `sean` / `staff_1` / `staff_2` / `op4_backfill` /
   `payment_confirmer` / `test_01`(6 列)
   ⇒ 🔵 **`actor` 存的【就是】那個 id, 不是 label** ——
      稽核 `sean` 102 列 / `staff_1` 17 列, 兩者**各自對得上 staff 1 列**(119/119 全部對得上)
```
⇒ ✅ **「指向誰」這一格【今天成立】。我撤回那半。**
⇒ 🔴 **而真正的洞留著, 它換了一句話**:
```
staff 有 is_manager / is_active 兩個【會變】的欄, 而稽核【沒有存當下的值】
⇒ 📌 那 119 列裡, 每一列的「他當時是不是 manager」都要去【現在的 staff 表】猜
⇒ 🛑 而 staff 表會變 ⇒ **同一列稽核, 明天讀出來的答案可能不一樣。**
```
🔵 **實例就在表上**:`test_01` / `op4_backfill` / `payment_confirmer` 今天 `is_active = f`
⇒ 若它們曾經寫過稽核列, 那些列今天讀起來會像「一個停用帳號做的」。

---

## 2. 打算怎麼改(一支 migration + 兩處呼叫端)

| 步 | 動作 | 檔 |
|---|---|---|
| A | `admin_audit_log` 加一欄 `actor_snapshot jsonb`, 存**寫入當下**的 `{is_manager, is_active}`(以及未來的 role) | 新 migration |
| B | 洞① 的三條 `return null` 改判別聯集(`row` / `absent` / `unreadable`);形狀照 `read.ts:139-143` **同檔已有**的那支 | `manual-cancel-notice-read.ts` |
| C | 洞① 的兩處呼叫端寫 `'none'` / `'unreadable'`;字彙 `actions.ts:110` **同檔已有** | `manual-cancel-notice-actions.ts` |
| D | 洞①③ 兩條無 log 的路補 log(有界去重, 用 `staff.ts:30` 的 `consumeLogSlot`) | 同 B |
| E | 測試:三個世界各自寫出**不同**的 `before`;`actor_snapshot` 有值 | 兩支 `.test.ts` |

**不改的**:
- 🛑 **既有 119 列一列都不動。** append-only, 而**改它就是本 plan 要防的那件事本身。**
- 🛑 不動 `canRevokeManualCancelNotice`(它「讀不到 ⇒ 不畫鈕」是另一個決定, 檔裡寫了理由)。

---

## 3. 🔴 本 plan 【證不到】什麼

```
① 洞②③ 的【嚴重度】我證不到:那 119 列裡有幾列的 is_manager 事後被改過
   ⇒ 要有稽核的稽核, 而那不存在。⇒ 📌 **我只證得到「查不到」, 證不到「已經錯了」。**
② 新欄 actor_snapshot 的**形狀**是我提的, 不是拍過的
   ⇒ 存 jsonb 還是三個平欄、要不要存 role —— 那要跟未來的權限模型一起想。
③ 洞① 的 0 列是【今天】的讀數, 而那兩個按鈕隨時可能被按第一次
   ⇒ 🔴 **到期那一刻沒有訊號。**
④ 我沒有查**別的地方**有沒有也存了那個 before(只查了 admin_audit_log 一張表)。
⑤ 整張表只有 119 列 ⇒ 📌 **這些小數字說的是【系統還沒被真的用過】, 不是【問題不嚴重】。**
```

## 4. 驗收條件(每條可 yes/no)

- [ ] 洞①:三個世界各自寫出**不同**的 `before`(**測試證明**, 不是讀碼)
- [ ] 洞①:兩條無 log 的路各留一行 log, 而**有界去重**
- [ ] 洞②③:`actor_snapshot` 在寫入當下取值, 而**不是**事後 join `staff`
- [ ] 🔴 **突變**:把 `unreadable` 改回 `null`、把 `actor_snapshot` 改成事後 join ⇒ **各要有測試變紅**(紅在哪一句指得出來)
- [ ] 稽核畫面(`audit-diff.ts`)吃得下新欄與字串, **實跑看過**
- [ ] 既有 **119 列一列都沒有被改動**(用 count + 抽樣 md5 驗)
- [ ] 三綠 `TURBO_FORCE=1`(`0 cached`)
- [ ] codex 對抗審查跑過(鐵則 12③, **不降級**)
- [ ] 🔴 **Sean 拍板**
