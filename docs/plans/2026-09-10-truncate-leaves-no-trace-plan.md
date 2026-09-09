# 2026-09-10 `TRUNCATE` 把訂單清光而完全不留痕 —— plan

> 🛑 **等 Sean 批才動手。** 動 schema ⇒ 鐵則 8。碰稽核 ⇒ 鐵則 12 ⇒ 要 codex 唯讀審。
> 出處:`⟦db-ORDERDELETENOTRACE⟧` 的補證(`docs/evidence/2026-09-10-orders-delete-audit-真的會抄-驗證.md`)。
> 本檔所有數字都標來源:**【量的】**(有命令有讀數,尺先證明會咬)/ **【推的】** / **【證不到】** / 🔴 **【跑了但數字不能用】**。

---

## 0. 🔴 先更正我自己講錯的一句 —— **天花板比我說的高很多**

我昨晚回報時逐字寫過:

> ⛔ ~~「statement 級的 trigger 拿不到 `OLD` ⇒ 它記得到『發生過』,**記不到『刪掉的是哪幾筆』**。那是機制天花板。」~~

🔴 **那句話是錯的,而且是我沒量就講的。**

【量的】拋棄式 PG 17.10 實跑:`BEFORE TRUNCATE … FOR EACH STATEMENT` **跑在資料消失【之前】**
⇒ 它在函式裡 `SELECT … FROM <那張表>` **讀得到還在的每一列**,可以整筆抄進留痕表。

```
🎯 v2:TRUNCATE 之後 log 表幾列   3
 source_table | order_id                             | 單號    | 金額 | 是truncate
 order_items  | 55555555-5555-4555-8555-555555555555 |         |      | true
 orders       | 55555555-5555-4555-8555-555555555555 | D-T-101 | 777  | true
 orders       | 66666666-6666-4666-8666-666666666666 | D-T-102 | 888  | true
```

⇒ 📌 **「單號 D-T-101、金額 777」都留下來了。** 與 `DELETE` 那條路**留的是同一種東西**。
📌 **那個假天花板從哪來的**:`AFTER TRUNCATE` 確實什麼都撈不到(資料沒了)。我把 `AFTER` 的限制,講成了「TRUNCATE 這件事」的限制。**兩個字的差別。**

---

## 1. 病是什麼

【量的】2026-09-10 拋棄式 PG,基底 = 骨架三張表 + 貼板 103(`20260907070000`,rc=0):

```
TRUNCATE public.orders CASCADE;
🎯 log 表總列數 ⇒ 仍是 3(一列都沒多)
   而 orders 剩 0 列 ⇒ 資料真的沒了
```

原因:貼板 103 那三支是 `AFTER DELETE … FOR EACH ROW`,而 **`TRUNCATE` 不觸發 row-level trigger**。

🎯 **而這不是邊角** —— `⟦db-ORDERDELETENOTRACE⟧` 板上記的原始事件逐字:
> **(Sean 09-04 請窗刪掉測試單,23 ⇒ 1)**

那是**直接下 SQL**。⇒ 📌 **這道稽核擋得住「下次有人 `DELETE`」,擋不住「下次有人 `TRUNCATE`」。而對 Sean 來說那是同一件事:單子不見了。**

### 誰做得到 —— 量過再說
【量的】唯讀查正式庫:對 `orders` / `order_items` / `order_legal_consents` 有 `TRUNCATE` 的應用角色
(`anon` / `authenticated` / `service_role` / `pcm_readonly` / `authenticator`)⇒ **0 個**。
🟢 正對照:`service_role` 對 `orders` 有 `SELECT` ⇒ `true` ⇒ 尺會咬。表擁有者 = `postgres`。

⇒ 🟡 **低可能性,而正好命中原始劇本** —— 一般應用路徑到不了;而唯一到得了的身分(`postgres` / SQL Editor),**正是當初真的刪掉那 22 張單的那個身分**。

---

## 2. 修法 —— 三支 `BEFORE TRUNCATE … FOR EACH STATEMENT`

掛在 `orders` / `order_items` / `order_legal_consents`,共用一支 `SECURITY DEFINER` + `SET search_path = ''` 的函式,
用 `EXECUTE format(...)` 把那張表當下的每一列 `to_jsonb(t)` 抄進**現有的** `public.orders_deleted_log`,
並在 `row_data` 加一個 `'pcm_truncate': true` 的旗標。

🔵 **不新增表、不改現有欄位** —— 沿用貼板 103 已經建好的 `orders_deleted_log`。
⚠️ `orders_deleted_log_source_valid` 那個 CHECK 只允許三個表名,而本片正好只掛那三張 ⇒ **不用動約束**。

### 🔴🔴 而【範圍】是這份 plan 第二版最大的更正 —— codex must-fix,我量了,它對

⛔ ~~我第一版預設 `TRUNCATE orders CASCADE` 只會掃到那三張表~~ —— **那是我拿最小骨架量出來的,而骨架只有三張表。**
🔴 **`TRUNCATE … CASCADE` 的範圍不是照 FK 的 `ON DELETE` 動作決定的** —— 它**遞迴納入所有參照過來的表**,
連 `DELETE` 時會被 `RESTRICT` / `NO ACTION` 擋下來的表也一起清([官方](https://www.postgresql.org/docs/17/sql-truncate.html))。

【量的】唯讀查正式庫,遞迴走 `pg_constraint` 的 FK 圖:

```
TRUNCATE orders CASCADE 會清到幾張【相異】表(含 orders 自己)   26
其中【本 plan 三支 trigger 涵蓋的】                              3
⇒ 沒被涵蓋的                                                    23
```

**而沒被涵蓋的那 23 張裡,有 14 張碰錢**:
```
order_manual_refunds · order_payments · order_pending_refunds · order_refund_items
order_refund_job_items · order_refund_jobs · order_refund_manual_corrections · order_refunds
payment_charge_attempts · payment_double_charge_anomalies · payment_double_charge_anomaly_events
payment_refund_events · payment_refunds · pending_invoices
```
外加 `email_outbox` · `order_cancellations` · `shipment_items` · `coupon_redemptions` 等。

⇒ 📌 **所以三支 trigger【不是】完整方案。** 它會讓 `orders` / `order_items` / `order_legal_consents` 留痕,
而**退款、收款、發票那 23 張表照樣安靜地全部消失**。
⇒ 🛑 **而最小骨架的驗收會【全綠】** —— 因為骨架裡沒有那 23 張表。
📌 **這正是今天的母題再來一次:一個綠色的輸出,由「真的完整」與「量的世界太小」兩種原因產生,而它們印同一個字。**

### 【量的】它真的會叫,而且四格都跑過

| 格 | 讀數 |
|---|---|
| **正檔** | `TRUNCATE orders CASCADE` ⇒ log 表 **3 列**(2 張單 + 1 個品項),單號與金額字面都在 |
| **CASCADE 會不會帶到子表** | ✅ `order_items` **有留痕**(log 表裡真的有那一列)⇒ 它的 trigger 確實跑了。<br>🛑 **而 `order_legal_consents` 那一支我【沒測到】** —— v2 那一發我沒種同意書,所以它的抄寫分支**沒有證據**(codex nit,它對)。<br>⛔ ~~原本我拿 `NOTICE: truncate cascades to table …` 當證據~~ —— **那只證明它被列進清除清單,不證明 trigger 執行了**(trigger 停用時同樣會印那句)。 |
| **負對照** | 三支停掉(`tgenabled='D'`,前提斷言 = 3)⇒ 同樣動作 ⇒ log 表 **0 列** |
| **回歸** | 原本的 `DELETE` 那條路 ⇒ 仍抄 **2 列**,而它們的 `pcm_truncate` 是空的 ⇒ **兩條路分得出來** |

---

## 3. 代價 —— 也量了

`TRUNCATE` 之所以被用就是因為它快。抄列會讓它變成 O(n)。

【量的】同一個叢集,50,000 列:

| | TRUNCATE 耗時 |
|---|---|
| **掛著本片的 trigger** | **643.885 ms** |
| **把 trigger 停掉** | **9.085 ms** |

⇒ 約 **70 倍**,而 50,000 列仍在 **1 秒內**。

【量的】而**今天的正式庫規模**:`orders` **6** 列 · `order_items` **7** 列 · `order_legal_consents` **3** 列。
⇒ 🔵 **今天要【複製的資料量】很小(16 列)。**

🔴 **而「資料量小」推不出「成本是零」** —— codex must-fix,它對。漏掉的實質成本至少四項:
· **留痕表只增不減**:`TRUNCATE` 清掉來源表,**不會清掉抄進 `orders_deleted_log` 的那些副本**(JSONB / TOAST / 索引持續長大)。
· **WAL、提交持久化、備份與複寫**都要吃那些寫入。
· 🔴 **持鎖時間變長**:`TRUNCATE` 對涉及的表持排他鎖到交易結束;多一段抄寫**會把鎖握得更久**,期間線上訂單的讀寫會等([鎖文件](https://www.postgresql.org/docs/17/explicit-locking.html))。
· 🔴 **留痕寫失敗 ⇒ 整個操作失敗**,不是「只慢一點」。而**那是 Sean 自己拍過的**:
  `20260907070000:50` 逐字「**Sean 2026-09-07 答 `Q37` = 甲 —— 「留痕寫不進去 ⇒ 刪除跟著失敗」**」(fail-closed)。
  ⇒ ✅ **本片沿用同一個語意**,不得為了「操作零影響」而吞錯。

🛑 而那個 70 倍的比較**公平性我沒證**:兩組之間的 log 初始大小、快取狀態、重複次數、計時邊界(含不含 COMMIT / WAL 刷盤)**我都沒有控制**。
⇒ 📌 **它是一個數量級的參考,不是一個受控的量測。**

---

## 4. 影響 / rollback

· 新增:1 支函式 + 3 支 trigger。**不新增表、不改欄位、不改現有 trigger。**
· 對客人:**零**。對 Sean 的操作:**零**(除非他自己下 `TRUNCATE`,那時會慢一點點)。
· rollback:`DROP TRIGGER` ×3 + `DROP FUNCTION` ⇒ 回到今天的狀態。**不會動到任何既有資料。**
· 號段:窗 C `20260909 08xxxx`(下一個未用號)。

---

## 5. 🛑 我證不到什麼

· **【證不到】正式庫上真的 `TRUNCATE` 會怎樣** —— 那要在正式庫 `TRUNCATE`,**不做**。全部在拋棄式 PG 上。
· **拋棄式的骨架是我建的最小三張表** ⇒ 正式庫的完整欄位、約束、其他 trigger 的互動**沒有涵蓋**。
· **【證不到】`orders_deleted_log` 自己被 `TRUNCATE` 的話會怎樣** —— 沒測。**留痕表自己被清掉,本片擋不住。**
· **【證不到】50,000 列那個數字在正式庫的硬體上是多少** —— 那是我本機拋棄式叢集的讀數。
· **【證不到】`DROP TABLE` / `DROP SCHEMA`** —— 那兩個連 trigger 都一起沒了,**本片與貼板 103 都擋不住**。
· **【證不到】有沒有人在貼板 103 上線之前刪過單** —— log 表從 0 開始。

### 🔴 而下面這幾格是【已知限制】,不是「機制未知」(codex nit,分開寫比較誠實)

· **留痕表自己被清掉** ⇒ 紀錄一起消失。
· 🔴 **同一句把來源表與留痕表一起 `TRUNCATE`** ⇒ BEFORE 剛寫進去的那些列,**會在後續的清除階段被一起清掉**。
  🛑 **調換表名順序救不了**(同一個語句)。
· **`DROP TABLE` / `DROP SCHEMA`** 不觸發任何 DML trigger ⇒ 連 trigger 自己都沒了。
· **`DISABLE TRIGGER` 繞得過**;而有設定權限的人用 `session_replication_role = replica`,
  **也會讓「預設啟用」模式的 trigger 不執行**([設定文件](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE))。
· **整個交易回滾** ⇒ 清除與留痕一起回滾;它**不保存失敗的嘗試**。
· **空表 `TRUNCATE`** ⇒ `INSERT … SELECT` 寫入零列 ⇒ **不是每次操作都有事件紀錄**。
  📌 那一格值得單獨看:**「沒有紀錄」有兩種原因 —— 沒發生過,或發生在空表上。**

### 🛑 動態 SQL 那段的實作要求(codex nit,收進驗收)

本檔 §2 只寫了敘述、**沒有給格式字串與引數** ⇒ **不能據此判它安全或有洞**。實作時必須:
· schema / 表 / 欄名用 `%I`(完整名稱是 `%I.%I`,**不可以把 `public.orders` 整串塞進一個 `%I`**);值用 `%L` 或 `USING`。
· `SET search_path = ''` 之下,**來源表與目的表都要完整限定 schema** —— 裸的 `FROM %I` 找不到 public 的表,還可能解析到同名暫存表。
· `TG_TABLE_NAME` 由 PostgreSQL 給,**來源可靠不等於可以不做 SQL 引用**(表名可能含引號)。
· 值不會自動代入 PL/pgSQL 區域變數 ⇒ 要走 `USING`。
· 核對 `TG_RELID` 的 schema 與允許的表名;明訂函式擁有者、`REVOKE` 與權限驗收。

---

## 6. 驗收(缺一不算)

1. 拋棄式 PG 正向貼 ⇒ 種假單 ⇒ **真的 `TRUNCATE`** ⇒ log 表列數 = 種下去的列數,且 `row_data` 含單號與金額。
2. **負對照**:三支 trigger 停掉 ⇒ 同樣動作 ⇒ **0 列**。(前提斷言:先驗 `tgenabled='D'` 的有 3 支)
3. **回歸**:原本的 `DELETE` 那條路仍抄,且 `pcm_truncate` 為空 ⇒ 兩條路分得出來。
4. **CASCADE**:`TRUNCATE orders CASCADE` ⇒ 兩張子表也各留痕。
5. 🔴 **`order_legal_consents` 那一支要單獨驗** —— 種一筆非空的同意書,`TRUNCATE`,看它的內容真的進了 log 表。
   (第一版沒測到這一格,而我拿 `NOTICE` 當了證據 —— **那不是執行證據**。)
6. 🔴 **範圍要當著 Sean 的面講清楚**:驗收若只在最小骨架上跑,**會全綠而 23 張表沒被涵蓋**。
   ⇒ 驗收環境至少要包含一張**碰錢的**參照表(例如 `order_refunds`),用來**證明它【沒有】被涵蓋**。
7. codex 唯讀審 `-m gpt-6-astra`,must-fix 折完才 commit。

---

## 6.5 🔴 丙(擋住 TRUNCATE)查完了 —— **它沒有大家希望的那個性質**

> 主視窗希望丙有一個甲乙都沒有的性質:**「它不需要知道有幾張表。26 也好 40 也好,擋住入口就都擋住了。」**
> 🔴 **我實測的結果:那個性質【不存在】。**

【量的】拋棄式 PG 17.10,四題逐題測:

### ① 技術上擋得住嗎 ⇒ **擋得住,而只有一種做法**

`BEFORE TRUNCATE … FOR EACH STATEMENT` 的 trigger 裡 `RAISE EXCEPTION`:
```
測 1:postgres(擁有者)自己 TRUNCATE
  NOTICE:  truncate cascades to table "order_items"
  ERROR:  這張表不允許 TRUNCATE(表:orders)。要清資料請用 DELETE —— 那條路有留痕。
  HINT:   真的要 TRUNCATE 的話, 必須先明確停用 …
測 2:資料還在嗎(必須 2)  ⇒ 2
```
✅ **連表的擁有者 `postgres` 都擋得住**,資料一列沒少,而且**錯誤訊息 + HINT 講得出下一步**。

### 🔴 而「一支守全庫」的那條路 —— **PostgreSQL 直接拒絕**

```sql
CREATE EVENT TRIGGER pcm_no_truncate_evt ON ddl_command_start
  WHEN TAG IN ('TRUNCATE TABLE') …
ERROR:  event triggers are not supported for TRUNCATE TABLE
```
⇒ 📌 **所以丙【也要逐表掛】** —— 跟乙**同一個腐爛問題**:每有人加一張參照 `orders` 的新表,就多一個沒被擋的洞,而沒有任何東西會叫。
🎯 **丙沒有「不需要知道有幾張表」這個性質。那是我先前沒查就沒說,而主視窗照那個假設在推薦它。**

### ② 擋了之後誰會被擋到 ⇒ **擋得住,而一行就繞得過**

| 繞過路徑 | 結果 |
|---|---|
| `SET session_replication_role = replica;` | 🔴 **TRUNCATE 成功,剩 0 列** —— **一行 SQL 就繞過** |
| `ALTER TABLE … DISABLE TRIGGER …` | 🔴 **TRUNCATE 成功,剩 0 列** |

🛑 **而能下 `TRUNCATE` 的那個身分,本來就下得了這兩行。** ⇒ 📌 **丙是一個減速丘,不是一道牆。**
🔵 它擋得住的是「**手滑**」與「**不知道有這規矩的人**」,擋不住「**決定要做的人**」。

### ③ 它擋不擋 `DROP TABLE` / `DROP SCHEMA` ⇒ **完全不擋**

```
DROP TABLE public.order_items;  ⇒ DROP TABLE
DROP TABLE public.orders;       ⇒ DROP TABLE
🔴 表還在嗎 ⇒ 0(沒了)
```
⇒ **與甲乙一樣的天花板。丙在這一格【不比較完整】。**

### ④ 會不會擋到我們自己的維運 ⇒ **會,而且量得出來**

✅ **不擋 `DELETE`**(實測:`DELETE FROM orders WHERE id=1` ⇒ 正常,剩 1 列)⇒ **正常操作不受影響**。

🔴 **而我們自己的驗證腳本會被擋**:
【量的】掃 `supabase/migrations/` 與 `scripts/`(**先剝掉整行註解**),找 `TRUNCATE` 那 26 張表裡任何一張的:
```
命中 12 處, 分布在 10 支腳本
  scripts/expire-unpaid-by-channel-verify.sh  (orders · payment_charge_attempts)
  scripts/probe-expire-day-boundary.sh        (orders)
  scripts/l5b1-verify.sh                      (payment_refunds)
  scripts/pcm01-record-verify.sh              (order_manual_refunds)
  scripts/shipunvoid1-apply-probe.sh          (email_outbox)
  scripts/coupon-cap-concurrency-verify.sh    (coupon_redemptions)
  scripts/d3d-immutable-verify.sh             (order_manual_refunds ×2)
  scripts/b2s1b-verify.sh                     (shipment_items)
  …
🟢 正對照:整個 migrations 裡出現過 TRUNCATE 這個字的檔數 = 73 ⇒ 尺會咬
```
· 這些都跑在**它們自己起的拋棄式 PG**(實測 `expire-unpaid-by-channel-verify.sh:40` 自己 `initdb`)⇒ **不碰正式庫**。
· 🔴 **但其中有幾支【會套用我們的 migration】** ⇒ 那道擋 trigger 會跟著進去 ⇒ **它們的 `TRUNCATE` 會被自己擋掉**。
  【量的】抽樣四支:`l5b1-verify.sh` 提到 `supabase/migrations` **3** 次 · `d3d-immutable-verify.sh` **8** 次
  · `expire-unpaid-by-channel-verify.sh` **1** 次 · `b2s1b-verify.sh` **0** 次(自建 schema,不受影響)。
  🛑 **【證不到】確切有幾支會壞** —— 那要逐支讀它們怎麼用 migrations,我只抽樣了四支。

🔵 **而災難還原那一格反而沒事**:`pg_restore --disable-triggers` 本來就是設 `session_replication_role = replica`
⇒ 它會自動走繞過路徑 ⇒ **不會在還原那天擋路**。(【推的】—— 我沒有真的跑一次 `pg_restore` 驗證。)

### ⇒ 丙的老實結論

| 主視窗希望的性質 | 實測 |
|---|---|
| 不需要知道有幾張表 | 🔴 **不成立**(event trigger 不支援 TRUNCATE ⇒ 要逐表掛,跟乙同樣會腐爛) |
| 擋住入口就都擋住了 | 🟡 **半成立** —— 擋得住手滑,而 `session_replication_role = replica` **一行就繞過** |
| 比甲乙完整 | 🔴 **不成立** —— `DROP TABLE` / `DROP SCHEMA` 一樣擋不住 |
| 對 Sean 影響是零 | ✅ **這一格成立** —— 不擋 `DELETE`;而他 09-04 那次是 `23 ⇒ 1`,不是 TRUNCATE |
| 代價 | 🔴 **會擋到我們自己幾支驗證腳本**(12 處命中 / 10 支;會壞幾支我證不到) |

📌 **所以三個選項都有缺陷,而那本身就是結論**:
· 甲 = 記一部分,而**看起來像記全了**
· 乙 = 記全,而**清單會腐爛**
· 丙 = 擋住手滑,而**擋不住決定要做的人**,且**同樣要逐表掛**

---

## 7. 要 Sean 答的一題

> 🔴 **本節是第二版。** 第一版的選項建立在「三支 trigger = 完整方案」這個錯前提上,
> 而我量到 `TRUNCATE orders CASCADE` 會清到 **26 張表**、三支只涵蓋 **3 張**。**兩個選項都重寫了。**

```
Q:訂單被 TRUNCATE 清光時, 要不要補留痕? 而【補到哪裡為止】?

    現況(都是量的):
      · 貼板 103 已上線, 擋得住【一列一列 DELETE】—— 刪一張單留 3 列, 單號金額都在。
      · 🔴 但 TRUNCATE 一列都不會留。實測過。
      · 🔴 而 TRUNCATE orders CASCADE 會遞迴清到【26 張表】,
        其中【14 張碰錢】(退款 8 張 · 收款/扣款 4 張 · 發票 1 張 · 重複扣款異常 2 張)。
        ⚠️ CASCADE 的範圍不看 FK 是不是 ON DELETE CASCADE —— RESTRICT 的也照清。

    甲 = 只補那三張(orders / order_items / order_legal_consents)。
        給的:那三張表被 TRUNCATE 時, 每一列的完整內容都抄得下來(實測, 單號金額都在),
              沿用貼板 103 已拍的 fail-closed(留痕寫不進去 ⇒ 操作跟著失敗)。
        🛑 不給的:另外【23 張表照樣安靜地全部消失】, 包含所有退款與收款紀錄。
              ⇒ 📌 事後你會看到「三張表被清了」而【看不到退款資料被清了】——
                 那比完全沒有留痕更容易誤導, 因為它看起來像有在記。
        代價:留痕表只增不減(TRUNCATE 不會清它)· WAL 與備份 · 持鎖時間變長
              · 5 萬列時 9ms → 644ms(未受控的參考值, 不是受控量測)。

    乙 = 補到 26 張表都涵蓋。
        給的:CASCADE 掃到的每一張表都留痕。
        代價:🔴 26 支 trigger 要維護, 而【每次有人加一張參照 orders 的新表, 就多一個沒被涵蓋的洞】,
              而沒有任何東西會提醒我們。⇒ 那是一個會持續腐爛的清單。
              持鎖與寫入量也跟著放大 26 倍量級。

    丙 = 不補 TRUNCATE 這條路, 改成【擋住它】—— 例如 REVOKE / 加規則不讓 TRUNCATE 發生。
        🛑 我沒有查過這條路可不可行, 也沒有量過它會不會擋到正常維運。
        ⇒ 若你想走這條, 我先去查再回你, 不要現在拍。

A: 甲|乙|丙
```

🔵 **我不預設,而我要講清楚一件事**:我第一版寫「甲的成本今天幾乎是零」,
那句在**資料量**上是對的(16 列),在**完整性**上是**誤導的** —— 它只涵蓋 26 分之 3。

🔴 **而「發生過一次」是哪一次 —— 講具體,而且要標清楚哪一半是證到的**:
> `⟦db-ORDERDELETENOTRACE⟧` 板上(**節錄**,原句更長):**(Sean 09-04 請窗刪掉測試單,23 ⇒ 1)**

· 【量的】那次是**授權的**,而缺口從頭到尾都是同一個:**零留痕**。
· 🛑 **【證不到】那次用的是不是 `TRUNCATE`** —— 23 ⇒ 1 反而不像單次 `TRUNCATE`(那會變成 0)。
  **也證不到當時走的是 `postgres` / SQL Editor。** 我第一版把這兩件寫得太滿。
· 【量的】五個指定應用角色(`anon`/`authenticated`/`service_role`/`pcm_readonly`/`authenticator`)
  對那三張表**沒有直接的 `TRUNCATE` 權限**。
  🛑 **而這推不出「唯一做得到的是 Sean 本人」** —— 我沒有排除其他角色、可切換的角色身分、
  管理連線、或高權限函式。**DB 角色也不等於某一個人。**

⇒ 📌 **所以這一題真正在問的是**:下一次有人用高權限 SQL 清掉單子,
你要不要事後查得到清掉了什麼 —— **以及,只查得到 26 分之 3 算不算數。**
