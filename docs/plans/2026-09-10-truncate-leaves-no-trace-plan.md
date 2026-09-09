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

### 【量的】它真的會叫,而且四格都跑過

| 格 | 讀數 |
|---|---|
| **正檔** | `TRUNCATE orders CASCADE` ⇒ log 表 **3 列**(2 張單 + 1 個品項),單號與金額字面都在 |
| **CASCADE 會不會帶到子表** | ✅ **會** —— `order_items` / `order_legal_consents` 的 trigger 也叫了(NOTICE 逐字 `truncate cascades to table "order_items"`) |
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
⇒ 📌 **今天抄的代價實質是零(16 列)。** 那個 70 倍要等資料長大才有意義。

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

---

## 6. 驗收(缺一不算)

1. 拋棄式 PG 正向貼 ⇒ 種假單 ⇒ **真的 `TRUNCATE`** ⇒ log 表列數 = 種下去的列數,且 `row_data` 含單號與金額。
2. **負對照**:三支 trigger 停掉 ⇒ 同樣動作 ⇒ **0 列**。(前提斷言:先驗 `tgenabled='D'` 的有 3 支)
3. **回歸**:原本的 `DELETE` 那條路仍抄,且 `pcm_truncate` 為空 ⇒ 兩條路分得出來。
4. **CASCADE**:`TRUNCATE orders CASCADE` ⇒ 兩張子表也各留痕。
5. codex 唯讀審 `-m gpt-6-astra`,must-fix 折完才 commit。

---

## 7. 要 Sean 答的一題

```
Q:訂單被 TRUNCATE 清光時, 要不要留痕?

    現況:貼板 103 已經上線, 它擋得住【有人一列一列 DELETE】——
          我實測過, 刪一張單會留下 3 列, 單號金額都在。
          🔴 但有人下 TRUNCATE 的話, 單子全沒了而【一列都不會留】。實測過。
          而當初真的刪掉那 22 張測試單的那條路, 就是直接下 SQL 那一條。

    甲 = 做。加三支 BEFORE TRUNCATE 的 trigger。
        🔵 我原本以為它只記得到「發生過」——【那是我講錯的】。實測:它跑在資料消失【之前】,
           所以【整筆內容都抄得到】, 跟 DELETE 那條路留的是同一種東西。
        代價:① TRUNCATE 會變慢。5 萬列實測 9ms → 644ms(約 70 倍, 仍在 1 秒內);
              而【今天正式庫只有 6 張單】⇒ 實質是零。
              ② 多一支函式 + 三支 trigger 要維護。
              ③ 🛑 它擋不住 DROP TABLE / DROP SCHEMA, 也擋不住留痕表自己被清掉。
        不解決:誰刪的仍然分不出是哪一個人(SQL Editor 直下時 session_role 多半是 postgres,
              那是機制天花板, 貼板 103 自己也有同一格)。

    乙 = 不做。
        理由:對那三張表有 TRUNCATE 權限的應用角色【0 個】(我量的), 唯一做得到的是你自己。
        代價:🔴 下次單子用 TRUNCATE 不見了, 系統【一個字都不會記】——
              而那正是這一列當初開出來的那個劇本。

A: 甲|乙
```

🔵 **我不預設。** 兩邊的代價都量過寫在上面。要補一句的是:**甲的成本今天幾乎是零(16 列),而它守的是一個低機率但已經真實發生過一次的劇本。**
