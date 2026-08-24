# `#858` 手動建單 RPC — 拋棄式 PG 驗證紀錄(2026-08-24,線C)

> **這份檔存在的理由**:那支 migration 的負測、以及「我的驗證環境跟正式庫差在哪」的**分母**,
> 原本只活在一次對話裡。對話會消失,而**下一個改那支 RPC 的人需要的正是這兩樣**。
>
> 對象檔:`supabase/migrations/20260824020000_m4b_858_admin_create_manual_order.sql`
> 環境:PostgreSQL 17.10(Homebrew,aarch64-apple-darwin23.6.0)拋棄式叢集
> 狀態:**該 migration 尚未 apply 到正式庫**(本檔寫成當下)

---

## 🔴 0. 效度限制 —— 先讀這段,不要只讀下面的 ✅

**這個環境不等於正式庫。** 下面每一個 ✅ 的射程都受這一段限制
(數法:`grep -c '✅' docs/probes/2026-08-24-858-manual-order-rpc-probe.md`
—— ⚠️ **那個數字含本行以外的所有 ✅,包含不是驗收結果的那些**;要精確的驗收格數看 §3 的兩個數法):

| 差在哪 | 具體 |
|---|---|
| **7 支 migration 沒跑**(見 §2) | 那 7 支在正式庫是**有效的**;它們建立的東西,我這裡沒有 |
| 平台物件是 **shim** | `auth.users` / `auth.uid()` / 三個角色 / `pgcrypto` 都是 repo 的 `scripts/d1-*.sql` 造的替身,不是 Supabase 給的真東西 |
| 資料是**空的** | 只有 1 位種子客人 + 1 張種子訂單。**沒有真商品、沒有真訂單量**⇒ 效能、索引選擇、與既有資料的交互作用**一格都沒量到** |
| `service_role` 的權限是 shim 給的 | `d1-supabase-shim.sql:50-52` 的預設授權**比正式站寬**(見 §2 那支被跳過的 ACL 斷言) |

⇒ **能證的**:這支 RPC 的**邏輯**在這些輸入下會怎麼走、哪些守門會開火。
⇒ **不能證的**:它在正式庫上會不會 apply 成功、會不會撞到真資料、效能如何。

---

## 1. 環境怎麼起(可重跑)

照 `docs/runbooks/throwaway-postgres-for-migration-verification.md` §1,加上本片的三件事:

```bash
export LC_ALL=C LANG=C
D=/tmp/pcm-probe-c96; PORT=5591
initdb -U postgres -A trust "$D/data"
pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start
```

**① 資料庫必須是 UTF8** —— initdb 在 `LC_ALL=C` 之下造出來的 template 是 `SQL_ASCII`,
而 `20260716210000` 裡有 `U&'\00A0'`(NBSP)⇒ 直接炸 `conversion between UTF8 and SQL_ASCII is not supported`。
```sql
CREATE DATABASE probe ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
```

**② 三份 shim 都要用,而 `d1-fitments-bootstrap.sql` 要插在【中間】**
```
scripts/d1-supabase-shim.sql        ← 開頭跑
scripts/d1-fake-cron.sql            ← 開頭跑
scripts/d1-fitments-bootstrap.sql   ← 🔴 在 20260712183000 【之前】跑,不能在開頭
                                       (它 CREATE 的 view 引用 public.products,而那張表還沒建)
```

**③ `auth.uid()` 要換成會讀 JWT claim 的版本**
`d1-supabase-shim.sql` 給的那支**寫死回 NULL**,而 `20260820020000` 的自我驗證需要它真的回借來的 uid。
```sql
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
```

**④ `20260820020000` 之前要先種一張訂單** —— 它自己寫著「現在 `public.orders` 零列 ⇒ probe 跑不了……
**不要把這道斷言拿掉**」。種一位客人 + 一張單即可(`display_id` 要用 `public.pcm_generate_display_id()`,
手打的字串過不了 `orders_display_id_format`)。

結果:**205 支 apply 成功 / 7 支跳過。**

---

## 2. 🔴 跳過的 7 支 —— 這是「我的環境 ≠ 正式庫」的分母

**這 7 支在正式庫都是有效的。跳過它們是本機環境的限制,不是它們有問題。**
**我一個字都沒有改它們。**

| 版本號 | 為什麼跳 | 這讓我看不到什麼 |
|---|---|---|
| `20260723120000` | pg_cron 未啟用。`d1-supabase-shim.sql` **檔頭自己指名要跳它** | settle sweep 的排程註冊 |
| `20260809170000` | 同上(pg_cron 閘) | 未付款訂單過期的排程 |
| `20260819160000` | 同上(pg_cron 閘) | — |
| `20260820060000` | 同上(pg_cron 閘) | — |
| `20260820070000` | `cron.job` 少 `nodename` 欄 ⇒ **`d1-fake-cron.sql` 比這支 migration 舊** | capture recheck 的排程 |
| `20260818190000` | 函式 EXECUTE 斷言紅(`owner 以外的 grantee 應零筆,實 6 筆`)。成因=`d1-supabase-shim.sql:52` 的 `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role` **比正式站寬** | admin SSO login events 的 ACL 縱深 |
| `20260820120000` | EBC 商品資料回填 —— 空 probe 沒有那些商品 | 分類搬移的資料正確性 |

🔴 **另一件在這裡量到的事,與本片無關但值得記**:
`supabase/migrations/` **沒辦法從零重播** —— `20260712183000` 引用一個 `20260811020000` 才建的 view。
repo 用 `scripts/d1-fitments-bootstrap.sql` 補它,而**那是 shim 不是修好**(該檔檔頭指向 backlog `#299`)。

---

## 3. 負測:每一格對應一條被 codex 打中的 finding

**完整可跑的腳本就在旁邊兩支檔**(不是貼在這裡的片段):
```
docs/probes/2026-08-24-858-manual-order-rpc-r1-negatives.sql   ← R1 那 21 格
docs/probes/2026-08-24-858-manual-order-rpc-r2-negatives.sql   ← R2 那組 + 兩個 nit 的負測
```
跑法:環境照 §1 起好之後 `psql -h 127.0.0.1 -p 5591 -U postgres -d probe -q -f <上面那支>`。

腳本形狀(`pg_temp.mk2` 把 `SQLSTATE` 與 `CONSTRAINT_NAME` 一起吐出來,
**否則「哪一道守門開火」與「有東西紅了」在輸出上是同一句話**):

```sql
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  RETURN 'RAISE[' || v_state || '/' || COALESCE(v_con,'-') || '] ' || left(SQLERRM, 28);
```

### R1 那組
**格數數法**(不是我數的,是輸出自己數的):
```bash
psql -h 127.0.0.1 -p 5591 -U postgres -d probe -q \
  -f docs/probes/2026-08-24-858-manual-order-rpc-r1-negatives.sql 2>&1 \
  | grep -cE '^ (P|N|X)[0-9]'      # ⇒ 2026-08-24 得到 21
```
⚠️ **「全對」是我逐格看過輸出得到的,不是那條命令算出來的** —— 那條只數**格數**,
不數**對錯**(這支腳本沒有 assert,它印值、由人判)。要自動化就要另外寫,本片沒寫。

| 格 | 餵什麼 | 得到 |
|---|---|---|
| P1 / P1b | 兩個品項 × 500 + 運費 100 | `subtotal=1000 total=1100 src=manual_phone ch=bank_transfer` |
| P2 / P2b | 同鍵同內容重送 | `idempotent:true`,且 orders 仍只有 1 列 |
| P3 / P4 | **邊界** 50 筆 / qty 9999 | 都放行(上限用 `>` 判 ⇒ 邊界值含在允許範圍) |
| P5 / P6 | 兩個代購品 sku 不同 / spec 全字串 | 都放行 |
| N1 / N1b | 同鍵不同內容 / 同鍵只有運費不同 | 都拒 |
| N2 / N3 / N3b | 51 筆 / qty 10000 / **qty=2147483647 配 0 元** | 都拒 |
| N4 / N5 | 同 variant_id 兩列 / 代購品 sku+品名都一樣 | 都拒 |
| N6 / N7 / N7b | spec 值是數字 / 有 `cost` / 有 `price_by_tier` | 都拒 |
| X1 | 失敗的那些鍵 | orders **零列**(整筆回滾) |
| X2 / X3 / X4 | `anon` / `service_role` / `authenticated` 的 EXECUTE | `false / true / false` |

🔴 **每一格的訊息都要確認是【本函式的】,不是表上 CHECK 的** —— 兩者都會紅,而**只有訊息分得出是誰擋的**。

### R2 那組(codex 第二輪之後新增)
| 格 | 餵什麼 | 期望 | 得到 |
|---|---|---|---|
| R2-1a | 同鍵、品項**換順序** | `IDEMPOTENT` | ✅(R1 版本會**誤拒**) |
| R2-1b / 1c / 1e | 同鍵、發票載具 / 品名 / 規格值多空白 | `IDEMPOTENT` | ✅(R1 版本三格全**誤拒**) |
| R2-1f | 同鍵、真的改了數量 | `P858B` | ✅ `RAISE[P858B/pcm_858_manual_order_payload_mismatch]` |
| R2-3a / 3b | 同料號同品名、**規格不同** / **單價不同** | 放行 | ✅(R1 版本會誤拒) |
| R2-3c | 同料號、品名**中間**多一個空白 | 拒 | ✅(R1 版本會被繞過) |
| nitA-1 | 直接 INSERT:有冪等鍵、指紋是 NULL | 被 CHECK 擋 | ✅ **(第一版沒擋住,見下)** |
| nitA-2 | 指紋不是 64 碼 hex | 被 CHECK 擋 | ✅ |
| 併發 | A 持未 commit 的同鍵列,B 撞上去 | `P858A` | ✅ `RAISE[P858A/pcm_858_manual_order_concurrent_request]` |

**併發那格怎麼做成決定性的**(不靠運氣):
```
A: BEGIN; INSERT 一列帶同一顆 manual_request_id; SELECT pg_sleep(6); COMMIT;   ← 背景跑
B: 兩秒後呼叫 RPC ⇒ 它在冪等格查不到 A 的未 commit 列 ⇒ 走到 INSERT ⇒ 卡在唯一索引
   ⇒ A commit ⇒ B 拿到 unique_violation ⇒ 進 handler
```

---

## 4. 🔴 這組負測抓到的兩個【我自己造的】洞

**兩個都不是讀出來的,兩個都在「為了修 nit 而新增的碼」裡。**

### ① `pg_catalog.nullif(...)` —— 這個函式不存在
`NULLIF` / `COALESCE` / `CASE` 是 **SQL 語法構造**,不是 `pg_catalog` 的函式。
函式本體其他每一行都寫 `pg_catalog.xxx(...)`(因為 `SET search_path = ''`)⇒ **照風格寫就會寫錯**。
```
靜態閘 4 道 / typecheck / lint / build / 本檔 apply 斷言  ⇒ 全綠
真的呼叫一次                                              ⇒ 立刻爆 function does not exist
```
**成因:plpgsql 的函式本體到【被呼叫】那一刻才解析名稱。**

### ② 新加的 CHECK 對它自己的目標零判別力
```sql
-- 第一版(壞的)
(manual_request_id IS NOT NULL AND manual_request_payload_sha256 ~ '^[0-9a-f]{64}$')
```
`sha` 是 NULL 時:`NULL ~ pattern` = **NULL,不是 FALSE** ⇒ `false OR NULL` = NULL
⇒ 而 **CHECK 只擋 FALSE、放行 NULL** ⇒ **毒化列照樣寫進去。**

🔴 **形狀比內容值錢**:這道 CHECK **存在的唯一理由**就是擋「有鍵無指紋」的列,
而它對那個情境**完全無效** —— 它不是「擋得不夠嚴」,是**對自己的目標零判別力**,
而它在 schema 上**看起來完全像一道 CHECK**。

修法=補 `AND manual_request_payload_sha256 IS NOT NULL`。
⚠️ **這一族用眼睛讀是零判別力的。我讀了兩遍沒看出來。**

---

## 5. 🔴 一個量測坑(不是本片的,但同一天量到)

```
第一次跑完整 admin 套件 ⇒ 2 支紅
再跑一次              ⇒ 換成【另外兩支】紅
錯誤內容              ⇒ Test timed out in 20000ms(不是斷言失敗)
成因                  ⇒ 我的拋棄式 PG 叢集還開著在搶資源
收攤後重跑            ⇒ 254 檔全綠
```
**⇒ 跑測試套件之前先收攤。**
**⇒ 同一把尺量兩次結果不同 ⇒ 那不是資料在變,是尺在變。**
我差點把三支**別人的**檔報成「紅的」。

**怎麼把「我造成的」與「本來就紅」分開**:
**把自己的檔整支移出工作樹,再跑一次。** 那是唯一決定性的動作 ——
今天用它證出:`database-types-apply-state.test.ts` **拿掉我的檔照樣紅**(所以不是我的)。

---

## 6. 收攤

```bash
pg_ctl -D /tmp/pcm-probe-c96/data stop -m fast
rm -rf /tmp/pcm-probe-c96
lsof -nP -iTCP:5591 -sTCP:LISTEN   # 應無輸出
```
