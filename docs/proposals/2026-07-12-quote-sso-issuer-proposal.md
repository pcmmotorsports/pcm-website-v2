# 跨 repo 提案:報價單後台=SSO 發起端(M-4a M0 前置)

> 2026-07-12。目的=PRD `docs/specs/2026-07-12-m4a-admin-phase1-prd.md` §3.1「統一入口」:登入報價單後台一次,點選單即進網站後台,不再輸入第二次密碼。
> 動的是**報價單 repo**(`pcm-quote-v2`),故按跨 repo 規則先提案、Sean 批了才動工。網站側對接端點屬本 repo M0,不在本提案。

## 白話

報價單後台加一個「網站管理」選單。點下去的那一瞬間,報價單系統發一張 60 秒有效、用一次就作廢的「號碼牌」,網站後台伺服器拿號碼牌回頭向報價單伺服器換真正的門票。號碼牌就算被截走也沒用(單次、短效、換票要憑兩台伺服器間的暗號)。

## 流程(六步、OAuth authorization code 骨架)

1. 使用者在報價單後台點「網站管理」→ 導向 `admin.pcm…/api/sso/start`
2. admin 產 `state`、寫 state cookie(admin 網域)→ 302 至 `quote.pcm…/api/sso/authorize?state=X`
3. 報價單 authorize:驗自己的 session(未登入先走原登入)→ 產 code(≥256-bit 隨機,DB 只存 hash、TTL 60s、綁 state hash、記 amr/auth_time)→ 302 回 `admin…/api/sso/callback?code=Y&state=X`
4. admin callback:驗 state cookie 相符
5. admin **server-to-server** POST `quote…/api/sso/exchange`(帶 code+`PCM_SSO_EXCHANGE_SECRET`)→ 報價單原子消耗 code(同交易驗證+標記已用;過期/已用/state 不符=拒)→ 回 `{ok, amr, auth_time}`
6. admin 發自己的 `__Host-` session → 303 到 dashboard(URL 乾淨無 code)

反向(網站後台→報價單)第一期=普通連結(報價單 session 還在就直接進),不做反向 SSO。

## 報價單側改動清單(估 1-2 slice)

| 項 | 內容 |
| --- | --- |
| 新表 | `sso_codes`(code_hash PK、state_hash、amr、auth_time、expires_at、used_at、created_at);報價單 Supabase,一張小表、不碰既有表 |
| 端點 A | `app/api/sso/authorize/route.ts`(登入態才可;沿用既有 middleware session 判定) |
| 端點 B | `app/api/sso/exchange/route.ts`(驗 shared secret;原子消耗;失敗一律 401 不洩因) |
| 選單 | 後台導覽加「網站管理」項(連 admin `/api/sso/start`) |
| env | `PCM_SSO_EXCHANGE_SECRET`(與網站 admin 共享)、`PCM_ADMIN_APP_URL`(302 目的地 allowlist,只此一值) |

## 安全邊界(高風險件,實作後必過 Fable 對抗審)

- code 單次+短效+只存 hash;exchange 同交易消耗防併發重放;302 目的地寫死 allowlist(不接受參數傳入 URL);state 防 login CSRF;`Referrer-Policy: no-referrer`;敏感操作另在 admin 側依 amr/auth_time 要求 step-up。
- 不動報價單既有登入/2FA/session 機制,失敗回退=兩邊各自密碼登入照舊。
- secret 輪替 SOP:`PCM_SSO_EXCHANGE_SECRET` 兩邊同批換,寫進 runbook。

## 驗收(逐條 yes/no)

1. 報價單登入態點選單→免密碼進入 admin dashboard
2. 同一 code 重放第二次=401;逾 60s=401;state 竄改=401
3. URL 歷史/伺服器 log 僅見已作廢 code,無任何 session token
4. 報價單既有功能與登入流程零改變(回歸點按驗)

— 等 Sean 批;批後排入報價單 repo session 動工,網站側對接同步排 M0。—
