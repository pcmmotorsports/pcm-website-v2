# A7 片級 plan:`order_cancellations` + `order_cancellation_items`(取消真相)

> **v5** —— 折入關卡1 四輪:**codex R1(19+4)+ codex R2(16+5)+ Fable R3 換模型換角度(8+6)+ Fable R4 delta(3+4)= 46 must-fix + 19 nit,全數接受、駁回 0**
> ✅ **Sean 2026-07-30 拍板 Q1=A / Q2=A 已落地**(見 §12;memory `project_m4b-a7-cancellations-decisions`)
> 逐條裁定 = `docs/reviews/2026-07-30-e10-a7-k1-codex.md`
> 片型 M(純 schema;零 trigger、零 DB 函式)· **高風險片**(鐵則 12③)· M-4b · E10 第 1 批第 24 列
> 施工權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 第 24 列、**§5.1b / §5.1c / §5.1d**、§1 原則 1/2/3
> 授權 = Sean 2026-07-29 凌晨拍 A(過夜自跑只做 code / migration 檔 / 測試 / 模擬;apply、push、deploy 在禁區)
> ✅ **§12 兩題已由 Sean 拍板(Q1=A / Q2=A)** —— A7-t 因此誕生、部署序約束已寫進 master plan。
> 🔴 **關卡2(codex,審已寫完的 code)R1 = NO-GO 12 must-fix + 12 nit,全數接受、駁回 0;修法與實測見 §13 與 §14**

---

## 0. 結構性決定(先看,否則下面會誤讀)

### 0.1 片拆**三個**施工片(鐵則 4;v2 自批「40-50 分鐘不拆」是 R2 抓到的直接違規;A7-t 為 Sean 拍 Q1=A 後新增)

| 片 | 內容 | 估時 | 產物 |
|---|---|---|---|
| **A7-1** | migration:兩表 + 索引 + ACL + **結構/定義/ACL 驗收**(零合成資料、零行為探針、**零條件略過**)| ~30 分鐘 | `supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql` |
| **A7-2** | 行為驗證腳本:環境閘 + trigger inventory 閘 + 合成 fixture + 全部行為探針 + sentinel rollback | ~35 分鐘 | `scripts/a7-behavior-probe.sql` |
| **A7-t** | 🆕 **主從一致 constraint trigger 片**(**Sean 2026-07-30 拍 §12 Q1=A**):兩支 DEFERRED CONSTRAINT TRIGGER 擋「有 header、零明細」,照 `order_refunds` 的形狀(`20260725130100:182-186`)。**片型 T、獨立成片**(M 片不得放 trigger)| ~35 分鐘 | 另支 migration |

🔴 **交易邊界的正確敘述**(關卡2 nit 更正原字面):A7-1 在隔離庫**自己 COMMIT**(它就是一支正常 migration),
A7-2 另開一筆交易跑探針、結尾整份 `ROLLBACK`。原本寫「探針交易自己建表」是錯的。
證明力仍成立:**兩者都在 apply 到正式站之前跑完**,而 A7-2 對 live 表的合成資料零殘留。
順序:A7-1 → A7-2 → 隔離庫實跑 + 突變驗證(§8)→ 全綠 → 才交 Sean `db push`。
授權依據 = §5.1 估時紀律逐字「估超 45 分鐘當場再拆」+「本表只定範圍與依賴,不代替片級 plan」;
先例 = A8a1/A8a2 本來就是「同一支 RPC 的兩個施工片」⇒ **不改 master plan 的 69 片表**。

### 0.2 `actor` 加 FK 到 `staff`(R2 nit #13 推翻 v2 的理由)

v2 寫「不加 FK,因為員工停用後舊紀錄要留、FK 會綁死刪除」—— **這個理由是錯的**。親驗:
`staff` 逐字「停用走 `is_active=false`、**不物理刪除**」(`20260726120000:26-27`)、service_role **無 DELETE 權**、
`id` **被刻意排除在 UPDATE 欄級授權外**(`:66-72`,理由逐字「改 id 會讓歷史稽核列變孤兒」)。
⇒ **加 `REFERENCES public.staff(id) ON DELETE RESTRICT`**;債 ⑥ 從「A8a1 的責任」升級為 **DB 層已擋**。
⚠️ **措辭收斂(R3 F9)**:正確說法是「**在現行授權合約下**永遠不會擋到任何東西」—— table owner / postgres 仍可 DELETE staff,
屆時 RESTRICT 會擋住(那是**想要**的行為:誤建的員工列不該連歷史一起消失)。
⚠️ A2/A3 的 `author` / `received_by` 沒有這條 FK(較早寫的)—— **本片不回頭改它們**,記錄此不一致。

---

## 1. 一句話

建「客人的單被取消了幾件、為什麼、誰做的」這件事的**真相表**,讓第 19 項(取消訂單)第一次有地方可寫;
本片只有 schema,**按不下取消** —— 寫入要到 A8a1/A8a2,畫面要到 A13a/A13b。

## 2. 單一驗收條件

**A7-1**:migration 內建 DO block(結構 + 定義字面 + ACL/RLS,**無任何條件略過**)通過。
**A7-2**:`scripts/a7-behavior-probe.sql` 在隔離 PG17 實跑全綠。

🔴 **突變驗證的標準(R3 F1 更正 —— 原字面物理上不可滿足;R4 N1/N2 再修編號與級聯)**:
v3 寫「每條負測配一次突變、**只有它轉紅**」是錯的 —— 多條探針共用同一支約束時,拿掉該約束必然**多條同時轉紅**。
照原字面施工,實作者會發現達不到、然後靜默改寬鬆判定 = `feedback_negative-test-harness-self-false-green` 的復發。

⇒ **改成以「約束」為單位**:每次突變拿掉**一支約束**,驗
①**掛在該約束上的探針全部轉紅** ②**其他約束的探針一條都不受影響**。

🔴 **預期紅名單(R4 N1:v4 一度沿用 v3 的舊編號、種子本身是錯的;以下依 §7.2 現行編號重算)**:

| 突變(拿掉這支約束) | 預期轉紅的探針 |
|---|---|
| `reason_detail` 雙向 CHECK | **10 / 11 / 12 / 13 / 34 / 35 / 36**(空白 detail 的 11 屬同一支,v4 一度漏列;34-36 = 施工時新增的三個渲染全白碼位,**刻意編在最後以免位移既有編號**)|
| `reason_code` allowlist CHECK | 9 |
| `payload_hash` 形狀 CHECK | 14 / 15 / 16 |
| ~~`actor` 形狀 CHECK~~ | 🔴 **該約束已刪除**(施工時被自己的突變測試打掉:拿掉它探針照樣綠,因為 actor FK 嚴格支配它 —— 任何非 slug 值必然也不在 staff 裡,而 `staff.id` 自帶 `staff_id_format`)。詳 §13 |
| `actor → staff(id)` FK | **17 / 18**(17 = 非 slug 形狀、18 = slug 形狀但不存在;兩種壞 actor 都靠 FK 擋)|
| `(order_id, idempotency_key)` UNIQUE | 19 |
| `(cancellation_id, order_item_id)` UNIQUE | 21 |
| `cancelled_quantity > 0` CHECK | 23 / 24 |
| items 的 **order_item 複合 FK** | **27 / 31** |
| header 的 **order_id FK** | **28 / 29** |
| items 的 **cancellation 複合 FK** | **26 / 30** |

🔴 **FK-target 約束的特例(R4 N2)**:header 的 `UNIQUE (id, order_id)` 是 items `cancellation` 複合 FK 的**被引用約束**
⇒ 拿掉它必須 `CASCADE`、連那支 FK 一起掉 ⇒ 探針 **26 / 30 必然轉紅**,這**不違反**標準②。
本例的預期紅名單 = **級聯集合**(該約束 + 所有依賴它的約束各自的名單)。
⚠️ 同理:`(id, order_id)` 這支 UNIQUE **自身沒有獨立負向探針**(它擋的是「同一 id 掛到不同 order」,而 `id` 是 PK ⇒ 物理上構不出),
本清單明文記錄此事,**不假裝它被驗過**。

🔴 **本驗證方法的可觀察上限(施工時實測發現,誠實列出)**:探針腳本是 **fail-fast** 的
—— 一支約束被拿掉時,腳本停在**紅名單裡第一條**,後面那幾條沒機會執行。
⇒ 標準①「掛在該約束上的探針**全部**轉紅」實際只觀察得到**第一條**;
完整觀察需要把探針改成不 fail-fast(累計後才報),本片**沒有這麼做**、也不假裝有。
紅名單的其餘編號是**設計意圖**、不是實測結果。

🔴 **突變 runner 自己也會假綠(實測踩到)**:正向探針失敗時噴的是 PG 原生錯誤
(`check_violation` / `unique_violation`),**不帶「探針 N 失敗」字樣** ⇒ 只 grep 自家訊息的 runner
會把「腳本其實炸了」判成綠。⇒ runner 的判定必須是「**腳本有沒有走到最後那句成功 NOTICE**」,
不是「有沒有出現我的錯誤訊息」。(實測 P7 加上限、P9 改 UNIQUE 兩條都是這樣被誤判成綠的。)

🔴 **無突變覆蓋的探針,明文列出理由**(R4 建議;免得日後被當成遺漏):
正向探針 **1-8 / 20 / 22 / 25** 與 **32 / 33** 本質上不由「拿掉約束」驗證
—— 它們證明的是「合法的事做得到」與「不該發生的自動行為沒發生」,拿掉約束只會讓它們**更容易**通過。
⇒ 這些探針的保護來自 §7.1 的**定義字面比對**(例如探針 25 配「CHECK 恰為 `> 0`」),不是突變。

## 3. 為什麼要兩張表(不是在 orders 加欄)

| 選項 | 為什麼不行 |
|---|---|
| `orders.cancel_reason_code` 加欄 | **原則 3 破口**:`orders` 對登入客人有表級 `GRANT SELECT`(`20260604120000:190`)+ `orders_select_own` RLS ⇒ 客人讀得到**自己那張單的所有欄位**(R3 F10 精確化:不是「整表任何人可讀」,但**本人單就足以洩** `internal_error`「我方疏失」)。由來逐字 = `docs/reviews/2026-07-28-e10-k1-findings-triage.md:134` |
| 只建 header 一張表 | 部分取消要記「哪個品項取消幾件」,單表表達不了 1:N;A4a 重算 trigger 與 A8a2 守門**都需要 items 當來源**(R12 明文)|

**對客欄不動**:`orders.cancelled_at` / `cancelled_reason` 原封保留(`20260712203000:56-57`,全樹**零 writer**,`packages/domain/src/order/types.ts:301` 逐字「取消功能留取消片」)。由 A8a1 寫 —— 本片不碰。

## 4. 沿用既有 pattern(逐項對過行號)

`order_refunds` + `order_refund_items`(`20260725130100`)與 A7 **結構同形**。

- `order_items` 的複合唯一鍵 **`order_items_order_id_id_key UNIQUE (order_id, id)` 早已存在**(**`:76-77`** —— R3 F11 更正 v3 誤寫的 `:78-79`)⇒ **不需 ALTER 任何 live 表**
- ⚠️ **「不 ALTER」≠「不取鎖」**(R1 #3):建指向 `orders` / `order_items` **與 `staff`**(R3 F12 補漏)的 FK 要對**被引用表**取 `SHARE ROW EXCLUSIVE`,與 live 結帳 INSERT 互斥 ⇒ §5.5 的 `lock_timeout` 是這條的解。`staff` 只有 3 列、風險趨零,但宣稱完整就要完整
- header 自帶 `UNIQUE (id, order_id)`(同 `order_refunds_id_order_id_key`,`:107`);複合 FK 欄序對齊被引用約束:`(order_id, order_item_id) → order_items (order_id, id)`
- 子表 `id` 有 `DEFAULT gen_random_uuid()`(`:143-145`)

## 5. Schema(A7-1)

### 5.1 `public.order_cancellations`

| 欄 | 型 | 約束與理由 |
|---|---|---|
| `id` | uuid PK | `DEFAULT gen_random_uuid()` |
| `order_id` | uuid NOT NULL | `REFERENCES orders(id) ON DELETE RESTRICT` |
| `reason_code` | text NOT NULL | CHECK 收斂 **§5.1d 七值**。驗收必**逐值正向**(R1 #8)|
| `reason_detail` | text | `other` 必填非空白、其餘六值必 NULL(單一雙向 CHECK)。🔴 **「非空白」= 明列碼位後比對空字串,刻意不用 `[[:space:]]`** —— 後者是 locale-dependent,施工時實測 C locale 下全形空白 U+3000 **不**被判為 space ⇒ 原寫法放行「一格全形空白」(詳 §13.1)。清單已含 U+2800 / U+3164 / U+00AD(Fable R3 點名的三個)+ 探針 34-36 實證。⚠️ 仍**不宣稱窮盡** ⇒ 債 ⑧ |
| `idempotency_key` | uuid NOT NULL | 🔴 **用 uuid 是本片的實作決定、非規格字面**;代價 = producer 改用 ULID 等 text 鍵會被拒。先例 `orders.cart_session_id`(`20260613130000:93`)|
| `payload_hash` | text NOT NULL | CHECK `^[0123456789abcdef]{64}$` —— 🔴 **明列 16 字元、不用 `[0-9a-f]` range**(關卡2:PG 的 regex **range 也是 collation-dependent**,與 §13.1 同一個病灶的第二處)。型別必須是 `text`(改 `varchar(64)` 會多出第二個長度真相 ⇒ 已納入結構斷言)。🔴 **schema 只能擋外觀** —— 「真的是 canonical payload 的 sha256」**物理上無法在 schema 層強制**(R2 #10)⇒ 債 ① 升級為「A8a1 必附 golden vector」|
| `actor` | text NOT NULL | **`REFERENCES public.staff(id) ON DELETE RESTRICT`**(§0.2)。🔴 **刻意沒有形狀 CHECK** —— 施工時寫了、被自己的突變測試打掉(FK 嚴格支配它;詳 §13);形狀由 `staff.id` 的 `staff_id_format`(`20260726120000:21`)**傳遞性保證** |
| `created_at` | timestamptz NOT NULL | `DEFAULT now()` |
| — | UNIQUE | `(order_id, idempotency_key)` / `(id, order_id)` |

### 5.2 `public.order_cancellation_items`

| 欄 | 型 | 約束與理由 |
|---|---|---|
| `id` | uuid PK | `DEFAULT gen_random_uuid()` |
| `cancellation_id` / `order_id` / `order_item_id` | uuid NOT NULL | `order_id` 是**冗餘欄,唯一理由 = 讓兩道複合 FK 夾住跨單**(沿用 `order_refund_items:147`)|
| `cancelled_quantity` | integer NOT NULL | 🔴 **只有 `> 0`、無上限**(R1 #4)。**這條修法本身需要守護**(R3 F2):§7.1 必須**字面比對**該 CHECK 恰為 `> 0`、§7.2 必須有一條**大數量正向探針** —— 否則施工時照抄 A2 的 `BETWEEN 1 AND 100000`,全部驗收依然綠,R1 專門刪掉的錯原樣回歸 |
| `created_at` | timestamptz NOT NULL | `DEFAULT now()` |
| — | FK | `(cancellation_id, order_id) → order_cancellations (id, order_id) ON DELETE RESTRICT` |
| — | FK | `(order_id, order_item_id) → order_items (order_id, id) ON DELETE RESTRICT` |
| — | UNIQUE | `(cancellation_id, order_item_id)`(同一次取消不重複列同品項;**跨次不受限** = 可分次)|

### 5.3 索引

`order_cancellations (order_id, created_at DESC)`、`order_cancellation_items (order_item_id)`(A8a2 守門與 A9g 要對單一品項**跨多次取消聚合**)。
🔴 兩者都進結構斷言 —— 漏建無行為異常、只會慢,正是沒守門就永不被發現的一類。

### 5.4 ACL

`ENABLE ROW LEVEL SECURITY`(zero-policy)+ `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` + `GRANT SELECT TO service_role`。

誠實邊界(沿用 A2 `20260729020000:248-254` 完整版):service_role 具 BYPASSRLS ⇒ RLS 擋不住它,真防線是 ACL 與金鑰保密;
table owner 不受 RLS 擋(不加 FORCE,否則 A8a1 自己會斷);
🔴 **grantee allowlist 不是「權限已窮盡」的證明** —— role inheritance 與 `pg_read_all_data` 這類叢集層授權不在 `relacl` 裡。

### 5.5 migration 骨架

```
BEGIN;
SET LOCAL lock_timeout = '5s';        -- 建 FK 對 orders / order_items / staff 取 SHARE ROW EXCLUSIVE、與結帳互斥
SET LOCAL statement_timeout = '60s';  -- 5 秒等不到就整片回滾、改挑離峰
…（建表 / 索引 / ACL / 結構驗收 DO block）…
COMMIT;
```

- 自寫 `BEGIN/COMMIT` = 全 repo 現行做法,且 **Sean 07-29 拍 D0-1=A「維持現狀、別順手改」**(`03d5d23`)
- ⚠️ **`lock_timeout` 只限制「等鎖」、不限制「持鎖時長」**(R2 nit):探針已搬出 ⇒ 持鎖區間只有 DDL 與結構查詢,但**不宣稱為零**

## 6. 🔴 合約債

| # | 債 | 承接者 |
|---|---|---|
| ① | `payload_hash` 的正規化未定義,且 **DB 只能擋外觀** | **A8a1**:算法寫死 + **golden vector** + 同鍵不同內容必 `RAISE` |
| ② | 跨列不變式 `Σ cancelled_quantity ≤ quantity − instock` 無 DB 強制;**「同交易自持」不夠** —— 承接者必須先 `orders FOR UPDATE`(§5.1b 已定死)| A1 + A4a + A8a2 |
| ③ | 對客欄與本表的一致性無 DB 強制 | **A8a1** |
| ④ | **零明細 header 擋不住** —— `order_refunds` 為此掛了**兩支 DEFERRED CONSTRAINT TRIGGER**(`20260725130100:182-186` 逐字「只掛子表則空 header 完全擋不住」)。R3 F4 + R4 定案:**全 master plan 無任何片承接**(A4a 掛 items ⇒ 零 items = 零事件、管不到空 header;全檔無 `DEFERRED CONSTRAINT TRIGGER` 字樣)| ✅ **已解 —— Sean 2026-07-30 拍 Q1=A ⇒ 新增 `A7-t` 片**(§0.1);本片(M 型)仍不放 trigger,債在 A7-t 落地時結案 |
| ⑤ | append-only 只在應用路徑成立 | 沿用 A3 字面,不宣稱物理不可改 |
| ⑥ | FK 只證明 slug 存在於 staff,**不證明 `is_active`** | **A8a1**:負測含「已停用的 slug 被拒」 |
| ⑦ | 冪等重送語意,**三格都要定**:同 key+同 hash+同 actor ⇒ 回既有結果;同 key+**不同 hash** ⇒ `RAISE`;同 key+同 hash+**不同 actor** ⇒ `RAISE` | **A8a1** |
| ⑧ | 「非空白」剝除清單有限、不宣稱窮盡 | A8a1 輸入正規化 |
| ⑨ | 🔴 **`actor` 記的不是經驗證的身分**:操作者仍是自己從下拉挑的(`apps/admin/src/lib/session/actor.ts:7` 自陳非授權邊界)⇒ **E8-B 前不得當責任歸屬證據** | E8-B |
| ⑩ | **無上限窗口的安全靠「本表零寫入 GRANT」+「A1/A4a 先於 A8a」,不是硬閘** | A1 / A4a 落地前不得有任何 writer |

### 6.1 A7 對下游的部署約束(R2 #15)

`master-plan v2 §5.1` 字面上 A8a1 寫 header、A8a2 才寫 items ⇒ **A8a1 若單獨發布**:
① 零明細 header ② A4a 重算看不到整單取消(它掛 items)⇒ `cancelled_quantity` 恆 0
③ A8c 已因「存在取消紀錄」封鎖該單付款 ⇒ **單子既沒被真正取消、又收不到錢** ④ A8a2 後上線**不會自動修復**已寫下的列。

⇒ **`A8a1` 不得單獨發布**(必須與 A8a2 同批,或 A8a1 自己寫入整單全部品項的 items)。
R3 F5 指出這條原本只是 A7 plan 裡的一句話、A8a1 作者從 master plan §5.1 開工不會讀到 ⇒ 等於不存在(機制優先律)。
⇒ ✅ **已解 —— Sean 2026-07-30 拍 Q2=A**:本約束**已寫進 master plan §5.1 的 A8a1 與 A8a2 兩列字面**,
並於 STATUS 同 commit 記錄。**master plan 是 A8a1 作者的唯一開工入口 ⇒ 約束從此在他必讀的路徑上。**

## 7. 驗收清單

### 7.1 A7-1 結構驗收(migration 內;**無任何條件略過**)

1. 兩表存在;**PK 存在**;逐欄 `attnotnull` + 型別(`idempotency_key` 必 `uuid`、`payload_hash` 必 `text`、`cancelled_quantity` 必 `integer`)
2. `id` / `created_at` 的 default **用 `pg_get_expr` 比對算式字面**(換成別的函式要被抓)
3. 兩個索引 **用 `pg_get_indexdef` 比對定義字面**(欄序錯的同名索引要被抓)
4. 全部約束 `pg_get_constraintdef` 字面比對:header 的 `order_id` FK 與 `actor` FK **含 `ON DELETE RESTRICT`**、兩支 UNIQUE、
   items 兩支複合 FK **含欄序**、UNIQUE、各 CHECK
   —— 🔴 **`cancelled_quantity` 的 CHECK 必須恰為 `> 0`**(R3 F2:字面比對是唯一能抓到「上限被加回來」的守門)
   —— 🔴 撈定義前先 `count(*)` 擋 FK **與 CHECK** 總數(Fable F6 + R3 F2:裸 `contype` 在多支時會靜默取任一支)
5. 🔴 **兩張新表的 user trigger 數 = 0**(R4 N6):M 型「零 trigger」是本片的自我約束,但**先前沒有任何 DB 層驗收**
   ⇒ 沒有這條,一支偷偷加上的 clamp trigger 可以讓探針 25(大數量正向)看起來綠、實際值被改掉。
   ⚠️ 這條在 **A7-t 落地後必須改成「恰好 2 支、且是預期的那兩支」**(A7-t 的驗收條件)
6-9. RLS 開 + zero-policy / 三 role × 四寫權 = 0 / `anon`·`authenticated` 無 SELECT 且 `service_role` 只有 SELECT / grantee allowlist + PUBLIC 零授權 + 零欄級 ACL

### 7.2 A7-2 行為探針(`scripts/a7-behavior-probe.sql`)

**閘 -1 — 環境閘(R3 F7;fail-closed)**:本腳本會對 `orders` / `order_items` 插入合成資料(**DML,不是 DDL**)
⇒ 執行前必須證明「這不是正式站」:**叢集識別碼比對 + 明示 env 旗標雙輸入**(沿用 D1a0 的守門形狀),任一不符即 abort。
v3 寫「可對任何環境重跑」是危險字面,已刪。
🔴 **閘必須寫在 `.sql` 檔內、不得只做在 wrapper**(R4 N4):若只在 shell wrapper 檢查,任何人 `psql -f` 直接跑腳本就繞過了。
落地形狀 = 檔內 `\if` / `DO` 區塊同時要求 ①`psql -v` 傳入的明示旗標(未傳 ⇒ `RAISE`)②**DB 端自己回讀**
`pg_control_system()` 的叢集識別碼並比對白名單(不信呼叫端轉述的環境)。

**閘 0 — trigger inventory(R2 #6)**:`orders` / `order_items` 的 user trigger 必須恰好等於預期集合
(現況親驗 = 只有 `orders_freeze_shipping_snapshot_bi`,`20260725120000:104`;`order_items` 零)。不符即 abort。
⚠️ **這一閘在 harness 是套套邏輯**(harness 由 migrations 重建、永遠相符)—— 真正的漂移核對見 §8 步驟 5(R3 F8)。

**fixture**:
- 3 張合成訂單 **A / B / C** + 3 個品項(A 單 2 個、B 單 1 個;**C 單刻意不建任何 `order_cancellation_items` 引用** —— R3 F3 專用)
- `display_id` = `PCM-9999-0001/0002/0003`:**不呼叫 `nextval`**;9999 年不可能被舊產號器產出、新產號器只產 6 碼 ⇒ 型式上不可能撞;插入前仍 assert 不存在
- `customer_user_id` 取既有 `customers` 任一列(🔴 `customers.user_id → auth.users(id)`,`20260523034911:15` ⇒ 造不出合成客戶是**物理限制**)
- `actor` = `'sean'`(FK 目標必須真實存在;harness 的 staff seed 內建此列)
- exact JSON / 金額約束(全部親驗 `20260604120000:112-131,139-167`):`shipping_address_snapshot` = exact `{name,phone,line}` 全字串;
  `invoice.type ∈ {personal,company,donate}` 且移除白名單鍵後為 `{}`;`product_snapshot` = exact `{title,sku,spec}`、
  `spec` 值全字串且不含 `price_store/price_by_tier/cost`;`total = subtotal + shipping_fee − discount_total`;`line_total = unit_price × quantity`
- RF2a-0 三個運費欄由 `DEFAULT` + trigger 自動補
- **rollback 機制**:`RAISE … USING ERRCODE='PC001'` + `EXCEPTION WHEN SQLSTATE 'PC001'` sentinel(同 A2)

**探針**(每條負向各自 `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` 精確比對;每條正向 assert 真的寫進去):

| # | 探針 |
|---|---|
| 1-7 | **逐值正向 ×7**:七個 `reason_code` 各一條(R1 #8:v1 只測非法值,一個只允許 `customer_request` 的 CHECK 會整組通過)|
| 8 | 正向:`other` + 非空白 `reason_detail` |
| 9 | 負向:第 8 個 code 被 `…_reason_code_check` 擋 |
| 10-12 | 負向:`other` 但 detail 為 NULL / 空白 / 純零寬 |
| 13 | 負向:非 `other` 卻帶 detail |
| 14-16 | 負向:`payload_hash` 長度不足 / 大寫 hex / 非 hex |
| 17 | 負向:非 slug 形狀 `actor` ⇒ 🔴 **斷言 `foreign_key_violation`(不是 check_violation)** —— 語意在施工時被突變測試改寫,見 §13 |
| 18 | 負向:`actor` 是 slug 但**不在 `staff`** ⇒ `foreign_key_violation` |
| 19 | 負向:同 `(order_id, idempotency_key)` 重複 |
| 20 | 正向:**不同單**共用同一 `idempotency_key` 可並存(冪等鍵範圍是單內、非全域)|
| 21 | 負向:同一次取消重複列同品項 |
| 22 | 正向:同一張單**兩個 header**,🔴 **且第二個 header 重複列第一個 header 已列過的同一 `order_item_id`**(R3 F13 寫死:這才是「同品項可分次取消」的行為證明)|
| 23-24 | 負向:`cancelled_quantity` = 0 / 負數 |
| **25** | 🔴 **正向:`cancelled_quantity = 1000000` 寫得進去**(R3 F2:守護「無上限」這條修法;照抄 A2 上限會讓這條轉紅)|
| 26 | 🔴 負向:**只觸發 header FK** —— `(cancellation_id = A 的 header, order_id = B)` ⇒ assert `…_cancellation_fk` |
| 27 | 🔴 負向:**只觸發 item FK** —— `(cancellation_id/order_id 皆 A, order_item_id = B 的品項)` ⇒ assert `…_order_item_fk` |
| 28 | 負向:不存在的 `order_id` 進 header ⇒ header FK 擋 |
| 29 | 🔴 負向:**有 header 但零 items 引用的 C 單刪不掉** ⇒ assert header FK 名。**必須用 C 單**(R3 F3:`order_items.order_id → orders` 是 **CASCADE**,`20260604120000:141` ⇒ 用 A 單會先級聯刪 items、再撞 items FK,先報哪支由 trigger OID 序決定 = 斷言不確定)|
| 30 | 負向:有 items 的 header 刪不掉 |
| 31 | 負向:被 items 引用的 `order_items` 列刪不掉 |
| 32 | 誠實負測:插 items **不會**讓任何 `order_items` 計數器變動(A1/A4a 後要改成斷言會被擋)|
| 33 | 交易**內**確認合成資料在預期位置。⚠️ **它不證明零殘留**(關卡2 nit:真正的零殘留是 `ROLLBACK` **之後**那段未編號的 DO block)⇒ 引用「探針 33 通過」當零殘留證據是假證據 |
| **34-36** | 🔴 **施工時新增**:三個「渲染全白但不屬 POSIX 空白類」的碼位(U+00AD 軟連字號 / U+2800 盲文空白 / U+3164 諺文填充)必被擋。Fable R3 曾點名它們、當時被我列成「不宣稱窮盡」的殘面;改成明列碼位後它們進得了清單 ⇒ **必須實際證明擋得住,不能只在註解宣稱已涵蓋**。**刻意編在最後**以免位移既有編號(R4 N1 的教訓)|

**突變驗證**:照 §2 的「以約束為單位」標準,每支約束一組預期紅名單寫進腳本註解。

## 8. 實跑環境(**不碰正式站做任何 DDL**)

v3 原寫「在正式站 `BEGIN` → migration 全文 → `RAISE`」—— **兩個問題,R2 抓出**:
① 🔴 **migration 全文自帶 `COMMIT;`** ⇒ 內層 COMMIT 當場提交 ⇒ 那不是模擬,是**一次沒進 migration ledger 的正式 apply**
(命中 memory `project_supabase-migration-version-drift` 的災難成因)。**我誤讀了 RF2a-0 的先例** —— 它跑的是**可執行語句**,不是含 `COMMIT` 的檔案全文。
② `SET LOCAL` 經 MCP 可能是 no-op(memory `reference_supabase-migration-set-local-is-noop`)⇒ 模擬期間 DDL 等鎖沒有有效上限,可能堵住結帳。

⇒ **改跑 D1 線已建好的本機拋棄式 PG17 harness**(`scripts/d1t2-rehearsal.sh` provision 段:PG17 + **88 支** migration〔87 支既有 + A7-1;07-29 交接檔的「85」是 N3a/N3b 之前的舊數字〕〔R3 F11 更正 v3 誤寫的 85;N3a/N3b 已入,harness 動態 glob 不受影響〕+ `auth.uid()` shim + `auth.users` 替身種子 + 客戶/訂單 seed):

1. provision 隔離庫 → 套用 A7-1 → 跑 A7-2 探針
2. 逐支約束跑突變,對照 §2 的預期紅名單
3. 零留痕檢查在隔離庫做(拋棄式)。⚠️ **「零留痕」只能宣稱「零可見業務列」**(R2 nit)—— WAL、dead tuple、server log 仍在
4. 🔴 **誠實邊界(沿用 D1 線一路標註、不放寬)**:**本機 PG17 非 Supabase**、`auth.uid()` 是 shim
   ⇒ 證明「SQL 邏輯與約束行為正確」,**不證明**:Supabase CLI ledger 原子性、真實鎖競爭、`db push` 的 session 設定、模擬到 apply 之間的漂移、正式站併發安全
5. 🔴 **apply 硬前置:正式站唯讀漂移核對(R3 F8 升級,原為「可選」)** —— 只跑 `SELECT`、**零 DDL、零 DML**:
   `orders` / `order_items` 的 user trigger 集合與約束集合必須等於 ledger 預期。
   🔴 **比對程序寫死(R4 N5:「等於 ledger 預期」原本不可執行 —— 誰算預期、怎麼比、誰跑都沒寫)**:
   ①**預期集合的來源 = 同一批 harness**(它由 87 支 migration 從零建成 ⇒ 它的 trigger 與約束集合**就是** ledger 的預期值),
   從 harness `SELECT` 出 `tgname` 與 `conname` + `pg_get_constraintdef` 排序後 dump
   ②正式站跑**同一句 SELECT**(唯讀)
   ③兩份輸出**逐字 `diff`**,非空 diff = 停下回報,**不自行判斷「這個差異應該沒關係」**
   ④執行者 = 主對話(不是 Sean;他無法核 diff)
   **理由**:探針搬出 migration 之後,v2 那個「順帶在正式站 apply 交易內驗漂移」的效果掉出保護範圍了;
   而 harness 的 trigger inventory 閘是套套邏輯(harness 由 migrations 重建 ⇒ 永遠相符)。
   本 repo 的 migration 漂移是**已實錘的災難類**(#299 / MCP 重編號),不能靠「應該沒人動過 dashboard」。

## 9. 鐵則判定

| 鐵則 | 判定 |
|---|---|
| 3 | 純 DB schema、無前台面;對客欄不動 ⇒ 不觸發 |
| **4** | ✅ 已拆兩片(~30 分 / ~35 分);v2 自批不拆 = R2 抓到的直接違規,已更正 |
| 6 | A7-1 預估 400-500 行、A7-2 預估 500-600 行 |
| 8 | ✅ 命中(動 schema)⇒ 本檔即 plan;上層 plan 已由 Sean 07-29 最終批准 |
| 9 | 不適用(零內容字面;七值是 Sean 07-28 Q18 拍板的受控 code)|
| 11 | typecheck + lint(未動 .ts/.tsx ⇒ 不需 build,同 A2/A3 先例)|
| 12 | ✅ 命中 ③DB 結構 ⇒ 關卡1 三輪(R1/R2 codex、**R3 換 Fable**)、43+15 全折入;**commit 前** codex 關卡2 審 diff。不 push、不 apply |

## 10. 回滾(R2 #14 + R3 F6 / F14)

Supabase forward-only ⇒ 另立版本號更大的 down migration。
🔴 **down migration 不是本片產物**,災難當天才寫 ⇒ **執行程序寫進 `docs/runbooks/2026-07-30-a7-rollback.md`**
(R3 F14:實際執行者是某個有 context 的 AI session,不是 Sean 本人;plan 不指路等於沒有程序)。
🔴 **承接時點(R4 N7)= A8a1 開工前置** —— runbook 必須在**第一個 writer 出現之前**存在。
現在還沒有 writer(債 ⑩ 保證本表零寫入 GRANT)⇒ 風險窗未開;A8a1 一落地,窗就開了。

**DROP 前置守門 —— 只寫 DB 真的驗得到的**:
1. **資料守門**:兩張表任一有列 ⇒ 拒絕。
   🔴 **但必須帶 escape(R3 F6)**:壞資料入表**正是**回滾動機(§6.1 那個零明細 header 情境),
   守門若絕對拒絕就會在它唯一被需要的那天擋死自己 ⇒ 半夜出事只剩「現場即興繞過」= 守門歸零。
   ⇒ 明文 escape:**先把資料整表搬進 `order_cancellations_archive_YYYYMMDD`、Sean 拍板覆核筆數與內容後,守門才放行**
   —— 三步都寫進 runbook,**不留即興路徑**。
   🔴 **archive 表的 ACL 必須逐字複製 §5.4 的三件套(R4 N3 —— 原本只寫「service_role only」五個字,是回滾路徑上的原則 3 破口)**:
   Supabase 對**新建的表會自動 re-grant default privileges**(`20260726120000` 的 staff migration 明文「先撤 default-privilege re-grant」才精準補權)
   ⇒ 災難當天照 runbook `CREATE TABLE …_archive` 會**繼承 anon/authenticated 授權且無 RLS**
   ⇒ `internal_error`「我方疏失」透過 PostgREST **對客可讀**。
   runbook 必須含:`ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` + `GRANT SELECT TO service_role`,
   並在搬完資料後**當場斷言** `anon`/`authenticated` 對 archive 表零權限。
2. **依賴守門(限現在可驗證的實名)**:`order_items.cancelled_quantity` 欄存在 ⇒ 拒絕(A1 未回滾);
   掛在這兩張新表上的任何 trigger 存在 ⇒ 拒絕(A4a 未回滾)。

🔴 **DB 守門擋不到的,誠實列成人工核對清單**:
- `admin_cancel_order`(A8a1/A8a2)—— **現在還不存在**,查存在無意義
- `begin_charge_attempt` / `confirm_order_payment` 的**取消守門版本**(A8c1/A8c2)—— 🔴 **兩支現在就存在**、
  且守門版本**沒有不同物件名** ⇒ 查存在會讓回滾從第一天就被擋死。只能人工確認「已改回不查取消表的版本」
- A8b 的退款 enqueue RPC —— master plan 只有描述、**無實名**,猜名字的守門 = 永遠通過的守門
- 應用層:A9g / A9d2 / A13a-b / A11a-c / A2b1-A2b2 / A9c / A9d1 —— 需在**部署版本**層面確認

**DROP 順序**:先子表、再 header(反了會被 FK RESTRICT 擋)。

## 11. 不做什麼

- ❌ 任何 trigger 或 DB 函式(M 型)· ❌ 任何 RPC / 投影 / 型別 / 畫面
- ❌ 不碰 `orders.cancelled_at` / `cancelled_reason`、不碰 `order_items`、不回頭改 A2/A3 的 `author` FK
- ❌ **不對正式站跑任何 DDL 或 DML**(含模擬與探針;§8 步驟 5 是唯讀)
- ❌ 不 apply、不 push、不 deploy

## 12. ✅ Sean 2026-07-30 拍板兩題(R3 F4 / F5 逼出)

> **Q1 = A** · **Q2 = A**。決定與理由另存 memory `project_m4b-a7-cancellations-decisions`。

| 題 | 拍板 | 落地 |
|---|---|---|
| **Q1** 空明細 header 要不要有 DB 層防線 | ✅ **A —— 要,新增一片 T 型** | §0.1 新增 **`A7-t`**(兩支 DEFERRED CONSTRAINT TRIGGER,照 `order_refunds` 形狀);債 ④ 的承接者從「無」變成具名片;§7.1 第 5 條的「零 trigger」斷言在 A7-t 落地後改成「恰好 2 支且是預期那兩支」 |
| **Q2** 「A8a1 不得單獨發布」寫在哪 | ✅ **A —— 寫進 master plan** | §5.1 的 **A8a1 與 A8a2 兩列**加上約束字面 + STATUS 同 commit 記錄;§6.1 已改為「已解」 |

---

### 原始題目與選項(備查)

#### Q1(F4)— 空明細 header 要不要有 DB 層防線

`order_refunds` 遇到同型問題時,是用**兩支 DEFERRED CONSTRAINT TRIGGER** 在 DB 層擋掉「有 header、零明細」
(`20260725130100:182-186` 逐字:只掛子表則空 header 完全擋不住)。
取消這邊目前**沒有任何 DB 層等價物,而且 master plan 沒有任何一片被指派去補**(A4a 掛在 items 上、管不到空 header)。

### Q2(F5)— 「A8a1 不得單獨發布」要不要進 master plan

這條約束目前只寫在 A7 的 plan 檔。A8a1 的作者是從 master plan §5.1 那張表開工的,**不會讀到它** ⇒ 靜默失效。
repo 自己的**機制優先律**(發現 AI 會犯錯,第一選擇是做成機制、規則文字守不住)在這裡直接適用。

---

## 13. 🔴 施工紀錄:實跑抓到的三件事(全部推翻本 plan 先前的字面)

環境 = 本機拋棄式 PG17.10 + `scripts/d1t2-rehearsal.sh provision`(88 支 migration 含 A7-1)。
⚠️ socket path 有 103 byte 上限 ⇒ workdir 必須用短路徑(scratchpad 全路徑會讓 postmaster 起不來)。

### 13.1 `[[:space:]]` 是 locale-dependent —— 我的 CHECK 原本擋不住全形空白

- 探針 10-12 當場轉紅:`other` 配一格全形空白 `'　  '` **寫得進去**。
- 根因實測:C locale 下 `'　' ~ '[[:space:]]'` = **false** ⇒ `[^[:space:]]` 反而命中全形空白。
- **正式站唯讀實查 = `en_US.UTF-8`,同式 = `true`** ⇒ 同一條 CHECK **兩個環境行為不同**。
- 修法:改成**明列碼位後比對空字串**(純字元集合運算、與 locale 無關)⇒ A7 在兩邊逐字元同行為;
  順帶把 Fable R3 點名的 U+00AD / U+2800 / U+3164 納入清單並補探針 34-36 實證。
- 🔴 **連帶開出 #305**:A2/A3 用同款 `[[:space:]]`(它們在正式站**有效**、不是破口),但
  ①註解把 locale-dependent 的事寫成無條件事實 ②它們的行為探針在隔離庫**因空表被略過**
  ⇒ 那條防護**從未在任何環境被實測**。更重要的是:**隔離庫與正式站的字元類語意不同**
  = 整套「本機隔離庫驗過」的效力折扣,而先前沒人知道。

### 13.2 `actor` 形狀 CHECK 被 FK 嚴格支配 ⇒ 刪掉

- 突變(拿掉形狀 CHECK)⇒ **探針 17 照樣綠**:任何非 slug 值必然也不在 `staff` 裡,FK 先擋、
  丟的是 `foreign_key_violation` 而非 `check_violation`。**兩道約束互相遮蔽。**
- 而它**原理上無法被獨立證明**:FK 要求 `actor ∈ staff.id`,而 `staff` 自帶 `staff_id_format`
  ⇒ 形狀已被傳遞性保證。
- ⇒ 依「防護不得命名超出它的實際能力」**刪除該 CHECK**(留一個測不到的約束比沒有更糟:
  它會在約束總數閘與突變紅名單各留一格永遠不會被驗到的東西)。探針 17 改為斷言 FK。
- 連動:A7-1 的 CHECK 總數閘 4 → **3**,並在錯誤訊息寫明「若是 4,很可能有人補回了被支配的那條」。

### 13.3 突變 runner 自己假綠

- P7(加 A2 式上限)與 P9(UNIQUE 誤設)兩條**實際上讓腳本炸了**,但 runner 判成綠 ——
  因為它 grep 自家的「探針 N 失敗」字樣,而**正向探針**失敗時噴的是 PG 原生錯誤。
- ⇒ runner 的判定改成「腳本有沒有走到最後那句成功 NOTICE」。

### 13.4 實跑結果(截至本紀錄)

| 項 | 結果 |
|---|---|
| A7-1 結構驗收 | ✅ 通過;**15 條結構突變全紅 + 1 條零突變對照綠** |
| A7-2 行為探針 | ✅ **36 / 36**;零殘留複驗通過 |
| A7-2 突變 | ✅ **13 條全紅 + 1 條零突變對照綠**(含 P13 clamp trigger 改值 → 被探針 25 的**讀回**抓到 = Fable R4 N6 的修法實測有效)|
| 誠實邊界 | 🔴 **本機 PG17 非 Supabase**、`auth.uid()` 是 shim、**C locale ≠ 正式站 en_US.UTF-8**(見 13.1)⇒ 證明「SQL 邏輯與約束行為正確」,**不證明** CLI ledger 原子性、真實鎖競爭、正式站併發安全 |
| 三綠 | ✅ typecheck / lint 皆綠(未動 `.ts/.tsx` ⇒ 依 A2/A3 先例不跑 build);`git diff --check` 乾淨。⚠️ 兩者皆 turbo cache 命中(因為本片零 TS 變更),且工作樹含**另一個 session** 的 TSX 修改 ⇒ 這兩項順帶涵蓋了它們 |
| 可重現驗證 | ✅ **`scripts/a7-verify.sh`**:21 條結構突變 + 13 條行為突變 + 兩組零突變對照,實跑 **37 / 0**(關卡2 must-fix:原本突變證據只存在於對話、repo 查無)|
| 尚未做 | **A7-t**(Sean 拍 Q1=A 新增的 T 片)、`docs/runbooks/2026-07-30-a7-rollback.md`(承接時點 = A8a1 開工前置)、apply(Sean 的動作)|

---

## 14. 關卡2(codex,審已寫完的 code)R1 = NO-GO 12 must-fix + 12 nit —— 全數接受、駁回 0

🔴 **12 條 must-fix 裡有 8 條是「我的驗收有洞」,不是 code 錯** —— 也就是說:
A7-1/A7-2 當時的「全綠 + 突變全紅」是真的,但**綠得不夠有意義**。

| 類 | findings | 修法(全部已實測驗證) |
|---|---|---|
| **驗收可被繞過**(5 條) | ①`payload_hash` **型別**沒驗 ⇒ 改 `varchar(64)` 全綠 ②`actor` FK 沒驗 `ON DELETE RESTRICT` ⇒ 改 CASCADE 全綠、日後刪 staff 會連取消歷史一起消失 ③`reason_code` 只驗「七值有出現」⇒ **加第八值不會被抓到** ④`payload_hash` CHECK 可放寬成 `{64,}` ⇒ 超長 hash 被接受而三條負測仍紅 ⑤`reason_detail` 碼位清單可被拿掉單一碼位而全綠 | 全部改成**逐字比對 / 逐碼位斷言**;`reason_detail` 因定義字面含真正的不可見字元 ⇒ 改「34 個碼位逐一 strpos」(可讀且語意等價)。**六個情境各跑一次突變、全部轉紅** |
| **環境閘不是白名單** | 原設計 = 呼叫端自證 + 正式站黑名單 ⇒ 對 staging 或任何共用庫傳它自己的 cluster id 就過得去 | 新增**正向白名單**:目標庫必須存在 `public.pcm_a7_probe_allowed`(建它本身是刻意的 DDL,而對正式站跑 DDL 本就違反本線紅線)|
| **range 也是 collation-dependent** | 我在 §13.1 宣稱「A7 兩環境同行為」**過廣** —— `[0-9a-f]` 本身就是 range | `payload_hash` 改**明列 16 字元**;#305 同步補這條 |
| **證據不可重現** | 「15 條 / 13 條突變全紅」只存在於對話,repo 查無 runner 與原始輸出 | 🆕 **`scripts/a7-verify.sh`**:21 結構突變 + 13 行為突變 + 兩組零突變對照,實跑 **37 / 0**;判定改成「兩句成功 NOTICE 都要出現」 |
| **文件與事實不符**(4 條) | runbook 被寫得像已存在(實際尚未撰寫)/ 三綠宣稱與 §13.4「尚未做」自相矛盾 / 交易邊界敘述錯(A7-1 自己 COMMIT、不是探針交易建表)/ 探針數 33·32·36 三處不一致 / harness 87 vs 88 / 探針 33 不證明零殘留 / PC001 sentinel 其實不存在 | 逐條更正 |
| **backlog 三條** | #304 的 A 案(接 TapPay 退款 webhook)**官方沒有那個事件**、且無簽章機制 ⇒ 作廢 / #303 漏了「接線既有但零呼叫端的 `reconfirmExpiredOrphans`」/ master plan 的「30 張」已漂移 | 逐條更正;訂單數經正式站唯讀實查 = **31**(舊格式 30 + 新格式 1)|

**我自己額外關掉的一條不確定**:codex 標「正式站 PG 17.6 與本機 17.10 的 `pg_get_constraintdef` deparser 若有差,字面斷言會誤紅」
⇒ **用純唯讀查詢關掉**:向正式站查同形既有約束(`order_refund_items` 的兩道複合 FK、`order_refunds_id_order_id_key`、
`order_item_procurement_allocated_range`),渲染**與本機逐字元相同**(含 `CHECK ((x >= 1) AND …)` 的雙括號風格)。

🔴 **仍未關的**:A7-t 尚未施工、rollback runbook 尚未撰寫(承接時點 = A8a1 開工前置)、apply 是 Sean 的動作。
