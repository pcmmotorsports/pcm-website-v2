# A7b-T 交接檔(2026-07-31 起;**2026-08-01 折入 Fable R3 後改寫**)

> **狀態:Fable R3 的 20 條已全部折入,五支 harness 從零 provision 全綠。未 apply、未 push。**
> 🔴 **但這是「R3 已收斂」的快照,不是「審查收斂」的快照** —— R3 的修法本身**還沒有被任何人審過**,
>    而本輪修法新增了兩道錢面守門與一條被推翻的舊結論。**下一步是 R4(換模型換角度),不是 apply。**
> 上游交接檔 = `docs/handoff/2026-07-31-a7b-m-handoff.md`(A7b-M,已 apply 正式站)。
> 規格權威 = `docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md`(v7 + 本輪回寫)。

---

## §1 現在該做什麼(依序)

1. ~~先看 §3 的兩題~~ **已於 2026-08-01 拍板(Q1=A / Q2=A),見 §3。**
2. **R4 對抗審查:換模型、換角度**(`~/.claude/rules/00-work-rules.md` §5:第 3 輪起必須換)。
   R3 是 Fable ⇒ R4 建議 codex `gpt-5.6-sol` xhigh,重點放在**本輪新增的東西**:
   C8 / 3.2d / 隔離級閘 / rollback 的 ③b 分支 / E14 競速那三輪的結論是否站得住。
   🔴 **送審前先凍結版本**(`feedback_freeze-artifact-before-adversarial-review`;上一輪違反過)。
3. R4 收斂後才輪到 Sean 手動 `db push`。**不要自己 apply、不要 push。**
4. TapPay:sandbox 交易 `D202607314b3cIL` 排定 **2026-08-01 18:00(台北)** 請款,
   之後跑 `scratchpad/tappay_probe.py` 的第 ③-⑥ 步驗「多次部分退款」(見 §6)。

---

## §2 本輪(2026-08-01)做了什麼

Fable R3 判 NO-GO,8 must-fix + 12 nit。**逐條折入,每一條都有實跑證據,沒有一條是「看起來對」。**

### 錢面(最重的兩條)

| # | 修法 | 承重證明 |
|---|---|---|
| **F1** | 新增 **C8:跨取消單累計退掉的運費 ≤ `orders.shipping_fee`**(與 C7 同型,`DISTINCT ON` 只取每張取消單的最大世代) | 突變 harness 判 **GREEN** = 拿掉它那筆壞資料就進得去,不是死碼 |
| **F15** | fixture 改跑在**非零運費**上(注入 `shipping_fee = 137`) | 沒有它,C8 的正向側永遠是 `0 = 0`、負測物理上構造不出來 |

🔴 **F15 一改就當場炸出四處「只在運費 = 0 才成立」的假綠**(全部是實跑抓的,不是看出來的):
① 併發測試用 `refund_amount` 當 `unit_price` ⇒ 運費非零後 C2 立刻紅;
② 五處 gen2/gen3 的 payload 寫死 `0,0,0` ⇒ 本該紅在別條的負測全部改紅在 3.2c;
③ T3b-014 的帳本 `refund_amount * 2` 違反帳本自身的 `amount_balances`;
④ `sql_gen2` 的運費欄與前代不符(3.4 要求逐欄相等)。
**這四處在 118 條負測全綠的狀態下存在了整整一輪。**

🔴 **fixture 的 job1 現在刻意把運費整筆退掉**(`after = 0`)⇒ 正向鏈**恰好坐在 C8 的邊界上**
(累計 137 = 實付 137)⇒ C8 若寫成 `>=` 或上界少算一元,**整條正向鏈與 120 條負測前綴會全紅**;
而 C8 的負測只需要再多退**一元**。邊界的兩側都被釘住。

### 新增的兩道守門(**這是本輪的範圍擴張,見 §3**)

| ID | 擋什麼 | 為什麼原本沒有 |
|---|---|---|
| `a7bt_insert_order_payment_not_captured`(3.2d) | 訂單的 `payment_status` 是 `unpaid` / `partiallyPaid` 時不得建退款工單 | **F3**:整片 T 一次都沒讀過 `orders.payment_status`(grep 零命中),靠的是「只有 `confirm_order_payment` 會寫 `rec_trade_id`」這個跨 migration 的**推論** |
| `a7bt_isolation_not_read_committed` | 主從一致函式在非 READ COMMITTED 下拒跑 | **F11**:advisory 鎖的序列化論證**前提是 READ COMMITTED**,而前提從來沒有被守著 |

兩條的突變判定都是 **GREEN**(隔離級那條除外,見 §4 的登記)。

### rollback(F6 / F7 / F10 / F19)

- **F6(最重)**:正式站現況是 **M 已 apply、T 未 apply**,而第 ④ 步第一句刻意不帶 `IF EXISTS`
  ⇒ 42704 ⇒ **連 A7b-M 都退不掉**。新增第 **③b** 步自己判定 T 在不在
  (依據 = `pcm_a7bt_*` 函式支數,**7 或 0 以外一律 abort**,不處理半套狀態);
  判定為「在」時每一句仍不帶 `IF EXISTS`(打錯名字照樣 42704)。
  🔴 **測法是真的**:隔離庫裡先 rollback、再**只重套 A7b-M**,在那個真正的 M-only 狀態下跑整包,
  並斷言 NOTICE `t-applied=NO`(不斷言的話「跑完沒錯」可能是走了另一條路徑)。
- **F7**:第 ⑦ 步是全檔唯一沒有 escape 的一步 ⇒ 補 `-v skip_ledger_count=YES_I_CHECKED`,
  且期望列數改成**動態**(T 已套用 = 2、未套用 = 1)。escape 雙向驗過。
- **F8**:`BEGIN` 移到兩把鑰匙**之前** —— 正式站走 Supavisor transaction pooling,
  交易外的每個 statement 可能落在不同 backend ⇒ 「驗過的那條連線」不保證是「跑 DROP 的那條」。
- **F10**:第 ③ 步的 `LOCK TABLE` 補上 `order_cancellation_items`(第 ④ 步要對它取 ACCESS EXCLUSIVE)。
- **F19**:第 2 段自己種的 `supabase_migrations` schema 殘留會被 `CREATE DATABASE … TEMPLATE` 複製過去
  ⇒ 第 3 段開頭加一道「它必須不存在」的斷言。

### E14 ↔ gen2 競速(codex R2 的 must-fix,交接檔舊 §5-1)

新增 §9b 三輪,**含兩輪就地反事實**(md5 前後比對證明突變真的套上了):

| 輪 | 拿掉什麼 | B 的結果 | 孤兒 |
|---|---|---|---|
| ① | 什麼都不拿 | 紅在 `a7bt_e14_successor_exists` | 無 |
| ② | **只拿掉 E14 那把 `order_cancellations … FOR UPDATE`** | **一模一樣** | 無 |
| ③ | 連 INSERT 側「鎖最大世代列」的 `FOR UPDATE` 也拿掉 | **成功** | **真的產生** |

🔴🔴 **② 推翻了 migration 自己的註解**:承重的是 **INSERT 側那把鎖**(它鎖的正是 gen(N) 那一列,
而 E14 的 UPDATE 目標也是同一列 ⇒ B 在取自己的列鎖時就被擋住)。
E14 那把 cancellation 列鎖**不是死碼**,但**不得再被記成這條競速的防護**。註解已就地更正。

---

## §3 ✅ 兩題已拍板(2026-08-01,Sean 逐字「依照建議」)

- **Q1 = A**:3.2d 只擋 `payment_status ∈ {unpaid, partiallyPaid}`,**`refunded` 放行**。
  理由 = 「全額退完之後還能不能再開工單」取決於第 3 批 worker 何時把狀態翻成 refunded
  (拆兩筆的全額退款,第一筆完成時就可能已經是 refunded)⇒ 現在擋等於拿沒寫的程式當前提。
  🔴 **第 3 批 worker 片開工時要回頭決定 `refunded` 要不要收緊** —— 這是本拍板的明文連動,不是「已經解決」。
- **Q2 = A**:本輪新增的兩道守門(3.2d、`a7bt_isolation_not_read_committed`)**保留**,
  雖然超出 07-31 拍板的「四條錢面守門全關」。

---

## §4 未關項(**逐條登記,不是「沒事了」**)

| # | 事項 | 嚴重度 |
|---|---|---|
| 1 | 🔴 **新發現(本輪實驗副產品)**:E14 路徑的取鎖順序與 INSERT 路徑**相反** —— UPDATE 自己先鎖 `order_refund_jobs` 那一列,trigger 才鎖 `order_cancellations`;INSERT 則是先 cancellations 後 jobs ⇒ **理論上存在互鎖窗**。後果是 PostgreSQL 中止其中一方(錯誤訊息,**不是錢的錯誤**)⇒ 不擋本片,但第 3 批之前要決定 E14 要不要改成先鎖 cancellations。**未測** | 建議 |
| 2 | `a7bt_isolation_not_read_committed` **沒有承重證明**:它的負測必須自己開 `BEGIN ISOLATION LEVEL REPEATABLE READ`(case_red 的外殼下會回 25001)⇒ 走自訂外殼 ⇒ 不在 §7.2 矩陣裡 ⇒ 突變 harness 看不到它 | 登記 |
| 3 | **trigger 綁定沒有專屬 mutant**(F16):突變只涵蓋走 `TG_ARGV` 的五支;「`DROP TRIGGER` 解綁」這個形狀本檔測不到(含第 11 支) | 登記 |
| 4 | **同一 ID 多條負測只突變第一條**(F17):`a7bt_c5_item_not_cancelled` 有三條案例、只有第一條進過突變 | 登記 |
| 5 | **plan↔實跑的 SQLSTATE 欄不是獨立第二來源**(F18):兩邊同源(plan 的列就是從 matrix.tsv 產生的)。真正有判別力的是 `expect_red` 把**資料庫實際回的** SQLSTATE 與推導值比對 | 登記 |
| 6 | **`count_gate` 的能力小於自述**(F20):只動斷言時「刪一條 + 加一條無關的」淨值不變可穿過;真正擋案例被刪的是 `CASE_N` 與逐列 diff | 登記 |
| 7 | 第 11 支 trigger 會拿**當下**資料重驗**歷史 completed 工單**(F14)⇒ 日後合法改動 `order_items.quantity` 會讓新的取消動作紅在早已結清的退款單上。**刻意接受**(方向 fail-closed),撞上時走 break-glass | 已登記 |
| 8 | 已付款訂單中 **2 筆 `tappay_rec_trade_id` 為 NULL** ⇒ 綁定守門讓它們走不了自動退款(fail-closed 正確,但 Sean 要知道那兩張只能人工 Portal) | 營運 |
| 9 | `order_cancellation_items` 上第 11 支 trigger 的 ACL / owner 面沒有單獨驗收(它掛在別片的表上) | 建議 |

✅ **F2 已拍板(2026-08-01,Sean)**:「同一張訂單同時只能有一筆在途退款工單」**可接受**。
營運規則定為 **部分退款隔日、全額退款當日**。
🔴 事實補註(規則比實測更保守,是刻意的簡化,**不要日後拿實測去「放寬」它**):中信實際是
「18:00 前授權欲請款 → 18:00 送批 → 20:00 可確認」⇒ 早上下單其實當天 20:00 就能部分退。
⇒ **連動(第 3 批 worker 片)**:部分退款的工單不得走「5→10→20→40→80 分鐘、2 小時 35 分放棄」
那條重試曲線;`10024 Authorized transaction cannot be partially refunded` 必須被認成
「**還不能做**」而非「失敗」。

---

## §5 🔴 這條線踩過的坑(不要重蹈)

1. **寫不出「只讓它單獨轉紅」的負測 ⇒ 先懷疑那條守門是 no-op**(C7 第一版就是被 C6 嚴格蘊含的空氣)。
2. **越寬的守門排越後面**,否則會把窄守門的負測整個蓋掉。
3. **送對抗審查前先凍結版本**(上一輪違反過)。
4. 🆕 **fixture 的每一個「碰巧成立」都會變成假綠**:運費 = 0 讓四處錯誤活了一整輪;
   `payment_status = unpaid` 讓一整片守門從來不存在也沒人發現。
   ⇒ **fixture 的每一個欄位值都要問一次「這個值是不是讓某條守門變成恆真」**。
5. 🆕 **psql 變數在 dollar-quoted 區塊裡不會被展開**(`a7bt-rollback.sql:33` 早就寫過,我又踩一次)。
   救我的是「突變必須證明自己套上了」那道 md5 前後比對 —— 沒有它,那次失配會變成
   「拿掉鎖也全綠」的假結論。
6. 🆕 **反事實的期望值也可能是錯的**:我以為拿掉 E14 那把鎖 B 就會成功,實測不會。
   ⇒ 反事實跑出「不如預期」時,**先懷疑自己的歸因,不是懷疑程式**。
7. 🆕 **`d1t2-rehearsal.sh provision` 不會自己停掉佔著 54329 的舊 cluster**
   (只有 `a7bt-*.sh` 的 `all` 模式會)⇒ 手動 provision 前要先確認埠是空的,否則
   `rm -rf` 會刪掉還活著的 pgdata、然後 `pg_ctl start` 死在 `Address already in use`。

---

## §6 TapPay 實測結果(sandbox `pcmmoto_CTBC`,真的打了 API)

| 問題 | 答案 | 證據 |
|---|---|---|
| 刷 N 元能只退一部分嗎? | **未請款時不行** | `status=10024 Authorized transaction cannot be partially refunded`(連退 3/2/1/1 四次全擋) |
| 全額退款要不要先請款? | **不用,即時生效** | `status=0`、`refunded_amount=6`、`amount` 歸 0、`record_status=3` |
| 「當日請款」是即時的嗎? | **不是,是排程** | Cap Today API 回 `cap_millis` = 隔天 18:00;`is_captured` 仍 false |
| 退 3000 後能再退 2000 嗎? | **還沒測到** | 需要一筆已請款的交易;`D202607314b3cIL` 排在 2026-08-01 18:00 |

🔴 **待查證的矛盾**:repo 的 `docs/reference/tappay-reference.md` 寫「退款隔日才真正生效」,
官方銀行表對中信寫「呼叫 Refund API 後即呼叫銀行退款、銀行當下回應」。**兩邊打架,未定案。**

探針:`python3 <scratchpad>/tappay_probe.py <stamp>`,身分閘只准 `merchant_id=pcmmoto_CTBC`;
金鑰在 `.env.tappay-sandbox`(已 gitignore,**值不入對話**)。

---

## §7 審查輪次

| 輪 | 模型 | 結果 |
|---|---|---|
| K2 R1 | codex `gpt-5.6-sol` xhigh | **NO-GO**,28 must-fix + 3 nit。最重 = 退款可超過取消量 |
| K2 R2 | codex `gpt-5.6-sol` xhigh | **NO-GO**,22 must-fix + 12 nit。最重 = 推翻「不需累計」+ rollback 身分閘沒有 `ON_ERROR_STOP` |
| R3 | **Fable**(換模型換角度) | **NO-GO**,8 must-fix + 12 nit。最重 = **運費退兩次**、rollback 在正式站狀態下跑不動 |
| **R4** | **待跑(建議 codex xhigh)** | 重點 = 本輪新增的 C8 / 3.2d / 隔離級閘 / rollback ③b / E14 三輪的結論 |

---

## §8 怎麼跑

```bash
cd /Users/sean_1/pcm-website-v2
lsof -nP -iTCP:54329 -sTCP:LISTEN   # 必須是空的,不空先停掉那個 postmaster
rm -rf /tmp/a7bt3b && bash scripts/d1t2-rehearsal.sh provision /tmp/a7bt3b
for f in verify negative-state negative-money mutation acl-rollback-lock; do
  bash "scripts/a7bt-$f.sh" run /tmp/a7bt3b
done
```

**目前基準(2026-08-01 從零 provision 實跑,全綠)**:

| harness | 結果 |
|---|---|
| T2 `verify` | 35 斷言 / 0 FAIL |
| T3a `negative-state` | **120 案例 / 163 斷言** / 0 FAIL |
| T3b `negative-money` | 29 案例 / 45 斷言 / 0 FAIL |
| T4-1 `mutation` | 突變 **102** 物件(T1 守門 92 + A7b-M 10):乾淨轉綠 **57** / 被第二層接住 45 / **死規則 0**;23 斷言 |
| T4-2 `acl-rollback-lock` | 35 斷言 / 0 FAIL |

🔴 五支都有 `count_gate` 釘死案例數與斷言數 ⇒ **改動時那些常數要一起改**,那正是它要擋的事。
🔴 `a7bt-mutation.sh` 另外釘死六個分布常數 + plan §7.2 矩陣逐列 diff ⇒ 加一條負測要改三處。
🔴 改 migration 之後 **§9.4 的函式指紋常數會變**:直接 provision 一次,錯誤訊息會印出實際值。
