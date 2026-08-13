# #445 超退閘 — slice plan **v2**

> 2026-08-13 · 主視窗十四代重寫 · **codex 關卡1 R1 判 FAIL(19 must-fix + 12 important),本版逐條折**
> 片型 = **高風險片**(鐵則 12①**錢**;12③ schema/RPC)⇒ 鐵則 8 提 plan 等批 + 對抗審查不降級
> 來源 = backlog `#445`(Sean 2026-08-12 **知情推翻拍板⑤**,排 2g 之前)
> v1 = 同檔 git 歷史(`5a7497c1`)。**v1 的 §4-2「算兩本帳」整段作廢**,理由見 §0-B。

---

## §0 v1 → v2:三個把設計方向改掉的發現

### §0-A 🔴 `payment_refunds` **不是**訂單退款帳(codex F09/F10;主視窗開檔複驗)

v1 §4-2 第 2 點寫「算兩本帳:`order_refunds` ∪ `payment_refunds`」。**這一整段作廢。**

實查 `supabase/migrations/20260810140000_m4b_lifecycle_l5b_refund_ledger.sql:75-89`:

- 父表 `payment_refunds.attempt_id` **FK 指向 `payment_charge_attempts(id)`**,不是 `orders`
  ⇒ 它是**某一次刷卡嘗試的補償退款**,不是「這張訂單退了多少貨款」。
- 全檔 `grep -n 'status'` **零命中**(實跑)⇒ 父表**沒有 status 欄**,結果語意在事件流。

**Sean 的 Q3=A 建立在「它是另一本訂單退款帳」這個錯前提上,主視窗已當面撤回(Q12=A)。**
照 v1 寫法的真實後果:客人被重複扣款、我方退了 100 元補償 → 之後**合法的取消訂單退款 100 元會被錯擋**。

### §0-B 🔴 RPC **拿不到** TapPay Record —— Q9/Q10 的落點只能在 app 層(主視窗新發現)

新方案本來是「`order_refunds`(在途)+ **TapPay Record**(已退)取小」。但 Record 要打 TapPay API,而:

1. `pg_net` 是**非同步**的。repo 內唯一用法 `20260723120000_m3_s2_settle_sweep_pgcron.sql:113`
   `SELECT net.http_get(...)`,包它的 `pcm_cron.invoke_cron_route` **RETURNS bigint**(request_id);
   檔頭 `:37` 逐字「6h TTL 只管 `net._http_response`」⇒ **回應事後才進另一張表**,
   同一個交易裡拿不到。
2. 就算拿得到也不該:`admin_initiate_order_refund` 步 3 持著 order advisory lock,
   在鎖內等外部 API = **把鎖持有時間綁在 TapPay 上**(adapter 30s 上限)。

⇒ **Q9/Q10「問 TapPay Record」只能落在 app 層,不能落在 RPC 層。**
   這同時解掉 codex F10(「`payment_refunds` 沒 status,SQL 無從照規格實作」)——
   **RPC 層本來就不該算那本帳**,它只該守 DB 內看得到的 `order_refunds`。

### §0-C 🔴 app 層加業務判定會**製造**超退(codex F16 + 主視窗把後果推到底)

v1 §5 的 445a 是「`refund-form.ts` 上界 `MAX_AMOUNT` → 改成帳本未登記額」。
`refund-actions.ts:112` 的 `parseRefundForm` 在 **RPC 之前**跑,而 RPC 的順序是
`步 4 冪等 G4 → 步 6 守門`。⇒ **同 token 重播會先被 app 層的上界擋掉**:

前次退款已成功 → 帳本額度變小 → 重播請求被 parser 判「金額不合法」→
**永遠走不到 `refund-actions.ts:280` 的 `DUPLICATE_REQUEST` + `rowStatus='confirmed'` ⇒ 視同成功**那條路。
員工看到「金額不合法」以為沒退成功 → 換一張表單再退一次 → **真的退兩次**。

**一個防超退的改動,製造出超退。**

而且 repo 自己的契約早就寫了:`refund-actions.ts:111` 逐字
「解析(純形狀;**業務判定單一真相在 RPC**)」⇒ v1 的 445a 違反既有契約。

### §0-D 🏁 Q-445-1 = **A**(Sean 2026-08-13 拍板)

```
Q-445-1: TapPay Record 檢查(Q9/Q10)要放在退款流程的哪一步?
拍板 = A:放 RPC 之前,但**先花一次 SELECT 查「這個 token 是否已在帳本」**——
       已在 = 重播 ⇒ 跳過 Record 檢查,直接送 RPC 讓冪等 G4 處理;
       不在 = 首次 ⇒ 做 Record 檢查。
```

**代價(已知情接受)**:每次退款多一次 DB 查詢(~10ms);445a 片體積 +20-30 分鐘。

🔴 **A 案的實作契約(三條,缺一條就退化成 §0-C 那個會製造超退的形狀)**:

1. **重播查詢的鍵 = `request_token`**,與 RPC 步 4 冪等 G4 用的**同一把鍵**。
   用別的鍵(例如 order_id + amount)會把「同單同額的第二筆合法退款」誤判成重播 ⇒ 放行超退。
2. **查詢結果為「查不到」時走首次路徑**(做 Record 檢查),不是走重播路徑。
   fail-closed 方向:讀不到帳本 ⇒ 當成首次 ⇒ 做檢查 ⇒ 擋得住;反過來會放行。
3. 🔴 **這道查詢本身不是守門,是分流**。它判錯的後果只有「多做/少做一次 Record 檢查」,
   真正的冪等權威仍在 RPC 步 4 的 G4。**不得**因為有了這道查詢就把 G4 當成備援。

---

## §1 一句話目標

**讓 100 元的訂單退不出 99999。**

現況三層全不擋(§2 逐條實查),TapPay 是唯一防線 —— 而我方對它的拒絕行為**只有 sandbox 實證**,
且 partial 路徑我方完全不查帳。本片把「算得出來但沒人用」的剩餘額**升格成守門**。

🔴 **做完也不得宣稱「擋得住超退」**,只能宣稱「**擋得住經由 `admin_initiate_order_refund` 的超退**」(§8)。

---

## §2 偵察(全部實查,附檔案:行號)

### 2-1 算式已經存在,而且只算一半的帳

`supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:394-408`:

```sql
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT o.total::bigint - COALESCE(
           (SELECT SUM(r.refund_amount) FROM public.order_refunds r
             WHERE r.order_id = o.id AND r.status IN ('processing','confirmed')), 0)
    FROM public.orders o WHERE o.id = p_order_id;
$$;
```

- COMMENT(`:411`)逐字:「🔴 **不是守門、沒有 trigger 讀它**(拍板⑤)」。
- **查無訂單**回 NULL;**零帳本列**回訂單總額(不是 NULL —— 見 2-6)。

### 2-2 守門的位置早就有,是刻意留空的

`order_refunds` 的 INSERT 守門已有六道,COMMENT(`:298`)最後一句逐字:
「🔴 **不含任何超退檢查(拍板⑤)**」。同檔 `:25` 是拍板⑤ 原文:「**零超退守門**(金額上界不設;TapPay 10051 是權威)」。
`:254` 另有一句劃界:「本道擋『沒收過錢』**不擋『還能退多少』**=拍板⑤」。

⇒ **這不是沒地方放,是當初決定不放。** 本片=推翻該決定(Sean 已知情拍板)。

### 2-3 2f(今晨已 apply)把並發解決了

2f 在 `admin_initiate_order_refund` **步 2 之後、步 3 之前**取了 order 級 advisory lock
(`20260812170000` 檔頭 A 段)⇒ **同一張訂單的退款發起已經序列化**。
守門放在那把鎖**之後**,並發問題自動消失 —— 這是 Q1=A 不做 trigger 層的技術理由。

### 2-4 RPC 的檢查順序是合約,partial 是唯一沒查的那條

`20260803150000...sql:419-422` 九步逐字(v1 引 `:418-420` 少兩行,codex F05 已更正):
`1 輸入衛生 → 2 kind/金額互斥 → 3 鎖訂單 → 4 冪等 G4 → 5 業務前置 → 6 凍結額+NOTHING_LEFT → 7 產鍵 → 8 INSERT → 9 稽核`

步 6 現況(`:537-540`)**只管 full**:

```sql
IF p_kind = 'full' AND v_frozen < 1 THEN
  RETURN jsonb_build_object('result','REFUND_NOTHING_LEFT');
END IF;
```

`v_frozen` 兩條來源:`:485` partial = `v_frozen := p_amount`(**員工輸入多少就是多少**)、
`:496` full = `p_record_amount`(走 TapPay Record 的剩餘額)。

⇒ **本片在 DB 側的落點就是步 6,把 partial 納入。**

### 2-5 🔴 第 9 碼要同步的地方(v1 引錯位置 + 少算五處;codex F01/F02/F19/F20)

**v1 錯**:說結構斷言在 `20260803150000...sql:1031`。實查該處是 **COMMENT 的 LIKE 檢查**(比對 8 碼字面在註解裡)。

**真正的閉集斷言在 `20260812170000...sql:1011-1023`**(2f 後置⑦),它釘三個東西:

```sql
IF v_n <> v_n2 OR v_n <> 10 THEN   -- v_n='result' 鍵數;v_n2=緊接 8 碼字面的數
```

🔴 **2f migration 自己就把交辦寫好了**(`:1010` 逐字):

> 「⚠️ 合法增刪回傳點時這裡會擋 ⇒ 症狀 = apply 擋在 `l5b2_2f_result_code_closure`、訊息印出實得數;
>   那時要一起改的是:**本 PIN、COMMENT 的 8 碼全集、呼叫端 allowlist**。**三處同動才是完整的改**。」

**完整同步清單(共 8 處,v1 只寫 4 處)**:

| # | 位置 | 動作 |
|---|---|---|
| 1 | `admin_initiate_order_refund` 函式體 | 新增回傳點 |
| 2 | 該函式 COMMENT(`20260803150000:599`) | 8 碼全集 → 9 碼 |
| 3 | 新 migration 的後置⑦ 斷言 | 8 碼 regex → 9 碼、絕對數 10 → 新數 |
| 4 | `refund-repository.ts:17-26` allowlist 常數 | 加碼 |
| 5 | `refund-repository.ts` outcome union 型別 | 加碼 |
| 6 | `refund-repository.ts:211` 未知碼 throw 的 parser | 對齊 |
| 7 | `refund-repository.test.ts:72-84,168-177` | 釘死的八碼/六業務碼 → 更新 |
| 8 | `scripts/l5b2-2f-verify.sh` E1a/E1b/**M15** | 見下 |

🔴 **第 8 處要改三格,不是一格**(codex F20 只說「要同步」,主視窗拆開實查):
- `:395-401` **E1a** 8 碼 regex
- `:402-406` **E1b** 絕對數 **10**
- `:621` **M15 突變格**逐字「`M15 冒出第 9 個回傳碼(後置⑦)`」——
  它現在把「出現第 9 碼」當作**應該被擋住的突變**;445b 之後那個突變格本身要改成第 **10** 碼,
  否則 harness 會把合法狀態判成破壞合約。

⚠️ **2f 是已 apply 的凍結檔**(`APPLIED.tsv` 釘 sha256,08-13 實測連純註解都不能動)
⇒ 445b **不得修改 `20260812170000` 檔**,新斷言寫在 445b 自己的 migration 後置段。

### 2-6 前台的值流已經通,但有一個短路會封死第一筆退款(codex F21;主視窗查出真因)

`order-detail.tsx:429` 逐字 `!(refundUnregisteredAmount !== null && refundUnregisteredAmount < 0) &&`
⇒ 未登記額為負時整個退款入口 fail-closed 關閉。值流:`order-detail-route.tsx:143` 取 → `:220` 傳 → `:410` 用。

🔴 但 `order-detail-route.tsx:140-141` 逐字:

```
// 有帳本列才查未登記額(零列時該數=訂單總額,無資訊、省一趟)。
if (refunds.length > 0) {
```

⇒ **零帳本列(= 每張訂單的第一筆退款)時 `refundUnregisteredAmount` 恆為 `null`。**
v1 §6 驗收第 3 條「讀不到 ⇒ 擋」會**封死每一張訂單的第一筆退款**。

**修法(最小):刪掉那個 `if` 短路,一律查。**
`refund-read.ts:93-100` 直接轉呼 `pcm_order_refundable_remaining`,零列時它回訂單總額 = 正確上界;
`null` 只剩「查無訂單」這一種語意 —— 那時擋是對的。
代價 = 每次開訂單頁多一趟 RPC(該註解說的「省一趟」)。

### 2-7 措辭鐵律(不得違反,已有負向測試盯著)

`refund-ledger-view.ts:4-8` 逐字:「UI 措辭必須是「**帳本未登記額**」,**不得**寫「還能退」「剩餘可退」——
值班照著錯的名字按下去 = 同一筆錢退兩次。」

### 2-8 現行 canonical 的 failed 語意(codex F11;v1 退回單純 blocklist 會重開已知洞)

`20260812140000_m4b_lifecycle_refund_manual_reversal.sql:438-465` 已明寫:
**舊帳 `failed` 無結構保證**(只有值域 CHECK,沒有任何約束保證「外呼沒發生過」)、
**補償帳必讀有效終局**。`20260811030000...sql:135-136` 同一句逐字重述。

⇒ v2 的守門式**不得**只寫 `status <> 'failed'` 就當作扣掉(見 §4-2)。

---

## §3 Sean 拍板(現況)

| 題 | 拍板 | 狀態 |
|---|---|---|
| Q1 幾層 | 前台 + RPC 兩層(不做 DB trigger 層) | 有效,但**兩層能力邊界改變**,見 §4-1 |
| Q2 算式 | 另寫守門版,方向翻成 blocklist | 有效,**但 blocklist 的內容要對齊 §2-8**,不是單純 `<> 'failed'` |
| ~~Q3 兩本帳~~ | ~~現在就把 `payment_refunds` 算進去~~ | 🔴 **已撤回(Q12=A)** —— 前提錯,見 §0-A |
| Q4 卡單擋到合法退款 | 擋死,但訊息直接指出是哪一筆卡住 | 有效,**但要回傳列 ID 才做得到**,見 §4-4 |
| Q5 場外退款登記入口 | 不做,守住範圍、另立 backlog | 有效 |
| Q9 partial 也問 TapPay Record | 是 | 有效,**落點改 app 層**(§0-B);放哪一步待 Q-445-1 |
| Q10 Record 連不上就擋 | 是 | 同上 |

---

## §4 設計

### 4-1 兩層各自擋什麼(能力邊界已依 §0-B 修正)

| 層 | 擋什麼 | **擋不到什麼** |
|---|---|---|
| **前台提示**(`order-detail` 表單) | 手滑打太多 —— 最大宗,當場看得到 | 竄改 DOM;繞過前台;兩人同時送 |
| **app 層 Record 閘**(Q9/Q10) | Portal 場外已退的部分;Record 連不上 | 繞過 app 直呼 RPC |
| **RPC 步 6**(2f 鎖之後) | 繞過前台;**並發**(2f 已序列化);DB 帳本超額 | 🔴 **Portal 場外退款**(RPC 看不到 Record,§0-B);直接 `INSERT`(需 service_role) |
| TapPay(不動) | 最後一道 | partial 我方仍不查帳;正式環境行為只有 sandbox 實證 |

🔴 **與 v1 的差別**:v1 以為 RPC 層是最完整的一層。實際上 **RPC 層看不到 Portal 場外退款**,
而 app 層看得到 Record 卻擋不住繞過。**沒有任何單一層是完整的** —— 這句要進 §8。

🔴 **前台層的角色從「守門」降級為「提示」**:業務判定單一真相留在 RPC
(`refund-actions.ts:111` 既有契約),理由見 §0-C。

### 4-2 守門專用算式(新函式,與顯示用那條並存)

新函式 `pcm_order_refund_guard_remaining(uuid)`,與 `pcm_order_refundable_remaining` 的差異:

1. **方向翻轉為 blocklist**:只有**明確證實不佔額度**的列才扣掉,其餘一律**佔額度**(fail-closed)。
   🔴 **「明確證實」的定義對齊 §2-8,不是 `status <> 'failed'`**:
   `failed` **只有值域 CHECK、沒有任何約束保證外呼沒發生過** ⇒ 本函式**把 `failed` 也算進佔額度**,
   除非該列有補償帳的有效終局證據。
   ⚠️ 這比 v1 更保守 ⇒ **會產生「明明退失敗了卻退不了」的卡單**,由 Q4=A 的訊息把那一筆指出來。
2. **只算 `order_refunds`**(§0-A:`payment_refunds` 不是訂單退款帳)。
3. **NULL 語意**:查無訂單回 NULL;守門遇 NULL 一律擋(fail-closed)。

🔴 **兩條式子並存 = 漂移風險,機械守門要能真的抓到漂移(codex F13/F14)**:
v1 寫「在現行狀態集合下兩式相等」——**固定 fixture 不會因未來 CHECK 新增狀態自動長出案例**,
兩條公式可以一起漂、測試永遠綠。改成:

- 測試從 **`information_schema` 實讀 `order_refunds.status` 的 CHECK 白名單**,對每個值各造一列;
  新增狀態時案例自動長出來。
- 方向翻轉的負測要能跑得出資料:**新增假狀態會先被現行 CHECK 擋掉**(codex F15)⇒
  負測在**拋棄式資料庫**裡先 `ALTER TABLE ... DROP CONSTRAINT` 再造列,跑完整庫丟掉。
  (2e/2f 的 harness 已有拋棄式庫慣例,沿用同一套。)

### 4-3 RPC 步 6 的改法

```
步 6(現況只管 full)→ 擴成:
  full   : v_frozen < 1                    → REFUND_NOTHING_LEFT(不動,既有語意)
  partial: v_frozen > guard_remaining()    → REFUND_EXCEEDS_REMAINING(新第 9 碼)
  guard_remaining() IS NULL                → REFUND_EXCEEDS_REMAINING(fail-closed)
```

🔴 **SQL 陷阱(codex F17)**:`IF v_frozen > NULL` 不會進分支(結果是 NULL 不是 true)⇒
**必須明寫 `guard_remaining IS NULL OR v_frozen > guard_remaining`**,不能靠比較運算自然擋。

位置紀律:**必須在步 3(2f advisory lock)之後**,否則並發防不住。
順序紀律:**必須在步 4 冪等 G4 之後**,否則同 token 重播拿到超退碼而非 `DUPLICATE_REQUEST`。
🔴 **且必須在 2f 的 payment-refund veto 之後**(codex F18):v1 放「步 6」會早於那道 veto,
在途補償退款會被改回超額碼,**吃掉原本帶 blocking ID 的 `REFUND_IN_FLIGHT`** ——
員工會收到「打太多」而不是「有一筆卡住」。實作時要在 2f post-image 上定位 veto 的實際位置再插入。

### 4-4 第 9 碼與訊息(Q4=A 的落點)

新碼 `REFUND_EXCEEDS_REMAINING`。回傳除 `result` 外附帶:
- `remaining`:守門算出的額度
- `blocked_by_refund_id`:🔴 **列 ID,不是布林**(codex F22)——
  v1 的 `blocked_by_pending` 是布林,**指不出「是哪一筆」,做不到 Q4=A 承諾的事**。
- `blocked_by_pending` 保留為布林,但只當文案分流用。

前台文案分流:
- 無阻擋列 → 「這張單的帳本未登記額是 N 元」(單純打太多)
- 有阻擋列 → 「有一筆退款(單號 X)正佔著額度,先去處理那一筆」+ 連到帳本那一列
  (backlog `#442` 的卡單;Q4=A 的用意是逼人面對它)

🔴 **repository 要驗欄位型別(codex F03)**:`remaining` / `blocked_by_refund_id` 是新欄位,
畸形 RPC 回應不得直接流進 UI —— parser 對這兩個欄位做型別檢查,不合格 = 走既有的未知形狀路徑。

---

## §5 片界:拆兩片,順序不可顛倒

> 依據:「一片=一支 migration **或**一個純應用層改動,**不混**」;
> memory `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 A9h 正式站壞 8 小時)。

### 445a —— 應用層(**標準片**,先做)

🔴 **v1 說「純前端 45 分」是錯的**(codex F23)。實際碰到的檔:

| 檔 | 改什麼 |
|---|---|
| `order-detail-route.tsx:140-141` | 刪掉 `if (refunds.length > 0)` 短路(§2-6) |
| `order-detail.tsx:408-435` | 把上界值傳進表單區(v1 只算到 `RefundLedgerSection`,漏了 `RefundSection`;codex F04) |
| `refund-section.tsx:56-70` | 表單 `max` 屬性 + 即時提示文案 |
| `refund-repository.ts:17-26,211` | allowlist 加第 9 碼 + outcome union + parser 型別檢查 |
| `refund-action-state.ts` | 兩支文案 |
| `refund-repository.test.ts:72-84,168-177` | 釘死的碼表更新 |
| `refund-actions.ts` | 🏁 **Q-445-1=A**:重播分流查詢(`request_token`)→ 首次才走 Record 閘 |
| `refund-read.ts` | 重播分流用的 token 查詢(新函式;單一 SELECT) |

🔴 **445a 不做 server 端金額擋**(§0-C)——只做:①UI 提示 ②認得第 9 碼 ③(視 Q-445-1)Record 閘。
🔴 **445a 的碼處理必須先於 445b apply**,反過來 = migration 產出 app 不認得的碼 = caller bug 路徑。

### 445b —— 純 migration(**高風險片**,後做)

1. 新守門函式(§4-2)
2. `admin_initiate_order_refund` 步 6 擴充(§4-3)+ 第 9 碼
3. 後置斷言(§2-5 第 3 處;**寫在 445b 自己的 migration**,不動 2f 凍結檔)
4. 同步 `scripts/l5b2-2f-verify.sh` 三格(§2-5 第 8 處)
5. **apply = Sean 停點**;停點素材以 **migration 檔頭為準**(2f 停點教訓)

---

## §6 驗收條件(逐條 yes/no)

**445a**
1. ☐ **零帳本列的訂單(第一筆退款)** ⇒ 表單拿得到上界(=訂單總額)、**不被擋**(codex F21/F26 的直接反例)
2. ☐ partial 輸入超過未登記額 ⇒ UI 當場提示(不送出)
3. ☐ partial 輸入等於未登記額 ⇒ 放行(邊界,防 off-by-one)
4. ☐ **同 token 重播已成功的退款** ⇒ 拿到 `DUPLICATE_REQUEST`/視同成功,**不是**「金額不合法」(§0-C;codex F16/F26)
5. ☐ 查無訂單(真 null)⇒ 擋
6. ☐ app 收到 `REFUND_EXCEEDS_REMAINING` ⇒ 不進 unknown-code 路徑、吐兩支文案之一
7. ☐ RPC 回傳 `remaining`/`blocked_by_refund_id` **型別畸形** ⇒ 不流進 UI(codex F03)
8. ☐ 文案零命中「還能退」「剩餘可退」(§2-7,機械 grep,**掃畫面字串、不掃註解**)
9. ☐ 三綠 + `vitest run` 全綠
10. ☐ Record 連不上 ⇒ 擋 + 文案講清楚**是查不到、不是超額**(Q10;誤導文案會讓員工換路再退)
11. ☐ 🔴 **重播分流三條契約各一格**(§0-D):
    a. 分流查詢用的鍵**就是** `request_token`(與 RPC G4 同一把)—— 用同單同額造第二筆**合法**退款,
       必須走**首次**路徑(證明沒把它誤判成重播)
    b. 分流查詢**查不到** ⇒ 走首次路徑做 Record 檢查(fail-closed 方向)
    c. 分流判成重播 ⇒ 跳過 Record 檢查、直接送 RPC,且最終結果由 G4 決定(不是由分流決定)

**445b**
12. ☐ 守門函式對 **`information_schema` 實讀的 CHECK 白名單**逐值測(§4-2;不是固定 fixture)
13. ☐ 拋棄式庫裡 DROP CONSTRAINT 後加假狀態 ⇒ 守門版佔額度、顯示版不佔(方向翻轉負測)
14. ☐ `guard_remaining IS NULL` ⇒ 擋(§4-3 的 SQL 陷阱,要有獨立一格)
15. ☐ partial 超額 ⇒ `REFUND_EXCEEDS_REMAINING`,`blocked_by_refund_id` **指到正確那一列**
16. ☐ partial 恰等於額度 ⇒ `INITIATED`(邊界)
17. ☐ 同 token 重播超額 ⇒ `DUPLICATE_REQUEST`(順序負測)
18. ☐ **在途補償退款存在時** ⇒ 回 `REFUND_IN_FLIGHT`(帶 blocking ID)**不是**超退碼(§4-3 veto 順序;codex F18/F19)
19. ☐ 🔴 **兩個不同 token 並發、各自合法、合計超額** ⇒ 只有一筆成立(codex F24;**這片的核心失敗情境**)
20. ☐ `CREATE OR REPLACE` 後回歸:full 路徑、advisory lock 位置、G4、2f veto、`lock_timeout`、
    `SECURITY DEFINER`/ACL 全部保存(codex F25;整支 RPC 被改壞仍可能全綠)
21. ☐ 後置⑦ 閉集斷言含第 9 碼且通過;`l5b2-2f-verify.sh` E1a/E1b/**M15** 三格同步後全綠(§2-5)
22. ☐ 回退腳本可單獨跑 + 負測

---

## §7 回退

- 445a:`git revert`,無資料面。
- 445b:`CREATE OR REPLACE` 回 **2f 的 post-image**(🔴 codex F27:v1 只寫「回舊版 RPC」,
  回到 A7c 版本會**一起刪掉 advisory lock 與跨帳本 veto**)+ `DROP FUNCTION` 新守門式;不動任何資料列。
  🔴 **post-image 指紋要在 445b 檔頭釘死**(md5),回退腳本先驗指紋再動手。
- ⚠️ 回退腳本連線拓樸沿用 2f:**直連 5432、不走 pooler 6543**。
- 🔴 **回退不是零風險**(codex F28):不動資料列,但**立即重新開放超退路徑**。
  回退決策要當作「暫時關掉一道錢的守門」來處理,不是「反正沒動資料」。

---

## §8 誠實邊界

**能宣稱**:擋得住**經由 `admin_initiate_order_refund` 的**超退(前台手滑、繞過前台的 RPC 呼叫、同單並發)。

**不能宣稱**:
1. 🔴 **沒有任何單一層是完整的**(§4-1):RPC 層看不到 Portal 場外退款;app 層看得到 Record 但擋不住繞過。
2. 🔴 **Portal 場外退款**:Q-445-1 選 C 時完全不擋;選 A/B 時只在 app 路徑擋。
   `:411` 逐字「真實剩餘額 ≤ 本值」⇒ 我方算出的額度**只會高估**。
3. 🔴 **繞過 RPC 直接 INSERT** 擋不到(Q1=A 不做 trigger 層)。
4. 🔴 **`failed` 的語意靠營運紀律**(codex F29;§2-8):`failed` 只有值域 CHECK、
   沒有結構保證「外呼沒發生過」。v2 選擇把 `failed` 算進佔額度(保守),代價是會卡住合法退款。
5. TapPay 正式環境拒絕行為**仍只有 sandbox 實證**。
6. 445a 單獨上線期間,**RPC 仍不查 partial 的帳**。

> **名字大於實力的防護比沒有防護更危險**。任何 UI 文案、commit body、STATUS
> 不得出現「已防止超額退款」這種全稱句。

---

## §9 相關既有紀錄與連動面

- backlog `#445`(本片)/ `#442` 卡住的補償退款永久隱形(Q4=A 訊息指向它)/ `#443` 異常清單只讀一本帳
- `#444` `payment_charge_attempts.order_id` 無 immutable 守門 —— 與本片共用「尺度可信」假設
- 2f = `20260812170000`(**已 apply、凍結檔**);本片並發前提騎在它的 advisory lock 上
- 2g(未建)= `payment_refunds` 的 writer;🔴 **v2 不再與 2g 連動**(§0-A)
- memory:`project_0812-fuzzy-logdrain-dirty-decisions`(拍板)/
  `feedback_app-layer-must-not-ship-before-migration-apply`(§5 順序)/
  `reference_tappay-refund-api-multiple-partial-and-overrefund`(Record 語意)

---

## §10 估時(v1 低估,重估)

- 445a:**90-120 分**(v1 說 45-60;標準片,七個檔 + 型別驗證 + 重播格)
  + Q-445-1 選 A/B 再 **+20-30 分**
- 445b:**150-210 分**(v1 說 90-120;八處同步 + 11 個驗收格 + 拋棄式庫負測 + 並發格 + 回歸包 + 對抗審查)

---

## §11 codex R1 findings 逐條折(19 MF + 12 IMP + 2 nit = 33 條)

| # | 嚴重度 | 摘要 | 折法 | 落點 |
|---|---|---|---|---|
| F01 | MF | `:1031` 不是結構斷言 | 改釘 `20260812170000:1011-1023` | §2-5 |
| F02 | MF | 「同步四處」少算五處 | 擴成 8 處清單 | §2-5 |
| F03 | IMP | repository 未驗新欄位型別 | 加型別檢查 | §4-4 / §6-7 |
| F04 | IMP | 值沒流到 `RefundSection` | 片界加兩元件 | §5 表 |
| F05 | nit | 九步引用少兩行 | 改引 `:419-422` | §2-4 |
| F06 | IMP | `payment_refunds` 非結構恆零 | 整段作廢(更強) | §0-A |
| F07-F08 | IMP | 兩帳無跨表唯一鍵 / 可能雙扣 | 隨 §0-A 消滅(不再算兩帳) | §0-A |
| F09 | MF | `payment_refunds` 是補償退款非貨款退款 | 撤 Q3、改設計 | §0-A |
| F10 | MF | 父表無 status,SQL 無從實作 | RPC 層不算那本帳 | §0-A/§0-B |
| F11 | IMP | 退回單純 blocklist 重開已知洞 | blocklist 對齊 canonical | §2-8 / §4-2 |
| F12 | MF | `failed` 非「證實錢沒動」 | `failed` 改算佔額度 | §4-2 / §8-4 |
| F13 | MF | 固定 fixture 不會長出新狀態 | 改實讀 CHECK 白名單 | §4-2 / §6-12 |
| F14 | IMP | 兩公式可一起漂 | 同上 | §4-2 |
| F15 | IMP | 假狀態會被 CHECK 擋、跑不出資料 | 拋棄式庫 DROP CONSTRAINT | §4-2 / §6-13 |
| F16 | MF | app 上界先於 G4、重播被誤擋 | 445a 不做 server 擋 | §0-C |
| F17 | IMP | `IF v_frozen > NULL` 不進分支 | 明寫 `IS NULL OR` | §4-3 / §6-14 |
| F18 | MF | 新守門早於 2f veto、吃掉 `REFUND_IN_FLIGHT` | 定位 veto 後插入 | §4-3 / §6-18 |
| F19 | MF | `blocked_by_pending` 可能回 false、診斷誤導 | 同上 + 回列 ID | §4-3 / §4-4 |
| F20 | MF | harness 把第 9 碼當突變失敗 | 三格同步(E1a/E1b/M15) | §2-5 |
| F21 | MF | 零帳本列 null ⇒ 封死第一筆退款 | 刪 route 短路 | §2-6 / §6-1 |
| F22 | IMP | 布林指不出「哪一筆」、做不到 Q4 | 改回列 ID | §4-4 |
| F23 | IMP | 445a 不是純前端、估時失真 | 列七檔 + 重估 | §5 / §10 |
| F24 | MF | 無兩 token 並發格(核心情境) | 加驗收 19 | §6-19 |
| F25 | MF | 無 `CREATE OR REPLACE` 回歸包 | 加驗收 20 | §6-20 |
| F26 | MF | 無第一筆退款格、無重播格 | 加驗收 1、4 | §6 |
| F27 | MF | 回退未釘 2f post-image | 釘指紋 + 先驗後動 | §7 |
| F28 | IMP | 「零資料風險」掩蓋行為風險 | 明寫重開超退路徑 | §7 |
| F29 | MF | 誠實邊界自相矛盾 | 改「經由該 RPC 的超退」 | §1 / §8 |
| F30 | IMP | 未承認 failed 靠營運紀律 | 加 §8-4 | §8 |
| F31 | nit | 「trigger 擋不了並發」講太滿 | 改「本片拍板不做第三層」 | §4-1 |
| F32 | IMP | 造一列 payment_refund 不證明該扣 | 該驗收格隨 §0-A 刪除 | §0-A |
| F33 | MF | 無 failed/補償退款狀態矩陣 | 併入驗收 12(CHECK 白名單逐值) | §6-12 |

---

## §12 這份 plan 還沒過的關

1. 🏁 **Q-445-1 = A,Sean 2026-08-13 已拍**(§0-D)—— §5/§6 已依 A 案落定
2. ☐ **關卡1 R2 對抗審查**:🔴 **換模型**(R1 是 codex;R2 走 adversarial-reviewer/Fable,
   00-work-rules §5「第 3 輪起換角度換模型」的精神——本 plan 被大幅重寫,等同新 plan)
3. ☐ **Sean 批准**(鐵則 8)
4. ☐ 445b 的 **apply 停點**(素材以 migration 檔頭為準)
