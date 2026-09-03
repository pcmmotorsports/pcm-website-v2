# plan · ⟦b4-REFUND10016⟧ 乙:讓值班分得出【先去哪裡查】

> 🔴🔴 **2026-09-03 實作後訂正(codex R2)—— 本檔原標題與 §1 那張表是【過度宣稱】**
> ⛔ ~~讓值班分得出「錢動了」與「錢沒動」~~ · ⛔ ~~`:499` = 拒絕了 = 錢沒動 ⇒ 要重退~~
> 🛑 `TapPayChargeAdapter.ts:496` 逐字「其餘非 0 碼(含 kind='full' 的任何非 0 碼 —— **組合未實證**)」
>    ⇒ 非 0 **不等於**乾淨拒絕(乾淨拒絕的碼在上游就回 `status:'rejected'`, 不會走到這裡)。
> 🎯 ⇒ **兩者都是「已送出、狀態未知」, 都不得自動重發、都不該叫人直接重退。**
>    它們真正的差別是【**先去哪裡查**】。而我原本那句過度的方向正是**雙退**。
> 📌 本 repo 早有這條紀律:`apps/admin/src/lib/payment/refund-money-line-forbidden.test.ts`。
> **舊字面留著加刪除線** —— 搜「錢沒動」的人要同一發撞到這段訂正。

> 🔴 **射程,第一句就講**(主視窗-87 硬約束②):
> **本片【不解決甲】** —— `10016` 的分類仍然卡在 TapPay sandbox 實證(⟦b4-REFUNDID1⟧)。
> **它只讓看到那一列的人分得出下一步該往哪走。** 卡住的單仍然卡住,仍然要人按。
>
> 🔴 **這個檔在什麼情況下會【變成假的】**:
> ① `TapPayChargeAdapter.ts` 的兩個 throw 點被搬動或合併(本檔用行號 `:429` / `:499` 定位)
> ② `REFUND_ERROR_CLASSES` 那個封閉字集被別人改了
> ③ 有人在 `admin_audit_log` 上加了限制 `after` 內容的東西(今天沒有,見 §3)
> ⇒ **動手前先跑 §3 那四發, 不要相信這張紙上的數字。**

線 `-db` · 2026-09-03 · 主視窗-87 裁 A、指定寫成 plan

---

## 1. 要解的是什麼(一句話)

`TapPayChargeAdapter.ts` 有兩個 throw 點,**它們的金錢意義相反**,而它們在資料庫裡留下的痕**一模一樣**。
值班看到那一列,**分不出下一步該做什麼**,而兩條路的錯誤代價相反:

| throw 點 | TapPay 那一側 | 錢 | 值班該做的 | 做錯的代價 |
|---|---|---|---|---|
| `:429`(`wire.status === 0`) | **受理了**、回應形狀壞掉 | ⛔ ~~可能已經出去~~ ⇒ **未知** | 先查**那一筆退款**的下落 | 重退 ⇒ **退兩次** |
| `:499`(`wire.status ≠ 0` 且該碼未實證) | 回了**我們沒實證過的碼** | ⛔ ~~沒動~~ ⇒ **未知** | 先確認**那個碼**(可能已查過) | ⛔ ~~不退 ⇒ 客人的錢沒回來~~ ⇒ **照舊字面做會【雙退】** |

> 08-22 與 09-01 兩次卡單都走 `:499`(板 `docs/launch-todo.md:452`;
> ⚠️ 那一格是**從已記錄的證據推的不是量到的** —— 兩次的 DB 列都在 09-01 清空訂單時被帶走了)。

---

## 2. 現況(全部是本窗當場開檔量的,不是轉述)

```
① 兩個 throw 丟【同一個型別】
   TapPayChargeAdapter.ts:429 / :499 ⇒ 皆 `throw new TapPayRefundUnknownStateError(...)`
   逐行看過, 兩處只有【訊息字面】不同

② 訊息字面【沒有被存下來】
   apps/admin/src/lib/payment/refund-error-class.ts:76
     `if (error instanceof Error) return 'error_unclassified'`
   ⇒ 兩者被分成【同一類】

③ 那筆稽核寫哪裡 —— 不是獨立的表, 是 admin_audit_log 的 jsonb 欄
   refund-unknown-state-audit.ts:180 ⇒ getAdminAuditLogRepository().record({ after: buildAfter(input) })
   buildAfter 的欄位(:110-118 逐欄看過):
     site / order_id / refund_row_id / bank_refund_id / tappay_refund_id
     / error_class / resolved_status_type / resolved_status_length
   🛑 **沒有訊息欄** ⇒ 唯一分得出兩者的東西沒有落地

④ 資訊沒有完全消失, 而它不在值班會看的地方
   adapter `logRefund` 帶 outcome:'accepted_malformed'(:421)/'unknown_wire_status'(:491)
   ⇒ Vercel runtime log 裡分得出來
   數法 `grep -rn "accepted_malformed\|unknown_wire_status" --include='*.ts' . | grep -v node_modules | grep -v '\.test\.' | grep -v TapPayChargeAdapter` ⇒ **1**
   而那 1 是 `packages/domain/src/payment/types.ts:155` 的**一句註解**, 不是碼 ⇒ 零消費端
   🔵 正對照 `grep -rl "'rejected'" --include='*.ts' . | grep -v node_modules` ⇒ **49** ⇒ 尺會動
```

---

## 3. 🔴 主視窗要我補的那格:`error_class` 有沒有 CHECK

**主視窗-87 給的判準查的是 `refund_unknown_state_audit` 這張表 —— 而【那張表不存在】。**
```
grep -rl "refund_unknown_state_audit" supabase/migrations/ | wc -l  ⇒ 0
🔵 正對照 grep -rl "admin_audit_log" supabase/migrations/ | wc -l   ⇒ 52   ⇒ 尺會動
```
🛑 **⇒ 那條 SQL 會回空集合, 而【空集合】與【沒有 CHECK】印同一個東西。**
**⇒ 它會給出一個碰巧正確的答案, 而理由是錯的。不要用它當證據。**

**正確的問法 —— 而 repo 內就答得出來(版控是那張表的真 DDL):**
```
建表 supabase/migrations/20260712210000_m4a_admin_audit_log.sql:49  `after jsonb,`
     同檔 :55-58 全部 4 條 CHECK:
       actor <> '' · action <> '' · request_id <> '' · source_app IN ('admin','quote')
     ⇒ **沒有一條碰 after**
後續唯一動它的 20260829190000_m4b_d1restore_audit_source_ops.sql:29-33
     ⇒ 只把 source_app 的字集擴成 ('admin','quote','ops')
數法 `grep -rn "ALTER TABLE[^-]*admin_audit_log" supabase/migrations/ | grep -c "ADD CONSTRAINT"` ⇒ 0(針對 CHECK 的)
🔵 正對照 `grep -rn "ADD CONSTRAINT" supabase/migrations/ | grep -v '^\s*--' | wc -l` ⇒ 116 ⇒ 尺會動
```
✅ **⇒ `error_class` 是一個 jsonb 的 key, 不是欄位 ⇒ 它結構上不可能有 CHECK。**
✅ **⇒ 本片【零 migration】⇒ 不命中鐵則 12③。**

🛑 **而這一格仍標【未在正式庫證實】**:上面是**版控重播**的結論。
若要變成量到的, 判準是(對 `admin_audit_log`, 不是那張不存在的表):
```sql
SELECT conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
 WHERE t.relname = 'admin_audit_log' AND c.contype = 'c';
-- 🔵 正對照:期望至少回 4 列(actor/action/request_id/source_app)⇒ 回 0 列 = 尺沒接上, 不是「沒有 CHECK」
```
**缺哪一道檢查才叫「已確認」:上面那一發對正式庫跑過, 且正對照非空。** 本窗無正式庫存取。

---

## 4. 要改什麼(最小形狀;主視窗硬約束① 畫的線)

```
🛑 不動:退款判斷邏輯 · DB schema · 仍然 throw · 仍然不自動重發 · 不碰 .env · 不 apply
```

**改 2 支碼 + 它們的測試:**

**(a)** `packages/domain/src/payment/types.ts` — `TapPayRefundUnknownStateError` 多帶一個 outcome
```
現在: constructor(message, refundId)
改成: constructor(message, refundId, outcome: 'accepted_malformed' | 'unknown_wire_status')
⇒ 那兩個字面【已經存在】(adapter :421 / :491), 本片不發明新詞
```

**(b)** `packages/adapters/src/tappay/TapPayChargeAdapter.ts:429` / `:499` — 各自傳它自己那顆 outcome
（兩處 `logRefund` 已經在傳同一個值 ⇒ **同一個來源, 不重打一份**）

**(c)** `apps/admin/src/lib/payment/refund-error-class.ts` — 字集加兩格
```
REFUND_ERROR_CLASSES 由 5 格 ⇒ 7 格, 新增 'accepted_malformed' · 'unknown_wire_status'
classifyRefundError 在 `instanceof Error ⇒ 'error_unclassified'` 之前先判
  `error instanceof TapPayRefundUnknownStateError ⇒ error.outcome`
⚠️ 該檔 :39 逐字「封閉字集。新增一格要同時改這裡, 測試釘住回傳值恆在字集內」⇒ 照它做
🛑 而該檔 :30-35 記著一個坑:不可以 import `composition.ts` / `refund-repository.ts`
   (它們 `import 'server-only'` ⇒ 本檔單元測試整支解析失敗)。
   ⇒ `TapPayRefundUnknownStateError` 來自 `packages/domain` ⇒ **需先驗它不帶 server-only**, 見 §6 待驗①
```

---

## 5. 影響面 / rollback

```
檔:3 支碼 + 3 支測試   ·   migration:0   ·   schema:0   ·   對外發送:0
行為改變:0 —— 仍然 throw、仍然回 refundFailure('unknown_state')、仍然不自動重發
唯一的差別:admin_audit_log.after 的 error_class 從 'error_unclassified'
           變成 'accepted_malformed' 或 'unknown_wire_status'
rollback:三支檔 revert 即可。已寫進稽核的舊列不受影響(jsonb 無 CHECK ⇒ 新舊值共存)
🔴 而【舊列讀不回來】:2026-09-03 之前寫的列全部是 'error_unclassified',
   而它們分不出是哪一種 —— **本片不回填, 也回填不了**(訊息從來沒存過)。
   ⇒ 這一句要寫進 commit body, 否則下一個人會以為稽核表整段可比。
```

鐵則:12①(退款/金流)**命中** ⇒ codex 對抗審查**不降級**(主視窗硬約束③)。
12③(schema/新 DB 物件)**不命中** —— 理由在 §3,而它是版控重播的結論、標未在正式庫證實。
鐵則 8:跨 3 檔 ⇒ **本 plan 就是那個等批准的動作**。

---

## 6. 驗收(每條 yes/no)

```
① 兩個 throw 各自帶對的 outcome —— 而【不是抄我要寫的那行碼】:
   期望值從 §1 那張表推(:429 = 受理了 ⇒ 先查那一筆 = accepted_malformed;:499 = 沒實證過的碼 ⇒ 先查那個碼 = unknown_wire_status)
② 🧬 突變:把 (b) 兩處的 outcome 對調 ⇒ 測試必須紅, 且【只有那兩格】紅
   🛑 若對調而全綠 ⇒ 斷言太弱或那個突變沒壞掉任何東西 ⇒ 先問第二個
③ 🧬 突變:把 (c) 那個新分支拿掉(退回 'error_unclassified')⇒ 必須紅
④ 字集封閉性:既有那條「回傳值恆在字集內」的測試仍綠, 且新增兩格被涵蓋
⑤ 三綠 TURBO_FORCE=1 pnpm typecheck / lint / build 皆綠
⑥ 測試:跑【測到我動的那三支檔】的檔 —— 連跑兩發, 比四個數
   (Test Files 檔數 / Tests 測項總數 / 紅的格數 / 🔴 我餵幾條 vs 它跑幾支)
⑦ codex 對抗審查跑完、findings 修完;不 push
```

**§6 待驗 —— ①② 本窗已跑, ③ 仍缺**

**① `packages/domain` 有沒有 `server-only`** ⇒ ✅ **沒有, 而我第一發量錯了**
```
⛔ 我第一發 `grep -rn "server-only" packages/domain/src/ | wc -l` ⇒ 3
   🔴 而逐處開檔:三處【全在註解裡】(types.ts:449 · :471 · order/types.ts:137)
      —— 它們是在【講】server-only, 不是在 import 它。
✅ 正確的問法(問指令不問字面):
   `grep -rn "^import 'server-only'" packages/domain/src/ | wc -l` ⇒ **0**
   🔵 正對照 同一發對 apps/admin/src/ ⇒ **41** ⇒ 尺會動
   🔵 負對照 現造字面 `^import 'zzq-not-a-package-9f'` ⇒ **0**
   而 `types.ts` 自己只 import 兩支 type-only 模組(`:9` shared/types · `:10` order/types)
⇒ **(c) 那個 import 安全, 不會炸掉 refund-error-class 的單元測試。**
📌 而這一格值得留著:**「提到 X」與「用了 X」在 grep 上是同一個命中, 而它往【危險】那一側錯**
   —— 我差一點因為一個假的 3 把整個最小形狀judged 成做不了。
```

**② `TapPayRefundUnknownStateError` 的 constructor 呼叫點** ⇒ ✅ **只有 2 處, 就是要改的那兩處**
```
`grep -rn "new TapPayRefundUnknownStateError" --include='*.ts' . | grep -v node_modules`
⇒ TapPayChargeAdapter.ts:429 · :499  ⇒ 改簽章不波及第三個地方
```

**③ §3 那發 SQL 對正式庫跑過** ⇒ 🔴 **仍缺。本窗無正式庫存取, 要主視窗或有授權的人代跑。**
   ⇒ 在它跑完之前, §3 的結論標**版控重播、未在正式庫證實**。

---

## 7. 🛑 本片不做

```
· 不碰 10016 的分類(那是甲, 前置 = TapPay sandbox 實證 ⇒ ⟦b4-REFUNDID1⟧)
· 不改 /orders/refund-exceptions 的畫面(那是下一片, 要先有這一片的資料)
· 不回填舊列(訊息從來沒存過, 回填等於編)
· 不動告警門檻(ALERT_REFUNDING_STUCK_SECONDS = 86400 是設計, 見板 :452)
```

## 8. 而它做完之後仍然剩什麼(不要讀成收線)

值班在 `/orders/refund-exceptions` 上看到的**畫面**仍然一樣 —— 本片只讓資料分得出來,
**沒有讓那個人看得到**。⇒ 要他看得到, 要另一片動 UI。
📌 **⇒ 一個分得出來而沒有人看得到的區分, 與沒有做, 在值班那一端印同一個畫面。**
