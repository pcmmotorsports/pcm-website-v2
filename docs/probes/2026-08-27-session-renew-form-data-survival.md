# 探針 · 續期失敗時,表單裡打到一半的字會不會不見(2026-08-27 線3)

> **這一格從 2026-08-26 起被記成「做不到」。它現在做得到了,而擋住它的東西不是當初以為的那個。**
> 原句在 `docs/runbooks/local-admin-with-real-data-probe.md:438`(已於 `acf3484a` 標為過期並附訂正節)。
> 受測對象:`bc61afe6`(片二補審)工作樹版本。撰寫時 `bc61afe6` **未推**。

---

## §0 這支探針回答什麼、不回答什麼(先讀,它決定你能拿它說什麼)

```
回答     續期【失敗】時, 頁面會不會自己跳走
         🔴 **以及:在【一個非受控、無 debounce、不靠 client state 的輸入框上】字會不會不見**
✅ 回答   續期【成功】那條路 —— **2026-08-27 03:2x 已補量, 見 §6**
         ⛔ ~~本機量不到, 理由見 §1~~ —— 那個「量不到」的理由是錯的, 見 `…-947-…-WITHDRAWN.md`
不回答   🔴 **受控輸入框(React state + 可能重新 mount)會不會掉字 —— 那一格【仍然是開的】**
```
🔴🔴 **本檔第一版把回答欄寫成「打到一半的字會不會不見」, 射程太寬。** 訂正原因(`-9e` 複量):
我量的 `#customer-keyword-search`(`components/customers/customer-keyword-search.tsx:65`)是
**`defaultValue` 的非受控 input**, 該檔**沒有 `'use client'`**、走 server action + PRG,
`grep -n "useState\|onChange" <同檔>` ⇒ 零命中(rc=1);正對照同檔 `grep -n "defaultValue"` ⇒ `:65`。
📌 **那是所有輸入框裡最不可能掉字的一種** —— 它的值住在 DOM 上, 不住在任何 React state 裡。
⇒ 結論**不得**寫成「打到一半的字不會掉」。
🔴 **這是兩個宣稱。** 本檔的結論**不得**被引用成「靜默續期已驗」。

⚠️ **本檔引用的行號在 `bc61afe6` 之後的樹上核過一次(2026-08-27 02:5x),而行號會漂。**
   實例:本檔第一版寫 `route.ts:61`,而正解是 `:91` —— 漂掉的原因是**我自己**在 `acf3484a`
   給那支檔加了 10 行檔頭。⇒ **引用前自己 `sed -n '<N>p' <檔>` 印一次**,不要相信這裡的數字。

---

## §1 為什麼要繞路:`ADMIN_DEV_BYPASS` 一個旗標控制兩道閘

```
登入閘     apps/admin/src/lib/dev-auth-bypass.ts:23   if (env.ADMIN_DEV_BYPASS !== '1') return false;
           (判斷在這支;apps/admin/src/proxy.ts:17 只是用途註解)
Origin 閘  apps/admin/src/lib/session/authorize.ts:18
           apps/admin/src/app/api/session/renew/route.ts:79
數法 `grep -rn "ADMIN_DEV_BYPASS" apps/admin/src | wc -l` ⇒ 25(2026-08-27 主視窗複量)
```

⇒ 本機只有兩個世界(`dev-auth-bypass.ts:23` 是布林開關, 沒有第三態),
而**想量的那一格落在兩個世界中間**:

| 旗標 | 登入閘 | Origin 閘 | 能不能量「票過期 ⇒ 續期成功」 |
|---|---|---|---|
| `=1` | **關掉** | 放行 localhost | ❌ 票過不過期根本沒人檢查 |
| 不設 | 開著 | **擋掉 localhost** | ❌ 續期永遠 `403 bad-origin` |

🔴 **其中一半是 `bc61afe6` 造成的**:片二原本沒有 Origin 閘 ⇒「旗標關」那個世界本來量得到。
**一道安全閘的代價不只是多一段碼,還可能是它讓某一件事再也量不到了** ——
而那個代價**在 diff 上看不見、三綠不紅、審查不會問**。登記於 `#947`。

## §1-b 繞法:不去造「票過期」,去找一個【已經存在而且更壞】的世界

旗標開 ⇒ 沒有 admin session cookie ⇒ `/api/session/renew` 回 **`401 not-active`**
(`route.ts:91` 的 `if (!payload)` 那一格)
⇒ 那正是「續期失敗」,而且**四發全部失敗**(§3 訊號 D 逐發列出),比真的票過期更壞。
⇒ 用**未修改**的 `scripts/admin-probe/up.sh` 就到得了這個世界。

---

## §2 怎麼重跑(逐字,可複製)

```bash
cd /Users/sean_1/pcm-website-v2
bash scripts/admin-probe/up.sh          # 起完整鏈, 約 1 分鐘;結尾自檢會印真資料筆數
```
端點先驗一次(**兩個世界要印不同的東西,否則下面整段沒有意義**):
```bash
curl -s -X POST -H "Origin: http://localhost:3011" -w "\nHTTP %{http_code}\n" http://localhost:3011/api/session/renew
#   ⇒ {"outcome":"not-active"}   HTTP 401
curl -s -X POST -w "\nHTTP %{http_code}\n" http://localhost:3011/api/session/renew
#   ⇒ {"outcome":"bad-origin"}   HTTP 403      <- 負對照:Origin 閘是活的
curl -s -o /dev/null -X POST -H "Origin: http://localhost:3011" -w "location=[%{redirect_url}]\n" http://localhost:3011/api/session/renew
#   ⇒ location=[]                              <- 端點不導向
```
🔴 瀏覽器**一定要開 `http://localhost:3011`**,不要 `127.0.0.1`(runbook §9:用 127 時 client JS 靜靜地不見)。
先驗 client JS 真的活著,否則後面量的是一頁沒有 React 的 HTML:
```js
Object.keys(document.querySelector('main')).some(k => k.startsWith('__react'))   // 必須 true
```
然後開 `/customers`,用**原生 setter + 派發 `input` 事件**打字(直接設 `.value` 不會更新 React state),
掛一支記錄器數 `/api/session/renew` 的回應與 `beforeunload`,等 ≥3 分鐘,讀三個訊號。

---

## §3 量到什麼(2026-08-27 02:47–02:52)

環境自檢:`products=12` / `orders=7` / `HTTP /orders=200` / 畫面上不同單號 6(真資料,非 fixture)。
表單:`#customer-keyword-search`(`/customers` 的搜尋框,真元件)。打入 `半形打到一半-DONTLOSEME-9f3a`(22 字)。

```
訊號 A  字還在不在      ⇒ "半形打到一半-DONTLOSEME-9f3a"(22 字, 逐字相同)
訊號 B  網址有沒有變    ⇒ 沒有(前後都是 http://localhost:3011/customers)
訊號 C  有沒有離開頁面  ⇒ 沒有
訊號 D  續期打了幾次    ⇒ 頁內鉤子 4 發, 全部 401 not-active, t = 39 / 99 / 159 / 219 秒
                          playwright 自己的網路記錄 6 發(它從開頁就在記, 我的鉤子是載入後才裝)
頁面存活 238 秒
```
數法:四發間隔 60 秒,與 `session-renew.tsx:47` 的 `CHECK_INTERVAL_MS = 60_000` 一致。

### 訊號 D 與補審 M3 的關係 —— 🔴 **而這一段被主視窗打回來過,我把它改小了**

補審 **M3** 的修法:`not-active` **不得當終局**(它與「DB 掛掉」是同一個值,`#933`)。
碼在 `session-renew.tsx:115` 的 `default:` 那支(不停,`return` 就好)——
🔴 **本檔一度寫成 `:113`,而那一行是 `chain-expired` 的 `stopped = true`,是【相反】的那支。**
   指錯一格而它就在隔壁三行,`sed -n` 印出來看起來也很合理 ⇒ **今晚第三次「結論對、位置錯」。**
```
新碼(bc61afe6)  ⇒ 【本檔量到】4 發(頁內鉤子)/ 6 發(playwright)
舊碼(5276411e)  ⇒ 【`-9e` 量到】1 發(node 層 esbuild 打包兩版跑假 fetch, 2026-08-27)
                   ⚠️ **本檔第一版寫的是我【讀碼推的】**, 現在這個數字不是我量的, 是它量的。
                   ⇒ 引用時要說得出**是誰量的**, 兩邊來源不同。
```
🔴 **而那個 6 有一部分是 dev 自己造出來的**(`-9e` 用 performance resource entries 量到
`startTime = 1, 1, 61, 121, 181, 241` 秒)⇒ **開頭兩發在同一秒 = React StrictMode 把 effect 跑兩次**
(`grep -n "reactStrictMode" apps/admin/next.config.ts` ⇒ 零命中 rc=1 ⇒ 走 Next 預設,dev 開啟)。
⇒ **6 = 2 + 4**,而 production 只會有 1 發 mount。
📌 **我在 dev 量到的數字, 有一部分是 dev 自己造出來的** —— 而我原本的解釋(「鉤子晚裝」)只說對一半。
🔴 **本檔第一版把這兩行並排寫成一個對比,而並排會讓兩邊看起來同級** ——
   一邊是量到的數字,一邊是我讀 `session-renew.tsx` 推出來的。
   📌 **「量到的 vs 推出來的」並排在同一個表格裡,是本 repo 記過的坑,而我剛剛又做了一次。**
⇒ 能宣稱的只有:**新碼在真瀏覽器 + 真 Next runtime 上,連續四發 401 之後仍在巡邏。**
   **不能**宣稱「已證明舊碼會停」,也**不能**由此推「正式站現在正在壞掉」。
⏳ **待補**:換上 `5276411e` 那一版 `session-renew.tsx` 跑同一支探針、數同一個數字。
   2026-08-27 03:0x 試過一次而**做不成**:`next dev` **每個目錄只准一份**,
   當時 `apps/admin` 那一份是別的窗的鑽機(PID 13948 / 埠 3011)——
   🔴 **而我要做的事是改工作樹上的檔,那會安靜地改掉他們正在量的東西** ⇒ 不做,等樹空出來。
   (換埠只換得掉 pg / PostgREST / proxy,`next dev` 的鎖是綁目錄的,換埠繞不過。)

### 另外兩把尺,主視窗也打過(結論不同,分開講;被質疑的碼在 `session-renew.tsx:80`)
```
① 4 發 vs 6 發的差額 —— 我的解釋是「頁內鉤子是載入後才裝的, 漏掉開頁那一發」
   🔴 **那是解釋, 不是量測。** 一個【有解釋的差額】比沒解釋的更危險:解釋會關掉懷疑。
   ⇒ 待補:把記錄器改成在頁面 JS 之前就裝(initScript), 兩把尺應該收斂到同一個數。
③ beforeunload 那把尺 —— 我用【手動 dispatch】驗它 false→true。
   🔴 合理的質疑:手動派發的事件, 與【真的離開頁面】不是同一件事。
   ✅ 而這一格有一把**非合成**的尺, 而且它一直都在:
      `window.__probe` 這個物件**在 238 秒後仍讀得到**, 且它自己記的年齡就是 238 秒。
      **頁面若導走過, 那個 JS context 會被拆掉, 這個物件就不存在了** ⇒ 讀它會是 undefined。
      ⇒ 「物件活著」比「beforeunload 沒被觸發」強:前者不需要任何監聽器正確接線。
```

### 每一把尺都做過雙向表演(否則那些「沒有」不算數)
```
訊號 B  URL 比對          —— 起點/現值都印出來, 兩個值可直接看
訊號 C  beforeunload 旗標 —— 手動 dispatch 一次 ⇒ false → true ⇒ 尺會動, 那個 false 是真的
訊號 D  兩把獨立的尺      —— 頁內鉤子 4 / playwright 6, 差額有解釋(裝設時點不同)
端點     Origin 閘        —— 帶 Origin ⇒ 401 / 不帶 ⇒ 403, 兩個世界不同的字
環境     client JS        —— __reactFiber 檢查 ⇒ true(§9 那個坑的正對照)
```
每一格的原始輸出都逐格印在 §3 上面那個區塊裡;被量的碼在 `session-renew.tsx:80`。

---

## §4 結論(逐字,不要外推)

✅ **續期失敗【不會】把使用者打到一半的字弄不見,也不會把頁面導走。**
   量到的是:每分鐘一發 401,連續四發,頁面不動、網址不動、字不動。

⚠️ **而「不會掉資料」的理由不是這一片做了什麼保護** —— 是 `SessionRenew` 只做 `fetch`、
   從頭到尾**不碰 `location`**。掉字要靠導頁,而導頁發生在**使用者下一次自己點連結**時
   (proxy 登入閘會在那一刻擋),那與這一片無關。
   ⇒ 📌 **本片能宣稱的仍然只有:「續期本身不造成 redirect」。** 與 `5276411e` commit body 同一句話,
     差別是**現在它是量到的**。
數法(🔴 **第一版我只 grep `location`, 而宣稱是「不會導頁」—— 尺比宣稱窄**;補寬):
`grep -nE "window\.|router\.|redirect|assign|href|replace\(" apps/admin/src/components/session/session-renew.tsx`
⇒ 9 筆, **逐條開過**:7 筆是註解、1 筆是 `fetch` 的 `redirect: 'manual'` 選項(不是導頁)、
1 筆是 `res.type === 'opaqueredirect'` 判斷 ⇒ **零筆是導頁動作**。
窄尺 `grep -n "location" <同檔>` ⇒ 零命中(rc=1);正對照同檔 `grep -n "fetch"` ⇒ `:25` `:80`(rc=0)。

🔴 **沒量到的**:續期**成功**那條路(§1 的兩個世界問題)。要量它得先拆旗標(`#947`)。

---

## §5 這支探針自己的射程
🔴🔴 **撤回一格:本檔第一版寫的「探針收攤已驗」那個證據不算數。**
我量的是埠 `55501 / 3998 / 3011`,而 `scripts/admin-probe/env.sh:24-27` 的預設是
**`55534 / 3979 / 3978 / 3011`** ⇒ **其中兩格從來就不是那些服務的埠** ⇒ 恆綠。
📌 **一把量錯對象的尺, 印出來的是一個【正確的、令人安心的】0** —— 不是空輸出、不是錯誤,
   是一個乾淨的數字。**這是今晚那一族偽裝最好的一個成員。**
✅ 真正證實我收攤了的是 `-9e`:它**用自己的 `up.sh` 起得來** ⇒ 埠是空的。
   **它救了我, 而我的尺沒有。**
⇒ 之後驗收攤一律 `source scripts/admin-probe/env.sh` 之後用 `$PG` `$PREST` `$PROXY` `$WEB`,
  **不要手打數字**。
⚠️ **而寫這一段訂正時我又指錯一次**:第一版寫 `env.sh:23-26`,而 `:23` 是 `ADMIN_PROBE_DIR`,
   四個埠在 `:24-27`。數法 `grep -n "ADMIN_PROBE_PG:=\|ADMIN_PROBE_WEB:=" scripts/admin-probe/env.sh`
   ⇒ `24` 與 `27`。📌 **今晚第四次「結論對、位置差一格」** —— 而這一次是在【訂正一個量錯對象的尺】
   的那段話裡發生的。⇒ 判別動作:**任何 `檔案:行號` 落筆之後, 當場 `sed -n` 印一次再送出。**

```
瀏覽器      只量了 Chromium(playwright)
時間        238 秒 / 4 發巡邏。沒有量「開著一整天」
            (238 是**頁內時鐘**算的 `Date.now() - startedAt`;等待用的是 shell 的 `perl select`,
             不是 playwright 的 wait —— 後者實測只等 35-60 秒就回, 見 runbook §5-e 訂正節)
表單        只量了一個【非受控】input(搜尋框, defaultValue)。
            🔴 **沒有量受控 input(React state)** —— 那才是會掉字的那種
            沒有量檔案上傳、富文字、多步驟表單
票          全程【沒有】有效票(旗標開 ⇒ 沒有 cookie)⇒ 沒有量「票從有效變過期」那一刻
分頁        單一分頁。沒有量多分頁同時續期
```
⇒ 以上每一行都是**未數**。
⚠️ 上面每一行都是「我沒量」,**不是「不會有問題」**。

---

# §6 ✅ 補量:續期【成功】那條路(2026-08-27 03:2x)

> 這一格原本被記成「本機量不到」。那個結論是錯的 —— 真因是**我沒種票**,不是機制擋住。
> 配方見 `docs/specs/2026-08-27-947-split-dev-bypass-flag-WITHDRAWN.md` §2。

## §6-1 起法(不改任何腳本)
```bash
ADMIN_SESSION_SECRET='<至少 32 字元>' bash scripts/admin-probe/up.sh
```
🔴 `up.sh` **自己不設** `ADMIN_SESSION_SECRET`(`grep -n "ADMIN_SESSION_SECRET" scripts/admin-probe/up.sh` ⇒ rc=1)
⇒ 從**呼叫端環境**餵進去,`next dev` 會繼承。**不要改腳本。**
🔴 票的簽法(`lib/session/session.ts:302` `getKey`):
```
token = b64url(JSON.stringify(payload)) + '.' + b64url(HMAC_SHA256(payloadJSON, key))
key   = `v1:${secret.length}:${secret}:${envTag.length}:${envTag}`
envTag 本機 = 'local'(VERCEL_ENV 未設 + NODE_ENV=development;resolveEnvTag :258)
```
staff 表要有那個人且 `is_active=t`(本次用 `sean`;`select id,label,is_active from staff` ⇒ 5 列,3 活)。

## §6-2 七個世界,同一支簽票管線(curl,真 Next runtime)
```
世界                     HTTP  outcome         種新票
還早    exp+3600         200   fresh           0
快過期  exp+60           200   renewed         1     <- ✅ 成功那條路
已過期  exp-60           401   not-active      0
鏈到頂  sso_at-13h       401   chain-expired   0
人被停用 staff=op4       403   not-active      0
簽章壞掉                 401   not-active      0
沒有票(對照)            401   not-active      0
```
🔴 **注意最後三列**:`沒有票` / `已過期` / `簽章壞掉` **印出完全一樣的東西**(401 + `not-active`)。
📌 **那正是 2026-08-27 稍早騙倒我的那一格** —— 我拿到 401,讀成「閘擋住我」,
   而真相是第一列那種:**我根本沒種票**。**一個 401 有很多種原因。**
⚠️ 這是端點的**刻意設計**(不外洩哪一種失敗),不是缺陷。而它對**量測的人**是個陷阱。

## §6-3 續出來的那張票,逐欄拆開(這是 `bc61afe6` 三條修法的真 runtime 驗證)
搬運的碼在 `apps/admin/src/app/api/session/renew/route.ts:131-143`
(`buildAdminSession` 呼叫;`amr` `:132` / `auth_time` `:133` / `sid` `:142`)。
⚠️ 本節第一版寫 `:104-118`,而 `:104` 是 `fresh` 早退的 `return` —— **今晚第五次「結論對、位置錯」**。
   數法 `grep -n "const next = buildAdminSession" <同檔>` ⇒ `131`。
```
欄位        舊票 → 新票                判定
sid         相同(cccc…)               ✅ 沿用不旋轉   <- 第三把審查 N1
sso_at      相同(1787769017)          ✅ 鏈起點原封   <- 片二唯一的天花板
amr         相同(['pwd'])             ✅ 不得被改寫   <- N2(改寫 = 可自我提權成 2FA)
auth_time   相同                       ✅ 不得被改寫   <- N2
iat / exp   都變新                     ✅ 正對照(否則整張票原封不動也會過)
新票壽命    900 秒                     ✅ = ADMIN_SESSION_MAX_AGE_SEC
sub         {kind:user, staff_id:sean} ✅ 原封
```

## §6-4 🔴 `exp` 夾鏈尾 —— 那條【正在 production 上壞著】的洞,修法實測
造一張**鏈只剩 120 秒**到頂的票:
```
新票活多久   = 120 秒
沒夾的話會是 = 900 秒
新票 exp     = 1787772795  = 鏈尾, 距鏈尾 0 秒
```
⇒ **夾住了。** 而 `5276411e`(現正在 origin/dev 上)沒有這一段 ⇒ 那張票會活 900 秒、越過鏈尾。

## §6-5 真瀏覽器:續期成功時, 頁面與表單有沒有受影響
(被量的元件在 `apps/admin/src/components/session/session-renew.tsx:80`)
種票 → 重新載入 → 在 `#customer-keyword-search` 打 `續期成功那條路-KEEPME-7c1d` → 等 198 秒:
```
續期呼叫 5 發:#22 renewed / #23 renewed / #24 fresh / #26 ? / #27 fresh
A 字還在不在   ⇒ 逐字相同
B 網址有沒有變 ⇒ 沒有
C JS context   ⇒ window.__p2 仍讀得到(頁面若導走過, 它會不存在)
D 頁面活了     ⇒ 198 秒(頁內時鐘)
```
✅ **續期成功不改 URL、不導頁、不動表單。**
✅ 而且**續完之後就不再打 DB**:第 3 發起一律 `fresh` —— 那是補審 M1 的早退在真 runtime 上生效。

### 🔴 兩件這一輪【新量到】的事
```
① mount 那兩發是【同時】打出去的, 而【兩發都 renewed】
   ⇒ 第二發在第一發的 Set-Cookie 回來之前就上路了 ⇒ 兩張票都被簽出來。
   ⇒ 這就是審查提過的「多分頁 / 併發續期」那一格, 現在量到了。
   ⚠️ 不構成安全問題(兩張都是同一條鏈的合法票), 而**每一發都是一次 DB 查詢**。
   ⚠️ 而這兩發其中一發是 dev 造的:React StrictMode 讓 effect 跑兩次
      (`grep -n "reactStrictMode" apps/admin/next.config.ts` ⇒ 零命中 rc=1 ⇒ 走 Next 預設)。
      **production 只會有 1 發 mount** ⇒ 併發那一格在 production 要靠【多分頁】才會出現。
② `document.cookie` 讀不到那張票 —— 而那不是失敗, 是**伺服器用 httpOnly 重種了**。
   🔴 我當下沒有猜, 去看網路層:兩發都是 200 ⇒ cookie 確實有送出去、有被接受。
   📌 **「讀不到」與「沒送到」在 document.cookie 上長得一樣。**
```

## §6-6 收攤(這一次用對的尺)
```
source scripts/admin-probe/env.sh   ⇒ web=3011 proxy=3978 prest=3979 pg=55534
四個埠逐一 lsof ⇒ 各 0 listener;資料目錄已刪;pgrep "next dev" ⇒ 查無
```
🔴 對照 §5 那一格被撤回的證據:上一輪我**手打**了 `55501 / 3998`,而那兩個**從來不是這些服務的埠**。
**這一次的埠是從 `env.sh` 讀出來的, 不是我打的。**

## §6-7 這一輪的射程
```
· 只量了 Chromium、單一分頁、198 秒、一個【非受控】輸入框。
· 「受控輸入框會不會掉字」**仍然沒量**(§0 那一格還開著)。
· 併發那一格只量到 dev 的 StrictMode 版本, **沒有量真的多分頁**。
· 端點那七格是 curl 量的(server 層), 瀏覽器那段是另一組量測 —— 兩者沒有互相驗證。
```
