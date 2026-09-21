# CLAUDE.md

> **2026-09-09 減法版(Sean 拍 Q2 甲,試行一週)。** 舊版 23,504 字元:`git show 54bb99e18:CLAUDE.md`。研究全文 `~/pcm-mailbox/診斷-艦隊為什麼一直做量具-20260909.md`。
> 共同安全線 `docs/ops/AI_CONTRACT.md` > 本檔。現況以 `docs/handoff/CURRENT.md` 為準。

## 開工(每 session)
```bash
pwd && git branch --show-current && git status --short && git log --oneline -3
```
施工窗的 `pwd` 不是被指派的 worktree ⇒ 先切回去再做事(2026-09-14 VSCode 重開後四個窗全開在主樹)。
讀 `docs/handoff/CURRENT.md`(這週兩條線、誰在做、卡在哪、下一件)。其他檔命中下面「要查東西時」才讀。

## 這週只做兩條線(細節在 CURRENT.md)
- **窗 A 前台**:客人找商品 → 看商品 → 結帳 → 付款 → 收到信。含搜尋正確與快、商品完整呈現、首頁「最新商品」與最新上架頁要同步。
- **窗 B 後台**:員工收單 → 收款 / 退款 → 建單 / 訂貨 / 到貨 → 出貨 → 客人收出貨信。含每一步狀態與文字正確。
- **做完的定義只有一個:Sean 自己開瀏覽器從頭走到尾。** 測試綠不算做完。

## 做完就停
任務做完、或每一條都卡在別人手上 ⇒ 停下回報。**不去量東西、不寫規則、不加閘、不加腳本、不記事故、不整理板子。** 工具壞了且正擋著這兩條線才修,只修不研究。判別句:這件做完,客人或 Sean 會不一樣嗎?不會 ⇒ 不做。

## 多窗:哨兵(2026-09-11 Sean 拍乙)
**主視窗每派一件工,同一發掛一個哨兵**(`SendMessage` 帶 `notify_when_idle: true`;純訂閱就省略 `message`,不花那個窗任何成本)。窗做完 / 結束 ⇒ 主視窗收到一則通知。

**而哨兵不是唯一那把尺,兩件事要一起做:**
- **回報 Sean 之前先跑 `ListAgents`。** 窗會不會回報是它的事,而**有幾個窗只有 `ListAgents` 答得出來**。🔴 2026-09-11 實測:主視窗以為 4 個、實際 8 個,漏掉的三個空轉十小時 —— 而**抓到它的是 `ListAgents`,不是哨兵**。
- 每一則回報都要同步發主視窗(2026-09-09 拍板),含「問題與停下」。**停著等批**與**當掉了**在主視窗那一端長得一模一樣。
- **合別窗的 commit 前要過【兩道】,一道答不了兩個問題:**
  · ① `git cat-file -e '<hash>^{commit}'` 答「**這顆存在嗎**」。🔴 2026-09-14 收到一則冒充施工窗的回報,帶的 hash 在 repo 裡不存在。
  · ② `git merge-base --is-ancestor '<hash>' '<那個窗的分支>'` 答「**它還算不算數**」。🔴 2026-09-17 設計窗 rebase 換過號,而**舊 hash 照樣 `cat-file -e` 過**(rebase 不刪舊物件)⇒ ① 量不到「舊」,兩種都長成「合得下去」。
  ⇒ **所以窗回報 hash 一律要帶【分支名】** —— 沒有分支名,②那一行跑不了。沒帶或核不過 ⇒ 不合、回問那個窗。
  🔵 已經合了才發現拿到舊號 ⇒ 用 `git patch-id --stable` 逐顆比,**不要比樹**(比樹會把兩個基底之間別人的東西算進這顆的帳)。
- 臨時截圖寫到 `~/pcm-mailbox/`,不要落在 repo 裡(主樹多人共用)。

**🛑 哨兵的已知限制(不要讀寬了)**:2026-09-11 整夜實測,**每一則 idle 通知抵達時,那個窗自己的訊息都早就到了** ⇒ 通知**是過期的**。
📌 **⇒ 它守的是「那個窗結束了而它沒發訊息」那一種缺席,不是「我現在不知道它在做什麼」。** 一個會遲到的提醒不能當成「有人在盯著」——**那正是本檔一直在抓的形狀:一道看起來在守、而實際上守不到的閘。**

## 鐵則(編號固定不重排)
1. **design 直接搬**:寫前台元件前先 grep `design-reference/`,不憑記憶、不畫預覽 HTML。後台訂單 UI 真權威 = OD 專案 `pcm-524f` 的 `HANDOFF-orders-ui.md`。
2. 後台 schema 對應 design 的資料結構。
3. 前台與後台同一 slice 一起改、肉眼驗、再 commit。
4. 一個 slice 15-45 分鐘,超過就拆。
5. CSS + TSX 同元件同一 slice。
6. 元件 >400 行考慮拆;拆檔時註解跟著碼搬,不用刪註解降行。
7. 多代理**實作**先問 Sean;讀取 / 搜尋 / 審查委派不用問。
8. **動 schema / API / 共用元件 / next.config / vercel.json / Prisma / 部署 / 資料遷移 ⇒ 先寫 plan(改什麼、為什麼、影響、rollback)等 Sean 批。**
9. 週改多次的內容要後台 CRUD;發現就停,寫 PRD 再動。頻率拿不準當 L3 問 Sean。
10. 技術決策過三視角:擴充性 / 可維護性 / 出錯可追。
11. **三綠**:commit 前 `TURBO_FORCE=1 pnpm typecheck` 與 `TURBO_FORCE=1 pnpm lint`,動 .ts/.tsx/.css 加 `build`。紅了修紅,不 disable / skip / ignore。測試跑到你動的那個東西的檔。只動 .md 免跑。
    **主視窗合完別窗、推之前(本批不是純 .md),加跑一次 `pnpm test`** —— 三綠不含 vitest,各窗只跑異動檔會漏掉跨檔的清冊型測試(2026-09-14 各窗三綠都過,合起來 17 格紅)。用 `pnpm test` 不用裸 `npx vitest run`:前者有「0 檔 / 全 skipped 會叫」那道閘。
12. **高風險 commit 前 codex 唯讀審一輪**:錢(order / payment / refund / 價格 / 會員 tier / 儲值金)、權限(auth / RLS / GRANT / service_role)、schema / migration / 大量寫入、next.config / vercel.json / CI / env、寄信 / 對外發布、`packages/ui` 行為。
   ```bash
   codex exec -s read-only --disable apps -m gpt-6-astra "$(cat <prompt檔>)" < /dev/null > <out> 2>&1
   ```
   must-fix 修完才 commit;R1 有 must-fix 才 R2。**R2 還有 must-fix ⇒ 不跑 R3,停下端 Sean**。純文字 finding 一律 nit。**其他片不審**,靠測試 + Sean 走一遍。
   **每週一次總掃**(Sean 09-09 拍 Q5 甲):主視窗每週一把該週碰到 `apps/` 與 `packages/` 的 commit 打包給 codex 掃一輪,專抓「被當成 UI 其實碰到錢或權限」的分類錯。
13. **窗可以自己修的那一類(Sean 2026-09-19 拍甲)** —— 三個條件**缺一不可**,少一條就回到「先問」:
    ① **修法不是窗自己想的** —— 日報 / plan / 審查已經寫好的才算。窗自己推出來的修法不在此列。
    ② **不碰**共用件 / schema / 金流 / 權限 / 寄信 / 部署 —— 那幾類照舊鐵則 8 寫 plan。
    ③ **要留下一發「弄壞它會紅」的驗證**,而且**落筆前先餵一發該紅的**。
    🔴 **為什麼是③而不是「改完跑一次測試」**:2026-09-19 窗C 原本要照抄自己上一片的修法,
    查下去發現那樣改會**把前一片弄壞**(把「空的指標」換成「指到不相干內容的指標」)——
    而那個修法**看起來完全合理**。📌 **「修法寫好了」不等於「照著做就對」。**
    🛑 而同一天另外兩件證明②不能鬆:分類器那件(24 支 fetcher 只有 1 支有補救)與選測閘那件
    (候選改法會換出一個新洞、淨值可能是負的)——**兩件都是先寫 plan 才發現的。**

## Git
- SSH only。credential 命令只印名稱不印值。`cat .env*` 不在對話跑。
- **`dev` = 後台 admin 的 production,推 dev = 後台上線。`main` = 顧客站 production,Sean 手動 FF。** 開發都在 dev。
- 訊息 `type(scope): subject [M-4b]`,繁中祈使句。`git add <精確路徑>`,禁 `-A` / `.`。
- **不自動 push。** migration 貼正式庫的人是 Sean(或他明文授權的那一次)。
- 多窗同時在跑時,推之前發預告(origin/dev 從 X 到 Y 共 N 顆)。
- **貼板與推的順序**(誰貼照上一條):
  · 本次程式要用到還沒套用的 DB 變更 ⇒ **板先貼**,那支 migration 檔與 `APPLIED.tsv` 那一列都 commit 進要推的那顆,程式才合進 dev。部署時序閘只**擋**新函式 / 新 view(`.rpc(` / `.from(`),**新欄位只印警告不擋**,碼先上會靜靜壞(2026-09-15 sitemap 那片撈不到欄就變空、build 不紅)。
  · 跟本次程式無關的板 ⇒ **等推 main 那一發跑完再貼**:帳本閘只在推 main 時跑、讀的是被推的那顆 commit,途中貼上的版本會被判「平台孤兒」擋下(2026-09-15 撞過)。
  · 🔴 **改既有函式的簽章(加/減參數)⇒ 兩個方向都有空窗**:板先貼 ⇒ **舊碼叫不動**(必填參數沒送,PGRST202);碼先推 ⇒ **新碼叫不動**。⇒ 貼板與推碼要當成**同一次動作**,中間時間壓到最短,而且**事先知會正在用那條路的人**(2026-09-16 板 199 出貨五支 RPC 改簽章,後台建箱 / 標出貨 / 作廢在碼推上去前全部失敗)。

## Server 端鐵則
會員等級 server 端重驗、不信 client。client component 不 import `@/lib/prisma` 或任何經銷價模組,經銷價絕不到一般會員瀏覽器。金額整數或 `Decimal`,禁 `number`。secrets 只在 `.env.local`。

## zsh(Sean 的終端機)
命令內禁 `#` 註解、禁全形標點;雙引號內禁反引號;多步驟 `&&`;含反斜線的字用 `printf '%s\n'`;`git show "${ref}:path"` 要大括號;迴圈用 `while IFS= read -r`。細節 `docs/patterns/zsh-and-bash-traps.md`。

## 跟 Sean 講話
使用自然、清楚的台灣繁體中文。先直接回答，再補必要原因與下一步；不要為了短而省掉主詞，也不要用工程縮寫、比喻或大量警示符號代替說明。歷史交接與註解的文風不作為回覆範本。一般回覆一至三個短段落即可；決策提供 2–3 個清楚選項並標示推薦，不重問已批准的方向。

Sean 2026-09-21 要求改善日常回覆與後台介面文字。Claude Code 全域細則在 `~/.claude/rules/00-work-rules.md` 第 6–7 節；後台文案使用 `docs/patterns/admin-copy-style.md`。按鈕說動作，狀態說事實，提示說明問題與下一步。保留 Sean 自訂的狀態及功能名稱（例如「已收未定」「已收已定」）；改善的是難懂的說明與操作提示，不擅自重新命名。不能把「已登記」寫成「已退款」，也不能把「結果未確認」寫成「失敗」。已修改、本機驗證、推送及正式上線必須分清楚。

## 要查東西時(按需讀,不預讀)
- 改這支檔會影響什麼:`graphify query "<檔名>"`,查完開檔核。
- design 對稿:`bash scripts/design-ref-check.sh`;OD 稿 CSS 真值 `python3 scripts/tool-final-css.py`。
- 開本機後台看畫面:`bash scripts/admin-probe/up.sh`;顧客站 `bash scripts/storefront-probe/up.sh`;真資料走查 `docs/runbooks/local-admin-with-real-data-probe.md`。後台不能用 curl 驗(入口在 quote 站,一律 429)。
- migration 貼了沒:`bash scripts/is-migration-applied.sh <版本>`(`APPLIED.tsv` 的 0 不是答案)。查正式庫唯讀:`~/pcm-mailbox/0905查證/run.sh`(只讀不 apply,不印連線字串)。
- 新建 DB 物件 / GRANT / RLS / SECURITY DEFINER:`docs/patterns/revoking-function-execute-in-supabase.md`。抄既有函式先 `bash scripts/latest-definition-of.sh <名>`。
- 新竹物流開送前:`docs/runbooks/hct-first-shipment-activation.md`;卡在「送出結果未知」:`docs/runbooks/hct-unknown-stuck-manual-reset.md`;停寄信:`docs/runbooks/email-sweep-kill-switch.md`。
- Vercel 防火牆 / cron:`scripts/vercel-json-waf-cron-gate.py` 看 repo、`scripts/vercel-firewall-cron-order-check.py` 看 live,兩支都要。
- 其他:`docs/patterns/index.md`、`docs/runbooks/`、`docs/PHASE-1-NORTHSTAR.md`。

## 2026-09-09 起不再做
不每片更 STATUS 七欄、⛔ ~~不寫心跳~~(**2026-09-11 Sean 拍乙:主視窗每派一件工掛一個哨兵** —— 見上面〈多窗:哨兵〉。📌 那不是心跳復活:心跳是**窗主動定時報**,哨兵是**主視窗訂閱一次性的結束通知**,窗那一端零成本)、不跑 literal-sweep、不每片 code-reviewer、不寫 memory 事故紀錄(只記 Sean 拍板 `project_*`)、不改 `docs/launch-todo.md`(凍結,只讀)、不加 `.husky` 閘、不加 `scripts/` 量測腳本。busboy 照舊由 Sean 跑。

— END —
