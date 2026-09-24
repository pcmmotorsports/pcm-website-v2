# 計畫：經銷子網域 b2b.pcmmotorsports.com

- 日期：2026-09-23
- 狀態：**只寫計畫。沒有改任何程式、沒有改任何設定、沒有貼正式庫、沒有推送。**（2026-09-25 第四版：前台已做片 4 的 `site-mode.ts` 與片 6，未 commit；見「第四版」一節）
- 依據拍板：Sean 2026-09-23（做 b2b 子網域，帳號與一般站共用）、2026-09-08（`project_0908-b2b-subdomain-after-launch`）、2026-09-09（`project_0909-dealer-price-whole-package-after-launch`）
- 需要 Sean 批准才能動工：本計畫碰資料庫函式、新建資料表與權限、共用登入元件、Vercel 設定、寄信與金額顯示，命中鐵則 8 與鐵則 12。
- **2026-09-23 第二版**：Sean 看過第一版，六題答「依照推薦」，第 3 題改成**要有經銷商申請表單流程頁面**（逐字「還是要有申請表單流程頁面出現，感覺專業一點」）。第 8 節改寫成已定案、新增第 9 節整條申請流程、分片多 6 片、總時間約 10 小時 05 分。
- 🔴 **第二版還有兩件做不下去、要 Sean 決定**：核准之後帳號要變成哪一級（Q7）、核准要不要寄通知信（Q8，查下去比想像中貴很多）。兩題都在第 8 節末。
- 審查：見文末「審查紀錄」。**本輪沒有 Codex**（額度用完到 2026-09-27），改用 Fable 對抗審查，缺 Codex 那一路。**R1 判 FAIL（4 條必修）、R2 也判 FAIL（1 條必修）**，兩輪的必修都已修完，但照鐵則 12「R2 還有必修就不跑 R3、停下端 Sean」，**這份計畫要 Sean 看過才動工**。
- 🔴 **2026-09-24 更正（後台窗）**：第 4.2 節「目錄頁改讀 `price_by_tier->store`」**不能照做**。正式庫唯讀實查，那一欄有 **1,086 件比一般價還貴**，全部是過期的舊價（9/9 時只有 5 件）。改接哪一欄、怎麼修，以 `docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md`（分支 `agent/shop-6`）為準。第 9 節新增 9.7 申請表單頁細節。
- 🔴 **最重要的一件事**：真的經銷價**從來沒有灌進網站過**（2026-09-23 讀同步 log 實測，見第 4.0 節）。所以修目錄頁那支 migration 貼下去，畫面上一個數字都不會變——要先灌價，而灌價的第四道門是 Sean 要說「灌」這個字。

---

---

## 第四版（2026-09-25 下午；取代同日上午的第三版，也取代下面第 2.5、3、6 節的前台部分）

> 第三版（「經銷站跟原網站一樣、一般會員也能在經銷站買」）被 Sean 同日下午的回答取代，Fable R1 對第三版的 3 條必修也併進本版。
> 本版前台的依據：Sean 2026-09-25 經主視窗轉述的四點（下面 A 節逐條），以及第 8 節已定案的各條。

### A. Sean 定的四點（2026-09-25）

1. **一般站不再顯示經銷價**：片 9 照做。
2. **「申請成為經銷商」入口兩站都要放。**
3. **登入分流**：一般會員不能登入經銷站，經銷會員不能登入一般站。
   - 登入成功後依會員等級判斷，站別不對就**立刻登出**，顯示「這是經銷專用網站，請到一般網站登入」或反過來的訊息，附另一站的連結。**email 與 LINE 都要處理**（本版一併處理 Google 與重設密碼，它們也會建立登入狀態）。
   - 經銷站上沒登入的訪客可以瀏覽、看一般價，但**結帳必須登入** ⇒ 實際上只有經銷商能在經銷站下單。
   - 會員等級變更後（例如一般會員被核准成經銷商），原本那個站的登入狀態要在**下次請求時失效**。
   - 申請中、還沒核准的會員算一般會員，只能登入一般站。
4. 後台由後台窗負責；本計畫只寫清楚跨站銜接（下面 E 節）。

**「經銷會員」的定義**：`customers.tier = 'store'`（後台名稱「車行」）。理由：`create_order` 只有這一級收經銷價（`20260915100000:190,372`），前台取價也只認這一級（`lib/tier-prices.ts:62`）。`premiumStore`（後台名稱「經銷」）今天收一般價，本版**當一般會員處理**（見 F 節 Q1）。

### B. 兩個站各自的規則

| | 一般站 www | 經銷站 b2b |
|---|---|---|
| 訪客 | 看一般價、可加購物車、結帳要登入（現況） | 看一般價、可加購物車、結帳要登入 |
| 能登入的帳號 | `tier ≠ 'store'`（含申請中的人、含 `premiumStore`） | 只有 `tier = 'store'` |
| 登入後看到的價 | 一律一般價（片 9：不走任何經銷價路徑） | 經銷價 |
| 查不到會員等級 | 維持 09-08 拍板「查不到給一般價」（`project_0908-tier-lookup-failure-shows-general`） | 照 Q5「查不到就擋」：登出並顯示「目前無法確認您的經銷資格」 |
| 搜尋引擎 | 照常收錄 | 不收錄（片 6） |

### C. 片、時間

| 片 | 內容 | 時間 | 審查 |
|---|---|---|---|
| 4 | `lib/site-mode.ts`（已做，未 commit）。**改**：認不得的值不再猜成經銷站，改成在建置時直接失敗（Fable R1 consider 4：經銷站外觀與一般站幾乎相同，一般站設錯時唯一差別是不收錄，沒有人看得出來） | 15 分 | Fable |
| 6 | 經銷站不收錄（已做，未 commit）。**改**：robots.txt 不再全擋（全擋會讓 Google 讀不到 noindex，被外部連結的網址仍可能出現在搜尋結果；Fable R1 consider 5），改成照一般站的規則但不發 sitemap；各頁靠 `noindex` meta；`/llms.txt` 在經銷站回 404 | 15 分 | Fable |
| L1 | 站別規則集中一支：`lib/site-access.ts`。輸入站別與登入狀態，回「訪客／可以／站別不對／查不到」四種結果；純邏輯、可單測 | 30 分 | Codex（權限） |
| L2 | 四個會建立登入狀態的入口套用 L1，站別不對或（經銷站）查不到就立刻登出並導到 `/login?error=…`：帳密登入 `app/login/actions.ts`、註冊 `app/register/actions.ts`、Google 與所有信件連結（驗證信、改信箱、**重設密碼**）共用的 `app/auth/callback/route.ts`、LINE `app/api/auth/line/callback/route.ts`。登入頁顯示對應訊息與另一站連結。LINE 那支要沿用它「唯一的 redirect 在 try 之外、先回目的地字串」的既有形狀（C4）。登出一律用只清本機的方式（C1） | 90 分（兩片） | Codex（權限） |
| L3 | 每次請求的後備檢查，**放在 `apps/storefront/src/proxy.ts`，不放根 layout**（Fable 第四版 R1 must-fix：根 layout 在站內點連結換頁時不會重跑，server action、route handler、`app/api/**` 也不經過它，「等級變更後下次請求失效」做不到）。proxy 每個請求都經過（含換頁的 RSC 請求、server action、API），而且能直接寫 cookie。做法：**只有帶登入 cookie 的請求才查**（訪客零成本）；驗使用者並查 `customers.tier`；站別不對、或經銷站驗不出來（F 節 Q5）⇒ **直接刪掉本機的登入 cookie**（不呼叫會撤銷所有 session 的全域登出，見 C1），再導到 `/login?error=…`。刪 cookie 不依賴登入系統回應，所以登入系統故障時也不會在登入頁無限導向（C2）。不需要另外做一支 GET 登出網址（避免被跨站圖片或預取觸發，C3）。`/login` 本身要排除在「導向」之外，避免迴圈 | 45 分 | Codex（權限） |
| L4 | 金額的最後一道：購物車 server action（`app/cart/actions.ts`）與建單（`app/checkout/charge-actions.ts` → `placeOrder` → `create_order`）依站別擋：經銷站只接受 `store`、一般站拒絕 `store`。**擋在建單那條路，不只購物車**（Fable R1 must-fix 3） | 45 分 | Codex（錢） |
| 5 | 經銷站上三處不走經銷價的地方（第 4.5 節：搜尋疊層、商品頁「相關商品」、首頁與會員中心精選）：**經銷商看經銷價、其他人看一般價**（F 節 Q4 已定）。相關商品與精選用現成的 `fetchEffectivePrices` 換價；搜尋疊層只在經銷站帶登入 cookie 時多呼叫一次 `get_effective_prices` | 45 分 | Codex（金額顯示） |
| 9 | 一般站不再走經銷價：**依 `isB2bSite()` 分流，不是刪程式**（同一份程式碼開兩個站，刪掉就是把經銷站的經銷價一起刪掉；Fable R1 must-fix 3）。**落在一個入口**：`lib/tier.ts` 的等級解析在一般站模式下一律回 general（Fable 第四版 R1 consider C6），目錄經銷 RPC、`fetchEffectivePrices`、商品頁經銷價都只在 `store` 時才走，因此自動全關，RSC payload 也不會帶經銷價 | 45 分 | Codex（錢） |
| 入口 | 「經銷商申請」連結：兩站頁尾各一條、會員中心一條。**連到一般站的 `/dealer-apply`**（申請中的人只能登入一般站，申請頁只能在一般站用；經銷站的連結用完整網址指到 www） | 15 分 | Fable |

- **L3 的實作細節（Fable 第四版 R2 必修，已寫入；實作照這裡）**
  1. proxy **另建** Supabase client：`createServerClient` 的 `getAll` 讀 `request.cookies`、`setAll` 寫進**同一個** response，刪 cookie 也寫在那一個 response（Supabase 官方 middleware 的形狀）。**不可以 import `lib/supabase/server.ts`**：它走 `next/headers` 的 `cookies()`，而 Next 16.3 在 proxy 回傳後會用那一份整個覆寫 response 的 `set-cookie`（`next/dist/server/web/adapter.js:312-313`）⇒ 權杖剛好到期被換新時，proxy 刪 cookie 那幾行會被新 token 蓋掉，錯站帳號永遠登不出去。
  2. **等級查詢拆兩層**：「原始等級」（查 `customers.tier`、不看站別）給 L1、L3、L4 用；「顯示價格用的等級」才套片 9 的「一般站一律 general」。否則一般站永遠看不到 `store`，經銷商照樣能登入一般站、L4 永遠不觸發、核准後也不會被登出。
  3. **「帶登入 cookie」的判斷與要刪的名單**：cookie 名稱是 `sb-<ref>-auth-token` 或它的分段 `sb-<ref>-auth-token.0`、`.1`…（`@supabase/ssr` 分段上限 3180 字元）。判斷照 `app/layout.tsx:206` 的寫法：`name === base || name.startsWith(base + '.')`。**不可以用 `startsWith(base)`**：Google 登入用的 `sb-<ref>-auth-token-code-verifier` 也會被當成登入 cookie 而被刪掉 ⇒ 經銷站上 Google 登入對所有人失效。
  4. **server action 不導向**：帶 `Next-Action` 標頭的請求若被導向，瀏覽器會重送 POST 並顯示「An unexpected response was received」錯誤。這種請求改成放行、同時清掉 request 與 response 的登入 cookie，讓 action 走既有的「未登入」處理。一般的換頁請求照常導向。
  5. **登入系統「暫時」出錯不刪 cookie**：`lib/tier.ts:92-98` 已經分得出可重試的錯誤。可重試 ⇒ 回一頁 503「目前無法確認經銷資格，請稍後重試」（不是導向，不會迴圈，也不會在刷卡 3DS 導回那一刻把人登出）；**只有「驗得出來但等級不對」才刪 cookie**。這修正 F 節 Q5 甲的範圍。
  6. matcher 排除 `_next/static`、`_next/image`、圖檔與 favicon（照 `apps/admin/src/proxy.ts` 的形狀）；`/login` 用**精確**比對排除，不用前綴（`/login/reset`、`/login/forgot` 不排除）。Next 16.3 的 proxy 固定跑 Node，不用設 runtime。
  7. **代價**：每個帶登入 cookie 的請求多兩次網路往返（驗使用者、查等級），含 `<Link>` 預取。訪客零成本。
  8. 登入頁要新增錯誤碼對應 F 節 Q3 那四句（`LoginPage.tsx:51-56` 今天只認 `oauth`、`line`，其他碼會顯示成「登入失敗」）。
  9. 瀏覽器端殘留：cookie 刪掉後瀏覽器端 client 讀不到 session、不會寫回；只有自動換發權杖的極短空窗可能復活一次，下一個請求會再被刪。localStorage 裡會留使用者自己的資料，無害。
- **L3 與 L2 的登出只清本機**（Fable 第四版 R1 consider C1）：`SupabaseAuthAdapter.ts:89` 的 `signOut()` 沒有指定範圍，預設會撤銷這個人所有的登入。
  情境：經銷商剛被核准、已在經銷站登入，又打開一般站的舊分頁 ⇒ 一般站登出他 ⇒ 若是全域登出，經銷站那邊也一起失效，還會被誤判成「無法確認經銷資格」。
- **原第三版的片 4b（丟錯誤給錯誤畫面）取消**：正式建置會把錯誤訊息換成通用字，客人看到的是「500 服務暫時無法使用」（Fable R1 must-fix 2）。改由 L2、L3 用「登出＋導到登入頁顯示原因」處理。
- **合計約 345 分（5 小時 45 分）**：15+15+30+90+45+45+45+45+15。
  對照第二版前台（片 4、5、5b、6、9 = 30+45+45+30+90 = 240 分）：**多 105 分**。多出來的是登入分流（L1–L3 共 165 分）；
  少掉的是片 9（從「刪程式」90 分改成「依站別分流」45 分）與片 4、6（已做，只剩調整，各 15 分）；片 5b 的擋下改成 L4（同為 45 分）。
  第三版那個「省 75 分」算錯了（Fable R1 consider 11），已作廢。

### D. 上線前的前置（不是前台片，但沒做完經銷站不能上）

- **經銷價要先灌（片 1b，Sean 要說「灌」）**。Fable R1 must-fix 1：經銷價沒灌時 `product_variants.price_store` 全是 NULL，`get_effective_prices` 會退回一般價（`20260924100000:226-233`），而 `create_order` 對 `store` 收 `coalesce(price_store, price_general)` 並改用未稅加稅制（`:190,:377`）⇒ **刷卡的經銷商會付「一般價＋5%」，比一般會員還貴**，畫面還把一般價當經銷價顯示。⇒ **片 1b 列為片 7（掛網域）的前置**；在那之前經銷站不對外。
- 片 7b 要多做：經銷站保留 LINE 登入（Sean 要求 email 與 LINE 都要分流）⇒ LINE 後台要加經銷站的 Callback URL，Vercel 經銷站專案要設 `LINE_REDIRECT_URI`；Supabase Redirect URLs 加經銷站（Google 與重設密碼要用）。

### E. 跨站銜接（給後台窗與主視窗）

- **申請**：申請中的人是一般會員，只能登入一般站 ⇒ 申請表 `/dealer-apply` 實際只在一般站用。經銷站上的入口指向 `https://www.pcmmotorsports.com/dealer-apply`。
- **核准之後**：後台把等級改成 `store` ⇒ 這個人在一般站的下一次請求被 L3 登出，登入頁顯示「您的經銷資格已開通，請到經銷網站登入」並附經銷站連結。申請頁「已開通」那一格的按鈕也指到經銷站。
- **降級（員工把經銷商改回一般）**：經銷站的下一次請求被 L3 登出，顯示「這個帳號目前沒有經銷資格，請到一般網站登入」。
- **後台不用做任何「踢人」的動作**：失效靠 L3 每次請求重查等級，不靠後台去刪 session。

### F. 還沒定的題目（每題附推薦）

- **Q1 `premiumStore`（後台「經銷」）算哪一種？** 甲（推薦）：當一般會員，只能登入一般站、看一般價（與今天收款一致）。乙：當經銷會員，那要先把取價與 `create_order` 打開給這一級（第 8 節 Q7 乙），碰金流、另開計畫。
- **Q2 經銷站的註冊頁怎麼辦？** 新註冊的帳號一定是一般會員，在經銷站註冊完會立刻被登出。甲（推薦）：經銷站的註冊頁不顯示表單，改成一段說明「經銷帳號請先在一般網站註冊並提出經銷商申請」，附一般站註冊與申請的連結。乙：照常註冊，註冊完被登出並看到說明（會多產生一個「註冊成功卻不能用」的體驗）。
- **Q3 登入頁的站別訊息文案**（主視窗 2026-09-25：先照推薦寫，與其他文案一起給 Sean 看）：
  - 經銷站擋一般會員：「這是經銷商專用網站。您的帳號目前是一般會員，請到一般網站登入。」按鈕「前往 www.pcmmotorsports.com」
  - 一般站擋經銷會員：「您的帳號是經銷商帳號，請到經銷商網站登入，那裡會顯示您的經銷價格。」按鈕「前往 b2b.pcmmotorsports.com」
  - 一般站、剛被核准：「您的經銷資格已開通，請到經銷商網站登入。」按鈕同上
  - 經銷站查不到等級：「目前無法確認您的經銷資格，請稍後再登入。若一直無法登入，請聯絡 PCM 業務。」
- **Q4 經銷站的搜尋疊層、相關商品、精選怎麼顯示價格？** **已定（主視窗 2026-09-25 轉 Sean：經銷站要看起來跟原站一樣，優先顯示正確價格）**：
  **經銷商看經銷價，其他人看一般價**，三處都做，不退到「不顯示價格」。理由與成本：
  - 相關商品、首頁與會員中心精選：這幾頁在伺服器端已經解析過等級，只要把商品編號交給現成的 `fetchEffectivePrices`（`lib/tier-prices.ts:58`，非 `store` 一律不呼叫）換價，不新增取價路徑。
  - 搜尋疊層：客人停打字 220 毫秒才送一次（`components/SearchOverlay.tsx:64`）。只有「經銷站＋帶登入 cookie」的請求才多呼叫一次 `get_effective_prices`；那支資料庫函式自己驗身分，不是 `store` 一律回一般價（`20260907010000:107`），所以不需要在 API 裡另外查等級。訪客與一般站零額外成本。
  - 三處都碰金額顯示 ⇒ 片 5 照鐵則 12 送 Codex。取不到經銷價時照 `cac121efb` 的做法顯示「價格暫時無法取得」，不退回一般價。
- **Q5 經銷站「有登入 cookie 但登入系統驗不出來」時？** 甲（推薦）：當成查不到，登出並顯示 Q3 最後一句（分辨不出這人是不是經銷商，給一般價就是 Q5 禁止的那一種）。**沒有登入 cookie 的訪客不受影響**，照常看一般價（`app/layout.tsx` 已經分得出「確定沒登入」與「驗不出來」）。乙：一律照訪客處理（代價：登入系統抖動時經銷商會看到一般價）。
- **Q7 在「錯的站」點重設密碼信怎麼辦？**（Fable 第四版 R1 consider C5）重設密碼的登入狀態是在 `/auth/callback` 建立的，L2 會把它登出，重設頁就會顯示「連結不能用」，原因不對。甲（推薦）：`/auth/callback` 判斷是重設密碼且站別不對時，登出並顯示「這個帳號請到〔另一站〕重設密碼」，附連結。乙：重設密碼豁免站別，改完密碼再登出（多一條例外，較容易出錯）。
- **Q6 經銷商專用提示條「經銷商專區：以下價格為您的經銷價。」要不要做？** 甲（推薦）：先不做。經銷站只有經銷商能登入，站名本身就說明了；而提示條若放進 Header 或根 layout，就得在那裡解析等級，會把 L3 的故障面擴大（Fable R1 consider 7）。乙：只放在已經解析過等級的頁面（目錄、商品頁、購物車）。
- **依賴**：D 節的片 1b 灌價，要 Sean 說「灌」。

---

## 1. 做完之後，兩種客人各自看到什麼（⛔ 第二版；兩站行為以上面「第四版」B 節為準）

一般客人在 `www.pcmmotorsports.com` 買東西，看到的一律是牌價，網站上沒有任何地方會出現經銷價；經銷商改到 `b2b.pcmmotorsports.com`，用**同一組帳號**登入後，從商品列表到結帳看到的一律是他自己的經銷價。

一般帳號如果打開經銷站的網址，會看到一頁「這個帳號沒有經銷資格」的說明，**看不到任何商品與價格**，畫面上有一顆按鈕可以直接提出經銷商申請。

想成為經銷商的人，在一般站或經銷站都找得到「申請成為經銷商」，登入後填一張八格的表送出，員工在後台核准之後他的帳號就能進經銷站（第 9 節）。

---

## 2. 架構

### 2.1 一份程式碼、兩個 Vercel 專案

顧客站程式碼只有一份（`apps/storefront`），用一個環境變數決定它這次是「一般站」還是「經銷站」。不複製 repo、不開新分支。

這個做法在本專案已經有先例：`apps/admin` 就是同一個 repo 開成另一個 Vercel 專案（`pcm-admin`，綁 `admin.pcmmotorsports.com`）。

現有 Vercel 專案（來源：`docs/runbooks/2026-09-09-domain-switch-shop-to-www.md:29-37`，Sean 2026-09-11 自己在後台看過並貼回，主視窗用 Vercel MCP 唯讀複核過）：

| 專案 | 綁的網域 | production 分支 |
|---|---|---|
| `pcm-website-v2` | `shop.pcmmotorsports.com` 等 | `main` |
| `pcm-admin` | `admin.pcmmotorsports.com` | `dev` |
| `pcm-quote-v2` | `quote.pcmmotorsports.com` | 未問 |
| `pcm-official-site` | `www.pcmmotorsports.com`、`pcmmotorsports.com` | 沒接 Git |
| `pcm-moto` | `bikes.pcmmotorsports.com` | 未問 |

上表是 2026-09-11 的狀態。`docs/handoff/CURRENT.md` 2026-09-21 那段寫著 `www.pcmmotorsports.com`、`pcmmotorsports.com`、`shop.pcmmotorsports.com` 現在都指向顧客站的 production 部署，**所以上表第 1 列與第 4 列之間已經變過**。開新專案之前要先在 Vercel 後台重看一次，不要照抄這張表。

新專案設定：

- 名稱：`pcm-website-b2b`（暫定）
- Git repo：同一個，Root Directory 與 Build Command **照抄 `pcm-website-v2` 現有設定**（repo 本機沒有 `.vercel/project.json`，這兩格我查不到，必須開後台看）
- Production 分支：與顧客站相同
- 網域：`b2b.pcmmotorsports.com`

### 2.2 環境變數怎麼分

顧客站只有一個「站台自己的網址」環境變數：`NEXT_PUBLIC_SITE_URL`（`apps/storefront/src/lib/site-url.ts:6,21-29`）。它刻意不寫進 `.env.example`，值由 Sean 在 Vercel 後台設（同檔 `:11-16` 註解）。

經銷站專案要獨立設定的：

| 變數 | 值 | 為什麼 |
|---|---|---|
| `NEXT_PUBLIC_SITE_MODE` | `b2b` | 新增。一般站不設或設 `retail` |
| `NEXT_PUBLIC_SITE_URL` | `https://b2b.pcmmotorsports.com` | 不設會讓 canonical、Open Graph 與刷卡 3DS 回呼全部指回 www。3DS 那支會嚴格驗 https origin（`apps/storefront/src/lib/payment/three-ds-urls.ts:18,27-36`），值不對刷卡會壞 |
| `LINE_REDIRECT_URI` | `https://b2b.pcmmotorsports.com/api/auth/line/callback` | 只在決定經銷站保留 LINE 登入時才要。LINE 後台的 channel 也要把這個網址加進 Callback URL 清單，否則 LINE 登入會被 LINE 擋掉 |

其餘變數（`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_TAPPAY_*` 等）與顧客站相同值，兩邊各設一份。

### 2.3 經銷站不可以被 Google 收錄

這一格很容易漏，而漏掉的後果是經銷站整站進 Google。要改三個地方：

- `apps/storefront/src/lib/seo.ts` 的 `buildRobots()`：經銷模式回 `Disallow: /`
- `apps/storefront/src/app/sitemap.ts`：經銷模式回空陣列
- `apps/storefront/src/app/layout.tsx` 的 metadata：經銷模式加 `robots: { index: false, follow: false }`

不能靠「不設 `NEXT_PUBLIC_SITE_URL`」來達成（那確實會讓 robots 休眠全擋），因為同一個變數也在管刷卡 3DS 回呼。

### 2.4 登入狀態要不要跨兩個子網域

**現況（我開檔核過）**：

- 顧客站**沒有 middleware**。Next 16 把這支檔改名成 `proxy.ts`，所以兩個檔名都要找：`find apps -iname 'middleware.ts*' -o -iname 'proxy.ts*'` 只命中 `apps/admin/src/proxy.ts`（後台的），顧客站兩種都沒有。登入保護目前落在每個頁面與 server action 自己呼叫 `getVerifiedUser()`。
- Supabase client 建立時**沒有設 cookie domain**：`apps/storefront/src/lib/supabase/browser.ts:23`（`createBrowserClient(url, anonKey)`，無第三參數）、`apps/storefront/src/lib/supabase/server.ts:35-49`（`createServerClient` 只給 `cookies` adapter，`setAll` 直接沿用 SDK 給的 options）。
- 所以登入 cookie 今天是 host-only，`www` 與 `b2b` **預設不會共用同一個登入狀態**。

有兩條路：

**路 A：不共用 session，只共用帳號（建議）**

兩個站用同一個 Supabase 專案、同一份 `auth.users` 與 `customers`，所以是**同一組帳號、同一組密碼**。差別只是經銷商在 b2b 要自己登入一次。

- 要改的程式：**零**。
- 要改的設定：Supabase 後台 Authentication → URL Configuration 的 Redirect URLs 加 `https://b2b.pcmmotorsports.com/**`（Google 一鍵登入與密碼重設信要用）。Google Cloud Console 不用改，Google 的回呼對象是 Supabase 自己的網址，不是我們的網域。
- 代價：經銷商在兩個站之間切換要各登入一次。

**路 B：共用 session（不建議，但寫清楚怎麼做）**

要把 cookie 從 host-only 改成 `domain: '.pcmmotorsports.com'`：

- `apps/storefront/src/lib/supabase/browser.ts:23` → `createBrowserClient(url, anonKey, { cookieOptions: { domain: '.pcmmotorsports.com' } })`
- `apps/storefront/src/lib/supabase/server.ts:35` → `createServerClient(url, anonKey, { cookies: {...}, cookieOptions: { domain: '.pcmmotorsports.com' } })`

（型別上可行：`@supabase/ssr` 的 `cookieOptions` 是 `Partial<SerializeOptions>`，接受 `domain`。）

三個代價要先知道：

1. 這顆 cookie 會**同時送到 `admin.pcmmotorsports.com`、`quote.pcmmotorsports.com` 與 `bikes.pcmmotorsports.com`**，因為它們在同一個主網域底下。今天顧客的登入資料不會到後台，改了就會。（後台沒有用 `@supabase/ssr`，所以不會撞到同名 cookie，但它仍然會收到客人的登入資料。）
2. 改了之後，**現有每一位已登入客人的瀏覽器裡會同時存在新舊兩顆同名 cookie**（舊的 host-only、新的帶 domain）。瀏覽器兩顆都會送，而哪一顆生效沒有保證，症狀是「有些客人被登出、有些客人怎麼重登都卡住」，而且只發生在改版那一刻已登入的人身上，本機測不出來。
3. 這是共用登入元件，命中鐵則 8，本身就要另外一份 plan。

**建議走路 A**，理由是它的失敗方向是「經銷商多登入一次」，路 B 的失敗方向是「顧客的登入資料跑進後台網域」與「上線當下一批客人登入壞掉」。這題列進第 8 節請 Sean 決定。

### 2.5 進站的閘要放在哪（⛔ 進站閘已取消：第四版沒有「擋人看站」這件事。**proxy 仍會新增，但用途改成 L3 的站別後備檢查**，見第四版 C 節；下面內文只剩紀錄）

~~不新增 middleware。~~ **2026-09-25 更正（主視窗決定甲）：改用最小 proxy，只在經銷模式寫路徑標頭。**
原因：根 layout 拿不到目前的網址，而經銷站上有幾頁非經銷帳號也必須進得去（登入、註冊、忘記密碼、條款、申請表、首頁）；
若改成各頁群組各自加閘，之後新增頁面時會漏掉（第 5 節講的就是這種漏法）。
做法：新增 `apps/storefront/src/proxy.ts`。一般站模式直接放行、不改請求也不改回應；經銷模式把目前路徑寫進請求標頭
（**覆寫**，不沿用客人自己送來的同名標頭），並在回應加 `X-Robots-Tag: noindex, nofollow`。

閘放在 `apps/storefront/src/app/layout.tsx`：那是根 layout，**每一個頁面**都從它渲染，經銷模式時先問一次身分，
不是經銷商、而且路徑不在放行清單裡，就直接渲染說明頁、不渲染 `children`。
放行清單：`/`（經銷站首頁，見第 3 節）、`/login`、`/login/forgot`、`/login/reset`、`/register`、`/logout`、`/privacy`、`/terms`、`/dealer-apply`。
標頭缺席（proxy 沒跑到）時一律當成「不在放行清單」處理，也就是擋下。

**但它只管「頁面」，不管下面這些**，這一格不要讀寬了：

| 不經過根 layout 的東西 | 在經銷站上的影響 |
|---|---|
| route handler（`apps/storefront/src/app/api/` 底下 7 個目錄） | 一般帳號仍叫得到。它們吐的東西**不含經銷價**（有些是逐單資料、有些是金流 webhook，不是全部都公開） |
| server action（購物車與結帳 `app/cart/actions.ts`） | 一般帳號仍呼叫得到。**這一支要自己加擋**，它已經 import 了 `resolveAuthenticatedTierStrict`（`:30`） |
| `sitemap.ts` / `robots.ts` / `generateMetadata` | 走 2.3 節那三處改法，不走這道閘 |
| `not-found` / error boundary | 會在閘外渲染。內容是通用文字，不含價格 |

**而這道閘不是經銷價的防線**——真正的防線在資料庫，而且已經在了：

- 經銷目錄函式 `search_catalog_by_vehicle_dealer`：沒登入或 tier 不是 `store` 直接 `RAISE EXCEPTION`。引註要指**現役那一代**（14 參）：閘在 `supabase/migrations/20260922130000_m4b_catalog_page_limit_1000.sql:649`，`anon` 沒有 EXECUTE（`supabase/migrations/20260916220000_m4b_catalog_fit_scope.sql:1063` 只 GRANT 給 `authenticated`）。最初那一代（12 參）的同一道閘在 `20260908010000:158`，行為一樣，但那個簽章已經不是活的了。
- 經銷價函式 `get_effective_prices`：非 `store` 的 tier 一律降成 `general`（`supabase/migrations/20260907010000_m4b_m208_get_effective_prices.sql:107`）。
- 經銷專用 view `products_list_dealer`：`anon` 與 `authenticated` 都沒有任何權限，只有上面那支 SECURITY DEFINER 函式讀得到（`supabase/migrations/20260908000000_m4b_q74_products_list_dealer_view.sql:231-233`）。

所以「一般帳號誤進經銷站」不會洩漏經銷價，這件事不靠畫面判斷，靠的是資料庫拒絕。畫面那道閘是為了**不要讓一般客人看到一個他用不了的站**，不是為了擋價格。

---

## 3. 進站規則與文案（⛔ 第二版，已被「第四版」取消；保留作紀錄）

文案照 `docs/patterns/admin-copy-style.md`：說明現在是什麼狀態、下一步能做什麼，不出現資料表名稱、tier、RPC 這類字眼。

### 經銷站首頁（2026-09-25 Sean 新需求，片 5c）

任何人都能進經銷站首頁（`/` 在放行清單裡），顯示最新商品：

- **未登入，或已登入但不是經銷商**：看得到最新商品，**商品卡不顯示任何價格**，價格的位置改放「登入看經銷價」按鈕；
  頁首放兩個入口「登入」與「申請成為經銷商」（連到 `/dealer-apply`）。點進商品頁一樣會被擋，擋下時照下面三種畫面處理。
- **已登入的經銷商**：最新商品的商品卡直接顯示經銷價，資料一律讀經銷那條路，不用一般價。
- 盡量重用一般站首頁現有的「最新商品」元件與版型（鐵則 1）；要改共用元件先回報主視窗。

### 未登入（首頁以外的頁面）

導到經銷站自己的登入頁，頁面上方一句說明：

> 標題：經銷商專區
> 說明：這裡是 PCM 經銷商專用的訂購網站，登入後會顯示您的經銷價格。
> 按鈕：登入
> 連結：還不是經銷商？提出申請
> 附註：一般消費者請前往 www.pcmmotorsports.com

「提出申請」這條連結點下去，未登入的人會先被導去註冊或登入，登入完自動回到申請表（沿用現有的 `next` 參數機制）。理由見 9.1：不登入就做不到「核准誰」這件事。

登入表單本身沿用現有的（`apps/storefront/src/app/login`），不另做一套。

### 一般帳號登入

不顯示任何商品與價格，只有一頁說明：

> 標題：這個帳號目前沒有經銷資格
> 說明：您已登入，但這個帳號尚未開通經銷商資格，因此無法查看經銷價格與下單。
> 說明第二段：如果您是車行或零售商，可以在這裡提出經銷商申請；如果您要以一般消費者身分購買，請前往 www.pcmmotorsports.com。
> 按鈕一：提出經銷商申請
> 按鈕二：前往 www.pcmmotorsports.com
> 按鈕三：登出

這一頁**不渲染任何商品資料**，也不去呼叫任何取價的函式。

⚠️ **這個帳號已經有一筆申請在審核中的話，第一顆按鈕要換成「查看申請進度」**，不能還寫「提出申請」——他會以為上次沒送出去而重送，而重送會被資料庫的部分唯一索引擋下（9.3），畫面上就變成一個沒有解釋的錯誤。

### 經銷帳號登入

正常顯示整個網站，價格一律是經銷價。頁首固定一條說明，讓人知道自己在哪個站：

> 經銷商專區：以下價格為您的經銷價，未稅。

「未稅」這兩個字要不要印，跟著 Sean 2026-09-06 的 Q24 拍板走（`project_0906-dealer-price-display-tax-by-payment-method`）：他明文說**不標「未稅」**。所以上面那句要改成：

> 經銷商專區：以下價格為您的經銷價。

同一條拍板還定了：刷卡加 5%、匯款不加；商品頁那句「含稅 · 滿 NT$ 5,000 免運」對經銷身分不顯示。這兩件已經拍過，不再問。

### 身分查不到的時候

Sean 2026-09-08 拍過「查不到身分給牌價、不給錯誤頁」（`project_0908-tier-lookup-failure-shows-general`）。**那條拍板的射程是一般站**。在經銷站上「給牌價」等於讓一個身分不明的人看到整個站，方向相反。

經銷站的處理是：身分查不到就當作沒有經銷資格，顯示上面那頁說明，並在文案裡明說這可能是暫時的：

> 標題：目前無法確認您的經銷資格
> 說明：系統暫時讀不到您的帳號資料，請重新整理。若仍無法進入，請聯絡 PCM 業務。
> 按鈕：重新整理

這一格算是對 09-08 拍板的例外，要列進第 8 節請 Sean 確認。

---

## 4. 經銷價資料修好的步驟

### 4.0 先講清楚：這裡有兩個病，不是一個

**病一：真的經銷價從來沒有灌進網站過。這句是實測的，不是推論。**

經銷價的真來源是報價單資料庫的 `dealer_price_v`，要灌進顧客站必須把 GitHub secret `DEALER_PRICE_SUPPLIERS` 從空字串設成 `rpm`。那顆按鈕的前置條件逐字寫在 `docs/runbooks/dealer-price-first-load.md`：門 1 說這顆 secret「**先設成空字串**」，門 4 說「**Sean 說了『灌』這個字，A 才 `gh secret set`**」。

secret 的值讀不出來，但**同步程式每一輪都會把生效的 allowlist 印進 log**（`scripts/rpm-import.ts:272`）。我讀了最近一輪排程同步的 log（2026-09-23 唯讀跑 `gh run view 35710220221 --log`，那是 2026-09-22 09:32 CST 那一輪）：

```
[dealer-price] 本次生效 allowlist: (空) · 家數 0
[dealer-price] eazigrip 不在 allowlist ⇒ untouched(兩層各帶自己的舊值)
```

每一家供應商都是同一句。⇒ **到 2026-09-22 為止，經銷價一次都沒有灌過。**

旁證（都對得上）：`20260908000000_m4b_q74_products_list_dealer_view.sql:46-48` 逐字（2026-09-07 唯讀實測，**分母 25,769 筆 products**）`price_store IS DISTINCT FROM price_general` = **0** 筆；`tier-prices.ts` 檔頭記著 25,769 件商品 + 59,841 個變體全無差價。

⇒ **第 4.2 節那支 migration 修完之後，畫面上一個數字都不會變。** 這不是失敗，是這個病本來就要兩件一起做——片 1b 那趟灌價流程是**必做**，不是「如果」。

**病二：就算灌了，目錄頁還是顯示一般價**，因為它接的欄位永遠 NULL。這是第 4.1 節。

⇒ 順序是：先確認病一（片 1），再修病二（片 3）。兩個都做完，經銷商在目錄頁才會看到自己的價。

### 4.1 病二的根因

經銷價在資料庫裡有三個欄位，而**目錄頁接的是唯一一個沒有任何程式會寫的那個**。

| 欄位 | 誰寫 | 誰讀 | 現況 |
|---|---|---|---|
| `product_variants.price_store` | `scripts/rpm-transform.ts:678`（`dealerPriceOf()`，`:635`） | `get_effective_prices`（`20260907010000:150`）、`create_order`（`20260915100000:377`） | **接線是對的**（商品頁、購物車、結帳走這條）。**有沒有資料是另一回事**，見 4.0 |
| `products.price_by_tier->>'store'` | `scripts/rpm-transform.ts:563`（`productStoreOf()`，`:653-658`） | `get_effective_prices`（`20260907010000:120-123`） | 接線是對的（沒有變體的商品走這條）。**key 一定在，但值不一定是真經銷價**，見下 |
| **`products.price_store`** | **沒有人寫**：`scripts/rpm-transform.ts:534` 逐字 `price_store: null` | **只有經銷目錄 view 讀它**：`supabase/migrations/20260908000000_m4b_q74_products_list_dealer_view.sql:216` 逐字 `coalesce(pr.price_store, v.price_general) AS price_general` | **永遠 NULL** |

同步程式那一行的註解寫著「Q2=A 獨立經銷欄留 NULL（view 無經銷價、絕不接）」——那是 2026-06-02 的決定（`supabase/migrations/20260602192455_s3a_composite_keys_drop_rpm_prefix.sql:9`），而 2026-09-08 建經銷目錄 view 的人接了這一欄。**兩邊各自都合理，湊起來就是經銷目錄永遠 `coalesce` 回一般價。**

**「`price_by_tier` 帶 store 有 26,642 筆」不能讀成「有 26,642 筆經銷價」。** 資料庫的 CHECK 逼每一列都必須有 `store` 這個 key（`supabase/migrations/20260511180231_pricing_tier_alignment.sql:44-47` 逐字 `price_by_tier ? 'general' AND price_by_tier ? 'store'`），所以那個數字就是商品總數。而沒有真經銷價時，同步程式填的是一般價或 0：`scripts/rpm-transform.ts:563` 逐字 `store: { amount: productStoreOf(...) ?? priceGeneral ?? 0, currency: TWD }`。

⇒ 判斷「有沒有真經銷價」只能靠 4.3 節那句「與一般價不同的有幾筆」，不能靠「有幾筆帶 store」。

### 4.2 要改哪裡

> 🔴 **2026-09-24 本節作廢，不要照做。** `price_by_tier->store` 在沒有開灌價的供應商身上是**過期的舊一般價**（同步程式 `rpm-transform.ts:653-658` 只帶舊值、不重算，而一般價每天更新）。正式庫 2026-09-24 唯讀：與一般價不同 1,109 件、比一般價貴 **1,086 件**（rizoma 984、dbk 83 等）。照本節貼下去，這 1,086 個比牌價還貴的數字會直接給經銷商看到。
> 新修法：改接**基準款變體的 `product_variants.price_store`**（結帳真的收錢的那一欄），並一起修 `get_effective_prices` 商品那一半。全文見 `docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md`。以下原文保留，作為當時的判斷紀錄。

**改讀的那一邊，不改寫的那一邊。** 一支 migration 把 view 的那一格從 `pr.price_store` 換成 `price_by_tier->'store'->>'amount'`。

**不可以寫成裸的 `::integer` 轉型。** 上面那條 CHECK 只保證 key 存在，不保證值是數字：遇到 `'1,500'`、`'12.5'`、`'abc'` 會讓整張 view 的查詢直接 RAISE，而 `fetchCatalogPage` 對經銷路徑刻意不退回公開查詢（`apps/storefront/src/lib/products.ts:861-877`）⇒ **經銷商看到的是整個目錄空白**。既有的 `get_effective_prices` 正是因為這個理由用正則守（`20260907010000:118-123`，檔內註解寫明那是 codex R1 的 must-fix）。

**逐字照抄它的判斷，一個字都不要多加**：

```sql
coalesce(
  CASE
    WHEN pr.price_by_tier -> 'store' ->> 'amount' ~ '^[0-9]+$'
    THEN (pr.price_by_tier -> 'store' ->> 'amount')::integer
  END,
  v.price_general
) AS price_general
```

`CASE` 沒有 `ELSE`，不符合的列回 NULL，再由外層 `coalesce` 退回一般價——與舊寫法「NULL 就退回一般價」的語意完全一樣。

🔴 **不要自作聰明多加守衛。** 這份計畫第一版加了 `nullif(...,0)` 與幣別判斷，R2 審查抓出來那是錯的，理由有三個，每一個都足以單獨否決：

1. **會跟商品頁與結帳算出不同的價。** `get_effective_prices` 對 `amount` = `'0'` 的列回 **0**（正則命中、不看幣別），而加了 `nullif(...,0)` 的 view 會退回一般價。同一支商品：目錄頁印 750、商品頁印 0、結帳收 0。**修一個不一致，造出一個更難發現的不一致。**
2. **與 Sean 的拍板方向相反。** Sean 2026-08-25 拍板「0 元是合法價格」（贈品、買一送一的那個「送」、試用品），`create_order` 那道閘為此從 `<= 0` 改成 `< 0`（`20260915100000:381-385` 逐字）。把 0 當成「沒有價格」是在推翻它。
3. **理由本身與程式事實不符。** 我原本寫「擋同步程式填的 0 placeholder」，但 `scripts/rpm-transform.ts:563` 是 `productStoreOf(...) ?? priceGeneral ?? 0`——只有在一般價**也是** null 時才會填 0，那種情況下退不退回一般價結果都一樣。幣別同理：同一行寫死 `currency: TWD`，那道守衛擋不到任何實際資料，只會製造分歧。

⇒ **如果真的要訂「0 元怎麼算」或「非台幣怎麼算」的規則，那要在同一支 migration 裡把 `get_effective_prices` 與 `create_order` 一起改**，而那是金流函式，要另外一份 plan 與一輪審查。本片只做一件事：讓目錄頁讀對欄位。

為什麼不是「讓同步程式開始寫 `products.price_store`」：那要重跑一整輪同步才會有值，而且從此有兩個欄位要保持一致，哪天不一致沒有人會發現。改 view 是一支 migration、當下生效、不用重跑同步，而且讓那一欄真正變成沒人用的死欄（要不要順手 DROP 它另案，本次不動）。

那支 migration 必須沿用 `20260908000000` 的寫法：`security_invoker` 刻意不設、兩道 REVOKE、誰都不 GRANT。少任何一道，經銷價就對 `authenticated` 開了。

### 4.3 改之前一定要先做的三件事（片 1）

全部唯讀（`scripts/readonly-prod-sql.sh` 或 `~/pcm-mailbox/0905查證/run.sh`）。探測 SQL 本身也要帶正則守，否則一筆壞資料會讓探測先炸，而那會被誤讀成「查不到」。

**① 有幾筆真的有經銷價**

```sql
-- 商品層：守衛後取得到值、而且與一般價不同的有幾筆
select count(*) from products
where case when price_by_tier->'store'->>'amount' ~ '^[0-9]+$'
           then (price_by_tier->'store'->>'amount')::integer end is not null
  and case when price_by_tier->'store'->>'amount' ~ '^[0-9]+$'
           then (price_by_tier->'store'->>'amount')::integer end <> price_general;

-- 變體層：有幾筆有值、有幾筆與一般價不同
select count(*) filter (where price_store is not null)                     as 有值,
       count(*) filter (where price_store is distinct from price_general)  as 有差價
from product_variants;
```

**這裡不可以用 `IS DISTINCT FROM`**：守衛後的值是 NULL 時（壞資料、缺 key），`NULL IS DISTINCT FROM 1500` 會回 true，**把壞資料算成「有差價」**——而這個數字正是 Sean 決定要不要灌價的依據。要先 `IS NOT NULL` 再比。

依第 4.0 節的實測，這兩層預期都是 **0**。量到不是 0 ⇒ 我對「從來沒灌過」的判斷錯了，停下重查。

**② 會不會有「經銷價比一般價貴」的錯價見客**

```sql
select count(*) from products
where case when price_by_tier->'store'->>'amount' ~ '^[0-9]+$'
           then (price_by_tier->'store'->>'amount')::integer end > price_general;
```

`project_0909-dealer-price-whole-package-after-launch` 記著：2026-09-09 有 **9 筆**不同、其中 **5 筆經銷價比一般價貴**（止滑貼 750 → 1500、搖臂護蓋 4600 → 12800 等），原因是網站把一般價與經銷價取自不同變體。今天目錄頁接的是 NULL，所以那幾筆藏著沒人看到；**一修 view 就直接見客**。

同步程式後來改過：`productStoreOf()`（`scripts/rpm-transform.ts:653-658`）現在取的是 `basis` 那一支的上游價，與 `price_general` 同一支，註解明寫「兩個數才是一對」。**所以根因可能已經修掉了，而 09-09 那個讀數是 14 天前的，我沒有複量。** 這個數不是 0 ⇒ **停，先查那幾筆，不要貼 view**。

**③ 有沒有非數字或非台幣的值**

```sql
select count(*) from products
where price_by_tier->'store'->>'amount' !~ '^[0-9]+$'
   or coalesce(price_by_tier->'store'->>'currency','') <> 'TWD';
```

這個數不是 0 ⇒ 上面那三個守衛就不只是保險，是現在就會用到的。

### 4.4 怎麼驗證

**正對照（改對了會看到）**：挑一支已知經銷價與一般價不同的商品，用經銷帳號在目錄頁看到的是經銷價，用一般帳號在同一頁看到的是一般價。今天兩個帳號看到的是同一個數字。

**⚠️ 如果 4.3 ① 量出來是 0，全站沒有任何一支商品有價差**，那這個正對照做不出來——`20260908000000:48` 逐字寫過同一件事：「改對與改錯會印出同一個畫面」。那種情況下要在拋棄式 PG 上自己造一筆有價差的資料來驗，不能宣稱「線上驗過了」。

**負對照（證明這把尺是活的）**：三個都要做，只做一個證不到事情。

1. 在拋棄式 PG 上把 view 的那一格**故意寫回 `pr.price_store`**，跑同一組查詢，經銷價必須退回一般價。如果照樣顯示經銷價，代表我量的不是這條路。
2. 在拋棄式 PG 上餵一筆 `amount` 是 `'1,500'` 的壞資料，view 必須照常回一般價、**不可以 RAISE**。這一格在驗三個守衛真的在。
3. 用一般帳號直接呼叫 `search_catalog_by_vehicle_dealer`，必須被 `RAISE EXCEPTION` 擋下（現役那一代的閘在 `20260922130000:649`）。如果它回了資料，代表身分閘壞了，這支 migration 不能貼。

**注意拋棄式 PG 證不到正式庫**（`reference_throwaway-pg-fixture-types-differ-from-prod`：09-19 板 217 就是假表型別與正式庫不同，Sean 貼上去當場炸）。貼之前要用 catalog 對一次型別，而且要確認正式庫 `products` 的欄位授權與 view 的 proacl 仍與 migration 相同（`reference_view-truth-is-in-the-live-db-not-the-migration`）。

**另外要留一發會紅的測試**（鐵則 13 第 ③ 條）：在 `apps/storefront/src/lib/catalog-tier-all-paths.test.ts` 那一族補一格，斷言經銷目錄拿到的價格來自 `price_by_tier->store` 而不是 `price_general`。**落筆前先餵一發該紅的**（把 view 定義換回舊的那一格，確認測試會紅）。

---

## 4.5 還有三個地方，經銷商在經銷站上也會看到牌價

修完 view 還不夠。下面三條路**寫死一般價**，經銷商在 b2b 站上會遇到「目錄與商品頁是經銷價、這三個地方是牌價」，同一個站兩種價：

| 檔案:行號 | 現況 |
|---|---|
| `apps/storefront/src/app/api/search/route.ts:177` | 搜尋疊層回 `price: p.price`，來源是公開 view，恆牌價 |
| `apps/storefront/src/lib/recommendations/rule-based-engine.ts:35-36` | 商品頁「相關商品」逐字「一律 `toUIProduct(p,'general')` strip」 |
| `apps/storefront/src/lib/product-jsonld.ts:246-250` | 結構化資料用 `product.price` / `v.price`（給 Google 看的，經銷站本來就不該被收錄，所以這一條跟著 2.3 節走就好） |

另外還有兩處已知的同族缺口，`docs/launch-todo.md` 記著 `⟦front-FEATUREDRAILGENERALPRICE⟧`（Sean 拍 B 先不修，理由就是等子網域）：`fetchFeaturedProducts()`（`apps/storefront/src/lib/products.ts:399`）釘死一般價，首頁精選與會員中心推薦兩處對經銷會員顯示牌價。

⇒ 這些要排成片 5b，時間 45 分：經銷模式下，搜尋疊層與相關商品要嘛改成取經銷價，要嘛不顯示價格（顯示「登入查看價格」之類）。**建議不顯示價格**——改成取經銷價要多開兩條取價路徑，而不顯示價格是刪東西，零新增路徑。這一題的選擇列進第 8 節 Q6。

---

## 5. 一般站要不要保留經銷價邏輯

**建議：全部移除**，讓一般站在結構上不可能出現經銷價。這也正是 Sean 2026-09-08 選子網域的理由——他自己寫的那張對照表裡，子網域那一欄逐字是「結構上不可能」。

### 要移除的程式路徑

| 檔案:行號 | 內容 |
|---|---|
| `apps/storefront/src/lib/products.ts:861-878` | 目錄頁 `tier === 'store'` 走經銷 RPC 的整段分支 |
| `apps/storefront/src/app/products/(catalog)/page.tsx:45,436` | 目錄頁取 tier |
| `apps/storefront/src/app/brands/[slug]/page.tsx:44,178` | 品牌頁取 tier |
| `apps/storefront/src/app/products/[slug]/page.tsx:33,123-190` | 商品頁疊 `dealerPrice` 的整段 |
| `apps/storefront/src/components/ProductInfo.tsx:175-195,379,418` | 顯示層選經銷價 |
| `apps/storefront/src/components/ProductPage.tsx:145-160,383` | 同上 |
| `apps/storefront/src/components/products-filter-logic.ts:183-211` | 經銷價參與篩選與排序 |
| `apps/storefront/src/app/cart/actions.ts:30,32,255,286-300` | 購物車與結帳改用經銷價 |
| `apps/storefront/src/lib/tier-prices.ts` | 整支只服務經銷價，一般站不需要 |

`apps/storefront/src/lib/tier.ts` **保留**：首頁還在用 `resolveTierFromRequest()`（`app/page.tsx:38,105`），而且經銷站那邊要用它做進站判斷。

### 風險：這一步不能單獨做

移除之後，一般站畫面顯示的是牌價，**但資料庫那支 `create_order` 仍然會依 `customers.tier` 收經銷價**：`supabase/migrations/20260915100000_m4b_couponfield_p_d_create_order_redeem_dryrun.sql:377` 逐字 `v_unit_price := coalesce(v_variant.price_store, v_variant.price_general)`。

⇒ 經銷商如果在一般站下單，會變成**畫面上是一件事、實際收的是另一件事**。這是金額不一致，不能留。

（順帶訂正一則舊記憶：`project_0909-dealer-price-whole-package-after-launch` 寫「結帳收一般價」，那是 09-09 的狀態。09-07 的 migration `20260907040000` 已經改成收經銷價，並且一路帶到 09-15 那一代。那一格現在是對的。）

所以第 5 節與第 8 節第一題綁在一起：

- 若 Sean 決定**經銷商不能在一般站下單**：移除顯示邏輯的同一片，要在一般站的購物車與結帳加一道「這個帳號請到經銷站下單」的擋下（改 `app/cart/actions.ts`），畫面與收款就一致。
- 若 Sean 決定**經銷商可以在一般站下單、而且照牌價**：那要改的是資料庫那支 `create_order`，屬於金流函式，要另外一份 plan 與一輪審查。
- 若 Sean 決定**經銷商可以在一般站下單、照經銷價**：那一般站就必須保留顯示邏輯，第 5 節整節不做，回到 2026-09-08 那個「每一頁都要記得」的狀態。

### 替代方案（如果不移除）

保留現狀，靠 `apps/storefront/src/lib/products.ts:861-878` 那個「經銷會員整條繞過快取」的做法擋快取混用。它今天是對的，代價是每加一個會顯示價格的新頁面，就多一次漏掉的機會——而顧客站已經有一個漏掉的例子：`fetchFeaturedProducts()`（`apps/storefront/src/lib/products.ts:399`）釘死一般價，首頁精選與會員中心推薦兩處對經銷會員顯示的是牌價（`docs/launch-todo.md` 記著 `⟦front-FEATUREDRAILGENERALPRICE⟧`，Sean 拍 B 先不修，理由就是等子網域）。

---

## 6. 分幾片、多久、順序（⛔ 前台片以「第四版」C 節為準；片 1–3、7、7b、8、A–D2 不變，片 1b 改列為片 7 的前置）

每片 15-45 分鐘（鐵則 4）。**片 1 到片 3 是資料修復，與子網域無關，可以先做、先驗收。**

| 片 | 內容 | 時間 | 需要 Sean 做什麼 |
|---|---|---|---|
| 1 | 正式庫唯讀複量第 4.3 節那三組數 | 20 分 | 無（唯讀） |
| 1b | **如果經銷價還沒灌**：照 `docs/runbooks/dealer-price-first-load.md` 走那五道門 | 另計 | **門 4 要 Sean 說「灌」這個字** |
| 2 | 若 4.3 ② 不是 0：查那幾筆的根因、寫進報告 | 30 分 | 可能要拍板怎麼處理 |
| 3 | 寫 `products_list_dealer` 改讀 `price_by_tier->store` 的 migration + rollback + 測試（含先餵一發該紅的） | 45 分 | **要 Sean 批准後才貼正式庫**（鐵則 8） |
| 4 | 新增 `lib/site-mode.ts`（一個環境變數、一個函式），根 layout 依模式分流 | 30 分 | 無 |
| 5 | 三種進站畫面與文案（第 3 節） | 45 分 | 文案要 Sean 看過 |
| 5b | 經銷站上的搜尋疊層與相關商品不再顯示牌價（第 4.5 節）；購物車與結帳 server action 在經銷模式擋下非經銷帳號 | 45 分 | 要先答 Q6 |
| 5c | 經銷站首頁（第 3 節，2026-09-25 Sean 新需求）：任何人可進；非經銷商看最新商品但不顯示價格、放「登入看經銷價」；經銷商看經銷價 | 45 分 | 文案要 Sean 看過 |
| 6 | 經銷站不被收錄：`lib/seo.ts`、`app/sitemap.ts`、`app/layout.tsx` metadata 三處 | 30 分 | 無 |
| 7 | Vercel 開第二個專案、掛網域、設環境變數；順便確認新專案的防火牆規則（Vercel 防火牆是專案設定、不在 repo，新專案一開是空的） | — | **只有 Sean 做得到**（Vercel 後台） |
| 7b | Supabase 後台 Redirect URLs 加 b2b；若保留 LINE 登入，LINE 後台加 Callback URL；確認 TapPay 商戶端有沒有回呼網址白名單要登記 | — | **只有 Sean 做得到** |
| 8 | Sean 自己開瀏覽器走一遍：一般帳號進 b2b、經銷帳號進 b2b 從目錄走到結帳 | — | **只有 Sean 做得到**（做完的定義） |
| 9 | 一般站移除經銷價邏輯（第 5 節），連同購物車擋下 | 45 分 × 2 片 | 照第 8 節第 1 條 |

**申請表單流程（第 9 節，Sean 2026-09-23 加的）**：

| 片 | 內容 | 時間 | 需要 Sean 做什麼 |
|---|---|---|---|
| A | `dealer_applications` 建表 migration：欄位、五道 CHECK、部分唯一索引、RLS 三條 policy、REVOKE + 三組欄級 GRANT（9.3）+ rollback + 先餵一發該紅的 | 45 分 | **要 Sean 批准後才貼正式庫**（鐵則 8 + 12，碰權限） |
| B | 申請表頁 `/dealer-apply`：八個欄位、送出的 server action、統編格式檢查、重複送出（資料庫回 23505）對應成「您已經有一筆申請在審核中」 | 45 分 | 無 |
| B2 | 修改申請資料：編輯表單 + 更新 server action（只在審核中出現） | 45 分 | 無 |
| C | 四種狀態畫面（還沒申請／審核中／已核准／已婉拒）與三個入口的文案，含經銷站那兩頁的按鈕連動 | 45 分 | 文案要 Sean 看過，含「1 至 2 個工作天」這句承諾 |
| D1 | 後台 `/customers/dealer-applications` 列表 + 明細頁；側欄待處理件數（要動 `apps/admin/src/components/layout/nav-items.ts` 那一族） | 45 分 | 無 |
| D2 | 核准 / 婉拒兩顆按鈕：接 `setCustomerTier`（不是 `setTierAction`，見 9.5）、確認視窗、兩段寫入的順序與重按收斂、那一發會紅的測試 | 45 分 | 無 |

**時間**（上一版這三個數我全部加錯，審查抓到，已重算）：

- 子網域那批（片 1、2、3、4、5、5b、6、9）：20+30+45+30+45+45+30+90 = **335 分 ≈ 5 小時 35 分**
- 申請表單這批（片 A 到 D2）：45+45+45+45+45+45 = **270 分 ≈ 4 小時 30 分**
- **合計約 10 小時 05 分**，另加片 1b 的灌價流程與片 7、7b、8 由 Sean 操作的時間。**比 Sean 加申請表單之前多了 6 片、多 4 小時 30 分。**

**要 Sean 貼 migration 的有兩片**：片 3（改經銷目錄 view）、片 A（建申請表與權限）。寄信那一片已經從本計畫拿掉（9.6），所以不是三片。片 1b 要動 GitHub secret 與寫入正式庫商品價；片 7 與 7b 要改 Vercel、Supabase、LINE、TapPay 的後台設定。其餘各片不碰正式庫、不碰設定。

順序理由：片 1-3 修的是「經銷功能現在是壞的」，不修的話片 7 上線的經銷站在目錄頁還是顯示一般價。片 5b 要在片 8 之前，否則 Sean 走一遍時會看到同一個站兩種價。片 9 排最後，因為它要先確定經銷商真的能在 b2b 買完東西，才敢把一般站那條路拆掉。

**申請表單那批要排在片 7（網域上線）之後**：入口之一在經銷站的未登入頁與「沒有資格」那一頁，站還沒上線就沒有地方掛。片 A 到 D2 可以先寫先測，片 C 的入口接線等站上線再開。

貼板與推碼的順序（CLAUDE.md〈Git〉那條）：片 3 的 migration 與片 3 的測試要在**同一顆 commit**，板先貼、碼才合進 dev。這支改的是既有 view 不是新函式，部署時序閘只擋新函式與新 view，**擋不到這一支**，所以順序要人工顧。

---

## 7. 出事怎麼退回

| 出了什麼事 | 怎麼退回 | 可逆嗎 |
|---|---|---|
| 片 3 貼上去之後目錄頁價格不對 | 跑 rollback SQL，把 view 定義換回 `coalesce(pr.price_store, v.price_general)`。那一欄永遠 NULL，所以退回之後就是今天的行為 | 可逆，秒級 |
| 片 3 讓那 5 筆（或複量後的筆數）錯價見客 | 同上，退回 view。錯價來源在同步資料，不是 view | 可逆 |
| 經銷站 build 壞掉、環境變數打錯 | 一般站完全不受影響，兩個 Vercel 專案各自獨立部署。把 `b2b.pcmmotorsports.com` 從新專案拿掉即可 | 可逆 |
| 進站閘誤擋真的經銷商 | 經銷站那一頁有「前往 www.pcmmotorsports.com」按鈕，他還是買得到東西（照牌價）。**退回方式是在 Vercel 把 `b2b.pcmmotorsports.com` 從專案拿掉**，不是回滾片 4 那一顆——片 4 與片 5、5b 若分顆，只回滾一顆會留下一個沒有閘的經銷站 | 可逆 |
| 片 1b 灌了經銷價之後發現價格錯 | `dealer-price-first-load.md` 門 5 要求**先取 pre-image 再 dispatch**，落點在 repo 外。照那份 runbook 用 pre-image 還原 | 可逆，但**前提是門 5 有做** |
| 走了路 B（共用 cookie）之後一批客人登入壞掉 | **這一格最難退**：cookie 已經寫進客人的瀏覽器，程式回滾不會刪掉它。要另外做一支清舊 cookie 的路徑。這也是建議走路 A 的原因 | **不好退** |
| 片 9 移除之後才發現經銷商需要在一般站買東西 | `git revert` 那幾顆 commit。程式碼還在 git 裡，沒有資料損失 | 可逆 |
| 片 A 的申請表建壞了 | `DROP TABLE public.dealer_applications`（連帶索引與 GRANT 一起消失）。它是新表、沒有別的東西 FK 指向它，也不在任何金流路徑上 | 可逆。**但已經送出的申請會一起沒有** ⇒ 上線之後要退回就不能用 DROP，要改成把入口先拿掉 |
| 核准按下去、等級改了，才發現核准錯人 | 後台既有的改等級那條路把他**改回稽核紀錄裡的原等級**（不可以預設「改回一般會員」——他原本可能就是車行），再把那筆申請改回審核中 | 可逆。本計畫不寄核准信（9.6），所以沒有「信已經寄出去收不回來」這一格 |
| （原本這裡有一列「片 E 寄信白名單放寬之後想收回」） | 已刪除：寄信整包移出本計畫（9.6）。⚠️ 而那一列原本寫的 rollback 是**錯的且危險的**——它說「把 `event_type` 的 CHECK 改回兩種」，而現役白名單是**九種**（`20260915150000:121-131`），真照著貼會讓取消信、匯款信、出貨信等七種信全部寫不進去。留這一句是要讓下一個想做寄信的人先撞到它 | — |

所有不可逆的動作（貼 migration、改 Vercel 網域、改 Supabase 設定）都排在各自那一片的最後，而且要 Sean 批准。

---

## 8. Sean 已經決定的事（2026-09-23）

Sean 看過這份計畫，六題答「依照推薦」，**只有第 3 題他改了**，逐字：

> 還是要有申請表單流程頁面出現，感覺專業一點

所以下面第 3 條是照他的意思重寫的，其餘五條照原建議寫定，不再是問題。

| # | 決定 |
|---|---|
| 1 | **經銷商不能在一般站（www）下單。** 一般站的購物車與結帳偵測到經銷帳號就擋下，請他到 b2b 下單。一般站完全移除經銷價邏輯（第 5 節），結構上不可能出現經銷價 |
| 2 | **登入狀態不跨站共用。** 同一組帳號、同一組密碼，經銷商在 b2b 自己登入一次。不改 cookie domain（第 2.4 節路 A） |
| 3 | **要做經銷商申請表單流程頁面**（見第 9 節）。不是原建議的「只由員工在後台標」 |
| 4 | **經銷站沿用滿 NT$ 5,000 免運。** 運費怎麼算稅 2026-09-07 已拍過（經銷單運費當未稅進稅基，100 變 105，`project_0907-sean-rulings-qb1-qb3-freight`） |
| 5 | **經銷站身分查不到時要擋**，顯示「目前無法確認您的經銷資格，請重新整理」，不顯示任何商品。這是 2026-09-08「查不到給牌價」那條拍板在經銷站上的例外 |
| 6 | **經銷站的搜尋疊層與「相關商品」不顯示價格**，只留商品名稱與圖片（第 4.5 節） |

**2026-09-24 補：身分查不到時，兩個站各自怎麼做（Sean 說「不要問我，依推薦」，選甲）**

- **一般站（www）維持現狀**：照 2026-09-08 拍板「查不到給牌價」（`project_0908-tier-lookup-failure-shows-general`，`apps/storefront/src/lib/tier.ts` 查不到回 `general`）。代價是：經銷商在一般站遇到會員等級查不到時，畫面顯示一般價，結帳收的卻是經銷價。這件事在第 5 節「經銷商不能在一般站下單」做完後就會消失；在那之前，經銷會員是 0 人。
- **經銷站（b2b）照上表第 5 條**：查不到就擋，不顯示任何商品與價格。
- 背景：`cac121efb`（經銷價修正計畫 3.6）已把「查到身分、但沒取到經銷價」改成顯示「價格暫時無法取得」。Codex 審查指出「查不到身分」這一條不在那一片範圍內，所以在這裡定案。

之前就拍過、本計畫沿用的：經銷價顯示未稅且不標「未稅」、刷卡 +5%、匯款不加稅（`project_0906-dealer-price-display-tax-by-payment-method`）；發票是手寫紙本不串平台（`project_0913-invoice-handwritten-paper-no-platform`）；統編前台不開、客人講員工後台填（`project_0914-tax-id-frontend-stays-hidden`）。

### 還有兩件要 Sean 決定，做不下去的

**Q7　核准之後，帳號要變成哪一級？**

後台的會員等級有三個：`會員` / `車行` / `經銷`（`apps/admin/src/lib/customers/customer-list-view.ts:118-122`，Sean 2026-09-13 自己改的名字）。而顧客站**只有「車行」拿得到經銷價**——`apps/storefront/src/lib/tier-prices.ts` 那道邊界逐字只認 `tier === 'store'`，「經銷」那一級在前台走不到經銷價那條路。

⇒ 問題是：功能叫「經銷商申請」，核准之後卻要把人標成「車行」，名字對不上。

- **甲（建議）**：核准給「車行」。**這是今天唯一真的能看到經銷價的等級**，改 0 行取價程式。「經銷」那一級先留著不動。
- 乙：核准給「經銷」。那要先把顧客站的取價路徑打開給這一級，等於多一批改動，而且碰的是金額顯示。
- 丙：兩級都能核准，員工在後台自己選。最有彈性，但員工要知道兩者差在哪，而今天差別是「一個看得到經銷價、一個看不到」——那不是一個好解釋的差別。

**Q8　核准之後要不要寄一封通知信？**

第 9.6 節查下去發現這件事比想像中貴很多：寄信佇列那張表**每一列都必須綁一張訂單**（`20260717020000:300` 逐字 `order_id uuid NOT NULL REFERENCES public.orders(id)`），而核准信沒有訂單。

- **甲（建議）**：這一包先不寄。客人送出後畫面就寫著「申請已送出」，之後回到同一個網址看得到狀態；員工核准後本來就會打電話。
- 乙：要寄。那要另外一份計畫（碰寄信佇列那張表的必填欄位、寄送程式的窮舉表與測試），**不是 45 分鐘的工**，時間要另外排。

---

⚠️ **第 4 條與第 3 條之間有一個要注意的地方**：統編那條拍板講的是「**結帳時**的發票統編前台不開」。經銷商申請表單要填統編，那是**申請資料**不是發票資料，兩件事不衝突——申請表上的統編不會自動變成任何一張訂單的發票抬頭。第 9.2 節有寫進欄位說明。

---

## 9. 經銷商申請表單流程

### 9.1 整條路長什麼樣

```
客人（已登入的一般帳號）
  → 看到「申請成為經銷商」入口
  → 填申請表 → 送出
  → 畫面顯示「審核中」，同一個網址隨時回來看得到狀態
員工
  → 後台「經銷商申請」看到待處理件數
  → 打開一筆 → 核准 或 婉拒
核准 ⇒ 客人的帳號等級變成經銷商 + 寄一封「經銷資格已開通」
婉拒 ⇒ 申請標成未通過、記下原因；不自動寄信，由員工電話聯絡
```

🔴 **一定要先登入才能申請。** 這是整個設計裡最省事也最安全的一格：

- 核准就是「把**這個帳號**變成經銷商」，不登入的話系統不知道要核准誰，員工還要手動比對 Email 找人。
- 不登入的表單是垃圾訊息磁鐵，而後台那份清單會被灌爆。
- 客人要回來看進度，靠登入就好，不用發「申請查詢碼」這種東西。

⇒ 未登入的人點申請入口 ⇒ 先導去註冊／登入，登入後自動回到申請表（沿用現有的 `next` 參數機制）。

### 9.2 表單要填什麼

一頁到底，不分步驟。欄位刻意只有八格——**每多一格就多一個客人填不出來而放棄的理由**，而缺的資料員工打電話問得到。

| 欄位 | 必填 | 為什麼要這一格 |
|---|---|---|
| 公司或商號名稱 | 是 | 經銷是對公司給價，不是對個人。這是員工判斷「這是不是一家真的店」的第一個依據 |
| 統一編號 | 是 | 唯一能驗證「這家店真的存在」的欄位，也是日後開發票的抬頭來源。**這是申請資料，不是結帳時的發票欄位**，與 `project_0914-tax-id-frontend-stays-hidden` 不衝突 |
| 店名（門市招牌名稱） | 否 | 很多車行的公司登記名與招牌名不同，員工認得的是招牌名 |
| 營業地區 | 是 | 下拉選單（縣市）。Sean 判斷要不要再收一家經銷時，同一個地區已經有幾家是關鍵 |
| 聯絡人姓名 | 是 | 員工要打給誰 |
| 聯絡電話 | 是 | 主要聯絡方式。車行多半打電話不看信 |
| 聯絡 Email | 是 | 預設帶入登入帳號的 Email、可改。**業務窗口常常不是註冊那個人**（老闆註冊、會計收信） |
| 主要銷售品牌或需求說明 | 否 | 自由文字，上限 500 字。員工判斷「這家店賣什麼」用，也讓客人有地方講他真正想問的事 |

**刻意不做的**：不收營業登記證上傳（多一條檔案儲存路徑與一份要保管的個資，而員工本來就會自己查統編）、不收地址（核准後下單時才要，那時收件地址流程已經在了）、不做分步驟精靈（八格不需要）。

### 9.3 資料放哪裡

一張新表 `dealer_applications`，不動 `customers`：

```sql
CREATE TABLE public.dealer_applications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🔴 DEFAULT auth.uid() + 不給客人 INSERT 這一欄 ⇒ 填不了別人的帳號(見下面權限段)
  user_id        uuid NOT NULL DEFAULT auth.uid()
                 REFERENCES public.customers(user_id) ON DELETE CASCADE,
  company_name   text NOT NULL,
  tax_id         text NOT NULL,
  store_name     text NOT NULL DEFAULT '',
  region         text NOT NULL,
  contact_name   text NOT NULL,
  contact_phone  text NOT NULL,
  contact_email  text NOT NULL,
  note           text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'pending',
  decided_by     text,
  decided_at     timestamptz,
  decide_note    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealer_app_status_check    CHECK (status IN ('pending','approved','rejected')),
  -- 只驗 8 碼數字、不驗檢查碼。沿用後台既有的決定:
  -- apps/admin/src/lib/orders/invoice-title-lookup.ts:26 逐字「不驗檢查碼,驗錯了會擋掉合法統編」
  CONSTRAINT dealer_app_tax_id_format   CHECK (tax_id ~ '^[0-9]{8}$'),
  CONSTRAINT dealer_app_decided_at_pairing CHECK (
    (status = 'pending') = (decided_at IS NULL)
  ),
  -- 🔴 兩個欄位【各綁一道】。只綁 decided_at 的話,
  --    「已核准而不知道是誰核准的」那種列照樣進得來,而它在畫面上完全正常。
  CONSTRAINT dealer_app_decided_by_pairing CHECK (
    (status = 'pending') = (decided_by IS NULL)
  ),
  CONSTRAINT dealer_app_reject_has_note CHECK (
    status <> 'rejected' OR decide_note <> ''
  )
);

-- 一個帳號同時只能有一筆審核中的申請
CREATE UNIQUE INDEX dealer_applications_one_pending
  ON public.dealer_applications (user_id) WHERE status = 'pending';
```

幾個刻意的選擇：

- **`decided_pairing` 那道 CHECK** 綁住「還在審核中就不該有決定時間」。少了它，一筆 `pending` 卻帶著 `decided_at` 的列在畫面上會長得完全正常。
- **部分唯一索引**擋重複送出。⚠️ 如果之後有人要用 `ON CONFLICT` 接這個索引，仲裁子句必須帶一模一樣的 `WHERE status = 'pending'`（`reference_partial-unique-needs-matching-where-in-on-conflict`）。
- **婉拒必填原因**：員工三個月後回頭看才知道當初為什麼不收。這個原因**只給員工看**，不寄給客人。
- **不加 `tier` 欄位**。核准要改的是 `customers.tier`，而那條路已經有了（見 9.5），不要在這張表裡再存一份會跟它分岔的東西。

**權限要照 `customers` 那一支的形狀寫**（`supabase/migrations/20260523034911_init_customers_and_subtables.sql:229-231` 與 `:170-172`），不是「欄級 GRANT 排除」那種講法——Postgres 沒有「排除」這個動作，要先整組收回再逐欄給：

```sql
ALTER TABLE public.dealer_applications ENABLE ROW LEVEL SECURITY;

-- 🔴 先 REVOKE 再 GRANT。Supabase 對 public schema 的新表有預設授權,
--    少了這一行,下面的欄位清單擋不住任何東西。
REVOKE ALL PRIVILEGES ON TABLE public.dealer_applications FROM anon, authenticated;

-- 讀:只給客人看得到的欄。decided_by 與 decide_note 【不給】——
--    婉拒原因是員工內部判斷,畫面不印不等於讀不到。
GRANT SELECT (id, user_id, company_name, tax_id, store_name, region,
              contact_name, contact_phone, contact_email, note,
              status, decided_at, created_at, updated_at)
  ON TABLE public.dealer_applications TO authenticated;

-- 寫:user_id 不給,由 DEFAULT auth.uid() 填 ⇒ 客人填不了別人的
GRANT INSERT (company_name, tax_id, store_name, region,
              contact_name, contact_phone, contact_email, note)
  ON TABLE public.dealer_applications TO authenticated;
GRANT UPDATE (company_name, tax_id, store_name, region,
              contact_name, contact_phone, contact_email, note, updated_at)
  ON TABLE public.dealer_applications TO authenticated;

CREATE POLICY dealer_app_select_own ON public.dealer_applications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY dealer_app_insert_own ON public.dealer_applications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
-- 🔴 USING 帶 status = 'pending':決定過的紀錄客人不能再改。
--    少了它,被婉拒的人可以回頭把公司名稱與統編改掉,而那筆紀錄看起來完全正常。
CREATE POLICY dealer_app_update_own_pending ON public.dealer_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');
```

`user_id` 那一欄的 DDL 要跟著改成 `uuid NOT NULL DEFAULT auth.uid() REFERENCES ...`。員工端走 `service_role`（Supabase 預設全開，不用顯式 GRANT）。

🔴 **四個洞都是審查抓到的，每一個都會讓客人做到他不該做的事**：沒有 REVOKE ⇒ 欄位清單形同虛設；沒有 INSERT policy ⇒ 客人可以替別人送申請；UPDATE 沒綁 `status = 'pending'` ⇒ 決定過的紀錄可被事後竄改；`decide_note` 給了 SELECT ⇒ 客人讀得到婉拒原因。

### 9.4 客人看到什麼（文案）

照 `docs/patterns/admin-copy-style.md`：狀態說事實、按鈕說動作、提示說明問題與下一步。

**入口出現在三個地方**，都連到 `/dealer-apply`：

1. 一般站（www）頁尾：`經銷商申請`
2. 經銷站未登入頁，登入按鈕下面：`還不是經銷商？提出申請`
3. 經銷站上一般帳號看到的那頁（第 3 節），按鈕換成：`提出經銷商申請` / `前往 www.pcmmotorsports.com` / `登出`

**申請表頁（還沒申請過）**

> 標題：申請成為 PCM 經銷商
> 說明：填寫以下資料後我們會與您聯絡確認。通過後您的帳號就能登入經銷商專區，看到經銷價格並直接下單。
> 送出按鈕：送出經銷商申請

**送出成功後（同一個網址，之後回來也是這一頁）**

> 標題：申請已送出
> 說明：我們已收到您的申請，PCM 業務會在 1 至 2 個工作天與您聯絡。審核結果也可以隨時回到這個頁面查看。
> 附註：申請日期 2026-09-23｜公司名稱 〇〇車業
> 按鈕：修改申請資料

「修改申請資料」只有在**審核中**才出現，而且它要一張編輯表單與一支更新用的 server action（資料庫那邊的 UPDATE policy 已經綁死 `status = 'pending'`，見 9.3）。已核准或已婉拒之後這顆按鈕不出現。

「1 至 2 個工作天」要 Sean 確認這個承諾寫得出來；寫不出來就改成「我們會盡快與您聯絡」，**不要寫一個做不到的天數**。

**已核准**

> 標題：您的經銷商資格已開通
> 說明：您現在可以到經銷商專區登入，查看經銷價格並下單。
> 按鈕：前往 b2b.pcmmotorsports.com

**已婉拒**

> 標題：這次的申請未通過
> 說明：這次沒有通過審核。如果情況有變動或想了解原因，請與 PCM 業務聯絡。
> 按鈕：重新提出申請

🔴 **婉拒的原因不印在客人畫面上。** 員工寫的原因是內部判斷（例如「同地區已有經銷商」「查不到這個統編」），直接印出來容易得罪人，而且有些理由本來就不該對外。客人看到的是一句中性的說明加一個聯絡方式。**這不是隱瞞，是把解釋交給打電話的那個人。**

### 9.5 員工在後台看到什麼

**位置**：後台側欄「客戶」底下新增一條「經銷商申請」，路徑 `/customers/dealer-applications`。放在客戶底下的理由是它處理的就是客戶資料，員工不用學新地方。

側欄那條連結旁邊顯示待處理件數（例如「經銷商申請 3」）——**這是唯一會提醒員工「有人在等」的東西**，所以它不能省。

**列表**：申請日期、公司名稱、統編、營業地區、聯絡人、狀態。預設只看「審核中」。

**明細頁**：八個欄位全部顯示，加上這個帳號現在的等級與註冊日期，再加兩顆按鈕：

> 按鈕一：核准並開通經銷資格
> 按鈕二：婉拒這筆申請（需要填原因）

**核准按下去會發生什麼**

> 確認視窗標題：要核准這筆申請嗎？
> 內容：〇〇車業（王小明）的帳號等級會從「〔現在的等級〕」變成「〔要改成的等級〕」，之後這個帳號在經銷商專區看到的會是經銷價格。
> 按鈕：確認核准

⚠️ **「現在的等級」要印實際現值，不可以寫死成「一般會員」。** 後台的三個名稱是 `會員` / `車行` / `經銷`（`apps/admin/src/lib/customers/customer-list-view.ts:118-122`，Sean 2026-09-13 改的），「一般會員」是已經廢掉的舊標籤。而且這個帳號如果已經是車行或經銷，核准鈕要停用並說明原因——不然核准一個已經是經銷的帳號會把他降級。

**核准怎麼接既有的改等級那條路**——我第一版寫「呼叫 `setTierAction`」，**那是錯的**，審查開檔抓到：

- `setTierAction(formData: FormData): Promise<void>`（`apps/admin/src/lib/customers/tier-actions.ts:31`）結尾一律 `redirect(...)`，而 `redirect` 是用拋例外實作的 ⇒ **從核准 action 裡呼叫它，後面「把申請標成 approved」那一行永遠不會執行**。
- 它還要 `TIER_FROM_FIELD` 與變更原因兩個表單欄位，我沒寫怎麼給。

✅ **真正可以重用的是下面那一層**：`setCustomerTier()`（`apps/admin/src/lib/customers/customer-repository.ts:140`），它包的就是 `setTierAction` 在用的同一支 `admin_set_customer_tier` RPC，參數是具名物件（`customerId` / `tier` / `from` / `note` / `actor` / `requestId`），**沒有 redirect**。

⇒ 所以核准是**一條新的、會改會員等級的後台路徑**，它自己要過 `authorizeAdminMutation()`。**這命中鐵則 12 的權限類**，我第一版寫「少寫一條碰會員等級的路徑」是講錯了，已訂正。重用 `setCustomerTier` 換到的是：等級變更的稽核紀錄與員工手動改的長得一樣、「從 X 變成 Y」那道防呆（現值不同就回 `STALE` 零寫入）自動沿用。變更原因填「經銷商申請核准 #〔申請編號〕」。

🔴 **兩個寫入不在同一個交易裡**（改等級走 RPC、標記申請走 UPDATE），中間失敗會留下「等級已經改了、申請還是審核中」。處置寫死：

1. **先叫 RPC 改等級，成功了才 UPDATE 申請列。** 順序反過來的話，會留下「申請寫著已核准、而他其實進不去經銷站」——那一種客人會打電話來，而員工看畫面看不出問題。
2. RPC 同值會回 `NO_CHANGE`（冪等），所以**核准鈕在申請仍是審核中的時候要能再按一次**，第二次按只會補做 UPDATE 那一半。
3. 這一格要留一發會紅的測試：模擬 UPDATE 失敗，斷言等級已改而申請仍是 pending，且再按一次核准會收斂。**落筆前先餵一發該紅的。**

**成功提示**（說已經發生的事，不宣稱還沒發生的）：

> 已核准，帳號等級已改為〔新等級〕。

**婉拒**：

> 確認視窗：要婉拒這筆申請嗎？
> 內容：請填寫原因（只有員工看得到，不會寄給客戶，也不會顯示在客戶畫面上）。客戶畫面上會顯示「這次的申請未通過」，並請他與業務聯絡。
> 成功提示：已婉拒。

### 9.6 寄信：第一版不寄，而且它要自己一份計畫

我第一版寫「加一種 `dealer_application_approved`、一支 migration、一個模板、45 分鐘」。**審查開檔把這個估算打掉了，兩個事實我都複核過**：

1. **`email_outbox` 每一列都必須綁一張訂單。** `supabase/migrations/20260717020000_m4a_email_outbox.sql:300` 逐字 `order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT`。**經銷核准信沒有訂單** ⇒ 它根本寫不進這張表。要讓它寫得進去，就得把一張金流表的 NOT NULL 拿掉。
2. **`event_type` 的白名單今天不是兩種，是九種**（第 8 代，`supabase/migrations/20260915150000_m4b_partially_cancelled_email_pending.sql:121-131`）。我引的 `20260717020000:315` 是第 1 代，已經過期。

而加一種信要同時碰的東西遠不只 CHECK：`EmailOutboxEventType` 那個手抄的 union（`packages/ports/src/IEmailOutbox.ts:181`）、同檔的 `SUPPRESS_WHEN_ORDER_INELIGIBLE` 窮舉表、寄送程式的 `switch` 與 `satisfies never`（`packages/use-cases/src/sweep-email-outbox.ts`）、去重鍵規則、模板、還有一支專門比對「union 與資料庫白名單一不一致」的測試。**而現行排信的方式是寄送程式自己去掃訂單 view，核准信沒有訂單 view 可掃，觸發方式要另外設計。**

⇒ **建議：這一包不做寄信。** 理由不是偷懶，是這條路的每一格都指向同一件事——那張表是為「訂單信」長的，而這封不是訂單信。

**不寄信，整條流程仍然走得完**：客人送出後畫面就寫著「申請已送出」，之後回到同一個網址看得到狀態（9.4 的四種畫面）；而 9.2 自己寫過「車行多半打電話不看信」，核准之後員工本來就會打電話講。

⇒ 片 E 從本計畫拿掉。要做的話另開一份計畫，命中鐵則 12（寄信）與鐵則 8（碰 `email_outbox` 這張金流相關的表），而且**不是 45 分鐘的工**。

⚠️ **這一格要 Sean 點頭**：他說要「感覺專業一點」，而我判斷專業感來自那一整條有入口、有表單、有狀態頁、有後台審核的流程，不是那一封信。他如果認為核准信是必要的，那就是另外一份計畫、另外排時間。

### 9.7 申請表單頁：頁面細節（2026-09-24 補）

9.2 定了「收什麼」，9.4 定了「四種狀態各說什麼」。這一節補「頁面本身怎麼運作」，讓片 B、B2、C 照著寫就不用再猜。

#### 網址與所在的站

- 網址 `/dealer-apply`。**一般站與經銷站都有這一頁**（同一份程式碼，第 2.1 節），入口分別在 www 頁尾與 b2b 那兩頁。
- 未登入打開 ⇒ 導到 `/login?next=/dealer-apply`，登入後回到這一頁（沿用 `apps/storefront/src/app/login/page.tsx:30` 既有的 `next` 參數）。
- 這一頁**不顯示任何商品與價格**，所以不需要走第 2.5 節的經銷閘，也不受快取問題影響。頁面要設成每次請求都重新讀（不快取），否則送出後回來看到的可能是舊狀態。

#### 版面

- `design-reference/` 裡**沒有這一頁的稿**（2026-09-24 grep「申請」「dealer」只命中退貨說明與經銷價標籤）。依鐵則 1，不自己畫新樣式：**表單外觀照會員中心的表單**（`design-reference/components/AccountPages.jsx` 的欄位、標籤、按鈕樣式）。
- 一欄到底。手機寬 390px 不可以出現橫向捲動；統編與電話輸入框要叫出數字鍵盤（`inputMode="numeric"`／`type="tel"`）。
- 頁首是 9.4 的標題與說明，下面是八個欄位，最下面一顆送出按鈕。必填欄位標籤後面加「（必填）」，不用紅色星號。

#### 開頁時先決定顯示哪一種畫面

依序判斷，命中就停：

| 順序 | 條件 | 顯示 |
|---|---|---|
| 1 | 帳號等級已經是能看經銷價的那一級（依 Q7 的答案） | 9.4「已開通」，不管有沒有申請紀錄 |
| 2 | 有一筆審核中的申請 | 9.4「申請已送出」＋「修改申請資料」 |
| 3 | 最新一筆是已核准，但帳號等級不是經銷那一級 | 「已開通」**不能顯示**。這代表 9.5 那兩段寫入之間出過錯，或員工事後把等級改回去。顯示：「您的申請已核准，但帳號資格尚未生效，請與 PCM 業務聯絡。」 |
| 4 | 最新一筆是已婉拒 | 9.4「這次的申請未通過」＋「重新提出申請」 |
| 5 | 沒有任何申請 | 空白表單 |
| — | 讀申請紀錄失敗 | 「申請資料載入失敗，請重新整理。若仍無法載入，請聯絡 PCM 業務。」**不可以退回顯示空白表單**，那會讓已經送過的人以為沒送出而重送 |

「重新提出申請」打開的表單**帶入上一次的資料**，客人只要改需要改的格。送出的是一筆新申請，舊的那筆留著給員工看歷史。

#### 八個欄位的輸入規則

| 欄位 | 輸入方式 | 檢查（前台與 server action 都要做） | 錯誤訊息 |
|---|---|---|---|
| 公司或商號名稱 | 文字，上限 100 字 | 去頭尾空白後不可空白 | 請填寫公司或商號名稱。 |
| 統一編號 | 文字，數字鍵盤 | 去空白後恰好 8 碼數字（與資料庫 CHECK 同一條規則，見 9.3） | 統一編號是 8 位數字，請再確認一次。 |
| 店名 | 文字，上限 100 字，選填 | 無 | — |
| 營業地區 | 下拉選單，22 個縣市，預設「請選擇」 | 必須是清單中的一個 | 請選擇營業地區。 |
| 聯絡人姓名 | 文字，上限 50 字 | 不可空白 | 請填寫聯絡人姓名。 |
| 聯絡電話 | `type="tel"` | 去掉空白、橫線、括號後是 8 到 10 碼數字（市話含區碼或手機都可以） | 請填寫可以聯絡到您的電話號碼。 |
| 聯絡 Email | `type="email"`，預設帶登入帳號的 Email | 基本 Email 格式 | Email 格式不正確，請再確認一次。 |
| 主要銷售品牌或需求說明 | 多行文字，上限 500 字，選填，旁邊顯示已輸入字數 | 超過 500 字擋下 | 需求說明最多 500 字，目前 〇〇〇 字。 |

- 縣市清單：顧客站今天**沒有**共用的縣市常數（地址是自由文字），片 B 要新增一個，22 個縣市照內政部名稱，用「臺」不用「台」。
- 錯誤訊息顯示在**那一格正下方**，送出時畫面捲到第一個有錯的欄位。**已經填好的內容不可以因為錯誤而被清掉。**
- 前台檢查只是方便；server action 要再檢查一次，因為別人可以不經過畫面直接送。資料庫還有第三道（9.3 的 CHECK 與權限）。

#### 送出時

- 按下送出後按鈕改成「送出中…」並停用，防止連按兩次。
- 成功 ⇒ 轉到同一個網址（重新整理不會再送一次），顯示 9.4「申請已送出」。
- 資料庫回「已有一筆審核中」（部分唯一索引，錯誤碼 23505）⇒ 「您已經有一筆申請在審核中，不需要重新送出。」並直接顯示那一筆的狀態。這是 9.3 已經寫的對應，這裡只定文案。
- 登入已過期 ⇒ 「登入已過期，請重新登入後再送出。您填的資料不會保存。」附一顆「重新登入」按鈕（帶 `next=/dealer-apply`）。**判斷方式**：server action 寫入前先呼叫 `getVerifiedUser()`（`apps/storefront/src/lib/auth/verified-user`），拿不到使用者就回這一句，不送到資料庫。不能等資料庫報錯再判斷：沒有登入時 `user_id DEFAULT auth.uid()` 會撞 NOT NULL（23502）或權限規則（42501），落到下面「其他失敗」就會叫客人重試，而重試永遠不會成功（R1 審查）。
- 其他失敗 ⇒ 「申請送出失敗，請稍後再試一次。若仍無法送出，請直接聯絡 PCM 業務。」**失敗時表單內容保留**。這裡可以叫客人重試，因為送出失敗不會留下半筆資料（單一 INSERT），而且重送最多撞到 23505，不會變成兩筆。

#### 修改申請資料（片 B2）

- 只在「審核中」出現。打開的是同一張表、帶入現值，按鈕改成「儲存修改」。
- 成功 ⇒ 「已更新申請資料。」回到狀態頁。
- 儲存時如果員工剛好審完，資料庫的 UPDATE 權限規則（9.3 `status = 'pending'`）會讓這次更新 0 筆。server action **必須檢查更新了幾筆**（supabase-js 的 `.update()` 接 `.select('id')` 看回傳幾列，或帶 `{ count: 'exact' }`；兩種都沒做就拿不到筆數，這條寫不出來），0 筆就顯示：「這筆申請已經審核完成，無法再修改。請重新整理查看結果。」不可以顯示「已更新」。

#### 會紅的測試（鐵則 13 ③，落筆前先餵一發該紅的）

1. 審核中的帳號打開頁面，**看不到空白表單**（把第 2 條判斷拿掉，這個測試要紅）。
2. 讀申請紀錄失敗時顯示錯誤訊息，**不是空白表單**。
3. 修改時資料庫更新 0 筆 ⇒ 顯示「已經審核完成」，不是「已更新」。
4. server action 收到 7 碼統編 ⇒ 擋下，不送到資料庫。
5. 送出失敗後，表單欄位的值還在。

## 審查紀錄

### R1　2026-09-23　Fable 對抗審查（`adversarial-reviewer`）

**🔴 這一輪沒有 Codex。** Codex 額度用完到 2026-09-27（`project_0911-codex-quota-fable-as-second-review`），所以鐵則 12 那一路是用 Fable 代打的，**深度不等於 Codex 那一路**。

結果：**FAIL，4 條必修。** 每一條我都自己開檔複核過才改，不是照抄審查意見。

| 編號 | 問題 | 處置 |
|---|---|---|
| M1 | 原本寫的 `::integer` 裸轉型沒有守衛。資料庫的 CHECK 只保證 key 存在、不保證值是數字，一筆 `'1,500'` 會讓整張經銷目錄查詢炸掉，而顧客站對經銷路徑刻意不退回公開查詢 ⇒ 經銷商看到整個目錄空白 | 已修。第 4.2 節改成照抄 `get_effective_prices` 的正則守，另加 `nullif(...,0)` 與幣別判斷 |
| M2 | 原本寫「變體那條路有值、是對的」，而我引用的「1 筆」出自 `20260908000000:46`，那一行的分母明寫是 **products** 不是變體。查下去發現更大的事：**真的經銷價可能從來沒有灌進網站過**（`dealer-price-first-load.md` 門 4 要 Sean 說「灌」這個字，而那顆 secret 的值讀不出來） | 已修。新增第 4.0 節把「兩個病」講開，片 1 加量變體層，片 1b 排灌價流程 |
| M3 | 原本把「`price_by_tier` 帶 store 26,642 筆」當成「有 26,642 筆經銷價」。那個數就是商品總數，因為 CHECK 逼每一列都要有那個 key；沒有真經銷價時同步程式填的是一般價或 0（`rpm-transform.ts:563`） | 已修，寫進第 4.1 節 |
| M4 | 原本寫根 layout 是「一個檔案、一個選擇點」。route handler、server action、sitemap/robots 都不經過它；而且經銷商在經銷站上，搜尋疊層與相關商品仍顯示牌價 | 已修。第 2.5 節加了射程表，新增第 4.5 節與片 5b |

審查員另外提的 7 條建議（nit）已併入：`proxy.ts` 檔名、cookie 會送到 `bikes` 子網域、後台沒用 `@supabase/ssr`、員工端下單路徑不受 Q1 影響、回滾要拿掉網域而不是回滾單顆 commit、TapPay 回呼白名單、Vercel 防火牆新專案是空的。

有一條我**沒有採納**：審查員說 `scripts/rpm-transform.ts:678` 是註解、程式在 `:679`。我 `grep -n` 核過，`:678` 就是 `price_store: dealerPriceOf(v.sku, dealerPrice),` 那一行，原文是對的。`productStoreOf()` 的行號他說得對，已從 654-660 改成 653-658。

### R2　2026-09-23　Fable 對抗審查

結果：**FAIL，1 條必修。** 已修完，但照鐵則 12「R2 還有必修 ⇒ 不跑 R3，停下端 Sean」，**到此為止，等 Sean 看過**。

**必修：第一版的 §4.2 我自己多加的兩道守衛是錯的。**

我原本在 view 的 CASE 外面包了 `nullif(...,0)`，又加了幣別判斷，理由寫成「擋 0 placeholder、擋非台幣」。審查抓出三件事，我逐條開檔複核過，三件都成立：

1. 它會讓目錄頁與商品頁、結帳對同一筆資料算出**不同的價**（`get_effective_prices` 對 `'0'` 回 0，我的 view 會退回一般價）。修一個不一致，造出一個更難發現的不一致。
2. 它與 Sean 2026-08-25「0 元是合法價格」那條拍板方向相反（`20260915100000:381-385`）。
3. 我寫的理由與程式事實不符：`rpm-transform.ts:563` 只在一般價也是 null 時才填 0，幣別那一行寫死 `TWD`，兩道守衛都擋不到任何真實資料。

⇒ §4.2 已改成**逐字照抄 `get_effective_prices:118-123`**，只留正則、`ELSE NULL`、外層 `coalesce` 退回一般價。§4.3 的探測 SQL 同步改掉。

**R2 另外提的四條建議，全部採納：**

- 「經銷價有沒有灌過」其實查得到，不必寫成未確認。我自己跑了 `gh run view 35710220221 --log`（唯讀），六家供應商每一家都印 `allowlist: (空) · 家數 0`。§4.0 已從推論改成實測，片 1b 從「如果」改成「必做」。
- §4.3 ① 的探測 SQL 原本用 `IS DISTINCT FROM`，壞資料（守衛後是 NULL）會被算成「有差價」——而那個數字正是 Sean 決定要不要灌價的依據。已改成先 `IS NOT NULL` 再比。
- Q4 的運費**已經拍過一半**：Sean 2026-09-07 逐字「經銷商在網頁都是未稅，刷卡+5% 運費就是 105」（`project_0907-sean-rulings-qb1-qb3-freight`）。原本的選項「經銷單一律免運」與那條拍板相撞，已拿掉，題目收窄成只問免運門檻。
- Q3 與 `project_0913-next-bind-identity-to-quote-login` 的關係已在題目下面講明。

行號訂正：`fetchFeaturedProducts()` 是 `products.ts:399`、`browser.ts:23`、`productStoreOf()` 是 `:653-658`；§2.5 與 §4.4 引的經銷目錄函式身分閘已換成現役那一代（`20260922130000:649`，GRANT 在 `20260916220000:1063`）。

---

### R3　2026-09-23　Fable 對抗審查（第二版新增範圍：第 1、3、6、7、8、9 節）

結果：**FAIL，7 條必修。** 每一條我都自己開檔複核過才改。

| 編號 | 問題 | 處置 |
|---|---|---|
| M1 | 我寫「寄信佇列的 `event_type` 今天只認兩種」，引的是第 1 代。**現役是九種**（`20260915150000:121-131`）。而第 7 節的回滾寫「改回兩種」，真照著貼會讓取消信、匯款信、出貨信等七種信全部寫不進去 | 已修。回滾那一列改寫成警告留痕 |
| M2 | 「一支 migration、一個模板、45 分」嚴重低估：**`email_outbox.order_id` 是 `NOT NULL REFERENCES orders(id)`**（`20260717020000:300`），核准信沒有訂單，根本寫不進那張表 | 已修。9.6 整節重寫，**寄信移出本計畫**、片 E 刪掉，改列成 Q8 端 Sean |
| M3 | 「核准就是呼叫 `setTierAction`」接不上：那支結尾一律 `redirect`（`tier-actions.ts:31` 起），從另一個 action 呼叫它，後面標記申請那一行永遠不會執行 | 已修。改接下一層的 `setCustomerTier`（`customer-repository.ts:140`），並訂正「少寫一條碰會員等級的路徑」那句錯話——它就是一條新的權限類路徑 |
| M4 | 核准無條件設成 `store`：已經是經銷的帳號會被降級；而且「經銷商申請」核准後標成「車行」名字對不上，`premiumStore` 在顧客站拿不到經銷價 | 部分已修（確認視窗印實際現值、已是車行或經銷就不能再核准）。**給哪一級是產品決定 ⇒ 列成 Q7 端 Sean** |
| M5 | 權限那段四個洞：沒有 `REVOKE`（Supabase 新表有預設授權，欄位清單形同虛設）、沒有 INSERT policy（客人可替別人送申請）、UPDATE 沒綁 `status='pending'`（決定過的紀錄可被竄改）、`decide_note` 給了 SELECT（**客人讀得到婉拒原因**，畫面不印不等於讀不到） | 已修。9.3 照 `customers` 那一支的形狀重寫（`20260523034911:229-231`、`:170-172`） |
| M6 | 文案宣稱不會發生的事：「審核結果會寄到〔聯絡 Email〕」而婉拒不寄信；「開通通知信已排入寄送佇列」而那一片要 Sean 先點頭 | 已修。兩句都拿掉，改成「隨時回到這個頁面查看」 |
| M7 | 三個時數全部加錯 | 已修。重算：5 小時 35 分 + 4 小時 30 分 = **10 小時 05 分** |

建議（consider）也採納了：`decided_by` 另加一道配對 CHECK、`ON DELETE CASCADE` 的取捨寫成有意識的選擇、漏掉的工（修改申請資料、側欄件數、23505 對應）補進分片、回滾「改回原等級」不預設 general、統編只驗 8 碼數字引既有先例（`invoice-title-lookup.ts:26`）。

### R4　2026-09-24　Fable 對抗審查（後台窗；只審檔頭更正、§4.2 作廢框、§9.7）

與 `docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md` 同一輪審查。本檔這三段**沒有必修**；兩條建議已採納：§9.7「登入已過期」改成寫入前先用 `getVerifiedUser()` 判斷，不等資料庫報錯；「修改申請資料」要用 `.update().select('id')` 才拿得到更新筆數。審查員確認 §9.7 狀態表與 §9.3 權限、部分唯一索引一致，「可以叫客人重試」那句成立。

另一條建議先記著、不在本次改：§9.3 的 UPDATE 授權含 `updated_at`，客人可以自己填任意時間；片 A 實作時可改由 trigger 寫。

### R5　2026-09-24　Fable 對抗審查（R4 的第二輪）

結果：**PASS，沒有必修**。審查員確認 `getVerifiedUser()`（`apps/storefront/src/lib/auth/verified-user.ts:37`）在寫入前判斷成立；`.update().select('id')` 在 §9.3 的權限規則下，不符合時回 0 列、不會報錯，判斷方式成立。一條措辭建議已採納（也可以用 `count: 'exact'`）。依規則第二輪通過就結束審查，實作前再送 Codex。

## 這份計畫裡哪些是我親自驗過的、哪些不是

**親自開檔核過（本機 repo 的字面）**：第 4.1 節那張三個欄位的表、第 4.2 節引用的 CHECK 與正則守、第 4.5 節三處寫死一般價、第 5 節的檔案行號清單、第 2.4 節「沒有 middleware 也沒有 proxy」與「cookie 沒有設 domain」、第 2.5 節三道資料庫身分閘、第 5 節 `create_order` 現在收經銷價（而且 `supabase/APPLIED.tsv` 顯示 `20260915100000` 已貼）、Q1 底下員工端那三條路。

**自己實跑過的**：`gh run view 35710220221 --log`（2026-09-23 唯讀），確認 2026-09-22 那一輪同步的經銷價 allowlist 是空的 ⇒「經銷價從來沒灌過」是量到的，不是推論。

**沒有親自驗的**：

- 正式庫今天的筆數（15 位會員、tier=store 0 人、`product_variants.price_store` 非空 1 筆、`price_by_tier` 帶 store 26,642 筆）是後台窗 2026-09-23 唯讀實查給的，我**沒有複量**。
- 第 4.3 節那「9 筆 / 5 筆」是 2026-09-09 的讀數，**已經 14 天，必須複量**（片 1 就是在做這件事）。
- **正式庫現在的欄位授權與 view 的 proacl 是不是仍與 migration 檔一致**，我只讀了 migration，沒有查活的庫（`reference_view-truth-is-in-the-live-db-not-the-migration`：view 的真相在活的庫，不在 migration）。片 3 貼之前要查。
- 第 2.1 節的 Vercel 專案表是 2026-09-11 的，而 `docs/handoff/CURRENT.md` 顯示網域之後變過，**開專案前要重看後台**。
- `pcm-website-v2` 專案的 Root Directory 與 Build Command 我查不到（repo 裡沒有 `.vercel/project.json`）。
- **TapPay 商戶端有沒有回呼網址白名單**要登記 b2b，我沒查（刷卡是金流，這一格不能用猜的）。
- Vercel 防火牆規則是專案設定、不在 repo，新專案一開是空的。顧客站現在有哪些規則我沒查。
