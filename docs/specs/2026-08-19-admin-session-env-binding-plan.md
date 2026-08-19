# admin session 綁環境 + 讓既有票失效 · slice plan(2026-08-19,W5)

> **狀態:等 Sean 批(鐵則 8)。** 命中 **鐵則 12②(權限/auth)** ⇒ 關卡1 / 關卡2 都不降級。
> **片型:高風險片。** 內容分級:不涉可編輯內容 ⇒ **L1**(值寫死在 code、年 0-1 次)。
> **來源**:Sean 2026-08-19 答 `q3=甲`(票裡加環境標記、跨環境的票直接失效)。
> **主視窗裁定**:與「`must_change_password_at` 完全不在路徑上」併成同一份 plan(兩個洞在同一條路上)。
> **審查**:本 plan 出去給 **W6**(寫的人與驗的人分開)。

---

## §0 🔴🔴 R1 對抗審查結果:**FAIL —— 這份 plan 現在【不可以】送 Sean 批**

審查=**W6**(fresh context、唯讀)· 交件 `~/pcm-mailbox/W6-006-審env綁定plan-R1-FAIL-四條-20260819.md`
**4 must-fix + 5 nit。四條我逐條自核過(可機械核的部分),全部成立。**

### 🔴 M1 · fail-closed 會把 Sean 鎖在外面,而且**零逃生門** —— 而真正的病是【順序】

```
proxy.ts:17-18 逐字：DEV_AUTH_BYPASS = NODE_ENV !== 'production' && ADMIN_DEV_BYPASS === '1'
⇒ 正式部署恆 false ⇒ 沒有 bypass
若 turbo 真的濾掉 VERCEL_ENV ⇒ 第一次 production 部署起 signSession 一律回 null
⇒ 🔴 所有人登不進去，唯一復原是改設定 + 重新部署
```
🔴🔴 **而它是一個【死鎖】,這才是 W6 最尖的一刀**:
`§6` 第 9 格我自己寫著「本機測不出來、要一次真的 preview 部署才看得到」
⇒ **要驗它必須先部署,而部署的風險正是它。**

📌 **W6 給的對照,我照抄因為它比我的原話準**:
> `dev-preview/layout.tsx` 那個前例**有 fallback**(`return env.NODE_ENV !== 'production'`)
> ⇒ **同一個未確認,在那裡只會誤殺,在你這裡會鎖門。**
> **你拿掉 fallback 的同時,把那個未確認變成了【承重的】。**

**⇒ 折法(已採納,見 §0.1):先出一片【零風險探針】,拿到答案再落 fail-closed。**

### 🔴 M2 · 路 A 的代價我低估了一個量級,而且不是「改一份 spec」

```
b3-spec:396-397 逐字：「B3（報價單）＝ 直接拒 v:1；B5（admin）＝ 暫時接受 v:1，
                        直到 ADMIN_REQUIRE_REAL_IDENTITY 打開才拒」
⇒ 而我 §3-3 寫的是【無條件立刻拒、零開關】
量法（我自己重跑）：grep -rIl 'ADMIN_REQUIRE_REAL_IDENTITY' docs/specs | wc -l ⇒ 8 份
  ⚠️ W6 報 7 份 —— 差的那一份【就是本檔】：我在 §1 更正裡引了 B5 的政策句，
     於是本檔自己進了分母。🔴 又一次「尺撞到講述它自己的文本」，這次是我讓它撞的。
     📌 **而這是一個【新的子形狀】,前三次都不是這樣**(主視窗 2026-08-19 判,已請 W2 收進 traps):
        前三次 = **尺撞到【別人寫的】講述它自己的文本**(說明行、提示行、規格自述)
        這一次 = 🔴 **量測者【自己把自己餵進分母】** —— 我為了更正一個錯,引用了被量的那個字面,
                 於是我的更正動作本身改變了我要量的那個數。
        判別句:**我在量的這段期間,有沒有【我自己】動過會被這把尺掃到的檔?**
```
⇒ **路 A 不是「改一句話」,是拆掉一個橫跨 8 份 spec 的漸進切換機制。**
🔴 **⇒ 這件我【不自己拍板】,轉成決策題,見 §0.2。**

### 🔴 M3 · 我自己違反了自己的限縮 —— 而它不在 §6,在正文

我在 §2 寫了⚠️框「本 plan 是洞二的前置不是解、不得勾洞二已修」,
**而正文兩處寫著「那道強制才回到路徑上」** —— **那道強制根本還不存在**:
```
grep -rIl 'must_change_password' apps/admin/src packages --include='*.ts' --include='*.tsx' | grep -vc '\.test\.'
⇒ 0   （我自己重跑過，與 W6 一致）
```
✅ **已折**:兩處都改成「**待 B2 落地之後**才回到路徑上」。
📌 **形狀值得留**:**我寫了一個正確的限縮框,然後在正文裡違反它。**
**框是給讀的人看的,而正文是他真正會照著做的東西。** ⇒ 限縮要寫進**動詞**,不是只寫進框。

### 🔴 M4 · 驗收:無恆綠格,但格 3 會【紅錯地方】,而且缺一格

```
格3（v:1 舊票 → 新驗證端 ⇒ 拒）：若用固定字串 fixture 而測試 secret 與產生它時不同
  ⇒ 它在【簽章】那關就被拒，版本檢查一行沒走到，而測試照樣綠
  ⇒ 修：同一顆 payload 只改 v，並排證 v:2 過 / v:1 拒
缺的那格（W6 N3）：§4.1 只規定 production 那半
  ⇒ 【非 production 而讀不到 VERCEL_ENV】要簽出什麼，沒規定
  ⇒ 若簽出 undefined，就和 turbo-strict 世界的 production 又對上了 —— 正是 §4 開頭要防的形狀
```
✅ 兩者已折進 §6(格 3 改寫、新增格 10)。

### ✅ M5 / N-族 · 轉述的射程限定沒有跟過來

`§2` 洞一那段我只標了【轉述】,而 **W6 原始量測的四條射程限定沒跟著搬**。已補進 §2。
其餘 nit(§4.3 乙沒有 backlog 編號 ⇒ 沒有落點;§3 分母只答「誰簽」沒答「誰驗」)一併折。

---

## §0.1 ✅ 折 M1:本工作拆成【兩片】,探針在前

> ## 🔴🔴 R2(W6)FAIL:**片 0 三條 must-fix,全部是「它會安靜地回一個假答案」**
>
> **總評逐字(W6)**:「片 0 把【鎖門】的風險移走了(對的),而它換成了另一種 ——
> **它可能安靜地回一個假答案,而下游會拿那個假答案去動 `turbo.json`**。」
> **三條我逐條開檔核過,全部成立。以下是折完的版本。**

```
片 0 · 探針（先做；🔴 而「零風險」三個字已被打掉，見下）
  · 🔴 R2-①：原設計會把【三個世界塌成兩個觀察】
        A 探針跑了、讀到 'preview'  ⇒ log 有值
        B 探針跑了、真的讀不到      ⇒ log 沒值
        C 探針【根本沒跑】          ⇒ log 沒值   ← 與 B 同一個畫面
        ⇒ B 與 C 都會被讀成「陷阱成立」⇒ 有人去改平台設定，而依據是假的
     ✅ 折法（三件缺一不可）：
        ① 無條件輸出一行（不是「讀到才印」）
        ② 讀不到時印顯式哨兵 __ABSENT__，不是空字串、不是省略
        ③ 同一行帶 NODE_ENV 當【正向對照】⇒ 整行不見才是世界 C
  · 🔴🔴 R2-②（最貴的一條）：探針量【一個 runtime】，而承重的有兩個
        signSession 在 route handler（callback/route.ts:72）
        而 env 比對寫在 isPayload() ⇒ 它跟著 verifySession 跑在 proxy.ts:40 那一側
        session.ts:4 逐字：「proxy.ts 的 runtime 只是註解宣稱、未證實（盲點掃描指名）」
        ⇒ route handler 讀得到而 proxy 讀不到 ⇒ 片 0 回報「陷阱不成立」⇒ 片 1 落地
        ⇒ 🔴 每一次請求 env 比對都失敗 = 全站登入失效，後果與鎖門相同而片 0 沒量到
     ✅ 折法：**片 0 必須在【兩個 runtime】各輸出一次**（route handler 側 + proxy 側）
  · 🔴 R2-③：plan 沒寫【怎麼讓探針跑起來】
        recordSsoLogin 呼叫端全在 callback/route.ts:52/62/68/75/84
        ⇒ 只有走 /api/sso/callback 才跑；preview 有 Vercel Authentication、又要報價單導過來
        ⇒ 沒人觸發 ⇒ 永遠停在世界 C
     ✅ 折法（我開檔核過：五個點裡【四個是 'fail'】）：
        **故意帶壞 state 打一發 /api/sso/callback ⇒ :62 state-mismatch 就會落一筆**
        ⇒ 不必完成登入、不必有帳號。**這一步寫成片 0 的驗收動作，不是備註。**
  · ⚠️ nit（W6）：探針搭 **console 那半，不是 DB 那半**
        login-event.ts:145-147 逐字：「表還沒 apply、權限不對、DB 掛掉、逾時，症狀都一樣」
        ⇒ 用 DB 那半當量具 = 又一個「兩個世界同一個畫面」
  · 不新增端點、不碰 session、不改 payload、不改 validator
  · 🔴 它【不會】讓任何人登不進去 —— 因為它不參與簽發或驗證的任何判斷
    ⚠️ 而「零風險」不等於「零誤導」—— 上面三條講的都是【它會不會給出假答案】，
       而假答案的下游動作是【改平台設定】。⇒ 本片的風險不在它自己，在它的讀者。
  · 🔴 驗收條件【只有一條，主視窗 2026-08-19 寫死】：
      **在 preview 的 log 裡看到它讀到的實際值，而 production 印出【不同的】值。**
      🔴 一個值不夠 —— 要【兩個世界印不同的東西】。
      只在 preview 印一個 'preview' 就收工 ⇒ 那與「這段程式永遠印 'preview'」在輸出上一模一樣。
  · 產出判讀：preview 印 'preview' 且 production 印 'production' ⇒ runtime 讀得到，陷阱不成立
              兩邊都印 undefined（或印同一個值）⇒ 陷阱成立，§4 必須順帶處理 turbo.json
                                                （鐵則 12④，另一層批准）
  · 🔴 追加驗收（主視窗 2026-08-19 邊界④）：探針除了印環境值，**也印它自己那份 code 簽出來的 v**
       ⇒ 一次部署換兩個答案，而且【兩個世界會印不同的東西】
       ⇒ 它順手填掉我目前唯一那格「未量到」：**沒有人打過那顆 preview 證明它真的還在簽 v:1**
          （現在那句是讀 code + 讀部署 sha 推的，不是量到的）
  · 片型：不改 session / payload / validator ⇒ 🔴 不中鐵則 12②，標準片即可

  ### ✅ 2026-08-19 片 0 已寫完(未部署)—— 而它比原設計【小很多】

  ```
  檔案  apps/admin/src/app/diag/env/page.tsx（+ page.test.tsx）
  形狀  production 單頁、gated（走 proxy.ts:39 的登入閘）⇒ 零 auth 改動
  內容  大字白話三格：這台機器讀到的 VERCEL_ENV / 它實際簽出的 v / NODE_ENV（正向對照欄）
  🔴 讀不到時印顯式哨兵 `__讀不到__`，不是空白 —— 「空白」與「頁面沒渲染」要分得開
  🔴 v 那格呼叫 buildAdminSession() 讀回傳值 ⇒ 是【這份 code 實際會簽的】，不是我寫死的常數
  ```

  ### 🔴 preview 那半【不做】,而理由寫在這裡(不要只是消失)

  ```
  ① 「preview 還在簽 v:1」⇒ 已用【零部署】的方式量到，不需要探針：
     vercel api /v6/deployments ⇒ 活著的 preview（branch=main, target=None）
       = dpl_2WKZwj6qCH2vnb17vbyV, sha = 84f57eda
     而 git rev-parse --short origin/main ⇒ 84f57eda（逐字相同）
     git show 84f57eda:apps/admin/src/lib/session/session.ts | grep "return { v:" ⇒ :112 v: 1
     🔴 對照 1（弱）：production 那顆 sha 也是 v:1 ⇒ 它證的是「尺會讀到不同 sha」，
        不是「會印不同答案」—— 因為今天兩邊本來就都是 v:1。【弱的這一發也留著】，
        留著並標明它弱在哪，下一個人才知道這一格還有一個沒被覆蓋的方向
     🔴 對照 2（強）：git show deadbeef:… ⇒ fatal ⇒ 「讀不到」與「讀到 v:1」分得開
     殘餘假設：build 忠實編譯了那份源碼 —— 而那是【每一次部署都在依賴】的同一個假設，
       不是這一格特有的弱點
  ② 「preview 讀到什麼」⇒ 不承重：只要 production 讀到一個【非空】值，
     金鑰材料就已經不同 ⇒ 閘有效。閘失效唯一的世界是【兩邊讀到完全相同的字串】
     ⚠️ 而那句仍是「我想不出它怎麼發生」，不是「我證明它不會」—— 照實標，不升級
     ✅ 而丁的 fail-closed 方向已覆蓋那個殘餘（讀不到 ⇒ 不簽）⇒ 它不成立時也不會變成放行
  ③ 要在 preview 上做，唯一的路是【放寬登入閘】(SSO_OPEN_PATHS 或 matcher)
     🔴 主視窗否掉，理由兩條：
       · 用一個 12② 改動去省一個 12② 改動的風險，帳不一定划算
       · 🔴 那條免閘路徑會【活得比探針久】—— 片 1 刪掉診斷頁時，那一行在【別的檔、別的 diff】裡，
         很容易被留下 ⇒ 一個為了探針而開的洞，會在探針消失之後繼續存在，而沒有東西會紅
  ```

  ### ✅ 而片 0 剩下要回答的,現在【只有一件】

  ```
  🔴 production 的 runtime 到底讀不讀得到 VERCEL_ENV（以及讀到什麼字）
  而連這一件都已經有兩個獨立旁證指向「讀得到」：
    ① 這支探針【自己的編譯產物】：grep "process\.env\.VERCEL_ENV" apps/admin/.next/server
       ⇒ 4 個檔仍是 runtime 讀（沒有被烤成字面）
       🔴 負向對照：grep 一個我沒寫過的變數名 ⇒ 0 檔 ⇒ 尺不是對什麼都命中
       📌 這比先前那一發強：先前是拿 ADMIN_SESSION_SECRET 推「server 端一般是 runtime 讀」，
          這一發是【要部署的那份 code 本身】
    ② vercel api /v9/projects/<pcm-admin> ⇒ autoExposeSystemEnvs = true
  ⚠️ 兩者都【沒有碰到一個正在跑的部署】⇒ 仍是推論。片 0 就是把它變成觀察。
  ```

  ### 🔴 退場的【機制】(不靠註解)

  ```
  ① 片 1（丁）那一顆 commit 必須同時刪掉 page.tsx 與 page.test.tsx
  ② 機械訊號（一半）：test 檔 import 了 page ⇒ 只刪 page 不刪 test ⇒ 【測試紅】
  ③ 另一半靠驗收格：片 1 收工前跑
       test -e apps/admin/src/app/diag/env/page.tsx   ⇒ 必須為【假】
     ⚠️ 誠實界線：② 擋不住反方向（只刪 test 留著 page 不會紅）⇒ ③ 要有人跑
  ```
    ⚠️ 而它仍要 Sean 點頭才部署（部署是他的動作）
片 1 · 綁定（本 plan 其餘部分）
  · 🔴 前置：片 0 的答案。在它回來之前【不落 fail-closed】
```
🔴 **這正是 W6 說的「病是順序」** —— 原本的順序是「先落一個承重的未確認,再去驗它」。

## §0.15 📌 兩條要並排寫的判別句(**分開寫會讓下一個人以為算過就安全**)

```
下游版（W5，2026-08-19）：當我請別人查某件事時，先問「我自己算得出來嗎」
                          —— 算得出來的，不該外包成一個問題
上游版（主視窗，同日，它自陳今天犯了三次）：
                          當我裁定某件事時，先問「我這一裁踩在哪個數字上，那個數字我量過嗎」
🔴 而【第三句才是這兩句的邊界】，缺了它前兩句會誤導：
   我這一輪【確實自己算了，然後算錯了】（12 小時那個上界）
   ⇒ 「先自己算」防的是【外包】，防不了【框錯】
   ⇒ 升級版：我這個算式裡，有哪一個「之後就會…」是我沒量過的？
      上界 / TTL /「會自己過期」這類句子全部靠一個【未來狀態】，而未來狀態最容易被假設掉
```

## §0.16 📌 **重裁理由,只重新想了【辯護】那一半**(主視窗 2026-08-19 自陳,出處記主視窗)

```
主視窗兩次重裁 §0.2，兩次都在【修理由】，
而【沒有回頭問「甲到底有沒有做到他要的那件事」】—— 答案是完全沒有。
🔴 判別句：重裁理由會讓人覺得已經重新想過了，而它其實只重新想了【辯護】那一半。
⇒ 換理由的當下要另外問一次：【結論本身】還成立嗎？
```

## §0.2 🔴 決策題(折 M2 之後浮出來的)—— ✅ **2026-08-19 主視窗裁【丁】**

> 🔴 **而「照字面還是照效果」那一題,主視窗判它【不成立】,理由要照抄不得含混**:
> **「在票裡加環境標記」那七個字是【主視窗自己寫的】,不是 Sean 說的** —— 那是端給他的選項裡
> 主視窗描述機制的措辭。**他真正批的那一格逐字是括號裡那句:「程式裡、有測試、活得比後台開關久」**
> ⇒ **丁三條全中,而且比甲硬**(不論 `v:1` `v:2` 一律死)。
> ⇒ **⇒ 選丁不是拿事實推翻他的決定,是把【我方自己寫壞的機制描述】換掉。**
> ⇒ 主視窗明講會在給 Sean 的說明裡**寫明是它自己寫窄了,不含糊帶過**;
>   而 Sean 只需要知道一句:**「做法換了,效果更嚴格,而且不用動另外 8 份規格」——不佔他一題。**


```
本 plan 原設計：v:1 無條件立刻拒（洞二的前置需要它）
既有設計    ：v:1 由 ADMIN_REQUIRE_REAL_IDENTITY 控（橫跨 8 份 spec 的漸進切換）
🔴 兩者不相容，而【拆掉哪一個】不是我該決定的：

甲  保留開關：本片只做 env 綁定（v:2 票必須 env 相符），v:1 仍由開關控
    ⇒ 洞一修掉 —— 🔴 而它【有界，而那個界原本沒寫】（折 R2 nit；W5 與 W6 各自算到同一格）：
     「洞一修掉」只對【片 1 之後簽的票】成立。片 1 之前簽出的 v:1 票沒有 env 欄
     ⇒ 環境檢查對它無效 ⇒ 它在 production 上照樣有效，直到自己過期
     ⛔⛔ ~~而那個「直到」可量且很短：ADMIN_SESSION_MAX_AGE_SEC = 60*60*12~~
     ⛔ ~~殘留窗【最長 12 小時，而且會自己關】，不需要任何人做任何事~~
     ⛔ ~~且片 1 之後 preview 再也簽不出 v:1~~
     ⛔ ~~📌 補這一段會讓【甲】更站得住~~

     🔴🔴 【2026-08-19 R3 撤回:上面整段是錯的。它不是殘留窗,它是【可續杯的】。】
     發現者 W6(它同時更正了自己 R2 給的同一句);**下列數字 W5 自量,不是轉述**:
     ```
     git rev-list --count origin/main..origin/dev            ⇒ 220
     origin/main tip 84f57eda / origin/dev tip 1aecece1
     git show origin/main:apps/admin/src/lib/session/session.ts | grep -n "return { v:"
       ⇒ :112  return { v: 1, … }      ← preview 那顆【現在就在簽 v:1，而且沒有 env 欄】
     ```
     **pcm-admin 的 production 分支是 `dev`、preview 來自 `main`**
     ⇒ preview 跑的是**落後 production 220 顆**的 code
     ⇒ 片 1 併進 `dev` 之後，**preview 仍持續簽出 v:1、沒有 env 欄**
     ⇒ 甲之下 v:1 不做環境檢查 ⇒ **收**
     ⇒ 🔴 **「跨環境的票」不但沒失效，它還在被【持續生產】** ⇒ **甲【沒有做到】Sean 那句話。**

     🔴 **邊界線的診斷(W6 逐字,比我寫得準)**:
     > 「『在他批准的範圍內選最小實作』這條**邊界線本身沒問題** —— 問題是**甲落在那個範圍外面**。」

     📌 **這一格的教訓(W5 與 W6 各自犯了同一個)**:
     我們都寫了「**片 1 之後 preview 就…**」而**沒有量 preview 會不會拿到片 1**。
     🔴 **判別句:我這個算式裡,有哪一個「之後就會…」是我沒量過的?**
     **上界 / TTL /「會自己過期」這類句子,全部靠一個【未來狀態】,而未來狀態最容易被假設掉。**
     ⚠️ **射程**:220 是當下值會變;**沒有人去打那顆 preview 證明它真的還在簽 v:1**
     —— 這是**讀 code + 讀部署 sha 推出來的**,不是量到的。
  🔴 而洞二的前置【沒有達成】（既有票還在）
    ⇒ 漸進切換機制原封不動，8 份 spec 不必改
乙  照原設計：v:1 無條件拒
    ⇒ 洞一 + 洞二前置一起達成
    ⇒ 🔴 代價：拆掉那個漸進切換機制，8 份 spec 要重新對齊
丙  兩段做：先甲（現在），等 B5 時把 v:1 的拒併進開關打開那一刻
    ⇒ 🔴 代價：所有人被登出兩次（正是 §7 一開始要避免的）
🔴🔴🔴 丁【R3 之後升級:它從「另一個選項」變成【唯一同時滿足兩邊的】】
    （W6 於 R2 找到、我原本漏了；R3 證實甲做不到之後，它的地位改變）
    舊 code 的 preview 用 importKey(secret)、新 code 的 production 用 importKey(secret+'|production')
    ⇒ 簽章對不上 ⇒ 🔴 不論 v:1 還是 v:2 一律死 ⇒ 真的做到「跨環境的票直接失效」
    ⇒ 而它零 payload 改動 ⇒ B5 的開關機制一個字都不必動 ⇒ 8 份 spec 零改
    ⇒ **乙做得到但要拆 8 份 spec；丁兩件都做到。**
    原始描述如下：
    把環境綁進【金鑰推導】，不是綁進 payload。
    session.ts:76-81 getKey() 現行 importKey('raw', encode(secret), …)
    ⇒ 改成 importKey('raw', encode(secret + '|' + env), …)
    · 跨環境的票在【簽章】那一關就死 ⇒ fail-closed 是【構造上的】，不必在 isPayload 加分支
    · 🔴 零 payload 改動 ⇒ 不升 v ⇒ B3/B5 的 v:1→v:2 完全不動 ⇒ 8 份 spec 零改
    · 代價與乙同：金鑰換了 ⇒ 登出一次 ⇒ 洞二的前置【也達成】
    · ⚠️ 省不掉片 0：env 讀不到 ⇒ 兩環境又推導出同一把金鑰 ⇒ 同一個恆綠陷阱
    · ⚠️ 誠實代價（W6 標的）：失敗訊號變成「簽章不符」，與【竄改】在 log 上分不開
    🔴 而它有一個【字面 vs 事實】的問題，必須由裁的人看，不由我判：
       Sean 答的那一句逐字是「**在票裡加環境標記**，跨環境的票直接失效」
       ⇒ 丁【沒有在票裡加任何標記】—— 它做到的是後半（跨環境直接失效），而且做得更硬
       ⇒ 這是「照他的字面」還是「照他要的效果」的取捨 ⇒ 🔴 我不判，送上去
我的推薦：甲。理由=洞一的急迫度來自「E8-B 一往前它的賠率就變大」，而那與 v:1 收不收無關；
         而洞二的前置可以掛在 B5 開開關那一刻（本來就會登出一次），不必另外製造一次。

✅✅ 【裁甲】—— 主視窗 2026-08-19，而且【這一題不上送 Sean】。理由逐條：
  · ⛔ ~~Sean 批的是「在票裡加環境標記、跨環境的票直接失效」⇒ **甲 100% 做到那件事**~~
    🔴 **2026-08-19 主視窗重裁,理由更換,原因:原句未涵蓋【現存的票】。**
    主視窗自陳逐字:「我當時**沒有去想現存的票**,我只比對了『他批的字面』與『甲的設計意圖』,
    **沒有比對它們與世界**。」
    ✅ **新理由(逐字)**:甲對**片1 之後簽的每一張票** 100% 做到;**片1 之前簽出的票**
      有一個**最長 12 小時、會自己關**的殘留窗(`session.ts:58` `ADMIN_SESSION_MAX_AGE_SEC = 60*60*12`,
      而 `:112` 現行無條件簽 `v:1`)。而在**只有一個使用者、preview 又有 SSO 保護**的今天,
      拿 8 份 spec 去換那 12 小時**不成比例**。
    📌 **送 Sean 的形狀 = 一句【告知】不是一題**:「開關打開之前,舊的票最長還會活 12 小時,
      那段期間跨環境仍然有效。」**他要不要為那 12 小時多做什麼,才是他的題。**
  · 乙要拆掉一個橫跨 8 份 spec 的漸進切換機制 ⇒ 那是【範圍擴張】，不在他答的那一題裡
    🔴 範圍擴張要問他；而【在他批准的範圍內選最小實作】是我方該做的判斷，不是他的
  · 丙自己踩到本 plan 一開始就要避免的東西（登出兩次）

🔴 【邊界】（這一裁的附帶條件，不是可選）：
  甲之下，洞二的前置【未達成】⇒ 驗收表那一格照原紀律寫「仍未修」，不准寫「部分完成」
  而洞二的前置【掛在 B5 打開 ADMIN_REQUIRE_REAL_IDENTITY 那一刻】（本來就會登出一次）
  ⇒ 🔴 那個掛載點已寫進 B5 spec，否則它會變成一個沒有人接手的孤兒
⚠️ 日後若發現甲擋不住某個【真實攻擊路徑】⇒ 那才是 Sean 的題（要不要提早拆那個機制）
   到那時再送，並附上【是什麼路徑逼我們回來的】。
```

## §0.3 ✅ W6 順手解掉我一格「未解」

`§9-2` 我寫「preview 部署有沒有 Vercel 存取保護 —— 未查」。
**W6 已查**(`W6-002`):三個專案 `ssoProtection.enabled=true` / `all_except_custom_domains`
⇒ **preview 僅限有 Vercel 帳號的人進得去。**
🔴 **這改變的是【急迫度框架】不是【修法】**:洞一的可觸發者從「任何人」收窄成「有 Vercel 帳號的人」
⇒ **仍要修**(帳號會外流、成員會離職、而票是可攜的),**但它不是對外開放的洞。**
⚠️ **射程**:那是 W6 量的,本窗未自量 ⇒ 標【轉述】。

---

## §1 🔴 代價與時機 —— **先讀這段,它決定了「現在做」是不是對的**

**動 payload = 現在所有已簽發的票【全部立刻失效】,所有登入中的人被踢回 `/api/sso/start`。**

🔴 **而現在只有 Sean 一個人在用後台。**
```
量法(當場可重跑,值會過期)：
  報價單 auth.users            ⇒ 2 列（sean@… / shopee1@…，兩個都是 Sean 本人）
  「目前沒有任何一筆真實訂單、尚未對外開放」⇒ STATUS.md「全站業務前提」那一行
⇒ 被踢下線的人數 = 1，而那個 1 就是要批准這件事的人
```
**⇒ 代價最低的時刻是現在,而那個「最低」會隨真登入上線消失** —— 員工帳號一開,
同一個動作就變成「全公司在上班時間被登出」。
📌 **這是【做它的理由】,不是它的風險。** 把它寫在第一段,是因為讀的人會先看到「所有人被登出」而卻步。

### ⛔🔴 2026-08-19 本窗自我更正 —— **上面那段原本把主詞寫錯了,而它是這條線上的第三次**

⛔ ~~**而它有一個【不可分割】的相鄰事實**:`B3` 片本來就要把 payload 升 `v:2`(為了塞 `sub`)。~~
⛔ ~~本 plan 的 v:2 與 **B3** 的 v:2 必須是同一次 bump。~~

🔴 **錯在哪:`B3` 升的是【報價單自己的 cookie】,admin 一個位元都看不到。**
逐字依據(我開檔核過,不是推的)——`docs/specs/2026-08-16-m4b-e8b-b3-spec.md:617`:
> **報價單把它的 payload 升到 `v:2`,admin 一個位元都看不到。「所有人被登出」那件事不會發生。**

**跨 repo 傳的是一份 server-to-server 的 JSON,不是 cookie。** admin 拿到 `amr` + `auth_time` 之後
**自己簽一個全新的 session**(`callback/route.ts:72`),那個 `v` **是 admin 自己給的**。

✅ **真正與本 plan 耦合的是 `B5`**(`plan v4:167` 把 admin 那半放在 B5):
`docs/specs/2026-08-17-m4b-e8b-b5-spec.md:525` 逐字 `export interface AdminSessionPayloadV2 … { v: 2; sub: AdminSessionSub }`。

📌 **而這個錯【B3 spec 自己已經記錄過兩次】**(`:611-615` / `:629-632`):第一次是寫 B3 的人,
第二次是 codex 2026-08-17 抓到,它當場命名為 **「每個字都是對的,只是主詞放錯」**(memory
`feedback_wrong-subject-narration-every-word-true`)。**我是第三次。**
🔴 **可複用的判別句**:句子裡出現「payload / cookie / session / validator」時,**先問【誰簽的、誰驗的】**
—— 這條線上有**兩個 repo 各一套同名的東西**,而它們**從不互相驗**。

### ✅ 更正後的相鄰事實(結論仍成立,而理由換了、而且更強)

```
本 plan 動 admin payload；B5 也動 admin payload（加 sub）⇒ 🔴 同一個檔、同一行（session.ts:131）
⇒ 分兩次 bump ⇒ 所有人被登出【兩次】—— 這一句原封成立，只是對象從 B3 換成 B5
⇒ 而 B5 比 B3 更下游（B5 卡 B4、B4 卡 B3、B3 卡 B2、B2 卡 anon key）
   ⇒ 🔴 等 B5 比等 B3 更久 ⇒ §7 的「現在就做」不但沒被推翻，理由還變硬了
```
🔴 **而【結論對而理由錯】不是沒事** —— 下一個人是照理由決定要不要重看的。所以原句劃掉留著,不刪。

### 🔴 而更正之後浮出一個【原本看不到的衝突】,它要在動工前解掉

```
本 plan  ：v:1 一律拒（既有票全失效 = 洞二的前置）
B5 spec :555 逐字：「ADMIN_REQUIRE_REAL_IDENTITY 開 ⇒ v:1 一律拒；關 ⇒ v:1 / v:2 都收」
         :612 逐字：buildAdminSession 無 sub 時「維持 :93 現行的 v:1 形狀一字不動」
⇒ 🔴 兩份設計對【同一行 session.ts:131】給出不相容的預設
```
**解法(要 W6 / 主視窗核):本片把 `v:2` 定義成「帶 `env`、`sub` 欄保留未用」,
B5 之後【在 v:2 上填 `sub`、不再 bump】。**
⇒ B5 的「開關關 ⇒ v:1 也收」那半**在本片之後失去對象**(本片之後沒有任何東西再簽 v:1)
⇒ **那半要改寫成「開關關 ⇒ v:2 但 `sub` 未填也收」。**
🔴 **這個交接必須寫進 `B5 spec` 那一份,不能只寫在本檔** —— 會踩到它的人讀的是 B5 spec。

---

## §2 兩個洞(**分開列,因為它們的性質不同**)

### 洞一 · 新增一道【今天不存在】的防線:票沒有綁環境

```
現況（我開檔核過，不是推的）：
  apps/admin/src/lib/session/session.ts:41   AdminSessionPayload = { v, sid, iat, exp, amr, auth_time }
                                             ⇒ 🔴 沒有任何一欄說「這張票是哪個環境簽的」
  :112  buildAdminSession() 寫死 v: 1
  :131  isPayload() 第一道就是 if (o.v !== 1) return false
  cookie = base64url(payloadJSON) + '.' + base64url(HMAC_SHA256(payload, ADMIN_SESSION_SECRET))
```
而 `ADMIN_SESSION_SECRET` 在 Vercel 上是**單一條目、`Preview` 與 `Production` 同列**
⇒ **兩環境同一個值** ⇒ **preview 簽的票,production 驗得過。**

🔴 **而 preview 部署【一直在自動長出來】,不是偶爾一台**:
`pcm-admin` 的 production 分支是 `dev`、storefront 的是 `main`
⇒ **對 `pcm-admin` 而言 `main` 是一個 preview 分支** ⇒ **每一次客人站上線,都順手產生一顆後台的 preview 部署**
(別名固定 `pcm-admin-git-main-pcm-motorsports.vercel.app`)。**沒有人要它,也沒有人知道它在。**
📎 出處:W6 量的,經主視窗逐字轉;本窗未自量 ⇒ **標【轉述】**,而它與我自己量到的 env 清單一致。
🔴 **而 W6 原始量測的四條射程限定必須跟著這段走(折 W6 N5;這段會被複製進給 Sean 的摘要,而前後文不會)**:
```
① 只看最近 20 顆部署，【沒有翻頁】
② 「target:null = preview」是【讀欄位語意推的】，不是引官方文件
③ 【沒有去打那個網址】—— 沒有證實它現在活著
④ 別名會不會換【沒驗】
⇒ 這四條在一起的意思是：「preview 部署會自動長出來」這個結論【方向可靠、而細節未坐實】。
```

**🔴 為什麼這件事【必須跟 E8-B 一起做】,而不是排到之後**(這一段是本 plan 的承重點):
```
今天：payload 沒有 sub ⇒ 同一把鑰匙偽造得出來的上限 = 「一個【沒有身分】的已登入狀態」
E8-B 之後：payload 有 sub ⇒ 同一把鑰匙偽造得出來的是 「我是 sean」
⇒ ⇒ 這不是本線【引入】的漏洞，是本線【把既有漏洞的賠率放大】
⇒ 前者可以選擇「不要做」；後者【必須在同一條線裡一起修】，否則做完會比不做更糟
```
📌 **兩份規格各自 fresh context 獨立走到同一格**(`docs/reviews/2026-08-19-b3-b4-spec-k1-codex-findings.md` §2):
B3 逐字「**本片把可偽造內容從『已登入』升級成『冒名某員工』,因此更糟**」;
B4 逐字「preview **現在會成為可簽發具名 sub 的 production 冒名入口,冒名難度降低**」。

### 洞二 · 一道【已經寫好、但根本沒被走到】的防線:強制改密碼

> 🔴 **狀態欄一律寫【仍未修,前置已排除】—— 不得寫「部分完成」**(主視窗 2026-08-19 明文)。
> **理由**:「部分完成」在清單上會被下一輪的人讀成「剩一點點」,而它剩的是
> **B2 落地 + 攔截點要在所有入口之前** —— **那是一整條線,不是收尾。**
> 📌 **半綠的格子比紅的格子危險。**

```
B2 規格要求「首次登入強制改密碼」。而 codex 關卡1 逐字：
  「既有新式 v1 session 或 legacy cookie 已存在時，使用者不必重新登入即可直接打 SSO authorize
   → must_change_password_at 完全不在路徑上。」
```
🔴 **母 plan §6 第 9 條在三天前就逐字寫著「第 9 條是最容易漏的一條」** —— 而它現在仍然是漏的。
📎 全文與「指名一個風險 ≠ 覆蓋那個風險」那條教訓:`docs/reviews/2026-08-19-e8b-forced-password-change-not-on-the-path.md`。

**🔴 兩個洞為什麼是同一份 plan**:它們的修法是**同一個動作** ——
**動 payload / 升版本 ⇒ 既有票全失效 ⇒ 每個人都得重新登入 ⇒ 那道強制【待 B2 落地之後】才回到路徑上。**

⚠️ **而要誠實講清楚射程**:本 plan **不是**洞二的完整修法。
```
本 plan 做到的：把「既有票可以繞過」這個【前提】拿掉
洞二真正的修法：在 B2 落地那道強制，並且攔截點要在【所有入口之前、包含 SSO authorize】
⇒ 本 plan 是它的【前置】，不是它的【解】。不得在驗收表上勾「洞二已修」。
```

---

## §3-丁 🔴🔴 **【現行設計】綁金鑰推導** —— 主視窗 2026-08-19 裁丁,取代原 §3

> ⛔ **下面原本的 §3(改 payload / 升 `v:2` / 加 `env` 欄)已被取代,劃記保留不刪。**
> 取代的理由不是「payload 那條寫得不好」,是 **R3 證實它【沒有做到 Sean 要的那件事】**(見 §0.2)。

### 3-丁.1 改什麼(**一處**)

| 檔案:行號 | 改什麼 |
|---|---|
| `apps/admin/src/lib/session/session.ts:76-88` `getKey()` | `importKey('raw', encode(secret), …)` ⇒ `importKey('raw', encode(secret + '|' + env), …)` |

**就這樣。** payload 不動、`isPayload()` 不動、`buildAdminSession()` 不動、`v` 不升。

```
效果：舊 code 的 preview 用 importKey(secret)、新 code 的 production 用 importKey(secret+'|production')
     ⇒ 簽章對不上 ⇒ 🔴 不論 v:1 還是 v:2 一律死
⇒ 這是【構造上的】fail-closed —— 不是多一道 if，是那把鑰匙根本開不了那把鎖
```

### 3-丁.2 🔴🔴 **只綁一把,而【另一把絕對不能綁】**(主視窗裁定的邊界①,而我把答案查出來了)

```
✅ 綁：ADMIN_SESSION_SECRET   —— admin 自己簽自己驗，兩端都在本 repo
🔴 絕對不綁：PCM_SSO_EXCHANGE_SECRET
```
**理由是量到的,不是保守**:那把 secret **不是拿來推導金鑰的,是【逐字當 Bearer token 比對】**:
```
admin 側   apps/admin/src/lib/sso/exchange.ts:116   authorization: `Bearer ${config.exchangeSecret}`
報價單側   app/api/sso/exchange/route.ts:28         const expected = process.env.PCM_SSO_EXCHANGE_SECRET;
                                                    （常數時間比對，:8 檔頭逐字）
```
⇒ **admin 若送 `secret+'|production'`,報價單拿 `expected` 逐字比 ⇒ 對不上 ⇒ 每一次 SSO 換票都 401
⇒ 🔴 全站登入失效。而那是【另一個 repo】,不會有任何東西紅。**
📌 **判別句(本 plan §5 那條的實例)**:**我改的東西,對面那個 repo 讀不讀?讀 ⇒ 停下。**
⇒ **要不要分離那把,是【另一片、另一次批准】。本片一個字都不動它。**

### 3-丁.3 代價:**不是 12 小時,是【當場】**(邊界②)

```
丁讓 v:1 也死 ⇒ 🔴 片1 部署當下，【所有現存 session 立刻失效】，沒有寬限期
⇒ 而這正是它比甲強的地方（甲對 v:1 不做檢查，preview 還在持續生產）
⇒ 並排要寫的那句：今天後台【只有 Sean 一個人在用】（報價單 auth.users 2 列都是他本人）
   ⇒ 立刻失效的人數 = 1，而那個 1 就是要批准這件事的人
```

### 3-丁.4 **本片零 spec 改動**(邊界③,附前後同值的證據)

```
🔴 ADMIN_REQUIRE_REAL_IDENTITY 那個橫跨多份 spec 的漸進切換機制，本片【一個字都不動】

⛔⛔ 原本寫的量法【是壞的，而且它在【現在】就已經印錯了】（W6 R4-M3，我自量複驗成立）：
  ~~grep -rIl 'ADMIN_REQUIRE_REAL_IDENTITY' docs/specs | wc -l  ⇒ 前後都 8~~
  🔴 它測不到「動了 spec」——因為 b5-spec【本來就含那個字面】，改它不會讓計數變。
  而我本輪【真的動過 b5-spec】。當場量：
    git show --name-only --format='' <sha> | grep -c '^docs/specs/'
      14682d88 ⇒ 1   40073186 ⇒ 2   5650aaea ⇒ 2   b9379bb9 ⇒ 2   2c7dce09 ⇒ 1
    ⇒ 那個 2 的第二支就是 docs/specs/2026-08-17-m4b-e8b-b5-spec.md
  📌 母題：【尺量的是「這個字在不在」，而我要問的是「這個檔有沒有被改」】——兩件事。

✅ 換成這把（量的是【異動】不是【字面】）：
  git show --name-only --format='' <本片的 sha> | grep '^docs/specs/'
  ⇒ 只准出現本 plan 自己一支；出現 b5-spec 或任何其他 spec = 本片越界了
  🔴 而【本片之前的那幾顆刻意動過 b5-spec】（掛載點、判別句），那是主視窗明文要求的第二落點
     ⇒ 那些不算越界，而【實作片】不得再動它。兩者要分開講。

📎 而 W6 自陳它第一發也量錯（跑 git diff --name-only origin/dev...HEAD -- docs/specs/ ⇒ 10，
   那是全窗未推的東西不是我這片）⇒ 同一個坑的另一面：**尺對了、範圍錯了。**
```

### 3-丁.6 🔴🔴 R4-M1:`getKey()` 的**快取鍵**必須一起改,而**只改它不夠**

```
session.ts:74-88 現行快取鍵【只認 secret】：if (secret !== cachedSecret || !cachedKey)
⇒ 我把材料改成 secret+'|'+env，而快取鍵沒跟著把 env 算進去
⇒ 同一個 process 內 env 變動時 ⇒ secret 沒變 ⇒ 回【舊的 key】
```
🔴 **W6 打出來的那半比我設想的毒**(逐字):它**會紅**,而它
> 「紅在一個**看起來像測試環境問題**的地方,而最順手的修法是 `vi.resetModules()`
> ⇒ **suite 綠了而 `getKey()` 一行沒改**。」

📌 **那是「動驗證本身」的立即停止訊號**(常載 §R4)—— **修法不是讓它變綠,是讓它紅得對。**

**⇒ 折法(兩件缺一不可)**:
```
① 快取鍵改成【完整材料】：material = secret + '|' + env，比對 material 不是比對 secret
② 加一格【在同一個 process 內】釘住快取的測試
   ⛔ ~~同一把 secret，簽 env=A → 翻成 env=B → 再簽 ⇒ 兩顆簽章必須不同~~
   🔴🔴 【R5 撤回:那樣寫是【恆綠】的。W5 自己起疑 → W6 獨立證實 → 我自量複驗】
     session.ts:99-103 newSid() ⇒ crypto.getRandomValues（每次不同）
     session.ts:112-113 buildAdminSession() ⇒ sid: newSid()、iat/exp = Date.now()
     ⇒ 兩次產出的【payload 本身就不同】⇒ 簽章必然不同
     ⇒ 🔴 那格【不論 env 有沒有進快取鍵都會過】
   ✅ 正確寫法（兩件缺一不可）：
     (a) 🔴 不要用 buildAdminSession() —— signSession(payload) 收的就是現成 payload（:116）
         ⇒ 用【同一顆固定 payload】簽兩次，中間只翻 env
     (b) 🔴 加正向對照：同一顆 payload + 【同一個 env】簽兩次 ⇒ 簽章必須【逐字相同】
         （HMAC 是決定性的）
         ⇒ 沒有 (b)，「不同」可以來自任何東西 —— 那正是這次恆綠的成因
   ✅ 修完它真的有判別力：快取 bug 在場 ⇒ 第二次拿到舊 key ⇒ 兩顆簽章【相同】⇒ 格②紅
   🔴 沒有②，①被改回去時【沒有任何東西會紅】
```

### 3-丁.7 🔴🔴🔴 R4-M2:驗證端的失敗訊號**不是「合流」,是【根本不存在】** —— 這是丁的必要配套

我問 W6「跨環境失敗會不會被讀成又是環境搞錯」。**它的答案是:不會,因為根本沒有人會讀到。**
**我自量複驗**:
```
grep -c 'return null' apps/admin/src/lib/session/session.ts                ⇒ 11 條失敗分支
grep -cE 'console\.|logger|record' apps/admin/src/lib/session/session.ts   ⇒ 0
proxy.ts:41-50 ⇒ 只是導去 /api/sso/start，零記錄
recordSsoLogin 只掛 callback 那五個點（:52/:62/:68/:75/:84）
```
⇒ **`verifySession` 的每一種拒絕都完全靜默。真偽造 / turbo 濾掉 / 自然過期
—— 三者輸出【完全相同,而且都是空的】。**

🔴🔴 **⇒ 丁上線後若 production 讀不到 env,第一個症狀是【所有人被登出,而零 log】。**
**⇒ 因此:三態分類訊號(`sig_invalid` / `expired` / `shape`)= 丁的【必要配套】,不是 nice-to-have。**

### 🔴 R5-M2:而它**放錯層了** —— 而「刻意靜默還是沒做」的答案是**第三種**

```
【DB 那半】被既有硬規則明文擋住 —— 不是沒做，是【不准做】
   session.ts:3-5 ★runtime-neutral 硬規則★ 逐字「絕不 import 'node:crypto' 或 '@supabase/supabase-js'」
【console 那半】查無任何一份裁過它
   W6 掃 docs/specs + docs/reviews ⇒ 查無
   🔴 而 W6 自陳【沒掃 memory 與 lessons-learned】⇒ W5 補掃了，結果要分開講：
     · 「verifySession 要不要記」⇒ 仍然【查無裁定】
     · 🔴 而找到一條【相鄰的】裁定，它管的是【記什麼】不是【記不記】：
       memory project_m4a-admin-phase1-decisions.md:77 逐字「security-log 不記 code/secret/token」
     ⇒ 兩者不可互相取代：那條約束了內容，沒有授權或禁止這個行為本身
⇒ 結論：一半被硬規則擋住、一半沒人裁過。【兩者都不是「刻意保持靜默」】。
```

**✅ 折法(W6 給的形狀,我採納)**:
```
verifySession 回傳改成帶原因：{ ok:false, reason:'sig_invalid'|'expired'|'shape' }
【由呼叫端記錄】—— 而呼叫端只有兩處：proxy.ts:40 / authorize.ts:29（我自量複驗）
好處：不碰那條硬規則 / session.ts 維持純函式 / 兩端各自決定要不要記、記去哪
```

### 🔴 R5-nit:這個訊號有**兩個新攻擊面**,而「不記 token/sid」只擋掉其中一個

```
① 🔴 未認證的人可以【無限觸發它】
   隨便一顆壞 cookie 打任何 admin 網址就走到 proxy:40
   ⇒ 寫 DB = 未認證寫入放大
   ⇒ 寫 console = log 被灌爆、【真訊號被淹掉】
      📌 那等於：這道警報【在最需要它的那一天】失效
   ⇒ 規定：console-only + 取樣/聚合，不得逐次寫 DB
② 🔴 分類【永遠不得影響回應】
   現在三種都回同一個 303 —— 那是對的，而它要【寫成規定】不是靠現況
   ⇒ 哪天 sig_invalid 與 expired 回不同狀態碼 / 標頭 / 延遲
      = 等於告訴偽造者「你的簽章對了，只是過期」
③ ✅ PII 那格已照 login-event.ts:149 紀律做到（只記分類，不記 token / payload / sid）
```

### 3-丁.8 ⚠️ R4-M4(nit):代價的下游 —— **我點的三個裡只有一個成立,而真正的風險我沒點到**

```
✅ 背景 job    不受影響（cron 走 CRON_SECRET，不是 session）
✅ requestId  不受影響（每請求新產）
🔴 進行中的表單【會丟】—— order_note.append 那條用 server 渲染時發的一次性 token

🔴🔴 而我完全沒點到的那個（W6 找的）：
   舊金鑰實例與新金鑰實例【同時存在的那一段】
   ⇒ 持舊票的人被新實例拒 → 重登 → 拿新票 → 打到舊實例 → 又被拒 ⇒ 【來回彈】
   · Vercel 別名切換通常原子 ⇒ 視窗很短，但【非零】
   · ⛔ ~~若 Rolling Releases 開著就【不短】—— 那格沒有人查過，標【未查】~~
     ✅🔴 **2026-08-19 W5 當場查掉了（唯讀，附負向對照）**：
     ```
     vercel api "/v1/projects/prj_vzKNmbKryBdp4mAenFbyD6gehJjF/rolling-release/config?teamId=…"
       ⇒ {"rollingRelease": null}          ← pcm-admin【未設定】
     🔴 負向對照（證明這把尺不是對什麼都回 null）：
     同一支端點換一個不存在的 project id ⇒ Error: Project not found. (404)
       ⇒ 尺分得出「查到了而它是 null」與「根本沒這個東西」兩個世界
     ```
     ⇒ **Rolling Releases 沒開 ⇒「來回彈」的視窗回到「別名切換」那個量級（通常原子）⇒ 短但非零。**
     ⚠️ **射程**:這是**現在**的設定值,**它是可以被改的** ——
     若有人在片 1 部署前打開 Rolling Releases,這一格要重查。**寫成部署前的一步,不是結論。**
```

### 3-丁.9 ✅ **丁還有一個 plan 沒寫的【結構性】優勢,而它有本 repo 裡的實錘**(W6 R5-nit)

`docs/specs/2026-08-16-m4b-e8b-b3-spec.md:819` 逐字(那份 spec **自己的 R2 must-fix**):
> 現行 `2fa/enroll/confirm:89` 是 `buildPayload(...)` **重新造一個 payload**
> ⇒ **`sub` 會靜默消失,而 3b/3c/4/4b/4c/4d/7/9/10 全綠**。

🔴 **同一個失效模式,對「`env` 欄」一字不差成立** ——
**未來多一個簽發點,誰忘了帶 `env`,十格照樣全綠。**

**⇒ 而丁把 `env` 放進【金鑰】⇒ 新的簽發點【自動繼承】,沒有人需要記得。**
📌 **這是丁勝過甲/乙的【結構性】理由,而不是效能或工作量的理由** ——
**它把「要靠人記得」換成「不記得也不會錯」。**

⚠️ **而它今天是【未來式】的,照實標**:
```
signSession( 的真呼叫端（非測試、非定義）分母 = 1
  量法：grep -rn "signSession(" --include='*.ts' --include='*.tsx' apps/admin/src | grep -v '\.test\.'
  ⇒ 只有 apps/admin/src/app/api/sso/callback/route.ts:72
🔴 而 b3-spec:819 指的 app/api/admin/2fa/enroll/confirm/route.ts【本 repo 不存在】
  （find apps/admin/src -path '*2fa*' -o -path '*enroll*' ⇒ 零命中）—— 那是【報價單 repo】的檔
⇒ 所以：§3 的分母【今天正確】，這個優勢要等「第二個簽發點出現」那天才兌現。
```

### 3-丁.5 仍然沿用原設計的部分

```
· §4 那整節（VERCEL_ENV 的恆綠陷阱、fail-closed 方向＝不簽）🔴 原樣成立
  —— 丁一樣要讀 env，讀不到一樣會讓兩環境推出同一把金鑰 ⇒ 同一個陷阱
· §0.1 片 0 探針 原樣成立，且驗收條件多一項（見 §0.1 追加）
· §5 報價單影響面 原樣成立，而 3-丁.2 把它變成一條【具體的禁令】
```

---

## ⛔ §3 要改什麼(四處,全在 admin repo)—— **已被 §3-丁 取代,保留不刪**


| # | 檔案:行號 | 改什麼 |
|---|---|---|
| 1 | `apps/admin/src/lib/session/session.ts:41` | `AdminSessionPayload` 加 `v: 2` 與 `env: string` |
| 2 | `:106-112` | `buildAdminSession()` 寫入 `v: 2` 與當下環境標記 |
| 3 | `:131` | `isPayload()` 改 `o.v !== 2` ⇒ reject;**並新增**「`env` 必須 === 本機當下環境」 |
| 4 | `apps/admin/src/app/api/sso/callback/route.ts:72` | 唯一簽發點,依 §4 改成「取不到環境 ⇒ 不簽」 |

**呼叫點分母(量法,可重跑)**:
```
grep -rn "buildAdminSession\|signSession(" --include='*.ts' --include='*.tsx' apps/admin/src | grep -v '\.test\.'
⇒ 4 行，其中 production 呼叫點只有 callback/route.ts:72 一處（其餘 3 行是定義與 import）
```
🔴 **而上面那個分母只答了「誰【簽】」,沒答「誰【驗】」(折 W6 N5)**:
```
grep -rn "verifySession(" --include='*.ts' --include='*.tsx' apps/admin/src | grep -v '\.test\.'
⇒ 真呼叫端 2 處:proxy.ts:40 / authorize.ts:29
```
⚠️ **這不是漏洞**(兩處都在既有授權鏈上),**而不寫出來的話,讀的人看不出 server action 有沒有被涵蓋。**

### 🔴 §3.1 版本欄與 env 欄【兩個都要】,只加一個不行

```
只加 env 不升 v  ⇒ isPayload() 不檢查未知欄 ⇒ 舊 validator 收下新票、忽略 env ⇒ 保護靜默失效
只升 v 不加 env  ⇒ 舊票失效了（洞二的前置達成），但 preview 仍能簽出 v:2 ⇒ 洞一沒修
⇒ 兩個一起改，而且【同一次】
```

---

## §4 🔴🔴 環境標記從哪裡來 —— 這一格有一個【會讓守門恆綠】的陷阱

**候選 = `VERCEL_ENV`**(Vercel 系統變數:`production` / `preview` / `development`)。
✅ **本 repo 已有前例,不要重新發明**(鐵則 1 精神:先 grep 再寫):
`apps/storefront/src/app/dev-preview/layout.tsx:50` `isDevPreviewReachable()` —— 純函式 + fail-closed + 白名單。

🔴 **而那支檔的檔頭自己寫下了陷阱,逐字**:
> Turborepo 2 預設 **Strict** env mode…「Strict Mode will filter out environment variables that come from
> your CI vendors until you've accounted for them」、而 `VERCEL_ENV` **不在** `turbo.json` 的 build `env` 清單裡

**我當場複量**:`grep -c 'VERCEL_ENV' turbo.json` ⇒ **`0`**。
**正向對照(證明那份清單不是空的)**:`python3 -c "import json,io;print(len(json.load(io.open('turbo.json',encoding='utf-8'))['tasks']['build']['env']))"` ⇒ **26 筆**,而 `VERCEL_ENV` 不在其中。
⛔ ~~本行原本寫「19 筆」~~ —— **那是我目視 `grep -A 12` 前幾行湊出來的,不是數出來的**;實數 **26**。
📌 **形狀值得留:一個【看起來像量過】的數字,來源其實是「我看到的那一段」。** 判別句 = **我這個數字是不是只涵蓋了螢幕上顯示的那一頁?**

**⇒ 這個陷阱在本 plan 裡比在 dev-preview 那片【嚴重得多】**:
```
dev-preview 那片：讀不到 ⇒ 落到 NODE_ENV ⇒ 往【關】的方向倒 ⇒ 最壞情況是 preview 也 404（誤殺，會被發現）
本 plan：       讀不到 ⇒ preview 與 production 讀到【同一個值 undefined】
                ⇒ 兩邊簽出來的票【互相驗得過】⇒ 🔴 這道閘什麼都沒擋，而且不會有任何東西紅
⇒ ⇒ 這正是「恆綠守門」的形狀（docs/patterns/guard-and-instrument-traps.md）
```

### 🔴 §4.1 因此 fail-closed 的方向是【不簽】,不是【給預設值】

```
決定：production build（NODE_ENV==='production'）而讀不到 VERCEL_ENV
     ⇒ signSession 回 null ⇒ callback:72 走既有的 configError() 路徑（500 設定缺漏）
     ⇒ 形狀抄現成的：session.ts:94 adminSessionSecretConfigured() → callback 回 500
🔴 絕不能用 'unknown' / '' 之類的預設值填欄位 —— 那會讓兩個環境又對上。
⚠️ 代價要寫明：這個選擇的意思是「設定沒弄好 ⇒ 後台整個登不進去」。
   而那是【看得見的失敗】，比【看不見的放行】好 —— 這是刻意的取捨，不是疏忽。
```

### 🔴 §4.2 驗收必須有一格證明這把尺【分得出兩個世界】

```
不夠：測 production 票在 production 驗得過（那在閘壞掉時也會綠）
必要：構造一顆 env='preview' 的票 → 在 env='production' 的驗證端 ⇒ 🔴 必須被拒
     並且反向也要一格：env='production' 的票在 preview 端 ⇒ 也必須被拒
     再加一格：turbo strict 把 VERCEL_ENV 濾掉的世界（env 讀不到）⇒ 必須【簽不出】而不是簽出 undefined
```

### §4.3 已評估、**不採用**的兩條

```
乙（Sean 未選）：只把 Preview / Production 的 secret 換成不同的
  ⇒ 便宜，但 preview 部署會【一直長出新的】，它只解「現在那一台」
  ⚠️ 而它與甲【不互斥】—— 分離 secret 仍然值得做，只是不能取代甲。
  🔴 折 W6 N4:「列為 backlog」沒有編號 = 沒有落點,那句話講完就消失了。
     ⇒ 本 plan 批准時要【當場開一個 backlog 編號】並把號碼寫回這一行;在那之前這一行是【欠的】。
丙：抄報價單的 ver（token_version）做 server 端撤銷
  ⇒ 報價單 lib/session.ts:19 有 ver 欄、:114 驗它，配 SESSION_TOKEN_VERSION_FLOOR + Edge Config
  ⇒ 🔴 admin 沒有那個 store，補一個 = 範圍擴張（而且那是【撤銷】機制，不是【綁環境】）
  ⇒ 不做，但寫下來免得下一個人以為沒人想過
```

---

## §5 🔴 影響面 —— **報價單那一側(另一個 repo,動了不會有東西紅)**

> ## 🔴🔴🔴 **第一行就是這一句(主視窗 2026-08-19 明文要求最高標記、不准埋在表格裡)**
>
> # **`PCM_SSO_EXCHANGE_SECRET` 絕對不綁。**
>
> **理由是量到的,不是保守**:那把 secret **不是拿來推導金鑰的,是【逐字當 Bearer token 比對】**。
> ```
> admin   apps/admin/src/lib/sso/exchange.ts:116        authorization: `Bearer ${config.exchangeSecret}`
> 報價單  app/api/sso/exchange/route.ts:28              const expected = process.env.PCM_SSO_EXCHANGE_SECRET
> ```
> **⇒ admin 若送 `secret+'|production'` ⇒ 報價單逐字比 ⇒ 對不上 ⇒ 每一次換票 401 ⇒ 全站登入失效。**
> **⇒ 而那是【另一個 repo】,不會有任何東西紅。**
>
> 🔴 **為什麼要放在第一行(主視窗的理由)**:**下一個人最可能順手做的就是「兩把一起綁」。**
> ⇒ **本片只綁 `ADMIN_SESSION_SECRET`。要不要分離那把,是另一片、另一次批准。**


```
🔴 PCM_SSO_EXCHANGE_SECRET 是【兩個 repo 共用】的，而它在 Vercel 上同樣是
   單一條目、Preview 與 Production 同列（我當場量的 env 名單）
⇒ 本 plan【不動】那把 secret，也不動 exchange 協定 ⇒ 報價單端零改動
⇒ 但下面這件要寫進來，因為它會咬到人：
```
| 動作 | 報價單那邊會怎樣 | 有沒有東西會紅 |
|---|---|---|
| 本 plan(只動 admin payload) | **無感** —— 它不解析 admin 的 cookie | — |
| 若有人**順手**把 `PCM_SSO_EXCHANGE_SECRET` 也分環境 | 🔴 **報價單的 exchange 會開始拒 admin** | 🔴 **不會。** 兩邊各自部署、沒有共同測試 |
| 若有人改 `/api/sso/exchange` 的回應形狀 | 🔴 admin `exchange.ts` 壞形狀 ⇒ 整包拒 ⇒ 登入全失敗 | 🔴 **不會** |

🔴 **⇒ 本片的硬規則:不得在同一片裡順手動 `PCM_SSO_EXCHANGE_SECRET` 或 exchange 協定。**
**那是另一片、另一次批准。** 判別句:**我改的東西,對面那個 repo 讀不讀?讀 ⇒ 停下。**

---

## §6 驗收 —— 🔴🔴 **R6 整張重寫。原表是為【被取代的那個設計】寫的。**

> **R6(W6)判定:【驗收表結構】問題,非設計層 ⇒ 依主視窗寫死的停止條件,折完直接端 Sean。**
> **丁本身這一輪【沒有被打到東西】。**
>
> **逐格一個字(R6 原始評分)**:`恆綠 2 / 單向 2 / 偏題 1 / 有效 6`
> ```
> 1 有效(措辭錯)  2 有效(措辭錯)  3 偏題  4 恆綠  5 恆綠  6 有效
> 7 有效          8 單向          10 有效  11 有效(措辭錯)  9 單向
> ```
> 🔴 **成因只有一句**:`§3-丁.1` 逐字「payload 不動、`isPayload()` 不動、`buildAdminSession()` 不動、**v 不升**」,
> 改動**一處**(`getKey()` 的金鑰材料);**而 §6 十一格是在【原 §3】(升 `v:2` + 加 `env` 欄)之下寫的。**
> **取代發生在它之後,而沒有人回頭重寫它。**

### 🔴🔴 R6 對「有沒有一格守到那件事」的答案 —— **比「零格」精準,而且更難看見**

```
有 3 格（1/2/11）守得到那個【結果】，
而【沒有一格】守到丁做那件事的【方式】：
  丁的全部改動 = getKey() 那一行的金鑰材料
  §6 十一格裡【零格】直接釘住「金鑰材料必須含 env」
  （釘它的那格在 §3-丁.6 格②，不在驗收表裡 —— 而驗收表才是實作者照著跑的那份）
```
🔴🔴 **所以偏題不在「守不到結果」,在【這張表會把實作者導向錯的機制】**:
```
有人把 getKey() 改回 importKey(encode(secret)) ⇒ 格 1/2/11 會紅（好）
但它們紅的理由讀起來像「env 沒被檢查」，【指不到那一行】
⇒ 修的人第一個念頭會是「去 isPayload() 加 env 比對」= 回到【被取代的設計】
⇒ 而格 3 最嚴重：照它字面實作，你會去加一個【版本檢查】—— 那就是【乙】，
   而乙正是因為要拆 8 份 spec 才被否掉的
```
📌 **母題(值得帶走)**:**一張測試表不只驗結果,它還【教】下一個人這東西是怎麼運作的。**
**表過期的時候,它不是失效,是【開始教錯的東西】。**

---

### ✅ 重寫後的驗收表(丁之下)

```
 1  在 env=A 下【簽出】的票 → env=B 的驗證端                  ⇒ 🔴 拒
 2  反向：在 env=B 下【簽出】的票 → env=A 的驗證端            ⇒ 🔴 拒
    🔴 措辭是刻意的（折 R6）：寫「在 env=A 下【簽出】的」，不要寫「env='A' 的票」
       —— 丁之下票裡【沒有 env 這個東西】，寫成欄位會把實作者導回被取代的設計
 3  🆕🔴🔴 釘住機制本身（R6 指出【零格】在守它）：
    getKey() 的金鑰材料【必須含 env】
    量法：同一顆固定 payload，env=A 簽一次、env=B 簽一次 ⇒ 兩顆簽章【必須不同】
    🔴 正向對照（缺它就是 R5 那個恆綠）：同一顆 payload + 同一個 env 簽兩次
       ⇒ 簽章必須【逐字相同】（HMAC 是決定性的）
    🔴 不得用 buildAdminSession() 產 payload —— 它每次新 sid + 新 iat/exp ⇒ 簽章必然不同 ⇒ 恆綠
 4  production build 而讀不到 VERCEL_ENV                       ⇒ 🔴 signSession 回 null（不是用預設值簽）
 5  ✅ 正向對照：同環境簽、同環境驗                            ⇒ 必須【過】
    🔴 沒有這一格，其餘的「全拒」與「這把尺對什麼都拒」印出同一個畫面
 6  callback 在格 4 的世界裡                                   ⇒ 回 500，且【不清 session cookie】（既有紀律）
 6b 🆕 格 6 的另一側（折 R6「單向」）：callback 在【正常】世界裡
    ⇒ 必須成功發出 cookie —— 否則格 6 的「回 500」與「它永遠回 500」分不開
 7  【非 production】而讀不到 VERCEL_ENV ⇒ 簽出什麼？
    不得用一個【可能與 production 相同】的值 ⇒ 規定寫入 'local'
 8  格 7 的孿生格：在 env='local' 下簽出的票 → production 驗證端 ⇒ 🔴 拒
    理由：'local' 是【所有開發機共用的同一個值】，而格 1/2 只涵蓋 preview↔production
 9  🔴 快取那一格（R5-M1）：getKey() 的快取鍵必須是【完整材料】
    量法：同一個 process 內，同一把 secret，簽 env=A → 翻 env=B → 再簽 ⇒ 兩顆簽章必須不同
    🔴 它與格 3 不同：格 3 驗「材料含 env」，本格驗「快取沒有把 env 吃掉」
       —— 快取 bug 在場時格 3 可能仍過（第一次簽就對），本格才會紅
10  🔴 三態訊號（3-丁.7）：sig_invalid / expired / shape 三種拒絕要分得開
    而【三種必須回完全相同的回應】（狀態碼／標頭／延遲）—— 分類只進 log，不進回應
```

### ⛔ 移除的四格 —— **劃記保留,因為「為什麼刪」比「刪了」有用**

```
⛔ 原格 3「v:1 舊票 → 新驗證端 ⇒ 拒」
   刪因：丁【不升 v】。而它自訂「同一把 secret」⇒ 同一把金鑰 ⇒ v:1 本來就合法
   🔴 它是四格裡最危險的：照字面實作 = 去加一個版本檢查 = 回到【乙】
⛔ 原格 4「v:2 但沒有 env 欄」/ ⛔ 原格 5「env 欄型別不對」
   刪因：丁之下 payload 【本來就沒有 env 欄，而那是正常票】⇒ 構造不出來
   ⇒ 實作時只會標 N/A，永遠不會紅 = 恆綠
⛔ 原格 9「turbo strict 世界的整合驗證」
   刪因：它【已被片 0 取代】。留著是【兩份真相】—— 而片 0 的驗收條件寫得更硬
        （兩個世界要印不同的東西 + 順手印它自己簽出來的 v）
```

### 📋 審查紀錄欄(六輪;**射程照抄不放寬**)

```
R1 4 must-fix + 5 nit   設計層（fail-closed 會鎖門、路 A 代價低估、我違反自己的限縮框）
R2 3 must-fix + 4 nit   量具層（片 0 會安靜回假答案：三個世界塌成兩個觀察）
R3 1 must-fix           前提層（甲根本沒做到那件事 ⇒ 翻掉裁定，改採丁）
R4 3 must-fix + 1 nit   實作層（快取鍵、驗證端零記錄、那把尺是壞的）
R5 2 must-fix + 2 nit   驗證裝置層（我上一輪寫的驗收格自己是恆綠）
R6 結構層               整張驗收表是為【被取代的設計】寫的
⇒ 停止條件由主視窗於 R6 之前【先寫死】：R6 回來不論抓到什麼，一律停止 plan 層審查。
   不會有 R7。
```
🔴 **而主視窗自己記了一格,照抄不美化**:
> 我當時是靠「**一命中而沒問分母**」推出要再跑一輪,**不是預見了這件事**。
> **換角度那個指定是對的,而理由是運氣的一半。**

📌 **這一格值得留,因為它是「對的決定」與「對的理由」分開記的少數實例** ——
**下一個人若照那個理由去複製這個做法,他複製到的是一半。**

⚠️ **W6 對 R6 的射程(照實帶走)**:它只讀 `§6` 全文 + `§3-丁.1/.2/.3`,**沒通讀 `§3-丁` 其餘小節**;
「`§3-丁.6` 格②不在 `§6`」是比對兩節得到的,**沒排除別的小節另有覆蓋**;turbo 仍未獨立驗證。

---

## §7 排程與順序(硬的)

```
⛔ 本 plan 的 v:2 與 B3 的 v:2 必須是同一次 bump   ← 🔴 主詞錯，見 §1 自我更正
🔴 正確版：本 plan 的 v:2 與 B5 的 v:2 是【同一行】(session.ts:131) ⇒ 必須是同一次 bump

⇒ 兩條路，擇一：
   路 A  先做本片（只加 env、升 v:2、sub 欄保留未用），B5 之後在 v:2 上【填 sub】不再 bump
         ⇒ 好處：現在就修掉洞一，而且只登出一次
         ⇒ 代價：B5 spec 要改兩處（:555「關 ⇒ v:1 也收」與 :612「無 sub 維持 v:1 一字不動」）
                 🔴 該交接【已經寫進 B5 spec :555 底下】，不是只寫在本檔
   路 B  等 B5 一起做，一次 bump 帶 env + sub
         ⇒ 好處：改一次
         ⇒ 🔴 代價：B5 卡 B4、B4 卡 B3、B3 卡 B2、B2 卡 anon key（正在往 Sean 走）
            ⇒ 洞一在那【四層】前置清完之前一直開著，而 E8-B 每往前一步它的賠率就變大

✅✅ 【路 A】—— 主視窗 2026-08-19 **重裁一次**（不是「維持原裁」）

⛔ ~~舊理由（2026-08-19 第一次裁時寫的）：B3 卡 B2、B2 卡 anon key ⇒ 等 B3 太久~~
   🔴 **整條作廢** —— 那個理由建立在「B3 會動 admin payload」這個【錯的主詞】上。

✅ **新理由（2026-08-19 主視窗重裁，依據 W5 的主詞更正）**：
   真正耦合的是 **B5**（plan v4:167 把 admin 那半放在 B5），
   而 **B5 比 B3 多兩層前置（B5←B4←B3←B2←anon key）⇒ 等它更久**；
   洞一的賠率隨 E8-B 前進而放大 ⇒ 不能等。

🔴 **為什麼要重裁而不是「結論一樣所以不用動」** —— 主視窗逐字採用了本檔自己的判準：
   **「結論對而理由錯不是沒事，下一個人是照理由決定要不要重看的。」**
   ⇒ 換結論要重裁；**只換理由也要重裁**，而且要留下【誰、在什麼時候、把哪一條理由換掉】。
```

---

## §8 Rollback

> # 🔴🔴 **第一行:rollback 這一片,【不只是 revert 那一行 code】。**
>
> **revert `getKey()` 的金鑰材料 ⇒ 那把鑰匙變回 `encode(secret)`**
> ⇒ **preview 簽的票對 production 又驗得過了** —— 而不只是「保護消失」:
> **那些【在丁上線之前於 preview 簽出、還沒過期的票】會【復活】。**
>
> ```
> 復活的窗口有上界，而它可量：
>   ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 12   （session.ts:58，我當場讀的）
>   ⇒ 最長 12 小時，之後那些票自己過期
> ```
> **⇒ 硬約束:rollback 的同一個動作裡,必須【同時換 `ADMIN_SESSION_SECRET`】** ——
> 換掉它,**所有票(新的舊的、production 的 preview 的)一次全死**,復活這件事就不存在。
>
> ### 🔴 而「什麼東西在執行這條約束」—— **誠實答案:目前【只有紙上約束】**
> ```
> 有的：· 本行（plan §8 第一行）
>       · 🔴 而更好的落點是 session.ts 的 getKey() 檔頭 —— 因為【要 rollback 的人會打開那支檔】
>         ⇒ 片 1 落地時，那句話要寫在【被 revert 的那幾行的正上方】
> 沒有的：任何機制。git revert 不會問你有沒有換 secret，而換 secret 是 Vercel 上的動作
>        ⇒ 🔴 兩件事在【不同的系統】上，沒有東西能把它們綁在一起
> ⚠️ 而半夜出事、有人急著 rollback 的那一刻，正是最不會去讀 plan 的時刻
>    ⇒ 這一格【我沒有解】。寫成「目前只有紙上約束」，不假裝它被守住了
> ```
>
> ### 🔴 而「沒有機制」這句要修準一格 —— **它其實有【半個】**(W6 2026-08-19,片 1 落地後成立)
> ```
> 🔴 沒有機制的是【換 secret】—— 那是 Vercel 上的操作，repo 管不到
> ✅ 而【悄悄 revert】是有的：env-binding.test.ts 有 3 格直接釘住「金鑰材料含 env」
>    ⇒ 有人 revert getKey ⇒ 測試紅 ⇒ 他【必須動測試才過得去】
>    ⇒ 而那一刻，正是他會打開 session.ts、讀到 getKey 檔頭那句話的時刻
> ⇒ ⇒ 精確講法：**「換 secret」沒有機制；「悄悄 revert」有。**
> ```
> 📌 **這個修正讓這一段從「我們沒辦法」變成「我們擋得住其中一半,另一半靠紙」**
> —— **而那兩件事的優先序完全不同。**
>
> 📌 **而這條的形狀值得記住**:**一個保護在它最需要的那一刻自己消失。**
> 今天這批 finding 裡,這是最壞的一種。

```
· 本片零 migration、零 DB 改動 ⇒ 可以 git revert
· 🔴 而 revert 的代價與上線一樣：所有人再被登出一次（v:2 票在 v:1 validator 下必被拒）
  ⇒ 不是「無痛回退」，要寫進 commit body
· 🔴 revert 陷阱（母 plan §8 已指名，本片同款）：
  isPayload() 不檢查未知欄 ⇒ 若只 revert validator 而沒 revert 簽發端，
  帶 env 的新票仍然有效、只是 env 被忽略 = 靜默退回無保護
  ⇒ 簽發端與驗證端必須【同一顆 commit】、同進同退
· 最快的止血：換 ADMIN_SESSION_SECRET（全票失效）—— 但那需要 Vercel env 權限
```

---

## §9 我現在答不出來的(不要當成已解決)

```
1 🔴 turbo strict 會不會咬到這道閘 ——【未確認，而缺的檢查在下面，不是三個字了事】

  🔴 主視窗 2026-08-19 指名了我漏掉的那一層，它把問題問對了：
     turbo 的 strict env mode 濾的是【build 期】的環境變數
     ⇒ 所以真正要分辨的不是「turbo 有沒有濾」，是【這道閘讀 VERCEL_ENV 是在 build 期還是 runtime】
        · runtime（每次請求在 server 上讀）⇒ turbo 濾不到 ⇒ 這個陷阱在本片【不成立】
        · build 期被 inline 進 bundle       ⇒ 成立，而且會恆綠

  ⇒ 缺的那道檢查（可執行，兩個世界會印不同的東西）：
     在一個 preview 部署上讓那段程式把它讀到的值寫進一則 log（recordSsoLogin 已有現成落點）
     ⇒ 印 'preview' = runtime 讀到了，陷阱不成立
     ⇒ 印 undefined = build 期被固定，陷阱成立 ⇒ §4 要順便改 turbo.json
     🔴 這一格【本機做不到】：本機 next dev 與 next build 都讀不到 VERCEL_ENV（它是 Vercel 注入的）
        ⇒ 本機測「讀不到」不能證明部署上也讀不到 —— 那兩個 undefined 來自不同原因

  📎 已有的【部分】證據，不足以結案但值得帶著：
     apps/storefront/src/app/dev-preview/layout.tsx 檔頭記錄它量過 next build 印 `ƒ`（dynamic、非預渲染）
     ⇒ 那些頁每次請求在 server 上跑；而本片的 callback/route.ts 更硬 —— 它自己寫著
        export const runtime = 'nodejs' 與 export const dynamic = 'force-dynamic'
     ⚠️ 但「這條路由是 dynamic」推不出「process.env 一定是 runtime 讀的」
        —— bundler 仍可能把 process.env.X 文字替換掉。⇒ 這是【吻合但未證實】，不是證據。

  ⚠️ 這一格決定 §4 要不要順便改 turbo.json（而那是鐵則 12④ 平台設定，另一層批准）
  ✅ 而【不必等它就能動工】：fail-closed 的方向在兩個世界都安全（讀不到 ⇒ 不簽）
     它影響的是「preview 會不會連坐登不進去」，不影響 production 的正確性
2 preview 部署【現在】有沒有 Vercel 的存取保護 ——【未查】
  它決定洞一今天的可觸發性是「任何人」還是「有 Vercel 帳號的人」，而那影響急迫度不影響修法
3 「所有人被登出」在 Sean 那一刻的實際體感 —— 他正在做的事會不會丟失
  ⇒ 這是產品取捨，不是技術題，要他自己說什麼時候方便
```
