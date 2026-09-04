# Plan:把 SECURITY DEFINER 的 `search_path` 鎖成空(2026-09-05,線 `-db`)

> 唯讀普查來源 `e2597dc1a`;數字當場重量於 2026-09-05,分母 = `public` 的 169 支函式。授權射程:唯讀已批、**apply 未批** ⇒ 本檔只規劃。

## 0. 兩個把交辦前提推翻的訂正(先讀這節)

| 交辦單原句 | 實測 | 差在哪 |
|---|---|---|
| 「39 支非空 **+ 7 支未設**」 | `DEFINER 且完全未設 search_path` = **0 支** | 那 7 支來自 `acl-snapshot` 的 `FNCFG` 族,分母是**全部 169 支**(含 INVOKER)。逐支查:7 支**全是 INVOKER** |
| 「哪些 body 裸引用 public 物件 ⇒ 要改 body」 | **0 支需要改 body** | 見 §2。我第一版尺報 17 支、第二版報 23 支,**兩版都是錯的** |

⇒ **待鎖範圍 = 39 支,不是 46。**

## 1. 分堆(39 支;名單 `scratchpad/definer39.txt`,貼板前重跑 §4-A 重生)

| 堆 | `search_path` 現值 | 支數 | 其中 `service_role` 叫得動 | 處置 |
|---|---|---|---|---|
| **A(優先)** | `public, pg_temp` | 36 | **20** | 鎖成 `''` |
| B | `pg_catalog, pg_temp` | 1 | 1 | `record_auth_callback_event` |
| C | `pg_catalog` | 1 | 1 | `rls_auto_enable`(唯一用動態 SQL 的) |
| D | `pg_catalog, public` | 1 | 0 | `pcm_op2b_reversal_amount` |

🔴 **B/C/D 三支不是同一種風險**:`pg_catalog` 不是使用者可寫的 schema ⇒ 它們**現在就已經安全**。
　 真正的風險全在堆 A 的 `public` 那一段。**⇒ B/C/D 可以緩,不要為了「數字歸零」一起動。**
　 尤其 C 是 event trigger + `EXECUTE format(...)`,鎖成 `''` 要連 builtin 都補前綴 —— 成本最高、收益最低。

## 2. 「body 要不要改」—— 量到 0,而**這個 0 的可信度全繫在那把尺上**

尺:拿 `public` 的真實 relation / 獨立型別 / 函式名,比對 body 裡**沒有 `public.` 前綴**的出現;比對前先剝掉**行註解**與**單引號字串常值**。

**突變測試(四個世界,全對)**:
| 餵進去的 body | 尺該說 | 實測 |
|---|---|---|
| `UPDATE customers SET x=1` | 有 | ✅ 有 |
| `UPDATE public.customers SET x=1` | 沒有 | ✅ 沒有 |
| `-- UPDATE customers 禁裸覆寫` | 沒有 | ✅ 沒有 |
| `RAISE EXCEPTION '改 customers 要走 trigger'` | 沒有 | ✅ 沒有 |

🔬 **為什麼要做這四格**:前兩版尺各自報 17 / 23 支,拆開看**全是註解與字串常值**:
　 · `admin_adjust_wallet` 命中的 `UPDATE customers`,住在一句寫著「本函式體**零** UPDATE customers」的**註解**裡
　 · 四支命中的 `staff`,是 `listing_set_by = 'staff'` 這種**字串常值**
　 · 命中的「其他 public 函式」全在註解,真正的呼叫都已經寫成 `public.pcm_b2_is_blank(...)`
　 📌 ⇒ **一把沒有突變測試的尺,可以連續兩版都給出「完整、具體、而完全錯」的清單。**

**已量掉的盲區**(都不成立,所以 0 站得住):
· 序列名藏在 `nextval('...')` 字串裡 ⇒ 39 支裡用到 `nextval/currval/setval` 的 = **0 支**
· `gen_random_uuid` 被裸呼叫 ⇒ 它**同時存在於 `pg_catalog`**,空 `search_path` 下照樣解析得到
· 動態 SQL ⇒ 只有 `rls_auto_enable` 一支(堆 C,本次不動)

✅ **拋棄式 PG 實測(2026-09-05,PG 17.10;四個世界)** —— 把 §4 閘 C 從「推的」變成「量到的」:
| 世界 | 結果 |
|---|---|
| 鎖前,裸引用版 / 帶前綴版 | 兩支都正常回值 |
| 鎖後,**帶前綴版** | ✅ 照常回值 |
| 鎖後,**裸引用版** | 🔴 `ERROR: relation "customers" does not exist`(呼叫時才炸) |
| 下 `ALTER FUNCTION … SET search_path = ''` 的**當下** | **零警告、零錯誤** |
🔴 **最後一列才是重點**:`ALTER` **不檢查 body** ⇒ 一支會壞的函式,鎖的那一刻**完全安靜**,
　 migration 全綠、`acl-snapshot` 形狀對,而它下一次被呼叫才炸。**⇒ 閘 B(行為)不是加分項,是唯一的證據。**

🛑 **這個 0 證不到什麼**(逐字寫進 plan,不寫在註解):
　 ① 字串剝除用的是 `'[^']*'`,遇到 `''` escape 會配對錯 ⇒ 誤差方向**兩邊都有**
　 ② 尺不含**運算子**(如 pg_trgm 的 `%`)與**自訂 cast**
　 ③ **靜態尺看不到執行期** —— PL/pgSQL body 不在 `CREATE` 時解析,鎖完的真正證據只有**跑過那條路**

## 3. 分幾支 migration

- **`M1` 堆 A 的 20 支 SR** —— 收 `BYPASSRLS` 那片的前置,優先。
- **`M2` 堆 A 剩下 16 支**(trigger / guard 函式,不對外)。
- **`M3` 堆 B/C/D 3 支** —— 標 `parked`,收益低風險高,等 M1/M2 上線觀察一週再議。

拆三支的理由:M1 的爆炸半徑是**後台整條**,M2 是**寫入路徑的 guard**,回滾對象不同;綁一支會逼人一次滾掉全部。

## 4. 事後閘

- **A. 形狀閘**:`acl-snapshot.sh` 的 `FNCFG` 族已經記 `search_path=` 值 ⇒ 貼完 M1,`FNCFG` 該有 **20 格變動**,值從 `search_path=public, pg_temp` → `search_path=""`。**這是唯一不需要新寫東西的閘。**
- **B. 行為閘(A 證不到的那半)**:M1 那 20 支裡,`admin_*` 系走後台真實動線各叫一次。
  🔴 **A 綠 B 沒跑 = 不算通過** —— 形狀對而執行期炸掉,正是 §2 盲區③ 講的那一格。
- **C. 負對照**:鎖之前先在拋棄式 PG 上把**任一支** body 的 `public.` 前綴拿掉再鎖,確認它**真的會紅**;不紅 ⇒ 閘沒接上,停。

## 5. Rollback

`ALTER FUNCTION` 只改 `proconfig`,**不動 body、不動 ACL** ⇒ 反向就是把原值寫回去。
✅ **實測:`ALTER FUNCTION` 受交易保護** —— `BEGIN → ALTER → ROLLBACK` 值退回原狀;`COMMIT` 才留下。
🔴 **而「把原值寫回去」有一個會靜靜失敗的形狀**:實測 `SET search_path = 'public, pg_temp'`(整串加引號)
　 存進去是 `search_path="public, pg_temp"`,**與正式庫現況的 `search_path=public, pg_temp`(不加引號)不是同一個字面**。
　 ⇒ 回滾腳本若把值當成一個字串塞回去,函式**行為會對**而 `acl-snapshot` 的 `FNCFG` 族**會叫**,
　 　 而那個叫聲會被讀成「有人動了權限」。⇒ 回滾要寫成**不加引號的清單形式**,並在回滾後跑一發快照確認 0 格。
migration 內先把 39 支的 `(proname, proconfig)` 存進 `public.pcm_definer_searchpath_rollback_<版本>`,該表開一列「**退場:M1+M2 上線滿一週且 B 閘跑過 ⇒ DROP**」(比照 `pcm_rls_rollback_20260904270000`)。

## 6. Codex 要審什麼(鐵則 12② 權限類,不降級)

1. §2 那個 0 —— **不是問「清單對不對」,是問「這把尺在哪一種 body 上會靜靜漏掉」**。
2. 堆 B/C/D 緩做的判斷:`pg_catalog` 真的不可寫嗎?有沒有 `CREATE FUNCTION pg_catalog.foo` 的路徑?
3. M1/M2 的拆法:20 支一起鎖,有沒有**互相呼叫**而形成半鎖狀態的組合。
4. 閘 A 的天花板 —— `FNCFG` 記的是值,**它證不到那支函式還跑得動**。
