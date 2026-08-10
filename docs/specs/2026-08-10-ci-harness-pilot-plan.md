# CI harness 試點片 — plan **v2**

> P 窗 / 2026-08-10。主視窗核准 `P-306` 提案。**v2 = 依 codex 關卡1 FAIL(6 must-fix + 1 consider)改寫。**
> 🔴 **最大的改動:不新增 workflow,改在既有 always-on 的 `CI / check` job 加兩個 step**
> (codex consider #7)。理由見 §2 —— 那一步同時消掉三條 must-fix。
> 片型=**高風險片**(鐵則 12 ④平台設定)。流程:plan → 關卡1 → **發主視窗批** → 實作 →
> 凍結不 commit → 審查 → marker → commit,全程不降級。⚠️ 不急,錢面拍板一回來優先切回。

---

## 0. 設計原則(措辭已依 codex 2b 收窄)

> 🔴 **判定為相關之後,不得跳過。**
> 一支 harness 若在 CI 因為缺前置而**靜靜跳過**,CI 綠而我們以為它守著了 —— 比不掛更糟。
> ⚠️ v1 寫成「任何情況不得跳過」是**不精確的**:`paths` 過濾造成的「不觸發」與
> job-level `if:` 造成的「跳過但顯示成功」是**兩種不同的東西**(見 §2)。v2 用「判定相關後不得跳過」。

---

## 1. 🔴 實測數字(v1 完全沒有,codex MF5;本機 macOS / PG 17.10)

| harness | `real` | 斷言數 |
|---|---|---|
| `scripts/l5am-verify.sh` | **4.71 秒** | 28 |
| `scripts/l5a1-verify.sh` | **8.84 秒** | 58 |
| **合計** | **約 14 秒** | 86 |

⚠️ 這是**本機**數字。CI runner 較慢、且要現裝 PG,保守抓 **3-5 倍 ⇒ 約 1 分鐘內**。
⇒ **成本可忽略** ⇒ 沒有任何理由做 `paths` 過濾去省時間(而 paths 正是 v1 三條 must-fix 的根源)。

---

## 2. 🔴 改成「加 step 到既有 job」,一步消掉三條 must-fix

既有 `.github/workflows/ci.yml`:`on: push[dev,main] + pull_request`(**無 paths 過濾**)、
單一 job `check`、`ubuntu-latest`、已有 Typecheck / Lint step。

| v1 的 must-fix | 為什麼加 step 就沒了 |
|---|---|
| **MF2b** paths 過濾讓 required check 卡 Pending(或未設 required 就完全擋不住) | 不新增 check 名稱、不加 paths ⇒ 沿用既有 `CI / check`,所有 PR 都跑 |
| **MF3** workflow 自己不在自己的 paths 內 ⇒ 有人在它裡面加 `continue-on-error`,那次改動不觸發它 | 既有 workflow 對所有 PR 觸發 ⇒ 改它的 PR 一定會跑到它自己 |
| **MF5** CI 時間成本未知 | §1 實測 14 秒 ⇒ 全 PR 跑得起 |

🔴 MF3 那條我特別記著:**守門自己不在自己的觸發面上** —— 這是「守門看不到對它自己的破壞」的
一個新形狀,今天在別的地方抓了一整天,這次是我自己寫出來的。

---

## 3. 要做什麼(最小)

在 `.github/workflows/ci.yml` 的 `check` job 內、Lint 之後追加:

1. **一個安裝 step**:明確安裝 PostgreSQL **17**(不假設 runner 自帶;codex MF4)
   —— `ubuntu-latest` 是否把 PG17 放進 PATH **不是可依賴的 runner 合約**。
   安裝 step 自身非零離場本來就會讓 job 紅。
2. **一個版本斷言 step**:`initdb --version | grep -q ' 17\.'`,不符即 fail
   (照抄 `scripts/a7c-rw1b-verify.sh:92` 既有形狀)。
3. **兩個各自獨立的 harness step**(codex MF2):
   - `- name: DB harness · l5am` / `shell: bash` / `run: bash scripts/l5am-verify.sh`
   - `- name: DB harness · l5a1` / `shell: bash` / `run: bash scripts/l5a1-verify.sh`
   - 各自 `timeout-minutes: 5`(實測 <10 秒,5 分鐘是給 runner 慢速與現裝 PG 的餘裕)
4. 🔴 **禁止**:`continue-on-error` / `|| true` / job 或 step 的 `if:` / `matrix` / composite action /
   把兩支塞進同一個多行 `run:`(錯誤傳遞不透明;而且 `l5a1-verify.sh:22` 只開 `set -u`、
   **沒有 `set -e`** ⇒ 不能拿 script 自身當保證)。

**不做**:不新增 workflow 檔、不動 pre-commit、不加 provision job、不掛其餘 41 支。

---

## 4. 驗收(含**可重現**的突變程序,codex MF1)

| 格 | 斷言 | 證據 |
|---|---|---|
| 正向 | 兩個 step 都跑完 exit 0 | run URL |
| 🔴 **突變 A:harness 真的被執行** | 在 `l5am-verify.sh` 尾端暫時植入 `exit 97` → push → **job 必紅且錯誤碼可辨識** → 還原 → 再綠 | **兩個 run 的 SHA + URL 都要留存**(紅一次、綠一次);不得只留綠的 |
| 🔴 **突變 B:版本閘有作用** | 把版本斷言期望值改成 `18.` → **必紅** → 還原 | 同上留存 |
| 🔴 **突變 C:缺前置必紅不得 skip** | 移除安裝 step → `initdb` 不存在 → **必紅**,不得 skip | 同上留存 |

⚠️ v1 寫「弱化某道閘 ⇒ 必紅」是**不可靠的**(codex MF1):弱化不保證在正常 fixture 下一定翻。
改用 `exit 97` 這種**確定性**突變,證的是「這個 step 真的被執行」——那才是這格要證的東西。

🔴 **常設結構守門(補 MF1 後半)**:上述三發是一次性人工驗證,擋不住**日後**有人加 `continue-on-error`。
⇒ 另加一個常設檢查(在同一個 always-on job 內,純文字掃 `.github/workflows/ci.yml`):
斷言該檔內 `continue-on-error` 出現 **0 次**、兩個 harness step 各出現 **1 次**。
⚠️ 它是文字掃描、擋不住語意等價的繞法(例如改成 `run: bash x.sh || true`)⇒ 一併斷言 `|| true` 為 0 次。
**誠實**:這仍是「掃得到的形狀」的守門,不是全稱保證。

---

## 5. 誠實邊界(依 codex MF6 補齊,並把過滿的結論降級)

1. 只掛 2 支 ⇒ 其餘 **41 支仍是「人記得跑才有效」**。本片**不宣稱**解決那個缺口,只立起形狀。
2. 🔴 **「CI 綠 = harness 真的跑了」只在下述條件下成立**:workflow 確實啟動、且兩個固定 step 都完成。
   v1 把這句寫成無條件的,**過滿**。
3. 🔴 **required status check 是否真的啟用、以及 branch protection 怎麼設,我沒查也管不到**
   —— 那在 GitHub 設定裡,不在 repo。若沒設成 required,紅燈擋不住合併。**這條要 Sean/主視窗確認。**
4. runner 上的 PG17 靠**安裝 step**提供;安裝失敗 ⇒ job 紅(刻意 fail-closed),
   代價是 apt 來源或 runner 映像變動會擋住所有 PR。
5. 本片**不改任何 harness 本體**,只是叫它們跑。
6. 執行時間見 §1;`timeout-minutes: 5` 是保護,不是預期值。

## 6. 體積
單一檔(`ci.yml`)加約 5 個 step + 驗收。符合鐵則 4。
⚠️ v1 說「符合鐵則 4」時尚未含突變驗證程序;v2 把三發突變算進去,仍在範圍內(每發=改一行、push、看紅、還原)。

## 7. 待確認(要主視窗/Sean 回)
- §5-3:`CI / check` 目前**是不是** branch protection 的 required check?若不是,本片的紅燈擋不住任何東西。
