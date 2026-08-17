# 推送前攻擊面掃描 —— 2026-08-17 那一輪的結果 + 可重跑工具

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**基準**:`git diff origin/dev...dev`(🔴 **三個點**)
- **工具**:`scripts/pre-push-attack-surface-sweep.sh`(本輪之後做成的;`--selftest` 是它唯一的判別力)
- 🔴 **為什麼要有這件**:`dev` = `pcm-admin` 的 **production** ⇒ **推了就上線**。而「逐顆正確性」有 V 窗在做,**沒有人在問「這一整包碰到了哪些面」**。

## 問的問題只有一個

> **這一包改變了什麼安全面?**

**不是**「這顆對不對」(那是 V 窗)。

## 本輪結果(**落筆當下** 258 顆 / 160 檔;⚠️ 顆數隨 dev 前進漂移,引用要帶時點 —— reviewer 複跑時已是 259)

| 類 | 命中檔 | 本體非註解行 | 判定 |
|---|---|---|---|
| 1 auth / 權限邊界 | 7 | **0** | 🟢 **不 gate** —— 四支 `session/*.ts` **只改註解**;另 3 檔是 `.md` |
| 2 錢 | 37 | **240** | 🟡 要讀 ⇒ **已讀,見下** |
| 3 平台設定 | 1 | 3 | 🟡 `package.json` 加一條 lint-staged selftest(開發期工具) |
| 4 對外可見 | 16 | 292 | 🟡 全在**後台列印面**;寄信/法律頁/storefront API **零命中** |
| 5 新建 DB 物件 | **0** | — | 🟢 **零 migration**(兩支 `.sql` 在 `docs/specs/` 是草稿) |
| 6 祕密字面 | **0** | — | 🟢 含正向對照(餵假 JWT ⇒ 命中 1) |

### 類 2 的 240 行:兩支 adapter 的分頁,**都逐條核過五準則,全過**

`SupabaseWalletAdapter`(儲值金帳目)/ `SupabaseOrderAdapter`(列印品項):
```
頁大小 < db-max-rows（200 < 1000）✅   .range() 兩端皆含 ✅
中途失敗 throw 不 break ✅             count 不當終止判準 ✅
排序帶唯一鍵（.order('id')）✅
```
🔴 **兩支都 fail-closed,而且理由寫在 code 裡**:
- Wallet:`count === null` ⇒ throw,逐字「沒有 N 就不回傳一份看起來完整的一頁」
- Order:達 `MAX_PAGES` ⇒ throw,逐字「**不回傳部分結果 —— 部分結果會讓紙上少列品項而紙看起來完全正常**」
⇒ **正是 Sean 08-17 拍的 Q2 甲。**
🟡 **`SupabaseOrderAdapter` 這片解掉的是【列印那一條路】,不是整條 `ORDER_ITEMS_EMBED_LIMIT`**(🔴 **code-reviewer must-fix #7 更正我原本的過度宣稱**):

```
✅ 列印品項  listOrderItemsForPrint ⇒ 分頁 + 上限 10,000 + 超過 throw（本片新增）
🔴 訂單明細  findAdminOrderDetail   ⇒ 【仍被 ORDER_ITEMS_EMBED_LIMIT = 200 夾住】
             SupabaseOrderAdapter.ts:847  .limit(ORDER_ITEMS_EMBED_LIMIT, …)
             觸及時翻成 itemsTruncated；常數仍活著
```
⚠️ **我原本寫「實質解掉了」是錯的** —— 那句會**關掉下一個人的尋找動作**,而 Sean 的業務事實(一張單可能到 200 品項、判定用 `>=`)**對明細那條路仍然成立**。原句劃掉留痕:~~實質解掉了 `ORDER_ITEMS_EMBED_LIMIT = 200`~~
⚠️ `limit` 不可被操控:`WALLET_LEDGER_PAGE_SIZE = 20` 寫死;`walletPage` 經 `parsePage` 驗證(**整數 ≥ 1,否則回 1**)⇒ offset 不可能為負。

## 🔴 結論

**沒有找到應該在推之前修的東西。**
⚠️ **口徑**:查的是「碰到哪些面」,**不是逐顆正確性**。**未查**:前端 XSS/CSRF、依賴鏈、Edge Functions、業務邏輯正確性 —— **與 `2026-08-16` 那份的「仍沒查」同一份清單,這一包沒有改變那個清單。**

## 🔴 做工具時,工具自己踩了三個坑(留著,因為都是同族)

1. **第一個對照組沒有判別力**:類 5 我先用 `^supabase/` 當對照 ⇒ **它也是 0** ⇒ 證明不了任何事。改用 `^docs/=49` / `^apps/=77` 才成立。**對照組本身要先被對照。**
2. **未跳脫的 `.`**:`grep -c ".env"` 報 1 命中 ⇒ 實際是 `environment-values-….md`。**根本沒有 `.env` 檔。** ⇒ selftest 世界 C 就是在守這一條。
3. **工具第一版會【永遠回 3】**:幾乎每包都碰 `order|payment` ⇒ 只看檔名的話它一直叫,而**一直叫的守門會被關掉**。⇒ 改成**數本體非註解行**,並**排除 `.md` 與測試檔** —— 沒排除的話,**本窗自己的 `docs/security/*auth*.md` 會被算成「授權被動過」143 行**,而四支真的 auth `.ts` 全是 0。

📎 第 3 條是本工具能用的原因:**它現在會對「只改註解的 auth 檔」保持安靜**,所以它叫的時候才有意義。

---

## 工具本身:**R1 FAIL → 重做 → 現況 R1 待複審**(2026-08-17 E 窗第二輪)

### 第一輪:R1 = FAIL,7 條 must-fix,**沒有 commit**
🔴 **只有 5 條留下白紙黑字,第 6、7 條隨那個 session 的 context 一起消失** —— 本檔不宣稱修了 7 條。
(第二輪的 fresh reviewer 事後押那兩條可能是「從子目錄跑」與「`secret_hits` 零自壞偵測」,**押注不是證據**,僅供參考。)

### 第二輪:fresh code-reviewer(opus,唯讀)實跑 ⇒ **又是 R1 = FAIL,9 條 must-fix**
**最重要的一條是 `F8`:第一輪的修法【把同一個病換了位置】。**
第一版 selftest grep 的是 pattern 的**複本**;第二版改成呼叫本尊了,**但分母只有 PAT1/PAT6**
⇒ reviewer 實跑 **22 發突變**(`PAT2/3/4/5` 換掉、`exit 3` 改 `exit 0`、自壞守門刪光…)**全部仍然全綠**。
> **pattern 不再是複本了,但 rc 決策是。**

其餘 8 條裡,**三條是全新的「印『攻擊面未變』並回 `rc=0`」路徑**(全部實跑):
```
F1 從子目錄跑  FILES 是 repo-root 相對、pathspec 是 CWD 相對
               ⇒ 同一組 base/head：root 跑 rc=3；cd apps 跑【每一類都 0】rc=0
F2 grep 自壞   NOISE 換成壞 ERE ⇒ 回空字串 ⇒ [ "" -lt 0 ] 報錯被當 false ⇒ rc=0
F3 secret_hits 整層零自壞偵測 ⇒ pattern 壞掉就回 0 ＝「乾淨」
```

### 重做的兩個設計決定 —— **都是量出來的,不是想出來的**

**決定一:gate 判準不再排除註解。**
舊版拿一條 ERE 想同時認出 `// # * /* --` 五種註解 ⇒ 那是在寫多語言註解解析器,而它把**真 code** 丟掉:
CSS 自訂屬性 `--primary: #0066b1;`(PCM 主題/列印樣式**每一行**都長這樣)、TS 私有欄位、generator `*fn(){}`。
🔴 **而它換來了什麼:量了 10 個歷史區間(`dev~200..dev~0`,每 20 顆一段),
「排除註解」與「不排除」算出來的 gate 結果【10/10 完全相同】。**
⇒ 它從未改變過任何一次 `rc`,只改變了「哪一類顯示成 0 行」⇒ **拿三個 must-fix 換一個沒改變過決策的啟發式 ⇒ 刪掉。**
註解比例仍然印,但**只作為給人看的參考欄,永不參與 gate**。

**決定二:改用一次 `--numstat` + `--raw`,完全不傳 pathspec。**
舊版把檔名餵回 git 當 pathspec,那條路生出的 bug 全是同一族(空白檔名、CJK 檔名、子目錄相對性)
⇒ **不傳 pathspec,整族一起消失**,不是一條一條修。白撿兩個舊版天生量不到的:
**binary 檔改動**(無 `^[+-]` 行 ⇒ 舊版恆 0)與 **mode-only 改動**(`chmod +x`,攻擊面真的變了而 diff 0 行)。

### 第三輪:V 窗**反向盤點**(不是審 diff,是盤「gate 宇宙的覆蓋」)
🔴 這條線問的問題和 reviewer 不同:**倖存的 must-fix 清單不是母體。**
它從腳本本身反推「現在還壞著的地方」,三條有執行級證據(V 窗當場實跑,rc 附在下面):

```
RI-1 must-fix  祕密掃描的 SECRC 抓的是【管線最右端 grep】的 rc
               ⇒ 左端 git diff 死掉 ⇒ grep 吃空輸入、印 0、rc=1、過了 -ge 2 檢查
               ⇒ **祕密掃描讀成「乾淨」**。W13 只證了 grep 半邊(壞 ERE→rc=2)。
               🔴 這正是 CLAUDE.md 終端紀律「pipeline 的 $? 是右端那個」——
                  而這支腳本自己就是為了防這種事而存在的。
RI-2 must-fix  鐵則 12⑥【共用元件】整類不在五類裡（實跑 world=ui ⇒ rc=0「五類皆未命中」）
RI-4 finding   PAT3 收 package.json 卻不收 pnpm-lock.yaml（實跑 world=lock ⇒ rc=0）
RI-5 finding   對照組副檔名白名單比 gate 字集窄:只改 .husky/pre-push ⇒ CTRL_ANY=0
               ⇒ rc=1「清單或 grep 壞了」（實跑 world=hook ⇒ rc=1）
RI-3 finding   類 4 對外可見 = note 永不 gate,而鐵則 12⑤ 列高風險 ⇒ 零 rationale 落檔
RI-6 nit       測試檔一律不 gate ⇒ 對 production 面成立,但 test 是 CI/dev 機的執行面
```

**處置(全部落地,無一條用「收斂」帶過)**:
- `RI-1` **修**:full diff 存一次 `FULLDIFF=$(git diff …) || exit 1`,三條管線共用(順帶 4 次 full-diff 降 1 次)。
- `RI-2` **修**:新增類 7 `^packages/` 為 gate。🔴 **量了才敢加**:`packages/ui/` 目前是空目錄
  (`find packages/ui -type f -name '*.tsx'` ⇒ 0)⇒ 近 200 顆零命中是「還沒有檔」,不是「不會被改」;
  而 `^packages/`(含 adapters/ports/schemas,載著 DB client 與驗證邏輯)在 5 個區間裡命中 3 個 ⇒ **不是常態叫**。
  鐵則 12⑥ 字面只點名 `packages/ui`,擴到 `^packages/` 是我方判斷,寫在檔頭。
- `RI-4` **修**:PAT3 補 `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`。
  V 窗給的界線很利:**「不查依賴鏈」的免責講的是邏輯層,而路徑分類正是本工具職掌。**
- `RI-5` **刪掉那道對照組**。它的職務已由 `N==0` + `is_num`/`TOOLBROKE` 覆蓋(三者皆有 selftest 格),
  而它自己會把「這一類該 rc=3」變成 rc=1。🔴 **下場比漏報更糟:訊息把人引去修工具,
  而人看兩次 rc=1 就會下結論「工具壞了,照推」。**
- `RI-3` / `RI-6` **不改行為,把 rationale 寫進檔頭**:類 4 在 10 個歷史區間裡 **9 段命中**
  ⇒ 升 gate 等於幾乎每包都叫,而一直叫的守門會被關掉;高風險那一面交給鐵則 12 的人工審查鏈。

### 第四輪:fresh reviewer R2 對 v3 ⇒ **又是 FAIL,8 條 must-fix**

🔴 **三輪審查、三次 FAIL。** 每一輪都抓到**新的、實跑得出來的**「印乾淨卻是壞的」路徑,列在這裡不美化:

```
R2-1 awk -v 會做逃脫處理 ⇒ C-quote 檔名的 \t 變真 TAB、pattern 的 \. 被吃掉
     ⇒ 難搞檔名那一族【沒有隨 pathspec 一起消失,它搬到了 -v】。改用 ENVIRON[] 才真的關掉。
R2-2 .html 被每一類排除（含 gate 類 7）⇒ 出貨單/列印範本整類消音（實跑 rc=0）
R2-3 PCM_SWEEP_* 覆寫在【正式路徑】無條件生效、無警告
     ⇒ 設兩個環境變數就能讓它對任何 diff 回 rc=0「乾淨,可以推」＝消音開關
R2-4 rc=2 三道守門零 fixture ⇒ 突變 exit 2→exit 0 時 selftest 全綠,
     而那個世界裡「ref 打錯」與「不在 git repo」都回 rc=0
R2-5 --no-renames 零 fixture ⇒ 拿掉後純改名從 rc=3 變 rc=0
R2-6 tolower 零 fixture ⇒ 拿掉後 CheckoutPanel.tsx 這類大寫檔名靜默歸零
R2-8 selftest 只斷言 rc ⇒ note-only 的類 4 整類可無聲消失而沒有一格會紅
```

**🔴 R2-7 是我自己寫的假字面,單獨列出來:**
我在檔頭寫「`packages/ui/` 目前是**空目錄**」,依據是 `find packages/ui -type f -name '*.tsx'` ⇒ 0。
**那個量具比那個結論窄。** 實查 `git ls-files packages/ui` ⇒ **6 個追蹤檔**,含真原始碼
`packages/ui/src/filters/cascadeFilterReducer.ts`(+ `.test.ts`)與 `src/index.ts`。
⇒ 正確說法:**那裡有共用元件原始碼,只是在我抽樣的區間裡沒被改到。**
⇒ 🔴 **而我是拿這句話當「加類 7 不會吵」的理由的** —— 結論(該加)沒變,**理由是錯的**,
   而下一個人會照理由決定要不要重看。**這是今天我自己犯的第二次「量具比結論窄」。**

**另一句也要更正**:決定二原本寫「不傳 pathspec ⇒ 整族一起消失」。**不成立。**
pathspec 這個**入口**關了,`awk -v` 是**第二個入口**。正確說法:
**關掉一個入口不等於關掉那一族;要逐一問「這個值還經過誰的手」。**

### 現在的守門(**這一節就是它可不可以被信任的全部理由**)
```
selftest      24 格（數法:`grep -c '^  _ck '` + 1 格 `_ckout` 輸出斷言）
              斷言 rc；另有一格斷言 stdout（因為 note 類永不影響 rc）
              涵蓋:五個 gate 類各一 ＋ binary ＋ 結構變更（新增/刪除/改名/權限）
              ＋ 祕密 ＋ 只動 .md 不該叫 ＋ 子目錄 ＋ 空區間 ＋ 兩格量具自壞
              ＋ 共用元件 ＋ lockfile ＋ .husky ＋ 純改名 ＋ 大寫檔名 ＋ .html 列印範本
              ＋ TAB 檔名 mode-only ＋ 兩格 rc=2 ＋ 覆寫拒跑
突變測試      22 發有效突變 ⇒ **21 紅**
              仍綠 1 發＝`FULLDIFF` 的 `|| exit 1`（見誠實缺口）
回歸          三個真實區間 rc 維持 3 / 0 / 1；子目錄 rc=3
覆蓋變化      類 4 從 16 檔/448 行 → **17 檔/731 行**（.html 不再被排除）
              類 7 共用元件 14 檔 / 597 行 —— 一整類先前不在任何分母內
```

### 🔴 誠實缺口(不要讀成已驗)
```
· 本輪（v4）尚未經 fresh reviewer 複審。上面的 R2 FAIL 是【第二輪 reviewer 對 v3】的結論。
· `FULLDIFF` 的 `|| exit 1` 無 fixture：要構造「這一發 git diff 失敗、而前面幾發成功」
  需要一個【選擇性失敗的 git shim】（同一個 binary 服務前面必須成功的呼叫）⇒ 未做，保留該守門。
· shellcheck 本機未安裝（`command -v shellcheck` ⇒ 查無）⇒ 那層不是通過，是不存在。
· 三綠對 .sh 語意恆綠、零判別力。selftest 是它唯一的守門。
· R2 的 nit 10（W10/W2 對現行 code 零鑑別力，只擋「未來重新引入 pathspec」）未處理：
  保留為回歸格，但不宣稱它們現在在守什麼。
· R2 的 nit 12/13/15（多報方向、dead var、空區間該不該算自壞）未處理。
```

🔴 **這支工具的檔頭要寫一句給下一個人**:
**守門存在的理由不是替別人擋,是替寫它的人擋。** 今天它擋下作者本人四次:
兩次是 rc 抓到量測 harness 壞掉、一次是 W15 抓到 sed 沒改到卻差點宣稱修好、
一次是 W17 抓到純改名不 gate。

⚠️ **本節上方那份【手工】掃描結果不受任何影響** —— 它是逐條人工查的,不是這支跑出來的。
