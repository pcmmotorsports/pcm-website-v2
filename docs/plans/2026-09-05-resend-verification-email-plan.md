# Plan · 重寄驗證信的自助入口(`⟦b4-SIGNUPOPEN1⟧` 的前置)

> 線【身分】`-auth` · 2026-09-05 · 主視窗 `-f8` 派(Sean `13.甲` = 要開信箱驗證)
> 🛑 **本檔是 plan,還沒動碼。** 命中**鐵則 8**(跨 6 檔)與**鐵則 12⑤**(對外寄信)⇒ **要批准 + codex。**

---

## 0. 為什麼要有它 —— 而它不是「順便補個功能」

`13.甲` 是 Sean 拍的:**打開 Email 驗證**。而我 2026-09-05 量到那條路**今天是死路**:

```
會被擋   auth-error.ts:30      Supabase 的 email_not_confirmed → email_confirmation_required
        login/actions.ts:33-34 回「請先收信完成 Email 驗證後再登入」⇒ 登入被拒
沒有出口 自助 auth.resend 命中 0 · 後台三個字面開檔看全是【出貨通知】重寄, 與驗證信無關
        🔵 負對照(編造字面)⇒ 0
```
🔬 **數法(2026-09-05 當場跑, 可重跑)**:
```bash
grep -rn 'auth\.resend\|\.resend(' apps packages --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l   # ⇒ 0
grep -rln 'resend\|重寄\|重新寄' apps/admin/src --include='*.ts' --include='*.tsx' | wc -l                            # ⇒ 3, 逐支開檔看
grep -rln 'zzznosuchresendliteral' apps packages | wc -l                                                            # 🔵 負對照 ⇒ 0
```
⇒ 🎯 **開了之後,未驗證的人被擋在門外,而【我們沒有任何工具把他救回來】** ——
他只能自己去信箱找當初那封信。⇒ 📌 **這一片是那個開關的前置,不是它的加值。**

⚠️ **而「今天有幾個人是未驗證」我量不到**:`pcm_readonly` 對 `auth` schema 無權
(實測 `ERROR: permission denied for schema auth`)⇒ **那個數字要 Sean 的後台。**
🔵 **本片不依賴那個數字** —— 0 個人時它是保險,N 個人時它是必要;兩種世界都該做。

---

## 1. 落點(逐檔,而它就是「跨 6 檔」的證據)

| # | 檔 | 動什麼 |
|---|---|---|
| 1 | `packages/ports/src/IAuthService.ts` | 加 `resendSignupConfirmation({email, redirectTo})` |
| 2 | `packages/adapters/src/supabase/SupabaseAuthAdapter.ts` | 實作 = `auth.resend({type:'signup', email, options:{emailRedirectTo}})` |
| 3 | `packages/use-cases/src/resend-signup-confirmation.ts`(新)+ `index.ts` | 照 `request-password-reset.ts` 的形狀 |
| 4 | `apps/storefront/src/app/login/actions.ts` | 加一支 server action |
| 5 | `apps/storefront/src/components/LoginPage.tsx`(245 行) | 錯誤是 `email_confirmation_required` 時多一顆按鈕 |
| 6 | 三支測試(adapter / action / LoginPage) | — |

🔵 **`LoginPage.tsx` 245 行,加一顆按鈕不會過 400** —— 鐵則 6 不觸發。

---

## 2. 🔴 照抄 `forgot` 那條路的**四個非顯而易見的約束**(它們是別人踩出來的,不是我發明的)

`apps/storefront/src/app/login/forgot/actions.ts` 檔頭逐字寫著四條,本片**逐條沿用**:

```
① 帳號列舉防護:通過驗證之後, 不論成功 / 帳號不存在 / 429 rate_limited,
   一律回【同一個空物件】—— 任何分支差異都會讓這頁變成帳號探測器
② redirectTo 只能從 resolveSiteUrl() 組, 絕不可從 request header / host
   —— 那是 /auth/callback 那支記著的一條 codex 關卡2 must-fix
③ resolveSiteUrl() 回 undefined ⇒ throw、不吞 —— 那是站台設定錯誤不是帳號訊號;
   吞掉的話每個客人都看到「信寄出去了」而系統一封都沒寄
④ 留痕但不記 PII:記 outcome(requested / provider_error)與 email【長度】,
   不記 email、不記網域(公司網域會把範圍縮到一間公司)
```

### 🛑 而有一件我要先講清楚,因為它會影響 ① 的價值

**登入頁【今天就已經】分得出「密碼錯」與「沒驗證」** —— 那兩種回不同的字。
🔬 **落點**:`apps/storefront/src/app/login/actions.ts:31-34` ——
`credentials_invalid` ⇒「Email 或密碼錯誤」· `email_confirmation_required` ⇒「請先收信完成 Email 驗證後再登入」。
⇒ 📌 **那本身就是一個帳號列舉訊號,而它比本片早、不是本片造成的。**
⇒ ✅ **本片仍然照 ① 做**(那支 action 可以被直接呼叫,不是只有那顆按鈕會叫它),
　 而**不宣稱「本片讓登入頁不再洩漏」** —— 它沒有。要不要修那個是**另一列**。

---

## 3. 節流 —— 照 Supabase 預設,而**那句話要有內容**

主視窗說「節流照 Supabase 預設」。⚠️ **而我沒有查證那個預設是多少** ⇒ 【未確認】。
✅ **本片的做法**:**不自己加節流**,讓 provider 的 429 走 ①(回同一個空物件)+ ④(留痕)。
🔴 **代價寫出來**:客人連按五次,**畫面五次都說「已重寄」而後面四次其實被限流了** ——
⇒ 📌 **那是 ① 的直接後果**(回應形狀不得有差異),不是疏忽。
⇒ ⚠️ **要不要讓畫面誠實一點,是一個【與帳號列舉防護對衝】的設計題** ——
　 本片**不自己決定**,列進「要 Sean 或主視窗裁的」那一節。

---

## 4. 驗收(每條可 yes/no)

```
1. adapter 測試:呼叫 auth.resend 且參數逐字是 {type:'signup', email, options:{emailRedirectTo}}
   🔴 附一發突變:把 type 改成 'email_change' ⇒ 那一格必須紅
2. action 測試:三個世界(成功 / provider 丟 AuthError / provider 丟 429)
   ⇒ 回傳值【逐字相同】(帳號列舉防護)
   🔴 附一發突變:讓 429 那支回不同的東西 ⇒ 必須紅
3. action 測試:resolveSiteUrl() 回 undefined ⇒ throw(不得回「已寄出」)
4. action 測試:留痕有 outcome 與長度, 而【不含】email 字面
   🔴 負對照:把 email 塞進 log ⇒ 那一格必須紅
5. LoginPage 測試:formError 是「請先收信…」時按鈕出現;是「Email 或密碼錯誤」時【不出現】
6. 三綠 + 動 .tsx ⇒ 加 build
7. 鐵則 12⑤ ⇒ codex 對抗審查, findings 修完才 commit
```

---

## 5. Rollback

碼 revert 一顆(六個檔在同一顆)。**零 schema、零 migration、零 env、零新權限。**
🔵 **而它是【單向門的反面】**:revert 之後回到今天的狀態 —— 而今天的狀態就是「死路」。

---

## 6. 這份 plan 證不到什麼

```
① Supabase 的 auth.resend 對【已經驗證過】的帳號回什麼, 我沒有實測 ⇒ 未確認
   ⇒ 動手第一件事是在拋棄式環境或測試帳號上打一發, 而不是照我的假設寫
② 節流預設值未查證(§3)
③ 本片不修「登入頁分得出密碼錯與沒驗證」那個既有的列舉訊號(§2)
④ 我沒有量「今天有幾個未驗證帳號」—— 那要 auth schema 權限(§0)
```

---

## 7. 要批的兩題

```
Q1: 這片跨 6 檔 + 對外寄信 ⇒ 鐵則 8 + 12⑤。誰批?
    甲 = 主視窗裁(工程範圍內)   乙 = 端 Sean
A: 甲|乙   ← 我推【甲】。理由:它不改任何 Sean 拍過的行為, 只是把他拍的
              「13.甲 開驗證」從死路變成走得通;而它零 schema、零權限、可 revert。

Q2: §3 那個「連按五次都說已重寄」要不要讓畫面誠實?
    甲 = 照 forgot 的形狀, 回應完全一致(推薦)  乙 = 429 時顯示不同的字
A: 甲|乙   ← 我推【甲】。理由:乙會讓這頁變成帳號探測器, 而那正是 forgot 那條路
              用四行註解擋下來的東西;而甲的代價只是「按太快時畫面樂觀」。
```
