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
