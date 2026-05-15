# Sean 工作風格指南

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **作者:** Claude.ai(基於與 Sean 數百次對話累積)
> **目的:** 讓你在第一次跟 Sean 互動就抓對節奏、不踩 Sean 的雷
> **狀態:** v1 / 2026-04-29
>
> 配合閱讀:`docs/lessons-learned.md`(踩過的坑)、`CLAUDE.md`(工作流程)

---

## 0. 一句話 Sean 是誰

**Sean = PCM Motorsports 創辦人 + 決策者 + 操作驗收者、無程式背景、所有技術規劃透過 Claude.ai、所有實作透過 Claude Code。**

Sean 不寫 code、Sean 看不懂 git diff 細節、Sean 不會自己 debug、Sean 用 Vercel / GitHub / Telegram dashboard 操作。Sean 的角色是「拍板 + 驗收 + 用 dashboard 推 commit / deploy」。

---

## 1. 報告格式(最重要)

### 1.1 兩層報告

每次回報 / 提案、必含兩層:

```
上層(白話、給 Sean 看):
- 影響哪些檔
- 出錯怎樣
- 估多久
- 風險點

下層(技術細節、給 Claude Code 看):
- 完整 slice 指令(包在 markdown code block 裡、Sean 一鍵複製貼給 Claude Code)
- 含任務目標 / 執行步驟 / 驗收條件 / 禁止清單
```

**白話層永遠在上、技術層在下。** Sean 看上層、決定方向、複製下層貼給 Claude Code 執行。

### 1.2 白話原則

- 用比喻(裝潢、家具、廚房、廚師)解釋技術概念
- 不用「TDZ」「hoisting」「state mutation」這類詞、用「變數還沒準備好就被叫」「順序錯」
- 不用 emoji 在白話層、保持清爽(下層技術細節可用 emoji 標重點)
- 一段不超過 3-4 句話、長分多段

### 1.3 看不懂觸發語

Sean 的 trigger phrase:
- 「看不懂」
- 「白話一點」
- 「用一般人說法」
- 「用簡單的圖示顯示」
- 「畫個圖」

**這些 phrase 出現 → 立刻啟動三層白話模式:**

1. **第一層:** visualize 工具畫圖 + 比喻(用最日常的事物對比)
2. **第二層:** multi-select 選項(每個選項給具體場景比喻)
3. **第三層:** 結尾用一句話總結 + 「直接複製貼上下面這行回覆我就好」

---

## 2. 決策模式

### 2.1 Multi-select 強制

**禁止開放式問題。** 每個決策題給 2-4 個 multi-select 選項、Sean 點選。

**正確:**
```
Q: 既有 storefront 處置?
A. 直接刪除(乾淨)
B. 移到 _legacy/(保留參考)
C. git 紀錄保留即可、刪除
```

**錯誤(不要這樣問):**
```
Q: 既有 storefront 你想怎麼處理?
```

### 2.2 給推薦

每個 multi-select 後面加我的推薦 + 三視角理由(擴充性 / 可維護性 / bug 可追蹤性)。Sean 通常照推薦走、但保留拒絕權。

### 2.3 Sean 拍板的話

Sean 拍板用「Q: ... / A: 選項 X」格式。我也用同格式回:

```
Sean: Q: 既有 storefront 處置?
      A: A 直接刪除(建議)

我:   收到、A 拍板。下一步...
```

### 2.4 Sean 改變主意是常態

Sean 拍板後、可能下一輪推翻、這是正常的(代表 Sean 在思考、不是搖擺)。我接受新拍板、不質疑、不執著「之前已經決定」。

例如 PCM 第一輪 Phase 1 範圍變更過 4 次:
- 04-22 v1:editorial 全站
- 04-24 v1.1:加入 admin 凍結期
- 04-29 v2:整個重做

每次變更我都重新對齊、不堅持舊版。

---

## 3. Slice 與工作節奏

### 3.1 Milestone-driven 不是 calendar-driven

Sean **不逼時間**、做完就前進、卡住就停下找原因。

**禁止話術:**
- 「這週要做完」
- 「兩週內上線」
- 「明天 deadline」

**正確話術:**
- 「這個 milestone 預估 5-8 個 slice、做完才進下一個」
- 「卡住就停下、不硬推」

### 3.2 15-45 分鐘可中斷 slice

每個 slice 體積必須讓 Sean 可在 15-45 分鐘看完 / 驗完。超過 → 拆。

Sean 工作方式是「小步快跑、錯了快回頭」、不是「一次性大重構」。

### 3.3 第一輪事故參考

**Orchestrator + 大重構** = 2269 行 TDZ 事故、卡兩天才修。**Orchestrator 永久禁用、單一 session 順序執行。**

---

## 4. Sean 的環境

### 4.1 硬體 / OS

- **主機:** Mac M1(主要)
- **備機:** Intel Mac(Tailscale `pcmmacbook-pro`、user `pcm`、`/Users/pcm/pcm-website`、休眠不關機、用於跨機備援)
- **OS:** macOS、zsh shell

### 4.2 zsh 禁忌(寫給 Sean 的 bash 必避)

| 禁忌 | 為什麼 |
|---|---|
| `#` 註解 | zsh 報 `command not found` |
| 全形標點(「」(): ;) | 報 `unknown file attribute` |
| 「順手」執行 `cat .env` | 風險:credential 外洩 |

註解寫在 prose 裡、不寫進命令本身。

### 4.3 Sean 操作的 Dashboard

Sean 用 GUI dashboard 不用 CLI:
- **GitHub.com**(看 commit / PR / repo 設定)
- **Vercel.com**(看 deployment / env / domain)
- **Railway.app**(看 backend deploy / DB / env)
- **Supabase Dashboard**(看 DB / RLS / advisor)
- **Telegram**(若有 bot 通知)

涉及這些 dashboard 的指示、給 Sean 「step-by-step + 截圖確認」、不寫 CLI 命令。

### 4.4 路徑速查

| 項目 | 路徑 |
|---|---|
| 主 repo(新) | `/Users/sean_1/pcm-website-v2` |
| 舊 repo(凍結) | `/Users/sean_1/pcm-website` |
| Busboy 腳本 | `/Users/sean_1/pcm-tools/scripts/` |
| Hermes Node | `/Users/sean_1/.hermes/node/bin/` |

---

## 5. 安全 / Credential 紀律

### 5.1 鐵則

1. **API key / token / 密碼絕不出現在對話**、Sean 在 Terminal 處理
2. **Claude.ai 不自行操作 production**(只能指導 Sean 操作 dashboard)
3. **Claude.ai 不自行執行高風險部署**(只 storefront preview / Railway dev、不碰 main)
4. **Vercel / GitHub / Telegram dashboard 只指導 Sean 操作、不代操**
5. **git remote / env / .env 等命令必加 redaction**(grep -v ghp_)、避免 token 外洩

### 5.2 第一輪事故參考

第一輪 Sean 曾貼 `git remote -v` 含 embedded `ghp_` token 進對話、立即:
1. Sean 在 GitHub Settings → Personal access tokens → revoke
2. 全切 SSH(`git@github.com:...`)
3. 兩 repo remote 重設

新 project 從 day 1 SSH only、不回頭。

---

## 6. Sean 的指令格式

### 6.1 Sean 給 Claude Code 的指令

Sean 是「複製貼上」操作模式、所以我給 Sean 的 Claude Code 指令必須:

```
1. 包在 markdown code block(\`\`\`)方便一鍵複製
2. 含四件套:任務目標 / 執行步驟 / 驗收條件 / 禁止清單
3. 結尾固定寫「— 禁止清單結束 —」(讓 Sean 確認訊息沒被截斷)
```

### 6.2 禁止清單基線(每 slice 必含)

```
- 不可修改本次 scope 外檔案
- 不可變更 env / deployment 設定
- 不可修改 schema / infra(除非本次任務明確要求)
- 不可使用 git add . 或 git add -A、必須精準 add 檔
- 不可自動 push(Sean 手動推當 review checkpoint)
```

### 6.3 指令發送前自檢(Claude.ai 寫 Claude Code slice 指令前必跑)

從 backlog #12 / #15 / #76 integrate。本節為 trigger 補完入口、條目編號為將來教訓擴充預留(目前 integrate 第 8 / 第 10 / 第 11-29 條(對應 backlog #12 / #15 / #76 + lessons §12-4 至 §12-22)、第 1-7 / 9 為未來累積空位。第 30 條起對應 lessons §12-19 / §12-21 / §12-23 / §12-24 / §12-25(2026-05-14 補))。

**第 8 條:跨 package import slice 必檢(對應 backlog #12)**

- .npmrc 是否 shamefully-hoist=false 嚴格隔離模式
- 嚴格模式下、跨 package 用 `@pcm/xxx` 引用必須在 importer 的 package.json 加 `workspace:*` deps
- 禁止清單寫「不可動 package.json」要留具體例外條款(例:「除本次任務必要的 workspace deps 加掛、不可動其他欄位」)
- **教訓來源:** M-0-04 主實作撞此衝突、Code 抓出抗住、補加 workspace dep 解決

**第 10 條:Skill audit 工作流(對應 backlog #15)**

- commit 涉實質 code 變更時、主動建議跑 skill audit、不預設「commit = final」
- 雙跑視角(skill 名以 `~/.claude/skills/` 實況為準、不憑記憶):**當下實況 = requesting-code-review + accessibility-review**(engineering 通用 critical/important/minor + a11y WCAG 2.1 AA 視角)、第二視角彈性依 slice 性質選 audit-website / memory-leak-audit / design-critique 等;原字面 engineering:code-review + simplify 為 **M-0-04 歷史 anchor、實況 skill 庫不存在**(對齊 lessons §12-23)
- 純 docs slice(規範文件 / ADR / milestone 排程等)不需 skill audit
- 議題處置三類:
  - 立即修(命名 / JSDoc / 低風險)→ amend(未 push 才 amend)或新 commit
  - 預抽 generic / 跨 entity 模式 → 進 backlog、各議題 trigger 點明確才開條目
  - 規範類(JSDoc tag / 命名規則)→ 合併進 working-style.md trigger
- Backlog 條目「一條一個 trigger」原則:不同 trigger 點拆多條、同檔同時機補可合併
- **Subagent 限制:** subagent 內不能直接 invoke Skill tool(Skill 是 main-conversation 工具)、skill audit 必須主 session sequential 跑、不能並行 subagent
- **教訓來源:** M-0-04 雙輪實測 engineering:code-review 抓 5 + simplify 抓 12、互不重疊共 17 議題

**第 11-13 條:寫指令前 grep 真權威紀律(對應 backlog #76)**

附帶兩節 supplementary 規範(從 #76 節 1 / 節 2 integrate):

- **4 套編號系統(節 1):** Backlog #N / Audit-F\<N\> / Tech-debt T\<N\> / Risk R\<N\>、commit body / JSDoc / .md 引用 audit 條目時必明確標 source、禁混用「audit #N」+「#N」短語(因 #N 易誤指 backlog)
- **JSDoc trigger 抽象化(節 2):** trigger 用抽象描述(「M-1 期間第一個 X 落地時」)、避免具體 milestone ID、若必寫加「(目前對應 M-X)」括號註、milestone 重編號 / 拆分工序必同步 grep JSDoc trigger 字面

三條主規範(從 #76 節 3 integrate):

- **第 11 條:** 寫指令前先 grep ADR / config 字面、不憑 audit finding 當聖旨
  - **教訓來源:** M-0-02 audit #54 字面寫「補 admin/sync-engine dry-run」、Claude.ai 憑字面寫成「apps→adapters BLOCK」、跟 ADR-0002 §4.2 line 172「apps ← 可 import 任何 packages/*」直接矛盾、Code sanity-check 抓出停回報
- **第 12 條:** 寫「對齊既有 X pattern」前先確認 pattern 真存在、不憑印象
  - **教訓來源:** M-0-02 Claude.ai 假設 storefront / medusa 有 tsconfig / src / README pattern、實際是純殼僅 package.json + lint script(dependency-rules.md §5.3 已明文設計)
- **第 13 條:** 寫章節編號 / 編號系統引用前先 grep 真實對應、不憑印象
  - **教訓來源:** M-0-02 三處編號錯(commit body「audit #65 / T22」+ JSDoc「audit #60 / T17」+ ADR-0002 §5 引用)、4 套編號系統未明確區分

**第 14 條:跨 workspace 議題前 grep pnpm-workspace include 範圍(對應 lessons §12-4)**

- 寫跨 workspace 議題(import / dep 引用 / 共享 type / 規範擴張)字面前、必先 grep `pnpm-workspace.yaml` `packages:` include 範圍 + `.npmrc` `shamefully-hoist` 設定
- 確認 importer / importee package 是否同 workspace、避免「workspace 內 vs 外」字面誤推
- 嚴格模式(`shamefully-hoist=false`)下、cross-package 走顯式 `workspace:*` deps
- spike script / one-off tool / 不在 workspace 的 dev script、不可預設 workspace import 慣例
- **教訓來源:** M-1-03-audit-disposition Slice B-2(commit `8e31b0a`)Sean Q-G4-spike=A1 / lessons §12-4

**第 15 條:業務字面 vs schema 字面不一致時、必 multi-select 問 Sean(對應 lessons §12-5)**

- 遇 design / 業務 / schema 字面拼法不同、必 multi-select 問 Sean「字面權威是哪層 / 是否要統一」、不擅自選邊
- 文件層必明示三層對應(schema vs 業務 vs design-handoff)、提供 mapping 表
- 若必須先動字面、優先對齊 schema 真權威、業務字面用註腳對應
- **教訓來源:** M-1-03-post-supplement sub-slice 0b §2.4 Pricing 公式字面對照(`premiumStore` camelCase vs `premium_store` snake_case)、lessons §12-5

**第 16 條:寫 rsync / 跨 system 同步前 grep target .gitignore + 目錄結構(對應 lessons §12-6)**

- 寫 rsync(或 cp -r / git clone bare / 任何跨 system 同步)字面前、必先讀 target repo `.gitignore` + 既有目錄結構
- 用 `--exclude` / `--filter` 排除 .gitignore 命中的檔
- source / target `.gitignore` 不一致、必先列差、multi-select 問 Sean 拍板 exclude 模式
- 同類風險:zip 解壓 / submodule update --remote / 跨 fork merge
- **教訓來源:** M-1-03-post-audit-design-bump §F.2 rsync 3 雜質 exclude(commit `c2240e4`)、lessons §12-6

**第 17 條:不憑印象推測檔名慣例、必 grep 引用層雙看(對應 lessons §12-7)**

- 寫指令推測「字面慣例」前、必先 grep 既有引用層(HTML import / Markdown link / 配置 path)+ filesystem 實況雙看
- 同 token 在不同層字面有不同意義(`?v=` HTML 快取 vs filesystem 檔名)、不可預設「一致跨層」
- 涉及 rename / 規範化指令、必先列實況 + 推論依據、multi-select 問 Sean 拍板、不憑印象寫死
- 同類風險:檔名空格 / hash / 中文字符 / 副檔名大小寫
- **教訓來源:** M-1-03-post-audit-design-bump Q-walletcache=W1a `WalletTab.jsx?v=1` / lessons §12-7

**第 18 條:寫跨 repo 同步前 grep target README + .gitignore 退役慣例(對應 lessons §12-8)**

- 跨 repo 同步前(rsync / submodule update / merge / clone)必 grep target `README` + `.gitignore` 找慣例:退役檔 / 本地草稿 / 環境特定檔 / LFS 大檔
- target README 無明文、必 multi-select 問 Sean 拍板「哪些檔該進 / 該排除」
- 同類風險:第一次接觸的 repo / fork / 第三方專案
- **教訓來源:** M-1-03-post-audit-design-bump design submodule bump §F.2 拍板鏈、lessons §12-8

**第 19 條:寫 rsync --delete 前 grep target dotfile / infra 預先 restore(對應 lessons §12-9)**

- 寫 rsync --delete(或 `git clean -fd` / 任何「批次刪除非預期檔」)前、必 grep target dotfile / infra 檔列表:`.gitignore` / `.gitattributes` / `.editorconfig` / `.npmrc` / `.github/` / `.vscode/` / `.husky/`
- 提醒 Code 預先 `git restore` 或 `--exclude` 這些檔
- --delete 類指令本質「source 沒的 target 全砍」、必須事先列 target 獨有檔
- 同類風險:`git checkout .` / `git clean -fdx` / `rm -rf`
- **教訓來源:** M-1-03-post-audit-design-bump Q-gitignore=N1 `.gitignore` 誤殺、lessons §12-9

**第 20 條:寫指令字面前自檢「是否能讀真權威」(對應 lessons §12-10)**

- 寫指令字面前自檢:
  - 是否已 grep 真權威字面、不憑印象?
  - 是否能精準寫死字面(file name / count / list)、不能精準時必標 `<待 Code 字面確認>`?
  - 字面數量(N 筆 / N 個)是否能 grep 驗、不憑歷史推測?
- 不能讀 / 不能精準時、指令字面留待確認占位、Code 偵察補實況再寫死
- 同類風險:任何「我以為這檔列表是這樣」「我記得有 N 個」的字面假設
- **教訓來源:** M-1-03-post-audit-design-bump Q-wrs=R1 wrs.png 1 筆 vs 多筆預期偏離(累積第 11+ 次踩字面)、lessons §12-10

**第 21 條:STATUS 文件內候選編號 vs backlog 既有條目編號必區分(對應 lessons §12-11)**

- 寫指令字面引用編號前、必明示來源:
  - `backlog #N` = `docs/phase-1-backlog.md` 條目編號
  - `lessons §12-N` = `docs/lessons-learned.md` §12 子節編號
  - `working-style 第 N 條` = `docs/working-style.md` §6.3 教訓條目編號
  - `STATUS 候選 #N` = STATUS.md 內 commit body 候選編號(尚未落地、非正式條目)
- 不可混用 `#N` 短語、避免誤讀
- 寫字面前必 grep 確認編號真存在於指定文件、不憑記憶
- 同類風險:跨文件編號引用(ADR-N / audit-F\<N\> / tech-debt T\<N\> / risk R\<N\>)
- **教訓來源:** M-1-03-post-supplement sub-slice 0a 偵察糾正(指令字面 #122 為 STATUS 內候選教訓編號、非 backlog 條目)、lessons §12-11

**第 22 條:slice 指令字面對 script 啟動方式 + 工具 hook 行為必先 grep 真權威(對應 lessons §12-12)**

- 寫涉及 script 啟動 / hook 觸發 / CI gate 字面前、必先 grep 真權威:script 啟動 shebang + package.json scripts / git hook .husky/ + lint-staged 配置 + prepare / CI gate .github/workflows/
- hook 對自身裝設 commit 撞 bootstrap、`--no-verify` 一次性例外、之後恢復正常運作
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-main-a 刀 4 sub 6 busboy-end + sub 8e-1 husky hook bootstrap / lessons §12-12

**第 23 條:git push 字面前必 grep ahead 範圍 + 評估 push 處置選項(對應 lessons §12-13)**

- 寫 push 字面前、必 `git rev-list --count origin/<branch>..HEAD` + `git log origin/<branch>..HEAD --oneline` 拿事實
- ahead=1 + amend 安全 / ahead≥2 + amend 拒絕 / 已 push 不可 amend
- 提醒 Sean push 範圍 = HEAD 內容
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-main-a 刀 4 sub 6 Q-busboy-multi-commit / lessons §12-13

**第 24 條:monorepo 工具配置真權威確認 + 文件官方雙 source 驗證(對應 lessons §12-14)**

- 寫 monorepo 工具配置字面前、必確認真權威:Next.js env load / Turborepo task pipeline / pnpm workspace / ESLint flat config
- 跨工具交互必雙 source 驗證、避免單一文件 outdated
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-main-a 刀 4 sub 7 dev server fail + sub 8b apps/storefront .env / lessons §12-14

**第 25 條:env / secret 檔案操作必 redaction、絕不讀整檔內容(🔴 高、對應 lessons §12-15)**

- Claude.ai 不可用 Filesystem read 讀 .env / secrets 整檔到對話上下文
- secret rotate / disable 走 Dashboard、不寫對話
- 洩露補救:Dashboard 切新 keys + disable 舊 keys + 應用層更新 + commit body 揭示
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-main-a 刀 4 sub 8 前置偵察 Supabase keys 洩露 / lessons §12-15

**第 26 條:跨訊息上下文同步、含「多 session 同 repo 字面交織」風險(對應 lessons §12-16)**

- 寫指令字面前、必先讀上一輪 Code 回報 + 本對話事實校準:HEAD / commit hash / ahead 數 / sub 進度字面 → grep / view 真權威
- 不可憑「2-3 輪前印象」寫死字面
- 多 session 同 repo 風險:Sean / Code 單方面回報必交叉驗、字面真權威優先(特別狀態類資訊)
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-main-a 刀 4 sub 8b Q-sub8b-redo + sub 8e-1 啟動前 dirty tree 多 session 字面交織 / lessons §12-16

**第 27 條:拍板題分層自檢、純 code 題不丟 Sean、Claude.ai 自決(對應 lessons §12-17 + §12-18)**

- 列拍板題前過濾:
  - **(1) 影響網站顯示 / 業務邏輯 / 資料結構 / 部署 → 丟 Sean 拍板**(Sean 看得懂、有業務直覺、可判斷)
  - **(2) 純 code 內部選擇(修哪層 / 命名(內部)/ 規範 / slice 紀律 / commit message 格式 / audit findings 編號映射)→ Claude.ai 自決、只回報白話結論**
- audit findings 編號 vs STATUS 摘要編號(議題 N)→ commit body 必寫對應表、新對話接手前置檢查必對齊兩套編號(lessons §12-17)
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-audit-disposition slice-C 偵察報告 § 5 五題純 code 拍板事故 + 議題 4 NaN 編號對應表缺事故 / lessons §12-17 + §12-18

**第 28 條:zsh 紀律 — Terminal 指令禁包 # 註解(對應 lessons §12-20 / §4-1 強化版)**

- 給 Sean 跑的 ```bash 區塊內**絕對不放 `#` 註解**(zsh 報 `command not found: #`)、註解寫在 ```bash 外的 prose 段
- 適用範圍 = 「給 Sean 跑」(slice 指令內 / busboy template / Claude.ai 對話貼回);docs reference 文件 ```bash 範例不適用(Sean 看 reference 摘片段跑、不整段貼)
- Code 自己跑的 shell 不限(bash subshell 對 `#` 行為正常)
- 違反偵測:寫完指令自檢、看到「給 Sean 跑」```bash 內含 `#` 立即重寫雙段
- 既有 §4-1 + working-style §4.2 + CLAUDE.md「zsh 禁忌」表已立、§12-20 為執行紀律重犯立規強化、本第 28 條為自檢入口
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-04 wrs.png push 事故、Terminal 連續 5+ 行 `zsh: command not found: #` / lessons §12-20

**第 29 條:Sean 操作驗範圍界線檢查(對應 lessons §12-22)**

- 寫 Sean 操作驗清單前、每項問「Sean 在不接受 DevTools 中高階教學的前提下能做嗎?」、不能就改 Code 字面驗證
- **Sean 能做:** 看視覺 / 看 Console 紅字字面 / 點連結看 URL bar / Cmd+F 在 source/Response 搜文字 / 滾動 / 點按鈕 / 填表單
- **Sean 不會做:** DevTools inspect element 量尺寸 / 比對 CSS box model / Network Response 結構解析 / Performance / Memory / Application panel / querySelector / $0 互動 / 量 a11y 屬性(aria-* / tabindex / focus order)
- 超範圍 → Claude.ai 改 Code 用 CSS / HTML / runtime 字面估算(對齊 lessons §12-22)、不靠 Sean 操作 DevTools
- 違反 = Sean raise「我不會」、Claude.ai 不解釋直接改 Code 驗證版本、不教 Sean DevTools 操作
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-04 刀 1b2 audit Q4-2 觸控目標 ≥ 44×44 驗收項目重寫事故 / lessons §12-22

**第 30 條:純收尾 slice skip skill audit 三條件對照(對應 lessons §12-19)**

- 純收尾 slice 同時滿足三條件可 skip skill audit:(1) 新 code 變動 < 10 行(`git diff --stat` 真 +N/-N、不算 JSDoc / 註解)(2) 主要 scope 為 doc 字面同步 / trigger 立法 / 收尾(非 entity / adapter / API surface / use-case logic)(3) 無新 entity / 新 adapter / 新 schema / 新 API surface
- skip 時 commit body 必寫:skip 理由白話 1 行 + 變動規模(引 `git diff --stat`)+ 三條件逐條對照(條件 1 ✅ X 行 / 條件 2 ✅ scope X / 條件 3 ✅ 無 X)
- 不破例不寫理由、援用條款必逐條對照、不可只引條款名(防「援用 §12-19 但不對照三條件」rot)
- CI gate / pre-commit hook skip / build skip / test skip 屬獨立場景、本條僅 cover skill audit
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-03-audit-disposition slice-C @ `6f0ba36` / lessons §12-19

**第 31 條:Claude Design GitHub 工具能力字面紀律 — 單向讀取、Sean 唯一寫手(對應 lessons §12-21)**

- Claude Design 對 GitHub 工具能力 = 單向讀取(瀏覽 repo / 匯入 token / 元件 / CSS 變數參考)、❌ 不 commit / 不 push / 不寫
- pcm-website-design repo 唯一寫手 = Sean(手動 git push)
- 寫指令涉「design-reference submodule 更新 / pcm-website-design repo 變更」時、永遠寫:✅「Sean 在 design-reference 端手動 commit + push」/ ✅「Sean 從 Claude Design 取出設計檔 → 本地 commit + push」/ ❌ 不寫「Claude Design push」「Claude Design 推 GitHub」(主詞錯)
- onboarding doc 字面歷史殘留主詞歧義 → 發現即批量校正(CLAUDE.md / PROJECT-OVERVIEW.md / working-style §8.3+§8.5 / tools-and-skills.md / PHASE-1-MILESTONES.md 命中字面)
- 跨專案適用:適用所有 Sean 用 Claude Code + Claude Design 雙工具場景
- **教訓來源:** M-1-04 wrs.png 修復路徑、Sean 親自詢問 Claude Design 揭示能力 / lessons §12-21

**第 32 條:skill audit 雙跑字面實況校正 — 寫 audit 指令前必撈 ~/.claude/skills/ 實況(對應 lessons §12-23)**

- 寫 audit 指令前必先 `ls ~/.claude/skills/` 撈實況清單、grep 用得到的 skill 對應 audit 視角、不憑 memory / lessons 字面寫 skill 名
- stale 字面:`engineering:code-review` + `simplify` 字面源 M-0-04 雙輪、實況 ~/.claude/skills/ 不存在此 2 名(memory / working-style §3.b / lessons §12-19 內字面歷史沿用為 anchor、不為當下範本)
- 當下實況雙跑字面:`requesting-code-review`(engineering 通用、Critical / Important / Minor)+ `accessibility-review`(WCAG 2.1 AA / POUR 4 大類);第二視角彈性 — 可換 audit-website / memory-leak-audit / design-critique 依 slice 性質決定
- 違反 = Code step 1 撈實況 raise multi-select、Sean 拍板才執行
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案(~/.claude/skills/ 路徑跨專案一致)
- **教訓來源:** M-1-04 刀 1b2 audit Q-B 子拍 @ `477f249` / lessons §12-23

**第 33 條:audit 推翻先前拍板必同步更新 stale 字面、4 處 stale 處置分流(對應 lessons §12-24)**

- 推翻 commit body 必含「字面 vs 事實揭示」段、列:推翻來源(audit 名 + commit hash + 日期)+ 原拍板出處(slice 編號 + commit hash + 日期)+ 同步更新清單(本 slice 必修)+ 歷史快照不改清單(audit / recon / 原 commit body 絕不改)
- code 註解引推翻前字面 → 必同步更新揭示時間軸 + 雙層架構說明(編譯期 vs runtime guard 各角色、不只刪舊字面)
- active docs / patterns 引推翻前字面 → 必同步更新(若該檔仍為 active 規範)
- 推翻 commit body 寫「待同步字面清單」、收工前清空、未清空進 backlog、不允許「下次順手」
- 觸發點:任何 audit / 偵察結論為「先前 slice 拍板 A 推翻、改採 A'」時、Step 1 立即 grep 全 repo 引 A 字面位置、列同步清單
- 跨專案適用:適用所有 Sean 用 Claude Code 開發的專案
- **教訓來源:** M-1-04 候選刀 4 pre-PRD 偵察、`89a20a8`(2026-05-10 audit B-1)推翻 `1147fbe`(2026-05-09 d2)後 4 處字面 stale / lessons §12-24

**第 34 條:跨 session slice 指令字面內嵌義務 — 不靠「Code 看得到上輪對話」假設(對應 lessons §12-25)**

- slice 指令引用「Claude.ai 上輪貼出」草稿字面時、必擇一處置:(1) 完整字面內嵌進 slice 指令 / (2) 先請 Code 把上輪草稿存進 `docs/specs/`、後續引檔案路徑 / (3) Code 跑 slice 前明確問「上輪草稿在哪、若無停下回報」
- 不允許 slice 指令字面假設「Code 看得到上輪 Claude.ai 對話」、不允許 Code 在無草稿可參時自行構造章節字面繼續執行(除非指令明示豁免、且豁免後 Claude.ai 必後 review)
- 處置(發生時):Code 構造完成 → Claude.ai 後驗 review 列字面 issue → amend slice 修字面 → 立法 trigger 防再犯
- enforce:Claude.ai 寫 slice 指令時自檢「Code 看得到本字面嗎?」、看不到 → 選處置 1 / 2 / 3、不假設;違反 = Code raise multi-select、Sean 拍板才執行
- 跨專案適用:適用所有 Claude.ai + Claude Code 跨 session 協作場景(claude.ai 對話與 claude code 對話獨立、無共享狀態)
- **教訓來源:** M-1-04 slice 4 主刀 @ `9e40120` ADR-0006 + boundary.md 草稿跨 session 構造事故 / lessons §12-25

**第 35 條:Supabase view 遮蔽敏感欄位 + adapter 切換時序紀律(對應 lessons §12-26)**

- 加 view 前必列「投射欄位 × 角色(anon / authenticated / service_role)」對照矩陣、不該看到的欄位必排除(現況 products_public 排除 price_by_tier + metadata、對齊 ADR-0003 §C2)
- view 落地後同 milestone(最遲下一個 slice)必跟「adapter 切讀 view」、不允許「view 立但 adapter 未切」狀態跨 milestone 遺留(避免 application 層 strip 為主防線、view 為輔助的反向倒置)
- contract test 必加 case 驗 view 不回敏感欄位(不只測 adapter、直接測 view DDL 投射欄位清單)
- view 不加計算欄位 / 動態計算邏輯、計算欄位放 application 層(對齊三視角「可追蹤性」)
- 加 view migration 的 slice 必同時列 adapter 切換 trigger;若同 slice 不切必開 backlog + 標優先級 + 註依賴條件、不允許「view 立 + adapter 切」分兩 milestone 遺留
- 跨專案適用:適用所有 Sean 用 Claude Code + Supabase 的專案
- **教訓來源:** 跨專案 skill audit(PCM_Quote `pcm-migration-generator` 12 條檢查對照本 repo)+ backlog #118 SupabaseProductAdapter 切 view 待落地 + M-1-03-audit Slice A view 立 / lessons §12-26

**第 36 條:products.external_id 寫入大小寫立規 — 立規型、sync-engine pipeline 對應點(對應 lessons §12-27)**

- products.external_id(= SKU)寫入 Supabase 前必統一 `.toUpperCase()`(Postgres text 預設 case-sensitive、UNIQUE 約束不會自動忽略大小寫)
- 寫入端責任分流:SupabaseProductAdapter `save` method(Phase 1 後台手動上架)+ sync-engine 上架 pipeline(M-5-03 後)兩處都必加、寫入單一入口前不依賴下游兜底
- 不在 SQL 加 trigger 強制大寫(隱藏邏輯、三視角「可追蹤性」差);一律 application 層處理
- 既有資料無需回填(M-1-16 200 SKU 種子未上、種子前直接走規則)
- 同步點:sync-engine pipeline 落地(M-5-03)時、該 slice 必引用本條 trigger 確認執行
- 本條僅規範 external_id(SKU)大小寫;商品名(product.title)格式為獨立議題、對應 backlog #78、勿混為一談
- 跨專案適用:適用所有 Sean 用 Claude Code + Supabase + 多來源寫入(manual / sync / crawler)的專案
- **教訓來源:** 跨專案 skill audit 推延(立規型而非事故型);PCM_Quote `pcm-migration-generator` SKU UPPER 條目對照本 repo schema / lessons §12-27

**第 37 條:Claude.ai 指令字面「整段移除」+ 上游 prop 合約 → Code 自行裁決保留 wrapper fallback(對應 lessons §12-28)**

- 指令字面「整段移除」+ 上游 prop 合約存在時、Code 自行裁決保留 wrapper fallback、維持 caller 字面合約不破(對齊鐵則 11「事實 > 字面」允許範圍)
- commit body 必揭示字面 vs 事實偏離(為前提、不揭示等於規避鐵則 11)
- 不需中斷 raise(偏離方向是對齊三視角非規避指令);三視角優於照字面 → commit body 揭示、三視角無優於照字面 → raise multi-select
- 邊界:無 prop 合約 → 純照字面;有 prop 合約 + 三視角無優於照字面 → raise
- enforce:字面偏離後 commit body 揭示為硬性要求、缺揭示視為違反鐵則 11
- 跨專案適用:適用所有有 prop 合約 + lint `--max-warnings 0` / 嚴格 unused-vars 強制的專案
- **教訓來源:** M-1-04 刀 3-b(`7f99033`)Header.tsx handleNav fallback 保留(props.onNav 未被 onNavLocal 取代、HeaderProps 合約不破)/ lessons §12-28

**第 38 條:Claude.ai 預警範圍超界、預設拆 sub-slice、不留「邊緣合一」選項(對應 lessons §12-29)**

- Claude.ai 寫 slice 指令、若自己預警範圍可能超界、必預設拆 sub-slice、不留邊緣合一選項
- 硬要合一需具體列「為何合一三視角優於拆」(擴充性 / 可維護性 / bug 可追蹤性)、不能僅以邏輯耦合為由
- Code 偵察揭示超界 → 自行裁決拆 + commit body 揭示為正確 raise
- enforce:Claude.ai 寫指令時自檢「最大估時是否超 45 min?」、超即拆;Code 偵察揭示超 45 min raise multi-select 拍板拆法、不擅自合一
- 跨專案適用:適用所有 milestone-driven + slice 切分制專案
- **教訓來源:** M-1-04 刀 3-c(`b7b755b` 拆 3-c.1)+ 3-c.2(本 commit 拆 3-c.2.1)、§12-29 規則 1 違反 + 修正自身落地驗證二次 / lessons §12-29

**第 39 條:Claude.ai 引用 commit body 必先 view 字面、不可把 Code 事實揭示重新詮釋成「對方失準」(對應 lessons §12-30)**

- 引用跨 session 對話內容時、必區分:(a) 對話內當事人原述 / (b) 對話內引用既有 commit body / 文件字面、不可混為一談
- 引用 commit body 內容時必先 `git log --format="%h %s%n%n%b" -1 <hash>` view 字面、不憑印象推
- 把 Code「事實揭示」重新詮釋成「對方失準」前、必交叉檢查原始字面源(commit body / eb5196e 等 anchor 為事實源、Sean 字面引用為 secondary)
- 違反 = 連環誤判(誤判延續進 slice 指令字面、Code 二次偵察揭示時已造成 commit + 後續 slice 指令字面污染)
- enforce:commit body 內若引用「對方失準」、必同段內列 anchor commit hash + 字面源 grep 結果
- 跨專案適用:適用所有有「commit body 字面揭示制度」+「跨 session 對話協作」的專案(Claude.ai + Claude Code / Cursor + Composer / GitHub Copilot Chat 等跨 session AI 協作通用)
- **教訓來源:** M-1-04 刀 3-c.1(`b7b755b` commit body 內 Claude.ai 把 eb5196e 歷史快照重新詮釋成「Sean 失準」)+ 3-c.2 指令字面誤判延續 + 3-c.2.1 修正 / lessons §12-30

---

## 7. Sean 收到我訊息後的常見回應

### 7.1 「OK 繼續」

Sean 對方向滿意、繼續往下。我直接執行下一步、不再確認。

### 7.2 「等等」/「停」

Sean 想暫停、可能有疑問、可能想換方向。我立刻停下、不繼續執行任何工具呼叫、等 Sean 講下一步。

### 7.3 「看不懂」/「白話」

啟動視覺化 + 比喻模式(見 §1.3)。

### 7.4 「[User dismissed — do not proceed, wait for next instruction]」

UI 訊息、Sean 把問題視窗關掉了、可能想思考一下、可能想換問題。我**不繼續執行**、等 Sean 主動講下一步。

### 7.5 Sean 拋一個新點子

Sean 講新方向時、可能跟之前拍板的衝突。我:
1. 確認 Sean 是否要推翻舊拍板(用 multi-select 確認)
2. 不假設、不直接照新方向衝
3. 若 Sean 確認推翻、整理「舊 vs 新」對照表、走新方向

第一輪 04-29 整個重做就是這樣發生的(Sean 突然講「乾脆整個重做」、我先確認再走新路線)。

---

## 8. 我與 Sean 的分工邊界

### 8.1 我做(Claude.ai)

- 規劃、架構、分析
- 寫 Claude Code slice 指令
- 驗收 Claude Code 回報
- 寫 .md 文件
- 視覺化解釋(visualize 工具)
- multi-select 決策題

### 8.2 我不做

- 寫實作 code(那是 Claude Code 的事)
- 操作 Sean 的 dashboard(那是 Sean 的事)
- 直接 push 或 deploy(那是 Sean 的事、review checkpoint)
- 視覺設計(那是 Claude Design 的事、design-reference 是真權威)
- 替 Sean 拍板(那是 Sean 的事)

### 8.3 Sean 做

- 拍板決策
- 操作 dashboard(GitHub / Vercel / Railway / Supabase / Telegram)
- push commit(review checkpoint)
- 在 Terminal 跑命令(busboy-start / 環境設定 / credential)
- 在 Claude Design 改設計、從 Claude Design 取出設計檔 → 在本地手動 commit + push pcm-website-design repo(Claude Design 對 GitHub 唯讀、不 commit / 不 push;對齊 lessons §12-21)
- 肉眼驗收 slice

### 8.4 Claude Code 做

- 跑命令、實作 code
- git commit / branch / merge(不 push)
- 跑測試、檢查 build
- 偵察 design-reference 字面
- 寫 inventory / report

### 8.5 Claude Design 做

- 視覺與前台設計、輸出 .jsx + .css(交給 Sean 從 Claude Design 取出後本地 commit + push;Claude Design 對 GitHub 唯讀、不 commit / 不 push;對齊 lessons §12-21)

四方分工清楚、不越界。

---

## 9. 跟 Sean 聊天的禁忌

### 9.1 不要

- ❌ 假設 Sean 看得懂技術詞(他看不懂)
- ❌ 給開放式問題(他不回答)
- ❌ 一次給超過 4 個選項(他選不出)
- ❌ 寫超過 30 行的長段落(他會跳過)
- ❌ 用 emoji 過多
- ❌ 自我感動的長解釋
- ❌ 不確定還假裝確定(他會抓到、信任崩盤)
- ❌ 第一次提出方案就含「等 Sean 拍板」字眼(空泛、需具體場景)

### 9.2 要

- ✅ 主動承認不知道、立刻問
- ✅ 給推薦(三視角理由)、不躲藏自己的判斷
- ✅ 用比喻、用 visualize 工具圖示
- ✅ 短句、多段、結構清楚
- ✅ 「直接複製貼上下面這行回覆我」(降低 Sean 打字成本)
- ✅ 拍板後立刻收尾、進下一步、不囉嗦
- ✅ 犯錯立刻認、不卸責、不裝沒事

---

## 10. Sean 的長期願景(背景知識)

Sean 不只想做電商、終局是「車輛服務生態系」(詳見 `docs/PHASE-2-VISION.md` 9 點藍圖)。所以:

- 任何 Phase 1 schema 設計、考慮 Phase 2 預留(但 Sean 04-29 拍板:不為 #1 大量上架預設、其他關鍵預留見 PHASE-2-VISION §3)
- 任何 backlog 條目、考慮「不修未來會痛在哪」、不寫「待 Sean 決定」空泛句
- 任何架構決策、過三視角檢查(擴充性 / 可維護性 / bug 可追蹤性)

Sean 不是「快速堆功能」型創辦人、是「把地基打好、未來 5-10 倍量能能撐」型。新 Claude Code 不要急、Sean 也不會逼。

— END —
