# 四綠 RUN-CONTEXT 比較表 —— 一天四發，四個不同的紅因

> 建檔 2026-08-18 W1（dev 守門）。主視窗指定，理由逐字：
> **「今天三發四綠、三個不同的失敗原因，而每一次都是靠當下那幾個數字才定得了案。這張表讓下一個人不必重新發明那套判讀。」**
>
> 🔴 **這張表的用途不是留紀錄，是【讓下一個看到四綠紅了的人，五秒內知道要不要去讀 diff】。**
>
> ⚠️ **資料量：本機 6 發 + CI 1 發 = 7 筆**（`grep -c '^| [0-9—]' <本檔>` ⇒ **7**，2026-08-18 13:3x G1 重數）。**未做統計、樣本未達可推論規模。**
> 🔴 **建檔當天這一行寫「共 5 筆」，而它自己附的那條命令當時就回 6** —— 表格有五列編號 + 一列 CI。
>   量法(可重跑)：`git show 5ae39275:docs/patterns/four-greens-run-context-table.md | grep -c '^| [0-9—]'` ⇒ **6**。
>   ⇒ **一個附了量法的數字，仍然可以是用手數的**：量法附在旁邊，不等於那個數字是它印出來的。
>   (2026-08-18 G1 加第 6 發時撞到；`grep -c` 是這一行唯一的真值來源，人數的那個不是。)

---

## 一、當天四發（同一台機器、同一個人、一個上午）

| # | 時點 | commit | 四項 rc | vitest | 起跑 load(1m) | 判定 |
|---|---|---|---|---|---|---|
| 1 | 10:05–10:19 | `3c48e938` | 0/0/0/**0** | `521 passed \| 1 skipped (522)` | 未記（手打，沒跑腳本） | 🟢 綠 |
| 2 | 10:17–10:21 | `afd3e78e` | 0/0/0/**1** | `2 failed \| 8657 passed` | **37 → 214.78** | 🔴 **負載**（我自己造的） |
| 3 | 10:25 單跑 vitest | `afd3e78e` | —/—/—/**1** | `4 failed \| 518 passed (523)` | ~11 | 🔴 **環境**（缺 playwright 瀏覽器） |
| 4 | 10:33–10:35 | `afd3e78e` | 0/0/0/**0** | `8659 passed (8664)` | 6.88 | 🟢 綠 |
| 5 | 10:58–11:00 | `6dcaf0d1` | 0/0/0/**0** | `8659 passed (8664)` | 12.82 | 🟢 綠 |
| — | 11:07（CI，非本機） | `a482b428` | Test **failure** | `2 failed \| 520 passed (523)` | n/a | 🔴 **CI 少一步 build** |
| 6 | 13:23–13:25 | `52d83440` | 0/0/0/**0** | `523 passed \| 1 skipped (524)` / `8683 passed (8688)` | **127.34 → 157.20**、vitest 期間 run queue 中位 **66** / 最大 **87** | 🟢 綠 |

⚠️ **第 1 發沒有 load 數字，因為我手打四行、沒跑 `scripts/dev-four-greens.sh`。**
🔴 **沒有負載數字的「四綠紅了」，事後無法重新解讀 —— 那個數字五分鐘後就取不回來。**

### 🔴 第 6 發是第一個「高負載而全綠」的資料點 —— 它推翻不了負載假說,但限縮了它

**現場**:2026-08-18 13:23 G1 在拋棄式鑽機 `/Users/sean_1/pcm-g1-fg1`(detached @ `52d83440`,無 `.env.local`)
跑收割後的驗證發。機器 13:10 才開機,Spotlight(`mds_stores`)與 Time Machine(`backupd`)都在跑。

```
load average 開始 127.34 / vitest 起跑前 121.16 / 結束 157.20
vitest 期間 run queue  n=84 最大=87 p95=82 中位=66 最小=37
四項 rc                0 / 0 / 0 / 0
timed out 命中          0（量法 grep -c 'timed out' <四支 *.full.log> ⇒ 0 0 0 0）
```

🔴 **值得記的是這一句**:第 2 發 load 214 造成 2 格 timeout 假紅,而本發 load 121–157 **一格都沒有**。
⇒ ~~「load 高就會假紅」~~ **太寬**。已知成立的是:**214 會、157 不會**;
   中間那一段**沒有資料**,而 `b489c52f`(容差拉到 30s)之後這條界線可能已經整個移動。
⚠️ **這是一個資料點,不是門檻。** 不要拿它去寫「load < 160 可以放心跑」。

### 🔴 而 `rc=0` 那四個 0 的旁邊,`build.full.log` 有 **162 行** `not set`

```
grep -o '[A-Z_]* not set' build.full.log | sort | uniq -c
  81 NEXT_PUBLIC_SUPABASE_URL not set
  81  not set          （同一則錯誤的第二行:throw new Error(`${name} not set`)）
樣本 :66  [fetchCatalogPage] search_catalog_by_vehicle failed: Error: NEXT_PUBLIC_SUPABASE_URL not set
```

**81 這個數字與 W1 2026-08-18 上午在三份 build log 各量到的 81 一模一樣**
(來源:`~/pcm-mailbox/W1-003-STOP-20260818.md` §③,我開檔讀的)。
⇒ 🔴 **這是【零 env 環境的穩定性質】,不是這次收割帶進來的迴歸** ——
   而它同時是那一課的正向對照:**同一個數字在兩次獨立量測裡重現,所以它不是雜訊;
   但它從頭到尾都伴隨 `rc=0`,所以 `rc=0` 從頭到尾就沒有在回答這件事。**
📎 引用限度:81 只證「這兩次的 zero-env build 各失敗 81 次」,**不證** CI 那一份也是 81
   —— CI 我沒量,標未確認。

---

## 二、五種紅，五個判別法（照順序問，命中就停）

```
① 錯訊息是 `Test timed out in Nms`
   ⇒ 【負載】，不是 code。單獨重跑那幾支；綠 ⇒ 放行。
   實例：#2（load 214，我一邊跑四綠一邊 remove 12 棵工作樹）
   ⚠️ 2026-08-18 已把 check-syntax-nonts.gate.test.ts 的容差拉到 30s（b489c52f），
      這一族應該少很多；再出現代表是【別的】格子。

② 錯訊息是 `Executable doesn't exist at .../ms-playwright/...`
   ⇒ 【環境】，機器上的瀏覽器不見了。修法**不要**用 `pnpm exec playwright install`
      （它裝 1217、測試要 1223，裝完照樣紅），用：
      node node_modules/.pnpm/playwright@<版本>/node_modules/playwright/cli.js install chromium
   實例：#3。成因見 memory `feedback_cleanup-breaks-the-next-verification`

③ 錯訊息含「找不到建置產物」/「編譯後 CSS（掃到 0 支）」
   ⇒ 【順序】，還沒 build 就跑了測試。本機跑 `dev-four-greens.sh` 不會發生（它先 build）；
      **CI 會**，因為 ci.yml 沒有 build 步驟（2026-08-18 提案修正中）。
   實例：CI run 32094343674

④ 錯訊息是 `⨯ Another next build process is already running.`
   ⇒ 【build 鎖】。另一個 build 正在跑,你這一發是**無效量測** —— 不是綠也不是紅。
   🔴 它長得跟真的 build 失敗**一模一樣**(`rc=1`、`Tasks: 0 successful`),差別只在那一行字。
   ⇒ **等,不要重跑三次** —— 三次都會紅,而且紅得一模一樣。
   實例:W6(主樹)、W5(自己的 worktree)2026-08-18 各一次。
   🔴 **鎖的範圍比「同一棵樹」寬**:W5 是在【自己的 worktree】撞到的
      ⇒ ~~「各自的 `.next` 不相干所以不會撞」~~ 已被兩個獨立來源推翻。
      ⚠️ **而實際範圍沒有人量到** —— 只知道它比「同一棵樹」寬,**不宣稱它是全機一把鎖**。
   ⚠️ 前置檢查 `pgrep -f "next build"` **本身也會騙人**:W5 命中 1 筆,而那筆是
      另一個窗**背景喚醒命令裡的提醒文字**(裡面剛好有 `next build` 這幾個字)。
      W5 原話:**「我是在查『有沒有人在 build』時,撈到一張寫著『記得查有沒有人在 build』的紙條。」**
      ⇒ **命中之後開出來看那一行是什麼,不要看數量。**

⑤ 錯訊息是 `AssertionError` / `expected … to …`
   ⇒ 🔴 這一種才去讀 diff。
   ⚠️ 【當天我這邊零實例】—— ①②③④ 各有實例（④ 是 W6/W5 撞的，不是我），⑤ 我當天沒遇過。**⑤ 是照排除法推的，不是量到的。**
```

---

## 三、🔴 定案的手法（今天用了兩次，兩次都定了案）

**同一顆 commit 跑兩次，結果不同 ⇒ 不是程式。**

```
負載那次：afd3e78e @ load 214 ⇒ 2 failed  ／ 同一顆 @ load 11 ⇒ 那兩格綠
環境那次：afd3e78e 10:19 ⇒ 521 passed ／ 同一顆 10:25 ⇒ 518 passed + 4 failed
          518 + 4 = 522，數字對得起來 ⇒ 是那 4 支從 passed 移到 failed，不是別的東西變了
```

⚠️ **反過來不成立**：同一顆跑兩次都紅，**不證明**它是 code 問題（環境可能兩次都壞）。
這個手法只能**證偽**「是 code」，不能證實。

---

## 四、起跑門檻（2026-08-18 主視窗裁定，附限定）

```
門檻 ＝ RUN-CONTEXT 的「全樹並行四綠 vitest 數」為 0
⚠️ 它只看得到跑【新版腳本】的窗；舊 checkout 對它隱形
   ⇒ 0 是【下限成立】不是【保證沒人在跑】
⇒ 真要確定，加一句人工的：開跑前在窗群喊一聲「我要跑四綠了」
load 降級為附在旁邊的參考值
```

🔴 **為什麼 load 不當門檻**：W7 2026-08-18 量到機器上吃 CPU 的前幾名是
VS Code Helper(Renderer) 42.1% / WindowServer 13.6% / VS Code Helper(gpu) 11.9%，
**八個 claude session 自己只佔個位數**，外加 Time Machine 在跑。
⇒ **「等 load < 15」等的是一個我們自己撐在上面的數字，它可能永遠不會掉下來。**
⚠️ W7 自己標的限度要一起帶：「我量的是各程序的 `%cpu` 與 `etime`，**我沒有證明是誰把 load average 推上去的**。
macOS 的 load 同時算 CPU 可執行與 I/O 阻塞 ⇒ Time Machine 那半可能被低估、VS Code 那半可能被高估。」

---

## 四-b 🔴 起跑前先確認沒有別人在 build（W6 2026-08-18 實撞）

```
pgrep -fl 'next build'
```
**同一棵主樹上兩個窗同時 `pnpm build` 會互斥**，Next 印 `⨯ Another next build process is already running.`
⇒ 那一發是**無效量測**（不是綠也不是紅）—— 🔴 **而「無效」與「紅」在 rc 上長得一樣**，不先看訊息會被記成迴歸。

📌 另一條同源的（W6 打回我的）：**`TURBO_FORCE=1` 只繞過 turbo 的快取，繞不過 Next 自己的 `.next/cache`。**
⇒ 連跑同一棵樹的 build 時間會一路下降（我當天 43.173 → 18.31 → 14.706 → 8.175s），
**那條下降曲線不是機器變快，是快取在生效** ⇒ **拿它去估 CI（永遠冷 checkout）會低估。**

---

## 五、跑四綠的人自己要遵守的兩條（都是當天踩出來的）

1. 🔴 **四綠跑的時候不做任何別的重活。** 實例 #2：我一邊跑一邊刪 12 棵工作樹 ⇒ load 214 ⇒ 那一發整個作廢。
2. 🔴 **驗證動作本身有外部性。** 這台機器八個窗共用一切（CPU / playwright 瀏覽器快取 / git index）。
   當天實際發生的取捨：**為了證明「負載會造成假紅」而製造負載，很可能當場害別的窗吃一個假紅。** ⇒ 沒做，改用兩段各自乾淨的因果。

---

## 六、本表的射程限定（不要放大）

- 🔴 **本機四綠對「CI 會不會過」沒有判別力** —— 兩邊順序不同。
  量法：`grep -cE 'pnpm build|turbo run build' .github/workflows/ci.yml` ⇒ **0**；
  正向對照（證明尺對這個檔量得到）：`grep -c 'run:' .github/workflows/ci.yml` ⇒ **7**。
  本機順序見 `scripts/dev-four-greens.sh`（typecheck → lint → **build** → vitest）。
  ⇒ 在 CI 那個順序被修好之前，這條一直成立。
- 🔴 **CI 綠也不證線上那份是對的** —— CI 自己建的產物 ≠ Vercel 部署的那份（codex 2026-08-18 R1 F1）。
- **本表只有一天的資料（四發 + 一發 CI）。** 判別法 ①②③ 各只有一個實例；④ 當天**零實例**（當天沒有任何一發是真的 `AssertionError`）。
  ⇒ **這是一張起手表，不是統計。** 下一個人撞到新形狀，請往「二、」加一列並附實例。
