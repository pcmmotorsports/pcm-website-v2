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

### 0b. Vercel 上總共有哪些專案(2026-09-11 Sean 自己開後台貼回的畫面逐字)

> 🔴 **這一格 repo 永遠答不了** —— 本機沒有 `.vercel/project.json`,repo 文字裡提過的專案名
> 只證明「文件提過」,不是綁定清單。**下面是後台真值。**

| 專案 | 綁的網域 | production build 自 |
|---|---|---|
| `pcm-website-v2`(顧客站) | `shop.pcmmotorsports.com` · `pcm-website-v2.vercel.app` | 🟢 **`main`** |
| `pcm-admin`(後台) | `admin.pcmmotorsports.com` · `pcm-admin.vercel.app` | 🟢 **`dev`** |
| `pcm-quote-v2`(報價單) | `quote.pcmmotorsports.com` · `pcm-quote-v2.vercel.app` | (未問) |
| 🔴 `pcm-official-site` | **`www.pcmmotorsports.com`** · **`pcmmotorsports.com`** · `pcm-official-site.vercel.app` | 🛑 **沒接 Git** —— CLI `vercel deploy` |
| 🟢 `pcm-moto` | `bikes.pcmmotorsports.com` · `pcm-moto.vercel.app` 等 vercel.app 三條 ⇒ **不碰 www / 裸網域,本次不動** | (未問) |

> 🔵 **[2026-09-11 13:0x 主視窗用 Vercel MCP `get_project` 唯讀實查]**:`pcm-moto` 如上;`pcm-official-site` = `pcmmotorsports.com` · `www.pcmmotorsports.com` + 兩條 vercel.app;`pcm-website-v2` = `shop.pcmmotorsports.com` + 三條 vercel.app ⇒ **與上表 Sean 貼回的值一致。**

🎯 **⇒ 是五個專案,不是三個。** 而 `pcm-moto` 那一列**還沒有答案**,不要把它讀成「它沒綁網域」。
📌 **⇒ 這次要動的只有 `pcm-website-v2` 與 `pcm-official-site` 兩個**;`pcm-admin` 與 `pcm-quote-v2` 的網域不變。

---

## 1. 換網域當天,按這個順序做

> ## 🔴 **[2026-09-11 改過順序。這一格是【為什麼】—— 不寫下來,下一個人會以為本來就是這樣。]**
>
> **原本的排法**是:掛 www → 改 env → Supabase → 停止線 → **shop 全站 301** → Search Console → 驗收。
> 🛑 **而那樣排,等於在【沒有任何人確認過 www 是活的】之前,就把全部舊流量倒進去。**
>
> **失敗形狀(逐字)**:
> > `www` 那邊 build 壞了 / env 打錯 / Supabase 沒改 ⇒ **而 `shop` 已經 301 出去**
> > ## 🛑 **⇒ 兩個網域同時死,而他手上沒有一個還活著的站可以退回去。**
>
> 🎯 **⇒ 而修法不是加東西,是【把不可逆的那一步搬到最後】。**
> 📌 這跟這個 repo 平常在做的是同一個形狀:三綠 → codex → 拋棄式 PG → **才貼**。

### 🔵 今天的順序(這一格是權威;下面每一節的標題編號沿用舊的,沒有重編)

| 做第幾 | 章節 | 一句話 | 可逆嗎 |
|---|---|---|---|
| 1 | 步驟 1 | 把 `www` 掛到商店專案 | 🟢 可逆(拿掉就好) |
| 2 | 步驟 2 | 改 `NEXT_PUBLIC_SITE_URL` | 🟢 可逆(改回去 + 重 build) |
| 3 | **步驟 2b-a** | Supabase **Redirect URLs 加一條**(純加) | 🟢 可逆 |
| 4 | 🛑 停止線 | 等新的 build 變 Ready | — |
| 5 | 步驟 4.5 | 三十秒版驗收(**他自己按**) | — |
| 6 | 步驟 5a | 四條 curl 驗 `www` | — |
| 7 | **步驟 2b-b** | Supabase **Site URL 改成 www** | 🟡 可逆但中間會有空窗 |
| 8 | 🔴 **步驟 3** | `shop` 全站 301 → `www` | 🔴 **不可逆(這是最後一步的原因)** |
| 9 | 步驟 5b | 一條 curl 驗 301 | — |
| 10 | 步驟 4 | Search Console 變更網址工具 | 🔴 不可逆 |

> ## 🛑 **這一句適用【每一步】,下面不再重複:**
> ## **卡住 ⇒ 停在這裡,不要往下做,把畫面截圖丟給主視窗。**
> 🔵 統一成同一句,是為了讓他不用在每一步各想一個 —— **而「往下做」是這份文件裡最貴的錯。**

### 步驟 1 —— 先把商店掛上 www(還不要動 shop)
⛔ ~~在 Vercel 專案 `pcm-website-v2` 加網域 `www.pcmmotorsports.com`。~~
⛔ ~~`pcm-official-site` 那邊要先把同一個網域移除,否則 Vercel 不讓兩個專案綁同一個網域。~~

🔵 **[2026-09-11 改法。上面兩行留著劃線,因為它們沒有錯 —— 只是有更好的一步。]**

**做法 A(推薦,一個動作):**
```
vercel domains add www.pcmmotorsports.com pcm-website-v2 --force
```
Vercel CLI 官方文件逐字:「**Force a domain onto a project, removing it from any existing project.**」
🎯 **⇒ 一個動作同時完成「從 `pcm-official-site` 拿掉」與「掛到 `pcm-website-v2`」。**
📌 **⇒ 而它消掉了舊做法的一個空窗**:解綁之後、掛上之前,`www` 是**誰都沒有的**(客人那一刻會看到錯誤頁)。
⚠️ **限定詞**:這一行出自官方文件,**我沒有實際操作過**。

**做法 B(後台點,兩個動作):**
1. `pcm-official-site` → **Settings → Domains** → 把 `www.pcmmotorsports.com` 移除
2. `pcm-website-v2` → **Settings → Domains** → Add → `www.pcmmotorsports.com`

**怎麼知道成功了**:`pcm-website-v2` 的 **Settings → Domains** 清單裡看得到 `www.pcmmotorsports.com`,
且狀態不是 pending / Invalid Configuration。

**漏掉會怎樣**:www 還指著 coming-soon,客人看到的是舊頁。

🔵 **[2026-09-11 Sean 開 Vercel 貼回真值 —— 這一步多了兩格。]**

**① `pcm-official-site` 綁的是【兩個】網域,不是一個:**
```
www.pcmmotorsports.com     ← 要解綁給商店
pcmmotorsports.com         ← 🔴 裸網域, 而這份文件原本沒提到它
pcm-official-site.vercel.app
```
🟢 **⇒ 已答 —— Sean 2026-09-11 逐字拍【甲 = 301 轉到 www(一般做法, 兩個網址都通)】。**
　 ⇒ 📌 **所以裸網域也要從 `pcm-official-site` 解綁, 而它的去處是【301 到 www】, 不是留在原地。**
　 ⛔ ~~待答(要 Sean 決定,答案還沒下來):換完之後【裸網域 `pcmmotorsports.com` 要指到哪裡】?~~
```
甲  301 到 www(一般做法)
乙  留在 pcm-official-site
丙  其他
```
　 📌 **不答這一題,裸網域那天會停在一個沒有人決定過的狀態** —— 而客人打 `pcmmotorsports.com` 是很常見的。

**② `pcm-official-site` 沒有接 Git** —— 畫面逐字是「Connect Git」與 `vercel deploy`
　 ⇒ 🛑 **它是 CLI 手動部署的,不是 push 觸發** ⇒ **停掉 / 改它的方式跟別的專案不一樣**,
　 別套用「推分支就好」那套。
　 ⛔ ~~⚠️ **具體怎麼停我沒做過,以當天畫面為準。**~~
🟢 **[2026-09-11 查完官方文件後訂正 —— 上面那個擔心是【多餘的】。]**
```
解綁網域這件事與【有沒有接 Git】完全無關 —— 它是「專案 ↔ 網域」的關係, Git 不在裡面
  移除網域   DELETE /v9/projects/{idOrName}/domains/{domain}
             (官方頁 docs/domains/working-with-domains/remove-a-domain)
  停用專案   POST /v1/projects/{projectId}/pause
             官方逐字「disables auto-assigning custom production domains
                      and blocks the active Production Deployment」
  安全網     vercel remove <project> --safe
             官方逐字「Skips removal of deployments with active preview URLs
                      or production domains」⇒ 還有正式網域時它會擋住
```
🛑 **真正因為「沒接 Git」而不同的只有一件事:它不能靠推分支重新部署。**
　 而**換網域根本不需要重新部署它** ⇒ 📌 **這一格對本次作業沒有影響。**
⚠️ 以上全部出自官方文件,**我沒有實際操作過任何一個**。

### 步驟 2 —— 改 `NEXT_PUBLIC_SITE_URL`(這一格最容易忘,而它一個人決定三件事)
Vercel → `pcm-website-v2` → Settings → Environment Variables → Production:

```
NEXT_PUBLIC_SITE_URL = https://www.pcmmotorsports.com
```

改完**要重新部署才生效**(它是 build 時嵌進去的 `NEXT_PUBLIC_*`)。

**怎麼知道值真的存進去了**:同一個 Environment Variables 頁面,那一列的 **Production** 標籤要在,
值的欄位會顯示成遮蔽的樣子(Vercel 不回明文)⇒ 🛑 **所以「看到值對不對」在這個畫面上做不到。**
📌 **⇒ 真正驗這顆變數的地方是步驟 4.5(開 `/robots.txt` 看最後兩行),不是這個畫面。**
⚠️ 在這個畫面上唯一能確認的是「**那一列存在、而且掛在 Production**」。

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

### 步驟 2b —— Supabase Auth 的兩格(**改 Vercel 它不會跟著改**)

> **[2026-09-11 補。這一格原本這份文件連提都沒提,而它已經用同一個形狀咬過一次。]**

🔴🔴 **前科**:2026-08-08 正式站 Google 登入一直回跳 `localhost:3001`。`PROGRESS.md:1008` 逐字:
> 主視窗診斷=Vercel `NEXT_PUBLIC_SITE_URL` 實查**對**,根因=**Supabase 後台 Site URL 欄位仍 dev 值**(**≠Vercel env,兩處設定**)

📌 **⇒ 這兩處是【分開的設定】。步驟 2 改完 Vercel,Supabase 這邊【一個字都不會變】。**

**現在的真值(2026-09-11 Sean 開 Supabase 後台貼回):**
```
Supabase → Authentication → URL Configuration
  Site URL       https://shop.pcmmotorsports.com/
  Redirect URLs  7 條:
     ①② localhost:3000 / localhost:3001
     ③  shop 的 /auth/callback
     ④⑤⑥⑦ 四條 vercel.app preview(其中兩條帶 pcm-* 通配符)
```

🔴🔴 **[2026-09-11 拆開:這兩格【不在同一個時間點做】,而它們在同一個畫面上、長得一模一樣。]**

#### 步驟 2b-a —— Redirect URLs **加一條**(做第 3 順位,**在 build 之前**)
```
加  https://www.pcmmotorsports.com/auth/callback
```
🟢 **為什麼可以提前做**:Redirect URLs 是一份**允許清單** ⇒ 加一條是**純加**,
　 對**還在跑的 `shop`** 零影響。⇒ 📌 **越早加越好,它不會弄壞任何東西。**
🛑 **只加,不要刪。** 那七條裡哪幾條還有人在用,`b4` 正在量 —— **在那份讀數回來之前,一條都不要刪。**

#### 步驟 2b-b —— Site URL **改成 www**(做第 7 順位,**在 5a 全綠之後、步驟 3 之前**)
```
Site URL  https://shop.pcmmotorsports.com/  ⇒  https://www.pcmmotorsports.com/
```
🔴 **為什麼不能提前**:Site URL 是**一個單一值** ⇒ **改掉的那一刻,`shop` 那邊就不是它了**。
　 而那時 `shop` 還是客人在用的站 ⇒ 📌 **提前改 = 自己製造一段兩邊都不對的空窗。**

**怎麼知道成功了**(這一格很便宜,而且是真的端到端):
```
登出 ⇒ 在 www 上跑一次「忘記密碼」⇒ 看收到的信裡那個連結是不是 www 開頭
```
🎯 **⇒ 那一條連結同時驗到 Site URL、Redirect URLs、與 `NEXT_PUBLIC_SITE_URL` 三件事。**

⛔ ~~🔴 **換網域那天這兩格都要動。**~~
⛔ ~~🛑 **而【要改成什麼】這份文件還不能寫** —— 哪幾條 Redirect URL 還有人在用,`b4` 正在量。
　 ⇒ **這一格刻意留白,等那份讀數回來再補。不要憑感覺刪那七條裡的任何一條。**~~
🔵 **[上面那段留著劃線:它說的「不要憑感覺刪」今天仍然成立,而【什麼時候做】已經拆開寫在上面兩格。]**

**漏掉會怎樣**:客人在 www 上**登不進來**(Google 登入、email 登入都走這裡),
而**重設密碼信、註冊驗證信裡的連結會指回舊網域**。
🔴 **而它不會叫** —— 站是活的、robots 是綠的、canonical 是對的,只有客人按下去才會發現。
🔵 對照:程式碼那一側**不用改**(`login/actions.ts:153` 與 `login/forgot/actions.ts:57` 的
`redirectTo` 都是從 `resolveSiteUrl()` 組的;Google 登入 `LoginPage.tsx:196` 用
`window.location.origin`)⇒ **要動的只有 Supabase 後台這兩格。**

### 🛑 停止線 —— 在下一次 build 完成之前,下面的驗收【一條都不算數】
> ⛔ ~~原標題逐字:`### 🛑 停止線 —— 在下一次 build 完成之前,步驟 5 的驗收【一條都不算數】`~~
> ⇒ 2026-09-11 改順序後,接在它下面的是
> **步驟 4.5 與 5a**(步驟 5 已拆成 5a / 5b)。**這一格擋的是同一件事,只是下一節換了名字。**

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

⛔ ~~**而顧客站是從哪一個分支 build,這份文件答不了 —— 請 Sean 在 Vercel 專案設定確認一次。**~~
　 ⛔ ~~⚠️ **吻合但未證實**:`CLAUDE.md` 寫著「`main` = 顧客站 production,Sean 手動 FF」,
　 而**我沒有讀 Vercel 的 Git 設定**去坐實它。~~
🟢 **[2026-09-11 證實了 —— Sean 自己開 Vercel 貼回畫面逐字。上面那兩句留著劃線,是為了看得出它從推論變成事實。]**
```
pcm-website-v2  畫面逐字「To update your Production Deployment, push to the `main` branch.」
pcm-admin       畫面逐字「push to the `dev` branch」
```
🎯 **⇒ 顧客站(`pcm-website-v2`)的 production build 由【推 `main`】觸發** ⇒ 而 `CLAUDE.md` 寫著那是 **Sean 手動 FF**
　 ⇒ 📌 **「改變數」與「FF `main`」是同一天的兩件事,而且有先後:先改變數,再 FF,才會 build 到新值。**
　 ⚠️ **仍未證實的那一半**:「手動 FF」這個動作出自 `CLAUDE.md`,**Vercel 畫面只說了「push to `main`」,沒說是誰按**。

🔵 **怎麼知道 build 真的跑完了**:在 Vercel 專案的 Deployments 看到一個**比你改變數還晚**的
部署,狀態 Ready。⇒ 在那之前,下面每一條驗收都先不要跑,跑了也不要相信。

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

### 步驟 5a —— 驗收 www(每一條都要親眼看到,不要憑「應該有生效」)

> 🔵 **[2026-09-11 改順序:這一段原本排在步驟 3【後面】,現在搬到【前面】。為什麼見 §1 開頭那格。]**
> ⛔ ~~原標題逐字:`### 步驟 5 —— 驗收(每一條都要親眼看到,不要憑「應該有生效」)`~~
> ⇒ 拆成 **5a(驗 www,在 301 之前)** 與 **5b(驗 301,在 301 之後)**。

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
curl -s https://www.pcmmotorsports.com/products/dbk-gr06 | grep -o '<link rel="canonical" href="[^"]*"'
```
要指向 `www`。

🔴🔴 **最後一格,而它是唯一一個 `curl` 驗不到的:【真的下一筆測試單走到付款頁】。**
   理由見步驟 2 那張表:`NEXT_PUBLIC_SITE_URL` 格式不合時,金流那條路是 **`throw`** ——
   而那個失敗**發生在客人按下結帳的時候**,`robots.txt` 與 canonical **全部都會是綠的**。
   ⇒ 📌 **前面四條全綠,不代表客人付得了款。**
   ⇒ 走到 3DS 跳轉那一步,確認跳得出去、也回得來。回不來 ⇒ 多半是 TapPay 後台的網域白名單
     (見 §2 第 3 點),那要 Sean 去 TapPay 後台看。

### 步驟 3 —— shop 全站 301 轉到 www(**不是**把 shop 關掉)
在 Vercel 專案的 Domains,把 `shop.pcmmotorsports.com` 設成 redirect 到
`www.pcmmotorsports.com`(Vercel 的網域轉址預設是 308,對 SEO 與 301 等價)。
⚠️ 我**沒有實際操作過那個畫面**,選項名稱以當天畫面為準。

🔴 **要保留路徑**:`shop.../products/dbk-gr06` 必須轉到 `www.../products/dbk-gr06`,
不是全部倒到首頁。全部倒首頁 = 25,843 個商品頁的排名一次歸零。

🔴 **shop 至少留一年不要拆。** Google 要反覆抓到 301 才會把權重搬完。
拆掉 = 那 25,867 個網址變 404,而不是「搬家了」。

**漏掉會怎樣**:舊網址變 404 或死掉,收錄與外部連結一起賠掉。

### 步驟 5b —— 驗收 301(**這一條留在原位,它量的是步驟 3 的成果**)

> 🔵 **[2026-09-11 拆出來的。為什麼它【不跟著搬上去】:上面那幾條量的是「www 活著沒」,
> 而這一條量的是「shop 有沒有轉過去」—— 步驟 3 還沒做的時候跑它,答案必定是紅的,
> 而那個紅【不代表出錯】。⇒ 📌 一條在錯的時間跑的驗收,比沒有驗收更糟:它會教人忽略紅燈。]**

```
curl -sI https://shop.pcmmotorsports.com/products/dbk-gr06 | head -5
```
要看到 `301` 或 `308`,而且 `location:` 是 `https://www.pcmmotorsports.com/products/dbk-gr06`
(**路徑要在**,不是首頁)。


🔵 這一條綠了,整個換網域才算完成。**在它之前,舊網址還沒有真的搬家。**

### 步驟 4 —— Search Console(Sean 的帳號,只有他做得了)
1. 加 `www.pcmmotorsports.com` 這個資源並驗證。
2. 在 `shop.pcmmotorsports.com` 那個資源用「**變更網址工具**」指向 www。
   ⚠️ 這個工具要求兩件事:兩個資源都已驗證、且 shop 已經在 301 到 www ⇒ **它一定排在步驟 3 之後。**
3. 在 www 資源送出 `https://www.pcmmotorsports.com/sitemap.xml`。

**漏掉會怎樣**:搬家一樣會完成,只是慢很多(數週 → 數月),而且過程中看不到進度。

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
- ⛔ ~~**Vercel 防火牆規則 / cron**:`scripts/vercel-json-waf-cron-gate.py` 與
  `scripts/vercel-firewall-cron-order-check.py` 兩支都要在換完之後再跑一次。我沒跑過。**~~
🔴 **[2026-09-11 讀完那兩支的碼之後訂正 —— 上面那句【留著劃線】,因為它是一筆「把檢查掛錯理由」的紀錄,刪掉下一個人會再掛一次。]**

## 🛑 **這兩支跟換網域【沒有關係】。而它們仍然要跑,只是理由不同。**

**為什麼無關(機械成因,不是判斷):**
```
兩支的受詞都是【路徑】, 不是【網域】:
  gate.py :33-38   CRON_PATHS = ['/api/cron/', '/api/cron/reconcile',
                                 '/api/cron/shipped-email', '/api/cron/x/y']
  order-check :33-34  CRON_PREFIX = '/api/cron/' + 同一組 CRON_PATHS
⚪ 兩支檔裡【一個網域字串都沒有】(掃過, 0 個)
🎯 WAF 規則掛在【專案】上, 而換網域換的是【專案 ↔ 網域】的綁定 ——
   而專案沒變(換前換後都是 pcm-website-v2)
⇒ 📌 換網域【不會改變這兩支量的任何東西】。
```
**✅ 真正的理由(用這個,不要用「因為換了網域」):**
> ## **不是「因為換了網域」,是「排程死掉不會有人通知,而沒有人記得上次跑是什麼時候」。**
> ## 📌 **掛錯理由的檢查,下次有人會因為「這次沒換網域」而跳過它。**

### 它們各自檢查什麼,以及為什麼是兩支
| | `vercel-json-waf-cron-gate.py`(repo 側) | `vercel-firewall-cron-order-check.py`(live 側) |
|---|---|---|
| 問的問題 | 有沒有人在 `vercel.json` 的 `routes[].mitigate` 加了會擋到 `/api/cron/` 的規則 | 有沒有規則排在 **bypass 之上**而會擋到 `/api/cron/` |
| 背後那句官方逐字 | 「`log`, **`bypass`**, and `redirect` actions are **not supported** in `vercel.json` configuration.」⇒ 📌 **這條路上放不了 bypass** ⇒ 在這裡加一條 `deny`,**沒有任何辦法在同一個地方放行排程** | 「The bypass action allows specific traffic to skip any **subsequent** firewall rules.」⇒ 📌 **bypass 只救它【下面】的** |
| 怎麼判 | 把 `src` 當 regex **真的拿去 match** 那四條路徑;命中 + action ∈ `deny`/`challenge` ⇒ 紅 | 找到匹配排程的 bypass,**只看它上面**那幾條;action ∈ `deny`/`challenge`/**`rate_limit`** ⇒ 紅 |
| 對外請求 | **0 次** | **1 次**(`rules list --json --expand`,一發拿完) |
| 🛑 自標的天花板 | 「看不到 dashboard 上的自訂規則 ⇒ 全綠 ≠ 排程安全」 | 「看不到 `vercel.json` 的 mitigate ⇒ 全綠 ≠ 排程安全」 |

> ## 🎯 **兩支自己都寫了同一句:「本支看得到的東西另一支看不見。」**
> ## 📌 **⇒ 要跑就兩支一起跑。單跑一支的綠,是半個綠。**

### 綠長什麼樣 / 紅長什麼樣(逐字)
**`vercel-json-waf-cron-gate.py` —— 綠(exit 0)**
```
✅ ./vercel.json —— 沒有會擋到排程的 mitigate 規則
✅ ./apps/admin/vercel.json —— 沒有會擋到排程的 mitigate 規則

分母:掃了 2 支 vercel.json · 代表性排程路徑 4 條
🛑 本閘【看不到】dashboard 上的自訂規則 —— 全綠 ≠ 排程安全。
```
🔵 今天必綠的機械理由:兩支 `vercel.json` **都沒有 `routes` 這個鍵** ⇒ 掃描函式直接回空。
**紅(exit 1)**
```
🔴 ./vercel.json
     src=/api/(.*)  action=deny  ⇒ 會匹配 /api/cron/, /api/cron/reconcile, …
   出路二選一:①把那條規則的 `src` 收窄到不會碰 /api/cron/
               ②改到 dashboard 的自訂規則去做, 並把它排在 bypass 【下面】
   ⛔ 不要用「把 CRON_PATHS 刪一條」讓它變綠 —— 那是把會叫的錯換成不會叫的錯。
```

**`vercel-firewall-cron-order-check.py` —— 綠(exit 0)**
```
  #1 facet                     rate_limit
  …
  #5 bypass-machine-traffic    bypass        ← Bypass

分母:5 條規則 · 代表性排程路徑 4 條
🔵 bypass 在第 5 條;它【上面】有 4 條規則要檢查。
🟡 而它是【最後一條】 ⇒ 它下面沒有東西 ⇒ **它今天保護不了任何東西**。
   排程今天安全, 是因為上面那幾條剛好沒有匹配到它 —— 不是因為 bypass 在擋。
✅ bypass 之上沒有任何規則會擋到排程。
```
> ## 🔴 **那個 🟡 不是紅,而它是這支最值得讀的一行** —— 它寫在**全綠的那一份輸出裡**,告訴你今天安全是**巧合**,不是保護。

**紅 A(exit 1)有規則排在 bypass 上面**
```
🔴 有規則排在 bypass 之上而會擋到排程:
   #1 kill  action=deny  ⇒ pre /api/
   出路:把它排到 bypass【下面】, 或把條件收窄到不會碰 /api/cron/。
   ⛔ 不要把 bypass 移到最上面 —— 2026-09-02 codex 與 -0a 都裁定不要。
```
**紅 B(exit 1)連 bypass 都找不到**
```
🔴 找不到任何【匹配 /api/cron/ 的 bypass 規則】 ⇒ 排程沒有放行規則保護。
   ⚠️ 而這也可能是規則被改名或條件被改了 ⇒ 去開面板看, 不要直接加一條。
```
**🟠 exit 2 —— 【讀不到】,不是【有問題】**
```
🔴 讀不到規則(not_linked):這棵樹沒有 .vercel link ⇒ 要在【主樹】跑。
   🔴 這是設定缺失, 不是 Vercel 掛掉。
🔴 讀不到規則(no_json):rc=…;輸出裡找不到 JSON ⇒ 可能未登入或命令變了。
```
> ## 🎯 **三種結束碼要做的事不同,而它刻意分開:`0` 沒事 · `1` 有規則要搬 · `2` 我根本沒讀到。**

### 誰跑得動
| | `gate.py` | `order-check.py` |
|---|---|---|
| 需要什麼 | 🟢 **只要 python3**,零網路、零登入 | 🔴 `vercel` CLI + **已登入** + **在主樹跑** + team slug 對得上 |
| Sean 自己跑得動嗎 | 🟢 **可以**,一行 | 🟡 技術上可以(主樹有 `.vercel` · `vercel` 在 `/opt/homebrew/bin/vercel`),**而下面兩格他會卡** |
| 會卡在哪 | — | ① **在 worktree 跑會回 `not_linked`** ② `--scope pcm-motorsports` 是**寫死的**,team slug 不符就 `no_json` |
```
gate.py       python3 scripts/vercel-json-waf-cron-gate.py
order-check   python3 scripts/vercel-firewall-cron-order-check.py     ← 要在主樹
```

### ⚠️ CLI 版本那一格
```
這台機器的 Vercel CLI 是 57.0.0, 而最新是 59.15.1 —— 差兩個大版本
⇒ order-check 吃的是 `vercel firewall rules list --json --expand` 的輸出格式
⇒ 📌 旗標或輸出格式可能已經變了
🟢 而它的失敗形狀是【安全的】:格式一變就走 no_json ⇒ exit 2 ⇒ 它【不會假裝綠】
⚠️ 而「57.0.0」是從本機環境提示讀到的, 【沒有跑 vercel --version 確認】。
```

🔵 **要確認尺本身沒壞,不用碰 live**:兩支都有 `--selftest`,而它是**零對外請求**的
(order-check 的 selftest 自己會印「本次 selftest 對外請求 = 0 次(全吃 fixture)」)。
```
python3 scripts/vercel-json-waf-cron-gate.py --selftest
python3 scripts/vercel-firewall-cron-order-check.py --selftest
```
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

## 2b. 🔴 換到一半發現不對,怎麼退回去

> **[2026-09-11 新增。這是這份文件原本【完全沒有】的一格。]**
> 🎯 而順序改完之後,退路變得很乾淨 —— **因為不可逆的那一步(步驟 3)排在最後。**

### 🟢 在步驟 3(301)【之前】發現不對 ⇒ 退得很乾淨
```
`shop` 還完全活著, 客人一直都在用它, 什麼都沒斷
1  把 www 從 pcm-website-v2 的 Settings → Domains 拿掉
2  NEXT_PUBLIC_SITE_URL 改回 https://shop.pcmmotorsports.com + 重新 build
3  Supabase:2b-a 加的那條 Redirect URL 可以留著(純加、無害);
   2b-b 若已改, Site URL 改回 shop
4  www 要不要掛回 pcm-official-site 由當天決定 —— 客人本來就沒在用它
```
📌 **⇒ 這就是把 301 排最後的全部理由:在這條線之前,每一步都退得回去。**

### 🔴 在步驟 3(301)【之後】發現不對 ⇒ **我答不出來怎麼乾淨地退**
```
🛑 我沒有做過網域搬遷的回退, 也查不到一個「把 301 收回去」的乾淨程序。
   我知道的只有這些, 而它們都【不是答案】:
   · 技術上 301 拿掉就沒了 —— 而 Google 那一側【已經開始把權重搬走】
   · 搬回去要再發一次反方向的 301, 而那等於再搬一次家
   · Search Console 的「變更網址工具」有沒有取消、取消之後會怎樣 ⇒ 🛑 我不知道
   · 那段期間客人拿到的連結、外部網站抄走的連結, 指的是哪一個 ⇒ 🛑 我不知道
```
> ## 🛑 **而「我答不出來怎麼退」本身,就是「301 一定要排最後」最強的理由。**
> 📌 **⇒ 在按下步驟 3 之前,請確認步驟 4.5 與 5a 每一格都是綠的。那是最後一個能反悔的地方。**

⚠️ **這一節有一半是【我答不出來】,而我沒有把它寫成一個看起來完整的程序。**
　 要真的答得出來,需要一個做過網域搬遷回退的人,或 Google 官方對「變更網址工具」可否撤銷的說明。

## 3. 限制(不要把下面讀成結論)

- 全份沒有任何一步是我做過的 —— 這是**寫給那天照著按的**,不是事後紀錄。
- `NEXT_PUBLIC_SITE_URL` 的**現值**我仍然沒讀到(`vercel env ls` 的值欄是 `Encrypted`,只印得出名字)
  ⇒ 「它現在是 `https://shop.pcmmotorsports.com`」仍然是**從 `robots.txt` 的 `Host:` 行反推的**,
  吻合但未證實。**已證實的只有:它存在於 Production。**
- Vercel 網域轉址的畫面與選項名稱我沒有實際操作過。
- 「Google 現在收了幾頁」沒查。
