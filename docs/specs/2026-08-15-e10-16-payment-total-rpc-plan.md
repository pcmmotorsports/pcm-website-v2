# `#16` MF-A 修法 plan —— 今日實收改走 SECDEF RPC

> **狀態(2026-08-15 09:5x 重寫;下面那行是它原本的樣子)**:
> migration **已寫、已 apply 到正式庫(09:3x,Sean 親手)**、**codex 關卡2 已跑 = `PASS` 零 must-fix**。
> **剩下**:型別重 gen(`Q-讀型別` Sean 已准)→ 三綠 → commit。**未 push。**
> ⚠️ ~~「等主視窗看過 → 等 Sean 回核(鐵則 8)。**尚未動手寫 migration。**」~~
> **← 這行從頭到尾都是「世界的狀態」,每一段都過期了,而它長得像一個正常的狀態列。**
> 見 memory `feedback_status-file-fixed-fields-hide-stale-claims`:**欄位只要格式對就讀起來對。**
> **來源**:R2 reviewer MF-A;Sean `Q-16A = A`(逐字「A」)=走修法①新開 RPC,**不是**砍掉那一格。
> **作者**:A 窗 `void-readers`。本檔所有 `檔案:行號` 都是我自己開檔查的,不是轉抄 reviewer。

---

## §0 🔴 三段「本來要寫在 migration 檔頭」的更正 —— 為什麼住在這裡

**因為那支 migration 已經 apply 了,而已 apply 的 migration 連註解都不能動。**

機制:`supabase/APPLIED.tsv` 為每支已上庫的 migration 釘 sha256
(規則出處 `docs/runbooks/night-run-command-playbook.md:85`,2026-08-13 D 窗實測撞到)。
**2026-08-15 09:5x 實測全帳對帳:171 支雜湊零漂移**(**基準時點 = 加入 08-15 兩列之前的帳,故分母 171 而非 172**;
`20260815010000` 與 C 窗 `20260815020000` 當時都還沒登)⇒ 這不是空條文,是被維持了 171 次的紀錄。

🔴 **事故經過(留著,因為它會再發生)**:09:3x apply 成功 → 主視窗要我改檔頭那句過期字面 → **我改了(09:28:35)**
→ 收工前自查才發現撞規則 → **已還原**(`sha256 = d630272f…`)。

⚠️ ~~「已還原成 **apply 當下的內容**(`sha256 = d630272f…`,**逐字複驗對上**)」~~
**← 08-15 10:0x 作廢(觸發 = E 窗指出這句是循環論證)。兩個毛病,分開講:**

1. **「apply 當下的內容」是推導,不是觀測。** **沒有任何人在 09:3x 對那個檔按過 `shasum`。**
   我知道的只有時序(你報 apply 成功的信先到,我 09:28:35 才編輯)+ 全機器只有一份該檔。
2. 🔴 **「逐字複驗對上」是循環的** —— **我拿還原檔去對還原檔,它當然對得上。**

**能證的上界(這句才是可觀測的)**:
> **現況檔 == 我 09:47 產生的那份 scratchpad 還原檔,逐位元組相同(`sha256 = d630272f…`)。
> 而那份還原檔 == 我逆轉自己三次編輯的結果 —— 那三次編輯的原文我手上有,但「它就是被 apply 的那一份」仍是推的。**

**證不到的**:`== 被 apply 的那一份`。唯一的硬來源是 Sean 的終端機或
`supabase_migrations.schema_migrations` 的 `statements` 欄,**兩個施工端都拿不到。**

✅ **爆炸半徑仍然有界,而且這條是量出來的**:還原檔與編輯版的**非註解行差異 = 0**
⇒ **無論被 apply 的是哪一版,DB 語意都相同。** 分歧只可能在註解字面。
**主視窗裁「甲」並認錯,通則落檔:指揮者派的「小動作」最容易繞過守門,因為它不長得像高風險 ——
「只改註解」是體積,不是風險等級。**
⇒ **以下三段是原本要進 migration 檔頭的內容,一個字沒掉,只換載體(`.md` 不在雜湊守門範圍)。**

### §0-1 apply 已發生,而它證明了什麼、沒證明什麼

✅✅ **2026-08-15 09:3x:Sean 已把 `20260815010000` apply 到正式庫,成功。**
終端機逐字:`Applying migration 20260815010000_…sql` → `Finished supabase db push.`
(`--dry-run` 先跑過,清單只有本檔 + `20260815020000`,無夾帶。)

🔴 **檔尾那組閘是 fail-closed —— 任一條紅,整支 apply 就中止。**
⇒ **apply 成功 ⇒ 它們已在正式庫的 owner / ACL / 既有資料下跑過而且過了。**
**這不是推的:「它沒中止」這個可觀察事實推不出別的結論。**

⚠️ **量詞校正**:習慣講的「五道閘」是**五個檢查主題**(①-⑤,③ 另有子項 ③b),
**實際的 `RAISE` 是 11 條**(`grep -nE 'RAISE (EXCEPTION|WARNING|NOTICE)'`,全 EXCEPTION、零 WARNING/NOTICE,
同在一個 `DO $gate$` 區塊)。**結論不變,但別拿「五」去對程式碼裡的條數,對不上。**

❌ **範圍到此為止,不要擴張**:**仍不證**
`select has_table_privilege('service_role','public.order_payments','SELECT');` 的實際值,
**也不證 `42501` 真的消失**。⇒ **`#502` 那份清單不因本次 apply 結案。**

### §0-2 「本檔零正式庫驗證」那句已作廢,但兩層的分法仍有效

migration 檔頭 `:65` 寫著「🔴 **本檔零正式庫驗證**」、`:69` 寫著「仍不證:正式庫的 owner / ACL / 既有資料下也過」。
**兩句都在 apply 之前為真,09:3x 之後為假。**(檔內不能改,故更正寫在這裡。)

**縮小後的真實剩餘**:
- ✅ **已證**:那組閘在正式庫成立(見 §0-1);另有 08-15 本機拋棄式 PG 17.10 證 `STRICT` 語意 + **突變對照證「閘會紅」**。
- ❌ **仍不證**:`42501` 真的消失 —— 需要正式庫連線,**施工端沒有**,出口是 `#502`。

⚠️ **檔頭 `:73-75` 那段仍然成立、不需要更正**:
「施工端無 DB 連線 ⇒ 不證 apply 得過」的**前半是環境事實、後半是假的推論** ——
引擎行為本機測得到,真做不到的只有正式庫的**狀態**。地圖見 `~/pcm-mailbox/A-043-STOP.md`。

### §0-3 🔴 rollback:檔頭 `:79` 那句現在會害人估錯撤退成本

migration 檔頭 `:79` 逐字:

> **還沒 apply ⇒ 刪檔 + `git revert`,DB 一個位元組沒動。**

🔴 **這句 09:3x 之後是假的,而且它假得最貴 —— 它誤導的不是「事情做完沒」,是「撤退要付多少錢」。**
照它估的人會刪檔 revert,**而 DB 上那支函式還在,沒有人知道。**

⇒ **現在唯一成立的是本檔 §5a 的(乙)**:先退應用層、再 `DROP FUNCTION`(完整順序見 §5a,不在此複述)。
**任何人不得再照 migration 檔頭 `:79` 估 rollback 成本。**

⚠️ 判別句(這輪抽出、主視窗採用為紀律):
> **這句描述的是「本檔的內容」,還是「世界的狀態」?**
> **後者只要世界一動就假,而檔案不會有任何 diff 提醒你。**

---

## §1 問題(我自己複驗過的部分)

`apps/admin/src/lib/dashboard/today-read.ts:110` 用 service client 直接 `.from('order_payments')`。

| 查的東西 | 證據 | 結論 |
|---|---|---|
| `order_payments` 對 service_role 的表權 | `20260810100000_m4b_e10_op1_order_payments_m.sql:410` 逐字 `REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role, authenticator;` | **零表權** |
| 有沒有別處補回來 | `grep -rn "GRANT" supabase/migrations/*.sql \| grep order_payments` ⇒ 命中全是 COMMENT 字串 / RAISE 訊息 / **函式** EXECUTE,**零一句表級 GRANT** | 沒有 |
| 官方說法 | `20260811090000:123` COMMENT 逐字「order_payments 對每個非 owner 角色的 SELECT 都是 false(零表權、零 RLS policy)⇒ **不經本支讀不到**」 | 一致 |
| 對照組 ① | `20260725130100_m3_rf2a2_order_refunds_ledger.sql:324` `GRANT SELECT ON TABLE public.order_refunds TO service_role;` | **退款那支沒事** |
| 對照組 ② | `20260611120000:18` 逐字「REVOKE INSERT/UPDATE/DELETE/TRUNCATE FROM service_role(**保留 SELECT**)」 | **新單那支沒事** |

⇒ **四個查詢裡壞的剛好是管錢那一個。** 上線後 payments 回 `42501` → throw → `page.tsx` catch
→ **四格全變失敗卡,每次、永久**,而現有 36 格測試(全 mock)照樣綠。

🔴 **病根**:plan §1 抄的是 `refund-read.ts` 的**形狀**,沒查 `order_payments` 自己的 ACL ——
**拿相鄰的東西當成要問的那個東西**(memory `feedback_blocker-must-prove-scenario-reachable-first` 的上位形狀)。
`order_refunds` 有 GRANT、`order_payments` 沒有,而它們在我眼裡「長得一樣」。

## §2 為什麼不能對表補 GRANT(這條我開檔驗過,不是推測)

同檔 `:690-701` 有 **apply-time 閘**:掃 `pg_class.relacl`,只要出現 owner 以外的 grantee 就
`RAISE ... ERRCODE 'P2B20'`(constraint `pcm_op1_acl_extra_grantee`)。
⇒ **對表補一句 `GRANT SELECT` 會讓那份既有 migration 在下次 apply 時整份炸掉。**
⇒ 新權限**只能是新 migration 裡對「函式」開 EXECUTE**,不是對「表」開 SELECT。

## §3 修法:新開一支 SECDEF RPC(形狀抄 house,不自創)

**migration 版本號 = `20260815010000`**(主視窗 2026-08-15 發;檔名
`20260815010000_m4b_e10_16_admin_today_payment_total.sql`)。
發號量法:主樹與三個 worktree 的最新號皆 `20260814190000`;我自己複驗
`ls supabase/migrations/ | grep -c "^20260815"` = **0**、信箱佔位宣告零命中。
⚠️ **這是下限不是保證** —— 只存在於 remote、本機無對應 branch 的號掃不到。
🔴 **`20260815020000` 已保留給 C 窗的 D1,不是我的號,不得使用。**

🔴 **本片一併處理 R2 nit7**(失敗卡要講出是哪一格掛了)。
理由:要知道哪一支掛,得把 `loadTodaySummary` 的三道 `throw` 改成逐支收集錯誤 ——
而那正是 §3.3 要改寫的同一段。分兩片做 = 同段程式改兩輪、審兩輪。
**寫在這裡而不是只寫在信裡,免得它蒸發。** 對應驗收條件見 §6-9。

**前例**:`admin_list_order_payments(uuid)`(`20260811090000:100-140`)—— 同一張表、同樣的存在理由。
照抄它的五件事:`SECURITY DEFINER` / `search_path=''` / 逐個點名 `REVOKE` /
`GRANT EXECUTE TO service_role` / 檔尾結構斷言。

### 3.1 簽章(**我的判斷,理由在下面**)

```sql
public.admin_today_payment_total(p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (total bigint, row_count bigint)
```

- **不叫 `admin_today_*` 的「today」語意進 SQL** —— 日界換算留在 TS(`today-view.ts` 已經是唯一真相),
  RPC 只收一個**半開區間**。SQL 端不需要知道「今天」是什麼,也就不會有第二份日界規格。
  (reviewer 建議的 `(from, to)` 我同意;只把 `p_` 前綴與型別對齊 house。)
- **回兩欄不是一欄**:`row_count` 是 `amountsTruncated` 的替代品 —— 見 §4。
- `bigint` 不是 `int`,而且**這條是查過的**:`20260810100000:199` 逐字
  `amount integer NOT NULL CHECK (amount <> 0)` ⇒ 欄本身是 `integer`,
  而 Postgres 的 `SUM(integer)` **回傳型別就是 `bigint`** ⇒ 簽章寫 `bigint` 既正確又順帶擋掉溢位。
  (我原本在這裡寫「house 金額欄本來就是 bigint、未確認」—— **那是猜的,而且猜錯了**。
  一個 grep 就能解掉的東西不該掛「未確認」:誠實缺口只收構造不出來的,不收懶得查的。)

### 3.1a 🔴 零筆時 `SUM()` 回 **NULL 不是 0**(主視窗 must-fix,成立)

**這不是邊角案例,是每天早上的常態** —— 今天第一筆收款進來之前,收款筆數就是 0。

| 端 | 零筆時 | 依據 |
|---|---|---|
| 現行 TS | **`0`** | `today-view.ts:56` `rows.reduce((total, r) => total + r.amount, 0)` —— reduce 帶初始值 |
| 改成 RPC 後的 SQL | **`NULL`** | SQL `SUM()` 的定義 |

⇒ 不處理的話 `total` 會是 `null`,**回歸掉 `#16` 第一輪就通過的驗收條件⑥**(零資料顯示 0、無 `NaN`/`undefined`),
而 36 格測試因為 mock 一定餵得出數字 ⇒ **照樣全綠**。

**修法:`COALESCE(SUM(amount), 0)::bigint`。** 這是 house 既有寫法、我原本是在偏離它 ——
`20260523034911:129`、`20260725130100:218`、`20260803150000:776` 各有一處同形。

**TS 端型別 = `number`(不是 `number | null`),理由**:
讓「不可能是 null」這件事**有一個守得住的地方**(SQL 端的 `COALESCE` + 下面的守門),
而不是兩端各做一半防禦 —— **兩邊都防 = 沒有人真的負責**,而且 TS 端一旦寫成 `number | null`,
就會長出一個 `?? 0`,那顆 `?? 0` 會把「RPC 真的壞了」偽裝成「今天沒收到錢」。
🔴 **保證要有機制、不能只有約定**:`today-read.test.ts` 加一格**源碼契約測試**,
`readFileSync` 讀 migration 檔、斷言含 `COALESCE(SUM(amount), 0)` —— 本機無 DB 連線下,
這是唯一能讓「拿掉 COALESCE」當場轉紅的觀察點。**它不證 DB 行為,只證那句話還在檔裡**(誠實邊界)。

### 3.2 口徑必須與 TS 端**完全一致**

`today-view.ts` 的 `sumReceived` 是**直接加總、不分正負**(沖銷列帶負值、沖銷之沖銷可為正)。
⇒ RPC 內 **`SUM(amount)`,不得**過濾負列、**不得** `SUM(ABS(...))`、**不得**只算 `reverses_payment_id IS NULL`。
承重字面:`20260810100000:197`(「已收 = SUM(amount)」)+ 同檔 `:82`(`500-500+500=500`)。
🔴 **一邊算一邊不算 = 兩個數字都對不起來,而且沒有錯誤訊號。**

### 3.3 呼叫端改法

`today-read.ts` 的 payments 那一段從 `.from('order_payments')` 改成 `.rpc('admin_today_payment_total', {...})`。
**其餘三支一個字不動**(它們有表權、已驗)。

## §4 MF-B 在 RPC 之後還剩多少(主視窗要求分開講)

| 支 | MF-B 還在嗎 | 理由 |
|---|---|---|
| **收款** | ❌ **消失** | 加總在 SQL 端做,回來的是**一列兩個純量** ⇒ 沒有 `max-rows` 可截。`amountsTruncated` 對這支失去意義。 |
| **退款** | ✅ **還在** | 仍走 PostgREST 撈列再 TS 加總 ⇒ `TODAY_REFUNDS_LIMIT = 500` 與那條 `toBeLessThan(1000)` 守門**都要留著**。 |

⇒ `amountsTruncated` 的語意要改成「**退款**筆數撞上限」,型別註解與畫面警語跟著改。
**不要**因為收款那支不用了就把整個旗標拿掉 —— 那會讓退款的截斷變回靜默。
`row_count` 保留的用途:讓呼叫端能記錄「今天有幾筆收款」,同時**作為 RPC 真的跑過的證據**(見 §6)。

## §5 片型與鐵則(**plan §4 的舊字面作廢**)

`#16` 原 plan §4 寫「鐵則 12 全不命中」⇒ **現在是過期字面,連同本檔一起更新,不只在信裡講。**

| 類 | 命中 | 依據 |
|---|---|---|
| ①錢 | **是(弱)** | 不動錢,但這支就是「今天收了多少錢」的唯一來源 |
| ②權限 | 🔴 **是** | 新 `GRANT EXECUTE TO service_role` |
| ③DB 結構 | 🔴 **是** | 新 migration |
| ④平台設定 | 否 | 不動 next.config / vercel.json / CI |
| ⑤對外不可回收 | 否 | 不寄信、不對外 |
| ⑥`packages/ui` | 否 | 零 UI 元件改動 |

⇒ **高風險片**;**鐵則 8 命中**(動 schema/API)⇒ 要 Sean 回核;
**鐵則 12 ⇒ codex 關卡2 不降級**(主視窗跑,我不能自己跑)。

## §5a Rollback(🔴 **鐵則 8 明文要求「含 rollback」,本 plan 前一版整份零字** —— 我自己補的)

🔴🔴 **2026-08-15 09:3x 更新:Sean 已 apply 到正式庫,成功。⇒ 本節的分支已經定了,是(乙)。**
下面的(甲)保留留痕、**不刪**,但**它已經不是現況,任何人不得再照它估 rollback 成本**。

分兩種情境,**不要混為一談**:

**~~(甲)還沒 apply~~(現況,而且會維持到 Sean 本人動手為止)** ← **08-15 09:4x 作廢**
⚠️ **「現況」兩個字就是它過期的方式** —— 寫的當下為真,而它描述的是**世界的狀態**,不是本檔的內容,
所以世界一動它就假了,**而檔案不會有任何 diff 提醒你**。
~~⇒ rollback = 刪掉那支 migration 檔 + `git revert` 那顆 commit。
DB 一個位元組都沒動過 ⇒ **零 rollback 成本**。~~ **← 現在 DB 動過了,零成本那句不再成立。**

**(乙)已 apply 之後才發現要退** ← 🔴 **這就是現在所在的分支**
⇒ 需要一支**反向 migration**:`DROP FUNCTION IF EXISTS public.admin_today_payment_total(timestamptz, timestamptz);`
(`REVOKE` 不必單獨寫 —— 函式被 DROP,它的 ACL 跟著消失。)
🔴 **但「退掉 RPC」不等於「回到能用的狀態」**:呼叫端一旦改走 `.rpc(...)`,DROP 之後首頁那格會回到
**每次都失敗**(`42883` 函式不存在),而不是回到現在的樣子 —— 因為現在的樣子本來就是壞的(MF-A)。
⇒ **真正的退路是「應用層與 migration 一起退」**,順序:先退應用層(`git revert`,四格回到「必失敗」)
再 DROP 函式。反過來做會有一段時間首頁完全打不開。
⚠️ 這條連動 memory `feedback_app-layer-must-not-ship-before-migration-apply`:
**apply 與部署之間有時間差,而這片的兩端都會壞**(apply 前部署 = `42883`;
部署前 apply = 沒人呼叫、無害)⇒ **正確順序是 apply 先、部署後。**

**(丙)不需要 rollback 的部分**:本片**零 schema 變更**(不建表、不改欄、不加索引、不動既有函式)
⇒ 沒有資料遷移、沒有不可逆寫入。爆炸半徑僅限「一支新函式存不存在」。

## §5b 批准邊界(**我自己標,免得誰以為這片已經全批了**)

- ✅ **Sean 拍過的**:`Q-16A = A` = **方向**(走 SECDEF RPC + `GRANT EXECUTE`,不砍那一格)。
- ⚠️ **Sean 沒逐段看過本 plan** —— 批「開工」的是主視窗。
  依 2026-08-14 Sean 的常設範圍授權,主視窗可自批的是**不碰錢/權限/schema/平台設定**的片,
  而本片 **碰權限 + schema** ⇒ **嚴格說主視窗不在自批範圍內**。
- ⇒ 我照做,但把偏離**明寫**:實作照走、**migration 檔只寫不 apply**、**不 push**,
  commit body 註明「Sean 拍的是方向(`Q-16A=A`),本 plan 本體由主視窗批」。
  Sean 回頭要退,退的成本就是上面 §5a 的(甲)= 零。

## §6 驗收條件(每條可 yes/no)

1. migration 檔存在,內含:函式定義 / 逐個點名 REVOKE / `GRANT EXECUTE TO service_role` / 檔尾結構斷言。
2. 檔尾斷言至少涵蓋:`prosecdef = true`、`proconfig` 含 `search_path=`、
   `has_function_privilege('service_role', …, 'EXECUTE')` 為真、且**非 service_role 角色為假**。
3. `today-read.ts` 的 payments 段已改走 `.rpc(...)`,`grep -c "from('order_payments')"` **= 0**。
4. `today-read.test.ts` 有一格斷言送出的是 `rpc('admin_today_payment_total', { p_from, p_to })`
   且**半開區間兩端與~~另外兩支~~另外一支(`orders`)同值**(突變:改成閉區間或改錯參數名 ⇒ 該格紅)。
   ⚠️ **「另外兩支」是退款那格拆掉前的字面**;半開區間的守門也已從退款鏈搬到 `orders` 鏈。

🔴🔴 **第 5、6 條於 2026-08-15 作廢(觸發 = SOP ⑥ code-reviewer 指出兩句已成假)**:
5. ~~退款那支的 `TODAY_REFUNDS_LIMIT` 與 `toBeLessThan(1000)` **仍在**(突變:改回 1000 ⇒ 紅)。~~
6. ~~`amountsTruncated` 的型別註解與畫面警語已改成「退款」語意,且有一格釘住。~~
   **← 兩條所指的東西都已隨「今日退款」那一格整個拆掉:常數、旗標、欄位、警語、對應測試全數移除。**
   🔴 **不得再拿本節第 5、6 條當驗收條件對照 commit** —— 它們會讓人以為那兩樣東西還在。
   **現行事實與重做時要帶回什麼,見 `apps/admin/src/lib/dashboard/today-view.ts` 的墓碑段**
   (含 `toBeLessThan(1000)` 為何存在:守的不是「剛好 500」而是「嚴格低於伺服器上限」)。
   ⚠️ **這兩句過期的方式與 §0-3 的 rollback 段同型**:它們描述的是**世界的狀態**(那些東西還在不在),
   不是本檔的內容 ⇒ **世界一動就假,而檔案不會有任何 diff 提醒你。**
7. 四綠(test / typecheck / lint / build)各自 exit 0,**分開收**。
8. migration 檔名 **`20260815010000_m4b_e10_16_admin_today_payment_total.sql`**;
   `ls supabase/migrations/ | grep -c "^20260815"` 只命中這一支(**不得出現 `20260815020000`,那是 C 窗的**)。
9. 🔴 **nit7**:`loadTodaySummary` 改成逐支收集錯誤,失敗卡講得出**是哪一格掛了**;
   至少一格測試讓~~「只有退款那支掛」~~**「只有其中一支掛」**(退款那格已拆 ⇒ 現用**新單**那支)
   ⇒ 畫面出現該格的失敗字樣、而其餘格**照常顯示**
   (突變:把逐支收集改回「任一失敗就整段拋」⇒ 該格紅)。
   ✅ **本條已超額達成**:除了原本的 `{ error }` 路徑,另加 **transport 層 reject** 的兩格
   (codex 關卡2 MF3:`Promise.all` 一支 reject 會整包倒,而上一版只有一支查詢接住了 reject)。
10. 🔴 **零筆**:migration 內含 `COALESCE(SUM(amount), 0)`,且 `today-read.test.ts` 有一格
    `readFileSync` 源碼契約測試釘住它(**突變:拿掉 `COALESCE` ⇒ 該格紅**);
    TS 端 `total` 型別是 `number`、**不得**出現 `?? 0` 之類的第二層防禦。
11. 反向 migration 的 `DROP FUNCTION` 語句寫進 §5a,**不另建檔**
    (~~還沒 apply,乙情境用不到~~ ← **08-15 09:4x 作廢:已 apply,現在就在乙情境。
    語句仍不另建檔,但理由變了 —— 不是「用不到」,是「要用的時候照 §5a 的順序手動跑」**)。
12. ~~**未 apply**~~ **← 09:3x 已 apply(Sean 親手)**、**未 push(仍成立,26 顆)**。

## §7 誠實缺口(**現在就寫,不等做完**)

1. ~~🔴 **RPC 一樣零正式庫驗證** —— …**不證** apply 得過…~~ ← **08-15 09:4x 大幅縮小,見下。**
   🔴 **縮小後的真實剩餘**(觸發 = 09:3x Sean 親手 apply 成功):
   - ✅ **已證(且不是推的)**:檔尾五道閘 **fail-closed** ⇒ apply 沒中止 = 五道閘在**正式庫的 owner / ACL /
     既有資料**下全過。另外 08-15 本機丟棄式 PG 17.10 已證 `STRICT` 語意 + 「閘會紅」(突變對照)。
   - ❌ **仍不證**:`42501` 真的消失。
     `select has_table_privilege('service_role','public.order_payments','SELECT');` **我仍跑不了**(施工端無連線),
     出口是 `#502` 那份清單 —— 🔴 **不因本次 apply 成功而結案。**
   ⚠️ **留痕原因**:原句把「環境事實(我沒連線)」與「可能性推論(所以測不出來)」黏成一句,
   一整晚被當同一件事用;地圖見 `~/pcm-mailbox/A-043-STOP.md`。
2. 🔴 **MF-A 本身也沒對正式庫驗過** —— 上面 §1 全部是 migration 字面 + apply-time 閘,不是實跑 `SELECT` 看到 `42501`。
   結論我認為成立(五份字面互相支持、且有兩個對照組證明不是全表通病),但**它是「repo 這樣寫」不是「DB 這樣答」**。
3. 四格的真資料路徑至今**零證據**,這片做完仍然如此。
4. migration 版本號的唯一性**只掃得到本機**(主樹 + 三個 worktree + 信箱佔位)⇒ 見 §3 那段「下限不是保證」。
5. 🔴🔴 **本片的 migration 至今未經任何不同模型的對抗審查。**
   鐵則 12②③ 要求 codex 關卡2 不降級,但 2026-08-15 codex **跑不出來**:
   主視窗替 C 窗那支 migration 跑了兩輪都 **零 findings** —— R1 被 12 分 watchdog 砍(白名單檔名不存在)、
   R2 只跑 2 分 1 秒就自己結束,輸出是 prompt 回聲 + warning、**零 model 回覆**;
   而 codex 本身正常(smoke test 回得出來)。已送 Sean 裁,**主視窗不自行放寬 2 輪上限**。
   ⚠️ **「codex 沒吐 findings」不得讀成「沒問題」** —— 那是 memory `feedback_absence-read-as-verified`
   的形狀(**什麼都沒有被讀成檢查過了**)。本片的 SQL 現在只被**我自己**看過,
   而我就是寫它的人 ⇒ **驗證不自驗這條鐵律在這片上目前是破的**,不是滿足的。
6. 錢口徑的 DB 端行為驗證 ⇒ **`#502`**(已落 `docs/phase-1-backlog.md`),
   可執行版本 = `docs/runbooks/2026-08-15-16-payment-total-apply-checks.md`
   (**9 道**唯讀查詢,**apply 前 4 / apply 後 5**;🔴 `has_table_privilege` 那道在 **apply 前**,
   因為它驗的是「這片存在的理由還成立」—— **那道不過就不該 apply**)。
   ⚠️ 該 runbook 本身**也是全部未在正式庫執行過**,它是清單不是紀錄。

> ⚠️ **本節刪掉過兩條**,刪的理由留在這裡免得下一輪 reviewer 以為是漏寫:
> ~~「`amount` 欄型別未確認」~~ ⇒ 一個 grep 就查掉了(`20260810100000:199` = `integer`),已寫進 §3.1。
> ~~「migration 版本號未定」~~ ⇒ 主視窗 2026-08-15 已發 `20260815010000`,已寫進 §3。
> **誠實缺口只收構造不出來的,不收懶得查的、也不收已經解決的** —— 留著等於虛報缺口。

## §8 範圍與刻意不做的

- ✅ **R2 nit7 在本片範圍內**(不是延後)—— 見 §3 的專段與 §6-9 的驗收條件。
  併進來的理由:要知道哪一支掛得改寫 `loadTodaySummary` 的三道 `throw`,而那正是 §3.3 要改的同一段;
  分兩片 = 同段程式改兩輪、審兩輪。
- **R2 nit9**(`STATUS.md` 7 欄未更):🔴 **這條我不能做。**
  子窗不得直接寫 `STATUS.md`(收帳權集中主視窗;實錘=08-08 撞真 merge conflict)。
  ⇒ **素材我在收工信給,主視窗落帳。** reviewer 不知道這條窗別紀律,所以這條 finding 對我不成立。
