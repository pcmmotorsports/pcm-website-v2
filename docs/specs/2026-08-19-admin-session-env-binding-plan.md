# admin session 綁環境 + 讓既有票失效 · slice plan(2026-08-19,W5)

> **狀態:等 Sean 批(鐵則 8)。** 命中 **鐵則 12②(權限/auth)** ⇒ 關卡1 / 關卡2 都不降級。
> **片型:高風險片。** 內容分級:不涉可編輯內容 ⇒ **L1**(值寫死在 code、年 0-1 次)。
> **來源**:Sean 2026-08-19 答 `q3=甲`(票裡加環境標記、跨環境的票直接失效)。
> **主視窗裁定**:與「`must_change_password_at` 完全不在路徑上」併成同一份 plan(兩個洞在同一條路上)。
> **審查**:本 plan 出去給 **W6**(寫的人與驗的人分開)。

---

## §1 🔴 代價與時機 —— **先讀這段,它決定了「現在做」是不是對的**

**動 payload = 現在所有已簽發的票【全部立刻失效】,所有登入中的人被踢回 `/api/sso/start`。**

🔴 **而現在只有 Sean 一個人在用後台。**
```
量法(當場可重跑,值會過期)：
  報價單 auth.users            ⇒ 2 列（sean@… / shopee1@…，兩個都是 Sean 本人）
  「目前沒有任何一筆真實訂單、尚未對外開放」⇒ STATUS.md「全站業務前提」那一行
⇒ 被踢下線的人數 = 1，而那個 1 就是要批准這件事的人
```
**⇒ 代價最低的時刻是現在,而那個「最低」會隨真登入上線消失** —— 員工帳號一開,
同一個動作就變成「全公司在上班時間被登出」。
📌 **這是【做它的理由】,不是它的風險。** 把它寫在第一段,是因為讀的人會先看到「所有人被登出」而卻步。

⚠️ **而它有一個【不可分割】的相鄰事實**:`B3` 片本來就要把 payload 升 `v:2`(為了塞 `sub`)。
```
🔴 兩件事若分兩次做 ⇒ 所有人被登出【兩次】
⇒ 本 plan 的 v:2 與 B3 的 v:2 必須是【同一次 bump】，不是各自 bump
⇒ 這是排程約束，不是偏好；誰先做由 §7 決定
```

---

## §2 兩個洞(**分開列,因為它們的性質不同**)

### 洞一 · 新增一道【今天不存在】的防線:票沒有綁環境

```
現況（我開檔核過，不是推的）：
  apps/admin/src/lib/session/session.ts:41   AdminSessionPayload = { v, sid, iat, exp, amr, auth_time }
                                             ⇒ 🔴 沒有任何一欄說「這張票是哪個環境簽的」
  :112  buildAdminSession() 寫死 v: 1
  :131  isPayload() 第一道就是 if (o.v !== 1) return false
  cookie = base64url(payloadJSON) + '.' + base64url(HMAC_SHA256(payload, ADMIN_SESSION_SECRET))
```
而 `ADMIN_SESSION_SECRET` 在 Vercel 上是**單一條目、`Preview` 與 `Production` 同列**
⇒ **兩環境同一個值** ⇒ **preview 簽的票,production 驗得過。**

🔴 **而 preview 部署【一直在自動長出來】,不是偶爾一台**:
`pcm-admin` 的 production 分支是 `dev`、storefront 的是 `main`
⇒ **對 `pcm-admin` 而言 `main` 是一個 preview 分支** ⇒ **每一次客人站上線,都順手產生一顆後台的 preview 部署**
(別名固定 `pcm-admin-git-main-pcm-motorsports.vercel.app`)。**沒有人要它,也沒有人知道它在。**
📎 出處:W6 量的,經主視窗逐字轉;本窗未自量 ⇒ **標【轉述】**,而它與我自己量到的 env 清單一致。

**🔴 為什麼這件事【必須跟 E8-B 一起做】,而不是排到之後**(這一段是本 plan 的承重點):
```
今天：payload 沒有 sub ⇒ 同一把鑰匙偽造得出來的上限 = 「一個【沒有身分】的已登入狀態」
E8-B 之後：payload 有 sub ⇒ 同一把鑰匙偽造得出來的是 「我是 sean」
⇒ ⇒ 這不是本線【引入】的漏洞，是本線【把既有漏洞的賠率放大】
⇒ 前者可以選擇「不要做」；後者【必須在同一條線裡一起修】，否則做完會比不做更糟
```
📌 **兩份規格各自 fresh context 獨立走到同一格**(`docs/reviews/2026-08-19-b3-b4-spec-k1-codex-findings.md` §2):
B3 逐字「**本片把可偽造內容從『已登入』升級成『冒名某員工』,因此更糟**」;
B4 逐字「preview **現在會成為可簽發具名 sub 的 production 冒名入口,冒名難度降低**」。

### 洞二 · 一道【已經寫好、但根本沒被走到】的防線:強制改密碼

```
B2 規格要求「首次登入強制改密碼」。而 codex 關卡1 逐字：
  「既有新式 v1 session 或 legacy cookie 已存在時，使用者不必重新登入即可直接打 SSO authorize
   → must_change_password_at 完全不在路徑上。」
```
🔴 **母 plan §6 第 9 條在三天前就逐字寫著「第 9 條是最容易漏的一條」** —— 而它現在仍然是漏的。
📎 全文與「指名一個風險 ≠ 覆蓋那個風險」那條教訓:`docs/reviews/2026-08-19-e8b-forced-password-change-not-on-the-path.md`。

**🔴 兩個洞為什麼是同一份 plan**:它們的修法是**同一個動作** ——
**動 payload / 升版本 ⇒ 既有票全失效 ⇒ 每個人都得重新登入 ⇒ 那道強制才回到路徑上。**

⚠️ **而要誠實講清楚射程**:本 plan **不是**洞二的完整修法。
```
本 plan 做到的：把「既有票可以繞過」這個【前提】拿掉
洞二真正的修法：在 B2 落地那道強制，並且攔截點要在【所有入口之前、包含 SSO authorize】
⇒ 本 plan 是它的【前置】，不是它的【解】。不得在驗收表上勾「洞二已修」。
```

---

## §3 要改什麼(四處,全在 admin repo)

| # | 檔案:行號 | 改什麼 |
|---|---|---|
| 1 | `apps/admin/src/lib/session/session.ts:41` | `AdminSessionPayload` 加 `v: 2` 與 `env: string` |
| 2 | `:106-112` | `buildAdminSession()` 寫入 `v: 2` 與當下環境標記 |
| 3 | `:131` | `isPayload()` 改 `o.v !== 2` ⇒ reject;**並新增**「`env` 必須 === 本機當下環境」 |
| 4 | `apps/admin/src/app/api/sso/callback/route.ts:72` | 唯一簽發點,依 §4 改成「取不到環境 ⇒ 不簽」 |

**呼叫點分母(量法,可重跑)**:
```
grep -rn "buildAdminSession\|signSession(" --include='*.ts' --include='*.tsx' apps/admin/src | grep -v '\.test\.'
⇒ 4 行，其中 production 呼叫點只有 callback/route.ts:72 一處（其餘 3 行是定義與 import）
```

### 🔴 §3.1 版本欄與 env 欄【兩個都要】,只加一個不行

```
只加 env 不升 v  ⇒ isPayload() 不檢查未知欄 ⇒ 舊 validator 收下新票、忽略 env ⇒ 保護靜默失效
只升 v 不加 env  ⇒ 舊票失效了（洞二的前置達成），但 preview 仍能簽出 v:2 ⇒ 洞一沒修
⇒ 兩個一起改，而且【同一次】
```

---

## §4 🔴🔴 環境標記從哪裡來 —— 這一格有一個【會讓守門恆綠】的陷阱

**候選 = `VERCEL_ENV`**(Vercel 系統變數:`production` / `preview` / `development`)。
✅ **本 repo 已有前例,不要重新發明**(鐵則 1 精神:先 grep 再寫):
`apps/storefront/src/app/dev-preview/layout.tsx:50` `isDevPreviewReachable()` —— 純函式 + fail-closed + 白名單。

🔴 **而那支檔的檔頭自己寫下了陷阱,逐字**:
> Turborepo 2 預設 **Strict** env mode…「Strict Mode will filter out environment variables that come from
> your CI vendors until you've accounted for them」、而 `VERCEL_ENV` **不在** `turbo.json` 的 build `env` 清單裡

**我當場複量**:`grep -c 'VERCEL_ENV' turbo.json` ⇒ **`0`**。
**正向對照(證明那份清單不是空的)**:`python3 -c "import json,io;print(len(json.load(io.open('turbo.json',encoding='utf-8'))['tasks']['build']['env']))"` ⇒ **26 筆**,而 `VERCEL_ENV` 不在其中。
⛔ ~~本行原本寫「19 筆」~~ —— **那是我目視 `grep -A 12` 前幾行湊出來的,不是數出來的**;實數 **26**。
📌 **形狀值得留:一個【看起來像量過】的數字,來源其實是「我看到的那一段」。** 判別句 = **我這個數字是不是只涵蓋了螢幕上顯示的那一頁?**

**⇒ 這個陷阱在本 plan 裡比在 dev-preview 那片【嚴重得多】**:
```
dev-preview 那片：讀不到 ⇒ 落到 NODE_ENV ⇒ 往【關】的方向倒 ⇒ 最壞情況是 preview 也 404（誤殺，會被發現）
本 plan：       讀不到 ⇒ preview 與 production 讀到【同一個值 undefined】
                ⇒ 兩邊簽出來的票【互相驗得過】⇒ 🔴 這道閘什麼都沒擋，而且不會有任何東西紅
⇒ ⇒ 這正是「恆綠守門」的形狀（docs/patterns/guard-and-instrument-traps.md）
```

### 🔴 §4.1 因此 fail-closed 的方向是【不簽】,不是【給預設值】

```
決定：production build（NODE_ENV==='production'）而讀不到 VERCEL_ENV
     ⇒ signSession 回 null ⇒ callback:72 走既有的 configError() 路徑（500 設定缺漏）
     ⇒ 形狀抄現成的：session.ts:94 adminSessionSecretConfigured() → callback 回 500
🔴 絕不能用 'unknown' / '' 之類的預設值填欄位 —— 那會讓兩個環境又對上。
⚠️ 代價要寫明：這個選擇的意思是「設定沒弄好 ⇒ 後台整個登不進去」。
   而那是【看得見的失敗】，比【看不見的放行】好 —— 這是刻意的取捨，不是疏忽。
```

### 🔴 §4.2 驗收必須有一格證明這把尺【分得出兩個世界】

```
不夠：測 production 票在 production 驗得過（那在閘壞掉時也會綠）
必要：構造一顆 env='preview' 的票 → 在 env='production' 的驗證端 ⇒ 🔴 必須被拒
     並且反向也要一格：env='production' 的票在 preview 端 ⇒ 也必須被拒
     再加一格：turbo strict 把 VERCEL_ENV 濾掉的世界（env 讀不到）⇒ 必須【簽不出】而不是簽出 undefined
```

### §4.3 已評估、**不採用**的兩條

```
乙（Sean 未選）：只把 Preview / Production 的 secret 換成不同的
  ⇒ 便宜，但 preview 部署會【一直長出新的】，它只解「現在那一台」
  ⚠️ 而它與甲【不互斥】—— 分離 secret 仍然值得做，只是不能取代甲。列為後續 backlog，不在本片。
丙：抄報價單的 ver（token_version）做 server 端撤銷
  ⇒ 報價單 lib/session.ts:19 有 ver 欄、:114 驗它，配 SESSION_TOKEN_VERSION_FLOOR + Edge Config
  ⇒ 🔴 admin 沒有那個 store，補一個 = 範圍擴張（而且那是【撤銷】機制，不是【綁環境】）
  ⇒ 不做，但寫下來免得下一個人以為沒人想過
```

---

## §5 🔴 影響面 —— **報價單那一側(另一個 repo,動了不會有東西紅)**

```
🔴 PCM_SSO_EXCHANGE_SECRET 是【兩個 repo 共用】的，而它在 Vercel 上同樣是
   單一條目、Preview 與 Production 同列（我當場量的 env 名單）
⇒ 本 plan【不動】那把 secret，也不動 exchange 協定 ⇒ 報價單端零改動
⇒ 但下面這件要寫進來，因為它會咬到人：
```
| 動作 | 報價單那邊會怎樣 | 有沒有東西會紅 |
|---|---|---|
| 本 plan(只動 admin payload) | **無感** —— 它不解析 admin 的 cookie | — |
| 若有人**順手**把 `PCM_SSO_EXCHANGE_SECRET` 也分環境 | 🔴 **報價單的 exchange 會開始拒 admin** | 🔴 **不會。** 兩邊各自部署、沒有共同測試 |
| 若有人改 `/api/sso/exchange` 的回應形狀 | 🔴 admin `exchange.ts` 壞形狀 ⇒ 整包拒 ⇒ 登入全失敗 | 🔴 **不會** |

🔴 **⇒ 本片的硬規則:不得在同一片裡順手動 `PCM_SSO_EXCHANGE_SECRET` 或 exchange 協定。**
**那是另一片、另一次批准。** 判別句:**我改的東西,對面那個 repo 讀不讀?讀 ⇒ 停下。**

---

## §6 驗收(負向為主;每一格要指得出【它在什麼情況下會紅】)

```
 1  env='preview' 的票 → production 驗證端                    ⇒ 🔴 拒
 2  env='production' 的票 → preview 驗證端                     ⇒ 🔴 拒（反向也要，否則只證明了一半）
 3  v:1 的舊票（正確簽章、未過期）→ 新驗證端                   ⇒ 🔴 拒
 4  v:2 但【沒有 env 欄】的票                                  ⇒ 🔴 拒
 5  v:2 + env 欄型別不對（number / null / 空字串）            ⇒ 🔴 拒
 6  production build 而讀不到 VERCEL_ENV                       ⇒ 🔴 signSession 回 null（不是簽出 undefined）
 7  ✅ 正向對照：同環境簽、同環境驗                            ⇒ 必須【過】
    🔴 沒有第 7 格，前六格的「全拒」與「這把尺對什麼都拒」印出同一個畫面
 8  callback 在第 6 格的世界裡                                 ⇒ 回 500，且【不清 session cookie】（既有紀律）
 9  🔴 turbo strict 世界的整合驗證：build 後實際讀得到 VERCEL_ENV 嗎
    ⚠️ 這一格【本機測不出來】—— 它要一次真的 preview 部署才看得到
    ⇒ 不得在本機宣稱它通過；驗收表上標【待部署後量】
```

---

## §7 排程與順序(硬的)

```
🔴 本 plan 的 v:2 與 B3 的 v:2 必須是同一次 bump
⇒ 兩條路，擇一，要 Sean / 主視窗裁：
   路 A  先做本片（只加 env、升 v:2），B3 之後在 v:2 上【加欄】不再 bump
         ⇒ 好處：現在就修掉洞一，而且只登出一次
         ⇒ 代價：B3 屆時要改「v:2 加 sub」而不是「v:1→v:2」，B3 spec 要跟著改
   路 B  等 B3 一起做，一次 bump 帶 env + sub
         ⇒ 好處：改一次
         ⇒ 🔴 代價：B3 卡在 B2、B2 卡在 anon key（正在往 Sean 走）
            ⇒ 洞一在那段期間【一直開著】，而 E8-B 每往前一步它的賠率就變大
我的推薦：路 A。理由=洞一的嚴重度與 E8-B 的進度【正相關】，而 B2 的前置不在我們手上。
```

---

## §8 Rollback

```
· 本片零 migration、零 DB 改動 ⇒ 可以 git revert
· 🔴 而 revert 的代價與上線一樣：所有人再被登出一次（v:2 票在 v:1 validator 下必被拒）
  ⇒ 不是「無痛回退」，要寫進 commit body
· 🔴 revert 陷阱（母 plan §8 已指名，本片同款）：
  isPayload() 不檢查未知欄 ⇒ 若只 revert validator 而沒 revert 簽發端，
  帶 env 的新票仍然有效、只是 env 被忽略 = 靜默退回無保護
  ⇒ 簽發端與驗證端必須【同一顆 commit】、同進同退
· 最快的止血：換 ADMIN_SESSION_SECRET（全票失效）—— 但那需要 Vercel env 權限
```

---

## §9 我現在答不出來的(不要當成已解決)

```
1 🔴 turbo strict 到底有沒有濾掉 VERCEL_ENV ——【未確認】
  已量到的只有 grep -c 'VERCEL_ENV' turbo.json ⇒ 0（清單裡沒有它）
  缺的那道檢查：一次真的 preview 部署，讀一下 runtime 拿不拿得到
  ⚠️ 這一格決定 §4 要不要順便改 turbo.json（而那是鐵則 12④ 平台設定，另一層批准）
2 preview 部署【現在】有沒有 Vercel 的存取保護 ——【未查】
  它決定洞一今天的可觸發性是「任何人」還是「有 Vercel 帳號的人」，而那影響急迫度不影響修法
3 「所有人被登出」在 Sean 那一刻的實際體感 —— 他正在做的事會不會丟失
  ⇒ 這是產品取捨，不是技術題，要他自己說什麼時候方便
```
