# #445 超退閘 — slice plan **v4**

> 2026-08-14 · R 窗折 R3 · **R1 codex FAIL(33)→ v2 → R2 換模型 FAIL(1 BLOCKER + 13 MF)→ v3 → R3 兩條換模型線 FAIL(26 MF)→ 本版**
> 片型 = **高風險片**(鐵則 12①**錢**;12③ schema/RPC)⇒ 鐵則 8 提 plan 等批 + 對抗審查不降級
> 來源 = backlog `#445`(Sean 2026-08-12 **知情推翻拍板⑤**,排 2g 之前)
> 版本史:v1 `5a7497c1` / v2 `e3573f8b` / v3 `188e185d` / **v4 = 本版**。
>
> 🔴 **v4 的存在理由**:v3 §4-1/§4-5 的前提「前台已經有一條金額上界」是**假的** ——
> `apps/admin/src/components/orders/refund-section.tsx` 沒有 `max`(量法:`grep -c "max=" <該檔>` = **0**)。
> R3 的三個引擎**各自獨立開同一個檔量到同一件事**。由該前提推出的「§4-5 硬條件 ⇒ 逼出第三片 445c」失去依據。
>
> 🔴 **本版的折法紀律(R3 的交辦)**:v4 裡每一句新寫的因果句都標 **【量到】**(有 `檔案:行號` 或可重跑命令)
> 或 **【推的】**(尚未實測)。標記清單集中在 §13。**這是因為 v1→v3 三版的共同病根是「我證明了 A、寫下了 B」。**
>
> ⏸ **本版刻意不折的 5 條**(A2/A3/A4-窗口二/B4 + 折的過程中改列進來的 B5,理由見 §11):
> §4-5 / §5-445c / §6-23~25 / §8-5 窗口二 / `refund-section.tsx:110-111` 的說明文字 —— 它們的折法依賴 `Q-445-R3-1`
> (445c 做不做)的拍板結果,**兩個分支會長成完全不同的東西**,先折等於替 Sean 拍板。逐條見 §12-A。

---

## §0 設計方向(含 v2/v3 的自我更正)

### §0-A 🔴 `payment_refunds` **不是**訂單退款帳(codex R1 F09/F10;開檔複驗)

v1 §4-2「算兩本帳:`order_refunds` ∪ `payment_refunds`」**整段作廢**。

實查 `supabase/migrations/20260810140000_m4b_lifecycle_l5b_refund_ledger.sql:75-89`:

- 父表 `payment_refunds.attempt_id` **FK 指向 `payment_charge_attempts(id)`**(`:79`),不是 `orders`
  ⇒ 它是**某一次刷卡嘗試的補償退款**,不是「這張訂單退了多少貨款」。
- 父表**沒有 status 欄**(量法:`grep -c "status" <該檔>` = **0**,R3 重跑確認)⇒ 結果語意在事件流。

**Sean 的 Q3=A 建立在「它是另一本訂單退款帳」這個錯前提上,已當面撤回(Q12=A)。**

### §0-B 🔴 v2 的自我更正:「RPC 拿不到 TapPay Record」是**假的**(R2 BLOCKER)

**證明的是**:RPC **自己打不了 HTTP**(`pg_net` 非同步)。**這部分是真的。**
**寫下的結論是**:RPC **拿不到** Record。**這是假的** —— RPC 從來不需要自己打:

| 證據 | 逐字 |
|---|---|
| `apps/admin/src/lib/payment/refund-baseline.ts:3-5` | 「DB 打不了 HTTP ⇒ S2 baseline(`record_refunded_before`)與 full 凍結額(`record_amount`)由 server action 從 TapPay Record API 查得後**餵給** RPC」 |
| `supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:427` | 簽章上就有 `p_record_refunded_before bigint` |
| `apps/admin/src/lib/payment/refund-actions.ts:231` | partial 路徑此刻已經在傳 `recordRefundedBefore: baseline.refundedBefore`(**v3 引 `:230`,實際在 `:231`**;`:230` 是 `recordAmount: null`)|

🔴 **病根**:證據句的主詞是「打」,結論句的主詞是「拿」。**動詞換了,那就是兩件事。**

### §0-C ✅ v2 §0-C 隨 §0-B 一起作廢

比對搬進 RPC 步 4 之後 ⇒ 重播在步 4 就返回(`20260803150000:516-521`,兩個出口逐字見下)、走不到比對
⇒ v2 §0-D 那道額外 SELECT、三條實作契約、+10ms 不需要存在。

⚠️ **R3 補正一句**:v3 §0-C 寫「重播在步 4 就 `DUPLICATE_REQUEST` 返回」——
只有**前次列是 `processing`/`confirmed`** 時才回該碼(`20260803150000:516-520`);前次已終結會 **RAISE**(`:521`)。
兩種都走不到比對,**結論不變,但字面要精確**。【量到】

### §0-D 🏁 Q-445-1 = **C**(Sean 2026-08-13 二次拍板)

```
Q-445-1(重問): 「已經退多少」的比對要放哪?
拍板 = C:照現有做法把 TapPay Record 的值當參數餵進 RPC,
       比對放在 RPC 內「認出重播」(步 4 G4)之後。
```

🔴 **C 案的實作比想像的更小 —— 值已經到位,只是沒人用它做判斷**:

- `p_record_refunded_before` **對兩種 kind 都已生效**:`20260803150000:475-476` 的 RAISE **不分 partial/full**(它在步 1 輸入衛生段,早於 `:480` 起的 kind 分流)。【量到】
- `:551-554` 已寫進 `order_refunds.record_refunded_before`;`:588` 已進稽核 payload。
- **但全檔沒有任何一處拿它做守門判斷** —— 它只被記錄,不被使用。

🔴 **R2「445a 不得先送」的顧慮不成立**:那條建立在「要放寬 partial 傳 `record_amount`」上(`:483-485` 確實 RAISE 禁止),
但守門要的是 `record_refunded_before` 的語意 ⇒ **不需要動那道 RAISE,片界順序維持 445a 先。**

### §0-E 🏁 Sean 的驗收定調:**「我要求的是使用上直覺、好用即可」**

轉成可 yes/no 的三條(進 §6):

1. **擋下來的時候,員工看得懂下一步做什麼** —— 不是丟 `REFUND_EXCEEDS_REMAINING`,
   而是講出金額上限或指出卡住的東西,**並且能點過去**。
   🔴 **v3 在這一條寫的示範文案「這張單最多還能退 N 元」本身違反 §2-7 措辭鐵律**(含禁語「還能退」),
   把它寫進 `refund-action-state.ts` 會讓 `refund-wiring.test.tsx:341` 的 oracle 立刻紅。【量到】
   ⇒ **v4 的示範文案改為「本單目前可受理的退款上限:N 元」**(不含「還能退」「剩餘可退」),
   最終字面在 445a 決定並同步寫進 `refund-ledger-view.ts` 的措辭清單。
2. **不能擋得莫名其妙** —— 每一種擋下來的情況,訊息都要能讓員工分辨
   「我打太多」/「有東西卡住」/「系統查不到資料」,因為**這三種的處置完全不同**。
3. **正常退款不能因為這片變麻煩** —— 沒有多出來的確認步驟、沒有多一個要填的欄位。

---

## §1 一句話目標

**讓 100 元的訂單退不出 99999。**

🔴 **做完也不得宣稱「擋得住超退」**,只能宣稱「**擋得住經由 `admin_initiate_order_refund` 的超退**」(§8)。

---

## §2 偵察(逐條附 `檔案:行號` 或可重跑的量法;沒有出處的一律標【未量】)

### 2-1 算式已經存在,而且只算一半的帳

`20260803150000:394-408` 的 `pcm_order_refundable_remaining(uuid)`:
`o.total - COALESCE((SELECT SUM(r.refund_amount) ... WHERE r.status IN ('processing','confirmed')), 0)`

- COMMENT(`:411`)逐字:「🔴 **不是守門、沒有 trigger 讀它**(拍板⑤)」,同句另有「只反映本帳本,Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值」。
- **查無訂單**回 NULL;**零帳本列**回訂單總額。
- 🔴 **注意那個 `COALESCE(..., 0)`**:`SUM()` 對零列回 **NULL** 不是 0。**新守門式必須照抄這個 COALESCE**(見 §4-3 第三處 NULL 源)。【量到:`:401-405` 就寫在那裡】

### 2-2 守門的位置早就有,是刻意留空的

`order_refunds` 的 INSERT 守門已有六道,COMMENT(`:298`)最後一句逐字「🔴 **不含任何超退檢查(拍板⑤)**」;
同檔 `:25` 是拍板⑤ 原文「**零超退守門**(金額上界不設;TapPay 10051 是權威)」;`:254` 另有劃界句。
⇒ **這不是沒地方放,是當初決定不放。** 本片=推翻該決定(Sean 已知情拍板)。

### 2-3 2f(已 apply)把並發解決了

2f 在 **步 2 之後、步 3 之前**取 order 級 advisory lock(`20260812170000:558-565`,檔頭 `:9` 同句)
⇒ 同一張訂單的退款發起已序列化。守門放在那把鎖之後,並發問題自動消失。

### 2-4 RPC 的檢查順序是合約 —— **座標一律釘 2f post-image**

🔴 **v3 用 `20260803150000` 的座標描述「現況」,但 live body 已被 2f 的 `CREATE OR REPLACE` 換掉**(R3-Fable F12)。
v4 起,凡描述「現在庫裡那支函式」一律釘 `20260812170000`:

| 東西 | 2f post-image 座標 | 內容 |
|---|---|---|
| 步 2 kind/金額互斥 | `:530` | RAISE 面 |
| partial 凍結額 | `:544` | `v_frozen := p_amount` |
| full 凍結額 | `:555` | `v_frozen := p_record_amount::integer` |
| 2f-A advisory | `:558-565` | 步 2 後、步 3 前 |
| 步 3 鎖訂單 | `:567-573` | `FOR NO KEY UPDATE`;`:574-576` `ORDER_NOT_FOUND` |
| 步 4 冪等 G4 | `:583` 起 | 逐欄比指紋 |
| **步 6 NOTHING_LEFT** | **`:605-608`** | `IF p_kind = 'full' AND v_frozen < 1` |
| **2f-B 跨帳本 veto** | **`:610-644`** | **在步 6 之後**、步 8 INSERT 之前 |
| 步 8 INSERT | `:657` 起 | |

九步順序的原始合約仍在 `20260803150000:419-422`(文字未變)。

### 2-5 第 9 碼要同步的地方:**10 處(不是 8 處)**,而且 harness 的面比清單大得多

🔴 **v3 §2-5 自稱「完整同步清單(共 8 處)」,實際 10 處** —— 另兩處只寫在 §5-445b-5(R3-自查 C10)。
**「完整」二字在 v4 拿掉**,清單改為下表 10 列:

| # | 位置 | 動作 |
|---|---|---|
| 1 | `admin_initiate_order_refund` 函式體 | 新增回傳點 |
| 2 | 該函式 COMMENT(`20260803150000:599`) | 8 碼全集 → 9 碼 |
| 3 | 445b 自己 migration 的後置斷言 | 8 碼 regex → 9 碼、絕對數 10 → 新數 |
| 4 | `refund-repository.ts:17-26` allowlist | 加碼 |
| 5 | `refund-repository.ts` outcome union(`:151-159`) | 加碼 + `remaining` |
| 6 | `refund-repository.ts:211` 未知碼 throw 的 parser | 對齊 |
| 7 | `refund-repository.test.ts:72-84` | 釘死的八碼 → 更新 |
| 8 | `scripts/l5b2-2f-verify.sh` E1a(`:396-401`)/ E1b(`:402-406`)/ **M15**(`:621`) | 三格 |
| 9 | `apps/admin/src/lib/payment/refund-actions-dispatch.test.ts:363` | 碼→state 對照表 |
| 10 | `scripts/a7c-rw1b-verify.sh:516-522` | c24 cell |

🔴 **2f 的交辦逐字**(`20260812170000:1011-1012`,**v3 引 `:1010` 差兩行**):
「⚠️ 合法增刪回傳點時這裡會擋 ⇒ …那時要一起改的是:**本 PIN、COMMENT 的 8 碼全集、呼叫端 allowlist**。」

#### 2-5a 🔴 harness 的真實面遠大於上表(R3-codex + R3-自查)

1. **`scripts/l5b2-2f-verify.sh` 會在跑到 E1a/E1b/M15 **之前**就紅** ——
   `:32` `POST_MD5_EXPECT="6ad5549694cc49bc97b38958724e887a"` 比的是**庫裡的 prosrc**,
   445b 一改函式,開頭那格就不符(檔頭 `:28` 逐字「改了 migration/rollback 沒重量這裡 ⇒ 本檔拒跑」)。
   ⇒ **445b 必須決定這支 2f harness 的處置**(重量指紋 / 標記為 2f 世代凍結 / 另立 445b 版),
   否則「跑完全綠」這個驗收條件本身不可達。【量到】
2. **兩支 live harness 對 `admin_initiate_order_refund` 的呼叫共 97 處**
   (量法:`grep -c "admin_initiate_order_refund" scripts/a7c-rw1b-verify.sh` = **37**、
   `... scripts/l5b2-2f-verify.sh` = **60**)。445b 加了金額守門後,**任何 fixture 金額超過新可退額的既有 cell 都會改碼**。
   ⇒ **445b 的第一個動作不是寫 SQL,是先在拋棄式庫跑一次現有兩支 harness、量出實際紅格數**,
   再決定要改 fixture 還是改期望值。**這個數字現在未知**【未量:需要拋棄式庫,本輪沒跑】。

### 2-6 前台的值流:短路會封死第一筆退款,但刪短路有代價

`order-detail.tsx:473` 逐字 `!(refundUnregisteredAmount !== null && refundUnregisteredAmount < 0) &&`
⇒ 未登記額為負時退款入口 fail-closed 關閉。值流:`order-detail-route.tsx:156` 取 → `:233` 傳 → `order-detail.tsx:475` 用。

🔴 **v3 的行號已漂**(v3 寫 `:429` / `:140-141` / `:143` / `:220` / `:410`,那是 plan commit `188e185d` 當時的座標;
兩檔在 `188e185d..HEAD` 各 +28 / +76 行)。**v4 起施工清單一律用字面 anchor,不用純行號。**

`order-detail-route.tsx:153-154` 逐字:

```
// 有帳本列才查未登記額(零列時該數=訂單總額,無資訊、省一趟)。
if (refunds.length > 0) {
```

⇒ **零帳本列(= 每張訂單的第一筆退款)時 `refundUnregisteredAmount` 恆為 `null`**,
任何「讀不到 ⇒ 擋」的驗收會封死每一張訂單的第一筆退款。

**修法(最小):刪掉那個 `if` 短路,一律查。**

🔴 **但這不是「零行為變化」(R3 三引擎收斂;v3 §6-5 照字面必紅)**:
`order-detail-route.tsx:157-161` 該 RPC 一 throw 就 `refundUnregisteredFailed = true`,
`order-detail.tsx:472` 讓退款入口整個關閉。現況零帳本列時**根本不呼叫** ⇒ 刪短路後
**每一張訂單的退款入口都新增一條對 `pcm_order_refundable_remaining` 可用性的 fail-closed 依賴**。【量到】
⇒ §6 必須有「該 RPC 失敗 ⇒ 入口關閉」這一格,而且 §8 要把它列成 445a 的新行為,**不能寫「零變化」**。

⚠️ **措辭更正**:v3 §2-6 寫「零列時它回訂單總額 = **正確上界**」——
`20260803150000:411` COMMENT 逐字「Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值」⇒ 那是**上界的上界**。
v4 改寫成「零列時它回訂單總額,**不含 Portal 場外退款**」。

### 2-7 措辭鐵律(不得違反,已有負向測試盯著)

`refund-ledger-view.ts:4-8` 逐字:「UI 措辭必須是「**帳本未登記額**」,**不得**寫「還能退」「剩餘可退」——
值班照著錯的名字按下去 = 同一筆錢退兩次。」
oracle = `refund-wiring.test.tsx:336-347`,正規式 `/還能退|剩餘可退/`,
斷言 `expect(hits).toEqual(['components/orders/refund-section.tsx'])` = **檔案粒度白名單**。

### 2-8 現行 canonical 的 `failed` 語意

`20260812140000_m4b_lifecycle_refund_manual_reversal.sql:438-445` 已明寫:
**舊帳 `failed` 無結構保證**(逐字「`order_refunds.status='failed'` **只有值域 CHECK**,沒有任何約束保證『外呼沒發生過』」)、
**補償帳必讀有效終局**。`20260811030000:135-136` 同一句逐字重述。

---

## §3 Sean 拍板(現況)

| 題 | 拍板 | 狀態 |
|---|---|---|
| Q1 幾層 | 前台 + RPC 兩層(不做 DB trigger 層) | 有效;**守門集中 RPC**,前台那層的現況見 §4-1 |
| Q2 算式 | 另寫守門版,方向翻成 blocklist | 有效,**`failed` 要三分**(§4-2) |
| ~~Q3 兩本帳~~ | ~~現在就把 `payment_refunds` 算進去~~ | 🔴 **已撤回(Q12=A)**,見 §0-A |
| Q4 卡單擋到合法退款 | 擋死,但訊息直接指出是哪一筆卡住 | 🔴 **實質縮減**:守門是 SUM 語意,「哪一筆」不存在 ⇒ 改成指向帳本區塊(§4-4)。**Sean 有權推翻** |
| Q5 場外退款登記入口 | 不做,守住範圍、另立 backlog | 有效 |
| Q9 partial 也問 TapPay Record | 是 | ✅ 本來就在問(`refund-actions.ts:231`)—— 缺的只是「拿它做判斷」 |
| Q10 Record 連不上就擋 | 是 | ✅ 本來就會擋(`refund-baseline.ts:5` 逐字「任一不成立 → action abort、**RPC 零呼叫**」)|
| Q-445-1 比對放哪 | **C** | 2026-08-13 二次拍板(§0-D) |
| Q-445-E 驗收定調 | 「使用上直覺、好用即可」 | 轉成 §0-E 三條 |
| **Q-445-R3-1 445c 做不做** | **☐ 未拍板** | **§12-A 的 4 條全部卡在這裡;選項與推薦見 §12-A** |

---

## §4 設計

### 4-1 三層各自擋什麼(🔴 依 R3 的事實更正重寫)

| 層 | 現況 | 本片之後 |
|---|---|---|
| **前台** | 🔴 **今天沒有任何金額上界**。`refund-section.tsx` 的 props 只有 `{orderId, returnTo, serverToken}`(`:56-69`),金額欄只有 `pattern='[1-9][0-9]{0,9}'` 與 `maxLength={10}`(**字元數,不是金額**,`:154-165`);`RefundSection` **不收** `unregisteredAmount`(量法:`grep -c "max=" <該檔>` = 0)。未登記額只流到 `RefundLedgerSection`(`order-detail.tsx:452-459`)與 `:470-475` 的 fail-closed 閘 | **⏸ 待 `Q-445-R3-1`**(§12-A)|
| **RPC 步 6 之後** | 零金額守門(拍板⑤)| **本片的落點**:擋繞過前台、並發(2f 已序列化)、帳本超額、**Portal 場外已退**(靠 `record_refunded_before`)|
| TapPay | 最後一道 | 不動;正式環境拒絕行為只有 sandbox 實證 |

🔴 **與 v2/v3 的差別**:v2 以為 RPC 層看不到 Portal 場外退款,**看得到**;
v3 以為前台已經有上界要「改讀新式」,**沒有**。⇒ 守門集中在 RPC 一層,前台那層的處置是拍板題。

### 4-2 守門式:兩個來源取嚴,`failed` 必須**三分**

**可退額 = 訂單總額 − GREATEST(TapPay 已退, 帳本佔額度合計)**

- **TapPay 已退** = `p_record_refunded_before`(action 已查、已傳、已驗非負;`20260803150000:475-476`)。含 Portal 場外退款。
- **帳本佔額度合計** = `order_refunds` 中佔額度的列的 `refund_amount` 合計,
  🔴 **必須 `COALESCE(SUM(...), 0)`**(見 §4-3 第三處 NULL 源)。

🔴 **「佔額度」的判準**:

| 列的狀態 | 佔不佔 | 依據 |
|---|---|---|
| `processing` / `confirmed` | **佔** | 在途或已成立 |
| `deferred` | **不佔** | `20260803150000:370-373` 逐字「三者語意=確定沒動錢」 |
| `failed` + `failed_reason IN ('rejected_out_of_range','not_sent')` **且證據欄為空** | **不佔** | 見下方「依據更正」 |
| **`failed` 且 `provider_refund_id_evidence` 非空** | **🔴 佔(v4 新增)** | R3-Fable F8:P7C15 只擋「轉移當下」,已 `failed` 列可事後 `NULL→值` 補寫證據(`:348-352` write-once 只擋非空改值)⇒ 判準要結構自足,不依賴 writer 紀律 |
| `failed` + `failed_reason = 'manual_failed'` | **佔** | RW4 人工判定出口,無結構保證。🔴 **代價見 §8-3 與 backlog `#473`** |
| `failed` + `failed_reason IS NULL` | — | 🔴 **這個組合在正式 schema 不存在**(`20260725130100_m3_rf2a2_order_refunds_ledger.sql:127-128` `order_refunds_failed_consistency` 逐字 `CHECK ((status='failed') = (failed_reason IS NOT NULL AND btrim(failed_reason) <> ''))`)⇒ 式子仍寫 fail-closed(blocklist 預設佔),但**驗收格要改**(§6) |
| **任何其他值(含未來新增)** | **佔** | blocklist 方向(Q2=A) |

🔴 **依據更正(R3 三引擎收斂;v3 措辭過強)**:
v3 寫「**P7C15 結構保證**:證據欄非空的列不得走這三個終態 ⇒ 能走到的列證據必為空 = TapPay 未曾受理」。
P7C15(`20260803150000:374-378`)的條件是 `OLD.provider_refund_id_evidence IS NOT NULL`,
⇒ 它保證的是「**證據欄非空**的列不得走零動錢終態」;
「證據欄為空 ⇒ TapPay 未曾受理」**不是它保證的**,靠的是 app 層的錯誤二分紀律:

- `not_sent` 的唯一 app 寫入點 = `refund-actions.ts:320-335`,只在 `TapPayRefundNotSentError` 時觸發;
- 該例外的全部 throw 點都在 `fetch` **之前**(`packages/adapters/src/tappay/TapPayChargeAdapter.ts:245-303`),
  且 adapter 在 fetch 之後**顯式把誤用的 NotSentError 重包成裸 Error**(`:344-353`、`:362-366`);
- 送出後的一切異常走 unknown-state(`refund-actions.ts:343-345`)⇒ **不 finalize、列留 `processing`** ⇒ 佔額度。
  【量到,量法:`grep -rn "not_sent" apps packages supabase scripts` 逐處開檔】

⇒ **v4 的字面**:三分的依據是「**app 層錯誤二分紀律 + P7C15 擋住反向竄改**」,不是「P7C15 單獨保證」。
上表新增的「證據非空即佔」那一列,就是把這條紀律的缺口補成結構判準。

🔴 **為什麼一定要三分**:「`failed` 一律佔額度」會讓**網路斷線**(`not_sent`)永久卡死那張單,
而解鎖出口要等 2g、#445 又排在 2g 之前 ⇒ 結構上無解。三分之後這個死結不存在。

#### 4-2a 兩條未陳述的假設(v4 補寫;R3-自查 G1 / Fable G2)

1. **`GREATEST` 不低估,依賴的是別片建的索引。** 兩個來源可以不相交(Portal 場外退在 Record、在途列不在 Record)。
   目前不低估靠 partial unique index `order_refunds_single_processing_per_order`(`20260803150000:197-198`)
   擋掉在途重疊 —— 2f 自己 `:616-617` 就是這樣寫的。**那條索引不是本片建的,它被改動時本守門會靜默 fail-open。**【量到:2f 註解逐字】
2. **「TapPay 請款額 == `orders.total`」未經陳述。** 守門式混用兩個尺度。與 `#444`(`payment_charge_attempts.order_id` 無 immutable 守門)同族。【未量:本輪沒查多次刷卡/尾款情境下 `orders.total` 與單一 `rec_trade_id` 的關係】

> 為什麼不改顯示版 `pcm_order_refundable_remaining`:它已被驗收、有措辭鐵律與負向測試綁著。

### 4-3 RPC 的改法:partial **與 full 都要**,而且位置不是「步 6」

🔴 **v3 的「步 6 擴成」與位置紀律 3「veto 之後」在幾何上互斥**(R3 codex + Fable 收斂):
2f post-image 裡 **步 6 在 `:605-608`、veto 在 `:610-644`** ⇒ 「擴充步 6」必然落在 veto 之前。【量到】

**v4 明定最終逐步順序(施工者照這個寫,不要再從『步 6』推):**

```
… 步 5 業務前置(LEDGER_FULL / NOT_REFUNDABLE / NO_CARD_TRANSACTION)
  步 6      full 的 v_frozen < 1                    → REFUND_NOTHING_LEFT   （既有,不動）
  2f-B      跨帳本 veto                              → REFUND_IN_FLIGHT      （既有,不動）
  🆕 6b     超退守門                                  → REFUND_EXCEEDS_REMAINING
  步 7 產鍵 → 步 8 INSERT → 步 9 稽核
```

**新段落名稱 = 「步 6b」,插入點 = 2f 的兩個結構錨之間**
(`l5b2_2f_anchor_veto_after_g4` `20260812170000:795` / `..._before_insert` `:804`)。
這個順序讓四個具體診斷與 `REFUND_IN_FLIGHT` 都**優先於**籠統的超額碼,與 2f 自己 `:614-615` 的取捨一致。

**步 6b 的式子:**

```
guard := 訂單總額 - GREATEST(p_record_refunded_before, COALESCE(帳本佔額度合計, 0))

full   : guard IS NULL OR v_frozen > guard → REFUND_EXCEEDS_REMAINING
partial: guard IS NULL OR v_frozen > guard → REFUND_EXCEEDS_REMAINING
```

🔴 **C1(R3 最重的一條,金流 fail-open):v3 只在 partial 那行寫了 `guard IS NULL OR`,full 那行沒寫。**
`v_frozen > NULL` 的結果是 NULL 不是 true ⇒ **full 路徑會直接放行**。v4 兩行對稱。

🔴 **full 也要管**:full 的凍結額來自 TapPay Record、不看帳本 ⇒ 員工被擋掉 100 元部分退款後,
改按「全額退款」就會被放行。**守門擋住小的、放行大的**,違反 §0-E 第 2 條。

#### 4-3a 🔴 C1 的病邊界:NULL 源一共幾個(R3 交辦「還有沒有第三處」)

**今天的函式體內沒有第三處**(量法:`grep -n "v_frozen" 20260812170000` 全部 12 處逐一開檔;
拿 `v_frozen` 做比較的只有 `:583` / `:669`(等值比對,`v_row` 來自 FOUND 分支)與 `:606`(`< 1`);
其餘既有大小比較都是對**參數**做的,而參數在 `:526`/`:534`/`:545`/`:548` 都先過 `IS NULL OR` 檢查)。【量到】

**但 445b 會親手製造兩個新的 NULL 源:**

1. `guard` 本身(新函式回傳)—— 已由上面兩行 `guard IS NULL OR` 接住。
2. 🔴 **`SUM(refund_amount)` 對零列回 NULL** —— **這是 v3 完全沒寫的一處**。
   零帳本列 = 每張訂單的**第一筆退款**。若式子照 v3 字面寫成沒有 COALESCE 的 SUM,
   NULL 會沿著算式傳染到 `guard` ⇒ 走 `guard IS NULL` 分支 ⇒ **每一張訂單的第一筆退款都被擋死**。
   這與 §2-6 的前台短路是**同一型的坑,在 DB 側重演一次**。
   ⇒ **式子必須 `COALESCE(SUM(...), 0)`,且不得依賴 `GREATEST` 對 NULL 的處理方式**
   (那條語意我沒有實跑驗證【未量】,不要把守門的正確性押在上面)。
   ⇒ §6 新增一格:零帳本列的第一筆退款 ⇒ `guard` = 訂單總額 − TapPay 已退,**不是 NULL**。

### 4-4 訊息:員工要分得出三種情況(§0-E 第 2 條的落點)

新碼 `REFUND_EXCEEDS_REMAINING`。

🔴 **回傳 payload 不能只有 `remaining`(R3 codex + Fable 收斂)**:
`refund-repository.ts:151-159` 的非 INITIATED/DUPLICATE 分支**不帶任何額外欄位**;
而 §0-E 第 2 條要求的三分判斷依據(「有沒有在途的列」)**只有 RPC 知道**。
⇒ **RPC 回傳必須帶 discriminator**,否則 app 拿一個碼加一個數,分不出「打太多」與「有東西卡住」。【量到】

**v4 的回傳形狀:**

```json
{ "result": "REFUND_EXCEEDS_REMAINING",
  "remaining": <bigint | null>,
  "blocked_by": "amount" | "in_flight" | "unknown" }
```

| 情況 | `blocked_by` | 員工看到 | 他該做什麼 |
|---|---|---|---|
| 單純打太多 | `amount` | 「本單目前可受理的退款上限:N 元」 | 改金額重打 |
| 有東西卡住 | `in_flight` | 「有一筆退款還在處理中,請先處理它」+ **連到帳本區塊** | 點過去處理 |
| 系統查不到 | `unknown`(`guard IS NULL`)| 「查不到這張單的退款額度,**不是**金額問題,請找工程師」 | 回報,不要重試 |

🔴 **「可以點過去」在 445a 目前交付不出來(R3 codex)**:
`refund-section.tsx:114-121` 的 failure 只渲染 `<p role='alert'>{state.message}</p>`(純字串),
`refund-action-state.ts` 的 failure state 也只有字串。
⇒ **445a 的檔案清單要加上「failure state 支援一個可選的錨點連結」**,否則 §0-E 第 1 條做不到。【量到】

🔴 **`blocked_by_refund_id` 不做**:守門是 **SUM 語意** —— 三筆各 40 元的列讓 50 元退款被擋時,
沒有任何一筆是「那一筆」。⇒ Q4=A 在 SUM 語意下**做不到**,改成指向帳本區塊。**已入 §8-2,Sean 有權推翻。**

🔴 **`manual_failed` 會被上表誤導(R3 codex,v4 修正)**:
`manual_failed` 列不是 `processing` ⇒ 依「有無在途列」判會落到 `amount` 分支,
員工看到「上限 N 元」、同頁帳本卻寫著「失敗、錢沒有動」,**他降低金額仍持續被擋**。
⇒ **`blocked_by` 的判定不能只看 `processing`**:凡「帳本佔額度合計 > 0 且該合計來自非 `processing` 的列」
一律走 `in_flight` 文案,並在訊息裡點名該列的狀態。**根因(那種列沒有解鎖出口)已獨立成 backlog `#473`。**

### 4-5 ⏸ **待 `Q-445-R3-1` 拍板 —— 本節不折**

v3 這一節的前提(「UI 的 `max` 來自 `getLedgerUnregisteredAmount()`」)已被 §4-1 證否。
**兩個分支會長成完全不同的東西**,先折等於替 Sean 拍板 ⇒ 見 §12-A。

---

## §5 片界

### 445a —— 應用層前置(**輕量片**,先做,純向後相容除下述一項)

| 檔 | 改什麼 |
|---|---|
| `refund-repository.ts:17-26,151-159,211` | allowlist 加第 9 碼 + outcome union 加 `remaining`/`blocked_by` + parser 型別檢查 |
| `refund-repository.test.ts:72-84` | 釘死的碼表更新 |
| `refund-action-state.ts` | **三支**文案(§4-4);🔴 **字面不得含「還能退」「剩餘可退」**(§0-E-1) |
| `refund-actions.ts` | 新碼的 switch 分支 → 對應 failure 態(帶 `blocked_by`)|
| `refund-actions-dispatch.test.ts:363` | 碼→state 對照表加一列 |
| **`refund-action-state.ts` + `refund-section.tsx`** | 🆕 failure state 支援可選錨點連結(§4-4)|
| `order-detail-route.tsx`(anchor:`if (refunds.length > 0)` 那行)| 刪短路(§2-6)|

🔴 **445a 不是「零行為變化」** —— 刪短路那一項會新增一條 fail-closed 依賴(§2-6),**必須寫進 §8 與驗收**。
🔴 **445a 不做任何金額判定**(`refund-actions.ts:111` 既有契約「業務判定單一真相在 RPC」)。

### 445b —— 純 migration(**高風險片**,中間做)

0. 🆕 **開工第一件事**:拋棄式庫跑一次 `scripts/a7c-rw1b-verify.sh` 與 `scripts/l5b2-2f-verify.sh`,
   量出 445b 之後會變紅的既有 cell 數(現在未知,見 §2-5a);**量到之前不要開始寫 SQL**。
1. 新守門函式 `pcm_order_refund_guard_remaining(uuid, bigint)`(吃 order_id + record_refunded_before),
   **內部 `COALESCE(SUM(...), 0)`**(§4-3a)
2. `admin_initiate_order_refund` 新增**步 6b**(§4-3;partial 與 full 都要,兩行都帶 `guard IS NULL OR`)+ 第 9 碼 + `blocked_by`
3. **ACL 照 repo 樣板**(`20260801120000_m4b_e10_a7c_refund_ledger_guards.sql:478-479`
   `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` + `GRANT EXECUTE ... TO service_role`),
   並配正負斷言(同檔 `:639-648` 是範本)
4. 後置斷言寫在 445b 自己的 migration(**不動 `20260812170000` 凍結檔**)
5. 同步 §2-5 表的 10 處 + §2-5a 量到的紅格
6. 🆕 **2f harness 的處置決定**(§2-5a 第 1 點)
7. **apply = Sean 停點**;停點素材以 **migration 檔頭為準**
8. 🔴 **硬前置:backlog `#473`**(`manual_failed` 無解鎖出口)—— 本片把 `manual_failed` 算成佔額度,
   apply 那一刻它就從「紀錄改不了」升級成「那張訂單永遠退不了款」。**`#473` 沒有出口之前不得 apply 445b。**

### 445c —— ⏸ **待 `Q-445-R3-1` 拍板**(§12-A)

---

## §6 驗收條件(逐條 yes/no)

### 445a

1. ☐ **零帳本列的訂單(第一筆退款)** ⇒ 頁面正常渲染、退款入口開著
2. ☐ 🔴 **`pcm_order_refundable_remaining` 呼叫失敗 ⇒ 退款入口 fail-closed 關閉**(§2-6 的新行為,**不是回歸格**)
3. ☐ app 收到 `REFUND_EXCEEDS_REMAINING` ⇒ 不進 unknown-code 路徑
4. ☐ 🔴 **三種情況各吐各的文案**,判別依據是 `blocked_by` 不是猜的(§4-4)
5. ☐ 🔴 **`in_flight` 文案帶得出可點的錨點連結**(§4-4;純字串不算過)
6. ☐ 🔴 **三支文案的字面過措辭 oracle**:`vitest run refund-wiring` 綠、且 `hits` 白名單不變
7. ☐ RPC 回傳 `remaining` / `blocked_by` **型別畸形** ⇒ 不流進 UI
8. ☐ 445a 單獨上線 ⇒ **除了第 2 格那條新依賴之外**,既有退款流程行為零變化
9. ☐ 三綠 + `vitest run` 全綠

### 445b

10. ☐ 🔴 **零帳本列 ⇒ `guard` = 訂單總額 − TapPay 已退,不是 NULL**(§4-3a 第二處 NULL 源;**這格若紅 = 第一筆退款全被擋**)
11. ☐ 🔴 **`guard IS NULL` ⇒ 擋,partial 與 full 各一格**(C1;full 那格是本輪最重的負測)
12. ☐ `failed`+`not_sent`+證據欄空 ⇒ **不佔額度**
13. ☐ `failed`+`rejected_out_of_range`+證據欄空 ⇒ 不佔額度
14. ☐ 🆕 **`failed`+`not_sent`+證據欄非空 ⇒ 佔額度**(§4-2 新增列)
15. ☐ `failed`+`manual_failed` ⇒ **佔額度**
16. ☐ `deferred` ⇒ 不佔額度
17. ☐ **未來新狀態 ⇒ 佔額度**(blocklist 負測)。
    🔴 **只 DROP status CHECK 不夠**:`20260803150000:298` INSERT 守門 ①初態必須 `processing`、
    `:211-215` 狀態機逐字「唯三合法轉移」⇒ 拋棄式庫要同時卸掉這兩道,否則測試在進守門公式前就失敗
18. ☐ **TapPay 已退 > 帳本合計**時以 TapPay 為準(Portal 場外退款正測)
19. ☐ **帳本合計 > TapPay 已退**時以帳本為準
20. ☐ partial 超額 ⇒ `REFUND_EXCEEDS_REMAINING` + `remaining` 值正確 + `blocked_by='amount'`
21. ☐ 🔴 **full 超額 ⇒ 也擋**
22. ☐ partial 恰等於可退額 ⇒ `INITIATED`(邊界)
23. ☐ 同 token 重播超額 ⇒ `DUPLICATE_REQUEST`(**Q-445-1=C 的核心驗收**)
24. ☐ 在途補償退款存在時 ⇒ `REFUND_IN_FLIGHT`(帶 blocking ID)**不是**超退碼。
    🔴 **fixture 不得加 terminal 事件列**:veto 的條件是
    `NOT EXISTS (... payment_refund_effective_terminal ...)`(`20260812170000:626-627`)⇒
    加了 terminal 就把 fixture 排除在 veto 之外,永遠量不到該碼。要造的是
    `payment_refunds` + `payment_charge_attempts` + **無**有效終局、**無** `result_success` 事件的列
25. ☐ 🔴 **序列兩筆**:第一筆 confirmed 後,第二筆合計超額 ⇒ 擋(**不是**兩 token 並發)
26. ☐ `CREATE OR REPLACE` 後回歸:full 既有語意、advisory 位置、G4、2f veto、`lock_timeout`、`SECURITY DEFINER`/ACL 全保存
27. ☐ **新函式 ACL 正負斷言**(`public` schema 對 PostgREST 曝露,漏 REVOKE = anon 帶 order UUID 就能問出金流狀態)
28. ☐ 後置斷言含第 9 碼;§2-5 表 10 處全同步;**§2-5a 量到的紅格全部處理完**
29. ☐ 🔴 **2f harness 的處置已決定並執行**(§2-5a 第 1 點;`POST_MD5_EXPECT` 那格的去留寫進 445b 檔頭)
30. ☐ 回退腳本可單獨跑 + 負測 + 驗 2f post-image 指紋(§7)
31. ☐ 🔴 **`#473` 已有解鎖出口**(445b apply 的硬前置,§5-445b-8)

### 445c —— ⏸ **待 `Q-445-R3-1` 拍板**(v3 的 §6-23/24/25 全部凍結,見 §12-A)

---

## §7 回退

- 445a:`git revert`,無資料面。
- 445b:`CREATE OR REPLACE` 回 **2f 的 post-image** + `DROP FUNCTION` 新守門式;不動任何資料列。

🔴 **v3 這一節有三個洞,v4 補**:

1. **不只回 body,COMMENT 也要回。** `scripts/l5b2-2f-rollback.sql:30-32` 的閘②b 逐字
   「prosrc 相符還不夠…**proconfig / COMMENT / 七個屬性**」,`:78` 釘 `c_post_cmt_md5='d9ff6ab4b4086076be9100233f124b97'`。
   445b 會改 COMMENT(§2-5 第 2 處)⇒ **只回 body 會讓 2f 的三態閘判第三態、abort**。【量到】
2. **post-image 的 SQL 文字從哪拿,plan 必須指定。** `scripts/l5b2-2f-rollback.sql:395` 的閘③ 逐字
   「還原 body 與 COMMENT(**來源逐字 = `20260803150000`**,同一世代)」= 那是 2f 的 **pre-image**。
   ⇒ 值班若照直覺去複製現成的 2f rollback,拿到的是 pre-image,**連 advisory lock 與跨帳本 veto 一起刪掉**。
   **445b 的回退腳本必須自帶 2f post-image 全文,並在檔頭釘 `POST_MD5 = 6ad5549694cc49bc97b38958724e887a`**
   (該值可在 `scripts/l5b2-2f-rollback.sql:67` 與 `scripts/l5b2-2f-verify.sh:32` 對照,**不要自己重算**)。【量到】
3. **445b 的回退必須是單一交易。** `scripts/l5b2-2f-rollback.sql:58` 是 `BEGIN;` 單一交易;
   445b 的回退是兩步(`CREATE OR REPLACE` + `DROP FUNCTION`)⇒ 第一步成功、第二步失敗時,
   庫裡會變成「RPC 已回舊版但新 helper 還在」。**兩步包在同一個交易裡。**

- ⚠️ 回退腳本連線拓樸沿用 2f:**直連 5432、不走 pooler 6543**。
- 🔴 **回退不是零風險**:不動資料列,但**立即重新開放超退路徑**。
- 🔴🔴 **445b 上線後,既有的 2f 回退腳本會恆 abort** —— `scripts/l5b2-2f-rollback.sql:28-29` 的閘② 是三態閘,
  445b 的 `CREATE OR REPLACE` 就是第三態。⇒ **正確動作是先跑 445b 的回退、再跑 2f 的回退**,
  而且 445b 的回退要照上面第 1 點把 COMMENT 一起還原,否則第二步照樣 abort。
  這句必須同時寫進:①445b migration 檔頭 ②445b 回退腳本開頭 ③本節。

---

## §8 誠實邊界

**能宣稱**:擋得住**經由 `admin_initiate_order_refund` 的**超退(前台繞過、同單並發、帳本超額、Portal 場外已退)。

**不能宣稱**:

1. 🔴 **繞過 RPC 直接 `INSERT` 擋不到**(Q1=A 不做 trigger 層)。能這樣做的身分 = service_role = **我方自己的程式**。
2. 🔴 **Q4=A 被實質縮減**:守門是 SUM 語意,「是哪一筆卡住」在數學上不存在 ⇒ 訊息只能指向帳本區塊。**Sean 有權推翻。**
3. 🔴 **`manual_failed` 的語意靠人工判定,而且它沒有解鎖出口** —— `refund-recovery-actions.ts:87` 逐字
   `if (row.status !== 'processing') return { ok: false, code: 'already_finalized' };`,而 `manual_failed` 是終態
   (`20260803150000:211-215`)⇒ 本片把它算進佔額度之後,**那張訂單的退款會被永久擋住**,
   後台沒有任何 UI 能解開。**已獨立成 backlog `#473`,並列為 445b apply 的硬前置(§5-445b-8)。**【量到】
4. TapPay 正式環境拒絕行為**仍只有 sandbox 實證**。
5. 🔴 **三片之間的窗口** ——
   · **445a 之後、445b apply 前:行為不是零變化**(§2-6 的 fail-closed 新依賴)。
   · **445b apply 之後的窗口:⏸ 待 `Q-445-R3-1`**(§12-A)。
   · ✅ **已證實的好消息**:步 6 / veto / 步 6b 全在步 8 INSERT 之前(`20260812170000:605-657`)
     ⇒ 被擋 = **零寫入、無半寫狀態、無資料面回退窗口**。【量到】
6. 🔴 **Portal 場外退款擋得住,但只在 Record 查得到的範圍內**;Record 查詢失敗時 action 會 abort
   (`refund-baseline.ts:5`)⇒ **TapPay 掛掉時退款全部停擺**,這是 Q10=A 已知情接受的代價。
7. 🔴 **監控面未確認**:被守門擋下來時不 INSERT、無 audit outcome ⇒ 上線後可能量不出「擋了幾筆、哪一類」。
   R3-codex 提出,**本輪未開檔複核**【未確認】⇒ 445b 收尾前要查一次。

> **名字大於實力的防護比沒有防護更危險**。任何 UI 文案、commit body、STATUS
> 不得出現「已防止超額退款」這種全稱句。

---

## §9 相關既有紀錄與連動面

- backlog `#445`(本片)/ **`#473`**(`manual_failed` 無解鎖出口,**445b apply 硬前置**)/
  `#442` 卡住的補償退款永久隱形 / `#443` 異常清單只讀一本帳 / `#444` 與本片共用「尺度可信」假設(§4-2a-2)
- 2f = `20260812170000`(**已 apply、凍結檔**);本片並發前提騎在它的 advisory lock 上
- 2g(未建)= `payment_refunds` 的 writer;**本片不再與 2g 連動**(§0-A)
- memory:`project_0812-fuzzy-logdrain-dirty-decisions` / `feedback_app-layer-must-not-ship-before-migration-apply` /
  `reference_tappay-refund-api-multiple-partial-and-overrefund` /
  `feedback_folding-a-finding-defaults-to-the-named-spot-only`(§4-3a 就是照這條做的)

---

## §10 估時(v4 重估)

- **445a**:**90-120 分**(v3 估 60-90;+30 是 §4-4 的 `blocked_by` 與錨點連結、9 個驗收格)
- **445b**:**未知,下界 180 分** —— 🔴 **§2-5a 的紅格數沒量到之前不給上界**。
  v3 的「150-210 分」是在**不知道有 97 處呼叫點**的前提下估的,不可沿用。
- **445c**:⏸ 待拍板

---

## §11 R3 findings 逐條折(2026-08-14,兩條換模型線)

> R3-a = **Fable**(角度:主詞漂移獵人)7 MF + 3 consider + 5 nit;
> R3-b = **codex `gpt-5.6-sol`**(角度:執行時間軸演練 A/B/C/D)20 MF + 1 nit;
> R3-c = R 窗自查(引用行號抽驗 + §12-4 三點)12 條。合併去重 = 26 MF + 1 拍板題 + 1 consider + 6 nit。
> 完整原文 = `~/pcm-mailbox/附件-R-445-R3-findings.md`。

### 堆 B —— 本版已折(22 條)

| # | 摘要 | 折法 | 落點 |
|---|---|---|---|
| A1 | §4-1 宣稱的前台 `max` 不存在 | 整表依實況重寫 | §4-1 |
| C1 | 🔴 full 那行漏 `guard IS NULL OR` = 金流 fail-open | 兩行對稱 + 病邊界盤點 | §4-3 / §4-3a / §6-11 |
| C2 | 「擴充步 6」與「veto 之後」幾何互斥 | 明定「步 6b」與插入錨 | §4-3 |
| C3 | §4-3 把 advisory 標成步 3 之後 | 改回「步 2 後、步 3 前」 | §2-3 / §2-4 |
| C4 | §6-7d 的 `failed_reason IS NULL` 被 CHECK 禁止 | 該格移除,改記在 §4-2 表 | §4-2 / §6 |
| C5 | §6-9 只 DROP status CHECK 造不出未來狀態 | 驗收明寫要卸三道 | §6-17 |
| C6 | §6-10 `guard IS NULL` 在 RPC 路徑不可達 | 改成守門函式直呼 + partial/full 各一格 | §6-11 |
| C7 | §6-17 加 terminal 事件會排除 fixture | 驗收明寫「不得加 terminal」 | §6-24 |
| C8 | §6-21 跑不到:harness 開頭 md5 先紅 | 新增「2f harness 處置決定」 | §2-5a / §5-445b-6 / §6-29 |
| C9 | 97 處呼叫點未計 | 445b 第 0 步先量 | §2-5a / §5-445b-0 / §10 |
| C10 | 「完整 8 處」實為 10 處 | 表擴為 10 列、拿掉「完整」 | §2-5 |
| C11 | `failed` 列可事後補寫證據繞過三分 | 新增「證據非空即佔」列 | §4-2 / §6-14 |
| D1 | 只回 body 不回 COMMENT ⇒ 三態閘 abort | §7 第 1 點 | §7 |
| D2 | post-image SQL 來源未指定 | §7 第 2 點 | §7 |
| D3 | 445b 回退未規定單一交易 | §7 第 3 點 | §7 |
| B1 | 三文案無判別值 | 回傳加 `blocked_by` | §4-4 / §6-4 |
| B2 | 「可點連結」交付不出來 | 445a 加 failure 錨點連結 | §4-4 / §5-445a / §6-5 |
| B3 | §0-E/§4-4 文案含禁語「還能退」 | 改「本單目前可受理的退款上限」 | §0-E-1 / §4-4 / §6-6 |
| B5 | `refund-section.tsx:110-111` 說明文字在 445b 後不實 | ⚠️ 見下方「B5 的折法變更」 | §12-A |
| F1 | §6-5「零變化」照字面必紅 | §2-6 改寫 + 獨立驗收格 | §2-6 / §6-2 / §6-8 / §8-5 |
| E1 | `manual_failed` 無解鎖出口 | 開 `#473` + 列 445b apply 硬前置 | §5-445b-8 / §8-3 / §9 |
| E2 | `manual_failed` 會被歸成「打太多」 | `blocked_by` 判定不只看 `processing` | §4-4 |
| E3 | 「先去處理它」點過去無事可做 | 隨 E1 進 `#473`(那是 UI 缺出口的同一根) | §8-3 / `#473` |

🔴 **B5 的折法變更(R 窗在折的過程中改的判斷,標明出處)**:
我在 R3 把 B5 分進堆 B,理由是「445b 之後那兩行就不實,與 445c 做不做無關」。
**折的時候發現這個理由只對了一半**:`refund-section.tsx:110-111` 逐字是
「全額退款以 TapPay 端剩餘可退額為準;部分退款需 TapPay 已請款,金額不得超過剩餘可退額」——
它描述的是 **TapPay 端**的規則,而 445b 之後 TapPay 端的規則**沒有變**,變的是我方多加了一道更嚴的線。
⇒ 那兩行**不是變成假的,是變成不完整**。要不要補一句、補什麼字,取決於前台最後有沒有上界
⇒ **B5 改列入堆 A(§12-A)**。【推的:我沒有實測「員工看到那兩行會不會被誤導」,這是文案判斷】

### 堆 A —— ⏸ 本版刻意不折(見 §12-A)

A2(§4-5 的論證)· A3(445c 的資料來源)· A4-窗口二(§8-5 第二個窗口與 §10 的「同一工作段」硬約束)·
B4(§6-24 的措辭 oracle 驗收)· **B5(改列入,見上)**

### R3 的兩條「引用行號」更正(已套進 v4 全文)

- **已漂**:`order-detail-route.tsx:140-141→:153-154`、`:143→:156`、`:220→:233`;`order-detail.tsx:429→:473`、`:410→:475`。
- **小偏**:`refund-actions.ts:230→:231`;`20260812170000:1010→:1011-1012`。
- ⚠️ **R3-Fable 另報兩處「近似」我不採納**:它說 plan 的 `:483-485` 實為 `:482-484`、
  `20260801120000:478-479` 實為 `:477-478`。我用 `awk` 印出該行區間逐行核對,**plan 原本的座標是對的**
  (`:483` = partial 不得帶 record_amount 的 RAISE;`:478`/`:479` = REVOKE/GRANT 兩行)。【量到】

---

## §12 這份 plan 還沒過的關

### §12-A ⏸ 卡在 `Q-445-R3-1` 的 5 條(本版刻意不折)

**題目:445c(「前台加金額上界」那一片)還要不要做?**

| 條 | 拍「做」會變成什麼 | 拍「不做」會變成什麼 |
|---|---|---|
| **A2** §4-5 | 整節改寫成「**新建**一條上界」(不是「改讀新式」),並補上界與守門線同源的論證 | 整節刪除;§5 回到兩片 |
| **A3** 資料來源 | 必須設計「render 期取得 `record_refunded_before`」——今天 `order-detail-route.tsx` **零 Record 呼叫**(量法:`grep -n "Record\|tappay\|Baseline" <該檔>` 零命中)⇒ 要嘛每次開訂單頁打一次 TapPay Record API(新外呼面 + 10s 逾時 + Record 掛掉時頁面 fail-closed),要嘛上界退化成 ledger-only(那就違反同源要求)| 整段不存在 |
| **A4** §8-5 窗口二 | 保留「表單說可以、送出被擋」的窗口分析 + §10 的「445b/445c 同一工作段」硬約束 | 窗口二不存在;硬約束刪除,445b 可獨立排期 |
| **B4** §6-24 | 必須換 oracle 形狀:`refund-wiring.test.tsx:342-346` 是**檔案粒度**白名單且 `refund-section.tsx` 已在裡面 ⇒ 新數字放該檔時,即使寫成禁語 oracle 仍綠 | 沒有新數字進該檔,該格消失 |
| **B5** 說明文字 | `refund-section.tsx:110-111` 要補「我方另有更嚴的上限」的字 | 那兩行維持原狀(它描述的 TapPay 端規則沒變),但 §8 要註明「員工看得到的說明只涵蓋 TapPay 端」 |

```
Q-445-R3-1:445c(「前台加金額上限」那一片)還要不要做?

A. 不做 —— 前台不加金額上限,靠送出被擋時的訊息當場告訴員工上限是多少。
   三片變兩片;不用在每次開訂單頁去打一次 TapPay 的查詢。
   代價:員工要先按一次才知道上限。
B. 照 v3 做 —— 前台先幫他算好上限、填超過就當場擋。
   代價:每開一張訂單頁多打一次 TapPay 查詢(TapPay 慢或掛掉時訂單頁會變慢、
   或直接關掉退款入口),而且這是「新做一個從來沒有過的功能」,不是把舊的接上去。
C. 先做 A、把 B 另開 backlog 之後再說。

R 窗推薦 = C。理由:A 的成本是「多按一次」,B 的成本是「每張訂單頁多一個會掛的外部呼叫」;
而 #445 要解的是「100 元的訂單退不出 99999」,A 已經解掉了。
⚠️ 這是推薦不是拍板 —— v4 沒有假設 Sean 會拍哪一個,五條全部維持 ⏸。
```

### §12-B 其他還沒過的關

1. 🏁 Q-445-1 = C(2026-08-13 二次拍板)、Q-445-E 驗收定調已轉成 §0-E
2. 🏁 R1(codex)FAIL 33 → v2 全折
3. 🏁 R2(adversarial-reviewer 換模型)FAIL 1 BLOCKER + 13 MF → v3 全折
4. 🏁 **R3(Fable 主詞漂移 + codex 時間軸演練)FAIL 26 MF → 本版折 22、⏸ 5(B5 為折中改列)**
5. ☐ **`Q-445-R3-1` 拍板**(§12-A)
6. ☐ **Sean 批准 v4**(鐵則 8)
7. ☐ **R4 對抗審查** —— 🔴 必須第四次換角度換模型。
   R1=codex 通用 / R2=opus 跨層 / R3=Fable 主詞漂移 + codex 時間軸 ⇒
   **R4 建議角度:「拿 v4 的驗收表反推 —— 哪幾格就算全綠也證不到 §1 那句話」**,不要再跑前三種。
   **R4 要特別打的**:①§4-3a 說「今天沒有第三處 NULL 源」是我用 `grep -n "v_frozen"` 逐處開檔量的,
   **量具只掃了 `v_frozen` 這個名字** —— 有沒有別的變數也在跟可能為 NULL 的東西比大小?
   ②§4-2 表新增的「證據非空即佔」那一列會不會擋到合法的重試路徑?
   ③§4-4 的 `blocked_by` 三分,`manual_failed` 那條修法(E2)是我推的、沒有實測。
8. ☐ 445b 的 **apply 停點**(素材以 migration 檔頭為準),硬前置 = `#473` 有出口

> 🔴 **本 plan 的自我評價(誠實條款)**:v1→v4 四版,前三版每版都有一條方向級的錯
> (v1 算錯帳本 / v2 假的「做不到」/ v3 假的前台上界)。**v4 待驗。**
> 三版的共同病根都是 **「我證明了 A、寫下了 B」** —— §13 是本版為此加的自我標記。

---

## §13 v4 新寫的因果句:哪些是量到的、哪些是推的

| 句子 | 出處 |
|---|---|
| 前台今天沒有金額上界 | **【量到】** `grep -c "max=" refund-section.tsx` = 0;props `:56-69`;`grep -c "unregisteredAmount" <該檔>` = 0 |
| full 那行漏 `IS NULL` ⇒ fail-open | **【量到】** plan v3 `:293-295` 兩行不對稱,肉眼可見 |
| 今天函式體內沒有第三處 NULL 比較 | **【量到,但量具只掃 `v_frozen` 這個名字】** 見 §12-B-7① |
| `SUM()` 對零列回 NULL ⇒ 必須 COALESCE | **【量到】** 既有 `pcm_order_refundable_remaining`(`:401-405`)就是這樣包的 |
| `GREATEST` 對 NULL 的處理方式 | **🔴【未量】** 沒有實跑 ⇒ v4 刻意不依賴它,一律 COALESCE |
| 步 6 在 veto 之前 | **【量到】** `20260812170000:605-608` vs `:610-644` |
| advisory 在步 2 後、步 3 前 | **【量到】** `:558-565` vs `:567-573` |
| `not_sent` 不可能在送出後產生 | **【量到】** `TapPayChargeAdapter.ts:245-303` / `:344-353` / `:362-366` |
| `manual_failed` 沒有解鎖出口 | **【量到】** `refund-recovery-actions.ts:87` + `20260803150000:211-215` |
| 被擋時零寫入、無半寫狀態 | **【量到】** 三個判斷點都在 `:657` 的 INSERT 之前 |
| `blocked_by` 判定不能只看 `processing`(E2 修法) | **🔴【推的】** 沒有實測員工行為,是從 §4-2 佔額度表推的 |
| B5 那兩行「不是假的,是不完整」 | **🔴【推的】** 文案判斷,沒有實測 |
| 445b 之後會有幾格 harness 變紅 | **🔴【未量】** 需要拋棄式庫,§5-445b-0 是為此設的 |
| 監控面是否量得出被擋筆數 | **🔴【未確認】** R3-codex 提出,本輪未開檔複核 |

— END —
