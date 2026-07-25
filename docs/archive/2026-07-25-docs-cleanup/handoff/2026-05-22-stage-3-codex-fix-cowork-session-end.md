# 2026-05-22 Stage-3-codex-fix Cowork Session 收工 Handoff

> Cowork session 收工交接文(2026-05-22 第 3 個 Cowork session、Stage 3 onboarding fix slice 完成)。下個 Cowork session 進來第一件事讀這份對齊。

---

## §1 Session metadata

| 欄位 | 值 |
|---|---|
| 日期 | 2026-05-22(同日第 3 個 Cowork session、Codex findings 應對 + V1 補丁、reviewer chain 第一次實證) |
| Cowork session 重點 | Codex Review 4 件 findings 處置 + Code raise V1 補丁實證新工作流 + 階段 B reviewer 第一次 FAIL → 自修 → PASS 實證 |
| Branch | `dev` |
| HEAD | `9f33ed7`(chore(workflow): 應對 Codex Review 4 件 findings [Stage-3-codex-fix]) |
| ahead | 4(待 Sean 一次 push:`786a52c` / `81ba671` / `6bb41da` / `9f33ed7`) |
| design-reference submodule | `637dafc`(未動) |
| 工作樹 | clean(busboy-end + STATUS amend 同 commit) |

---

## §2 本 session 做了什麼

### 2.1 Codex Review findings 處置(4 件、1 commit `9f33ed7`)

| Finding | 處置 |
|---|---|
| must-fix #1 | `docs/patterns/cowork-review-chain.md` L12+L35「五件套→六件套」字面修(2 處、grep 驗 五件套 0 行 / 六件套 2 行) |
| must-fix #2 | `scripts/design-mirror.mjs` --target 擴 component/css/related_storefront 三類路徑 + multi-match + --component filter;--validate 擴驗 8 類 path 欄位 + related_storefront[] |
| consider #1 | `docs/reviews/2026-05-22-stage-3-onboarding-packet.md` 字面對齊 ahead=3 / 本機 HEAD=`6bb41da`(out-of-scope)/ Codex 審查 HEAD=`81ba671` |
| consider #2 | design-mirror.mjs L132-134 刪不存在的 `--skip-manifest-check` flag 字面、改行為指引 |

### 2.2 V1 補丁(validate 抓到既存 drift、Sean 拍 V1 例外放行)

- `docs/design-storefront-manifest.yaml` VehicleFinder.storefront.css 改佔位字面(原指向不存在 `apps/storefront/src/styles/vehicle-drawer.css`)
- VehicleFinder.open_drifts 加 `vehicleFinderCssNotPorted` 條紀錄真實 drift
- 維持既有 entry shape:field/note/plan 三欄、無 detected_at 新欄位、無 backlog 佔位字面
- 僅動 VehicleFinder、其餘 13 components + yaml schema 不動

### 2.3 順帶

- git add Sean 自編 handoff §7.1 Codex 處置 prompt(原 working tree dirty)

### 2.4 新工作流第一次完整實證(階段 B + C reviewer chain)

| 階段 | 結果 |
|---|---|
| 主 slice 階段 B reviewer attempt#0 | PASS(4 件 🟢 nit、不修) |
| Code 跑主 slice 步驟 1-8 | OK、加強版 validate 抓到 1 件既存 drift、Code 停下回報(禁止清單運作正確) |
| Sean 拍 V1 | 授權 manifest 1 行例外 |
| V1 補丁階段 B reviewer attempt#0 | FAIL(1 must-fix + 3 consider + 1 nit) |
| V1 補丁 fix attempt #1 | Cowork 自修 6 處 |
| V1 補丁階段 B reviewer attempt#1 | PASS(6 件全解、無新 drift) |
| 階段 C code-reviewer | PASS、0 critical、復現所有驗證(general-purpose 注入 role、harness hot-load 限制) |

---

## §3 當前 milestone 全貌

```
M-1-13a ~ 13f-2 ✅
M-1-13g ⏸    暫停(Toast 推延)
M-1-13H ✅   商品頁全面改版完成
Stage 3 工作流升級 ✅(81ba671)
Stage-3-codex-fix ✅(9f33ed7、Codex findings 4 件 + V1 補丁)
M-1-13I ⏭   3 個車款狀態傳遞 bug(下個任務、用新工作流第二次實證)
M-1-14   ⏭   Customer schema
M-1-15   ⏭   LoginPage·RegisterPage
M-1-16   ⏭   200 SKU 種子
```

---

## §4 新工作流第一次實證學到的(候選 lessons / working-style)

| 項 | 內容 | 候選對應 |
|---|---|---|
| 1 | Stage 3 reviewer chain 階段 B 在 fix attempt #0 抓 1 must-fix(commit body 兩段並存自相矛盾)— fresh context audit 有實效、不是裝飾 | cowork-review-chain.md §2 設計意圖實證 |
| 2 | 加強版 --validate 第一跑抓 1 真 drift(VehicleFinder.storefront.css)— Codex must-fix #2 視角補的覆蓋面有實效 | cowork-review-chain.md §6 manifest grep 規範實證 |
| 3 | 補丁類 slice 指令模板:用「補丁範圍說明」段明示繼承主 slice、不重列六件套、避免冗長 + reviewer 誤判 FAIL | 候選進 docs/working-style.md 補丁 slice 範例段 |
| 4 | V1 模式可複用:validate 抓到 → Code 停下回報 → Cowork 評估 → Sean 拍例外 → 補 1 行 + open_drifts 記錄 閉環 | 候選進 docs/working-style.md 「禁止清單例外放行流程」段 |
| 5 | harness hot-load 限制:本 session 新建 subagent(.claude/agents/code-reviewer.md)同 session 不可 Task spawn、需新 session 才生效;Cowork 用 Agent tool spawn general-purpose 注入 role 同等效果 | 候選進 docs/lessons-learned.md §12-N、下個 Code session 第一次 Task spawn 驗 OK 後寫 |
| 6 | Code 一次成形 commit vs Cowork 字面寫 amend 路徑:當主 commit 還未下時、字面對應「amend 完成態」、實際 Code 寫一次成形 — 屬「事實 > 字面」、commit body 揭示即可、不算偏離 | 對齊鐵則 11 字面 vs 事實守則(已立法、本實證為應用範例) |

本 handoff 列「候選」、不直接寫 lessons / working-style、下個 Cowork session 評估是否進。

---

## §5 下次 session 任務:M-1-13I(用新工作流第二次實證)

### 5.1 任務內容(沿用前 handoff §5.1、不變)

3 bug fix:
1. 首頁 VehicleFinder push `?brand=X&model=Y&year=Z` / ProductsPage 不讀 URL → 車種跨頁丟失
2. 商品頁麵包屑 useMemo / vehicle 變數沒用 → crumbs href 不帶 vehicle
3. vehiclePill 整顆 button onClick={handleClearVehicle} → 沒拆「pill 本體導航」+「× 清除」兩層

### 5.2 設計拍板題

- Q1:URL 格式統一(A=1 param 推薦 / B=3 param / C=兩格式都支援)
- Q2:slice 拆法(A=1 刀合一 推薦 / B=2 刀 / C=3 刀)
- Q3:A2 hook 腳本 timing — **Sean 上 session 已拍 B(獨立 slice、M-1-13I 完成後)**、本 session 不重拍

### 5.3 V1 補丁順帶 plan(本 session 留給 M-1-13I)

VehicleFinder CSS 來源(manifest open_drifts `vehicleFinderCssNotPorted`):M-1-13I 修 VehicleFinder 時順帶 audit:
- 路徑 a:port `design-reference/styles/vehicle-drawer.css` 進 storefront、把 manifest 佔位字面改回真路徑
- 路徑 b:確認 VehicleFinder 用 tokens / global css 達樣式、不需 ported file、把 manifest 佔位字面改寫為「無需 ported、樣式來源見 [X]」+ 從 open_drifts 移除該條(改完算解決)

若 audit 時 1 行修法就過、併本 slice;若 port CSS 開新 slice、不擴 M-1-13I scope。

---

## §6 Sean 待決策(沿用 + 本 session 新項)

沿用前 handoff §6:
- #1 發票自動化 / #3 TapPay sandbox / #4 部署(premortem step-2 設最晚拍板日)
- M-1-13I Q1+Q2 拍板(新 session 開時拍)
- Q3=B A2 hook 推延已拍(2026-05-22)
- Q6 explorations 刪除(Sean 在 Claude Design 端動)

本 session 新項:無(Codex findings 全處置完、V1 拍板執行完、無遺留拍板)

---

## §7 下個 session 開場 prompt 範本

### 7.1 Cowork(新對話)

**前置確認(三項全綠才用本 prompt、對齊前 handoff §7.1):**
- [ ] §J 已貼 Cowork app Projects instructions(若 Stage 3 工作流升級時已貼跳)
- [ ] Codex Review Packet findings 已處置(本 session 已收尾 ✅)
- [ ] origin/dev 已 push(ahead=0)

三項全綠才用:

```
請讀 docs/handoff/2026-05-22-stage-3-codex-fix-cowork-session-end.md 對齊上下文、
再讀 STATUS.md + docs/PHASE-1-NORTHSTAR.md + docs/patterns/cowork-review-chain.md(新工作流規範)。

接續任務:M-1-13I 3 個車款狀態持續傳遞 bug(用 Stage 3 新工作流第二次實證、第一次完整跑通)。

請給我 Q1(URL 格式統一)+ Q2(slice 拆法)multi-select 拍板、Sean 拍完後:
1. Cowork 寫 slice 指令(六件套含 Manifest Impact 段)
2. Cowork 跑階段 B slice-reviewer(Agent tool spawn fresh)
3. PASS 後給 Sean 貼 Code
4. M-1-13I 修 VehicleFinder 時順帶 audit V1 補丁記錄的 vehicleFinderCssNotPorted(open_drifts 內、port CSS or 確認 tokens / global css 達樣式無需 ported file)
```

### 7.2 Code(新 Claude Code session)

```
[貼 busboy-start.js pcm 輸出]
```

Code 跑完起手 5 綠檢查 + 讀套件、回報「我已讀完套件、可以開工」、然後等 Cowork 傳 M-1-13I slice 指令。

**本 Code session 額外驗:第一次 Task spawn `.claude/agents/code-reviewer.md`**(harness hot-load 限制本日 Cowork session 不可用、新 session 才生效)— 若 spawn OK、Cowork 評估進 lessons §12-N。

---

## §8 5 綠起手檢查預期(新 Code session)

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current     # 預期: dev
git status                     # 預期: clean(若 Sean 已 push、ahead=0;若未 push、ahead=4 或 5 含本 handoff commit)
git log --oneline -5           # 預期最上面:
                               #   9f33ed7 chore(workflow): 應對 Codex Review 4 件 findings [Stage-3-codex-fix]
                               #   6bb41da docs(handoff): 2026-05-22 Stage 3 工作流升級 Cowork session 收工
                               #   81ba671 chore(workflow): Stage 3 終版 v4 工作流升級基礎建設
                               #   786a52c chore: 收 2026-05-22 session 遺留
                               #   46594ae docs(backlog): #163 dev tier override 機制
git submodule status design-reference  # 預期: 637dafc...
```

STATUS.md 頂列 hash 可能標 amend 前 hash(busboy-end 雙 amend 自參考慣例、對齊 backlog #142)、實際 HEAD `9f33ed7`、屬慣例範圍可接受。

---

## §9 Sean 在本 session 結束時待做的事(順序)

1. **push origin dev**(ahead=4、含 `786a52c` + `81ba671` + `6bb41da` + `9f33ed7`)
2. **貼 Cowork app Projects instructions §J**(從 `docs/proposals/stage-3-bundle-docs-deliverables.md` §J 複製、Stage 3 工作流升級時若已貼跳)— 下次 Cowork session 才會載新規則
3. **開新 Cowork session 進 M-1-13I**(用 §7.1 主版本 prompt、三項全綠才用)

本 handoff(本檔)目前 untracked、Sean push 前可在當前 Code session 順手 commit + push 一次 5 個 commits;或之後在新 Code session 順手 commit、再 push。任一順序都可。

— END —
