# ④-a 片級 plan —— **草稿 v0**(E 窗八代;純 docs、**非開工令**)

> **狀態:草稿。不是開工令,也不進關卡1。** 授權出處 `E-350-A` §2(「④-a plan 草稿=照做,純 docs、寫完落 NOTE 我收」)。
> 母 plan = `docs/specs/2026-08-11-paid-cancel-refund-integration-plan.md`(**定稿 v2**);本檔只展開它 §3 那一列的 ④-a。
> 🔴 **上游 2g 未落地 ⇒ 本片不得開工**;本檔存在的目的是「令一到就能動」,不是提前動。
> **行號基準:2026-08-12 09:5x–10:0x 現量**(worktree fast-forward 到 `0adcd5e8` 之後**重量過一輪**,不是抄母 plan 的舊值——重量抓到母 plan 兩處錯,見 §7)。

---

## §0 一句話

④-a = 把**兩支已上線的取消 RPC** 從「只收 `unpaid`」改成「也收 `paid` 家族」,並在**同一次簽章改版**塞一顆必填參數,
把「取消完不管錢」擋在 DB 層。動的是**正在收錢的 RPC** ⇒ 🔴 **高風險片(鐵則 12①③)**,簽章走 **DROP + CREATE**。

---

## §1 本片 scope —— 六件,缺一不可

| # | 要做的事 | 座標(2026-08-12 現量) | 依據 |
|---|---|---|---|
| 1 | 放寬允許集合 | `20260804180000…a8a1…sql:199` / `20260805100000…a8a2…sql:360` | 母 §1-F1 |
| 2 | **重新定義冪等指紋** | `a8a1:171` / `a8a2:290` / `a8a2:307-308` | 母 §1-F1 紅字 |
| 3 | 必填參數(一併退款 / 稍後退) | 簽章 **6 參 → 7 參** | ④-Q2=A |
| 4 | ④-a 自帶的第五、第六道 overload 閘 | 新 migration 內 | 母 §4b-3 |
| 5 | 型別 regen | `packages/adapters/src/supabase/database.types.ts:106`、`:2779` | 母 §4b-3 |
| 6 | C1 告警計數放寬 | `20260810220000…sql:362` | 母 §6-C1 |

**明確不在本片**:④-b 的應用層與 UI(母 §3 「④-a 與 ④-b 不得同片」)、④-d 復原、結清執行器(母 §9-1 已轉交未來寫入器)。

---

## §2 簽章改版 —— overload 帳的「第三版」是什麼意思

🔴 **先澄清一個容易讀錯的地方**:母 §4b-3 說「四道閘期望值要重新決定(它會是第三版)」,
**不是叫我們回頭改那四道**——它們住在**已 apply 的 migration** 裡,改已 apply 的檔是另一種罪。
「第三版」= **④-a 自己帶第五、第六道**,是這條函式歷史上第三對閘。

| 版 | 閘 | 座標 | 期望值 | 本次實量字面 |
|---|---|---|---|---|
| 一 | A8a1 前置 | `a8a1:51` | 0(首建) | `'A8a1 前置閘:admin_cancel_order 已存在 % 個 overload(預期首建=0);停下人工對齊'` ✅ |
| 一 | A8a1 後置 | `a8a1:281` | 恰 1 | `'A8a1 結構 assert:overload 數=%(預期恰 1);拒繼續'` ✅ |
| 二 | A8a2 前置 | `a8a2:40` | 恰 1(=A8a1 版) | `'A8a2 前置閘:admin_cancel_order overload 數=%(預期恰 1=A8a1 版);停下人工對齊'` ✅ |
| 二 | A8a2 後置 | `a8a2:507` | 恰 1 | `'A8a2 結構 assert:overload 數=%(預期恰 1);拒繼續'` ✅ |
| **三** | **④-a 前置** | 新檔 | **恰 1(=A8a2 的 6 參版)** | 待寫 |
| **三** | **④-a 後置** | 新檔 | **恰 1(=④-a 的 7 參版)** | 待寫 |

**做法**(照 `a8a2:15` 檔頭逐字,不重新發明):

> `-- 🔴 簽名=DROP 5 參+CREATE 6 參(加 default 走 CREATE OR REPLACE 會產生第二 overload=PG`

⇒ ④-a = **DROP 6 參 + CREATE 7 參**。**不得 `CREATE OR REPLACE`**,不得給新參數 default 來「省一次 DROP」——
給 default 正是長出第二個 overload 的那條路。

**現行簽章逐字**(`database.types.ts:106`):
`public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) → jsonb` = 6 參,與上表一致。

---

## §3 冪等指紋 —— 三處字面,以及為什麼「改述詞」不夠

母 plan 的紅字說對了一半,本次重量把另一半補上:那三處**不是同一種寫法**,要分開改。

| 處 | 本次實量字面 | 形狀 |
|---|---|---|
| `a8a1:171` | `OR v_order.payment_status <> 'unpaid'::public.payment_status` | 拿**現值**比字面常數 |
| `a8a2:290` | 同上 | 同上 |
| `a8a2:307` | `OR v_audit.before IS DISTINCT FROM pg_catalog.jsonb_build_object('payment_status', 'unpaid', 'cancelled_at', NULL)` | 把 `unpaid` **烤進稽核快照的期望形狀** |
| `a8a2:308` | `OR v_audit.after->>'payment_status' IS DISTINCT FROM 'unpaid'` | 把 `unpaid` 烤進**事後**形狀 |

🔴 **`:307-308` 才是真陷阱**:它們斷言「這次重播的 before/after 快照長得跟當初一模一樣,而當初一定是 `unpaid`」。
④-Q1=A 之下取消**不動** `payment_status` ⇒ 正確的新形狀是「**before 與 after 的 `payment_status` 相等,且等於該單當下的實際值**」,
**不是**換一個常數。寫成「把 `'unpaid'` 換成 `'paid'`」會在部分退款單(`partiallyRefunded`)上再錯一次。

⚠️ **NULL 面**:退款線那支對同一個欄位是 `IF v_payment_status IS NULL OR v_payment_status NOT IN (…)`(母 §1-F2 逐字),
**它顯式處理了 NULL**。取消線這四處目前用 `<>`,而 `NULL <> 'unpaid'` 求值 NULL ⇒ 走 `IF` 的 ELSE。
放寬時要**明確決定 NULL 走哪邊並寫負測**,不要讓它從「碰巧被擋」變成「碰巧被放行」。
(memory `reference_pg-check-passes-on-null-use-coalesce-false` 是同一族的病。)

---

## §4 必填參數(④-Q2=A)的語意

- 參數本身**只記錄意圖**(一併退款 / 稍後退),**不代替退款**——真的退款走 M3 退款 RPC。
- 🔴 **它是唯一一道網**:母 §4b-1 已證退款路徑全程不看 `cancelled_at`(雙向零命中)⇒「不允許取消完不管錢」
  **完全靠這顆參數撐**。⇒ 驗收條件必須含「**不給參數 = RPC 直接拒**」的負測,而且要驗**拒的是 RPC 不是 UI**。
- 「稍後退」這個值**不產生任何後續追蹤**(今天沒有「欠退款」清單)⇒ 這是**已知缺口**,
  由 ④-b 或後續片決定要不要建;**本片不偷偷長一張表**。

---

## §5 C1 告警計數

`20260810220000…sql:362` 本次實量:`AND o.payment_status = 'unpaid'::public.payment_status),`

⇒ 放寬取消之後,**已付款取消產生的異常永遠不會進告警計數**(母 §6-C1)。
本片必須連帶改,而且**改完要有負測證明它現在數得到**——否則就是「守門存在但恆假」那一族。

---

## §6 型別 regen 與跨 apply 停點

1. **regen 是收工步驟的一部分**,不是可選:`database.types.ts:106` 與 `:2779` 都記著舊簽章,
   不 regen 的話 **`tsc` 會綠**(它信型別檔),而正式庫已經換簽章。
   ⚠️ regen 副作用見 backlog **#418**(註解引用生成型別寫死行號 ⇒ 整批過期)。
2. 🔴 **應用層不得先於 migration apply 上線**(memory `feedback_app-layer-must-not-ship-before-migration-apply`;
   事故形狀=A9h 正式站壞約 8 小時)。唯一同步點本次重量確認**仍是 1 處**:
   `apps/admin/src/lib/orders/cancel-repository.ts:160`(`grep -rn "\.rpc('admin_cancel_order'"` 語法位置數=**1**,
   非關鍵字命中數;該檔 `:7` 自稱唯一呼叫端,與實量一致)。
3. **觀測點**(那條教訓要求指定):apply 後對 PostgREST 打一次**具名參數** smoke,確認 7 參版收得到、
   且舊 6 參呼叫**明確報錯而非靜默成功**——靜默成功代表 overload 沒清乾淨。

---

## §7 🔴 對母 plan 定稿 v2 的兩處更正(本次重量抓到)

### §7-1 路徑更正(小)

母 §4b-1 / §6 寫 `PgChargeAttemptAdapter.ts:210` **沒給路徑**;真身是
`packages/adapters/src/payment/PgChargeAttemptAdapter.ts:210`(**`/payment/` 不是 `/supabase/`**)。行號 210 正確。

### §7-2 🔴 斷言方向反了(大)——`flagNonUnpaidActive` **不會**標「已取消 + 仍 paid」

母 §4b-1 與 §6-7-1 兩處都寫「④-Q1=A 之後『已取消 + 仍 paid + attempt 仍 active』**會被標人工**,
那是對的還是噪音由 ④-a 答」。**本次讀函式本體,它不會。**

定義出處 `supabase/migrations/20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:155` 起,**本體**逐字:

```
WHERE a.status IN ('pending', 'charged')
  AND o.payment_status NOT IN ('unpaid'::public.payment_status, 'paid'::public.payment_status)
  AND a.needs_manual_review = false
```

`paid` **在排除集合裡** ⇒ 「已取消 + 仍 `paid` + attempt 仍 active」**不落入它的掃描範圍**。
(交叉對照:同檔 `:20` 檔頭與 `:182` `COMMENT` 都寫 `NOT IN(unpaid,paid)`,三處一致;
另有 `20260624120008` 提到這支但檔內逐字寫「**不改本體**」⇒ 沒有後續版本推翻。)

⇒ **④-a 的真題不是「標人工是對的還是噪音」,是「那這個形狀今天誰在管」。**
📌 **母 plan 已同批更正**(`E-352-A` §2 令):`paid-cancel-refund-integration-plan.md` §4b-1 / §6-7-1 / §7-3 三處,
以及**病源** `rf7-recon-settle-trigger-matrix.md` §5 末 / §6-2 / §7-1 三處 —— 六處同 commit。
本檔**不代答**——那需要走一次 settle 路徑的實跑,屬 ④-a 開工後的第一件事。
📌 順帶:`#425`(`paid` 短路格)可能正是答案的一半,**但我沒驗**,不把它寫成結論。

⚠️ **這條更正的來源是「重量」不是「重讀」**:母 plan 那句我寫的時候引的是 adapter 的**註解**
(「標 refunded/partiallyPaid 殘留 active attempt」),沒下去看 SQL 本體。
註解沒說錯——是我把「沒列 paid」讀成了「涵蓋 paid」。這是 memory `feedback_guard-checks-existence-not-effect` 的同族。

---

## §8 順帶量到的一條**過期前瞻**(不在本片射程,轉記帳)

`20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql:27-35` 有一段 forward note〔F〕,逐字揭示兩個
「Phase 1 不可達」的盲點(flag 不收 `released` / 12h marker 永不寫),而它宣告不可達的**理由**是:

> 「Phase 1 released 僅由 R1a3 CAS(order unpaid)產生、其 order **無正常路徑變 refunded/partiallyPaid**
>  (…**Phase 1 無退款流程**)→ 兩面皆不可達」,並註明「**Phase II 開退款前置**須一併處理」。

🔴 **那個前提今天已經不成立**:M3 退款寫入 RPC(`20260803150000`)已上線,訂單**確實有路徑**變
`partiallyRefunded` / `refunded`。⇒〔F〕自己寫的**觸發條件已經到了**。

⚠️ **我沒有量到的**:是否真的存在「同時有 `released` attempt 且已退款」的單。所以我**不宣稱它已經在漏**,
只宣稱**它當初的不可達論證已經過期、需要有人重估**。
(這正是 memory `feedback_withdrawal-reason-needs-expiry-condition` 說的那種到期日;
 難得的是這次**原作者有寫失效條件**,所以它才被撿得起來。)
⇒ **已立案 `#433`**(主視窗 `E-352-A` §3 配號,同 commit 帶)。條目口徑與本節一致:只宣稱論證過期、不宣稱正在漏。

---

## §9 驗收條件(逐條 yes/no)

1. ☐ `admin_cancel_order` 在正式庫**恰 1 個 overload**,參數 7 個(catalog 問出來的,不是數 CREATE 敘述)。
2. ☐ 不給必填參數呼叫 RPC → **拒**(負測,且驗的是 SQLSTATE 不是訊息字串)。
3. ☐ `paid` / `partiallyRefunded` / `refunded` 三種單各能取消成功一次;`unpaid` **維持原行為不回歸**。
4. ☐ `payment_status` **為 NULL** 的單走哪邊已明寫,且有負測。
5. ☐ 冪等重播:同一單重打兩次 → 第二次認得出是同一件事(涵蓋 `:307-308` 的快照比對新形狀)。
6. ☐ C1 告警計數:已付款取消產生的異常**數得到**(拿掉那行改動則負測轉紅)。
7. ☐ `database.types.ts` 已 regen,新簽章 7 參入檔。
8. ☐ apply 後 PostgREST 具名參數 smoke 過,且舊 6 參呼叫**明確報錯**。
9. ☐ 三綠(typecheck + lint + build)。
10. ☐ 鐵則 12 對抗審查已跑、findings 修完才 commit、**未 push**。

---

## §10 誠實界(本草稿**沒有**做到的)

1. **零實跑**。全部是讀檔;沒跑過任何一支 migration、沒開過 PG。
2. **§7-2 的真題(「誰在管那個形狀」)我沒答**,只證明了母 plan 的答案錯在哪。
3. **§8 我沒證明它正在漏**,只證明不可達論證的前提過期。
4. **沒查 sweeper 的觸發頻率細節**:本次實量 `vercel.json` 與 `apps/admin/vercel.json` **兩檔都無 `cron` 字樣**
   (`grep -n cron` 兩檔 exit=1),而 `settle-sweep/route.ts:3` 自陳靠「Vercel cron(**本片不含**)」觸發
   ⇒ **看起來沒掛**,但我沒查 Vercel 後台、也沒查別的觸發路徑,**不下「它不會跑」的結論**。
5. **必填參數的具體型別/值域沒定**(enum? text + CHECK?)——那是開工當下配合 §3 的 NULL 決定一起拍,現在定會白定。
6. 行號=2026-08-12 09:5x–10:0x 現量;**下次引用前重量**(母 plan §7-9 同款要求,而本檔 §7 就是重量的產物)。

---

— E 窗八代,**草稿 v0**:2026-08-12(落款以本檔 mtime 為準)。**未實作、未 commit code、實作等 2g 開工令。**
