# codex R2 唯讀審查報告 · ⟦tidy-NETPUBLICALL⟧ plan

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md`(R1 稿)
> 🛑 **結論是「不可交給老闆拍板」。主視窗 2026-09-09 裁不跑 R3** —— 卡點是面板那一格設定,不是稿子的措辭。
> 逐條怎麼修,見 plan 的 §8。R1 報告原檔留在 scratchpad 未進版控(它已被 §8 完整轉述)。

---

依第一輪完整意見、修訂稿及官方原始碼核對；本輪未重跑正式庫量測，未修改檔案。

**A．§7 修正核對**

| 第一輪 must-fix | 判定 | 核對結果 |
|---|---|---|
| ① DB 授權被寫成外部攻擊成立 | **部分修｜must-fix** | §0、§6 已區分兩層；但 [plan:11](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:11) 仍稱「鏈路完整、這是量到的」，[plan:102](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:102) 又把暴露 `net` 直接推成能對外發請求。函式完整執行條件仍未補齊。 |
| ③ 移除 schema 的影響與前後矛盾 | **已修｜無問題** | [plan:119](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:119) 已補後端、外部整合、service-role、預設 schema 順序與原位置還原；已掃／未掃的矛盾消除，repo 外的限制也有揭露。 |
| ④ 嚴重度、TRUNCATE、佇列憑證 | **部分修｜must-fix** | TRUNCATE 的介面混淆已修；[plan:40](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:40) 已補憑證程式路徑，且未冒稱外洩。但 §3「沒有間接入口」及 §4「只差面板這格」仍超出證據。 |
| ⑤ 事件、函式條件、間接入口、錯誤掃描 | **部分修｜must-fix** | 已補觸發時機、版本、`prosecdef` 與錯誤格式；但 [plan:154](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:154) 稱「全部補量」不成立：sequence、完整函式定義及 trigger／相依路徑仍沒有交代，版本解讀另添錯誤。 |

**B．新增內容**

1. **must-fix｜`prosecdef=f` 加 INSERT，不足以證明鏈路完整。**  
   [plan:26](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:26)、[plan:31](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:31)：直接由 anon 呼叫時使用 anon 權限，這部分正確；但佇列的 `bigserial` 會用到 sequence，`nextval()` 另外需要 sequence 的 **USAGE 或 UPDATE**，表格 INSERT 不包含它。三支函式還會呼叫編碼 helper、`net.wake()`，也需要相應 EXECUTE。缺一項就可能在內部失敗。[PostgreSQL sequence 權限](https://www.postgresql.org/docs/current/functions-sequence.html)、[pg_net 0.20.0 原始碼](https://github.com/supabase/pg_net/blob/v0.20.0/sql/pg_net.sql)。

   `search_path` 應核對正式定義與 `proconfig`，但不能反過來臆測它一定有問題：上游對佇列表與 net helper 已使用完整 schema 名稱。上游也確實授予 PUBLIC sequence 權限；**缺的是本稿的完整證據，不是已證實本庫缺權限。**

2. **must-fix｜版本分支讀對，安全結論讀錯。**  
   [plan:76](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:76)：0.20.0 不在清單，所以舊版分支不跑，成立。但該分支同時修改 SECURITY DEFINER、search_path，而且 **REVOKE PUBLIC 後立即 GRANT EXECUTE 給 anon 等角色**；它不是「阻止 anon」的分支。註解也不能推出「0.12+ 應已撤掉 PUBLIC，而本庫異常」。[平台完整定義](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql)。

   0.20.0 上游本來就公開表格、sequence，三支函式採 invoker；Supabase 官方的隔離說明則建立在 `net` 未暴露於 Data API。因此 [plan:78](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:78)「平台假設在本庫不成立」及 §5「版本條件缺口」沒有成立。[官方權限說明](https://supabase.com/docs/guides/database/extensions/pg_net#permissions)。

   另外，schema GRANT 只是**不受版本條件限制**，外層仍要求這次事件涉及 `pg_net`；不是每次 `CREATE EXTENSION` 都重授。

3. **nit｜六小時是引用的預設值，沒有證明是本庫有效保留設定。**  
   [plan:36](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:36)：第一輪已提供「預設六小時」及官方來源；本稿新增的是沿用該說法，所列親測仍只有 468 列與 5h58m 跨度。**沒有標「未親測本庫 TTL」**，反而寫成「正確講法＝滾動最近六小時」。

   官方預設確實是六小時，但可以設定；跨度吻合只能支持推測。應改成「當時保留的 468 列；官方預設六小時，本庫有效 TTL 未核對」。無須為此碰回應內容。[官方設定說明](https://supabase.com/docs/guides/database/extensions/pg_net#configuration)。

4. **nit｜support 的授權閘足夠，但各章指令不一致。**  
   [plan:128](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:128) 明列 Sean 決定是否開單及由誰開，**就計畫階段足夠**；不代表現在已授權送出。

   但 [plan:105](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:105) 寫「並開一張」，第 125 行又寫「兩種答案都要做」。應統一成「建議開單，待 Sean 決定」，避免把回答「沒有 net」誤當開單授權。開單授權也不等於正式庫修改授權。

5. **must-fix｜新寫的「沒有間接入口」仍然證過頭。**  
   [plan:83](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:83)：`prosrc` 搜尋 `net.http` 不涵蓋直接讀 `net._http_response` 的 RPC；也未交代第一輪要求的 trigger 與遞迴相依路徑。例如 anon 修改某張可寫表，觸發 SECURITY DEFINER trigger，再呼叫 cron wrapper，不能只靠 anon 對 wrapper 的 EXECUTE=f 排除。

   這些缺口不全是動態 SQL。應寫「所列搜尋未發現入口」，不能據此把面板列為唯一未確認條件。

6. **must-fix｜「所有 DB 修法不可能」被搬到 §5。**  
   [plan:127](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:127) 又稱 support 是「唯一」能動 DB 的路，與第 67 行承認未排除管理入口直接矛盾。可推薦 support，但只能稱「目前已識別的求助途徑」，不能把未查證的替代路徑判死。

不可：仍把未完成的執行與可達性證據寫成定論，且誤讀平台版本分支，會讓老闆依錯誤前提拍板。
tokens used
70,363
依第一輪完整意見、修訂稿及官方原始碼核對；本輪未重跑正式庫量測，未修改檔案。

**A．§7 修正核對**

| 第一輪 must-fix | 判定 | 核對結果 |
|---|---|---|
| ① DB 授權被寫成外部攻擊成立 | **部分修｜must-fix** | §0、§6 已區分兩層；但 [plan:11](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:11) 仍稱「鏈路完整、這是量到的」，[plan:102](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:102) 又把暴露 `net` 直接推成能對外發請求。函式完整執行條件仍未補齊。 |
| ③ 移除 schema 的影響與前後矛盾 | **已修｜無問題** | [plan:119](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:119) 已補後端、外部整合、service-role、預設 schema 順序與原位置還原；已掃／未掃的矛盾消除，repo 外的限制也有揭露。 |
| ④ 嚴重度、TRUNCATE、佇列憑證 | **部分修｜must-fix** | TRUNCATE 的介面混淆已修；[plan:40](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:40) 已補憑證程式路徑，且未冒稱外洩。但 §3「沒有間接入口」及 §4「只差面板這格」仍超出證據。 |
| ⑤ 事件、函式條件、間接入口、錯誤掃描 | **部分修｜must-fix** | 已補觸發時機、版本、`prosecdef` 與錯誤格式；但 [plan:154](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:154) 稱「全部補量」不成立：sequence、完整函式定義及 trigger／相依路徑仍沒有交代，版本解讀另添錯誤。 |

**B．新增內容**

1. **must-fix｜`prosecdef=f` 加 INSERT，不足以證明鏈路完整。**  
   [plan:26](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:26)、[plan:31](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:31)：直接由 anon 呼叫時使用 anon 權限，這部分正確；但佇列的 `bigserial` 會用到 sequence，`nextval()` 另外需要 sequence 的 **USAGE 或 UPDATE**，表格 INSERT 不包含它。三支函式還會呼叫編碼 helper、`net.wake()`，也需要相應 EXECUTE。缺一項就可能在內部失敗。[PostgreSQL sequence 權限](https://www.postgresql.org/docs/current/functions-sequence.html)、[pg_net 0.20.0 原始碼](https://github.com/supabase/pg_net/blob/v0.20.0/sql/pg_net.sql)。

   `search_path` 應核對正式定義與 `proconfig`，但不能反過來臆測它一定有問題：上游對佇列表與 net helper 已使用完整 schema 名稱。上游也確實授予 PUBLIC sequence 權限；**缺的是本稿的完整證據，不是已證實本庫缺權限。**

2. **must-fix｜版本分支讀對，安全結論讀錯。**  
   [plan:76](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:76)：0.20.0 不在清單，所以舊版分支不跑，成立。但該分支同時修改 SECURITY DEFINER、search_path，而且 **REVOKE PUBLIC 後立即 GRANT EXECUTE 給 anon 等角色**；它不是「阻止 anon」的分支。註解也不能推出「0.12+ 應已撤掉 PUBLIC，而本庫異常」。[平台完整定義](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql)。

   0.20.0 上游本來就公開表格、sequence，三支函式採 invoker；Supabase 官方的隔離說明則建立在 `net` 未暴露於 Data API。因此 [plan:78](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:78)「平台假設在本庫不成立」及 §5「版本條件缺口」沒有成立。[官方權限說明](https://supabase.com/docs/guides/database/extensions/pg_net#permissions)。

   另外，schema GRANT 只是**不受版本條件限制**，外層仍要求這次事件涉及 `pg_net`；不是每次 `CREATE EXTENSION` 都重授。

3. **nit｜六小時是引用的預設值，沒有證明是本庫有效保留設定。**  
   [plan:36](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:36)：第一輪已提供「預設六小時」及官方來源；本稿新增的是沿用該說法，所列親測仍只有 468 列與 5h58m 跨度。**沒有標「未親測本庫 TTL」**，反而寫成「正確講法＝滾動最近六小時」。

   官方預設確實是六小時，但可以設定；跨度吻合只能支持推測。應改成「當時保留的 468 列；官方預設六小時，本庫有效 TTL 未核對」。無須為此碰回應內容。[官方設定說明](https://supabase.com/docs/guides/database/extensions/pg_net#configuration)。

4. **nit｜support 的授權閘足夠，但各章指令不一致。**  
   [plan:128](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:128) 明列 Sean 決定是否開單及由誰開，**就計畫階段足夠**；不代表現在已授權送出。

   但 [plan:105](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:105) 寫「並開一張」，第 125 行又寫「兩種答案都要做」。應統一成「建議開單，待 Sean 決定」，避免把回答「沒有 net」誤當開單授權。開單授權也不等於正式庫修改授權。

5. **must-fix｜新寫的「沒有間接入口」仍然證過頭。**  
   [plan:83](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:83)：`prosrc` 搜尋 `net.http` 不涵蓋直接讀 `net._http_response` 的 RPC；也未交代第一輪要求的 trigger 與遞迴相依路徑。例如 anon 修改某張可寫表，觸發 SECURITY DEFINER trigger，再呼叫 cron wrapper，不能只靠 anon 對 wrapper 的 EXECUTE=f 排除。

   這些缺口不全是動態 SQL。應寫「所列搜尋未發現入口」，不能據此把面板列為唯一未確認條件。

6. **must-fix｜「所有 DB 修法不可能」被搬到 §5。**  
   [plan:127](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-netpublicall-anon-can-reach-pg-net-plan.md:127) 又稱 support 是「唯一」能動 DB 的路，與第 67 行承認未排除管理入口直接矛盾。可推薦 support，但只能稱「目前已識別的求助途徑」，不能把未查證的替代路徑判死。

不可：仍把未完成的執行與可達性證據寫成定論，且誤讀平台版本分支，會讓老闆依錯誤前提拍板。
