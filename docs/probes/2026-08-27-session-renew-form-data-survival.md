# 探針 · 續期失敗時,表單裡打到一半的字會不會不見(2026-08-27 線3)

> **這一格從 2026-08-26 起被記成「做不到」。它現在做得到了,而擋住它的東西不是當初以為的那個。**
> 原句在 `docs/runbooks/local-admin-with-real-data-probe.md:438`(已於 `acf3484a` 標為過期並附訂正節)。
> 受測對象:`bc61afe6`(片二補審)工作樹版本。撰寫時 `bc61afe6` **未推**。

---

## §0 這支探針回答什麼、不回答什麼(先讀,它決定你能拿它說什麼)

```
回答     續期【失敗】時, 頁面會不會自己跳走 / 使用者打到一半的字會不會不見
不回答   續期【成功】那條路 —— 本機量不到, 理由見 §1
```
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

### 🔴 訊號 D 順帶證明了另一件事(比原題更值錢)
補審 **M3** 的修法:`not-active` **不得當終局**(它與「DB 掛掉」是同一個值,`#933`)。
```
舊碼(5276411e, 現正在 production 上)⇒ 第一發 401 就 stopped = true ⇒ 【只會有 1 發】
新碼(bc61afe6)                      ⇒ 量到 4 發(頁內)/ 6 發(playwright)
```
⇒ **這是 M3 修法在真瀏覽器 + 真 Next runtime 上的第一次實證**,不是單元測試。

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
```
瀏覽器      只量了 Chromium(playwright)
時間        238 秒 / 4 發巡邏。沒有量「開著一整天」
表單        只量了一個受控 input(搜尋框)。沒有量檔案上傳、富文字、多步驟表單
票          全程【沒有】有效票(旗標開 ⇒ 沒有 cookie)⇒ 沒有量「票從有效變過期」那一刻
分頁        單一分頁。沒有量多分頁同時續期
```
⇒ 以上每一行都是**未數**。
⚠️ 上面每一行都是「我沒量」,**不是「不會有問題」**。
