# admin session 綁環境 + 讓既有票失效 · slice plan(2026-08-19,W5)

> **狀態:等 Sean 批(鐵則 8)。** 命中 **鐵則 12②(權限/auth)** ⇒ 關卡1 / 關卡2 都不降級。
> **片型:高風險片。** 內容分級:不涉可編輯內容 ⇒ **L1**(值寫死在 code、年 0-1 次)。
> **來源**:Sean 2026-08-19 答 `q3=甲`(票裡加環境標記、跨環境的票直接失效)。
> **主視窗裁定**:與「`must_change_password_at` 完全不在路徑上」併成同一份 plan(兩個洞在同一條路上)。
> **審查**:本 plan 出去給 **W6**(寫的人與驗的人分開)。

---

## §0 🔴🔴 R1 對抗審查結果:**FAIL —— 這份 plan 現在【不可以】送 Sean 批**

審查=**W6**(fresh context、唯讀)· 交件 `~/pcm-mailbox/W6-006-審env綁定plan-R1-FAIL-四條-20260819.md`
**4 must-fix + 5 nit。四條我逐條自核過(可機械核的部分),全部成立。**

### 🔴 M1 · fail-closed 會把 Sean 鎖在外面,而且**零逃生門** —— 而真正的病是【順序】

```
proxy.ts:17-18 逐字：DEV_AUTH_BYPASS = NODE_ENV !== 'production' && ADMIN_DEV_BYPASS === '1'
⇒ 正式部署恆 false ⇒ 沒有 bypass
若 turbo 真的濾掉 VERCEL_ENV ⇒ 第一次 production 部署起 signSession 一律回 null
⇒ 🔴 所有人登不進去，唯一復原是改設定 + 重新部署
```
🔴🔴 **而它是一個【死鎖】,這才是 W6 最尖的一刀**:
`§6` 第 9 格我自己寫著「本機測不出來、要一次真的 preview 部署才看得到」
⇒ **要驗它必須先部署,而部署的風險正是它。**

📌 **W6 給的對照,我照抄因為它比我的原話準**:
> `dev-preview/layout.tsx` 那個前例**有 fallback**(`return env.NODE_ENV !== 'production'`)
> ⇒ **同一個未確認,在那裡只會誤殺,在你這裡會鎖門。**
> **你拿掉 fallback 的同時,把那個未確認變成了【承重的】。**

**⇒ 折法(已採納,見 §0.1):先出一片【零風險探針】,拿到答案再落 fail-closed。**

### 🔴 M2 · 路 A 的代價我低估了一個量級,而且不是「改一份 spec」

```
b3-spec:396-397 逐字：「B3（報價單）＝ 直接拒 v:1；B5（admin）＝ 暫時接受 v:1，
                        直到 ADMIN_REQUIRE_REAL_IDENTITY 打開才拒」
⇒ 而我 §3-3 寫的是【無條件立刻拒、零開關】
量法（我自己重跑）：grep -rIl 'ADMIN_REQUIRE_REAL_IDENTITY' docs/specs | wc -l ⇒ 8 份
  ⚠️ W6 報 7 份 —— 差的那一份【就是本檔】：我在 §1 更正裡引了 B5 的政策句，
     於是本檔自己進了分母。🔴 又一次「尺撞到講述它自己的文本」，這次是我讓它撞的。
```
⇒ **路 A 不是「改一句話」,是拆掉一個橫跨 8 份 spec 的漸進切換機制。**
🔴 **⇒ 這件我【不自己拍板】,轉成決策題,見 §0.2。**

### 🔴 M3 · 我自己違反了自己的限縮 —— 而它不在 §6,在正文

我在 §2 寫了⚠️框「本 plan 是洞二的前置不是解、不得勾洞二已修」,
**而正文兩處寫著「那道強制才回到路徑上」** —— **那道強制根本還不存在**:
```
grep -rIl 'must_change_password' apps/admin/src packages --include='*.ts' --include='*.tsx' | grep -vc '\.test\.'
⇒ 0   （我自己重跑過，與 W6 一致）
```
✅ **已折**:兩處都改成「**待 B2 落地之後**才回到路徑上」。
📌 **形狀值得留**:**我寫了一個正確的限縮框,然後在正文裡違反它。**
**框是給讀的人看的,而正文是他真正會照著做的東西。** ⇒ 限縮要寫進**動詞**,不是只寫進框。

### 🔴 M4 · 驗收:無恆綠格,但格 3 會【紅錯地方】,而且缺一格

```
格3（v:1 舊票 → 新驗證端 ⇒ 拒）：若用固定字串 fixture 而測試 secret 與產生它時不同
  ⇒ 它在【簽章】那關就被拒，版本檢查一行沒走到，而測試照樣綠
  ⇒ 修：同一顆 payload 只改 v，並排證 v:2 過 / v:1 拒
缺的那格（W6 N3）：§4.1 只規定 production 那半
  ⇒ 【非 production 而讀不到 VERCEL_ENV】要簽出什麼，沒規定
  ⇒ 若簽出 undefined，就和 turbo-strict 世界的 production 又對上了 —— 正是 §4 開頭要防的形狀
```
✅ 兩者已折進 §6(格 3 改寫、新增格 10)。

### ✅ M5 / N-族 · 轉述的射程限定沒有跟過來

`§2` 洞一那段我只標了【轉述】,而 **W6 原始量測的四條射程限定沒跟著搬**。已補進 §2。
其餘 nit(§4.3 乙沒有 backlog 編號 ⇒ 沒有落點;§3 分母只答「誰簽」沒答「誰驗」)一併折。

---

## §0.1 ✅ 折 M1:本工作拆成【兩片】,探針在前

```
片 0 · 探針（零風險，先做）
  · 只做一件事：在 preview 部署上，把 runtime 讀到的 VERCEL_ENV 值寫進一則既有的 log
    （recordSsoLogin 已有落點，不新增端點、不碰 session、不改 payload、不改 validator）
  · 🔴 它【不會】讓任何人登不進去 —— 因為它不參與簽發或驗證的任何判斷
  · 產出：一個字。'preview' ⇒ runtime 讀得到，陷阱不成立
                undefined  ⇒ 陷阱成立，§4 必須順帶處理 turbo.json（鐵則 12④，另一層批准）
片 1 · 綁定（本 plan 其餘部分）
  · 🔴 前置：片 0 的答案。在它回來之前【不落 fail-closed】
```
🔴 **這正是 W6 說的「病是順序」** —— 原本的順序是「先落一個承重的未確認,再去驗它」。

## §0.2 🔴 決策題(折 M2 之後浮出來的,**我不自己拍板**)

```
本 plan 原設計：v:1 無條件立刻拒（洞二的前置需要它）
既有設計    ：v:1 由 ADMIN_REQUIRE_REAL_IDENTITY 控（橫跨 8 份 spec 的漸進切換）
🔴 兩者不相容，而【拆掉哪一個】不是我該決定的：

甲  保留開關：本片只做 env 綁定（v:2 票必須 env 相符），v:1 仍由開關控
    ⇒ 洞一修掉；🔴 而洞二的前置【沒有達成】（既有票還在）
    ⇒ 漸進切換機制原封不動，8 份 spec 不必改
乙  照原設計：v:1 無條件拒
    ⇒ 洞一 + 洞二前置一起達成
    ⇒ 🔴 代價：拆掉那個漸進切換機制，8 份 spec 要重新對齊
丙  兩段做：先甲（現在），等 B5 時把 v:1 的拒併進開關打開那一刻
    ⇒ 🔴 代價：所有人被登出兩次（正是 §7 一開始要避免的）
我的推薦：甲。理由=洞一的急迫度來自「E8-B 一往前它的賠率就變大」，而那與 v:1 收不收無關；
         而洞二的前置可以掛在 B5 開開關那一刻（本來就會登出一次），不必另外製造一次。
⚠️ 但這一題【要主視窗或 Sean 裁】—— 它決定要不要拆一個橫跨 8 份 spec 的機制。
```

## §0.3 ✅ W6 順手解掉我一格「未解」

`§9-2` 我寫「preview 部署有沒有 Vercel 存取保護 —— 未查」。
**W6 已查**(`W6-002`):三個專案 `ssoProtection.enabled=true` / `all_except_custom_domains`
⇒ **preview 僅限有 Vercel 帳號的人進得去。**
🔴 **這改變的是【急迫度框架】不是【修法】**:洞一的可觸發者從「任何人」收窄成「有 Vercel 帳號的人」
⇒ **仍要修**(帳號會外流、成員會離職、而票是可攜的),**但它不是對外開放的洞。**
⚠️ **射程**:那是 W6 量的,本窗未自量 ⇒ 標【轉述】。

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

### ⛔🔴 2026-08-19 本窗自我更正 —— **上面那段原本把主詞寫錯了,而它是這條線上的第三次**

⛔ ~~**而它有一個【不可分割】的相鄰事實**:`B3` 片本來就要把 payload 升 `v:2`(為了塞 `sub`)。~~
⛔ ~~本 plan 的 v:2 與 **B3** 的 v:2 必須是同一次 bump。~~

🔴 **錯在哪:`B3` 升的是【報價單自己的 cookie】,admin 一個位元都看不到。**
逐字依據(我開檔核過,不是推的)——`docs/specs/2026-08-16-m4b-e8b-b3-spec.md:617`:
> **報價單把它的 payload 升到 `v:2`,admin 一個位元都看不到。「所有人被登出」那件事不會發生。**

**跨 repo 傳的是一份 server-to-server 的 JSON,不是 cookie。** admin 拿到 `amr` + `auth_time` 之後
**自己簽一個全新的 session**(`callback/route.ts:72`),那個 `v` **是 admin 自己給的**。

✅ **真正與本 plan 耦合的是 `B5`**(`plan v4:167` 把 admin 那半放在 B5):
`docs/specs/2026-08-17-m4b-e8b-b5-spec.md:525` 逐字 `export interface AdminSessionPayloadV2 … { v: 2; sub: AdminSessionSub }`。

📌 **而這個錯【B3 spec 自己已經記錄過兩次】**(`:611-615` / `:629-632`):第一次是寫 B3 的人,
第二次是 codex 2026-08-17 抓到,它當場命名為 **「每個字都是對的,只是主詞放錯」**(memory
`feedback_wrong-subject-narration-every-word-true`)。**我是第三次。**
🔴 **可複用的判別句**:句子裡出現「payload / cookie / session / validator」時,**先問【誰簽的、誰驗的】**
—— 這條線上有**兩個 repo 各一套同名的東西**,而它們**從不互相驗**。

### ✅ 更正後的相鄰事實(結論仍成立,而理由換了、而且更強)

```
本 plan 動 admin payload；B5 也動 admin payload（加 sub）⇒ 🔴 同一個檔、同一行（session.ts:131）
⇒ 分兩次 bump ⇒ 所有人被登出【兩次】—— 這一句原封成立，只是對象從 B3 換成 B5
⇒ 而 B5 比 B3 更下游（B5 卡 B4、B4 卡 B3、B3 卡 B2、B2 卡 anon key）
   ⇒ 🔴 等 B5 比等 B3 更久 ⇒ §7 的「現在就做」不但沒被推翻，理由還變硬了
```
🔴 **而【結論對而理由錯】不是沒事** —— 下一個人是照理由決定要不要重看的。所以原句劃掉留著,不刪。

### 🔴 而更正之後浮出一個【原本看不到的衝突】,它要在動工前解掉

```
本 plan  ：v:1 一律拒（既有票全失效 = 洞二的前置）
B5 spec :555 逐字：「ADMIN_REQUIRE_REAL_IDENTITY 開 ⇒ v:1 一律拒；關 ⇒ v:1 / v:2 都收」
         :612 逐字：buildAdminSession 無 sub 時「維持 :93 現行的 v:1 形狀一字不動」
⇒ 🔴 兩份設計對【同一行 session.ts:131】給出不相容的預設
```
**解法(要 W6 / 主視窗核):本片把 `v:2` 定義成「帶 `env`、`sub` 欄保留未用」,
B5 之後【在 v:2 上填 `sub`、不再 bump】。**
⇒ B5 的「開關關 ⇒ v:1 也收」那半**在本片之後失去對象**(本片之後沒有任何東西再簽 v:1)
⇒ **那半要改寫成「開關關 ⇒ v:2 但 `sub` 未填也收」。**
🔴 **這個交接必須寫進 `B5 spec` 那一份,不能只寫在本檔** —— 會踩到它的人讀的是 B5 spec。

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
🔴 **而 W6 原始量測的四條射程限定必須跟著這段走(折 W6 N5;這段會被複製進給 Sean 的摘要,而前後文不會)**:
```
① 只看最近 20 顆部署，【沒有翻頁】
② 「target:null = preview」是【讀欄位語意推的】，不是引官方文件
③ 【沒有去打那個網址】—— 沒有證實它現在活著
④ 別名會不會換【沒驗】
⇒ 這四條在一起的意思是：「preview 部署會自動長出來」這個結論【方向可靠、而細節未坐實】。
```

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

> 🔴 **狀態欄一律寫【仍未修,前置已排除】—— 不得寫「部分完成」**(主視窗 2026-08-19 明文)。
> **理由**:「部分完成」在清單上會被下一輪的人讀成「剩一點點」,而它剩的是
> **B2 落地 + 攔截點要在所有入口之前** —— **那是一整條線,不是收尾。**
> 📌 **半綠的格子比紅的格子危險。**

```
B2 規格要求「首次登入強制改密碼」。而 codex 關卡1 逐字：
  「既有新式 v1 session 或 legacy cookie 已存在時，使用者不必重新登入即可直接打 SSO authorize
   → must_change_password_at 完全不在路徑上。」
```
🔴 **母 plan §6 第 9 條在三天前就逐字寫著「第 9 條是最容易漏的一條」** —— 而它現在仍然是漏的。
📎 全文與「指名一個風險 ≠ 覆蓋那個風險」那條教訓:`docs/reviews/2026-08-19-e8b-forced-password-change-not-on-the-path.md`。

**🔴 兩個洞為什麼是同一份 plan**:它們的修法是**同一個動作** ——
**動 payload / 升版本 ⇒ 既有票全失效 ⇒ 每個人都得重新登入 ⇒ 那道強制【待 B2 落地之後】才回到路徑上。**

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
🔴 **而上面那個分母只答了「誰【簽】」,沒答「誰【驗】」(折 W6 N5)**:
```
grep -rn "verifySession(" --include='*.ts' --include='*.tsx' apps/admin/src | grep -v '\.test\.'
⇒ 真呼叫端 2 處:proxy.ts:40 / authorize.ts:29
```
⚠️ **這不是漏洞**(兩處都在既有授權鏈上),**而不寫出來的話,讀的人看不出 server action 有沒有被涵蓋。**

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
  ⚠️ 而它與甲【不互斥】—— 分離 secret 仍然值得做，只是不能取代甲。
  🔴 折 W6 N4:「列為 backlog」沒有編號 = 沒有落點,那句話講完就消失了。
     ⇒ 本 plan 批准時要【當場開一個 backlog 編號】並把號碼寫回這一行;在那之前這一行是【欠的】。
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
 3  v:1 的舊票 → 新驗證端 ⇒ 🔴 拒
    ⚠️ 🔴 fixture 來源是硬要求（折 W6 N2「紅錯地方」）：
       不得用固定字串當舊票 —— 測試 secret 與產生它時不同 ⇒ 它在【簽章】那關就被拒，
       版本檢查一行都沒走到，而測試照樣綠。
       ⇒ 必須：同一顆 payload、同一把 secret，只改 v，並排證 v:2 過 / v:1 拒
 4  v:2 但【沒有 env 欄】的票                                  ⇒ 🔴 拒
 5  v:2 + env 欄型別不對（number / null / 空字串）            ⇒ 🔴 拒
 6  production build 而讀不到 VERCEL_ENV                       ⇒ 🔴 signSession 回 null（不是簽出 undefined）
 7  ✅ 正向對照：同環境簽、同環境驗                            ⇒ 必須【過】
    🔴 沒有第 7 格，前六格的「全拒」與「這把尺對什麼都拒」印出同一個畫面
 8  callback 在第 6 格的世界裡                                 ⇒ 回 500，且【不清 session cookie】（既有紀律）
10  🔴 【非 production】而讀不到 VERCEL_ENV ⇒ 簽出什麼？（折 W6 N3：§4.1 只規定了 production 那半）
    不得簽出 undefined —— 那會和 turbo-strict 世界的 production 又對上，正是 §4 開頭要防的形狀
    ⇒ 規定：非 production 讀不到 ⇒ 寫入一個【明確且不可能與 production 相同】的值（例：'local'）
 9  🔴 turbo strict 世界的整合驗證：build 後實際讀得到 VERCEL_ENV 嗎
    ⚠️ 這一格【本機測不出來】—— 它要一次真的 preview 部署才看得到
    ⇒ 不得在本機宣稱它通過；驗收表上標【待部署後量】
```

---

## §7 排程與順序(硬的)

```
⛔ 本 plan 的 v:2 與 B3 的 v:2 必須是同一次 bump   ← 🔴 主詞錯，見 §1 自我更正
🔴 正確版：本 plan 的 v:2 與 B5 的 v:2 是【同一行】(session.ts:131) ⇒ 必須是同一次 bump

⇒ 兩條路，擇一：
   路 A  先做本片（只加 env、升 v:2、sub 欄保留未用），B5 之後在 v:2 上【填 sub】不再 bump
         ⇒ 好處：現在就修掉洞一，而且只登出一次
         ⇒ 代價：B5 spec 要改兩處（:555「關 ⇒ v:1 也收」與 :612「無 sub 維持 v:1 一字不動」）
                 🔴 該交接【已經寫進 B5 spec :555 底下】，不是只寫在本檔
   路 B  等 B5 一起做，一次 bump 帶 env + sub
         ⇒ 好處：改一次
         ⇒ 🔴 代價：B5 卡 B4、B4 卡 B3、B3 卡 B2、B2 卡 anon key（正在往 Sean 走）
            ⇒ 洞一在那【四層】前置清完之前一直開著，而 E8-B 每往前一步它的賠率就變大

✅ 主視窗 2026-08-19 裁【路 A】。
⚠️ 而那一裁是在我把 B5 誤寫成 B3 的前提上做的。我更正前提後【重新推導過】：
   路 A 的理由不但沒被推翻，還變硬了（B5 比 B3 多兩層前置 ⇒ 等它的代價更大）
   ⇒ 裁定維持，而【理由已更換】—— 已回報主視窗，由它決定要不要重裁。
   🔴 結論對而理由錯不是沒事：下一個人是照理由決定要不要重看的。
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
1 🔴 turbo strict 會不會咬到這道閘 ——【未確認，而缺的檢查在下面，不是三個字了事】

  🔴 主視窗 2026-08-19 指名了我漏掉的那一層，它把問題問對了：
     turbo 的 strict env mode 濾的是【build 期】的環境變數
     ⇒ 所以真正要分辨的不是「turbo 有沒有濾」，是【這道閘讀 VERCEL_ENV 是在 build 期還是 runtime】
        · runtime（每次請求在 server 上讀）⇒ turbo 濾不到 ⇒ 這個陷阱在本片【不成立】
        · build 期被 inline 進 bundle       ⇒ 成立，而且會恆綠

  ⇒ 缺的那道檢查（可執行，兩個世界會印不同的東西）：
     在一個 preview 部署上讓那段程式把它讀到的值寫進一則 log（recordSsoLogin 已有現成落點）
     ⇒ 印 'preview' = runtime 讀到了，陷阱不成立
     ⇒ 印 undefined = build 期被固定，陷阱成立 ⇒ §4 要順便改 turbo.json
     🔴 這一格【本機做不到】：本機 next dev 與 next build 都讀不到 VERCEL_ENV（它是 Vercel 注入的）
        ⇒ 本機測「讀不到」不能證明部署上也讀不到 —— 那兩個 undefined 來自不同原因

  📎 已有的【部分】證據，不足以結案但值得帶著：
     apps/storefront/src/app/dev-preview/layout.tsx 檔頭記錄它量過 next build 印 `ƒ`（dynamic、非預渲染）
     ⇒ 那些頁每次請求在 server 上跑；而本片的 callback/route.ts 更硬 —— 它自己寫著
        export const runtime = 'nodejs' 與 export const dynamic = 'force-dynamic'
     ⚠️ 但「這條路由是 dynamic」推不出「process.env 一定是 runtime 讀的」
        —— bundler 仍可能把 process.env.X 文字替換掉。⇒ 這是【吻合但未證實】，不是證據。

  ⚠️ 這一格決定 §4 要不要順便改 turbo.json（而那是鐵則 12④ 平台設定，另一層批准）
  ✅ 而【不必等它就能動工】：fail-closed 的方向在兩個世界都安全（讀不到 ⇒ 不簽）
     它影響的是「preview 會不會連坐登不進去」，不影響 production 的正確性
2 preview 部署【現在】有沒有 Vercel 的存取保護 ——【未查】
  它決定洞一今天的可觸發性是「任何人」還是「有 Vercel 帳號的人」，而那影響急迫度不影響修法
3 「所有人被登出」在 Sean 那一刻的實際體感 —— 他正在做的事會不會丟失
  ⇒ 這是產品取捨，不是技術題，要他自己說什麼時候方便
```
