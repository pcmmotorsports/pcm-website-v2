# codex R1 唯讀審查報告 · 部署時序閘 + trigger REVOKE

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md`(R1 稿)
> 🛑 **結論是「不可拿去建議改板」。** 兩個實質問題 R2 稿都修了:①我把「只警告不擋」的欄級檢查誤判成可靠防護 ②我把一個已被三處追蹤的失效包裝成新缺口。
> 逐條怎麼修見 plan 的 §5。主視窗 2026-09-09 定:純 .md 只跑 R1,不跑 R2。

---

121,449
1. **【nit】§1 足以支持「九對當下有效 EXECUTE 已撤除」，不足以支持「所有路徑都收乾淨」。**  
   [原稿:35](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:35)：一般角色繼承已納入有效權限判斷；schema USAGE 也不會把缺少的 EXECUTE 補回來。若確實查的是 `public` 下那三個零參數函式，別的 schema 同名函式不推翻這九對結果。

   **但存在兩把尺同時符合、仍能取得權限的反例**：角色不繼承 `postgres` 權限，卻能 `SET ROLE postgres`。此時原角色可回 `f`，ACL 仍只有 `{postgres=X/postgres}`，切換後卻取得權限。這是可能構造，**不是本次查到正式庫有這條路**；[專案既有規範:232](/Users/sean_1/pcm-mob/docs/patterns/revoking-function-execute-in-supabase.md:232)及 [PostgreSQL 官方文件](https://www.postgresql.org/docs/current/role-membership.html)均區分繼承與角色切換。

   沒找到 NULL ACL 對照組不必否決窄範圍結案；可以對同三支查 owner 的 EXECUTE 當正對照。兩把尺共用 ACL 資料，也不能稱完全獨立，更不能由 `proacl` 證明「曾明確 REVOKE」。建議保留該列結案，收窄「收乾淨」的範圍，附完整 SQL／schema／簽章。本次未重新連正式庫，九對讀數仍是作者提供的證據。

2. **【nit】§2③ 正文有誠實限定，但標題及改板建議把證據說大了。**  
   [原稿:70](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:70)承認無判別力，[原稿:79](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:79)也明說 blocked 反例引用昨天，這兩個限定正確。**今天量到的是相同摘要，不是今天重新證明「原本該擋卻放行」。**

   我核對當前兩顆 SHA，`apps/`、`packages/` 差異為空；[腳本:810](/Users/sean_1/pcm-mob/scripts/deploy-order-gate.sh:810)遇此直接跳過應用程式比對。這比「pending 相同」更直接解釋本次為何兩邊都零 blocked。pending 相同本身不能一般性推出 blocked 相同。

   因此 [原稿:117](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:117)的「複量仍在」應改成「本次手餵摘要仍無法辨識方向；會漏擋的反例引用 09-08」。正文限定沒有完整帶進準備貼板的句子。

3. **【nit】「第 726 行收尾摘要只列兩格」是真的；「失效②未被追蹤」是假的。**  
   我逐字核對 [launch-todo.md:726](/Users/sean_1/pcm-mob/docs/launch-todo.md:726) 的 `⟨已量 2026-09-09 · B⟩`：確實只有「①整表級抓不到」「②沒有構造真的擋」。這個②是缺口編號，**不是失效②**。

   但失效②已有三處記錄：同列前文、[第 2411 行 `db-PENDINGLISTUNSEEN`](/Users/sean_1/pcm-mob/docs/launch-todo.md:2411)、[第 2511 行 `db-DIRGATENOMECH`](/Users/sean_1/pcm-mob/docs/launch-todo.md:2511)。最後一列還明記「不擋」「今天不做機制」，另有 [決策文件:45](/Users/sean_1/pcm-mob/docs/decisions/2026-09-08-deploy-order-gate-bypass.md:45)。

   所以可建議的是**摘要補交叉引用與既有處置**，不能包裝成新發現的未列管缺口。[原稿:121](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:121)也接錯決策：GRANT 的甲乙題，沒有回答 stdin 方向防護要不要修。

4. **【must-fix】§2④「欄級那類的 0 blocked 現在是真的」不成立，會讓人誤信部署防護。**  
   [原稿:89](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:89)把抽取成功當成判定可靠。但現行 [腳本:1069](/Users/sean_1/pcm-mob/scripts/deploy-order-gate.sh:1069)明確把欄級命中放進 `COL_WARN`，不放進 `BLOCKED`；[腳本:1097](/Users/sean_1/pcm-mob/scripts/deploy-order-gate.sh:1097)在沒有其他阻擋時照樣 `exit 0`。**即使 pending 欄級 GRANT 被成功偵測，仍可印零 blocked 並放行。**

   另外，[腳本:783](/Users/sean_1/pcm-mob/scripts/deploy-order-gate.sh:783)只憑已套用的 `(表, 欄)` 豁免；先前新增過欄位，不代表這次授給特定角色的 UPDATE 權限已存在。

   「不同原因可能產生相同摘要」這個弱推論成立；「修過欄級後，混淆只剩整表級」不成立。stdin 餵反也不會因欄級 parser 修好而消失。必須把「欄級已修好」改成精確的**抽取已加入、下游只警告且有豁免盲區**。

5. **【nit】§3 有漏；「今天第五次」也沒有足夠可核對的四件證據。**  
   [原稿:95](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-grantgate-and-halfrevoke-plan.md:95)至少漏列：角色切換未排除、完整查詢未附、欄級只警告與豁免限制，以及撤權後既有 trigger 的功能回歸未驗。[migration:66](/Users/sean_1/pcm-mob/supabase/migrations/20260909020000_m4b_halfrevoke1_second_revoke_three_trigger_fns.sql:66)原本就保留最後這項。

   四個前例逐一核對：**ugrep** 有[來源紀錄:176](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:176)，本次 `/usr/bin/grep` 重跑確實命中 15，ugrep 本體未重現；**git commit 時間**有[自承錯誤紀錄:130](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:130)；**schema 閘**有[讀數紀錄:40](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:40)，但它是「EXECUTE 為 t 卻不可達」，不是「零被誤認沒事」；**版本號前綴當窗口尺**未找到作者實際踩過的獨立紀錄。不能據此確認恰好第五次，應補座標或刪掉精確次數。

不可：摘要少列一項屬實，但原稿漏掉既有追蹤與決策，更把只警告的欄級檢查誤判為可靠防護，須先修正才能拿去建議改板。
