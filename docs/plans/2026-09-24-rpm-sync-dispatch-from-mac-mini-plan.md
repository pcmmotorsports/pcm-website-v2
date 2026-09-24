# 計畫：商品同步改由 mac mini 在 07:45 準時觸發

- 日期：2026-09-24
- 狀態：**只寫計畫。沒有改 workflow、沒有動 mac mini、沒有推送。** 命中鐵則 8（CI）；實作時碰到經銷價判斷，也命中鐵則 12，實作前要送 Codex 審。
- 依據：Sean 2026-09-24 選推薦做法：由 mac mini 在台灣 07:45 用 `gh workflow run`（手動觸發，GitHub 稱 `workflow_dispatch`）啟動 `rpm-sync`。

---

## 1. 為什麼要改

排程表訂台灣 07:45（`.github/workflows/rpm-sync.yml:100`，`45 23 * * *` UTC），但 GitHub 的排程常常晚很多才開跑：

- 舊時段表訂 12:30，最近 5 輪實際開跑是 16:53–18:07，晚了 4.4–5.6 小時（`gh run list --workflow rpm-sync.yml`，9/18–9/22）。
- 新時段第一次（9/24）到 09:15 都還沒開跑（本窗 08:35、08:55、09:15 三次實查）。

手動觸發則是「按下就跑」（`rpm-sync.yml:76` 註解，實測）。整輪大約 25 分鐘，所以 07:45 觸發，08:10 左右就會跑完。

---

## 2. 做完之後的樣子

1. mac mini 每天台灣 07:45 執行一次 `gh workflow run rpm-sync.yml --ref dev`，不帶其他參數，等於 19 家全跑。
2. GitHub 立刻開跑，約 08:10 跑完。每家寫一筆 `public.supplier_sync_runs`。
3. mac mini 照原本的接線，讀 `supplier_sync_runs` 判斷今天哪幾家成功，再做車款同步。
4. GitHub 排程**保留當備援**，改到比較晚的時段。它開跑時先檢查「今天已經有一輪手動觸發跑成功了嗎」，有就直接結束，不重跑。

---

## 3. 怎麼觸發（mac mini 那一側）

- **排程工具**：macOS 的 launchd，設在每天 07:45。mac mini 07:45 在睡眠時，launchd 會在醒來後補跑一次，所以不會整天漏掉。
- **命令**：`gh workflow run rpm-sync.yml --repo <owner>/<repo> --ref dev`。一定要帶 `--ref dev`：dev 是這支 workflow 平常跑的分支，不帶的話 GitHub 會用 repo 預設分支，萬一預設分支換了就會跑錯版本。
- **權限**：mac mini 要一把 GitHub 權杖，**只給這一個 repo 的「Actions：讀寫」**（fine-grained token），不給程式碼寫入權。權杖由 Sean 在 GitHub 建立、存在 mac mini 的鑰匙圈或 `gh auth` 裡，不進 repo、不進對話。
- **確認有開跑**：觸發後等 2 分鐘，用 `gh run list --workflow rpm-sync.yml --event workflow_dispatch --limit 1` 確認有一輪「今天建立」的執行。沒有就發通知（第 6 節）。

---

## 4. 一定要一起改的一件事：經銷價的觸發判斷

**這一條不改，灌價之後經銷價會停在灌價那一天。**

- 現在的規則：同步程式看到觸發方式**不是**排程，就要求經銷價校驗碼，沒有就沿用舊值、不寫新值（`scripts/rpm-import.ts:376-390`，`DEALER_PRICE_TRIGGER` 由 `rpm-sync.yml:220` 帶入 `github.event_name`）。
- 這條規則是為了保護**第一次灌價**：人手動觸發的那一發，必須帶 dry-run 核准過的校驗碼。
- 改成 mac mini 手動觸發之後，**每天那一輪都是手動觸發、都沒有校驗碼**。已經開灌價的供應商會每天沿用舊值，經銷價永遠跟不上報價單，而且不會報錯（它會印紅字，但那一輪仍然算成功）。
- 今天還沒有任何一家開灌價，所以**現在不會出事**。但經銷價修正計畫的灌價排在這之後（`docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md` 第 4 節），兩件一定會撞在一起。

**改法（建議）**：workflow 的手動觸發多一個輸入 `daily`（是或否，預設否）。

- mac mini 觸發時帶 `-f daily=true`。
- workflow 把 `DEALER_PRICE_TRIGGER` 改成：排程觸發，或手動觸發且 `daily=true` ⇒ 帶 `schedule`；其他手動觸發照舊帶 `workflow_dispatch`，要校驗碼。
- 程式 `rpm-import.ts` **一行都不改**，判斷規則還是「是不是日常同步」。

**這樣做的代價**：任何有 repo 權限的人手動觸發時勾了 `daily`，都可以不帶校驗碼寫經銷價。這跟今天「等排程跑」的效果一樣，因為排程本來就不要校驗碼。真正保護第一次灌價的，仍然是「清單還沒設就不會寫」，以及經銷價計畫 4.2 的順序：**等當天那一輪跑完，才設清單、立刻帶校驗碼觸發**。改成 mac mini 之後，「當天那一輪」指的是 07:45 那一輪。

灌價 runbook（`docs/runbooks/dealer-price-first-load.md`）要一起補一句：第一次灌價的那一發**不可以**勾 `daily`。

---

## 5. 怎麼避免同一天跑兩次

備援排程改到比較晚的時段，並在最前面加一道檢查。

- **備援時段**：建議表訂 `17 3 * * *` UTC（台灣 11:17）。照最近的延遲，實際大約 15:30–17:00 才會開跑，跟以前下午那一輪差不多，不會比今天更晚。
- **檢查**：新增一個最先跑的小 job，只在排程觸發時執行。它用 `gh api` 查這支 workflow 今天（台灣時間）有沒有一輪**手動觸發而且結論是成功**的執行：
  - 有 ⇒ 輸出「今天已跑過」，後面的同步 job 全部略過。
  - 沒有，或 07:45 那輪失敗、取消 ⇒ 照常跑全部 19 家。重跑已成功的供應商不會出錯（每家同步本來就可以重複執行）。
  - 需要權限 `actions: read`（`notify-failure` 那個 job 已經這樣用，`rpm-sync.yml` 的 notify-failure 段）。
- **兩輪時間重疊時**：`concurrency: rpm-sync`（`rpm-sync.yml:133-135`）會讓後到的那一輪排隊，不會同時寫。
- **手動觸發本身不做檢查**：人要補跑時一定跑得起來。

⚠️ 備援排程被略過時，GitHub 上那一輪會顯示成功，但裡面的同步 job 是「略過」。看 Actions 時要看 step，不要只看整輪的綠燈。

---

## 6. 失敗時通知誰

| 狀況 | 誰會知道 | 怎麼知道 |
|---|---|---|
| 某幾家同步失敗 | 客服信箱（`SYNC_ALERT_TO`） | 既有 `notify-failure` job 寄信。手動觸發也會寄（它只排除 dry-run） |
| mac mini 觸發失敗（權杖過期、沒網路、gh 出錯） | **要定**（見 Q2） | mac mini 第 3 節那道「2 分鐘後確認有開跑」沒看到執行 ⇒ 發通知 |
| mac mini 當天整個沒動（關機、launchd 壞掉） | 沒有人會立刻知道 | 備援排程下午會照跑，所以網站仍然會更新，只是回到今天的時間 |
| 備援也失敗 | 客服信箱 | 同第一列 |
| 到台灣 20:00 仍沒有當天紀錄 | mac mini | 交接檔第 5 節既有規則：當作今天沒跑，不做車款同步 |

---

## 7. 分片

| 片 | 內容 | 時間 | 誰 |
|---|---|---|---|
| 1 | `rpm-sync.yml`：加 `daily` 輸入、改 `DEALER_PRICE_TRIGGER` 的判斷、排程改 `17 3 * * *`、加「今天已跑過」檢查 job；runbook 補一句 | 45 分 | 後台窗；Codex 審（CI＋經銷價） |
| 2 | 實作時改成：`daily` 不可與 `supplier`／`dry_run`／checksum 同時用（dispatch-guard 會擋），所以沒辦法用「單家乾跑＋daily」測。改由 `scripts/rpm-sync-workflow.test.ts` 釘住判斷式的字面，第一次真的 daily 觸發後再看 log 裡 `DEALER_PRICE_TRIGGER` 是 `schedule` | — | 後台窗 |
| 3 | 建立 GitHub 權杖 | — | **Sean** |
| 4 | mac mini 設 launchd、觸發命令、2 分鐘確認、失敗通知 | — | 報價單窗（mac mini） |
| 5 | 第一個早上看結果：07:45 觸發、約 08:10 跑完、`supplier_sync_runs` 有 19 筆；下午備援那一輪要是「略過」 | — | 後台窗 |

片 1 推上 dev 就生效（dev 是 workflow 跑的分支），所以片 1 推上去之前，mac mini 那邊要先準備好。或者片 1 先推，當天排程照舊在下午跑，mac mini 隔天再開始。

---

## 8. 怎麼退回

| 狀況 | 怎麼退 |
|---|---|
| mac mini 觸發出問題 | 停掉 mac mini 的 launchd 工作。備援排程下午照跑，網站回到「下午更新」 |
| workflow 改壞了 | `git revert` 片 1 那一顆，推 dev。排程回到 `45 23 * * *`，`daily` 輸入消失；mac mini 帶 `-f daily=true` 觸發會被 GitHub 拒絕（輸入不存在），要同時停掉 mac mini |
| 備援檢查誤判、每天都略過 | 手動觸發一次補跑；再 revert 那道檢查 |

兩邊各自都可以單獨退回，不會卡住對方。

---

## 9. 要問 Sean 的題

**Q1　備援排程放在哪個時段？**

- **甲（推薦）**：表訂台灣 11:17，實際大約下午才跑。mac mini 沒觸發時，網站還是會在傍晚前更新，跟今天差不多。
- 乙：拿掉備援，只靠 mac mini。mac mini 當天沒動，網站就整天不更新，而且要等人發現。

**Q2　mac mini 觸發失敗時，通知送到哪裡？**

- **甲（推薦）**：寄到跟同步失敗同一個客服信箱（`SYNC_ALERT_TO`），大家只要看一個地方。
- 乙：用 LINE 通知 Sean。比較快被看到，但要多接一條通知管道。

（第 4 節的 `daily` 輸入不另外問：不做的話，灌價之後經銷價會停住，沒有其他選擇。）

---

## 這份計畫哪些親自驗過、哪些沒有

- **親自核對**：`rpm-sync.yml` 的排程、手動觸發輸入、`concurrency`、`notify-failure` 條件、`DEALER_PRICE_TRIGGER` 帶入方式；`rpm-import.ts:376-390` 的判斷；最近 5 輪與今天早上的開跑時間。
- **沒有驗**：手動觸發「按下就跑」是 yml 註解記的實測，我這次沒有自己觸發；launchd 睡眠補跑的行為沒有在這台 mac mini 上試過；mac mini 目前有哪些通知管道我不知道。
- **沒有送審**：這份是計畫。片 1 實作時送 Codex。
