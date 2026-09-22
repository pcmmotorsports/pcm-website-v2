# 商品同步提早到 07:45，並讓車款同步讀得到「完成紀錄」

- 日期：2026-09-23
- 派工：主視窗 pcm-website-v2-90（報價單 session 提出，Sean 同意方向）
- 狀態：程式已修改，與本文件同一顆 commit 在 `agent/shop-6`，**尚未推送**。推送前主視窗會先問 Sean。
- 🔴 **推送時機**：今天（09-23）那一輪還沒跑（近期都是台灣 16:44-18:07 開跑、跑 23-26 分鐘）。若在今天台灣 12:30 之前推上 `dev`，今天這一輪就不會跑，下一次要等 09-24 早上，中間約 39 小時沒有商品同步，而且沒有任何東西會提醒。兩個做法擇一：等今天那一輪跑完（約 18:10 之後）再推；或推完立刻手動觸發一次補跑——但手動觸發沒帶 checksum 時，有經銷價的那幾家會沿用舊價並被標成 `degraded`（`scripts/rpm-import.ts:381-387`）。由 Sean 決定。
- 這份文件給報價單那邊（Mac mini 車款同步）看：網站這邊改了什麼、完成紀錄怎麼讀。

## 1. 改了什麼

| 項目 | 改之前 | 改之後 |
|---|---|---|
| `.github/workflows/rpm-sync.yml` 排程 | `30 4 * * *`（台灣 12:30） | `45 23 * * *`（台灣 07:45） |
| 每家同步跑完寫的備註 | 一律空白 | 有部分商品或變體被跳過時寫 `degraded` |

- 排程只在 GitHub 預設分支生效，本 repo 的預設分支是 `dev`。所以推上 `dev` 後，隔天的排程就會用新時間。
- 表訂 07:45 是最早的開跑時刻。GitHub 只會延後，不會提早，所以不會早於 07:15 的翻譯。
- 新時段的延遲沒有量過。舊時段（UTC 04:30）最近 15 次都晚了 4.2-5.6 小時才開跑（台灣 16:44-18:07），每次跑 23-26 分鐘；這個數字不能直接套到新時段。

## 2. 完成紀錄：用現成的 `supplier_sync_runs`，不新建表

網站庫 `public.supplier_sync_runs`（`supabase/migrations/20260906340000_m4b_supplier_sync_runs_and_stale_counts.sql`）。同步程式 `scripts/rpm-import.ts` 每一家開工時寫一筆，收工時回填。

| 欄位 | 意思 |
|---|---|
| `supplier_slug` | 哪一家（例 `wrs`、`rpm`） |
| `started_at` | 開工時間 |
| `completed_at` | 收工時間；空白 = 還在跑，或被中途砍掉 |
| `outcome` | `completed` 跑完、`failed` 程式自己判定失敗、空白 = 沒有回填 |
| `note` | `failed` 時是錯誤原因；`completed` 時空白 = 全部正常，`degraded` = 跑完但有部分跳過（2026-09-23 起） |
| `run_ref` | GitHub 執行編號 `<run id>/<第幾次>`；手動重跑失敗的那幾家，編號後面的次數會加 1 |

- 權限：`service_role` 可以讀（2026-09-23 正式庫唯讀查 `has_table_privilege`）。Mac mini 的 `sync_storefront_fitments.py` 本來就用網站庫的 `SUPABASE_SECRET_KEY`（service key）走 REST，所以不用新增任何密碼，也不用把報價單的密碼放進 GitHub。
- 試跑（dry run）不寫這張表。

### 判斷「今天這一家成功了」

建議車款同步**逐家判斷**：哪一家今天成功就同步哪一家，失敗或還沒跑的那家先跳過。這樣一家失敗不會拖住其他家。

```sql
-- 每一家今天（台灣時間）最新的一筆
SELECT DISTINCT ON (r.supplier_slug)
       r.supplier_slug, r.started_at, r.completed_at, r.outcome, r.note, r.run_ref
  FROM public.supplier_sync_runs r
 WHERE r.started_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')
 ORDER BY r.supplier_slug, r.started_at DESC;
```

| 那一家今天最新一筆 | 意思 | 車款同步該怎麼做 |
|---|---|---|
| `outcome = 'completed'`，`note` 空白 | 成功 | 可以同步 |
| `outcome = 'completed'`，`note = 'degraded'` | 跑完，但有部分商品或變體被跳過 | 可以同步；少數被跳過的商品會找不到，要算進「找不到」比例 |
| `outcome = 'failed'` | 這一家失敗 | 這一家先不要同步 |
| `outcome` 空白、`completed_at` 空白 | 還在跑，或被中途砍掉 | 等一下再查；開工超過 1 小時仍空白就當失敗 |
| 今天沒有這一家的列 | 今天還沒輪到它、整個排程還沒開始，或那一筆開工紀錄沒寫進去 | 等一下再查；**到台灣 20:00 仍沒有列就當今天沒跑**，跳過並記一筆，不要一直等 |

「沒有列」有兩種永遠不會出現的情況，所以一定要有截止時刻：開工紀錄寫不進去時同步仍會照跑（`scripts/rpm-sync-run-log.ts:56-61`），以及 GitHub 整次丟棄排程。截止時刻建議取「表訂 07:45 + 目前實測最久的延遲（約 5.6 小時）+ 跑完的時間」再留一點餘裕，也就是台灣 20:00；等量到新時段的實際延遲後再調整。

用 REST 讀（Mac mini 現有的做法）：

```
GET {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/supplier_sync_runs
    ?select=supplier_slug,started_at,completed_at,outcome,note,run_ref
    &started_at=gte.<台灣今天 00:00 換成 UTC 的 ISO 時間>
    &order=started_at.desc
```

回來之後每一家取第一筆（最新的），再照上表判斷。

### 判斷「今天整個排程都成功了」

每日排程共 19 家，名單就是 `rpm-sync.yml` 裡 `matrix.supplier` 那一行。19 家今天最新一筆都是 `completed` 才算整個成功。名單會隨 Sean 開新品牌而變，所以不建議 Mac mini 寫死 19；逐家判斷不需要知道總數。

## 3. 07:45 前後的其他排程

- 網站庫 pg_cron：`pcm-acl-digest`、`pcm-net-exposure` 在 UTC 00:00（台灣 08:00），都是輕量讀取。`pcm-anomaly-alert` 在 UTC 01:00、13:00，讀 `get_supplier_sync_stale_counts`，沒回填超過 6 小時才會叫，所以同步跑到一半不會誤報。
- rpm-sync 自己的 `image-trim-scan` 與失敗通知信都排在同步之後（`needs: sync`），跟著一起提早。
- 兩個 Vercel 專案的 `vercel.json` 都沒有排程。
- 報價單 07:15 翻譯要跑多久，本 repo 量不到。如果翻譯還沒寫完同步就開跑，會讀到一半翻好的名稱，隔天那一輪會補上。

## 4. 推送後怎麼量第一次實際完成時間

推上 `dev` 後的第一個早上：

```bash
gh run list --workflow=rpm-sync.yml --limit 3 --json databaseId,event,createdAt,updatedAt,conclusion
```

- 看 `event = schedule` 那一筆：`createdAt` 加 8 小時是台灣的開跑時間，`updatedAt` 加 8 小時是跑完時間。
- 再用上面的 SQL（或 REST）查當天 `supplier_sync_runs`，每一家的 `completed_at` 就是那一家寫完的時間。
- 連續量幾天，才知道新時段的延遲大概多少。量到之後，報價單那邊再決定車款同步要排在幾點、要不要改成「查到完成紀錄才跑」。

## 5. 不做的事

- 不新建資料表、不改資料庫結構：`outcome` 只允許 `completed` / `failed`，所以「部分跳過」寫在 `note`。
- 不讓 Mac mini 直接觸發 GitHub 排程。若量到新時段仍延遲好幾個小時，可以考慮讓 Mac mini 翻譯完後用 GitHub token 觸發 `workflow_dispatch`（按下就跑）。那需要在 Mac mini 放一把 GitHub token，要另外決定。
