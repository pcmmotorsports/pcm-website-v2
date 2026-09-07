# plan · ⟦b4-PARTPAIDNOCANCEL1⟧ 收了訂金的匯款單會變成不能取消

> 2026-09-08 · 線【帳號】`account` · 分支 `agent/line-account-cardcancel`
> 🔴 **鐵則 8**(動 migration)+ **鐵則 12①③**(錢 · schema/DB 寫入)⇒ **本 plan 要主視窗 A 批, 批完才寫碼;commit 前 codex 對抗審查必跑;不 push。**
> 座標:`origin/dev` = `0a530379f`(當場跑 `git rev-parse --short HEAD`)

---

## 1. 要改什麼(一句話)

`admin_cancel_order` 的付款守門把 **`partiallyPaid`** 當成「不准取消」。
把它加進允許集,**與 `paid` 完全同條件**(有收款列 + 沒有 card 收款列)。

---

## 2. 為什麼(證據鏈,每一格可重跑)

### 2.1 缺陷是真的,而且是【上線會製造出來的】不是現存的

**製造者** — `supabase/migrations/20260905060000_m4b_stuck_bank_orders_health.sql:4` 逐字:
> 「`20260904230000` 讓收到錢的匯款單自己翻成 paid / partiallyPaid」

**擋下它的閘** — `admin_cancel_order` 最新一代 `20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql`:

```
:421-426  IF (v_order.payment_status <> 'unpaid'::public.payment_status
:422           AND NOT (v_order.payment_status = 'paid'::public.payment_status
:423                    AND EXISTS (SELECT 1 FROM public.order_payments op WHERE op.order_id = p_order_id)
:424                    AND NOT EXISTS (SELECT 1 FROM public.order_payments op
:425                                     WHERE op.order_id = p_order_id AND op.rail = 'card')))
:426     OR EXISTS (... payment_charge_attempts ...) THEN  RAISE EXCEPTION
```

⇒ 允許集 = `unpaid` ∪ (`paid` ∧ 有收款列 ∧ 無 card 收款列)
⇒ **`partiallyPaid` 落在集合外 ⇒ RAISE EXCEPTION。**

**`partiallyPaid` 確實在值域內** — `20260604120000_m3_s2a_orders_order_items.sql:50` 逐字
`CREATE TYPE payment_status AS ENUM ('unpaid', 'paid', 'partiallyPaid', 'refunded')`。
⚠️ **我一度以為它不存在** —— 因為 `latest-definition-of.sh` 只印最後一代(`20260725130000` 那支 ALTER 加的是 `partiallyRefunded`)。
📌 **一支「印最新一代」的工具, 對【原始 CREATE 裡就有的值】結構性失明。** 訂正靠開檔,不靠工具。

**行為已被實測** — 板列 `:1189` 引 `bash scripts/cancel-gate-probe.sh <workdir>`:
CTZZ27(`partiallyPaid` + 匯款收款列)⇒ **擋下**;🟢 正對照 CTZZ26(`card`)⇒ **也擋下** ⇒ 尺會動。
⚠️ **那是 `-0e` 的量測, 我沒有複跑** —— 複跑卡在拋棄式 PG 從零 replay 斷在
`20260712180000…:128`(斷點單獨成檔 `~/pcm-mailbox/斷點-拋棄式PG從零replay斷在20260712180000-20260907.md`, 是 `-db` 的地盤)。
🛑 **⇒ 這一格是【複驗不了】不是【未複驗】, 而它是本 plan 最大的證據缺口。** 見 §6。

### 2.2 為什麼「不能取消」是缺陷而不是保護

客人匯了訂金(短匯)⇒ 單翻 `partiallyPaid`。
此時要退他訂金並關單 ⇒ 後台**按不下取消**,而錯誤訊息是通用的(`v_generic_msg`)⇒ 值班的人看不出原因。
🔴 對照:`expire_unpaid_orders` 用**正向**過濾 `WHERE o.payment_status = 'unpaid'`(`20260906600000:198`)
⇒ 逾期 cron **跳過**這種單 ⇒ 📌 **它既不會被自動取消, 也不能被手動取消 —— 兩條路都關著。**

---

## 3. 影響面(分母怎麼來的)

### 3.1 要改的:**1 支函式, 3 處述詞**(碼裡自己寫著必須一起改)

`20260903093000_…:321-323` 逐字:
> 「三處述詞(步7 / 本處 / audit 快照)**必須一起改**」
> 「這裡不同步改的話:現金單第一次取消得了,而重送同一顆冪等鍵會在這裡被擋 ⇒ 外觀是『隨機失敗』」

```
① :324-329  冪等路徑 ⑤ payment 允許集合
② :421-426  主路徑 步7 付款守門
③ :360      audit 快照值域  v_audit.before->>'payment_status' NOT IN ('unpaid', 'paid')
```
🔴 **③ 不改的話**:一張 `partiallyPaid` 單取消成功後,**用同一顆冪等鍵重送會炸** —— 因為快照裡記的是 `partiallyPaid`,而值域只認兩個值。

### 3.2 **不**要改的:另外 6 支帶同款述詞的函式

🔬 數法(可重跑):
```
grep -rln "payment_status <> 'unpaid'::public.payment_status" supabase/migrations/ | wc -l   ⇒ 21 支檔
```
🛑 **而 21 是【檔】不是【函式】** —— `CREATE OR REPLACE` 讓同一支函式有很多代。
用「每個述詞出現點往上找最近的 `CREATE FUNCTION`」歸屬之後 ⇒ **7 支函式**,
逐支對 `bash scripts/latest-definition-of.sh <名>` 的 `newest` ⇒ **7 支的最新代都還帶著它**:

| 函式 | newest | 本 plan 動不動 | 理由 |
|---|---|---|---|
| `admin_cancel_order` | 20260903093000 | ✅ **改** | 本列標的 |
| `begin_charge_attempt` | 20260904050000 | ⛔ 不動 | 「別對已收錢的單再開刷卡」——排除 `partiallyPaid` 是對的 |
| `confirm_order_payment` | 20260906700000 | ⛔ 不動 | `20260906700000:602` 逐字「refunded / partiallyPaid → 拒(同 rec 也不復活成 paid)」= 刻意 |
| `coupon_redeem_on_paid` | 20260901030000 | ⛔ 不動 | 券核銷,非取消路徑 |
| `get_stuck_bank_orders_health` | 20260905060000 | ⛔ 不動 | 唯讀健康檢查 |
| `settle_zero_total_order` | 20260901030000 | ⛔ 不動 | 零元單結算 |
| `supersede_charge_attempt_for_user` | 20260810010000 | ⛔ 不動 | attempt 汰換 |

### 3.2a 🔴 那張表**不再是讀語意判的了** —— 而讓它變機械的過程中, 主視窗 A 的機制被證偽

**A 2026-09-08 給的判法**:同一個字面在兩種位置有相反極性 ⇒ `admin_cancel_order` 是【擋】、其他 6 支多半是【要求】;
而 `partiallyPaid` 本來就不是 `unpaid` ⇒ 它在【要求】那一側早就通過了 ⇒ 那 6 支不用改。
A 自己標了「**我這段推論本身也是讀名字推的,我沒開那 6 支檔**」。

🔴🔴 **我開了那 6 支檔。極性那把尺【9 格裡 8 格是「擋」】—— A 的機制不成立。**

| 函式 | 極性(實查) | A 預測 |
|---|---|---|
| `begin_charge_attempt` `:105` | **擋** `RETURN 'not_unpaid'` | 要求 ❌ |
| `confirm_order_payment` `:603` | **擋** `RAISE EXCEPTION` | 要求 ❌ |
| `coupon_redeem_on_paid` `:399` | **擋** `RETURN NULL` | 要求 ❌ |
| `settle_zero_total_order` `:890` | **擋** `RAISE …只有 unpaid 能被結清` | 要求 ❌ |
| `supersede_charge_attempt_for_user` `:218` `:251` | **擋** ×2 `RETURN false` | 要求 ❌ |
| `get_stuck_bank_orders_health` `:140` `:157` `:159` | **要求**(`WHERE`/`FILTER`) | 要求 ✅ |

🎯 **⇒ 照 A 自己的規則(「出現任何一處是擋 ⇒ 回來找我, 那支要一起改」), 我要回報【5 支都要改】——
而那個結論是錯的。** 📌 **一把錯的尺, 照著它走會走到一個具體、可執行、而錯的動作。**

✅ **真正的判別式不是極性, 是【那道述詞裡有沒有一個放行「已收錢」狀態的逃生口】**:

```
admin_cancel_order  :  IF ps <> 'unpaid' AND NOT (ps = 'paid' AND 有收款列 AND 無 card 收款列) THEN RAISE
                       ⇒ 有逃生口。paid 進得去, 而 partiallyPaid 進不去 —— 兩個都是「已收錢」
                       ⇒ 📌 那是【不一致】, 所以是缺陷
其他 6 支          :  IF ps <> 'unpaid' THEN 擋        ← 光禿禿, 沒有逃生口
                       ⇒ 「只有 unpaid」就是規則的全部;paid / partiallyPaid / refunded 一起擋
                       ⇒ 📌 那是【一致】, 所以不是缺陷
```

🔬 **機械查法(可重跑, 剝註解後在述詞後 8 行內找 `'paid'` 字面)**:
```
函式                        極性   有 paid 逃生口   本 plan
admin_cancel_order          擋     有              ✅ 改
admin_cancel_order(冪等)    擋     有              ✅ 改
begin_charge_attempt        擋     無              ⛔ 不改
confirm_order_payment       擋     無              ⛔ 不改
coupon_redeem_on_paid       擋     無              ⛔ 不改
settle_zero_total_order     擋     無              ⛔ 不改
supersede_attempt A / B     擋     無              ⛔ 不改
stuck_bank_health           要求   無              ⛔ 不改
⚪ 負對照:同一把尺問該檔檔頭 8 行 ⇒ 無 ⇒ 尺不是對什麼都回「有」
```
⇒ **逃生口那一欄乾淨地分開 2 : 7,而極性那一欄分不開(8 : 1 且方向相反)。**

🔵 **獨立佐證(不靠我的尺)**:`confirm_order_payment` 那支自己在 `20260906700000:602` 逐字寫著
「refunded / partiallyPaid(非 unpaid)→ 拒(同 rec 也不復活成 paid)」⇒ **排除是刻意的, 碼自己講的。**

🛑 **⇒ Q-plan-2 的答案仍是甲(只動 `admin_cancel_order`), 而【理由換了】。**
📌 **A 的結論對而機制錯** —— 而如果我照那個機制機械地執行, 我會去改 5 支不該改的函式。
🎯 **這一格要留著**:一個對的結論配一個錯的理由, 下一次那個理由會被套到別的地方, 而那次結論不會剛好也對。

### 3.3 另外兩支取消寫入端:**不受影響**(已開檔核)
- `expire_unpaid_orders`(newest `20260906600000`)⇒ 正向 `= 'unpaid'`(`:198`)⇒ 跳過,不炸
- `admin_mark_order_cancelled`(newest `20260903093000:604`)⇒ 它的閘是 `payment_status IS DISTINCT FROM 'refunded'`(`:734`)= 另一條語意(已退款才准標取消)⇒ 不動

---

## 4. 修法(最短 diff)

新開一支 migration,`CREATE OR REPLACE` 整支 `admin_cancel_order`,**從 `20260903093000:90` 抄簽章**
(⚠️ 不從第一代抄 —— `latest-definition-of.sh` 明示 newest = `20260903093000`)。

三處各改一個 enum 值:

```sql
-- ① :324-329 與 ② :421-426 同款(兩處逐字相同, 一起改)
IF (v_order.payment_status <> 'unpaid'::public.payment_status
     AND NOT (v_order.payment_status IN ('paid'::public.payment_status,
                                         'partiallyPaid'::public.payment_status)   -- ← 只有這一行變
              AND EXISTS (SELECT 1 FROM public.order_payments op
                           WHERE op.order_id = p_order_id)
              AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                               WHERE op.order_id = p_order_id AND op.rail = 'card')))
   OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
               WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
  RAISE EXCEPTION '%', v_generic_msg;
END IF;

-- ③ :360 audit 快照值域
OR v_audit.before->>'payment_status' NOT IN ('unpaid', 'paid', 'partiallyPaid')   -- ← 加一個值
```

🔴 **`rail = 'card'` 那一格一個字不動** ⇒ 刷卡單照樣被擋。
🔴 **`payment_charge_attempts` 那一半一個字不動** ⇒ `20260809160000` L3a COMMENT 的跨檔不變式
「cancelled ⇒ 無 active attempt」不受影響(碼裡 `:419` 自己寫著這句)。
🔴 **刻意不加 `SUM(amount) > 0`** —— 沿用碼裡 `:416-418` 的既有理由:那道條件在並行下會翻面(codex 關卡1 R2 的 E-1)。

---

## 5. 驗收(每條可 yes/no)

| # | 條件 | 怎麼驗 |
|---|---|---|
| 1 | `partiallyPaid` + 匯款收款列 ⇒ **准取消** | `cancel-gate-probe.sh` 新增世界 CTZZ28(現有到 CTZZ27) |
| 2 | 🟢 正對照:CTZZ26(`card`)⇒ **仍被擋** | 同一發 —— 證明我沒有把閘整個拆掉 |
| 3 | 🟢 正對照:`partiallyPaid` + **有 card 收款列** ⇒ **仍被擋** | 新增世界 CTZZ29 |
| 4 | 🟢 正對照:`partiallyPaid` + **非終態 attempt** ⇒ **仍被擋** | 新增世界 CTZZ30 |
| 5 | 冪等重送:同一顆冪等鍵對 `partiallyPaid` 單重送 ⇒ **冪等成功, 不炸** | 這一格單獨驗 §3.1 的 ③ |
| 6 | 突變:只改 ①②**不改** ③ ⇒ 第 5 格**必須紅** | 證明 ③ 不是多餘的 |
| 7 | 三綠 | `TURBO_FORCE=1 pnpm typecheck` / `lint`;動 `.sql` ⇒ 另有語法守門 |
| 8 | 測試:跑到我動的東西 | 14 支測試檔含 `partiallyPaid`(數法見下)⇒ **連跑兩發, 比四個數**:`Test Files` / `Tests` / 紅的格數 / **我餵幾條 vs 它跑幾支** |

🔬 第 8 格的分母數法:
```
grep -rln "partiallyPaid" --include='*.test.ts' packages/ apps/ | wc -l          ⇒ 14
🟢 正對照 grep -rln "describe" --include='*.test.ts' packages/ | wc -l           ⇒ 138
⚪ 負對照 grep -rln "zzqNoSuchToken20260908" --include='*.test.ts' packages/ apps/ | wc -l ⇒ 0
```
⚠️ **`--include` 一定要加引號** —— 不加的話 zsh 把它當 glob 吃掉,命令**根本不會跑**而印 0。
📌 我寫這份 plan 時**真的踩了一次**,那個 0 看起來與「查無」一模一樣。

---

## 6. 🛑 我證不到什麼(不放寬)

1. 🔴🔴 **CTZZ27 那一發是 `-0e` 的量測, 我沒有複跑。** 卡在拋棄式 PG 從零 replay 的工具層斷點(§2.1)。
   ⇒ **本 plan 的「缺陷存在」這一句, 我是【讀碼推的】+【引別人的量測】, 不是我自己量到的。**
   ⇒ 出路二選一(**要 A 判**):
   - **甲** = 先等 `-db` 修掉那個 replay 斷點,我複跑 CTZZ27 再動碼
   - **乙** = 我不等,照讀碼結果寫碼,而**驗收第 1-6 格全部改成在 review 時由 codex 逐條核述詞**(不跑真 DB)
   🔵 **我推薦乙**,理由:述詞是**純字面**(一個 enum 值在不在 IN 清單裡),讀碼的判別力對它夠強;
   而 CTZZ27 要證的是「閘會擋」,那件事**碼上直接看得出來**。⚠️ 而乙的代價要明寫:**沒有任何一發真的跑過那條路。**
2. **我沒有查那三處述詞在正式庫上是不是這一版。** `latest-definition-of.sh` 的 `live` 欄來自帳本 `APPLIED.tsv`,
   而帳本檔頭逐字「不在本表上什麼都不代表」。要問正式庫 ⇒ `~/pcm-mailbox/0905查證/run.sh`(唯讀),而**那是另一個授權**。
3. **§3.2 那張「不動」表是讀語意判的, 不是量的**(已在該節標)。
4. **我沒有量「今天正式庫有幾張 `partiallyPaid` 的單」** ⇒ 本修法的**觸發頻率未知**。
   🔵 而板上已知正式庫只有 4 張單 ⇒ 很可能是 0 ⇒ 📌 **這是【上線會製造出來的】缺陷, 修它是為了上線那天, 不是為了今天。**

---

## 7. Rollback

`CREATE OR REPLACE` 整支函式 ⇒ 回滾 = **再 `CREATE OR REPLACE` 一次, 貼回 `20260903093000:90` 那一版**(逐字)。
🔴🔴 **資料不回滾:期間真的被取消的單, 那筆取消與它開的待退款列【會留著】。**
✅ **主視窗 A 2026-09-08 拍甲(可接受), 理由逐字**:
> 「**那些單是真的被取消了** —— 回滾它等於抹掉真實發生過的事,比留著糟。」
🛑 **而這句話一定要在 rollback 那一節裡, 不能只寫在別處** —— A 的理由逐字:
> 「沒有那句話的話,下一個做 rollback 的人會**假設回滾後是乾淨狀態**,然後在髒資料上重跑。」
🔵 待退款列本來就是該有的東西(`⟦b4-NCPCRONRACE⟧` 那張網),不是本片製造的垃圾。

---

## 8. 我要 A 批的三件

```
Q-plan-1: §6-1 的證據缺口(CTZZ27 我複跑不了)怎麼走?
A: 甲 = 等 -db 修 replay 斷點, 我複跑再動碼    乙 = 不等, 照讀碼寫, codex 逐條核述詞(我推薦乙)

Q-plan-2: §3.2 那 6 支「不動」的函式, 你同意嗎?
A: 甲 = 同意, 只動 admin_cancel_order          乙 = 有一支你覺得要動(講哪一支)

Q-plan-3: §7 rollback 不回滾資料那一句, 我判「可接受」。
A: 甲 = 可接受                                  乙 = 不行, 要寫資料回滾步驟
```

### ✅ A 2026-09-08 已全部答完
- **Q-plan-1 = 乙**(不等 replay 斷點, 照讀碼寫碼)。三個條件:①六格驗收【跑得動的照跑】, 跑不動的**逐格列在 commit body 寫明「未跑」**(🛑 不准寫「已驗證」然後在別處註明)②codex 那一發**指名**攻述詞清單:三處是不是真的只有三處 ③CTZZ27 一律標【`-0e` 量的, 我沒複跑】
- **Q-plan-2 = 甲**(只動 `admin_cancel_order`)—— 🔴 **而 A 給的機制被我證偽, 見 §3.2a;結論不變, 理由換了。**
- **Q-plan-3 = 甲**(可接受)—— 條件已落進 §7。
- 🔵 **replay 斷點 A 接走去派 `-db`**;修好後**我回頭補跑 CTZZ27**, 無論紅綠都回報 —— 🔴 **不因為已 commit 就不補跑。**
