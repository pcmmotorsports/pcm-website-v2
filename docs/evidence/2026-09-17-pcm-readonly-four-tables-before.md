# 證據 · 貼板 `20260917010000` 貼【前】的正式庫讀數

> 2026-09-17 · 設計窗。**R2 指出「這些數字目前只有作者的記述,`docs/evidence/` 底下沒有存檔」⇒ 主視窗批了,這是那份存檔。**
> 🟢 **唯讀** —— 這一發只讀 catalog,不改任何東西、不動任何一列。
> 撈的身分:`pcm_readonly`(那把唯讀鑰匙本人)· PostgreSQL 17.6 · `2026-09-17 03:44:10 UTC`。

## 怎麼重跑(命令原文)

```bash
cd /Users/sean_1/pcm-design
bash scripts/readonly-prod-sql.sh docs/evidence/2026-09-17-pcm-readonly-four-tables-before.sql
```
掃錯誤要用行首形狀,**不要用裸 `grep -c ERROR`**(它會把那句提醒自己數進去):
```bash
grep -nE '^psql:.*ERROR|^ERROR:' <輸出>     # 本次實跑 ⇒ 0
```

## 對照表:檔頭宣稱 vs 這一發實撈

| 檔頭宣稱 | 實撈 | |
|---|---|---|
| 四張目標存在 4/4 | 4/4 全 `t` | ✅ |
| 四張表級 SELECT 全 `f` | 全 `f` | ✅ |
| 四張上欄級授權 0 筆 | 0 | ✅ |
| `rolbypassrls = t` | `t`(且 `rolsuper = f`) | ✅ |
| 不是任何角色的成員 | `pg_auth_members` 0 筆 | ✅ |
| 🟢 正對照 `public.orders` = `t` | `t` | ✅ |
| ⚪ 負對照 `public.pcm_incident` = `f` | `f` | ✅ |
| `public` 72 張表 | 72 | ✅ |
| 表級讀不到 11 張 | 11 | ✅ |
| = 9 真的全不給 + 2 給了一半 | 9 張欄級 0 筆 + `supplier_sync_runs` 5 筆 / `pcm_settle_retry_attempts` 4 筆 | ✅ |
| 全庫欄級授權 9 筆,全在不碰的那兩張上 | 5 + 4 = 9,只有那兩張 | ✅ |
| 貼前直接授權 86 筆 | 86 | ✅ |
| 七張的 RLS 7/7 開著 | 7/7 `relrowsecurity = t` | ✅ |

**⇒ 檔頭 13 條帶數字的宣稱,13 條全部對上。**

## 🔴 順手撈到而檔頭沒寫的一件

`pcm_net_exposure_snapshot` **與 `pcm_incident` 與 `pcm_settle_retry_attempts` 的 policy 數都是 0**
—— 也就是說這三張**今天讀得到列, 完全只靠 `rolbypassrls`**(檔頭 `rolbypassrls` 那一段講的正是這個,而它只點名了 `pcm_net_exposure_snapshot`)。
另外四張各有 1-3 條 policy。📌 **不影響本片的結論,而貼完那一步撈 `count(*)` 更要做。**

---

## 原始輸出(逐字,未編輯)

```
分頁顯示已關閉。
=== ① 四張目標:存在? 表級 SELECT? (檔頭宣稱:存在 4/4, 表級全 f) ===
                目標表                 | 存在 | 表級select 
---------------------------------------+------+------------
 public.home_banners                   | t    | f
 public.supplier_inbound_emails        | t    | f
 public.pcm_net_exposure_snapshot      | t    | f
 public.shipment_order_ship_clearances | t    | f
(4 筆資料)

=== ② 四張目標上的欄級授權筆數 (檔頭宣稱:0 筆) ===
 四張上的欄級授權筆數 
----------------------
                    0
(1 筆資料)

=== ③ 角色屬性 + 成員關係 (檔頭宣稱:rolbypassrls=t, pg_auth_members 0 筆) ===
   rolname    | rolbypassrls | rolsuper | rolcanlogin 
--------------+--------------+----------+-------------
 pcm_readonly | t            | f        | t
(1 筆資料)

 pcm_readonly是幾個角色的成員 
------------------------------
                            0
(1 筆資料)

=== ④ 正負對照 (檔頭宣稱:orders=t, pcm_incident=f) ===
         表          | 表級select 
---------------------+------------
 public.orders       | t
 public.pcm_incident | f
(2 筆資料)

=== ⑤ 分母:public 幾張表 / 表級讀不到幾張 (檔頭宣稱:72 張, 讀不到 11 張) ===
 public表總數 | 表級讀不到 
--------------+------------
           72 |         11
(1 筆資料)

=== ⑥ 那 11 張裡, 哪些其實有欄級授權 (檔頭宣稱:9 真的全不給 + 2 給了一半) ===
                       表                       | 欄級授權筆數 
------------------------------------------------+--------------
 supplier_sync_runs                             |            5
 pcm_settle_retry_attempts                      |            4
 dbk_external_id_rename_20260904                |            0
 home_banners                                   |            0
 pcm_definer_searchpath_rollback_20260905100000 |            0
 pcm_definer_searchpath_rollback_20260905110000 |            0
 pcm_incident                                   |            0
 pcm_net_exposure_snapshot                      |            0
 pcm_rls_rollback_20260904270000                |            0
 shipment_order_ship_clearances                 |            0
 supplier_inbound_emails                        |            0
(11 筆資料)

=== ⑦ 全庫欄級授權總筆數 (檔頭宣稱:9 筆, 全在不碰的那兩張上) ===
 schema |            表             | 欄級授權筆數 
--------+---------------------------+--------------
 public | pcm_settle_retry_attempts |            4
 public | supplier_sync_runs        |            5
(2 筆資料)

=== ⑧ 貼前直接授權總筆數:表級+欄級, 全 schema (檔頭宣稱:86 筆) ===
 直接授權總筆數 
----------------
             86
(1 筆資料)

=== ⑨ 七張表的 RLS 開關 + policy 數 (檔頭宣稱:RLS 7/7 全開) ===
               表               | rls開著 | policy數 
--------------------------------+---------+----------
 home_banners                   | t       |        1
 pcm_incident                   | t       |        0
 pcm_net_exposure_snapshot      | t       |        0
 pcm_settle_retry_attempts      | t       |        0
 shipment_order_ship_clearances | t       |        1
 supplier_inbound_emails        | t       |        1
 supplier_sync_runs             | t       |        3
(7 筆資料)

=== ⑩ 撈這份的身分與時間(證明是 pcm_readonly 這把鑰匙撈的) ===
    我是誰    |           撈的時間            |                                       pg版本                                       
--------------+-------------------------------+------------------------------------------------------------------------------------
 pcm_readonly | 2026-09-17 03:44:10.523934+00 | PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
(1 筆資料)


⚠️ 這支沒有 `\set ON_ERROR_STOP on`(刻意, 見本腳本註解)⇒ 中間某格炸掉後面照樣跑照樣印, 而 rc 仍是 0。
   自己掃一次輸出, 掃法:grep -nE '^psql:.*ERROR|^ERROR:' <輸出>
   🔴 不要用裸的 grep -c 去數那個字 —— 它會連【這一句話】一起數進去(實測虛報 1)。

rc=0
```
