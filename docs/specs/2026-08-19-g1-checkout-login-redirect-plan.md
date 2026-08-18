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
⚠️ **我沒有實走過 Google / LINE 登入**(那要真帳號)⇒ **這格是讀 code 得到的,不是量到的。**

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
· 沒有判 checkout/callback/page.tsx:94 未登入時「導回結帳」是不是對的
  —— 那是 3DS 回來的落點，導回去可能重複建單。**這一格要另外查，不要照抄 §⑥。**
· 沒有量「客人真的會不會放棄」—— 那要行為數據，我沒有
· 沒有查 /register 那條路（客人可能選註冊而不是登入）⇒ 註冊成功後會不會回結帳，未查
```
