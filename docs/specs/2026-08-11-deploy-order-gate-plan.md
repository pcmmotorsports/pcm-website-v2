# 部署時序 gate — 片級 plan **v3**(Q26=A)

> **v1→v2 是被關卡1 打掉重畫的**:codex 對 v1 開 11 條 must-fix,其中一條(§3 閘 A 走一遍 A9h 實際動作序列)
> 證明 **v1 的閘 A 擋不住 A9h** —— 寫一行 `APPLY-ORDER: migration-first` 就放行、然後忘記 `db push`,
> 事故原封不動地重演。**一個擋不住它宣稱要擋的事故的閘 = 儀式**,所以 v1 的核心機制整個換掉,不是修補。
> v2 的差別:**閘 A 改成查「repo 內可查的 apply 帳」的真互鎖**,`migration-first` 這種不可驗的宣告**取消**。
> 逐條回應在 §9。
>
> **v2→v3**:關卡1 R2 又開 8 條,其中 **#3 再次致命** —— 「`flag-guarded <任一預設 off 的 flag>`」
> 可以隨便指一支**與本次改動無關**的 flag ⇒ A9h 換一行合法宣告照樣重演。
> 兩輪下來的共同結論:**只要「例外」是靠人打字宣告的,它就會是儀式**。
> v3 因此把例外整個拿掉,改成**物件層級的比對**(見 §3);flag registry 那條(v2 的閘 B)**整片取消**。
> 🔴 **關卡1 已用滿 2 輪且未收斂 ⇒ 照紀律停下,把決策題交給 Sean(§8),批准前不動手。**

> **標的**:把「**應用層不得先於它依賴的 migration apply 上線(或掛預設 off 的 flag)**」從「靠人記得」變成機制。
> **拍板來源**:`STATUS.md:23` 逐字「Sean Q25=三支 go/**Q26=A 建部署 gate**……Q26=A 的 gate 片排 P 2c 後」。
> **事故本體**:2026-08-07 A9h-1 —— app 層先上、`a9h_m` 未 apply ⇒ 正式站採購 upsert 回 `PGRST202`、**壞約 8 小時**;
> **那一夜跑滿了審查鏈、三綠全綠、harness 全格,沒有任何一道看得見它**(memory `feedback_app-layer-must-not-ship-before-migration-apply`)。
> **片型**:高風險片(鐵則 12④ 平台設定=動 `.husky/` 與 `.github/workflows/`)+ 鐵則 8(跨 3+ 檔)⇒ **plan 先過關卡1 與 Sean 批准,批准前零實作**。
> **內容分級**:L1(規則與腳本,不是後台可編輯內容)。

---

## §1 現況實查(每條可複跑;這片能掛在哪,由這六件決定)

| # | 事實 | 座標 |
|---|---|---|
| 1 | CI 只有 typecheck / lint / vitest(+裝 chromium),**零 migration 相關檢查**(全檔 51 行) | `.github/workflows/ci.yml:35`(Typecheck)`:38`(Lint)`:51`(Test) |
| 2 | 另一條 CI 是 prod-build E2E,打的是 `NEXT_PUBLIC_SUPABASE_*`(anon 層),**不看 migration 狀態** | `.github/workflows/e2e-prod.yml:67-77` |
| 3 | `pre-commit` = reviewer-gate + lint-staged;**`pre-push` 只有 `pnpm typecheck && pnpm lint`(整支就一行)** | `.husky/pre-commit`、`.husky/pre-push:1` |
| 4 | reviewer-gate 的形狀可直接沿用:staged 命中路徑清單(`:39` 的 `^(apps\|packages\|supabase\|scripts\|\.github)/` 加根層平台設定)就要求「第一行=當下 HEAD」的標記檔(`:45`),否則 `:57` `exit 1` | `.husky/reviewer-gate.sh:39/:45/:57`(全檔 57 行) |
| 5 | **repo 內沒有「已 apply 到哪」的可查帳**:唯一寫著 ledger 尾的是一行**寫死的字面**,而且已經過期(寫 `20260731120000`,實際已 apply 到 `20260811100000`) | `scripts/a7c-preflight.sh:98-101` |
| 6 | 部署後的觀測點**已經有一個能用的先例**:真打正式站 PostgREST、對 `PGRST202` 專門判讀、只 `grep` 單顆 env 不 `source` | `scripts/269b-gate.sh:1-40` |

**現有 flag 慣例**(三處都是嚴格 opt-in、只認字面):
`apps/storefront/src/lib/payment/three-ds-flag.ts:19`(`=== 'true'`)、
`apps/storefront/src/app/api/cron/settle-sweep/route.ts:105`(`!== 'true'` 就 no-op,檔頭 `:10` 明寫這是「4a migration 未進 prod 時的 sequencing gate」)、
`apps/admin/src/lib/payment/refund-ui-flag.ts:22`(`=== '1'`)。⇒ **「掛 flag」在本 repo 已是成熟做法,不需要發明新機制。**

**部署拓樸**(決定 gate 掛哪一側):
- storefront `pcm-website-v2`:production = **`main`**;`dev` push 只有 preview ⇒ **上線動作 = `git push origin dev:main`**。
- admin `pcm-admin`:production branch = **`dev`** ⇒ **上線動作 = `git push origin dev`**(push 即上線)。
(memory `project_deploy-topology-main-stale-dev-live`、`project_pcm-admin-production-tracks-dev`)

---

## §2 🔴 要更正前一版立法草案的一句「做不到」

`docs/reviews/2026-08-07-night-legislation-draft.md:300` 逐字:

> **做不到的那半**:真正要擋的是「應用層 deploy 早於 migration apply」,而 deploy 發生在 Vercel、
> apply 發生在 Sean 手動 `db push`,**兩者都不經過 git**,repo 側的 hook 對它們沒有觀測點。

**「deploy 不經過 git」不成立**。兩個專案的 production 部署**都由一次 git push 觸發**:
storefront = `push origin dev:main`、admin = `push origin dev`(§1 拓樸)。
⇒ **`pre-push` 是 deploy 面「目前唯一實際在用的觸發路徑」上的觀測點**,而且它拿得到這次要推的 ref 範圍
(git 由 stdin 餵 `<local-ref> <local-sha> <remote-ref> <remote-sha>`)。
🔴 **收窄(關卡1 must-fix,成立)**:它覆蓋的只有「**這台機器、這個 clone、沒繞 hook 的 git push**」。
**看不到**:GitHub 網頁端 merge/PR、Vercel dashboard 的 Redeploy 按鈕、Vercel API/CLI 部署、別台機器 push。
⇒ 本 plan 一律**不寫**「deploy 面已被機制覆蓋」,只寫「本機 push 這條路徑被覆蓋」;其餘路徑屬**知情缺口**,列在 §6。
草稿把「Vercel 在別處建置」與「觸發它的動作在本機」混為一談 ⇒ 把一個做得到的機制寫成做不到,
而 §4 機制優先律的判準正是「機制做不到才寫規則文字」——**這句話直接決定了那條教訓最後只落成文字**。

⚠️ 誠實邊界(這條**不**因此變成完美機制):
`--no-verify` / `HUSKY=0` 繞得過(與 reviewer-gate 同一個天花板)、Sean 從別台機器或 GitHub 網頁操作時 hook 不在、
而 `db push` 那一側仍然完全在 git 之外。⇒ **pre-push 擋的是「順序寫錯」,不是「有人存心繞過」。**

---

## §3 設計(v3):**一道閘,物件層級,零宣告**

### 兩輪關卡1 逼出來的判準
- v1 用「commit body 宣告」⇒ 打一行就過(R1 走 A9h 序列證明擋不住)。
- v2 用「宣告 + flag registry」⇒ 隨便指一支無關的預設 off flag 就過(R2 #3)。
⇒ **凡是「靠人宣告」的例外都是儀式。v3 不留任何宣告欄位。**

### 閘的形狀(純文字、零網路、可離線)

1. `PENDING` = `supabase/migrations/*.sql` 的版本號 **減去** `supabase/APPLIED.tsv` 已記錄的版本號。
   `APPLIED.tsv` 一行=`版本號<TAB>檔案 sha256<TAB>apply 時間<TAB>誰`,**含檔案雜湊**
   (R2 #2:只記版本號的話,同版本號的檔案內容事後被改動、或正式庫被 restore,`PENDING` 會錯算成空)。
2. 對每一支 pending migration,抽出它**新建的具名物件**:`CREATE (OR REPLACE)? (FUNCTION|TABLE|VIEW|INDEX|TYPE)` 的名字、
   以及 `ADD COLUMN <name>`。這是純文字抽取,不需要連 DB。
3. 取 push 範圍的 **app 面 diff**(`apps/**`、`packages/**`,排除 `*.test.*`),
   若其中**出現任何一個那些物件名的字面** ⇒ **擋**(`exit 1`),訊息列出:哪支 migration 未 apply、命中哪個物件名、在哪個檔。
4. 沒命中 ⇒ 放行。**沒有宣告欄位、沒有例外語法。**

**為什麼這個版本擋得住 A9h**:當天 `a9h_m` 新建的 RPC 名字,**逐字出現在**同一批 app 層的呼叫端 ⇒ 命中 ⇒ 擋。
**為什麼它不會過度攔截**:別的窗同時推的無關 admin UI 變更不含那些名字 ⇒ 放行(v2 的 repo-global 判準會誤擋它們)。

### 範圍與 ref 的正確讀法(R2 #1)
判定一律以 **pre-push 的 stdin 每一行的 `local_sha`** 為準(不是工作樹、不是 `HEAD`),
並逐行處理多 ref;`local_sha` 為全 0(刪除 ref)= 跳過。⇒ `push origin dev:main` 這種**非 HEAD ref** 也要正確。

### 例外怎麼走(不在 hook 裡)
要「app 層先上但掛 flag」是**合法且必要**的做法,但 hook 證不到 flag 真的包住 code ⇒
v3 **不提供 in-hook 例外**:走 `--no-verify`,並要求在 commit body 寫明理由。
**這是刻意的**:讓「繞過」留在人的動作裡、看得見,而不是變成一個打字就過的欄位。

---

## §4 驗收條件(v3)

1. **A9h 回歸**:用當天的檔案組合(migration 新建 RPC + app 層呼叫同名)造 push ⇒ **紅**,訊息點名該 RPC。
2. **物件層級不誤擋**:同一批 push 含**無關**的 app 變更(不含任何 pending 物件名)⇒ 綠。
3. **APPLIED 翻面**:把該 migration 連同**正確的 sha256** 寫進 `APPLIED.tsv` ⇒ 綠。
4. **sha 漂移**:`APPLIED.tsv` 有那一行、但 migration 檔內容被改過(sha 不符)⇒ **紅**(R2 #2)。
5. **ref 範圍**:`dev:main`(非 HEAD ref)、多 ref、一次推多顆、`local_sha` 全 0 四種各一格。
6. **突變**:每一段(PENDING 計算 / 物件名抽取 / app 面過濾 / sha 比對)各一發;
   **每發的預期紅格由實跑決定、不由推測填**(R2 #6 指出我 v2 的突變預期是猜的)。
7. `bash -n` + 三綠;hook 用 `git push --dry-run` 對真 remote 實跑。

---

## §5 rollback 與風險
- **rollback**:純加法(`.husky/pre-push` 追加一行、新增 gate 腳本、新增 `supabase/APPLIED.tsv`)⇒ `git revert`;零 DB 面。
- **風險**:①誤擋(物件名剛好是常見字,例如 `orders`)⇒ 抽取時只取**新建**的物件、且比對要求完整識別字邊界;
  ②`APPLIED.tsv` 的真實性靠 apply 停點的人(見 §6-2);③擋到 Sean 推版 ⇒ 訊息給兩條出路 + 明說 `--no-verify`。

---

## §6 知情缺口(寫下來,不假裝覆蓋)
1. 只覆蓋**本機 git push**;GitHub 網頁 merge / Vercel Redeploy / Vercel CLI / 別台機器 **看不到**(R1 #1)。
2. `APPLIED.tsv` 是**自陳帳**:更新了卻沒真 apply、或正式庫事後被 restore/rollback ⇒ 攔不到(R2 #2 的殘餘)。
   本片**不**驗證帳與庫一致;那要連正式庫,屬拆出去的 apply-smoke 片。
3. 證不到「app 層那半有沒有被 flag 包住」⇒ 所以 v3 乾脆不給 in-hook 例外。
4. 反向事故(migration 先上、舊 app 撞 `PGRST201`,2026-08-10 L5a-M)**本片不擋**。
5. `--no-verify` / `HUSKY=0` 可繞(與 reviewer-gate 同天花板)。

## §7 相關既有紀錄與連動面(偵察 pass 命中項)

- `docs/lessons-learned.md:1059-1070` §12-31:同一條規則的文字版(含「機制觀測點在部署後」那句)。
- `docs/reviews/2026-08-07-night-legislation-draft.md:108-110`、`:300`:前一版提案與那句要更正的「做不到」(§2)。
- `docs/reviews/2026-08-07-e-batch-apply-runbook.md`:現行 apply 停點包長什麼樣(人工每次生一份)⇒ 閘 C 要接上去的地方。
- **連動檔**:`.husky/pre-push`、`.github/workflows/ci.yml`(若 Q1 選到要進 CI 才動)、`scripts/269b-gate.sh`(抽通用時的來源)、`scripts/a7c-preflight.sh:98`(寫死的 ledger 尾,順手修或明文留)。

— v1,P 七代 2026-08-11 20:5x

---

## §8 要 Sean 拍的(🔴 **關卡1 兩輪未收斂,照紀律停下來問你**)

兩輪對抗審查的共同結論是一句話:**repo 側的 hook 擋得住「順序寫錯」,擋不住「有人繞過或帳說謊」;
而只要留一個「打字就過」的例外欄位,它就會被用來繞。** v3 的取捨是「不留例外、寧可偶爾誤擋」。

```
Q1:本片要做到哪個程度?
A: 照 v3 做(物件層級一道閘 + APPLIED.tsv;無 in-hook 例外,要繞就 --no-verify 並在 commit body 說明)【推薦】
   | B: 更輕:只做「pending migration 存在時印警告但不擋」(零誤擋風險,但它只是提醒、不是閘)
   | C: 先不做 repo 面,直接做拆出去那片「apply 後真站 smoke」(擋不到推錯順序,但抓得到「東西沒到位」)

Q2:誤擋的容忍度(這題決定 §5 風險 ① 怎麼設計)
A: 寧可偶爾誤擋:物件名比對從寬(推薦;誤擋的代價=看訊息、確認一下、必要時 --no-verify)
   | B: 寧可漏擋:比對從嚴(只認 RPC 函式名這種高鑑別度的物件,column/table 名不比)

Q3:`supabase/APPLIED.tsv` 誰維護
A: apply 停點的人 apply 完當下寫入並 commit(推薦;與更新 STATUS 同一動作、同一時刻)
   | B: 另寫腳本從正式庫實查產生(要有 DSN,等於綁到能連正式庫的人)
   | C: 不建這本帳 ⇒ 那麼 v3 的閘沒有判準,等於選 Q1=B 或 C
```

## §9 關卡1(codex,2026-08-11 21:0x)逐條回應 —— 11 must-fix

| # | findings | 處置 |
|---|---|---|
| 1 | pre-push 看不到 GitHub merge / Vercel redeploy / 別台機器 | ✅ **收窄**:§2 改寫、§6-1 立為知情缺口 |
| 2 | 「本片改不到另一個 `pcm-admin` repo」 | 🔴 **不成立(實查推翻)**:admin **在同一個 repo**(`apps/admin/`;`git remote -v` 只有一個 `pcm-website-v2`),pcm-admin 只是**指向同一 repo 的第二個 Vercel 專案** ⇒ 同一個 `.husky/pre-push` 天然覆蓋兩條部署線 |
| 3 | 「push 同時含」與「每顆 commit」定義衝突 | ✅ **改掉**:v2 用 **push aggregate**(範圍內的檔案集合)算 `PENDING` 與 app 變更,不再逐 commit 猜關係 |
| 4 | **走一遍 A9h:v1 的閘擋不住** | ✅ **這條把 v1 打掉重畫**:改成查 `APPLIED.tsv` 的真互鎖(§3),`migration-first` 宣告取消 |
| 5 | `migration-first` / `no-consumer` 打一行即過 | ✅ 兩種宣告**整個取消** |
| 6 | 閘 B 正規式證不到「預設 off」(假陽性) | ✅ 改成 registry + `default: 'off'` 欄位;控制流那半明列為證不到 |
| 7 | server config / helper / 動態 key ⇒ 假陰性 | ✅ 同上:改成「單一可靜態驗證的 flag 合約」,不再猜寫法 |
| 8 | 閘 C「有人記得跑」,拿掉不會有驗收紅 | ✅ **C 拆出去**,不在本片宣稱 |
| 9 | `rpc + P0001` 探針只涵蓋 RPC | ✅ 同上,拆出去時再設計多型別探針 |
| 10 | §4.3 量到的是「字串存在」不是「保護了 consumer」 | ✅ 驗收改寫(§4-6/7),並在 §3 明寫「證不到包住 code」 |
| 11 | 三個獨立失效域應拆片 | ✅ 拆成 A+B(本片)與 apply-smoke(另片);Q1 讓 Sean 確認 |

**判停**:11 條裡 10 條成立且已折,1 條(#2)實查推翻。v2 待 Sean 批准後才動手;批准前零實作。
