# codex R1 唯讀審查報告 · ACL 偵測器補兩處小改 plan

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md`(R1 稿)
> 🛑 **結論是「不可交給 Sean 批」。** 兩個實質問題 R2 稿都修了:
> 　① **rollback 檔原樣貼跑不起來**(`pg_get_functiondef` 輸出結尾沒有分號)—— 已補 `$function$;` 並在檔頭寫明那是我補的。
> 　② **「貼完順手蓋基線章」會錯誤批准** —— 替換函式不產生新快照,立刻 approve 蓋到的是今天那張有五族差異的舊列,而 Sean 已拍不蓋章。那句已刪。
> 逐條怎麼修見 plan 的 §9。主視窗 2026-09-09 定:純 .md 只跑 R1,不跑 R2。

---

103,237
1. **【無問題】改動 A 的 PostgreSQL 語法與名稱解析正確。**

   [基底 SQL:168](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:168)：表與被呼叫函式均有 `public.`；`d`、`t` 是區域別名，`EXCLUDED` 是 PostgreSQL 提供的新列參照。`taken_at` 與 `SET` 左側欄名不靠 `search_path` 查找，**不能為求完全限定而改成 `SET t.approved_at`**。PL/pgSQL 也沒有同名變數造成歧義。[INSERT 官方說明](https://www.postgresql.org/docs/17/sql-insert.html)

   `search_path = ''` 仍隱含搜尋 `pg_catalog`，因此 `now()`、`date` 等內建名稱可解析。兩個新增欄位允許 NULL；既有 UTC 日期唯一索引與 conflict expression 相符，沒有漏掉 partial-index 的 WHERE。[搜尋路徑官方說明](https://www.postgresql.org/docs/17/ddl-schemas.html#DDL-SCHEMAS-CATALOG)

   消費者確實會改變行為：[view:69](/Users/sean_1/pcm-mob/supabase/migrations/20260905170000_m4b_acl_drift_status_and_approve.sql:69) 將批准狀態轉成 false；[adapter:1646](/Users/sean_1/pcm-mob/packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:1646) 在「有漂移、未批准、未過期」時恢復告警。這符合目的。**即使 digest 完全沒變，同日重跑仍清章，可能重新觸發已批准差異的告警**；plan 已接受無條件清章，故不列 must-fix。`approved_note` 沒有被該 adapter 使用。

2. **【must-fix】改動 B 的 SQL 正確，但缺少角色存在的貼前條件。**

   [基底 SQL:20](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:20)：`g.rol` 用於七種表級權限查詢，並成為摘要列的 `priv`。下游沒有假設 REL 只能四個角色；[JSON 聚合:117](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:117) 按八個**族名**組裝，新增角色不會造成重複 key 或純量子查詢回多列。

   **`+96` 算對。** WHERE 只有 `public` 與 `relkind IN ('r','v','m','p')`，沒有按持有權限過濾。96 個 relation 各新增一列；沒有 SELECT 的 24 個也照算。

   但 `has_table_privilege('不存在的角色', …)` **會拋錯，不會回 false**。[PostgreSQL 原始碼](https://doxygen.postgresql.org/acl_8c_source.html)。今天的取樣支持 `pcm_readonly` 存在，這不是函式或重建環境的保證。若不存在，整支 digest／record 失敗，快照停止更新；保留中的舊快照不會立即顯示這次失敗。

   **貼前必須確認 `pg_catalog.to_regrole('pcm_readonly') IS NOT NULL`，不成立就停止。** 拋棄式驗證也必須明確準備該角色，不能把缺角色誤認為 JSON 問題。

3. **【must-fix】§3 的 rollback 原樣整份貼上跑不起來。**

   [基底 SQL:126](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:126) 是 `$function$`，**後面沒有分號**，第 129 行直接接第二個 `CREATE OR REPLACE`。本體內的 `FROM lines;` 在 dollar-quoted 字串裡，不能結束外層 CREATE。換行也不能分隔兩個 SQL statement，因此會在第二個 `CREATE` 附近發生語法錯誤。[SQL 分隔規則](https://www.postgresql.org/docs/17/sql-syntax-lexical.html)

   第 201 行同樣沒有外層分號；若它是整段輸入末尾，EOF 可以結束 statement，但追加斷言或 `COMMIT` 就不能依靠 EOF。**兩段結尾都應明確使用 `$function$;`，再將兩支包成同一交易。** 重複使用 `$function$` 沒有衝突，本體中也沒有提前關閉它的同名標記。

   [plan:92](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md:92)「直接貼就退回」不能保留。另外，這個 rollback **只還原函式定義**，不會恢復已被同日重錄覆蓋的快照或已清掉的批准資料；必須寫明這個界線。

4. **【must-fix】「隔天必然漂移」缺少時序前提，「順手蓋章」會消掉不該消的訊號。**

   [基底 SQL:107](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:107)：總 digest 是**所有族的原始摘要列，排序串接後做一次 md5**，不是把各族 md5 再合起來算；`row_count = count(*)`，等於各族 `n` 加總。

   在其他狀態不變時，A、B 只讓 REL 的內容及列數改變，總列數增加 96。**不會因為改了函式本體而改變 FN**：FN 只記簽章、EXECUTE 與 DEFINER；FNCFG 記 DEFINER 與 search_path，也應不變。

   [plan:72](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md:72) 的反例：今天貼完並手動 record，今天已是新版；明天再記相同新版，view 比較新版對新版，`有漂移 = false`。只替換函式、不重錄，才是下次成功取樣對舊版快照的情境。

   更危險的是第 73、159 行要求順手批准：**替換函式本身不會產生新快照**。立即呼叫 approve，批准的可能仍是今天原本未批准的舊列；[保全證據:108](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:108) 顯示它已有 `FN,FNCFG,POL,REL,VIEWOPT` 五族差異。即使先重錄，也不能把混入的其他變更全部歸給 `+96`。

   **刪除自動／順手蓋章指示**，與 [plan:119](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md:119)「Sean 已拍不蓋章」一致。預期的 REL 變更不能成為批准整張快照的理由。

5. **【must-fix】缺少能證明兩支函式真的正確替換、也真的還原的驗證安排。**

   [plan:95](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md:95) 的斷言只查 security 設定與 REL 列數。**只退 B、A 完全沒退，這些查詢仍全部符合期望**；而且 `SELECT` 加註解不會在不符時自動中止交易。

   最小必要補充如下：

   - **貼前比對精確的兩個零參數簽章及完整現行定義**，確認仍符合受審基底；核對 owner、ACL、`proconfig`、`prosecdef`、`provolatile`。函式若已被別窗修改就停止，避免舊基底覆蓋新修正。正常 REPLACE 保留既有 owner／ACL，但其他屬性依此次 SQL 重設。[CREATE FUNCTION 官方說明](https://www.postgresql.org/docs/17/sql-createfunction.html)
   - **正向與反向各自同一交易完成**，不拆兩次提交。避開已在執行的 `pcm-acl-digest` 與人工 record／approve；已開始的呼叫不能當成新版驗證。排程呼叫點在 [migration:314](/Users/sean_1/pcm-mob/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql:314)，record 又會呼叫 digest 兩次並寫心跳。
   - **在拋棄式庫實跑正向、同日衝突分支與 rollback**：確認批准兩欄清空、一天仍一列、八族齊全、REL 為當場 relation 數乘五、其餘七族不變、總列數增加當場 relation 數；rollback 後兩支完整定義均符合基底。正式貼後也要核對新版定義及實際 digest，不能只看 CREATE 成功。
   - **既有 parity 綠燈不能作本次證據**：[腳本:61](/Users/sean_1/pcm-mob/scripts/acl-digest-parity.sh:61) 抽取的是舊 migration 本體，沒有呼叫線上新版；另一邊的快照腳本也仍是四角色。兩個舊演算法可以一起通過，完全沒驗到 B。此處只需明確排除這種驗證宣稱，不要求擴修腳本。

以上完成全文靜態審查及 PostgreSQL 官方語意核對；未修改檔案、未執行 SQL、未重查正式庫。view 依 repo 定義核對，兩支函式依你指定的線上基底判讀。

**不可——rollback 目前無法整份執行，且順手蓋章會錯誤批准尚未釐清的漂移；先修這兩項與驗證缺口。**


