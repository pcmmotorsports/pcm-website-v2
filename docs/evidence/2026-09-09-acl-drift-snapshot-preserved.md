# 保全 · `pcm_acl_snapshot_digest` 全表逐字 —— **因為明天 `2026-09-10 00:00` 那發 cron 一跑,今天這個未批准的漂移訊號就會自己消失**

> 線【權限/信件】窗 C · **2026-09-09 10:58 UTC** 唯讀抄錄 · `pcm_readonly` @ 正式庫 · `bash scripts/readonly-prod-sql.sh` · 零寫入。
> 🛑 **窗 C 沒有蓋章、沒有 apply、沒有 push。** 這份只做兩件:**保全** 與 **核對**。
> 🔴 **本檔是 R1 後改稿**。codex 唯讀審抓到 5 個 must-fix,其中兩個是實質的:①我漏了 `supabase/APPLIED.tsv` 與 `~/pcm-mailbox/貼結果-*.log` 這兩份**獨立紀錄**,而它們**推翻了我一項歸屬** ②第一版省略了 24 個族別 md5 與一段完整批准理由 —— **一份保全抄本不可以省略欄位**。逐條見 §5。

## 0. 這份為什麼存在

`⟦b9-ACLDRIFT5⟧` 的偵測 view(`20260905170000_m4b_acl_drift_status_and_approve.sql:69` 起)**只取最新兩列**(`rn = 1` 與 `rn = 2`)。
⇒ 📌 三天的摘要若是 `A → B → B`,第二天 `有漂移 = t`、**第三天 `有漂移 = f`,即使 B 從來沒被批准過。**
⇒ 🔴 **所以 `2026-09-09 00:00` 這個「有漂移而未批准」的訊號,明天 00:00 那發 cron 一跑就不見了。**

---

## 1. 保全 · 全表五列**全欄位**逐字(2026-09-09 10:58 UTC 抄)

### RECORD 5 —— 🔴 **待核的那一列**
```
taken_at      2026-09-09 00:00:00.228822+00
digest        8eaf5404096b20fc766684fad1e5f077
row_count     1615
families      {"FN":        {"n": 844, "md5": "4d0bf0cadc3368f2eb397f00bd3e7598"},
               "POL":       {"n": 101, "md5": "7e4e7dca57d4e3348fbd46daef0d4597"},
               "REL":       {"n": 384, "md5": "586ac35f81e921fde1248b9cdb26b4f7"},
               "ROLE":      {"n":   4, "md5": "365ed3a235d126e4c502282bc082b317"},
               "FNCFG":     {"n": 211, "md5": "e95eb9c4f45be070575b4293ba2a6e60"},
               "DEFACL":    {"n":   9, "md5": "e7cf84266195d843d604f4cc5256069c"},
               "VIEWOPT":   {"n":  30, "md5": "743fe3a6289bf4c91d8066b149ae2bcd"},
               "STORAGEACL":{"n":  32, "md5": "2e3ddbc55183be0ae3e01d6a2a37d410"}}
approved_at   (空)
approved_note (空)
```

### RECORD 4 —— **比較基準那一列**
```
taken_at      2026-09-08 00:00:00.207449+00
digest        bc60204914efe7d535411b770fac7b60
row_count     1566
families      {"FN":        {"n": 820, "md5": "f52398c89ef7e0ca2a15f5de0e469bb3"},
               "POL":       {"n": 100, "md5": "c8798faae141d817ceaa5d40e1bcad86"},
               "REL":       {"n": 368, "md5": "9af195ed0f606d4f8e206393ef0f9cbe"},
               "ROLE":      {"n":   4, "md5": "365ed3a235d126e4c502282bc082b317"},
               "FNCFG":     {"n": 205, "md5": "93cba942ecabb9a924ac6c57707ea111"},
               "DEFACL":    {"n":   9, "md5": "e7cf84266195d843d604f4cc5256069c"},
               "VIEWOPT":   {"n":  28, "md5": "8d7045565065b3f7302e9b21816f72fe"},
               "STORAGEACL":{"n":  32, "md5": "2e3ddbc55183be0ae3e01d6a2a37d410"}}
approved_at   2026-09-08 02:52:24.788384+00
approved_note 2026-09-07 依 Sean 指示連續貼了 12 支 migration(貼 73/74/79/80/84/85/86/87/88/90/91/92,版本號 20260907050000~20260908000000),FN/FNCFG/REL/VIEWOPT 四族的差是它們造成的
```

### RECORD 3
```
taken_at      2026-09-07 00:00:00.114279+00
digest        6338905709360f43b791ea91696300ed
row_count     1541
families      {"FN":        {"n": 804, "md5": "4ade938a6c611de9030e493af3d2b6c7"},
               "POL":       {"n": 100, "md5": "c8798faae141d817ceaa5d40e1bcad86"},
               "REL":       {"n": 364, "md5": "919cfe7f350343a495d9a01c6c02def0"},
               "ROLE":      {"n":   4, "md5": "365ed3a235d126e4c502282bc082b317"},
               "FNCFG":     {"n": 201, "md5": "ba91200afbbc95a83eff0739f2da2234"},
               "DEFACL":    {"n":   9, "md5": "e7cf84266195d843d604f4cc5256069c"},
               "VIEWOPT":   {"n":  27, "md5": "ad4a4f278a0f7c9034b76a0d4d6726df"},
               "STORAGEACL":{"n":  32, "md5": "2e3ddbc55183be0ae3e01d6a2a37d410"}}
approved_at   2026-09-07 05:56:12.468156+00
approved_note (🔴 全文,不節錄 —— 第一版只留節錄,codex 判 must-fix)
              2026-09-07 -db 對帳後批准。快照與基線差 244 行, 拆開是:新物件 216 行(昨夜到今天貼的 RPC/表/view 出生自帶) + 簽章換掉 6 行 + 真正的權限變動 11 行。11 格逐格對得上版控 migration:(a) products_list_public 與 vehicle_taxonomy_public 的 anon+authenticated 由 SIUDTRG 收成 S------ ← 20260905260000_m4b_public_views_revoke_write_from_anon.sql:204-207;(b) DEFACL 兩格(sequences 掉 anon/authenticated 的 w、tables 掉 service_role 的 Dxtm)← 20260905430000 與 20260905350000;(c) 唯一一格放寬 = get_search_log_health() 對 payment_confirmer 加 EXECUTE ← 20260906970000_m4b_anomaly_reader_grants_payment_confirmer.sql:78;(d) pcm_order_refund_status_transition() 四個角色由 DEFINER 變 INVOKER ← 20260907030000_m4b_tappaydirect_a2_void_backfill.sql:115-118 該檔沒有寫 SECURITY DEFINER 那一行, 且檔內說明只交代 search_path 收緊、未提 DEFINER。 含一格 DEFINER→INVOKER, codex 判無害。codex 逐字結論:VERDICT: 無害(限已核對的 A2 trigger 本體, 單論 DEFINER → INVOKER);理由逐字:函式本體只比較 OLD/NEW、檢查 NULL、回傳或拋錯, 沒有查表、呼叫其他函式或檢查角色。 補量(唯讀):五支寫入 RPC admin_finalize_order_refund / admin_record_manual_refund / admin_void_backfilled_refund / admin_correct_backfilled_refund / admin_backfill_tappay_console_refund 全部 owner=postgres 且 secdef=t;trigger 函式 owner 亦為 postgres, order_refunds owner=postgres。 所以列舉到的每一條路, DEFINER 與 INVOKER 的有效身分都是 postgres, 沒有一條會變。 射程(不放寬):codex 的無害只涵蓋已核對的本體與單論這一個屬性, 不是對整支 migration 的背書;本批准也不涵蓋任何未被本次快照量到的面。 本批准對應的快照 taken_at = 2026-09-07 00:00:00.114279+00
```

### RECORD 2 —— 🔴 **這一列也從來沒被批准過,而它的訊號早就消失了**
```
taken_at      2026-09-06 00:00:00.170816+00
digest        80217ec40768c6b0a455c82ab9559412
row_count     1486
families      {"FN":        {"n": 768, "md5": "8d23f48768f9290a51a28dc368fd010a"},
               "POL":       {"n": 100, "md5": "c8798faae141d817ceaa5d40e1bcad86"},
               "REL":       {"n": 356, "md5": "ddb38333a72c0162930f84be0cd759ef"},
               "ROLE":      {"n":   4, "md5": "365ed3a235d126e4c502282bc082b317"},
               "FNCFG":     {"n": 192, "md5": "334abe6e79b81e4ebac0856cfce70738"},
               "DEFACL":    {"n":   9, "md5": "e7cf84266195d843d604f4cc5256069c"},
               "VIEWOPT":   {"n":  25, "md5": "22c6e94a65e0299a45bb6d12e9e5eede"},
               "STORAGEACL":{"n":  32, "md5": "2e3ddbc55183be0ae3e01d6a2a37d410"}}
approved_at   (空)
approved_note (空)
```

### RECORD 1
```
taken_at      2026-09-05 08:10:43.337554+00
digest        4fe69a79890aacbcb563fa88c54d933f
row_count     1370
families      {"FN":        {"n": 716, "md5": "b2fec8717a03bd82efee0c20e5230248"},
               "POL":       {"n":  96, "md5": "f76147f87c62b3e8c4ae93494eb181c3"},
               "REL":       {"n": 316, "md5": "8fcdf2a6489cd8d5ed496d5e049196a5"},
               "ROLE":      {"n":   4, "md5": "365ed3a235d126e4c502282bc082b317"},
               "FNCFG":     {"n": 179, "md5": "2dbd4e53f6beafe3cfca1e16f4444292"},
               "DEFACL":    {"n":   9, "md5": "25120ebe5851d94951b57a73e346dad1"},
               "VIEWOPT":   {"n":  18, "md5": "f9eae51802b98003cf2fc3e04d5a2d1a"},
               "STORAGEACL":{"n":  32, "md5": "2e3ddbc55183be0ae3e01d6a2a37d410"}}
approved_at   2026-09-05 08:10:43.337554+00
approved_note 20260905170000 貼板後的第一次批准:這一列含本片新增的 view 與函式(事後斷言寫的)
```

✅ **內部一致性(codex 逐列加總驗過)**:五列的八族 `n` 加總 = 該列 `row_count`,**1370 / 1486 / 1541 / 1566 / 1615,五列差額全 0**。
🛑 **而加總對不證明 `digest`、`taken_at`、批准文字抄錄正確** —— 那三樣沒有第二把尺可以自我核對。

### 那支 view 現在說什麼(明天會變)
```
最新時刻 2026-09-09 00:00:00.228822+00 · 前一次時刻 2026-09-08 00:00:00.207449+00
有漂移 t · 最新這列已被批准 f · 最新列數 1615 · 前一次列數 1566
變了的族 FN,FNCFG,POL,REL,VIEWOPT · 最新這列太舊 f
```

---

## 2. 核對 · 逐族差

| 族 | 9/8 | 9/9 | 差 | md5 |
|---|---|---|---|---|
| FN | 820 | 844 | **+24** | 變 |
| FNCFG | 205 | 211 | **+6** | 變 |
| REL | 368 | 384 | **+16** | 變 |
| VIEWOPT | 28 | 30 | **+2** | 變 |
| POL | 100 | 101 | **+1** | 變 |
| ROLE / DEFACL / STORAGEACL | 4 / 9 / 32 | 4 / 9 / 32 | 0 | 未變 |
| **合計** | **1566** | **1615** | **+49** | ✅ 與 `row_count` 一致 |

**每個物件算幾列(codex 讀 `20260905140000:93` 起的定義確認,不是我推的)**:
`REL` 每個 relation **4 列**(四個應用角色各一)· `VIEWOPT` 每個 view **1 列** · `FNCFG` 每個函式簽章 **1 列** · `FN` 每個函式簽章 **4 列** · 索引與序列**不算進 `REL`**。

### 🔴 歸屬 —— **用 `supabase/APPLIED.tsv` 的【貼入日】,不是 git commit 時間**
🛑 **第一版我用 commit 時間,那是錯的尺** —— migration 是 Sean 手動貼的,commit 與 apply 是兩件事,而 **`APPLIED.tsv` 這一欄就記著貼入日**。codex 指出來,我逐支核過:

| migration | `APPLIED.tsv` 貼入日 | 建了什麼 | REL | VIEWOPT | POL |
|---|---|---|---|---|---|
| `20260908000000` products_list_dealer | **2026-09-07** `@20260907-223227-90487` | view | ❌ **窗口前,不算** | ❌ | |
| `20260907070000` orders_delete_audit_trail | **2026-09-08** `@20260908-182947-31052` | `orders_deleted_log`(table)+ `:255` `CREATE POLICY orders_deleted_log_select_service_role` | +4 | — | **+1** |
| `20260907210000` order_effective_amounts_v | **2026-09-08** `@20260908-150938-94340` | `:60` `CREATE VIEW public.pcm_order_effective_amounts_v` | +4 | +1 | |
| `20260908030000` net_exposure_probe | **2026-09-08** `@20260908-171601-90015` | `pcm_net_exposure_snapshot`(table) | +4 | — | |
| `20260908080000` partial_refund_email_pending | **2026-09-08** `@20260908-120518-87143` | view | +4 | +1 | |
| **合計** | | | **+16** ✅ | **+2** ✅ | **+1** ✅ |

🎯 **REL / VIEWOPT / POL 三族,新增物件的數量逐格對得上,而每一支都有 `APPLIED.tsv` 的貼入日當獨立紀錄。**
🛑 **`20260907210000` 那一支是 codex 找到的,我漏了** —— 少了它,REL 會差 4、VIEWOPT 會差 1。

**FN +24 / FNCFG +6** ⇒ 需要**淨增 6 個函式簽章**。窗口內貼入的 migration 有多條 `CREATE FUNCTION`,而**同簽章的 `CREATE OR REPLACE` 不增加列數**。
⇒ ⚠️ **我沒有逐支算出「淨增了哪 6 個簽章」** ⇒ **這 30 項是量級相符,不是逐支對上。**

---

## 3. 🛑 這份核對證不到什麼(第一版漏的都補進來了)

1. 🔴🔴 **「49 項都找到了對應物」—— 第一版那句撤回。** `49` 是**淨增列數**,不是**全部變更項目數**。
   ⇒ 📌 **反例**:新增 4 個 relation(+16)的同時放寬 10 個既有 relation 的權限 ⇒ `REL` 仍然只 `+16`。新增與刪除也會互抵。
   ⇒ ✅ **正確講法:新增物件的【數量】對得上,而【那五族裡既有項目的 ACL 值有沒有變】這一發完全答不出來。**
2. 🔴 **`md5` 相同 ≠ 沒動過。** `ROLE` / `DEFACL` / `STORAGEACL` 三族 md5 逐字相同,那**至多支持「兩次取樣的當下內容相同」** —— **不排除中間改過又改回**(那正是 `⟦b9-ACLDRIFT5⟧` 守不到的那一種)。第一版寫「三族是真的沒動」,**過強,已改**。
3. 🔴 **`REL` 族只掃 `anon` / `authenticated` / `service_role` / `payment_confirmer` 的【表級】權限**(`20260905140000:91-107`)⇒ **`pcm_readonly` 與欄級授權根本不在射程** ⇒ 那一類的手改,**連「有漂移」都不會出現**。
4. 🛑 **「沒有一項指向路⑤」的正確讀法**:是「**新增物件都在版控裡找得到**」,**不是**「**沒有人手動改過權限**」。板上 `⟦db-ACLVALUEPROVENANCE⟧` 逐字:**一個在 dashboard 被手改過的物件,只要它本來就有 migration,在這把尺下照樣對得上。**
5. 🔴 **`cron.job_run_details` 只有一列,推不出「那張表前一天才存在」。** 第一版拿它當獨立佐證 —— **弱證據,已降級**:晚啟用排程、或歷史紀錄不完整,都會造成同樣的讀數。**真正的獨立紀錄是 `APPLIED.tsv` 與貼結果 log。**
6. 🔴 **`APPLIED.tsv` 的貼入日是【日期】不是時戳,而窗口是 UTC 00:00→00:00。** 我用貼板時戳(`@2026MMDD-HHMMSS`)換算過(台灣 −8 小時),五支都落在窗口的正確一側 —— **但那個換算是我做的,時區沒有寫在那份檔裡。**
7. 🔴 **我的 SQL 解析器會漏抓 `DO` 區塊裡的 `CREATE`。** `orders_deleted_log` 的 `CREATE POLICY` 就在 `DO $$…$$` 裡,害我一度得到「窗口內新增 policy = 0」這個**假的中間結論**。⇒ **「窗口內沒有別的東西」這句,我的工具答不出來。**
8. **`FN` / `FNCFG` 那 30 項只對到量級**(見 §2 末)。
9. **我沒有蓋章、也沒有權限蓋** —— `pcm_readonly` 只有 `SELECT`,沒有 `pcm_acl_approve_latest` 的 `EXECUTE`。

---

## 4. 🔴 蓋章 —— **「鎖定 taken_at」今天【做不到】,第一版那個建議給了假的安全感**

`pcm_acl_approve_latest`(`20260905170000:129-132`)**只吃 `p_note`**,內部取 `max(taken_at)`。
⇒ 🛑 **它不接受指定的時刻,也不接受 digest** ⇒ **先查一次、把時刻寫進 `p_note`,那不是綁定,只是留字。**
⇒ 🔴 **執行前若最新列變了(例如同日重錄、或跨過午夜),就會蓋到別張。** 隔天再呼叫也**無法回頭蓋 RECORD 5**。

**而更狠的一格**:`20260905140000:252-258` 的同日重錄 `ON CONFLICT … DO UPDATE SET digest / row_count / families / taken_at`,**沒有清 `approved_at` / `approved_note`**
⇒ 📌 **即使當下蓋對了,後來內容變了仍可能沿用那個章。**

### ⇒ 所以蓋章之前的實際前提(不是三句限定文字就夠)
1. 呼叫前後**各讀一次** `taken_at` 與 `digest`,**確認就是受審的那一張**;不符 ⇒ **回滾,不蓋**。
2. 避免併發換列(同日重錄 / 跨午夜)。
3. 🛑 **三句限定文字寫在 `p_note` 裡,擋不住蓋錯列** —— 它是給人讀的,不是閘。
4. **要真正做到「鎖定」,得改那支函式讓它吃 `taken_at` + `digest`** ⇒ 那是 migration ⇒ **鐵則 8,要 plan 等 Sean 批。**

**蓋章文仍要帶三句限定**(板上 09-07 已寫,而**那三句沒有落到正式庫上**):①證的是「物件在版控裡有 `CREATE`」不是「這個 ACL 值是那支給的」②**dashboard 手改過的物件,只要本來就有 migration,這把尺照樣對得上** ③本章只涵蓋這一批差異。

🔴 **而 `RECORD 2`(2026-09-06)那個從來沒被批准過的漂移,已經沒有任何地方在追它了。這份是它今天唯一的落點。**

---

## 5. codex R1 —— 5 個 must-fix,逐條怎麼修

| codex 意見 | 怎麼修 |
|---|---|
| ①每物件的倍率(REL 4 / VIEWOPT 1 / FNCFG 1 / FN 4)**成立**,但「逐項對上」不成立;我引的 commit 只是補註解 | 歸屬全部改用 **`APPLIED.tsv` 的貼入日**;`FN`/`FNCFG` 降級成「量級相符、未逐支對」(§2) |
| ②**我漏了 `APPLIED.tsv` 與貼結果 log**,而它們推翻一項歸屬:`products_list_dealer` 是 **9/7** 貼的 ⇒ 不算;而漏了 `20260907210000` 的 `pcm_order_effective_amounts_v` | §2 歸屬表整個重做,加上那一支 ⇒ **REL/VIEWOPT/POL 三族逐格對上**;`cron` 那個佐證降級(§3 第 5 條) |
| ③五列加總**全對**(1370/1486/1541/1566/1615,差額 0);但**省略了 24 個族別 md5 與 RECORD 3 的完整批准理由** | §1 **全部補回,五列八族 md5 一個不缺,`approved_note` 全文不節錄** |
| ④「49 項都有對應物」自相矛盾且過度宣稱;`md5` 相同 ≠ 沒動過 | **那句撤回**(§3 第 1 條),並說明 `49` 是**淨增**;「三族真的沒動」改成「兩次取樣當下相同」(§3 第 2 條) |
| ⑤「鎖定 `taken_at`」做不到,函式只吃 `p_note` 取 `max` | §4 **整節重寫**,寫明做不到、寫出實際前提、並指出「要真做到得改函式 ⇒ 鐵則 8」 |

🛑 **codex 結論是「不可 —— 抄本缺少原始欄位、來源歸屬已有反證、蓋章方式無法保證批准的是受審快照」。**
✅ **前兩項本稿補齊了**(欄位全補、歸屬用 `APPLIED.tsv` 重做);**第三項本稿沒有解決,只有把它寫清楚** —— 因為修法是改那支函式,而那要 Sean 批。
🛑 主視窗 2026-09-09 定:**純 .md 只跑 R1,不跑 R2。**
