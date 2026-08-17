# Plan:收掉「新表出生自帶 `anon` TRUNCATE」的預設授權(`E683-1`)—— 鐵則 8 + 12③,**等 Sean 批**

- **提出**:E 窗(資安稽核,唯讀)　**日期**:2026-08-17　**狀態**:🔴 **尚未批准,未動任何 code**
- **finding 正本**:`docs/security/2026-08-16-external-exposure-audit.md` `E683-1` + **§7f(先例)**
- 🔴 **命中**:鐵則 **12③**(DB 結構/授權)+ 鐵則 **8**。

---

## 🔴 0. 先講三句,免得被讀成急件

1. **這不急,今晚不用動。** 既有 46 張表的 `anon` 寫權限**實測全為 0**;`anon` 也**進不到**能用這個權限的位置(外部只能經 PostgREST)。
2. **這【不是】Sean 關掉的那個開關。** 他關掉「Automatically expose new tables」是對的,但**那只管「新表會不會自動可讀」**;本 plan 管的是**「新表會不會自動被授予 `TRUNCATE`」**。**關掉之後 `anon=Dxtm` 仍在(當天實測)。**
3. 本 plan 的價值是**把一道現在靠「每個人都記得」的防線,換成一行 checked-in 的宣告**。

---

## 1. 改什麼

**一支 migration,對 `public` schema 的 `TABLES` 預設授權,收掉 `anon` 與 `authenticated`**:
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
```
🔴 **只動 `FOR ROLE postgres` 那一份** —— 那是**我們自己 migration 建表時**套用的那組。
⚠️ `FOR ROLE supabase_admin` 那一份**動不了**(`postgres` 非 superuser,實測 `rolsuper=f`;同 `20260723120000…:16-21` 已記載的理由)⇒ **plan 不要留一條做不到的 SQL 給下一個人試。**

**現況 vs 目標(實測)**:
```
現在（網站庫）  postgres → {postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}
                                              ^^^^ D = TRUNCATE（RLS 管不到）
目標           postgres → {postgres=arwdDxtm, service_role=arwdDxtm}
                          ＝ 報價單庫【現在就是這個樣子】（實測）
```

**驗收(migration 自帶 fail-closed 斷言,照本 repo 既有樣板)**:
```sql
-- 套用後：postgres 那份預設 ACL 不得再出現 anon / authenticated
DO $$ DECLARE v int; BEGIN
  SELECT count(*) INTO v FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace,
    LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname='public' AND d.defaclobjtype='r'
     AND d.defaclrole='postgres'::regrole
     AND a.grantee IN ('anon'::regrole,'authenticated'::regrole);
  IF v <> 0 THEN RAISE EXCEPTION 'E683:postgres 預設 ACL 仍含 anon/authenticated（% 筆）', v; END IF;
END $$;
```
🔴 **這個斷言要有反向對照才算數**:套用**前**跑同一段**必須 RAISE**(現況 `v > 0`)。**沒表演過兩個世界的斷言不算守門。**

---

## 2. 為什麼

1. **`TRUNCATE` 不受 RLS 管** ⇒ 那 71/46 張「RLS 開著」的表,**RLS 擋不住這個權限**。
2. **repo 內零字面可掃**:那個授權**沒有 `GRANT` 語句** ⇒ code review 看不到、`grep` 找不到、三綠不紅(`E683-1` 原文)。⇒ **改成顯式宣告之後,它變成可 grep 的。**
3. ✅ **有「對的樣子」可對照**:報價單庫**現在就是目標狀態**(實測)。

### 🔴 2b. 成因調查:**narrowed but not closed**(a4 要我先試著關掉這格)

| 我試的方向 | 結果 |
|---|---|
| 報價單 repo 有沒有 `ALTER DEFAULT PRIVILEGES` | **有,20 處**;但 `TABLES` 那些是 **`GRANT`,且在 `20260730000000_baseline_schema.sql`(pg_dump 型 baseline)** ⇒ **它記錄狀態,不證明誰設的** |
| 網站庫 repo 有沒有 | 🔴 **11 個命中【全部是註解】(`--` 開頭),零實際語句**(正向對照:同目錄 `GRANT` 命中 **149/179** 檔 ⇒ grep 範圍正確) |
| PG 版本差異 | **兩庫皆 PostgreSQL 17.6** ⇒ **不是版本差** |
| 專案年齡代理 | ❌ **不可用** —— 報價單最舊 migration 是 baseline dump,專案實際更早 |

⇒ **結論:差異來自【兩個 repo 的 migration code 之外】**(專案 provisioning,或 baseline 之前的人工動作)。**究竟哪一個 = 未確認**,上述四個方向已試完。

🔴 **而這一格【不擋本 plan】,理由**:不論成因為何,**我們要做的是「顯式宣告成目標狀態」**,而不是「複製報價單庫怎麼變成那樣的」。**顯式宣告比繼承平台預設更好** —— 它把一個看不見的狀態變成 checked-in 的字面。

---

## 3. 影響面

| 面 | 影響 |
|---|---|
| **既有 46 張表** | 🔴 **零影響** —— `ALTER DEFAULT PRIVILEGES` **只作用於【之後】建的物件**。既有的要另外 `REVOKE`,**而它們的 `anon` 寫權限實測本來就是 0** ⇒ **不需要,也不在本 plan 範圍**。 |
| **之後建的表** | `anon` / `authenticated` **不再自動拿到 `Dxtm`**。⇒ 🔴 **若哪張新表【真的需要】給 anon 讀,要顯式 `GRANT SELECT`** —— 而**本 repo 149/179 支 migration 本來就在顯式 `GRANT`**(實測)⇒ **現行寫法不受影響。** |
| **`supabase_admin` 那份** | **動不了、不動**(§1)⇒ **由 `supabase_admin` 建的物件仍會自帶** ⇒ **本 plan 不宣稱把這條路關死。** |
| **app / 金流 / 前台** | **零影響**(不動任何既有物件的權限)。 |

---

## 4. Rollback

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
```
⚠️ **回退後不會自動修復「回退期間建的表」** —— 那些表出生時沒拿到預設授權,**回退不會補發給它們**。⇒ 若真要回退,**同時要盤點回退窗內新建的表**。
✅ **但風險極低**:回退窗內若沒建新表,回退是完全無痕的。

---

## 5. 這份 plan **沒有**涵蓋

- **`supabase_admin` grantor 那一份**(動不了,§1)。
- **既有 46 張表的殘留授權**(實測為 0,不需要)。
- **函式的 `EXECUTE` 預設授權** —— `E683-1` 原文同時提到函式,而**本 plan 只處理 TABLES**。函式那半**本 repo 已有既有紀律**(多支 migration 顯式四方 `REVOKE`,見那 11 處註解)⇒ **另議,不混進來。**
- **欄級授權**(另一軸)。

## 6. 口徑

兩庫 `pg_default_acl`、PG 版本、既有 46 張 `anon` 寫權限 = **2026-08-17 `pcm_audit_ro` 唯讀實測**。兩 repo 的 `ALTER DEFAULT PRIVILEGES` 字面 = **當場 grep**(網站庫含正向對照 149/179)。**「兩庫為何不同」= 未確認,四個方向已試完並列於 §2b。** **本 plan 未實作、未執行任何一步。**
