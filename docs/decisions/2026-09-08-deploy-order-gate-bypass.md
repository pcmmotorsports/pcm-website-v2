# 2026-09-08 · 部署時序閘 fail-closed 誤擋,Sean 拍 A 用 `--no-verify` 推這一發

> 🔴 **這份存在的理由**:`git push --no-verify` 在 git log 上**看不見**。
> 本檔是那一發的證據落點,而它與那顆 push **同一批**進 repo。

## 閘說什麼(逐字)

```
🔴 部署時序 gate:這次要推的應用層新增程式碼,用到了還沒 apply 的 migration 帶進來的東西
  · 🔴  的函式名是識別字而我認不出它: rpcName(在 apps/storefront/src/lib/products.ts)
    └ 這次有未 apply 的 migration,而我無法確定這支呼叫指到哪裡 ⇒ fail-closed。
gate: 1 blocked / 0 欄位警告(不擋) / 12 pending
```

## 🔵 為什麼判定它是誤擋 —— **而判定的依據是量到的,不是推的**

`apps/storefront/src/lib/products.ts:506` 逐字 `const rpcName: CatalogRpcName = dealer?.rpcName ?? CATALOG_RPC_PUBLIC;`
⇒ 那個變數**只有兩個可能值**(:408 / :409,兩者都是 `as const` 字面):

```
CATALOG_RPC_PUBLIC = 'search_catalog_by_vehicle'
CATALOG_RPC_DEALER = 'search_catalog_by_vehicle_dealer'
```

🔬 **正式庫唯讀實查(2026-09-08 15:45,`PCM_READONLY_DATABASE_URL`,零寫入)**:
```
 search_catalog_by_vehicle        | 2      (兩個多載)
 search_catalog_by_vehicle_dealer | 1      ← 15:10 由貼板 101 貼入
⚪ 負對照 never_exists_negative_control ⇒ 沒有印出來(只回 2 筆)⇒ 那把尺兩個方向都會動
```
⇒ 🎯 **兩個可能值在正式庫裡都存在 ⇒ 推上去不會 PGRST202 / 42703。**

## 🛑 這一發【沒有】跳過的東西 —— 閘跳過了,而檢查是手跑的

```
TURBO_FORCE=1 pnpm typecheck   rc=0 · 9/9 · 0 cached
TURBO_FORCE=1 pnpm lint        rc=0 · 11/11 · 0 cached
TURBO_FORCE=1 pnpm build       rc=0 · 2/2 · 0 cached
pnpm vitest run  連跑兩發、逐字一致:
  Test Files 905 passed | 1 skipped (906)
  Tests 16712 passed | 17 skipped | 2 todo (16731)   紅 0
各線 dev..<branch> 全 0 · 工作樹 dirty 0
```

## 🔴 而我犯的錯要寫在這裡,因為它比誤擋本身重要

我在收割後**自己跑過一次那道閘**,拿到 `0 blocked / 15 pending` 並據此廣播「全綠」。
🛑 **成因**:我餵 stdin 的順序是 `<新 sha> <舊 sha>`,而閘讀的是 `local_ref local_sha remote_ref remote_sha`
(`scripts/deploy-order-gate.sh:649`)⇒ **我把方向餵反了 ⇒ 它掃的是相反方向的差集。**
📌 **⇒ 一個餵錯方向的閘,印出來的綠與真的綠【逐字一樣】。**
✅ 修法不是「下次小心」:**跑這道閘之前先確認它印的 pending 支數,與 `git diff --name-only origin/dev..dev` 裡的 migration 支數對得上。**

## ⏭ 留下來的兩件

1. 🔴 **閘讀不懂 `const X = '字面' as const`** ⇒ 開成板列,由專人修 + codex 審。
   ⛔ **今晚不改** —— 收工時改一道守門、沒有第二人審,比繞過它更危險(R4:動驗證本身 = 立即停止訊號)。
2. 🔵 那 12 支 pending 不是本片造成的,清單見 `DOG_DEBUG=1` 的輸出。

**授權**:Sean 2026-09-08 15:4x 拍 A(選項逐字「這一發 `git push --no-verify`, 而理由寫進紀錄」)。
