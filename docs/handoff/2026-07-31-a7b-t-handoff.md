# A7b-T 交接檔(2026-07-31 深夜)

> **狀態:已 commit `07b8e58`(未 apply、未 push;未推 1 個 commit)。**
> 🔴 **但 Fable R3 在 commit 之後才回、判 NO-GO** ⇒ 那一版是「五支 harness 全綠」的快照,
>    **不是「審查收斂」的快照**。下一個 session 直接從「§1 現在該做什麼」開始。
> 上游交接檔 = `docs/handoff/2026-07-31-a7b-m-handoff.md`(A7b-M,已 apply 正式站)。
> 規格權威 = `docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md`(v7 + 本輪回寫)。

---

## §1 現在該做什麼(依序)

> 🔴🔴 **Fable 第 3 輪已回:NO-GO,20 條(8 must-fix + 12 nit)。逐條在 §6b。**
> 它自己下 SQL 做實驗,抓到的東西前兩輪 codex 完全沒碰到。**下面三條是新視窗的第一件事。**

1. **F1 — 運費會被退兩次(錢面,最重)**。C7 只夾「件數」,而我新加的 3.2c **強制**每一張取消單的
   工單都宣告 `shipping_fee_before = orders.shipping_fee`,那個欄位不會因退款遞減
   ⇒ 兩張取消單各自「合法地」把運費退到 0。Fable 實測「合計退款 400 / 其中運費 200,實付運費 100」。
   🔴 **我的 3.2c 不只沒擋住,它讓這件事變成強制的。** 修法方向 = 對運費也要有跨工單累計上界
   (`Σ(-shipping_delta) ≤ orders.shipping_fee`),做法與 C7 同型。
2. **F6 — rollback 在「今天的正式站狀態」下跑不動**。第 ④ 步 `DROP TRIGGER
   a7bt_cancel_items_after_change_consistency ON order_cancellation_items` 沒帶 `IF EXISTS`
   (刻意不帶,理由見檔內),但**正式站現在是 M 已 apply、T 未 apply** ⇒ 那支 trigger 不存在
   ⇒ 整包死在 42704、**連 A7b-M 都退不掉**。Fable 實跑驗證過。
3. **F15 — 現行 fixture 結構上看不見 F1**。fixture 選到的訂單是 `payment_status=unpaid`、
   `shipping_fee=0`(而全 cluster 三筆 paid 訂單的運費也都是 0)⇒ 3.2c 的正向側永遠是 `0 = 0`,
   118+29 條負測**從未在非零運費上跑過**。修 F1 之前要先讓 fixture 挑(或注入)`shipping_fee > 0`。

4. **折完 §5 + §6b 其餘項**,其中 **E14 ↔ gen2 競速沒有測試** 仍在。
5. 五支 harness 全綠 + 三綠 → **commit**(精準 pathspec;本 repo 另有並行 session,
   禁 `git add .` / `-A` / `--amend`)。
6. ~~F2 待 Sean 拍板~~ **已拍板,見 §5 開頭。**
7. **不 push、不 apply** —— apply 是 Sean 手動 `db push`,且必須在審查收斂之後。
8. TapPay:sandbox 交易 `D202607314b3cIL` 排定 **2026-08-01 18:00(台北)** 請款,
   之後跑 `scratchpad/tappay_probe.py` 的第 ③-⑥ 步驗「多次部分退款」(見 §4)。

---

## §2 本 session 做了什麼(一句話)

Sean 拍板「四條錢面守門全關」之後,**A7b-T 新增 C5 / C6 / C7 / rec_trade_id 綁訂單 /
運費綁訂單 / 第 11 支反向 trigger**,並折入 codex 關卡2 兩輪共 50 條 findings 的絕大部分。

### 起因:codex 關卡2 R1 抓到一條會直接退兩次錢的洞

`pcm_a7bt_assert_job_consistent()` 的 C3/C4 只把退款明細對 `order_items`,
**完全沒有比對 `order_cancellation_items`** ⇒ 取消 A 品項卻退 B、或取消 1 件卻退 2 件,
C1-C4 全過、帳本配得平、一路走到 `completed`。我另寫攻擊腳本複驗成立。
🔴 這是**規格漏洞**,不是實作 bug —— plan §5.6(a) 從來沒要求做這個比對。

### 六道新守門(全部在 `20260731120100`)

| ID | 位置 | 擋什麼 |
|---|---|---|
| `a7bt_c5_item_not_cancelled` | 主從一致函式 | 退的品項不在該取消單的取消明細內 |
| `a7bt_c6_quantity_exceeds_cancelled` | 同上 | 退的件數 > 該取消單對該品項的取消件數 |
| `a7bt_c7_cumulative_exceeds_cancelled` | 同上(**排在 C3/C4 之後**) | 同一品項**跨取消單累計**退款件數 > `order_items.quantity` |
| `a7bt_insert_rec_trade_not_order_own` | BEFORE INSERT 3.2b | `rec_trade_id` ≠ `orders.tappay_rec_trade_id`(退到別人的卡) |
| `a7bt_insert_shipping_before_not_order_own` | BEFORE INSERT 3.2c | `shipping_fee_before` ≠ `orders.shipping_fee` |
| `a7bt_cancel_items_after_change_consistency`(trigger) | `order_cancellation_items` | 工單建好後回頭刪/改取消明細 |

另加 `pg_advisory_xact_lock(hashtext('a7bt_order:'||order_id))` 序列化 —— 同時清掉
plan §4.3 登記的「併發合約債 2」(count/sum 型 DEFERRED 檢查的快照洞)。

---

## §3 🔴 三個施工時被實測推翻的判斷(不要重蹈)

### ① 我告訴 Sean「逐筆比就夠、不需要累計」—— 錯的
推論只證明了「**同一張**取消單內拆不成兩筆」,漏掉「同一品項可以被兩張不同取消單各取消一次」
(分次取消是規格刻意允許的)。攻擊輸出逐字:
「品項原始下單量 = 1 件,單價 = 100 / 兩張取消單、兩筆退款工單全部建立成功、C1-C6 全過 /
該品項下單 1 件,但退款工單合計要退 2 件、金額 200」。

### ② C7 第一版是 no-op —— **被自己的負測抓到**
第一版寫「累計退款 ≤ **累計取消**」。C6 已保證每張取消單各自不超額 ⇒ 求和後不等式自動成立
⇒ **C7 被 C6 嚴格蘊含、永遠不會紅**。發現方式 = 它的負測物理上構造不出來。
正確上界 = **客人買的件數**(`order_items.quantity`)。
> 🔴 可複用判準:**一條新守門如果寫不出會讓它單獨轉紅的負測,先懷疑它是 no-op,不要當作「很難測」。**

### ③ 越寬的守門要排越後面
C7 一開始放在 C5/C3 之前 ⇒ 把那兩條的負測整個蓋掉(實測:兩條都變成紅在 C7),
它們就沒在測自己。移到 C3/C4 之後才各自歸因正確。

---

## §4 TapPay 實測結果(sandbox `pcmmoto_CTBC`,真的打了 API)

| 問題 | 答案 | 證據 |
|---|---|---|
| 刷 N 元能只退一部分嗎? | **未請款時不行** | `status=10024 Authorized transaction cannot be partially refunded`(連退 3/2/1/1 四次全擋) |
| 全額退款要不要先請款? | **不用,即時生效** | `status=0`、`refunded_amount=6`、`amount` 歸 0、`record_status=3` |
| 「當日請款」是即時的嗎? | **不是,是排程** | Cap Today API 回 `cap_millis` = 隔天 18:00;`is_captured` 仍 false |
| 退 3000 後能再退 2000 嗎? | **還沒測到** | 需要一筆已請款的交易;`D202607314b3cIL` 排在 2026-08-01 18:00 |

**中國信託(TW_CTBC)官方請款時間表**:18:00 前授權且欲請款 → 18:00 送批 → 銀行當下回應 → 20:00 可確認。
⇒ 早上下單約 10 小時後可部分退、晚上下單要等隔天。**不是固定一到兩天。**

### 🔴 由此暴露的設計缺口(第 3 批 worker 片,已知未解)
自動重試是 5→10→20→40→80 分鐘、第 6 次進 `dead`,**總共約 2 小時 35 分**。
而請款最快也要等到當天 20:00 ⇒ **早上下單的部分退款,重試會在中午用完、每筆掉進人工池**。
修法方向:把 `10024` 認成「**還不能做**」而不是「失敗」,`next_retry_at` 直接排到請款確認之後。

### 🔴 另一條待查證的矛盾
repo 的 `docs/reference/tappay-reference.md` 寫「退款隔日才真正生效」,
但官方銀行表對中信寫「呼叫 Refund API 後即呼叫銀行退款、銀行當下回應」。**兩邊打架,未定案。**

---

## §5 未關項(交接的重點)

| # | 事項 | 嚴重度 |
|---|---|---|
| 1 | **E14(更正結案)↔ gen2 INSERT 的競速沒有測試**。那把 `order_cancellations FOR UPDATE` 鎖只有「兩筆 gen2 併發」一個形狀被測過;拿掉或放錯位置,現有順序測試與具名突變**都會全綠**(codex R2) | must-fix |
| 2 | `order_cancellation_items` 上第 11 支 trigger 的 ACL / owner 面沒有單獨驗收(它掛在別片的表上) | 建議 |
| 3 | plan §7.4d/§7.4e 的突變數字仍有舊字面混雜(56/39/85 vs 現行 100/90/10) | 字面 |
| 4 | 已付款訂單中 **2 筆 `tappay_rec_trade_id` 為 NULL** ⇒ 綁定守門會讓它們走不了自動退款(fail-closed 正確,但要讓 Sean 知道那兩張只能人工 Portal) | 營運 |
| 5 | Fable 第 3 輪 findings(見 §6) | 視結果 |

✅ **F2 已拍板(2026-08-01,Sean)**:「同一張訂單同時只能有一筆在途退款工單」**可接受**。營運規則定為 **部分退款隔日、全額退款當日**。🔴 事實補註(規則比實測更保守,是刻意的簡化,不要日後拿實測去「放寬」它):中信實際是「18:00 前授權欲請款 → 18:00 送批 → 20:00 可確認」⇒ 早上下單其實當天 20:00 就能部分退;晚上下單才真的要等隔天。Sean 選擇一律講「隔日」。⇒ **連動(第 3 批 worker 片)**:部分退款的工單不得走「5→10→20→40→80 分鐘、2 小時 35 分放棄」那條重試曲線,要嘛延到請款確認後才 enqueue、要嘛把 `next_retry_at` 直接排到隔日;`10024 Authorized transaction cannot be partially refunded` 必須被認成「還不能做」而非「失敗」。

### 🔴 一個語意變化,已成立、要寫進第 3 批的規格
綁定 `rec_trade_id` 之後,**同一張訂單同時只能有一筆進行中的退款工單**
(一張訂單只有一筆刷卡 ⇒ 兩筆進行中必然共用同一個交易編號 ⇒ 撞 `orj_one_current_per_rec_trade_idx`)。
這本來就是原意,只是以前可以用假編號繞過。
**連帶發現:原本有約十條負測建在「正式站不可能出現的資料」上**(同一訂單兩個不同交易編號),已改。

---

## §6 審查輪次

| 輪 | 模型 | 結果 |
|---|---|---|
| K2 R1 | codex `gpt-5.6-sol` xhigh | **NO-GO**,28 must-fix + 3 nit。最重 = 退款可超過取消量(#24) |
| K2 R2 | codex `gpt-5.6-sol` xhigh | **NO-GO**,22 must-fix + 12 nit。最重 = 推翻我的「不需累計」+ rollback 身分閘沒有 `ON_ERROR_STOP` 等於虛設(兩條我都親自複驗成立) |
| R3 | **Fable**(換模型換角度:假設審查 / 災難當天可用性 / 修法回歸 / 新斷言自己的假綠) | **NO-GO**,8 must-fix + 12 nit,見 §6b |

### §6b Fable R3 findings(逐條;`commit 07b8e58` 之後才回,**尚未折入**)

**must-fix**
| # | 位置 | 一句話 |
|---|---|---|
| F1 | `20260731120100:315-322` / `:1202-1226` | **運費無累計上界**,而 3.2c 強制每張取消單重報完整原始運費 ⇒ 運費退兩次(實測 100 → 退 200) |
| F2 | `:297-304` × `20260731120000:439-441` | 綁 `rec_trade_id` 讓 U3 語意升級成「同訂單同時只能一筆在途退款」;plan §631 沒寫、表 COMMENT 也沒寫 ⇒ ****已於 2026-08-01 拍板接受**,規則 = 部分退款隔日 / 全額退款當日(見 §5 開頭)|
| F3 | `:297-304` | 整支 T **一次都沒讀 `orders.payment_status`**(grep 零命中)⇒ 未付款 / 已 refunded 的訂單照樣建得出退款工單;現在靠「只有 `confirm_order_payment` 會寫 rec_trade」這個**推論**擋 |
| F6 | `a7bt-rollback.sql:278` | 見 §1 第 2 點 |
| F7 | `a7bt-rollback.sql:344-348` | ⑦ 要求 ledger 恰刪 2 列否則 abort,**唯一沒有 escape 的一步**(⓪ 有兩把鑰匙、① 有 `skip_text_scan`)⇒ 半夜擋死自己只能改檔 |
| F11 | `:1042-1054` | advisory lock 的正確性依賴 READ COMMITTED 但沒有隔離級 fail-closed 閘;**C7 的併發洞現在其實是被 U3 擋掉的,不是被 advisory lock** ⇒ plan 把功勞記錯層 |
| F12 | `:1049-1051` | 「無鎖環」論證的前提是 advisory 只在 DEFERRED 階段取得,但每條負測都 `SET CONSTRAINTS ALL IMMEDIATE` ⇒ **測試跑的鎖序與正式站不同,那個論證沒有任何測試覆蓋** |
| F14 | `:1012-1023` + `:1475` | 第 11 支 trigger 讓取消流程與退款流程共用序列化鎖,且會拿**當下**資料重驗**歷史 completed 工單** ⇒ 日後合法改動 `order_items` 會讓新的取消動作紅在早已結清的退款單上 |
| F15 | `a7bt-fixtures.sh:258-268` | 見 §1 第 3 點 |

**nit**:F4(C7 上界 `order_items.quantity` 的不可變性沒寫進註解,而 A1 即將放一份去正規化副本)/
F5(`rec_trade_id` 只在 INSERT 檢一次,誠實邊界沒寫)/ F8(兩把鑰匙的 `\gset` 在 `BEGIN` 之外,
走 Supavisor transaction pooling 可能不是同一條 backend,**疑似、附驗法**)/ F9(第二把鑰匙的期望值
呼叫者事前不知道,而錯誤訊息把正確答案原樣印出來 ⇒ 實質只多一次重跑)/ F10(③ 的 `LOCK TABLE`
沒把 `order_cancellation_items` 算進去,而 ④ 第一句要對它取 ACCESS EXCLUSIVE)/ F13(advisory lock
放在迴圈內重複取)/ F16(trigger 類突變只涵蓋五支 `TG_ARGV`,**第 11 支等六支沒有專屬 mutant**)/
F17(`seen` 去重讓 `a7bt_c5_item_not_cancelled` 的三條案例只有第一條被突變)/ F18(plan↔實跑 diff
的 SQLSTATE 欄兩邊是**同一個推導函數**的輸出,不構成獨立第二來源)/ F19(共用 cluster 上
`DROP SCHEMA supabase_migrations CASCADE` 的中止殘留)/ F20(`count_gate` 自述比實際能力大 ——
「刪一條案例 + 加一條無關斷言」淨值不變即可穿過,真正擋住的是 `CASE_N` 與逐列 diff)。

🔴 **我對 F1 的複驗程度(誠實標註)**:推論鏈四步我逐步驗過(completed 不在 U3 索引內、
3.2c 強制兩筆同值、`shipping_delta` 只受 `after >= 0` 限制、無跨工單運費加總),
且「completed 之後再開一筆」在 T3a 案例 099/100/103 已實跑;
**但「兩筆一起跑出 200」那一格是 Fable 跑出來的,我自己那版捷徑被狀態機擋掉、沒跑成。**

🔴 **紀律偏差要記下來**:R2 送審之後我又動過 migration(只加註解 + 指紋常數)——
違反 `feedback_freeze-artifact-before-adversarial-review`。實質內容未變,但 R2 讀到的不是最終檔。

---

## §7 怎麼跑

```bash
cd /Users/sean_1/pcm-website-v2
rm -rf /tmp/a7bt3b && bash scripts/d1t2-rehearsal.sh provision /tmp/a7bt3b   # 埠寫死 54329
for f in verify negative-state negative-money mutation acl-rollback-lock; do
  bash "scripts/a7bt-$f.sh" run /tmp/a7bt3b
done
```

**目前基準(全綠)**:35 / 118 案例 145 斷言 / 29 案例 45 斷言 / 突變 100 物件 0 死規則 / 32。
🔴 五支都有 `count_gate` 釘死案例數與斷言數 ⇒ **改動時那些常數要一起改**,那正是它要擋的事。

TapPay 探針(需 `.env.tappay-sandbox`,已 gitignore、值不入對話):
`python3 <scratchpad>/tappay_probe.py <stamp>`,身分閘只准 `merchant_id=pcmmoto_CTBC`。
