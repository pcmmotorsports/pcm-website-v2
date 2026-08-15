# `#1` 片0 — PostgREST `.or()` 疊加語意查證報告(零 code、**實跑實測**)

> C 窗 · 2026-08-15 · repo @ `d532b946`。
> 🔴 **這份報告的結論不是讀文件推的,是跑起一座 PostgREST 量出來的**(用完已拆,見 §5)。
> 🔴 **零正式庫接觸**:全程對一座**丟棄式本機 Postgres**(scratchpad、TCP 55432、四列假資料)。

## §0 三題的答案(先給結論,證據在下面)

| 題 | 答案 | 承重程度 |
|---|---|---|
| **1. 兩個 `.or()` 疊起來** | **AND**,而且**各自的括號保住** ⇒ `(A OR B) AND (C OR D)` | **實測 + 拿到逐字 SQL WHERE** |
| **2. `.or()` 疊 `.in('id',…)`(關鍵字)** | **AND**,`or=` 那組的括號不會被拆開 | **實測 + 逐字 WHERE** |
| **3. `.or()` 與 `.is('cancelled_at', null)`** | 🔴 **不加守門就會撈回已取消的單**;加了就正確,語意是 `(cancelled_at IS NULL) AND (… OR …)` | **實測**(已取消那列真的跑出來過) |

⇒ **片1 可以照原計畫走 `.or()`,不必改走 RPC。** 但第 3 題確認了一個**必做**的動作,見 §3。

## §1 客戶端:supabase-js 把 `.or()` 變成什麼(本機量測,零網路)

`@supabase/postgrest-js@2.105.3`(實裝版本)`src/PostgrestFilterBuilder.ts:2002-2012` 逐字:
```ts
const key = referencedTable ? `${referencedTable}.or` : 'or'
this.url.searchParams.append(key, `(${filters})`)
```
🔴 **`append` 不是 `set`** —— 而且該檔**每一支** filter 方法都用 `append`
(數法:`grep -c 'searchParams\.append' src/PostgrestFilterBuilder.ts` ⇒ **36**;
`grep -c 'searchParams\.set' 同檔` ⇒ **0**。
🔴 **正向對照**:同一支 pattern 打 `src/PostgrestTransformBuilder.ts` ⇒ **5** 命中
⇒ `set` 的 pattern 有效,FilterBuilder 的 0 是**真的零**、不是沒對上。)

實跑真 builder(不送出、只印 URL)得到的字面:
```
M2 兩個 .or() 疊起來:
/admin_order_list_v?select=id&or=(payment_status.eq.unpaid,goods_axis.eq.none)&or=(payment_channel.neq.tappay,payment_status.neq.unpaid)

M3 待處理 .or() + 關鍵字 .in(id) + cancelled 守門:
/admin_order_list_v?select=id&or=(payment_status.eq.unpaid,goods_axis.eq.none)&id=in.(x,y)&cancelled_at=is.null
```
**正向對照(證明量法有判別力)**:
```
對照A 同欄呼叫兩次 .eq ⇒ ?payment_status=eq.unpaid&payment_status=eq.paid
   (若是 set 語意會只剩一個 ⇒ 兩個都在 = append 確認)
對照B .or() 之後再 .eq ⇒ ?or=(a.eq.1,b.eq.2)&c=eq.3
   (`c` 沒有被吸進括號 ⇒ .or() 不會吞掉後面的 filter)
```

## §2 伺服器端:實跑 PostgREST 量到的**逐字 SQL WHERE**

**環境**:丟棄式 Postgres 17.10 + **PostgREST 14.16**(`postgrest --version`),`db-plan-enabled = true`。
**測資四列(刻意設計成三種假說會給出三種不同答案)**:

| id | payment_status | goods_axis | payment_channel | cancelled |
|---|---|---|---|---|
| X | unpaid | shipped | tappay | 否 |
| Y | paid | ordered | tappay | 否 |
| Z | unpaid | none | cash | 否 |
| C | unpaid | none | cash | **是** |

`orA` = 待處理 = `or=(payment_status.eq.unpaid,goods_axis.eq.none)`
`orB` = L6 隱藏 = `or=(payment_channel.neq.tappay,payment_status.neq.unpaid)`

**判別力設計**:單獨 `orA` ⇒ `C,X,Z`;單獨 `orB` ⇒ `C,Y,Z`。
⇒ 若疊起來是 **AND** ⇒ `C,Z`;若**前者贏** ⇒ `C,X,Z`;若**後者贏** ⇒ `C,Y,Z`。**三個假說各自有不同的可觀察結果。**

### 實跑輸出(原始)
```
=== 單獨 orA(待處理)===        [{"id":"C"},{"id":"X"},{"id":"Z"}]
=== 單獨 orB(L6 隱藏)===       [{"id":"C"},{"id":"Y"},{"id":"Z"}]
=== Q1 兩個 or= 疊起來 ===       [{"id":"C"},{"id":"Z"}]
=== Q1 反向:順序對調 ===        [{"id":"C"},{"id":"Z"}]
=== Q1 的 WHERE 逐字(explain)===
  Filter: (((payment_status = 'unpaid'::text) OR (goods_axis = 'none'::text))
           AND ((payment_channel <> 'tappay'::text) OR (payment_status <> 'unpaid'::text)))
```
⇒ **AND,括號各自保住,且與順序無關**(對調結果逐字相同)。

### 第 2 題:`or=` 疊 `id=in.(…)`
```
=== Q2 or= 疊 id=in.(X,Y) ===   [{"id":"X"}]
  Recheck Cond: (id = ANY ('{X,Y}'::text[]))
  Filter: ((payment_status = 'unpaid'::text) OR (goods_axis = 'none'::text))

=== Q2b 三個一起 orA+orB+id=in.(X,Y,Z) ===   [{"id":"Z"}]
  Filter: (((payment_status = 'unpaid') OR (goods_axis = 'none'))
           AND ((payment_channel <> 'tappay') OR (payment_status <> 'unpaid')))
  Index Cond: (id = ANY ('{X,Y,Z}'::text[]))
```
⇒ `id=in.()` 走 index、與 `or=` 那組 **AND**;`or=` 的括號**沒有被拆開**。
算術對照:`orA` = `{C,X,Z}`,∩`{X,Y}` = `{X}` ✅;`orA∩orB` = `{C,Z}`,∩`{X,Y,Z}` = `{Z}` ✅。

### 🔴 第 3 題:已取消的單**真的跑出來了**
```
=== Q3 待處理 OR,不加守門 ===        [{"id":"C"},{"id":"X"},{"id":"Z"}]   ← C 是已取消的那列
=== Q3b 加上 cancelled_at=is.null ===  [{"id":"X"},{"id":"Z"}]
  Filter: ((cancelled_at IS NULL) AND ((payment_status = 'unpaid') OR (goods_axis = 'none')))
```
⇒ **主視窗第 3 題的疑慮成立,而且不是理論** —— 「待處理」走 OR 會撈回膠囊寫著「已取消」的單。
⇒ 但 `.is('cancelled_at', null)` 放在**頂層**就解決了(它與 OR 組是 AND)。

## §3 對片1 的硬結論(可以直接當驗收條件寫)

1. ✅ **`.or()` 這條路可行**,不必改走 RPC。兩個 `.or()` 疊起來就是我們要的 `(待處理) AND (L6 隱藏)`。
2. ✅ **關鍵字搜尋不受影響**:`id=in.()` 與 `or=` 是 AND,關鍵字仍然是「在這批結果裡再篩」。
3. 🔴 **「待處理」必須自己帶 `.is('cancelled_at', null)`** —— 現行那道守門綁在
   `SupabaseOrderAdapter.ts:645-652` 的 `if (filter.goodsAxes?.length)` **裡面**,走 OR 就繞過它了。
   ⚠️ 而且**必須綁在「待處理生效時」這個條件裡、不是全域** —— 註解逐字寫沒選貨品軸時已取消單「照舊要看得到」。
4. 🔴 **驗收要有一格負向測試**:測資含一張**已取消**的待處理單,斷言它**不出現**。
   本次量測已證明:**不加守門它真的會出現** ⇒ 這格不是恆綠格,有判別力。

## §4 誠實缺口(這份報告不能證明什麼)

1. 🔴 **版本差**:我量的是 **PostgREST 14.16**(本機 brew),**正式站 Supabase 跑哪一版我沒查、也沒有辦法在不碰正式庫的前提下查**。
   官方文件對「多個 query 參數 = AND」有明文(`docs.postgrest.org` v12 tables_views:「Multiple conditions on columns are evaluated using `AND` by default.」),
   ⚠️ **但「同一個 `or=` 鍵重複出現」那條,官方文件沒有寫**(我親問過那頁,逐字回覆是 not covered)。
   ⇒ **這條是實測成立、文件無明文** ⇒ 我判它是**穩定行為但非契約**。片1 應該**釘一格整合測試**,不要只靠這份報告。
2. **未對正式庫查詢、未開瀏覽器。** 測資是我造的四列,不是真訂單。
3. **沒有測 `admin_order_list_v` 這個 view 本身**(我用的是一張同形狀的表)。
   view 上的 filter 下推理論上一樣,**但我沒證**。⚠️ 特別是 `goods_axis` 是 view 的**衍生欄**,
   對它做 OR 時的計畫可能與對實體欄不同(**效能**面,不是正確性面)。
4. **沒測效能。** 兩個 `.or()` 疊起來會不會讓 planner 放棄索引、在 149k 列上變慢 —— **完全沒量**。
   ⚠️ memory 有前例:同表同資料量,窄索引 22.9ms vs 寬索引+merge join 2,995ms = **130 倍**。這條不該憑「反正有快取」帶過。
5. **沒測 `.or()` 與 `count: 'exact'` 的互動**(列表要總筆數)。

## §5 零留痕

- 丟棄式環境:`initdb` 到 scratchpad → `pg_ctl start`(TCP 127.0.0.1:55432,`unix_socket_directories=` 空)→ PostgREST 53000。
- **用完已拆**:`pg_ctl stop -m fast` ⇒ exit 0;`pgrep -fl 'postgrest|55432'` ⇒ **空**。
- **worktree 零改動**:`git status --porcelain` ⇒ **0**;HEAD 仍 `d532b946`。
- **零 production 檔被碰**(片0 是查證,主視窗明令)。
