# codex R1 唯讀審查報告 · migration 20260909060000

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql`(R1 稿)
> 🛑 **結論是「不可交主視窗代貼」。** 兩個 must-fix 都修了,而第一個【當場重現過】:
> 　① `split_part(c,'"',1)` 只驗第一個引號前的字 ⇒ `search_path="\$user", public` 與 `search_path="SomeSchema"` 會被錯誤放行。
> 　　拋棄式實測:**舊寫法兩種都放行(f)、新寫法(整陣列比對)兩種都擋住**。
> 　⑤ 事後閘漏 `pronargs = 0`;而「別窗改了函式本體但保留設定 ⇒ 全綠而舊基底覆蓋新修正」這一格檔內閘擋不到 ⇒ 已寫進檔頭給代貼的人。
> 　④ rollback 檔原本沒有交易封套(自動提交下第一支成功、第二支失敗 ⇒ 只退一支)⇒ 已加 BEGIN/COMMIT,並把「不要貼」改成「僅供核准回復時執行」。

---

91,266
1. **【must-fix】合格值會通過，但非空 `search_path` 也可能被放行。**  
   位置：[正檔:84](/Users/sean_1/pcm-mob/supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:84)、[事後同款判斷:315](/Users/sean_1/pcm-mob/supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:315)。

   `unnest` 後的實際元素是 `search_path=""`；切第一個 `"` 得到 `search_path=`，所以 `ANY = true`、外層 `NOT = false`，**確實通過**。但同樣推導：

   | `proconfig` 元素內容 | 外層 `NOT` | 結果 |
   |---|---:|---|
   | `search_path=""` | false | 正確通過 |
   | `search_path=public` | true | 正確擋下 |
   | `search_path="$user", public` | false | **錯誤放行** |
   | `search_path="SomeSchema"` | false | **錯誤放行** |

   原因是它驗「第一個引號前的文字」，沒有驗完整值。這是依 PostgreSQL 的 [`split_part`](https://www.postgresql.org/docs/17/functions-string.html) 與 [`ANY`](https://www.postgresql.org/docs/17/functions-subquery.html) 語意推導，本輪未實跑 SQL。

   多個 `SET` 不會使子查詢報「多列」；任一元素匹配就通過。但**額外設定也會被忽略，接著遭 `CREATE OR REPLACE` 清掉**。若契約就是受審基底那個唯一設定，兩處可改用：
   ```sql
   p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   ```
   如此 NULL、其他路徑、額外設定都會擋下。

2. **【無問題】③、④的倍率與基底實際查詢一致。**  
   [基底:49](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:49) 的 REL 篩選只有 `public` 加 `relkind IN ('r','v','m','p')`；每個 relation 固定產生五列，沒有依權限有無過濾。

   [基底:57](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql:57) 的 FN **只有** `WHERE n.nspname = 'public'`，沒有 `prokind` 篩選。嚴格說，是 public 的每筆 `pg_proc` 記錄，包括一般函式、procedure、aggregate、window，再乘四。

   [事後閘④:334](/Users/sean_1/pcm-mob/supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:334) 計算的也是同一集合。正式庫從兩支變數百支，不會因此算錯；反而擅自加 `prokind = 'f'` 才會不一致。

3. **【無問題】兩次呼叫沒有快照寫入副作用，也未見需要阻擋貼板的負載問題。**  
   [正檔:322](/Users/sean_1/pcm-mob/supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:322)、334 呼叫的是 `digest()`；其本體只查 catalog、權限並聚合，**不執行被列舉的函式、不呼叫 `record()`、不寫快照或心跳**。

   既有 84–108 ms 讀數粗估兩次約 168–216 ms，但那是舊版、舊時點量測，不能當成本次正式庫延遲保證。它仍有 catalog 讀取與函式替換所需的鎖，可能等待並行 DDL；不能稱「完全無鎖」，但沒有逐張鎖住業務資料表的操作。一般讀取鎖也不排斥一般 DML。[PostgreSQL 鎖定規則](https://www.postgresql.org/docs/17/explicit-locking.html)

   合併成一次取出 `families` 可以省一次計算，屬 nit，不是貼板必要條件。

4. **【nit】放 `rollbacks/` 沒問題；「不要貼」確實應修，但另須遵守交易包覆。**  
   已逐位元組確認 rollback 與 evidence 基底相同。[rollback:5](/Users/sean_1/pcm-mob/supabase/rollbacks/20260909060000-rollback.sql:5) 的「不是 migration」合理，「不要貼」卻與用途矛盾，應改成「僅供核准回復時執行」。

   **檔案本身沒有 `BEGIN/COMMIT`**，只有 [第21行](/Users/sean_1/pcm-mob/supabase/rollbacks/20260909060000-rollback.sql:21) 註解提醒。必須照 plan 將兩段包在同一交易。若照註解中的原樣 `psql -f`、採預設自動提交，第一支成功、第二支失敗，就可能只退一支；語法驗證成功沒有證明失敗時的原子性。[psql 文件](https://www.postgresql.org/docs/17/app-psql.html)

   若要交付「整份直接執行」的 rollback，應把交易封套直接納入交付內容。

5. **【must-fix】還有基底核對與同名函式範圍兩個缺口；正向失敗回滾本身沒有半套寫入。**

   **基底核對不能省。** [plan:196](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md:196) 要求貼前比較現行定義，但 [正檔:64](/Users/sean_1/pcm-mob/supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:64) 只驗存在、`SECURITY DEFINER`、`proconfig`。別窗若修了函式本體、仍保留這些設定，全部閘門照樣通過，**舊基底會覆蓋新修正**。主視窗必須完成 plan 的定義比對；檔內綠燈不能代替它。比較對象應是同格式 `pg_get_functiondef`，不是整份 evidence 檔的雜湊。

   **事後查詢漏限零參數。** [正檔:311](/Users/sean_1/pcm-mob/supabase/migrations/20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:311) 沒有前置閘的 `p.pronargs = 0`。若存在合法的同名參數版、採 `SECURITY INVOKER` 或其他設定，這支交易會被無關函式誤擋。事後①也只按名稱查。應統一鎖定兩個零參數簽章。

   **回滾邊界正確：**正檔由第47行 `BEGIN` 包到第342行 `COMMIT`，事後例外沒有被吞掉，而且不呼叫 `record()`。完整執行時，閘門失敗會撤銷兩支替換，不會清批准或產生快照；若連線停在 aborted transaction，執行 `ROLLBACK` 再繼續。成功後應核對兩支完整定義、owner／ACL、設定與族數；`CREATE OR REPLACE` 會保留既有 owner／ACL。[PostgreSQL 文件](https://www.postgresql.org/docs/17/sql-createfunction.html) 不要為驗證而重錄或蓋章。

   本輪完成檔案與基底比對，未修改任何檔案、未連正式庫、未重跑作者的 PG 測試。

**不可——先修正 `proconfig` 誤放行與事後簽章範圍，並完成貼前基底比對及 rollback 同交易包覆，才能交主視窗代貼。**
