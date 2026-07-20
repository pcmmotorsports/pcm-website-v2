# #215 tier server 權威治本 — 規劃分析(2026-07-13 Fable)

> Fable 過夜規劃(Sean 選 C)。**核心產出:一個範圍判斷要 Sean 拍 + 治本方案骨架已備。**

## 現況(親讀 `apps/storefront/src/lib/tier.ts`)
- `resolveTierFromRequest`:tier 來源優先序 = `?tier=` override(dev flag `PCM_DEV_TIER_OVERRIDE=1`)> cookie `pcm-tier` > 'general'。只驗字面合法性(general|store|premium_store)、**不查 DB customers.tier**。
- cookie `pcm-tier` **client 可偽造**(`document.cookie='pcm-tier=store'`)。
- 調用點:金額頁面 server component(page.tsx:46 等)決定顯示哪個 tier 的價格。

## 🟢 為何當前無洞(關鍵、常被誤判成緊急)
tier.ts JSDoc L34-35 已載:read 路徑走 `products_public` view(**物理排除 price_store**)+ mapper store/premiumStore 恆 **dummy 0**。→ 偽造 tier 最多看到「店價 NT$0」破圖,**看不到真經銷價**。當前 cookie 偽造**零經銷價洩漏**。

## 🔴 威脅在未來(M-2-08 引爆點)
**接真 tier-aware pricing(讀真 price_store)之前**,tier 必須改 server 認證。否則接了真經銷價、又沿用 cookie → 一般會員偽造 cookie 即取真經銷價 = 違反最高安全鐵則(CRITICAL)。

## 🔴 範圍判斷(要 Sean 拍)— #215 與 M-4a 客戶線 tier 片是「兩件事」
PRD §5 L90 寫「tier 變更同 slice 治本 #215」,但親查後這是**兩個不同路徑**:
- **M-4a 客戶線 tier 編輯片**(後續片、高風險件#3)= 後台 admin **寫** customers.tier(service_role + 稽核 + step-up)。**可獨立做,不需 #215 前置**(後台寫走 admin service_role、不涉前台 cookie)。
- **#215** = 前台 storefront **讀** tier 改 server 認證。真正必修時機 = **M-2-08 接真經銷價前**。

當前:客戶線第一片=列表(WIP、唯讀顯示 tier),完全不涉 tier 編輯或 #215。

**張力**:後台改了某會員 tier,前台要正確反映得靠 #215(server 讀真 tier);但當前前台即使讀對 tier,經銷價也是 dummy 0(沒接)→ 後台改 tier 現在對前台**無實際 pricing 效果**,要等 M-2-08。

## 決策題(給 Sean)
```
Q: #215(前台讀 tier 改 server 認證)現在做,還是延到 M-2-08?

A(Fable 推薦): 延到 M-2-08(接真經銷價)時一起做,現在保持 tier.ts 釘樁。
   理由:當前零洩漏、#215 是 M-2-08 前置非 M-4a 前置;M-4a 後台 tier 管理
   可獨立做,前台反映等 M-2-08 才有實際意義;現在動 = 跨 app 提前改 storefront、
   M-4a 範圍膨脹、改了也沒 pricing 效果。分離關注點更乾淨。

B: 現在隨 M-4a tier 片一起做,一次收乾淨「tier 端到端可信」。
   理由:治本方案已備、storefront 有現成 pattern、成本可控;避免 M-2-08 又動一次。
   代價:M-4a 動到 storefront(跨 app)、範圍變大。
```

## 治本方案骨架(若做、A 或 B 都用這套)
```ts
// resolveTierFromRequest 改收 supabase server client(取代 cookieStore):
const { data: { user } } = await supabase.auth.getUser();   // 認證、非可偽造 getSession
if (!user) return 'general';                                 // 未登入恆 general(快路徑)
const { data } = await supabase.from('customers')
  .select('tier').eq('user_id', user.id).single();
try { return data?.tier ? designTierToSchema(data.tier) : 'general'; }
catch { return 'general'; }                                  // fail-closed
// cookie pcm-tier 移除為 tier 來源;?tier= override 保留 dev flag only
```
- **先例**:checkout/page.tsx:32、account/page.tsx 已用 `getUser()` 守門;charge-actions「userId=getUser().user.id、不信 client」同模式。
- **影響面**:resolveTierFromRequest 簽章改(收 client)、調用點(金額頁面)注入 server client、per-request 快取避免每頁重複 getUser、移除 cookie 依賴。
- **驗收**:未登入→general;登入會員→查真 tier;偽造 cookie `pcm-tier=store`→仍 general(不再信 cookie);三綠+完整 vitest+經銷隔離不回歸。
- **風險等級**:高風險件#3(經銷價保護鏈)→ 若做,plan + Fable 對抗審 + codex 雙關卡(PRD §7)。

## 連動
memory [[security-audit-2026-06-05-dealer-price-chain]](H-1 原始稽核)、[[m4a-admin-phase1-decisions]](客戶線 tier 片)、tier.ts JSDoc L31-38(釘樁)。M-2-08=前台真經銷價 pricing slice(#215 的真正觸發)。
