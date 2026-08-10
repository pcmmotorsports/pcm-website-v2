# DB 角色成員漂移偵測(`payment_confirmer`)

> **用途**:偵測**平台側**(Supabase)對 `payment_confirmer` 成員關係的變動。
> 這不是假設題:2026-08-11 五支 migration 首推,就是被 OP3 的成員前提閘擋下 ——
> 正式庫的 `payment_confirmer` 有一筆**我方 migration 從未種過**的成員(`postgres`,grantor `supabase_admin`)。
>
> ## 🔴 更新紀律(最重要的一段,先讀)
> **下方「釘住的期望值」只有 Sean 拍板才准改。**
> 改它 = **承認正式庫的角色成員狀態變了**,而那件事**必須先有人解釋為什麼變**。
> ⛔ **禁止**因為「查出來不一樣、所以把期望值改成現況」而更新 —— 那不是修好,是**把偵測器關掉**,
> 而且關掉之後一切看起來都正常。這是本機制最可能的死法,寫在最前面。

---

## 1. 釘住的期望值

| 角色 | 期望成員集合 |
|---|---|
| `public` / `payment_confirmer` | **恰一列**:`member = postgres`、`grantor = supabase_admin` |

**這筆為什麼被接受**(不是因為「平台種的」——來源推不出安全性):
`postgres` 是相關 SECDEF 函式的 **owner**,owner 恆有 grant option、可自行把 EXECUTE 授回來
⇒ 拿掉這筆成員資格,`postgres` 對那些函式的可達性**不會變** ⇒ 它**沒有擴大可達集合**。
逐字論證見 `supabase/migrations/20260810220000_…l5b0s_….sql` 的成員閘註解與 `20260810160000`(OP3)。

## 2. 偵測 SQL(唯讀;貼 Supabase SQL Editor 直接跑)

```sql
with expected(member, grantor) as (values ('postgres','supabase_admin')),
     role_oid as (select pg_catalog.to_regrole('payment_confirmer') as r),
     actual as (
       select pg_catalog.pg_get_userbyid(am.member)  as member,
              pg_catalog.pg_get_userbyid(am.grantor) as grantor,
              am.admin_option
         from pg_catalog.pg_auth_members am, role_oid o
        where o.r is not null and am.roleid = o.r)
select (select r is null from role_oid) as role_missing,
       (select count(*) from actual)    as actual_rows,
       ( (select r is null from role_oid)
         or exists (select member,grantor from actual   except select member,grantor from expected)
         or exists (select member,grantor from expected except select member,grantor from actual)
       ) as drift,
       coalesce((select string_agg(member||'@'||grantor||
                case when admin_option then ' [admin]' else '' end, ', ' order by member)
                 from actual),'(零成員)') as actual_detail;
```

**判讀**:`drift = f` ⇒ 過,繼續。`drift = t` ⇒ **停下人工判斷**,`actual_detail` 就是現況。

### 2.1 三個刻意的設計(改這條 SQL 前先讀)
- **對稱差(兩個 `except` 都要)**:不只抓「多了成員」,也抓「**期望那列不見了**」。
  後者會讓兩支 migration 的白名單變成**空轉**(放行一個不存在的東西),同樣是平台側變動。
- **`to_regrole` 不用 `::regrole`**:角色若被刪,`::regrole` 會 **42704 整句紅**,
  分不出「角色沒了」與「SQL 壞了」;`to_regrole` 會明確回 `role_missing = t`。
- **`admin_option` 只顯示、不納入 `drift` 判定**:它只決定能不能再轉授,`false` 是**更小**的權限面
  ⇒ 納入會對「風險變小」發假紅(沿用 OP3 已拍板的同一理由)。

## 3. 誰跑、什麼時候跑

| | |
|---|---|
| **誰** | **主視窗**(唯讀通道;施工窗碰不到正式 DSN) |
| **時機** | **① apply 前**(與既有 count 類前置同一格)**② apply 後**(與 prosrc 指紋 read-back 同一格) |
| **落點** | 排進 apply 檢查表範本的「前置」與「read-back」兩節各一列 |

🔴 **刻意不建 cron、不排程**:排程要有人維護、會被複製、在多視窗環境會長出第二份
(見 memory `feedback_duplicate-cron-double-fires-external-writes`);
而本查詢的價值時點**就是 apply 那一刻**(平台變動最可能在那前後被發現)⇒ **綁流程比綁時間準**。

## 4. 誠實邊界(不宣稱擋住的)
- ⚠️ **兩次 apply 之間的漂移偵測不到** —— 這是上面那個取捨的**代價,不是遺漏**。
  要涵蓋那段就得排程,屆時重估 §3 那條。
- 本查詢**只看 `payment_confirmer` 一個角色**;其他角色的成員漂移不在射程內。
- 它是**偵測**,不是防護:查出 `drift = t` 時,變動**已經發生**了。

## 5. 受益面(兩支不對等,別混講)
- **OP3(`20260810160000`,`confirm_order_payment`)**:它**有**執行期 `P2B36` 兩層
  ⇒ 成員漂移最終會以「刷卡全掛」現形。本查詢的價值 = **把發現時點從「第一筆刷卡」提前到「apply 當下」**。
- 🔴 **L5b-0-s(`20260810220000`,四支掃描 RPC)**:**函式體內零 actor 檢查、沒有任何執行期訊號**
  ⇒ 成員漂移在這片是**完全無聲**的(照樣跑、照樣綠、不會有人知道)。
  **它才是本機制的主要受益者**,不是 OP3。

## 6. 基線紀錄

| 日期 | 跑的人 | `role_missing` | `actual_rows` | `drift` | `actual_detail` |
|---|---|---|---|---|---|
| 2026-08-11 | 主視窗(正式庫唯讀) | `f` | `1` | **`false`** | `postgres@supabase_admin [admin]` |

> 述詞邏輯另在本機以 `initdb -U supabase_admin` 重現正式站形狀後四狀態實測
> (角色不存在 / 零成員 / 正式站形狀 / 多一成員 ⇒ `t / t / f / t`,四格皆如預期)。
> 為什麼要換 bootstrap superuser 才重現得出來:見 memory
> `reference_pg-grantor-is-bootstrap-superuser-supabase-admin`(超級使用者的 GRANT,
> `grantor` 記的是叢集 bootstrap superuser;本機是 `postgres`、Supabase 是 `supabase_admin`)。
