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

從 backlog #12 / #15 / #76 integrate。本節為 trigger 補完入口、條目編號為將來教訓擴充預留(目前 integrate 第 8 / 第 10 / 第 11-13 條對應 #12 / #15 / #76,1-7 / 9 為未來累積空位)。

**第 8 條:跨 package import slice 必檢(對應 backlog #12)**

- .npmrc 是否 shamefully-hoist=false 嚴格隔離模式
- 嚴格模式下、跨 package 用 `@pcm/xxx` 引用必須在 importer 的 package.json 加 `workspace:*` deps
- 禁止清單寫「不可動 package.json」要留具體例外條款(例:「除本次任務必要的 workspace deps 加掛、不可動其他欄位」)
- **教訓來源:** M-0-04 主實作撞此衝突、Code 抓出抗住、補加 workspace dep 解決

**第 10 條:Skill audit 工作流(對應 backlog #15)**

- commit 涉實質 code 變更時、主動建議跑 skill audit、不預設「commit = final」
- 雙跑 engineering:code-review + simplify(security / correctness / 維護性 vs reuse / quality / efficiency)
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
- 在 Claude Design 改設計、push pcm-website-design repo
- 肉眼驗收 slice

### 8.4 Claude Code 做

- 跑命令、實作 code
- git commit / branch / merge(不 push)
- 跑測試、檢查 build
- 偵察 design-reference 字面
- 寫 inventory / report

### 8.5 Claude Design 做

- 視覺與前台設計
- 推 pcm-website-design GitHub repo

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
