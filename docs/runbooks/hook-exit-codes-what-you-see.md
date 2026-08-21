# commit / push 被擋下來了 —— 我看到的那行字是什麼意思

> 立於 2026-08-21(W5;主視窗裁定)。**給 Sean 看的**,不是給寫 hook 的人看的。
> 分母:`pre-commit` **5 道**(`grep -c 'sh .husky/' .husky/pre-commit` ⇒ 5)+
> `pre-push` **一條 `&&` 鏈上 4 段**(看那一行:`grep -v '^[[:space:]]*#' .husky/pre-push | tail -1`
> —— 🔴 這裡只能**看**不能 `grep -c`,四段在同一行上;我第一版寫的計數命令回 1,已改)。
> 清單會長,**數字要當場重跑**。
>
> 🔴 **為什麼放在 `docs/runbooks/` 而不是 `docs/patterns/`**:這份檔要回答的是
> 「**我現在該做什麼**」,不是「這道閘怎麼設計的」。設計面在各 gate 檔的檔頭與
> `docs/patterns/slice-checkpoint.md`;這裡只放**你螢幕上會出現的那一行 → 你的下一步**。
>
> 🔴 **每一格寫的是【你實際會看到的那行字】,不是 exit code 的定義。**
> 來源(2026-08-20 實錘):執行包寫「你會看到 `UPDATE 123`,看不到就立刻回滾」——
> 而 Supabase SQL Editor **根本不印那行**,成功的畫面是 `Success. No rows returned`
> ⇒ 正確的結果觸發了破壞性的動作。**判準要寫那個人實際看得到的東西。**

---

## 0. 三十秒版

```
husky - pre-commit script failed (code 1)   ⇒ 往上捲,找【🔴 擋下:】或【⛔】開頭那行
husky - pre-commit script failed (code 2)   ⇒ 🔴 是【閘自己壞了】,它印的數字都不要引用
husky - pre-push  script failed (code 1)    ⇒ 往上捲,大多是 typecheck / lint 紅了
husky - pre-push  script failed (code 3)    ⇒ 🔴 資料庫帳本對不上,別跑 supabase db push
```

`code` 那個數字**只夠讓你知道要往哪裡找**,真正的指示在它上面那幾行。
🔴 `code 1` 同時代表五、六種不同的事 ⇒ **先看訊息**。而 `code 2` 與 `code 3` 各只有一個意思(§2-B / §4)。

---

## 1. commit 被擋(`pre-commit`)

現在掛了 **5 道**(數法:`grep -c 'sh .husky/' .husky/pre-commit` ⇒ 5)。

🔴 **「驗」欄的意思**:✅ = 2026-08-21 在拋棄式 repo 裡**真的把那個狀態造出來、真的跑 `git commit`**,
下面那行字是從畫面上抄的;⚠️ = **只從 gate 原始碼抓到字面**,沒有讓它真的發生過。
(W3 在 R3 指出:`grep` 到字面在檔裡 **≠** 螢幕上會出現那行字。)

| 驗 | 你會看到的那一行 | 誰擋的 | 你要做什麼 |
|---|---|---|---|
| ✅ | `⛔ PCM reviewer gate:本次 commit 動到受審面…` | `.husky/reviewer-gate.sh` | 這片還沒過 code review。跑完審查後照它訊息裡那行寫 marker,再 commit。 |
| ✅ | `🔴 擋下:子窗(worktree)不得直接寫 STATUS.md` | `.husky/status-owner-gate.sh` | STATUS 只能主視窗寫。把內容給主視窗,自己這邊撤掉。 |
| ✅ | `🔴 擋下:免登入後台指令缺 -H 127.0.0.1` | `.husky/admin-dev-bypass-gate.sh` | 把那條指令補上 `-H 127.0.0.1` 再 commit。 |
| ✅ | `🔴 擋下:migration 時間戳撞號` | `.husky/migration-ts-gate.sh` | 兩支 migration 用了同一個時間戳,改一支的檔名。 |
| ✅ | `🔴 scripts-whitelist-gate 擋下:上列檔在 package.json 的 lint-staged 與豁免清單裡【都沒有】` | `.husky/scripts-whitelist-gate.sh` | `scripts/` 多了一支沒人看管的腳本。訊息裡有兩條路,擇一。 |
| ✅ | `🔴 …:分母是 0 / 檔名含換行 / …` + **`code 2`** | 同上,但**是閘自己壞了** | 它印的數字全部不可引用。見 §2-B。 |

五格的造法(要重驗照這個做):拋棄式 git repo + 真的 gate 檔 + `git config core.hooksPath .husky/_`
+ 逐格造出觸發條件(worktree 那格用 `git worktree add`)⇒ 真的跑 `git commit`。

## 2. 🔴 一段我寫錯過的東西 —— 留著,因為錯的形狀比結論有用

### 2-A 我曾經在這裡寫「reviewer gate 從來沒有擋下過任何一次 commit」。**那是錯的。**

當時的量法:`sh .husky/pre-commit` ⇒ rc=0 ⇒ 我判它不擋。
而 husky **不是那樣叫它的**:`.husky/_/h:17` 寫的是 `sh -e "$s"`。同一份檔、兩種叫法:

```
sh    .husky/pre-commit   ⇒ rc=0     ← 我用的(錯的)
sh -e .husky/pre-commit   ⇒ rc=1     ← husky 實際用的
```

🔴 **我在寫一份關於「你實際會看到什麼」的檔,而我自己用了一個沒有人會用的叫法去量它。**
真正的驗法是讓 git 自己跑一次(拋棄式 repo、`core.hooksPath` 接好),結果:

```
世界①  動到受審面、沒有 marker  ⇒ husky - pre-commit script failed (code 1)、commit 沒進去
世界②  寫上有效 marker          ⇒ commit 進去了
```

⇒ **這道閘一直都在工作。** 上面那個表裡它的欄位照一般情況讀就好。

⚠️ 但它**曾經**只靠外面那一層的 `-e` 旗標在成立(本檔沒寫 `|| exit`)——
husky 換版、或有人手動 `sh .husky/pre-commit`,它就會安靜地不擋。
2026-08-21 已改成 `|| exit $?`,兩種叫法都成立。

### 2-B `exit 2`(閘自己壞了)以前會顯示成 `code 1` —— ✅ 已修

`scripts-whitelist-gate.sh` 分三態:`0` 乾淨 / `1` 有漏列 / `2` **它自己壞了、輸出作廢**。
而 `.husky/pre-commit` 舊寫法 `|| exit 1` 把那個 2 壓成 1。三個版本實測(假閘固定回 2):

```
|| exit 1    ⇒ sh -e:1   裸 sh:1     ← 語意被壓掉
|| exit $?   ⇒ sh -e:2   裸 sh:2     ← 保留,且不依賴 -e   ✅ 現在用這個
什麼都不接    ⇒ sh -e:2   裸 sh:0     ← 只在 -e 下成立,脆弱
```

端到端驗過(真的跑 `git commit`):

```
husky - pre-commit script failed (code 2)
```

⇒ **現在 `code 2` 真的會出現在你眼前**,它的意思是:
**那道閘自己壞了 ⇒ 它上面印的任何數字都不要引用**,不是「有東西漏列」。

---

## 3. push 被擋(`pre-push`)

`.husky/pre-push` 是一條 `&&` 鏈,**前面紅了後面就不跑**。順序:

```
1. TURBO_FORCE=1 pnpm typecheck
2. TURBO_FORCE=1 pnpm lint
3. scripts/deploy-order-gate.sh            (部署時序)
4. scripts/migration-ledger-divergence.sh  (migration 帳本分岔;只在推 main 時實查)
```

| 驗 | 你會看到的那一行 | 意思 | 你要做什麼 |
|---|---|---|---|
| ✅ | `error TS….` + `code 1` | typecheck 紅 | 型別錯。**可能不是你的檔** —— 七窗共用一棵樹,先 `git status` 看是誰的。(2026-08-21 實際撞到過一次,是別窗編輯中的檔。) |
| ⚠️ | eslint 的檔案:行號清單 + `code 1` | lint 紅 | 同上。🔴 **未驗**:缺的那道檢查 = 「在不影響別窗的地方造一個 lint 錯」。共用工作樹不能拿來造錯,而拋棄式 workspace 要裝整套 eslint 設定 ⇒ 本輪沒做。**這一列的字面是推的。** |
| ✅ | `🔴 部署時序 gate:**這次要推的應用層新增程式碼,用到了還沒 apply 的 migration 建的函式**。`<br>下一行:`· 函式 [<名字>](在未 apply 的 migration 裡)出現在新增行:<檔>  [ref refs/heads/dev]`<br>最後一行:`gate: 1 blocked / 1 pending(檢查了 1 個 ref)` | 應用層會先於 DB 上線 | 訊息裡有兩條出路。硬要推:`git push --no-verify` 並在 commit body 寫理由。 |
| ✅ | `ledger-gate: 跳過(這次推的不是 refs/heads/main,或是刪除 ref)—— 本閘沒有判準,不是「檢查過而乾淨」` | **正常** | 沒事,它只是告訴你它沒判。**這不等於「檢查過而乾淨」。**(`git push --dry-run origin dev` 實跑) |
| ✅ | `🔴 ② 危險 13 支:…` + `code 3` | 🔴 見 §4 | (`git push --dry-run origin dev:main` 實跑,git 真的拒絕) |
| ✅ | `🔴 supabase migration list --linked 失敗(未 link / 未登入 / 連不上)` + **`code 1`** | **量不到**平台帳本 | 不是「沒問題」。先 `supabase login` / 檢查網路,再推。 |
| ✅ | `🔴 找不到 supabase CLI ⇒ 量不到平台帳本,exit 1(這不是「沒問題」)` + **`code 1`** | 機器上沒有那支 CLI | 同上。`brew install supabase/tap/supabase` 然後 `supabase link`。 |

🔴 **更正(2026-08-21 codex R4 must-fix)**:本表前一版把「量不到」寫成 `code 3`,**那是錯的,它回 1**
—— 而同一份檔的下面兩行自己就寫著是 1。**一份專門為了「寫他實際會看到什麼」而存在的檔,
在那一格寫了一個沒有量過的數字。**
造法(兩個子情況都造過了):
```
PATH 裡拿掉 supabase        ⇒ 「找不到 supabase CLI」   rc=1
放一支 exit 1 的假 supabase ⇒ 「migration list --linked 失敗」rc=1
```

## 4. 🔴 `code 3` 目前只有一個來源,而它值得單獨講

數法(2026-08-21 當場跑):
```
grep -rn 'rc=3\|exit 3\|return 3' .husky/ scripts/deploy-order-gate.sh \
        scripts/migration-ledger-divergence.sh | grep -v '^\s*#'
⇒ 只命中 scripts/migration-ledger-divergence.sh:259 / :269
```
🔴 **我第一發用 `grep -c 'exit 3'` 掃,結果每一支都是 0** —— 包括那支真的會回 3 的。
成因:它不是寫 `exit 3`,是 `rc=3` 再 `return $rc`。**掃描字集比宣稱窄,而結果長得像「零命中」。**
(同族還有 `scripts/where-is.sh:185` 的 `return 3`,但那支不掛在 hook 上。)

看到 `code 3` 代表:

> **正式庫的 migration 帳本與我們的帳對不上。**
> 在這個狀態下跑 `supabase db push`,它會把已經套過的 migration **當成沒套過而重跑**;
> 其中不冪等的會 ERROR,而 db push 逐支送、前面成功的**不會回滾**。

你當下該做的事,**照這個順序**:

1. **不要跑 `supabase db push`。** 這是唯一一件必須立刻不做的事。
2. 看它印出來的版本號清單 —— ② 那組是「我們說套過、平台不知道」,⑦ 那組是「平台有、我們查不到出處」。
3. 要修,官方指令是(**確認過那支真的已生效才做,而且要有人在場**):
   ```
   supabase migration repair --linked --status applied   <版本號>   # ② 用
   supabase migration repair --linked --status reverted  <版本號>   # ⑦ 用
   ```
   🔴 `supabase/APPLIED.tsv` 是**自陳帳**:它說 apply 過不代表真的 apply 過。**不要盲補。**
4. 不想現在修 ⇒ 就繼續走 SQL Editor / MCP 逐支套,不要用 db push。

當場重跑看現況(不需要推任何東西):

```
sh scripts/migration-ledger-divergence.sh
```

---

## 5. 這份檔本身的誠實邊界

- 上面每一行「你會看到的字」都是**從 gate 檔裡抓出來的字面**,不是我複述的。
  抓法:`grep -oE "'⛔[^']*'|'🔴[^']*'" .husky/<gate>.sh` 與各檔的 `cat >&2` 區塊。
- §2-A / §2-B 兩個 `pre-commit rc=` 是**在拋棄式 repo 實跑量到的**,不是讀 code 推的。
- **`code 1` 不可靠(它是好幾種事的共用出口),`code 2` / `code 3` 可靠。**
  2026-08-21 已把 `.husky/pre-commit` 五道全改成 `|| exit $?`,語意才帶得出來。
- 🔴 **這份檔自己踩過一次它要防的坑**(§2-A):用一個沒有人會用的叫法去量「別人會看到什麼」。
  留著不刪 —— 錯的形狀比結論有用。
- 沒有涵蓋:`--no-verify` / `HUSKY=0` 繞過之後會發生什麼(答案是:什麼都不會發生,那正是它們的用途)。
