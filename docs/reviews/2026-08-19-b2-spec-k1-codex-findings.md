# B2 spec · 關卡1 對抗審查 findings(2026-08-19,W5)

> 標的 `docs/specs/2026-08-18-m4b-e8b-b2-spec.md`(521 行)· 審查器 codex `gpt-5.6-sol` · `-s read-only`
> **判定:FAIL —— 21 must-fix + 1 nit。findings 全文逐字轉錄於 §3,一個字未改。**
> 🔴 **本檔只做【落檔】,不做折疊。** 折 findings 是下一輪的工作,而其中數條**折不動**(見 §2)。

---

## §1 🔴 兩件關於【這次審查本身】的事,比 findings 先讀

### 1.1 R1 逾時,而病因可複製:白名單把 codex 的時間吃光了

第一輪我給了 4 支白名單檔(`session.ts` / `exchange.ts` / plan v4 / b1-spec)。
codex 的第一個動作是 `nl -ba` 把**四支整份**灌進 context(b1-spec 一支就 707 行)⇒ **12 分鐘 watchdog 到,零 findings。**

**第二輪改法:白名單降為 0 支,把那 4 支裡【承重的 8 條事實】抽出來寫進 prompt(標 `[F1]`..`[F8]`)。**
⇒ 同一份規格、同一個模型,**38,641 tokens、一輪出 22 條**。

📌 **可複用的判別句:白名單不是「給它資料」,是【給它一件必須先做完的事】。**
**要它審 A,就不要同時要求它自己去讀 B —— 把 B 讀完的結果直接給它。**

### 1.2 🔴🔴 「跑前後 `git status --porcelain` 比對」這道零留痕檢查,**在共用工作樹上天生失效**

`codex-adversary` skill §執行紀律 4 要求跑前後比對 porcelain。**我照做了,而它回了 8 行差異。**

```
跑前 7 行 → 跑後 15 行,新增:
  README.md / docs/PROJECT-OVERVIEW.md / docs/working-style.md / package.json
  docs/proposals/stage-3-bundle-docs-deliverables.md
  docs/specs/2026-08-01-storefront-home-redesign-brief.md
  supabase/APPLIED.tsv
  supabase/migrations/20260819120000_m4b_legal_terms_v3_legal_name.sql
```
🔴 **而那不是 codex 動的** —— 判定依據是**內容不是時間**:
`git diff README.md` ⇒ `- # PCM Motorsports` / `+ # PCM重機零件販售`
⇒ 那是**另一個窗的改名線**(`MAIN-056 §2` `A3`=甲:全樹 91 處都改),`APPLIED.tsv` 那兩支是 legal terms apply 的紀錄。

**⇒ 這道檢查的預設是「這棵樹只有我一個人」,而 PCM 現在七個窗共用一棵。**
```
它會【誤報】：鄰居在我跑審查的那 12 分鐘裡動了檔  ⇒ 我的比對回非空
它會【漏報】：codex 真的寫了某個檔，而同一時間鄰居也在動   ⇒ 我只會看到「一堆差異」，
             而【多出來的那一個是誰的】,porcelain 答不出來
```
🔴 **⇒ 我這次能下「零留痕」是靠【內容歸屬】,不是靠那道比對** ——
每一筆新增都指得出是哪一條已派工的線,且沒有一筆落在 codex 的射程內(它白名單 0 支、`-s read-only`)。
⚠️ **這是一個【比原方法弱】的證據,我照實標。** 要真的強,方法應該是**私有 worktree 跑 codex**,
或比對**只限 codex 可能碰的路徑集合**,而不是整棵樹。
📌 **已交主視窗:這是 skill 層的缺陷,不是我這一次的操作失誤。**

---

## §2 🔴 21 條裡,有一族是【折不動】的 —— 它們指向同一個前置

第 1、4、5 條(以及第 6、20 的一半)全部落在**同一個地方**:
**`anon key` 兩側都零 + GoTrue 的限速鍵/鎖定行為未知。**

⇒ 這一族**不是規格寫得不好,是規格站在一個還沒查過的世界上**。
⇒ **它們的處置是「去查 / 去問 Sean」,不是「改幾行字」。**
📌 而值得單獨記的是:**codex 是在【我沒有叫它下這個結論】的情況下自己走到這裡的** ——
我只在 `[F5]` 給它「anon key 兩側都零」這個**事實**,是它自己推出「那條路根本啟動不了」。
⇒ **兩個獨立來源(我量的 + 它推的)指向同一格 ⇒ 那一格的份量比任何一邊單獨說都重。**

而**另一族是 codex 找到、我完全沒看到的**,其中最重的一條:
> `[must-fix] §3.4「不可能繞過」｜既有新式 v1 session 或 legacy cookie 已存在時,使用者不必重新登入
> 即可直接打 SSO authorize → `must_change_password_at` 完全不在路徑上。`

🔴 **母 plan §6 第 9 條逐字寫著「第 9 條是最容易漏的一條」** —— **而它現在仍然是漏的,codex 獨立撞到同一格。**

---

## §3 findings 全文(逐字轉錄,一個字未改)

FAIL

[must-fix] §3.2、§6①②｜production 沒 anon key、程式也沒 anon client → 個人密碼驗證根本無法啟動。修法：把新增 server-only anon env、逐請求 client、Vercel 設值與實測列為前置部署關卡。

[must-fix] §3.2｜「用 Supabase Auth 驗密碼」未指定實際 API；server 端可用 anon key 呼叫 `signInWithPassword`，但會取得 access/refresh token。修法：明定 token 不回傳、不寫 cookie、不記錄，client 用完即丟棄。

[must-fix] §3.4 改密碼端點｜「用 Auth 管理介面」未決定用已驗證 session 的 `updateUser`，還是 service role 的 `updateUserById` → 施工者可能更新錯使用者。修法：指定唯一 API，且目標 UUID 只能取自同次密碼驗證結果。

[must-fix] §3.5、§6③｜GoTrue 限速的鍵、涵蓋失敗、鎖定時間與是否啟用都未知 → 「平台接手帳號鎖定」目前不成立。修法：四項查清並實測前禁止開工；若不是 per-account，回到方案取捨。

[must-fix] §3.5｜server 代呼 GoTrue 時，平台可能只看到共享的 Vercel 出口 IP → 一人暴力嘗試可耗盡全體登入額度，或分散 IP 繞過 quote 的 per-IP 限速。修法：把實際限速鍵與共享出口壓測列為必要驗收。

[must-fix] §3.4、§4 #21d｜登入與公開改密碼 API 若各自有獨立 per-IP 計數器，攻擊者可在兩端交替猜密碼 → 有效嘗試額度翻倍。修法：明定兩端共用同一限速桶與累計規則。

[must-fix] §3.1、D-2、§4 #14–16｜前文要求具名登入跨多階段維持 account，D-2 又裁定具名登入只准單段 → #14、#15 在裁定後無法構造。修法：刪除舊契約與 #14–15，改驗 `require_2fa=true` 時具名登入必明確拒絕。

[must-fix] §3.3-b、§5｜開啟 `QUOTE_REQUIRE_REAL_IDENTITY` 後，備援登入在新 cookie 基建故障時仍「照舊成功發 legacy」，但接收端立刻拒絕 → 使用者看到登入成功卻永遠進不去。修法：旗標開啟時任何分支都不得新發 legacy，明確回設定錯誤。

[must-fix] §5 部署順序｜先關 legacy「收」而新 cookie 尚未可靠可發 → 全員鎖死；先保留「收」→ 持舊 cookie 者持續無身分進入。修法：補部署矩陣：先部署預設關、驗證新 cookie、處理既有 cookie，再開兩個接收點。

[must-fix] §5、跨 repo 開關｜admin 先開 `ADMIN_REQUIRE_REAL_IDENTITY`，但 B3/B4 尚未送 sub → 所有 SSO 登入失敗；quote 先開但 admin 尚未開 → 無身分操作窗口仍存在。修法：明定 B3→B4→B5 後才開 admin，並列兩顆開關的 rollback 次序。

[must-fix] §3.4「不可能繞過」｜既有新式 v1 session 或 legacy cookie 已存在時，使用者不必重新登入即可直接打 SSO authorize → `must_change_password_at` 完全不在路徑上。修法：加入既有 session 的失效／版本切換方案，或在可取得身分後於 authorize 再查旗標。

[must-fix] §3.4｜session 是 stateless、只認 exp，migration 回填不會撤銷任何既有 session → 最長窗口取決於舊 cookie 到期，而不是首次登入流程。修法：明定 cookie 名稱或版本輪替及切換時間，不能宣稱立即強制。

[must-fix] §4 #10｜未持 session 直接打 `/api/sso/authorize` 本來就會被 middleware 擋住，不論旗標有沒有實作都會綠。修法：測試必先注入「有效但仍被標記須改密碼」的既有 session。

[must-fix] §4 #9｜規格已裁定同一登入頁切換狀態，#9 卻期待「打登入頁就導去改密碼頁」；尚未提交 account 時頁面根本不知道是誰。修法：改成「正確帳密提交後回 409、同頁切表單且零 Set-Cookie」。

[must-fix] §4 #2｜B2 只「算出 sub」但不簽入 payload，若驗收只 mock 內部回傳，即使真正發出的 session 永遠沒有身分也會綠。修法：明定 B2 的可觀察介面契約，並由 B3 整合驗收證明 sub 真正進入 v2 cookie。

[must-fix] §4｜所有格子都用新登入流程時可全綠，但已有 v1/legacy session 的使用者仍能繞過首次改密碼並直接 SSO。修法：新增兩格既有 v1 session、既有 legacy cookie 在旗標切換前後的真實動線。

[must-fix] §3.4 migration｜`DEFAULT now()` 只防漏寫欄位，顯式插入 NULL 仍合法；同時清旗標本來就會製造 NULL → 「零 NULL」只是一次性 migration 斷言。修法：把它明確限定為 seed 驗證，另為新增員工流程加驗收，不得宣稱持續不變量。

[must-fix] D-1 SECURITY DEFINER｜函式未定義參數、目標列、owner 與 `search_path` → 可能清錯人，或形成 search-path 劫持面。修法：固定 schema/search_path，目標 UUID 取自已驗證結果，並精確限制 owner、EXECUTE 與函式簽章。

[must-fix] §3.4｜若 Supabase 允許把新密碼設成舊密碼，旗標仍會被清掉 → 「強制改密碼」名義完成、實際密碼未變。修法：明文拒絕新舊相同，並保留 #21b 作端到端證明。

[must-fix] §3.5｜不存在帳號與錯密碼只規定訊息／狀態碼一致，但 GoTrue 呼叫、映射查詢與 409 分支造成明顯時間差 → 帳號列舉仍可能成立。修法：先定量測門檻；未處理前驗收必標未做，不得稱防列舉完成。

[must-fix] §3.1｜account 未定義長度上限、email 正規化與 Unicode／大小寫規則 → 超長輸入可放大 Auth 請求成本，同一帳號也可能出現不同字面。修法：明定長度、格式及只用 Supabase 回傳 UUID 作身分鍵。

[nit] §8 結尾｜文字仍寫「兩題都沒有自己拍板」，前面卻已標示主視窗裁定甲 → 施工者無法判斷是否仍待決。修法：刪除過期句，留下唯一有效裁定。

---

## §4 用量與紀律

```
tokens used  38,641（第二輪；第一輪逾時未計，那一輪的成本沒有回收）
輪數         R1 逾時（依 skill「逾時=殺掉、只准再窄化重跑一次」）→ R2 出 FAIL
下一步       R1 FAIL 有 must-fix ⇒ 依常載 §5 輪次紀律，修完要跑 R2 確認
             🔴 而 §2 那一族折不動 ⇒ 它們要先變成【給 Sean 的前置】，不是折疊項
零留痕       ⚠️ 見 §1.2 —— 靠內容歸屬成立，不是靠 porcelain 比對
本輪未動      B3 / B4 兩份規格的關卡1 尚未跑
```
