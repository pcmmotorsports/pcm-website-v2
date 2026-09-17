# plan:退款上限用「已收」算,不要用「訂單原總額」算

> 起因:窗 A 做 B5 時挖到「`pcm_order_refundable_remaining` 不看取消」,主視窗獨立核過並派給窗 B 寫 plan。
> 寫的人:窗 B(後台,worktree `pcm-ops`,branch `agent/ops-17-receipt`),2026-09-17。
> 🔴 本檔所有數字都是**今天對正式庫唯讀實查**(`scripts/readonly-prod-sql.sh`),不是抄 repo、不是抄別人的回報。
> 碰錢 ⇒ 鐵則 12。**plan 階段沒有 diff,不用審**;真的寫 migration 之前要 codex / adversarial 審一輪。
> 🛑 **本檔不含 migration 檔,也沒有動任何碼。**
>
> ## 🟢 2026-09-17 Sean 已答(§10 那兩題,兩題都甲)
> - **Q1 換成哪個量 ⇒ 甲:改用「已收」(`order_paid_totals_v`)。** 方向批了。
> - **Q2 什麼時候做 ⇒ 甲:排進下一批,不是現在。**
> ⇒ 🛑 **「批了方向」不等於「現在動工」** —— 甲的內容逐字就是「排下一批」⇒ **現在仍然不寫 migration 檔**。
> ⇒ 真的要動工的人:§6 的改法與 §9 的驗法直接照做,**那兩題不用再問一次**;
>   還沒答的只剩板號(要 Sean 逐字說「貼 <編號>」,主視窗貼,窗 B 不自己貼),
>   而動工那一發要先過鐵則 12(碰錢)。

---

## 1. 一句話

退款上限現在是「**訂單原本要收多少**」減掉已退,而它應該是「**我們實際收到多少**」減掉已退。
⇒ 今天有 6 張**客人一毛錢都沒付**的取消單,系統仍然允許登記最高 13,800 元的退款。

---

## 2. 🔴 先把兩件事分開(它們不是同一件事)

| | 量到了什麼 | 結論 |
|---|---|---|
| **定義上的洞** | `pcm_order_refundable_remaining` 的本體裡**沒有**「已收」也沒有「取消」這兩項 | ✅ **成立**(實查函式定義) |
| **真的有人退超過嗎** | 全庫逐筆比對「已退 vs 已收」 | ✅ **0 筆**(沒有出事) |

**⇒ 沒有人退超過。這不是事故,是一道現在擋不住的閘。** 這兩句不要合併成「正在超退」。

實測數字(全庫 10 張單,網站 09-15 才上線):

```
退超過【已收】的單   0 張
退超過【原總額】的單 0 張
有退過款的單         4 張 / 全部 10 張
```

---

## 3. 現在的算法(正式庫實查的定義,不是 repo)

```
pcm_order_refundable_remaining(p_order_id)  -- LANGUAGE sql, STABLE, SECURITY DEFINER, SET search_path TO ''
  = o.total                                              ← 🔴 訂單【原本】的總額
  − SUM(order_refunds 裡 status in (processing, confirmed))
  − SUM(order_refunds 裡 failed + manual_failed 而被更正成 money_moved)
  − SUM(order_manual_refunds 裡 voided_at IS NULL)
  FROM orders o WHERE o.id = p_order_id
```

🔵 **窗 A 說「這條對所有單成立」—— 我自己核過,是真的**:
- 函式本體 `FROM public.orders o WHERE o.id = p_order_id`,**零個** `order_source` / `payment_method` / `rail` 的條件。
- 擋卡片退款那道 trigger `order_refunds_a445b_cap_guard_bi` 是 `BEFORE INSERT ON public.order_refunds FOR EACH ROW`,**沒有 WHEN 子句** ⇒ 每一列都開火。
  🔵 負對照:全庫確實有 4 個 trigger **帶** WHEN ⇒ 「沒有 WHEN」是真的,不是我查不到。
- 手動退款那條路(`admin_record_manual_refund` 步 5)也是無條件呼叫同一支。

⇒ **所有單、兩條退款路,都吃同一個上限。**

**誰在用它**(全庫實查,6 支):
`pcm_order_refund_cap_guard` · `admin_record_manual_refund` · `admin_correct_backfilled_refund` ·
`coupon_revert_on_full_refund` · `pcm_d3d_manual_refund_immutable` · (它自己)

---

## 4. 🔴🔴 根因不是「不看取消」—— 而且「照取消改」會**弄壞現在是好的東西**

窗 A 的描述是「不看取消」。**症狀對,而那個名字會把人帶去一個危險的修法。**

真正的根因:**上限用了「應收」這個量,而退款的天花板是「已收」。**
取消只是**最容易看到它**的地方(沒付款的單最常被取消)。

### 為什麼不能「照取消改」

最直覺的修法是把 `o.total` 換成 `pcm_order_effective_amounts_v.effective_total`(取消會讓它變小)。
**那會擋掉合法的退款**,而且**已經有一筆真實資料可以證明**:

```
全庫那 7 張取消單裡有一張:total=1 · 已收=1 · 已退=1 · 現行 cap=0
⇒ 客人付了錢、單被取消、錢退回去了 —— 整條路都是對的。
⇒ 若改成 effective_total:整單取消 ⇒ effective_total=0 ⇒ cap = 0 − 0 = 0
   ⇒ 那筆【已經發生過而且正確】的退款會被擋下。
```

📌 **判別句:取消讓客人【少欠我們錢】,不是讓我們【少欠客人錢】。**
付了錢又取消的單,我們欠客人的正是那筆錢 —— 而 `effective_total` 會把上限壓成 0。

### 還有一個反方向的好處

用「已收」還**順便修好多收的情形**:客人溢付 1,200 元(訂單 1,000),
- 現行 `o.total` 制 ⇒ 上限 1,000 ⇒ **退不了那多收的 200**。
- 已收制 ⇒ 上限 1,200 ⇒ 退得了。
(對得上 Sean 0916 Q1 甲「應收 = 取消後剩下金額 + 多收待退 + 待退款一行」那個方向。)

---

## 5. 曝險有多大(實查,逐張)

那 7 張取消單:

| total | 已收 | 已退 | 現行 cap | 我們還握著的錢 | 多出來的額度 |
|---|---|---|---|---|---|
| 13,800 | 0 | 0 | **13,800** | 0 | 13,800 |
| 5,400 | 0 | 0 | **5,400** | 0 | 5,400 |
| 1,050 | 0 | 0 | **1,050** | 0 | 1,050 |
| 1,000 | 0 | 0 | **1,000** | 0 | 1,000 |
| 100 | 0 | 0 | **100** | 0 | 100 |
| 10 | 0 | 0 | **10** | 0 | 10 |
| 1 | 1 | 1 | 0 | 0 | 0 ✅ |

```
已取消 7 張:6 張的 cap 高於已收, 多出來的額度合計 21,360 元
未取消 3 張:0 張(三張都付滿了)
```

⚠️ **要按幾下才會真的出事**:員工得在一張沒收過錢的單上,主動去登記一筆退款。
系統不會自己退錢。⇒ **這是一道擋不住的閘,不是一個會自己流血的洞。**

---

## 6. 改什麼

**只改一支函式的第一項,其他三項一個字不動。**

```
- SELECT o.total::bigint
+ SELECT COALESCE((SELECT pt.paid_total FROM public.order_paid_totals_v pt
+                   WHERE pt.order_id = o.id), 0)::bigint
       − (三段已退,原封不動)
    FROM public.orders o WHERE o.id = p_order_id;
```

**為什麼是 `order_paid_totals_v`**:它是**現成的**(`SELECT order_id, COALESCE(sum(amount),0) FROM order_payments GROUP BY order_id`),
而且 `order_payments.amount` 的欄位 COMMENT **逐字**寫著:

> 收款列恆正;沖銷列 = 被沖列金額的反號(可正可負,必帶 `reverses_payment_id`)。⇒ **「已收」= SUM(amount)**。
> 🔴 退款不在本表(照 rail 分流到別的機制);沖銷 ≠ 退款,沖銷是登錄錯誤的更正。

⇒ **不自己再算一次已收**,用那張既有的 view(鐵則:同一個量只有一個來源)。

🔴 **`CREATE OR REPLACE` 會把 `SET` 子句整組換掉** ⇒ 新版**必須原樣寫回** `SET search_path TO ''`,
否則這支 SECURITY DEFINER 會掉回可寫 schema。(memory `reference_create-or-replace-resets-set-clause`)
簽章、回傳型別、`STABLE`、`SECURITY DEFINER` 全部不動。

---

## 7. 影響 / 錯了會怎樣

**白話**:這支函式是「還能退多少」的**唯一**算法。改對了,沒收過錢的單就退不出去;
改錯了,**該退的錢退不出去** —— 客人拿不到退款,而員工只會看到「只剩 0 元可退」。

- **錯的方向會怎樣**:`已收` 算少了 ⇒ 上限太低 ⇒ **誤擋合法退款**。這是本片唯一真正的風險。
- **對的方向**:上限從「原本要收多少」降到「實際收到多少」⇒ 沒付錢的單上限變 0。
- **不受影響**:三段「已退」一個字沒動 ⇒ 已經退過的帳一筆都不會被重算。
- **DB 端呼叫端是 3 支**(不是 6 支,2026-09-17 更正):`pcm_order_refund_cap_guard` ·
  `admin_record_manual_refund` · `admin_correct_backfilled_refund`(用法是
  `IF p_new_amount > v_remaining + v_amount` ⇒ 只比大小、不推導已退 ⇒ 換口徑後仍正確)。
  ⛔ ~~`coupon_revert_on_full_refund` / `pcm_d3d_manual_refund_immutable`~~ **不是呼叫端**:
  前者那 4 行全是註解(逐字還寫著「不要改用它」),後者那一行在 `RAISE` 的訊息字串裡。
  🔴 我第一版用 `prosrc LIKE` 掃出「6 支」而信了它 —— **`prosrc` 含註解**,這個坑本 repo
  記過、我自己也在 migration 註解裡寫過,然後踩了它。

- 🔴🔴 **而真正的漏在另一頭:那份清單只掃了 DB、沒掃 app,而唯一會出事的消費者在 app。**

## 🟢 2026-09-17 已上線(板 210 = `20260917150000`)

- **Sean 拍甲:碼先推、板隨後貼。** 主視窗照做:推 → 立刻貼板 210 → 驗,中間沒停。
- 正式庫實查(我自己跑的,不是抄回報):函式本體 md5 = `a5a57c30196ca1c67215317667b47a36`
  = 我測出來的新版;`order_paid_totals_v` = t、`o.total` = f;`search_path=""` 沒被
  `CREATE OR REPLACE` 吃掉;owner / EXECUTE 權限未變。
  🔵 負對照:同族的 `pcm_order_remaining_receivable` 對同一把尺回 f ⇒ 那個 t 是真的。
- 驗收兩邊都過:**正對照** 6 張已收 0 的取消單上限逐張歸零(21,360 空頭上限收掉);
  **負對照** 4 張真的收過錢的單逐張不變(10500 / 1785 / 4 / 1)。
- ⚠️ **那幾分鐘(碼已上、板未貼)的預期現象,不是故障**:未付款單「已退」印【未知】,
  而且**「帶入尾款」快填鈕會暫時消失**(條件含 `refundedTotal === 0`,那時它是 null)。

### 🔴 為什麼是「碼先推」—— 順便更正我自己引錯的規則

⛔ ~~本檔原本寫「照 CLAUDE.md〈Git〉第一條:程式要用到的 DB 變更 ⇒ 板先貼」~~ —— **我引錯了。**
那條的**原文**是「本次程式要用到【**還沒套用的**】DB 變更 ⇒ 板先貼」,而配套的部署時序閘
**只擋新函式 / 新 view**(`.rpc(` / `.from(`)。
⇒ **本片沒有任何新物件** —— 碼叫的是同一支既有函式,兩個方向都叫得動,差別只在**答案對不對**。
⇒ 真正命中的是同段那條 🔴「改既有函式兩個方向都有空窗 ⇒ 當成同一次動作、時間壓到最短、事先知會」,
  **而那條沒有指定誰先** ⇒ 所以這一題要 Sean 拍,不是照抄規則就有答案。

而兩個方向的**代價不對稱**(adversarial-reviewer R2 實算四種單):

| 單 | 板先貼(舊碼+新 RPC) | 碼先推(新碼+舊 RPC) |
|---|---|---|
| 未付款 | 印「已退 13,800」**憑空** ❌ | 算出負數 ⇒ 印「未知」✅ |
| 只收訂金 | 印「已退 700」❌ | 印「未知」✅ |
| 付滿 | 正確 | 正確 |
| 溢付 | 正確 | 高估 ❌(而正式庫此刻溢付 **0 筆**) |

📌 **碼先推是 fail-closed 的那一邊,板先貼是印假數字的那一邊。**

### 🔴 還欠一發:09-20 的跨模型複核

本片**從頭到尾只有單一模型審過**(adversarial-reviewer:R1 FAIL → 修 → R2 FAIL → 修)。
codex 額度 2026-09-20 12:12 才回來 ⇒ **要補一發跨模型審**,已排進主視窗 M4。
🛑 在那一發之前,不要把本片讀成「兩個模型都看過了」。

---

**🔴 部署時序:有空窗,板與碼是【同一次動作】**(2026-09-17 更正,adversarial-reviewer R1 抓到):
⛔ ~~「沒有空窗。本片只有 migration,沒有程式碼。」~~ —— **那句是錯的。**
`apps/admin/src/lib/orders/payment-list-view.ts` 的 `refundedTotalFromUnregistered` 是用**相減**
推導「已退」:`已退 = 第一個參數 − 這支 RPC`。四個呼叫端原本一律傳 `orders.total`。
```
舊:RPC = T−R ⇒ T−RPC = R          ✅
新:RPC = P−R ⇒ T−RPC = T−P+R      ❌ 只要已收 ≠ 原總額就錯
```
⇒ 板先貼 ⇒ **舊碼印錯數字**(每一張未付款 / 只收訂金的單都會印「已退 <原總額>」);
  碼先推 ⇒ **新碼配舊 RPC 一樣錯**。
⇒ 📌 這是 CLAUDE.md〈Git〉「改既有函式兩個方向都有空窗」的**同一個形狀,換的是語意不是簽章**。
⇒ **照 CLAUDE.md〈Git〉第一條:本次程式要用到的 DB 變更 ⇒ 板先貼**,那支 migration 與
  `APPLIED.tsv` 那一列要 commit 進要推的那顆,程式才合進 dev。中間時間壓到最短。

**🔴 誤擋的實測檢查(已做)**:把現有**每一筆**退款拿去問「已收制下會不會被擋」:

```
manual voided   10,500  該單已收 10,500  ⇒ 放行
manual active   10,500  該單已收 10,500  ⇒ 放行
manual active    1,785  該單已收  1,785  ⇒ 放行
card confirmed       4  該單已收      4  ⇒ 放行
card confirmed       1  該單已收      1  ⇒ 放行
⇒ 5/5 全部放行, 一筆都不會被誤擋。
```

**⚠️ 這個檢查的射程**:全庫只有 10 張單,而 `payment_status` **只印得出 2 種值**(`unpaid` 6 / `refunded` 4)——
**庫裡沒有任何一張「收了訂金、還沒收完」的單** ⇒ **分期 / 訂金那個情境我沒有真資料可以驗**,只能從定義推。
📌 這句是「吻合但未證實」,不要讀成「已驗」。

**🔵 已收那張表是活的,不是凍的**(這件事承重,所以我去核了):
`order_payments` 上五個 trigger 全是 `tgenabled='O'`(啟用),OP2b 那批已經落地
(`pcm_op2b_reversal_amount` / `pcm_op2b_immutable_columns` / `pcm_op2b_no_delete`);
三種 rail 都寫得進去,最近一筆 2026-09-16(bank_transfer 1,785)。
⚠️ **而 `amount` 的欄位 COMMENT 已經過期** —— 它還寫著「在 OP2b 落地前,本表由 dormant gate 全擋、任何列都寫不進來」,
而 OP2b **已經落地**。🛑 那是別人的檔、碰錢,**本片不動它**,只在這裡記一筆。

---

## 8. Rollback

要附 `<編號>r_<版本號>_還原_災難用.sql`:
用 `CREATE OR REPLACE` 把函式改回 `o.total` 那一版(**連 `SET search_path TO ''` 一起寫回**),
本體逐字取自貼板前 `pg_get_functiondef()` 的輸出 —— migration 的第 2 段會先把它存進 rollback 表。

```
貼板前本體 md5(今天實查, 前置閘要比對):
  pcm_order_refundable_remaining  ⇒ 見 migration 前置閘(寫 migration 當天重抓一次, 不要用本檔的舊值)
```

🔴 **不要用本檔記的 md5 當最終值** —— 從今天到貼板中間它可能被別人動過。
前置閘要比的是**寫 migration 那一刻重抓的值**,而貼板當下閘會自己再比一次。

---

## 9. 貼板怎麼驗(含負對照)

全部在**同一筆交易**裡,任何一條不符就整筆 rollback:

**前置閘**
1. 函式存在、簽章 `(p_order_id uuid)`、回傳 `bigint`、`prosecdef = true`。
2. `md5(prosrc)` 精確等於寫 migration 當天抓的值 ⇒ 中間沒被別人改過。
3. `order_paid_totals_v` 存在且查得出列(不然新版會整支回 0)。

**後置斷言**
4. `SET search_path` 那一項仍然是 `search_path=""` ⇒ 證明 `CREATE OR REPLACE` 沒把它吃掉。
5. **正對照(該變的有變)**:那 6 張「已收 0 的取消單」⇒ `pcm_order_refundable_remaining(id)` **全部 = 0**。
   （貼板前它們是 13,800 / 5,400 / 1,050 / 1,000 / 100 / 10。）
6. **🔵 負對照(不該變的沒變)**:那 3 張**付滿、未取消**的單 ⇒ 回傳值與貼板前**逐張相等**。
   📌 **這一條是承重的** —— 少了它,「全部變 0」也會讓第 5 條過,
   而那正是**誤擋所有退款**的樣子。第 5 條單獨為真**不能**證明改對了。
7. **第二個負對照(尺會動)**:隨便取一張單,把上限跟 `o.total` 比 ——
   至少要有一張**兩者不相等**,否則表示我其實還在讀 `o.total`。

**貼完之後(照 CLAUDE.md M2 的順序,不能反)**
```
正式庫實查(要有負對照) → NOTIFY pgrst 'reload schema'
→ pcm_acl_digest_record() → pcm_acl_approve_latest('…')
```

**🛑 三綠證不到這件事**:本片沒有 .ts/.tsx,typecheck / lint / build 全過跟它對不對**沒有關係**。
真的驗是上面第 5、6、7 條。

---

## 10. 🙋 要 Sean 決定的

```
Q1:退款上限要換成哪個量?
    甲) 已收(order_paid_totals_v)—— 沒付過錢的單上限 0, 付了又取消的單照樣退得掉,
        多收的部分也退得掉。現有 5 筆退款實測 5/5 都不會被誤擋。(推薦)
    乙) 維持現狀(原總額)—— 曝險 21,360 元繼續掛著, 但零改動風險。
    A: 甲 | 乙

Q2:什麼時候做?
    甲) 排下一批 —— 實測 0 筆超退, 而且要員工主動去登記才會出事, 不是會自己流血的洞。(推薦)
    乙) 現在就做 —— 只改一支函式的第一項, 可完整還原。
    A: 甲 | 乙
```

⛔ ~~**Q1 答完之前不寫 migration 檔。**~~ ⇒ 🟢 **2026-09-17 已經寫了**(Sean 逐字「依照推薦」
= Q1 甲改用已收 + 「繼續把待辦排下去」⇒ 排下一批 = 現在那一批):
`supabase/migrations/20260917150000_m4b_refund_cap_uses_paid_not_total.sql` + 同號還原檔,
**外加 TS 那半**(`payment-list-view.ts` 與四個呼叫端)—— 兩半是同一次動作。
⚠️ 版本號原本是 `20260917140000`,而窗A 的 M2 也用了那個號 ⇒ **改成 150000**
(兩支 migration 檔名不同 git 不會叫,但**還原檔會撞成同一個路徑**)。
板要 Sean 逐字說「貼 <編號>」、由主視窗貼,窗 B 不自己貼。
寫 migration 那一發要先過鐵則 12(碰錢)。

---

## 11. 我沒做、也不打算做的

- 不動任何碼(6 支呼叫端只讀回傳值,不用改)。
- 不改 `order_payments.amount` 那段過期的 COMMENT(別人的檔、碰錢,只記一筆)。
- 不碰 `pcm_order_remaining_receivable`(那支**本來就**看取消,是對的,拿它當對照組)。
- 不碰 `order_pending_refunds`(待退款是「我們欠客人多少」,與「上限」是兩本帳,不要合併)。
- 不去查那 9 支 anon/authenticated 可執行的 SECDEF(另一件事,已回報主視窗)。

— END —
