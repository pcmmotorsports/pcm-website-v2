# Plan · 線【DB 金流】剩餘 24 支怎麼進 dev

> 量測 **2026-08-31 11:5x** · 樹 `/Users/sean_1/pcm-wt-db` · 分支 `agent/line-db` @ `df50d324`
> 對照基準 = **`origin/dev` @ `934fa394`**(11:33:42 fetch 後重量;11:2x 寫作當下遠端還是 `dc92260c`,見 §0)
> 提案人 = 線 DB `[6cdb1c]` · 收件 = 主視窗 `[16689c]` → Sean

---

## 0. 🔴 §0 在寫完之後 20 分鐘就過期了 —— 而它過期的方式值得留著

**原本這一節寫的是**:那三支 `.ts` 的防護只在【本機】dev 上,`origin/dev` 沒有它
(11:2x 實量 `git merge-base --is-ancestor 934fa394 origin/dev` ⇒ **rc=1**),
⇒ 「commit 進 dev」與「防護生效」中間還隔著 Sean 的手。

🛑 **11:33:42 我重量一發 ⇒ 那一格已經不成立**:
```
git rev-parse --short origin/dev                  ⇒ 934fa394   (11:2x 時是 dc92260c)
git merge-base --is-ancestor 934fa394 origin/dev  ⇒ rc=0
```
⇒ ✅ **Sean 推了。那三支 `GIT_*` 防護現在【真的上線了】。本片最初的目的達成。**

📌 **舊字面留著不刪, 因為它示範的東西比它的結論有用**:
那一段在 11:2x **是對的** —— 它有指令、有 rc、有時刻。它壞掉不是因為量錯,是因為**世界動了**。
🔴 **而我是被【別人來訊】才去重量的, 不是自己想到的** —— 哨兵 `[f00b72]` 11:3x 通報「已推上去」。
⇒ 若沒有那一則,我會把一份**每個字都有證據**的過期結論 commit 進 repo,而**不會有任何東西紅**。
⇒ 📌 **這正是我同一天上午對哨兵說的那句話,回頭打在我自己身上:
     「解藥不在寫的那一端(寫的當下是對的),在讀的那一端接件前先量一次。」**
⇒ ⇒ **而它同時證明了那句話不夠**:讀端重量需要一個**觸發**,而我這次的觸發是運氣。

✅ 內容我核過:那三支在 `origin/dev` 與在我分支上 **sha256 逐字相同**
(`4f47bd40e1de7f3d` / `198323e0f2be2077` / `8a12bb511958494e`)⇒ 那一手沒有掉東西。

## 1. 要改什麼(範圍 = **22 支**,而 24 與 25 都不是答案)

🔴 **兩點與三點在我這條線上差 1 支,而【兩個都不是爆炸半徑】。**
哨兵 `[f00b72]` 11:4x 通報:別的線兩點比三點大(line-ship 78 vs 26),結論「要爆炸半徑就用三點」。
**那條結論對那幾條線成立,對我這條不成立** —— 我這條 `origin/dev` 只領先 2 顆,而我被 cherry-pick 走過 3 支。
我把兩邊的**檔名清單**直接比(不是比數字):

```
git diff --name-only origin/dev HEAD    | sort > two.txt    ⇒ 24 支
git diff --name-only origin/dev...HEAD  | sort > three.txt  ⇒ 25 支

comm -13 two three  ⇒ 只在三點裡 3 支:那三支 GIT_* 測試
                       (已被 934fa394 取走, 兩邊【逐字相同】⇒ 落地是零改動)
comm -23 two three  ⇒ 只在兩點裡 2 支:G-20260829-….md / progress-roadmap.html
                       (7eedb46e 加的, dev 比我新 ⇒ 我沒有貢獻, 只會蓋掉)
comm -12 two three  ⇒ 交集 22 支
```

⇒ **三條路各自算,都落在 22**:
```
三點 25 − 已在 dev 且逐字相同的 3 支 = 22
兩點 24 − dev 比我新的 2 支          = 22
交集直接數                           = 22
負對照 origin/dev 對自己 ⇒ 兩點 0 · 三點 0
自檢(`-a0` 的做法):挑一項我確定沒碰過的 —— `supabase/APPLIED.tsv` 在交集清單裡嗎 ⇒ 印 0 ⇒ 分母對
```

📌 **⇒ 兩點與三點不是「一個對一個錯」,是【答兩個問題】,而我要問的是第三個**:
```
三點  = 我從共同祖先以來改了什麼            ⇒ 25(把已經落地的算進來 ⇒ 偏大)
兩點  = 現在兩棵樹哪裡不一樣                ⇒ 24(把我沒貢獻的算進來 ⇒ 也偏大)
交集  = **我落地之後 dev 上會真的變的東西** ⇒ 22  ← 爆炸半徑要的是這個
```
🔴 **而這一格會咬人的地方是:那 3 支與那 2 支【互相抵銷得幾乎剛好】** ——
24 與 25 只差 1 ⇒ 看起來像「小數點誤差、選哪個都差不多」,
**而它其實是 5 支檔在兩個方向上抵銷。** 兩個數都不對,而它們對得太近所以不會有人去拆。

**行數**(以下各堆仍以兩點量,因為要看的是內容差多少):
`git diff --shortstat origin/dev HEAD` ⇒ **24 files, +1676 / -298**

🔴 **而「24 支」不是一件事** —— Sean 11:0x 拍乙的理由逐字是「**動到錢的東西該有它自己的 plan 跟審查,不該搭順風車上線**」。
⇒ 那句話的推論不是「這 24 支要一起審」,是「**會動到錢的那幾支要單獨審**」。
⇒ 本 plan 的主張:**先把不碰錢的搬走,讓要審的那一份縮到人看得完的大小。**

分四堆(指令 `git diff --numstat dev HEAD -- <各自 pathspec>`):

| 堆 | 內容 | 支數 | +/- | 片型 | 碰錢? |
|---|---|---|---|---|---|
| **A · docs** | launch-todo / guard-and-instrument-traps / order-state-gates / 2 支 traps-inbox / progress-roadmap.html | 6 | +389 / -51 | 輕量片 | ❌ |
| **B · 工具** | `latest-definition-of.sh` / `rpm-import.ts` / `rpm-reconcile.ts` + 2 支 rpm 測試 | 5 | +389 / -13 | 標準片 | ❌ |
| **C · 契約測試** | `packages/adapters/.../anomaly-alert-key-contract.test.ts` | 1 | +44 / -0 | 標準片 | ❌ |
| **D · 退款** | payment 產品碼 5 支 + 測試 5 支 | 10 | +357 / -234 | 🔴 **高風險片** | ✅ |
| **E · migration** | `20260831010000_…_manual_refund_raise_plaintext.sql` + `pcm03stars-apply-probe.sh` | 2 | +497 / -0 | 🔴 **高風險片** | ✅ |

D 的產品碼(**會上線執行的那 5 支**,測試不算):
```
manual-refund-repository.ts   +44  -0
refund-repository.ts          +42  -79
refund-actions.ts             +25  -19
refund-ledger-view.ts         +14  -6
refund-action-state.ts        +9   -4
小計 5 支 +134 -108
```
📌 **⇒ 真正要人逐行看的是這 134+108 行,不是 1676 行。**

### ⚠️ 一個對不上的數字,我不下判斷只擺著
主視窗轉述給 Sean 的描述逐字是「**11 支產品碼 / 401 行**」。我試了三個分母都複現不出來:
```
vs 本機 dev, 非測試的 .ts/.sh/.sql   ⇒ 10 支 +878 -118(動 996 行)
vs origin/dev, 同上                  ⇒ 10 支 +878 -118(動 996 行)
vs 本機 dev, payment 全部(含測試)   ⇒ 10 支 +357 -234(動 591 行)
```
🔴 **而這【不影響那一板】** —— Sean 拍乙的理由是「動到錢的該有自己的 plan」,那句話不吃這個數字大小。
⇒ 擺著的用途只有一個:**下次引用時用得出來的分母,而不是一個沒有人重算得出來的數。**

---

## 2. 為什麼要拆(而不是整包審)

1. **拆完之後 D+E 的審查面積少 76%**(1676 → 401 行 = D 的 357 + E 扣掉 probe)。審查的命中率與面積成反比。
2. **A/B/C 對 D/E 零依賴**,我逐條驗過:
   - 契約測試讀不讀那支新 migration ⇒ `grep -n '20260831010000\|rail_cap_guard'` ⇒ **印 0 行**
   - `rpm-*` 碰不碰 refund ⇒ `grep -n 'refund' scripts/rpm-reconcile.ts scripts/rpm-import.ts` ⇒ **印 0 行**
3. 🔴 **而有一條綁死的,不能拆**:`pcm03stars-apply-probe.sh:17` 逐字引用
   `supabase/migrations/20260831010000_…sql` ⇒ **probe 必須與 migration 同進退**,否則 probe 指向一支不存在的檔。⇒ 所以 E 是兩支一起,不是分開兩片。

---

## 3. 預期影響面

| 堆 | 壞掉會怎樣 |
|---|---|
| A | 文件讀起來不對。**零執行路徑。** |
| B | `rpm-import` / `rpm-reconcile` 是**離線批次工具**,不在顧客或員工的請求路徑上 ⇒ 壞了是「那支腳本跑不動」,不是網站壞掉。⚠️ 但它會**寫資料**(import/reconcile)⇒ 不是零風險,是「風險在批次不在線上」。 |
| C | 契約測試壞掉 ⇒ **CI 紅**。它自己不上線。 |
| D | 🔴 **員工按退款的那條路**。壞掉的形狀:退款金額算錯 / 該擋的沒擋 / 狀態機卡住。**錢。** |
| E | 🔴 一支 `CREATE OR REPLACE` 換掉**上線中 trigger 的整個函式本體**。抄錯一代 ⇒ 後面幾代行為整個回捲,而**三綠不會紅**。 |

**Rollback**
- A/B/C/D:`git revert <那一顆>`,純 repo 內,無外部狀態。
- E:🔴 **沒有一行還原**。migration 檔尾自己寫著:要還原就是把 `20260824011000:112-216` 那段原樣 `CREATE OR REPLACE` 回去,**從那支檔抄、不要憑記憶重打**。

---

## 4. 提議的順序與各自的驗收

> 每片獨立 commit、獨立三綠、獨立收工。**四片都不 push。**

**片 1(A · docs)** — 輕量片
- 🔴🔴 **不可以整堆 `git checkout`** —— A 的 6 支裡有 **2 支的差異方向是【dev 比我新】**:
  ```
  git diff --numstat origin/dev HEAD -- 'docs/patterns/traps-inbox/G-*' 'docs/progress-roadmap.html'
  ⇒  0  44  docs/patterns/traps-inbox/G-20260829-….md
     1   1  docs/progress-roadmap.html
  ```
  那 44 行是 `7eedb46e`(已在 `origin/dev` 上)加的 ⇒ **拿我的版本蓋過去 = 把它刪掉。**
  📌 **而 `git checkout <branch> -- <path>` 對這件事零抵抗:它不合併、不警告、不留衝突標記,
     它就是【用那一版整個覆蓋】** ⇒ diff 上長得像一次正常的 docs 更新,三綠不會紅。
  ⇒ ✅ 片 1 只取**其餘 4 支**;那 2 支改成逐檔看差異、要哪幾行再說(或直接放棄我這側的版本)。
- 動作:`git checkout agent/line-db -- <A 扣掉那 2 支之後的 4 條路徑>` 到 dev
- 驗收:純 .md/.html ⇒ 依鐵則 11「純文件片」不跑三綠;`git diff --cached` 逐條核路徑
- ⚠️ `docs/progress-roadmap.html` **是 .html 不是 .md** ⇒ 不吃「純文件片」豁免,要跑一次 build

**片 2(B+C · 工具與契約測試)** — 標準片
- 驗收:`TURBO_FORCE=1 pnpm typecheck / lint / build` 三個 rc=0;
  測試餵 3 條(`rpm-partial-report` / `rpm-reconcile` / `anomaly-alert-key-contract`)⇒ 連跑兩發比四個數
- code-reviewer subagent 一輪

**片 3(D · 退款)** — 🔴 高風險片(鐵則 12 ①錢)
- 驗收:三綠 + payment 那 5 支測試連跑兩發
- 🔴 **突變必跑**:每一支產品碼至少一發,證明測試殺得死它(不是「測試綠」)
- 🔴 **codex 對抗審查 commit 前跑,由本窗自己跑**(`-s read-only`,不代跑)
- 主視窗要的爆炸半徑:**5 支產品碼 / +134 -108 / 壞掉 = 員工退款那條路**

**片 4(E · migration + probe)** — 🔴 高風險片,**且它卡在 Sean**
- 現況:migration 已有 **1 道前置閘 + 7 道後置斷言**(指紋刻意排最後,`90e9808a` 掃 239 支對齊慣例後搬的),**已過一輪 codex**(檔內引用 must-fix 5 逐字)
- 🔴 **缺的那一格**:`scripts/pcm03stars-apply-probe.sh` 已寫好(224 行,答「斷言殺不殺得死突變」),
  **而我查不到它被跑過的紀錄**(`git log --grep='apply-probe' dev..HEAD` ⇒ **印 0 行**;本 session 我**未跑**)
  ⇒ **這是片 4 動工的第一件事**,不是最後一件
- ⚠️ 而 probe `:14` 是 `REPO=/Users/sean_1/pcm-wt-db` **寫死** ⇒ 與 CLAUDE.md 記著的 `storefront-probe/up.sh` 舊病**同一個形狀**(換一棵樹呼叫它會安靜地跑去別的樹)。從本樹跑正確,**換樹前要先改它**
- 🛑 **apply 是 Sean 的手。本片交出的是「它 apply 得起來、而它的斷言會紅」的證據,不是 apply 本身。**

---

## 5. 要 Sean / 主視窗拍的

只有一題,其餘我自己走。

```
Q: 線 DB 剩下的 24 支怎麼進 dev?
A: 甲 | 乙

甲 = 照本 plan 拆四片, 由不碰錢的先進(A → B+C → D → E)
     代價:四次 commit、四次收工, 主視窗要看四次而不是一次
     好處:要逐行審的那一份從 1676 行縮到 401 行; A/B/C 今天就能落地

乙 = 剩下 24 支當一片走完整流程
     代價:codex 要審 1676 行 —— 而那正是 Sean 11:0x 拍乙時不想要的形狀
     好處:只收工一次
```
**我推甲。** 理由不是省事:**Sean 那句「不該搭順風車」講的是【錢跟著別的東西一起上車】,而拆片正是把順風車拆掉。** 乙會讓 134 行的錢埋在 1676 行裡,審查的人要先把它找出來。

⚠️ **而甲有一個我先講的代價**:A/B/C 先進 dev 之後,`agent/line-db` 與 dev 會有一段時間**部分重疊**,下次比對要用**兩點** `git diff dev HEAD` 不能用三點 `dev...HEAD` —— 三點比的是 merge-base,會把已經進去的東西又算一次(本 plan 寫作當下我就踩了一次:三點印 25 支,兩點才是 24 支)。

---

## 6. 相關既有紀錄與連動面

- 交接檔 `~/pcm-mailbox/交接-DB金流-下一個合這條分支的人-20260831.md` —— 本片來歷
- `8c773692` / `df50d324` 兩顆 merge 的 body —— 衝突判準與四發突變
- `934fa394`(本機 dev)—— 主視窗取走的那三支
- 板 `⟦b4-PCM03STARS⟧`(`docs/launch-todo.md:729` done / `:733` parked / `:738` done)—— **同一個錨三列**
- CLAUDE.md 路由表「要抄一支既有的 DB 函式來改」⇒ `scripts/latest-definition-of.sh`(片 4 的前置)

**L 分級**:A/B/C = L1(不是內容,是工程檔)· D = L1(退款流程是功能不是內容)· E = L1。**無 L3。**

🛑 **本 plan 未經批准,我不動任何一片。**
