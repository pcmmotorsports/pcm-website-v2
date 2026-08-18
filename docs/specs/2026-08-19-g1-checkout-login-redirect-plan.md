# plan · 客人按「前往結帳」被送去登入,而登入完落在首頁

> 作者:G1 · 2026-08-19 · 🔴 **狀態:尚未批准,一行 code 未動。** 命中鐵則 12②(auth)。
> 來源:G3 實走顧客站量到,客人**現在就在撞**。

## ⓪ 🔴 先講最重要的一件:**主視窗要我設計的那個東西,已經做好而且上線了**

主視窗列的五格裡,**四格是已經解決的** —— 我不重新設計,我只指出它在哪。
```
`#190` 已經蓋好整套「登入後導回」的安全機制,而且【三個 sink 都接了】:
  白名單本體  apps/storefront/src/lib/auth/safe-redirect.ts  `sanitizeNextParam()`
  email 登入  app/login/actions.ts:71     redirect(sanitizeNextParam(next))
  Google      app/auth/callback/route.ts:33  redirect(sanitizeNextParam(next))
  LINE        api/auth/line/start/route.ts:34  sanitize 後才存 cookie，callback 再驗（縱深）
現有消費端（證明它是活的，不是死 code）:
  app/account/page.tsx:54        redirect(`/login?next=${encodeURIComponent('/account')}`)
  contexts/FavoritesContext.tsx:237  router.push(`/login?next=…`)
```
⇒ 🔴 **真正的缺口只有一句話:結帳那條路【沒有帶 next】。**

## ① open redirect 白名單 ⇒ **已存在,而且負向對照已被測試釘死**
`safe-redirect.ts` 逐條擋掉主視窗點名的四種:
```
不以 '/' 開頭（http://evil、https://evil、裸字串）  ⇒ 擋
'//host'（protocol-relative）                      ⇒ 擋
'/\host' 與任何反斜線                               ⇒ 擋
控制字元 / 空白（charCode ≤ 0x20、0x7f）            ⇒ 擋
```
**測試已釘住(`lib/auth/safe-redirect.test.ts`)**:`http://evil.com` `https://evil.com/path`
`//evil.com` `//evil.com/path` `/\evil.com` `/\\evil.com` `/path\to\evil` 逐個列在拒絕清單。
`%2f%2f` 那格檔內另有一段說明:**query 來源的 next 由 `URLSearchParams` 先解碼一次 ⇒ `%2f%2f` 解碼成 `//` 後落入 protocol-relative 攔截**。
⇒ **本片不新增白名單、不改那支 helper。** 若要動它,那是另一片而且一定要對抗審查。

## ② 登入頁怎麼知道「他是被結帳導來的」⇒ **看 `next` 參數,不用 referrer**
`app/login/page.tsx:22` 已經把 `next` 讀出來傳進 `LoginPage`(`:23`)。
⇒ 判斷式就是 `sanitizeNextParam(next) === '/checkout'`。**referrer 不可靠,本片不用它。**

## ③ 第三方登入走同一條路嗎 ⇒ **走同一條**(這格本來最可能修一半)
```
Google  LoginPage.tsx:111  redirectTo=`${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`
LINE    start route 把 sanitize 過的 next 存 cookie、callback 讀回
```
⇒ **三條登入路徑都吃同一個 `next`** ⇒ 只要結帳把 `next` 帶上,三條都會回結帳。
⚠️ ~~我沒有實走過 Google / LINE 登入 ⇒ 這格是讀 code 得到的~~
⇒ ✅ **GR-065 C-1 開檔驗了 LINE callback `:70` 也有 `sanitizeNextParam(next)`**
   ⇒ **三個 sink 各自對過,從「讀 code 推的」升級成量到的。**(仍未實走真帳號,而三 sink 已逐一確認。)
   📎 nit:LINE 的 next cookie **10 分鐘逾時後落 `/`** —— 與今日行為相同,不是本片新增。

### 🔴 `/register` 那條路(GR-065 要求二選一,不留曖昧)
**本片不做**:註冊成功後的落點**不在本片射程**。⇒ 客人若選「註冊」而非「登入」,**登入完仍回不到結帳**。
⇒ **這一格明列為不做 + 落點寫出來**,而不是假裝它不存在。要做的話是同族的下一片。

## ④ 🔴 已登入的人開 `/login?next=/checkout` ⇒ **現在會再看到一次登入表單**
`app/login/page.tsx:16-24` 全文只讀 `searchParams`、**沒有任何 session 檢查**。
⇒ 這是真的缺口,而它會發生在:客人在另一個分頁登入了、或 session 還活著時點到舊連結。
⇒ **修法**:route 端先查 session,有 user ⇒ `redirect(sanitizeNextParam(next))`。
⚠️ 而這一步**動的是 auth 邊界** ⇒ 它是本片最需要被審的一格。

## ⑤ 鐵則 1:design 有這一頁,而**它對「為什麼被導來」是沉默的**
```
design-reference/components/AccountPages.jsx:202
  「登入你的 PCM 帳號，查看訂單與收藏。」
storefront LoginPage.tsx:133 是同一句（你/您 的差別是 Sean 的稱謂拍板，既有且已批）
掃「被導來登入」那一族字面:`grep -rnE '結帳|先登入|登入後|繼續結帳' AccountPages.jsx` ⇒ **2 命中**
  逐個開檔:`:161 前往結帳`（那是購物車的按鈕）+ `next` 變數 ⇒ **零個是登入頁的情境文案**
  正向對照(同檔該命中的):`grep -c 登入` ⇒ **6** ✅ 尺是活的
```
⇒ **design 沒有「從結帳被導來」這個情境,因為 design 的登入頁不是從結帳來的。**
⇒ 與 `#309` 同族:**沉默不是反對**。而本片**不改 design 已有的那句**,只在 `next=/checkout` 時**多加一句**。
🔴 **【代裁,代裁人 G1,可推翻】** —— 主視窗/Sean 要判「多加一句也算偏離」的話,這片就停。

## ⑥ 改法(最小)
```
app/checkout/page.tsx:49          redirect('/login')
                               ⇒ redirect(`/login?next=${encodeURIComponent('/checkout')}`)
app/checkout/callback/page.tsx:94  同上（它是 3DS 回來的落點，未登入同樣該回得去）
                                   ⚠️ 這一支我還沒判它導回哪裡才對 —— 見 §⑧
app/login/page.tsx                 已登入 ⇒ 直接 redirect(sanitizeNextParam(next))
components/LoginPage.tsx           next 指向 /checkout 時多顯示一句（文案見 §⑦）
```
**檔數:4 檔**(+ 對應測試)⇒ 🔴 **命中鐵則 8,要 Sean 批。**

## ⑦ 文案:**我不定調,給 Sean 挑**(他對客人稱謂已拍「您」)
```
甲 「結帳前請先登入,登入後會直接回到結帳頁。」   ← 直述，講清楚接下來會發生什麼
乙 「登入後即可繼續結帳。」                       ← 最短
丙 「為了保護您的訂單,結帳需要先登入。」          ← 說明理由
```
⚠️ **三個都是我寫的,沒有一個來自 design** ⇒ 這是新文案,依鐵則 1 要他點頭。

## ⑧ 我沒做/沒查的
```
· 沒有實走 Google / LINE 登入（③ 是讀 code 得到的）
· ~~沒有判 checkout/callback/page.tsx:94~~ ⇒ **查完了,見 §⑨。答案是【不可以照抄】。**
· 沒有量「客人真的會不會放棄」—— 那要行為數據，我沒有
· 沒有查 /register 那條路（客人可能選註冊而不是登入）⇒ 註冊成功後會不會回結帳，未查
```

---

## ⑨ 🔴 `checkout/callback/page.tsx:94` ⇒ **不可以照抄 §⑥ 的改法。理由是錢。**

> 這一格是我自己在 §⑧ 標「要另外查」的,查完了。**答案是:那裡【不能】帶 `next=/checkout`。**

### 為什麼(量到的,附行號)
```
建單順序   apps/storefront/src/app/checkout/charge-actions.ts:5 逐字:
           「鐵則 12 成交 path:組【建單(既有 placeOrder)→ charge → confirm】整鏈」
           :16 buildCardholder 先於建單 / :17 placeOrder → findTotal read-back → 才扣款
⇒ 客人從 3DS 銀行頁回到 callback 的那一刻，**訂單【已經建好】，而且可能【已經扣款】**
```
🔴 **所以若在 `:94` 寫 `redirect('/login?next=/checkout')`**:
```
客人登入完 → 落在【結帳頁】→ 他會以為剛才沒成功 → **再結一次**
⇒ 第二張單 + 可能的第二次扣款，而第一張單可能已經 paid
⇒ 這不是 UX 問題，是**鐵則 12① 錢**
```
📌 **形狀**:`/checkout` 對「還沒下單的人」是正確的落點,對「**剛下完單的人**」是**最危險的落點**。
**同一個 `next` 值,在兩個情境裡意義相反。**

### ⇒ 這一格的正確做法(而它仍要 Sean 批,因為仍是 auth + 錢)
```
next 應指回【結果頁本身】並保留 order 參數:
   /login?next=/checkout/callback%3Forder%3D<uuid>
⇒ 登入完落在【那張單的結果頁】，不是新的結帳
✅ sanitizeNextParam 允許站內路徑 + query（helper docstring 明列 `/products?cat=x` 是允許形狀）
⚠️ 已知代價（檔頭自己寫的）:pending 狀態重刷會【重打 Record】——
   而那是【重新整理本來就有】的既有行為，不是本改法新增的；per-order 節流由 3DS-4 補。
```
### 🔴🔴 ~~而我建議的最小動作是:這一支【先不要動】~~ ⇒ **被 GR-065 MF-1 打掉,我採納**

> **我說「先不要動 = 安全的差體驗」。那句錯了,而反例是【我自己量的三個東西拼起來】。**

```
清車住在 callback 的【渲染路徑】:ClearCartOnSuccess 在 :146（paid）與 :175（pending）
而未登入在 :94 就被 redirect 彈走  ⇒ **永遠到不了清車那一步**（我自己開檔複驗過行號）
檔頭 :18 逐字:pending「清品項(A4;可能已扣款、鎖仍持 → **清車防雙扣**)」
G3 實走量到:購物車沒掉、徽章仍是 1
```
⇒ **已扣款的客人帶著一台【沒被清的車】落在首頁** → 「剛才好像沒成功」→ 回購物車 → 這次已登入 → **第二張單**。
🔴 **§⑨ 怕的那個病,現況照樣到得了 —— 只是多三步。而燃料(那台車)正是被我稱為「安全的」那條 redirect 保下來的。**
📌 **形狀**:我把「**不會直接把他推到結帳頁**」讀成「**他不會再下一單**」。**擋住一條路,不等於擋住那個結果。**

### ⇒ 採用 GR 的甲:**callback 那支與 §⑥ 同批做**,用上面那個正確的 `next`
```
理由不是「順手」，是：**只有讓他回到結果頁，才走得到 paid/pending 的清車分支。**
⇒ 這一支從「以後判」變成「同一個病的另一張嘴」，先做反而更安全。
```
⚠️ 而 **`no_attempt` / `failed` 兩支本來就刻意不清車**(檔頭 :19/:20,Sean 拍過)⇒ **本改法不動那個決定。**

### ~~原本的理由(留著當訃聞)~~
```
現況 redirect('/login') ⇒ 客人落在首頁，**多走幾步，但不會被推去建第二張單**
⇒ 它現在是【安全的差體驗】。而改壞的代價是【錢】。
⇒ 結帳那支（§⑥ 第一條）先做，這一支獨立判、獨立審。
```
🔴 **兩支長得一樣、住在同一個資料夾、而處置相反** —— 這一段寫在這裡就是為了擋住「順手一起改」。

### 我還是沒查的
```
· 沒有實走 3DS（檔頭自己寫「Phase I 建好但無真 3DS 流量」）⇒ ⑨ 的機制部分是讀 code 得到的
· ~~沒查「客人回來時 session 真的會不會掉」—— 若根本不會掉，這整格是空的~~
  ⇒ 🔴 **GR-065 V-1 把它驗掉了,不用刷卡**:`callback:3` 逐字「瀏覽器 **GET** 導回…非 server→server」
  + 本 repo 自己寫明的機制(`line/start:5`「Lax 允許 top-level GET 帶 cookie」)
  ⇒ **系統性掉 session 的世界被排除**;活證 = Sean 兩筆真 3DS 單走完並看到訂單。
  ⇒ **剩下的人口 = OTP 期間 session 真過期者 —— 窄,而不是空。** 這一格改成這個定價。
```
