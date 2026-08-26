# Plan · `#945` 讓沙箱與 CI 帶 `design-reference` submodule

> **狀態:等 Sean 批。一行都還沒改。**
> 數法(2026-08-27 當場跑):`git status --porcelain | grep -c '945-submodule'` ⇒ 1
>
> 🔴 **Sean 已答方向「可以」,而那【不是】批這份 plan。**
> 來源:主視窗 `pcm-website-v2-5b` 2026-08-27 轉述,逐字「可以」,條目落 `f3d939f6`。
> ⚠️ 我沒有直接聽到那句 ⇒ 依 `~/.claude/rules/00-work-rules.md:98` 轉述契約①標**來源屬性 = 讀來**。
> 📌 判別句:「**他說可以做**」與「**他看過我要怎麼做**」是兩個宣稱,而在執行端都長得像一個授權。
>
> 命中 **鐵則 12④**(平台設定:CI)⇒ 高風險片、對抗審查**不降級**。
> 命中 **鐵則 8**(動 CI 設定)⇒ 本檔就是那份 plan。
> 產出者:施工窗 線4,2026-08-27。內容分級:**非 L1/L2/L3**(不是給客人看的內容)。

---

## 0. 🔴🔴 這一片【有一步只有 Sean 做得到】—— 先看這節
(落點:`.gitmodules` 的 url 欄 + `.github/workflows/ci.yml:19`)

**已量掉的兩格(2026-08-27,原本標「未確認」、原本要進 Sean 待辦 ⇒ 現在都不必)**

📌 判別句(主視窗 `-5b` 2026-08-27;來源屬性=**讀來**,依 `~/.claude/rules/00-work-rules.md:98`):
**進他待辦表的,應該只有【只有他做得到】的事。「我沒查」不等於「只有他查得到」。**

### 0-a `pcm-website-design` 是**私有**(量到的,不是推的)

```
前提① 不帶憑證打 GitHub API ⇒ HTTP 404
      curl -s -o /dev/null -w '%{http_code}'         -H 'Accept: application/vnd.github+json'         https://api.github.com/repos/pcmmotorsports/pcm-website-design      ⇒ 404
      正對照 同一發打 actions/checkout                                       ⇒ 200(我通得到 GitHub)
      負對照 同一發打 pcmmotorsports/definitely-no-such-repo-xyz             ⇒ 404
🔴 **單看 404 分不出「私有」與「不存在」—— 負對照那發也是 404。**
前提② 這個 repo【確實存在】:本機 submodule 有完整 git 歷史
      `git -C design-reference rev-list --count HEAD` ⇒ 6
      `git -C design-reference log -1` ⇒ a14fdcf 2026-08-03
      `git -C design-reference remote get-url origin` ⇒ git@github.com:pcmmotorsports/pcm-website-design.git
⇒ **存在 + 不帶憑證 404 ⇒ 私有。** 兩個前提缺一個都推不出來。

🔴 **而 codex 關卡1 把這個推論打穿了一格,它對**(finding 落在本檔 `:32-36`):
```
「本機 clone」只證明它【clone 的那一刻】存在, 不證明它【現在】存在。
而 repo 被刪除 / 改名 / 設成 internal 時, 不帶憑證照樣 404。
⇒ 「目前為 private」推不出來。
```
✅ **訂正後的結論(而它對本片的決定【零影響】)**:
   我真正需要知道的不是「private 還是 internal 還是被刪了」,是
   **「不帶憑證讀不讀得到」** —— 而那正是 404 直接量到的東西。
   ⇒ 本片一律寫 **「不具公開讀取權」**,不寫「私有」。
   📌 **我原本要的是一個決定所需的事實, 而我寫成了一個比它更強的宣稱。**
      更強的宣稱不會讓決定更好, 只會讓它更容易被推翻。
```

### 0-b 官方文件怎麼說(親讀,不是憑記憶)

`actions/checkout` README(2026-08-27 讀 `https://github.com/actions/checkout/blob/main/README.md`)**逐字**:

> `${{ github.token }}` is scoped to the current repository, so if you want to checkout a
> different repository that is private you will need to provide your own PAT

> When the `ssh-key` input is not provided, SSH URLs beginning with `git@github.com:` are
> converted to HTTPS.

🔴 **第二句對我們特別致命**:`.gitmodules` 用的正是 `git@github.com:`
⇒ 不給 `ssh-key` 的話它會被**改寫成 HTTPS**,然後拿一顆只涵蓋本 repo 的 token 去要一個私有 repo
⇒ **checkout 失敗、CI 整條紅、每個 PR 都紅。**
⚠️ 我第一版寫「GITHUB_TOKEN 只涵蓋當前 repo」時標的是「既有知識、未查證」——
   **現在是查證過的,而且多查到了 SSH→HTTPS 改寫那一條,那條我原本不知道。**

### 0-c ⇒ 剩下的那一步,**只有 Sean 做得到**
(沙箱那一半不受它影響 —— 實測見 `§11-1`;要動的那行 `scripts/commit-pack-preflight.sh:105`)

```
要在 GitHub 上放一個【秘密】: deploy key(SSH 私鑰)或一顆有跨 repo 讀權的 PAT
⇒ 我碰不到 .env*、碰不到 repo settings ⇒ **這一步不是我做得完的**
⇒ 見 §6 Q-945-1(問的已經不是「公開還是私有」, 是「用哪一種鑰匙」)
```
🔴 **在那把鑰匙就位之前,`§3` 的第 ② 步(改 `ci.yml`)不可以動** ——
   先改就是把 CI 弄紅,而紅的是**每一個人的每一個 PR**,不只是我這片。
✅ **而 `§3` 的第 ① 步(沙箱)不受它影響** —— 本機 `git submodule update` 走的是
   Sean 自己的 SSH key,那把鑰匙已經在了(本機 submodule 拉得到就是證據)。
   ⇒ **這一片可以先做沙箱那一半,CI 那一半等鑰匙。**

---

## 1. 為什麼 —— 這件事是一支守門抓出來的,不是想出來的

`apps/storefront/src/components/account/tabs/WalletTab.test.tsx` 有一格正對照:
它讀 design 原稿,證明「我們刻意不渲染的那幾個字面,在稿上**真的存在**」——
沒有它,`querySelector` 回 `null` 在【我們沒渲染】與【這個 class 名打錯了】兩個世界印同一句話。

而 `design-reference` 是 **git submodule**(`.gitmodules` 逐字
`url = git@github.com:pcmmotorsports/pcm-website-design.git`)⇒ 新 worktree 上那個目錄是空的。

```
2026-08-27 實際發生:
  bash scripts/commit-pack-preflight.sh <六支檔>
  ⇒ 「🔴 這一包在乾淨 dev 上站不住 ⇒ 多半漏收了一支它需要的檔」
  ⇒ 而真相不是漏收, 是沙箱裡沒有那個 submodule
```
📌 **preflight 抓到了一件我在主樹上量不出來的事** —— 主樹有 submodule,所以主樹永遠是綠的。

當下處置 = `it.skipIf(!existsSync(...))`,天花板寫在該檔的 `HAS_DESIGN_SUBMODULE` docstring:
🔴 **代價 = 它在沙箱與 CI 上不生效 = 一個 fail-open。本片就是要收掉那個 fail-open。**

---

## 3. 要改什麼(鐵則 8 第一件)

```
① scripts/commit-pack-preflight.sh:105
   現行  git worktree add --detach "$W" HEAD >/dev/null 2>&1 || { ... }
   加一步(其後):在新 worktree 裡把 submodule 拉起來
   🔴 而它【不得讓沙箱整支掛掉】—— 拉不到(離線 / 沒金鑰)時應照舊跑完並印一句
      「submodule 沒帶進來, 那類測試會 skip」, 不是 exit 1。理由見 §6 Q-945-2。

② .github/workflows/ci.yml:19
   現行  submodules: false   →   submodules: true   (私有的話還要金鑰, 見 §2)
   ⚠️ 另外兩支【不改】, 而理由要寫下來:
      .github/workflows/e2e-prod.yml:51   submodules: false
      .github/workflows/rpm-sync.yml:77   submodules: false  # 逐字「同步腳本不需 design-reference submodule」
      .github/workflows/rpm-sync.yml:111  submodules: false  # 同上
      ⇒ 數法:`grep -rn 'submodules' .github/workflows/` ⇒ 4 行;
        而跑 `pnpm test` 的只有 `ci.yml:163`(`grep -n 'run: pnpm test' .github/workflows/ci.yml`)
      ⇒ 🔴 **只有 ci.yml 需要 submodule。不要順手三支一起改** —— 另外兩支是純成本、零收益。

③ apps/storefront/src/components/account/tabs/WalletTab.test.tsx
   `HAS_DESIGN_SUBMODULE` 的 docstring 要更新 —— 🔴 **而 `skipIf` 本身不刪,理由見 §5。**
```

---

## 4. rollback

```
① 沙箱那支   純 shell 加法 ⇒ 單一 commit revert 即完全復原
② ci.yml     單一 commit revert ⇒ 回 submodules: false
🔴 而「改壞了會怎樣」有兩種形狀, 而它們的退法【相反】:
   形狀 A  checkout 就失敗(私有 + 沒金鑰)⇒ CI 整條紅、每個 PR 都紅
           ⇒ 很吵、很快被發現 ⇒ revert 就對
   形狀 B  checkout 成功, 而某些測試第一次真的跑起來 ⇒ 紅在測試上
           ⇒ 🔴 **那個紅是真的, 不該 revert**(見 §5)
⇒ **退之前先分清楚是 A 還是 B。revert 掉 B 等於把一個真的缺陷重新蓋起來。**
③ 金鑰(若走私有那條路)⇒ 不是 code, 是 Sean 在 GitHub 上的設定 ⇒ 由他撤
```

---

## 5. 🔴 影響面:它會讓現在綠的東西變紅,而那個紅是好事

```
submodule 帶進去之後, 那一格在 CI 上【第一次真的跑】⇒ 它有可能一裝上就紅
⇒ 而那個紅【不是這一片弄壞的】—— 它是「那一格從來沒在 CI 上跑過」這件事的顯影
```
📌 這條**不是新教訓**,正本已有:`docs/patterns/guard-and-instrument-traps.md:377` 的 §④
逐字「**守門一裝上就自己紅 ⇒ 先分清是守門錯, 還是產物錯**」
(⚠️ 我第一版引的是 `:6342` 與 `:11112` —— **那兩處是【提到它】的交叉參照, 不是正條**;
 2026-08-27 開檔重量才找到 `:377` 才是章節本體。
 📌 **grep 命中的第一行不一定是那條規則住的地方。**)⇒ **本片只引用、不重寫**
(常載 `~/.claude/rules/00-work-rules.md` §4:同一教訓不寫兩處全文)。

⚠️ **處置寫在前面,不要等它紅了才決定**:
```
一裝就紅 ⇒ 停下、開檔看它在講什麼、當成一個【真的 finding】處理
        ⇒ **不得**用「先關掉再說」蓋回去
        —— 那是 R4 換路訊號(想動驗證本身 = 立即停止、回報 Sean)
```

🔴 **而 `it.skipIf` 這一片【不刪】**,兩層理由:
```
① 本機開發者不一定跑過 `git submodule update --init`
   ⇒ 刪掉 ⇒ 他們 clone 完第一次跑測試就紅, 而紅的理由與「字面打錯」長得一樣
② 🔴 更重要:留著 skipIf, 「CI 上到底有沒有真的跑」才是一個【可以被驗的問題】
   ⇒ 見 §7 雙向驗收。刪掉它, CI 綠就只剩一種解釋 —— 而那正是本片要修的病。
```

---

## 6. 🔴 要先答的 —— 兩題

```
Q-945-1  ✅ **「讀不讀得到」已經量掉了(§0-a:不具公開讀取權)** —— 現在問的是【用哪一種鑰匙】
         (量法與正負對照見 §0-a;官方原文見 §0-b)
   甲 deploy key —— 產一把 SSH 金鑰、公鑰放 design repo 的 Deploy keys(唯讀)、
      私鑰放本 repo 的 Actions secret, workflow 加 `ssh-key: ${{ secrets.… }}`
      👉 權限最小(只開那一個 repo、只讀), 而且**不會觸發 SSH→HTTPS 改寫**(§0-b 第二句)
   乙 fine-grained PAT —— 一顆限定 repo、唯讀、有期限的 token 放 secret
      👉 🔴 **我第一版寫「PAT 通常開得比一個 repo 大」—— 那是【舊型 classic PAT】的性質**,
         codex 關卡1 指出 fine-grained PAT **可以限單一 repo、唯讀、設期限**
         ⇒ 我原本那條「甲的權限比較小」的理由**站不住**, 兩者可以一樣小。
         📌 **我拿一個過時的性質去比較兩個選項, 而比較結果看起來很有說服力。**
      👉 真正的差別剩:PAT **會過期**(到期那天 CI 會紅, 而紅法與「鑰匙沒配好」一樣)
         · deploy key 不會過期, 而它綁死一個 repo
   👉 🔴 **兩條都要你在 GitHub 上放一個秘密 ⇒ 我做不到, 也不該替你選權限範圍。**
   👉 我傾向甲(範圍最小), 而**真正該由你決定的是「要不要為了一個測試多一把鑰匙」**
      —— 若答案是不要, 那 `§3` 第 ② 步(CI)就不做, **只做沙箱那一半**, 本片仍有價值。

Q-945-2  沙箱(`commit-pack-preflight.sh`)拉不到 submodule 時要怎樣?
   甲 照舊跑完, 印一句「submodule 沒帶進來, 那類測試會 skip」        ← 我傾向
   乙 直接 exit 1, 不讓你 commit
   👉 乙比較嚴格, 而 preflight 是**每個窗每次 commit 都要跑的東西**
      ⇒ 把它變成「網路不通就不能 commit」, 大家會開始繞過它,
        而**一個被繞過的守門比沒有守門更糟** —— 它還在名單上, 讓人以為有在守。
```

---

## 7. 🔴 驗收:雙向表演,不是「CI 綠了」

📌 **CI 在那一格 skip 掉的時候也是綠的。⇒ 只驗綠 = 零判別力。**
(同族先例:`docs/patterns/guard-and-instrument-traps.md:10995` 那一段 ——
 `succeeded` 是綠的,而 body 逐字 `{"sent":0,"enqueueStatus":"skipped_no_cutoff"}`。**本片只引用。**)

```
世界 A  帶了 submodule ⇒ 那一格必須【跑】
        量法:CI log 的 vitest 摘要 —— 該格出現在 passed 而**不是** skipped;
              並比 skipped 總數(它要比世界 B 少 1)
世界 B  不帶 submodule ⇒ 那一格必須【skip】而其餘全綠
        量法:本機 `git worktree add --detach` 一棵不帶 submodule 的樹, 跑同一支測試
🔴 兩個世界都要餵一發, 而且要印出【不同的東西】。
   一發綠 + 一發也綠 = 一個證據複印兩份, 不是效度。

負對照(證明量的是對的東西):
  在帶了 submodule 的世界把 `DELIBERATELY_OMITTED.tierCard` 改名成 `-v2` ⇒ 那一格必須【紅】
  ✅ 2026-08-27 我在主樹上跑過這一發, 它紅了(只紅那一格)
  🔴 而裝上 CI 之後要在 CI 上【再跑一次同一發】—— **主樹紅不證明 CI 會紅。**
```

---

## 8. 代價(量一次寫進去)

```
design-reference 工作樹    3.6M   (`du -sh design-reference`, 2026-08-27)
它的 .git 物件             25M    (`du -sh .git/modules/design-reference`)
⚠️ **CI 上多花多少時間我沒有量** ⇒ 標未確認。
   要精確值 ⇒ 裝上之後比對前後兩次 CI 的 Checkout step 耗時。
   沙箱那邊本機已有 `.git/modules` 快取 ⇒ 應該接近零, **同樣未量**。
📌 不要把「3.6M 很小所以很快」寫成結論 —— 那是推出來的, 不是量到的。
```

---

## 9. 這份 plan 自己不確定的(逐條,不藏)

```
· ~~`pcm-website-design` 公開還是私有~~ ✅ **2026-08-27 量掉 ⇒ 私有**(§0-a,含正負對照)
· ~~actions/checkout 對私有 submodule 的行為~~ ✅ **2026-08-27 親讀官方 README 引原文**(§0-b)
  📌 而查證多撈到一條我原本不知道的:**不給 `ssh-key` 時 `git@github.com:` 會被改寫成 HTTPS**
     ⇒ **查證的價值不只是把「未確認」變成「確認」, 它會撈到你沒想過要問的那一條。**
· 帶了 submodule 之後 CI 會不會有【別的東西】第一次跑起來 —— **沒查**
  🔴 而掃這件事的尺**不能只掃測試檔**:next.config / vitest config / 任何 build 期引用都算
· CI 多拉一個 submodule 的實際耗時 —— **沒量**(§8)
· 那一格裝上 CI 會不會一裝就紅 —— **不知道**, 而 §5 已先寫好處置
```

---

## 10. 一件我重量過、而它推翻了我自己上一句話的事

我在 `WalletTab.test.tsx` 原本寫「本檔是全 repo **唯一**在 runtime 讀 design-reference 的測試」,
並附數法 `grep -rn design-reference --include='*.test.ts*' apps packages` ⇒「只有本檔那一行」。

🔴 **那條指令照抄去跑印 12,不是 1。結論對,數法錯。**

**真正的數法(已改寫進該檔,兩段;而第②段不是一條指令)**:
```
① 寬尺取候選集:全 repo、不限目錄、六種測試檔命名變體(find …)⇒ 851 支
   其中內容含 design-reference ⇒ 7 支;負對照同尺查 `design-reference-nosuch` ⇒ 0
② 逐支開檔【人工分類】那 7 支 ⇒ 只有 1 支把 design-reference 路徑餵給讀檔 API
   (3 支 readFileSync 讀別的路徑、design-reference 只在註解;1 支註解在講掃描範圍不含它;
    2 支純註解無讀檔 —— 其中 FilterDrawer 那一行是**測試標題字串**)
🔴 第②段不能用 grep:路徑寫在 const 裡、readFileSync 收的是【變數】
   ⇒ `grep '(readFileSync|readFile|import)\(' | grep -c design-reference` 對本檔自己印 0
```
📌 **這兩個病正本都已經記過,本片只引用不重寫**(2026-08-27 跑 `traps-neighbours.py` 查重,
自檢六個世界 PASS,分母 1603 則):
```
· 「grep 數關鍵字會把註解裡提到的算進來」 ⇒ memory reference_grep-keyword-count-includes-comments
· 「尺撞到談論自己的文本 ⇒ 印假滿手 / 假空集合」⇒ memory reference_a-broken-ruler-prints-an-empty-set-not-an-error
· 「守門一裝就紅」            ⇒ docs/patterns/guard-and-instrument-traps.md:6342
· 「綠燈底下寫著 skipped」    ⇒ 同檔 :10995
```

📌 相關:`.github/workflows/ci.yml:19` · `scripts/commit-pack-preflight.sh:105` ·
`apps/storefront/src/components/account/tabs/WalletTab.test.tsx` 的 `HAS_DESIGN_SUBMODULE` docstring


---
---

# 🔴 §11 codex 關卡1 的結果:14 條 must-fix + 4 條 nit

> 2026-08-27 線4 自己跑(`codex exec -s read-only`、stdin 導掉、`codex-cli 0.144.1`)。
> 完整 log 在 session scratchpad,不進 repo。

## 11-1 ✅ 我當場**實測**了 codex 最重的那一條 —— **而它只對一半**

codex 說:「Git 官方仍標 linked worktree 的 submodule 支援不完整」並附了 `git-worktree` 文件連結。

**我照 §7 的規矩,兩個世界各餵一發**(2026-08-27 實跑):
```
建一棵 linked worktree(`git worktree add --detach`)
  design-reference/ 檔案數 ⇒ **0**(空的)—— 與本片的前提一致 ✅
在那棵 worktree 裡 `git submodule update --init design-reference`
  rc ⇒ **0**
  log 第一行 ⇒ `Cloning into '…/wt-probe/design-reference'…`
  拉完檔案數 ⇒ **12**;那支測試要的 `components/WalletTab.jsx` ⇒ **在** ✅
主樹有沒有被污染 ⇒ `git status --porcelain | grep -c design-reference` ⇒ **0** ✅
收攤 `git worktree remove --force` ⇒ 殘留 **0** ✅
```
⇒ 🔴 **`submodule update` 在 linked worktree 裡【是work的】。**
   codex 引的那段官方文字,讀原文是在講**移動 / 移除**帶 submodule 的 worktree,
   **不是在講 `submodule update`** ⇒ **這一條 finding 的證據與結論對不上,我不照它改。**
   📌 **而抓到審查錯一次之後,最容易的下一步是不信它整輪 —— 下面 11-2 那些我逐條核過,它們是對的。**

⚠️ **而它旁邊那半是對的,而且很重要**(`git -C <worktree> submodule update --init` 的 log 第一行是 `Cloning into`)⇒
   **每一棵新 worktree 都是一次【全新 clone】,不是從本機快取 link 過去。**
   ⇒ 八個窗 × 每次 commit = 每次都走一次網路 + SSH 憑證
   ⇒ **`§8` 的代價欄「本機已有 .git/modules 快取 ⇒ 應該接近零」是【錯的】,已推翻。**

⚠️ **一個我不留著不解釋的數字**:主樹 13 個項目、新 worktree 12 個。
   差的是 `.DS_Store`(macOS 產物、`.gitignore` 內)⇒ **不是漏拉。**

## 11-2 🔴 codex 對的、而我改不動的 —— 這些讓本片**縮小範圍**

```
① 驗收那個「比 skipped 總數少 1」**跨環境比不了**
   世界 A 是 CI 全套、世界 B 是本機單檔, 而 repo 另有兩個條件 skip
   ⇒ **總數差 1 歸因不到 WalletTab 那一格。**
   ⇒ 改法:量**那一格自己的狀態**(vitest 的 JSON reporter 逐格取), 不量總數。
② 「在 CI 上再跑一次突變」**現行 CI 沒有 workflow_dispatch**
   ⇒ 要推一顆故意紅的 commit 才跑得到 ⇒ 而 plan 沒寫分支 / 授權 / 還原 / 不得進 dev 的停點
   ⇒ **這一步不能留在 plan 裡當「順手做」** —— 它要嘛先加 workflow_dispatch, 要嘛不做。
③ **fork PR 與 Dependabot 拿不到 secret** ⇒ 那些 PR 的 checkout 會失敗
   ⇒ 🔴 **這是一個本片會弄壞、而我完全沒想到的族群。**
④ rollback **不只 A/B 兩形狀** —— 還有「checkout 成功但測試 skip 的假綠」、
   「憑證外洩的綠」、「clone 放大造成後續 timeout」⇒ 二分法會選錯處置。
⑤ 沙箱那半的 fail-open **沒有真的收掉**:離線 / 鑰匙失效 ⇒ 拉不到而 preflight 照樣綠、
   正對照繼續 skip ⇒ **本片宣稱要收的那個 fail-open 原封不動。**
   📌 這一條最狠 —— **本片的存在理由就是收掉那個 fail-open, 而 `Q-945-2` 我傾向的甲會把它留著。**
   ⇒ `Q-945-2` 要重寫:不是「掛掉還是不掛掉」, 是**「拉不到時,那個 skip 要不要變成一個看得見的紅」**。
⑥ submodule 釘住的 SHA 若被 design repo 改寫成不可取得 ⇒ 新沙箱 / CI 拉不到,
   而**主樹的舊物件仍在 ⇒ 主樹假綠**。
⑦ `:157-159` 我把「刪 skipIf 之後 CI 綠只剩一種解釋」**寫反了** —— 缺檔時它會紅不會綠。
   ⇒ 那一句的論證方向錯, 而**結論(不刪)仍然成立**, 理由要換成 §5 的第 ① 條。
⑧ `:102` 指到「見 §2」而 §2 已升成 §0 ⇒ **死指標**, 改指 §0-b / §6。
⑨ `:171` 「PAT 通常開得比一個 repo 大」不足以當甲乙的權限比較 ——
   **fine-grained PAT 可以限單一 repo、唯讀、設期限** ⇒ 那一格的理由要改寫。
```

## 11-3 判定

```
🔴 **FAIL。** 而它與 `#1` 那份不同:`#1` 是【地基假】, 本片是【範圍比我寫的窄】——
   fork PR / 每次全新 clone / 沙箱 fail-open 沒真的收掉 / CI 上驗不了突變,
   四件合起來 ⇒ **本片交得出來的東西比 §1 宣稱的少。**
⇒ 折法**不是補洞**, 是**把本片重新切**:
   片A 沙箱那一半(不需要任何鑰匙, 而 `Q-945-2` 要先重寫成「拉不到要不要紅」)
   片B CI 那一半(要鑰匙 = Sean;而 fork PR 那一格要先有答案)
⇒ **今晚不往下寫** —— `Q-945-1`(哪種鑰匙)與 `Q-945-2`(重寫後)都要人拍,
  而 fork PR 那一格我連題目都還沒寫成選項。
```
