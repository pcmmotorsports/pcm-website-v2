# M-4a 客戶線(至儲值金編輯)收工上 production + 新視窗 kickoff(2026-07-16 值班審查台收尾)

> 寫者:值班審查台(Fable、本日下午)。客戶線前四片全審畢上線,本檔=新開的「執行視窗+審查視窗」開工依據。
> 入口鏈:`CURRENT.md`(本檔摘要)→ 本檔 → `STATUS.md`(已同 commit 對齊)。

## 1. 本輪完成(值班審查台視角)

- **STATUS 主表重寫** `6c34037`(docs)——review-lite PASS 代推。
- **客戶明細-a** `30659b8`(基本資料+儲值金顯示,唯讀)——快掃 PASS;儲值金 override 拍板親驗 memory 屬實;登入閘 default-deny 覆蓋驗實;代推。
- **客戶明細-b** `675b949`(訂單歷史+地址+車庫,唯讀)——快掃 PASS;三處 adapter `.eq('customer_user_id')` scoping 親讀本體驗實;#278(unpaid 濾單)誠實揭示非隱瞞;代推。
- **儲值金編輯** `afea2b7`(🔴 動錢硬閘)——全鏈:plan 關卡1 R1 PASS(0 must-fix、3 note)→ 執行台實作+code-reviewer PASS+codex 兩輪 4 findings 全修(含 PG `E'\v'` 字面陷阱→`\013`)→ 值班台 code 審 PASS → Sean db push `20260716210000` → **值班台 prod 交易模擬全 PASS**(ACL aclexplode 全 allowlist=postgres+service_role only;快樂路加值/扣款/負餘額+audit before/after 快照精確;5c `vip客戶v` 首尾字保留;**26 樣本拒收矩陣全 RAISE 零寫入**〔含 Unicode 空白繞過 6 種〕;NOT_FOUND;ROLLBACK 零留痕)→ 代推。
- **D1 撞板事故+解**:Sean 初拍 D1=A(不加 JS)因時間差未達執行台;codex F1 逼出 pending-disable island;Sean **重拍 D1=A(最終)=island 保留、DB 級 idempotency 去重開 backlog 隨 tier 片評**;D2=A 上界 1000 萬。全落 memory `project_wallet-deposit-taiwan-legal-hold`。
- **🚀 dev:main FF 上 production**(Sean 07-16 明說授權;含本 handoff docs commit)。

## 2. 現況快照

- **branch**:`dev` = `origin/dev` = `origin/main`(本 handoff commit;前一 feature commit=`afea2b7`)。
- **DB**(A庫 `bmpnplmnldofgaohnaok`):migrations 至 **`20260716210000`** 全 apply;`admin_adjust_wallet` live 驗訖(ACL/行為/零留痕)。
- **working tree**:僅既有凍結 dirty(`.gitignore`/`*.png`/docs 群/`docs/superpowers/`)——接手不得 reset/stash/混 commit。
- **Sean 開站驗收(累積待驗)**:①admin 客戶明細五區塊+儲值金加值/扣款實操 ②正式站 `/products` 年份卡片。

## 3. 下一階段(M-4a 第一期收口、Sean 07-16 拍優先序)

| # | 件 | 風險 | 備註 |
|---|---|---|---|
| **1** | **tier 編輯**(客戶線最後一片) | 🔴 高風險件#3 | service_role 寫 customers.tier+audit+**step-up**;鐵則 8=先偵察 pass→plan 丟 review-inbox 過關卡1 才動工;step-up 門檻(auth_time 多久算近期+過期 re-auth 動線)屆時給 Sean 拍;偵察已知=audit_log 已 apply 在用/actor 現為過渡 cookie |
| **2** | Email 通知片 | 🔴 schema+PII | plan=`docs/handoff/2026-07-13-email-notification-slice-plan.md`;動工前先拍「觸發點碰不碰金流 RPC」 |
| **3** | 最新商品(storefront) | 例行 | |
| 4 | 小件穿插:Q3d 佔位圖/Q3a 佔位頁/Q3e 結帳內嵌地址 | 小 | |

**執行台順手欠帳(下一片一併、不單開 commit)**:①backlog 新開「儲值金 ledger DB 級 idempotency 去重」(codex 強烈建議、Sean 拍隨 tier 片評;三視角照鐵則 10)②`SupabaseOrderAdapter.ts:176` docstring「零 service_role」字面漂移一行修(明細-b verdict nit)③STATUS 待決策 D1/D2 已銷案(本檔 commit 已代辦)④**開工先補跑 `/pcm-roadmap` + `/graphify --update`**(07-10 拍板=每日/milestone 一次;07-16 尚未跑)。

## 4. 兩視窗開工步驟

**執行視窗**:①Sean 跑 `busboy-start.js pcm` 貼 template ②讀 `CURRENT.md`→本檔 ③首件=tier 編輯偵察 pass→plan 丟 `/Users/sean_1/pcm-tools/review-inbox/`(檔名 `m4a-tier-edit-plan.md`)等關卡1 verdict 才動工。

**值班審查台視窗**:①重掛雙哨兵(inbox 15s 輪詢新 `.md` 排除 `*.verdict.md`、無 `.seen` 才觸發+touch;repo commit 監看)——哨兵隨 session 死必重掛 ②接單=touch `.seen`→refute-first 審→verdict 寫回 `<slug>.verdict.md`。

## 5. 審查台慣例(本輪確立/沿用,新審查視窗照做)

- **代推一律走乾淨 worktree**:`git worktree add --detach <scratchpad>/wt <sha>` + `pnpm install --frozen-lockfile` + 從 worktree `git push origin <sha>:dev`——live 樹被執行台施工汙染時 husky pre-push(typecheck+lint)會誤殺;worktree 推=hook 驗的正是被推內容。已知坑:worktree root `.bin` 缺 tsc symlink → `PATH="$WT/packages/domain/node_modules/.bin:$PATH"` 補(memory `reference_od-worktree-typecheck-gotcha`)。
- **審查分級**:例行 UI=快掃(diff 全讀+新測親跑+紅線 grep;R1 PASS 含 nit 即收);硬閘(schema/RPC/migration/tier/權限/金流相鄰)=隔離 worktree 淨驗+prod 庫單呼叫交易模擬(BEGIN→合成 auth.users〔trigger 自動建 customers〕→fail-loud ASSERT→攻擊樣本→ROLLBACK→零留痕另查)+aclexplode 全 allowlist;codex 第三眼僅鐵則 8/12 觸發、每 diff 硬上限 2 輪。
- **動 schema 的 commit 壓住不推**,等 Sean db push+值班台驗欄才放行;`dev:main`=Sean 明說;db push=Sean 終端機(`.env.local` 暫移開=CLI 讀檔 blocker);絕不動 `.env*`。
- **拍板即落檔**:Sean 每板當場寫 memory+(跨視窗)丟 directive 單進 review-inbox——本輪 D1 撞板=教訓實錘(執行台沒接到初拍、codex 撞出矛盾;directive 單機制補上這個洞)。

## 6. 風險 / 未決(不擋線)

- **待 Sean 拍(時點到才拍)**:①Email 觸發點碰不碰金流 RPC(動 Email 片前)②step-up 門檻(tier plan 時)③(非阻擋)車款繼承件 inherited 年份。
- **backlog(不擋)**:儲值金 DB 級去重(待執行台落檔)/Fable F1 表級 CHECK/F2 哨兵 md5/create_order p_invoice 自由欄型別/admin 明細頁未顯 vehicle_snapshot/#278 unpaid 查法另片/V-2g 雙擊縮放刻意未做。
- **0072 雙扣退款**:Sean 手動 W1 runbook,仍 open。
- **#215 tier server 認證**:defer,真死線=M-2-08 接真經銷價前(tier 後台寫不需 #215 前置=07-13 分析)。

— 值班審查台(Fable),2026-07-16
