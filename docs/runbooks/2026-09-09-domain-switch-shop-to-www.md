# 換網域存活包:shop.pcmmotorsports.com → www.pcmmotorsports.com

> 2026-09-09 窗 D(SEO/GEO)寫。**這支只寫、不做** —— 換哪一天是 Sean 決定的,
> 而 Search Console 是他的帳號。
> **為什麼要有這份**:換網域那天沒有人記得住這三件事的順序,而順序錯了會賠掉已經收錄的 25,867 頁。

## 0. 先看懂現況(以下每一格都是 2026-09-09 對線上直接 GET 量到的)

| 事實 | 量到的值 | 怎麼量的 |
|---|---|---|
| 商店現在活在 | `shop.pcmmotorsports.com`(Vercel 專案 `pcm-website-v2`) | 主視窗給的背景,我沒有再查 Vercel |
| 商店**已經全開放收錄** | `robots.txt` = `Allow: /`,http 200 | `curl -s https://shop.pcmmotorsports.com/robots.txt` |
| sitemap 規模 | **25,867 條**(25,843 商品 + `/` `/products` `/brands` + 21 個品牌介紹頁),3.6 MB | `curl -s .../sitemap.xml \| grep -c '<loc>'` |
| `NEXT_PUBLIC_SITE_URL` 現值 | 推測 `https://shop.pcmmotorsports.com` —— **吻合但未證實**(我沒讀 Vercel 設定,是從 `robots.txt` 的 `Host:` 行與 sitemap 的絕對網址反推) | 同上 |
| `www` 現在是什麼 | 另一個專案 `pcm-official-site` 的 coming-soon 頁;`/robots.txt` 與 `/sitemap.xml` 都 **404** | `curl -s https://www.pcmmotorsports.com/robots.txt` |
| repo 裡有沒有現成的轉址設定 | **沒有**。`apps/storefront/next.config.ts` 無 `redirects`,根 `vercel.json` 也沒有 | `grep -n -E 'redirect|rewrites' apps/storefront/next.config.ts vercel.json` |
| Google 現在實際收了幾頁 | **沒查**(要 Search Console,Sean 的帳號) | — |

🔴 **一句話的風險**:Google 現在收的是 `shop.*` 的 25,867 個網址。`www` 換成商店那天,
**這些網址全部會變**。沒有 301,那些排名與收錄不會跟著搬,會直接掉。

---

## 1. 換網域當天,按這個順序做

### 步驟 1 —— 先把商店掛上 www(還不要動 shop)
在 Vercel 專案 `pcm-website-v2` 加網域 `www.pcmmotorsports.com`。
`pcm-official-site` 那邊要先把同一個網域移除,否則 Vercel 不讓兩個專案綁同一個網域。

**漏掉會怎樣**:www 還指著 coming-soon,客人看到的是舊頁。

### 步驟 2 —— 改 `NEXT_PUBLIC_SITE_URL`(這一格最容易忘,而它一個人決定三件事)
Vercel → `pcm-website-v2` → Settings → Environment Variables → Production:

```
NEXT_PUBLIC_SITE_URL = https://www.pcmmotorsports.com
```

改完**要重新部署才生效**(它是 build 時嵌進去的 `NEXT_PUBLIC_*`)。

這一個變數同時決定:① 每一頁的 `canonical` ② `robots.txt` 的 `Host:` 與 `Sitemap:` 那兩行
③ `sitemap.xml` 裡 25,867 條的絕對網址。出處:`apps/storefront/src/lib/site-url.ts`
的 `resolveSiteUrl()`,以及 `apps/storefront/src/lib/seo.ts` 的 `buildRobots` / `buildSitemapEntries`。

🔵 **[2026-09-11 補:上面那三件是最貴的,而【完整清單是五件】,少點名的兩件同樣會靜默壞掉。]**
```
① 每頁 canonical      page.tsx:50 · products/[slug]/page.tsx:60 · products/page.tsx:86
                      · lib/catalog-canonical.ts:33          ⇒ 讀不到 ⇒ 整個省略
② robots.txt          lib/seo.ts:94-98                       ⇒ 讀不到 ⇒ Disallow: /
③ sitemap.xml         app/sitemap.ts:50                      ⇒ 讀不到 ⇒ 回空陣列
④ 🔴 llms.txt          lib/llms-txt.ts:20                     ⇒ 讀不到 ⇒ 路由回 404
⑤ 🔴 OG url / JSON-LD  lib/org-jsonld.ts:63 · 上列 page 各檔   ⇒ 讀不到 ⇒ 欄位整個省略
```
📌 **五件全部是【靜默】的** —— 沒有一件會回報錯誤。會出聲音的是下面那張表裡的 `throw`。

**漏掉會怎樣**:站在 www 上,而每一頁的 canonical 都指回 `shop.*`
⇒ 等於親口告訴 Google「請不要收 www,去收 shop」。**這是這份文件裡最貴的一格。**

🔴🔴 **[2026-09-11 補:而「改了」也有一種壞法 —— 少一個 `https://`,整站對 Google 消失。]**
   ```
   NEXT_PUBLIC_SITE_URL = www.pcmmotorsports.com      ← 🔴 少了 https://
   ```
   🎯 **它看起來完全正確**,而 `resolveSiteUrl()`(`apps/storefront/src/lib/site-url.ts:19-27`)
   只認開頭是 `http://` 或 `https://` 的值(`isAbsoluteHttpUrl`,同檔 `:31`)⇒ 不合格 ⇒
   production 回 **`undefined`**(`:26`,刻意不 fallback localhost)⇒ `buildRobots` 走休眠那條
   (`apps/storefront/src/lib/seo.ts:94-98`)⇒ 產出的 `robots.txt` 只有兩行:
   ```
   User-Agent: *
   Disallow: /
   ```
   ⇒ 🛑 **全站對所有搜尋引擎關門,而它不會報錯、不會有任何測試變紅**(見 §2 最後一格)。
   📌 **⇒ 所以步驟 2 貼完值,請【逐字看一眼開頭有沒有 `https://`】,不要只看網域對不對。**

🔴🔴 **[2026-09-09 補查:這一顆的影響【遠不只 SEO】—— 打錯字會讓客人【付不了款】。]**
   ⛔ ~~原本這一段只寫「休眠模式 ⇒ 整站對 Google 消失」~~ —— 那句沒錯,**而它漏掉了更貴的兩件**。
   逐一讀碼查到的(唯讀,**沒有打任何請求給 TapPay**):

   | 讀這顆變數的地方 | 讀不到 / 格式不合時會怎樣 |
   |---|---|
   | **金流 3DS 回呼**(`lib/payment/three-ds-urls.ts`) | **`throw`** ⇒ 🔴 **結帳直接失敗、客人付不了款** |
   | **重寄驗證信**(`app/login/actions.ts:144`) | **`throw`** ⇒ 註冊的人收不到信 |
   | 🔴 **忘記密碼**(`app/login/forgot/actions.ts:32`)〔2026-09-11 補〕 | **`throw`** ⇒ 客人按了重設密碼收不到信 |
   | 寄信裡的會員中心連結(`api/cron/email-sweep`) | 那一段連結不印(降級,不是壞掉) |
   | `robots.txt` / `sitemap.xml` / 每頁 canonical | 全擋 / 回空 / 省略 |
   | 🔵 `llms.txt`(`lib/llms-txt.ts:20`)〔2026-09-11 補〕 | 路由回 **404** |
   | 🔵 OG url / JSON-LD url(`lib/org-jsonld.ts:63` 等)〔2026-09-11 補〕 | 欄位整個省略(靜默) |

   🔵 **金流那個 `throw` 是【刻意的 fail-closed】,不是 bug**:它在 `placeOrder` **之前**跑
     (`charge-actions.ts:340` 的 preflight)⇒ **零扣款、零垃圾單**。
     ⇒ 📌 最壞情況是「**結帳全掛而沒有人被亂扣錢**」—— 很糟,但不會出金錢事故。
   🔴 **而它的驗證比 SEO 那側嚴格**:要求 `https:`、要有 hostname、**不得有路徑 / query / hash**、
     不得帶帳密。⇒ `https://www.pcmmotorsports.com` 可以;
     `https://www.pcmmotorsports.com/shop` **不行**;`http://` 也不行。
   ⇒ 🛑 **所以步驟 2 改完不要只驗 `robots.txt` —— 要真的下一筆測試單。見步驟 5 最後一格。**

### 🛑 停止線 —— 在下一次 build 完成之前,步驟 5 的驗收【一條都不算數】

> **[2026-09-11 補。這一格是這份文件裡唯一一個會讓你【看到一份全綠的假驗收】的地方。]**

**改完那顆環境變數,站上不會有任何變化。** `NEXT_PUBLIC_*` 是 **build 的時候嵌進去的**(步驟 2 `:39` 已經寫了這句),
所以在下一次 build 完成之前:

```
你在 Vercel 改了值        ⇒ 舊 build 還活著, 裡面嵌的是【舊值】
這時去開 /robots.txt      ⇒ 看到的是【舊值】, 而它是對的(因為舊站本來就是對的)
⇒ 🛑 步驟 5 那五條 curl 會【全綠】, 而它們量的是一個【還沒換過的站】
```

📌 **⇒ 全綠不代表換好了。它可能只代表【還沒開始換】。**

**所以順序是:改變數 → 重新 build → 等 build 完成 → 才跑步驟 5。**

🔴 **而顧客站是從哪一個分支 build,這份文件答不了 —— 請 Sean 在 Vercel 專案設定確認一次。**
　 ⚠️ **吻合但未證實**:`CLAUDE.md` 寫著「`main` = 顧客站 production,Sean 手動 FF」,
　 而**我沒有讀 Vercel 的 Git 設定**去坐實它。⇒ 若那句今天仍成立,則 build 由 **Sean 手動 FF `main`** 觸發,
　 意思是「改變數」與「FF main」是**同一天的兩件事,而且有先後**。
　 ⇒ 📌 **當天第一件該確認的就是這一句** —— 它決定「重新部署」到底是誰按、按哪裡。

🔵 **怎麼知道 build 真的跑完了**:在 Vercel 專案的 Deployments 看到一個**比你改變數還晚**的
部署,狀態 Ready。⇒ 在那之前,下面每一條驗收都先不要跑,跑了也不要相信。

### 步驟 3 —— shop 全站 301 轉到 www(**不是**把 shop 關掉)
在 Vercel 專案的 Domains,把 `shop.pcmmotorsports.com` 設成 redirect 到
`www.pcmmotorsports.com`(Vercel 的網域轉址預設是 308,對 SEO 與 301 等價)。
⚠️ 我**沒有實際操作過那個畫面**,選項名稱以當天畫面為準。

🔴 **要保留路徑**:`shop.../products/dbk-gr06` 必須轉到 `www.../products/dbk-gr06`,
不是全部倒到首頁。全部倒首頁 = 25,843 個商品頁的排名一次歸零。

🔴 **shop 至少留一年不要拆。** Google 要反覆抓到 301 才會把權重搬完。
拆掉 = 那 25,867 個網址變 404,而不是「搬家了」。

**漏掉會怎樣**:舊網址變 404 或死掉,收錄與外部連結一起賠掉。

### 步驟 4 —— Search Console(Sean 的帳號,只有他做得了)
1. 加 `www.pcmmotorsports.com` 這個資源並驗證。
2. 在 `shop.pcmmotorsports.com` 那個資源用「**變更網址工具**」指向 www。
   ⚠️ 這個工具要求兩件事:兩個資源都已驗證、且 shop 已經在 301 到 www ⇒ **它一定排在步驟 3 之後。**
3. 在 www 資源送出 `https://www.pcmmotorsports.com/sitemap.xml`。

**漏掉會怎樣**:搬家一樣會完成,只是慢很多(數週 → 數月),而且過程中看不到進度。

### 步驟 4.5 —— 三十秒版驗收(**這一份是給 Sean 自己按的**)

> **[2026-09-11 補。]** 下面步驟 5 那五條 `curl` **是給窗跑的**,Sean 執行不了。
> **同一件事,兩個使用者** —— 這一份只要瀏覽器、只看一個畫面。
> 🛑 **先過停止線**:確認 build 已經跑完(見上面那道停止線),否則這一份也會給你假綠。

**第 1 步** — 在瀏覽器開:

```
https://www.pcmmotorsports.com/robots.txt
```

**第 2 步** — 看它長怎樣,只有三種:

| 你看到 | 意思 | 要做什麼 |
|---|---|---|
| **只有兩行**:`User-Agent: *` 換行 `Disallow: /` | 🔴 **全站對所有搜尋引擎關門** | 立刻停。步驟 2 那顆變數沒設、打錯、或少了 `https://` |
| **很長一串**(十幾段 `User-Agent:`),而**最後兩行的網址 = 你網址列上的網域** | 🟢 **正常** | 往下做 |
| **很長一串**,而**最後兩行的網址 ≠ 你的網域**(舊的 `shop.` 或別的) | 🔴 **設了,但指到別的地方去** | 立刻停,把那個網址原樣念出來 |

**第 3 步** — 只看**最後兩行**,它們長這樣:

```
Host: https://xxxxx
Sitemap: https://xxxxx/sitemap.xml
```

🎯 **`xxxxx` 要跟你網址列上的網域【一個字一個字一樣】。**
🛑 **不一樣就是壞的**,不管上面那一大串看起來多正常。

🔵 **今天的基準線是硬的(2026-09-11,Sean 自己開瀏覽器看的)**:
　 `https://shop.pcmmotorsports.com/robots.txt` ⇒ 🟢 很長一串、12 段一段不少、
　 `Host: https://shop.pcmmotorsports.com` **與網址列逐字相同**。
　 ⇒ 📌 **換完之後只要對【同一個位置】看新值** —— 那兩行要從 `shop.` 變成 `www.`,其餘長相不變。

⚠️ **第三種壞法不是假想的**:2026-09-10 的本機 build 產物
(`apps/storefront/.next/server/app/robots.txt.body`)最後兩行逐字是
`Host: https://confined-dislocate-showgirl.ngrok-free.dev` —— 一份**又長又正常、12 段一段不少**
的 `robots.txt`,而它把 Google 指到別人的網域。**「看起來正常」不等於「是對的」。**

### 步驟 5 —— 驗收(每一條都要親眼看到,不要憑「應該有生效」)

```
curl -s https://www.pcmmotorsports.com/robots.txt
```
要看到 `Host: https://www.pcmmotorsports.com` 與 `Sitemap: https://www.pcmmotorsports.com/sitemap.xml`。
🔴 若看到 `Disallow: /` ⇒ **步驟 2 的環境變數沒生效或打錯**,立刻停,不要放著過夜。

```
curl -s https://www.pcmmotorsports.com/sitemap.xml | grep -c '<loc>'
```
要 ≥ 25,000,而且

```
curl -s https://www.pcmmotorsports.com/sitemap.xml | head -c 300
```
裡面的網址要是 `https://www.pcmmotorsports.com/...`,不是 `shop.`。

```
curl -sI https://shop.pcmmotorsports.com/products/dbk-gr06 | head -5
```
要看到 `301` 或 `308`,而且 `location:` 是 `https://www.pcmmotorsports.com/products/dbk-gr06`
(**路徑要在**,不是首頁)。

```
curl -s https://www.pcmmotorsports.com/products/dbk-gr06 | grep -o '<link rel="canonical" href="[^"]*"'
```
要指向 `www`。

🔴🔴 **最後一格,而它是唯一一個 `curl` 驗不到的:【真的下一筆測試單走到付款頁】。**
   理由見步驟 2 那張表:`NEXT_PUBLIC_SITE_URL` 格式不合時,金流那條路是 **`throw`** ——
   而那個失敗**發生在客人按下結帳的時候**,`robots.txt` 與 canonical **全部都會是綠的**。
   ⇒ 📌 **前面四條全綠,不代表客人付得了款。**
   ⇒ 走到 3DS 跳轉那一步,確認跳得出去、也回得來。回不來 ⇒ 多半是 TapPay 後台的網域白名單
     (見 §2 第 3 點),那要 Sean 去 TapPay 後台看。

---

## 2. 這份文件沒有處理、而換網域那天也會動到的

- **寄出去的信裡的網址**:信件模板若有寫死 `shop.` 的連結,那是另一條線(窗 C)的事,這裡只點名。
- ~~**TapPay / 金流的回呼網址白名單**:…**我沒有查過**,標未確認~~
  🔵 **[2026-09-09 查完了。三件量到的事實:]**
  1. **回呼網址是【每一筆交易當下現組的】,不是 TapPay 後台的固定設定。**
     `lib/payment/three-ds-urls.ts` 的 `buildResultUrls()` 用 `NEXT_PUBLIC_SITE_URL` 拼出
     `frontend_redirect_url` 與 `backend_notify_url`,隨每一次 charge 請求送給 TapPay。
     ⇒ **改那一顆環境變數,回呼網址就跟著換,不用改第二個地方。**
  2. **Production 的 55 顆環境變數裡,只有 `NEXT_PUBLIC_SITE_URL` 一顆與顧客站網域有關。**
     (`vercel env ls production --project pcm-website-v2`,**只印名不印值**〔值欄全是
      `Encrypted`〕;掃 `URL|SITE|TAPPAY|NOTIFY|DOMAIN|CALLBACK` 的命中逐一看過,其餘是
      DB / Supabase / Healthchecks / TapPay 金鑰;掃 `SHOP|WWW` ⇒ **0 命中**。)
  3. **回呼路由自己不檢查來源網域** ⇒ 換網域不會被它自己擋掉。
     (`app/api/checkout/tappay-notify/[secret]/route.ts`,232 行,掃
      `host|origin|referer|x-forwarded` ⇒ **0 命中**;🟢 正對照同檔掃 `export|secret|request`
      ⇒ **11 命中** ⇒ 尺是活的。)
  🔴 **仍然只有 Sean 看得到的那一格**:**TapPay 後台有沒有設「只接受某個網域的回呼」。**
     程式碼答不了這件事 —— 那是 TapPay 那一側的設定。
     ⇒ 換網域前請 Sean 登入 TapPay 後台,確認商店設定裡沒有把 `shop.pcmmotorsports.com`
       釘成白名單 / 固定網域;有的話要一起改成 `www`。
     ⚠️ **我沒有打任何請求給 TapPay,也沒有動任何設定。**
- **Vercel 防火牆規則 / cron**:`scripts/vercel-json-waf-cron-gate.py` 與
  `scripts/vercel-firewall-cron-order-check.py` 兩支都要在換完之後再跑一次。我沒跑過。
- **B2B 子網域**:`project_0908-b2b-subdomain-after-launch` 記著那是上線後第一件,與本份無關但同一批網域設定。
- 🔴🔴 **沒有任何測試、CI 或部署閘會因為這顆變數壞掉而變紅**〔2026-09-11 量的〕:
  ```
  apps/storefront/src/lib/seo.test.ts 命中 process.env ⇒ 0 次
     ⇒ 它餵的是字面 buildRobots(BASE) 與 buildRobots(undefined)
     ⇒ 它斷言的是「休眠這個行為是對的」, 不是「正式站不在休眠」⇒ 兩種世界都綠
  site-url.test.ts :37 :43 兩條同理 —— 鎖的是行為, 不是環境
  scripts / .github / vercel.json / *.yml 命中 NEXT_PUBLIC_SITE_URL ⇒ 1 個檔, 而那是
     scripts/storefront-probe/up.sh:570 在【設】它, 不是閘在【檢查】它
     ⚪ 正對照:scripts 命中 "supabase" ⇒ 274 個檔(尺是活的)
  ```
  📌 **⇒ 這件事只有【有人去看】才會發現。這份文件的步驟 4.5 與步驟 5 就是那個「有人去看」。**

## 3. 限制(不要把下面讀成結論)

- 全份沒有任何一步是我做過的 —— 這是**寫給那天照著按的**,不是事後紀錄。
- `NEXT_PUBLIC_SITE_URL` 的**現值**我仍然沒讀到(`vercel env ls` 的值欄是 `Encrypted`,只印得出名字)
  ⇒ 「它現在是 `https://shop.pcmmotorsports.com`」仍然是**從 `robots.txt` 的 `Host:` 行反推的**,
  吻合但未證實。**已證實的只有:它存在於 Production。**
- Vercel 網域轉址的畫面與選項名稱我沒有實際操作過。
- 「Google 現在收了幾頁」沒查。
