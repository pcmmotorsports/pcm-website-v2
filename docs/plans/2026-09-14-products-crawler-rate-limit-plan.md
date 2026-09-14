# plan · 商品頁爬蟲(每 2 秒一頁 /products/[slug])怎麼擋 —— 2026-09-14 B 窗

> 主視窗派第 13 件;A 窗 `a26c8e617` 量到「正式站近 7 天 OOM 67 次 / 32 人 + 300 秒逾時 14 次, 全在爬蟲掃商品頁的波段裡」。
> 碰 Firewall / vercel.json ⇒ 鐵則 8, 本檔只 plan 不動碼、不動 dashboard。全部讀數唯讀。

## 1. 今天量到什麼(2026-09-14 19:3x, 唯讀)
- **runtime log(mcp get_runtime_logs, production, 24h)**:`requestPath` 去重 **8,577 個**, 前 25 名之外幾乎全是 `/products/<slug>`;
  15 分鐘窗實例:`11:25:13 materya-mty043 → 11:25:15 motogadget-0003084 → …0003085 → …0003091`(**每 2 秒一頁、slug 依字母序遞增、全部 `cache=MISS`、200**)。
  ⇒ 這是【依 sitemap / 目錄順序掃全站】的形狀, 不是人。
- **🔴 UA / IP / ASN 拿不到**:runtime log(mcp 與 `vercel logs --json`)欄位只有 path / status / cache / branch, **沒有 user-agent、沒有 IP**(實跑 25 秒逐字核過欄名)。
  能看的地方 = Vercel dashboard → 專案 `pcm-website-v2` → **Firewall → Traffic**(依 path 前綴 `/products/` 篩, 看 UA / ASN / IP 排行)—— 那是 dashboard 專屬, 沒有 CLI / MCP 路。**要主視窗或 Sean 開一次, 把前三名 UA + ASN 抄下來, 才能答「正派或野的」。**
  📌 在那之前的判讀(只能推, 不是量到):Googlebot 不會固定 2 秒一頁、依字母序連號掃;這個節奏比較像 Bytespider / 自寫 scraper。
- **正派爬蟲的辨法**(等 Traffic 讀數用):Googlebot / Bingbot 反查 DNS 落在 `googlebot.com` / `search.msn.com`;Vercel Traffic 會直接標 bot 名與 ASN(Google = AS15169)。

## 2. 現有規則(兩支都跑了, 只讀)
- repo `vercel.json`(根 + apps/admin):**零 mitigate 規則**(`scripts/vercel-json-waf-cron-gate.py` 全綠)。
- live Firewall(`scripts/vercel-firewall-cron-order-check.py`, 主樹跑;`vercel firewall rules list --json --expand`)8 條, 全 active:
  ```
  #1 facet-counts rate limit   path eq /api/catalog/facet-counts   rate_limit 20/60s/ip → 429
  #2 Log TapPay notify         path pre /api/checkout/tappay-notify/ log
  #3 Log login requests        path pre /login                      log
  #4 tappay-notify flood       path pre /api/checkout/tappay-notify/ rate_limit 300/60s/ip → 429
  #5 bypass-machine-traffic    path pre /api/cron/                  bypass
  #6 search-log-flood-cap      path eq /search OR path eq /products rate_limit 10/60s/ip → challenge
  #7 login-rate-cap            path pre /login                      rate_limit 10/60s/ip → challenge
  #8 Search rate limit         path pre /api/search                 rate_limit 60/60s/ip → 429
  ```
  🔴 **`/products/<slug>`(單頁)今天沒有任何規則** —— #6 是 `eq /products`(列表頁), 前綴不含斜線後面。

## 3. 怎麼擋(推薦甲;都在 dashboard 加規則, 不動 vercel.json ⇒ 不碰 repo、rollback = 關規則)
**甲(推薦)· 新規則 `products-page-crawl-cap`**:`path pre /products/` ⇒ `rate_limit` 限 **20 / 60 秒 / ip**, 動作 **`rate_limit`(回 429)不用 `challenge`**。
- 為什麼 20:爬蟲 2 秒一頁 = 30 / 分 ⇒ 第 21 頁起 429;真客人一分鐘點開 20 張商品頁極少(手機一頁一頁看 ≈ 3-6 / 分)。
- 為什麼 429 不用 challenge:challenge 是 JS 挑戰, **Googlebot 過不了 ⇒ 商品頁全部從 Google 掉光**;429 對 Googlebot 是「慢一點再來」(Google 官方:429 視為暫時、會自動降速重爬), 不掉索引。
- 放的位置:排在 #5 bypass 之下即可(cron 不走 /products/);與 #6 不衝突(#6 eq 列表頁)。
- 零誤傷的證法(照順序, 每一步有讀數才下一步):
  1. **先用 `log` 動作放 24 小時**(同條件, action=log)⇒ Firewall → Traffic 看「命中這條的 IP / UA」:應該只有那一兩個 ASN;若出現 AS15169(Google)或客人 IP 一分鐘 >20 ⇒ 門檻調高再放一天。
  2. 切成 `rate_limit` 後 24 小時:runtime log `group_by statusCode` 429 應集中在 `/products/`;Search Console → 設定 → 檢索統計「主機狀態」不得出現紅字;`/products/<slug>` 索引數不降。
  3. 自己驗:瀏覽器一分鐘內連開 21 張商品頁 ⇒ 第 21 張 429(證明規則活著);等一分鐘再開 ⇒ 200(證明會放行)。
- rollback:dashboard 把該規則 `active=false`(秒級生效);`vercel firewall rules list` 確認消失。零 repo 改動。

**乙 · 加一條 UA 黑名單 `deny`**(等 Traffic 讀數之後才能寫):`user_agent inc Bytespider / GPTBot / ClaudeBot / Amazonbot / PetalBot`(依讀數挑)⇒ deny。
- 只擋自報身分的;野的換 UA 就繞過 ⇒ 是甲的補充不是替代。零誤傷:Googlebot 字串不在名單。

**丙 · 不擋, 改讓商品頁便宜**(A 窗那條線):PDP 現在每一發都 `cache=MISS`(dynamic);上 ISR / `revalidate` 讓爬蟲打到 cache ⇒ OOM 消失而流量照收。這是根治, 但碰 next 快取策略(鐵則 8 另一份 plan), 與甲不衝突、可以並行。

**不推薦**:`vercel.json` `routes[].mitigate` 寫死在 repo —— 改門檻要重部署, 而 dashboard 秒改秒退;Bot Protection「全站 challenge」—— 會把 Googlebot 一起擋。

## 4. 要主視窗 / Sean 做的
```
Q1: 先去 dashboard Firewall → Traffic 抄前三名 UA + ASN(路徑篩 /products/)?
A: 甲 主視窗抄(推薦)| 乙 Sean 抄
Q2: 甲案的第 1 步(log 動作放 24h)現在就加?
A: 甲 加(推薦, 零風險, 只記不擋)| 乙 等 Q1 讀數再說
```
分片:Q2 甲 = dashboard 一條規則(主視窗按, 5 分鐘);24h 後看讀數 ⇒ 切 rate_limit(再 5 分鐘)⇒ 24h 後看 Search Console。零 commit。
