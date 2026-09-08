# 自檢清單病史簿(checklist-casebook)
> 🔴 **2026-09-02 從 `CLAUDE.md`「快速自檢清單」節【原封搬過來】—— 一個字都沒刪、沒改寫。**
> 成因:那 25 格勾選裡有幾格各自帶著一整段實錘(selftest git 隔離、marker 順序、literal-sweep),
> 合計 2,873 字元 —— 而**勾選本身**只佔約三成。
>
> 🎯 **`CLAUDE.md` 留 25 格勾選;每一格「為什麼有這一格」住這裡。**
>
> 🛑 **這個檔在什麼情況下會【變成假的】**:
> 當某一格勾選被增刪或改字面、而本檔沒跟著改的那一天(而本檔不會知道)。
> ⇒ 引用前先回 `CLAUDE.md` 數一次現在有幾格;格數對不上 ⇒ 本檔整份待驗。

---
## 原文(逐字)

**slice 開工前**:☐ 起手檢查綠 ☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD)☐ 標片型 ☐ 判鐵則 8(是則先提 plan 等批)☐ 涉錢/權限/schema・migration/平台設定/對外發送/共用元件行為 → 逐字過鐵則 12 六類清單(硬清單、不憑自評)☐ 偵察 pass(標準片以上)☐ **報片數/片界前先開母 plan §5.0 DAG 看上游;報 schema 行為前先開建表 migration 讀註解(契約債與交辦寫在那裡,查 `information_schema` 看不到);兩者在報告裡都要附 `檔案:行號`,附不出來=沒查**(詳 memory `feedback_assert-scope-only-after-reading-source-file`)☐ 估時 15-45 分鐘(超出拆)。🔴 ☐ **要新寫一支帶 `--selftest` 而且會碰 git 的腳本 ⇒ selftest 的【第一件事】是剝掉繼承來的 git 環境**(`GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE` / `GIT_OBJECT_DIRECTORY` / `GIT_ALTERNATE_OBJECT_DIRECTORIES` / `GIT_COMMON_DIR` / `GIT_NAMESPACE`)—— 🛑 **`git -C <路徑>` 擋不住它, 那兩顆 env 的優先權比 `-C` 高**。⇒ 2026-09-02 一夜【兩支新工具】各被 `scripts/selftest-git-isolation-gate.sh` 擋一次(`design-ref-check.sh` 受害者 `ls-files|status` 從 **1|0 變 4|6** · `what-happened-to.py` rc=1)。🔴 **而兩支在自己樹上手跑 selftest 都是綠的 —— 只有掛在 hook 底下才壞, 而那正是它會被跑的世界。**📌 ⇒ 「我本機 selftest 全過」與「它在真的被跑的環境裡是乾淨的」是兩個宣稱。🔵 用【一次剝乾淨】不要逐發包 `env -u`:逐點突變量到那道閘只覆蓋 6 個呼叫點裡的 **4** 個 ⇒ 一個只修對一半的修法在它底下仍然全綠。 🔵 **而它是【兩支,兩個作者,同一夜】不是一次巧合**(`-f3` 2026-09-02 補第二支的數字):`scripts/what-happened-to.py` 修前 **`rc=1` 且受害者 `1\|0 ⇒ 3\|4`**,修後 `rc=0` 且 `1\|0 / 1\|0`;🟢 **突變副本(只停掉剝環境那三行)仍然 `1\|0 ⇒ 3\|4`** ⇒ **證明是那個修法在擋,不是別的東西。**🛑 **而最毒的一格**:它**在自己的樹上手跑 `--selftest` 是全綠的**(`-f3` 跑過**四次**,四次都綠)⇒ 📌 **「我測過了」在這一族裡零判別力 —— 測試環境與受害環境的差別,就是那個病本身;而【同一把尺量四次,一致不是效度】。**🔵 **撞到症狀時的入口在路由表**(觸發情境寫成「**我新寫了一支帶 `--selftest` 的腳本,而它在我自己樹上跑是綠的**」)。
**slice 結束前**:☐ **寫一行心跳**(`bash scripts/heartbeat.sh …`)—— 🔴 **【窗在做事】與【窗停了】在主視窗那端是同一個訊號:什麼都沒有** ☐ 🔴 **順序:先 `git add`、【再】寫 reviewer 標記、才 commit**(Sean 2026-09-02 拍甲改字面;~~原本本清單把「寫標記」排在「精準 add」之前~~ 作廢)—— 🛑 **理由是量到的**:那個標記釘的是 **staged 樹的雜湊** ⇒ add 之前寫, 它釘到一棵【還沒有你的東西】的樹 ⇒ commit 當場被閘擋下(2026-09-02 線 `-fc` 實測:add 前 `staged=f4929253` / add 後 `staged=5df30c21` —— **兩個不同的雜湊**)。🔴 **而那道閘的訊息會把你推向錯的方向**:它最顯眼的第一段寫「你用了 `git commit -- <pathspec>` … **不要重寫第二次**」—— 而 `-fc` **沒有**用 pathspec, **而正解就是重寫第二次**;真正的解法寫在它輸出的更下面。📌 **⇒ 一道正確攔下你的閘, 用它最顯眼的那一段把你推向「不要做那個會解決問題的動作」。**⚠️ 而根因是**兩份文件都誠實而給相反的順序**:`write-reviewer-marker.sh` 自己的輸出寫「2026-08-30 起順序變了」, 而本清單沒跟著改 ⇒ **腳本改了, 常載清單沒改, 而只有腳本會執行。** ☐ **寫 reviewer 標記一律走 `bash scripts/write-reviewer-marker.sh "<片名+輪次或跳審理由>"`, 不要直接寫 `.git/`**(Sean 2026-08-29 拍「加」)—— 🔴 **實錘:有一個窗每一顆都直接寫, 而它說沒有人跟它講過**;⚠️ **而那道閘只驗「有沒有標記 + 釘不釘在當前 HEAD」, 不驗理由是不是真的** ⇒ **一個誠實的跳審理由與一個編的, 在它底下印同一個綠。** ☐ 肉眼驗(「肉眼驗✅」是 Sean 專屬用詞、Claude 只能寫程式驗)☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip)☐ **改過任何對外字面(註解/文案/plan/commit body/handoff)→ 拿舊字面跑 `bash scripts/literal-sweep.sh '<舊字面>'` 再 commit**(Sean 2026-08-15 拍板;那支工具四個施工窗都有卻零人使用,同夜「宣稱改好其實沒改」發生 5 次,通報後三個窗在自稱掃乾淨處又撈到東西)☐ 命中鐵則 12 → codex 對抗審查已跑、未 push ☐ 動前台元件 → 補/更新 smoke test(`*.test.tsx`)☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add、格式對 ☐ STATUS 7 欄更新(同 commit)☐ 收尾對帳(Sean 拍板逐條 vs 已落檔,漏的補寫 memory `project_*.md`)☐ busboy-end ☐ 不 push。(`/pcm-roadmap` 與 `/graphify --update` 不隨每 slice:milestone 收尾或每日收工跑一次即可。)
---

## 🔴 2026-09-08 `refund`:**順序句對「做兩次」失明** —— 同一格,新的失敗形狀

> 上面那格已經記過「順序:先 `git add`、再寫標記」的病史(2026-09-02 線 `-fc`)。
> **這一次照著做了,而照樣被擋** —— 因為那句話管的是**順序**,而真正的約束是**邊界**。

```
我的實際動作(每一步都合規):
  ① git add <3 支檔>
  ② bash scripts/write-reviewer-marker.sh "<片名>"      ← 順序正確
  ③ git commit                                          ← 被 state-gates 閘擋下(另一道)
  ④ 照那道閘的修法重產 docs/reference/order-state-gates.md
  ⑤ git add docs/reference/order-state-gates.md         ← 🛑 **第二次 add**
  ⑥ git commit                                          ← reviewer 標記閘擋下:釘的內容對不上
```

🔴 **判別句要換一句** —— 順序句擋不到這個:
```
⛔ 「先 git add、再寫標記、才 commit」      ← 描述【順序】, 對「add 了兩次」失明
✅ 「寫完標記之後不准再 git add」            ← 描述【邊界】, 而它擋得到
```
📌 **為什麼順序句必然漏**:標記釘的是 **staged 樹的雜湊**,而**任何一次 add 都會換那個雜湊**。
⇒ 約束的對象不是「哪一步在前」,是「標記之後那棵樹不准再動」。
⚠️ 而**兩道閘互相推**:第一道(state-gates)叫你去 `git add` 一支檔,而那個動作**正好作廢**第二道要的標記。
⇒ 🎯 **一道閘給的正確修法,會讓另一道閘紅。** 兩道各自都對,而**沒有任何一份文件講到它們的交互**。

### 🔵 順手記另一格:`state-gates-freshness-gate` 為什麼要 `--write` 而不是直接跑產生器

```
✅ sh .husky/state-gates-freshness-gate.sh --write     ← 讀【index 視圖】
⛔ bash scripts/state-gates.sh                          ← 讀【工作樹】
```
🔴 **七窗共用一棵樹** ⇒ 讀工作樹會把**別窗 untracked 的 migration** 一起掃進那張表
⇒ 你的 commit 會夾帶別人還沒交的東西,而 diff 上看起來只是「表更新了」。
⚠️ 而 `--write` 自己也會**覆寫工作樹那張表** —— 它印了一句提醒:若剛才 `git status` 顯示它是 `M`,
那可能是別窗的重產(2026-08-23 真實發生過一次)。**表是自動產生物、可隨時重跑,而通報一聲比較好。**

### 📌 這一片為什麼會撞上 state-gates:**我只加了註解**

那張表記的是「哪一支 migration 的哪一行在改 `payment_status`」⇒ **行號**。
而本片在 `20260901030000` 的函式體上方插了一段判準表註解 ⇒ 底下的碼整段往下推
⇒ 表裡 **3 個行號位移**(`:945→:990` · `:917→:962` · `:929→:974`)。
🎯 **行為零改動、三綠全綠,而一份自動產生的文件過期了** —— 那正是
`feedback_my-comment-only-diff-breaks-others-coordinates` 那一族,**而這次有機制在守。**
