# ⟦b4-NONCARDPAID1⟧ 匯款/現金收款不會翻狀態 ⇒ 那張單隔天被自動取消

> 線【出貨】`-0e` 2026-09-01 19:xx 寫。**Sean 已拍甲(現在就修), 主視窗 `-0a` 裁 (ii) 述詞形狀。**
> 🛑 **本檔是 plan, 不是交件。**未寫任何 migration、未 apply、未 push。

---

## 0. 一句話

**客人匯款、後台登記了收款,而【沒有任何一支函式為匯款翻 `payment_status`】**
⇒ 那張單一直是 `unpaid` ⇒ **逾期 cron 隔天把它取消掉,而錢在我們這裡。**

---

## 1. 機制 —— 逐格量到的,不是推的

### 1-a 寫入端:正式庫上只有 2 支函式會寫 `payment_status`,而兩支都不是匯款那條路

```
psql 唯讀 2026-09-01:
  select proname from pg_proc where prosrc ~* 'set\s+payment_status\s*='
    ⇒ public.confirm_order_payment                   (卡片那條腿)
    ⇒ public.pcm_sync_order_refund_payment_status    (退款同步)
    ⇒ 支數 = 2
🟢 正對照 同一把尺找【讀】payment_status 的函式 ⇒ 29 支(尺會動)
🔴 負對照 現造欄名 ⇒ 0
```

🔴 **而 repo 裡有一句話說「至少五處【不同函式】會 SET payment_status='paid'」——【那句是錯的】。**
它逐字寫在 `20260901020000:183` / `20260901021000:1090` / `20260901030000:1150` 的 `COMMENT ON` 裡,
而它是「為什麼用 trigger 而不是改 `confirm_order_payment`」的理由。

```
我自己量(收窄成【行首就是 SET payment_status =】的碼行, 不吃註解):
  20260611120000:178 / 20260804150000:127 / 20260810160000:448 / 20260810170000:436
    ⇒ 🔴 這四行是【同一支函式 confirm_order_payment 的四代 CREATE OR REPLACE】
  20260901030000:1487 ⇒ public.settle_zero_total_order(而那一支【未 apply】)
⇒ 碼行 5 行, 而函式只有 2 支
```
📌 **⇒ 那個「五」數的是【定義點】不是【函式】,而它讀起來是「五個不同的地方各自會翻單」。**
⇒ ✅ **正確的機制描述更乾淨**:不是「五處都漏了匯款」,是**根本沒有任何一支函式為匯款翻狀態**。
⇒ 🔵 **那讓本列從「有人漏了」變成「這條路從來沒有被接上」。**
⚠️ 那三處 `COMMENT ON` **本片不改**(不是本線的東西、且兩支已 apply ⇒ 要新 migration)。已端給主視窗。

### 1-b 登記收款那支:8 次命中 `payment_status`,**全部是讀**

```
正式庫 pg_get_functiondef(admin_record_manual_payment) ⇒ 261 行
  payment_status 命中 8 次:
    :95  SELECT … o.payment_status            ← 讀進 record
    :118-:122  IF … IN ('refunded','partiallyRefunded') THEN  ← 值域閘
    :127-:129  IF … NOT IN ('unpaid','paid','partiallyPaid') ← fail-closed allowlist
  SET/UPDATE 命中 payment_status ⇒ 🔴 0
🟢 正對照 同一支函式的 INSERT INTO ⇒ 3 處(admin_audit_log ×2 + order_payments ×1)⇒ 它確實會寫東西
```
🔵 **而 `:127` 那道 allowlist 的三個值 = OP6a 的可判定集 P1 ⇒ 兩邊本來就對齊。**

### 1-c 逾期 cron:**卡片那條腿有保護,匯款那條腿沒有** —— 這是不對稱的確切位置

`supabase/migrations/20260828060000_*.sql`,`pcm_cron.expire_unpaid_orders(integer)`:
```sql
WHERE o.payment_status = 'unpaid'::public.payment_status
  AND o.cancelled_at IS NULL
  AND o.created_at < now() - interval '1 day'      -- 1 天 = Sean 2026-08-09 逐字拍的
  AND NOT EXISTS (                                  -- 🔵 卡片那條腿的保護
        SELECT 1 FROM public.payment_charge_attempts a
         WHERE a.order_id = o.id AND a.status <> 'failed')
```
🔴 **匯款/現金那條腿【沒有對應的那一句】。**
📌 **⇒ 所以本片不是「要加一個保護」,是【要補齊一個已經存在的對稱】。**
✅ **⇒ 而那自帶正對照:改完之後兩條腿的形狀要長得一樣。**

### 1-d OP6a 已經算得出來 —— 缺的只是「誰去呼叫它並寫回」

`public.admin_compute_order_settlement(uuid)`(唯讀、STABLE、SECURITY DEFINER)
回 `{gross, refunded, receivable, net, verdict, reasons[], scope}`。

⚠️ **代數要指對**:repo 有 **3 代**(`latest-definition-of.sh`),
`20260811030000`(create)/ `20260812140000`(cor,**正式庫現行**)/ `20260901030000`(cor,**未記**)。
🟢 而兩代的**七條前提逐字相同**(去空白後逐條比,P1-P7 全同);唯一差別在 `ref` CTE 第②面
(`payment_refund_events` ⇒ `payment_refund_effective_terminal`)。

把七條前提套在「匯款已登記」那個形狀上:
```
P1 unpaid 在可判定集內 ✓  P2 無取消 ✓  P3 品項快照 ✓  P4 收款列形狀乾淨 ✓
P5 (rows_n>0 AND uncovered_n=0) ← 匯款有收款列、零卡腿 attempt ⇒ 成立 ✓
P6 四個退款面全空 ✓        P7 金額範圍 ✓
⇒ all_ok=true ⇒ net = gross - total ⇒ settled / underpaid / overpaid 三選一
```

---

## 2. 要做什麼(兩件,而第二件是第一件的兜底)

### 甲:登記收款時順手把狀態翻對

在 `admin_record_manual_payment` 寫完 `order_payments` 之後,呼叫 OP6a 並依 `verdict` 寫回:

| verdict | 處置 | 理由 |
|---|---|---|
| `settled` | ⇒ `paid` | 淨額 = 應收 |
| `underpaid` | ⇒ `partiallyPaid` | 值域裡有這個值 |
| `overpaid` | 🔴 **不翻** | **值域裡沒有對應的值**(實查 `payment_status` = `unpaid / paid / partiallyPaid / refunded / partiallyRefunded`,共 5 個;🟢 正對照 同一把尺 `fulfillment_status` 4 / `member_tier` 3 ⇒ 尺會動;🔴 負對照現造型別名 ⇒ 0)⇒ 開一列,不猜 |
| `needs_human` | 🔴 **不翻** | 它自己宣告算不清 ⇒ 不該由它決定終態 |

🛑🛑 **而「不翻是安全的」這句話【依賴乙】—— 這個依賴要明寫,因為它不寫下來就會被拆掉。**
```
沒有乙的世界:overpaid / needs_human 那兩種單仍然是 unpaid
            ⇒ cron 隔天照樣取消它們 ⇒ 🔴 缺口的形狀與今天【一模一樣】, 只是變窄
有乙的世界  :那兩種單的 sum(amount) > 0 ⇒ cron 不碰 ⇒ 「不翻」才變成一個可以選的選項
```
✅ **⇒ 所以乙不只是兜底,它是【讓甲可以誠實地不處理某些情況】的前提。**(主視窗原話)
🔴 **⇒ 而後果要寫在這裡**:哪天有人拿掉乙那一句(例如覺得它多餘、或改寫述詞時順手簡化),
**這一片會【安靜地】退化回今天的樣子** —— 沒有測試會紅,因為那兩種單本來就不常見。
⇒ 🎯 **所以驗收條件裡那兩條(overpaid / needs_human 的單 cron 不取消)是【乙的證人】, 不是甲的。**

### 乙:逾期 cron 的述詞補上匯款那條腿

```sql
-- 與上面卡片那條腿【對稱】的一句
AND (SELECT coalesce(sum(p.amount), 0)
       FROM public.order_payments p
      WHERE p.order_id = o.id) <= 0
```

🔴 **為什麼是【淨額】不是【有沒有列】**(主視窗抓到的洞):
`order_payments` 有**沖銷列**(`20260810100000:76` 逐字「沖銷列 amount < 0」;`:94`「一正一負互指(-300/+300)⇒ 該單 SUM=0」)
⇒ 一張「收了 300、又沖銷 300」的單**有列而錢是 0** ⇒ 用 `NOT EXISTS` 寫,那種單**永遠不會被取消**,而它本來應該被取消。
📌 **而那個錯的方向是【留下殭屍單】,它比誤取消安靜:沒有客人會來抱怨一張沒被取消的單。**

### 🔴 為什麼判 (ii)(自己寫述詞)而不是 (i)(呼叫 OP6a)

🛑 **判準三條, 而【順序要留著】** —— 我翻過一次(從 (i) 翻到 (ii)),
**而翻的理由是【正確性】不是成本。**否則下一個人會以為這是成本決定的。

```
③ 正確性   🔴🔴 **這一條是決定性的, 而它是我翻案的原因**:
   cron 要接住的只有【甲接不住】的那些 = verdict 是 needs_human / overpaid 的單
   而 needs_human 的意思正是「這張單的帳我算不清」
   ⇒ ⇒ 用一個【自己宣告算不清】的函式的中間值去決定「不要取消」—— 那個組合讀起來就不對
   📌 那不是風格問題, 是【把一個函式的輸出用在它宣告的射程之外】
④ 我要問的問題比 OP6a 窄得多:不是「這張單結清了嗎」, 是【這張單淨收到的錢 > 0 嗎】

① 對稱     卡片那條腿用的是【述詞內的 NOT EXISTS】, 不是函式呼叫  ⇒ (ii) 勝
② 單一來源 (i) 勝 —— 而見下面那道斷言, 它把這一格買回來
⑤ 成本     🔴 **未量。而它【不是決定性的】** —— 判 (ii) 之後那 500 次函式呼叫的成本
          不再影響這個決定;它降級成「將來如果有人想改回 (i), 他要知道代價」的資料點。
          🛑 **不要把它讀成「因為 (i) 太慢所以選 (ii)」** —— 沒有人量過它慢不慢。
```
✅ **而 (i) 的一個未知數已經消掉了**(所以它不是被成本否掉的):
`pcm_cron.expire_unpaid_orders` 與 `admin_compute_order_settlement` **owner 都是 postgres 且 SECDEF**,
而 OP6a 的 EXECUTE 給 `{postgres, service_role}` ⇒ **呼叫得動,不需要新授權**(實查)。

### 🛑 (ii) 的代價,寫出來不藏

**那是第二份 `SUM(amount)`** —— OP6a 的 `pay` CTE 有第一份。兩份會漂:
哪天 `order_payments` 多一種「不算數的列」(例如未來日期的 `received_at`),
OP6a 的 `future_n` 會擋而這一句不會。

✅ **處置兩層**:
1. 述詞旁寫錨,指名 OP6a 的 `pay` CTE 是同源、動一邊要動兩邊
2. 🔴 **而寫在碼旁的錨不是機制** ⇒ migration 自帶一道斷言:在 fixture 上驗
   「這一句的結果」與「OP6a 的 `gross`」**同號**;不同號 ⇒ `RAISE`
   ⚠️ 斷言跑在 fixture 上,**不在正式庫上** —— 它證的是「今天兩份同源」,不是「以後不會漂」

---

## 3. 驗收(每條可 yes/no)

```
□ 空庫 fixture:匯款足額 ⇒ 登記後 payment_status = paid
□ 匯款不足額         ⇒ partiallyPaid
□ 匯款溢收           ⇒ 🔴 不翻(仍 unpaid), 而 cron 不取消它
□ needs_human(例:品項快照對不上)⇒ 不翻, 而 cron 不取消它
□ 一張「收了 300 又沖銷 300」的單 ⇒ 🔴 cron 【會】取消它(這是沖銷洞的證人)
□ 一張真的沒收錢的單 ⇒ cron 會取消它(正對照:改動沒有把功能關掉)
□ 🔴 **同源斷言存在, 而且它自己會紅**:migration 自帶一道斷言, 在 fixture 上驗
   「cron 那句 `sum(amount)` 的結果」與「OP6a 回的 `gross`」**同號**;不同號 ⇒ `RAISE`
   ⇒ **突變證人**:故意把其中一份改成別的算式 ⇒ 必須紅。**沒有那一發突變, 這一格不算做完。**
   ⚠️ 它跑在 fixture 上、不在正式庫上 ⇒ 它證的是「今天兩份同源」, 不是「以後不會漂」
□ 兩條腿的形狀對稱:卡片那句與匯款那句放在一起讀得出來是同一種東西
□ 三綠(而 .sql 走它自己的語法閘)
□ 鐵則 12①(錢)⇒ codex 對抗審查, 由【本窗自己】跑
```

---

## 3-b 🔴 本 plan 裡每一個數字是【量的】還是【算的】

```
量的(當場跑過, 指令與正負對照都在上面):
  寫入端 2 支 · 讀它的 29 支 · payment_status 值域 5 個 · SET 碼行 5 行而函式 2 支
  8 次命中全是讀 · OP6a 兩代七條前提逐字相同 · owner/SECDEF/EXECUTE 授權
算的 / 讀來的(沒有當場量):
  🔴 「1 天」那個逾期門檻 —— 讀自 migration 字面 + Sean 2026-08-09 拍板, 我沒有量正式庫的 cron 設定
  🔴 「cron 一次 500 列」—— 讀自 `SELECT pcm_cron.expire_unpaid_orders(500)` 那行字面
  🔴 (i) 的成本 —— **未量**(見判準⑤)
未確認:
  🔴 那支 cron 現在有沒有真的在跑(唯讀帳號讀不到 cron schema, 我實測 permission denied)
```
📌 **⇒ 為什麼要分**:今晚 `-15` 抓到一支檔把「約 25 分鐘」寫成事實而實際是 4-5 小時(差 10 倍),
而它的判斷是:**「下一個讀到【25 分鐘】的人, 可能會判【那還好】而不修。」**
🔴 **⇒ 一個低估的數字, 傷害不是不準 —— 是它會【讓人決定不做】。**

---

## 4. 🛑 本 plan 證不到什麼

```
· 那支 cron 現在【有沒有真的在跑】—— 唯讀帳號讀不到 cron schema(permission denied, 我實測過)
· 今天有沒有真的發生過 —— orders 今早被 ⟦b4-PURGE1⟧ 清空 ⇒ 那個 0 沒有判別力
  ⇒ 🔵 所以【急迫性】未知, 而【機制】確定。不要用「今天沒發生」當理由放慢
· OP6a 的第三代(20260901030000)【未 apply】⇒ 本片以【第二代】為準;
  那一代若先被貼上去, 本片要重驗七條前提
· 我沒有量 (i) 的成本 —— 判 (ii) 之後它降級成 nice-to-have(給將來想改 (i) 的人)
```

## 5. 與別片的關係(兩片都要在對方的 plan 裡出現一次)

```
`-c7` 的 ⟦b4-AUTOREFUND⟧:orders 上的 trigger, 在 cancel 發生【之後】開待退款
本片:pcm_cron.expire_unpaid_orders 的 WHERE 述詞, 決定 cancel 發不發生
🔴 而順序有意義:本片會讓【更少的單】被 cron 取消 ⇒ 減少那個 trigger 的觸發
⇒ ⇒ 而 -c7 的 W8 世界(逾期形狀有錢 ⇒ 開列)正是本片要消滅的那種單
🛑 ⇒ 那一格會變成死碼。不是壞事(它是防禦深度), 而【沒有人知道它變成死碼】才是壞事。
```
