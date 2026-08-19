# B3 / B4 spec · 關卡1 對抗審查 findings(2026-08-19,W5)

> 審查器 codex `gpt-5.6-sol` · `-s read-only` · **在 W5 私有 worktree `~/pcm-wt-w5-codex`(detached `a07b2304`)跑**
> **判定:兩份皆 FAIL。B3 = 9 must-fix / 0 nit;B4 = 16 must-fix / 1 nit。findings 逐字轉錄,一字未改。**
> 🔴 **本檔只做落檔,不做折疊。**
> 姊妹檔:`docs/reviews/2026-08-19-b2-spec-k1-codex-findings.md`(B2,21 must-fix + 1 nit)

---

## §1 ✅ 零留痕 —— 這一次它是【真的】證得出來的

`codex-adversary` §紀律 4 那道比對,B2 那輪在共用工作樹上失效(見 B2 findings 檔 §1.2)。
**主視窗 2026-08-19 裁定:跑 codex 一律在私有 worktree。本輪照做。**

```
git worktree add --detach ~/pcm-wt-w5-codex HEAD     ⇒ detached a07b2304
跑前  git status --porcelain | wc -l  ⇒ 0
兩輪後 同一條命令                      ⇒ 0     且 diff 逐行相同
🔴 正向對照:在跑後那份手動加一行假的 ⇒ diff 立刻報差異 ⇒ 這把尺有判別力
```
📌 **差別在哪:B2 那輪我只能靠【內容歸屬】推論(比較弱);本輪是【兩個 0】外加一發負向對照。**
**同一道檢查、同一個人、同一天 —— 換一棵樹,證據強度就從「推論」升到「量到」。**

---

## §2 🔴🔴 三份規格【各自獨立】撞到同一件事:preview 與 production 共用簽章金鑰

這是本輪最值得單獨看的一格。**三份規格是分三次、各自 fresh context 審的**,而:

| 片 | 它自己說的(逐字節錄) |
|---|---|
| B3 | 「Preview 可產生 Production 驗得過的 `v:2 + sub`;**本片把可偽造內容從「已登入」升級成「冒名某員工」,因此更糟**」 |
| B4 | 「preview **現在會成為可簽發具名 sub 的 production 冒名入口,冒名難度降低**」 |

🔴 **而【被冒名的對象】本來不存在** —— 今天 payload 裡沒有 `sub`,能偽造的上限是「一個沒有身分的已登入狀態」。
**這條線做完之後,同一把鑰匙偽造得出「我是 sean」。**
⇒ **⇒ 這不是本線【引入】的漏洞,是本線【把既有漏洞的賠率放大】。** 兩者的處置不同:
前者可以「不要做」;後者**必須在同一條線裡一起修**,否則做完會比不做更糟。

📎 **對應動作**:Sean 2026-08-19 已答 `q3=甲`(票裡加環境標記、跨環境的票直接失效)。
主視窗已把那份 plan 派給 W5,與 `docs/reviews/2026-08-19-e8b-forced-password-change-not-on-the-path.md`
那條**併成同一份 plan**(兩個洞在同一條路上,分兩次做 = 讓所有人被登出兩次)。

---

## §3 B3 findings 全文(逐字,一字未改;9 must-fix)

FAIL
[must-fix] §5-A／§6 第3b、3c格 — rollback 到舊 validator 後，尚未過期的舊 `v:1` cookie 會重新被接受，靜默恢復無身分語意。修法：禁止單獨 rollback verifier；rollback 必須同步換 secret 或提高 `tv/minValidIat` 撤銷全部舊票。

[must-fix] §5-A-1 — 新簽舊驗=`v:2→舊 code` 拒絕；舊簽新驗=`v:1→新 code` 也拒絕，兩者本身都不會靜默放行，但混版流量會形成反覆登入／登出迴圈。修法：部署驗收加入「所有服務實例版本一致」或流量排空 checkpoint。

[must-fix] §5-A／§6 — 真正的靜默放行是 rollback 後的「舊 `v:1` cookie→舊 validator」；現有第3c格只測新票被舊版拒絕，完全沒測舊票復活。修法：新增 rollback 情境，證明舊票仍失效，否則不得宣稱 `v:2` 提供 rollback 保護。

[must-fix] §5-C／§6 — payload `v` 與 token version `tv/ver` 沒有交叉驗收；`v:2 + tv低於floor` 或 `v:1 + tv高於floor` 若被寫成 OR，該失效的票會被另一軸「補回來」。修法：加入四格矩陣並規定兩軸必須各自通過、採 AND 判定。

[must-fix] §5／部署規劃缺環境維度 — Preview 與 Production 共用簽章及 SSO secret，Preview 可產生 Production 驗得過的 `v:2 + sub`；本片把可偽造內容從「已登入」升級成「冒名某員工」，因此更糟。修法：分離環境金鑰，並在簽章 payload 加入且驗證 `aud/env`。

[must-fix] §3.12／§6 — 正文正確區分 `sub` 與 `amr`，但驗收沒有刻意交叉兩軸；把兩者錯誤綁定的 validator 仍可能全綠。修法：加入 `user+pwd`、`user+totp`、`bootstrap+pwd/totp` 等合法交叉組合，分別驗身分閘只讀 `sub`、強度閘只讀 `amr`。

[must-fix] §3、§3.9／§6 — `bootstrap` 是必填 union 的第三分支，但驗收只有 user/fallback；實作若完全拒絕 bootstrap，現有每格仍可全綠，首次建置會壞。修法：新增 `:267` 簽發→`verifySession()` 正向格，以及 `bootstrap` 多帶額外鍵的 exact-shape 負向格。

[must-fix] §3.9／§6 — `:209`、`:221` 的「account 有值必須拒絕、不得靜默降級 fallback」只有文字規定，沒有可跑驗收。修法：兩個呼叫點各測具名請求必拒，並以 account 留空成功簽 fallback 作對照。

[must-fix] §6 第3c格 — 以「B3 commit 的 `HEAD^`」定義舊版，在多 commit 實作或補測 commit 中可能取到半新版本，測綠卻不是實際 rollback artifact。修法：先固定部署前 production SHA，測試與部署紀錄共同引用該不可變 SHA。

---

## §4 B4 findings 全文(逐字,一字未改;16 must-fix + 1 nit)

FAIL

[must-fix] §3、§4、§5 — migration 已上但舊 authorize 發出的碼會是 `sub_kind=NULL`；新 exchange 將它解讀成「回應不含 sub」，但規格沒有禁止 admin 再把「無身分」轉成 `fallback`。修法：明定 NULL 只能代表 legacy/unknown，任何層都不得轉成 fallback，並加跨 repo 驗收。

[must-fix] §4「session 沒有 sub 不給驗收格」— 此狀態在舊 authorize × 新 schema、rollback、部署中 60 秒飛行碼都可達，不是規格宣稱的不可達。修法：恢復 NULL 分支驗收，驗證發碼成功、回應缺欄且不被轉成任何身分。

[must-fix] §7 混版四象限：quote 舊 × admin 舊 — 登入成功但完全沒有 `sub`，規格沒有寫這格是允許的相容基線、暫時風險或必須拒絕。修法：補上端到端預期與允許期限。

[must-fix] §7 格7／§9 — quote 舊 × admin 新時，exchange 不帶 sub，而 F4 的 admin 會收下選填缺席；可能靜默簽出無身分 cookie。修法：實測 callback 最終 cookie/session，明定缺 sub 絕不能被當 fallback，並標示開關前後行為。

[must-fix] §7 格8 — quote 新 × admin 舊只驗「舊 exchange 不炸」，沒有驗 admin 是否忽略新 sub 後仍簽出無身分或錯身分 session。修法：加入真實舊 admin callback 的端到端斷言，而非只測 quote 回應。

[must-fix] §7／§9 — quote 新 × admin 新沒有涵蓋「舊 authorize 已發 NULL code，部署後由新 exchange 兌換」；該碼可成功登入卻遺失身分。修法：加入部署交界飛行碼案例，明定 admin 最終結果。

[must-fix] §7 格9 — 只測「第二次」兌換是 401，抓不到兩個 exchange 同時讀到未使用 code、雙雙成功的競態。修法：以同步屏障並行兌換同一 code，斷言恰好一個成功且成功者取得同一列 sub。

[must-fix] §4、§9 — 沒規定 authorize 必須等含 `state_hash＋sub` 的 INSERT 成功提交後才能把 code 回給瀏覽器；插入失敗或連線中斷可能發出永遠換不到的 code。修法：明定先持久化成功再回 redirect，並以 INSERT 失敗注入驗證不外發 code。

[must-fix] §9 — 沒驗證 code、state 與 sub 必須在同一筆原子寫入；若實作拆成更新，exchange 可在中間讀到 NULL sub 並消耗 code。修法：禁止後補 UPDATE，驗收需證明單次 INSERT 同時落下 code/state/sub。

[must-fix] §9、§10 — preview 與 production 共用 exchange secret，規格沒有 issuer、environment、audience 或 callback 綁定；preview 現在會成為可簽發具名 sub 的 production 冒名入口，冒名難度降低。修法：分離 Preview/Production secret 與資料域，並把環境識別納入 code/HMAC 驗證及負向測試。

[must-fix] §10 — 文字雖區分兩軸，但驗收沒有 `sub_kind='bootstrap'`、`amr=['pwd','totp']` 的不一致合法案例；實作拿 amr 推身分或拿 sub 判強度仍可全綠。修法：加入兩軸刻意不同的交換與 admin session 斷言。

[must-fix] §7 格2、2b — 只驗 authorize 資料列，沒有兌換 fallback/bootstrap；exchange 若一律省略 sub、把 bootstrap 當 fallback，或錯組成 user，現有格仍可全綠。修法：三種 sub 各自完成 authorize→exchange 的逐字形狀驗收。

[must-fix] §7 格8 — 「舊 exchange 不帶 sub」由實作能力決定，規格自己已承認恆綠；它不能證明新欄相容，更不能證明 admin 登入正確。修法：移除該半的通過計分，改驗舊 admin 最終 session/cookie。

[must-fix] §8、§11-5/6 — fallback 發碼成功在 `#647` 前恆真，而真正會攔寫入的應用層規則又不在本片；整張 B4 表可全綠但 `#647` 上線後 fallback/bootstrap 全被擋。修法：把 `#647` 後的整合驗收設為 B4/B7 上線硬閘。

[must-fix] §7 全表 — 所有 quote 端格子都可綠，但 admin 可能忽略 sub、拒絕 bootstrap、把缺席轉 fallback，或簽出無身分 cookie；目前沒有一格檢查最終 admin session。修法：至少加入 user、fallback、bootstrap、NULL 與四象限的跨 repo callback 驗收。

[must-fix] §9 rollback — 規格要求發現「欄在、constraint 不在」立即 rollback，卻沒有可執行的資料庫復原程序；F6 又明定 migration 不能靠 git revert。修法：提供明確、經審查的 forward-repair／rollback SQL、適用前提與驗證查詢。

[nit] §6-(1) — 直接記錄完整 `error.message` 可能把查詢或 schema 細節送進共享日誌。修法：記錄結構化錯誤碼與經清理訊息，不記 code、state、sub 或請求秘密。

---

## §5 用量與紀律

```
B3  52,084 tokens  一輪出 9 條
B4  (未印出數值;輸出檔 52,119 bytes)  一輪出 17 條
    ⚠️ B4 的 tokens used 那一行【我沒抓到數值】⇒ 標未量,不要拿 B3 的數去推它
配方  兩輪都用 B2 R2 那個窄化配方:白名單 0 支、承重事實抽成 [F1]..[F10] 寫進 prompt
      ⇒ 兩輪都【沒有逾時】(B2 R1 給 4 支白名單那次逾時了)
輪次  兩份都是 R1 ⇒ FAIL ⇒ 依常載 §5,修完要各跑一次 R2 確認
      🔴 而本輪【不折】(主視窗裁定:B2 那族折不動的前置正在往 Sean 走,三份一起交)
```

## §6 本檔【沒有】做的

```
· 沒有折任何一條 findings
· 沒有驗證任何一條 —— 它們是 codex 的推論,依據是我餵的 [F1]..[F10]
  🔴 缺的那道:每一條都要回到 code / 真實部署去核。本輪零條被核過
· 沒有動任何 production code
· B5 / B6 / B7 三份的關卡1 仍未跑
```
