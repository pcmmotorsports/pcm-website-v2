# 報價單庫（`pcm-quote-v2`）稽核 —— **帳號一到就開跑清單**

- **狀態**：⏸ **等 Sean 建帳號**（`E-674b` + **`E-674c` 的修正版**；他今晚貼過兩次，撞 `pgbouncer` 那個坑）
- **為什麼有這份**：那半是**唯一還完全沒查過的**。帳號一到，下一個人（或我）**照這份直接跑，不用重新想**。
- ⚠️ **「Sean 在電腦前」≠「帳號已經好了」** —— 開跑前先確認憑證檔真的存在且連得上（步驟 0）。

---

## 0. 開跑前（**三行，任一不過就停**）

```bash
test -f ~/.pcm-quote-readonly-db && echo "cred present" || echo "STOP: 憑證檔不存在"
URL=$(grep -m1 '^PCM_QUOTE_AUDIT_RO_URL=' ~/.pcm-quote-readonly-db | cut -d= -f2-)
psql "$URL" -X -A -t -c "SELECT current_user, session_user;"
```

🔴 **`current_user` 與 `session_user` 必須【相同】** —— 不同代表走了 `SET ROLE`，
**那量不出這個角色真正的權限**（`E-674c` §3.1／memory `reference_set-role-cannot-measure-target-role-escalation`）。
🔴 **絕不 `source` 憑證檔**，只 `grep` 單顆（非 ASCII 變數名會讓 zsh 把整行印進終端 —— 2026-08-02 真的外洩過一把 secret）。

**第二道正向對照**（沒有它，後面每個「查無」都不算數）：

```sql
SELECT count(*) FROM pg_catalog.pg_attribute WHERE attnum > 0;   -- 必須非 0
```

⚠️ **一律用 `pg_catalog`，絕不用 `information_schema`** —— 後者只回「你有權限的東西」，
而稽核帳號**故意沒有權限** ⇒ **它會系統性回 0，產出一份漂亮的假報告。**

---

## 1. 第一批查詢（**照這個順序，前三個決定後面要不要繼續**）

| # | 查什麼 | 預期形狀 | 不符代表什麼 |
|---|---|---|---|
| **1** | 這是不是**報價單庫**（不是 A 庫） | 專案識別（表名集合明顯不同於 A 庫的 `orders`／`customers`／`payment_*`） | 🔴 **貼錯庫，立刻停** —— 兩個專案畫面長得一樣，2026-08-16 已經貼錯過一次 |
| **2** | `pg_default_acl`（那把預設授權槍） | `public` 的 `r`／`S`／`f` 各若干筆，grantee 含 `anon`／`authenticated` | 若**沒有** ⇒ 這個專案較新、已套用新預設；那 A 庫的 A2 結論**不能直接搬過來** |
| **3** | `anon`／`authenticated` 可 SELECT 的關聯（跨所有非系統 schema） | 型錄類應該有、**客戶／報價資料應該沒有** | 命中客戶資料 = **本輪最高優先**，立刻停下報告 |
| 4 | SECURITY DEFINER 函式中 `anon` 可 EXECUTE 的 | **期望 0** | 非 0 = 同 `#525` 那個洞的形狀 |
| 5 | **逐欄** `has_column_privilege`（表級為 false 的那些） | 白名單式、且**不含價格／成本欄** | 🔴 A 庫的教訓：表級量法對欄級**會少報** |
| 6 | 9 支 view 的 `security_invoker` | 期望全 `true` | `false` = 繞過底表 RLS |
| 7 | `pg_db_role_setting` 的 `statement_timeout` | 分角色記下來 | A 庫是 `anon` 3s／`authenticated` 8s —— **報價單庫不一定一樣，不要照抄** |

**查詢本體**：直接沿用 `docs/security/2026-08-16-external-exposure-audit.md` §3「量法（可重跑）」那幾段，
**一個字都不用改** —— 那些查詢**不綁任何具體表名或 schema 名**。

---

## 2. 🔴 開跑前必須先寫下的**預測**（否則查到什麼都會覺得「本來就是這樣」）

**照 `E-678` 的做法：先發預測，再跑。** 至少寫下這四條的預期值：

1. `public` 裡 `anon` 可 SELECT 的關聯數 = ?
2. `anon` 可 EXECUTE 的 SECDEF 函式數 = ?（我預期 0）
3. `pg_default_acl` 在 `public` 有幾筆、grantee 含哪些角色 = ?
4. 有沒有任何「報價／客戶」語意的表對 `anon` 開著 = ?（我預期沒有）

⇒ **猜錯的那幾條才是這一輪真正的收穫。**

---

## 3. 不要重犯的四件（A 庫那輪的實帳）

1. **`grep` 的 `\b` 在這台機器上靜默回 0**（是 ugrep）⇒ **每個 pattern 先跑一次保證命中的正向對照。**
2. **零命中要附 pattern 與分母**，「查無」不等於「查過」。
3. **`has_table_privilege` 看不到欄級授權**（少報）、**也不管 schema `USAGE`**（多報）⇒ 三個盲點方向不同，不要當成「都偏保守」。
4. **快速連打會觸發節流** ⇒ 若走 HTTP 探測，每發間隔 3 秒，**並把控制組放在最後一發**確認量具還活著。

---

## 4. 產出落點

- **結論** → 新檔 `docs/security/<日期>-quote-db-external-exposure-audit.md`（**不要**混進 A 庫那份）
- **工具／SQL** → 若長出可重用的，**判斷該不該進 repo**，不要只活在信箱
- 🔴 **口徑**：A 庫那份的每一條結論**都只對 A 庫成立**。
  兩份之間**不要互相引用數字**，只引用**方法**。
