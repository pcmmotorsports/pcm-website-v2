# 夜跑多窗指揮 Playbook(常設工法)

> 2026-08-06 Sean 拍板:「本次的方式變成以後常用的夜跑方式」。本檔=該夜實跑方法的固化,單一權威;
> 信箱協定細節以 `/Users/sean_1/pcm-mailbox/README.md`(含補訂)為準,本檔不重複。
> 啟動前提:夜跑=多代理實作,**每次由 Sean 說「今晚夜跑」才開跑**(鐵則 7 批准制;08-01 拍板夜跑常態化=模式常設、單次仍要點頭)。

## 1. 角色拓樸

- **主視窗**:指揮/收割/裁決,**不下場實作**(例外:收割時的 nit 折入、docs/STATUS 收帳、鐵則允許的機械修)。
- **施工窗 ×N**:各自獨立 worktree+分支(絕不共用工作樹);代號沿用 A-E,新線開新代號並在信箱 README 補訂登記。
- **溝通**:全走信箱檔案(審計軌跡),不經對話轉貼;主視窗 `<代號>-1xx-A`、施工窗 `<代號>-2xx-Q/STOP`。

## 2. 主視窗開工儀式

① `git branch/status/log` 檢查(dirty 有主才續)②掛**三合一哨兵**(session scratchpad 生成 `sentinel-v2.sh`,樣板見本檔尾註):信箱 mtime 基準比對(**絕不用號段最大號**,主視窗 1xx 恆小於施工窗 2xx)+各施工分支 HEAD 快照+**靜默偵測**(任一窗 45 分零 commit/零信/工作樹零檔案異動=喚醒主視窗主動查——防「窗死了沒人知道」,08-06 B 窗斷線是 Sean 先發現的教訓);任一事件即喚醒,處理後 `rearm` 一行重掛;**發完信必先 rearm 再掛 watch**(排除自己的信)③全量 `ls -t` 信箱補讀,自己認未讀 ④讀 CURRENT checkpoint+收割筆記(scratchpad)。

## 3. 派工單六要素(每封 1xx 派工信)

①環境自建(worktree/分支/基於哪個 dev)②任務與硬序(引母 plan `檔案:行號`)③工法(偵察 grep 全樹→施工→三綠 `--force`+全套→code-reviewer R1 折入→高風險片 codex 關卡2 不降級→commit→STOP)④紅線(不 push/不動 STATUS·CURRENT/不 checkout·stash·reset·clean/繁中/精準 add/金流頁與 migration 等禁區逐條點名)⑤收工總 STOP 格式(進度表+每片 commit+測試數對帳,基線寫死在單裡)⑥時程(08:30 收尾、09:00 前總 STOP)。

## 4. 夜間節奏(與白天不同,派工單必明文)

- 施工窗寫完 STOP **不掛等待、直接續下一片**;主視窗批次收割;審出 must-fix 主視窗寫 1xx 信插隊。
- 施工窗每 30 分 `ls -t` 全量掃信箱(主視窗指示可能在它開工後才發)。
- 拿不準的產品判斷=跳過記 STOP,不猜、不硬標。
- **佇列預派**:每窗「下一份工作」在其現任務跑著時就先寫好(scratchpad `dispatch-queue.md`),STOP 一到即發;佇列永不空;08:30 起不發新單。免批准型優先(plan 起草/唯讀偵察報告/截圖包/smoke test/清單彙總);需 Sean 拍的只列決策題不執行。
- **續工授權**:派工完成後的加班清單預先寫進主動通知信(等 Sean 授權「不需同意的盡量推進」後)。

## 5. 收割工法(主視窗,逐線)

押住等 STOP → **R1 FAIL 必有確認輪**(紀錄面=主視窗以 SHA 窄確認;行為面=fresh reviewer;第 3 輪起換模型換角度;codex FAIL 的裁決型 finding 可由既有拍板/裁定處置,寫進 commit body)→ `merge --no-ff` → `turbo typecheck lint build --force`(0 cached)+全套 `pnpm test` **精確調和**(「預期 Δ vs 實際 Δ」逐片對帳,完整輸出留檔 scratchpad)→ 錢面加拋棄庫重跑 → **nit 順手清**(reviewer gate 標記引審查紀錄)→ STATUS 七欄收帳+欠的落檔(母 plan 註記/立案)同批 docs commit → push(夜跑持續授權;`dev`=pcm-admin production,收割即上線要心裡有數)。

## 6. 裁決分層(主視窗)

- **可自裁**:施工序/流程/方法論題(判準=不改產品可見行為、不動資料、可逆),**裁定前必親驗施工窗引用的事實**(`檔案:行號` 逐條),裁定信寫依據、落檔責任歸自己。
- **轉 Sean**:產品可見變化/不可逆/與既有拍板衝突/品味題 —— prose code block `Q:…/A: A|B|C` 附推薦,不擋施工的標明「不擋」;拍板即落 memory+發信給窗折入。
- **codex 與 Sean 拍板衝突以拍板為準**(CLAUDE.md 明文),不採的 finding 在 commit body 具名記理由。

## 7. 韌性

- **context 壓縮**:各窗自動壓縮可續跑,防的是「狀態只在對話」——每片 commit+STOP=checkpoint;改到一半先寫 scratchpad checkpoint 檔;壓縮後第一動=重讀自己最新 STOP。主視窗同理(收割筆記+本檔+STATUS)。
- **斷線復原**:主視窗盤點該 worktree 現場(未 commit 檔/拋棄庫埠/磁碟產物完成度)→ 寫「接手現場、不重做」重啟提示詞給 Sean 貼;施工窗產出隨做隨落檔=斷線零損失的前提。
- **macOS 防火牆彈窗**(本機 postgres 拋棄庫觸發):按允許一次即可;重啟單明寫「接手既有拋棄庫、不重 provision」。

## 8. 收尾(09:00 前)

各窗總 STOP → 主視窗總收帳:每線收割狀態+全套測試數對帳+截圖包路徑清單+Sean 待決策彙總(含設計端題分開列)+誠實邊界(做到哪/剩什麼/哪些沒驗)。換窗則寫 CURRENT checkpoint(本檔為工法權威,checkpoint 只寫當夜特例)。

## 相關

memory `feedback_night-pipeline-preplan-next-dispatch`(佇列預派的由來)、`project_workmode-0801-nightrun-decisions`(夜跑常態化拍板)、`docs/handoff/CURRENT.md`(當夜 checkpoint)、信箱 README(協定權威)。

## 尾註:sentinel-v2 樣板(每 session 生成到 scratchpad,不進 repo)

介面:`zsh sentinel-v2.sh rearm`(建基準:touch 信箱基準+分支快照+各窗活動戳)/`zsh sentinel-v2.sh watch`(run_in_background 迴圈)。watch 每 60s 查:①信箱 `find -newer 基準` ②分支 `for-each-ref` 快照比對 ③每 5 輪對各窗 worktree 的 `apps/packages/docs/scripts/supabase` 跑 `find -newer 活動戳 -print -quit`(短路、避開 node_modules),活動戳超過 45 分未刷新即輸出 `SILENT:<窗>` 喚醒。任一事件 `exit 0` 喚醒主視窗,處理後重掛。
