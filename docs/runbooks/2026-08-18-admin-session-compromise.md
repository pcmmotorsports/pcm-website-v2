# Runbook · 後台憑證疑似外洩(admin session compromise)

> **建立**:2026-08-18 W6 窗(上線前安全)。**觸發來源**:`docs/security/2026-08-17-pre-launch-must-close-checklist.md` §⑰。
>
> 🔴🔴 **先讀這一句,不然這份檔會害你**:
> **本檔的每一個步驟【都還沒有被執行過】。** 它是從 code 讀出來的推導,不是演練紀錄。
> 「照著做會有效」是**推出來的,不是量到的** —— §5 那一發演練沒跑之前,本檔的效度等於零。
> 📎 這個坑本 repo 踩過:報價單的「全部重新登入」機制寫在文件裡,而 Edge Config 實查**只有一筆 `hello world`**
> ⇒ **那個緊急功能從未被實際執行過**(memory `project_quote-2fa-deployed-but-dormant`)。
> **一份沒演練過的應變文件,和沒有文件的差別只在你以為你有。**

---

## 1. 什麼時候讀這份檔(任一成立)

```
· 後台憑證（cookie 值 / ADMIN_SESSION_SECRET / 報價單那組共用密碼）疑似流出
· Vercel runtime log 出現無法解釋的 sso.login success
· 後台出現沒有人承認做過的寫入（沖銷收款 / 改客戶資料 / 刪收據）
· 共用密碼曾經被貼進任何不受控的地方（截圖、對話、工單、離職員工手上）
```

---

## 2. 🔴 先知道兩件會讓你失望的事

**(a) 踢人只有一招,而且會踢掉【所有人】,包括 Sean。**
後台是 stateless 憑證,**沒有 server 端撤銷**。
```
apps/admin/src/lib/session/session.ts:8-9 逐字
  「無 server 端撤銷 …… 唯有 payload.exp 到期或換 ADMIN_SESSION_SECRET 才失效」
:125 逐字「被竊 cookie 於 exp 前有效,緩解=短 TTL + 換 secret 全域失效」
:39   ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 12   ⇒ 最長 12 小時
```
⇒ **不做任何事的話,那把鑰匙最長還有 12 小時的效期。**
⇒ 而 `#436`(稽核 `p_actor` 可冒名)代表:**入侵者做的事,帳本上可以掛在任何一位員工名下。**

**(b) 事後查得到的東西比你想的少。**
唯一的登入軌跡是 `apps/admin/src/lib/sso/security-log.ts` 寫進 Vercel runtime log 的一行 JSON。
**我方開檔逐欄核過,那一行有什麼、沒有什麼**:
```
有   evt / outcome / request_id / source_app / reason / amr
沒有 🔴 來源 IP、🔴 User-Agent、🔴 是哪個人（source_app 恆為 'quote' 字面，:26）
```
⚠️ **精確一點(2026-08-18 10:18 CST 修,原句我寫得太寬)**:上面說的是**我們自己那行 JSON**。
**Vercel 自己的 log row 另有 `Request User Agent` 與 `Region`**(官方 Log details 表列出的欄位;
🔴 **兩者都不是來源 IP** —— 官方那張表沒有 IP 欄)。
⇒ 準確講法:**UA 與 region 拿得到,「是哪個人」與「來源 IP」拿不到。**

### 🔴🔴 而鑑識視窗是【一小時】—— 2026-08-18 官方文件當場查證,已不是未確認

```
Vercel 官方 Runtime Logs 文件 · Limits 節(last_updated 2026-08-03)
  Hobby                              1 hour of logs      ← 🔴 我們是這個
  Pro                                1 day of logs
  Pro + Observability Plus           30 days of logs
  Enterprise                         3 days of logs
  Enterprise + Observability Plus    30 days of logs
來源 https://vercel.com/docs/logs/runtime  (2026-08-18 10:1x CST 親讀)
方案別=Hobby ⇒ memory reference_pcm-platform-plans-vercel-hobby-supabase-pro
```
🔴 **意思是:一小時內沒有人去看,那次入侵在我們這邊就【沒有發生過】。**
沒有 log、沒有時間、沒有 UA、沒有 region —— 而 `#436` 讓稽核表的「誰做的」也不可信。

🔴 **而「把 log 送到別的地方存」這條路在 Hobby 上【是關的】**:
```
Vercel 官方 Drains 文件 · Usage and pricing(last_updated 2026-07-22)逐字:
  「Drains are available to all users on the Pro and Enterprise plans. …
    If you are on the Hobby or Pro Trial plan, you'll need to upgrade to Pro
    to access non-audit-log drains.」
來源 https://vercel.com/docs/drains  (2026-08-18 10:1x CST 親讀)
```
⇒ **這一格不是「還沒做」,是「這個方案做不到」。**
⇒ **要延長鑑識視窗,只有兩條路**:
```
甲  升 Pro（1 天;+Observability Plus 30 天）
乙  不靠 Vercel log —— 把 sso.login 事件【寫進我們自己的 DB】
    📎 security-log.ts:3-5 檔頭自己就寫著它是「S3b 正式接 admin_audit_log」之前的 stopgap
    ⇒ 乙不是新設計，是那條線本來就規劃好的下一步
```
⚠️ **兩條都要錢或要工 ⇒ 這是 Sean 的決策題,不是施工窗自己能拍的。**
🔴 **而它有時效**:上線之後才升 Pro,**升級前那段時間的 log 已經永久沒了**
(官方那句「limits are applied immediately when upgrading」講的是**往後**,不是回溯)。

---

## 3. 步驟(照順序;每步標證據等級)

### 步驟 1 · 換 `ADMIN_SESSION_SECRET`(唯一確定有效的一招)
```
1-a  本機新生一把:openssl rand -hex 32     ← 🔴 絕不貼進任何對話
1-b  Vercel → pcm-admin 專案 → Settings → Environment Variables
     把 Production 的 ADMIN_SESSION_SECRET 換成新值
1-c  ⚠️ 未確認：換完要不要 redeploy 才生效
```
**為什麼有效(這半是【量到的】,我開檔讀過)**:
`verifySession` 用 `ADMIN_SESSION_SECRET` 驗 HMAC 簽章(`session.ts:124-140`),
金鑰換掉 ⇒ 所有舊 cookie 簽章對不上 ⇒ 回 `null` ⇒ `proxy.ts:38-45` 導 `/api/sso/start`。
**fail-closed**:secret 缺也回 `null`,不會放行。

🔴 **`1-c` 為什麼標未確認,而不是我猜一個答案填進去**:
`session.ts:53-56` 的 HMAC key 是**依 secret 值快取在模組作用域**的
(`cachedSecret !== secret` 才重載)⇒ **code 這一層換值即生效、不需重啟**。
但「Vercel 改了 Production env 之後,**現行 deployment 的函式實例**會不會讀到新值」
是**平台行為,不是我們的 code** —— 我沒有實測,也讀不到那個面板。
⇒ **不要因為 code 那半我講得很篤定,就把平台那半一起當成已確認。**
**保守做法:換完值之後【一律 redeploy】。** 多按一次不會錯,少按一次會讓你以為踢掉了而其實沒有。

### 步驟 2 · 換報價單那組共用密碼
後台的入口是**報價單站的共用密碼 → SSO**(`session.ts:11-12` 逐字)。
⇒ **只換 `ADMIN_SESSION_SECRET` 而不換那組密碼 = 對方重新登入一次就回來了。**
🔴 **兩件事要一起做,順序是先換 secret(踢掉現行 session)再換密碼(堵住重進來的路)。**
⚠️ 那組密碼在**另一個 repo**,操作步驟不在本檔射程 ⇒ 現場要有報價單側的人。

### 步驟 3 · 保存證據(在它被輪掉之前)
```
Vercel → pcm-admin → Logs，撈 evt":"sso.login"，整段【存下來】
🔴 先存再分析 —— §2-(b) 那個保留期未確認，你分析的時候它可能正在過期
```

### 步驟 4 · 清點被動過什麼
```
後台 → 設定 → 稽核紀錄（admin_audit_log）
🔴 而 #436:那一欄「誰做的」可以被冒名 ⇒ 只能當【做了什麼】的清單，不能當【誰做的】的證據
⇒ 逐條拿去跟人本人對:「這筆是不是你做的」。對不上的就是候選。
```

---

## 4. 這份檔**不涵蓋**什麼

```
· storefront 會員側被盜（那是 Supabase 的 session，有它自己的撤銷機制，不走本檔）
· 報價單站本身的應變（另一個 repo）
· DB 層（service_role key 外洩）—— 另一族，見 docs/security/ 的外部曝露稽核
· 對外通報 / 個資法義務 —— 🔴 未查，本檔不假裝有答案
```

---

## 5.0 🔴 演練【前置清單】(2026-08-18 G4;§5 那一發不是說跑就跑)

> 這一節在答一件事:**照 §5 按下去之前,哪些東西要先在手上,否則那一發不是白做就是把自己鎖在外面。**
> 逐條都有「怎麼算數」,不是提醒句。

```
[ ] P1 現在做最便宜 —— 而這一格會過期
    今天後台只有 Sean 一個人在用（memory project_admin-preprod-planning-posture:「後台未啟用、只有 Sean 測試」）
    ⇒ 踢掉所有人的代價 ≈ 0。員工上工之後同一發的代價 = 全公司當下停擺 N 分鐘。
    🔴 這是【現在做】的理由，不是【可以慢慢做】的理由。

[ ] P2 逃生路徑：把【舊的 secret 值】先存下來
    換完之後若登入整條壞掉，唯一便宜的回頭路就是把舊值換回去。
    🔴 ADMIN_DEV_BYPASS 救不了你 —— apps/admin/src/proxy.ts:16-18 逐字：
       「dev 本機須顯式設 ADMIN_DEV_BYPASS=1 才放行；prod(NODE_ENV=production)永遠擋、bypass 無效」
    ⇒ 正式站被鎖在外面時，那條路不存在。

[ ] P3 先抓一個【還沒到期】的舊 cookie —— 那是 §5 步驟③ 的唯一測資
    瀏覽器 DevTools → Application → Cookies → 名字是 `__Host-pcm_admin_sess`
    （量法：apps/admin/src/lib/session/session.ts:38，prod 用 __Host- 前綴、dev 才是 pcm_admin_sess_dev）
    🔴 那個值就是一把 12 小時的後台鑰匙（session.ts:39 ADMIN_SESSION_MAX_AGE_SEC = 60*60*12）
    ⇒ 不貼進任何對話、不寫進任何檔；演練換完 secret 之後它自然作廢。

[ ] P4 量具先在【該綠的世界】表演一次
    換 secret 【之前】就先跑下面這條，必須印 200；印別的 ⇒ 是量具或網址錯了，不是結論。
      curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
        --cookie '__Host-pcm_admin_sess=<剛剛抓到的值>' '<後台網址>/'
    🔴 沒有這一發，換完之後看到 303 你分不出是「secret 換掉生效了」還是「這條命令本來就打不開」。

[ ] P5 順序：換 env 之後【先不要 redeploy】，先跑一次 P4 那條命令
    仍 200 ⇒ 再 redeploy，然後再跑一次 ⇒ 答案是「需要 redeploy」
    已 303 ⇒ 答案是「不需要 redeploy」
    🔴 順序不能顛倒 —— 先按 redeploy，§6 那一格【就永遠問不出答案】，而它是本檔三個未確認之一。

[ ] P6 計時：從「決定要踢」到「舊 cookie 被拒」實際幾分鐘，當場記下來寫回 §5
    出事那天要知道這個數；事後回想的數字沒有用。

[ ] P7 演練【不換】報價單那組共用密碼（§3 步驟 2）
    那是另一個 repo、另一個人、另一個代價。演練只驗 secret 這一發。
    🔴 真的出事時兩件都要做，順序是先 secret 再密碼（§3 步驟 2 已寫）。
```

⚠️ **本清單沒有涵蓋**:對外通報 / 個資法義務(§4 已標未查)、報價單側的操作步驟、DB 層 key 外洩。
⚠️ **P5 量到的答案只對【當下那個 deployment】成立** —— Vercel 之後改行為不會通知我們。

---

## 5. 🔴 演練(**這一節沒跑之前,本檔不算存在**)

上線前要跑一次,而且**兩個世界要印不同的東西**:
```
① 用正常路徑登入 admin，拿到一個【還沒到期】的 session
② 換掉 ADMIN_SESSION_SECRET（＋redeploy）
③ 拿①那個 cookie 再打一次後台

   沒生效 ⇒ 照樣進得去（或畫面正常）
   生效   ⇒ **303** 導向 /api/sso/start
🔴 **~~302~~ ⇒ 303 更正(2026-08-18 G4 當場開檔量)**:`apps/admin/src/proxy.ts:45`
   逐字 `NextResponse.redirect(startUrl, 303)`。**照舊字面去對 302 的人會看到 303 而以為沒生效。**
🔴 ③ 一定要用【舊 cookie】試。用新登入試 = 兩個世界印同一個東西（都進得去），零判別力。
```
**順便會量到的兩件事**(這才是演練真正的價值,不是確認 code 對):
```
· 從決定要踢到真的踢掉，實際花了幾分鐘（出事那天你要知道這個數）
· 全部人被踢掉之後，重新登入需要誰在場、卡在哪一步
```

---

## 6. 收尾:上線前要把本檔的三個未確認關掉

```
[x] Vercel Hobby runtime log 保留期        ⇒ 1 hour（官方文件 2026-08-18 親讀，見 §2-(b)）
    🔴 而 Hobby 也不能開 log drain ⇒ 延長視窗要 Sean 拍板（升 Pro／改寫進自家 DB）
[ ] 改 Production env 要不要 redeploy      ← §3 步驟 1-c；🔴 只有照 **§5.0 P5 的順序**（先不 redeploy 量一次）才問得出來
[ ] 演練跑過一次，把實際耗時寫回 §5        ← 沒跑 = 本檔效度為零
```
🔴 **打勾要附證據(命令 + 看到的輸出),不是把 `[ ]` 改成 `[x]`。**
📄 母清單 `docs/security/2026-08-17-pre-launch-must-close-checklist.md` §⑰
