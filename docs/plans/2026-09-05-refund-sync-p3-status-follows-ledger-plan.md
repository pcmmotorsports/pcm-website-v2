# 片③ · 退款狀態【照事實走】—— 作廢之後 `payment_status` 要降得回去

> **錨** `⟦b4-REFUNDSYNCP3⟧` · 2026-09-05 · 線 `-account`(`-d8`)
> **鐵則 8**(跨 3+ 檔 · 動 schema/函式)· **鐵則 12①(錢)③(DB)** ⇒ **關卡 1 codex 必跑, 不降級**
> **狀態:等批准。本 plan 不動任何一行碼。**

---

## ⚠️ 讀這份 plan 之前先看這一句(關卡 1 R1 逼出來的)

**這份 plan 的第一版, 8 條 must-fix 裡有 6 條是【分母不對】, 而它們的形狀是同一個:**

> 🔴 **不是 view、不是 SQL, 就不在我的掃描形狀裡。**

漏掉的東西:一支 **TypeScript adapter**(會寄信)· 一份 **TS domain 合約**(宣告 `refunded` 是終態)·
兩支 **COMMENT**(會當場變假)· 一段**藏在另一支函式算式裡**的第三本帳。
📌 **⇒ 而我當時掃得很認真** —— 五支寄信 view 一支不漏、鎖序三支呼叫端全開檔。
🎯 **⇒ 問題不在密度, 在【形狀】** —— 我問的是「哪些 view 讀 `payment_status`」,
而正確的問題是「**哪些【東西】讀 `payment_status`**」。
⇒ 🛑 **接手這份 plan 的人:每加一個消費端之前, 先問「我這次的搜尋形狀排除了什麼」。**

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

## §0c 關卡 1 R2 —— **也 FAIL(9 條 must-fix + 1 nit)。上限 2 輪到了 ⇒ 端決策題, 不折第三輪。**

🔵 **而它們不是在同一層打轉** —— 每一條都是新的、更深的。**判停的理由是【上限】, 不是方向問題。**

**`-f8` 2026-09-05 裁的三題**(工程題, 未端 Sean;片③ 的方向 Sean 08-22 已拍):
| | 裁 | 落在哪 |
|---|---|---|
| **D1** 狀態漂移時作廢要不要被擋 | **甲 fail-loud** + 人話訊息 | §3-A |
| **D2** 超退怎麼讓人看得到 | **丙** 寫進 `pcm_incident`, 不用 WARNING 也不做 UI | §3-C |
| **D3** 本來被抑制、現在變可寄的舊信 | **甲** 封口擴大, 同一交易 | §1 ⓪-b |

🔴🔴 **而 R2 有三條是【推翻我自己上一輪寫的東西】, 原字面全部留刪除線**:
- ~~「正常呼叫端到不了那個 RAISE」~~ ⇒ **假的**, B/C 合法到得了(§3-A)
- ~~「照 `⟦PCM01⟧` 先例:WARNING + 標紅」~~ ⇒ **我引的先例正好否定我的做法**(§3-C)
- ~~「B/C 先鎖 orders」~~ ⇒ **不可施工**, 因為 `order_id` 在子列裡(§4)

🎯 **⇒ 而這一輪學到的形狀與 R1 那個是同一個的另一面**:
R1 是「**我掃的東西形狀太窄**」;R2 是「**我引的證據射程比結論窄**」——
`⟦PCM01⟧` 那個先例我真的讀了、真的引對了出處,**而它說的正好是相反的事**。
⇒ 🛑 **引一個先例之前, 要讀到它【否定什麼】, 不只讀它【支持什麼】。**

---

## §1 要改什麼(⓪ + 三處, 都在 DB)

### ⓪ 【先封口, 再改行為】—— 同一支 migration 裡, 排在改同步器【之前】

> **主視窗 `-f8` 2026-09-05 裁【甲】。** 乙(改 view 語意)**會漂**;丙(不處理)是**把一件對外不可回收的事交給時間**。

**兩件事, 同一支 migration、同一個交易**(關卡1 R2 之後改寫):

**⓪-a 沒有 outbox 列的** ⇒ 補一列「不會被寄」的記號。
🔴🔴 **而那一列【不可以標 `sent`】**(R2 must-fix, 我開檔驗過):
`apps/admin/src/lib/orders/email-log-view.ts:71` 逐字 `case 'sent': return '已寄出'`
⇒ 🛑 **後台會對員工說「已寄出」+ 一個時間, 而那封信從來沒有寄過。**
⇒ 而 `payload` 裡那句「片③ 封口, 非真寄」**UI 根本不讀**(欄位清單 `:61` 只有
`event_type,status,attempts,max_attempts,created_at,sent_at`)。
✅ **改用現成的誠實態 `skipped_no_real_email`** ⇒ 畫面顯示「**沒寄(沒有真的信箱)**」(`:75-76`)。
🔵 **而它封得住** —— view 的 anti-join **只比 `event_type`, 不比 `status`**(§5b 的 viewdef 逐字)
⇒ 📌 **任何態都封得住, 所以可以挑一個【看起來就是沒寄】的。**
⚠️ 而 `skipped_no_real_email` 這個字面**描述的原因與實情不同** ⇒ `payload` 那句話**照樣要寫**,
   它是唯一能讓未來的人分辨兩者的東西 —— **只是不能【只靠】它。**

**⓪-b 已經有 pending / failed outbox 列的**(D3 甲, `-f8` 2026-09-05 裁)
⇒ 那些列**一併改成 `skipped_no_real_email`**。
🔴 **為什麼非做不可**(R2-6, 我開檔驗過):
`packages/adapters/src/email/SupabaseIneligibleOrderEmailScannerAdapter.ts:54` 逐字
```
const INELIGIBLE_ORDER_FILTER = 'payment_status.eq.refunded,cancelled_at.not.is.null';
```
那是 **OR** ⇒ `refunded` **或**已取消 ⇒ 那張單的信被**抑制**。
⇒ 🛑 **片③ 把 `refunded` 降回 `paid` ⇒ 它不再被抑制 ⇒ 既有的 pending/failed 列【變成可寄】**
⇒ sweeper 會把它們寄出去(`packages/use-cases/src/sweep-email-outbox.ts:1038-1093`)。
🔵 曝險 = **`refunded` + 未取消 + 有 pending/failed 列**(同時已取消的仍被 OR 的另一半抑制)。
⇒ 📌 **⓪-a 與 ⓪-b 是兩群不同的單, 不是同一件事的兩種寫法** —— 一群沒有列, 一群有列而被壓著。

### 🔴 而封口的集合要【收窄】(R2-1 must-fix)

⛔ ~~補「全部 `refunded` 且無 outbox」的單~~ —— **那太寬**:
永遠維持 `refunded` 的、或**根本沒有真信箱**的單, 會被製造一筆假紀錄。
✅ **只封【真的有曝險】的子集** = 會被降回 `paid`(`v_moved = 0`)**且**通過收件人條件的那些。
🔵 判準直接沿用那兩支 view 自己的述詞, **不重寫一份** —— 📌 重寫一份就會分岔。

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
🔴🔴 **而關卡1 R2 推翻了上面那句「正常路徑到不了」—— 它是假的, 而它對。**
B/C 可以在「**退款建立之後、訂單狀態才漂移**」時**合法地**走到那裡 ⇒ helper RAISE ⇒ **整筆作廢 rollback**。
✅ **`-f8` 2026-09-05 裁【甲】= 照樣 fail-loud**, 理由:**它是錢** —— 一個「回成功而沒做事」的作廢, 之後沒有任何東西會叫。
🔴 **而訊息要講人話**(裁決時一併指定, 逐字):
> **「這張單狀態已漂移(現在是 X), 作廢沒有執行, 請找系統維護」**

📌 **為什麼這句話重要**:員工按下作廢、看到一個紅字 —— **他的第一個假設會是「我按錯了」**
⇒ 他會再按一次、換一個方式按、或以為系統壞了。**這句話要讓他知道那不是他的錯, 而且不要再按。**
⚠️ **而這一格【必須驗】, 不能靠推**:§7 有它的正負對照, **而且要從 B/C 真的呼叫**, 不是直接叫 helper。

### 🔴 B · `v_total = 0` 的單會被算成「已全額退款」

`v_moved >= v_total` 在 `v_moved = 0 AND v_total = 0` 時**成立** ⇒ 目標算成 `refunded`。
⇒ ✅ 所以 §1 的 CASE 第一格要寫 **`v_moved > 0 AND v_moved >= v_total`**。
⚠️ **而「有沒有 total=0 的單」我還沒查** —— 動手前先唯讀量一次(§7 驗收含這一格)。

### 🔴 C · 超退(`v_moved > v_total`)會被算成「剛好全退」, 而差額靜靜消失

關卡1 must-fix:卡退金額**明訂無上界**(`20260801120000:200-201`)
⇒ 總額 1,000 而帳本 1,200 時, `v_moved >= v_total` 成立 ⇒ 狀態 `refunded`
⇒ 📌 **看起來完全正常, 而 200 元的異常沒有任何人會知道。**

⛔ ~~修法照 `⟦PCM01⟧` 先例:`RAISE WARNING` + 讓它出現在紅格計數面~~
🔴🔴 **關卡1 R2 抓到:我引的那個先例【正好否定我的做法】。**
`20260902020000:1-15,211-229` **逐字**說 `WARNING` **員工看不到**、**不得與 UI／等價告警分開上線**
⇒ 📌 **一個沒有人看得到的 WARNING, 與沒有那個 WARNING 在行為上相同。**

✅ **`-f8` 2026-09-05 裁【丙】—— 不用 WARNING、也不做 UI, 改寫進小事故表。**
那就是 `⟦PCM01⟧` 先例要的「**等價告警**」⇒ **零 UI 工作, 而且不算分開上線。**

🔬 **而我沒有照轉述寫, 我自己量了(唯讀正式庫, 帶正負對照)**:
```
pcm_incident 表在嗎        true      ← 🟢 正對照 orders 在嗎 true · 🔵 負對照 現造表名 false
kind 的 CHECK 述詞          CHECK ((kind = 'pending_refund_open_failed'::text))
約束名                      pcm_incident_kind_check
```
⛔ **而表名不是轉述給我的那個** —— ~~`pcm_incident_log`~~ ⇒ ✅ **`public.pcm_incident`**。
📌 **舊字面留著加刪除線** —— 照那個名字寫 SQL 會 42P01, 而那個錯讀起來像「那張表還沒貼」。

🔴🔴 **而 `kind` 那個 CHECK 是【單值】, 不是 `IN` 清單** ⇒ 加一種 kind **必須 `ALTER`**:
```
ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
ALTER TABLE public.pcm_incident ADD  CONSTRAINT pcm_incident_kind_check
  CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total'));
```
🛑 **而那張表【不是我的】** —— 它住在 `agent/line-db` 上(commit `329f69fb0`), 我**只讀不改**。
⇒ **兩條路, 要 `-f8` 指一條**:①請 `-db` 去加那個值 ②片③ 內自己 `ALTER` 並在檔頭註明我動了別人的表。
⚠️ **而不管走哪一條, 順序都不可倒**:`ALTER` 要在第一次 `INSERT` 之前, 否則整筆取消被 CHECK 擋掉回滾。
⚠️ **帳本上沒有 `incident` 那一列**(`grep -c` = 0)—— 而**物件確實在正式庫上**(上面量到)
⇒ 📌 **那是帳本落後, 不是它沒貼** —— 照 `⟦01-LEDGERFALSENEG⟧` 那條, 帳本的 0 不是答案。
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

⛔ ~~修法:B/C 在鎖子表之前先取 `orders … FOR NO KEY UPDATE`~~
🔴🔴 **關卡1 R2:那句話【不可施工】** —— B/C 拿到的是**子列的 id**, 而 `order_id` **在那一列裡面**
⇒ **要先讀子列才知道要鎖哪一張 orders**, 而「先鎖 orders」正好要求相反的順序。

✅ **可施工的形狀 = 三步 + 一個不一致處置**:
```
① 無鎖預讀路由鍵   SELECT order_id INTO v_oid FROM <子表> WHERE id = p_id;   ← 不加 FOR
   IF NOT FOUND THEN RAISE …;                                              ← 查無要叫
② 鎖 orders        PERFORM 1 FROM public.orders WHERE id = v_oid FOR NO KEY UPDATE;
③ 鎖後重讀子列     SELECT * INTO v_row FROM <子表> WHERE id = p_id FOR UPDATE;
④ 🔴 兩次讀值不一致 ⇒ v_row.order_id <> v_oid ⇒ RAISE, 不要自己修正
```
🔴 **④ 那一格為什麼是 RAISE 而不是「重來一次」**:`order_id` 換人 = 有人把一筆退款搬到別張單上,
**那不是併發, 那是資料異常** ⇒ 重試只會讓它安靜地成功。
🔵 而 ① 的無鎖預讀**讀到舊值是正常的** —— ③ 會在鎖之後重讀, ④ 負責抓分歧。
⚠️ **射程**:這個形狀擋的是「鎖序」;它**不保證** ① 與 ② 之間那張單沒有被別人改
—— 那由 ③ 之後的既有守門負責, **本片不改它們**。

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

### 🔴 而【真正的分母】是這個(關卡1 R2 量的, 我原本連分母都沒寫)

> 非測試的 `apps/` + `packages/` 底下,`payment_status` **字面命中 65 檔**;
> **剝掉純註解之後, 仍有 30 檔是程式在讀它。**

📌 **⇒ 我原本寫的「五支 view + 三處」不是分母, 是【我找到的那幾個】。**
🔵 **而 R2 同時訂正我一件事**:`SupabasePaidOrderScannerAdapter` **是那支 view 的 cutoff 下游,
不是另一條獨立的寄信路** —— 與我 §5c 開檔讀到的一致 ⇒ **§5b 表格裡那一列的描述要照這句修。**
🛑 **⇒ 動碼之前要把那 30 檔逐一過一次**, 而**不是**再找幾個補進表格裡。
⇒ 📌 **「又想到一個」與「掃完了」是兩種宣稱, 而前面每一輪我交的都是前者。**

🛑 **而「今天 0 張」不等於「這個風險不存在」** —— 上面那張表講的是**機制**,
而機制在**下一張符合形狀的單出現時**就會生效。⇒ **修法要照機制做, 不是照今天的張數做。**

### ⇒ 本片因此多一件事(納入 §1)

`pcm_order_created_email_pending` 那一列**要處理**。
✅ **主視窗 `-f8` 2026-09-05 裁【甲】** ⇒ 做法寫在 §1 ⓪。
⛔ **乙**(view 加「早於信箱系統上線」的排除)**駁回**:那是**改 view 的語意**,而語意會漂 ——
   一條為了這件事加上去的排除, 半年後沒有人記得它為什麼在那裡。
⛔ **丙**(不處理)**駁回**:今天 0 張, 而**那是把一件【對外不可回收】的事交給時間**。

---

## §5c cutoff 掃描器那一格 —— 查完了, 而**它早就有一道專門擋這件事的閘**

**做法**:開檔讀 `packages/adapters/src/email/SupabasePaidOrderScannerAdapter.ts`, 不轉述。

它讀的就是 `pcm_order_created_email_pending` 那支 view, **而它多加兩個 cutoff**(`:222-224`):
```
.gte('paid_at',    input.cutoff)
.gte('created_at', input.cutoff)
```
🟢🟢 **而它自己的註解逐字寫著那第二個 cutoff 為什麼在**:

> 🔴 **兩個都要**:少了 `created_at` 那一半, **晚翻 paid 的舊單會被誤寄**(PRD §5 R3)

🎯 **⇒ 「晚翻 paid 的舊單」正是片③ 會製造的東西** ——
而**那道閘是別人為了別的理由先寫好的**, 它擋得住我們這一發。
🔵 一張被降回 `paid` 的舊單, `created_at` 與 `paid_at` **都不會變** ⇒ 兩個 cutoff 都把它濾掉。
🔵 cutoff 有下界 `EARLIEST_SANE = 2026-08-30T00:00:00+08:00`(`packages/use-cases/src/shipped-email-cutoff.ts:74`)
   ⇒ 它不會被設成一個古老的時點而讓全部舊單湧進來。

### 🔴 而【殘餘的窗口】仍然存在, 寫清楚

cutoff 擋的是**舊單**。擋不住的形狀 = **「`created_at` 在 cutoff 之後、而 outbox 裡沒有 `order_created` 那一列」**
—— 也就是**當初該寄而沒寄成功**的那些。它們被降回 `paid` 之後會**重新合格**。

✅ **而 §1 ⓪ 的封口正好蓋住這一格** —— 它補的就是「`refunded` 且 outbox 無 `order_created`」的列。
⇒ 📌 **兩層是互補的, 不是重複**:cutoff 擋**時間上舊**的, 封口擋**時間上新而漏寄**的。
⇒ ✅ **所以 `-f8` 裁的甲不只是保險, 它是這一格唯一的解。**

⚠️ **未驗**:我**沒有**實跑那支掃描器去看它對一張降回 `paid` 的單會怎樣 ——
上面是**開檔讀出來的**(檔案:行號都在)。⇒ 📌 **這是「讀到的」不是「量到的」, 已列進 §7。**

---

## §6 Rollback

1. 把 `pcm_sync_order_refund_payment_status` / `admin_void_manual_refund` /
   `admin_correct_order_refund_verdict` **三支各自的上一代原樣再貼一次**(全是 `CREATE OR REPLACE`)。
   座標:`20260905010000:244` · `20260820100000:292` · `20260814190000:191`。
2. 🔴 **而回滾之後回到今天**:作廢一筆退款之後狀態**降不回去**, 而那正是本片要修的東西。
3. 🔴🔴 **⓪ 那批列 rollback 也要處理**(R2 must-fix:原本完全沒寫):
   · **⓪-a 補出來的列** ⇒ **刪掉**(它們是本片造的, 不是歷史)。
   · **⓪-b 被改成 `skipped_no_real_email` 的列** ⇒ **改回原本的 `pending` / `failed`**
     ⇒ 🛑 **所以 ⓪-b 必須把【原本的態】留下來**(寫進 `payload`), 否則回滾時**分不出誰是誰**。
   ⚠️ **而那批列不刪也不還原的話, 那些信【被永久抑制】** —— 回滾了規則, 而信仍然寄不出去。
4. 🛑 **回滾【不會】把已經被降回 `paid` 的單改回 `refunded`** —— 那些是**照事實**改的,
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
7. **通知信**:掃**五支**寄信 view 對 `payment_status` 的述詞, 答「降回 `paid` 會不會排出新的信」。
   🔴 **對外不可回收 ⇒ 這一格沒答出來之前不得 commit。**
8. 🔴 **上線【前】重量 B/C/D 三格**(§5b 那三個數)——
   今天是 0,而**那是 2026-09-05 那一刻的讀數**;中間可能長出新的。
   ⛔ ~~而 ⓪ 封口印的「封口 N 張」與這一格的重量必須【對得上】~~
   🔴 **關卡1 R2:那樣會【誤紅】** —— B/C/D 與封口**不是同一個集合**
   (B 要「實際退款額 = 0」;C/D 又各加取消／信箱條件;⓪ 收窄後又是另一個子集)
   ⇒ 📌 **要求兩個不同集合的計數相等, 紅的時候紅在【對的系統】上。**
   ✅ 改成:**各自印各自的數**, 而斷言的是「**每一個數都 ≥ 0 且封口 N ≤ B**」這種**包含關係**,
   並把四個數**一起寫進 migration 的 NOTICE**, 讓人看得到而不是讓機器誤判。
9. 三綠(`.sql` 對三綠零判別力 ⇒ **另跑 `scripts/migration-static-checks.sh`**)。
10. **第三段帳本(§1 ①)**:造一筆 `failed + manual_failed` 而更正為 `money_moved` 的卡退
    ⇒ 它**必須被算進 `v_moved`**;負對照 = 更正為別的值 ⇒ **不算**。
11. **超退(§3-C)**:帳本 1,200 而總額 1,000 ⇒ **要有 WARNING**, 且狀態仍是 `refunded`;
    🔵 並答出「哪一支紅格計數面收得下這個訊號」(**目前未查**)。
12. **另外三個消費端(§5b)**:cutoff 掃描器 / 缺信計數 / stuck 告警 —— **各答一次**
    「新的 `paid` 進來之後它會做什麼」, 附 `檔案:行號`。
    🟢 **cutoff 掃描器那一格【已經答了】—— 見 §5c。**
13. **TS 合約(§1 ④)**:`state-machine.ts` 的 `refunded` 允許集要含 `paid`,
    且該檔既有測試的**負向斷言**(「`refunded → *` 一律 throw」)要跟著改;
    🔴 **改完跑那支測試, 比四個數**(鐵則 11)。
14. 突變 —— 🔴 **關卡1 R2:原本寫「每一道新守門」而【沒有列分母】⇒ 可以用 0 道突變交卷。**
    ✅ 改成:**先列出這一片新增的守門清單(逐條編號)**, 再逐條突變, **報「N 道全部各紅一次」**。
15. ⓪ 封口那一步的**負對照** —— 🔴 **R2:原本那格可能由既有 `(event_type, dedup_key)` UNIQUE 代答**
    (它本來就會擋第二列)⇒ 那不是我的守門在做事。
    ✅ 改成:**突變封口的 selector 本身**(例如把收窄條件改成恆真)⇒ 斷言
    ①migration 仍然成功 ②**受影響列數變成一個【錯的數】** ⇒ 那才證明 selector 有作用。
16. **後台 UI**:封口那批列在稽核頁顯示的是「**沒寄(沒有真的信箱)**」而**不是**「已寄出」
    —— 這一格 §8 之前寫「已列進 §7」而**實際上沒有**(R2 nit), 現在補上。
17. 造一張「`refunded` 且 outbox 已經有 `order_created`」的單 ⇒ **它不可以被補第二列**。

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
