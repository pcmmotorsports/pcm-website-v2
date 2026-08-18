# `#473(b)` plan v1 —— `manual_failed` 的更正出口

> ~~**狀態:等 Sean 批**(鐵則 8:動 schema)。R 窗 2026-08-14。~~
> **↑ 這行 2026-08-19 標作廢(不刪,留痕)。現行狀態見下面三格。**
>
> # 🔴🔴 狀態(2026-08-19 G6 查核 + Sean 本人答覆之後的**誠實版**)
>
> ### ① 這支 migration **已經被記為 apply**,2026-08-14
> ```
> supabase/APPLIED.tsv:191
>   20260814190000  10e17ac8bf4be93a6149e3ab712b94cf9383444d4078d866001767a84826d826  2026-08-14  主視窗-eca254fb
> 函式本體 supabase/migrations/20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:191
>   CREATE FUNCTION public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)
> ```
> ⚠️ **而「已記為 apply」不等於「正式庫真的有」** —— 那不是我加的限定,是**帳本自己寫的**
> (`supabase/APPLIED.tsv:7` 逐字):
> > 「🔴 **它是自陳帳**:這個檔證的是「**有人記下他 apply 了**」,**不是**「正式庫真的有」。」
>
> ### ② 🔴 「Sean 有沒有批准」—— **帳本答不出來,因為它沒有那個欄位**
> `APPLIED.tsv:3` 逐字:「一行一支,**四欄**以 TAB 分隔:**版本號 / 檔案 sha256 / apply 日期 / 由誰記**」
> ⇒ 四欄裡**沒有一欄是「批准者」**;第四欄 `主視窗-eca254fb` 是「**由誰記**」,連「由誰 apply」都不是。
> ⇒ **「誰批准」與「誰 apply」在這個帳本裡沒有欄位分得開。**
>
> ### ③ 🔴🔴 Sean 本人 2026-08-19 逐字答:**「你去查吧～我忘記了」**
> ⇒ **這一格【永久未確認】。它不會再有答案。**
> ⇒ **不要寫成「已批准」,也不要寫成「未批准」。**
> ⇒ 🔴 **不要再問他第三次** —— 已經問過,答案就是「忘了」。再問只會讓他在沒有記憶的情況下補一個答案上去。
>
> ### ④ 而應用層那半**還沒有人接**(這一格是量到的)
> ```
> admin_correct_order_refund_verdict 產品側呼叫端 = **0**
>   分母 全樹 12,608 支 .ts/.tsx/.js/.mjs/.py/.sh(排 node_modules/.git/migrations/database.types.ts/測試)
>   僅有的命中在 scripts/473b1-concurrency-probe.sh(驗證 harness,**不是產品接線**)
>   負向對照(同尺同分母)admin_initiate_order_refund ⇒ **142 命中** ✅
> ```
> ⇒ **員工今天按不到這個更正入口。**
> ⚠️ 「產品接線 = 0」**不等於**「員工按不到」的完整證明 —— 中間還有路由/權限/畫面,我一格都沒驗;
>   但**零 import** 已經足以說明「沒有人接手做那一半」。
>
> ### ⑤ 🔴 動這份 plan 之前先讀這一條(它會改變你做什麼)
> `20260814190000:387-388` COMMENT 逐字:
> > 「`corrected_to=money_moved` **不會**讓該筆變 confirmed …… **`orders.payment_status` 不受影響(`#497`)**」
>
> ⇒ **接上這個 UI 的那一刻,員工就能按出一筆「錢有動、而客人的訂單頁永遠寫『處理中』」** ——
>   那是 `#497` 描述的**永久錯誤狀態**,而且是**設計出來的路徑,不是邊角**。
> ⇒ 🔴 **`#473` 的 UI 接線與 `#497` 必須同一批做。先接這個 = 親手製造 `#497`。**
>
> 📎 完整查核寫在 `docs/phase-1-backlog.md` 的 `### #473.` 與 `### #497.` 段。
> **刻意短。** 本檔不重複 `#473` backlog 條目(`docs/phase-1-backlog.md`,搜 `### #473.`;**行號刻意不寫死**——那份檔天天在長)已寫的問題描述與痛點。
> `#473(a)`(文案誠實化 + `revalidatePath`)已收工 = commit `4caf73bb`;**它沒有解掉本條**。

---

## §1 一句話

**`order_refunds` 的人工判定判錯之後,員工要有一個動作能更正它;舊列一個字都不改。**

## §2 為什麼是這個形狀(三條實查,不是推的)

1. **狀態機不能放寬** —— `supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:211-215` 逐字只允許 `processing → confirmed/failed/deferred`,**三終態轉出一律 RAISE**;`:218-219` COMMENT 自我定位「**DB 層硬防線**」。且該函式體**只讀 `status`**、零 `failed_reason` ⇒ 想只放寬 `manual_failed` 做不到,會**連 `rejected_out_of_range` / `not_sent` 一起打開**。
2. **就地改 `failed_reason` 技術上做得到,但那是改帳** —— 同檔 `:391` COMMENT 逐字「**刻意留可變:status / failed_reason / failed_detail(NULL→值)**」⇒ UPDATE 守門不擋改 `failed_reason`。**能改不代表該改**:改掉之後「當初判了什麼、誰改的、為什麼」全部消失。
3. **姊妹帳本已經有現成形狀,抄它** —— `admin_correct_refund_manual_verdict`(`supabase/migrations/20260812140000_m4b_lifecycle_refund_manual_reversal.sql:572` 定義 / `:726` COMMENT):**一交易寫兩列(沖銷 + 新判定)、舊列不動、CAS 防併發、員工面只看到「修改判定」一個動作**。同檔 `:284` 逐字寫著「要改判定請走 `admin_correct_refund_manual_verdict`」。
   ⚠️ **它動的是 `payment_refund_events`,不是 `order_refunds`** —— 抄的是**形狀**,不是那支函式。`payment_refunds` 與訂單退款帳無關已由 `#445` plan `§0-A` 開檔複驗過。

## §3 三個做法(**Q-473-2 要 Sean 拍**)

| | 做法 | 代價 |
|---|---|---|
| **A(R 窗推薦)** | **新開一張小表** `order_refund_manual_corrections`(append-only,一次更正一列,`refund_id` FK + `actor` / `reason` / `corrected_to` / `created_at`,partial unique index 保「至多一筆有效更正」) | `order_refunds` **一個字都不動**(不動狀態機、不動 CHECK、不動既有欄);rollback = `DROP TABLE`。**代價**:多一張表要 join,`#443`「異常清單只讀一本帳」的家族再 +1 |
| **B** | `order_refunds` **加欄**(`corrected_at` / `corrected_to` / `corrected_by` / `corrected_reason`) | 少一張表。**代價**:`ALTER TABLE` 動 live 金流表(要 `lock_timeout`,先例 `20260725130100:68-72`);且一列只能被更正一次,更正的更正無處可放 |
| **C** | 就地 UPDATE `failed_reason` | 最小 diff。**代價**:改帳、無稽核軌跡、且**解不掉「其實錢動過了」那個方向**(那要轉 `confirmed`,狀態機擋死) |

**推薦 A。** 理由:本片的整個存在理由是「人會判錯」,那就必須留下「判錯了、誰改的」;C 把這件事刪掉,B 只留一次。

## §4 片界

| 片 | 內容 | 鐵則 | 估 |
|---|---|---|---|
| `473b-1` | migration:建表 + ACL(REVOKE ALL、只開 `service_role`)+ 更正 RPC(抄姊妹七道守門:隔離閘 / actor / 輸入驗 / 鎖父列 `FOR NO KEY UPDATE` / 鎖後重讀 / **CAS** / 寫入 row_count 守)+ 負測 | **8 + 12①③** | 90-140 分 |
| `473b-2` 🏁**已做** | 異常清單納入被卡的列 + 列級顯示。**寫本 plan 時**的現況 = `refund-read.ts` 的 `listRefundExceptions` 只有一支查詢、硬綁 `.eq('status', 'processing')`(行號刻意不寫死,見 §4-1) | 12① | 估 35-50 / **實際約 2 小時**(兩關審查 12 條 must-fix) |
| `473c` | 後台「修改判定」入口(UI)+ 與退款紀錄區塊的「哪個是現況」顯示 | 12① | 60-90 分 |
| `#445b` 連動 | 守門式的「佔額度」判準要認得更正列 —— **寫進 `445b`,不在本片** | — | 併入 445b |

🔴 **`473b-2` 不能省、也不能排在 `473c` 之後**:出口做出來但**沒有任何畫面會顯示那一列**,等於沒做。(寫本 plan 時卡住的列不在任何清單裡 —— 清單只查 `processing`。)

### §4-1 🏁 `473b-2` + `#483` 已完成(2026-08-14):清單與訂單頁**兩邊都看得見了**

- ✅ 已做:異常清單納入卡住的列(**兩支獨立查詢**,不是加寬一支 —— 合成一支會讓 ②類累積後餓死 ①類,關卡2 codex must-fix)、卡住的列**零按鈕**、文案敘述「當初的判定」而非「錢的狀態」。
- 🏁 **`#483` 已補做(2026-08-14,同日)**:訂單頁帳本區塊對卡住的列掛**第二顆徽章**,措辭與可處理那顆**刻意不同**(那顆說「待對帳處理」=有事可做;這顆說「這裡沒有可以改的動作,需要更正請聯絡工程師」)。
  **原本的痛點**:員工從訂單頁看不出這筆退款已被列管,只有主動去開異常清單才知道 —— 而異常清單是「值班才會開」的頁面,訂單頁才是他每天在看的那頁 ⇒ 兩邊說法不一致時他會相信訂單頁。
  **兩個判定式刻意不合併**(`isRefundException` / `isStuckManualVerdict`):前者代表「這列**可以按**對帳判定」,後者代表「這列**沒有動作可按**」—— 併成一顆 boolean 會讓兩種列長得一樣,而它們該做的事完全相反。

## §5 驗收(逐條 yes/no)

1. ☐ 更正一列 `manual_failed` 之後,**原列的每一個欄位逐欄比對前後相同**(不是「看起來沒變」,是 `SELECT to_jsonb(r) FROM order_refunds r WHERE id=…` 前後 diff 為空)。
2. ☐ 兩個交易同時更正同一列 ⇒ **後到者失敗**(CAS),不是兩邊都回成功。**負測要真的並發**,不是循序跑兩次。
3. ☐ 同一列更正兩次(序列) ⇒ 依 `Q-473-1` 的語意判 yes/no;partial unique index 的**負測**要能單獨紅。
4. ☐ ACL:`anon` / `authenticated` 呼叫 ⇒ 拒;`service_role` ⇒ 通。**正負各一發。**
5. ☐ **`473b-2`**:被更正過的列與**未被更正但卡住**的列,**都出現在異常清單**,且員工看得出差別。
6. ☐ **`473b-2` 的反向**:一列 `manual_failed` **在做任何更正之前**就要看得見 —— 這格證的是「看得見」不依賴「有出口」。
7. ☐ 三綠(動 `.sql` 走語法守門;動 `.ts` 加 build)。
8. ☐ 兩關審查都跑(鐵則 12① 錢 ⇒ **不降級**):`code-reviewer` + `codex-adversary` 審 diff。

⚠️ **放寬類改動的紀律**:`473b-2` 是「把清單條件放寬」。**放寬會讓格子綠、沒人會發現** ⇒ 改完必須回跑「原本會紅的那幾發」(既有 `refund-read` 相關測試全跑,不只跑新增的)。

## §6 風險與 rollback

- **rollback**:A 案 = `DROP TABLE public.order_refund_manual_corrections` + `DROP FUNCTION`;**`order_refunds` 無任何改動 ⇒ 沒有資料要回填**。這是選 A 的主要理由之一。
- 🔴 **apply 順序**:migration 未 apply 前**應用層不得上線**(memory `feedback_app-layer-must-not-ship-before-migration-apply`,08-07 正式站壞 8 小時)。`473b-2` / `473c` 都在 apply 之後。
- ⚠️ **`#445b` 的硬前置在 apply 之後才解除**,不是 commit 之後。plan v8 `§5-445b-8` 逐字「`#473` 沒有出口之前不得 apply 445b」。

## §7 🏁 兩題已拍(2026-08-14 Sean,**都照 R 窗推薦**)

| 題 | 拍板 | Sean 知情下接受的代價 |
|---|---|---|
| `Q-473-1` | **A = 最新一筆說了算**(可更正的更正) | 沒有「最終版」概念,要看歷史才知道經過 |
| `Q-473-2` | **A = 新開一張小表** | rollback = `DROP TABLE`;不動 `order_refunds` 這張 live 金流表 |

⇒ **`473b-1` 的 plan 已另檔寫成**:`docs/specs/2026-08-14-473b-1-correction-table-plan.md`(**等 Sean 批,未實作**)。
⚠️ 下面的原始題文保留當時字面,**不要拿它當現行狀態** —— 現行狀態是上表。

### §7-舊 當時給 Sean 的題文(存證,勿引用為現況)

```
Q-473-1:更正之後,「有效判定」怎麼認?
A. 最新一筆更正說了算(可以更正的更正)。優點:人再判錯還有救。代價:要顯示「這列被改過 N 次」。
B. 只准更正一次(partial unique index 鎖死)。優點:語意最簡單、畫面只有兩種樣子。代價:改錯了就又卡住,回到今天。
R 窗推薦 = A。理由:本片存在的前提就是「人會判錯」,而 B 假設人只會判錯一次。

Q-473-2:用哪個做法?(細節見 plan §3 表)
A. 新開一張小表,order_refunds 一個字都不動。
B. order_refunds 加四個欄。
C. 就地改 failed_reason(最小,但改帳、無軌跡、解不掉「其實錢動過了」那個方向)。
R 窗推薦 = A。
```

## §8 誠實缺口(**只收構造不出來的**)

1. 🔴 **「員工判錯的方向分布」我沒有資料** —— 本片假設兩個方向(判成沒動錢但其實動了 / 反過來)都要能更正。**這是我推的**,沒有實例。若 Sean 認為只有一個方向會發生,片會小一半。
2. ⚠️ **`Q-473-1` 選 A 時的畫面**(一列被更正多次要長什麼樣)**本檔沒有設計** —— 那是 `473c` 的事,且屬品味題 ⇒ 產圖給 Sean 看,不用文字選項。
3. ✅ **不是缺口的**:並發、ACL、稽核軌跡都在 §5 有可構造的負測 —— **不得拿「誠實缺口」豁免它們**。

---

— R 窗十六代 · `#473(b)` plan v1
