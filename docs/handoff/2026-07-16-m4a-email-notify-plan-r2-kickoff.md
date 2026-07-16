# M-4a Email 通知片 — 規劃收工 + 實作視窗 kickoff(2026-07-16 深夜,執行視窗)

> 寫者:執行視窗(Claude Code)。**本視窗只做規劃與審查,零 code 改動、零 commit(除本 docs)、未 push。**
> Sean 深夜交代:「要大量修改開新的視窗繼續,我要睡了,你安排完整計畫,看要怎樣跑」→ 本檔=新視窗的完整開工依據。
> 入口鏈:`CURRENT.md` → 本檔 → plan v2(真權威,見 §2)。

---

## 1. 本視窗做了什麼(一句話)

Email 通知片**規劃階段**:偵察 → plan v1 → **雙審皆 FAIL(Fable 7 + codex 9 must-fix)** → Sean 拍四板 → **架構大改(免費解)** → plan v2 → R2 雙審。**動工前置全部備齊,實作交新視窗。**

## 2. 真權威檔案

| 檔 | 內容 |
|---|---|
| **`/Users/sean_1/pcm-tools/review-inbox/m4a-email-notify-plan.md`** | **plan v2=唯一真權威**(含 §10 v1 must-fix 銷案表、§8 未決 11 題) |
| `~/.../memory/project_m4a-email-notify-decisions.md` | Sean 四拍板 + 雙審 must-fix 摘要 + 教訓 |
| `~/.../memory/project_m4a-email-trigger-no-money-rpc.md` | 🔴 觸發點「A」字面已釐清=**C 案(app 層)不是 trigger** |
| `~/.../memory/reference_pcm-platform-plans-vercel-hobby-supabase-pro.md` | 🔴 平台方案實查:**Vercel=Hobby / Supabase=Pro** |
| `docs/handoff/2026-07-13-email-notification-slice-plan.md` | 底稿,**四處字面已被實證推翻、不可直接照做** |
| R2 verdict | Fable=本視窗 subagent 產出、codex=scratchpad `codex-r2-out.txt`(**session 結束即失效 → 結論須由本視窗謄進 §6**) |

## 3. Sean 四拍板(07-16 深夜)

1. **Q1 LINE 會員無真實信箱** → 拍:**下單前強制補足會員資訊包(姓名/電話/地址/email)**。🔴 **=範圍擴張、獨立線、不併本片**(偵察:4-5 slice、碰金流 gate、需 LINE 官方 email scope 審核=外部依賴)。本片只做 fail-safe:假信箱不寄。
2. **Q2 `order_created` 觸發** → **A=只在付款成功才寄**(PCM 是先建單後扣款,建單即寄會寄給棄單者)。
3. **Q3 送達時效/花錢** → **先窮盡免費路**(原話:「難道每一個網站這個功能都是這樣設計?」)→ 已找到免費解(§4)。
4. **Q4 文案分級** → **A=L2 hardcode**(兩審查員此題意見相反 → Sean 親自拍板銷案)。

## 4. 🔴 架構定案(v1→v2 的關鍵轉向)

**v1 死在**:Vercel Hobby cron 一天只能跑一次、±59min、best-effort(漏跑不補、失敗不重試)→ 靠它送/兜底=最壞**無上限**。
**v2 解**:**排程不綁 Vercel**。Sean 已付費的 **Supabase Pro** 內建 `pg_cron`(可分鐘級、無 Free pause 風險)+ `pg_net` → 打 Next sweeper。**零新供應商、零新帳號、零額外費用。**

```
[付款成功] → app 層寫 email_outbox(交易外、不改 create_order)
      → after() 立即嘗試送 Resend(秒級、非 durable)
      → pg_cron(*/5)+ pg_net → Next sweeper 兜底(認領→送→標記→退避重試)
      → 仍失敗 → failed + 告警給 Sean
```
**送達保證來自 outbox 狀態機 + Resend Idempotency-Key,不是排程準時。**
三方獨立收斂(Fable / codex / 業界研究);GitHub Actions 被否決(每 5 分鐘=8,640 次/月 > private repo 2,000 分鐘/月免費額度);pgmq 判定過度工程。

## 5. 實作拆片(**兜底先上**=codex MF-6;順序不可調)

| 片 | 內容 | 硬閘 |
|---|---|---|
| **E1** | migration `email_outbox`(表+ACL+索引+DO 斷言)+ port/adapter(寫入/認領/標記/**gate 假信箱**)+ `IEmailSender`+Resend adapter(含 Idempotency-Key) | 🔴 Sean db push → 值班台 prod 交易模擬 → 才推 |
| **E2** | sweeper route + **pg_cron/pg_net/Vault migration** + 對帳補寄 + lease 回收 + 告警 | 🔴 同上 + pg_net→Vercel 連通實證(⚠️ `net._http_response` **只留 6 小時**,驗證要在 6 小時內做完) |
| **E3** | `order_created`(**付款成功後**寫 outbox + after())+ 文案(**寄出前字面給 Sean 過目**) | 鐵則 12 → codex 關卡2。⚠️ **前置=先偵察 paid transition 到底發生在哪幾處**(settleCharge/tappay-notify/settle-sweep 皆可能),不得憑 plan 字面直接寫 |
| **E4** | `order_shipped`(admin action 成功後寫 outbox + after()) | code-reviewer |

## 6. 🔴 新視窗開工前必做(順序)

1. **讀 R2 verdict 結論**(§7 由本視窗謄寫;若 §7 標「未謄」=本視窗 session 中斷,**必須重跑 R2 才動工**,不得跳過)。
2. **確認 Sean 已答 §8 的待拍題**(未答=不動工)。
3. E1 開工前:`ORDER_EMAIL_FROM` 新信箱是否需重驗網域=**未確認**,實測後才寫死。
4. 照 SOP:每片 → 三綠 → code-reviewer → (E1/E2/E3)codex 關卡2 → commit(動 schema 的**壓住不推**)→ Sean db push → 值班台驗 → 才放行。

## 7. R2 verdict 結論(已謄;plan 已出 **v3** 銷案)

**兩審皆 FAIL**(Fable 3 must-fix / codex 8 must-fix)→ **plan v3 已逐條銷,銷案表=plan §0。**
🔴 **plan 層審查上限 2 輪已用盡 → v3 不再開 R3 全審**(Fable R2 明示建議:三條 must-fix 皆非方向分歧、修法唯一 → 由 **Sean 過目 v3 §0 銷案字面 + 拍 §8 必拍題** 即收關卡1)。

**R2 抓到的重點(v1 沒有、v2 才引入或才浮現)**:
1. 🔴 **`order_shipped` 事件在現況不存在**(codex 親驗 `order-actions.ts:36-81`):`admin_update_order_workflow` 只改 workflow/配送/發票,**D2 per-item 落地後訂單層 workflow 已不代表出貨** → **E4 BLOCKED,等 Sean 定義**(plan §8-★S2)。
2. 🔴 **`paid_candidate` 不可當觸發述詞**:它只是金流驗證判定、後續 confirm RPC 仍可能失敗 → 述詞收窄為「confirm RPC 成功後 `orders.payment_status` 轉 `paid`」(plan §3.3)。⚠️ **3DS late-success / settle-sweep 補結=實際存在的晚翻 paid 路徑** → E3 前置=親驗全部 paid transition 發生地。
3. 🔴 **pg_net secret 面**(codex 親讀 pg_net 原始 SQL):**官方安裝腳本明載授權 `net` tables/sequences 給 PUBLIC**、`net.http_request_queue.headers` 暫存完整 request header(含 Authorization)=DB 內明文 → E2b 必須自行 REVOKE `net`/`vault`/`cron` 三 schema + fail-closed 斷言,**不可假設託管環境已收緊**;`cron.schedule` command 零內插、只呼 SECURITY DEFINER wrapper 執行期讀 Vault(plan §4.2)。
4. 🔴 **「pg_cron 沒跑=無人知」不可丟 backlog**(違 R6 自宣接受殘餘風險):outbox 狀態機只給 **safety**,**liveness 完全繫於排程** → **dead-man check 納入 E2a**(復用**獨立管道** anomaly-alert daily cron 檢查最老 pending age,**不可由 sweeper 自我監看**)(plan §3.6)。
5. **skipped × 唯一鍵矛盾**:假信箱 skipped 列佔住 `UNIQUE(event_type,order_id)` → 日後補真 email 的新 INSERT 被擋=LINE cohort 永久漏信 → skipped 改「可翻轉態」、由 Q1 線受控 UPDATE 翻回、**不自動回灌**(plan §3.4)。
6. **對帳補寄否決移動 watermark**:晚翻 paid 的舊單會落游標前永久漏掃 → 採「固定下界=上線時戳 + `NOT EXISTS` 全量重疊掃描」、述詞欄 `orders.paid_at`(plan §3.5b)。
7. **拆片再拆**:E1a/E1b/E2a/E2b/E3/E4(plan §5)。

**兩審分歧一題(Claude 已判、Sean 可否決)**:ACL — codex 裁 RPC-only / Fable 裁 GRANT service_role 已足(理由:RPC-only 不縮小 blast radius,持 service_role key 者本就能讀 `customers` 全表)。**採 Fable + 同時採 codex 的 server-only 邊界要求**(兩者不衝突),全紀錄=plan §4.3。

**兩輪四審一致擊不破**:DB CAS 認領(`WHERE status IN ('pending','failed')` + affected rows=1)=plan 最扎實處。

**銷案表已核**(Fable R2 逐條):v2 引用紀律「零引用失真」、遠優於 v1;`payload` 不可變快照論證經親驗成立(條件:M-3 退款線若動單內容須重審)。

## 8. 🔴 等 Sean 醒來拍(未答不動工)

1. **★是否過度工程(plan §2.5)**:codex 誠實揭示——若「信件只是方便通知、訂單真相在後台、有人會巡檢」→ **await 送 + failed 告警 + 人工補** 就夠,outbox+sweeper 是過度工程;若「承諾客人可靠收到、沒人每日巡檢」→ 薄 outbox+sweeper 是合理基本設施。**PRD §6.6 明文要求 outbox+重試**,故 plan 預設走後者。**這是 Sean 的板,不是模型的。**
2. **Vercel 升 Pro?**(合規議題,**與本片無因果**):官方明載 Hobby 禁商業用途,PCM 賣場已命中(「Advertising the sale of a product or service」+「processing payment」)。$20/月。**Sean 已知悉、尚未拍。**
3. **Q1 獨立線動工前**:核心決策=「真實 email 存哪、如何與 auth.users 同步、如何不破壞既有 LINE 防冒登入設計」——**Sean 須先拍此點**才能排 slice。
4. R2 若判出「必須 Sean 拍板」的新題 → 見 §7。

## 9. Sean 手動項(彙整)

①db push E1/E2 migration ②**storefront + admin 兩個 Vercel project 都要設** `ORDER_EMAIL_FROM=orders@pcmmotorsports.com` ③Supabase Vault 寫入 sweeper secret(不可進 git)④E3 文案字面過目 ⑤肉眼驗 E3/E4。

## 10. Working tree / 紀律

- 本視窗**零 code 改動**;新增 docs=本檔;memory 三檔(§2)。既有凍結 dirty 未動(`.gitignore`/`*.png`/docs 群/`docs/superpowers/`)——接手不得 reset/stash。
- **未 push、未 commit code**;`dev:main` 恆 Sean 明說。
- codex 兩輪(R1+R2)全程 `-s read-only`,跑前後 `git status --porcelain` 比對**零留痕 PASS**。
- ⚠️ **值班審查台視窗當時未開**(kickoff 檔字面「在線」是寫檔當下狀態、非當前事實)→ 本片改用「Fable subagent + codex」雙審。**新視窗若需硬閘驗證(E1/E2 交易模擬),須先確認審查台是否在線,不得照字面假設。**

## 11. backlog 待開(#281 起;現最大 #280,`docs/phase-1-backlog.md:6931`)

①outbox 清理 job ②per-item 部分出貨信 ③文案後台可改(L2→L3 路徑)④**pg_cron heartbeat 偵測**(沒跑=無人知)⑤`cron.job_run_details` 清理(官方未給預設保留期、會長大拖效能)⑥Resend bounce webhook 接入 ⑦**LINE 補資料獨立線**(Q1 拍板)。三視角照鐵則 10 寫「不修未來痛在哪」。

— 執行視窗(Claude Code),2026-07-16 深夜
