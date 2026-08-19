# E8-B · 報價單【正式庫】唯讀實查 —— B0 剩下那一半關掉了

> 落檔 2026-08-19T13:30 CST(`date` 實跑) · 窗 **W5**(socket `pcm-website-v2-36`)
> **全部是 `SELECT`。零寫入、零 apply、零 `db push`、沒有碰任何 `.env*`。**
> 🔴 **這一步會不會動到報價單那邊:【讀了它,沒有動它】。** 檔案異動只發生在 `pcm-website-v2` 的 `docs/`。

---

## §0 為什麼這一份現在才出現(不是沒人想查,是沒人查得到)

`docs/specs/2026-08-16-m4b-e8b-b1-spec.md` §5 逐字寫著:

> 🔴🔴 **而【通了】不等於【你的 session 用得到】—— 這一格我量到了,答案是「用不到」**
> ⇒ **MCP 伺服器是在 session 啟動時載入的;註冊發生在 session 開始之後 ⇒ 已經在跑的窗看不到那組工具。**
> ⇒ **要用它的人:開一個新 session,或重啟現有的。**

**⇒ 本窗是那之後才開的 session ⇒ `mcp__supabase-quote__*` 這組工具在我手上是活的。**
量法(可複驗):`ToolSearch "select:mcp__supabase-quote__execute_sql"` ⇒ **命中,schema 載入成功**。
📌 **所以這份的價值不在「我很認真」,在【我是第一個看得見那組工具的窗】。**
⚠️ 而**下一個窗只要是新開的 session 就同樣看得見** —— 這不是我的特權,是一個時間差。

---

## §1 結果(四段,逐段附量法與射程)

### 1.1 ✅ 2FA 三個值 —— **`plan v4 §7-3` 那個條件式缺口:條件【不成立】**

`plan v4 §7-3` 逐字:「**若複查非零 ⇒ 本線範圍必須當場擴張,不得照本 plan 往下做。**」

```sql
select (select require_2fa from public.auth_state limit 1) as require_2fa,
       (select count(*) from public.totp_devices)   as totp_devices_rows,
       (select count(*) from public.recovery_codes) as recovery_codes_rows,
       (select count(*) from public.auth_state)     as auth_state_rows
```
⇒ `require_2fa = false` / `totp_devices = 0` / `recovery_codes = 0` / `auth_state = 1`

🔴 **口徑升級,而升的是【哪一側】不是【數字】**:這三個值 `STATUS.md` 早就寫著,
而它引的是 memory `project_quote-2fa-deployed-but-dormant`(**repo 側 / 轉述**)。
**本次是 production 側實查** ⇒ `plan v4 §7-3` 那句「本輪沒有複查現值 ⇒ B0 第 2 項」**可以關掉**。

⚠️ **射程**:這是 2026-08-19T13:30 的值。**它描述【世界的狀態】** ⇒ 有人在報價單後台綁一次 TOTP
就變假,而**檔不會改、測試不會紅**。引用必帶時點;要現值 ⇒ 重跑上面那段 SQL。

### 1.2 ✅ Supabase Auth **有開,而且有兩個真帳號** —— `plan v4 §7-2` 那條關掉

`plan v4 §7-2` 逐字:「**D0-a 甲案沒有查證** —— 我沒確認那個 Supabase 專案有開 Auth。**「推薦」不等於「可行」。**」

```sql
select count(*) from auth.users            ⇒ 2
```
⇒ **Auth schema 存在、查得動、有 2 列** ⇒ 甲案的前提**成立**(而不是「看起來成立」)。

### 1.3 ✅🔴 B1-c seed 的那道 `0.3` 斷言 —— **提前跑了,而且它會過**

`docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:112-113` 寫死兩顆 uuid,
`:289` 那道斷言要求「uuid **與 email 成對**」都存在於 `auth.users`。
**那道斷言原本只有 apply 當下才跑得到 —— 而 apply 是不可逆的那一刻。**

| 世界 | 查的東西 | 結果 |
|---|---|---|
| 應該成立 | `f5fb22ee…533` ↔ `sean@pcmmotorsports.com` | **1** ✅ |
| 應該成立 | `63f0e9c6…0e2f` ↔ `shopee1@partscheaper.net` | **1** ✅ |
| 🔴 **負向對照** | 兩顆 uuid 與 email **對調** | **0** ✅ 尺會印壞消息 |
| 🔴 **負向對照** | 佔位符 uuid `00000000-…-0001` | **0** ✅ |

📌 **兩發負向對照是這一格的重點,不是附錄** —— 只跑正向的話,「全部回 1」與
「這把尺對什麼都回 1」在輸出上長得一模一樣。

⚠️ **射程(草稿 `:73-86` 自己寫的殘餘風險,原樣成立、本次沒有解掉)**:
這證的是「**這顆 uuid 今天屬於這個 email**」,證不到「**這個 email 屬於誰**」。
帳號被改 email 或密碼交給別人 ⇒ **uuid 沒變 ⇒ 這幾道斷言全都還是綠的。**

### 1.4 🔴 ledger 失同步 —— **仍然是真的,而形狀比想像窄:是【版本號】不是【schema】**

`b1-spec §5` 引的禁令理由(「本地 146 檔 vs 雲端 160 筆」)早已過期。**現況實測**:

```
雲端 ledger  supabase_migrations.schema_migrations  ⇒ 16 筆
本地檔       ls supabase/migrations/*.sql            ⇒ 16 檔（repo HEAD 1149e05）
版本號交集   ⇒ 12   雲端獨有 ⇒ 4   本地獨有 ⇒ 4
```
**而那 4 對【檔名逐一對得起來】**:

| 本地版本號 | 雲端版本號 | 同一個 name |
|---|---|---|
| `20260730120000` | `20260730043608` | `eazigrip_shopee_knob_comment` |
| `20260730150000` | `20260730055209` | `akrapovic_shopee_knob_comment` |
| `20260730160000` | `20260730055334` | `ebc_pricing_knobs` |
| `20260812150000` | `20260812091058` | `supplier_freeze_stage1` |

⇒ **`b1-spec §5` 預言的那件事已經發生過 4 次**(逐字:「MCP `apply_migration` 自動生成時間戳、
與手工命名檔會再分歧」)。**禁 `supabase db push` 的結論因此更硬,不是更鬆** ——
那 4 支在雲端 ledger 裡不存在 ⇒ **push 會把它們當成沒套過,再套一次。**

🔴🔴 **而【內容是否一致】我沒有證明,不要讀成我證明了**:
雲端 `statements` 去空白後長度 `159 / 1263 / 3799 / 4442`,
本地同名檔去空白後長度 `1256 / 3646 / 6597 / 19387` ⇒ **每一對都差很多**。
**最合理的解釋是雲端存的是剝掉註解之後的版本**(這幾支是 PCM 風格的重註解檔),
**而我沒有驗證那個解釋** ⇒ 這一格的誠實寫法是:
**「檔名 4/4 配對成功;內容一致性【未確認】,缺的那道檢查 = 把雲端 `statements` 取回來逐支比對。」**

---

## §2 這一份【沒有】做的事(寫下來,免得被讀成做了)

```
· 沒有 apply 任何東西、沒有 db push、沒有建表、沒有 seed
· 沒有動報價單 repo 的任何一個檔（該 repo 工作樹 porcelain 我沒有改）
· 沒有讀 .env*、沒有取得或轉貼任何金鑰
· 沒有查「那兩個 email 各自屬於誰」（見 1.3 射程；那是 auth.users 稽核,不是這裡）
· 沒有解掉 plan §9 的 Q1/Q2/Q3（那三題是 Vercel env 事實,不在 DB 裡,查不到）
```
🔴 **最後一條要特別講**:本次解掉的是 **B0/B1 的【DB 側】前置**。
**而擋住 B5 動工的 `Q1/Q2/Q3` 一格都沒有動到** —— 它們在 Vercel,不在 Postgres。
⇒ **「DB 通了」不得被讀成「E8-B 可以往下做了」。兩個不同的閘。**

---

## §3 因此改變了什麼(給排程的人)

| 原本的話 | 現在 |
|---|---|
| `plan v4 §7-2`「D0-a 甲案沒有查證」 | ✅ 關掉(1.2) |
| `plan v4 §7-3`「本輪沒有複查現值 ⇒ B0 第 2 項」 | ✅ 關掉,且**條件不成立 ⇒ 本線範圍不擴張**(1.1) |
| `G5-005` B0 列「只剩 §5③ 的 production 那一半」 | ✅ **版本號那一半關掉**;內容那一半仍開(1.4) |
| `G5-005` B1 列「B1-b/B1-c 走 MCP 那條路【未查】」 | ✅ 通道**在新開的 session 裡是活的**;而 **apply 仍要過鐵則 12 + Sean**(§0) |
| B1-c seed 的 `0.3` 斷言「只有 apply 當下看得到」 | ✅ **提前驗過,會過**(1.3) |

🔴 **而排程上真正的意思只有一句**:
**B1 的「不知道會不會炸」變成「知道它會過」,而「要不要炸下去」還是 Sean 的動作。**

---

## §4 追加(同一輪,13:4x)—— `G5-005 §二 #6`「等 prod access 才驗得了的四條」

那一列逐字:「`apply_migration` 走哪個角色 / `SET ROLE` 可達性當天重跑 / 正式庫既有 ADP 與欄級授權 /
台帳與 SQL 同不同交易」。**前三條是唯讀,現在就查得到;第四條不行**(要真的套一次才看得到)。

### 4.1 MCP 這條通道跑在哪個角色底下

```sql
select current_user, session_user, current_setting('is_superuser'), rolsuper, rolbypassrls, … 
```
| 欄 | 值 |
|---|---|
| `current_user` / `session_user` | **`postgres`** |
| `is_superuser` / `rolsuper` | **`off` / `false`** ⇒ 🔴 **不是 superuser** |
| `rolbypassrls` | **`true`** |
| `rolcreaterole` / `rolcreatedb` | `true` / `true` |
| 是哪些角色的成員 | `anon, authenticated, authenticator, dealer_price_reader, pcm_audit_ro, pcm_reparse_owner, pg_create_subscription, pg_monitor, pg_read_all_data, pg_signal_backend, service_role, supabase_privileged_role` |

### 4.2 🔴🔴 **而 `rolbypassrls=true` 這一格,是一個會讓 B1 驗收【全綠而無效】的量具陷阱**

**任何在這條通道上跑的「RLS 有沒有擋住 anon」斷言,若沒有明確 `SET LOCAL ROLE`,
量的都是 `postgres`,而 `postgres` 繞過 RLS ⇒ 它【看得到所有東西】⇒ 斷言會通過,而它什麼都沒證明。**

📌 母題(`docs/patterns/guard-and-instrument-traps.md`):**錯的那次和對的那次長得一樣。**

✅ **而逃生門在,我量了它會動**(`G5-005 §二 #6` 的「`SET ROLE` 可達性當天重跑」⇒ **今天可達**):
```sql
begin; set local role anon;
  select current_user, (select rolbypassrls from pg_roles where rolname = current_user);
rollback;
⇒ current_user = 'anon'   bypassrls = false      ← 換得過去,而且特權真的掉了
```
**兩個世界分得開**(不 `SET ROLE` ⇒ `postgres`/`true`;`SET LOCAL ROLE anon` ⇒ `anon`/`false`)
⇒ 這把尺**有判別力**,不是「怎麼跑都印同一句」。

🔴 **⇒ 寫進 B1 apply 當天的硬規則**:
**每一道「anon / authenticated 應該被擋」的斷言,都要包在 `begin; set local role <那個角色>; … rollback;` 裡。
沒有 `SET LOCAL ROLE` 的那種斷言,一律當作【沒跑過】,不是【通過】。**
⚠️ **射程**:我只驗了 `anon` 這一個角色、一個交易、一個時點。`authenticated` 與 `service_role` 沒單獨驗。

### 4.3 ADP(預設授權)—— **新表出生時拿到什麼,取決於【是誰建的】**

`pg_default_acl` 在 `public` schema 上有**兩個不同的 grantor**,而它們給的東西不一樣:

```
grantor = postgres         (r 表) ⇒ {postgres, service_role}                    ← anon / authenticated 【沒有】
grantor = supabase_admin   (r 表) ⇒ {postgres, anon, authenticated, service_role} ← anon / authenticated 【有】
```
**而 §4.1 量到 MCP 跑在 `postgres` 底下** ⇒ **經這條通道建的新表,不會自動長出 `anon` / `authenticated` 授權。**

🔴 **這對 B1「ACL deny-all」是好消息,而它【不是可以省掉 REVOKE 的理由】** ——
```
① 這是「今天的 ADP 長這樣」,不是「機制保證」。ADP 是資料、可以被改。
② 換一條管道(dashboard SQL Editor / 別的角色 / 未來某支 migration 用 SECURITY DEFINER 建物件)
   ⇒ 命中的可能是 supabase_admin 那一列 ⇒ anon 當場長出全權
③ CLAUDE.md 路由表指的 docs/patterns/revoking-function-execute-in-supabase.md
   逐字:「新物件出生就自帶 anon 權限、repo 內零 GRANT 字面可掃、三綠不紅」
⇒ ⇒ **B1 的兩道 REVOKE 照原樣保留。本節只是說明【今天為什麼還沒出事】,不是說可以不做。**
```

### 4.4 ❌ 第四條查不到:**「台帳與 SQL 同不同交易」**

`supabase_migrations.schema_migrations` 那一列與 DDL 本身**是不是同一個交易**,
**只有真的套一次才看得到** ⇒ 本輪**沒有查、也不能查**(要查就得寫進去)。
⇒ 它仍留在 `G5-005 §二 #6`,**不要因為本節關掉了三條就把整列劃掉。**
