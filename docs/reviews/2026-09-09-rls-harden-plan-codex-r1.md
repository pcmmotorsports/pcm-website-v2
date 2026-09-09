# codex R1 唯讀審查報告 · RLS 收緊那一族 plan

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md`(R1 稿)
> 🛑 **結論是「不可拿目前清單作為收 BYPASSRLS 的決策依據」。** 本稿沒有推翻它,反而把它寫進 plan 的 §0 與 §7:清單是候選,決策前還缺一道行為驗證。
> 逐條怎麼修,見 plan 的 §9。主視窗 2026-09-09 定:純 .md 只跑 R1,不跑 R2。

---

已核對稿件、作者原始 SQL、板上原文與 PostgreSQL 官方文件；未重新量測正式庫，以下不把反例當成正式庫已存在的配置。

1. **【must-fix】§2 證明了命令與角色存在，還不足以判定前置條件完成。**  
   落點：[審查稿:74](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:74)、[審查稿:81](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:81)。

   **表名沒有對錯組**：[板上原文:679](/Users/sean_1/pcm-mob/docs/launch-todo.md:679)確實要求這三張表。但實際是四條 policy：兩張各 INSERT，staff 為 INSERT＋UPDATE。「三條」是原文本身的計數錯誤，單獨算 nit。

   真正缺的是 `polpermissive` 與完整合併後的條件。作者查三張表的逐條 SQL **沒有選取 `polpermissive`**。反例：`admin_sso_login_events` 唯一 INSERT policy 是 restrictive，即使角色正確、`WITH CHECK (true)`，沒有 permissive policy 仍不能插入。另一種反例是 permissive 放行，但適用的 restrictive policy 擋住。[PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)

   `WITH CHECK (true)` 若確為常數，**那個條件本身就是放行，不必靠正式庫試寫才能理解**；但 staff UPDATE 還要核對 `USING`，現行 [staff-repository.ts:67](/Users/sean_1/pcm-mob/apps/admin/src/lib/staff-repository.ts:67) 的 INSERT／UPDATE 又有 `.select()`，必須涵蓋 SELECT／RETURNING 所需的政策。應補齊上述證據，再判「原缺口已補」，不能只由 `polcmd＋polroles` 宣告不用做。

2. **【must-fix】§1、§4 的零列判準漏掉角色繼承，而且 owner 豁免也有相同漏洞。**  
   落點：[審查稿:43](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:43)、[審查稿:128](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:128)。

   **確實漏了。** 假設 `pcm_readonly` 可繼承 `reader_group`，表上只有 `TO reader_group USING (true)` 的 permissive SELECT policy。作者直接比對 OID 會算出 0；PG 卻會套用該 policy，收掉 BYPASSRLS 後仍讀得到。PG 實作呼叫的是 `has_privs_of_role`；SQL 查核應處理 PUBLIC，並使用 `pg_has_role(目標角色, policy角色, 'USAGE')`，不能用不區分可否繼承的 `MEMBER` 代替。[PG 原始碼](https://doxygen.postgresql.org/rowsecurity_8c_source.html)、[pg_has_role 說明](https://www.postgresql.org/docs/current/functions-info.html)

   owner 也不能只比較名字：**可繼承表 owner 權限的角色，在未 FORCE 時也可能豁免**。作者的 `tbl.owner = br.rolname` 會把這類角色誤算進零列清單。[PG owner 檢查實作](https://doxygen.postgresql.org/aclchk_8c_source.html)

   正確的有限結論是：一般 SELECT 確實受 RLS 約束、其他存取權限足夠，且沒有任何適用的 SELECT／ALL policy 時，會 default-deny。反方向則是「有 policy」仍可能因只有 restrictive、`USING false/NULL` 等原因零列。另經 view／SECURITY DEFINER 的存取須另查檢查身分，不能把直接讀表的判斷擴成「每一次查證」。**51／10／25／84 目前都不能當確定影響數。**

3. **【nit】§3 核心 PG 語意正確，但「全部沒起作用、第一次執行」說過頭。**  
   落點：[審查稿:90](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:90)。

   **若該表的 RLS 檢查身分確實是帶 BYPASSRLS 的 `service_role`，policy 就不會套用；FORCE RLS 也不會推翻這個豁免。** PG 先檢查 BYPASSRLS，才處理 owner／FORCE。[PG RLS 實作](https://doxygen.postgresql.org/rls_8c_source.html)

   但不能推成那些 policy 對所有路徑都沒作用：另一個 NOBYPASSRLS 角色可以繼承 `service_role` 的 policy 適用資格，**BYPASSRLS 屬性本身不隨一般權限繼承**；或存取經過 view／SECURITY DEFINER，改以其他身分檢查。[PG 權限實作](https://doxygen.postgresql.org/aclchk_8c_source.html)、[view 的 RLS 身分](https://www.postgresql.org/docs/current/sql-createview.html)

   今天的角色屬性也證明不了歷史上從未執行。應改成「本次未驗證移除 BYPASSRLS 後的政策行為」。此外，「兩列原文都沒講」不實：b9 原文已討論 service_role 的 BYPASSRLS。這些屬於範圍與文字修正。

4. **【must-fix】§5 三個方向只證明輸出有差異，沒有證明零列預測正確。**  
   落點：[審查稿:151](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:151)。

   同一套錯誤算法也能對不同角色給不同答案、認得直接 owner、分清命令別，卻照樣漏掉第 2 點的繼承。這是**分類分支有運作，不是結果已校準**。

   原始 SQL 的 `reads_zero_today` 仍只是數 policy，沒有真的以 anon 讀取資料。因此 anon 那發既不是已知應失敗的案例，也沒有提供行為對照。

   要支撐決策，至少應有受控環境中的已知非空資料，對照「無適用 policy → 零列」與「繼承 permissive policy → 可讀」，再涵蓋 owner／FORCE、restrictive-only。**不必在正式庫寫測試資料**；若尚未驗證，應把清單降為待核對候選，撤掉「真的會變零列」的標示。

5. **【must-fix】§6 的「下限、只會更多」不成立，也漏掉決策必需的限制。**  
   落點：[審查稿:166](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:166)、[審查稿:184](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-rls-harden-who-goes-quiet-plan.md:184)。

   第 2 點的繼承 policy、繼承 owner 豁免，都會造成**算進去，但實際不會少列**；原本就是空表也不會因收權而「變少」。因此目前數字可能高估，也可能低估，不能稱下限。

   還漏了三項：
   
   - **不一定安靜零列**：缺 schema USAGE 可能報權限錯誤；`row_security=off` 在需要套用 RLS 時會報錯，並非繞過。[PG RLS 說明](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
   - **`count(*)=0＋rolbypassrls=false` 分不開空表與被濾光**：兩種情況讀數完全相同。需要同一資料快照的可信基準，或已知存在的測試資料；收權前用仍帶 BYPASSRLS 的角色讀，也不能驗證收權後行為。
   - **漏回原關閉條件**：[板上原文:679](/Users/sean_1/pcm-mob/docs/launch-todo.md:679)明訂四個非 `security_invoker` view 必須逐支判定。新稿 §7 沒保留這項；這些路徑可能仍以 owner 權限讀資料，直接影響「收權是否達成預期」。[PG CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html)

不可：核心算法存在雙向誤判，policy 前置條件與驗證方法也未成立，不能拿目前清單作為收 BYPASSRLS 的決策依據。
