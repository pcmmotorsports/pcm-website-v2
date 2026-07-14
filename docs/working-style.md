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

- 跨 workspace 議題(import / dep / 共享 type / 規範擴張)字面前必先 grep `pnpm-workspace.yaml` include 範圍 + `.npmrc` shamefully-hoist 設定;嚴格模式下 cross-package 走顯式 `workspace:*` deps。

→ 詳見 lessons-learned.md §12-4

**第 15 條:業務字面 vs schema 字面不一致時、必 multi-select 問 Sean(對應 lessons §12-5)**

- 遇 design / 業務 / schema 字面拼法不一致,必 multi-select 問 Sean「字面權威是哪層」、不擅自選邊,文件層需明示三層對應表。

→ 詳見 lessons-learned.md §12-5

**第 16 條:寫 rsync / 跨 system 同步前 grep target .gitignore + 目錄結構(對應 lessons §12-6)**

- 寫 rsync(或 cp -r / clone bare / 任何跨 system 同步)前必先讀 target `.gitignore` + 既有目錄結構,用 `--exclude`/`--filter` 排除;兩邊不一致必 multi-select 問 Sean。

→ 詳見 lessons-learned.md §12-6

**第 17 條:不憑印象推測檔名慣例、必 grep 引用層雙看(對應 lessons §12-7)**

- 推測「字面慣例」(rename / 去除 query string 等)前必先 grep 既有引用層(HTML / Markdown / config path)+ filesystem 實況雙看,不可預設一致跨層。

→ 詳見 lessons-learned.md §12-7

**第 18 條:寫跨 repo 同步前 grep target README + .gitignore 退役慣例(對應 lessons §12-8)**

- 跨 repo 同步前(rsync / submodule update / merge / clone)必 grep target `README` + `.gitignore` 找退役檔 / 草稿 / 環境特定檔慣例,無明文必 multi-select 問 Sean。

→ 詳見 lessons-learned.md §12-8

**第 19 條:寫 rsync --delete 前 grep target dotfile / infra 預先 restore(對應 lessons §12-9)**

- 寫 rsync --delete(或 git clean -fd / 任何批次刪除)前必 grep target dotfile / infra 檔列表(.gitignore / .npmrc / .github/ / .husky/ 等)、預先 restore 或 exclude。

→ 詳見 lessons-learned.md §12-9

**第 20 條:寫指令字面前自檢「是否能讀真權威」(對應 lessons §12-10)**

- 字面數量 / 檔名 / 清單不能精準 grep 驗證時必標 `<待 Code 字面確認>`,不憑印象 / 歷史記憶寫死。

→ 詳見 lessons-learned.md §12-10

**第 21 條:STATUS 文件內候選編號 vs backlog 既有條目編號必區分(對應 lessons §12-11)**

- 引用編號前必明示來源(backlog #N / lessons §12-N / working-style 第 N 條 / STATUS 候選 #N),不可混用 `#N` 短語,必 grep 確認真實存在。

→ 詳見 lessons-learned.md §12-11

**第 22 條:slice 指令字面對 script 啟動方式 + 工具 hook 行為必先 grep 真權威(對應 lessons §12-12)**

- 涉 script 啟動 / hook 觸發 / CI gate 字面前必先 grep 真權威(shebang / package.json scripts / .husky + lint-staged / .github/workflows)。

→ 詳見 lessons-learned.md §12-12

**第 23 條:git push 字面前必 grep ahead 範圍 + 評估 push 處置選項(對應 lessons §12-13)**

- 寫 push 字面前必 `git rev-list --count origin/<branch>..HEAD` + `git log` 拿事實;ahead=1+amend 安全 / ahead≥2 拒絕 amend / 已 push 不可 amend。

→ 詳見 lessons-learned.md §12-13

**第 24 條:monorepo 工具配置真權威確認 + 文件官方雙 source 驗證(對應 lessons §12-14)**

- 寫 monorepo 工具配置字面前必確認真權威(Next.js env load / Turborepo pipeline / pnpm workspace / ESLint flat config),跨工具交互必雙 source 驗證。

→ 詳見 lessons-learned.md §12-14

**第 25 條:env / secret 檔案操作必 redaction、絕不讀整檔內容(🔴 高、對應 lessons §12-15)**

- 🔴 不可用 Filesystem read 讀 .env / secrets 整檔進對話;secret rotate / disable 走 Dashboard;洩露補救 = 切新 keys + disable 舊 + 應用層更新 + commit body 揭示。

→ 詳見 lessons-learned.md §12-15

**第 26 條:跨訊息上下文同步、含「多 session 同 repo 字面交織」風險(對應 lessons §12-16)**

- 寫指令字面前必先讀上一輪 Code 回報 + 本對話事實校準(HEAD / hash / ahead / sub 進度)grep 真權威驗證,不憑「2-3 輪前印象」寫死。

→ 詳見 lessons-learned.md §12-16

**第 27 條:拍板題分層自檢、純 code 題不丟 Sean、Claude.ai 自決(對應 lessons §12-17 + §12-18)**

- 列拍板題前過濾:(1) 影響顯示 / 業務邏輯 / 資料結構 / 部署 → 丟 Sean;(2) 純 code 內部選擇(命名 / 規範 / slice 紀律 / 編號映射)→ Claude.ai 自決只回白話結論;audit findings 編號 vs STATUS 摘要編號 commit body 必寫對應表。

→ 詳見 lessons-learned.md §12-17、§12-18

**第 28 條:zsh 紀律 — Terminal 指令禁包 # 註解(對應 lessons §12-20 / §4-1 強化版)**

- 給 Sean 跑的 ```bash 區塊內絕對不放 `#` 註解(zsh 報 command not found);適用範圍 = 「給 Sean 跑」(slice 指令 / busboy template / 對話貼回),註解寫 prose 外。

→ 詳見 lessons-learned.md §12-20

**第 29 條:Sean 操作驗範圍界線檢查(對應 lessons §12-22)**

- 寫 Sean 操作驗清單前每項自問「Sean 不接受 DevTools 教學能做嗎」,不能就改 Code 字面驗證版本,不教 Sean DevTools 操作。

→ 詳見 lessons-learned.md §12-22

**第 30 條:純收尾 slice skip skill audit 三條件對照(對應 lessons §12-19)**

- 純收尾 slice 同時滿足三條件(code 變動 <10 行 / scope 為 doc 字面同步收尾 / 無新 entity·adapter·schema·API)可 skip skill audit;skip 時 commit body 必逐條對照三條件、不可只引條款名。

→ 詳見 lessons-learned.md §12-19

**第 31 條:Claude Design GitHub 工具能力字面紀律 — 單向讀取、Sean 唯一寫手(對應 lessons §12-21)**

- Claude Design 對 GitHub 唯讀(瀏覽 / 匯入 token / 元件參考),不 commit / 不 push;design-reference repo 唯一寫手 = Sean 手動 push,寫指令主詞不可寫「Claude Design push」。

→ 詳見 lessons-learned.md §12-21

**第 32 條:skill audit 雙跑字面實況校正 — 寫 audit 指令前必撈 ~/.claude/skills/ 實況(對應 lessons §12-23)**

- 寫 audit 指令前必先 `ls ~/.claude/skills/` 撈實況清單,不憑 memory / lessons 字面寫 skill 名(當下實況 = requesting-code-review + accessibility-review、舊 engineering:code-review + simplify 已不存在)。

→ 詳見 lessons-learned.md §12-23

**第 33 條:audit 推翻先前拍板必同步更新 stale 字面、4 處 stale 處置分流(對應 lessons §12-24)**

- 推翻 commit body 必含「字面 vs 事實揭示」段(推翻來源 / 原拍板出處 / 同步更新清單 / 歷史快照不改清單);觸發即 grep 全 repo 引用位置列同步清單,收工前清空不可拖延。

→ 詳見 lessons-learned.md §12-24

**第 34 條:跨 session slice 指令字面內嵌義務 — 不靠「Code 看得到上輪對話」假設(對應 lessons §12-25)**

- 引用「Claude.ai 上輪貼出」草稿字面時必擇一處置(完整內嵌 / 存進 docs/specs 引路徑 / Code 跑前明確問),不可假設 Code 看得到上輪對話、不可自行構造章節字面續行。

→ 詳見 lessons-learned.md §12-25

**第 35 條:Supabase view 遮蔽敏感欄位 + adapter 切換時序紀律(對應 lessons §12-26)**

- 加 view 前必列投射欄位 × 角色對照矩陣排除敏感欄;view 落地後同 milestone 內必跟 adapter 切讀 view,不允許「view 立但 adapter 未切」跨 milestone 遺留。

→ 詳見 lessons-learned.md §12-26

**第 36 條:products.external_id 寫入大小寫立規 — 立規型、sync-engine pipeline 對應點(對應 lessons §12-27)**

- products.external_id(SKU)寫入 Supabase 前必統一 `.toUpperCase()`;寫入端責任分流(手動上架 adapter + sync-engine pipeline 兩處都必加),不靠 SQL trigger、一律 application 層處理。

→ 詳見 lessons-learned.md §12-27

**第 37 條:Claude.ai 指令字面「整段移除」+ 上游 prop 合約 → Code 自行裁決保留 wrapper fallback(對應 lessons §12-28)**

- 指令字面「整段移除」但上游 prop 合約存在時,Code 可自行裁決保留 wrapper fallback(對齊鐵則 11 事實 > 字面),但 commit body 必揭示字面 vs 事實偏離。

→ 詳見 lessons-learned.md §12-28

**第 38 條:Claude.ai 預警範圍超界、預設拆 sub-slice、不留「邊緣合一」選項(對應 lessons §12-29)**

- 自己預警範圍可能超界時必預設拆 sub-slice、不留邊緣合一選項;硬要合一需具體列三視角理由,Code 偵察揭示超界時自行裁決拆 + commit body 揭示。

→ 詳見 lessons-learned.md §12-29

**第 39 條:Claude.ai 引用 commit body 必先 view 字面、不可把 Code 事實揭示重新詮釋成「對方失準」(對應 lessons §12-30)**

- 引用跨 session commit body 字面前必先 `git log --format="%h %s%n%n%b" -1 <hash>` view 字面,不可憑印象把 Code 事實揭示重新詮釋成「對方失準」;commit body 內若引用「對方失準」必同段列 anchor hash + grep 結果。

→ 詳見 lessons-learned.md §12-30

**第 40 條:commit 落地 ≠ apply 落地(對應 lessons §12-31)**

- Supabase migration 兩階段,commit 進 git ≠ DB 已套用;寫指令引「落地」字面時必明確區分,需 apply 落地必含「Sean 手動跑 supabase db push」步驟。

→ 詳見 lessons-learned.md §12-31

**第 41 條:Claude.ai 不憑印象推 MCP / CLI 工具行為(對應 lessons §12-32)**

- 寫指令引 MCP / CLI 工具行為前必驗 schema + flag(特別 timestamp / version 處理);真權威 = 當下實測 schema + dry-run,不憑訓練資料推。

→ 詳見 lessons-learned.md §12-32

**第 42 條:Claude.ai 寫指令字面前必先 grep callsite 真權威(對應 lessons §12-33)**

- 涉 mapper 拆分 / 投射欄位列舉 / type 簽名 / 既有 method 字面前必 grep callsite 三層真權威(domain / port type、DB 投射、adapter mapper 簽名),不憑「概念上應該夠用」推。

→ 詳見 lessons-learned.md §12-33

**第 43 條:Claude.ai 寫立法字面前必 view 末條編號(對應 lessons §12-34)**

- 寫「立法新條」前必 view 末條編號(grep tail -3 對應各檔),不憑「上次落地到 N、下次 N+1」印象推,未 view 必標占位待確認。

→ 詳見 lessons-learned.md §12-34

**第 44 條:Claude.ai 列 multi-select 跨選項字面格式 / 詳簡度 / 三視角描述必統一(對應 lessons §12-35)**

- 列 multi-select 跨選項字面必統一格式 / 詳簡度 / 三視角(擴充性 + 可維護性 + bug 可追蹤性各一句),不缺、不混用其他維度替代。

→ 詳見 lessons-learned.md §12-35

**第 45 條:Claude.ai 寫立法字面前必 view 既有條目格式真權威(對應 lessons §12-36)**

- 寫「立法新條」前必 view 既有條目格式真權威(模板段數 / bullet 結構 / marker),verbatim 比對後任一不對齊即重寫,不憑印象推格式。

→ 詳見 lessons-learned.md §12-36

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

> **2026-07-14 更新:** Codex 與 Claude 都可擔任完整執行者或明確唯讀審查者；角色由任務模式決定，權威來源為 `docs/ops/AI_CONTRACT.md`、`AGENTS.md` 與 `CLAUDE.md`。

現行模式分工：

| 角色 | 做 | 不做 |
|---|---|---|
| Sean | 拍板決策 / push commit / 操作 dashboard / 肉眼驗收 | 寫 code / debug / 看 git diff 細節 |
| Codex 或 Claude 執行 session | 自規劃 / 實作 / 測試 / 精準 commit / 更新 STATUS 與 CURRENT | 未授權 push / deploy / 替 Sean 拍板 / 視覺設計 |
| Codex 或 Claude 審查 session | 任務明確寫審查時唯讀回 findings / 風險 / 是否可繼續 | 改 code / commit / 寫入外部系統 |
| Design session | 視覺與前台設計、輸出設計稿 | 把設計稿當成已實作 / 未驗證即 deploy |

Review Packet 是審查模式的一種，完整鏈見 `docs/patterns/cowork-review-chain.md`。

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
