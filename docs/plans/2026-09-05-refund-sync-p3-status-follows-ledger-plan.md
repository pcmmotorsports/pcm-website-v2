# 片③ · 退款狀態【照事實走】—— 作廢之後 `payment_status` 要降得回去

> **錨** `⟦b4-REFUNDSYNCP3⟧` · 2026-09-05 · 線 `-account`(`-d8`)
> **鐵則 8**(跨 3+ 檔 · 動 schema/函式)· **鐵則 12①(錢)③(DB)** ⇒ **關卡 1 codex 必跑, 不降級**
> **狀態:等批准。本 plan 不動任何一行碼。**

---

## §0 為什麼是現在 —— 它是一次「裁不貼」留下來的正事

2026-09-05 我們原本要在**出口**擋:`20260905400000` 讓「標記取消」之前現算一次實際退款額,
不足就拒。那支跑完 R1/R2 共 8 條 must-fix、五發突變、正式庫唯讀對帳 —— **而第三輪換角度把它推翻**:

🛑 **它會把一張【真的已經退完】的單鎖死**(人工全退 → 作廢造成 stale `refunded`
→ 之後真的在 TapPay Portal 全退而 PCM 沒記帳 ⇒ 這道閘判不足、拒絕),
而 `admin_cancel_order` 也擋刷卡單 ⇒ **兩條取消路都走不通、沒有逃生門**。

⇒ 📌 **它擋錯的與放行錯的是同一個成因:把【帳本】當成【金流真相】。**
⇒ ✅ **而成因不在出口, 在這裡** —— 見 `20260905010000` 的 COMMENT **逐字**:

> 🔴🔴 **片3 必須【移除】上面那道早退,而不是留著它** —— Fable R2 2026-08-23 抓到:
> 留著它 ⇒ 全部退款被作廢時 `v_moved=0` ⇒ 早退 ⇒ 永遠走不到三態的 `paid` 分支 ⇒
> `payment_status` 卡死在 `refunded` ⇒ **Sean 拍板「作廢後照事實降回」的行為靜靜地不存在**,
> 而 typecheck / lint / build 與片1 片2 的全部驗收都是綠的。

**方向是 Sean 2026-08-22 `Q-B=甲` 拍過的**(允許回 `paid`)—— 本 plan 不重問那一題,
要批的是**做法與影響面**。

---

## §0b 關卡 1(codex, 鐵則 12①③ 不省)—— **R1 FAIL:8 條 must-fix + 1 nit, 全折**

📌 **而值得記的是【它抓到的那一類】** —— 8 條裡只有 2 條是算式本身,
**6 條是「這份 plan 的分母不對」**:漏了第三段帳本、漏了三個消費端、漏了 TS 那份合約、
漏了兩支會變成假的 COMMENT、而**兩格驗收各自恆綠**(死結測試構造不出那個環;
負對照會紅在 fixture 建立而不是被驗的那支)。

🎯 **⇒ 我寫這份 plan 時掃的是【我知道要掃的東西】** —— 五支 view 我掃了、鎖序我掃了,
而 `SupabasePaidOrderScannerAdapter` 不是 view、`state-machine.ts` 不是 SQL
⇒ **它們不在我的掃描形狀裡。**

⛔ **兩處被推翻的原字面留痕**:
- ~~§3-A「`v_moved = 0` 且狀態不在三態內 ⇒ 靜靜回傳」~~ ⇒ 改 **fail-loud**(理由見 §3-A)
- ~~§7-5 死結測試用「A 走 record、B 走 void」配對~~ ⇒ **那個環構造不出來**(理由見 §7-5)

---

## §1 要改什麼(⓪ + 三處, 都在 DB)

### ⓪ 【先封口, 再改行為】—— 同一支 migration 裡, 排在改同步器【之前】

> **主視窗 `-f8` 2026-09-05 裁【甲】。** 乙(改 view 語意)**會漂**;丙(不處理)是**把一件對外不可回收的事交給時間**。

對「現存 `payment_status='refunded'` 且 `email_outbox` 裡**沒有** `order_created` 那一列」的單,
**補一列已寄記號**,`payload` 逐字註明「**片③ 封口, 非真寄**」。

```
① 先量:符合形狀的有幾張                → RAISE NOTICE(前置量測, 今天預期 0)
② 補列                                  → RAISE NOTICE '封口 % 張'
③ 才動同步器
```

🔴 **順序不可倒** —— 先改同步器 ⇒ 狀態當場降回 `paid` ⇒ **那一瞬間它就合格了**,
而封口若排在後面, 中間那個窗口有多寬**沒有人量得到**(同一個交易裡也一樣:
**掃描器讀的是提交後的世界, 而順序決定了提交時的狀態**)。

🛑 **而「補一列假的已寄記號」這件事本身要看得見** ——
`payload` 那句話是**唯一**能讓未來的人分辨「這封信寄過」與「這封信被我們封口」的東西。
⇒ 📌 **不寫那句, 這一步就會在半年後被讀成一次真的寄信。**

---


### ① `pcm_sync_order_refund_payment_status` —— 拿掉早退, 開第三態

現行(`20260905010000:299-317`)三段:

```
  IF v_moved <= 0 THEN RETURN v_ps; END IF;                       ← ⓐ 早退
  IF v_ps NOT IN ('paid','partiallyRefunded','refunded') THEN RAISE …;
  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  IF v_ps <> 'refunded' AND v_ps <> v_target THEN UPDATE … END IF;  ← ⓑ 只升不降
```

改成:

```
  v_moved := 卡退(confirmed) + 人工退款(未作廢) + 【第三段:更正為 money_moved 的 failed 卡退】
  v_target := CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded'
                   WHEN v_moved > 0                        THEN 'partiallyRefunded'
                   ELSE                                         'paid' END;
  IF v_ps NOT IN ('paid','partiallyRefunded','refunded') THEN
    RAISE …;                                      ← 🔴 fail-loud, 見 §3-A(關卡1 推翻我原本的靜默回傳)
  END IF;
  IF v_moved > v_total THEN RAISE WARNING …; END IF;   ← 🔴 超退, 見 §3-C
  IF v_ps <> v_target THEN UPDATE … END IF;       ← ⓑ 的 `v_ps <> 'refunded'` 拿掉
```

🔴 **第三段帳本(關卡1 must-fix)**:同步器現在只加總 `order_refunds(status='confirmed')`
與 `order_manual_refunds(voided_at IS NULL)` —— 而**還有第三種「錢真的動了」**:
`status='failed' AND failed_reason='manual_failed'` 而 `order_refund_effective_verdict.corrected_to='money_moved'`
的那些(`20260814190000:417-423` 逐字, 它自己就在扣這一段)。
⇒ 🛑 **不補這一段 ⇒ 一筆「先判失敗、後來更正為錢有動」的退款會被算成 0**
⇒ 狀態錯降回 `paid`, 而**錢其實出去了**。
⇒ 📌 **而口徑分岔在這裡特別致命** —— 同一個問題兩支函式各有一份答案。

### ④ `packages/domain/src/order/state-machine.ts` —— TS 那份合約也要動

🔴🔴 **關卡1 抓到:plan 原本寫「零 DDL / 前台零」是【不成立】的。**
`state-machine.ts:19-43` **逐字**寫著 `refunded: []` 與「`refunded → *`(終態)」為非法。
⇒ **DB 開放倒退之後, TS 與 DB 對同一個轉移互相矛盾。**
✅ 方向本身 Sean **2026-08-22 `Q-B=甲`** 拍過(允許回 `paid`)⇒ 這不是新拍板, 是**把拍板落到合約上**。
⚠️ 而該檔的註解引用的是**另一次拍板**(2026-07-25 `Q1=A`, 講 DAG 與自我轉移)
⇒ 🛑 **改它的時候不得刪掉那段註解**(鐵則 6)—— 舊字面留著加刪除線, 新增一行寫 08-22。
⚠️ **「終態」這個詞在 repo 裡還有幾處未掃** ⇒ 動手前跑 `bash scripts/literal-sweep.sh` 掃舊字面。

### ⑤ 兩支 COMMENT 要跟著改(正向與 rollback 都要)

`20260814190000:378-388` 的 COMMENT **逐字**寫著「`orders.payment_status` 不受影響」
⇒ 本片會**當場讓它變假**。⇒ 正向改它, **而 §6 rollback 也要把它改回去** ——
📌 **只還原函式本體, 說明就會停在新世界而碼停在舊世界。**

### ② `admin_void_manual_refund`(`20260820100000:292`)—— 作廢完要呼叫同步器
### ③ `admin_correct_order_refund_verdict`(`20260814190000:191`)—— 同上

🔴 **而這兩支【不可以照抄】片2a 那一行** —— 理由在 §4。

---

## §2 為什麼(不是「順手改乾淨」, 是一個行為缺口)

- `admin_void_manual_refund` 剝掉行註解之後 **`public.orders` 零命中**(2026-09-05 量)
  ⇒ 它作廢一筆退款之後, **沒有任何人去改 `payment_status`**。
- 而同步器就算被叫到, 全部作廢時 `v_moved = 0` ⇒ **撞上 ⓐ 早退** ⇒ 一樣不會動。
- ⇒ 📌 **兩道各自獨立的擋** —— 只修其中一道, 行為零改變, 而**三綠會全綠**。

---

## §3 兩個不修就會出事的細節(這一節是本 plan 最重要的部分)

### 🔴 A · 拿掉早退會讓一批【本來不該進來】的單撞上 domain 閘

現行 ⓐ 早退擋住的不只是「沒有退款」, 還順帶擋住了 **`payment_status` 根本不在
`paid/partiallyRefunded/refunded` 三態裡的單**(`unpaid` / `pending` / …)——
它們 `v_moved = 0` ⇒ 早退 ⇒ **從來走不到那道 `RAISE`**。

🛑 **把早退拿掉而不補 §1 那一格 ⇒ 任何一個對這種單的呼叫都會 RAISE**
⇒ 而同步器是**多個呼叫端共用的**(它自己的錯誤訊息就寫著這句)
⇒ 📌 **一個看起來只是「刪三行」的改動, 會讓別條路上的正常單開始爆。**

⛔ ~~修法 = `v_moved = 0` 且狀態不在三態內 ⇒ **靜靜回傳、不寫也不叫**~~
🔴🔴 **關卡1 推翻這個修法(must-fix)**, 而它的理由比我原本的好:
> 靜默回傳**會吞掉真正的狀態漂移** —— 最後一筆退款作廢時訂單已異常變成 `unpaid/partiallyPaid`,
> RPC 回成功卻不揭露壞帳;**helper 對 domain 外的狀態應該維持 fail-loud, 由呼叫端決定什麼是合法的 no-op。**

✅ **改採 fail-loud**:狀態不在三態內 ⇒ **照舊 RAISE**(不管 `v_moved` 是多少)。
🔵 **而這樣安全嗎** —— 呼叫端只在「動過退款」之後才叫它, 而**動退款本身對 `unpaid` 的單已經被擋**
(`20260801120000:242-249` 的 INSERT guard)⇒ 📌 **正常路徑到不了那個 RAISE;會到的那些, 本來就該叫。**
⚠️ **而這一格【必須驗】, 不能靠推**:§7 有它的正負對照。

### 🔴 B · `v_total = 0` 的單會被算成「已全額退款」

`v_moved >= v_total` 在 `v_moved = 0 AND v_total = 0` 時**成立** ⇒ 目標算成 `refunded`。
⇒ ✅ 所以 §1 的 CASE 第一格要寫 **`v_moved > 0 AND v_moved >= v_total`**。
⚠️ **而「有沒有 total=0 的單」我還沒查** —— 動手前先唯讀量一次(§7 驗收含這一格)。

### 🔴 C · 超退(`v_moved > v_total`)會被算成「剛好全退」, 而差額靜靜消失

關卡1 must-fix:卡退金額**明訂無上界**(`20260801120000:200-201`)
⇒ 總額 1,000 而帳本 1,200 時, `v_moved >= v_total` 成立 ⇒ 狀態 `refunded`
⇒ 📌 **看起來完全正常, 而 200 元的異常沒有任何人會知道。**

✅ **修法照既有先例, 不自創**:`⟦PCM01⟧` 那次 Sean 拍過「**上限閘由【擋】改成【記 + 標紅】**」
(`20260902020000`, 帳本 `:409`)⇒ 本片同型:**`v_moved > v_total` ⇒ `RAISE WARNING` + 讓它出現在紅格計數面**,
**不擋**(擋了會讓一筆已經發生的事無法登記, 那正是那次拍板否決的方向)。
⚠️ **而「紅格計數面」現有哪一支收得下這個訊號, 我還沒查** ⇒ 列進 §7。
🔵 負數與 NULL 由現行 CHECK / NOT NULL 擋住;`bigint` 溢位會 fail-loud(關卡1 已代為確認)。

---

## §4 鎖序 —— 這兩支呼叫端【不可以照抄】片2a 那一行

`20260823020000:477` 與 `20260905280000:314` **各寫過一次同一句警告**:

> 另兩支(`admin_void_manual_refund` / `admin_correct_order_refund_verdict`)**沒有這個前提**
> —— 它們**先鎖子表** ⇒ 直接照抄本行會形成**反向鎖序**。

- **A = `admin_record_manual_refund`**:步4 已 `orders FOR UPDATE` ⇒ 鎖序 **orders → 子表** ⇒ 直接呼叫沒問題。
- **B = `admin_void_manual_refund`**:`:335` 先 `order_manual_refunds … FOR UPDATE`。
- **C = `admin_correct_order_refund_verdict`**:`:253-258` 先 `order_refunds … FOR NO KEY UPDATE`。
- ⇒ B/C 若直接呼叫同步器(它會 `orders FOR NO KEY UPDATE`)⇒ **子表 → orders**
  ⇒ 與 A 相反 ⇒ 🔴 **40P01 死結**。

✅ **修法(同步器的 COMMENT `:359-360` 已經指定了)**:
**B/C 在鎖子表【之前】先取 `orders … FOR NO KEY UPDATE`**, 把鎖序拉回 orders → 子表。

⚠️ **而 `20260823020000:565` 有一道自檢**逐字寫著「`admin_void_manual_refund` 也被接上了;
那屬片2b, 而它需要先重排鎖序」⇒ 📌 **本片就是那個「片2b/片③」** —— 動手時要一併處理那句斷言的去留,
**不要讓一支舊 migration 的自檢與新事實互相矛盾地留在樹上。**

---

## §5 影響面

| 面 | 影響 |
|---|---|
| DB 函式 | 3 支(1 支同步器 + 2 支呼叫端), 全部 `CREATE OR REPLACE`、**參數列不動** ⇒ 不是多載 |
| schema | **零 DDL** —— 不加欄、不加表、不動 CHECK(⚠️ 而 ⓪ 封口會 **INSERT `email_outbox`**, 那是資料不是 DDL) |
| 資料 | **不回填**。既有 stale `refunded` 的單**不會**被這支自動修好 —— 它只在**下一次有人動那張單的退款**時才會被帶回正軌 ⇒ 🔴 **要不要回填是另一題, 本片不做, 見 §8** |
| 前台 | 零 |
| **TS domain 合約** | 🔴 **不是零**(關卡1 抓)—— `packages/domain/src/order/state-machine.ts:19-43` 要一起改, 見 §1 ④ |
| trigger | `trg_coupon_redeem_on_paid` **會被觸發而不會重扣**(`WHEN OLD='unpaid'`)⇒ 記在這裡, **不寫成「零 trigger」** |
| 後台 UI | 退款狀態顯示會開始出現「從 refunded 降回 paid」這種變化 ⇒ **文案/圖示要不要跟著改, 未查** |
| 通知信 | ✅ **已查(2026-09-05 唯讀正式庫)—— 而答案是【會, 有兩個方向】**, 見 §5b |
| 其他呼叫端 | 同步器是共用的 ⇒ 每一個呼叫端都會拿到新行為, **要逐一列出來**(§7) |

---

## §5b 通知信那一格 —— 查完了, 而它有【兩個相反的方向】

**做法**:唯讀正式庫問五支寄信掃描 view 的 `pg_get_viewdef`,問 `payment_status` 在不在裡面。
🟢 正對照 `cancelled_at`、🔵 負對照現造字面 —— **兩個對照都表演了**(有的 t、沒有的 f)。

| view | 述詞含 `payment_status` | 片③ 之後會怎樣 |
|---|---|---|
| `pcm_shipped_email_pending` | **f** | 不受影響 |
| `pcm_tracking_corrected_email_pending` | **f** | 不受影響 |
| `pcm_unpaid_cancelled_email_pending` | t(`= 'unpaid'`) | **不受影響**(`refunded → paid` 碰不到 `unpaid`) |
| `pcm_cancelled_email_pending` | t(`= 'refunded'` + `cancelled_at IS NOT NULL`) | 🔴 **會【掉出佇列】** ⇒ 那封取消信**不會寄** |
| `pcm_order_created_email_pending` | t(`= 'paid'` + `cancelled_at IS NULL`) | 🔴🔴 **會【新進佇列】** ⇒ **新寄一封「訂單成立」信** |

🛑🛑 **第二列是【對外不可回收】** —— 一張老單本來是 `refunded`、沒取消、而 outbox 裡沒有
`order_created` 那一列(例如它早於整套信箱系統)⇒ 片③ 把它降回 `paid` ⇒ **它就合格了**
⇒ 📌 **客人會在很久以後收到一封「您的訂單成立」。**

🔵 而第一列的方向其實是**對的**:那種單的退款全被作廢了 ⇒ 錢沒退 ⇒
一封「已取消並已退款」的信本來就不該寄。**但它仍是一個行為改變, 不是 no-op。**

### 🔬 而今天實際有幾張(唯讀正式庫, 2026-09-05)

```
A 目前 payment_status=refunded 的單                                    1
B 其中【實際退款額=0】⇒ 片③ 會把它降回 paid                            0
C 🔴 B 之中【沒取消 + 沒寄過訂單成立信 + 有 email】⇒ 會新寄訂單成立信    0
D B 之中【已取消 + tappay】⇒ 會掉出取消信佇列                          0
🟢 正對照 全部訂單數                                                    2
🔵 負對照 payment_method=現造值                                         0
```

🔴🔴 **而「全部訂單 2」這個數字看起來像量具壞了, 所以我去驗了量具**:
```
current_user            pcm_readonly
我有 BYPASSRLS 嗎        true       ← ⇒ RLS 沒有在藏列
orders 有開 RLS 嗎       true
orders 上有幾條 policy    2
orders 我看得到幾列       2
orders 統計說插入過幾列   538        ← 插入過 538、現存 2 ⇒ 其餘被刪掉了
customers 我看得到幾列    15         ← 與帳本 09-02 記的「當時 14 列」對得上
```
⇒ ✅ **那些 0 是真的, 不是被過濾掉的 0。**
📌 **而「插入過 538 / 存活 2」這一格要留著當背景** —— 下一個讀這份 plan 的人
會跟我一樣覺得「全部訂單 2」像壞掉;**那一格就是回答他的東西**,不要當成雜訊刪掉。
⇒ 📌 **⇒ 片③ 今天上線, 會被改到的單是【0 張】。**

### 🔴 而「五支 view」不是全部的消費端(關卡1 must-fix)

我原本只掃了 view。關卡1 指出**還有三個地方在讀 `payment_status`**, 而它們**都會把新的 `paid` 當成缺信**:

| 消費端 | 座標 | 片③ 之後 |
|---|---|---|
| cutoff 掃描器 | `SupabasePaidOrderScannerAdapter.ts:215-228` | 🔴 **另一條會排出訂單成立信的路** —— 它**不是** view |
| 缺信計數 | `get_order_created_gap_counts`(`20260831030000:73-110`) | 會把新的 `paid` 算成「缺一封信」 |
| stuck 告警 | `20260901060000:72-115` | 同上 ⇒ **可能對外發告警** |
| 折價券 trigger | `trg_coupon_redeem_on_paid`(`20260901030000:1232-1257`) | 🟢 **不會重扣** —— `WHEN` 要求 `OLD='unpaid'`(關卡1 nit:要寫進影響面, **不可寫成「零 trigger」**) |

⇒ 📌 **§1 ⓪ 的封口只封住 `email_outbox` 那一條路** —— 上面前三格**要各自答一次**,
而**那不是同一個問題的三種說法**:一個會寄信、兩個會產生「缺信」的假訊號。
⚠️ **三格都【未查】** ⇒ 列進 §7。

🛑 **而「今天 0 張」不等於「這個風險不存在」** —— 上面那張表講的是**機制**,
而機制在**下一張符合形狀的單出現時**就會生效。⇒ **修法要照機制做, 不是照今天的張數做。**

### ⇒ 本片因此多一件事(納入 §1)

`pcm_order_created_email_pending` 那一列**要處理**。
✅ **主視窗 `-f8` 2026-09-05 裁【甲】** ⇒ 做法寫在 §1 ⓪。
⛔ **乙**(view 加「早於信箱系統上線」的排除)**駁回**:那是**改 view 的語意**,而語意會漂 ——
   一條為了這件事加上去的排除, 半年後沒有人記得它為什麼在那裡。
⛔ **丙**(不處理)**駁回**:今天 0 張, 而**那是把一件【對外不可回收】的事交給時間**。

---

## §6 Rollback

1. 把 `pcm_sync_order_refund_payment_status` / `admin_void_manual_refund` /
   `admin_correct_order_refund_verdict` **三支各自的上一代原樣再貼一次**(全是 `CREATE OR REPLACE`)。
   座標:`20260905010000:244` · `20260820100000:292` · `20260814190000:191`。
2. 🔴 **而回滾之後回到今天**:作廢一筆退款之後狀態**降不回去**, 而那正是本片要修的東西。
3. 🛑 **回滾【不會】把已經被降回 `paid` 的單改回 `refunded`** —— 那些是**照事實**改的,
   而回滾的是規則不是資料。⇒ 📌 **「回滾」在這一片是不對稱的, 不要寫成「回到原狀」。**

---

## §7 驗收(每條可 yes/no;拋棄式 PG 17.10)

1. **必紅測試(同步器 COMMENT `:355` 指定的那一格)**:全部退款作廢 ⇒ `payment_status` **回到 `paid`**。
2. **反向**:退一半 ⇒ `partiallyRefunded`;退滿 ⇒ `refunded`;**再作廢** ⇒ 回 `paid`。
3. **§3-A(已改 fail-loud)**:對一張狀態不在三態內的單呼叫同步器 ⇒ **要 RAISE**。
   🔴🔴 **而關卡1 指出這一格【容易紅在錯的地方】**:`order_refunds` 的 INSERT guard 本身就拒絕 `unpaid`
   (`20260801120000:242-249`)⇒ **fixture 建不起來也會紅, 而那個紅冒充成功。**
   ✅ 所以這一格要驗**三件**:①紅了 ②`SQLSTATE`／訊息**是同步器那一支**發的
   ③**證明 helper 真的被呼叫到**(不是在它之前就炸了)。
4. **§3-B**:`total = 0` 的單、零退款 ⇒ 目標是 `paid` **不是** `refunded`。
   並唯讀量一次正式庫有沒有 `total = 0` 的單(帶正負對照)。
5. **§4 鎖序** —— 🔴🔴 **關卡1 指出我原本挑的交易配對【構造不出那個環】**:
   `admin_record_manual_refund` 鎖了 `orders` 之後 **INSERT 一列新的**(`20260820021000:216,296-303`)
   ⇒ 它**不會去等** `void` 鎖住的那一列 ⇒ 兩者永遠不相撞 ⇒ 📌 **那個「死結測試」會恆綠, 而它證不到任何事。**
   ✅ **正確的配對 = 「orders → 同一子列」對「同一子列 → orders」**(兩邊碰的必須是**同一列**)。
   🔴 仍然要表演兩個世界:先讓它**真的 40P01 一次**, 再套修法讓它不死結。
6. **呼叫端清單**:列出同步器全部呼叫端(`git grep`, 附分母), 逐一說它拿到新行為之後會怎樣。
7. **通知信**:掃四支寄信 view 對 `payment_status` 的述詞, 答「降回 `paid` 會不會排出新的信」。
   🔴 **對外不可回收 ⇒ 這一格沒答出來之前不得 commit。**
8. 🔴 **上線【前】重量 B/C/D 三格**(§5b 那三個數)——
   今天是 0,而**那是 2026-09-05 那一刻的讀數**;中間可能長出新的。
   🛑 **而 ⓪ 封口那一步自己會印「封口 % 張」** ⇒ 那個數字與這一格的重量**必須對得上**;
   對不上 ⇒ 中間有東西在動, 停下。
9. 三綠(`.sql` 對三綠零判別力 ⇒ **另跑 `scripts/migration-static-checks.sh`**)。
10. **第三段帳本(§1 ①)**:造一筆 `failed + manual_failed` 而更正為 `money_moved` 的卡退
    ⇒ 它**必須被算進 `v_moved`**;負對照 = 更正為別的值 ⇒ **不算**。
11. **超退(§3-C)**:帳本 1,200 而總額 1,000 ⇒ **要有 WARNING**, 且狀態仍是 `refunded`;
    🔵 並答出「哪一支紅格計數面收得下這個訊號」(**目前未查**)。
12. **另外三個消費端(§5b)**:cutoff 掃描器 / 缺信計數 / stuck 告警 —— **各答一次**
    「新的 `paid` 進來之後它會做什麼」, 附 `檔案:行號`。
    🔴 **cutoff 掃描器那一格是【會對外寄信】的** ⇒ 沒答出來之前不得 commit。
13. **TS 合約(§1 ④)**:`state-machine.ts` 的 `refunded` 允許集要含 `paid`,
    且該檔既有測試的**負向斷言**(「`refunded → *` 一律 throw」)要跟著改;
    🔴 **改完跑那支測試, 比四個數**(鐵則 11)。
14. 突變:每一道新守門各弄壞一次, 各自紅在自己那一句。
15. ⓪ 封口那一步的**負對照**:造一張「`refunded` 且 outbox 已經有 `order_created`」的單
    ⇒ **它不可以被補第二列**(否則封口會製造重複記號)。

---

## §8 這份 plan 【證不到】什麼(照實寫)

- 它**不回填**既有 stale `refunded` 的單。🔬 **而「有幾張」查完了 = 0 張**(§5b)
  ⇒ 📌 **那一題今天不必問 Sean** —— 沒有東西可回填。
  🛑 **而這個 0 有時效** —— 它是 2026-09-05 那一刻的讀數;**片③ 上線之前要再量一次**,
  因為中間可能長出新的。⇒ 已列進 §7 驗收。
- §5 的「通知信」與「後台 UI 文案」兩格**都標了未查** —— 它們是 §7 的驗收項, 不是已知結論。
- §3-B 的 `total = 0` **我還沒量正式庫**, 只從 CHECK(`orders_total_check: total >= 0`)推出它可能存在。
- 本 plan **沒有**處理 `20260905400000`(出口擋)的去留 —— 那支已裁不貼、留在
  `agent/line-account-cardcancel` 當第二層保險候選, 檔頭第一行寫著。
  📌 **片③ 上線後若仍要縱深, 從那裡接;而那時它面對的世界已經不同了。**
