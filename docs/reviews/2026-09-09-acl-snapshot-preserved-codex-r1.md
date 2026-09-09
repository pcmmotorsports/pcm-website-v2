# codex R1 唯讀審查報告 · ACL 快照保全抄本

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md`(R1 稿)
> 🛑 **結論是「不可當作日後唯一證據」。** 抄本的前兩項缺失(欄位省略、歸屬有反證)R2 稿已補齊;第三項(蓋章無法綁定受審快照)沒解決,只寫清楚 —— 修法要改函式,要 Sean 批。
> 🔴 它抓到我漏了 `supabase/APPLIED.tsv` 與 `~/pcm-mailbox/貼結果-*.log` 這兩份獨立紀錄,而它們推翻我一項歸屬、補上我漏掉的一支。
> 逐條怎麼修見抄本的 §5。主視窗 2026-09-09 定:純 .md 只跑 R1,不跑 R2。

---

92,674
1. **【must-fix】§2 的計數倍率正確，但「逐項對上」不成立。**

   [摘要函式定義](/Users/sean_1/pcm-mob/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql:93)確認：REL 每個符合篩選條件的 relation **4 列**；VIEWOPT 每個 view／materialized view **1 列**；FNCFG 每個函式簽章 **1 列**；FN 每個函式簽章 **4 列**。因此新建 `orders_deleted_log` 確實可解釋 REL +4，其索引、序列不算進 REL。

   [第 255 行](/Users/sean_1/pcm-mob/supabase/migrations/20260907070000_m4b_orders_delete_audit_trail.sql:255)確實建立指定 policy。但[抄本第 108 行](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:108)引用的 **9/8 09:24 UTC commit 只是補註解**；真正新增 SQL 的 commit 是 `1bf6fabb3`，時間為 **9/7 02:45 UTC**。貼 103 的成功 log 支持它在窗口內執行，卻因 `IF NOT EXISTS` 守衛，不能單憑成功就證明 policy 當次才首次建立。

   REL／VIEWOPT 名單另有錯放，見第 2 點。FN／FNCFG 的「5 新增＋5 取代」也不能推出淨增 6 個簽章；同簽章取代不增加列數。**倍率成立，不代表來源核對成立。**

2. **【must-fix】§3 的限定不足，而且漏找的独立紀錄直接推翻其中一項歸屬。**

   [抄本第 122–123 行](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:122)稱只有③有獨立佐證，實際三支都有帳本及成功貼入 log：

   | 物件 | 獨立紀錄 | 對窗口歸屬的影響 |
   |---|---|---|
   | ② `products_list_dealer` | [APPLIED.tsv:585](/Users/sean_1/pcm-mob/supabase/APPLIED.tsv:585)、[貼92 log:10](/Users/sean_1/pcm-mailbox/貼結果-92-20260907-223227-90487.log:10)，記錄 9/7 貼入、建好，接著 COMMIT、rc=0 | **早於窗口，不能再拿它解釋這次新增** |
   | ③ `pcm_net_exposure_snapshot` | [APPLIED.tsv:592](/Users/sean_1/pcm-mob/supabase/APPLIED.tsv:592)、[貼102 log:30](/Users/sean_1/pcm-mailbox/貼結果-102-20260908-171601-90015.log:30) | 支持 9/8 貼入 |
   | ④ `pcm_partial_refund_email_pending` | [APPLIED.tsv:588](/Users/sean_1/pcm-mob/supabase/APPLIED.tsv:588)、[貼97 log:9](/Users/sean_1/pcm-mailbox/貼結果-97-20260908-120518-87143.log:9) | 支持 9/8 貼入 |

   漏掉的候選是 [`20260907210000:60`](/Users/sean_1/pcm-mob/supabase/migrations/20260907210000_m4b_order_effective_amounts_v.sql:60)建立的 `pcm_order_effective_amounts_v`；[貼99 log](/Users/sean_1/pcm-mailbox/貼結果-99-20260908-150938-94340.log:2)記錄 9/8 `CREATE VIEW`、COMMIT、rc=0，可解釋缺的 REL +4／VIEWOPT +1。上述 migration 的目前檔案 SHA-256 均與帳本吻合。

   此外，**cron 只有一次執行紀錄，不能推出表在前一天才存在**；晚啟用排程或歷史紀錄不完整都可能造成相同結果。摘要只有族數與雜湊，也不能辨認「某物件昨天沒有、今天出現」。

3. **【must-fix】五列算術無問題，但「全表逐字保全」不完整。**

   已用程式逐列加總：

   | RECORD | 八族 n 加總 | row_count | 差額 |
   |---|---:|---:|---:|
   | 1 | 1370 | 1370 | 0 |
   | 2 | 1486 | 1486 | 0 |
   | 3 | 1541 | 1541 | 0 |
   | 4 | 1566 | 1566 | 0 |
   | 5 | 1615 | 1615 | 0 |

   **沒有加總抄錯的證據。**但[第 54–69 行](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:54)省略 RECORD 1–3 的全部族別 md5，共 **24 個值**；RECORD 3 的 `approved_note` 也只留節錄與省略號。

   原始資料消失後，無法還原這些欄位，也無法核查歷史批准理由全文。這是保全內容缺失，不能只把標題改成「摘要」就滿足唯一證據的用途。加總正確亦不能證明 digest、時間、批准文字均抄錄正確。

4. **【must-fix】§3 第 4 條仍然過度宣稱，且漏掉淨差與歷程的盲區。**

   [第 127 行](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:127)的「這 49 項我都找到了版控裡的對應物」，直接抵觸第 115 行「30 項未逐支對照」，也抵觸第 2 點查到的錯誤歸屬。

   **49 是淨增列數，不是全部變更項目數。**例如新增四個 relation，同時放寬十個既有 relation 的權限，REL 仍只增加 16；新增與刪除也可互抵。即使新增物件全有 migration，仍不能解釋變動族內所有 ACL 值的變化。

   [第 130 行](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:130)「三族是真的沒動」也過強：雜湊相同至多支持**兩次取樣的受測內容相同**，無法排除中間改過又改回。§3 必須明列這些限制，並撤回「49 項都有對應物」。

5. **【must-fix】§4 的「已鎖定 taken_at」目前只是文字，沒有操作保證。**

   [蓋章函式第 129–132 行](/Users/sean_1/pcm-mob/supabase/migrations/20260905170000_m4b_acl_drift_status_and_approve.sql:129)只更新 `max(taken_at)`，不接受指定時間或 digest。先查一次、把時間寫進 `p_note`，都不能綁定核准目標；執行前若最新列改變，就會蓋錯列。隔天再呼叫，也無法指定回頭蓋 RECORD 5。

   更漏掉[快照寫入函式第 252–258 行](/Users/sean_1/pcm-mob/supabase/migrations/20260905140000_m4b_acl_drift_digest_table.sql:252)：**同日重錄會覆寫 digest、families、taken_at，卻保留舊批准**。即使當下蓋對，後來不同內容仍可能沿用那個章。

   [第 137–139 行](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md:137)必須把指定時間與 digest 的核對、避免並發換列、不符即回滾列為實際前提；三句限定文字不能阻止錯誤批准。

**不可——抄本缺少原始欄位、來源歸屬已有反證，且建議的蓋章方式無法保證批准的是受審快照。**


