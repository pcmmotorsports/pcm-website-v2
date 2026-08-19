# 後台的門禁【外包給報價單】—— 那是刻意的 SSO,不是漏掉的閘

> 2026-08-19 G6 查證後落檔。**寫這份的唯一理由:下一個查這件事的人會先往 cookie domain 找,而那條路是零命中。**

## 現象(Sean 2026-08-19 逐字回報)

> 「只要我報價單有登入,然後我在報價單有登入的 cookies 狀態下,**直接開啟後台網址(admin) 是可以直接看到後台的**」

## 🔴 它不是 bug —— 三個逐字錨點

```
apps/admin/src/lib/sso/config.ts:1
  「M-4a M0-S3 **SSO 收端設定** —— 報價單發起端 base URL + 換票共享 secret」
apps/admin/src/proxy.ts:8
  「prod **未登入 → 導 /api/sso/start**;dev(NODE_ENV≠production)放行逃生」
apps/admin/src/lib/session/session.ts:11
  「具名身分不在此 payload:**報價單=共用密碼登入**,SSO 只帶認證(amr/auth_time)、**無 per-user 身分**」
```
決策紙本:`docs/proposals/2026-07-12-quote-sso-issuer-proposal.md`
- `:3` 目的逐字:PRD §3.1「統一入口」:**登入報價單後台一次,點選單即進網站**
- `:44` 逐字:**「Sean 已批准(2026-07-12「A」)」**

## ⛔ 而【不要往這裡找】—— 這是本檔存在的主要價值

```
❌ cookie domain 設成 `.pcmmotorsports.com` 讓三站互通
   ⇒ 實查:`cookieOptions` / `domain:` 在 `apps/admin/src/**` ⇒ **零命中**
❌ 兩站共用同一個 Supabase 專案、或後台去驗報價單的 JWT
   ⇒ **後台從來沒有去驗報價單的 token。** 兩邊各自維護 session,金鑰不同也無所謂
```
🔴 **「兩個不同的 Supabase 專案而 session 互通」聽起來像矛盾,而它不是** ——
因為**共用的不是 token,是一條 OAuth authorization code 骨架的換票協定**。
📌 **一個正確的推論掛在一個不存在的機制上,會產生一個看起來很硬的錯誤結論。**

## 實際流程(提案書六步,與 code 逐條對得上)

```
1 未登入打 admin 任一頁     ⇒ `proxy.ts:43` 導 `/api/sso/start`
2 admin 產 state、302 至 quote `/api/sso/authorize`  ⇒ `sso/start/route.ts:35`
  🔴 目的地 host **寫死 env**、不接受請求參數(`config.ts:2` 防 SSRF / open-redirect)
3 報價單驗自己的 session ⇒ 發 code(60 秒、用一次作廢)
4 admin `/api/sso/callback` 驗 state
5 admin **server-to-server** POST quote `/api/sso/exchange`(HMAC,secret <32 字元 fail-closed `config.ts:14`)
6 admin 發自己的 `__Host-` session
反向(後台→報價單)第一期=普通連結,**不做反向 SSO**(提案書 `:19`)
```

## 🔴 而真正要知道的兩個含意

```
① **誰能登入報價單,誰就能進後台。**
   Sean 2026-08-19 逐字:報價單帳號是「**我跟員工**」⇒ 那就是後台現在的門禁名單
② **後台的 session 裡沒有「這是誰」** —— `session.ts:11-12` 逐字:
   報價單=**共用密碼登入**,SSO 只帶認證、無 per-user 身分;
   「操作者是誰」走 `lib/session/actor.ts` 的 **picker**(人自己挑)
   ⇒ 🔴 **稽核紀錄上的「誰做的」不是登入身分,是一個選單挑出來的值**
   ⇒ 修法=**E8-B 真登入**(Sean 2026-08-19 逐字:「等你帳號功能做好開啟就可以關掉員工帳號」)
```

## ⚠️ 一個【提案寫的】與【實際行為】的落差

```
提案 `:12` 的入口是:**在報價單後台點「網站管理」**
而實際上 `proxy.ts:43`:**任何未登入的請求都會被導去 `/api/sso/start`**
⇒ 「直接打 admin 網址」也走同一條路 —— 機制相同,**而入口比提案描述的寬**
⇒ 🔴 不一定是錯的(fail-closed 全站閘的自然結果),
   而**讀提案的人會以為只有選單那條路進得去**
```

## 限定

```
· 全部讀版控內容,**沒有線上試、沒有碰 `.env*`、沒有讀正式站 log**
· 「Sean 那一次走的就是這條路」= **推的**(機制存在 + 設計者自陳 + 現象吻合)
  要坐實得看 `apps/admin/src/lib/sso/security-log.ts` 記在正式站的東西 —— 本檔未讀
```
