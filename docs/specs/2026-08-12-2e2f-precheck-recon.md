# 2e / 2f 前置實查(唯讀 recon)—— 母 plan 前提對正式庫複驗 + 一條守門會量錯東西

> **為什麼有這份**:2e/2f 是全線最危險的兩片(動正在收錢/退錢的、**已上線**的 RPC)。
> 主視窗 `P-532-A` 批在等 Q-425 期間做這件唯讀前置。
> **它不是 plan**:2e/2f 的做法在母 plan `docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md`,
> 這裡只回答兩個問題:①母 plan 寫的現況**今天還成立嗎** ②有沒有它沒看到的東西。
> **權威來源=正式庫 catalog 的 `prosrc`**,不是 migration 檔的 CREATE 敘述
> (後面的片會 DROP+重建,數檔案看到的是歷史不是現狀)。

---

## §1 兩支 RPC 的正式庫現況(2026-08-12 唯讀查,專案 `bmpnplmnldofgaohnaok`)

| | `close_released_attempt`(2e 要動) | `admin_initiate_order_refund`(2f 要動) |
|---|---|---|
| 簽章 | `(p_attempt_id uuid, p_resolution text)` | `(p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text)` |
| SECDEF / owner | ✅ / `postgres` | ✅ / `postgres` |
| `prosrc` md5 | `fa8afcc2bf0f3c683e156a719fea80f0` | `f98e25f58dde8306772e157f0c7cc5cb` |
| `prosrc` 長度 | 2891 | 7006 |
| **advisory lock** | **0 個** | **0 個** |
| **真列鎖**(剝註解後數) | **2**:`payment_charge_attempts … FOR UPDATE` → `orders … FOR UPDATE` | **1**:`orders … FOR NO KEY UPDATE`;之後兩次**無鎖**讀 `order_refunds` |

**md5 的用途**:2e/2f 的前置閘可以直接拿這兩顆當 pre-image pin(對照 2d 的作法)。
⚠️ 它們是**今天**的值;實作當天要重查一次再落字面(這條檔案自己也適用「行號/指紋等定案才落筆」)。

🔴 **數列鎖時踩到的坑(記在這裡,因為下一個人一定會用同一招)**:
第一次我用 `regexp_matches(prosrc,'FOR (NO KEY )?UPDATE','g')` 數,**兩支都回 3**。
逐行看才發現其中一個命中在**註解**裡(`close` 的「-- 持 FOR UPDATE 鎖 + 已驗 released…」)⇒ 真值是 2 / 1。
同族=memory `reference_grep-keyword-count-includes-comments`,差別只在這次的載體是 `prosrc` 不是檔案。

## §2 母 plan 的前提複驗:**零漂移**,三條逐條對上

| 母 plan 的字面 | 今天對正式庫查到的 | 判 |
|---|---|---|
| `:222` 逐字「close 鎖序 `20260624120010:24` 逐字 `attempt FOR UPDATE → order FOR UPDATE`」 | `prosrc` 行 19-21 = `payment_charge_attempts … FOR UPDATE`;行 42-44 = `orders … FOR UPDATE` | ✅ 相符 |
| `:256` 「③ 只收 `attempt_id`,必須先讀才知道 order_id」 | 簽章確實只有 `(p_attempt_id, p_resolution)` | ✅ 相符 |
| `:289` 「② 取 advisory 必須在**步 3 鎖訂單之前**」 | 步 3 在行 63-69(`orders … FOR NO KEY UPDATE`);advisory **目前不存在**(=待 2f 加) | ✅ 相符 |

⇒ **母 plan v6-v8 對這兩支的描述今天仍然成立**,2e/2f 可以照它動,不需要重新設計。
(我原本以為抓到兩件事 —— 「兩支對 `orders` 的鎖強度不一致」與「鎖序相反」——
查下去發現**母 plan `:187-195` 與 `:207-222` 已經逐條處理過了**,而且比我想得細。
寫在這裡是因為:**沒查就報,會變成叫別人重做已經做完的功課**。)

## §3 🔴 一條**新的**:母 plan `:296` 的守門式子,套在 ② 上會量到註解

母 plan `:296` 給的順序守門是:

```
strpos(prosrc,'pg_advisory_xact_lock') < strpos(prosrc,'FOR UPDATE')
```

**問題**:② `admin_initiate_order_refund` 的列鎖型別是 `FOR NO KEY UPDATE`,**不是** `FOR UPDATE`。
那支函式裡**唯一**出現 `FOR UPDATE` 這個字串的地方,是步 3 上面那行**解釋為什麼不能用 `FOR UPDATE` 的註解**。

**實測**(同一支函式,剝註解前後對照):

| 量的東西 | `close_released_attempt` | `admin_initiate_order_refund` |
|---|---|---|
| `strpos(prosrc,'FOR UPDATE')`(原樣) | **831**(真列鎖) | **2530** ← **註解**(`-- 步 3. 鎖訂單(G1:FOR NO KEY UPDATE —— FOR UPDATE 與 …`) |
| `strpos(剝掉 --註解, 'FOR UPDATE')` | **584**(仍是真列鎖) | **0** ← **整支函式根本沒有 `FOR UPDATE`** |
| `strpos(剝掉 --註解, 'FOR NO KEY UPDATE')` | 0 | **2459**(真列鎖:`FROM … orders o WHERE o.id = p_order_id FOR NO KEY UPDATE;`) |

剝註解的式子:`regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g')`。

**後果**:
- ② 那格守門比的是「advisory 位置 vs **那段註解**的位置」,不是 vs 真列鎖位置。
- 而**註解是全函式最容易被改的東西**。有人重寫那句話、把 `FOR UPDATE` 四個字拿掉 ⇒ `strpos` 回 **0**
  ⇒ 式子變成 `advisory_pos < 0` = **恆 false**。方向上是誤擋(fail-closed,不致命),
  但守門從此**再也不是在量鎖序**,而沒有任何症狀會告訴你這件事。
- ③ `close_released_attempt` 目前**量對了** —— 但那是運氣:它的註解剛好排在真列鎖**後面**。
  把那句註解往上搬幾行,同一條式子就開始量註解。

**修法(已驗證有效,不是提議)**:
1. **先剝註解再比位置**(上表第二列證明剝完之後 ② 的 `FOR UPDATE` 歸零、③ 仍指真列鎖)。
2. **兩支不能共用同一個字串**:③ 找 `FOR UPDATE`、② 找 `FOR NO KEY UPDATE`。
   同一條式子套兩支,必然量錯一支。
3. 🔴 **它只是廉價前哨,不是判別力來源**。真判別力在母 plan `:301` 已經要求的那條消融
   (「把 ② 的 advisory 移回步 3 之後 ⇒ 必須能構造出 40P01」)。
   ⇒ 若時間有限,**先做 `:301` 的消融**,strpos 那條可有可無;反過來只做 strpos = 拿一條會量錯的東西當保證。

## §4 附帶發現:**同一個病有一顆活的**在 `w6b3`(不是我的片,我沒動)

查「這條 strpos 式子有沒有被抄到別處」時掃到的
(數法 `grep -rln "strpos(prosrc\|strpos(p.prosrc" --include='*.md' --include='*.sh' --include='*.sql' docs/ scripts/ supabase/` → 4 檔,
逐檔開來看:母 plan `:296`=源頭、本檔=在講它、`20260730120000:271`=註解裡的實驗紀錄非守門、剩下這一顆是**活守門**)。

`scripts/w6b3-cancel-vs-receipt.sh:310` 的絆線:

```
SELECT (strpos(prosrc, 'EXCEEDS_ROOM_AFTER_CANCELLATION') > 0) FROM pg_proc WHERE proname='admin_record_item_receipt'
```

它的宣稱職責逐字是「**甲片的品項層守門仍在**(被拔掉 ⇒ 紅)」(`:306`)。

**實測**(正式庫 `admin_record_item_receipt` 的 `prosrc`):

| 量的東西 | 值 |
|---|---|
| `EXCEEDS_ROOM_AFTER_CANCELLATION` 原樣命中 | **2** |
| 剝掉 `--` 註解後命中 | **1** |

⇒ 那個碼名在**程式碼裡 1 處(真守門)、註解裡 1 處**。
**後果**:有人把真守門拿掉、而**註解留著**(拔守門時留下一句「原本這裡擋 EXCEEDS_ROOM_AFTER_CANCELLATION」是很自然的事),
`strpos` 仍 `> 0` ⇒ **本格照樣綠** —— 而「守門被拔掉要紅」正是它唯一的職責。
同族=memory `feedback_guard-checks-existence-not-effect`(只檢查規則存在、沒檢查它做了什麼)。

**修法**(與 §3 同一招):偵測前先剝註解 —— `regexp_replace(prosrc,'--[^'||chr(10)||']*','','g')`,
或改成量「它做了什麼」(構造一筆超額到貨、斷言真的被那個碼擋下)。

🔴 **我沒有動它**:w6b3 不是我的片,而且它 2026-08-11 才由 codex 關卡2 C4 + 主視窗裁定重新基準化過;
改 harness 還要 record + check 回帳、且要先確認沒有別窗在跑。**回報給主視窗決定派給誰。**
⚠️ 誠實邊界:上表兩個數字是**實測**;「拿掉 code 那處、留註解 ⇒ 仍綠」是從 `strpos(x) > 0` 推的
**一步機械推論、沒有真的跑那個突變**(它在正式庫上,我不會為了驗守門去動正式庫的函式)。

## §5 誠實邊界

- 本檔**零 code、零 DDL**;對正式庫只跑 `SELECT`(`pg_proc` / `pg_namespace` 與字串函式)。
- §1 的兩顆 md5 是**今天**的;實作當天必須重查再落進前置閘。
- §3 的「後果」段有一句是**推論不是實測**:「有人改寫註解 ⇒ strpos 回 0 ⇒ 恆 false」——
  我實測到的是「剝掉註解後 ② 的 `strpos` 確實回 0」(等價於註解被拿掉的情形),
  但**沒有真的去改註解再跑一次守門**,因為母 plan `:296` 那條守門**還不存在**(它屬 2f 片)。
- §4 的兩個命中數是實測,但「拿掉 code 那處、留註解 ⇒ 仍綠」是**一步機械推論、沒跑那個突變**(理由寫在該節)。
- 我**沒有**碰 2g-2m;它們的前提沒查。

— P 八代,2026-08-12 00:4x
