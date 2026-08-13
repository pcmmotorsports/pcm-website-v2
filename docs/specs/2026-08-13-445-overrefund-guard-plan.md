# #445 超退閘 — slice plan **v3**

> 2026-08-13 · 主視窗十四代 · **R1 codex FAIL(33 條)→ v2 全折 → R2 換模型 FAIL(1 BLOCKER + 13 MF)→ 本版**
> 片型 = **高風險片**(鐵則 12①**錢**;12③ schema/RPC)⇒ 鐵則 8 提 plan 等批 + 對抗審查不降級
> 來源 = backlog `#445`(Sean 2026-08-12 **知情推翻拍板⑤**,排 2g 之前)
> 版本史:v1 `5a7497c1` / v2 `e3573f8b`(§4-2「算兩本帳」作廢)/ **v3 = 本版**。
> 🔴 **v3 的存在理由**:v2 §0-B 是主視窗寫下的**假的「做不到」**,而 Sean 的 Q-445-1 拍板建立在它上面。
> R2 抓到後已請 Sean 重拍(=C)。**v2 的 §0-C/§0-D 整段作廢**,理由見 §0-B/§0-C。

---

## §0 v3 的設計方向(含 v2 的自我更正)

### §0-A 🔴 `payment_refunds` **不是**訂單退款帳(codex F09/F10;主視窗開檔複驗)

v1 §4-2 第 2 點寫「算兩本帳:`order_refunds` ∪ `payment_refunds`」。**這一整段作廢。**

實查 `supabase/migrations/20260810140000_m4b_lifecycle_l5b_refund_ledger.sql:75-89`:

- 父表 `payment_refunds.attempt_id` **FK 指向 `payment_charge_attempts(id)`**,不是 `orders`
  ⇒ 它是**某一次刷卡嘗試的補償退款**,不是「這張訂單退了多少貨款」。
- 全檔 `grep -n 'status'` **零命中**(實跑)⇒ 父表**沒有 status 欄**,結果語意在事件流。

**Sean 的 Q3=A 建立在「它是另一本訂單退款帳」這個錯前提上,主視窗已當面撤回(Q12=A)。**
照 v1 寫法的真實後果:客人被重複扣款、我方退了 100 元補償 → 之後**合法的取消訂單退款 100 元會被錯擋**。

### §0-B 🔴🔴 **v2 的自我更正**:「RPC 拿不到 TapPay Record」是**假的**(R2 抓到,BLOCKER)

v2 §0-B 原本寫「RPC 拿不到 Record ⇒ Q9/Q10 只能落 app 層」,並據此改掉整個設計方向。**那是錯的。**

**我證明的是**:RPC **自己打不了 HTTP**(`pg_net` 非同步;`20260723120000:113` `net.http_get`、
包它的 `pcm_cron.invoke_cron_route` RETURNS bigint;`:37`「6h TTL 只管 `net._http_response`」)。**這部分是真的。**

**我寫下的結論是**:RPC **拿不到** Record。**這是假的** —— 因為 RPC 從來不需要自己打:

| 證據 | 逐字 |
|---|---|
| `apps/admin/src/lib/payment/refund-baseline.ts:3-5` | 「DB 打不了 HTTP ⇒ S2 baseline(`record_refunded_before`)與 full 凍結額(`record_amount`)由 server action 從 TapPay Record API 查得後**餵給** RPC」 |
| `20260803150000...sql:427` | 簽章上就有 `p_record_refunded_before bigint` —— 註解逐字「G0 baseline(action 從 Record 查得;缺欄時 action 已 abort)」 |
| `apps/admin/src/lib/payment/refund-actions.ts:230` | **partial 路徑此刻已經在傳** `recordRefundedBefore: baseline.refundedBefore` |

🔴 **病根**:證據句的主詞是「打」,結論句的主詞是「拿」。**動詞換了,那就是兩件事。**
(已寫進 memory `feedback_false-unconstructible-claim-is-worse-than-false-verified` 形狀二。)

### §0-C ✅ v2 §0-C 隨 §0-B 一起作廢(但它描述的坑是真的,只是換一種方式消失)

v2 §0-C 說「app 層加業務判定 ⇒ 上界先於 G4 ⇒ 同 token 重播被判『金額不合法』⇒ 員工換表單再退一次 ⇒ 真的退兩次」。

**這個失敗情境本身是真的**,但它只在「比對留在 app 層」時成立。
比對搬進 RPC 步 4 之後 ⇒ **重播在步 4 就 `DUPLICATE_REQUEST` 返回、根本走不到比對** ⇒ 坑自動消失。

⇒ v2 §0-D 那道額外 SELECT、三條實作契約、+10ms、+20-30 分鐘、驗收 11 a/b/c —— **全部不需要存在**。
它們是為了繞開一個不存在的限制而發明的機制。

### §0-D 🏁 Q-445-1 = **C**(Sean 2026-08-13 二次拍板,推翻同日稍早的 A)

```
Q-445-1(重問): 「已經退多少」的比對要放哪?
拍板 = C:照現有做法把 TapPay Record 的值當參數餵進 RPC,
       比對放在 RPC 內「認出重播」(步 4 G4)之後。
(同日稍早拍的 A —— app 層先查一次是否重播 —— 作廢;
 A 是在主視窗 §0-B 的假前提下拍的,不是 Sean 判斷失誤。)
```

🔴 **C 案的實作比想像的更小 —— 值已經到位,只是沒人用它做判斷**(主視窗實查):

- `p_record_refunded_before` **對兩種 kind 都已生效**:`:475-476` 逐字
  「須為非負整數(G0 baseline;Record 欄缺時 action 必須 abort、**不得傳 0 充數**)」——
  這道 RAISE **不分 partial/full**。
- `:551-554` 已寫進 `order_refunds.record_refunded_before` 欄;`:588` 已進稽核 payload。
- **但全檔沒有任何一處拿它做守門判斷** —— 它只被記錄,不被使用。

⇒ 這與 §2-1 的形狀完全相同:**「算得出來但沒人用」**。本片是把兩個現成的東西接起來,不是新建。

🔴 **R2 說「445a 不得先送、順序要對調」的顧慮不成立**:那條建立在「要放寬 partial 傳 `record_amount`」上
(`:483-485` 確實 RAISE 禁止)。但守門要的是「**已經退了多少**」= `record_refunded_before` 的語意,
**不是** `record_amount`(那是 full 的凍結額)。⇒ **不需要動那道 RAISE,片界順序維持 445a 先。**

### §0-E 🏁 Sean 的驗收定調:**「我要求的是使用上直覺、好用即可」**(2026-08-13)

這句是**驗收條件**,不是感想。轉成可 yes/no 的三條(進 §6):

1. **擋下來的時候,員工看得懂下一步做什麼** —— 不是丟 `REFUND_EXCEEDS_REMAINING`,
   而是「這張單最多還能退 N 元」或「有一筆退款卡住,先去處理它」+ **可以點過去的連結**。
2. **不能擋得莫名其妙** —— 每一種擋下來的情況,訊息都要能讓員工分辨
   「我打太多」/「有東西卡住」/「系統查不到資料」這三種,因為**這三種的處置完全不同**。
3. **正常退款不能因為這片變麻煩** —— 沒有多出來的確認步驟、沒有多一個要填的欄位。

配套 memory:`project_admin-ux-operation-intuitiveness`(後台每片驗收含「不用人教能做對嗎」)。

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
| Q1 幾層 | 前台 + RPC 兩層(不做 DB trigger 層) | 有效;**前台降為提示、守門集中 RPC**,見 §4-1 |
| Q2 算式 | 另寫守門版,方向翻成 blocklist | 有效,**但 `failed` 要三分不是一坨**(§4-2)—— v2 與 codex R1 都寫太粗 |
| ~~Q3 兩本帳~~ | ~~現在就把 `payment_refunds` 算進去~~ | 🔴 **已撤回(Q12=A)** —— 前提錯,見 §0-A |
| Q4 卡單擋到合法退款 | 擋死,但訊息直接指出是哪一筆卡住 | 🔴 **實質縮減**:守門是 SUM 語意,「哪一筆」不存在 ⇒ 改成**指向帳本區塊**(§4-4)。**Sean 有權推翻** |
| Q5 場外退款登記入口 | 不做,守住範圍、另立 backlog | 有效 |
| Q9 partial 也問 TapPay Record | 是 | ✅ **本來就在問**(`refund-actions.ts:230` 已傳 `recordRefundedBefore`)—— 缺的只是「拿它做判斷」(§0-D) |
| Q10 Record 連不上就擋 | 是 | ✅ **本來就會擋**(`refund-baseline.ts:5` 逐字「任一不成立 → action abort、**RPC 零呼叫**」)—— 本片零新增 |
| Q-445-1 比對放哪 | **C**(值當參數傳進 RPC、比對放 G4 之後) | 2026-08-13 二次拍板,推翻同日的 A(§0-D) |
| Q-445-E 驗收定調 | 「使用上直覺、好用即可」 | 轉成 §0-E 三條可 yes/no 條件,進 §6 |

---

## §4 設計

### 4-1 三層各自擋什麼(依 §0-B 更正後重寫)

| 層 | 擋什麼 | **擋不到什麼** |
|---|---|---|
| **前台上界**(`refund-section.tsx` 的 `max` + 即時提示) | 手滑打太多 —— 最大宗,當場看得到 | 竄改 DOM;繞過前台;兩人同時送 |
| **RPC 步 6**(2f 鎖之後、G4 之後、2f veto 之後) | 繞過前台;**並發**(2f 已序列化);帳本超額;**Portal 場外已退**(靠 `record_refunded_before`) | 直接 `INSERT`(需 service_role = 我方自己的程式) |
| TapPay(不動) | 最後一道 | 正式環境拒絕行為只有 sandbox 實證 |

🔴 **與 v2 的差別**:v2 以為 RPC 層看不到 Portal 場外退款。**看得到** —— `record_refunded_before`
就是 TapPay 對「這筆刷卡退了多少」的權威視角,**含 Portal 場外退的**。
⇒ 守門集中在 RPC 一層,前台只做提示。這同時滿足 `refund-actions.ts:111` 既有契約
「解析(純形狀;**業務判定單一真相在 RPC**)」。

### 4-2 守門式:兩個來源取嚴,`failed` 必須**三分**不是一坨

**可退額 = 訂單總額 − max(TapPay 已退, 帳本佔額度合計)**

- **TapPay 已退** = `p_record_refunded_before`(action 已查、已傳、已驗非負;`:475-476`)。
  它含 Portal 場外退款 ⇒ 這是唯一看得到場外的來源。
- **帳本佔額度合計** = `order_refunds` 中**佔額度**的列的 `refund_amount` 合計。

🔴 **「佔額度」的判準(v2 與 codex R1 都寫太粗,本版更正)**:

| 列的狀態 | 佔不佔 | 依據 |
|---|---|---|
| `processing` / `confirmed` | **佔** | 在途或已成立 |
| `deferred` | **不佔** | `:370-372` 逐字「三者語意=**確定沒動錢**」 |
| `failed` + `failed_reason IN ('rejected_out_of_range','not_sent')` | **不佔** | 同上,且 **P7C15 結構保證**(`:373-378`):證據欄非空的列**不得**走這三個終態 ⇒ 能走到的列證據必為空 = TapPay 未曾受理 |
| `failed` + `failed_reason = 'manual_failed'` | **佔** | RW4 人工判定出口,**無結構保證** |
| `failed` + `failed_reason IS NULL` | **佔** | fail-closed |
| **任何其他值(含未來新增)** | **佔** | blocklist 方向(Q2=A) |

🔴 **為什麼一定要三分**:v2 寫「`failed` 一律佔額度」會讓**網路斷線**(`not_sent`,最常見的暫時性失敗)
**永久卡死那張單** —— 而 v2 給的解鎖出口是「補償帳的有效終局證據」,那要等 2g,
而 #445 明定排在 2g **之前** ⇒ **結構上無解**。三分之後這個死結不存在:`not_sent` 本來就不佔。

> 為什麼不改顯示版 `pcm_order_refundable_remaining`:它已被驗收、有措辭鐵律與負向測試綁著。
> **但兩式並存有 4-5 的硬條件。**

### 4-3 RPC 步 6 的改法:partial **與 full 都要**

```
步 6 擴成(位置紀律見下):
  可退額 := 訂單總額 - GREATEST(p_record_refunded_before, 帳本佔額度合計)
  guard  := 可退額

  full   : v_frozen < 1                     → REFUND_NOTHING_LEFT(既有語意,不動)
  full   : v_frozen > guard                 → REFUND_EXCEEDS_REMAINING(新;見下)
  partial: guard IS NULL OR v_frozen > guard → REFUND_EXCEEDS_REMAINING
```

🔴 **full 也要管(v2 漏了,R2 M4)**:v2 只改 partial,而 full 的凍結額來自 TapPay Record、不看帳本
⇒ 員工被擋掉 100 元部分退款後,改按「全額退款」就會被放行。**守門擋住小的、放行大的**,
這是最不直覺的行為(違反 §0-E 第 2 條)。

🔴 **SQL 陷阱**:`IF v_frozen > NULL` 不會進分支(結果是 NULL 不是 true)
⇒ **必須明寫 `guard IS NULL OR v_frozen > guard`**。

**位置紀律(三條都要滿足)**:
1. 步 3(2f advisory lock)**之後** —— 否則並發防不住。
2. 步 4(冪等 G4)**之後** —— 否則同 token 重播拿到超退碼而非 `DUPLICATE_REQUEST`。
   **這條就是 Q-445-1=C 的落點**(§0-C:重播走不到比對)。
3. 2f 的 payment-refund veto **之後** —— 否則在途補償退款會被改回超額碼,
   吃掉原本帶 blocking ID 的 `REFUND_IN_FLIGHT`。
   2f 自帶結構錨 `l5b2_2f_anchor_veto_after_g4` / `..._before_insert`(`20260812170000:792-804`)
   ⇒ **實作時在 2f post-image 上定位這兩個錨之間插入**。

### 4-4 訊息:員工要分得出三種情況(§0-E 第 2 條的落點)

新碼 `REFUND_EXCEEDS_REMAINING`,回傳附帶 `remaining`(可退額)。

**三種擋下來的情況,訊息必須不同**(因為處置完全不同):

| 情況 | 判斷依據 | 員工看到 | 他該做什麼 |
|---|---|---|---|
| 單純打太多 | 無 `processing` 列 | 「這張單最多還能退 N 元」 | 改金額重打 |
| 有東西卡住 | 有 `processing` 列 | 「有一筆退款還在處理中,先去處理它」+ **連到帳本那一列** | 點過去處理 |
| 系統查不到 | `guard IS NULL` | 「查不到這張單的退款額度,**不是**金額問題,請找工程師」 | 回報,不要重試 |

🔴 **`blocked_by_refund_id` 不做(R2 M5)**:守門是 **SUM 語意** —— 三筆各 40 元的列讓 50 元退款被擋時,
**沒有任何一筆是「那一筆」**;回一個列 ID 只會指到任意一筆,員工去處理它之後仍然被擋,
比不給更不直覺。
⇒ Q4=A「訊息直接指出是哪一筆」在 SUM 語意下**做不到**,改成**指向帳本區塊**(那裡列出所有在途的列)。
**這是對 Q4=A 的實質縮減,已寫進 §8,Sean 有權推翻。**

### 4-5 🔴 UI 上界與 RPC 守門線**必須是同一條式子**(R2 M8;§0-E 第 2 條的硬條件)

v2 的形狀:UI 的 `max` 來自 `getLedgerUnregisteredAmount()` → `pcm_order_refundable_remaining`
(顯示版,`failed` **不**佔額度)、RPC 用新守門式(部分 `failed` **佔**額度)
⇒ **顯示式恆 ≥ 守門式** ⇒ 員工照表單填了「看起來合法」的金額,送出後被 RPC 擋。

**這是本片最容易做出來的「不直覺」**,而且它不是 bug、是兩條式子必然的差。

⇒ **硬條件:445a 的 UI 上界改讀新守門式**(新增一支 read 函式包 `pcm_order_refund_guard_remaining`),
**不得**沿用 `getLedgerUnregisteredAmount()`。
⚠️ 措辭仍守 §2-7 鐵律:UI 上顯示的字**不得**寫「還能退」「剩餘可退」——
新值的顯示名稱在 445a 決定並寫進 `refund-ledger-view.ts` 的措辭清單(見 §6-9 的 oracle 問題)。

## §5 片界:**拆三片**(v2 是兩片,§4-5 的硬條件逼出第三片),順序不可顛倒

> 依據:「一片=一支 migration **或**一個純應用層改動,**不混**」;
> memory `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 A9h 正式站壞 8 小時)。

🔴 **為什麼從兩片變三片**:§4-5 要求 UI 上界改讀**新守門式**,而新守門式是 445b 才建的
⇒ 若把它塞進 445a,445a 就依賴一支還沒 apply 的函式 = 正是那條 memory 講的事故形狀。
⇒ **UI 上界獨立成 445c,排在 445b apply 之後。**

### 445a —— 應用層前置(**輕量片**,先做,純向後相容)

| 檔 | 改什麼 |
|---|---|
| `refund-repository.ts:17-26,211` | allowlist 加第 9 碼 + outcome union + parser 型別檢查(`remaining`) |
| `refund-repository.test.ts:72-84,168-177` | 釘死的碼表更新 |
| `refund-action-state.ts` | **三支**文案(§4-4 三種情況),措辭守 §2-7 |
| `refund-actions.ts` | 新碼的 switch 分支 → 對應 failure 態 |
| `order-detail-route.tsx:140-141` | 刪掉 `if (refunds.length > 0)` 短路(§2-6) |

🔴 **445a 此時該碼還不會出現** ⇒ 純向後相容,單獨上線零行為變化(除了刪短路多一趟 RPC)。
🔴 **445a 不做任何金額判定**(§0-C 的教訓 + `refund-actions.ts:111` 既有契約)。

### 445b —— 純 migration(**高風險片**,中間做)

1. 新守門函式 `pcm_order_refund_guard_remaining(uuid, bigint)`
   —— 🔴 **吃兩個參數**(order_id + record_refunded_before),因為 TapPay 那半是 caller 餵的(§4-2)
2. `admin_initiate_order_refund` 步 6 擴充(§4-3;partial **與 full** 都要)+ 第 9 碼
3. **ACL 照 repo 樣板**(`20260801120000...sql:478-479`):
   `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` + `GRANT EXECUTE TO service_role`,
   並配正負斷言(同檔 `:639-648` 是範本)
4. 後置斷言(§2-5 第 3 處;寫在 445b 自己的 migration,**不動 2f 凍結檔**)
5. 同步 `scripts/l5b2-2f-verify.sh` 三格 + `refund-actions-dispatch.test.ts:363` + `scripts/a7c-rw1b-verify.sh:516-522`
   (後兩處是 R2 M10 補的,v2 的八處清單漏了)
6. **apply = Sean 停點**;停點素材以 **migration 檔頭為準**(2f 停點教訓)

### 445c —— 應用層收尾(**標準片**,445b apply 之後才做)

| 檔 | 改什麼 |
|---|---|
| `refund-read.ts` | 新增一支包 `pcm_order_refund_guard_remaining` 的 read 函式 |
| `order-detail-route.tsx` | 改呼叫新函式(順手併進既有的 `Promise.allSettled`,見 R2 C3) |
| `order-detail.tsx` / `refund-section.tsx` | UI 上界改讀新值(§4-5 硬條件)+ 顯示名稱 |
| `refund-ledger-view.ts` | 新值的**顯示名稱**寫進措辭清單(§6-9 的 oracle 問題) |

---

## §6 驗收條件(逐條 yes/no,不可用「應該」回答)

### 445a

1. ☐ **零帳本列的訂單(第一筆退款)** ⇒ 頁面正常渲染、退款入口開著(刪短路的正測)
2. ☐ app 收到 `REFUND_EXCEEDS_REMAINING` ⇒ 不進 unknown-code 路徑
3. ☐ 🔴 **三種擋下來的情況各吐各的文案**(§0-E 第 2 條):打太多 / 有東西卡住 / 查不到資料
4. ☐ RPC 回傳 `remaining` **型別畸形** ⇒ 不流進 UI(codex F03)
5. ☐ 445a 單獨上線 ⇒ **既有退款流程行為零變化**(回歸;§0-E 第 3 條)
6. ☐ 三綠 + `vitest run` 全綠

### 445b

7. ☐ 🔴 **`failed` 三分各一格**(§4-2 表):
   a. `failed`+`not_sent` ⇒ **不佔額度**(= 網路斷線後可以重退。R2 M1 的直接反例)
   b. `failed`+`rejected_out_of_range` ⇒ 不佔額度
   c. `failed`+`manual_failed` ⇒ **佔額度**
   d. `failed`+`failed_reason IS NULL` ⇒ 佔額度(fail-closed)
8. ☐ `deferred` ⇒ 不佔額度
9. ☐ 拋棄式庫 DROP CONSTRAINT 後加**未來新狀態** ⇒ **佔額度**(blocklist 方向的負測)
10. ☐ `guard IS NULL` ⇒ 擋(§4-3 SQL 陷阱,獨立一格)
11. ☐ **TapPay 已退 > 帳本合計**時,以 TapPay 為準(Portal 場外退款的正測)
12. ☐ **帳本合計 > TapPay 已退**時,以帳本為準(在途尚未反映到 Record 的正測)
13. ☐ partial 超額 ⇒ `REFUND_EXCEEDS_REMAINING` + `remaining` 值正確
14. ☐ 🔴 **full 超額 ⇒ 也擋**(R2 M4:v2 漏了 full,會變成「擋小的、放行大的」)
15. ☐ partial 恰等於可退額 ⇒ `INITIATED`(邊界)
16. ☐ 同 token 重播超額 ⇒ `DUPLICATE_REQUEST`(**Q-445-1=C 的核心驗收**:證明比對在 G4 之後)
17. ☐ 在途補償退款存在時 ⇒ `REFUND_IN_FLIGHT`(帶 blocking ID)**不是**超退碼(veto 順序)
    🔴 **要在拋棄式庫手造** `payment_refunds` + `payment_charge_attempts` + terminal 事件列
    (2f 檔頭 `:39` 逐字「否決條件**現在恆假** —— `payment_refunds` 尚無 writer」;R2 M12)
18. ☐ 🔴 **序列兩筆**:第一筆 confirmed 後,第二筆合計超額 ⇒ 擋
    (R2 M6:**不是**兩 token 並發 —— 那個由既有唯一索引
    `order_refunds_single_processing_per_order`(`:197-198`)保證,量不到新守門)
19. ☐ `CREATE OR REPLACE` 後回歸:full 既有語意、advisory lock 位置、G4、2f veto、`lock_timeout`、
    `SECURITY DEFINER`/ACL 全保存
20. ☐ **新函式 ACL 正負斷言**(R2 M9:`public` schema 對 PostgREST 曝露,漏 REVOKE = anon 帶 order UUID
    就能問出金流狀態)
21. ☐ 後置⑦ 閉集斷言含第 9 碼;`l5b2-2f-verify.sh` 三格 + 另兩支 harness 同步後全綠
22. ☐ 回退腳本可單獨跑 + 負測 + **驗 2f post-image 指紋**(§7)

### 445c

23. ☐ 🔴 **UI 顯示的上界 = RPC 實際擋的線**(§4-5 硬條件;R2 M8)——
    造一張有 `manual_failed` 列的單,UI 上界必須與 RPC 守門線**同值**(v2 的形狀下會差一截)
24. ☐ 措辭:新值的顯示名稱**不得**是「還能退」「剩餘可退」(§2-7)
    🔴 **驗法不能寫成「全樹零命中」**(R2 M7):既有 oracle
    `refund-wiring.test.tsx:336-347` 斷言命中**恰好等於** `['components/orders/refund-section.tsx']`
    (合法:`refund-section.tsx:110-111` 是 TapPay 端語意)⇒ 驗收改成「**白名單不變**」,
    且 445c 塞進 `refund-section.tsx` 的新數字**必須進 oracle 的掃描面**,否則那個檔是唯一盲區
25. ☐ 第一筆退款(零帳本列)⇒ UI 上界 = 訂單總額 − TapPay 已退
26. ☐ 三綠 + 回歸

## §7 回退

- 445a:`git revert`,無資料面。
- 445b:`CREATE OR REPLACE` 回 **2f 的 post-image**(🔴 codex F27:v1 只寫「回舊版 RPC」,
  回到 A7c 版本會**一起刪掉 advisory lock 與跨帳本 veto**)+ `DROP FUNCTION` 新守門式;不動任何資料列。
  🔴 **post-image 指紋要在 445b 檔頭釘死**(md5),回退腳本先驗指紋再動手。
- ⚠️ 回退腳本連線拓樸沿用 2f:**直連 5432、不走 pooler 6543**。
- 🔴 **回退不是零風險**(codex F28):不動資料列,但**立即重新開放超退路徑**。
  回退決策要當作「暫時關掉一道錢的守門」來處理,不是「反正沒動資料」。
- 🔴🔴 **445b 上線後,既有的 2f 回退腳本會恆 abort —— 半夜撞到會誤判成「有人偷改函式」**(R2 M11)。
  `scripts/l5b2-2f-rollback.sql:28-29` 的閘② 是**三態閘**:只接受「現況=2f post-image」或
  「現況=2f pre-image」,**其餘一律 abort**;445b 的 `CREATE OR REPLACE` 就是第三態。
  ⇒ **正確動作是先跑 445b 的回退、再跑 2f 的回退**。這句必須同時寫進:
  ①445b migration 檔頭 ②445b 回退腳本開頭 ③本節。(三處同動,否則值班的人看不到。)

---

## §8 誠實邊界

**能宣稱**:擋得住**經由 `admin_initiate_order_refund` 的**超退(前台手滑、繞過前台的 RPC 呼叫、同單並發)。

**不能宣稱**:
1. 🔴 **繞過 RPC 直接 `INSERT` 擋不到**(Q1=A 不做 trigger 層)。能這樣做的身分 = service_role
   = **我方自己的程式**。⇒ 本片守的是「我方經由這支 RPC 造成的超退」,不是「超退不可能發生」。
2. 🔴 **Q4=A 被實質縮減**:守門是 SUM 語意,「是哪一筆卡住」在數學上不存在(§4-4)
   ⇒ 訊息只能指向帳本區塊、不能指向某一列。**這是對已拍板內容的縮減,Sean 有權推翻。**
3. 🔴 **`manual_failed` 的語意靠人工判定**(§4-2):`rejected_out_of_range` / `not_sent` 有 **P7C15
   結構保證**(證據欄必為空),但 `manual_failed` 沒有 ⇒ 本片把它算進佔額度(保守),
   代價是**人工判定為失敗的退款會卡住後續退款**,解鎖要靠人再判一次。
4. TapPay 正式環境拒絕行為**仍只有 sandbox 實證**,本片不改變這件事。
5. 🔴 **445a→445b→445c 三片之間的窗口**(R2 M13,v2 這條講小了):
   · 445a 之後、445b apply 前:**行為零變化**(新碼不會出現)—— 這段是安全的。
   · 445b apply 之後、445c 上線前:**RPC 已經開始擋,但 UI 上界還是舊的顯示式**
     ⇒ 員工會看到「表單說可以、送出被擋」。**這段是三片裡最不直覺的窗口**,
     直接違反 §0-E 第 2 條。⇒ **445b 與 445c 之間的間隔要壓到最短**(同一個工作段內完成),
     若當天做不完,445b 的 apply 就往後排。
6. 🔴 **Portal 場外退款現在擋得住,但只在 Record 查得到的範圍內**:
   `record_refunded_before` 是 TapPay 的權威視角,含場外退款 ⇒ 這個洞比 v1/v2 以為的小很多。
   但 Record 查詢失敗時 action 會 abort(`refund-baseline.ts:5`)⇒ **TapPay 掛掉時退款全部停擺**,
   這是 Q10=A 已知情接受的代價。

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

- **445a**:**60-90 分**(輕量片;五個檔、純向後相容、6 個驗收格)
- **445b**:**150-210 分**(高風險片;守門式 + 步 6 partial&full + 第 9 碼十處同步 + 16 個驗收格
  + 拋棄式庫負測(`failed` 三分 + 未來狀態 + 補償退款 veto)+ ACL 正負斷言 + 回歸包 + 對抗審查)
- **445c**:**45-60 分**(標準片;四個檔 + 4 個驗收格)
  🔴 **必須與 445b 同一個工作段完成**(§8-5:中間的窗口最不直覺)

⚠️ Q-445-1=C 讓 v2 的「+20-30 分」消失(那道額外 SELECT 不需要了),但 §4-5 逼出的 445c 是新增的。

---

## §11-R2 R2(adversarial-reviewer,換模型)findings 逐條折(1 BLOCKER + 13 MF + 4 nit)

| # | 嚴重度 | 摘要 | 折法 | 落點 |
|---|---|---|---|---|
| FW1 | 🔴BLOCKER | 「RPC 拿不到 Record」是假的全稱句 | 整段自我更正 + 三條證據 | §0-B |
| FW2 | MF | FW1 成立則 §0-C/§0-D 作廢、Q-445-1 要重問 | 已請 Sean 重拍 = **C** | §0-C/§0-D |
| FW3 | MF | Record 閘沒有落點檔;Q10 今天就已經是行為 | §3 表改成「本來就在做」、零新增 | §3 |
| M1 | MF | `failed` 一律佔額度 ⇒ 網路斷線的單**永久退不了** | `failed` 三分(`not_sent` 不佔) | §4-2 / §6-7a |
| M2 | MF | 解鎖出口要等 2g、2g 排在本片後 ⇒ 結構無解 | 隨 M1 消滅(不再需要解鎖出口) | §4-2 |
| M3 | MF | 分辨力應落在 `failed_reason` 不是 `status` | 採納,並補 **P7C15 結構保證**依據 | §4-2 |
| M4 | MF | 守門只管 partial ⇒ 擋小的放行大的 | **full 也納入**步 6 | §4-3 / §6-14 |
| M5 | MF | SUM 語意下「是哪一筆」不存在 | 撤 `blocked_by_refund_id`、改指向帳本區塊;**Q4=A 實質縮減**已入誠實邊界 | §4-4 / §8-2 |
| M6 | MF | 驗收「兩 token 並發」零判別力(既有唯一索引已保證) | 改成**序列兩筆** | §6-18 |
| M7 | MF | 措辭「零命中」與既有 oracle 白名單牴觸 | 改成「**白名單不變**」+ 新數字必須進 oracle 掃描面 | §6-24 |
| M8 | MF | UI 上界(顯示式)≠ RPC 守門線 ⇒ 表單說可以、送出被擋 | **同一條式子**;逼出 445c | §4-5 / §5 / §6-23 |
| M9 | MF | 新 SECURITY DEFINER 函式無 ACL ⇒ anon 可問金流狀態 | 照 repo 樣板 REVOKE+GRANT+正負斷言 | §5(445b-3)/ §6-20 |
| M10 | MF | 八處清單仍漏兩支 harness | 補 `refund-actions-dispatch.test.ts:363`、`a7c-rw1b-verify.sh:516-522` | §5(445b-5) |
| M11 | MF | 445b 後 2f 回退腳本恆 abort(三態閘) | 三處同動寫明「先回退 445b」 | §7 |
| M12 | MF | 驗收「在途補償退款」跑不出資料(2g 未建) | 明寫拋棄式庫手造三張表 | §6-17 |
| M13 | MF | §8-6 講小了 | 改成三片之間**兩個窗口**分別評估 | §8-5 |
| C1 | nit | `information_schema` 讀 CHECK 已被判不夠 | 驗收 9 改行為探針(拋棄式庫加未來狀態) | §6-9 |
| C2 | nit | 「查無訂單真 null」頁面路徑不可達 | 該格移除(445a 不再做金額判定) | §6 |
| C3 | nit | 刪短路後多一趟**序列** RPC | 445c 併進既有 `Promise.allSettled` | §5(445c) |
| C4 | nit | `remaining` 進 UI 會撞措辭鐵律 | 顯示名稱在 445c 決定並寫進措辭清單 | §5(445c)/ §6-24 |

🔴 **R2 有一條我駁回**:「445a 不得先送、順序要對調」——
它建立在「要放寬 partial 傳 `record_amount`」上,但守門要的是 `record_refunded_before`(§0-D),
**不需要動那道 RAISE**。⇒ 片界順序維持 445a 先。(依據已寫在 §0-D,可被下一輪推翻。)

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

1. 🏁 **Q-445-1 = C,Sean 2026-08-13 二次拍板**(§0-D);**Q-445-E 驗收定調**已轉成 §0-E 三條
2. 🏁 **R1(codex)FAIL 33 條 → v2 全折**
3. 🏁 **R2(adversarial-reviewer,換模型)FAIL 1 BLOCKER + 13 MF → v3 全折**(§11-R2)
4. ☐ **R3 對抗審查:🔴 必須第三次換角度換模型**(00-work-rules §5:第 3 輪起換角度;
   R1=codex、R2=opus adversarial-reviewer ⇒ **R3 走 Fable 或 codex 換 prompt 角度**)。
   🔴 **R3 要特別打的**:①`failed` 三分的依據(P7C15)我只讀了那一處,**還有沒有別的路徑
   能讓證據欄為空但錢已經動了** ②三片窗口(§8-5)的風險評估是我自己寫的、沒被驗過
   ③§4-5 逼出的 445c 有沒有更簡單的解法(例如 UI 乾脆不顯示上界)
5. ☐ **Sean 批准**(鐵則 8)
6. ☐ 445b 的 **apply 停點**(素材以 migration 檔頭為準)

> 🔴 **本 plan 的自我評價(誠實條款)**:v1→v2→v3 三版,**每一版都有一條方向級的錯**
> (v1 算錯帳本 / v2 假的「做不到」/ v3 待驗)。三版的共同病根都是
> **「我證明了 A、寫下了 B」** —— 下一輪審查請把這當成最可能的失敗形狀來找。
