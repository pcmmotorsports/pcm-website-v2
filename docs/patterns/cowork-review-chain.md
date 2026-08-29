# Cowork Review Chain 規範

> 本檔保存一條可選的對抗審查流程；表內舊角色名稱不代表永久分工。2026-07-14 起，Codex 與 Claude 都可擔任執行或審查 session，實際模式以 `docs/ops/AI_CONTRACT.md` 與當次任務為準。

> **狀態:** 新建 / 2026-05-22 Stage 3 v4 落地
> **層級:** docs/patterns/、衝突仲裁在 CLAUDE.md 之下、其他 patterns 並列
> **對應:** outputs/stage-3-final-v4-master 5 階段對抗審查鏈 + self-audit 14 條補案

## §0 🔴 先讀這一段:**「審查線」這個職稱會給你一個假的方向感**(2026-08-22 審查窗自陳,具名)

接這條線的人,**上工前先知道這件事**:

> 🔴 **我今晚 14 次失誤裡,有 6 次是【別人】擋的 —— 而其中 4 次的「別人」,是我剛審過的那個人。**
> ⇒ **審查不是單向的。而今晚它實際上是雙向的 —— 我只是那個有職稱的方向。**

📌 **⇒ 那個職稱會讓你預設「箭頭從我指出去」,而那個預設是假的。**
而它的代價不是謙虛問題,是**你不會為【自己的產出】安排被審的路徑** ——
因為你就是審的人,而審的人沒有上游。

### 而同一個窗當天的另一句,是它的正面版
> **我今晚拆得動的每一樣東西,都是有人先把它寫成【可以被拆的樣子】。**
> ——`-86` 三處損傷、`-5b` 的 1px 邊界、`-13` 的四欄數字。
> **每一次我能打中,都是因為對方附了量法。**

🔴 **⇒ 所以審查的命中率,主要不是審查者的功勞,是【被審那份東西的形狀】。**
```
附了量法的       ⇒ 可以被逐格反駁 ⇒ 審得動
只有結論的       ⇒ 只能被整體同意或整體懷疑 ⇒ 審不動
```
📌 **⇒ 派工的人與交件的人,對審查的品質影響【比審查者本人大】。**
(相關:主視窗當天把自己的一個框架**標成假設並明寫「我要你推翻它」** ⇒ 那份 1/4 成立的驗證,
**是因為它被做成可以被拆的形狀才發生的** —— 那不是審查者拆了誰的東西。)

---

## §1 五階段對抗審查鏈

| 階段 | 誰跑 | fresh context agent | 抓什麼 |
|---|---|---|---|
| A. PRD 寫完 後 | Cowork session | PRD-reviewer(Cowork Agent tool spawn) | PRD 字面 vs 真權威 drift / 業務 override 漏記 / 影響面評估 / 鐵則違反 |
| B. Slice 指令寫完 後 | Cowork session | slice-reviewer(Cowork Agent tool spawn) | 指令字面 vs PRD vs 真權威 / 禁止清單 / 六件套完整(對齊 CLAUDE.md slice 指令格式段六件套定義)/ manifest impact 段 |
| C. Code 執行 後 | Code session | code-reviewer(.claude/agents/、Code Task tool spawn) | 鐵則 1-12 / 字面 vs 事實 / manifest 同步 / commit message |
| D. Milestone 結束 | Sean 手動貼 | Codex(外部) | milestone 級 / 跨 slice 一致性 / 業務邏輯 |
| E. 每 2-3 milestone | Sean | 肉眼開瀏覽器 | 商品 / 顯示 / 操作 / 業務流程 |

### 觸發條件

- **階段 A:** A mode milestone 級 PRD 寫完必跑;B mode 單 slice 跳;manifest 第一版 + 重大改動跑 PRD-reviewer 級 audit
- **階段 B:** 每個 slice 指令發給 Sean 拍前必跑、不允許 Cowork 自判跳;純 docs slice(只動 .md / .json / .yaml、不動 .ts·.tsx·.css·.sql)可跳
- **階段 C:** 每個 slice commit 前必跑、不允許跳;純 docs slice 可跳
- **階段 D:** 對齊 AGENTS.md 鐵則 12 觸發條件(六類:錢/權限/DB 結構與大量寫入/平台設定/對外不可回收/共用元件行為 + milestone 總審 + Sean 主動;2026-07-22 拍板 C)
- **階段 E:** 對齊 Sean Q2=B 拍板「每 2-3 milestone」、由 Sean 主動觸發

## §2 階段 B slice-reviewer agent prompt 範本

Cowork 用 Agent tool spawn general-purpose、prompt 範本:

```
你是獨立 slice 指令 reviewer、fresh context。

【任務】審 Cowork 剛寫的 slice 指令字面、抓:
1. 字面 vs PRD(若有)vs 真權威 drift
2. 禁止清單可執行不矛盾
3. 六件套完整(對齊 CLAUDE.md slice 指令格式段六件套定義)
4. manifest impact 段填妥(對齊 outputs/stage-3-self-audit.md F-9)
5. 鐵則 11(字面 vs 事實揭示)+ 鐵則 8(重大改動 plan)

【你的輸入】
- slice 指令字面(完整)
- 相關真權威路徑(design-reference / docs/specs / STATUS)
- 對應元件 manifest 段

【你的輸出】
PASS / FAIL + 具體 findings 列點 + 行號 + 建議修法

【你不做】
不寫 code / 不改 slice 指令字面、main session(Cowork)讀 findings 自修
```

## §3 階段 A PRD-reviewer agent prompt 範本

對齊階段 B 結構、但 audit 對象是 milestone 級 PRD、加重點:
1. 跨 slice 範圍邊界(避免單 slice 超 45 分鐘)
2. multi-select 拍板題完整(每題含 2-4 選項 + 三視角)
3. 業務 override 識別完整(對齊 backlog #161 + STATUS L24)
4. 影響面評估(連動哪些檔、跨 package 風險)

## §4 各階段 Failure recovery 規範

| 階段 | FAIL 處置 | Sean 介入 trigger |
|---|---|---|
| A PRD-reviewer | Cowork 自修 ≤2 輪、超過 raise Sean 拍方向(PRD 重寫 / 改 mode) | 第 3 輪 raise |
| B slice-reviewer | Cowork 自修 ≤2 輪、超過 raise Sean 拍方向(slice 指令拆 / 改方向) | 第 3 輪 raise |
| C code-reviewer | Code main session 讀 findings 自修 ≤2 輪、超過 raise Sean 拍處置 | 第 3 輪 raise |
| D Codex Review | findings → Sean 拍處置(忽略 / 修 / 開新 milestone) | 每次必 |
| E Sean 肉眼驗 | Sean 主動拋議題、Cowork 寫修案 | 每次必 |

自修邏輯(階段 A/B):
```
fix_attempt = 0
loop:
  reviewer_result = spawn_reviewer(current_content)
  if reviewer_result.pass: break
  if fix_attempt >= 2: raise_sean(findings); break
  fix_attempt += 1
  current_content = cowork_self_fix(reviewer_result.findings)
```

## §5 階段 C vs Codex Review 重疊區分工

| 範圍 | 階段 C code-reviewer | 階段 D Codex Review |
|---|---|---|
| slice 級鐵則違反 | ✅ | ❌(太細) |
| 字面 vs 事實偏離 | ✅ | ✅(milestone 級交叉檢) |
| manifest 同步 | ✅ | ✅(packet 內嵌異動段) |
| commit message | ✅ | ❌ |
| milestone 級風險 | ❌(太粗) | ✅ |
| 跨 slice 一致性 | ❌ | ✅ |
| 業務邏輯第二意見 | ❌ | ✅ |
| 視覺 / a11y | ❌(Sean 肉眼或 skill audit) | ❌(階段 E) |

重疊區(security / migration / pricing)→ 兩個都跑、各自視角獨立。

## §6 Manifest 第一版 grep 規範

Cowork 寫 manifest 第一版時、不憑記憶(對齊 lessons §12-25 + working-style 第 34 條):

必 grep 源(列為實況、不寫死字面、用 ls + grep + view 取得):
- `STATUS.md` L24「業務 override 紀錄」段(含 #161 + Phase 2 supabase 6 表 LOG)
- `docs/phase-1-backlog.md` 全文 grep `業務拍板|override|偏離|NT\$`
- `docs/specs/M-1-13H-product-page-overhaul-plan.md` §2 7 題拍板鎖定字面
- `docs/specs/*.md` 其他 PRD
- `docs/handoff/*.md` 收工字面
- `design-reference/components/` ls 列出對應 design 字面源(exclude explorations/)
- `apps/storefront/src/components/` ls 列出對應現場字面源

Manifest exclude 規則:
- `design-reference/components/explorations/` 整目錄 exclude(設計探索用、storefront 不對齊、對齊 STATUS L24 Q6 待刪)
- `design-reference/styles/*.v1.css` 標 `deprecated_in_design: true`(storefront 不需對齊)

## §7 A mode vs B mode 切換規範

- **預設 B mode**(每 sub-slice 獨立拍板 + Code raise + 收 commit、適合單純線性任務)
- **A mode 觸發條件**(Cowork 主動提議、Sean 拍板、不擅自切):
  - 剩餘 slice ≥ 3 且設計選擇耦合
  - Sean 顯示疲勞訊號(「累」「複雜」「想 automode」)
  - 連續 3+ 輪 Code raise

A mode 用既有 `docs/specs/M-1-13H-automode-protocol.md` 模板、Cowork 為新 milestone 寫對應 protocol(避免重複框架)。

## §8 Codex 雙關卡對抗審查(Cowork 退出 loop 時的 A/B/D 替代)

> **狀態:** 新建 / 2026-05-23(Sean 拍板:規劃移回 Claude Code、嫌 Cowork 拖速度;為保留「不同模型對抗審查」防線,用本機 `codex` CLI 當審查器)。
> **Skill:** `.claude/skills/codex-adversary/SKILL.md`(完整命令 + prompt + 紀律)。

當 Cowork **不在 loop**(Claude Code 自己規劃 + 實作該 slice)時,§1 的階段 A/B(Cowork spawn 的 PRD/slice-reviewer)+ 階段 D(Sean 手動貼 packet)由 **Codex(OpenAI gpt-5.5、不同模型)兩關卡**補回:

| 替代 | 關卡 | 命令(main session 跑、`dangerouslyDisableSandbox`) | 取代原 |
|---|---|---|---|
| 動手前審 plan | 關卡1 | `codex exec -s read-only "<審 plan vs PRD/design...>"` | 階段 A/B |
| 動手後審 diff | 關卡2 | `codex exec -s read-only "<PCM 鐵則...先跑 git diff>"`(主)+ 可選 `codex review --uncommitted`(通用) | 階段 D(+ 補 C) |

- **寫審分離:** Claude Code 寫 plan + code;Codex 審。不同模型 = 無共同盲點、比 Claude 審 Claude 對抗。
- **Claude `code-reviewer`(階段 C)保留** 作 diff 的快速 PCM 鐵則第一道(免費先篩)、Codex 關卡2 再深審。
### 🔴 零留痕檢查(codex 唯讀審查跑完之後)

⚠️ ~~舊字面「跑前後 `git status --porcelain` 比對一致」~~ **2026-08-28 作廢** ——
八窗共用一棵樹時它量到的是「**誰在動**」不是「**codex 動了什麼**」
(同族已記:memory `feedback_git-status-has-no-owner-column`;本節答的是它的下一題 ——
**換成雜湊之後付出什麼代價**)。

**照這個順序做,順序本身是判準的一部分:**
```
第 0 步  驗 codex【真的跑了】:輸出檔非空 + 含 findings 段
         沒過 ⇒ 判「沒跑」不是「零 findings」(本檔既有那句,錨 `空輸出/單行錯誤`)
第 1 步  `git rev-parse HEAD` 跑前跑後。**只是資訊,不得拿它作廢任何東西。**
         (夜跑時 HEAD 幾乎必然動 ⇒「動了就作廢」= 從來不會生效)
第 2 步  【主判準】跑前跑後兩份逐字相同:
         git ls-files -z -- <本片 pathspec> | while IFS= read -r -d '' f; do \
           printf '%s %s\n' "$(md5 -q "$f")" "$f"; done | sort
         git ls-files --others -- <同一組 pathspec> | sort
         🔴 吃 pathspec, 不是全樹
第 3 步  `git stash list | wc -l` —— 不是判準, 是「變了就去看一眼」(共用資源, 不可歸因)
```

**量到之後做什麼**
```
第 2 步多出東西 ⇒ **停下回報 Sean**(Codex 異常動手), 不要自己判斷是不是無害
第 0 步沒過     ⇒ 判「沒跑」, 重跑
第 3 步變了     ⇒ 去看一眼, 不得據此宣告紅或綠
```

**正負對照(每次都跑)**
```
負對照:pathspec 內【改一個位元組】(`printf 'X' >> <檔>`)⇒ 第 2 步必須不同
        🔴 不可用 `touch`(只動 mtime, md5 相同 ⇒ 恆等式)
        🔴 改完【必須還原】—— 八窗共用主樹、`git add <單檔>` 帶走整支 diff
           ⇒ 還原照 `docs/patterns/mutation-harness-restore.md`, 不自創
正對照:拿一個你確定在清單裡的檔名比對 ⇒ 必須命中(回 0 有兩種:真的沒有 / 你打錯字)
```

🔴 **價目表(換來歸屬,換掉這四類;2026-08-28 逐項實測)**
```
① `chmod +x`             md5 相同(舊尺印 1 行)⇒ 新尺比舊尺瞎
② symlink 換同內容實體檔  md5 相同(舊尺印 ` T`)⇒ 同上
③ submodule / gitlink    `md5 -q design-reference` ⇒ `Is a directory`
                         ⚠️ 不是少一格 —— 那一列變成【空雜湊 + 檔名】浮在最前面而 rc=0,
                            看起來像正常的一列
④ 新增檔粒度             `git ls-files --others -- apps/admin` ⇒ 4257 行
                         (加 `--exclude-standard` ⇒ 2)⇒ 兩種讀法都恆紅
                         ⇒ **本節不給判準, 明寫待解**;在有人給出可用粒度之前只當線索
```
⇒ **片內含 submodule、或會動權限位元/symlink ⇒ 另跑一發舊尺 `git status --porcelain -- <pathspec>` 當補充訊號。**
📌 舊尺的失效是**假警報**,新尺的失效是**靜默漏看** ⇒ 舊尺留著當補充,不是被取代。

⚠️ **偽陽是常態路徑**:codex 跑十幾分鐘,而你在那段時間本來就在改 pathspec 內的檔
⇒ **跑 codex 期間不要動 pathspec 內的檔**(2026-08-28 隊規「交出去審就凍結」;**本檔是它目前唯一的落點**)。

⚠️ **准許句**:過了這四步只能寫「codex 對【我的檔】零留痕」,**不得寫「零留痕 ✅」** —— 上面四類不在射程裡。

✅ **判準來源**:Sean 2026-08-28 拍 `Q-零留痕判準 = 甲`。
🔴 **強度**:他回一個字,讀的是主視窗端的摘要 —— **不是他讀了本節**。
落檔字面 =「**依主視窗摘要批准**」,**不得寫成「Sean 審過本節」**;他批准的是**方向**,
不是本節每一行做法 ⇒ 具體做法日後被推翻,**不得引用這次拍板當背書**。

📎 這個坑先前已寫過兩次(本節只是把它接進 codex 那條實際會被跑的路,不是發現它):
`docs/patterns/guard-and-instrument-traps.md`(錨 `我宣稱動過的那幾個路徑`)·
`docs/patterns/traps-inbox/V-20260818.md`(錨 `V-4 共用樹的`)。
- **觸發範圍(控成本):** **預設不跑 codex、例行前台 slice(form/tab/CSS/型別/docs)只走 code-reviewer。** 關卡1 = 高風險片 plan(鐵則 12 六類;2026-07-22 拍板 C);關卡2 = 鐵則 12 六類 + milestone 收尾總審。**每 slice codex 硬上限 2 輪(初審 + 1 複審)、round2 仍 FAIL raise Sean、不加輪**(2026-05-29 Sean 拍 E+B)。**成本實況(2026-05-29 校正):codex exec 是 agent 翻 repo、實測 ~0.5M–1.4M input token/次(非舊註 28k)、gpt-5.5 API key 計費約 $0.8–2/次。**
- **`/codex-review` skill(產 packet 給人手動貼 web Codex)已非預設**(2026-07-21 拍板:鐵則 12 一律直呼 codex CLI、不產書面 Packet;僅 Sean 明確要書面 Packet 時用)。CLI 即時審(本 §8)= 現行唯一預設。

---

## 🔴🔴 「第 3 輪換角度換模型」為什麼不是形式 —— 2026-08-30 的實證(線A `-e9`,片 D3-d)

家法(`~/.claude/rules/00-work-rules.md` §5)寫著:**第 3 輪起必須換角度、換模型**,
理由是「同模型再審傾向在同一框架內找更細的問題;換模型才會質疑框架本身」。
📌 **而那句話一直是【論證】,下面這一發是它的【量測】。**

同一片 diff、三輪、每一輪都抓到真 finding:

| 輪 | 誰 | 結果 |
|---|---|---|
| R1 | codex | FAIL 6 must-fix + 4 nit |
| R2 | codex(同模型,修完再審) | FAIL 4 must-fix + 10 nit |
| **R3** | **`adversarial-reviewer`(opus,換模型)** | **FAIL 3 must-fix + 2 consider + 3 nit** |

### 🔴 而三輪打的**不是同一面**,這才是重點

```
R1 / R2(codex 兩輪)問的都是:「這道鎖【繞得過去】嗎?斷言【恆綠】嗎?」
    ⇒ 抓到:TRUNCATE 不觸發 row trigger、後置斷言不驗 tgfoid/tgqual/tgenabled、
             ACL 只驗 proacl 非 NULL、逐欄覆蓋不足、rollback 漏物件、過濾器太寬…
    📌 全部都在【這片碼自己】的邊界內

R3(換模型)問的是:「它【叫人走的那條路】,今天真的走得通嗎?」
    ⇒ 抓到的那條, 完全在這片碼【外面】
```

**R3 抓到的那條(F1),前兩輪一次都沒有靠近過:**

> 本片的 `P2B46` 訊息叫人「用 `admin_record_manual_refund` **登一筆新的**」。
> 而那支 RPC 的冪等格是 `(order_id, request_id)` 且**不濾 `voided_at`**
> (`20260823020000:394-403`)⇒ 沿用原本那把 `request_id`
> ⇒ **命中那個已作廢的列** ⇒ 回 `idempotent:true`
> ⇒ **一列都沒寫、帳仍是「沒退過」**,而後台把 `idempotent` 當成功顯示
> (`manual-refund-actions.ts:150` 逐字:顯示成錯誤會誘導員工換 token 重送)。
> ⚠️ 而若只改了內容 ⇒ 撞到它的同鍵不同內容拒絕,**而那則訊息逐字叫你
> 「不要用新的 `request_id`」** —— 那句話的前提是「你在重送同一筆」,
> **不涵蓋「原本那筆被作廢了」**。
> 🔴 **⇒ 兩條分支都把員工推離唯一走得通的那條路,而畫面上是綠的。**

### 📌 一般化(這才是要留下來的那一句)

**同一個模型再審一次,是在【同一張地圖上】找更細的路;換一個模型,是換一張地圖。**
而 R1/R2 那 10 條 must-fix **全部落在「這片碼會不會被繞過」這張地圖上** ——
它們是真的,而它們**證明不了**「這片碼叫人做的事做不做得到」。

🔴 **判別句:當一輪審查的 findings 開始都長得像同一類問題,那不是「快收斂了」,
是【這張地圖已經被走完了】。** 換模型的成本是一次呼叫,
而不換的成本是**一個通過三綠、通過兩輪審查、而畫面上是綠的陷阱**。

⚠️ **射程(不要讀成比它大)**:這是**一片**的實證,不是統計。
它證的是「換模型**這一次**買到了前兩輪買不到的東西」,
**不證**「每一次換模型都會多抓到東西」,也不證「codex 比較弱」——
R1/R2 那 10 條 must-fix 每一條都是真的,而 R3 **沒有**抓到它們任何一條。
📌 **兩張地圖各自覆蓋對方的盲區,而不是其中一張比較好。**

— END —
