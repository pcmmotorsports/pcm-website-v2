# sweeper 健康端點規格 —— 給 Sean 的雲端巡邏用(**規格,E 唯讀不實作**)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**對應**:`docs/phase-1-backlog.md` `#231` ③「cron 靜默死偵測 heartbeat」
- **為什麼是這個形狀**:Sean 已有一個**每小時跑一次的雲端巡邏 routine**(claude.ai;唯讀 GET、不登入、會 `gh issue create`)⇒ **會叫的那條路已經存在**,缺的只是**一個它看得到的健康事實**。
- 🔴 **前提(主視窗轉述,我未親讀該 routine)**:巡邏跑在雲端、與被監控者**零共用基礎設施**、只打公開頁。**「零共用」這句我沒有自己驗證,標未確認** —— 但它若成立,`#231③` 我原本寫的「理由二(告警與被監控者共用 migration/wrapper/vault secret)」**在這條路上不成立**,而**理由一(告警條件全是『有壞資料』、沒有一條是『沒在跑』)仍然成立**,本規格正是補理由一。

---

## 1. 🔴 先講最重要的一件:**現在沒有 durable 的「sweeper 最後成功時間」**

**量法(可重跑;🔴 用 `pg_catalog` 不用 `information_schema` —— 見 §5 的坑)**:
```sql
SELECT count(*) AS ts_cols_total,
       count(*) FILTER (WHERE a.attname ~* 'last_(success|run|sweep|seen|beat)|heartbeat|ran_at|swept') AS heartbeat_like
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
   AND format_type(a.atttypid,NULL) LIKE 'timestamp%';
```
**實測**:`ts_cols_total = 97`(**正向對照:述詞抓得到東西**)/ `heartbeat_like = 1`,而那一個是 `product_fitments_effective_sync_log.ran_at` —— **別的 job 的**。

**逐一排除**(名字像但都不是 job 級心跳):

| 欄 | 為什麼不能用 |
|---|---|
| `payment_charge_attempts.last_poll_settle_at` / `last_expired_settle_at` | **per-row**,記的是「這一筆」何時被碰,不是「sweeper 這一輪跑完了」 |
| `payment_webhook_events.processed_at` | 🔴 **最像而最危險**:sweeper **健康但沒事做**時它不前進,**與 sweeper 死掉一模一樣** ⇒ **兩個世界同值,不可當心跳** |
| `net._http_response` | 我今天用的就是它,但 ①TTL **僅 6h** ②`anon` 有 **TRUNCATE/DELETE**(`E686-1`)⇒ **可被抹掉的稽核軌跡不能當健康來源** |

⇒ 🔴 **必須新增一個 durable 落點 ⇒ 這件事含 migration ⇒ 鐵則 12③(DB 結構)+ 鐵則 8。**

✅ **但有現成形狀可抄**:`product_fitments_effective_sync_log`(同庫、同 repo)
```
id bigint | ran_at timestamptz | status text | source_rows/staged_rows/orphan_rows/old_count/new_count int
note text | run_id uuid
```
⇒ **建議 `sweeper_run_log` 照這個骨架**:`ran_at` / `status` / 幾個 counts / `run_id`。**零 PII、零金額、零訂單編號。**
⚠️ 該表對 `anon` 是 `f`(實測)⇒ **新表也應對 `anon` 關閉**,端點走 server 側讀取(見 §3)。

---

## 2. 端點形狀

```
GET /api/health/settle-sweep        公開、不需 secret、回 JSON
```

**回什麼(🔴 只回事實,不回判斷)**:
```json
{ "lastSuccessAt": "2026-08-17T08:08:00.018Z", "secondsSinceLastSuccess": 132, "lastRunStatus": "ok" }
```

🔴 **不要回 `{ ok: true }`** —— 它在「剛跑完」與「兩天沒跑但服務還活著」**兩個世界一樣**。這正是本規格存在的理由。

### 🔴 門檻由【巡邏那邊】判,不由端點判

**理由**:端點自己判「我健康」= **被監控者替自己打分數**。端點只回**時間**,巡邏指令裡寫「超過 N 分鐘算異常」。

**N 的建議與推導(不是憑感覺)**:sweeper 排程 `*/2`(每 2 分)⇒ 正常間隔 2 分。要留的餘裕有三項:①單發 `503`(今天實測發生過一次、自行恢復)②退避造成的無事可做輪次(那些輪次**仍算成功**,見下)③巡邏本身**每小時**才跑一次。
⇒ **建議 `N = 15 分鐘`**(≈ 7 個排程週期)。**這是判斷不是量測** —— 上線後看誤報率再調。
⚠️ **「成功」的定義要寫死**:`status='ok'`(HTTP 200 且 `errors=0`)才更新 `lastSuccessAt`。**跑了但回 503 不算成功** —— 否則「一直在跑一直失敗」會被讀成健康。

---

## 3. 🔴 第 0 條:這個端點自己要有正向 + 反向對照

**巡邏怎麼分辨「端點回 200 但數字是假的」與「端點真的讀到 DB」?**

| 情境 | 端點**必須**回 | 為什麼 |
|---|---|---|
| 正常 | `200` + `lastSuccessAt` **有值** | — |
| **DB 讀不到 / 查詢 throw** | 🔴 **`503`,且 body 不含 `lastSuccessAt`** | **絕不可回 200 配一個舊值或預設值** —— 那會讓巡邏讀到一個「看起來新」的假數字 |
| 表存在但**零列**(還沒跑過) | 🔴 **`503`** 或 `200` + `lastSuccessAt: null` + `secondsSinceLastSuccess: null` | **不可回 `0`** —— `0` 秒會被讀成「剛剛才跑」,那是最壞的假綠 |

🔴 **明令**:
- **不得有任何預設值 / fallback / `?? Date.now()`**。查不到就是查不到。
- 🔴 **不得 blind spread `...result`**(`E680-1` 的形狀;本端點是**公開**的,blind spread 會讓未來新增的欄位**自動對外**)⇒ **顯式挑三個欄位**,照姊妹片 `email-sweep` 的 `pickCounts` allowlist 紀律。
- **零 PII、零金額、零訂單編號、零 `rec_trade_id`。** 只有時間、狀態字串、計數。

**巡邏側建議也帶一格正向對照**:同一輪順便打一個**已知該 200** 的公開頁(它本來就在打首頁)⇒ **端點 503 而首頁 200 ⇒ 是 sweeper 的問題;兩個都掛 ⇒ 是站或網路的問題。** 兩個世界分得開。

---

## 4. 快取與邊緣(容易漏的一格)

- 端點必須 `export const dynamic = 'force-dynamic'` + `Cache-Control: no-store`。
  🔴 **被 CDN 快取住的健康端點會永遠回同一個時間戳** ⇒ **sweeper 死了它照樣回「剛跑完」**。這是本族最典型的假綠。
- 建議巡邏端也帶 cache-buster query(`?t=<epoch>`),**兩道保險**。

---

## 5. ⚠️ 我在寫這份規格時自己踩的坑(留著,因為下一個人會踩同一個)

**第一版我用 `information_schema.columns` 掃「有沒有心跳欄」,得到 `0`。**
**而同一支查詢的正向對照 `timestamp_cols_total` 也是 `0`** —— 業務表明明每張都有 `created_at`。
⇒ 🔴 **`information_schema` 是【權限過濾】的**:`pcm_audit_ro` 對業務表無權 ⇒ 那些欄位**根本不出現**,不是「不存在」。
⇒ **那個 `0` 是量具造成的,不是事實。** 換成 `pg_catalog`(`pg_attribute`/`pg_class`,不過濾)之後 `ts_cols_total = 97`。

📌 **抓到它的是正向對照** —— 若我沒順手量那一格,我會寫出「全庫零心跳欄」而**理由是錯的**(結論碰巧仍對)。
📎 這是**同一天第二次**踩「量具因權限而少報」:第一次是 `has_table_privilege` **看不到欄級授權**(報價單庫 `products` 因此被漏掉)。
🔴 **判別句**:**我這支查詢,是不是用一個「會被我自己的權限過濾」的來源在數東西?** 是 ⇒ 換 `pg_catalog`,並**永遠附一格正向對照**。

---

## 6. 交付路徑(誰做什麼)

| 步 | 誰 | 做什麼 |
|---|---|---|
| 1 | 施工窗 | `sweeper_run_log` migration(照 `product_fitments_effective_sync_log` 骨架;對 `anon` 關閉)—— **鐵則 12③ + 鐵則 8,要 Sean 批** |
| 2 | 施工窗 | sweeper 每輪成功時寫一列(`status='ok'` 僅在 HTTP 200 且 `errors=0`) |
| 3 | 施工窗 | `GET /api/health/settle-sweep`,照 §2/§3/§4 |
| 4 | 主視窗 → Sean | 給他**要加進巡邏指令的確切文字**(含端點 URL、`N=15` 分門檻、以及「端點 503 而首頁 200 ⇒ 判 sweeper 問題」那條分辨規則) |
| — | **E(我)** | **只到這份規格為止**;唯讀,不實作、不改 code、不動 migration |

## 7. 口徑

「無 durable 心跳」= **量到的**(`pg_catalog` 全庫掃 + 正向對照 97)。「巡邏與被監控者零共用基礎設施」= **主視窗轉述,我未親讀該 routine ⇒ 未確認**。`N = 15 分鐘` = **判斷,非量測**。現成骨架 `product_fitments_effective_sync_log` 的欄位清單 = 當場查 `pg_attribute` 所得。
