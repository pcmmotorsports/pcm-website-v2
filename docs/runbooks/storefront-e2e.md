# 顧客站 E2E(鑽機上跑, 不進 CI)

> M-6-05 · Sean 2026-09-14 拍 Q13 甲:只做顧客站 happy path + 出過事的點。後台主線不自動化、不掛 CI。

## 跑一次

```bash
BANK_TRANSFER_CHECKOUT_ENABLED=true bash scripts/storefront-probe/up.sh
pnpm e2e
bash scripts/storefront-probe/down.sh
```

- `pnpm e2e` 預設打 `http://localhost:3020`(鑽機預設埠)、DB 埠 `55533`。
- 鑽機換了埠(多窗並行)⇒ 跟著帶:`E2E_BASE_URL=http://localhost:3050 STOREFRONT_PROBE_PG=55563 pnpm e2e`。
- 沒帶 `E2E_BASE_URL` 直接 `pnpm --filter @pcm/storefront test:e2e` ⇒ 舊行為:自己起 3100 跑 home / account-guard / cart-unavailable, 鑽機那幾支整檔 skip(不假裝綠)。

## 有哪些

| 檔 | 守什麼 |
|---|---|
| `e2e/checkout-happy-path.spec.ts` | 找商品 → 看商品 → 加購 → 登入 → 新增地址 → ATM 轉帳 → 送出 → 訂單明細;再 psql 問鑽機 DB:orders 那列 + 寄信掃描面 `pcm_bank_order_created_email_pending` 有它 |
| `e2e/catalog-regressions.spec.ts` | 品牌頁 0 件 / 關鍵字+分類互斥 / 中文搜尋 / 搜尋改寫成分類 / 車款下拉有貨 |
| `e2e/cart-unavailable.spec.ts` · `account-guard.spec.ts` · `home.spec.ts` | 既有三支(網路抖動車不消失 / 未登入守門 / 首頁 SSR) |

## 它證不到的(不要讀寬)

- **刷卡**:worktree 起的 next dev 沒 TapPay 伺服端金鑰 ⇒ 走匯款。刷卡 sandbox 要在主樹用真 env 跑。
- **email_outbox 真的有那一列**:寫進去的是 `/api/cron/email-sweep`, 它要 `RESEND_API_KEY` 且會真的寄;
  `scripts/storefront-probe/up.sh` 檔頭明令不打 `/api/cron/*`。這裡只證掃描面看得到。
- **正式站**:全部是鑽機(種子資料、假 auth、GRANT 是腳本自己下的)。「做完 = Sean 自己開瀏覽器走一遍」那句照舊。
- 鑽機上 `/api/catalog/facet-counts` 回 503(件數連動 RPC 從零重放沒套上)—— 頁面照常, 不是站壞了。
