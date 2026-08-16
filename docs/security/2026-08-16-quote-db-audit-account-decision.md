# 定案：報價單庫唯讀稽核帳號 —— **建，但它不是「零權限」**

- **窗**：E（資安稽核）　**日期**：2026-08-16　**目標庫**：`pcm-quote-v2`
- **狀態**：**定案（甲案）**。**實作與貼 SQL 由 Sean，我唯讀。**
- **前置**：`E-674b`（建帳號本體）＋ **`E-674c`（`pgbouncer` 那個 `42501` 的正解，必讀）**
  ＋ **本檔 §3 的斷言取代 `E-674c` §3 的 ②**。

---

## 1. 這件為什麼卡了一輪

`E-674c` 的驗收**擋下了帳號建立**，列出 8 項「碰得到不該碰的」。逐項查完之後：

```
2 項  cron.*                      → 誤報（有表授權，但無 schema USAGE ⇒ 碰不到）
4 項  net.* + extensions.*        → 🔴 真的碰得到（兩層都通）
2 項  schema USAGE: net / public  → 真的有（那就是前 4 項的第一層）
```

🔴 **誤報的成因是我自己的斷言少查了一層**（只查表授權、沒查 schema `USAGE`），
**而那個盲點正是我在外部曝險稽核檔 §2.4 寫過的那條。已修（§3）。**

---

## 2. 四個答案（**全部量過，來源逐項標明**）

| # | 問題 | 答案 | 來源 |
|---|---|---|---|
| ① | `net`／`extensions`／`cron` 在 Data API 的曝露清單裡嗎 | **不在** —— 清單四個選項是 `backup`／`graphql_public`✅／`pgroonga`／`public`✅ | ⚠️ **Sean 的 Dashboard 截圖**（讀圖，非機器輸出） |
| ② | `anon` 對那幾張表兩層都通嗎 | `net.http_request_queue`／`net._http_response`／`extensions.pg_stat_statements(_info)` **通**；`cron.*` **不通** | ✅ Sean 在**報價單庫**跑我的診斷 SQL |
| ③ | `anon` 看得到 `pg_stat_statements` 的**查詢文字**嗎 | **看不到**（非 superuser、非 `pg_read_all_stats` 成員） | ✅ Sean 在**報價單庫**實測 + PG17 官方文件 |
| ④ | `cron.job` 裡有沒有祕密 | 9 個排程 / **2 個疑似**；`anon` 進不去 `cron` ⇒ **本案不受影響** | ✅ Sean（只回計數，**零內容**） |

### ⚠️ 沒量的一項，明寫，不留空格

**那三張表的實際列數（`§4-②`）Sean 沒貼。**

**⇒ 不影響本案結論**（決定建不建、怎麼釘住，四個答案已足夠）。
🔴 **但它會讓一句話更準**：列數決定那個曝露是**理論的**還是**活的** ——
```
若 net.http_request_queue 長期為 0（該庫沒在用 pg_net）⇒ CRON_SECRET 那條鏈是理論的
若它會有東西                                          ⇒ 那條鏈是活的
```
⇒ **值得補問，但不擋定案。** 補到之後只需要改 §5 的語氣，不改任何決定。

---

## 3. 🔴 定案：**建，而且斷言改成「釘住」不是「放寬」**

**「放寬斷言」會讓下一個人以為標準降低了。要做的相反：把現在這一組明文釘死，多出任何一個就紅。**

```sql
-- 取代 E-674c §3 的 ②。其餘（① schema USAGE 圈、③ get_auth）不變。
DECLARE
  -- 🔴 已知且已接受的可讀面（2026-08-16 定案）。這份清單【就是】基準。
  c_accepted constant text[] := ARRAY[
    'net.http_request_queue',
    'net._http_response',
    'extensions.pg_stat_statements',
    'extensions.pg_stat_statements_info'
  ];
  v_bad  text[] := ARRAY[]::text[];
  v_seen text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, c.oid
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r','p','v','m','f')
  LOOP
    IF has_schema_privilege('pcm_audit_ro', r.nspname, 'USAGE')       -- 🔴 第一層
       AND has_table_privilege('pcm_audit_ro', r.oid, 'SELECT') THEN  -- 🔴 第二層
      IF (r.nspname||'.'||r.relname) = ANY (c_accepted)
        THEN v_seen := v_seen || (r.nspname||'.'||r.relname);
        ELSE v_bad  := v_bad  || (r.nspname||'.'||r.relname);
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION '🔴 稽核帳號可讀【基準以外】的 % 個物件：%。'
      '這代表授權面自 2026-08-16 定案後變大了 —— 先查清楚為什麼，不要直接加進 c_accepted。',
      array_length(v_bad,1), array_to_string(v_bad, ', ');
  END IF;

  -- 🔴 正向對照：基準一個都沒命中 ⇒ 這次掃描沒有判別力，「零違規」是假的。
  IF array_length(v_seen,1) IS NULL THEN
    RAISE EXCEPTION '🔴 基準清單一個都沒命中 ⇒ 本次掃描無判別力，不算通過'
      '（可能：角色不存在、schema 改名、迴圈沒跑）';
  END IF;

  RAISE NOTICE '✅ 可讀面與基準一致（% 項）：%', array_length(v_seen,1), array_to_string(v_seen,', ');
  RAISE NOTICE '⚠️ 這 % 項【不是零】—— 這組憑證讀得到它們，保管要求見本檔 §5', array_length(v_seen,1);
END;
```

**兩個設計要點**：
1. **基準之外才紅、基準之內只記錄** ⇒ 仍然是守衛，不是免死金牌。
2. 🔴 **`v_seen` 全空也紅** —— 沒有它，「掃到 0 個物件」與「乾淨」長得一模一樣。

---

## 4. 🔴 逐項列出：**這組憑證看得到什麼**（不能只寫「與 PUBLIC 同級」）

| 物件 | 它裡面是什麼 | 敏感度 |
|---|---|---|
| **`net.http_request_queue`** | pg_net 的送出佇列 —— **有排程在跑的瞬間裝著 `Authorization: Bearer <CRON_SECRET>`** | 🔴 **高** |
| **`net._http_response`** | pg_net 的回應體（保留約 6 小時） | 🔴 **高**（回應內容取決於打了什麼端點） |
| `extensions.pg_stat_statements` | 查詢**統計**（次數／時間／列數）。**別人執行的 SQL 文字看不到**（§2-③） | 低－中 |
| `extensions.pg_stat_statements_info` | 統計收集器自身的中繼資料 | 低 |
| schema `USAGE`：`net`、`public` | 前四項的第一層；`public` 是正常應用面 | — |

⚠️ **`public` 那格要分清楚**：稽核帳號對 `public` 有 schema `USAGE`，
**但它對 `public` 底下的表【沒有】表授權**（`E-674c` §2 的迴圈收掉了）
⇒ **進得了門，開不了櫃子。** 這正是為什麼斷言要兩層並查。

---

## 5. 🔴 那份連線字串檔的保管 —— **`chmod 600` 不夠，因為問題不在檔案權限**

`chmod 600` + 不進 git 回答的是「**誰讀得到這個檔**」。
**要寫下來的是「這個檔【等於】什麼」。**

**建議在 `~/.pcm-quote-readonly-db` 檔頭與 `E-674b` 步驟 2 同時加：**

> 🔴 **這個檔不是「唯讀帳號」那麼簡單。**
> 持有它的人讀得到 `net.http_request_queue` / `net._http_response`（**已實測，兩層都通**）。
>
> **⚠️ 那兩張表【若】這個庫確實在用 `pg_net` 跑排程，就會在送出的瞬間裝著
> `Authorization: Bearer <CRON_SECRET>`** ——
> 該行為**已在網站庫實測確認**；**本庫是否在用 `pg_net`【尚未量】**（見報告 §2 的「沒量的一項」）。
>
> **⇒ 在那一項量清楚之前，一律【當作】它等同於「可能取得排程金鑰」的憑證。**
> **保管比照 `.env`：不貼對話、不貼信箱、不進 git、不進任何報告附件。**
>
> 📌 **量清楚之後怎麼改這段**：
> `net.*` 長期為 0（沒在用 pg_net）⇒ 可降級為「唯讀 catalog 憑證」；
> 有東西 ⇒ 這段照原文保留，並**把它列進金鑰輪換清單**。

### 🔴 為什麼上面那段【自己】要帶條件，而不是靠報告裡的限定

**限定與斷言的載體不同 ⇒ 壽命與傳播範圍也不同：**

```
限定住在本報告 §2 / §5      ← 讀【報告】的人看得到
斷言會被複製進【憑證檔頭】   ← 那是一個永遠不會回頭讀報告的地方
⇒ 限定沒有跟過去
```

**⇒ 判別句：我這句話會被複製到哪裡去？那個地方裝得下它的限定嗎？裝不下 ⇒ 句子本身要帶條件。**

📎 這是「限定會被抹掉」的**新變體**：**不是被人抹掉，是【載體不同所以沒跟過去】。**
（V 窗 2026-08-16 對本檔的 finding，已採納並修正。）

### 🔴 權限鏈（先前沒寫出來的那條）

```
DB 連線字串 → 讀 net.http_request_queue → CRON_SECRET → 打 cron 端點
```

**⇒ 這組「唯讀」憑證的實際上限，不是「唯讀」，是「唯讀 ＋ 可能拿到一把能觸發排程的鑰匙」。**

⚠️ **鏈的終點威力【未確認】**：報價單庫的 cron 端點會做什麼，我沒查。
**但鏈本身在網站庫成立**（我實測過那張表裝的就是那個 header）。

---

## 6. 🔴 兩件我**刻意不宣稱**的（請不要在轉述時被抹掉）

### 6.1 我**不說**「`anon` 只看得到自己那幾列」

PG17 官方原文只說：

> **"only superusers and roles with privileges of the `pg_read_all_stats` role are allowed to see
> the SQL text and `queryid` of queries executed by other users."**

**它說的是【別人的 SQL 文字與 `queryid`】看不到，沒有說【別人的列】整列看不到。**
⚠️ 我讀到的網頁摘要有這樣延伸，**但那是摘要模型加的，不是原文** ⇒ **不採用。**
**⇒ 保守講法：統計面看得到，文字面看不到。**

### 6.2 我**不說**「所以沒有風險」

**統計面仍會洩漏行為指紋** —— 哪支查詢跑了幾次、多慢、掃幾列。
**那是低敏，不是零。** 對一個掌握商品／報價資料的系統，
**「哪支查詢在什麼時候變忙」本身就是商業訊息。**

---

## 7. 為什麼**不**選另外兩個方向

| 方向 | 為什麼不選 |
|---|---|
| **乙：收掉那幾張的 `PUBLIC` 授權** | **外部既然不可達，動全庫授權的風險 > 收益。** 而且 `net` 的 `nspacl` 連 `anon` 都明文有 USAGE ——**那是平台裝的，不是誰疏忽**；**pg_net／pg_cron 的 worker 可能就靠它在跑，收錯會靜默啞掉。** 鐵則 12 ② |
| **丙：不建 LOGIN 角色，Sean 當場跑** | 仍是有效選項，代價沒變（慢、要他配合、用更大權限做更小的事）。**若日後 §2-② 的列數顯示 `net.*` 真的有東西在跑，丙的相對吸引力會上升** |

---

## 8. 落地順序

```
1. Sean 照 E-674b + E-674c 貼（🔴 §3 的 ② 用本檔 §3 這版）
2. 看到 ✅ 那行 + ⚠️「這 4 項不是零」那行 ⇒ 通過
3. 憑證檔加 §5 那段檔頭
4. （可選，不擋）補問 net.* 三張的列數 ⇒ 決定 §5 的語氣要多強
5. （可選，不擋）把「外部不可達」從截圖升級成實打證據：
   /rest/v1/<那張表> 打一發 + 一個已知 200 與一個已知 404 的對照
   🔴 沒有對照，單一個 404 不算證據（網站庫踩過一次，整輪作廢）
```
