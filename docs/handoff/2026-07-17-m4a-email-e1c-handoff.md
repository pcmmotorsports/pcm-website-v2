# SESSION HANDOFF — 2026-07-17 M-4a Email 片:E1c(429 三分)全片收工已推,下一=E2a

> 一句話:本 session 目標本來是 E2a,**偵察中發現 Resend 額度缺陷 → 插入 E1c 兩片**(429 分類 + 合約落 migration),雙片皆收工**已 push**;E2a 未動工。
> 環境:pcm-website-v2 · Supabase prod(bmpnplmnldofgaohnaok)· branch dev · engineering mode。HEAD=`55365e6` = origin/dev。
> 🔴 **本檔 = E1c 當次快照,其「下一步/開工依據」字面已被 E2a-a 超越(2026-07-17)**——E2a 已由 Sean **Q12=A 拆三片**(E2a-a ✅ 已完成、下一=E2a-b);**仲裁序已是 §⑦ < §⑨ < §⑩**(§⑩=回收落點定案);**`reclaimStaleLeases` port method 已存在**(本檔下方「需新增 port method」= 已完成的未來式)。→ **開工入口以 `docs/handoff/CURRENT.md` 與 `STATUS.md`「下一步」為準**,本檔僅供 E1c 追溯。
> (原字面)接手先讀:`STATUS.md`「下一步」→ 本檔 → plan **v3.2** §3.5b/§3.6/§4.2 → migration `20260717020000` 頭註 ~~**§⑦+§⑨(漂移以 §⑨ 為準)**~~ **§⑦+§⑨+§⑩** → `packages/ports/src/IEmailOutbox.ts` 全檔 JSDoc。

## 1. 為什麼會插隊出 E1c(這片不在原 plan 裡)

Sean 問「下單量大時會不會撞限制」→ 查證 Resend:**Free = 100 封/日 + 3,000/月**,且 **429 有三種**(打太快 `rate_limit_exceeded` / 日額度 `daily_quota_exceeded` / 月額度 `monthly_quota_exceeded`),**只有 body 的 `name` 欄位能分辨**。原本 E1b 的 adapter 把所有 429 一律當 `http_429` → E2a 若對它做指數退避,**撞日額度會連燒 attempts 直到死信**(信永久寄不出)。E2a 開工前不修=E2a 得基於錯的錯誤碼設計退避 → 故先插 E1c。

## 2. 做了什麼(兩片,皆已推)

| commit | 內容 | push |
|---|---|---|
| `e90cbd3` | fix(storefront):E1c-1 解析 429 body 分辨限流與額度 | ✅ 已推 |
| `55365e6` | docs(schemas):E1c-2 退避三列+訊號 5 落 migration §⑨ | ✅ 已推 |

- **E1c-1(程式)**:`EmailSendErrorCode` 加 3 碼(`rate_limited` / `quota_daily_exceeded` / `quota_monthly_exceeded`);`ResendEmailSenderAdapter` **只在 status===429 時**讀 body 的 `name`;`SupabaseEmailOutboxAdapter` 的窮舉 flags 表同步(加碼會讓 typecheck 變紅=已實測)。測試 7→17。
- **E1c-2(合約)**:migration 頭註新增 **§⑨**(退避三列 + 訊號 5 + 訊號 1 述詞修正),**純註解、零 DDL**(該 migration 已 apply 於 prod,不可改 SQL;已用 diff 驗證零 SQL 變動)。
- 三綠 typecheck 8/8 + lint 10/10 + build 2/2;完整 vitest **221 檔 2371 綠**(baseline 2361 → +10)。

## 3. Sean 本 session 拍板(11 條,全已落檔)

| 題 | 拍板 | 落檔 |
|---|---|---|
| Q1 | 拆三片(E1c → E2a → E2a-2) | memory + STATUS |
| Q2 | lease 回收落 `failed` | memory + STATUS |
| Q3 | ineligible gate:**今日命中 0** | memory + STATUS + plan §5 |
| Q4 | 對帳下界走 env | memory + STATUS |
| Q5 | **暫不升 Pro**,系統告知額度不足我再升 | memory |
| Q6 | 429 三分 | memory + **程式碼法條** |
| Q7 | LINE 告警(已設定) | memory + migration §⑨ |
| Q8 | **退款線分兩段**(①後台取消+人工 SOP ②接 TapPay refund 等 checkout 開) | memory `project_refund-line-two-stage` |
| Q9 | monthly 比照 daily(每日告警) | memory + §⑨ + JSDoc |
| Q10 | E1c 再拆 E1c-1 + E1c-2 | memory + STATUS |
| Q11 | **未知 429 一律保守等 24h**(接受代價、精準版另開 #285) | memory + §⑨ + JSDoc + backlog #285 |

真權威 = memory `project_m4a-email-e2a-decisions`(Q1-Q11 全文 + Resend 事實 + E1c 審查紀錄)。

## 4. 🔴 誠實揭示(這兩條是風險、不是註腳)

1. **E1c 可能白做**:429 body 到底有沒有 `name` 欄位,**兩個官方 SDK 講的不一樣**(resend-node 透傳整包;resend-go 的 429 分支只解 `Message`、**無 Name**),我無法真的撞一次日額度來驗。**若真的沒有 → 不是「沒效果」,是所有 429 的信都白等 24h**(Q11=A 明示接受;精準版=backlog **#285** 讀 `Retry-After`)。
2. **死信沒有救援工具**(backlog **#286**):月額度撞牆連 5 天不理 → 那批信死掉,**系統會叫你但你沒有工具救**。

## 5. 開放項(E2a = 下一片、接手主工作)

sweeper route(復用 anomaly-alert 骨架 `vercel.json:11-14`)+ 對帳補寄(§3.5b 固定下界+NOT EXISTS)+ **dead-man 五訊號**(E1c 後是五、不是四)+ lease 回收 + failed 告警 + 單測。硬合約:

- 🔴 **照 `IEmailOutbox` port 用、勿自寫 SQL 繞過**(attempts guard / 世代柵欄 / claimed_at 清空已內建;繞過=作廢 8+2 輪審查成果)。
- 🔴 **lease 回收落 `failed`**(Q2=A)+ 退避 + `last_error_code='lease_reclaimed'`;**需新增 port method** —— 回收者不是 lease 持有者、手上沒有 `claimedAttempts`,現有 `mark*` 簽章接不上。這是**擴充 port、不是繞過 port**。
- 🔴 due 述詞與 CAS 述詞**都**要帶 `attempts < max_attempts`。
- 🔴 逐碼退避照 **§⑨ 三列**實作(quota_daily/monthly = 失敗時點 + ≥24h + jitter,**禁指數退避**;`http_429` 未知 = 比照 daily 保守長退避)。
- 🔴 **訊號 5(額度耗盡)走 LINE、不走 Email** —— Resend 額度耗盡時,用 Resend 寄告警會死鎖。訊號必須跑在**獨立管道**(anomaly-alert 每日 cron),**不可放進 sweeper**(不能自我監看)。
- ineligible:Q3=A **今日命中 0**;轉入必寫 `last_error_code='order_ineligible'` + 抑制路徑必附測試。
- composition:service_role client 窄 cast 為 `EmailOutboxClient`、`syntheticEmailDomain` 從 `line.ts:38` 注入;走 line-admin 式 server-only 模組(範例 `apps/storefront/src/lib/auth/line-admin.ts`)。
- 告警**零 PII**、response **counts-only**。
- 審查閘=code-reviewer + **codex 關卡2**(plan §5 明定、**不可省**)。

後續:E2a-2(對帳+訊號)→ E2b(pg_cron/pg_net/Vault)→ E3(order_created)→ E4。**部署順序不可調**(E2a 部署→Vercel secret→Vault 同值→db push E2b→驗→才 E3)。

🔴 **Sean 手動項(未動)**:`ORDER_EMAIL_FROM` 兩 project(E3 前)、pg_cron/pg_net 啟用+Vault secret(E2b 時)、E3/E4 肉眼驗。
**Q8 退款線第一段**(後台取消+SOP)= Email 線收完才開。

## 6. 這 session 最貴的教訓(接手請讀,會省你幾小時)

**程式碼 40 分鐘寫完,其餘時間全在修「我說的話跟事實不符」** —— 被抓 5 次、每次不同審查者:

1. 「PII 風險是零」→ 不是零(`res.json()` 會把整包 body 含 `message` 解進記憶體;「沒讀」≠「沒進來」)。改寫成「Sean 授權的**窄幅破例**」+ 誠實記殘餘風險。
2. 「改 5 個檔」→ 共用 `FetchLike` **沒有 `json()`**,10 分鐘就會撞牆、且很可能去擴張共用型別**波及 LINE 告警 adapter**。改用本地 `ResendFetchLike`。
3. 🔴 **原型鏈 Critical**(code-reviewer + codex **獨立雙命中**):物件字面量查表 `[name] ?? fallback`,攻擊者送 `{"name":"toString"}` → 拿到繼承來的函式 → `??` 不觸發 → errorCode **執行期不是 union 成員** → 下游 allowlist 改寫成 `provider_error` → 非保守退避 → 死信 = **重開這片要關的洞**。修法 `ReadonlyMap` + `.get()`;突變測試實測印出 `typeof errorCode === 'function'`。
4. 算術口徑混用 —— 是我**修 nit 時製造的新錯**。
5. 🔴 **`feedback_claimed-sync-but-only-patched-touched-lines` 第 5 次復發**:E1c-1 寫的 JSDoc(「本 JSDoc = 唯一定義處」「E1c-2 未落地前勿宣稱 migration 已是權威」)在 E1c-2 落地當下**全部變假**、形成閉環矛盾。memory 白紙黑字寫著「動合約前先 grep 全檔建舊字面清單、逐條銷完才准說已同步」,我還是只補了新的地方。

**可複用教訓(新)**:**把合約寫進「權威檔案」不夠,要寫進「讀者實際會走的路徑上」。** 我把新合約寫在 §⑨(第 146 行),但 §⑦ 結尾是收束句「四訊號…缺一即留盲區」—— 讀者沒理由再往下讀 24 行 → E2a 根本走不到 §⑨ → 訊號 5 永遠不會被實作。修法=在 §⑦ 收束句正下方放前向指標(已落地,見 migration:114-115)。

## 7. push 狀態與收尾自檢

**Sean 明說「push commit」→ 已推**:`origin/dev` = `55365e6`,本地零未推。`origin/main` 未動(storefront production 不含本線)。⚠️ **`dev` = pcm-admin 的 production 分支** → 本次 push 觸發 admin 重部署=預期,只帶未被引用的新零件、零行為變更。
凍結 dirty **19 件**(`.gitignore`/`docs/progress-roadmap.html`/`*.png`/`docs/handoff/2026-07-1*` 群/`docs/reviews/2026-07-16-*`/`docs/specs/2026-07-1*`/`docs/superpowers/`)原封未動 —— **接手不得 reset/stash/混入 commit**。secret 掃描:本檔+diff 零金鑰零連線字串。

~~**接手 1-2-3**:①讀 STATUS「下一步」+ 本檔 §4/§5 ②讀 plan v3.2 + migration **§⑦+§⑨** + `IEmailOutbox.ts` JSDoc + memory ③E2a 偵察 pass(anomaly-alert route 骨架 + **新 port method 簽章** + 訊號 5 落點)→ slice plan → 動工。~~ 🔴 **本節已由 E2a-a 執行完畢、字面過期**(偵察 pass 已做、slice plan Sean 已批 Q12/Q13、port method **已實作**;仲裁序已含 **§⑩**)→ **接手請改讀 `CURRENT.md`「下一個最小動作」**。

## 相關 plan / 記憶 / 文件

plan **v3.2**(`/Users/sean_1/pcm-tools/review-inbox/m4a-email-notify-plan.md`)、migration `supabase/migrations/20260717020000_m4a_email_outbox.sql`(§⑦+§⑨)、memory `project_m4a-email-e2a-decisions`(本 session 主紀錄)/`project_refund-line-two-stage`(Q8)/`project_m4a-email-e1a-decisions`(E1a+E1b)、backlog **#285**/**#286**、前交接 `docs/handoff/2026-07-17-m4a-email-e1b-handoff.md`(§5 的「四訊號」已被 §⑨ 超越為五訊號)。

— E1c 實作視窗(Claude Code),2026-07-17
