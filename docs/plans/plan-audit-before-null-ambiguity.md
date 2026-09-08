# Plan · 稽核的 `before` 分不出「沒有那一列」與「我讀不到」

> 線【帳號】`account` 2026-09-08 · **plan 而已, 沒有動任何碼**
> 🔬 座標:`dev = dcea1803c` · 分支 `agent/line-account-cardcancel`
> 🔴 **鐵則 12 命中:資料正確性(稽核)⇒ codex 對抗審查不降級。**
> 🛑 **本 plan 需 Sean 批准才實作**(鐵則 8:跨 3 檔 + 動已上 dev 的行為)。

---

## 1. 是什麼

`apps/admin/src/lib/orders/manual-cancel-notice-read.ts:96` 的
`readManualCancelNoticeRowForAudit()` 有**三條** `return null`:

| # | 世界 | 行 | 有沒有留痕 |
|---|---|---|---|
| ① | `res.error`(DB / RLS 出錯) | `:106` | 🔴 **沒有** |
| ② | `row === undefined`(真的沒有那一列) | `:110` | — (本來就不用) |
| ③ | `catch`(丟出來了) | `:121` | 🔴 **沒有** |

它被拿去當**稽核的 `before`**:

```
apps/admin/src/lib/orders/manual-cancel-notice-actions.ts:233   (撤銷登錄)
apps/admin/src/lib/orders/manual-cancel-notice-actions.ts:405   (電話通知)

  before: before === null ? { order_cancelled_outbox_row: null } : { … }
```

## 2. 為什麼要修(不是「不一致」, 是**還沒輪到**)

`actions.ts:222` 逐字寫了它的理由:
> 「讀不到就寫 `null` —— 那也是一個誠實的觀察(「我按的時候沒看到那一列」)。」

🔴 **而縫在那一句自己身上**:
- 註解說的是「我**沒看到**那一列」
- 存進稽核的 JSON 說的是 `order_cancelled_outbox_row: null` = 「**沒有**那一列」
- 📌 **稽核紀錄的用途是【事後有人爭議時拿出來看】** —— 而那時候原作者的註解不在現場,
  **只有那個 `null`。**
- 🎯 **一個誠實的觀察, 存進一個會被讀成事實的欄位, 就不再誠實了。**

### 🔴 決定性證據:同一支檔的隔壁已經做了相反的選擇

`read.ts:139-143` 逐字:
> **`unreadable` 與「不符合」在回傳上是兩種東西, 這是刻意的。**
> 讀不到時把它折成「不符合」⇒ 鈕消失 ⇒ **DB 抖一下, 那張單就沒有人救得了它**

⇒ 📌 **那推翻「這是刻意的」這個辯護** —— 作者自己在隔壁做了相反的選擇。
⇒ 🛑 **不是設計不一致, 是那一半還沒輪到。而沒輪到的那一半正是【寫進稽核】的那一半。**

### 🔵 而修法的字彙【已經在同一支檔裡】

`actions.ts:110` 同一個欄位已經寫過一個**字串**而不是 `null`:
```
before: { order_cancelled_outbox_row: 'none' },
```
⇒ 那個欄位**本來就吃得下一個說明狀態的字串**。不需要新設計。

## 3. 打算怎麼改

| 步 | 動作 | 檔 |
|---|---|---|
| A | `readManualCancelNoticeRowForAudit` 改回**判別聯集**, 照 `read.ts:139-143` 已有的形狀:`{ kind: 'row'; … } \| { kind: 'absent' } \| { kind: 'unreadable' }` | `manual-cancel-notice-read.ts` |
| B | ① 與 ③ 兩條**補 log**(用既有的 `consumeLogSlot` 有界去重, 見 `staff.ts:30` 的 `consumeLogSlot`, 用法在 `staff.ts:69`) | 同上 |
| C | 呼叫端兩處把 `unreadable` 寫成 `{ order_cancelled_outbox_row: 'unreadable' }`, `absent` 寫成 `'none'`(對齊 `:110` 既有字彙) | `manual-cancel-notice-actions.ts:233 / :405` |
| D | 測試補三格:三個世界**各自**寫出不同的 `before` | `manual-cancel-notice-read.test.ts` + `…-actions.test.ts` |

**不改的**:
- 🛑 **不動 `canRevokeManualCancelNotice:135`** —— 它「讀不到 ⇒ 不畫鈕」是**另一個決定**,
  而檔裡寫了理由(「畫一顆按不動的鈕比較糟」)。本 plan 不碰它。
- 🛑 **不動既有的稽核列。** append-only, 而且**改它就是本 plan 要防的那件事本身。**

## 4. 影響面 / rollback

- 3 支碼檔 + 2 支測試檔。**不動 schema、不動 migration、不動 RPC。**
- 稽核 `before` 的**形狀變了**(`null` ⇒ 字串)⇒ 讀稽核的畫面要能吃兩種。
  🔴 **這一格要在實作時當場驗** —— `audit-diff.ts` 怎麼展開這個欄位。
- rollback = revert 那一顆 commit。無資料遷移。

---

## 5. 🔴 本 plan 【證不到】什麼(這一節不可刪)

### ① **既有的稽核列裡已經有幾個這種 `null`, 我證不到。**

- 那要查正式庫的 `admin_audit_log`, 而**我沒有 DB 連線**(施工窗常態)。
- 🛑 **而這是【回不去的】** —— 那些列已經寫下去了, append-only,
  而**它們現在分不出來**:一個 `order_cancelled_outbox_row: null`
  到底是「那時候真的沒有那一列」還是「那時候讀不到」, **沒有任何欄位答得出來。**
- 📌 **本 plan 只能讓【以後】的列分得出來, 讓不了以前的。**

### ② 我能界定的只有**曝光期的上界**(版控, 不是正式庫)

```
193b6a8e5  2026-09-06  這支 actions.ts 最早那一顆
7e0c74eaf  2026-09-06  `before: … null` 這個形狀最早進來(撤銷登錄)
2fcd38355  2026-09-06  第二處(電話通知)
cf902d7a6  2026-09-06  折 codex 的修正
```

### 🔴 2026-09-08 補量:曝光期**不是 0**(主視窗問「那三顆部署了沒」)

原本我只量了 `origin/dev`。**補量 `origin/main`(CLAUDE.md:`main` ← production):**

```
座標(2026-09-08 當場 fetch 後)
  origin/dev  = 0a530379f   2026-09-08 01:16
  origin/main = 032e13394   2026-09-07 11:05

           origin/dev   origin/main
7e0c74eaf     在            🔴 在
2fcd38355     在            🔴 在
cf902d7a6     在            🔴 在

main 獨有 0 顆 / dev 獨有 545 顆 ⇒ main 完全被 dev 含住(是 dev 的祖先)
```

**尺的效度(雙向)**
```
🟢 正對照  origin/dev 對自己          ⇒ 「在」
⚪ 負對照① 我未推的 602feba2f          ⇒ 「不在」
⚪ 負對照② 餵一個【不存在的 ref】       ⇒ 「不在」
   🔴 這一發非做不可 —— 我第一輪把 `origin/main` 誤讀成不存在,
      而那時三顆都印「在」⇒ 我差點把「ref 壞掉」讀成「在 main 裡」。
      實際 `origin/main` 存在(032e13394);而**如果它真的不存在, 尺會說「不在」**
      ⇒ 兩個世界分得開, 這個「在」是真的。
```

⇒ 🛑 **曝光期 = 2026-09-06 至今, 而且那三顆在 production 分支上。**
⇒ 📌 **這一列不是「上線前修掉就沒事」, 是「已經在寫分不出來的資料」。**

### 🔴🔴 2026-09-08 再訂正:**我的結論對, 而理由是錯的**

我上面寫「main ← production」並據此說「在 production 分支上」。
**查重時撞到兩份既有紀錄, 它們把那句推翻了 —— 而它是【量到的】不是推的:**

```
memory project_pcm-admin-production-tracks-dev(2026-07-16, vercel inspect 實查)
  🔴 Vercel 專案 pcm-admin(admin.pcmmotorsports.com)的 production branch = `dev`, 非 main
     實證:推 dev 13ce3a9 當下 pcm-admin 產 target=production 部署並掛 admin 的 alias;
           之後推 dev:main 對 pcm-admin 只產 preview
memory project_0821-storefront-runs-main-and-lags
  🔴 逐字:「admin 跟 dev(推 dev 即上線), storefront 跟 main(要另外併)」—— 兩個 app 兩條規矩
```

🎯 **本 plan 的碼在 `apps/admin/`** ⇒ 它的 production branch 是 **`dev`**。

⇒ 🛑 **正確的說法**:那三顆在 `origin/dev` 上 ⇒ **admin 後台推上去的那一刻就上線了**,
   而 `origin/main` 在不在**與本列無關**(那是 storefront 的線)。
⇒ 📌 **結論(曝光期不是 0)不變, 而我原本給的理由是錯的。**
   一個對的結論會讓人不去查它的理由 —— 而錯的理由會被套到下一件事上, 那次不會剛好也對。

⚠️ **CLAUDE.md「Git 紀律」那句「`main` ← production」對 storefront 成立、對 admin 不成立。**
   📌 **一句寫在規則檔裡的事實, 不等於一個量到的事實** —— 而這一句在 repo 裡活了很久沒有人分開它。

⚠️ **那份 memory 的日期是 2026-07-16** ⇒ 面板設定**可能已經改過**(它自己寫了改法)。
   要升成當下量到的, 仍需有面板權限的人看一眼 —— 但**證據方向已經反過來**:
   現在是「有人量過 = dev」, 不是「我什麼都不知道」。

### ⚠️ 而我證不到的那一半(不要把它讀成「已部署」)

```
我量的是【commit 在不在那個 branch 上】, 不是【Vercel 有沒有把它建出來並推上線】。
· vercel.json 與 apps/admin/vercel.json 都【沒有】指定 production branch
  (頂層鍵只有 $schema / framework / installCommand / regions)
  ⇒ 哪一支 branch 會部署是設在 Vercel 面板上, 我從 git 看不到。
· 「main ← production」這句的來源是 CLAUDE.md「Git 紀律」那節, 不是我量到的。
🔴 ⇒ 正確的說法是:【那三顆在 production 分支上】, 而不是【那三顆已經在線上跑】。
   要把後者變成量到的, 需要有面板權限的人看一眼 main 最後一次部署的 commit。
```
⚠️ **而「幾筆」要有人拿唯讀連線去數** —— 建議的查法(**唯讀, 不改東西**):
```sql
SELECT count(*) FROM admin_audit_log
 WHERE action IN ('email.order_cancelled.manual_send_revoke_requested',
                  'email.order_cancelled.phone_notified')
   AND before ->> 'order_cancelled_outbox_row' IS NULL;
```
🔴 **而那個數字本身也分不出兩個世界** —— 它只答「有幾筆是模糊的」, 答不出「其中幾筆是誤記」。

### ③ 我沒有量的

- **別的 action 有沒有同一個形狀。** 我只掃了這一族欄位名(`order_cancelled_outbox_row`)
  ⇒ 其他稽核動作的 `before` **未掃**。
- `audit-diff.ts` 對字串 vs `null` 的展開差異, **我沒有實跑過**。

---

## 6. 驗收條件(每條可 yes/no)

- [ ] 三個世界各自寫出**不同**的 `before` 值(測試證明, 不是讀碼)
- [ ] ① 與 ③ 兩條各留一行 log, 而**有界去重**(不會被每個請求打爆)
- [ ] 🔴 **突變:把 `unreadable` 改回 `null` ⇒ 必須有測試變紅**(紅在哪一句要指得出來)
- [ ] 稽核畫面(`audit-diff.ts`)吃得下字串, **實跑看過**
- [ ] 三綠 `TURBO_FORCE=1`(`0 cached`)
- [ ] codex 對抗審查跑過(鐵則 12 資料正確性, **不降級**)
- [ ] 既有稽核列**一列都沒有被改動**
