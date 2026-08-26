# ⛔ 撤回 · `#947` 拆旗標這一片【不該做】—— 它的三個前提都是錯的

> 線3(`pcm-website-v2-6e`)2026-08-27 深夜。**本檔原本是一份實作 plan,現在是它的撤回書。**
> 撤回依據:codex 對抗審查(關卡1,CLI 唯讀模式 `-s read-only`)**FAIL,14 條 must-fix**,
> 其中三條打的是 plan 的**前提**而不是細節。三條我逐條自己重量過,**三條全中**。
> 🔴 **原 plan 內容不留全文** —— 一份前提是錯的 plan,留著只會讓下一個人照它做。
>    保留的是:錯在哪、怎麼量出來的、以及**正確的做法**。

---

## §1 三個前提,逐條被實測打掉

### 前提① 「Origin 閘與登入閘綁同一組條件」⇒ **錯**
```
數法 grep -c "checkProdDbInDev" <三支檔>
  apps/admin/src/lib/session/authorize.ts          ⇒ 0
  apps/admin/src/app/api/session/renew/route.ts    ⇒ 0
  apps/admin/src/lib/dev-auth-bypass.ts            ⇒ 2      <- 只有登入閘查 DB
逐行(sed -n 印過):
  authorize.ts:18   process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1'
  route.ts:79       (同上, 逐字相同)
  dev-auth-bypass.ts:24   return checkProdDbInDev(env).kind === 'ok';
```
⇒ **兩道閘讀同一個 env,而條件不同**:登入閘三條件,Origin 閘兩條件。

### 前提② 「本機只有兩個世界」⇒ **錯,格 C 今天就到得了**
(逃生門的碼與它的射程註在 `apps/admin/src/lib/dev-auth-bypass.ts:14-19`)
承前:`ADMIN_DEV_BYPASS=1` **配一個遠端 DB**(逃生門 `PCM_ALLOW_PROD_DB_DEV=1`)⇒
```
登入閘  isDevAuthBypassEnabled ⇒ DB 不是本機 ⇒ false ⇒ 登入閘【開著】
Origin  authorize.ts:18 不查 DB          ⇒ true  ⇒ Origin【放寬】
= 登入閘開 + Origin 放寬 = 我 plan 裡宣稱「要新增旗標才到得了」的那一格
```
🔴 **我要新增一個旗標,去解鎖一個今天就到得了的狀態。**

### 前提③ 「要拆旗標才量得到續期成功」⇒ **錯**
`proxy.ts:41` 的 bypass **只跳過閘,不注入任何票**;而
`app/api/session/renew/route.ts:84` **自己驗 cookie**。
⇒ **在格 B(旗標開)手動種一張近過期的有效票,route 會真的驗它、真的續它。**
⇒ 我 2026-08-27 那支探針量到 `401 not-active`,原因是**我根本沒種票**,不是閘擋住。

---

## §2 🔴 正確的做法(這才是本檔要留下來的東西)

要量「票快過期 ⇒ 續期成功 ⇒ 沒有導頁」:
```
1. 照原樣起 scripts/admin-probe/up.sh(旗標開, 不改它)
2. 用 ADMIN_SESSION_SECRET 自簽一張【近過期】的 v:2 票, 種進瀏覽器
   ⚠️ HMAC 的 key 不是 secret 本身, 是 `v1:${secret.length}:${secret}:${envTag.length}:${envTag}`
      (lib/session/session.ts getKey;envTag 本機 = 'local')
      —— 上一班在這裡踩過:用原始 secret 簽 ⇒ 三個世界印同一個 303
3. staff 表要有那個人(否則 resolveActiveStaffById 回 null ⇒ 403 not-active)
4. 開頁 → 打字 → 等 → 看 outcome 是不是 renewed、URL 有沒有變、字在不在
🔴 而「票【真的過期】之後」不該期待續期成功:
   proxy.ts:41-64 會先把導頁請求 303 掉;route.ts:84-91 對過期票回 401。
   ⇒ 那一格要驗的是【303/401 + 資料還在】, 不是【續期成功】。兩個不同的宣稱。
```
⇒ **不需要動任何安全邊界。**

---

## §3 另外抓到的、與本片無關而值得留下的一格

**[dev-only,未登記]** `isAllowedOrigin`(`apps/admin/src/lib/orders/workflow-form.ts:50`)
在 devBypass 下接受 `^http://(localhost|127\.0\.0\.1)(:\d+)?$` —— **任何埠**。
⇒ 開發者本機若同時開著一個惡意頁(例如 `localhost:4000`),它可以帶著 cookie 對 admin 發 mutation。
⚠️ **射程**:僅 dev、且要開發者本機正在跑敵意頁面。**我沒有構造攻擊,這是讀碼得到的。**
⇒ 這是**既有**面,不是任何一片新增的;要不要處理由 Sean 決定,不在本檔範圍。

---

## §4 我在這件事上做錯的兩層,寫下來

```
第一層  我把「我量不到」直接讀成「機制擋住了我」, 而真正的原因是【我沒種票】。
        📌 一個 401 有很多種原因, 而我只驗證了其中一種就去改機制。
第二層  我寫了一整份 plan 才去審它。
        ✅ 而這一次流程是對的:高風險片 ⇒ 動手前跑關卡1 ⇒ 它在【零行碼】時擋下來。
        📌 這正是關卡1 存在的理由 —— 先實作再審的話, 要折的就是 14 條 must-fix 的碼。
```
🔴 **最值錢的一句**:它打掉的不是我的寫法,是**我的問題本身**。
   它問「有沒有一條不動安全邊界就能達成同樣目的的路」—— 有,而**我沒問過自己這一題**。

---

## §5 本檔的射程
```
· §1 三格是【量到的】(grep -c 與 sed -n 逐條印過)。
· §2 那份配方我【沒有親手跑成功過】—— 它是審查意見 + 上一班 checkpoint §0-3
  的自簽票經驗組出來的。**下一個人照它做時, 第 2 步最可能卡。**
· §3 是讀碼得到的, 我【沒有構造攻擊】。
· 另外 11 條 must-fix 打的是原 plan 的細節, 而原 plan 已撤回 ⇒ 不逐條折;
  全文在 session log, 未進 repo(⇒ 本檔【不是】那 14 條的完整轉錄, 只轉了前提那三條)。
```

## 對 `#947` 這個編號的處置建議(要 Sean 或主視窗決定,我不自己改板子)
```
甲 關掉 #947, 理由寫「前提被實測推翻, 見本檔」
乙 保留 #947 但改寫成 §3 那一格(dev localhost 任意埠的 CSRF 面)
⇒ 我推薦【甲 + 另開一條給 §3】—— 兩件事不同, 擠在同一個編號裡下一個人會讀錯。
```
