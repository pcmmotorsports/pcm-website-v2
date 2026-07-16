# M-4a V 線收工上 production + 下一階段 kickoff(2026-07-16 值班審查台收尾)

> 寫者:值班審查台(Opus 4.8、本日凌晨~中午)。V 線全線審畢上線,本檔=下一個執行視窗的開工依據。
> 入口鏈:`CURRENT.md`(本檔摘要)→ 本檔 → `STATUS.md`(⚠️ 主表過時、見 §4)。

## 1. 本 session 完成(值班審查台視角)

- **V-2h 批**:codex 盲審 6 must-fix(MF-1 §7 slug 碰撞假✓ ~ MF-6 結帳顯車款)+ 拆 ProductPage(鐵則6、401→229)+ nit-7/8——逐片對抗審 PASS、代推。
- **V-2f**(RWD 375px 溢出)/ **V-2g**(lightbox 自實作 pinch-zoom)/ **V-3b**(admin 訂單列表車款欄)——審 PASS、代推。
- **codex round2**(gpt-5.6-sol)抓到 V-3a 型別破口(create_order brand/model/raw 無 jsonb_typeof 重驗、非字串 `->>` coerce 落庫)=值班台三查確認真 must-fix。
- **Sean 拍板 Q1=A / Q2=B** → **Codex Sol High 首次當執行方**寫兩片:`cd79939`(20260716200000 型別閘)+ `b6c97fd`(taxonomy dedup key 改 normalizeVehicleQuery、name 保 first-seen);規矩零瑕疵。
- 審驗鏈:Opus 審+prod 庫交易模擬 9 攻擊樣本(非字串→NULL 全過、零留痕)→ **Fable 終審 PASS 0 must-fix** → Sean db push `20260716200000`(值班台 MCP 驗 live 三閘+ACL 不變)→ Sean 真機驗 V-2g/V-2f → **`dev:main` FF 上正式站**。
- 教訓落 memory:`reference_review-desk-verify-commit-in-worktree`(live 樹恆被下一片汙染、commit 淨驗一律隔離 worktree)。

## 2. 現況快照(全對齊、零待推)

- **branch**:`dev` = `origin/dev` = `origin/main` = **`b6c97fd`**;production 部署 READY(sha 驗訖)、`shop.pcmmotorsports.com` 200。
- **DB**(A庫 `bmpnplmnldofgaohnaok`):migrations 至 **`20260716200000`**(V-3a 三支全 apply;create_order 型別閘 live 驗訖)。
- **連帶上線**:本次 FF 23 commits 含先前暫緩的 **P4+S4 目錄卡片年份 + priceMax=0 修**——STATUS Blocker「/products preview gate + 混批暫緩」**已自然解除**;🔴 剩 Sean 在正式站肉眼驗 `/products`(年份卡片/N 款車型/換頁篩選)。
- working tree:僅既有凍結 dirty(`.gitignore`/*.png/docs 群);`docs/superpowers/` 等 untracked 照舊勿動。

## 3. 下一階段候選(M-4a 第一期收口;標號給 Sean 選)

| # | 件 | 體量/風險 | 備註 |
|---|---|---|---|
| **1** | **M-4a 客戶線**(admin 客戶 tab;含 **tier 編輯**=service_role 寫 customers.tier+稽核+step-up) | 大/🔴 高風險件#3 | 第一期承諾(Q2=C 訂單+客戶);tier 寫後台路徑**不需 #215 前置**(07-13 分析) |
| **2** | **Email 通知片**(下單成功+出貨;outbox 表+sweep cron+Resend 復用) | 中/🔴 schema+PII | plan 備好 `docs/handoff/2026-07-13-email-notification-slice-plan.md`;**一個 Sean 決策懸而未決=觸發點碰不碰金流 RPC** |
| **3** | 最新商品(第一期加項、storefront) | 小 | |
| 4 | 小件穿插:Q2 日期欄/Q3d 佔位圖/Q3a 佔位頁/Q3e 結帳內嵌地址 | 小 | |
| 5 | 搜尋線:S2 lightech #275 → S3 搜尋 MVP;#277 | 中(獨立線) | 真權威 `docs/specs/2026-07-12-search-vehicle-work-plan.md` |
| 6 | M-3 真刷卡 gate(sandbox 3DS E2E+Sean 驗收;prod checkout 仍關) | 大(獨立線) | |

**值班台推薦**:1 → 2 → 3(把 M-4a 第一期收口),4 穿插;M-4a 收尾後開 Sean 交代的「**流程再優化**」正式題(memory `project_reminder-process-optimization-after-m4a`)。

## 4. 風險 / 未決 / 欠帳

- **STATUS.md 主表嚴重過時**(當前 slice 還停在 D-2/V-1);下個執行 session **開工首件=重寫 7 欄**(V 線收工+main=b6c97fd+本檔為據)。
- **backlog(不擋線)**:①Fable F1 表級 CHECK 縱深 ②F2 哨兵 md5 探測 ③create_order p_invoice 自由欄無型別重驗(pre-existing LOW)④admin 明細頁 `/orders/[id]` 未顯 vehicle_snapshot ⑤V-2g 雙擊縮放刻意未做。
- **#215 tier server 認證**:defer,真死線=M-2-08 接真經銷價前(07-13 分析:現況零洩漏)。
- **0072 雙扣退款**:Sean 手動 W1 runbook,仍 open。
- **graphify/roadmap 未刷**(值班台 context 深、跳過):milestone 收尾規則=下個 session 開工或每日收工跑 `/pcm-roadmap` + `/graphify --update` 一次即可。

## 5. 下一階段分工 + 模型表(Sean 2026-07-16 拍板方向、值班台整理)

**維持執行/審查分離;回到 Claude 主寫,Sol 當第三眼**(今晚 Codex 主寫實驗成功,但下一批=客戶 tier/email schema 高風險+PCM 規矩密,Claude 寫規矩成本低;Sol 跨模型抓錯已兩度實證、留在審查位)。

| 角色 | 模型+effort | 觸發 |
|---|---|---|
| 執行視窗(寫)高風險片(tier RPC/migration/outbox/金流相鄰) | **Opus 4.8 + high** | 客戶線、email 片 |
| 執行視窗(寫)例行 UI 片 | **Sonnet 5 + high**(或沿用 Opus 視窗) | 最新商品、小件 |
| 第一道審 | **code-reviewer subagent**(每片必跑、一輪制) | 全部 |
| 值班審查台(第二視窗、唯讀+代推) | **Opus 4.8 + high**;卡關/金流硬閘升 **xhigh** | 全部 done 單;硬閘=DB 交易模擬 |
| 第三眼跨模型 | **codex exec -s read-only -m gpt-5.6-sol + high** | 僅鐵則 8/12 觸發(schema/RPC/權限/金流)+ 批尾 round2;非每片 |
| 里程碑終審/卡兩輪 | **Fable**(agent 或 review-inbox) | milestone gate、高風險 sign-off |

不常駐 xhigh、不用 Ultra(衝鐵則 7)。流程=寫→三綠→code-reviewer→值班台審→(高風險)Sol→commit 壓住→值班台代推。

## 6. 新視窗開工

1. Sean 跑 `busboy-start.js pcm` 貼 template。
2. 新 session 讀 `CURRENT.md`(已刷新指到本檔)→ 本檔 §3 拍優先序 → 開工首件=刷 STATUS 7 欄。
3. 值班審查台視窗可沿用本模式重掛雙哨兵(inbox+commit)。

— 值班審查台(Opus 4.8),2026-07-16
