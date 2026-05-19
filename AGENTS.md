# AGENTS.md

> **這份是 Codex 工作規則檔。** 進入此 repo 的每個 Codex session 自動載入此檔。
>
> 詳細「為什麼」見其他 .md;本檔只寫「怎麼做」。
>
> 衝突仲裁:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > 本檔 > 其他 md > 對話歷史。

@import docs/lessons-learned.md
@import docs/working-style.md
@import docs/PHASE-1-NORTHSTAR.md

---

## 第一天起手檢查清單

新 Codex session 第一件事:

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current      # 預期: dev
git status                      # 預期: clean + up to date
git log --oneline -5            # 確認 HEAD 與 STATUS.md 一致
```

任一不綠 → 停下回報 Sean、不自行修復狀態。

接著按順序讀:
1. `STATUS.md`
2. `docs/PHASE-1-NORTHSTAR.md`
3. `docs/lessons-learned.md`
4. `docs/working-style.md`
5. **本檔**
6. `docs/PROJECT-OVERVIEW.md`
7. `docs/PHASE-2-VISION.md`
8. `docs/features/vehicle-service-ecosystem.md`
9. `docs/tools-and-skills.md`

讀完跟 Sean 報「我已讀完套件、可以開工」。

---

## 鐵則(每個 slice 必遵守)

### 鐵則 1:design 是成品、直接搬、不翻譯

- design-reference 是真權威、storefront 對齊 design、不反向遷就
- 寫前台元件前必先 grep design-reference 字面、不憑記憶
- slice 指令禁用「翻譯 / 對齊 / 重寫」字眼、預設「直接搬」
- 不畫預覽 HTML / 不憑想像描述視覺

### 鐵則 2:後台對應 design、不是 design 配合後台

- Medusa schema 對應 design 已定義的資料結構
- design `data/products.js` mock 是合約、Medusa 實作合約

### 鐵則 3:前後台同步、不分階段

每個 slice 順序:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**。

不允許「前台先全做、後台之後補」。

### 鐵則 4:Slice 15-45 分鐘可中斷

每個 slice 體積必須在 15-45 分鐘內可完成 + Sean 可肉眼驗。超過 → 拆。

### 鐵則 5:CSS + TSX 雙檔聯動單一 slice

CSS 與 TSX 屬於同元件、預設單一 slice 完成、不拆。

### 鐵則 6:檔案大小硬上限

- 元件檔 >400 行 必須拆
- 元件檔 >300 行 硬警戒
- Hook 檔 >200 行 注意

### 鐵則 7:Orchestrator 永久禁用

複雜工作禁用 Orchestrator、改用單一 session 順序執行。

### 鐵則 8:重大改動前先提 plan 等批准

「重大」定義(任一條符合):
- 跨 3 個以上檔案
- 動 schema / API / 共用元件
- 動 next.config / vercel.json / Medusa config / Prisma schema
- 影響部署或資料遷移

Plan 內容:**要改什麼、為什麼、預期影響面、rollback 方式**。

Sean 批准後才執行。

### 鐵則 9:內容分級 L1 / L2 / L3 強制前置

任何 slice 前先標記內容分級:

| 級別 | 變更頻率 | 處置 |
|---|---|---|
| L1 | 每年 0-1 次 | hardcode 可接受 |
| L2 | 每季 1-3 次 | hardcode + TODO + backlog |
| L3 | 每週多次 | **必須**後台 CRUD、強制停 slice 寫 PRD |

發現 L3 → 立即停、不繼續、寫 PRD 後再動。

### 鐵則 10:三視角檢查

每個技術決策必過三視角:
1. **擴充性** — 未來功能怎麼接
2. **可維護性** — 後續改動好不好懂
3. **bug 可追蹤性** — 出錯好不好定位

backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。

### 鐵則 11:Slice 收工三綠 Checkpoint

每個 slice 結束 commit 前、強制跑 typecheck + lint(動 .ts/.tsx 加 build)、任一紅停下修紅再 commit、不繞道、不 disable / skip / ignore。詳見 `docs/patterns/slice-checkpoint.md`。

字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明。背景:M-0-01a 事件(commit `dd7b606` 聲稱「建 root TS 環境」、實際 typescript 套件未裝)。

### 鐵則 12:收到 Codex Review Packet 做唯讀審查

收到 Sean 轉貼的「Codex Review Packet」時:**唯讀審查、不改任何檔、不跑寫入工具、不 commit、不 push**。只回 findings / 風險點 / 是否可繼續(可 commit / 需修正 / 需 Sean 拍板)。

審查重點(任一漏掉就點出):
- 安全 / 權限有無漏(RLS / GRANT / 經銷價洩漏)
- schema / migration 會否破壞現有行為
- 是否符合 STATUS.md / NORTHSTAR / 本檔鐵則
- 是否有該補的 backlog 或文件

Codex Review 與鐵則 8 plan 互補不重複:plan 在「動手前」、Codex Review 在「commit 前」。Packet 由 Claude Code 整理、Sean 轉貼;格式與完整人機協作流程見 `docs/patterns/codex-review-packet.md`。

---

## Slice 指令格式(你寫給 Sean / 自己執行的)

每份 slice 指令必含四件套、外層包 markdown code block:

```
[Slice ID] 任務名稱

═══════════════════════════════════════════
任務目標
═══════════════════════════════════════════
（1-2 句話講清楚要做什麼）

═══════════════════════════════════════════
前置檢查(全綠才繼續)
═══════════════════════════════════════════
cd /Users/sean_1/pcm-website-v2
git branch --show-current
git status
git log --oneline -5

═══════════════════════════════════════════
執行步驟
═══════════════════════════════════════════
（步驟 1 / 2 / 3 ...、可執行命令）

═══════════════════════════════════════════
驗收條件
═══════════════════════════════════════════
（明確 yes/no 條件、不模糊）

═══════════════════════════════════════════
禁止清單
═══════════════════════════════════════════
- 不可修改本次 scope 外檔案
- 不可變更 env / deployment 設定
- 不可修改 schema / infra(除非本次任務明確要求)
- 不可使用 git add . 或 git add -A、必須精準 add 檔
- 不可自動 push(Sean 手動推當 review checkpoint)
（依 slice 加額外禁止項)

— 禁止清單結束 —
```

結尾固定「— 禁止清單結束 —」、Sean 確認訊息沒被截斷。

---

## Git 紀律

### Remote 與認證

- **SSH only**:`git@github.com:pcmmotorsports/pcm-website-v2.git`
- 絕不在對話貼 ghp_ token
- 涉及 credential 命令必加 redaction(`grep -v ghp_`)
- `cat .env` 不在對話跑、Sean 在 Terminal 自驗

### Branch 模型

```
main    ← production(Sean 手動 merge)
  ↑
dev     ← 主開發分支(slice 都在 dev 上)
```

新 project 暫不開 feature branch、所有 slice 在 dev 上線性開發。

### Commit 訊息格式

```
type(scope): subject [optional milestone-id]
```

- `type`: feat / fix / refactor / docs / chore / test / perf
- `scope`: storefront / medusa / ui / schemas / docs / config
- `subject`: 繁體中文、祈使句、≤72 字元
- `[optional]`: milestone-id(若有、例 `[M-1-3]`)

範例:
```
feat(storefront): 新增 ProductsPage 對齊 design 真權威 [M-1-3]
fix(medusa): 修正 cart line item 計算邏輯
refactor(ui): 拆 ProductCard 為 3 個子元件
docs(decisions): 補 0002-medusa-schema-design.md
chore: 同步 design-reference 至 a1b2c3d
```

### Add 必精準

```bash
# 正確
git add apps/storefront/src/components/ProductsPage.tsx
git add apps/storefront/src/styles/products-page.css

# 禁止
git add .                    ❌
git add -A                   ❌
```

### 不自動 push

- 你做完 commit、跑 busboy-end、**不 push**
- Sean 手動推 = review checkpoint

### Submodule 操作

```bash
# 初始化 submodule(第一次 clone 後)
git submodule update --init --recursive

# 同步最新 design
git submodule update --remote design-reference/

# 提交 submodule 改動
git add design-reference
git commit -m "chore: 同步 design-reference 至 {hash}"
```

---

## Busboy 流程

### Session 開始

Sean 在 Terminal 跑:
```bash
node /Users/sean_1/pcm-tools/scripts/busboy-start.js pcm
```

輸出 template、Sean 貼進新 Codex session 第一則訊息。

### Session 結束

你在 Codex 跑:
```bash
node /Users/sean_1/pcm-tools/scripts/busboy-end.js pcm
```

自動更新 STATUS.md 4 欄位、commit、**不 push**。

busboy 失敗 → 停下回報、不自行 retry。

---

## STATUS.md 維護

每個 slice 結束、**同一個 commit**(slice commit 本身、不另開)更新 STATUS.md 7 欄位:

1. 📍 當前狀態(milestone / slice / branch)
2. 🕐 最後更新(時間 / 更新者)
3. 📝 最近 3 commit(挑有意義的、不機械對齊 git log -3)
4. ➡️ 下一步(第 1 條優先)
5. ❓ Sean 待決策
6. 🚧 Blocker(若有)
7. 🔥 緊急 backlog 編號

STATUS.md 結構:
- 主表(7 欄、`---` 分隔線上方)≤30 行嚴守、超過 → 精簡 content、不准砍欄位
- 附屬區(`---` 分隔線下方):Busboy 機制 / 文件交叉引用 / 外移指標、不限長度自然增長(WO-6 後:變更紀錄已移 `PROGRESS.md`「STATUS.md 變更紀錄歸檔」段、速查已移 `docs/quick-reference.md`、STATUS 不再收這兩類)

7 欄(順序):當前狀態 / 最後更新 / 最近 3 commit / 下一步 / Sean 待決策 / Blocker / 緊急 backlog

附屬區內容不寫進主表;歷史 blockquote 一律去 PROGRESS.md。

STATUS.md **不寫歷史**(去 PROGRESS.md)、**不複製 backlog 細節**(只列編號)。

---

## 終端機 / Bash 紀律(Sean 環境)

### zsh 禁忌(給 Sean 的 bash 貼片必避)

| 禁忌 | 為什麼 |
|---|---|
| `#` 註解 | zsh 報 `command not found` |
| 全形標點(「」(): ;) | 報 `unknown file attribute` |

註解寫在 prose、不寫進命令本身。

### Pipeline 多步驟用 `&&` 串接

任一步失敗自動停。**禁裸換行 batch 多命令。**

```bash
# 正確
cd /tmp && test -s newfile && cp newfile target.txt

# 錯誤
cd /tmp
test -s newfile
cp newfile target.txt
```

### 「產生新檔 → 驗證 → 覆蓋」模式

```bash
# 產生新檔到 /tmp
cat > /tmp/newfile <<'EOF'
...
EOF

# 驗證
test -s /tmp/newfile || exit 1

# 才覆蓋
mv /tmp/newfile target.txt
```

### 不假設非 macOS 預設 CLI 已裝

`jq` / `yq` 等用前先 `command -v jq` 確認、或改 Python 內建。

### zsh nomatch 處理

zsh 在 glob 無匹配時 exit 1、含 glob 加 `|| true` 或用 `find`。

---

## CJK 處理

### str_replace 對大塊中文易失敗

全形「」(): ; 常被無意打成半形、byte 不 match。

連敗 2 次切換策略:
1. `bash sed` + anchor pattern(起迄特徵文字、非行號)
2. read → rewrite 整段 → write
3. 拆短 anchor

`str_replace` 適用範圍:程式碼、英文、短中文 anchor。

---

## React / Next.js 規則

### React 19 hooks 嚴格

- `react-hooks/purity` 拒絕 render body 內 `Date.now()`
- `react-hooks/set-state-in-effect` 對 `try/finally` vs `.catch()` AST 敏感
- `try/finally` 必須完整包 `await + setState`

規則修法超出 slice 範圍時、用 `eslint-disable-line` + 註解 + backlog 追蹤、不擴張 slice。

### build pass ≠ runtime pass

`ignoreBuildErrors` 只影響 TypeScript、不影響 ESLint。Vercel build 不跑 ESLint、ESLint 守門靠 CI gate(GitHub Actions)。

---

## Server 端鐵則(會員與價格)

### 三級會員價格驗證

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組
- 經銷價**絕不傳到一般會員瀏覽器**
- 金額用整數(分 / 角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)

### 敏感資訊

- DB 連線字串、API token、第三方金流金鑰 → `.env.local` only
- 絕不提交 git
- 絕不貼對話

---

## Sean 風格速查(完整版見 working-style.md)

### 兩層報告

- 上層:白話(影響哪些檔 / 出錯怎樣 / 估多久 / 風險)
- 下層:技術細節 + slice 指令(markdown code block、Sean 一鍵複製)

### Multi-select 強制

每個決策題給 2-4 選項、Sean 點選。**禁止開放式問題**。

### 看不懂觸發語

「看不懂」「白話一點」「畫個圖」「用一般人說法」 → 啟動視覺化 + 比喻 + multi-select 三層白話模式。

### Sean 拍板格式

```
Q: 問題?
A: 選項 X
```

我也用同格式回覆。

### Sean 改變主意是常態

不質疑、重新對齊、不堅持舊版。

---

## 四方分工

| 角色 | 做什麼 | 不做什麼 |
|---|---|---|
| Codex.ai | 規劃 / 架構 / 寫 slice 指令 / 驗收 / 寫 .md / multi-select 決策題 | 寫實作 code / 操作 dashboard / 拍板 / 視覺設計 |
| Sean | 拍板 / 操作 dashboard / push commit / 在 Terminal 跑命令 / 在 Codex Design 改設計 / 肉眼驗收 | 寫 code / debug / git diff 細節 |
| Codex(你) | 跑命令 / 實作 code / git commit / 跑測試 / 偵察 design / 寫 inventory | push / deploy production / 替 Sean 拍板 / 視覺設計 |
| Codex Design | 視覺與前台設計、輸出 .jsx/.css(交給 Sean 取出後本地 push;Codex Design 對 GitHub 唯讀、不 commit / 不 push;對齊 lessons §12-21) | 寫 storefront 程式 / 後台設計 / push GitHub |

四方分工清楚、不越界。

---

## 快速自檢清單(slice 開工)

每個 slice 動手前跑(M-1-09 驗證過的開工順序、固化):

- [ ] 起手檢查綠?(branch = dev / 工作樹乾淨 / HEAD 對齊 STATUS,或 1 步 amend drift 屬慣例)
- [ ] 已讀 STATUS.md「下一步」、確認本 slice 範圍?
- [ ] 動 design 元件 → 已 grep design-reference 真權威字面、不憑記憶?
- [ ] 內容分級 L1 / L2 / L3 已標?(發現 L3 立即停、寫 PRD)
- [ ] 判定是否「重大改動」(鐵則 8:跨 3+ 檔 / 動 schema / 共用元件 / config)→ 是則先提 plan 等 Sean 批?
- [ ] 估時 15-45 分鐘?(超出先拆 slice)

---

## 快速自檢清單(寫 slice 指令前)

- [ ] 是「直接搬 design」還是「翻譯 / 重寫」?(後者錯)
- [ ] 已 grep design-reference 字面、不憑記憶?
- [ ] CSS + TSX 在同一個 slice?(雙檔聯動不拆)
- [ ] 前台 + 後台同步?(不允許前台先做後台之後補)
- [ ] 內容分級 L1 / L2 / L3 標記?
- [ ] 預估時間 15-45 分鐘?(超出拆 slice)
- [ ] 數字內部一致(預估 vs 門檻 vs 實測空間)?
- [ ] 用詞精準(preview vs production / stash vs working tree / commit vs push)?
- [ ] 禁止清單可執行、不自相矛盾?
- [ ] 結尾「— 禁止清單結束 —」未截斷?
- [ ] 重大改動已先提 plan 等 Sean 批准?

---

## 快速自檢清單(slice 結束前)

- [ ] 肉眼驗(前台啟動、操作流程跑一遍)?
- [ ] **三綠 checkpoint:** typecheck + lint(動 .ts/.tsx 加 build)全綠才允許 commit、不可 disable / skip / ignore(詳見 `docs/patterns/slice-checkpoint.md`)?
- [ ] 動到前台元件 → 已順手補 / 更新該元件 smoke test(`*.test.tsx`、見 `docs/architecture/testing-strategy.md`)?
- [ ] commit 訊息字面 vs 事實一致?字面與事實偏離必在 commit body 註明?
- [ ] 精準 git add(不用 git add . / -A)?
- [ ] commit 訊息符合 `type(scope): subject [milestone]` 格式?
- [ ] STATUS.md 7 欄位更新(同 slice commit、不另開)?
- [ ] 跑 busboy-end?
- [ ] 跑 `/pcm-roadmap` 更新進度地圖(docs/progress-roadmap.html)?
- [ ] 不 push(等 Sean 手動推)?

---

## 突發狀況處理

### 你發現自己在做以下事情、立刻停下

- 把 design 元件「翻譯成 Tailwind 風格」
- 為了「保留既有 storefront 結構」修改 design 內容
- 憑記憶或印象描述 design、畫預覽 HTML
- 把 9 大藍圖 schema 加進 Phase 1
- 一個 slice 跨 5+ 檔
- 想用 Orchestrator
- 即將自動 push

### Sean 訊息常見回應

| Sean 訊息 | 你怎麼做 |
|---|---|
| 「OK 繼續」 | 直接執行下一步、不再確認 |
| 「等等」「停」 | 立刻停下、不執行任何工具呼叫、等 Sean 講下一步 |
| 「看不懂」「白話一點」「畫個圖」 | 啟動視覺化 + 比喻 + multi-select |
| 「[User dismissed — do not proceed, wait for next instruction]」 | 不繼續執行、等 Sean 主動講下一步 |
| Sean 拋新方向(可能與舊拍板衝突) | 確認是否推翻舊拍板 → 確認後對齊新方向、不假設、不直接照新方向衝 |

---

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**

任何決策遇到不確定、回頭看這一句。

— END —
