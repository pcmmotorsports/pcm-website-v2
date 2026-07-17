# M-4a Email 通知片 — slice plan **v3.3**(2026-07-16 深夜規劃 / 2026-07-17 E1a·E1c·E2a-a 增補)

> 🔴 **v3.3(2026-07-17,E2a-a;Sean 拍「搬進 repo」)= 本檔已從 `pcm-tools/review-inbox/` 遷入本 repo `docs/specs/`。**
> **為何搬**:本檔是 Email 整條線的 plan 真權威,原處 **untracked = 無版控、無歷史、無備份**,
> 且**無法與 code 同 commit 同步** → E2a-a 因此被抓 must-fix(plan 留舊字面、commit 帶不進去)。
> 遷入後:plan 改動與 code **同 commit 落地**,「E2a-b 動工前同步 plan」的硬前置**就此消滅**。
> **舊路徑 `pcm-tools/review-inbox/m4a-email-notify-plan.md` 已改為指標 stub、不得再視為權威。**
>
> 🔴 **v3.3 內容更正(三處舊字面,皆由 Sean Q2=A / Q12=A / Q13=A 推翻;E2a-a 三審抓出)**:
> ①**lease 回收落 `failed`、不是 `pending`**(§3.5-4/§3.6 原字面已作廢)②**E2a 已拆三片** a/b/c(§5)
> ③**E2a 三片皆不做告警**(§5 原「E2a + failed 告警」字面**作廢**——與 §3.6「不可自我監看」紅字打架)。
>
> 🔴 **漂移仲裁序(v3.3 明確化)**:**§⑦ < §⑨ < §⑩**(皆指 migration `20260717020000` 頭註)。
> 本 plan 與 migration 漂移 → **以 migration 為準**;migration 內部:退避/訊號 1、5 依 **§⑨**;
> **lease 回收落點 / attempts 遞增時機 / 訊號表盲區依 §⑩**。

> 🔴🔴 **v3.1 增補(2026-07-17,E1a 實作視窗;Sean 拍 Q2=A「plan 是真權威、合約要寫回來」)**
> E1a 已實作,經 **8 輪審查**(code-reviewer×2、codex 關卡2×5、Fable 對抗審×3〔皆以拋棄式 PG 逐字實測〕)。
> **Sean 07-17 override**:codex「每片硬上限 2 輪」規則本次由他明示放寬。
>
> **改動節(E1b/E2a/E4 開工前必讀)**:
> · **§3.4** — 🔴 **Q1 線紅線**:兩個 `skipped_*` 態語意相反,嚴禁 pattern-match `skipped%`
> · **§3.5-1** — CAS 字面是**論證記錄、不是可複製的實作**(缺 attempts guard)
> · **§3.5-3** — 唯一鍵 `(event_type, order_id)` **已作廢** → `(event_type, dedup_key)`
> · **§3.6** — dead-man **五訊號**合約(v3.2:E1c-2 增補訊號 5 額度耗盡 + 修正訊號 1 述詞)+ REQUIRED-E2a(含雙向 claimed_at 的兩條 app 義務)
> · **§3.6/§4** — `failed` **不是終態**(終態界線在 `attempts >= max_attempts`)
> · **§4** — schema 真權威**移交 migration 檔** + 差異對照表(6 態 / 5 索引 / PII 邊界 / 鎖面)
> · **§7** — prod 交易模擬清單**移交 migration 檔尾**(原字面三處已被實證推翻)
> · **§9** — backlog **#281-#284 已開立實體條目**(前版只是清單、實際查無)
>
> ⚠️ **本檔 §0-§2 與各節未標 v3.1 的段落 = v2/v3 原字面**,僅供追溯決策脈絡;
> **凡與上列節次或 migration `20260717020000` 衝突,一律以後者為準。**

> 版本史:v1 雙審 FAIL(Fable 7 + codex 9 must-fix)→ Sean 拍四板 + 架構大改(免費解)→ v2 → **R2 雙審 FAIL**(Fable 3 + codex 8 must-fix)→ **本 v3 逐條銷**。
> 🔴 **plan 層審查上限 2 輪已用盡(PCM 規則)→ v3 不再開 R3 全審**(Fable R2 明示建議:三條 must-fix 皆非方向分歧、修法唯一 → v3 出後由 **Sean 過目銷案字面 + 拍 §8 必拍題** 即收關卡1)。
> 真權威序:本檔 > v2 > 底稿 `docs/handoff/2026-07-13-email-notification-slice-plan.md`(**多處字面已被實證推翻、不可直接照做**)。
> **狀態:零 code 改動。Sean 拍完 §8 才動工;實作另開視窗。**

---

## 0. R2 must-fix 銷案表(Sean/新視窗只需核這張)

| 來源 | must-fix | v3 銷案 |
|---|---|---|
| **Fable F1 + codex 2** | `skipped_no_real_email` 終態 × `UNIQUE(event_type,order_id)` 自相矛盾 → LINE cohort **永久漏信** | §3.4 **刪除「對帳補寄產生新事件」該句**;改:skipped=**可翻轉態**,由 Q1 獨立線以受控 UPDATE 翻回 pending(換 recipient),**非新 INSERT**;且**不自動回灌**(數月後補寄 order_created 語意本身就錯) |
| **Fable F2 + codex 1** | Vault/pg_net secret 面零設計(v2 新引入) | §4.2 三條硬規:①`cron.schedule` command **零內插**、只呼 `SECURITY DEFINER` wrapper、wrapper 執行期按固定名讀 Vault ②E2b migration **REVOKE `net`/`vault`/`cron` 三 schema 對 PUBLIC/anon/authenticated/service_role** + fail-closed 斷言(🔴 codex 親讀 pg_net 原始 SQL:**官方安裝腳本明載授權 `net` tables/sequences 給 PUBLIC**,不可假設託管環境已收緊)③sweeper response **counts-only 零 PII 零 secret**(`net._http_response` 留 6 小時) |
| **Fable F3 + codex 5** | 「pg_cron 沒跑=無人知」丟 backlog = **自宣接受殘餘風險(違 R6)** | §3.6 **dead-man check 納入 E2a**(不留 backlog):復用**獨立管道**既有 anomaly-alert daily cron(`vercel.json:11-14`)加檢查「outbox 最老 pending/failed age > N 小時 → 告警」≈10 行 → 靜默死亡收斂到 ≤24h 可見。**不可由 sweeper 自我監看(同歸於盡)** |
| **codex 3** | `paid_candidate` 不可當觸發述詞(它只是金流驗證判定,後續 confirm RPC 仍可能失敗)→ 仍會寄未付款信 | §3.3 述詞**收窄為唯一硬條件**:confirm RPC 成功後、DB `orders.payment_status` 由非 paid **轉為 `paid`**。禁 `paid_candidate` |
| **codex 4** | 🔴 **`order_shipped` 事件在現況不存在**:`admin_update_order_workflow` 只改 workflow/配送/發票;**D2 後訂單 workflow 已不代表出貨** | §8-★S2 **升為 Sean 必拍**;**未拍不得排 E4**(v3 已把 E4 標為 blocked) |
| **codex 7 + Fable-2 條件** | payload:`shipping_method` **可後台改** → 補寄前若已退款/取消/改配送,信件描述錯誤狀態 | §4.1 明定「事件時點不可變資料 vs 寄送時 gate」+ 存非 PII 的 `paid_at`/事件版本;**退款/取消後是否抑制舊信 → §8-★S3 Sean 拍** |
| **codex 6 / Fable Q5** | ACL:RPC-only(codex) vs GRANT service_role(Fable) — **兩審正面對撞** | §4.3 **採 Fable 裁示 + 記錄分歧與理由**(見該節);Sean 可否決 |
| **codex 8 / Fable Q8** | E2 超鐵則 4(45 分鐘) | §5 拆 **E1a/E1b/E2a/E2b**;E2b 依賴 E2a 已部署 |
| **Fable Q9 / codex 9** | 移動 watermark 有漏掃洞 | §3.5b **否決移動 watermark**,採「固定下界=上線時戳 + `NOT EXISTS` 全量重疊掃描」,述詞欄=`orders.paid_at` |
| **codex nit-9** | v2 §2.3 字面「8,640 次/月 vs 2,000 分鐘」「即使不進位亦逼近」 | §2.3 更正:8,640 是**次數**;private GitHub-hosted job **確實向上進位到整分鐘**(→ ≥8,640 billable min);**「即使不進位亦逼近」是錯的、刪除**;PCM GitHub 組織方案=**未確認** |
| **Fable nits** | n1 `IAlertNotifier` 註解實在 `:5` 非 `:12` / n2 狀態名漂移 / n3 GRANT 偏離 cited pattern 未明寫 / n4 「bounce rate <4%」無 URL | 全修:行號更正;狀態名統一 `skipped_no_real_email`(memory 補註);§4.3 明寫偏離;§3.4 補 URL(見該節) |

---

## 1. Sean 拍板(07-16 深夜)

| Q | 拍板 | 影響 |
|---|---|---|
| **Q1 LINE 會員無真實信箱** | **下單前強制補足會員資訊包** | 🔴 **獨立線、不併本片**(偵察:4-5 slice、碰金流 gate、需 LINE 官方 email scope 審核=外部依賴)。本片只做 §3.4 gate |
| **Q2 `order_created` 觸發** | **只在付款成功才寄** | §3.3(R2 後述詞再收窄=`payment_status` 轉 `paid`) |
| **Q3 免費路** | **先窮盡** | §2 → pg_cron 免費解成立 |
| **Q4 文案分級** | **L2 hardcode** | 兩審此題相反 → Sean 親自銷案;E3 文案字面寄出前給 Sean 過目 |
| **★S1 可靠度** | **A=做完整版**(薄 outbox+sweeper+重試+dead-man) | 極簡案否決;=plan 預設架構 |
| **★S2 出貨信語意** | **B=每出一批寄一封**(接受多封) | 🔴 **E4 unblock;但 `UNIQUE(event_type,order_id)` 作廢→`dedup_key`**(§3.7/§4);「一批」定義待 E4 偵察 |
| **★S3 退款後是否寄 + 重複風險** | **A=不寄**;且**認可無法保證只寄一次** | §4.1 送出前 gate 抑制;§3.5-5 殘留窗=Sean 明示認可(非自宣) |

**不做**:取消/退款信(併 M-3 退款線)、行銷信、開信追蹤、outbox 清理 job(**backlog #281**)、**LINE 補資料(獨立線、非 backlog)**、pgmq(兩審判定過度工程)。

---

## 2. 架構定案與研究結論

### 2.1 v1 死因
**Vercel Hobby cron=一天一次、±59min、best-effort(漏跑不補、失敗不重試)**(官方 https://vercel.com/docs/cron-jobs/usage-and-pricing )→ 靠它送/兜底,最壞**無有限上界**(v1 說「25 小時」是錯的)。

### 2.2 🔴 解:排程不綁 Vercel
MCP 實查(memory `reference_pcm-platform-plans-vercel-hobby-supabase-pro`):**Supabase org = `plan: pro`(已付費)** → **無 Free plan 7 天 pause 風險**(該 pause 是 pg_cron 方案最大坑,本專案不適用);`pg_cron` 1.6.4 / `pg_net` 0.20.0 可用未啟用;`supabase_vault` 已啟用。pg_cron 官方間隔「every second to once a year」;Supabase 協作者官方 discussion:「Cron is only limited by the resources it uses… on **any tier**」。
→ **分鐘級排程在 Sean 已付的 Supabase Pro 內本來就有。零新供應商、零新帳號、零額外費用。**
⚠️ **措辭紀律(codex R2-Q3)**:應稱「**無新增供應商費用**」,**不是**「免費的可靠性保證」。

### 2.3 方案盤點(三方交叉驗證)
| 方案 | 判定 |
|---|---|
| **Supabase pg_cron + pg_net → Next sweeper** | ✅ **採用**:無新供應商;沿用現有 Next+Supabase+Resend+cron 骨架;Pro 無 pause |
| GitHub Actions cron | ❌ 每 5 分鐘=**8,640 次/月**;private GitHub-hosted job **向上進位到整分鐘** → ≥8,640 billable minutes ≫ Free 2,000 分鐘/月(**PCM GitHub 組織方案=未確認**);官方自承 schedule 可能延遲或被丟棄 |
| Upstash QStash | 🟡 次選(免費 1,000 msg/日、內建 retry/dedup 10min 窗);代價=新帳號+token+console |
| Supabase Edge Function | 🟡 無增益:多一份 Deno 部署面,**不改善 pg_cron 觸發可靠性**(觸發器仍是 pg_cron) |
| Cloudflare Workers Cron | ❌ 免費層 CPU 10ms/次;又多一平台 |
| Vercel Queues(beta) | ❌ 仍有 DB commit→enqueue 空窗;**且 PCM 商用跑 Hobby 本就不符官方條款** |
| pgmq | ❌ **過度工程**(兩方獨立判定):解高併發/visibility window;本案每天數十封,一張 outbox 表足夠 |

### 2.4 誠實揭示:保證等級(R2 修正版)
官方**未載明** pg_cron 可靠性保證等級(=未確認)→ 本質亦 best-effort;它贏 Vercel Hobby 的是**頻率密度**,不是保證等級。
🔴 **v2 §2.4 的論證只對一半(Fable F3 擊破)**:outbox 狀態機給 **safety**(不重不漏記帳),**liveness 仍完全繫於排程**——pg_cron 死 + `after()` 失敗 → pending 無限期沉默堆積。
→ **故 dead-man check(§3.6)不是 nice-to-have,是 liveness 的唯一來源,納入 E2a。**

### 2.5 誠實揭示:是否過度工程(→ §8-★S1 Sean 拍)
codex 原話:「信件只是方便通知、訂單真相都在後台」→ 精簡 awaited send + 人工補寄足夠,outbox+sweeper **可能過度工程**;「承諾客戶可靠收到、客服不會每日巡檢」→ 薄 outbox+sweeper 是**合理基本設施**。
業界研究獨立結論:**outbox 表本身=Transactional Outbox Pattern、業界正解、非過度工程**;該避免的是「為數十封信引入新 SaaS」(本 plan 已避開)。
→ plan 預設走薄 outbox(**PRD §6.6 明文要求 outbox+重試**);Sean 若選極簡案,架構退化為「await 送 + failed 告警 + 人工補」。

---

## 3. 架構

### 3.1 全貌
```
[confirm RPC 成功、payment_status 轉 paid] → app 層寫 email_outbox(交易外、不改 create_order)
      → after() 立即嘗試送 Resend(秒級;非 durable)
      → pg_cron(*/5)→ pg_net → SECURITY DEFINER wrapper → Next sweeper:認領→送→標記→退避重試
      → 仍失敗 → failed + 告警(§3.6)
      → [獨立管道] anomaly-alert daily cron → dead-man check(🔴 **五訊號**〔v3.2〕、非單一 age;見 §3.6 + migration §⑨)
           ①pending 堆積(排程死)②dead letter(送不出去)③stale sending(認領後死)
           ④paid 但無列(列從沒進來 ← 前三者共同盲區、直接查 orders 不查 outbox)
```

### 3.2 `after()` 定位(v1 字面已更正)
v1 稱「已在 Hobby production 運行=可用之實證」→ **Fable 擊破:「已部署」偷換「已執行」**(`tappay-notify/route.ts:18-19` 明寫 3DS-4 前不開 prod 結帳 → 該 route 很可能從未執行)。
**正確字面**:`after()` 已在 repo 採用、慣例明確(`route.ts:25,189`;註解 `:14,185` 自載「after() 非 durable queue → 最終保證交 sweeper」);**是否曾實際執行=未確認**,E3 驗收(真下單收信)才是實證。
官方保證(親讀):`waitUntil` 字面「Promises passed to waitUntil() will have the same timeout as the function itself. **If the function times out, the promises will be cancelled**」→ **明確非 durable**。

### 3.3 `order_created` 觸發述詞(R2 後收窄)
🔴 **唯一硬述詞 = confirm RPC 成功後,DB `orders.payment_status` 由非 paid 轉為 `paid`**。
- **禁用 `paid_candidate`**(codex R2-3:它只是金流驗證判定,後續 confirm RPC 仍可能失敗 → 仍會寄未付款信)。
- 背景:`charge-actions.ts:219` ④建單在 ⑥扣款**之前**(親驗)→ 建單即寄=寄給棄單者(單 `payment_status='unpaid'`、前台刻意藏)。
- **paid transition 發生地(codex R2 已代為偵察,E3 仍須親驗)**:同步路徑 `charge-actions.ts:272-286`;共同 settle 路徑 `settle-charge.ts:271-291`;RPC 本體 `confirm_payment_rpc.sql:177-184`。⚠️ **3DS late-success / settle-sweep 補結 = 本 repo 實際存在的晚翻 paid 路徑**(Fable R2-Q9 點出)→ 觸發點**不只一處**,E3 開工前必須把全部 paid transition 發生地列全,不得憑本 plan 字面直接寫。

### 3.4 🔴 合成假信箱 gate(Q1 fail-safe)
LINE 會員 `customers.email` = `line_{sub}@line.pcmmotorsports.local`(`apps/storefront/src/lib/auth/line.ts:38,48-50`);LINE scope 現為 `'openid profile'`(`line.ts:25`)**不含 email** → `user_metadata.line_email` **幾乎恆 null**(偵察實證)。
**規則**:寫 outbox **前**判斷 recipient 可否投遞;合成域 → `status='skipped_no_real_email'`、**不呼 Resend、不進 due 索引、不重試**。
**判準(Q11 裁示)**:**import `LINE_SYNTHETIC_EMAIL_DOMAIN`(`line.ts:38`)單一來源比對 + 正規化**;**禁複製字串字面**;**否決 MX 即時查詢**(把網路依賴塞進寫入路徑;且 MX 存在 ≠ 地址可投遞)。
**理由(硬)**:①`.local` 是 **RFC 6762 保留給 mDNS 的特殊網域**、非可公開投遞郵件域 ②Resend 要求 **bounce rate < 4%**、明確警告勿寄假地址,超標會 suspend 寄送(來源:https://resend.com/docs/knowledge-base/account-quotas-and-limits + https://resend.com/blog/four-ways-to-hurt-your-sender-reputation ;**v2 此處無來源=Fable n4,已補**)→ 寄假信箱**傷害已驗證網域 `pcmmotorsports.com` 的寄件信譽**(全站告警信+未來所有信的共用資產)。
→ **絕不可靠 bounce webhook 事後補救**,必須寫入前 gate。
🔴 **`skipped_no_real_email` 是「可翻轉態」不是不可逆終態(R2 F1 銷案)**:v2 尾句「等 Q1 補完真實 email 後再由對帳補寄產生新事件」**已刪除**(與 §4 唯一鍵直接矛盾 → 該 cohort 永久漏信)。正解:**由 Q1 獨立線以受控 UPDATE 原地翻 `skipped_no_real_email`→pending(換 recipient、重設 `next_retry_at`),非新 INSERT**;且**不得自動回灌**(數月後補寄 order_created,單可能已退/已變=語意本身錯誤)→ 是否翻轉、翻哪些,**留 Q1 線設計時決定**(= **Q1 獨立線**的設計項,非 backlog 條目;動工前置 = Sean 先拍「真實 email 存哪」,見 §8.1)。

🔴🔴 **Q1 線的紅線(v3.1 新增;Fable R3 N2)**:E1a 後**有兩個 `skipped_*` 態**,語意相反 ——
`skipped_no_real_email` **可翻轉**;**`skipped_order_ineligible`(S3=A 退款/取消抑制)絕對不可翻轉**。
→ **Q1 線的 UPDATE 述詞必須寫死 `status = 'skipped_no_real_email'`,嚴禁 `status LIKE 'skipped%'` 之類 pattern-match** ——
否則會把**已退款/已取消訂單**的 `skipped_order_ineligible` 一起翻回 pending → **把「付款成功」信寄給已退款的客人**
(直接違反 Sean 拍的 S3=A)。此紅線同時載於 migration `20260717020000` §⑧。

### 3.5 冪等 / 防重複(兩審皆擊不破的部分:保留)
1. **DB CAS 認領**:`UPDATE ... SET status='sending', claimed_at=now() WHERE id=$1 AND status IN ('pending','failed')`,affected rows=1 為所有權憑證。**兩審兩輪皆擊不破**(READ COMMITTED 行鎖 + 重評 WHERE → 恰一 winner)=本 plan 最扎實處。
   🔴 **v3.1 更正(E1a codex 關卡2)**:上列字面**是併發論證的記錄、不是可直接複製的實作** —— 它**缺 `AND attempts < max_attempts`**,照抄會突破重試上限(TOCTOU:A 讀到 attempts=4、B 先推到 5,A 的 CAS 仍成立 → 多送一次)。**實作版述詞見 §3.6 REQUIRED-E2a**;`claimed_at` 亦不可省(E1a 有 CHECK 擋)。
2. **Resend `Idempotency-Key`**:官方支援、≤256 字元、**保留 24 小時**(https://resend.com/docs/dashboard/emails/idempotency-keys )。key=`<event_type>/<outbox_id>`。現有 adapter headers 只有 Content-Type+Authorization(`EmailAlertNotifierAdapter.ts:35-47`)=尚未有此 header。
   ⚠️ 24h 窗 < 重試總跨度 → **DB 唯一鍵 + `sent` 狀態不可省**。
3. **唯一事件鍵全量**:~~`UNIQUE (event_type, order_id)`~~ 🔴 **已作廢(Sean 拍 S2=B 的連鎖;此處為 v2 殘留、v3.1 更正)**
   → 實為 **`UNIQUE (event_type, dedup_key)`**(§3.7-1 / §4)。舊鍵在「每出一批寄一封」下會**擋掉同訂單的第二封出貨信**。
   ⚠️ `dedup_key` 必須在同 event_type 內**全域唯一**(唯一鍵**不含 order_id**)—— E4 若用 per-order 序號會跨訂單誤擋。
4. **lease ≥ 1 小時**(必須 > route `maxDuration` 上界,否則回收在途列 → 重寄)。
5. **殘留(誠實、不宣稱 exactly-once)**:Resend 已接受但回應斷線 / 寫 `sent` 前 function 死亡 → 24h 內 Idempotency-Key 擋、超過由 DB `sent` 擋;**兩者皆失效窗**=「Resend 已收、DB 未標 sent、且逾 24h 才重試」→ 極窄非零。**外部副作用無法與 DB 原子提交** → 目標=**at-least-once + 實務極低重複率**。→ **§8-★S3 Sean 認可**。

### 3.5b 對帳補寄(Q9 裁示:否決移動 watermark)
**採「固定下界 = 功能上線時戳(常數/env) + `NOT EXISTS` 全量重疊掃描」**,述詞欄=`orders.paid_at`(`20260604120000:108` 親驗存在)。
**否決移動 watermark 的理由**(Fable R2):晚翻 paid 的舊單(**3DS late-success / settle-sweep 補結=本 repo 實際存在路徑**)會落在游標之前 → **永久漏掃**;codex 亦指出「半批失敗後推進游標會漏單」。表量數十/日,partial index 下每 5 分鐘全量 `NOT EXISTS` 成本趨零。
**固定下界解 Fable-2**(首跑回灌上線前舊單群發)。

### 3.6 liveness / 可觀測(R2 F3:納入 E2a,不留 backlog)

> 🔴 **v3.1 增補(2026-07-17,E1a 實作視窗;Sean 拍 Q2=A「plan 是真權威、合約要寫回來」)**:
> 下列訊號合約由 **E1a 的審查鏈實戰逼出**(code-reviewer×2 + codex 關卡2×5 + Fable 對抗審×3,共 8 輪),
> 已同步寫進 `supabase/migrations/20260717020000_m4a_email_outbox.sql` 頭註 §⑦「REQUIRED-E2a」。
> 🔴 **v3.2(E1c-2)**:**四訊號 → 五訊號**(+額度耗盡)、**訊號 1 述詞已修正** → 增補落該檔頭註 **§⑨**。
> 🔴 **v3.3(E2a-a)**:lease 回收落點定案 → 落該檔頭註 **§⑩**(= §⑦「必須回頭過訊號表」義務的履行處)。
> **E2a-b/c 開工前必讀本節 + 該檔 §⑦、§⑨ 與 §⑩**(⚠️ §⑦ 收束句「四訊號…缺一即留盲區」是 E1a 當時的
> 完整集、**現已過期**,勿只讀到那裡就收工);漂移以 migration 檔為準(**內部仲裁序 §⑦ < §⑨ < §⑩**)。

**🔴 dead-man check = 五個訊號(v3.2;原三→四→五),缺一即留盲區**(復用**獨立管道**既有 anomaly-alert daily cron
`vercel.json:11-14`;**五者都不可由 sweeper 自我監看** —— pg_cron 死則同歸於盡):

> 🔴 **v3.2 增補(2026-07-17,E1c-2)**:**四訊號 → 五訊號**;訊號 1 述詞**已修正**(見上表訊號 1 列 + migration §⑨)。
> 權威 = `supabase/migrations/20260717020000_m4a_email_outbox.sql` 頭註 **§⑨**(本節與其漂移以 migration 為準)。

| # | 訊號 | 述詞 | 對應的死法 |
|---|---|---|---|
| 1 | **pending 堆積** | ~~最老 `pending`/`failed` 且 `attempts < max_attempts` 的 age > N 小時~~ → 🔴 **v3.2 修正**:「**已到 `next_retry_at` 且逾寬限仍未處理**」(非單看列齡);或排除 `last_error_code IN ('quota_daily_exceeded','quota_monthly_exceeded')` | **排程死**(pg_cron 停 / pg_net 不通) |
| 5 | 🔴 **額度耗盡**(v3.2 新增) | `count(**status='failed'** AND last_error_code IN ('quota_daily_exceeded','quota_monthly_exceeded')) > 0` → 告警「Resend 額度不足,請升級」**走 LINE** + 冷卻 | **額度撞牆**(Sean Q5=A「等系統告知再升級」的唯一訊號源;🔴 Q6=A 讓撞額度的信睡到隔天=**不變死信**→訊號 2 不叫→**恰好讓 Sean 更收不到通知** = 必要配套非加值) |
| 2 | **dead letter** | `count(status IN ('pending','failed') AND attempts >= max_attempts) > 0` | **送不出去**(Resend 持續失敗、已耗盡重試)+ **回收後的隱形死列** |
| 3 | **stale sending** | `count(status='sending' AND claimed_at < now() - <lease>) > 0` | **認領後才死**(function timeout / 部署中斷 / pg_cron 停在半路) |
| 4 | 🔴 **paid 但無列** | `count(orders WHERE payment_status='paid' AND paid_at >= <固定下界> AND paid_at < now() - <寬限> AND NOT EXISTS (SELECT 1 FROM email_outbox e WHERE e.order_id = orders.id AND e.event_type='order_created')) > 0` | **列從沒進來**(付款已提交、程序在 INSERT outbox 前掛掉)= 前三者的**共同盲區** |

🔴 **三條述詞的字面陷阱(codex 關卡2 逐輪抓出,照舊字面寫就會踩)**:
- **訊號 1 必須排除死列**(`attempts < max_attempts`):否則達上限的終態列 age 永增 → **永久告警噪音**,
  把真正的靜默死亡淹掉 = liveness 訊號自我廢除。
- **訊號 2 必須排除 `sent`/`sending`,但必須含 `pending`**(codex R2 + Fable R3 實測**兩輪收斂**):
  · 排除 `sent`:只寫 `attempts >= max_attempts` 會**命中第 5 次才送成功的 `sent` 列**(attempts=5、max=5)
    → 永久假告警。`sending` 同理(仍在途、還沒判生死)。
  · 🔴 **但不可收窄成只有 `status='failed'`**(Fable 拋棄式 PG 實測擊破「三訊號無盲區」的宣稱):
    `pending` + `attempts >= max_attempts` 的列會讓**四個述詞全回 0 = 第四種死法、永久漏信且無人知**。
    可達性 = 合約自己留的門:§3.5-4 lease 回收把 stale sending 翻回 **pending**,若 E2a 採「認領時遞增
    attempts」→ 第 5 次認領後 function 死 → 回收 → `pending@5/5` = 隱形死列。
    🔴🔴 **v3.3 更正(E2a-a)**:上述可達性前提 **已不成立** —— Sean **Q2=A 定案回收落 `failed`、不是
    pending**(權威=migration **§⑩**)→ **`pending@max` 不可達**(寫 `pending` 的路只剩 enqueue@0 與
    Q1 線受控翻回@0、皆非 @max;attempts 只在認領時遞增且遞增後必為 sending)。本段保留為歷史論證。
  ⚠️ **訊號 2 仍必須保留 `pending` 分支**(不可因「不可達」而收窄成只有 `failed`)= **縱深**:
    可達性論證若有誤,該分支是唯一的網;且零誤報成本(CAS guard 下 `pending@max` 永遠不可能再被認領
    = 定義上就是死列)。
  ✅ ~~**E2a 定案「attempts 遞增時機」與「回收落 pending 或 failed」時,必須回頭過本表**~~
  **本義務已於 E2a-a 履行、結論落 migration §⑩**(attempts 認領時 +1 × 回收落 failed → **零盲區**:
  `failed@max` 命中訊號 2、`failed@<max` 帶 next_retry_at 回 due 掃描)。
- 🔴 **訊號 4 不可省(codex R5 = 第五種死法)**:訊號 1-3 有一個**共同前提 —— 「outbox 裡有那一列」**
  (它們全在掃本表)。但「confirm RPC 成功、`payment_status` 轉 paid」**已提交**、程序卻在 **INSERT outbox 之前**
  掛掉 → **這張單根本沒有列** → 三訊號全回 0。
  · ⚠️ 對帳補寄(§3.5b)本是這條的安全網,**但它跑在 sweeper 裡** → sweeper/pg_cron 一死,補寄與偵測一起死
    (又是「不可自我監看」的同一個坑)。
  · ⚠️ **別以為訊號 1 會兜住**:訊號 1 要「有 pending 列」才叫得出來,而 PCM 一天只有數十封 →
    **平時 pending 表通常是空的**(信都寄完了)→「sweeper 死 + 某單 INSERT 失敗 + 其他信都已寄完」= **零訊號**。
  · `<寬限>` 須 > sweeper 正常補寄週期(否則剛付款未及補寄的單誤報);`<固定下界>` = §3.5b 同一個上線時戳。
  · ✅ E1a 新增的 `email_outbox_order_idx (order_id, event_type)` 正是為此 anti-join 而設(Fable EXPLAIN 實測兩欄全吃)。
  · ⚠️ **E4 定義「一批」後,`order_shipped` 亦須有對等訊號**,否則同一個洞在出貨線重演。
- 🔴 **分工界線(Fable R3 實測背書)**:訊號 1-3 由**本表狀態空間**完整分割 —— 它以 UNCOVERED probe 窮舉
  六態 × 生死 attempts,證明「三訊號 ∪ {sent, skipped_no_real_email, skipped_order_ineligible}」覆蓋全狀態空間、
  **DB 層無漏網列**;訊號 4 補的是**表外**的洞(列不存在)。**兩者不重疊、都要有。**
- 🔴 **`skipped_order_ineligible`(S3=A 抑制終態)天然不被任何訊號命中 —— 那是刻意的**(合法終局、非死信)。
  代價:**E2a 若「誤判」eligible → ineligible,零訊號、零對帳補救**(對帳看到列已存在就不補寄)。
  → REQUIRED-E2a:轉入該態**必寫** `last_error_code='order_ineligible'` 供事後稽核;抑制路徑必附測試。
- **訊號 3 不可省**:訊號 1 只掃 pending/failed、訊號 2 只看 attempts 上限 → **sweeper 認領後(status 已轉
  sending)才死的列,前兩個訊號都不命中** = 靜默死亡仍在。
  (lease 回收〔§3.5-4〕本應把它翻回 pending〔⚠️ **v3.3:E2a-a 已改為落 `failed`**,見 migration §⑩;
  本訊號 3 的存在理由不受影響〕,但**回收器自己跑在 sweeper 裡** → sweeper 死則回收也死,
  正是「不可自我監看」的同一個坑。)
  🔴 **E1a 的 DB invariant 是「雙向」的**(v3.1 更正;前版此處記單向 = Fable 實測抓出的 must-fix):
  `CHECK ((status = 'sending') = (claimed_at IS NOT NULL))`
  · 「sending ⇒ claimed_at 非 NULL」保證訊號 3 的比較不會因 NULL 恆 UNKNOWN 而靜默失效。
  · 「claimed_at 非 NULL ⇒ sending」使「危害態(failed/sent + 殘留舊 claimed_at)」**在 DB 層不可表示**
    —— 否則舊值殘留會讓 lease 回收把**正在寄送**的列判成 stale → 重新認領 → **重複寄信**。
  🔴 **由此產生兩條 app 義務(REQUIRED-E2a,漏做即 check_violation、不是靜默)**:
  1. **認領時必寫** `claimed_at = pg_catalog.now()`。
  2. 🔴 **每一句離開 sending 的 UPDATE(mark-sent / mark-failed / ~~lease 回收翻 pending~~ **lease 回收落
     `failed`**〔v3.3 更正〕)必須同時 `claimed_at = NULL`。**
     🔴 **v3.3 補充(E2a-a):離開 sending 有兩條路、所有權判定不同** —— **持有者路徑**(mark*)必帶
     `claimedAttempts` 世代柵欄;**回收器路徑**(`IEmailOutbox.reclaimStaleLeases`)**非持有者、無柵欄可帶**,
     改以 CAS 述詞 `status='sending' AND claimed_at < staleBefore` 自身判定。共同義務只有 `claimed_at = NULL`。 ⚠️ Fable 實測:漏這條 → **每一次 mark-sent 都 check_violation** →
     信已由 Resend 送出、列卻卡在 sending → lease 回收 → 重認領 → **系統性重複寄信**
     (只剩 24h Idempotency-Key 兜)。
  ⚠️ **DB 只保證「非 NULL ⟺ sending」,不保證那個時間是「本次」的 now()**(明寫舊值/未來值仍會通過)
  → 「認領寫 now()」是 app 合約、不是 DB 保證。

**🔴 REQUIRED-E2a(sweeper 述詞硬合約;關卡2 檢核點)**:
- due 述詞**與** CAS 述詞**都**必須含 `attempts < max_attempts`。**CAS 才是原子決策點**,due-select 只是最佳化:
  TOCTOU —— A 選中 X(attempts=4)→ B 先把 X 推到 attempts=5 → A 的 CAS 若只有
  `WHERE id=X AND status IN ('pending','failed')` **仍成立** → 突破上限多送一次。
- ⚠️ **plan §3.5-1 引的 CAS 述詞本身不含此 guard,照抄即踩**(§3.5-1 保留原字面是為記錄「兩審擊不破」的
  併發論證,**不是可直接複製的實作**)。
- E1a 已把 guard 寫進 due 索引述詞(`email_outbox_due_idx`)把約束機械化,**但索引不強制查詢** →
  正確性最終仍在 app 層述詞。
- 🔴 **v3.1 更正:`failed` **不是**終態**(此處為 v2 殘留字面)。`failed` = **可重試失敗態**,每次送失敗即標 failed + 退避、仍會被重新認領;**終態界線在 `attempts >= max_attempts`**。→ 告警條件 = **訊號 2 的述詞**(見上表),**不是「一進 failed 就告警」**(否則每次暫時性失敗都叫,假告警成常態 → 真告警被當噪音)。告警管道復用 `EmailAlertNotifierAdapter`;**告警零 PII**(只送 outbox id / event_type / attempts,**不送 recipient/payload**)。
- sweeper 回應碼沿用 anomaly-alert 慣例(有失敗→503 不吞錯,`anomaly-alert/route.ts:126,130,137`);**response body counts-only、零 PII、零 secret 回顯**(§4.2③)。

### 3.7 `order_shipped` — **Sean 已拍 S2=B:每出一批寄一封(部分出貨也通知)**
codex R2-4 親驗:`admin_update_order_workflow`(`order-actions.ts:36-81`)**只改 workflow、配送方式、發票欄位**;**D2 per-item 落地後,訂單層 workflow 已不代表出貨** → **現況不存在「整單轉 shipped」事件**(v2/v3 前版字面已作廢)。
**Sean 拍板(07-16 深夜)= B**:原話「每出一批就寄一封(部分出貨也通知,但客人可能收到好幾封)」→ **接受同一訂單多封出貨信**。
→ **觸發點改掛 per-item RPC**:`updateOrderItemWorkflowAction`(`order-actions.ts:89`)→ `admin_update_order_item_workflow`(`20260716130000`)成功後、app 層寫 outbox(不改 RPC)。欄位=`order_items.workflow_status`(`20260716120000`)。

🔴 **連鎖影響(S2=B 造成、E1a schema 必須先解決)**:
1. **`UNIQUE (event_type, order_id)` 作廢**——它是為「整單一封」設計的,B 案下會**擋掉同訂單的第二封出貨信**。
   → **改為通用 `dedup_key text NOT NULL` + `UNIQUE (event_type, dedup_key)`**(§4):`order_created` 的 `dedup_key = order_id::text`(語意不變、仍一單一封);`order_shipped` 的 `dedup_key = 該批的穩定識別`。
2. 🔴 **「一批」的定義=E4 開工前必須偵察後定(不得憑本 plan 字面猜)**。已知約束:
   - admin 現況是 **per-item** RPC(一次一個 item)→ 若「每 item 一封」= 3 個品項 3 封 = **太吵、不符 Sean「一批」原意**;
   - `request_id` 已有基建(middleware 產生、貫穿 action→repository→DB)但 **不可直接當 dedup_key**:雙擊 submit = 兩個 request_id = 兩封(**正是 Fable R1-MF3a 抓的縫**);
   - **候選(E4 偵察後擇一、附論證)**:①同一次出貨批次的 item id 集合排序後 hash(**擋雙擊/重送、退回再出貨=不同集合→合法第二封**)②引入顯式 shipment/批次概念(較重、可能超鐵則 4)③admin UI 若本就是「勾選多項一次送出」→ 以該次提交的 item 集合為批。
   - **E4 前置=先讀 admin 出貨 UI 與 action 本體**,確認「一次操作能不能一次出多項」——這決定「批」是否天然存在。
3. `order_items.workflow_status` 的**退回再出貨**路徑 → 是否寄第二封 = 由 dedup_key 語意決定(候選①下:同集合不重寄、不同集合寄)。**若 Sean 要「退回再出貨不重寄」須另拍**(現況 plan 不假設)。
4. 「per-item 部分出貨信」**移出 backlog = 本片範圍**(S2=B 拍板)→ v3.1 已從 §9 backlog 清單**實際刪除**(非只是註記)。

---

## 4. schema

> 🔴🔴 **以下 SQL 區塊 = v2 原字面,已被 E1a 實作超越 → 僅供對照、不可照做**(真權威 = migration 檔)。
> 已知偏離見區塊後的差異表;**至少 6 態(非 5)、5 具名索引(非 4)**。

```sql
CREATE TABLE public.email_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL CHECK (event_type IN ('order_created','order_shipped')),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  dedup_key       text NOT NULL,                    -- 🔴 S2=B 後新增:order_created=order_id::text;order_shipped=該批穩定識別(定義待 E4 偵察、§3.7)
  recipient_email text NOT NULL,                    -- 🔴 唯一保留的 PII 欄
  subject         text NOT NULL,
  payload         jsonb NOT NULL,                   -- §4.1 最小化、非 PII
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sending','sent','failed','skipped_no_real_email')),
  attempts        int  NOT NULL DEFAULT 0,
  max_attempts    int  NOT NULL DEFAULT 5,
  last_error_code text,                             -- 只存結構化安全碼(如 'http_422');禁存 Resend 回應全文
  request_id      text,                             -- 對齊 repo 慣例(非 correlation_id)
  created_at      timestamptz NOT NULL DEFAULT now(),
  next_retry_at   timestamptz NOT NULL DEFAULT now(),  -- 🔴 NOT NULL:NULL <= now() 不成立 → 永久卡信
  sent_at         timestamptz,
  claimed_at      timestamptz
);
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;   -- zero-policy
REVOKE ALL ON public.email_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON public.email_outbox TO service_role;   -- §4.3 偏離說明
CREATE INDEX email_outbox_due_idx ON public.email_outbox (next_retry_at) WHERE status IN ('pending','failed');
CREATE INDEX email_outbox_request_idx ON public.email_outbox (request_id);
CREATE UNIQUE INDEX email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key);  -- 🔴 S2=B:原 (event_type, order_id) 作廢(會擋掉同訂單第二封出貨信)
CREATE INDEX email_outbox_lease_idx ON public.email_outbox (claimed_at) WHERE status = 'sending';
```
ACL pattern 對齊 `admin_audit_log`(`20260712210000:82,85,89`)+ fail-closed DO 斷言(`:94` 起)。

> 🔴 **v3.1:上列 schema 區塊已被 E1a 實作超越 → 真權威改為
> `supabase/migrations/20260717020000_m4a_email_outbox.sql`(Sean 拍 Q2=A 後同步本節)。**
> 上列字面**保留原樣供對照**,但**不可照它實作**;E1a 經 4 輪審查(code-reviewer R1 FAIL→R2 PASS、
> codex 關卡2 R1 FAIL→R2 FAIL→修)後的**實際差異**:
>
> | 項 | plan §4 原字面 | E1a 實際 | 為什麼改(哪一輪抓的) |
> |---|---|---|---|
> | **due 索引述詞** | `WHERE status IN ('pending','failed')` | 加 `AND attempts < max_attempts` | code-reviewer R1:`failed` 是**可重試態非終態**,死列 `next_retry_at` 恆過期 → 留在 due 索引 = 下游漏 guard 即無限重試 |
> | **CHECK 數** | 8 | **10** | codex R2→R3:①🔴 **雙向** `CHECK ((status = 'sending') = (claimed_at IS NOT NULL))` —— 正向擋「stale-sending 訊號比較 NULL → 永久卡 sending 無人知」;**反向**擋「failed/sent 殘留舊 claimed_at → 重新認領漏寫 now() 仍過 CHECK → lease 回收把在途列判 stale → 重複寄信」(單向版擋不住;危害態在雙向版下**不可表示**)。→ **兩條 app 義務見 §3.6**:認領必寫 `now()`、**離開 sending 必清 NULL**。②`last_error_code ~ '^[a-z0-9_]{1,64}$'`(原「禁存回應全文」只是註解=願望,實作失誤即把 PII 永久複製進表;非 PII 物理閘、僅格式 backstop → 真防線=E1b 的錯誤碼 allowlist) |
> | **DO 斷言** | 查 anon/authenticated/service_role 三具名角色 | 加 **4e** aclexplode 全 allowlist(grantee ∉ {owner, service_role} 即 RAISE、PUBLIC=grantee 0)、**4f** 欄級 ACL 全空(attacl)、**4g** RLS+zero-policy 納入同一 DO | codex R1/R2:①只查具名角色 → **第三方角色的 grant 整個沒被看到**(該角色即可讀 `recipient_email`)②欄級 grant 表級查不到 ③`role_table_grants` 對 PUBLIC 的可見性隨 grantor 而異、不可當唯一防線 |
> | **status 態數** | **5** 態 | 🔴 **6** 態:新增 **`skipped_order_ineligible`** | codex R4:**S3=A(Sean 拍「退款/取消後不寄」)在原白名單裡沒有落點** → E2a 只能留 pending(永久 churn+假告警)/ 標 sent(說謊)/ 標 failed(假 dead letter)/ **借 `skipped_no_real_email`(最危險:會被 Q1 線翻回 pending → 把已退款訂單的付款成功信寄出去)**。新態=**不可翻轉終態**、不進 due、不被任何訊號命中(合法終局的正確靜默)。🔴 **Q1 線紅線見 §3.4**;「哪些訂單狀態算 ineligible」= E2a 定案 |
> | **具名索引數** | **4** | 🔴 **5**:新增 **`email_outbox_order_idx (order_id, event_type)`** | codex R4:**PG 不會自動為 FK referencing side 建索引** → ①orders 的 `ON DELETE RESTRICT` 檢查 ②§3.5b 對帳的 `NOT EXISTS (… WHERE order_id=o.id AND event_type=…)` 每 5 分鐘全量掃描 —— 皆全表掃。Fable R3 EXPLAIN 實測:與 `event_uniq` 首欄不同、**零冗餘**;anti-join 兩欄全吃。**訊號 4(§3.6)亦靠此索引** |
> | **PII 邊界** | 「recipient_email = 唯一 PII 欄」 | 字面收窄為「唯一**預期**存在的 PII 欄、**非 DB 強制**」+ 新增 **REQUIRED-E1b** | codex R4:payload 只被約束成 jsonb object(**無 key allowlist**)、subject/dedup_key/request_id 皆自由 text → 一次 DTO spread 就能把 email/電話/地址永久複製進表(清理 job 還在 backlog)。→ E1b:payload 顯式 key/型別 allowlist、**禁任意 DTO spread**、subject 只由固定模板+display_id 組、負向測試。本表只能關住**已落表**的 PII,擋不住「不該落表的東西被寫進來」 |
> | **鎖面/模擬** | (無) | 頭註新增「鎖面」段 + `SET LOCAL lock_timeout='3s'`;檔尾模擬流程重寫(總則 A/B + 斷言 0-13) | codex R2:①建 FK 對 `orders` 取 **SHARE ROW EXCLUSIVE**、鎖到交易結束 → 前版註解「零既有物件接觸/零流量影響」**是錯的**,照它在 prod 開著 txn 慢慢核會**卡住真實結帳建單** ②migration **自帶 `BEGIN;`/`COMMIT;`** → 前版「BEGIN→套→斷言→ROLLBACK→零留痕」字面**會在 prod 留痕**(內部 COMMIT 先提交、最後 ROLLBACK 退不了)→ 拆成「apply 前模擬(須剔除自帶 BEGIN/COMMIT)」與「db push 後驗收(表已存在、只有資料零留痕)」兩種腳本 |

### 4.1 payload 最小化 + 事件時點 vs 寄送時 gate
v1 存全快照 → PII 落第二張表且清理 job 不做=無限期滯留。
**論證**:`confirm_payment` UPDATE 僅 5 付款欄(`20260611120000:16`)、`order_items` 無內容 UPDATE 路徑、退款未實作 → 「不可變快照」**今日為真**(Fable R2 親驗背書)。⚠️ **條件註記:M-3 退款線若動單內容,須重審此論證。**
→ payload **只存渲染必需的非 PII 最小集**(`display_id` + `paid_at` + 事件版本 + event 專屬欄);品項/金額/地址**寄信時即時查主表**。
🔴 **codex R2-7**:`shipping_method` **可後台改** → 補寄前若已改配送/退款/取消,信會描述錯誤狀態。
→ **規則**:①**事件時點不可變資料**(display_id/paid_at/事件版本)存 payload ②**寄送時 gate**:送出前重查訂單現況,若已進入「不該再寄」狀態 → 抑制。**「哪些狀態該抑制」= §8-★S3 Sean 拍**(退款/取消後是否仍寄原「付款成功」信)。

### 4.2 🔴 Vault / pg_net / pg_cron secret 面(R2 F2 銷案;E2b 硬規)
1. **`cron.schedule` 的 command 零內插**:排程 SQL **絕不含 secret 字面**(否則明文落 git + `cron.job.command` + `cron.job_run_details`);只呼叫 **`SECURITY DEFINER` wrapper**,由 wrapper **執行期**按固定名稱讀 `vault.decrypted_secrets`。
2. **E2b migration 必須 REVOKE `net` / `vault` / `cron` 三 schema 對 PUBLIC/anon/authenticated/service_role 的表與函式權限 + fail-closed DO 斷言**。
   🔴 **依據(codex 親讀 pg_net 原始 SQL)**:官方安裝腳本**明載授權 `net` tables/sequences 給 PUBLIC** → **不可假設託管環境已替你收緊**。`net.http_request_queue.headers` 會**暫存完整 request header**(含 Authorization)=DB 內短暫明文。
   Vault 官方:「任何擁有 `SELECT vault.decrypted_secrets` 的角色都能直接看到明文」、官方明確要求保護此 view(https://supabase.com/docs/guides/database/vault )→ **現行託管專案實際 ACL 未被本 plan 證實 → migration 必須自行 REVOKE 並逐角色斷言,不靠預設值。**
3. **sweeper response 零回顯**:`net._http_response` 存**回應** header/body **6 小時** → response 必須 counts-only、零 PII、零 secret(否則自己把 secret 回顯進 DB)。

### 4.3 ACL 二裁:**採 GRANT service_role(Fable)+ 記錄分歧**
🔴 **兩審正面對撞**:codex R2-6 裁 **RPC-only**(理由:storefront 任一取得 service key 的 server 端程式都能讀全部客戶 email、任意改寄送狀態);Fable R2-Q5 裁 **GRANT 夠**(理由:**RPC-only 不縮小實際 blast radius**——持 service_role key 者本就能讀 `orders`/`customers` 全表,價值遠高於 outbox;tier 片欄級收斂的前例是「防直改高價值欄」,outbox 無此性質)。
**Claude 採納 Fable**,理由=blast radius 論證更強(outbox 的 email 是 `customers.email` 的子集,RPC-only 不減少實際暴露,卻要多寫 4-5 支 RPC + 每封多次往返)。**但同時採納 codex 的邊界要求**(§5.1 server-only 模組)——兩者不衝突。
⚠️ **此為兩審分歧、由 Claude 判定 → Sean 可否決**(§8-S4,非必拍)。
**偏離註記(Fable n3)**:本表 GRANT `INSERT,SELECT,UPDATE` **偏離** cited pattern(`20260712210000:89` 是 INSERT-only、明寫「不給 SELECT」)——理由正當(認領需 SELECT+UPDATE),**DO 斷言允許集須明寫與 audit_log 不同**。

---

## 5. 拆片(R2-Q8:再拆;**兜底先上**不可調)

> 🔴 **v3.3 作廢公告(Sean Q13=A;E2a-a 三審抓出本檔內部字面打架)**:本表原 E2a 欄寫「**+ failed 告警**」,
> 但 **§3.6 規定五訊號全掛 anomaly-alert 獨立管道、且紅字「不可放進 sweeper 自我監看」** → 兩處衝突。
> **採 §3.6 → 「E2a + failed 告警」字面作廢**:**E2a-a/b/c 三片皆不得實作任何告警**,五訊號全歸 **E2a-2**。
> 理由:sweeper 自己死時,它發的告警一起死 = 等於沒有告警;且 E2a-2 會再做一次 = 重工。

| 片 | 內容 | 硬閘 |
|---|---|---|
| **E1a** | migration `email_outbox`(表+ACL+索引+DO 斷言) | 🔴 Sean db push → 值班台 prod 交易模擬 → 才推 |
| **E1b** | `IEmailOutbox` port + `SupabaseEmailOutboxAdapter`(寫入/認領/標記/**gate 假信箱**)+ `IEmailSender` port + `ResendEmailSenderAdapter`(含 Idempotency-Key)+ 單測 | code-reviewer;依賴 E1a apply |
| **E1c-1** ✅ | 🔴 **v3.2 新增片(Sean Q6=A 授權窄幅破例 + Q10=A 拆片)**:Resend 429 三分(讀 body 頂層 `name`)+ union +3 碼(逐碼退避政策入 JSDoc)+ **法條改寫**(`IEmailSender`+adapter 檔頭)+ 本地 `ResendFetchLike` + 測試 7→17。**為何**:429 恆映射 `http_429` → 撞日額度(Free=100 封/日)的信幾分鐘內燒完 attempts → **永久死信** | 關卡1 雙審 FAIL→修;關卡2 R1 雙審 FAIL→修→R2(code-reviewer PASS / codex FAIL → Sean **Q11=A** 銷案)。commit `e90cbd3` |
| **E1c-2** | 🔴 **v3.2 新增片;E2a 動工前硬閘**:退避三列 + **訊號 5** + **訊號 1 述詞修正** 寫進 migration **§⑨** 頭註(**純註解、零 DDL、無需 re-apply**)+ 本 plan §3.6/§5 同步。**為何必須落 migration**(Fable 關卡1 F4):§3.6 頭註自寫「漂移以 migration 為準」而 §⑦ 是審過 4 輪的**四**訊號 → 只寫 plan/JSDoc 會被 E2a 實作者**當漂移丟棄** | code-reviewer(純文件) |
| ~~**E2a**~~ → **E2a-a** ✅ | 🔴 **v3.3:Sean Q12=A 拆三片**(原一片實估 95 分/10-12 檔、超鐵則 4)。**E2a-a(零件層)= ✅ 已完成** `6a8b155`:`IEmailOutbox` +`reclaimStaleLeases(staleBefore, nextRetryAt)`(**擴充 port 非繞過** —— 回收器非 lease 持有者、無 `claimedAttempts`,`leaveSending` 的世代柵欄接不上;且 `lease_reclaimed` **不在 `EmailSendErrorCode` union**、走 `markFailed` 會被 runtime allowlist 改寫成 `provider_error` → 稽核碼被靜默吃掉 → 比照 `order_ineligible` 於 adapter 內部寫死)+ adapter 實作 + 7 測 + **migration §⑩**(回收落點定案=§⑦「必須回頭過訊號表」義務的履行落點) | 三審:code-reviewer R1 FAIL 2 / Fable R1+R2 / **codex R1 FAIL 7 → R2 FAIL 3**(全字面、零程式錯誤);Sean **Q14=A** 收案 |
| **E2a-b**(下一片) | 退避政策模組 + sweeper use-case + 單測(鏡像 `checkAnomalyAlerts` 分層)。退避照 migration **§⑨** 三列:`quota_daily/monthly_exceeded` + `http_429` = 失敗時點 **+24h+jitter、禁指數退避**(Q11=A);`rate_limited` = **15 分+jitter**(§⑨「固定值由 E2a 定」→ Claude 拍);其餘 = 指數 5min×2^(attempts-1) 上限 2h。🔴 **「燒速上限每日 1 次」不需另做機關**:`max_attempts=5` 配 +24h 天然=每日一次 → 5 天緩衝才進死信。🔴 **lease 長度義務**:必 > sweeper 單輪最長執行時間 **+ 跨 instance app 時鐘偏差**(codex:Resend Idempotency-Key **只保 24h** → 停擺 >24h 的重送**會真的寄出第二封**;**送達保證 = at-least-once,不得宣稱「不會重複」**) | code-reviewer + codex 關卡2 |
| **E2a-c** | sweeper route(復用 anomaly-alert 骨架 `route.ts:37-40`、CRON_SECRET+`timingSafeEqual`、503 不吞錯)+ server-only composition(`line-admin.ts:19-21` 三行 pattern:`import 'server-only'` + 受控 eslint 例外 + 窄 cast `as unknown as EmailOutboxClient`;`syntheticEmailDomain` 注入 `LINE_SYNTHETIC_EMAIL_DOMAIN`)+ 單測。🔴 **不進 `vercel.json` crons**(排程走 E2b 的 pg_cron;Hobby cron 一天一次、放不了 `*/5`)。**response counts-only、零 PII** | code-reviewer + codex 關卡2 |
| **E2a-2** | 🔴 **v3.2 拆出**:對帳補寄(§3.5b;**Q4=A 固定下界走 env、未設即 skip 並明說**)+ **五訊號**掛 anomaly-alert **獨立管道**(🔴 不可放進 sweeper 自我監看)+ **Q3=A ineligible gate**(`payment_status='refunded' OR cancelled_at IS NOT NULL`;🔴 **今日命中率 0** —— 兩者皆「有欄位、零程式寫入」,Sean 退款目前人工在 TapPay 後台做 → 待**退款線第一段**〔後台取消訂單〕落地才生效)+ 單測 | code-reviewer + codex 關卡2 |
| **E2b** | 啟用 `pg_cron`/`pg_net` + Vault + `SECURITY DEFINER` wrapper + `cron.schedule('*/5 * * * *')` + **三 schema REVOKE/斷言**(§4.2)+ 連通實證 | 🔴 db push + 值班台驗;**依賴 E2a 已部署** |
| **E3** | `order_created`(§3.3 述詞)+ after() + 文案(**寄出前給 Sean 過目**)。⚠️ 前置=親驗全部 paid transition 發生地 | 鐵則 12 → codex 關卡2 |
| **E4** | `order_shipped`(**S2=B:每批一封**)= 掛 `updateOrderItemWorkflowAction`(`order-actions.ts:89`)成功後寫 outbox + after() + 模板。⚠️ **前置=偵察「一批」的定義**(讀 admin 出貨 UI/action 本體、確認能否一次出多項)+ 定 `dedup_key` 算法(§3.7-2) | code-reviewer(不改 RPC、不動 schema) |

### 5.1 storefront service_role 邊界(Fable R1-MF4;v1 引用失真已更正)
v1 引 `packages/adapters/src/supabase/client.ts:60-65` 稱「兩 app 已共用」→ **該檔 `:56` 字面正是禁令**:「`apps/storefront/` **不可呼叫此 factory**(對齊 PRD §7.3)」;唯一例外=`line-admin.ts:21`(檔內鎖死+受控 eslint 例外註解)。
**規則**:E2a(sweeper)與 E3(checkout 路徑寫 outbox)走 **line-admin 式 server-only 模組**(檔內鎖死、明確 eslint 例外註解、client bundle grep 驗證),**禁裸 import**;列入關卡2 檢核。
**Q7 裁示(兩審一致)→ sweeper 放 storefront**:E3 寫 outbox 本就在 storefront checkout(邊界例外躲不掉);放 admin 省不了例外,反而拆兩 app + 要為 pg_net 在 admin SSO 保護面另開洞。

---

## 6. 鐵則判定
- **鐵則 8** ✅ → 本檔=plan,Sean 拍 §8 才動工。
- **鐵則 12** ✅(schema/migration/GRANT + E3 碰 order/payment 相鄰)→ E1a/E2a/E2b/E3 commit 前跑 codex 關卡2。
- **鐵則 9** → **L2**(Sean 親自拍板,兩審相反 → Sean 定);條件=E3 文案字面過目 + backlog 升級路徑。
- **鐵則 4** → 拆 6 片(E1a/E1b/E2a/E2b/E3/E4)。
- **鐵則 3**:E3/E4 前台觸發 + outbox 落表同片。

## 7. 驗收
- 三綠 + **完整** `pnpm test`(動 packages/ports+adapters)。
- **E1a 值班台 prod 交易模擬** → 🔴 **v3.1:權威清單移交 migration 檔尾**(`20260717020000_m4a_email_outbox.sql` 斷言 0-13 + 總則 A/B)。本行原字面有**三處已被實證推翻**,勿照跑:
  1. ~~「BEGIN → 套 migration → 斷言 → ROLLBACK → 零留痕」~~ → migration **自帶 `BEGIN;`/`COMMIT;`**,外包一層會被內部 COMMIT **真的提交** → **prod 留痕**。須剔除自帶 BEGIN/COMMIT(路徑①),或改走 db push 後驗收(路徑②,表已存在、只有資料零留痕)。
  2. ~~「CAS 併發模擬(兩 writer 恰一 winner)」~~ → **在 rollback-only 腳本內物理上不可行**(未提交列對另一 session 不可見)→ **移至 disposable DB**(先 COMMIT fixture 再雙連線)。
  3. ~~「aclexplode 全 allowlist(postgres+service_role only)」~~ → 方向對,但**已升級為 migration 內的 DO 4e 自驗**(+4f 欄級 ACL、4g RLS);另加 **斷言 0 = db push 前 `pg_default_acl` 唯讀探針**(含 self-entry carve-out:defacl 定義者自身 entry 正常、**不要對 owner 補 REVOKE**)。
  ⚠️ 另注意**鎖面**:建 FK 會對 `orders` 取 SHARE ROW EXCLUSIVE、持有到交易結束 → **不可開著 txn 人工逐條核**(會卡住真實結帳建單);migration 內已加 `SET LOCAL lock_timeout='3s'` fail-fast。
- **E2b 交易模擬加驗(§4.2)**:`vault`/`net`/`cron` 三 schema 對 anon/authenticated 的 `has_schema_privilege`/`has_table_privilege` fail-closed 斷言;`cron.job.command` **零 secret 字面**;`net.http_request_queue`/`net._http_response` 對非 owner 零權限。
- **E2b 連通實證**(不可只看 SQL 寫對):`cron.job_run_details` 有成功紀錄 + Vercel 端收到請求 + `net._http_response` 可查 → ⚠️ **只留 6 小時,驗證要在 6 小時內做完**。
- 單測:寫入 / **gate 假信箱不呼 Resend** / CAS 認領 / 退避 / max_attempts 停 / **對帳固定下界+NOT EXISTS 不漏晚翻 paid 的單** / 首跑不回灌上線前舊單 / lease 不誤殺在途 / **dead-man check 觸發告警** / after() 內失敗不影響 response。
- 🔴 **PII 驗收**:①anon/authenticated 對 email_outbox 零權限 ②client bundle grep 零 `email_outbox`/`recipient_email` ③log 零 email 字面 ④告警信零 PII ⑤**secret 零落 DB 明文**(§4.2)。
- Sean 肉眼驗:E3 真下一單收信、E4 admin 改出貨收信。

## 8. Sean 必拍 — ✅ **S1/S2/S3 已於 2026-07-16 深夜拍板、銷案**

1. **★S1 是否過度工程** → ✅ **拍 A=做完整版(薄 outbox + sweeper + 自動重試 + dead-man check)**。即 plan 預設架構(PRD §6.6 明文要求)。極簡案(await+人工補)**否決**。
2. **★S2 `order_shipped` 業務語意** → ✅ **拍 B=每出一批寄一封(部分出貨也通知、接受客人收多封)**。→ **E4 unblock**;🔴 **連鎖=`UNIQUE(event_type,order_id)` 作廢→改 `dedup_key`(§3.7/§4);「一批」的定義=E4 開工前偵察後定。**
3. **★S3 退款/取消後是否仍寄 + 重複風險認可** → ✅ **拍 A=不寄**(送出前 gate:訂單已退款/取消 → 抑制,§4.1);**且 Sean 認可「無法保證只寄一次」的物理限制**(at-least-once + 實務極低重複率;非自宣接受=Sean 明示認可)。
4. **S4(非必拍、Claude 已判、可否決)**:ACL 採 GRANT service_role(Fable)而非 RPC-only(codex)——§4.3 有分歧全紀錄。**Sean 未否決 → 照 Fable 裁示執行。**

### 8.1 仍待 Sean 拍(不擋本片動工)
- **(與本片無因果)Vercel 升 Pro?** 官方明載 Hobby 禁商業用途、PCM 賣場已命中、$20/月=既存合規風險。**Sean 已知悉未拍。**
- **(LINE 補資料獨立線動工前)** 真實 email 存哪、如何與 auth.users 同步、如何不破壞既有 LINE 防冒登入設計。
- **(E4 設計期可能浮現)** 「退回再出貨」是否寄第二封(§3.7-3;現況 plan 不假設)。
5. **(與本片無因果)Vercel 升 Pro?** 合規議題:官方明載 Hobby 禁商業用途、PCM 賣場已命中。$20/月。**Sean 已知悉、未拍。**
6. **(Q1 獨立線動工前)** 核心決策=「真實 email 存哪、如何與 auth.users 同步、如何不破壞既有 LINE 防冒登入設計」。

## 9. 連動 / Sean 手動項
- **env `ORDER_EMAIL_FROM=orders@pcmmotorsports.com`** → ⚠️ **storefront + admin 兩個 Vercel project 都要設**;新信箱是否免重驗網域=**未確認**,E1 前實測。
- **Sean 手動項全清單(Q10 裁示)**:①Dashboard/SQL Editor 啟用 `pg_cron`+`pg_net` ②SQL Editor 跑 `vault.create_secret`(**值不進 git 不進對話**)③Vercel 設 sweeper secret(**與 Vault 同值**)④db push E1a/E2b ⑤兩 project 設 `ORDER_EMAIL_FROM` ⑥E3 文案字面過目 ⑦肉眼驗 E3/E4。
  **部署順序(Q10)**:E2a 先部署 → Vercel 設 secret → Vault 寫同值 → db push E2b → 驗 cron/Vercel/ACL/無 header 回顯 → 才准 E3。
  **Rollback**:先 `cron.unschedule` → 再移除 wrapper;secret 由 Sean 手動輪替或刪除。
- **memory**:`m4a-email-notify-decisions` / `m4a-email-trigger-no-money-rpc`(C 案釐清)/ `reference_pcm-platform-plans-vercel-hobby-supabase-pro` / `250-email-alert-resend-verified-domain` / `shopify-payment-first-order-phase2-target`(孤兒單不刪 ↔ `ON DELETE RESTRICT` 一致=Fable 裁無衝突)。
- **backlog** → 🔴 **v3.1:已開立實體條目**(前版只是清單、**實際查無 = 字面 vs 事實錯誤**,codex R5 抓出;現最大 **#284**):
  - **#281** outbox 保留政策 + 清理 job(PII `recipient_email` 無限期滯留;E3 上線後升高優先)
  - **#282** `cron.job_run_details` 清理(**E2b 啟用 pg_cron 後**才有對象;保留期須 > dead-man 偵測窗)
  - **#283** Resend bounce webhook(打錯的真實信箱目前零回饋;`sent` 只代表 Resend 接受、非客人收到)
  - **#284** 文案後台可改(L2→L3 升級路徑;Q4 拍板的已知取捨、非遺漏)
  - ~~per-item 部分出貨信~~ → **已刪除**:Sean 拍 S2=B 後**移入本片範圍**(§3.7-4),不是 backlog。
  - **LINE 補資料獨立線**(Q1;含「哪些 `skipped_no_real_email` 列翻轉」的設計)= **獨立線、非 backlog 條目**,動工前置 = Sean 先拍「真實 email 存哪」(§8.1)。🔴 紅線見 §3.4(嚴禁 pattern-match `skipped%`)。
  三視角照鐵則 10、已逐條寫「不修未來痛在哪」。
- **不連動**:`create_order` RPC / `admin_update_order_workflow` RPC / 告警線 #254/#255。

## 10. 兩審擊不破的一點(兩輪一致)
§3.5-1 的 DB CAS 認領:`UPDATE … WHERE id=$1 AND status IN ('pending','failed')` 以 affected rows=1 當所有權憑證——雙 sweeper 併發、lease 回收撞在途、shipped 退回再 shipped 三種交錯全被擋。READ COMMITTED 行鎖 + 重評 WHERE → 恰一 winner。**這是本 plan 最扎實處。**

— 執行視窗(Claude Code),2026-07-16 深夜
