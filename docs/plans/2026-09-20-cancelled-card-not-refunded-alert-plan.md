# plan · ⟦account-CANCELCARDNOTREFUNDED⟧ —— 每日告警信補一格「已取消而線上退款未發起」

> 板列 `docs/launch-todo.md:521`(態 `open`)· 作者 a1 · 2026-09-20
> 🛑 **本檔零落筆**:沒有動任何碼、沒有跑任何寫入。碰告警 / 寄信 ⇒ 鐵則 8, **等 Sean 批才做**。

---

## 0. 一句話:Sean 或員工會看到什麼不一樣

**那封每天早上的告警信,會多一行:**

```
已取消而線上退款未發起  N 張(最久的一張已取消 X 天)
```

**今天沒有那一行。** 一張刷卡單取消之後,**沒有任何東西會自動去退那筆錢**
(板列 `⟦0a-CARDCANCELNOREFUND⟧:2409` 逐字),而**如果沒有人記得按那顆鈕,今天沒有任何訊號**。
⇒ 📌 **客人的錢留在我們這裡,而我們這一端是靜音的。**

---

## 1. 這一列今天還成立嗎 ⇒ **成立**(a1 2026-09-20 實查)

**① ⛔ ~~那封信今天讀 16 支 summary~~ ⇒ 🔴 **那個 16 是錯的,真數是 20** —— 見文末〈訂正〉。(板上記的是 9 支 ⇒ 已經長大了)**
🔬 `grep -oE "get_[a-z_]+" apps/storefront/src/app/api/cron/anomaly-alert/route.ts | sort -u` ⇒ 16 支
　🔵 負對照 現造函式名 ⇒ 0
**② 而 16 支裡沒有任何一支在數這件事 —— 16 支【逐支開檔讀述詞】,不是掃字串**
🔬 方法:對每一支跑 `latest-definition-of.sh` 取最新代 ⇒ 切出函式本體 ⇒ 抽出「回哪些 key / 讀哪些表 /
　 `payment_status` 與 `cancelled_at` 的述詞」。**問的是「它數的是哪一種單」,不是「它有沒有那個字串」。**
🟢 **這把新尺的正對照**:`get_cancelled_mixed_rail_gap_counts` 用的是 `payment_status = 'refunded'`
　(**與我原本那把窄尺不同的寫法**)⇒ **新尺看得見它** ⇒ 尺是活的。

**🔬 16 支裡只有【兩支】碰 `cancelled_at IS NOT NULL`:**
```
get_cancelled_mixed_rail_gap_counts   cancelled_at IS NOT NULL + payment_status = 'refunded'  ⇒ 錢【已經退了】
get_order_unpaid_cancelled_gap_counts cancelled_at IS NOT NULL + payment_status = 'unpaid'    ⇒ 【沒收過錢】
```
🎯 **⇒ 「已取消 × 收過錢 × 還沒退」這一格,16 支裡【一支都沒有】。**
　 其餘 14 支:4 支明文 `cancelled_at IS NULL`(= 只看沒取消的)· 10 支根本不看訂單那一軸
　 (心跳 / 出貨 / 追蹤碼 / outbox / 供應商同步 / 車款同步 / incident / 角色 / 搜尋日誌 / 結算重試)。

🔴 **而我原本那把窄尺【真的會漏】—— 這次抓到了活例子**:
　`get_stuck_bank_orders_health`(`20260916060000`)用的是
　`payment_status <> 'unpaid'::public.payment_status` 與 `payment_status = ANY (ARRAY['unpaid','partiallyPaid'])`
　⇒ 📌 **裸 `grep "payment_status = 'paid'"` 對這兩種寫法完全看不見。** 我第一版那六個 0 之所以成立,
　是因為那六支剛好沒用這些寫法 —— **不是因為那把尺量得到。**
🎯 **最接近的那一支不算**:`get_cancelled_mixed_rail_gap_counts` 的述詞要求
　`payment_status = 'refunded'`(`20260906960000_...phone_notified.sql:88-89`)—— **那是【錢已經退了】**,
　它數的是「退了而取消信沒人工寄」。**與本列的「還沒退」是相反的一端。**
　📌 而 `get_order_refunds_stuck_summary` 整支檔 `payment_status` 命中 **0** ⇒ 它從 `order_refunds` 那張表看,
　**看得到的都是已經有人按過鈕的**。⇒ 🎯 **「卡住」與「沒開始」的差別,就是【有沒有人按過那顆鈕】。**

**③ 今天的曝險 = 0,而那個 0 【不能】讀成「這個洞不存在」**
🔬 正式庫唯讀(`scripts/readonly-prod-sql.sh`,只數不印值):
```
刷卡 × 已取消              1 張   ← 而那一張【已經退了】
其中還沒退(本列的受詞)     0 張
還沒退且零退款紀錄          0 張
分母:訂單 14 · 刷卡單 3 · 已取消單 7 · order_refunds 2 列
🔵 負對照(cancelled_at IS NOT NULL AND IS NULL)⇒ 0
```
🛑 **那個 0 的主詞是「刷卡單總共只有 3 張」,不是「這件事不會發生」。**
　 機制在:取消刷卡單**沒有任何自動退款**,而**沒有訊號**。⇒ **第一批真客人多退幾張,它就有分母了。**

---

## 2. 改什麼

**新開一支 summary 函式 + 寄信端多讀一支 + 信裡多一行。三件,不多不少。**

```
① 新 migration:CREATE FUNCTION public.get_cancelled_card_unrefunded_counts()
   回 2 個 key:
     cancelled_card_unrefunded_count      已取消 × tappay × payment_status <> 'refunded'
                                          × NOT EXISTS(order_refunds 那張單的任何一列)
     oldest_cancelled_unrefunded_at       上面那一群裡最舊的 cancelled_at(沒有 ⇒ null)
② apps/storefront/src/app/api/cron/anomaly-alert/route.ts 多讀這一支(第 17 支)
③ 信裡多一行:「已取消而線上退款未發起 N 張(最久的一張已取消 X 天)」
```

### 🛑 為什麼是【新開一支】,不是把 key 加進既有那支
**理由是那支老函式【自己寫的】,不是我的偏好**:
`20260824040000_m3_250_order_refunds_stuck_summary.sql:9-17` 逐字警告
**不要把新 key 加進 `get_payment_anomaly_alert_summary`** —— 它的定義散在**四支 migration**,
檔內有**四顆 pre-image `md5` fail-closed 閘 + 三道 post-image 指紋**,同簽章重貼可能**安靜撤回**最新述詞,
而「**新 key 照常出現、型別過、ACL 過、三綠過**」。
🔴 **而它給的第二個理由對我同樣成立,逐字**:「走那條路要 **live pre-image md5**,施工窗零 DB access
⇒ **我做不到那道驗證**」⇒ 📌 **「我做不到那道驗證」本身就是選路的理由。**
✅ **前例**:`m3_250` 自己就是這樣做的(新開一支,不動老的)。

### 🛑 文案紀律(板列明文,照抄)
**不得寫「去 TapPay 退」。** `cancel-review-section.tsx:77` 逐字「**『人工』對刷卡單是錯的:
這一頁最下方就有線上退款入口**」;`:99-101` 記著寫「退款流程」被測試當場擋掉,
**因為畫面上沒有一個叫那個名字的東西** ⇒ **紀律是指【位置】,不指【流程名】。**

---

## 3. 影響

```
🔵 客人   沒有直接影響(這一片只加一個【我們這端看得到】的計數)
           而間接影響是真的:有人看見 ⇒ 那筆錢會被退回去
🔵 Sean   每天那封信多一行。**平常那一行會是 0** —— 而 0 也要印, 不印的話
           「今天沒有」與「這一格壞了」又長成同一個東西
🔴 員工   沒有新畫面、沒有新按鈕。取消當下的畫面提醒 09-05 就做了
           (`cancel-pending-refund-notice.ts:5-6`, Sean 2026-09-05 拍乙)⇒ **本片不碰它**
🔴 DB     新增一支 SECURITY DEFINER function + GRANT。**要貼板, 要等 Sean 說貼。**
🔴 部署   碼與板要當成同一次動作:板先貼(新函式 ⇒ 部署時序閘會擋 `.rpc(`)
```

---

## 4. Rollback

```
① 碼:revert 那一顆(route 少讀一支、信少一行)—— 無狀態, 立即生效
② DB:DROP FUNCTION public.get_cancelled_card_unrefunded_counts();
      ⇒ 純新增物件, 沒有改任何既有函式 ⇒ **drop 掉等於回到今天**
      🛑 而順序是【先 revert 碼再 drop 函式】—— 反過來會讓還在線上的 route 叫一支不存在的函式
🔵 零資料變更 ⇒ 沒有需要還原的資料
```

---

## 5. 驗收(關閉條件,照板列逐字)

> 那封每日信裡出現一格「已取消而線上退款未發起」的計數,而它與既有三個「卡住」計數**分得開**
> (至少一發:造一張已取消未發起的單 ⇒ 新計數 +1 而三個舊計數不動)

🛑 **而「分得開」那一半是本片的重點,不是附加題** —— 板列逐字說那三個舊計數講的是【卡住】,
本片講的是【沒開始】,而**它們在信裡長得很像**。⇒ **落筆前先餵一發該紅的**:
把新函式的述詞從 `<> 'refunded'` 改成 `= 'refunded'` ⇒ 那一格必須紅(它會變成在數舊計數那一群)。

---

## 6. 我沒查的(照實,不要讀成已排除)

1. **我沒有起瀏覽器、沒有造一張「已取消而未退款」的單走一遍** ⇒ 我證的是【今天沒有任何 summary 在數它】,
   不是【那封信長什麼樣】。
2. ✅ **已補**(2026-09-20 同日):原本只開 6 支、另外 10 支靠名字判斷 ⇒ **現在 16 支全部開檔讀述詞**,
   見 §1②。⇒ 那一格從**推論**變成**讀數**。
3. ✅ **已補,而且那個擔心是對的**:`payment_status = 'paid'` 那把窄尺**真的會漏** ——
   `get_stuck_bank_orders_health` 用 `<> 'unpaid'::public.payment_status` 與 `= ANY (ARRAY[...])`,
   裸 grep 看不見。⇒ 已改成逐支讀述詞。
   ⚠️ **而新尺仍有射程**:我讀的是 **repo 最新代的 migration**,不是**正式庫上那一版**
   (「物件在」對「是哪一版」零判別力)。要完全關掉這一格得跑 `prod-vs-vc-functions.py`。**我沒跑。**
4. **`oldest_cancelled_unrefunded_at` 要不要進信、以什麼單位印(天 / 小時)** —— 我照既有
   `oldest_open_age_seconds` 的形狀提,**沒有問過 Sean**。


---

## 🔴 訂正(2026-09-20 晚 · 本檔作者自己抓到的兩個錯)

**做 `⟦auth-PARTIALREFUNDCANCELGAP⟧`(板 `:2546`)時撞到的。兩個都影響本檔。**

### 訂正一:§1 那個「16 支」是【錯的分母】,真數是 20

```
🔬 我當時的尺:grep -oE 'get_[a-z_]+' <anomaly-alert/route.ts>  ⇒ 16
🔴 而實際【被呼叫】的是 adapter:
   grep -oE "SELECT public\.get_[a-z_]+" <PgAnomalyAlertReaderAdapter.ts>  ⇒ 20
🔬 adapter 有而 route 沒提到的 6 支:
     get_daily_charge_failure_counts · get_manual_customer_search_summary
     get_paid_email_after_cancel_counts · get_partial_refund_cancel_gap_counts
     get_payment_anomaly_alert_display_ids · get_payment_anomaly_alert_summary
```
🛑 **⇒ 我量的是「route 檔裡出現過名字的」,而那不是「那封信讀了哪些」。**
📌 **成因**:呼叫住在 adapter,route 只在少數幾支上提到名字 ⇒ **我把「提到」當成「呼叫」。**

**✅ 而補讀那 6 支之後,§1 的【結論不變】** —— 逐支開檔讀述詞:
```
get_payment_anomaly_alert_summary      完全不碰 cancelled_at;payment_status 只有 unpaid / paid
get_paid_email_after_cancel_counts     數的是「取消之後還寄了信」(sent_at > cancelled_at), 不看退款
get_partial_refund_cancel_gap_counts   已取消 × partiallyRefunded  ⇒ 相鄰的另一群
get_daily_charge_failure_counts        整檔 cancelled_at ⇒ 0 命中
get_manual_customer_search_summary     整檔 cancelled_at ⇒ 0 命中
get_payment_anomaly_alert_display_ids  顯示用
🔵 負對照 現造欄名 zzq_cancelled_at ⇒ 0
```
🎯 **⇒ 20 支裡仍然沒有一支在數「已取消 × 收過錢 × 一毛都還沒退」。§2 的修法照舊成立。**
🛑 **而「結論沒變」不能拿來原諒那個分母** —— 這一次剛好沒事,而**同一把尺下一次會漏掉真的**。

### 訂正二:🔴🔴 §2 那一行【會踩到一個現成的坑】—— 它不會讓信寄出去

```
🔬 packages/use-cases/src/check-anomaly-alerts.ts:133 逐字:
   「不進 shouldAlert —— 照 partialRefundCancel 那格的形狀:
     有差額才在信裡多一行, 它自己不讓信寄出去。」
🔬 同檔 :17  shouldAlert = open>0 || refundingStuck>0 || attemptManualReview>0 || releasedStuck>0
```
🛑 **⇒ 如果本檔的新計數照既有形狀接, 那麼「今天唯一不對的事就是【已取消而線上退款未發起】」的那一天,
　 那封信【不會寄】** ⇒ 📌 **我提的那一行, 會被印在一封不存在的信上。**

🎯 **⇒ 而本檔 §0 的承諾正是「Sean 會多看到一行」** —— 那個承諾在這個接法下**不成立**。

**⇒ 本檔因此多一題要 Sean 裁(排在最前面):**
```
Q:「已取消而線上退款未發起」要不要【自己讓那封信寄出去】?
A: 甲 = 要(進 shouldAlert)——  這一格 >0 就寄, 就算今天別的都正常
       📌 理由:那是【客人的錢還在我們這裡】, 而沒有人按鈕它不會自己走
   乙 = 不要(照 partialRefundCancel 的形狀)—— 只在信已經要寄的時候多一行
       📌 代價:只有這一件出問題的那一天, 沒有人會知道
⛔ ~~🔵 我推薦【甲】~~ 🔴 **那個推薦我收回,見下方〈訂正三〉—— 甲會造出一盞永遠亮著的紅燈。**
```
⚠️ **而「不進 shouldAlert」是不是誰拍過的** —— 那行註解說它照既有形狀,**而是誰拍的我查不到**。
⇒ 🛑 **所以上面那個甲乙是一題【新的】題, 不是在推翻誰。**


---

## 🔴🔴 訂正三(2026-09-20 晚,更晚 · 我收回訂正二裡那個「推薦甲」)

**做 `⟦b4-CANCELMAILMIXEDRAIL⟧`(板 `:2545`)時,讀到這支檔【已經想過這一題並拒絕了甲】。**

```
🔬 packages/use-cases/src/check-anomaly-alerts.ts:1572-1573 逐字:
   「🛑 **不進 shouldAlert** —— 它是『有事要人做』不是『系統壞了』;
     與同日 ⟦QB-10⟧ 同一個判準:
     **一個不會自己好的數字進了響鈴, 就是下一個永遠亮著的紅燈。**」
```
🔴 **⇒ 而本檔要數的那個東西, 正是「不會自己好的數字」** ——
「已取消而線上退款未發起」會**一直 >0**,直到有人去按退款。
⇒ 🛑 **照甲做 ⇒ 那盞燈從按下去的那天起天天亮, 而亮著的紅燈等於沒有燈。**

### ⇒ 所以〈訂正二〉那個甲/乙【問錯了】。正確的題是:

```
Q:一個【要等人動手才會歸零】的數字, 怎麼告警而不變成長亮紅燈?
A: 甲 = 進 shouldAlert(原推薦)       🔴 **我收回** —— 會變成永遠亮著的紅燈
   乙 = 照既有形狀, 只搭便車            🔴 只有這一件出事的那天, 沒有人會知道
   丙 = **只在【年齡超過門檻】時才叫**   🔵 例如「最久的一張已取消 > 48 小時」才進 shouldAlert
        📌 它自己會好:有人去退了 ⇒ 那張消失 ⇒ 燈滅。而沒人理 ⇒ 它會叫, 而且愈叫愈該叫
   丁 = **只在【從 0 變成 >0】那一次叫**  ⚠️ 需要記住上一輪的值 ⇒ 要存狀態, 體積變大
🔵 **我改推薦【丙】。** 理由:它是唯一一個【自己會滅】的做法,
   而那正是 :1572 那句話真正在要求的東西 —— 它反對的不是「叫」, 是「不會滅」。
```

### 🔵 而不論選哪一個,有一格是共同的(這支檔自己寫的)
`check-anomaly-alerts.ts:1574-1575` 逐字:
> 「**分母一起印**:`Pending = 0` 而分母也 0 ⇒ 那是『今天沒有這種單』;
> 分母 > 0 而 `Pending = 0` 才是『有這種單而都寄完了』。**兩者不可印成同一句。**」

⇒ 📌 **本檔 §2 的 `oldest_cancelled_unrefunded_at` 不夠 —— 還要一個分母**
(= 今天有幾張已取消的刷卡單,不論退了沒)。**否則那一行的 0 有兩種意思。**
✅ 而丙那個做法**正好需要那個 `oldest`** ⇒ 兩件事接得起來,不用多加欄位。

### 🛑 而我為什麼會推薦甲 —— 記下來,因為它是本檔第三個同型的錯
```
🔴 我看到「它不進 shouldAlert」⇒ 讀成「有人偷懶」⇒ 推薦把它加進去
🛑 而它旁邊【就寫著理由】, 而我沒讀到那兩行就下了推薦
📌 ⇒ 與訂正一同一種:**我用了一把只看得到「有沒有」的尺, 而沒看「為什麼沒有」。**
```
