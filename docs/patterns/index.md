# Patterns 索引

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **本目錄性質:** 由 `CLAUDE.md` / `AGENTS.md` 路由表**按需引用**(2026-07-03 瘦身後不再常載全文);規則字面以 `CLAUDE.md` / `AGENTS.md` 為準,本目錄僅存細節。
> 命中路由表對應觸發情境才讀對應檔,不通讀全目錄。

---

## 檔案清單

| 檔 | 定位 |
|---|---|
| `general.md` | 通用工程規矩(可移植到任何 project,如檔案大小上限) |
| `pcm-specific.md` | PCM 專屬硬規則(design-reference 真權威等),寫 PCM 程式碼前必讀 |
| `react-nextjs-rules.md` | React 19 hooks / eslint 規則,動 hooks・useEffect 相關 code 時讀 |
| `money-handling.md` | brand type MoneyAmount 守門規範(ADR-0004 Q4=A3 落地),跑金額運算時讀 |
| `slice-checkpoint.md` | 三綠 Checkpoint(typecheck+lint+build)規範,鐵則 11 細節檔 |
| `slice-instruction-six-piece.md` | Slice 指令格式六件套完整規格(Cowork 模式) |
| `codex-review-packet.md` | Codex Review Packet 流程(歷史備查;2026-07-21 起鐵則 12 改直呼 codex CLI) |
| `codex-inspector-role.md` | 給新 Codex 視窗的「檢查者」角色說明(唯讀審查) |
| `cowork-review-chain.md` | Cowork 五階段對抗審查鏈規範 |
| `guard-and-instrument-traps.md` | **守門與量具的坑**(恆綠格 / 紅錯地方 / 一發紅多格 / 恆紅閘 / 掃描字集太窄 / 證據可不可重跑 / `cd` 改作用域 / 「共 N 處」重數還是錯 / 折出假的守門)。**條目數不寫在標題裡**——帶數字的標題沒有人會回頭改。**寫完守門要說「已驗證」之前、下全稱句之前、審別人驗收表之前**各查一次;每條附 2026-08-14 當天實例 + `檔案:行號` |
| `mutation-harness-restore.md` | **突變 harness 的「還原」怎麼寫才不會被殺掉**(來源=2026-08-16 A 窗實錘:**一份被突變的 migration 被 commit 進正式分支**)。**要跑任何「會改檔案」的腳本之前讀** —— 病灶不是忘了還原,是**用一個會殺掉還原的方式跑它**。⚠️ **2026-08-17 之前本表漏列它**(全樹除自身外零引用),不是它不重要 |
| `pagination-loop-review.md` | **分頁迴圈五條準則**(頁大小嚴格小於 `db-max-rows` / `.range()` 兩端皆含 / 中途失敗要 throw 不得 break / `count` 不當終止判準 / 排序帶唯一鍵)+ **repo 內那個比五條高一級的範本**(空頁終止 + 實得游標 ⇒ 對 `db-max-rows` 調小**免疫**,把第 1 條整個解耦掉)+ 錢族那把刀(「漏一筆+多一筆會不會剛好對上」)。**審或寫任何 `.range()`・翻頁迴圈之前讀**。🔴 檔頭有**證據等級聲明**:原始全文已隨 session 消失,本檔是轉錄版 —— **引用前先讀那一段** |
| `revoking-function-execute-in-supabase.md` | 🔴 **檔名寫 function,實際涵蓋【表 / view / 函式】三者** —— 找建表注意事項的人不要因為檔名走開。**新建任何 DB 物件之前讀**:新物件出生就自帶 `anon` 權限(表是整套寫權含 `TRUNCATE`、函式是 `EXECUTE`),而**那個授權在 repo 裡沒有 `GRANT` 語句可以被掃到、三綠也不會紅**。含兩道 REVOKE、`TRUNCATE` 不受 RLS 管、`has_*_privilege` 對欄級授權少報、ACL 欄是 `NULL` 時 PUBLIC 看不見、改參數型別會多出一支而舊的不會消失 |

---

## 與其他文件關係

- 想知道「為什麼有這條規則」→ `docs/lessons-learned.md`
- 想知道「具體怎麼做」→ 本目錄
- 想看執行清單/鐵則→ `CLAUDE.md`(Codex 對應 `AGENTS.md`)
- 想看拍板紀錄 → `docs/decisions/`

## 衝突仲裁

- **`stalled-line-triage.md`** —— 一條線停住了,先分型再動手。
  **觸發時機不是情境是【時刻】:在你說「那要開線」之前。**
  三型:甲沒有落點 / 乙結論住錯地方 / 丙照拍板在等;**丙型誤判 = 推翻當事人自己的拍板**。

`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > `CLAUDE.md` > `docs/decisions/` > `patterns/` > 其他 md > 對話歷史。

— END —

---

## 🔴 「量具會騙人」這一族的單一入口(2026-08-18 W8 建;本節只放指標,不放內容)

這一族的東西**散在四個地方**,而它們互相引用。**接手的人從這裡進去,不要各找各的:**

| 你手上的問題 | 去哪 |
|---|---|
| 我要下一個「零命中 / 沒有 / 不存在」的斷言 | `guard-and-instrument-traps.md` §恆綠格 + §「附了量法,而量錯東西」 |
| 我看到一個紅,而它好像一直都紅 | `guard-and-instrument-traps.md` §恆紅(恆綠的對稱另一半) |
| 我要派一個掃描 / 盤點 / 找「還沒做的事」 | memory `feedback_would-this-sweep-find-the-known-case`(**十二種形狀**在那裡) |
| 我要發一個 backlog 號 | `bash scripts/next-backlog-number.sh`(**它每次都印**錨定與別名兩條紀律)<br>+ `python3 scripts/backlog-duplicate-scan.py --search <症狀詞>`(**這件事已經有號了嗎**)<br>🔴 **+ 再跑一發,問【另一個】問題**:`python3 scripts/backlog-duplicate-scan.py --search <你這條要動的檔名或函式名>`<br>**⇒ 「還有誰指著同一支檔?」** 有 ⇒ 兩條可能是同一行 code,**「依賴:無」就不能寫**。<br>為什麼要多這一發:`#278`(2026-07-16 立案,寫「依賴:無」)與 `#659`(2026-08-18 立案)**指的是同一支 `listSummariesByCustomer` 的同一道 `.neq`** —— 而那句「無」**寫的當下是真的**,是世界後來長出了那條依賴。**寫的人再仔細也預測不到三十三天後開的條目** ⇒ 只有**開新條目的那一刻反向掃**攔得住。(`#659` 的作者就是這樣撈到 `#278` 的。) |
| 我要找「code 還在指望、而沒人在追」的缺口 | `bash scripts/orphan-code-refs.sh`(檔頭有已知案例測試與**盲區輸出**) |
| 我要判一棵 worktree 有沒有人 / 要清樹 | memory `reference_worktree-ownership-is-not-readable-from-git-state` |
| 某個窗靜了,我要判它是不是停了 | memory `feedback_a-finished-turn-is-indistinguishable-from-waiting`(**門檻 5 分鐘,量出來的**) |
| 我要開一個新窗 / 寫派工單 | `bash scripts/window-standing-actions.sh`(**常設動作 11 條,從 runbook 產出、不要手抄**)<br>為什麼:memory `feedback_a-correct-runbook-cannot-survive-a-dispatch-sheet-that-omits-it` |
| 我要照一條既有規矩做事,而隊形/環境跟它寫下來時不一樣了 | memory `feedback_a-rule-does-not-know-its-premise-vanished`<br>判別句:**這條規矩成立的【前提】是什麼?那個前提今天還在嗎?** |
| 🔴 **我正要把一條 backlog 標成 `✅`** | **先答一句：我做的是【全部】，還是【其中一半而另一半刻意不做】？**<br>是後者 ⇒ **狀態欄要把「沒做的那一半」寫出來**（既有正確範例：`#338`「已修（做 ① **不做 ②**）」、`#486`「乙案 —— **不做彈出選單**」）<br>+ 跑一發 `python3 scripts/backlog-duplicate-scan.py --search <你沒做的那一半的關鍵詞>` ⇒ **有人在等那一半嗎？**<br>🔴 **為什麼**：`✅` 這一個字元在承載**三種**世界 —— ①做完了 ②**決定不做** ③**做了一半而那一半是刻意的**。<br>下游若依賴的是**沒做的那一半**，它會**永遠被靜默擋住** —— 因為任何自動比對看到 `✅` 都判「前置已滿足」。<br>（2026-08-19 實掃：狀態值開頭 `✅` 的 **142** 條裡，三種混在一起的有 **3** 條；當時真有下游的只有 `#217`→`#240` 一條，**已修**。而那兩條的下游是零 = **運氣，不是機制**。）<br>📌 對稱的另一半在上面那列（**發號**時反向掃「還有誰指著同一支檔」）。 |
| 我正要把一個題目端給 Sean | memory `feedback_look-for-the-path-that-dissolves-the-question`<br>先查有沒有一條路讓這題不成立(例:有不碰 PII 的做法 ⇒ 那不是拍板題,是還沒查) |

> ## 🔴 這張表要怎麼加一列 —— **判斷「哪一列會被讀到」的依據**
>
> (2026-08-19 主視窗要求寫下來:**下一個人需要的不是結論,是判斷的依據**。)
>
> ```
> 1. 先問【誰做得到這件檢查】，不是【誰該知道這件事】。
>    受害的多半是【下游的讀者】，而他手上沒有材料；
>    做得到的是【當下那個人】——「我做了一半」只有他知道。
>    ⇒ 所以規矩要放在【他那一刻】，不是放在受害者那一刻。
> 2. 再問【那一刻他腦子裡的問句是什麼】，用那句話當這一列的標題。
>    ⇒ 本表的列標題全部是第一人稱的「我要…／我正要…」，那不是文風，是索引鍵。
> 3. 最後問【他本來就會打開這裡嗎】。
>    ⇒ 不會 ⇒ 換地方，不要靠「他應該要記得來查」。
> ```
> ⚠️ **而這一列有一個已知的不足,寫下來免得被當成解決了**:
> 真正最會被讀到的落點是 **`CLAUDE.md` 的「slice 結束前」自檢清單**(每次收工都走一遍),
> 而那份檔屬 **Sean 拍板範圍**(`~/.claude/rules/00-work-rules.md` §4 權限分級:CLAUDE.md 本體要先問)。
> ⇒ **本列是【我改得動的那個次佳位置】,不是最佳位置。** 要升級,是 Sean 的一句話。
>
> 📎 而「教訓要有第二個落點、而形狀是清單不是提醒」的全文在
> memory `feedback_the-lesson-lives-where-it-is-not-needed`。

**這一族共用一句話**:

> **附量法只擋得掉「沒有數」;要擋「數錯東西」,必須另放一條【它應該要命中】的樣本,
> 而那個樣本要獨立於你正在數的東西。**

📎 而兩條**跨窗結構**的東西不屬技術族,單獨記在這裡免得被當成量具問題:
1. **共用資源的清單本身沒有人在維護** —— 已知**五張**(埠登記 / worktree 認領 / playwright 快取 /
   **主樹 `pnpm build` 鎖**(`⨯ Another next build process is already running.` ⇒ **那是無效量測,不是綠也不是紅**)/
   🔴 **主樹 `git index`**(最隱形:**git 什麼都不說**,別窗 `git add` 的檔會被你 commit 走
   ⇒ `git commit -F <訊息檔> -- <明確路徑>` 繞過索引)),
   而**五張裡四張有當天的撞車證據**(埠那張未查,**所以不寫「全部」**);
   playwright 那張**在它咬人之前沒有一個人知道它是共用的**。
   🔴 真正的缺口是**「新增共用資源時誰負責登記?」目前答案是沒有人、靠撞**。
   全表與部分解在 memory `reference_shared-resources-across-windows`。
2. **窗做完一件、回合結束,它就「不在」了** —— 而「不在」跟「在等人」長得一樣。
   自律只縮短那道縫,**偵測必須是外部的**。
