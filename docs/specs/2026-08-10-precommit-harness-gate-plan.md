# pre-commit 掛 DB harness 守門片 — ⛔ **本片已押後(2026-08-10);本檔留作重啟規格**

> 🔴 **狀態:押後**。關卡1 **兩輪皆 FAIL**(R1 6 MF / R2 8 MF),主視窗裁 `P-309` §4=A。
> 押後的理由**不是難度,是優先序**:本片是錢面全卡時的補位工作,而它需要的工程量
> (index 匯出到拋棄式目錄、並行矩陣、離場碼傳播驗證)已明顯超過補位規模;
> Sean 的錢面拍板一回來,L5a-2 / L5b 才是主線。
>
> ## ⭐ 重啟時的第一條(最致命,先修這個)
> 🔴 **helper 的 `exit 1` 會被 `lint-staged` 的成功碼蓋掉**:`.husky/pre-commit` 在呼叫我的 helper
> 之後還有一行 `pnpm exec lint-staged`。若呼叫端沒寫成 `sh .husky/db-harness-gate.sh || exit $?`,
> 整片會變成「**看起來擋了、其實沒擋**」—— 正是本片存在要防的東西,而它會發生在本片自己身上。
>
> ## ⭐ 其餘未折的(R2 八條擇要)
> - **index 錯位沒根治**:v2 只擋 migration 的 staged/unstaged 錯位,但 harness 自己與其他測試輸入
>   仍可能錯位而假綠。真解=**從 index 匯出到拋棄式目錄執行**,不要動共享工作樹。
> - **「stage 或 stash」是壞建議**:stage 會把無關改動混進 commit,普通 stash 不含 untracked 檔。
> - **並行實測不足**:只證了「兩份 l5am 同跑」,證不到 l5a1 自身並行、l5am×l5a1 交叉、四 gate 實例。
> - **八格仍不合「每條都有確定性突變」**:T2 無突變、T1 只看延遲不是會紅的 oracle、
>   `sh -n` 證不到 POSIX 相容。
> - **v2 §5-6 的清理指示已更正**(見下方 🔴 兩條危險指示)。
>
> ## 🔴 兩條「我寫了、照做會出事」的指示(同一天內第二次;共同形狀值得進 lessons)
> 1. **L5a-1 誠實邊界 7**(已 apply 的 migration 內):寫「apply 前跑本段的**原字面 SELECT**」——
>    但那段是 **DO block 不是 SELECT**,且 `::regprocedure` 在函式未建時**必炸**。
>    ⇒ 照字面做會撞 `function does not exist`,並**誤判成守門異常**。已掛 backlog **#368**。
> 2. **本檔 v2 §5-6**:寫「`pkill -f l5a` 與 `rm -rf /tmp/l5a*` 是安全的清理手段」——
>    **不安全**:四窗並行時會殺掉/刪掉**其他窗正在跑的 harness**($ROOT 同樣長 `/tmp/l5a*`)。
>    ⇒ 只能用**該次執行自己的 PID 與已驗證的 `$ROOT`**,且先確認程序已停。
>
> 🔴 **共同形狀(這才是要記住的)**:兩次都是我在寫「**給別人照做的步驟**」,
> 而**沒有把自己放到讀者的處境去實際跑一遍**。兩次都不是知識不足,是**沒有換位執行**。
> 檢查法:任何寫給別人照做的指令,落筆前先問「我現在照這行貼下去,會發生什麼」。

---

# (以下為押後前的 plan v2 全文,保留供追線)

> **v2 = 依 codex 關卡1 FAIL(6 must-fix + 1 nit)改寫**;其中一條由**實測推翻**、一條是真假綠(見 §8)。

> P 窗 / 2026-08-10。主視窗核准(`P-307` D 案 → `P-308` 更正後**維持核准、理由換成正確版**)。
> 片型=**高風險片**(鐵則 12 ④平台設定:動 `.husky/`)。
> 流程:plan → 關卡1 codex 一輪 → 實作 → **凍結不 commit** → 主視窗代跑審查 → marker → commit。
> ⚠️ 不急;錢面拍板一回來優先切回。

---

## 0. 設計原則(兩條,都是主視窗指定寫進檔頭)

> 🔴 **一、沒被突變驗過的守門,正是假綠本身。**
> 一道沒有人證明過「它真的會紅」的守門,比沒有守門更危險——因為它讓人以為守著了。
> ⇒ 本片每一條斷言都要有**確定性突變**證明它會紅,證據留存。
>
> 🔴 **二、它擋的是「忘了跑」,不是「想繞」。**
> `git commit --no-verify` 與 `HUSKY=0` **繞得掉**(`.husky/reviewer-gate.sh:5-6` 逐字自陳)。
> 本片不假裝防偽。它與 `reviewer-gate` 同型(Sean 2026-08-04 拍板採用的哲學),
> 而今天要防的洞——**43 支 harness 全靠人記得跑**——恰好就是「忘了」那一類。
> ⇒ **D(pre-commit)與 CI 不是替代關係**:CI 才是伺服器端、繞不掉的那一層,**列為後續**
> (它需要 required workflow 與 GitHub 設定,屬 Sean 的操作面,不在 repo 內)。

### 0b. 一條我自己講錯、已更正的(留著防後人引用錯版本)
我在 `P-307` 曾宣稱「pre-commit 已經擋得住 `--no-verify`、是 repo 現有最強執行點」。**那是錯的。**
今天擋下我的是 **Claude Code 自己的 hook**(攔的是 AI 送出的命令字串,只管 AI session、不在 repo 裡),
不是 git hook。⇒ **「我繞不掉」不等於「它擋得住」**。更正見 `P-308-STOP`。

---

## 1. 問題

同一個機制缺口今天被指出三次(`P-295` 掛帳的 `SOLE-WRITER`/`ACL-UNIVERSAL`、
L5a-1 新增的可呼面十一格、codex 在 resolver 片指出的 `ORDERBY-EQUIV`)——
全是「**人記得跑才有效**」。`機制優先律`:機制做得到就別寫規則文字。這裡做得到。

## 2. 實測成本(本機 macOS / PG 17.10)

| harness | `real` | 斷言數 |
|---|---|---|
| `scripts/l5am-verify.sh` | **4.71 秒** | 28 |
| `scripts/l5a1-verify.sh` | **8.84 秒** | 58 |
| 合計 | **約 14 秒** | 86 |

⚠️ 這是**開發者本機**的數字,而 pre-commit 就在本機跑 ⇒ **這個數字直接適用**
(不像 CI 案還要換算 runner 差異)。14 秒只在**動到 migrations 的 commit** 上付。

## 3. 要做什麼(v2 改寫)

🔴 **抽成獨立檔** `.husky/db-harness-gate.sh`(codex nit):`.husky/pre-commit` 只留一行呼叫。
好處:可 `sh -n` 語法檢、可獨立手動跑、可單獨測,不用每次靠 commit 才驗得到。

### 3a. 觸發判定(codex MF1)
用 **pathspec** 而非 `--name-only` 字串比對:
```sh
git diff --cached --quiet -- supabase/migrations/
# 離場碼:0 = 沒動到 → 略過;1 = 有動到 → 執行;>1 = 判定本身失敗 → 🔴 擋 commit
```
理由:`--name-only` 對「rename 到目錄外」、含換行的路徑、`core.quotePath` 引號化的非 ASCII 路徑
會漏判或誤判;pathspec 交給 git 自己判,且 `>1` 明確走 fail-closed(v1 沒有這一格)。

### 3b. 🔴 index vs working tree —— v1 的真假綠(codex MF2,本片最重要的一條)
**v1 會 ship 一個假綠**:觸發判定看的是 **index**,但 harness 跑的是 **working tree**。
⇒ staged 的是 migration A、working tree 另有未 staged 的 B ⇒ **harness 對 B 跑綠、commit 的卻是 A**。
這正是本片存在的理由(防假綠)的反面教材。

修法(取最便宜且 fail-closed 的):**判定為相關時,若 `supabase/migrations/` 底下存在
「已修改但未 staged」或「untracked」的檔案 ⇒ 擋 commit**,並印明話要求先 stage 或 stash。
```sh
git diff --quiet -- supabase/migrations/            # working tree vs index,非 0 = 有未 staged 改動
git ls-files --others --exclude-standard -- supabase/migrations/   # 非空 = 有 untracked
```
⚠️ 不採「從 index 建暫存快照再跑」:那要 `git stash --keep-index` 或另建 worktree,
在 hook 裡失敗的後果是**動到使用者的工作區**,風險大於收益。**擋下來要求人先整理**比較誠實。

### 3c. POSIX 與離場碼(codex MF3)
- 既有 `.husky/pre-commit` 用 **`sh`** 跑 ⇒ 本段**只用 POSIX sh**:禁 `[[ ]]`、陣列、`PIPESTATUS`。
- **不靠 `set -e`**(它會讓第一支紅之後直接離場、第二支根本沒跑):
  ```sh
  failed=0
  if bash scripts/l5am-verify.sh; then :; else failed=1; fi
  if bash scripts/l5a1-verify.sh; then :; else failed=1; fi
  [ "$failed" -eq 0 ] || exit 1
  ```
- 🔴 v1 §3-3 寫「或至少可辨識它沒跑」是**留退路**,codex 要求刪掉 ⇒ **已刪**:
  兩支都必須被呼叫、都必須有結果。

### 3d. fail-closed 清單(主視窗條件①)
判定為相關之後,以下任一 ⇒ **擋 commit + 印明話**,不得靜默放行:
`initdb`/`pg_ctl` 不在 PATH / harness 檔不存在 / harness 非零離場 /
§3a 判定離場碼 >1 / §3b 有未 staged 或 untracked 的 migration。

**不做**:不動既有 reviewer-gate 那段(主視窗裁 A,其 soft-skip 立 backlog **#366**)、
不動 lint-staged、不碰 CI、不掛其餘 41 支。

## 4. 驗收(每條都要確定性突變)

| 格 | 斷言 | 確定性突變 |
|---|---|---|
| T1 觸發面 | 只改 `*.md` 的 commit ⇒ **不跑** harness、零延遲 | 改成也跑 ⇒ 應觀察到 14 秒延遲 |
| T2 觸發面 | staged 含 `supabase/migrations/**` ⇒ **有跑** | — |
| T3 harness 紅 ⇒ 擋 commit | 在 `l5am-verify.sh` 尾植入 `exit 97` ⇒ **commit 被擋** | 這就是突變本身 |
| T4 工具不在 ⇒ 擋 | `PATH` 移除 `initdb` ⇒ **commit 被擋**、印明話 | 這就是突變本身 |
| T5 harness 檔不見 ⇒ 擋 | 暫時改名 ⇒ **commit 被擋**(不得放行) | 這就是突變本身 |
| T6 兩支獨立 | 第一支紅時,**第二支仍被呼叫且有結果**(輸出裡兩支的結論都在) | 讓第一支 `exit 97`,斷言輸出仍含第二支的結論行 |

🔴 T3-T5 **全部在本機可跑、不需要 push**——這正是 D 案取代 CI 案的核心理由。
🔴 每發突變都要記錄「擋下時的實際輸出」,不能只記「有擋」。
🔴 **突變一律在拋棄式 worktree 內做,不動共享工作樹**(codex MF5):
   直接對共享樹植入 `exit 97` 再還原,遇到 Ctrl-C / 另一視窗同時編輯就可能還原失敗、
   把突變帶進後續 commit。做法:`git worktree add` 一個暫時的、在裡面突變、驗完整個丟掉。
   若真的不得不動原檔:先存 baseline `shasum`、設 trap、還原後**用 hash 驗證回復**才准 commit。
🔴 新增 **T7**:`sh -n .husky/db-harness-gate.sh` 語法檢必過(POSIX 相容,§3c)。
🔴 新增 **T8**:未 staged / untracked migration 存在時 ⇒ **擋 commit**(§3b 那條假綠的守門)。

## 5. 誠實邊界

1. 🔴 **只擋本機 commit**。別人在別台機器、或直接在 GitHub 網頁改檔,擋不到;
   `--no-verify` / `HUSKY=0` 也繞得掉(§0 原則二)。**本片不宣稱防偽。**
2. §3a 的「不相關就略過」**不是** soft-skip:soft-skip 指的是「判定為相關、卻因為前置缺失而靜默放行」。
   前者是範圍,後者是失效。兩者在 plan 裡不得混用同一個詞。
   🔴 **但這個區分只在下述三條都被處理之後才站得住**(codex MF6):
   ①觸發判定改用 pathspec 且 `>1` fail-closed(§3a);②index/working-tree 錯位已擋(§3b);
   ③多視窗並行的 PG 副作用已驗(§5-6)。v1 在三條都沒處理時就宣稱那個區分,**太早**。
3. 既有 `.husky/pre-commit` 對 `reviewer-gate.sh` **檔案不見就照樣放行**,與本片原則相反。
   **本片不動它**(超片界),立 backlog #366;我的段落自己 fail-closed。
4. 只掛 2 支 ⇒ 其餘 41 支仍靠人記得跑。本片**不宣稱**解決那個缺口,只在最貴的兩支上立起形狀。
5. 14 秒是**本機實測**;不同機器會有差異,但同一數量級。
6. 🔴 **多視窗並行:實測不互撞**(codex MF4 的擔憂,由實測推翻)——
   同時跑兩份 `l5am-verify.sh`(**兩者都用同一個 port 號 54431**)結果 **rc 皆 0、各自綠**。
   原因:`pg_ctl -o "-c listen_addresses="` 是**空值 ⇒ 不開 TCP listener**,
   port 號只是 `$SOCK/.s.PGSQL.54431` 這個 **socket 檔名**的一部分,而 `$SOCK` 在各自的
   `mktemp -d` 唯一目錄內(`l5am:39,:42,:93` / `l5a1:26,:29,:63`)⇒ 結構上不可能互撞。
   ⚠️ **仍存在的**:harness 的 teardown 掛在 `trap EXIT`,**SIGKILL 殺不到 trap** ⇒
   極端情況會留下 postmaster 與 `/tmp/l5a*` 目錄。這條不是本片引入的,但本片會提高它的發生頻率
   ⇒ 🔴 **更正(原本這裡寫 `pkill -f l5a` / `rm -rf /tmp/l5a*` 是安全的 —— 那是錯的)**:
   四窗並行時那兩條會殺掉/刪掉**別窗正在跑的** harness。正確清理=只用**該次執行自己的 PID**
   與**已驗證的 `$ROOT` 路徑**,且先確認程序已停止;知會信要寫這個版本。

## 6. 體積
兩個檔(`.husky/pre-commit` 一行呼叫 + 新增 `.husky/db-harness-gate.sh`)+ **八格驗收**。符合鐵則 4。

## 7. 落地時要做的(主視窗條件③)
🔴 **發全窗知會信**:這改動每個窗的 commit 路徑 —— B / D / E 三窗要知道
「動到 `supabase/migrations/**` 的 commit 會多 14 秒」、「紅了長什麼樣、怎麼看」,
以及 🔴「**migrations 底下有未 staged 或 untracked 檔時會被擋**,要先 stage 或 stash」(§3b)——
最後這條會改變他們的既有習慣,不講清楚會被當成 bug。
