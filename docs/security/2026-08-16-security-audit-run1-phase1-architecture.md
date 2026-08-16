> **這是 `security-audit` skill 的 Phase 1(偵察)產物,不是結論檔。**
> 結論看 `docs/security/2026-08-16-external-exposure-audit.md`。
> 🔴 **Phase 2–6 從未執行** —— 保留本檔的唯一理由是:重跑 Phase 1 很貴,而 Phase 2 需要它當輸入。
> 原位置 `scratchpad/audit-out/run-1/architecture.md`(session 結束即消失),2026-08-16 搬進 repo。
> ⚠️ **本檔原名 `2026-08-17-...`,2026-08-16 由 I 窗更正為 `2026-08-16-...`。**
> 那個 `08-17` 不是筆誤,是 E 窗當時的時鐘偏了約 8 小時(`E-691-STOP` 自述 `timestamp: 2026-08-17T03:50+08:00`),
> 真值三源一致:`date` ⇒ `2026-08-16 19:22 CST`、`git show --format=%ad 4871f25a`、session 環境宣告 `currentDate`。
> 🔴 **`~/pcm-mailbox/E-691-STOP.md:134` 與 `:177` 仍指向舊檔名 —— 已投遞的信不回改,循那兩行找不到本檔,請用新檔名。**

# architecture.md — pcm-website-v2 (audit run-1, 2026-08-16)

## Application

pnpm/Turborepo monorepo for PCM Motorsports — Taiwan motorcycle-parts B2B/B2C commerce.
- `apps/storefront` — Next.js 16.3.0 / React 19.2.6 customer site (catalog, cart, checkout, account)
- `apps/admin` — Next.js 16.3.0 staff back-office (orders, customers, products, shipping, refunds, staff)
- `apps/api`, `apps/sync-engine` — **empty placeholders** (`.gitkeep` + package.json only), not live surfaces
- `packages/{domain,ports,adapters,schemas,ui,use-cases}` — hexagonal layering; `adapters` holds Supabase/TapPay
- DB: Supabase Postgres (Singapore), 179 migrations. Payments: TapPay. Deploy: Vercel `sin1`.
  ⚠️ `README.md:91` says admin is on Railway; STATUS.md implies Vercel. **Contradiction unresolved — treat admin hosting as unverified.**

Baseline comparable: Shopify/Medusa + custom back-office. Divergences the project knowingly accepts:
hand-rolled admin auth, no per-employee identity yet, TapPay notify webhook has **no signature** (compensated by
secret path segment + `timingSafeEqual` + treating the Record API as settlement authority).

## Trust model

| Actor | Surface | Identity proof |
|---|---|---|
| Anonymous shopper | storefront | none (public catalog; Postgres `anon` role) |
| Registered customer | storefront | Supabase `auth.getUser()` (JWT re-verified server-side, not `getSession()`) |
| Staff | admin | SSO to sibling "quote" app → HMAC-SHA256 signed cookie, 12h, `exp` enforced server-side |
| "Actor" (named staff) | admin | 🔴 **self-selected cookie — code states it is NOT an authn/authz boundary** (`apps/admin/src/lib/session/actor.ts:6-7`) |

🔴 **Owner's threat model (north star):** staff are DELIBERATELY not partitioned. Only EXTERNAL access matters.
Dealer/wholesale pricing must never reach a normal customer's browser.

## Enforcement points

- `apps/admin/src/proxy.ts:39-50` — Next 16 middleware. Default-deny; dev bypass requires BOTH
  `NODE_ENV !== 'production'` AND `ADMIN_DEV_BYPASS=1`. SSO allowlist is exactly 2 paths. Matcher covers
  everything except `_next/static|_next/image|favicon.ico` ⇒ **Server Action POSTs are covered.**
- `apps/admin/src/lib/session/authorize.ts:24-35` — shared mutation gate: ① verifySession ② Origin allowlist
  fail-closed ③ named actor. ~20 admin actions call it first.
- Storefront: **no middleware**; each page/action calls `getUser()` and derives ownership from `user.id`,
  never from client input (`account/address/actions.ts:71` etc.).
- `service_role`: factory `packages/adapters/src/supabase/client.ts:60-65` is `server-only`;
  `eslint.config.js:137-152` blocks `apps/storefront/**` from importing it. **Admin is NOT restricted** —
  admin's whole data layer runs RLS-bypassing, so admin protection is app-layer + DB RPC, not RLS.

## Already covered elsewhere — DO NOT re-derive

A live DB-layer audit completed 2026-08-16 (`docs/security/2026-08-16-external-exposure-audit.md`) verified
**against production**: RLS policies, SECURITY DEFINER grants, anon/authenticated table+column privileges,
view `security_invoker`. anon can execute 0 SECDEF functions; 6 customer tables unreachable by anon.
**Do not re-derive these from migrations.** Weight effort toward source-only findings.

## Input surface (condensed)

**Route handlers (11):** admin SSO start/callback; storefront LINE start/callback, Google callback,
catalog facet-counts (public), TapPay notify `[secret]` (POST), order payment-status (auth'd),
3 cron routes (CRON_SECRET Bearer + timingSafeEqual).

**Server Actions:** storefront ~14 (login/register/reset/profile/address/vehicle/cart/checkout);
admin ~25 (staff, supplier, customers, orders, payment, refund, shipping, actor).

**Dangerous sinks — measured, not assumed:**
- `dangerouslySetInnerHTML` ×4, all JSON-LD or a hard-coded SVG path constant; no user input
- markdown/HTML renderer: **zero** (grep `react-markdown|marked|remark|rehype|showdown`)
- shell exec: **zero**; `eval`/`new Function`: **zero** in runtime code
- file upload: **zero**
- raw SQL string building: **zero** (all Supabase `.from()`/RPC)
- non-literal `redirect()`: all routed through `sanitizeNextParam()` / `safeReturnTo()` / prefix allowlists
- Brand rich text uses a custom whitelist parser that explicitly avoids `dangerouslySetInnerHTML`

## 🔴 Phase-1 conflict resolved by direct verification

Recon agent 1c claimed "**all** admin actions call `authorizeAdminMutation` — consistent repo-wide **per code
comments**". Agent 1b claimed `shipping/shipment-actions.ts` does not. **Direct grep settles it: zero hits for
`authorizeAdminMutation|getSessionActor|verifySession|isAllowedOrigin` in that file**, while the control file
`orders/order-actions.ts:6` does import it. **1c generalised from comments and was wrong.**

Affected: `shipment-actions.ts:83,161,178,193,232` (`submitShipment`, `fetchShipmentCandidates`,
`voidShipmentAction`, `unvoidShipmentAction`, `markShipmentShippedAction`).

**Severity already bounded by verified framework behaviour** — do not inflate:
Next 16.3.0 `dist/server/app-render/action-handler.js:446-462` **aborts** a Server Action when the `origin`
header is present and does not match host (`Invalid Server Actions request`, E80). Only a request with **no**
origin header passes with a warning, and such a request cannot carry the victim's cookies.
⇒ **The missing Origin check is NOT an exploitable CSRF hole.** Session is still enforced by `proxy.ts`.
**The genuine residue is audit attribution (no actor binding), not access control.**

## Where to hunt (owner's explicit priorities)

1. Frontend XSS / rendering paths · 2. Server Action authorization, one by one · 3. Open redirect
4. Business-logic & state-machine attacks in order/payment/refund/shipment flows · 5. Cross-layer chains
6. Dependency/supply chain · 7. Anything letting an external party read customer PII or dealer pricing
