# `EXCEPTION WHEN OTHERS` 統一處理 —— plan(不寫碼)

> 板列 `⟦b4-NCPCANCELROLLBACK⟧`(`bash scripts/board-row-by-anchor.sh b4-NCPCANCELROLLBACK`)。
> 主視窗 `-f1` 2026-09-07 派給 `-ship`:**出「統一處理」plan,不寫碼**。
> 本檔零改碼、零 migration、零 apply。**它要的批准在 §6。**

---

## 0. 先講一件會改變你怎麼讀本檔的事:**這一族的數字,我自己就量出三個**

```
15  ← 板列上原本寫的(我 2026-09-07 04:xx 寫的)   🔴 錯
18  ← 剝掉 SQL 註解之後再判                        ✅ 本檔採用
14  ← 直接對【生檔案文字】判                        🔴 會少報(註解裡的字被算成已處理)
```

⚠️ **而【分子】那一側我也量出三個**:`EXCEPTION WHEN OTHERS` 的檔數 = **22**(python,跨行)/ **21**(`grep -i`)/ **18**(`grep` 不加 `-i`)—— 成因見本節末「🔬 數法」。
🎯 **⇒ 這一族六個數字,沒有一個是「錯的尺」量出來的;它們是【六個不同的問題】。**
⇒ 🛑 **所以引用時要連問題一起講,不能只講數字。**

**差別全在「`query_canceled` 那個字出現在哪裡」**:

- 生文字判 ⇒ **8 支**檔案「含 `query_canceled`」⇒ 22 − 8 = **14**(數法見本節末「🔬 數法」)
- 剝註解判 ⇒ 只有 **4 支**真的在碼裡接 ⇒ 22 − 4 = **18**
- 🔴 **中間那 4 支,`query_canceled` 只出現在【註解】裡**

🎯 **而其中一支就是這一列的主角** ——
`20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql`:
它的註解裡逐字抄著 codex 那句 finding(「`WHEN OTHERS` **不接** `query_canceled`」),
⇒ 📌 **一把生文字的尺會把它算成「已經接了」—— 而那個字之所以在檔裡,正是因為它【沒接】。**

> 🛑 **⇒ 引用本檔任何一個數字時,要一起說「剝了註解」。**
> 板列上那個 **15** 我會同時訂正,舊字面留刪除線。

### 🔬 數法(可重現;三個數字都是這樣來的)

分母(**370 支**,而這個數會長 ⇒ 跑的時候自己重數):

```
ls supabase/migrations/*.sql | wc -l
```

生文字那一發:

```
grep -a -l -iE 'EXCEPTION[[:space:]]+WHEN[[:space:]]+OTHERS' supabase/migrations/*.sql | wc -l
grep -a -l -i 'query_canceled' supabase/migrations/*.sql | wc -l
```

🔴🔴 **而上面第一行【回 21,不是 22】—— 我寫這一節的時候先寫了 22,跑一次才發現不對。**
差的那一支是 `20260531142534_govern_rls_auto_enable.sql`:它的 `EXCEPTION` 與 `WHEN` **中間換行**
⇒ `grep` 逐行掃**結構上看不到它**,而 python 的 `\s`(跨行)看得到。
⇒ 📌 **兩把尺都沒有錯,它們答的是不同的問題**:一把答「哪一**行**裡有這串字」,
一把答「這支**檔**裡有沒有這個結構」。**本檔採用後者 ⇒ 22。**
⚠️ 另外 `-i` 不能省:少了它會再少 3 支(**18**)—— 那正是這一族第一次被量時寫下的數。

🔴 **剝註解那一發沒有一行 shell 做得到**(要處理 `--`、`/* */` 與**單引號字串**三種)
⇒ 用 `python3` 重跑本檔的數法:`strip_sql_comments()` 的實作與
`scripts/cron-allowlist-drift-gate.py` / `scripts/board-token-normalize.py` 同族,
**照那兩支抄一份即可** —— 🛑 **不要用 `sed 's/--.*//'`,它會砍掉字串裡的 `--`。**

負對照(現造字面,必須 0):

```
grep -a -l 'ZZZOTHERS_QVX7719' supabase/migrations/*.sql | wc -l
```

⚠️ **本節的每一個數字都綁著「2026-09-07 06:2x、在 `~/pcm-wt-ship`、HEAD `0db23c081` 之後」那個時刻。**
新 migration 一進來它就變 ⇒ **引用前自己跑一次。**
正對照 = 下面 §2c 那 4 支「已經做對」的樣本(它們是這一族**唯一**在碼裡接了 `query_canceled` 的,數法同上、剝註解)。

---

## 1. 病是什麼(照抄板列,不改寫)

codex 2026-09-04 對抗審查逐字:

> `WHEN OTHERS` 不接 `query_canceled` 與 `assert_failure`;重算等待 admin 鎖時撞 `statement timeout`,
> 整筆客人收款仍會回滾,違反硬不變式。

機制一句話:`EXCEPTION WHEN OTHERS THEN …` **會把 `query_canceled`(statement timeout / `pg_cancel_backend`)
一起吞掉**,於是「因為逾時而中止」被當成「一個可以吞掉繼續走的錯誤」處理
⇒ 而那個 handler 通常是「記一筆 log 就 return」⇒ **外層交易照樣回滾,而呼叫端以為它成功了。**

⚠️ **觸發頻率沒有人量過。** 板列自標一次、我今晚再標一次:
**「很少發生」這句話沒有來源,不要引用。** 要量它需要正式庫的 `statement_timeout` 實際觸發紀錄。

---

## 2. 分堆(18 支;剝註解後判)

### 2a. 💰 錢路那堆(**5 支** —— 先做這一堆)

| 檔 | `WHEN OTHERS` 次數 | 行數 |
|---|---|---|
| `20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql` | 4 | 776 |
| `20260904160000_m4b_search_catalog_multi_category.sql` | 1 | 523 |
| `20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql` ← **本列主角** | 2 | 809 |
| `20260905070000_m4b_pending_refund_on_late_payment.sql` | 2 | 690 |
| `20260906600000_m4b_expire_day_boundary.sql` | 1 | 483 |

> ⚠️ **「錢路」是用【檔名 + 內文字面】分的堆,不是逐支開檔判的。**
> 判準:檔名或內文出現 `payment|refund|order_payments|wallet|charge|capture|settle|paid|price|coupon` 達門檻。
> 🔴 `search_catalog_multi_category` 那支**很可能是誤入**(它是搜尋,不是金流)——
> **我沒有開檔確認**,列在這裡是因為**寧可多看一支,不要漏一支**。

### 2b. 一般那堆(**13 支**)

`20260531142534_govern_rls_auto_enable.sql`(1)·
`20260817080000_m4b_628_revoke_maintain_brands_categories.sql`(2)·
`20260820021000_m4b_e10_d1_record_manual_refund.sql`(**9** ← 全 repo 最多)·
`20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql`(3)·
`20260829170000_m4b_2b1_admin_coupon_list_view.sql`(1)·
`20260831170000_m4b_sweepdead_heartbeat_stale_counts.sql`(1)·
`20260901060000_m4b_e4_order_created_stuck_count.sql`(1)·
`20260903080000_m4b_expire_unpaid_by_payment_channel.sql`(1)·
`20260905140000_m4b_acl_drift_digest_table.sql`(1)·
`20260905170000_m4b_acl_drift_status_and_approve.sql`(1)·
`20260905260000_m4b_public_views_revoke_write_from_anon.sql`(1)·
`20260905290000_m4b_pending_refund_open_failure_incident.sql`(3)·
`20260905360000_m4b_pricecopytax_p2_manual_order_computes_tax.sql`(1)

> 🔵 `record_manual_refund` 那支 **9 次**是異常值 ⇒ **它一支就佔全體的 1/4** ⇒ 值得單獨開檔看是不是同一個 pattern 重複貼。

### 2c. ⚪ 正對照:**4 支已經做對的**(抄它們,不要重新發明)

`20260901021000_m4b_coupon_p3b_create_order_redeem.sql` ·
`20260901030000_m4b_zero_total_settle.sql` ·
`20260905180000_m4b_late_payment_pending_refund_sweep.sql` ·
`20260905220000_m4b_settle_retry_sweep.sql`

---

## 3. 「統一處理」具體是什麼(而它有兩種形狀,要 Sean/主視窗選一個)

### 甲 · 逐支補 `WHEN query_canceled THEN RAISE`(把中止原樣往外拋)

```
EXCEPTION
  WHEN query_canceled THEN RAISE;      -- 逾時/取消 ⇒ 不吞, 原樣往外
  WHEN assert_failure THEN RAISE;      -- 不變式壞了 ⇒ 不吞
  WHEN OTHERS THEN …既有處理…
```

- ✅ **與 §2c 那 4 支現行做法一致**(那 4 支的清單與數法見 §0 與 §2c)⇒ 抄得到、審得動、每一支的 diff 都很小。
- 🔴 **代價**:18 支 × 至少一段 ⇒ **這不是一片**,而且**每一支都是已 apply 的歷史檔**
  ⇒ 🛑 **不能就地改**(`⟦01-LEDGERHASH1⟧` 乙類:改已貼的歷史檔會讓帳本 sha 失準)
  ⇒ **要用【新 migration 重建那些函式】**,不是編輯舊檔。

### 乙 · 收成一支共用的 handler

- 例如一支 `pcm_util.reraise_if_cancelled()`,或把那段寫成統一的樣板。
- ✅ 之後新寫的人只抄一行。
- 🔴 **代價**:PL/pgSQL 的 `EXCEPTION` 子句**不能被函式抽走** ——
  你仍然要在每一支寫 `WHEN query_canceled THEN RAISE`,
  ⇒ 📌 **「共用 handler」在這個語言裡救不了重複** ⇒ 🛑 **乙 大概率是假選項,而我沒有實作驗證過。**

### 🔵 而不論甲乙,**都要配一道閘**,否則它會再長回來

`.husky` / `harvest-chain` 加一道:**新的 migration 若有 `EXCEPTION WHEN OTHERS` 而沒有 `query_canceled` ⇒ 出聲。**

- 🛑 **先只報不擋**(照 `REPORT_ONLY` 那一族的形狀)—— 現存 18 支會讓一道會擋的閘第一天就被關掉。
- ✅ **要配 baseline**(釘住現有 18 支)⇒ **只對新增的判紅**。
- 🔴 **而那道閘的判準必須【剝註解】** —— 見 §0:不剝的話,那 4 支會被讀成已處理。

---

## 4. 建議的順序(而每一步都可以單獨停下)

1. **開一道 baseline 閘(只報不擋)** ⇒ 先止血:**不再長新的**。
   體積小、不動任何歷史檔、不需要 Sean 的手。**這一步我建議先做。**
2. **逐支開檔判 §2a 那 5 支** —— 特別是確認 `search_catalog_multi_category` 是不是誤入。
3. **錢路那堆用新 migration 重建**(甲案形狀)⇒ 命中鐵則 12①③ ⇒ **codex 對抗審查 + Sean 的手**。
4. 一般那堆再排,或**就讓 baseline 閘擋著、不主動改**(它們不在錢路上)。

---

## 5. 本檔證不到什麼(照抄不簡化)

1. **觸發頻率我沒有量** —— 需要正式庫的 `statement_timeout` 觸發紀錄。「很少發生」仍然無來源。
2. **18 支我沒有逐支開檔** —— 我判的是「這支檔裡有沒有這個結構」,
   **答不出**「那個 `WHEN OTHERS` 實際包住的是哪一段」⇒ 有的可能包的是無害的段落。
3. **「錢路 5 支」是字面分堆** ⇒ 見 §2a 的警告。
4. **乙案我沒有實作驗證** ⇒ §3 乙 的結論是**讀規格推的**,不是量到的。
5. `assert_failure` 我**只當第二個欄位記錄**,沒有針對它做分堆
   ⇒ 18 支裡接了 `assert_failure` 的是 **0 支**。
6. 我**沒有**掃 `packages/` / `apps/` 那一側有沒有同型的 catch-all。

---

## 6. 要批准的是什麼

- **§4 第 1 步(baseline 閘)** ⇒ 動 `.husky` 或 `harvest-chain` ⇒ **主視窗裁**。
- **§4 第 3 步(錢路那堆)** ⇒ 新 migration + 動金流函式 ⇒ **鐵則 8 提 plan + 鐵則 12①③ codex + Sean 的手**。
- 🛑 **本檔沒有改任何一支 migration,也沒有 apply 任何東西。**
