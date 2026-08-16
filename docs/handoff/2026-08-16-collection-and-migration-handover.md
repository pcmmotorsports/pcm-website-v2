# 2026-08-16 交接 · 收割完成並已推 + migration 四支全套 + 真登入線開線

> **寫於 13:26。所有數字都是【當下量的】,不是記憶。**
> **下一個主視窗:先跑本檔 §1 的三行,對不上就以你量到的為準、回報差異,不要照抄本檔。**
> **前一個主視窗的失敗模式(三輪審查一致):不是程式寫錯,是【描述了一件自己沒有真的完成的事】。讀本檔時對每一句問「這句有證據嗎」。**

---

## 1. 開工先跑這三行(對不上就停)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git rev-parse --short HEAD && git rev-list --count origin/dev..dev && git status --porcelain
```
**13:4x 的值(已推)**:`dev` / `7c10f1a8` / **`0`** / 工作樹空。
🔴 **Sean 2026-08-16 明確指示推,已推** —— 93 顆全進 `origin/dev`,四條線 `git merge-base --is-ancestor <branch> origin/dev` 皆過。
⚠️ **push 輸出帶一句 `Bypassed rule violations: Required status check "check" is expected`**
   ⇒ GitHub 分支保護的 status check **被繞過**了。原因未查,**下一個窗要確認 CI 有沒有真的跑。**

```bash
for d in ~/pcm-void-readers ~/pcm-products ~/pcm-print ~/pcm-customers; do printf "%-22s %s %s %s\n" "$(basename $d)" "$(git -C $d rev-parse --short HEAD)" "$(git -C $d rev-list --count origin/dev..HEAD)" "$(git -C $d status --porcelain | grep -c '')"; done
```
**13:26 的值**(HEAD / 未推 / dirty):
```
pcm-void-readers  5b0aab41  32  0
pcm-products      9e833b84  17  0
pcm-print         1e547ca9  18  0
pcm-customers     64fe4684  17  0
```
🔴 **四個施工窗的未推數在收割後【沒有歸零】是正常的** —— 收割是把它們併進 `dev`,
分支 tip 沒動。**不要因為看到「還有 32 顆未推」就以為收割沒做。**
驗收割真的做了:`git merge-base --is-ancestor void-readers dev && echo 已併`(四條都要過)。

---

## 2. 今天做完的事(可驗)

### ✅ 收割:四條線全併進 `dev`
```
4accacef  void-readers 32  訂單線 / 客戶頁三欄
578a616f  products     17  BMW M token / 圓角定位器 / 設計參照
15a65864  print-docs   18  列印線 / 對外單據
a35900f3  customers    17  客戶關鍵字搜尋 / LINE 合成位址
```
**每併一支就跑一次完整驗證**(不是全部併完才跑)——理由是 D 窗實測過
「`products` + `print-docs` **零文字衝突但仍可能讓 CI 紅**」。
**最後一次全跑**:`vitest` 500 檔 / 8307 passed / 2 expected fail / 1 todo。

🔴 **三綠要加 `--force`**:第一次跑拿到 `FULL TURBO 35ms 8/8 cached`,
而 replay 的 log 路徑是 `/Users/sean_1/pcm-void-readers` **另一棵樹**
⇒ **根本沒有在合併結果上跑過**。**快取命中不是執行。**
```bash
npx turbo run typecheck --force && npx tsc -p tsconfig.scripts.json --noEmit
npx turbo run lint --force && npx eslint 'scripts/*.ts' --max-warnings 0
npx vitest run
```

### ✅ migration:四支**全部**已進正式庫
```
20260816010000 #525 客戶搜尋  ✅ 已套（--include-all，過程見 §3/§4）
20260816030000 客戶頁三欄     ✅ 已套
20260816040000 #518 錯誤訊息  ✅ 已套
20260816050000 #522 貨品軸    ✅ 已套
```
🔴 **apply 完的下一個動作是追加 `supabase/APPLIED.tsv`**(版本號/sha256/日期/誰)——
**pre-push 閘看的是那份台帳,不是資料庫。**詳見 §10。
**跑法(不碰 `.env*`)**:複製 `supabase/` 到 scratch、`supabase db push --workdir <scratch>`。
**一支一支套**=把其他 pending 檔從 scratch 移走,`--dry-run` 確認清單只有那一支。
🔴 **exit code 不要接管線**(`bash x.sh | head` 之後的 `$?` 是 `head` 的)。

---

## 3. ✅ 已解 —— `#525` 四支全數 apply(原本卡住那件)

✅ **`20260816010000` 已用 `--include-all` 套進去(Sean 2026-08-16 拍板甲),四支遠端欄皆有值。**
🔴 **而它 apply 通過的四項檢查裡有一項是本次新加的**
(`has_function_privilege('anon'|'authenticated', ...)`)⇒ **正式庫自己回答了:那兩個角色沒有可繼承的 EXECUTE。**
⚠️ 仍未關:`NOINHERIT` 的角色 `SET ROLE service_role` 這條路徑守門看不到;`anon.rolinherit` 實際值未確認。

### 當時卡住的原因(留著,因為下次還會遇到)
`010000` 版本號**低於**已套的三支 ⇒ 逆序,`supabase db push` 預設拒絕。

**dry-run 逐字**:
```
Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag to apply these migrations:
supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql
```

**原因**:它的版本號 `010000` **低於**已套的 `030000/040000/050000` ⇒ 逆序,
`supabase` 預設拒絕。官方解法是 `--include-all`。

當時沒有自己按那個 flag,理由(**下次遇到可以直接照這個判**):
① 那是**動正式庫**,而 CLI 自己特地擋了一道 = 它認為這需要人確認
② Sean 授權套 migration 時逐字說「**有一支不對就停下不往下**」,dry-run 就是不對

**Sean 2026-08-16 拍板【甲】。當時的選項留檔:**
```
Q: #525 那支 migration 版本號比已套的低，supabase 擋住了。怎麼辦？

A: 甲｜用 --include-all 套進去（官方解法，一個 flag）
       風險：migration 歷史從此不是遞增的。之後如果有人用「重建整個庫」的流程，
             重播順序會與這次不同。而這個庫目前沒有在做那件事。
   乙｜把檔名改成一個比 050000 大的版本號（例如 20260816060000）再套
       風險：這支已經 commit 了，改名會讓「同一支 migration 有兩個身分」；
             而 dev 上那顆 commit 的訊息會指到一個不存在的檔名。
```
**⚠️ 兩案的風險敘述【都沒有實測】** —— 是從 supabase 的行為推的。要更準需要實驗。

---

## 4. 🔴🔴 那支 migration 擋到的東西(這是今天最重要的發現)

apply 當場被它**自己的守門**擋下,逐字:
```
#525:acl 形狀是 [anon:EXECUTE,authenticated:EXECUTE,service_role:EXECUTE]，
期望 service_role:EXECUTE；拒繼續 (SQLSTATE P0001)
```

**Supabase 平台對 `public` schema 掛了 `ALTER DEFAULT PRIVILEGES`,新建函式
會【直接授權給 `anon` / `authenticated` 兩個具名角色】** ——
🔴 **那是具名授權、不是 PUBLIC 授權 ⇒ `REVOKE ... FROM PUBLIC` 收不到它。**

而這支是 `SECURITY DEFINER`、`anon` 是 **storefront 印在每個訪客瀏覽器裡**的公開金鑰角色
⇒ **任何人都能搜全公司客戶。**
📎 **正好命中 Sean 08-16 早上主動重申的威脅模型**:
> 「所有員工都可以看到客戶資料**沒有分權限**,我唯一擔心就是**資料被駭客攻擊**而已。」

### ✅ 後來關掉了 —— 而關掉它的是**正式庫自己**
第二次 apply 通過了本次新加的 `has_function_privilege('anon'|'authenticated', ...)` 檢查
⇒ **那兩個角色現在對這支函式沒有可繼承的 EXECUTE,這是 production 回答的、不是推論的。**
⚠️ **仍未關**:`NOINHERIT` 的角色 `SET ROLE service_role` 那條路徑守門看不到;`anon.rolinherit` 未確認。

### ⚠️ 第一次失敗當下【沒有】證實的那一半(留檔,因為當時的推理過程值得看)
```
沒有親眼看到正式庫裡現在沒有那支函式
  db dump 要 Docker（沒開）／ psql 要連線字串（在 .env*，禁碰）
已知三條都是【間接】：
  ① migration list 沒把它記成已套
  ② 把它從本地清單移走後，它在遠端那欄完全不出現
  ③ db push 一檔一交易 ⇒ 該檔整支回滾
```
**⇒ 當時的結論是「不得引用成已確認回滾」。後來由第二次 apply 的守門正面回答了。**

### 🔴 這條要推廣:**其他 SECURITY DEFINER 函式有沒有同樣問題?**
`supabase/migrations` 全樹 `SECURITY DEFINER` 出現 **388 次**
(量法 `grep -ci 'SECURITY DEFINER' supabase/migrations/*.sql | awk -F: '{s+=$2} END{print s}'`)。
**本次只查了 `#525` 這一支。其餘一支都沒查。**
⇒ **這是今天最大的未關缺口,建議下一個窗優先做。**
⚠️ 但要注意:同日 `20260816030000` **沒中**(它 `:101` 明文寫著這個平台行為)
⇒ **不是全部都有問題,要逐支看。**

---

## 5. Sean 2026-08-16 早上的拍板(全部落檔在 memory `project_0816-sean-morning-13-rulings`)

```
A-1 #535 清除搜尋      了解（已修，等推）
🔴 A-2/A-3            整題作廢 —— 見 §6
Q3  A ／ Q4 見下 ／ Q5 B方的 ／ Q6 B彩色但印黑白 ／ Q7 A改private
Q8  甲 ／ Q9 甲 ／ Q10 A ／ Q11 a ／ Q12 A不改 ／ Q13 A ／ Q14 依建議 ／ Q15 甲
reviewer marker  ✅ Sean 已跑
```

### 🔴 三條新需求(他答題時順口講的,不在任何選項裡,**還沒人做**)
```
① 出貨畫面重複顯示（逐字）
   「我看範例的 OHL-SD-107，由於他尚未到貨，那應該就把這個商品顯示在尚未出貨
     地方就好，為何上方還要一個【不揀 OHL-SD-107】的選項在上面。
     應該是尚未出貨跟本次出貨的分開，不重複顯示吧？」
   ⇒ 這是資訊架構問題不是樣式問題。D 窗的 D-074 plan 要先吸收再送批。

② 全站配色沒跟上直角化（逐字）
   「那底色與整個頁面設計顏色會改掉對吧？我看截圖跟後台都還沒動到」
   ⚠️ 這是【預期落差】不是需求 —— 他以為直角化=整套視覺換掉，不只圓角變方角。
   ⇒ 動工前要先跟他對齊「他以為會改什麼 / 這條線實際改什麼」。B 窗在等這一步。

③ 頁面寬度統一（逐字）
   「客戶列表等頁面寬度可以跟訂單頁面一樣寬，不需要侷限，倒不如說，
     我們可以統一自己變寬，側邊欄位顯示自動適應」
   ⚠️ A 窗指出:客戶列表那三欄與那張 view 是它做的、在 void-readers 那 32 顆裡。
```

### 🔴 威脅模型定調(以後不要再問「要不要對員工分權」)
> 「所有員工都可以看到客戶資料**沒有分權限**,我唯一擔心就是**資料被駭客攻擊**而已。」

**⇒ 內部不分權=刻意的。防的是外部。任何讓外部讀得到客戶資料的路徑 = 最高優先。**

---

## 6. 🔴🔴 方向改變:真登入線【現在做】

Sean 對 `A-2`(沒選身分⇒靜默寫入失敗)的第一反應**不是選項,是反問**(逐字):
> 「我們這個不是要跟報價單登入帳號做再一起嗎?怎麼又回到要先選身份?這不是走回頭路嗎?」

**他是對的,而檔案站在他那邊**:
```
2026-07-26 Q1=B   身分來自報價單，不在 admin 端另建一套帳號
2026-07-27 Q7/Q8  帳號+密碼登入、初始密碼 Sean 指定
🔴 2026-07-27 晚 Q1'=A  「先做 E10 訂單閉環、E8-B 真認證線押後」
   —— 他自己拍的，且在聽完「已有 2 人共用密碼、預計 3-5 人」的資安顧慮後二次確認
```
⇒ **下拉選身分不是走回頭路,是押後留下的臨時擋板。**
🔴 **而前一個主視窗把題目出成「要不要把擋板補得好一點」** ——
**那個框架預設了「押後仍成立」,而那個前提三週沒被重新問過。**

> 🔴 **判別句(可複用)**:**我出的選項,是不是全都站在同一個【當初是拍板、現在可能過期】的前提上?**
> **⇒ 選項全在同一前提底下 ⇒ 那個前提永遠不會被問到。**

**⇒ 重問後 Sean 拍【甲｜真登入現在做】**,明知代價(約 8 片、是一條線、訂單那邊要讓路)。
**⇒ `#534`(靜默失敗)與 `#536`(身分清不掉)不補擋板 —— 真登入上線後兩者自動消失。**

### 這條線的既有資產(不要重新發明)
```
memory project_m4b-real-auth-line-decisions  ← 完整拍板史 + 拆片 + codex 34 個 must-fix 的來歷
報價單 repo:/Users/sean_1/API大量上架/PCM報價單-V2   13:2x 實測落後 origin/main 16 顆
  ⇒ 動它之前先 git fetch 對 origin/main 驗（memory 有一條「真身在 mac mini」的舊警告，
     而 13:2x 實測 origin 拿得到、只落後 16 顆 ⇒ 那條警告的嚴重度可以下修，但要自己再驗一次）
現況:admin 端零登入機制（git grep signIn/signOut/getSession -- apps/admin/src 零命中）
      apps/admin/src/lib/session/actor.ts:6 自陳「這不是登入 / 授權邊界」
```
🔴 **這條碰 auth = 鐵則 8(要 plan 等 Sean 批)+ 鐵則 12(要對抗審查)。**
**⇒ 下一個主視窗的第一件事:寫 plan,不是動手。**

---

## 7. 五個施工窗的狀態(全部停著等派工)

```
🔴 **四條線的內容【已全部進 origin/dev】** —— 下面的顆數是「分支 tip 相對 origin/dev 的距離」,
   收割後那個數字沒有意義,**不要拿它判斷有沒有待推**。判斷法:`git rev-list --count origin/dev..dev` = 0。
A 窗 pcm-void-readers  訂單線 / 客戶頁三欄
  卡:#521 storefront env ／ order-status-axes.ts 兩份分母收斂（歸收割者=主視窗，還沒做）
B 窗 pcm-products      BMW M / 圓角定位器
  卡:Q5 對齊那一步（見 §5②）
  🔴 它自己回報:Q5=方之後，它那道圓角定位器【刻意放行 rounded-full】的理由消失了
     而守門仍是綠的 ⇒ 建議 Q5 落地與拿掉放行【綁同一片】，不留「綠著的違規」窗口
     products 樹實測:改法涉及 2 個共用常數 + 12 處寫死 inline + 1 真斷言 + 2 註解（共 17）
     ⚠️ 而 print-docs 樹只要改 1 處 ⇒ 不要把 D 窗的成本估搬到 B 窗
C 窗 pcm-customers     客人線 / 訂單列表 UI
D 窗 pcm-print         列印線 / 對外單據
  卡:D-074 出貨單 plan 等鐵則 8 批准（要先吸收 §5① 那條再送）
E 窗 唯讀審查，無工作樹（讀主樹）
  🔴 偵測器看不到它（沒有 commit、沒有分支 tip 會動）⇒ 判死活只能看 ~/pcm-mailbox/E-*.md 的 mtime
```

⚠️ **VSCode reload 之後 session 名字會被洗** —— 今天洗了兩輪,`SendMessage` 送錯過一次。
**⇒ 重要的東西寫信箱(`~/pcm-mailbox/`),不要只靠訊息。**

---

## 8. 待辦(依優先序)

```
1 ✅ §3 已解（Sean 拍甲、已套、已推）—— 待辦從第 2 條開始
2 🔴 §4 的推廣:其他 SECURITY DEFINER 函式有沒有同一個洞（388 次出現，只查了 1 支）
3 🔴 真登入線的 plan（§6）—— 鐵則 8，寫完等 Sean 批
4 §5 的三條新需求
5 order-status-axes.ts 兩份分母收斂（D-074 §8 有貼好的測試碼）
6 #544 編譯產物 border-radius 斷言（要一個 CI 順序的決定）
7 scripts/525-verify.sh 與 runbook 的假全稱句已在 f90670b3 改掉，但那條量法
  「只列出命中、不證明每個命中都已校正」⇒ 未確認
```

---

## 9. 🔴 給下一個主視窗的三條(今天實際踩出來的)

```
1 三綠要加 --force。快取命中不是執行，而它的輸出長得跟成功一模一樣。
2 git add 之後要驗【結果】不是【動作】:
  git diff --cached --numstat 的數字有沒有變。
  今天 code-reviewer 抓到「七項改動一項都沒 add」，而 commit 訊息逐條寫著已修。
3 同一支檔連改兩處不要用行號定位 —— 第一處編輯就讓第二處位移了。
  今天因此覆蓋掉一行真的程式碼。改用字串比對。
  同理:檔案內部不要寫「見本檔 :NNN」，寫一段 grep 得到的字。
```

✅ **已推。`origin/dev` = `7c10f1a8`,未推 0 顆,工作樹乾淨。**

## 10. 🔴 推完之後才發現的一件事(下一個窗要知道)
`pre-push` 閘擋了第一次推,理由是「應用層用到還沒 apply 的 migration」——
**而那時四支【已經 apply 完了】。**
🔴 **因為那道閘看的是 `supabase/APPLIED.tsv` 這份台帳,不是資料庫。**
我 apply 完只更新了 `STATUS.md` 與交接檔,**沒有更新台帳** ⇒ `7c10f1a8` 補登。
> **「套了」與「登錄了」是兩件事,而閘只認後者。**
**⇒ 以後 apply 完的下一個動作就是追加 `APPLIED.tsv`(版本號 / sha256 / 日期 / 誰),不要等閘來提醒。**
