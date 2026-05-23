# M-1-14d-2 交接 Handoff — SupabaseWalletAdapter(PRD §7、從 M-1-14d 拆出)

> **產出:** 2026-05-23 / Claude Code(M-1-14d 收尾後)
> **給誰:** 接手 M-1-14d-2 的新 Claude Code session
> **工作流:** Claude Code 自驅 SOP(CLAUDE.md「Claude Code 自驅 slice SOP」)。對抗審查 `codex-adversary`(雙關卡)+ `code-reviewer`。決策一律白話 prose multi-select 問 Sean。
> **M-1-14d-2 是重大 / 接 DB / 金流 slice** → 鐵則 8 先批 plan;`codex-adversary` 雙關卡(關卡1 plan / 關卡2 diff)+ code-reviewer **不可跳**。

---

## 0. 為什麼拆出(M-1-14d Q1=B 拍板)

M-1-14d 原規劃一次做 4 個 adapter(customer/address/vehicle/wallet)。codex 關卡1 抓到 wallet 與其他 3 個本質不同(混合 auth + 金流),Sean Q1=B 拍板**拆**:M-1-14d 先做 customer/address/vehicle(已 commit、單一 authenticated client、單純 CRUD),wallet 因混合 auth + 金流風險獨立成本段、單獨跑 codex 雙關卡。

## 1. 上一段 M-1-14d 結果 ✅(commit `<<本段 commit hash、見 STATUS>>`)

- `packages/adapters/src/supabase/` 新增 3 mapper(customer/address/vehicle.ts)+ 3 adapter(SupabaseCustomerAdapter/SupabaseAddressAdapter/SupabaseVehicleAdapter.ts)+ 3 mapper test;index.ts export 3 adapter。
- 全單一 authenticated client(RLS 守自己 row);nullable text 欄 `?? ''` 還原;invoice 巢狀↔攤平 5 欄。
- 三綠 typecheck 7/7 + lint 10/10 + build 1/1 + mapper test 23/23;code-reviewer PASS 0 must-fix;codex 關卡2 round2 PASS(round1 抓 customer GRANT 含 updated_at 字面偏離、已修註解)。

## 2. M-1-14d-2 任務目標

把 `IWalletRepository`(packages/ports/src/IWalletRepository.ts)用 supabase-js 實作、接 customer_wallet_ledger 表 + customers 餘額欄。

**產出檔:**
- `packages/adapters/src/supabase/mappers/wallet.ts`(新):`SupabaseWalletLedgerRow` type + `mapSupabaseWalletEntryToDomain` + `mapWalletEntryToInsertRow`
- `packages/adapters/src/supabase/SupabaseWalletAdapter.ts`(新):implements IWalletRepository
- `packages/adapters/src/supabase/mappers/wallet.test.ts`(新、對齊 M-1-14d Q2=A 慣例:mapper 單元測試)
- `packages/adapters/src/index.ts`:export SupabaseWalletAdapter(改 M-1-14d 留的「wallet 拆下一段」註解)

## 3. 落地要點 / 鐵則(codex 關卡1 已預判、務必照做)

### 3.1 ⚠️ 雙 client DI(codex 關卡1 must-fix #1、不可退回單 client)
IWalletRepository JSDoc 明訂:`listEntries` / `getBalance` 走 **authenticated** 自讀(RLS wallet_select_own:auth.uid()=customer_user_id);`addEntry` 走 **service_role** 寫(RLS wallet_insert_service_role、authenticated 無 INSERT GRANT)。
→ adapter constructor 接**兩個 client**:
```ts
constructor(
  private readonly readClient: SupabaseClient,   // authenticated(RLS own、listEntries/getBalance)
  private readonly writeClient: SupabaseClient,  // service_role(ledger INSERT 繞 RLS、addEntry)
) {}
```
**禁**單一 client + JSDoc 說「DI 注入正確 client」:單 authenticated → addEntry 必紅;單 service_role → reads 繞 RLS 可讀任意 customerId。JSDoc 註明雙 client 合約。

### 3.2 getBalance 偏離(codex 關卡1 consider #3、已預判、照做 + 註明)
- balance / totalDeposit 來源 = `customers.wallet_balance` / `total_deposit`(Q1=B trigger 同步、readClient 讀自己 row)。
- lastEntryAt:domain/port JSDoc 字面寫「對齊對帳 view customer_wallet_balance_check」,但該 view **不對 authenticated GRANT**(migration L246-247 註解掉、Phase 1 只 service_role)。→ 改 readClient 直查 `customer_wallet_ledger` MAX(created_at)(`.order('created_at',desc).limit(1).maybeSingle()`)、與 view 的 last_entry_at=MAX(created_at) 語意等價。**commit body + JSDoc 註明此字面偏離**(access GRANT 強制、非自由發揮)。
- customers 查無 row → throw data-integrity error(不 silent 回 0;trigger 保證 valid auth user 有 row)。

### 3.3 其他
- **listEntries 穩定排序**(codex consider #4):`.order('entry_date',desc).order('created_at',desc)`。
- **金額**:amount signed integer(deposit + / use - / refund +、DB CHECK wallet_amount_sign 守);mapper 純傳遞、**不做算術、禁浮點**。
- **ledger immutable**:無 update / delete(DB 無 UPDATE/DELETE policy)、port 也只有 listEntries/addEntry/getBalance。
- **addEntry 後** DB on_wallet_ledger_inserted AFTER INSERT trigger 自動同步 customers.wallet_balance / total_deposit(Q1=B);adapter 不自己算餘額。
- **mapper nullable**:wallet_ledger note NOT NULL DEFAULT ''(`string`)、related_order_id nullable(domain string|null 直送)、entry_date/entry_type/amount NOT NULL。
- 型別 cast 沿用 `as unknown as Row` + backlog #106;PGRST116 處理同 customer adapter。

## 4. 真權威源(grep、不憑記憶)
- DB:supabase/migrations/20260523034911_init_customers_and_subtables.sql(customer_wallet_ledger L99-119 / RLS L207-217 / GRANT L243-244 / view L125-136 + L246-247 / trigger L300-318)+ 20260523052537(ledger COMMENT)
- port:packages/ports/src/IWalletRepository.ts
- domain:packages/domain/src/identity/wallet.ts(WalletLedgerEntry / WalletBalance / WalletEntryType)
- pattern:M-1-14d 已落地的 SupabaseCustomerAdapter.ts + mappers/customer.ts(同款結構、可直接抄)

## 5. 後段排程(停等式逐段)
M-1-14d-2 ✅ 後 → e(use-case:register/login/CRUD/deposit、server 端用 @pcm/schemas re-parse)/ f1(Login·Register·Google OAuth)/ f2(LINE OAuth)/ g(AccountPage 7 tab)/ h(MobileTabBar #158)。M-1-14 整區收完 → 跑 `/pcm-roadmap`(Q2=B)。

## 6. 一句話交棒
> M-1-14d-2 = 把 IWalletRepository 用 supabase-js 實作:**雙 client**(讀 authenticated / 寫 service_role、codex 關卡1 must-fix)、getBalance 走 customers 欄 + ledger MAX(view 不對 authenticated 開)、amount signed int 禁浮點、ledger immutable;重大/接 DB/金流 → codex 雙關卡 + code-reviewer 不可跳、不 push。

— END —
