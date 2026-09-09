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

**漏掉會怎樣**:站在 www 上,而每一頁的 canonical 都指回 `shop.*`
⇒ 等於親口告訴 Google「請不要收 www,去收 shop」。**這是這份文件裡最貴的一格。**

🔴 **它還有一個休眠模式**:`resolveSiteUrl()` 在 production 讀不到這個變數時回 `undefined`,
而那會讓 `robots.txt` 變成 **`Disallow: /` 全站擋爬**、`sitemap.xml` 回**空**。
⇒ 打錯字(例如少了 `https://`)不是「沿用舊值」,是**整站對 Google 消失**。
改完務必跑步驟 5 的驗收。

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

---

## 2. 這份文件沒有處理、而換網域那天也會動到的

- **寄出去的信裡的網址**:信件模板若有寫死 `shop.` 的連結,那是另一條線(窗 C)的事,這裡只點名。
- **TapPay / 金流的回呼網址白名單**:換網域可能要在金流後台一起改。**我沒有查過**,標未確認,那條碰錢 ⇒ 要走 plan + Sean。
- **Vercel 防火牆規則 / cron**:`scripts/vercel-json-waf-cron-gate.py` 與
  `scripts/vercel-firewall-cron-order-check.py` 兩支都要在換完之後再跑一次。我沒跑過。
- **B2B 子網域**:`project_0908-b2b-subdomain-after-launch` 記著那是上線後第一件,與本份無關但同一批網域設定。

## 3. 限制(不要把下面讀成結論)

- 全份沒有任何一步是我做過的 —— 這是**寫給那天照著按的**,不是事後紀錄。
- `NEXT_PUBLIC_SITE_URL` 的現值我沒讀 Vercel 設定,是反推的。換之前請 Sean 自己開後台核一眼。
- Vercel 網域轉址的畫面與選項名稱我沒有實際操作過。
- 「Google 現在收了幾頁」沒查。
