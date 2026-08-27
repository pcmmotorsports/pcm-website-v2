# Plan · `#945` 讓沙箱與 CI 帶 `design-reference` submodule

> **狀態(2026-08-27 更新;審查 R3 點名檔頭與 `§12` 相反)**:
> · **片A(沙箱)已施工並收包** —— 見 `§12`。
> · **片B(CI)一行都還沒改** —— 卡 `Q-945-1`。
> ~~等 Sean 批。一行都還沒改。~~ ⇐ **這句只對片B 成立, 而讀者只會看第一行。**
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
(落點:`.gitmodules` 的 url 欄 + `.github/workflows/ci.yml` 的 checkout step)

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
🔴 **代價 = 它在沙箱與 CI 上不生效 = 一個 fail-open。本片【原本】說要收掉那個 fail-open。**
⚠️ **而片A 做完之後, 誠實的說法是「縮小 + 顯影」, 不是「收掉」** —— 差別與理由寫在 `§12-2`;
   審查 R3 進一步質疑「做一半掛在共用綠燈裡, 是不是比不做更不誠實」⇒ 我的回答寫在 `§12-9`。

---

## 3. 要改什麼(鐵則 8 第一件)

```
① scripts/commit-pack-preflight.sh:105
   現行  git worktree add --detach "$W" HEAD >/dev/null 2>&1 || { ... }
   加一步(其後):在新 worktree 裡把 submodule 拉起來
   🔴 而它【不得讓沙箱整支掛掉】—— 拉不到(離線 / 沒金鑰)時應照舊跑完並印一句
      「submodule 沒帶進來, 那類測試會 skip」, 不是 exit 1。理由見 §6 Q-945-2。

② .github/workflows/ci.yml  的 checkout step
   現行  submodules: false   →   submodules: true   (私有的話還要金鑰, 見 §2)
   ⚠️ 另外兩支【不改】, 而理由要寫下來:
      .github/workflows/e2e-prod.yml     submodules: false
      .github/workflows/rpm-sync.yml     submodules: false  逐字「同步腳本不需 design-reference submodule」(兩處)
      ⇒ 數法:`grep -rn 'submodules' .github/workflows/` ⇒ 4 行;
        而跑 `pnpm test` 的**只有 `ci.yml`** —— 🔴 **數法要用真的分母**(審查 M4-b:原本附的
        `grep -n … .github/workflows/ci.yml` **只掃 ci.yml, 永遠報不出別的檔 ⇒ 零判別力**):
        `grep -rn 'run: pnpm test' .github/workflows/` ⇒ **2 行** —— `ci.yml` 一行是精確的 `pnpm test`,
        `e2e-prod.yml` 那行是 `pnpm test:e2e:prod`(**前綴命中, 不是同一個指令**)。負對照 `run: pnpm test-nosuch` ⇒ 0。
      ⇒ 🔴 **只有 ci.yml 需要 submodule。不要順手三支一起改** —— 另外兩支是純成本、零收益。
      🔴 **而「只有 ci.yml」原本只是從指令字面推的**(審查 R3 點名:同檔 `§9` 自己承認沒查 build/config)。
      📏 2026-08-27 補量:源碼(`apps` + `packages`, 排除 `.next` / `node_modules` / 測試檔)
         含 `design-reference` 的行 **79**, **逐行看全是註解**;非註解的 2 行是 JSX 註解與字串。
         `next.config` / `vitest.config` / `tsconfig*.json` ⇒ **0**。
         ⚠️ 負對照那一發**印 1 不是 0** —— 命中的是測試檔裡**在講負對照的那句話**(尺撞到談論自己的文本)。
      ⇒ **除了那支測試, 沒有別的東西在 build 期讀稿** ⇒ 這個分母現在是量到的, 不是推的。
         ⚠️ 天花板:這把尺答的是「誰寫了這個字串」, 不是「誰讀了那個目錄」;**間接相依要跑 trace 才答得出**。

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

📌 相關:`.github/workflows/ci.yml`(grep `submodules`)· `scripts/commit-pack-preflight.sh`(grep `submodule design-reference`)·
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

> 🔴 **§11-3 的停點【一半被解掉了】, 2026-08-27 同日 —— 見 `§12`。不要只讀到這裡就走。**
> · `Q-945-2`(拉不到怎麼辦)**不是 Sean 拍的, 是線4 自己決定的**(選甲)。
>   自決的理由:它**可逆**、**不改任何人的 rc**、且它是這支腳本的預設行為, 不是一個對外承諾。
>   而**「要不要改成紅」這個取捨仍然開著** ⇒ 那一格要 Sean 拍, 寫在 `§12-2`。
> · `Q-945-1`(哪一種鑰匙)**原封不動地卡著** ⇒ 片B 一行都沒動。
> 📌 **一份 plan 裡兩個相反的現行狀態, 讀者只會撞到先讀到的那個** ⇒ 照本 repo 慣例劃記、不刪原文。

---
---

# ✅ §12 片A(沙箱)**已做**;片B(CI)**沒做**,卡在哪一題寫死在這裡

> 2026-08-27 線4 施工。派工來源:主視窗 `pcm-website-v2-5b` 轉述,來源屬性=**讀來**
> (`~/.claude/rules/00-work-rules.md:98` 轉述契約①)。
> 🔴 **這一節刻意分成「做了什麼」與「沒做什麼」兩半 —— 不要只讀上半。**

## 12-1 做了什麼(兩支檔,零 `.github/` 改動)

```
① scripts/commit-pack-preflight.sh
   `git worktree add --detach` 之後加一步 `git submodule update --init design-reference`
   · 拉得到 ⇒ 印「已帶進沙箱 ✅」
   · 拉不到 ⇒ 印警告 + **檔尾那個 ✅ 被加註「不涵蓋讀 design 原稿的那一格」**, 而 **rc 不變**
② apps/storefront/src/components/account/tabs/WalletTab.test.tsx
   `HAS_DESIGN_SUBMODULE` 的天花板段改寫:沙箱那一半已做 / CI 那一半沒做, 各自寫清楚
🔴 `.github/` 底下**一個字都沒動** —— `rpm-sync.yml` 今天是 `-de` 在動, 兩個窗不同時動它。
   數法:`git status --porcelain` ⇒ 我的兩支不含 `.github/`;`.github/workflows/rpm-sync.yml` 那支的
   髒是 `-de` 的, 不在我的包裡(preflight 的「主樹另有髒檔」候選名單當場印出它)。
```

## 12-2 🔴 `Q-945-2` 我選了甲,而 codex ⑤ 說甲留著 fail-open —— **兩句都對**

```
甲 = 拉不到照舊跑完、印一句。理由(不變):preflight 是每個窗每次收包都要跑的東西,
     變成「網路不通就不能 commit」⇒ 大家開始繞過它, 而**被繞過的守門比沒有守門更糟**。
codex ⑤ = 「本片宣稱要收的那個 fail-open 原封不動」⇒ **針對【拉不到】那一支路徑, 它是對的。**
🔴 而它們不衝突, 因為分母不同:
     改動前 = 沙箱裡那一格【永遠】skip, 而**沒有任何一行字提到它**
     改動後 = 沙箱裡那一格**在「submodule 拉到且在釘住的 SHA」時會跑**, 而沒拉到的那幾次
            **會印出來、且綠的射程會縮**(⚠️「通常」是頻率副詞、沒量過 —— 審查 N5/M4-a 兩次點名)
   ⇒ 這是 **縮小 + 顯影**, 不是 **收掉**。本檔與程式碼註解一律照這個字面寫。
⇒ 仍然開著的題(不是我能拍的):**拉不到的時候, 那個 skip 要不要變成一個看得見的紅?**
   甲(現行)= 不紅, 而綠的射程會縮  ·  乙 = 紅
   👉 我做甲, 理由如上;要改成乙, 那是「寧可誤擋也不漏抓」的取捨 ⇒ Sean 拍。
```

## 12-3 驗收:兩個世界各餵一發,**印出不同的東西**(2026-08-27 實跑)

```
🔴 同一棵 worktree、同一次 pnpm install ⇒ **唯一的變數是 submodule 在不在。**
世界B  建樹當下 design-reference 檔數 = 0
       npx vitest run …/WalletTab.test.tsx ⇒ `Tests  15 passed | 1 skipped (16)`   rc=0
世界A  同一棵樹 `git submodule update --init design-reference` ⇒ rc=0
       log 第一行 `Cloning into '…/wt945/design-reference'…`(⇒ 每次都是全新 clone, 走網路)
       `components/WalletTab.jsx` ⇒ 在
       同一支測試再跑一次 ⇒ `Tests  16 passed (16)`                                  rc=0
⇒ **15+1skip ↔ 16 passed** —— 兩個世界印不同的值, 不是兩個綠。

  負對照(證明量的是對的東西):世界A 把 `wal-tier-card` 改名成 `-v2`
  ⚠️ **「5」要帶著尺走**(審查 N2 點名沒有分母;複量後兩個數都對, 差的是尺):
     `grep -o` **出現次數** ⇒ 測試檔 **5**(HEAD 版同為 5)· `grep -c` **行數** ⇒ **4**
     · 稿那一側 `design-reference/components/WalletTab.jsx` ⇒ **1**;整個 `design-reference` ⇒ **2**
     · 負對照 `wal-tier-card-nosuch` ⇒ **0**   ⇒ 我改的是**測試檔裡的 5 個出現處**。
  ⇒ `Tests  1 failed | 15 passed (16)`, 紅的正是
    「🔴 正對照:這三個字面在 design 原稿上【真的找得到】」那一格 ⇒ **只紅一格、且是對的那格。**

本腳本自己的兩個世界(全套 preflight 各跑一發, 包=上面那兩支檔):
  世界A(可連)   `submodule design-reference: 已帶進沙箱 ✅` … 檔尾**沒有**加註 · rc=0
  世界B(`GIT_SSH_COMMAND=/bin/false`)
                `⚠️ submodule design-reference 拉不到…` … 檔尾**多一行**
                `⚠️ 而 design-reference 沒帶進沙箱 ⇒ …這個 ✅ 不涵蓋它。` · rc=0
  ⇒ 兩發都 rc=0(**這是刻意的 = 甲**), 而**印出來的字不同** ⇒ 判別力在字面上, 不在 rc 上。

  🔴 **上面那兩發是【修 M1 之前】跑的。修完之後 11:2x 重跑一次, 兩個世界仍印不同的字**
     (包=三支檔):世界A `submodule design-reference: 已帶進沙箱 ✅` / 檔尾**無**加註 / rc=0;
     世界B `⚠️ …沒進來(離線 / 沒金鑰 / update=none?)` / 檔尾**有**三行加註 / rc=0。
  🔴 **而 M1 那個世界要另外餵一發** —— 它是「rc 綠而目錄空」, 前兩發都碰不到它:
     `git -C <wt> -c submodule.design-reference.update=none submodule update --init design-reference`
       ⇒ `git_rc=0` · `ls -A` 計數 **0** · 新閘判 **missing** ✅(舊的 rc 閘會判 ok ⇒ 那正是 M1)
     同一棵樹接著真的拉 ⇒ `ls -A` 計數 **12** · 新閘判 **ok** ✅
     ⇒ **三個世界、三種輸入, 而閘只在第三個說 ok。**

  ⚠️ **N6 計時:這一步加了多少時間, 我【沒有乾淨地量到】。**
     手上只有兩發被污染的數:世界A **137 秒** / 世界B **85 秒**(同一包三支檔, 2026-08-27 11:2x)
     —— 而 A 跑在前面、turbo 與 pnpm store 的冷熱不同 ⇒ **那個 52 秒的差不能歸因給 submodule。**
     要乾淨的值:同一棵樹跑兩次、只切 `GIT_SSH_COMMAND`, 而我沒跑 ⇒ **標未量。**
     已知的量級參考:`.git/modules/design-reference` = **25M**, 且每棵新 worktree 是全新 clone。

收攤零留痕:`git worktree remove --force` rc=0 · `git worktree prune` ·
           主樹 `git status --porcelain` **沒有新增**我這幾支以外的東西(無新 worktree、無殘骸)。
           ⚠️ **這裡刻意不寫「別線有幾支髒檔」** —— 八個窗同時在寫, 那個數字**每分鐘都在動**
              (11:04 量到 4、11:17 量到 14)⇒ **它不是一個可以寫進檔案的數字, 只能當場跑。**
⚠️ 一個我不留著不解釋的數字:本次 `ls -1 design-reference | wc -l` ⇒ **10**,
   而 `§11-1` 寫 **12** —— `ls -1` **不含隱藏檔**(`.git` / `.DS_Store` 等)⇒ **兩把不同的尺**,
   不是拉少了。要比就用同一把。
```

## 12-4 🔴 **片B(CI)沒做。** 它卡在什麼,寫死在這裡

```
`.github/workflows/ci.yml` 的 checkout 仍然是 `submodules: false`
⇒ **那一格在 CI 上到今天為止從來沒有跑過, 而 CI 是綠的。**(這正是 §7 那句:skip 掉的時候也是綠的)
卡:Q-945-1 —— deploy key 還是 fine-grained PAT。**兩條都要在 GitHub 上放一個秘密**
   ⇒ 我碰不到 repo settings、碰不到 `.env*` ⇒ **不是我做得完的, 也不該由我選權限範圍。**
而在鑰匙就位【之前】不可以先改 ci.yml —— 先改就是把 CI 弄紅, 紅的是**每一個人的每一個 PR**。
⚠️ 而片B 還有一格連題目都還沒寫成選項:**fork PR 與 Dependabot 拿不到 secret**(§11-2 ③)
   ⇒ 那是本片會弄壞、而我原本完全沒想到的族群 ⇒ 片B 開工前要先把它變成一個可回答的題。
📌 ⇒ **不要把 §12-1 讀成「#945 做完了」。** 做完的是它的一半, 而另一半是它原本的主要目的。
```

## 12-5 `code-reviewer` R1 = **FAIL**(1 Critical + 3 must-fix + 8 nit)

> 🔴 **本節原本的標題寫「⇒ 全數修完」, 而 R2 證明那句話是假的**(M1 沒修好、N5 只修一半)
> ⇒ 已拿掉。**「我修完了」是最不該由修的人自己宣告的一句話。** 實際結果看 `§12-7`。

> 授權來源:**使用者本人在本窗開場的常設授權**(逐字「我(使用者)要求你在需要時自行呼叫
> code-reviewer subagent 來審查你自己的產出」)。opus / fresh context / 唯讀。

```
M1 🔴 Critical  `SUBMOD=ok` 掛在 git 的 rc, 而 `-c submodule.…update=none` ⇒ **rc=0 而目錄是空的**
                ⇒ 印「已帶進沙箱 ✅」、測試照樣 skip、檔尾加註**不觸發**
                ⇒ **fail-open 原封回來, 還多穿了一件綠 —— 比改動前更暗。**
   ✅ 改成 `[ -n "$(ls -A "$W/design-reference" 2>/dev/null)" ]`(判目錄, 不判 rc)
   📌 母題:**「指令成功」與「東西在那裡」是兩個宣稱, 而它們印同一個 0。**
M2 沒有 `< /dev/null` / `GIT_TERMINAL_PROMPT=0` / ssh `BatchMode`+`ConnectTimeout`
   ⇒ 連線卡住時**零輸出地停住**, 且 git 自己 `Retry scheduled` ⇒ 等待 ×2
   ✅ 三個旋鈕都加。🔴 而世界B 用 `/bin/false` 是**瞬間失敗** ⇒ 這條「慢/卡住」的路**仍未實測**。
M3 檔尾那行加註對【包內容】零條件 ⇒ 包裡沒那種測試時它印一句**假話**, 而八個窗都會看到
   ✅ 改成條件句 +「數法與分母住在哪」的指標。
M4 同一份檔裡兩個相反的現行狀態(`§11-3` 說「都要人拍」vs `§12-2` 說「我選了甲」)
   ✅ `§11-3` 補劃記, 並寫明 `Q-945-2` **是線4 自決、不是 Sean 拍的**。
nit ✅ 全清:N1 髒檔數改成「當場跑」· N2 「5 處」補上尺(出現次數 5 / 行數 4, 兩個都對)
        · N3 行號改 grep 錨 · N4「必然」改「吻合但未證實」· N5 頻率副詞「通常」改成它依賴什麼
        · N6 新加的這一步**沒有人重計時** ⇒ 明寫未量 · N7 trap 補 `worktree prune`
        · N8 本機 clone(`protocol.file.allow=always`)**評估過而不做**, 代價寫進註解
```
🔴 **審查打過而打不破的它也逐條列了(R1-R8)** —— 那一段比 findings 更有用:
   它讓「沒被報的」與「沒查的」分得開。逐字保留在 session log,不進 repo。

## 12-6 ⚠️ 一則**轉述**在本片當場被證偽 —— 留著,因為它的形狀比內容重要

```
主視窗 `-5b` 急件轉述(來源=`-de` 的 code-reviewer):
  「rpm-sync.yml 的 submodules: false 已從 :77/:111 漂到 :82/:116」
🔴 我當場重量(11:17):`grep -rn 'submodules' .github/workflows/` ⇒ **仍是 :77 / :111**;共 4 行;
   負對照 `submodules-nosuch` ⇒ 0。而 `-de` 那顆 commit 的標題逐字「**零位移保住下游行號**」。
⇒ **那個 finding 講的是它的第一版草稿, 而轉述時變成了「現況」。**
📌 而主視窗自己標了來源屬性(逐字「`-de` 自己沒有獨立複量, 我也沒有 ⇒ 你自己核一次再用」)
   ⇒ **這一則沒有造成損害, 靠的正是那一句標註。**
✅ 而它建議的動作**仍然採用**:本檔所有 `.github/workflows/*.yml` 的行號引用**全部改成 grep 錨**
   (數法:`grep -rn 'submodules' .github/workflows/` ⇒ 4;`grep -n 'run: pnpm test' …/ci.yml`)
   ⇒ 一個**被證偽的警報, 仍然指出了一個真的脆弱點。**
```

## 12-7 `code-reviewer` R2 = **FAIL**(1 Critical + 6 must-fix + 5 nit)—— **它打穿了我 R1 的修法**

> 同一個 subagent 型別、fresh context、唯讀。派它的理由:R1 是 FAIL ⇒ 照輪次紀律必跑 R2。

```
🔴🔴 R2 最重的兩條, 都是【我以為修好了】的地方:

C1  沙箱從頭到尾**印不出 skip 數** ⇒ 本片「顯影」那個核心宣稱**沒有觀測管道**
    `commit-pack-preflight.sh` 只 grep `Test Files` 那行, 而 skip **只出現在 `Tests` 那行**。
    實測 `Test Files 1 passed (1)` / `Tests 6 passed | 10 skipped (16)`
    ⇒ **10 格 skip 被印成一個乾淨的 passed**, 而 `.vt.log` 被 trap 刪掉 ⇒ 事後也查不到。
    ✅ 改成兩行都印。
    📌 而 `WalletTab.test.tsx` 裡那句「skip 會出現在 vitest 摘要 ⇒ 看得到」——
       **在【主樹手動跑】為真, 在【這個沙箱】為假**, 而我拿前者的經驗替後者背書。

M1-回歸 🔴 **我沒有修好 M1, 我是把假綠從 rc 搬到 ls。**
    R2 構造:remote 缺被釘住的那顆 SHA ⇒ `rc=128` + `did not contain <sha>`,
    而目錄裡留下一個 `.git` ⇒ `ls -A` = **1** ⇒ 新閘照樣說 ok, 而稿根本不在。
    ✅ 第三版 = `git submodule status` 首字元(2026-08-27 逐一實測三世界):
         " " 在釘住的 SHA(唯一放行) · "+" 在別的 SHA · "-" 沒初始化
    ⚠️ 而它**仍有一個看不見的世界**:clone 全成功、SHA 也對, 而**稿在上游被改名/搬檔**
       ⇒ 閘說 ok 而 `existsSync` false ⇒ 靜靜 skip。**那一格靠 C1 印出的 skip 數, 不靠這道閘。**
       📌 **閘的謂語(submodule 在正確的 SHA)與消費端的謂語(那支 .jsx 檔在)不是同一句話。**

M2-a  我寫「clone 失敗留下的是空目錄、porcelain=0」—— **那是從 `/bin/false` 那一種失敗外推的**。
      缺 SHA 那種留下 `.git` ⇒ porcelain=` M design-reference` ⇒ **既有那道 dirty 閘會開火**,
      印「新樹 dirty=1 ⇒ 量測作廢」⇒ **一個理由錯的紅**。已知、未修(修它要動既有閘, 不屬片A)。
M2-b  `ConnectTimeout` **結構上擋不到「已連上但傳到一半失速」**(`man ssh_config` 逐字:
      它只管 establishing + initial handshake)⇒ 我把「未實測」與「不涵蓋」混為一談。
      ✅ 補 `ServerAliveInterval=10` `ServerAliveCountMax=3`, 並改寫那句宣稱。
M4-a  我在 `§12-5` 寫「nit 全清」, 而 `§12-2` 的「通常會跑」**原句還在** ⇒ 腳本那份改了、plan 那份沒改。
      📌 **同一句話寫在兩個地方, 修一處會產生「已經修了」的感覺。**
M4-b  我附的數法 `grep -n 'run: pnpm test' .github/workflows/ci.yml` **只掃 ci.yml**
      ⇒ 對「只有 ci.yml 跑 pnpm test」這個宣稱**零判別力**(尺永遠報不出別的檔)。
      ✅ 改成 `grep -rn … .github/workflows/` ⇒ 2 行(`e2e-prod.yml` 那行是 `test:e2e:prod` 前綴命中)。
M6    我否決 N8(本機 clone)寫了兩條理由, 而**第二條實測是假的** ——
      「主樹沒 fetch 到新 SHA 會用一個看起來成功的舊物件」⇒ 實測是 `rc=128` **大聲失敗**。
      ✅ 只留真的那一條(重開 file transport / CVE-2022-39253), 仍不做。
      📌 **兩條理由的否決句與一條理由的否決句讀起來一樣有說服力, 而只有一條是真的。**
nit ✅ 全清:n1 註記塞在句子中間且在 fence 內(修 M4 的動作自己造了新的閱讀障礙)
        · n2 `worktree prune` 補上「它在防哪個世界」+ 實測對別線 worktree 無影響
        · n3 git 的 stderr 原本整條丟掉、然後用猜的列舉原因 ⇒ 改成把 git 自己那行印出來
        · n4 使用者已設 `GIT_SSH_COMMAND` 時**先出現的選項贏** ⇒ 這道保護對他失效, 寫成天花板
        · n5 echo 裡的 markdown 粗體改掉
```
🔴 **兩輪的共同形狀, 寫在這裡當作本片最貴的一句**:
```
R1 說「別用 rc」⇒ 我換成 ls ⇒ R2 說「ls 也會假綠」⇒ 我換成 submodule status
📌 **每一把新尺都自帶一組它看不見的世界, 而【我剛修好一個坑】是最不會回頭再量的時刻。**
⇒ 動作版:換掉一把尺之後, 立刻問「這把新的在哪一個世界會說謊」, 並且**餵那個世界一發**。
```

## 12-8 最終驗收(R2 修完之後重跑;2026-08-27)

```
【閘】四個世界各餵一發, 而閘只在第三個說 ok:
  1 沒初始化                       首字元=[-] ⇒ missing
  2 update=none(**git rc=0**)     首字元=[-] ⇒ missing   ← R1 的 M1 那一格
  3 真的拉到且在釘住的 SHA          首字元=[ ] ⇒ ok
  4 在別的 SHA                     首字元=[+] ⇒ missing   ← R2 的 M1-回歸那一格
  ⇒ **一把尺、四個輸入、三種拒絕。**(舊的 rc 閘在 2 說 ok;舊的 `ls -A` 閘在 4 說 ok。)

【全套 preflight】同一包三支檔, 只切 `GIT_SSH_COMMAND`:
  世界A  `submodule design-reference: 已帶進沙箱(status=在釘住的 SHA)✅`
         `Test Files 1 passed (1)` / `Tests  16 passed (16)`   / 檔尾**無**加註 / rc=0
  世界B  `⚠️ submodule design-reference 沒進來(submodule status 首字元=[-])`
         + **git 自己那行** `Failed to clone 'design-reference' a second time, aborting`
         `Test Files 1 passed (1)` / `Tests  15 passed | 1 skipped (16)` / 檔尾**有**加註 / rc=0
  🔴 **`Test Files` 那一行在兩個世界【完全相同】** —— 判別力整個住在 `Tests` 那一行,
     而那正是 C1 之前沒有印出來的那一行。**修 C1 之前, 這兩個世界在畫面上是同一個。**

【三綠】2026-08-27 11:2x-11:3x, `TURBO_FORCE=1`
  · 乾淨沙箱(HEAD + 我這三支)⇒ install/typecheck/lint/build/vitest **全 0**, 兩個世界各一發
  · 全樹 lint=0 / build=0;**typecheck=2** —— 紅在 `scripts/test-env-isolation-gate.test.ts(70,17)`,
    那支是**別條線的 untracked 檔**(`git status --porcelain` 顯示 `??`)⇒ **不是我的面**。
  ⇒ 照本窗規矩:**不宣稱三綠**。我的檔在乾淨樹上逐支過。
```


## 12-9 R3 = **codex**(換引擎、換角度)= **FAIL** —— 而它換掉的是**框架**,不是細節

> `codex exec -s read-only`(`codex-cli 0.144.1`,stdin 導掉)。派它的理由照輪次紀律:
> **第 3 輪起必須換角度、換模型** —— 前兩輪都是 Claude,與寫這段碼的是同一個腦。

```
🔴 它的頭條, 前兩輪【都沒有想到】, 因為前兩輪都在問「這道閘準不準」:
   逐字「一支 Wallet 測試讓所有 commit 包無條件連私有遠端;八窗同收包會產生八次 SSH clone,
        即使包內完全沒有相關測試。」
   ⇒ 而它是對的, 而且有一個**決定性的事實**我自己寫過卻沒用上:
     **本腳本的 vitest 只跑【包內的】測試檔** ⇒ 包裡沒那支測試 ⇒ 它在沙箱裡本來就不會跑
     ⇒ **拉了 100% 是浪費。**
   📌 **我修了兩輪「這把尺準不準」, 而沒有問過「這件事需不需要做」。**
      前兩輪的每一條 finding 都預設了「無條件拉」這個框架, 而框架本身沒有人碰。

✅ 改法(片A 第二版):**只在包裡有【讀稿的測試檔】時才拉。**
   判別:包內 `*.test.ts(x)` 逐支 `grep -q design-reference`(不看 .md —— 一份**談論**它的文件
   不該觸發一次 clone;第一版就這樣多拉了一次, 被世界C 那一發抓到)。
   成本量到了(N6 那格終於有值):一次 clone ≈ **6 秒 / 25M**(2026-08-27, 本機, 單發)
   ⇒ 現在只有真的需要的包付這 6 秒。

✅ 同時修掉的:
   · 失敗的 clone 留 `.git` 殘骸 ⇒ 觸發「新樹 dirty ⇒ 量測作廢」這個**理由完全錯的紅**
     (R2 的 M2-a / R3 都點名)⇒ 失敗時 `submodule deinit -f` 清乾淨再往下走(實測 porcelain 空)。
   · 「顯影」靠解析 vitest 給人看的摘要 ⇒ 格式一改就抓不到, **而抓不到會印一個空行**,
     空行與「沒有 skip」長得一樣 ⇒ 抓不到時改印一句紅字, 不印空行。
   · 檔頭「等 Sean 批、一行未改」與 `§12` 相反 ⇒ 拆成片A/片B 兩句。
   · 測試檔註解仍寫「判別掛在 `ls -A`」⇒ **R2 打掉的舊機制被寫成現況** ⇒ 已更新。
   · 「只有 ci.yml 需要 submodule」原本只是字面推論 ⇒ 已補量(見 `§3`)。

⚠️ **它有一條我不照著改, 而理由要寫下來**:
   R3 說「做一半掛在共用綠燈裡, 比暫不做更不誠實」。
   ⇒ 我的回答:**片A 現在的形狀不是「做一半」, 它是一件完整的小事** ——
     「包裡有讀稿的測試 ⇒ 沙箱裡讓它真的跑;拉不到 ⇒ 說出來並縮小那個綠的射程」。
     它自成一個閉環, 不依賴片B。而**片B 沒做這件事寫在三個地方**(檔頭 / `§12-4` / 測試檔 docstring)。
   ⇒ 但**它指出的風險是真的**:讀者只看綠燈時不會讀那三個地方。
     ⇒ 這就是為什麼那個綠**自己會印出射程**, 而不是靠文件。

⚠️ **仍然沒做、也沒有人做的**(不藏):
   · 八窗同時收包的峰值 / SSH 併發 / GitHub 節流 —— **未量**(單發 6 秒是單發的值)
   · design repo 明天被改名或撤權時誰先撞到 —— **未推演**(而條件化之後受害面只剩「動那支測試的人」)
   · 稿在上游被改名/搬檔 ⇒ 閘說 ok 而測試靜靜 skip ⇒ **靠 `Tests` 那行的 skip 數看見, 不靠閘**
```
