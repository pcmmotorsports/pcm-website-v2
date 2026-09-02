---
name: codex-adversary
description: 用 Codex(不同模型)當對抗審查器、從 Claude Code main session 直接跑 codex CLI。兩關卡:關卡1 動手前審 plan(codex exec -s read-only)、關卡2 動手後審 diff(codex exec -s read-only PCM 自訂為主;codex review 可選通用)。Cowork 退出 loop 時補回 Cowork 階段 A/B/D 的對抗審查。Use this skill whenever the user mentions codex 審 / codex 對抗審查 / 動手前審 plan / 動手後審 diff / 跑 codex review / Cowork 退出要審查, or 自己規劃 slice(無 Cowork 指令)時主動跑關卡1、重大/security/migration slice commit 前主動跑關卡2.
---

# codex-adversary — Codex 雙關卡對抗審查

> **狀態:** 新建 / 2026-05-23(Sean 拍板 A:Codex 審 plan + diff 兩關、取代 Cowork A/B/D)
> **對應:** `docs/patterns/cowork-review-chain.md` §8 + 五方分工(Cowork 退出時)
> **背景:** Sean 把規劃從 Cowork 移回 Claude Code(嫌 Cowork 拖速度);為保留「不同模型對抗審查」這道防線,用本機 `codex` CLI(gpt-5.5、Sean 已登入)當審查器。

## 為什麼 Codex 不是 Claude code-reviewer

Codex 是**不同模型(OpenAI gpt-5.5)**,比 Claude 審 Claude 更對抗(無共同盲點)。`code-reviewer`(Claude subagent)留作 diff 的**快速 PCM 鐵則第一道**(免費先篩),Codex 再深審。寫 plan / 寫 code 的是 Claude Code(我),審的是 Codex —— 寫審分離保對抗性。

## ⚠️ 執行紀律(硬性、每次必遵守)

1. **只從 main session 跑、不在 subagent 跑。**
   - 已實測(2026-05-23):subagent 的 Bash 用 `dangerouslyDisableSandbox` 會被 auto-mode classifier 擋(安全政策層);main session 可。故 codex 一律 main session 直跑。
2. **每次 Bash 呼叫帶 `dangerouslyDisableSandbox: true`**(codex 需網路 egress、預設 sandbox 擋)。timeout 設 ≥ 180000ms(codex 一次跑 1-3 分鐘)。**命令尾必接 `< /dev/null`**:`codex exec` 在背景 / 非互動 shell 會等 stdin EOF、不接會卡死(2026-05-24 M-1-14e-1a 實測連卡兩次、kill 後加 `< /dev/null` 才正常);搭 `> /tmp/codex-out.txt 2>&1` 收長輸出。
3. **只用唯讀命令:**
   - `codex exec -s read-only ...`(關卡1 審 plan、關卡2 PCM 自訂審 diff)
   - `codex review --uncommitted` / `--base ...`(關卡2 可選通用審、設計為唯讀)
   - **絕不**用 `codex fix` / `codex apply` / `codex exec`(**不帶** `-s read-only`)/ `--dangerously-bypass-approvals-and-sandbox`(會改檔)。
   - **防線分層(誠實)**:settings.json deny 擋 `codex fix` / `apply` / `a`(明確會改檔的子命令);但 deny **無法**精準「只擋非唯讀 exec、放行唯讀 exec」(pattern 重疊)→ `codex exec` 的唯讀紀律靠**本 skill 強制每次帶 `-s read-only`** + 下方第 4 點 baseline 比對當實質防線,**非全靠 hard deny**。
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
5. **成本意識(2026-05-29 校正):** codex exec 是 **agent 翻 repo**(會 git diff / grep / 開檔、每輪 re-send 全 context)、**不是讀一份包** → 實測累計 **~0.5M–1.4M input token/次**(非舊註的 28k)、gpt-5.5 API key 計費約 **$0.8–2/次**。故嚴格照下方「觸發範圍」控量、且每 slice 限輪數(見關卡2)、非每 commit。
6. 🔴 **窄化交辦(2026-08-10 Sean 指示立制;不窄化=實測 10 分鐘翻無關 docs、4027 行輸出零 findings、額度全費)**,每次 codex 呼叫必照:
   - **diff 直接餵進 prompt**:`git diff --cached`(或 plan 全文)貼進交辦,**不叫 codex 自己翻 repo 找對象**。
   - prompt 明文兩條限制:**禁 grep/搜尋全 repo**;**最多另開 N 個白名單檔**(逐一列路徑,N≤5)。
   - **審查角度逐條列**(3-4 條),且**主視窗/前輪已給的錨點先寫進 prompt**(標「已知,直接驗」),免得被當新 finding 再繞一輪。
   - **背景跑**(`run_in_background` 或 `&`)+輸出導 `/tmp/codex-out-*.txt`;**12 分上限用 shell watchdog**,🔴 **不得寫 `timeout 12m`——macOS 無 `timeout` 也無 gtimeout,照抄=codex 根本沒跑、輸出只有一行 command not found,而零留痕比對照樣「通過」**(B 窗 08-10 實錘)。watchdog 形狀:`( codex exec … < /dev/null > /tmp/codex-out-X.txt 2>&1 & CPID=$!; for i in $(seq 1 72); do kill -0 $CPID 2>/dev/null || exit 0; sleep 10; done; kill $CPID ) &`。逾時=殺掉、只准再窄化重跑一次(同一件事 2 輪封頂,第 2 輪仍逾時或零 findings=認列缺口回報主視窗,不跑第 3 輪)。**跑完必驗輸出非空且含 findings 段**——空輸出/單行錯誤=「沒跑」不是「零 findings」。
   - 🔴🔴 **白名單之外, 要【逐檔點名禁止】這五類 —— 而理由要寫進 prompt**(⟦e3-CODEXEATENBYDOCS⟧, 2026-09-02):
     `STATUS.md` · `docs/handoff/` · `docs/lessons-learned.md` · `docs/decisions/` · `docs/phase-1-backlog.md`。
     **理由逐字附上**:「上一輪你花光整個預算讀它們, 一條 finding 都沒產出。」
     🛑 **為什麼「禁 grep 全 repo」那一條擋不住它**:codex 不是用 grep 找到它們的 ——
     **它是【開檔讀】**, 而那些檔是 repo 裡最大、最像「背景說明」的東西。
     ⇒ 📌 **一條禁令的射程止於它舉的那個動作;`grep` 被禁而 `open` 沒有。**
   - 🔴🔴 **收到 log 之後【必跑兩把尺】—— 而上面那條「非空且含 findings 段」對這個病是瞎的**
     (⟦e3-CODEXEATENBYDOCS⟧;`-e3` 那一發 **608,047 bytes** ⇒ 它**輕鬆通過**「非空 + 有 findings 段」):
     ```
     尺A  grep -c 'must-fix' <log>                        ← 它數的是【字】
     尺B  grep -cE '[A-Za-z0-9_/.-]+\.[a-z]+:[0-9]+' <log> ← 它數的是【帶檔案:行號的】
     ```
     🎯 **判別句:一個【讀到的字】與一個【寫出來的結論】, 在 `grep` 底下是同一個東西。**
     `-e3` 那一發:尺A **31** · 尺B **0** ⇒ **31 條全部是它【讀到的檔案內容】**
     (落點 `STATUS.md:616-620` · `docs/handoff/CURRENT.md:252 / 1340 / 1924`)。
     🔬 **`-f3` 用自己三份 log 複現, 三份全部有落差, 而比例隨 log 變大而惡化**:
     `1,171,113 bytes ⇒ 46 ⇒ 3` · `60,419 ⇒ 12 ⇒ 4` · `209,268 ⇒ 28 ⇒ 5`
     ⇒ 🎯 **最健康的是【最小的那一份】, 而它正是唯一收窄過 prompt 的那一發。**
     ⚠️ **尺B 會低估**(finding 換個寫法就漏掉)⇒ **那些數字是下界不是精確值**;
     它要答的不是「幾條」, 是「**尺A 遠大於尺B ⇒ 這是一份【看起來很忙】的 log**」。
     🔴 **而尺B 自己也會【高估】—— 這一格是 2026-09-03 線 `-auth` 造假 log 驗它時撞到的**:
     尺B 認的是「檔案:行號」這個**形狀**, 而 codex **引用**別的檔時也會印出那個形狀
     (`STATUS.md:616` 本身就長這樣)⇒ **被引用的座標會被算進尺B。**
     ⇒ 📌 **所以 `尺A > 尺B` 是【有病】的訊號, 而 `尺A == 尺B` 不是【健康】的證明。**
     🟢 **三發對照(現造 fixture, 可重跑)**:忙碌 log ⇒ `A=3 B=2`(叫)· 正常 log ⇒ `A=2 B=2`(不叫)
     · 空檔 ⇒ `A=0 B=0`(不叫)⇒ **這把尺會動, 而它只在一個方向上有判別力。**
     🛑 **⇒ 而 0 finding 的 log 會被讀成「codex 審過了、沒問題」, 而它與【真的沒問題】印同一個東西。**
   - 🟢 **而本條【不可以】被讀成「codex 對本 repo 沒用」—— 同一天有反例**:
     `-fc` 那一發 **prompt 只有 4,711 bytes** ⇒ 產出 **4 條 must-fix**,
     其中一條是**兩輪 Claude 審查都沒抓到的**(註解自己前後矛盾)。
     ⇒ 📌 **變數是【怎麼餵】, 不是【能不能用】。**
   - 大 diff(>1500 行)拆段餵、或改附「檔案清單+行區間」;審 plan 同理(plan 全文貼入、禁翻 docs/)。
   - 實證:E 窗 #363 關卡2 第 1 輪未窄化=逾時零產出;第 2 輪窄化(diff 372 行入 prompt+白名單 3 檔)=45,877 tokens 正常吐 4MF+1nit。

## 觸發範圍(客觀判定、自己決定、不問 Sean)

> **預設:不跑 codex。** 例行 slice(storefront 前台 form / tab / 空狀態 / CSS / 純型別 / docs)一律只走 Claude `code-reviewer`、**不跑 codex**(2026-05-29 Sean 拍 E:重大才給 codex 才有意義、控 OpenAI API 成本)。只有下表命中才跑:

| 關卡 | 何時跑 |
|---|---|
| **關卡1(plan)** | 我自己規劃 slice 且屬高風險片(鐵則 12 六類:錢/權限/DB 結構與大量寫入/平台設定/對外不可回收/共用元件行為;2026-07-22 拍板 C)。標準/輕量片跳。 |
| **關卡2(diff)** | 命中鐵則 12 六類(同上)+ milestone 收尾總審。跨 3 檔/一般 API 不再自動觸發(2026-07-22 拍板 C);純前台 form/tab/CSS/型別 slice(如 g-5b 收件地址表單、M-1-14c)一律跳、走 code-reviewer 即可。 |

(Sean 若說「每個 slice 都跑」→ 全開。)

## 關卡1 — 動手前審 plan

我寫完 slice plan(handoff / plan 字面)後:

```bash
codex exec -s read-only "你是獨立對抗 plan reviewer(fresh context)。審下面這份實作 plan,對照 PRD 與 design 真權威,抓:
1. plan 字面 vs PRD vs design 真權威 drift
2. scope(鐵則 4 大小 15-45min / 鐵則 8 重大改動是否該先提)
3. 禁止清單可執行不矛盾
4. L3 內容分級漏判
5. 缺的決策點(會害動手後才爆、需上游先問人)
只輸出 PASS|FAIL + findings(列點 + 修法),不要修改任何檔案。

=== PLAN ===
$(cat <plan 檔路徑>)
=== 相關 PRD/design 字面 ===
<貼相關真權威字面>" < /dev/null > /tmp/codex-k1-out.txt 2>&1
```
(長 prompt 建議寫 `/tmp/codex-prompt.txt` 再 `"$(cat /tmp/codex-prompt.txt)"`,避免 quoting 地獄。)

findings 回來 → 我自修 → **codex 複審每 slice 全程硬上限 2 輪(初審 + 1 複審),round2 仍 FAIL 停下 raise Sean、不再加輪**(見關卡2 輪數上限)→ **真正的決策岔路一次性上游批次問 Sean**(不零碎打斷)。

## 關卡2 — 動手後審 diff

`/slice-checkpoint` 三綠 + Claude `code-reviewer` PASS 後、commit 前。

⚠️ **語法限制(2026-05-23 實測):`codex review` 的 scope flag(`--uncommitted`/`--base`/`--commit`)不能搭自訂 PROMPT**(`error: --uncommitted cannot be used with [PROMPT]`)。故分兩種:

**(a) PCM 鐵則自訂審查(主、推薦)** — 用 `codex exec -s read-only`、讓 codex 自己跑 git diff:
```bash
codex exec -s read-only "你是獨立對抗 code reviewer。先跑 git diff --staged(及 git diff HEAD)看本 slice 變更,審:PCM 鐵則 1-12 違反 + 字面vs事實偏離 + design 真權威對齊 + server 端會員/價格鐵則(經銷價不外洩 / 金額禁浮點 / tier 驗證在 server)。只輸出 PASS|FAIL + findings(列點+位置+修法),不要修改任何檔案。" < /dev/null > /tmp/codex-k2-out.txt 2>&1
```
(審 untracked 新檔時先 `git add` 精準 staged,codex 才看得到;`codex exec` 命令尾必接 `< /dev/null`。)

**(b) Codex 內建通用審查(可選、抓一般 bug/品質/安全)** — scope flag 不配 prompt:
```bash
codex review --uncommitted          # slice 級:staged+unstaged+untracked
codex review --base origin/dev      # milestone 級:對 origin/dev 整批
```

findings 回來 → 我自修 → **codex 複審每 slice 全程硬上限 2 輪(round1 初審 + round2 修後複審)。round2 仍 FAIL → 停、raise Sean 拍處置,不准再跑 round3/4**(2026-05-29 Sean 拍 B;反例:g-5b 跑到 round4 = 單 slice ~$4.28)。PASS → commit。

## 輸出處理

- Codex 輸出是**文字 / markdown(無 `--format json`)**→ 讀文字、抽 findings。
- 輸出可能長 → 必要時 `> /tmp/codex-out.txt` 再讀關鍵段,避免灌爆對話。

## 跟其他審查層的分工(對齊 cowork-review-chain.md §5)

- 關卡1(Codex plan)= 取代 Cowork 階段 A/B(動手前)
- `code-reviewer`(Claude)= diff 快速 PCM 鐵則篩(階段 C、免費)
- 關卡2(Codex diff)= 深度獨立審(階段 C+/D-lite、取代手動貼 packet)
- `/codex-review` skill(產 packet 給人手動貼 web Codex)= milestone 級完整審,**保留並存**
- Sean 肉眼驗 = 階段 E(視覺/操作)

## 不做的事

- 不在 subagent 跑 codex(classifier 擋)。
- 不用 codex 改檔(只審)。
- 不自動 push。
- Codex findings 是「第二意見」、不無腦照單全收;與 PCM 鐵則 / Sean 拍板衝突時以後者為準、衝突點 raise Sean。

— END —
