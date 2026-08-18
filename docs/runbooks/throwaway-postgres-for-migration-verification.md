# Runbook · 在 macOS 起一個能跑 PCM migration 的拋棄式 Postgres

> **用途**:要驗一支 migration 而**沒有 DB access**時(施工窗的常態),用本檔在本機起一個真的 Postgres 把它 apply 起來。
> **紅線**:只在拋棄式叢集、**不碰正式庫**、不進別人的 worktree 寫東西(要檔 `cp` 出來)。
> **實跑驗證**:2026-08-16 E 窗跑 `#518`(PostgREST 錯誤欄位)與 `#525`(客戶搜尋 RPC)兩次,本檔是那兩次的實際步驟。

---

## 🔴 這份檔為什麼要存在(不是因為沒人寫過)

**三個 macOS 坑,repo 裡【早就寫過】:**

| 坑 | 已存在的座標 | 寫於 |
|---|---|---|
| Unix socket 路徑 >103 bytes ⇒ postmaster 啟動即死 | `docs/handoff/2026-07-30-a7t-consistency-trigger-handoff.md:71`、`docs/handoff/2026-07-30-a7-cancellations-handoff.md:69` | **2026-07-30** |
| 少 `LC_ALL=C` ⇒ `postmaster became multithreaded during startup` | `docs/handoff/2026-07-30-a7t-consistency-trigger-handoff.md:72` | **2026-07-30** |
| zsh **不對變數做詞分割** ⇒ `PSQL="psql -h …"` 後 `$PSQL` 被當成單一命令名 | memory `feedback_claim-scope-exceeds-fact-three-shapes.md:114`(C 窗踩過) | 2026-08 |

> 🔴 **而 2026-08-16 我還是從頭踩了其中兩個。**
> **病不是「沒寫」,是【寫在只有當事人會回去讀的載體】** ——
> handoff 是一次性的;memory 要有人記得 recall。
> **而「我現在要起一個拋棄式 PG」這個動作,在那一刻沒有任何東西會叫。**
> ⇒ **本檔的唯一價值是【可被那個動作觸發】** —— 放 `runbooks/`,檔名就是那個動作。

---

## 0. 🔴🔴 先讀這段 —— **跑完之後你會覺得做完了,而那一刻正是要讀它的時候**

> **這段原本排在第 4 節。移到最前面的理由:照著指令跑完、看到 `exit 0`,人就停了。**

1. **`apply 成功` ≠ 那些斷言通過。**
   DO 區塊通常**只在失敗時 RAISE、成功時零輸出** ⇒ `exit 0` 只證明**整塊**沒炸,**不證明每一條都跑到**。
   ⇒ **要逐條突變**:一次破壞一個前提,確認**對應那一條**紅,而且**紅的是預期那條訊息**。
2. **先跑一個「本來就該紅」的對照,再信任任何綠。**
   (例:空表時 apply —— 若該 migration 的正向對照斷言是 fail-closed,它**應該炸**。它沒炸才是問題。)
3. **零命中 / 空結果一律配正向對照**:先打一個保證命中的輸入,證明管線是活的。
   **沒有正向對照的 0,與「函式恆回空」在觀察上不可分辨。**
4. **斷言炸掉時,先查是不是自己的環境缺前置**,不要直接報成對方的 bug。
   **實例**:`#525` 第一次 apply 炸在「索引不存在」,查了才知道那支索引由**前一支 migration** 建、
   而對方檔裡明文引了來源(`:146`)⇒ **是我環境不完整,差點報成假 finding。**

---

## 1. 起叢集(整段可貼)

```bash
export LC_ALL=C LANG=C                        # 🔴 少這行會 multithreaded 啟動失敗
D=/tmp/pgprobe && rm -rf "$D" && mkdir -p "$D"  # 🔴 短路徑;scratchpad 全路徑會超過 socket 103 bytes 上限
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" \
  -o "-p 55501 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start
sleep 3
psql -h 127.0.0.1 -p 55501 -U postgres -tAc "select version()"
```
**起不來就看 `$D/pg.log` 最後 6 行,不要猜。**

🔴 **zsh 陷阱**:不要寫 `PQ="psql -h 127.0.0.1 …"` 然後 `$PQ -c …` —— zsh 不做詞分割,整串會被當成命令名。
**用 shell function**:
```bash
pq () { psql -h 127.0.0.1 -p 55501 -U postgres -v ON_ERROR_STOP=1 "$@"; }
```

## 2. 🔴 PCM 專屬 bootstrap(這段是本檔真正新的部分)

**Supabase 平台幫你準備好、而本機沒有的東西**,一個都不能少:

```sql
-- 角色:🔴 `supabase/migrations/` 全樹零 `CREATE ROLE service_role` —— 它是 Supabase 平台給的,
-- 🔴🔴 **而【本檔下面兩行】自己就 `CREATE ROLE service_role`** —— 反例與宣稱只隔一行。
--    (⚠️ 2026-08-16 校正:原寫「repo 全樹零」是假的全稱句 —— 量法 `git grep -nE '全樹.{0,8}CREATE ROLE'` 曾回 5 命中,且本說法的反例包含【拋棄式測試環境自己造角色】。真值=`supabase/migrations/` 底下零,那目錄只有 `payment_confirmer`。)
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;

-- auth schema 骨架(只需要被 FK 參照的那張表)
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

-- 🔴 extensions schema —— migration 裡寫 `extensions.gin_trgm_ops`,沒有這個 schema 會在 DDL 那行就炸
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

-- 業務型別(依你要驗的那支 migration 需要什麼再加)
CREATE TYPE member_tier AS ENUM ('general','store','premiumStore');
```

**⚠️ 建表 DDL 一律從 repo 取,不要憑欄位名自己編** —— 「我造的表跟正式庫不一樣」是這類驗證最大的效度風險。
| 要什麼 | 逐字取自 |
|---|---|
| `public.customers` | `supabase/migrations/20260523034911_init_customers_and_subtables.sql:14-25` |
| `idx_customers_name_trgm` / `idx_customers_phone_trgm` | `supabase/migrations/20260812130000_m4b_347_fuzzy_admin_search_orders.sql:432-438` |

**找法**:`grep -ln "CREATE TABLE.*<表名>" supabase/migrations/*.sql`

## 3. 要 PostgREST 那一層時(驗錯誤欄位 / RPC 介面才需要)

```bash
cat > /tmp/pgprobe/prest.conf <<'CONF'
db-uri = "postgres://authenticator@127.0.0.1:55501/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = 3999
CONF
# 需要先 CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon TO authenticator;
postgrest /tmp/pgprobe/prest.conf > /tmp/pgprobe/prest.log 2>&1 &
```
🔴 **改完 schema 一定要重載 cache**,否則回 `PGRST202`(「找不到那個函式」)而不是你要測的東西:
```sql
NOTIFY pgrst, 'reload schema';
```

## 4. 驗證紀律 → **已移到 §0**

**跑到這裡表示你已經 apply 成功了 —— 回去讀 §0。**
`exit 0` 是「整塊沒炸」,不是「每一條斷言都跑到」。

## 4b. 🔴 要彩排 `supabase db push` 本身(不是只跑 SQL)—— 2026-08-18 實測

> **本節與上面幾節的差別**:上面驗的是「這支 SQL 做了什麼」;本節驗的是「**CLI 那條路長什麼樣**」。
> 存在理由:真 apply 那一刻 Sean 在場、全隊在等 —— **那是最不該當第一次的時刻。**
> 全文與逐格輸出:`docs/probes/2026-08-18-db-push-rehearsal.txt`

**① `db push` 強制 TLS,而 `sslmode=disable` 它【不理】**
拋棄式叢集預設沒有 TLS ⇒ `tls error (server refused TLS connection)`,加 `?sslmode=disable` 得到**一模一樣的錯**。
```bash
openssl req -new -x509 -days 1 -nodes -subj "/CN=localhost" \
  -keyout "$D/data/server.key" -out "$D/data/server.crt"
chmod 600 "$D/data/server.key"
printf "ssl = on\nssl_cert_file = 'server.crt'\nssl_key_file = 'server.key'\n" >> "$D/data/postgresql.conf"
pg_ctl -D "$D/data" -l "$D/pg.log" restart -o "-p 55501 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''"
```
⚠️ **這是【本機彩排】才會撞的**,正式 Supabase 本來就有 TLS ⇒ **不要誤讀成真 apply 的前置。**

**② push 不是整批原子的 —— 一支一支來,成功一支記一支**
實測:182 支推空庫、第 55 支炸 ⇒ 帳本 **54** 筆、失敗那支 **0** 筆。
⇒ **中途失敗 = 前面的東西已經在庫裡了**,不會因為後面炸而一起退回。

**③ 重跑從失敗那支續跑,已記帳的一支都不重跑**
原封再推:`Applying migration` 出現 **1** 次、帳本仍 **54**。
⇒ 🔴 **「不帶 `IF NOT EXISTS` 的 migration 重跑會不會炸」的答案是:不會** —— 它根本不會被再執行到。

**④ 一支跑到一半失敗 ⇒ 整支回滾,不留半成品**
構造(`CREATE TABLE` → `CREATE INDEX` → `SELECT 1/0`):那張表**不存在**(0),
而前一支建的表**在**(1,**正向對照** —— 證明這把尺量得到「存在」)。
⇒ 失敗的 migration 不留殘留 ⇒ 重跑不會撞到自己上一次的半成品。

**⑤ 帳本裡有一支本機目錄沒有的版本 ⇒ 整發拒絕、一支都不推(fail-closed)**
```
Remote migration versions not found in local migrations directory.
修復(已彩排,rc=0):supabase migration repair --status reverted <version> --db-url <本機>
```
📎 與 memory `reference_quote-repo-migration-ledger-desync`(報價單 repo 本地 146 檔 vs ledger 160 筆)
**是同一個機制** —— 那條現在有可重跑的量法了。

**⑥ 從零重放全部歷史【這條路不通】**
`db push --include-all` 到空庫在第 55 支就炸(缺 `product_fitments_effective`)。
⇒ 要彩排「推 N 支上去」,做法是**只把那 N 支放進一個乾淨目錄**,前置表逐字從 repo 的 migration 取(見 §2)。

**🔴 兩件本節【沒有】驗到的(不要當成已驗)**
```
· #628「記帳被拒」：本機你是 superuser ⇒ 帳本 INSERT 當然過。**對它零判別力。**
· 你彩排的是【已 commit 的那份】。主樹工作檔可能是別人未 commit 的 WIP
  —— 2026-08-18 實例：同一支 dev 上 205 行、主樹 287 行，差的那段有一個 trigger 函式。
  ⇒ **先 `git show dev:<path> | wc -l` 跟工作檔對一次**，否則你會把「那份沒有那段」報成「apply 少建了東西」。
```

## 5. ⚠️ 本機效度限制(必讀,否則會下錯結論)

🔴 **`pg_trgm` 在 macOS 對中文抽零 trigram**(memory `reference_pg-trgm-cjk-zero-on-macos-libc`)。
**2026-08-16 本機實測**:
```
extensions.show_trgm('abcdef')  ⇒ 7      ← 正向對照
extensions.show_trgm('王小明')  ⇒ 0      ← 抽零,實錘成立
```
**但適用範圍要分清楚(2026-08-16 E 窗實測後縮小)**:
| 查詢形狀 | 抽零的後果 |
|---|---|
| trgm 相似度運算子(`%` / `<%` / `similarity()`) | 🔴 **正確性壞掉** —— 本機結果不可信 |
| `LIKE '%…%'`(trgm GIN 只當索引加速) | ✅ **只是走全表掃,結果仍正確** |

**實測佐證**:`#525` 三軸全走 `LIKE … ESCAPE '\'`,而 `admin_search_customers('王小明',100)` **正確回 1 筆**,
即使 `show_trgm('王小明')` 是 0。
⇒ **「斷言索引真的被用到」(EXPLAIN 類)在本機無判別力;「斷言索引存在且是 trgm」不受影響。**

## 6. 收攤(逐 PID 驗,不看指令回傳)

```bash
pgrep -f "postgrest .*prest.conf" | while read p; do kill "$p"; done
pg_ctl -D /tmp/pgprobe/data stop -m fast
# 🔴 驗【世界的狀態】不是【動作的回傳值】
pgrep -f "postgrest .*prest.conf" | wc -l     # 期望 0
pgrep -f "postgres.*55501"        | wc -l     # 期望 0
curl -s -m 2 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3999/ # 期望 000(連不上)
rm -rf /tmp/pgprobe && test -d /tmp/pgprobe && echo "🔴 沒刪掉" || echo "✅ 已刪"
git -C <你的 worktree> status --porcelain --untracked-files=all   # 期望零行
```

---

**維護**:本檔由實跑產生。**改它之前先跑一次** —— 指令過期比沒有 runbook 更糟。
