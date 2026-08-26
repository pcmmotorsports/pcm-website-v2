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

## 2. 🔴 一個可能讓整片做不成的前置(排在最前面)

**`design-reference` 是【另一個 repo】,而 `.gitmodules` 用 SSH URL。**

```
actions/checkout 預設用 GITHUB_TOKEN, 而該 token 的權限【只涵蓋當前 repo】
⇒ 若 pcm-website-design 是私有, 光加 `submodules: true` 會【checkout 失敗】,
  失敗形狀是 CI 整條紅, 不是那一格 skip
⇒ 要另外配 deploy key(`ssh-key:`)或一顆有跨 repo 讀權的 PAT
```
⚠️ **兩件都未查,標未確認**:
① `pcm-website-design` 公開還是私有 —— 查它要對 GitHub 發請求 / 要 Sean 的帳號。
② 上面那句 token 權限範圍 —— **那是我的既有知識,不是當場讀的官方文件**
   ⇒ 實作前要親讀 `actions/checkout` 官方 doc,不憑記憶。

👉 見 `§6 Q-945-1`。**它答之前 `§3` 第 ② 步不能排時程。**

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
Q-945-1  `pcmmotorsports/pcm-website-design` 是公開還是私有?
   甲 公開  ⇒ 只改 `submodules: true` + 沙箱那一行, 本片很小、我一個人做得完
   乙 私有  ⇒ 要在 GitHub 上加一把 deploy key(或 PAT)⇒ **那一步只有 Sean 做得到**
   👉 我沒有查(要對 GitHub 發請求 / 要他的帳號)⇒ 標未確認, 不猜。
   👉 **猜錯的代價不對稱**:猜公開而其實私有 ⇒ CI 整條紅, 每個 PR 都紅。

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
· `pcm-website-design` 公開還是私有 —— **沒查**(§2 / Q-945-1)
· actions/checkout 對私有 submodule 的確切行為 —— **我的既有知識, 非當場查證** ⇒ 未確認
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
