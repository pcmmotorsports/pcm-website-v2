# 儲存的檢視(saved views · M-4b 片1)—— rollback runbook

> 2026-08-28 建立。來源:`docs/specs/2026-08-25-saved-views-plan.md` `§14-12-i`(交付物)· `§14-28`(實跑)。

## 🔴 檔頭釘死三句,先讀完再往下

```
① 本檔的 down-script 只在【拋棄式 PostgreSQL 17.10】上跑過。
   **正式庫:零次。** 這一句不隨時間放寬 —— 要改它,要有一次正式庫的紀錄貼在這裡。
② 而本 repo 的 rollback 慣例是【寫成註解、手動執行】(Supabase forward-only)。
   2026-08-28 量:222 支 migration,檔名帶 down/rollback/revert = **0**;
   帶 `DROP` 的 146 支裡,**100 支的 DROP 只出現在註解裡**。
   ⇒ 📌 **這不是疏漏,是刻意的決定** —— 但也表示:那些文字跑不跑得起來,沒有人知道。
③ 🔴 **本檔不主張「我們的回退是安全的」。** 它主張的是:
   **這一片的 down 有人跑過一次,而它跑在一個乾淨的空庫上。**
```

## ✅ 本檔裡的每一發指令**都跑過**(2026-08-28 02:15,拋棄式 PG 17.10)

```
認狀態 to_regclass        ⇒ admin_saved_order_views   (期望值相同)
函式支數                  ⇒ 5
RLS 開著                  ⇒ t
policy 數                 ⇒ 0
service_role 有 EXECUTE   ⇒ 4
跑 ② 那四句 REVOKE 之後   ⇒ 0        ← 兩個世界印不同的數
跑 ③ 那四句 GRANT 之後    ⇒ 4
跑 ④ 那段 down 之後       ⇒ to_regclass「不存在」· 函式支數 0
負對照(不存在的函式名)  ⇒ 0
```
📌 **為什麼要釘這一段**:`-c8` 2026-08-28 量到 ——
**寫了指令的數字,下一個人會去跑它;只寫結果的數字,下一個人只能抄它。**
⇒ 而本檔的指令是「跑出來的」不是「寫出來的」,那是兩件事。
🛑 **而這一整段的效度是【空表 · 拋棄式 PG】** —— 見上面檔頭釘的第 ① 條。

## 本檔涵蓋什麼 / **不涵蓋什麼**

| | |
|---|---|
| ✅ 涵蓋 | 四個階段的判斷樹 · 每一步可貼的完整指令 · down-script 逐句 · 重新上線時最容易漏的那一步 |
| ✅ 涵蓋 | 「D 期間寫入的資料怎麼辦」的答案與**它的理由**(其中一條理由曾經是假的,見下) |
| 🛑 **不涵蓋** | **正式庫上的任何一次實跑。** `§14-28` 那支 `.sh` 驗的是「down 跑不跑得起來」,**不是這份分階段流程** |
| ✅ 涵蓋(2026-08-28 02:21 補量)| 有資料之後的 down:**0 / 1,000 / 100,000 列三格都量過**,耗時 18/22/19ms **持平**(DROP TABLE 不掃列)⇒ 而**碼錶自己有正對照**(同樣資料量的 `DELETE FROM` = 15ms vs 54ms ⇒ 證明碼錶會動,持平不是碼錶壞了)|
| 🛑 **不涵蓋** | **正式庫**上帶資料的 rollback。上面那三格在拋棄式 PG、本機磁碟、無其他負載 ⇒ **不是正式環境的數字** |
| 🛑 **不涵蓋** | 前台/後台 app 那一側的回退(那是 Vercel 的事,見 `§14-14`;而該節的「1-2 分鐘」是**印象值不是量測**)|

---

## 四個狀態,先認自己在哪一格

```
A  什麼都沒做                    表不存在 · 四支 RPC 不存在 · app 是舊的
B  migration 套了、app 還是舊的  表在 · RPC 在 · 而沒有任何畫面呼叫它
D  migration 套了、app 也新的    正常運作
   (C = app 新而 migration 沒套 ⇒ **DB-first 之下不會經過這一格**;經過了 = 順序做錯了)
```
**認狀態的指令(可直接貼,兩個世界會印不同的東西):**
```bash
psql "$DATABASE_URL" -Atc "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');"
# 印 admin_saved_order_views ⇒ 在 B 或 D    印 不存在 ⇒ 在 A
```
```bash
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';"
# 期望 5(四支 RPC + touch trigger 那支)。印 0 ⇒ 在 A。印 1-4 ⇒ 🔴 半套, 停下不要繼續
```

---

## ① forward(A → D)

```
1. 套 migration(整支含 BEGIN; / COMMIT;)—— 它自帶斷言,任一條不成立會整支回滾
2. 停在 B,驗一次(下面那三發)
3. 才推 app ⇒ 到 D
```
🔴 **順序不可換。** DB-first 的理由:先推 app 會經過 C(app 呼叫一支不存在的 RPC)⇒ 使用者看到錯誤。

**在 B 驗這三發(每一發都寫死期望值):**
```bash
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';"                 # 期望 5
psql "$DATABASE_URL" -Atc "SELECT relrowsecurity FROM pg_class WHERE oid='public.admin_saved_order_views'::regclass;"  # 期望 t
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='admin_saved_order_views';"  # 期望 0
```

---

## ② 從 D 回退 ⇒ **只推回舊 app。不 drop 表、不 drop RPC。**

```
· 資料留著(不可逆的那一步不做)
· 🔴 而【入口要關掉】—— 這一步 2026-08-28 才補上, 而補它的理由是一句被推翻的話:
  原本寫「留著的代價是 0」⇒ **假的**。回到 B 之後, 四支 SECURITY DEFINER RPC
  對 service_role 仍然開放 ⇒ 那是一個【沒有 UI、沒有主人】的持久讀寫入口。
  📌 **「要不要關入口」與「要不要刪資料」是兩題, 一題可逆一題不可逆。**
     綁在一起, 就會用不可逆那題的謹慎去拖住可逆那題。
```
```sql
-- 關入口(可逆)。貼進 Supabase SQL Editor。
REVOKE EXECUTE ON FUNCTION public.admin_list_saved_order_views(text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_create_saved_order_view(text, text, text, text, boolean, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_delete_saved_order_view(text, bigint, text) FROM service_role;
```
**驗它(兩個世界印不同的東西):**
```bash
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%'
    AND has_function_privilege('service_role', p.oid, 'EXECUTE');"   # 關成功 ⇒ 0 · 沒關到 ⇒ 4
```

---

## 🔴🔴 ②-b 走 ④ 之前必看:**有人正在用後台,`DROP TABLE` 會卡住**

```
2026-08-28 02:21 實測(拋棄式 PG):
  一個連線開著交易在讀那張表 ⇒ 另一個連線跑 down ⇒ **DROP TABLE 拿不到 ACCESS EXCLUSIVE ⇒ 擋在那裡**
  ✅ 而被擋下來之後【表還在】—— 整支交易回滾, 沒有做一半
  ✅ 負對照:沒有人在讀的時候, 同一發 down 過得去(⇒ 這不是「什麼都擋」)
```
🔴 **維運上的意思**:半夜沒人用的時候跑,它 20ms 就結束;而**上班時間有人開著後台,它會掛在那裡**。
⇒ 而 `psql` 預設**沒有 `lock_timeout`** ⇒ 它會**無限等**,畫面上就是一個不動的游標。
✅ **一律先設上限,不要裸跑**:
```sql
SET lock_timeout = '5s';   -- 貼在 ④ 那段 BEGIN; 之前
```
⇒ 逾時的訊息會明說是鎖的問題;**沒設的話你只會看到它不動,而分不出「很慢」與「卡住」。**

## 🔴 ③ 重新上線時最容易漏的那一步(它會偷走你半小時)

```
若曾經走過 ② ⇒ **重新上線前要先把 EXECUTE 給回去**。
漏了的症狀是【四支全部 permission denied】——
📌 而那看起來像【權限設錯】, **不像【沒部署】** ⇒ 查的人會往完全錯的方向去。
```
```sql
GRANT EXECUTE ON FUNCTION public.admin_list_saved_order_views(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_saved_order_view(text, text, text, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_saved_order_view(text, bigint, text) TO service_role;
```
上面那發驗收 SQL 再跑一次 ⇒ 期望 **4**。

---

## ④ 從 B 回退到 A ⇒ **真要 drop 才走。而它不可逆。**

🛑 **命中鐵則 R3(不可逆)⇒ 停下問 Sean,不由施工窗自己決定。**

```sql
SET lock_timeout = '5s';   -- ⚠️ 見 ②-b:有人在用後台時 DROP TABLE 會卡住, 而裸跑會無限等
BEGIN;
  DROP FUNCTION IF EXISTS public.admin_list_saved_order_views(text);
  DROP FUNCTION IF EXISTS public.admin_create_saved_order_view(text, text, text, text, boolean, text, text);
  DROP FUNCTION IF EXISTS public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text);
  DROP FUNCTION IF EXISTS public.admin_delete_saved_order_view(text, bigint, text);
  DROP TRIGGER  IF EXISTS admin_saved_order_views_set_updated_at ON public.admin_saved_order_views;
  DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at();
  DROP TABLE    IF EXISTS public.admin_saved_order_views;
COMMIT;
```
⚠️ **順序有意義**:先四支 RPC、再 trigger、再 trigger 用的那支函式、**最後才是表**。
🔴 實測依據(`§14-28` RB2):漏掉 `admin_saved_order_views_touch_updated_at()` 那一句 ⇒
**表沒了,而那支函式留在庫裡** —— 一個沒有主人的孤兒物件,而沒有任何東西會提醒你。

**驗它回到 A(而不是只看 rc=0):**
```bash
psql "$DATABASE_URL" -Atc "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');"  # 期望 不存在
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';"                                # 期望 0
```
🔴 **`rc=0` 不等於「回到 down 之前的狀態」** —— 上面那兩發才是。
   (`§14-28` 的 `.sh` 在拋棄式 PG 上比的是三個 schema 快照:`before` / `after-up` / `after-down`,
    該相同的是 before 與 after-down,而 **after-up 必須與它們不同** ——
    少了後面那道,一支根本沒生效的 up 也會印一個很好看的綠。)

---

## ⑤ 「D 期間寫入的檢視資料怎麼辦」⇒ **留著,什麼都不做**

```
✅ 理由二:那是【使用者設定】不是交易資料 ⇒ 留著, 重新上線時它們還在
✅ 理由三:drop 不可逆, 而「留著」的代價已經被 ② 那道 REVOKE 關掉
          ⇒ **兩邊代價不對稱時, 不選不可逆那邊**
❌ 理由一(作廢):~~「回 B 之後舊 app 不呼叫那些 RPC ⇒ 那些列沒有任何人讀得到」~~
   🔴 **那句是假的**(codex F9):回 B 之後四支 RPC 對 service_role 的 EXECUTE 還在 ⇒ 讀得到;
      owner / superuser 也讀得到。
   📌 **結論沒變, 而支撐它的三條理由裡有一條是錯的 —— 錯的那條要劃掉, 不是留著湊數。**
```

## ⚠️ 而有一格本檔**答不出來**,明寫在這裡而不編一個流程

```
🛑 **「D 期間有人建了共用檢視, 回到 B 再回到 D 之後, 那些列還對不對」** —— 未量。
   已知的是「列還在」(理由二/三);**不知道的是**:
   · 期間若 `staff` 有人被停用 ⇒ 他名下的私人檢視在 list 那支底下會消失(設計如此)
     而那與「資料掉了」在畫面上是同一件事 ⇒ **沒有人會知道要去查哪一邊**
   · 期間若換過 `is_manager` ⇒ 共用檢視的可改動範圍跟著變, 而**沒有稽核列記錄那個變化**
     (稽核記的是【檢視被改了】, 不是【誰的權限變了】)
⇒ 這兩格要答, 需要一次帶資料的 rollback 演練 —— **本片沒有做, 也沒有排。**
📌 **一份 runbook 最危險的地方不是它寫錯, 是它把「沒問過的事」寫成一個看起來完整的流程。**
```

---

## 相關

- 規格與實跑:`docs/specs/2026-08-25-saved-views-plan.md` `§14-12-i` / `§14-28`
- down 的自動驗收:`bash docs/specs/2026-08-25-saved-views-rollback-test.sh`(拋棄式 PG,不碰正式庫)
- 拋棄式 PG 怎麼起:`docs/runbooks/throwaway-postgres-for-migration-verification.md`
