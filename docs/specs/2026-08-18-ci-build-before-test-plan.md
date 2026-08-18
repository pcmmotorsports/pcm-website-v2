# Plan · CI 在 `Test` 之前補一步 `build`（鐵則 8 + 鐵則 12④）

> 🔴 狀態(2026-08-18 13:4x G1 更新)：**Sean 已批(`Q1=甲` 照 plan 改 / `Q2=乙` 不開 PR、直接進 dev)，`ci.yml` 已動、未推。**
> ~~尚未批准，`ci.yml` 未動~~。提案人 W1（dev 守門），執行 G1。
> Sean 逐字只有一句「5 題依照建議」⇒ **內容在 `~/pcm-mailbox/MAIN-021-給G1-Sean批了CI-20260818.md` 貼的選項原文裡**，不在那句話裡。
> 🔴 **他沒批的**：feature branch 紀律例外（走乙之後不必答，不是被批准）。**不要記成他批了。**
> 量法（可重跑）：`grep -c 'pnpm --filter @pcm/admin build' .github/workflows/ci.yml` ⇒ **1**；
> `git rev-list --count origin/dev..dev` ⇒ 非 0（未推）。
> ~~量法：`git status --porcelain .github/workflows/ci.yml | wc -l` ⇒ **0**~~ —— **這句 2026-08-18 13:4x 起為假**：
> 那一步已經插進去了（未 commit 時該量法 ⇒ 1、commit 後 ⇒ 0，**兩個 0 意思相反**，別拿舊的那個 0 當「還沒動」）。
> 現行量法：`grep -c 'pnpm --filter @pcm/admin build' .github/workflows/ci.yml` ⇒ **1**（改前 0）。
> 正向對照（證明這把尺對這個檔量得到東西）：`grep -c 'run:' .github/workflows/ci.yml` ⇒ **8**（插入前 7）。
> 🔴 裁定：主視窗 2026-08-18 11:5x 裁【乙】(只 build admin)——~~11:1x 那版裁【甲】已被推翻~~,
> 理由與推翻過程在 §9-c(:427)與 :103。`ci.yml` = 鐵則 12④ 平台設定 ⇒ 需 codex 對抗審查 + Sean 批。
> 🔴 本檔所有「現況」句都附可重跑量法。量測時點 2026-08-18 11:1x CST、`dev = a482b428`。

---

## 1. 動機：一個恆紅的訊號，跟一個恆綠的訊號一樣沒有判別力

W5 的原句（本案的立論核心）：

> **「一個恆紅的訊號與一個恆綠的訊號一樣沒有判別力 —— 兩者都在『有事』與『沒事』印同一個東西。
> 恆綠至少還會被人懷疑；恆紅會被人習慣，而習慣比誤判更難逆轉。」**

⇒ 這不是一個「CI 有一格紅」的技術問題，是一個**會自我惡化**的問題：
每多紅一天，下一次真的壞掉時那個紅就更不會被當一回事。

📌 而 `STATUS.md` Blocker 已經逐字寫著 CI 的處境：
**「CI 不是閘、是事後警報，而【沒有人在看】」** ⇒ 一個沒人看的警報再變成恆紅，等於徹底報廢。

---

## 2. 現況（每條各附量法；量測時點 2026-08-18 11:1x CST、`dev = a482b428`）

### 2-a CI 現在是紅的，而且是新紅的

```
gh run list --branch dev --limit 4 --json headSha,name,status,conclusion
  CI                     run 32094343674  sha a482b428  completed / FAILURE
  E2E (production build) run 32094343689  sha a482b428  completed / success
  （前一顆 74001357 昨天的 CI 與 E2E 皆 success）

失敗位置：job `check` → 第 9 步 `Test`
Test Files  2 failed | 520 passed | 1 skipped (523)   Failed Tests 6
CI 整趟耗時：03:07:44Z → 03:11:05Z = 3m21s（201 秒）
```

### 2-b 根因：`ci.yml` 沒有 build 步驟，而有兩支測試需要建置產物

```
grep -cE "pnpm build|turbo run build" .github/workflows/ci.yml   ⇒  0
🔴 正向對照(0 命中要附分母與一把量得到東西的尺):
   grep -c "name: Test" .github/workflows/ci.yml                 ⇒  1   ← 同一把 grep 對同一個檔量得到
   grep -c "run:"       .github/workflows/ci.yml                 ⇒  7   ← 分母：這個檔共 7 個 run 步驟
⇒ 那個 0 是量出來的,不是尺壞掉。

現行步驟順序（`.github/workflows/ci.yml`）
  :32 Install dependencies
  :35 Typecheck
  :38 Lint
  :47 Install Playwright chromium
  :50 Test            ← 🔴 前面沒有任何 build
```

兩支失敗檔的錯訊息（**它們自己寫的**，原文）：

```
apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page-measure.test.tsx
  Error: 找不到建置產物目錄 .../apps/admin/.next/static/chunks —— 請先跑 `TURBO_FORCE=1 pnpm build`。
        這【不是】版面出問題,是還沒 build。

apps/admin/src/components/orders/orders-status-visibility-browser.test.tsx
  Error: 找不到含 .orders-grid / .col-status 的編譯後 CSS(掃到 0 支 .css)。本檔量的是真瀏覽器
        computed style,沒有真 CSS 就沒有判別力 ⇒ 這裡刻意【紅】而不是 skip。
        修法:先跑 TURBO_FORCE=1 pnpm build。
```

🔴 **兩支同一個病、同一句修法。而作者是刻意讓它紅而不是 skip** —— 那是對的紀律：
skip 會讓「有守門」悄悄變成「有宣稱」。**問題不在測試，在 CI 少一步。**

### 2-c 為什麼是現在才紅（它是新的，不是一直紅）

```
git cat-file -e 74001357:'apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page-measure.test.tsx'
  ⇒ 不存在（昨天綠的那顆沒有這支檔）
它 2026-08-18 進 dev：91df7f90 03:18 / 0bf90df3 03:31 / 5bcaa219 04:15
```

### 2-d 🔴 這不是新風險，是一個掛著的待決策到期了

`STATUS.md:22` 待辦第 ⑤ 條逐字：
**「`#544` 編譯產物 `border-radius` 斷言（要一個 CI 順序的決定）」**

⇒ 形狀值得記進制度：
**一個「待決定」的條目，跟一個「已知會出事」的條目，在 backlog 上長得一模一樣 —— 差別只在有沒有人排它。**

### 2-e 為什麼本機四綠是綠的、CI 是紅的（兩邊都沒說謊）

```
scripts/dev-four-greens.sh 的順序：typecheck → lint → build → vitest
ci.yml 的順序：              typecheck → lint → （無 build）→ test
```
⇒ 同一顆 commit、兩個結果，差的是量測順序。
🔴 **推論（要進 W1 之後每一份四綠報告的限定）：本機四綠對「CI 會不會過」沒有判別力。**

---

## 3. 要改什麼

> 🔴 **2026-08-18 11:5x 裁定更新：採【乙】(只 build admin)，不是甲。**
> 經過 R1/R2/R3 三輪與 §9 的重新推導，**本節原本寫的甲已被取代**。原文保留在下方刪除線裡，零刪除。
> 主視窗自陳它兩次都錯在同一個地方（原文）：**「我在權衡兩個方案的【性質】，而沒有先問【需求到底是什麼】。」**

### 3-a 現行提案（乙）

`.github/workflows/ci.yml`，在 `:50 Test` **之前**插入一步：

```yaml
      # 🔴 **註解正本在 `.github/workflows/ci.yml`(那一步的上方)，不在這裡。**
      #    ~~本區塊原本抄了一份完整註解~~ —— 2026-08-18 13:5x G1 拿掉(codex 關卡2 R2 三條 must-fix)：
      #    R1 的三條修正只折進了 workflow，**這份複本原封不動地留著錯的字面**
      #    (「admin 產物就是需求的全部」/ 被自己註解染色的 `grep -c 'env:'` / 「不會失敗」)
      #    ⇒ **一份提案裡的 code 複本，落地之後就是一個沒有人會去更新的第二真相。**
      #    判別句：**這段字有兩個地方在講同一件事嗎？有 ⇒ 其中一份遲早是假的。**
      - name: Build admin (編譯產物類測試的前置)
        run: TURBO_FORCE=1 pnpm --filter @pcm/admin build
```

**只加一步，不動既有任何一步。** 不改測試、不加 skip、不改任何斷言。

### 3-b ~~原提案（甲）~~ —— 已被取代，保留備查

~~`.github/workflows/ci.yml`，在 `:50 Test` **之前**插入一步：~~

```yaml
      # 🔴 `page-measure.test.tsx` 與 `orders-status-visibility-browser.test.tsx` 量的是
      #    【編譯後產物】（.next/static/chunks 與編譯後 CSS）。它們在缺產物時**刻意 throw
      #    而不是 skip** —— skip 會把「有守門」變成「有宣稱」。
      #    ⇒ 少了這一步，CI 恆紅；而恆紅與恆綠一樣沒有判別力。
      #    ⚠️ 順序刻意與 scripts/dev-four-greens.sh 一致（typecheck → lint → build → test），
      #       這樣「本機綠而 CI 紅」不會再是一個要每次重新推理的謎。
      - name: Build
        run: TURBO_FORCE=1 pnpm build
```

**只加一步，不動既有任何一步。** 不改測試、不加 skip、不改任何斷言。

---

## 4. ~~為什麼是甲，不是乙或丙~~ —— 🔴 **整節已被 §9-c 與 Sean 的 `Q1=甲`+`Q2=乙` 取代，照做會走回舊方案**

> 🔴 **2026-08-18 13:5x G1 加註（codex 關卡2 must-fix）**：本節從標題到表格到「仍選甲」那句，
> **講的都是【甲：全 monorepo build】**，而現行方案是**【乙：只 build admin】**（§3-a、§9-c、`ci.yml:76`）。
> **零刪除保留**是因為它記著「丁為什麼被否決」那條理由（那條在乙底下仍然成立）。
> ⚠️ **但只讀本節的人會去改成 `pnpm build`** —— 那正是本檔記過的形狀：
> **改了方案而論證段留在原地沒跟著改。**
> ⇒ 引用本節前先讀 §9-c(`:427` 起) 與 §3-a。
> 📌 **注意「甲」這個字在本檔有兩個意思**：§4 的「甲」= 全 build 方案；
> Sean `Q1=甲` = 「批准，照 plan 改」那個選項 —— **兩者不是同一件事**，別把後者讀成前者。


| 案 | 內容 | 判定 |
|---|---|---|
| **甲（採用）** | `Test` 前插 `TURBO_FORCE=1 pnpm build` | 與本機四綠同序 ⇒ 兩邊從此可比 |
| 乙 | 只 `pnpm --filter @pcm/admin build` | ❌ 兩邊順序仍不一樣；storefront 日後加同類測試會**再犯一次** |
| 丙 | 讓那兩支在無產物時 skip | ❌ 作者已明文拒絕；**把守門變成宣稱**；且 skip 在「有事」與「沒事」印同一個東西 |
| **丁** | 把「需要編譯產物」的測試拆成**專屬 job**：該 job 先 build admin、只跑那批；原 `Test` 保持不 build | ⏸ **codex R1 F4 補上，本 plan 原本漏了這一案**。見下方逐項比較 |

### 4-b 丁案逐項比較（codex R1 F4：「比較丁案的訊號隔離、時間及維護成本後，再裁定甲是否最佳」）

| 面向 | 甲（Test 前插 build） | 丁（拆專屬 job） |
|---|---|---|
| **訊號隔離** | ❌ build 掛了與 test 掛了都紅在同一個 job（雖是不同 step，但 job 層級只有一個紅） | ✅ 產物類失敗與一般測試失敗**分兩個 job**，一眼分得出 |
| **CI 時間** | 序列：build 之後才 test | ✅ 兩個 job 可**並行**，牆鐘可能更短 |
| **與本機四綠的可比性** | ✅ **同序**（typecheck → lint → build → test）⇒「本機綠 CI 紅」不再需要每次重新推理 | ❌ 兩邊結構不同，`§2-e` 那個謎**沒有解掉**，只是換個形狀 |
| **維護成本** | ✅ 加 5 行 | ❌ 要維護一份「哪些測試需要產物」的清單 —— 🔴 **而那份清單會過期，且過期時沒有訊號**（新增一支產物類測試而忘了加進清單 ⇒ 它落回沒 build 的 job ⇒ 又是恆紅） |
| **未量** | build 在 runner 上多久 | 同左，**再加**：並行 job 的排隊時間未量 |

🔴 **codex R2 F4-b 打掉我上面這張表的前提，我照實記**：
> 「丁案未交代原 `Test` 如何排除專屬測試，照現有 `pnpm test` 仍會重跑並恆紅。」

**它對。** 我描述的丁案是**跑不起來的**：另開一個 job 去 build + 跑那批，**原本那個 `Test` job 照樣會再跑一次同樣的測試、照樣恆紅**。
⇒ 真正的丁案還要**多做一件**：把那批從 `pnpm test` 排除（vitest project / exclude 清單）。
⇒ 也就是說 **丁的維護成本比我表上寫的還高**（要維護的不是一份清單，是**兩處必須同步的清單**：專屬 job 要納入、一般 Test 要排除；**任一處漏了就恆紅或漏測，而兩者都沒有訊號**）。
⚠️ **這對甲有利，但那不是我發現的 —— 是審查者打掉我的錯誤描述之後才浮出來的。** 我原本的比較表在跟一個不存在的丁案比。

🔴 **我的判斷（可被推翻）：仍選甲，但丁的「訊號隔離」是真的優點，甲拿不到。**
理由是那條會過期的清單：丁把一個**今天的設定問題**換成一個**每次新增測試都要記得的人工步驟**，而本 repo 今天正是被「有人新增了產物類測試、而 CI 沒跟上」咬到的。
⇒ **這一項請 Sean 或主視窗覆核** —— 我是提案人，不該由我獨自否決 codex 提的替代案。

✅ **主視窗 2026-08-18 已覆核，裁【甲】，並補一條把丁的唯一優勢消掉的理由（原文）**：
> 丁贏在【訊號隔離】—— 但那個隔離，我們【已經用另一種方式拿到了】。兩支失敗檔的錯訊息是**它們自己寫的**
> （「這【不是】版面出問題，是還沒 build」／「沒有真 CSS 就沒有判別力 ⇒ 這裡刻意【紅】而不是 skip」）
> ⇒ **丁靠【結構】分辨紅的種類；甲靠【訊息】分辨，而那些訊息已經寫好了、而且寫得比一個 job 名稱清楚。**

⇒ 再加上 §5-b 的失敗分類表，**甲的訊號隔離足夠**；而甲有丁沒有的：**CI 順序 = 本機四綠順序 ⇒ 兩邊從此可比**（那件今天已經害我們一次）。

---

## 5. 影響面

- **只動一個檔**：`.github/workflows/ci.yml`（加 5 行 + 註解）。零 code、零 schema、零 migration。
- **不影響 `E2E (production build)`**：那是另一支 workflow（`e2e-prod.yml`），本案不碰。
- **不影響本機三綠/四綠**：本機順序本來就有 build。
- **CI 耗時會變長**。
  🔴 **注意分母：下面這組數字是【全 monorepo build】量的（`0 cached, 2 total` = 兩個 app），而現行提案是【乙，只 build admin】** ⇒ **實際會比這組數字短，短多少未量。**
  本機實測 `TURBO_FORCE=1 pnpm build`（兩個 app）：**8.175s / 14.706s / 18.31s / 43.173s**（四發，同一台機器不同負載）。
  📌 這一處是 `scripts/literal-sweep.sh 'TURBO_FORCE=1 pnpm build'` 掃出來的 —— **方案從甲改乙時，這個數字留在另一節沒跟著改。** 正是 `feedback_claimed-sync-but-only-patched-touched-lines` 那個形狀。
  🔴 **GitHub runner 上要多久 = 未量**（`ubuntu-latest` 規格與本機不同，我沒有辦法在批准前量它）。
  ⇒ ~~以 CI 現行 201 秒為基數，估增加一至兩分鐘~~

  🔴 **上面那個估【基準選錯了】(W6 2026-08-18 打回，我採用)**：
  ```
  TURBO_FORCE=1 只繞過 turbo 的快取，繞不過 Next 自己的 .next/cache
  ⇒ 我那四發是【熱的 Next 快取】(同一棵鑽機連跑，43.173 → 18.31 → 14.706 → 8.175s，
     那條下降曲線本身就是快取在生效的證據)
  ⇒ 而 CI 每次都是全新 checkout ⇒ 【永遠是冷的】
  W6 在冷環境實量：@pcm/admin ✓ Compiled successfully in 2.4min
                   @pcm/storefront ✓ Compiled successfully in 2.4min
  ⚠️ 而那還【只是 compile】—— 後面還有 TypeScript 與靜態產生，它落信時尚未跑完
  ```
  ⚠️ **W6 自己標的限定，跟著數字走、不要拿掉**：「我這台是 macOS 筆電、`ubuntu-latest` 規格不同
  ⇒ **`2.4min` 不能當 CI 的值**。它證的是【那個估的基準選錯了】，不是【CI 要 2.4 分鐘】。」
  ⇒ **本欄結論改為：CI 增加的時間【未量，且原本的估法無效】。** 乙只 build admin ⇒ 約為上述其中一半，**仍未量**。
  📌 這條對三案比較有影響：**甲的時間成本被低估**，而丁的賣點之一正是「兩個 job 可並行」⇒ **它把天平往丁推一點**（但丁的兩處清單同步成本未變，見 §4-b）。
  ✅ **而它讓【乙】更強**：乙只 build admin ⇒ **冷編譯只付一次，不是兩次。**
  🔴 **本項在 §9-f 的三分法裡屬第 (b) 種「現在查不到」** —— ~~要真值只能推一次 PR 去量，
  而那件本身就是 §7 驗收 3 的動作~~ **已被 Sean `Q2=乙` 推翻(2026-08-18 13:5x G1 更正)**：
  驗收 3 現在是「**Sean 推 `dev` 之後那一發 CI**」，不是 PR。
  ⇒ 結論那半不變(它仍會在驗收時自然拿到)，**但取得它的動作變成「等他推」，不是「我開個 PR」。**
  ⚠️ 目前能說的只有：**它比本 plan 原本估的高一個量級**，而**確切值未確認**。

  📌 **一個對全陣有用的副產品（W6 發現）**：拋棄式 worktree **天生不帶 gitignored 檔** ⇒
  **它就是一個現成的「乾淨環境」複製品**，要驗「這件事在沒有 `.env` 的地方會怎樣」開一棵就有，不用架東西。
  代價是冷快取所以慢 —— **而那正好也是 CI 的樣子。**

### 5-b 執行面影響（codex R1 F5：「只寫改檔範圍，未分析執行影響」）

- 🔴 **2026-08-18 13:5x G1 更正(codex 關卡2 must-fix)：本項整條是【甲】的影響面，不是現行【乙】的。**
  ~~`pnpm build` 是【全 monorepo】的 build，不只 admin。分母 2（storefront / admin）
  ⇒ 從此 storefront 的 build 失敗也會讓 CI 紅 —— 而它今天不會。這是新增的失敗面，不是零成本。
  ⚠️ 但那個紅是真的紅（storefront build 壞了本來就該擋），不是假紅 ⇒ 判定為可接受。~~
  ✅ **乙底下這件【不會發生】**：落地的是 `TURBO_FORCE=1 pnpm --filter @pcm/admin build`
  （量法 `grep -c 'pnpm --filter @pcm/admin build' .github/workflows/ci.yml` ⇒ **1**；
  反向 `grep -cE '^\s+run: TURBO_FORCE=1 pnpm build$' .github/workflows/ci.yml` ⇒ **0**）
  ⇒ **storefront build 壞掉仍然不會讓 `ci.yml` 紅。**
  🔴 **而「storefront build 沒有人守」是【假的】——我落筆時差點這樣寫，查完才改掉：**
  `E2E (production build)`（`e2e-prod.yml`，同樣 `on: push: branches: [dev, main]` + `pull_request`）
  跑 `pnpm test:e2e:prod` ⇒ `playwright.prod.config.ts` 的 `webServer.command` 是
  **`command: 'node scripts/e2e-prod-preflight.mjs && pnpm build && pnpm exec next start --port 3200'`**
  （`apps/storefront/playwright.prod.config.ts:73` 本體，**不是註解** —— codex R2 打回我第一版只憑
  `:14` 註解就下結論，它對；我回頭讀了 command 那一行）⇒ **storefront build 壞掉，那支 workflow 會紅。**
  ⚠️ **但它守的位置不同**，兩件事不要混：
  ```
  守不守得到 storefront build 壞掉        ⇒ 守得到（e2e-prod）
  紅的時候【那顆已經在 dev 上】了嗎        ⇒ 是（兩支都是 push 後才跑）
  ci.yml 這一支會不會因為它紅              ⇒ 不會（乙只 build admin）
  ```
  ⇒ 所以乙的代價**不是**「沒人守」，是**「訊號分在兩支 workflow，而看的人要記得兩支都看」**。
  ✅ **`reuse 命中就不 build` 那個逃生門在這份 config 上是關的**：同檔 `:75` `reuseExistingServer: false`
  ⇒ 每一發都真的 build。（~~原本寫「涵蓋率未量」~~ —— 那是我只讀註解時的保守話，讀了 code 就不必猜了。）
- 🔴 **新的環境依賴**：build 需要的 env。
  ~~原本寫：`E2E (production build)` 能在 CI build 成功 ⇒ 推論在【同一個 runner】上 `pnpm build` 也建得起來。~~
  **那句是錯的（codex R2 F5-b）**，逐字：「另一支 workflow 並非『同一個 runner』，且未比對 env，不能據此推論本 workflow 能 build。」
  ⇒ **兩支是不同的 workflow ⇒ 不同的 runner 實例、各自的 env / secrets 設定**；`ubuntu-latest` 只是同一個**映像標籤**，不是同一台機器、更不是同一組 env。
  ⇒ **那個推論不成立，整條降級為【未確認】**：`ci.yml` 這支 workflow 能不能 build admin，**在批准前沒有人量過**。
  ⇒ **這是本案最可能在第一發就爆的地方**，而它爆的話症狀很清楚（Build step 紅、不是 Test 紅）⇒ 好診斷、好回滾。
- **失敗分類（給下一個看到 CI 紅的人）**：
  ```
  紅在 Build step  ⇒ 產物建不出來（env / 相依 / 真的編不過）
  紅在 Test step 且訊息含「找不到建置產物」⇒ Build 步驟被拿掉或失序了
  紅在 Test step 其他訊息 ⇒ 那才是真的測試失敗，去讀 diff
  ```
- **CI 成本**：GitHub Actions 分鐘數增加。本 repo 方案未查 ⇒ **未確認**，不宣稱「成本可忽略」。
- 🔴 **codex R1 F1 的限定（我採用）**：本案讓 CI 自己建一份 admin 產物來測，**那份產物不等於 Vercel 線上那份**。
  ⇒ **CI 綠不證線上那份是對的。** 這條要跟結論綁在一起講。

---

## 6. Rollback

```
git revert <該顆 commit>        （單檔、單步驟，無狀態、無資料變更）
```
- 沒有 migration、沒有資料寫入、沒有對外送出 ⇒ **git 層面無殘留**。
- 🔴 **但「無殘留」只在 git 層成立，功能面不成立**（codex R1 F3）：
  ```
  revert 之後那兩支測試【立刻恢復恆紅】—— 也就是回到我們現在要修的這個病。
  ⇒ 「回滾不會比現在更糟」這句只在【回滾當下】為真。
  ```
- 🔴 **而它會隨時間變差**：日後每新增一支依賴編譯產物的測試，單獨 revert 的破壞面就更大。
- **所以 rollback 是有條件、有時效的**：
  ```
  條件 A（可單獨 revert）：dev 上依賴編譯產物的測試檔仍然只有今天這兩支
  條件 B（不可單獨 revert）：多於兩支 ⇒ 必須同時提供替代的 build 前置，不能只把這一步拿掉
  ```
- **回滾的判準不是「有沒有殘留」，是「回滾之後那些測試還有沒有判別力」。**

🔴 **而「怎麼數出那兩支」這件事，我沒有可靠的量法（codex R2 F3-b 打掉我原本那條）**：
```
~~原本寫：grep -rl '找不到建置產物\|編譯後 CSS' apps --include='*.test.*' | wc -l ⇒ 2~~
codex R2 逐字：「用錯誤訊息字串計數無法完整識別所有依賴 build 的測試，rollback 條件會漏判。」
⇒ 它對。那條 grep 只撈得到【剛好用了這兩句中文措辭】的測試。
   一支新測試可以依賴 .next 產物而完全不印這兩句 ⇒ 它對我的尺隱形。
```
⚠️ **所以「現在是 2」這個數字，是【下限】不是【全部】** —— 這正是本 repo 反覆記過的那條：
**量具撈不到目標時，附的是假分母。**
⇒ **這一條標【未確認】**：目前沒有可靠的機械方式列舉「依賴編譯產物的測試」。
   較不糟的代理（仍不完備，明寫它漏什麼）：
   ```
   grep -rln "\.next/\|static/chunks\|readdirSync.*chunks" apps --include='*.test.ts' --include='*.test.tsx'
   ⇒ 漏掉：透過 helper 間接讀產物的、以及靠真瀏覽器載入編譯後 CSS 的
   ```
   ⇒ **rollback 前請人開檔判，不要只跑一條 grep 就宣布可以 revert。**

---

## 7. 驗收條件（每條可 yes/no）

1. `grep -c 'pnpm --filter @pcm/admin build' .github/workflows/ci.yml` ⇒ **1**。
   ✅ **已達成（2026-08-18 13:5x，未 commit 時量的）** —— ~~（現在是 0）~~ 那個「現在」指的是改之前，已過期（codex 關卡2 nit）。
   ⚠️ **驗收字面已跟著【乙】改** —— 原本寫的是 `grep -cE "pnpm build|turbo run build"`，那是甲的字面。
   📌 這是本 repo 記過的形狀：**改了方案而驗收條款留在另一節沒跟著改**（`feedback_claimed-sync-but-only-patched-touched-lines`）。
2. Build 步驟在 `Test` 步驟**之前**：`grep -n "name: Build\|name: Test" .github/workflows/ci.yml` 的行號，Build < Test。
3. 🔴 **Sean 推 `dev` 之後那一發 CI**：`gh run list --branch dev --limit 1 --json headSha,conclusion` 的 `headSha`
   對得上含本步的那顆，且 `conclusion` ⇒ **success**，`Test Files` 的 failed 數 ⇒ **0**。
   🔴 ~~PR 上那一發 CI（不推 dev）~~ **已被 Sean 2026-08-18 的 `Q2=乙` 推翻**（原文在 `~/pcm-mailbox/MAIN-021-給G1-Sean批了CI-20260818.md`，
   他逐字只說「5 題依照建議」，內容在該檔貼的選項原文裡）。乙 = 那一行直接進 dev、等下次推 dev 時看那一發 CI。
   ⚠️ **代價要寫在這裡不是藏在 §7-b**：猜錯就是 CI 再紅一次 —— 跟現在一模一樣。
   ⚠️ **這條的 yes/no 不在施工窗手上** —— 只有 Sean 推得動 `dev`，所以本條在他推之前**恆為「未驗」**，
   不是 fail。誰引用本 plan 說「已驗收」，要先答得出那一發 CI 的 run id。
   📌 §9-e 那兩個執行面（feature branch 紀律例外 / 只有 Sean 推得動）**因為走乙而變成不必答，不是被批准**
   （MAIN-021 明寫 Sean 沒批 feature branch 例外）。
4. 🔴 **負向對照（不可省）**：拿掉 Build ⇒ 那兩支**必須再度紅**，錯訊息仍是「找不到建置產物」。
   —— 沒有這一發，只證明「現在綠了」，不證明「是這一步讓它綠的」。
5. `E2E (production build)` 仍然 success（證明沒有波及另一支 workflow）。

### 7-b 🔴 ~~「只能 push 後才驗得到」那個矛盾，已經解掉了~~ —— **半條又回來了（Sean `Q2=乙`）**

> 🔴 **2026-08-18 13:5x G1 加註（codex 關卡2 must-fix）**：本節原本解的是「不推 dev 也驗得到正向」，
> 而 **Sean 選了乙 = 不開 PR、直接進 dev** ⇒ **正向那半又變回「只能推上去才驗得到」**。
> ✅ **沒有回來的是【負向那半】**：`a482b428` 那一發已經是「沒有 Build」的世界，仍然免費、仍然成立。
> ⇒ 本節下面的表格第一列已改；**codex R1 F2 那條技術事實（`ci.yml` 支援 PR）仍然為真**，
> 只是**我們選擇不走它**——`grep -n "pull_request" .github/workflows/ci.yml` ⇒ `:6`（我重跑過）。
> ⚠️ **不要把「沒走」讀成「走不了」**，也不要把它讀成「Sean 批了 feature branch 例外」（他沒批）。


~~原本寫：驗收 3/4 只能在推上去之後才做得到，是本案無法在 commit 前關掉的一段。~~ **那句是錯的。**

```
codex R1 F2：ci.yml 支援 PR ⇒ 不必推 dev 也驗得到正向結果
我當場複驗：grep -n "pull_request" .github/workflows/ci.yml ⇒ :6   ✅ 它說的對
```

⇒ **三條路各自負責一段，沒有一段需要「故意推一顆紅的上去」**：

| 要證的 | 怎麼證 | 在哪 |
|---|---|---|
| 正向：加了 Build 之後 CI 綠 | 🔴 ~~開 PR，看那一發 CI~~ **已被 Sean `Q2=乙` 推翻** ⇒ 那一行直接進 `dev`，等他下次推 `dev` 時看那一發 CI | `dev` 推上去之後，**不開 PR、不開 feature branch** |
| 負向：沒有 Build 就會紅 | 🔴 **`a482b428` 那一發【已經是】負向對照** —— 它就是「沒有 Build」的世界，而它 FAILURE、訊息是「找不到建置產物」 | 已存在，run `32094343674` |
| 負向（第二道，本機） | 在拋棄式鑽機上不 build 直接跑那兩支 ⇒ 必須紅 | `pcm-w1-fg2`，可重跑 |

🔴 **主視窗裁定：不推紅的。** 逐字理由：**「負向對照要證的是『這道檢查有判別力』，而那件在本機證得了；為了驗證而故意讓正式分支紅一次，代價明顯高於它證到的東西。」**
📌 而 codex 這條更省一步：**那個負向對照我們今天已經【免費拿到了】** —— 它就是今天這場事故本身。
**判別句：在你打算製造一個失敗來當對照之前，先問【那個失敗是不是已經發生過了】。**

---

## 8. 未決 / 誠實缺口

- **GitHub runner 的 build 耗時未量** —— 見 §5，那是估的。
- **本案不修「沒有人在看 CI」那條** —— `STATUS.md` Blocker 逐字「CI 不是閘、是事後警報，而沒有人在看」。
  🔴 **本案讓 CI 回到「紅＝有事」，但它仍然沒有人在看，也仍然不是閘**（直推 dev ⇒ 紅的時候東西已經在 production 上）。
  ⇒ **不要把本案讀成「CI 修好了」。** 通知與閘門化是另一題，未立案。
- **`#544` 那條待辦是否就此關閉，由持有者判**。本案處理的是 CI 順序，`#544` 的斷言內容我沒有讀。

---

## 9. 🔴 R3 之後的重新推導 —— 一個【已經跑過但沒被認出來】的實驗

> R3(W6)提出 F6:`ci.yml` 有**零個** `env:`(量法 `grep -c 'env:' .github/workflows/ci.yml` ⇒ **0**;
> 正向對照 `grep -c 'name:'` ⇒ **11**),而 `pnpm build` 是全 monorepo ⇒ storefront 那半會在零 env 下 build。
> 兩種壞結局:(a) storefront build 紅 ⇒ CI 仍恆紅、只是換一個 step (b) build 過但 `NEXT_PUBLIC_*` 內插成空。
> W6 自己標明 **(a)/(b) 它沒有量**。主視窗指示:**重新推導,不要護著甲。**

### 9-a 我不必新做實驗 —— 那個實驗今天已經跑過四次了

```
量法(可重跑)
  ls -la /Users/sean_1/pcm-w1-fg2/.env.local          ⇒ No such file or directory
  ls -la /Users/sean_1/pcm-w1-fg2/apps/*/.env.local   ⇒ no matches
  (git worktree 不帶未追蹤檔 ⇒ 拋棄式鑽機【天生沒有 .env.local】)

  grep -h "Environments" /Users/sean_1/pcm-w1-fg2/logs/four-greens/*/build.full.log | sort -u
    ⇒ 零行(主樹 build 會印「- Environments: .env.local」,鑽機這裡沒有)

  該鑽機 6dcaf0d1 那一發:
    TURBO_FORCE=1 pnpm build  Tasks: 2 successful / Cached: 0 cached, 2 total / rc=0
    pnpm test                 Test Files 522 passed | 1 skipped (523)
    grep -c "找不到建置產物" <該發 vitest.full.log> ⇒ 0
```

🔴 **⇒ 全 monorepo build 在【沒有任何 `.env.local`】的環境下:build 成功,而且那兩支產物類測試通過。**
⇒ **F6(a)「storefront build 會紅」= 量到不成立。**

### 9-a-2 🔴🔴 **而 F6(b) 有答案了,它把上面那段的【安慰】整個抽掉**(W6 2026-08-18 量到)

```
零 env 環境跑全 build ⇒ rc=0 / Tasks: 2 successful / Time: 17m49.639s
🔴 而它綠的【方式】：
   grep -c 'NEXT_PUBLIC_SUPABASE_URL not set' <零 env build log>  ⇒ 81
   受影響：[fetchCatalogPage] / [fetchCatalogBrandTaxonomy]
   來源逐字：packages/adapters/src/supabase/client.ts:28
   正向對照（證明尺沒壞）：同一條 grep 對【有 env 的主樹 log】 ⇒ 0
⇒ 81 次資料層失敗、零紅。錯誤被接住，build 回 0。
```

🔴🔴 **而我必須認一件事:那 81 次【也在我自己的 log 裡】,我引用那份 log 的時候沒有看見。**
```
逐發重數（可重跑）：
  grep -c 'NEXT_PUBLIC_SUPABASE_URL not set' \
    /Users/sean_1/pcm-w1-fg2/logs/four-greens/*/build.full.log
  afd3e78e-…-79368 ⇒ 81
  afd3e78e-…-22495 ⇒ 81
  6dcaf0d1-…-80040 ⇒ 81
```
**⇒ 我在 §9-a 拿這三份 log 去證「F6 的疑慮不成立」,而【推翻那個結論的東西就在同一份 log 裡】。**
我當時只 grep 了 `Environments` 與 `Tasks:`,**我問了我想問的，沒有問它還印了什麼。**

📌 **判別句（今天最貴的一條）：`rc=0` 回答的是「它有沒有失敗」，不是「它做對了嗎」。
我拿一個【沒有紅】當成【沒有事】。**

### 9-a-3 這條反過來打到本 plan 的立論本身

本 plan §1 的立論是「**恆紅與恆綠一樣沒有判別力**」。
🔴 **而甲會新增一個【綠、而資料層完全壞掉】的面** —— **用一個沒判別力的綠，換掉一個沒判別力的紅。**

而這個 repo **已經有一道專門擋這件事的閘，甲會繞過它**：
```
apps/storefront/scripts/e2e-prod-preflight.mjs:37  REQUIRED_KEYS = 那兩把
                                              :64  trim().length > 0
                                              :94  缺 ⇒ process.exit(1)
它由 playwright.prod.config.ts 的 webServer 在 next build【之前】跑
⇒ 那道閘【只在 e2e 路徑上】，ci.yml 的 pnpm build 不會經過它
```
`e2e-prod.yml` 檔頭自己寫著為什麼要有它，逐字：
> 「未設定的 secret 會內插成**空字串**（env var 仍建立），等於『**沒設定資料庫也一路綠**』」

**⇒ 甲會做的，正好就是那句話描述的事。**

⚠️ **W6 的誠實邊界，照抄不拿掉**：
- **它沒量「CI 上會不會也是 81 次」** —— 量的是本機零 env，CI 的 secrets 設定它讀不到。
- **它沒量「那 81 次會不會讓產出的頁面實際壞掉」** —— 只證明 build 綠而錯誤被接住。
⇒ 這兩件要有權限的人在 CI 上跑一次。**不替它們寫結論。**

⚠️ 射程限定:鑽機沒有 `.env.local`,**但它繼承了我 shell 的環境變數**。我沒有在 `env -i` 下跑
⇒「完全零環境」**未驗**;「沒有 `.env.local` 檔」**已驗**。CI 更接近後者(它也沒有那個檔)。

### 9-b F7 我要更正一半 —— 差異取決於【你在哪棵樹跑】

W6 量的是**主樹**的 build(會印 `- Environments: .env.local`);我的四綠跑在**鑽機**(不載入任何 `.env`)。

```
主樹跑四綠       ⇒ 載入 .env.local ⇒ 與 CI 環境【不同】   ← W6 說的那個差異,成立
拋棄式鑽機跑四綠 ⇒ 不載入任何 .env ⇒ 與 CI 環境【接近】   ← 我今天四發都在這裡
```

🔴 **所以 F7「甲落地後仍不可比」對【主樹跑的四綠】成立,對【鑽機跑的四綠】不成立。**
⇒ 降級照做,但理由要寫對:不是「環境永遠不同」,是 **「可比與否取決於你在哪棵樹跑」**
⇒ **收割窗跑四綠應一律用拋棄式鑽機,不要在主樹跑。** 這條比一句「不可比」有用。

### 9-c 那麼甲還是乙 —— 重新評,不護著裁定

新事實兩條:
1. 那兩支需要產物的測試**都在 `apps/admin`** ⇒ **乙(只 build admin)功能上就夠了。**
2. 全 monorepo build 在無 `.env.local` 下**實測會過** ⇒ 甲**不會**如 F6(a) 擔心的那樣換個 step 恆紅。

| | 甲(全 build) | 乙(只 build admin) |
|---|---|---|
| 解得掉這兩支 | 是 | 是 |
| 零 env 下會不會紅 | **實測不會**(§9-a) | 實測不會 |
| F6(b) bundle 與線上不同 | 🔴 storefront 那半會產一份 `NEXT_PUBLIC_*` 為空的 bundle;對這兩支測試無影響(它們量 CSS 與 chunks),但**多產一份沒人要、且與線上不同的東西** | **不產 storefront bundle ⇒ 這個疑慮不存在** |
| CI 時間 | 兩個 app | 一個 app(較短,未量) |
| 未來 storefront 加同類測試 | 自動涵蓋 | 要再改一次 —— 🔴 **而那是【已知、寫得下來】的未來工作,不是隱形的坑** |

🔴 **重新推導的結論:改推【乙】,不再推甲。**

1. **乙做的事剛好等於需要的事。** 甲多做的那半 storefront build,在 CI 的零 env 下會產出一份與線上結構不同的 bundle —— 它今天不咬人,但**多出來的東西日後會被誤用**。
2. F6(a) 那個疑慮我量掉了 ⇒ **甲不是不能用,只是它沒有比乙好。**
3. 甲原本唯一的優勢是「與本機四綠同序 ⇒ 可比」,而 §9-b 顯示**可比性真正取決於在哪棵樹跑** ⇒ 那個優勢比我原本寫的小。
4. 乙的代價寫進本檔就不再隱形:
   ```
   給未來的人:若你在 apps/storefront 新增依賴編譯產物的測試,
   ci.yml 的 Build 步驟要一起擴到 storefront,並自行處理它需要的 env。
   ```

⚠️ **我推翻的是我自己上一版的推薦,也連帶推翻主視窗基於那版做的裁定** ⇒ ~~這一項必須重新裁,不能沿用。~~
✅ **已裁完(2026-08-18 13:5x G1 更正,codex 關卡2 R2 must-fix)**:主視窗 11:5x 裁【乙】、Sean 13:20 批
(`Q1=甲` 照 plan 改 / `Q2=乙` 不開 PR)⇒ **本行不再是待辦**。留著是因為它記錄了「推薦被自己推翻」那個過程。
⚠️ 不要因為讀到「必須重新裁」就以為這份 plan 還在等人拍板 —— 檔頭 `:3` 是現況的權威。

### 9-d F8(must-fix):§7 驗收 3 與 §7-b 互相矛盾 —— 已改

`§7 驗收 3` 原本寫「推上去之後那一發 CI」,而 `§7-b` 裁的是「不推、開 PR」。
⇒ **照著做的人會照 §7 做,不會先讀 §7-b。** ~~驗收 3 已改寫成「PR 上那一發 CI」~~
🔴 **2026-08-18 13:4x 更新:那次改寫【又被推翻了】** —— Sean `Q2=乙` ⇒ 不開 PR、直接進 dev,
驗收 3 現在寫的是「**Sean 推 dev 之後那一發 CI**」(`:296`)。
📌 **這一節本身就是那個形狀的實例**:它記錄的是「兩節互相矛盾、已對齊」,
而對齊之後**上游又變了一次**,於是這一節自己變成新的過期字面 —— 而它讀起來像一則已結案的紀錄。

### 9-e ~~F9:開 PR 這條路的執行面兩個未答~~ —— 🔴 **這條路沒有被走(Sean `Q2=乙`)**

> **2026-08-18 13:5x G1 更正(codex 關卡2 R2 must-fix)**:本節原本以「我們要走開 PR 這條路」的口吻寫,
> 而 Sean 已選【乙 = 不開 PR、那一行直接進 dev】⇒ **下面兩個未答【變成不必答】。**
> 🔴 **不必答 ≠ 被批准。** `MAIN-021` 明寫「feature branch 例外,他沒有批」。
> ⇒ 誰日後要走 PR 那條路,這兩件要**重新問**,不能引用本節當作已解決。

~~機制上成立(`on: pull_request:` 無分支過濾)。但:~~
1. ~~`CLAUDE.md` Git 紀律「slice 都在 dev、暫不開 feature branch」⇒ 這是紀律例外,沒有人批過。~~
2. ~~「不自動 push」⇒ 施工窗推不了那個分支,要 Sean 動手。~~
⇒ ~~這條路需要 Sean 開分支並推,或需要一次 feature-branch 例外。~~
📌 **技術事實仍為真**:`grep -n 'pull_request' .github/workflows/ci.yml` ⇒ `:6`(我重跑過)
⇒ **走得了,只是沒走。**

### 9-f 全檔「未確認」逐條掃描(W6 的判準:查得到而沒查 vs 現在查不到)

| # | 未確認項 | 分類 | 處置 |
|---|---|---|---|
| 1 | storefront 缺 env 會不會 build 失敗 | **(a) 查得到而沒查** | ✅ **當場查掉**,見 §9-a:實測會過 |
| 2 | 那兩支測試在哪個 app | **(a)** | ✅ **當場查掉**:都在 `apps/admin` |
| 3 | `ci.yml` 有沒有 `env:` | **(a)** | ✅ 已查:0 個(正向對照 `name:` 11) |
| 4 | GitHub runner 上 build 要多久 | **(b) 現在查不到** | 需要真的在 runner 上跑一次;本機數字不可轉移。**標未量** |
| 5 | GitHub Actions 分鐘數方案/成本 | **(b)** | 需要看帳單頁面,不在 repo 內。**標未確認** |
| 6 | 「依賴編譯產物的測試」如何完整列舉 | **(b)** | 沒有可靠機械方式(見 §6);**代理量法不完備,已明寫它漏什麼** |
| 7 | 完全零環境(`env -i`)下 build 會不會過 | **(a) 但我沒做** | 🔴 **誠實列出:我做的是「沒有 .env.local」不是「零環境」。** CI 更接近前者,故我判邊際低而未做 —— **這是我的裁量,不是它不可查。** |

🔴 **第 7 項是這張表最重要的一列**:它是**我判斷不值得查而跳過的**,不是查不到。
**「未確認」有三種:查不到 / 查得到而沒查 / 查得到而我決定不查 —— 第三種要說出是誰決定的。**
