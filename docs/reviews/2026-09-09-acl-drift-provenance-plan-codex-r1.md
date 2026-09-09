# codex R1 唯讀審查報告 · ACL 漂移 + 權限值出處 plan

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-acl-drift-and-provenance-plan.md`(R1 稿)
> 🛑 **結論是「不可 —— 直接更新板子會把未驗證的權限保護寫成已完成」。** 本稿沒有推翻它:「甲已做完」已收窄成「碼上通了」、差集數字已收回、蓋章流程已改寫。
> 🔴 本輪它從偵測器原始碼挖出【三個板上兩列都沒講的洞】,我逐個核過 —— 見 plan 的 §4-B。
> 逐條怎麼修見 plan 的 §9。主視窗 2026-09-09 定:純 .md 只跑 R1,不跑 R2。

---

本輪未重連正式庫；以下結論來自原檔、Git 紀錄、程式實作與不寫檔的驗證。正式庫讀數未獨立複量。

1. **【nit】題幹存在的結論成立；「前人為什麼漏掉」沒有證據。**

   已核對[佇列第 424 行](/Users/sean_1/pcm-mailbox/端Sean-0905早上佇列.md:424)：去除清單、引文前綴及作者新增的粗體後，**轉錄逐字相同**。題幹、甲乙、代價與推薦均在，未見截斷造成意思改變。

   檔案時間都是台灣時間：建立於 **9/6 23:37:02**，mtime／ctime 都是 **9/8 01:40:16**。因此本機檔案時間支持「9/9 早上已存在」，不支持「今天才產生」。但 `pcm-mailbox` **不是 Git repository**，沒有版本紀錄能獨立證明歷史內容。

   我以完整 `Q-權限偷改偵測` 搜尋相同範圍，得到 **9 個檔；排除待審文件自己，恰為 8 個**。不過前人的原始命令、搜尋字串與排除條件均未附；「4 處」和「8 個檔」連計量單位都不同。[§2:54–55](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:54)只能寫「前次結果未涵蓋現存原題」，不能斷定搜尋失敗原因。

2. **【must-fix】「甲兩半都做完」證據不足，限定句救不了主結論。**

   [§3:73–78](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:73)證明了本機程式有接線；那 **4 次成功是 `pcm-acl-digest` 的取樣工作，不是 `pcm-anomaly-alert` 的寄信工作**。

   作者漏查了幾個現成關鍵點：

   - 真正讀取者是 **`payment_confirmer`**，見 [composition.ts:215](/Users/sean_1/pcm-mob/apps/storefront/src/lib/payment/composition.ts:215)。`pcm_readonly` 讀得到，不能證明告警端讀得到。補授權的 migration 在 [20260906970000:85](/Users/sean_1/pcm-mob/supabase/migrations/20260906970000_m4b_anomaly_reader_grants_payment_confirmer.sql:85)，應核對正式庫該角色的有效權限。
   - [route.ts:269](/Users/sean_1/pcm-mob/apps/storefront/src/app/api/cron/anomaly-alert/route.ts:269)允許停用時回 **200**；[composition.ts:302](/Users/sean_1/pcm-mob/apps/storefront/src/lib/payment/composition.ts:302)也允許只有 LINE 管道成功建構。因此即使路由成功，也未必有 Email。
   - 這封告警由 [EmailAlertNotifierAdapter.ts:55](/Users/sean_1/pcm-mob/packages/adapters/src/payment/EmailAlertNotifierAdapter.ts:55)直接呼叫 Resend，**不經 `email_outbox`**。§6 建議補查 outbox 找錯載體。
   - 「查不到」是 log／503，**不是直接進告警信**，見 [route.ts:545](/Users/sean_1/pcm-mob/apps/storefront/src/app/api/cron/anomaly-alert/route.ts:545)；持續失敗可能另外經心跳告警。

   应補量告警 cron 的排程、目標，以及可取得的 HTTP 回應中 `enabled`、`aclDriftDetected`、`alerted`、`notifiersTotal`、`notifiersFailed`；不能只看 cron 的 `succeeded`。現階段應判「取樣已有執行證據；寄信程式已實作，正式執行與 Email 管道未驗證」，不能據此撤銷完成驗收。

3. **【nit】「正對照也變了，所以閘沒掉」推論無效；但我補查後，保留接線的結論有支持。**

   [§1:33](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:33)的兩個計數，不能排除「兩道閘一起被拿掉」。真正的歷史證據是 **`b4f683a75`，9/9 10:58:39 +08:00**：它確實重寫 pre-commit、移除 status-owner，並保留 ACL 閘。

   我另確認 `core.hooksPath=.husky/_`、入口存在、[pre-commit:20](/Users/sean_1/pcm-mob/.husky/pre-commit:20)接到薄殼及 Python。實跑 **73 個純記憶體案例，73 PASS／0 FAIL**；薄殼注入回傳碼 **0／1／2，均原樣傳出**。

   因此可寫「接線保留，判斷核心及錯誤傳遞已驗證」。未執行完整 commit 流程及會建立暫存 Git repo 的自測，不能宣稱整條 commit 路徑已實測。

4. **【must-fix】`60/72` 不能直接使用：來源集合混入不同授權層級，也沒有真正做差集。**

   [§5:132–142](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:132)沒有附解析器原碼、完整命令與輸出清單，無法確認它如何處理多角色、字串、ADP 或動態 SQL。

   我用「剝註解＋分號切割＋具名 GRANT」重現出 **13 個名稱**，其中除了 schema，還包含：

   - **函式 EXECUTE**：[20260908120000:148](/Users/sean_1/pcm-mob/supabase/migrations/20260908120000_m4b_authprov1_provider_of_users.sql:148)。
   - **兩張表的欄級 SELECT**：[20260906380000:147](/Users/sean_1/pcm-mob/supabase/migrations/20260906380000_m4b_pcm_readonly_column_grants.sql:147)。

   這三項不能當成線上 `relacl` 表級 SELECT 的來源扣掉。**13 扣掉 schema 後，不等於 12 個同口徑交集**；目前只剩 9 個表級候選，仍須與線上名單逐筆相交，不能直接另宣布一個修正數字。

   解析器還必須證明：能辨認 `TO anon, authenticated, service_role` 中非第一順位角色；不把 ADP 當既有物件授權；不把 [RAISE WARNING 字串](/Users/sean_1/pcm-mob/supabase/migrations/20260901170000_m4b_pfe_ddl_into_version_control.sql:265)當執行敘述；動態組字遇到不明物件時標「未解析」。正對照有數字只能證明會命中，不能證明沒有漏抓或多抓。

   另外，原文「單行 grep 因跨行而兩角色都得 0」也不可重現：本樹同模式命中 **15／231 行**，包含註解，且確實存在單行授權。應追查實際命令或搜尋範圍，不能把原因直接歸給跨行。

5. **【must-fix】批准建議缺少保全與鎖定對象；「不刪列，所以蓋錯沒關係」不成立。**

   [§7:178–181](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:178)聲稱的「建表註解逐字」未找到；[實際建表註解](/Users/sean_1/pcm-mob/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql:58)沒有那句話。

   [批准函式:129](/Users/sean_1/pcm-mob/supabase/migrations/20260905170000_m4b_acl_drift_status_and_approve.sql:129)確實只更新批准欄位，不改 digest；但它會：

   - **覆寫既有批准時間與理由**，沒有保留修訂歷程。
   - 每次取 `max(taken_at)`，沒有綁定已審查的時間與 digest；審查後若新增快照，可能蓋到另一張。
   - 讓 [adapter:1646](/Users/sean_1/pcm-mob/packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:1646)將漂移告警判為 false。

   所以原始 digest 留存，不代表批准證據完整，也不代表錯誤批准不會壓掉告警。「大機率是自己貼的」僅凭五個族名無法支持；正常 migration 和未授權變更都可能動到那些族。

   建議須改成：先保全待核快照與原批准欄位，核對實際變更及適用批次，再由具批准權限者對**已鎖定的快照**操作。SELECT 權限不等於批准函式的 EXECUTE 權限。

6. **【must-fix】七條限制之外，至少還漏了三個會直接推翻「留著就守住」的行為。**

   **未批准漂移不會持續掛著。** [view:69、93](/Users/sean_1/pcm-mob/supabase/migrations/20260905170000_m4b_acl_drift_status_and_approve.sql:69)只比最新與前一列。若三天摘要為 `A → B → B`，第二天有漂移、第三天沒有；即使 B 從未批准也是如此。若第二天寄送失敗，第三天不會因這筆舊漂移再寄。這也推翻 [§7:179](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-acl-drift-and-provenance-plan.md:179)「明天 diff 會疊在未核基線上」的描述。

   **同一天重錄可能沿用舊批准。** [record 函式:254](/Users/sean_1/pcm-mob/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql:254)覆寫當天的 digest、族摘要和時間，卻未清除批准欄位。因此「批准 A → 權限變成 B → 同日重錄」可能讓 B 帶著 A 的批准而不告警。

   **偵測範圍還缺欄級權限與 `pcm_readonly`。** [digest:91–107](/Users/sean_1/pcm-mob/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql:91)只列四個應用角色、讀表級權限，沒有涵蓋 `pcm_readonly` 的 public 表級授權及 `attacl` 欄級授權。這些變更即使永久留著，也可能不變更摘要；缺口不只「改回去」及 DEFACL 射程外。

   這些都能從現有程式查出。另，作者列為「追不回」的唯讀授權，其具名 migration 已在 [20260908110000:141](/Users/sean_1/pcm-mob/supabase/migrations/20260908110000_m4b_aclro1_grant_readonly_acl_tables.sql:141)；尚缺正式套用時間的佐證，不能寫成連候選出處都不存在。

**不可：題幹存在可採用，但寄信完成、60/72 差集及批准安全性的判定不足，直接更新會把未驗證的權限保護寫成已完成。**


