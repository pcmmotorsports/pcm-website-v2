# PCM 專屬規矩

> **定位(2026-07-06):本檔=CLAUDE.md/AGENTS.md 鐵則的詳解與程式碼範例層、按需讀非常載;規則字面以 CLAUDE.md/AGENTS.md 為準,發現不一致以彼為準、並回報修本檔。**

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **狀態:** v1 / 2026-04-29
>
> 本檔是「**PCM 專屬的硬規則**」、不通用、寫 PCM 程式碼前必讀。
>
> 配合閱讀:`docs/PROJECT-OVERVIEW.md`(整體 PCM 介紹)、`docs/PHASE-2-VISION.md`(9 點業務藍圖)、`docs/lessons-learned.md`(踩過的坑)

---

## 1. design-reference 是視覺真權威

### 1-1. 真權威字面位置

```
design-reference/                    ← submodule
├── components/                      ← 13 個 .jsx
├── styles/                          ← 15 個 .css
├── data/                            ← mock data
├── design-reference/HANDOFF-*.md    ← 9 份 HANDOFF
└── index.html                       ← SPA 入口
```

### 1-2. 衝突仲裁鐵則

**storefront 與 design 衝突時、storefront 對齊 design、不反向遷就。**

例外只有三類:
1. **業務邏輯**(訂單流程、權限、價格、Medusa schema)→ 走 `docs/decisions/`
2. **技術實作**(Next.js routing、TypeScript 型別)→ 不影響視覺、按工程選擇
3. **Phase 1 範圍外**(9 大藍圖)→ design 若有相關 UI、Phase 1 不做

視覺、結構、路由、元件命名一律 design 為準。

### 1-3. 內部優先級(design-reference 內部不一致)

```
DETAILS > TOKENS > COMPONENTS > PAGES > OVERVIEW > index.html SPA 行為
```

實務上:**.jsx + .css 字面 > HANDOFF docs**(jsx + css 是渲染源、HANDOFF 可能未隨更新)。

### 1-4. 直接搬、不翻譯

**正確:**
```
design ProductsPage.jsx → cp 到 apps/storefront/src/components/ProductsPage.tsx
                       → 改副檔名 + import path + TS 型別
                       → 用
```

**錯誤(嚴禁):**
```
讀 design ProductsPage.jsx → 看結構 → 用 Tailwind 重寫一份「自己的風格」
```

slice 指令禁用「翻譯 / 對齊 / 重寫」字眼、預設「直接搬」。

### 1-5. 寫 slice 前必先 grep design 字面

寫任何前台元件前:
```bash
cd design-reference
grep -rn "ComponentName" components/
grep -rn ".class-name" styles/
```

**不憑記憶、不憑 inventory md**(inventory 也可能含 drift)。

第一輪三次踩坑(Slice C 虛構 v6 / MobileFab 推測錯刪 / pageheader props 憑記憶)都因為沒 grep。

---

## 2. B2B2C 架構原則

### 2-1. 一個系統、不分 B2B / B2C 兩 app

PCM 是 B2B + B2C 雙 channel、但**用同一個會員系統、同一個前台**:

```
單一會員系統
    ↓
member.tier 欄位
    ↓
├── general (一般會員)        → 看零售價
├── store (店家)              → 看經銷價
└── premium_store (高級店家)  → 看經銷價再 -3~5%
```

**錯誤(嚴禁):**
```
/storefront     → B2C 一般客戶
/wholesale      → B2B 店家(獨立 app / 獨立路由)   ❌
```

**正確:**
```
/products       → 所有人都來這、tier 決定看到什麼價格
```

### 2-2. tier-aware UI 集中處理

價格顯示邏輯**集中在 PriceDisplay 子元件**、不散落:

**錯誤:**
```tsx
{user.tier === 'general' ? <p>{retailPrice}</p> : <p>{wholesalePrice}</p>}
{user.tier === 'general' ? <p>{retailPrice}</p> : <p>{wholesalePrice}</p>}   // 重複多處
```

**正確:**
```tsx
<PriceDisplay product={product} user={user} />   // 單一元件、tier 邏輯內聚
```

未來 tier 規則改、改一處。

### 2-3. tier 切換 config 集中

不同 tier 看到不同的 TabBar / 選單時、用 config 表集中:

```ts
// config/tier-tabs.ts
export const TAB_CONFIG = {
  general: ['home', 'catalog', 'search', 'sale', 'account'],
  store: ['home', 'catalog', 'booking', 'schedule', 'account'],   // Phase 2
};
```

**不在 TabBar 元件內 if-else 散落判斷。**

---

## 3. 三級會員與儲值金

### 3-1. 三級會員 tier 定義

| 等級 | 英文代號 | 升級方式 | 折扣 |
|---|---|---|---|
| 一般會員 | `general` | 註冊即開通 | 零售價 |
| 店家 | `store` | 管理員手動審核 | 經銷價 |
| 高級店家 | `premium_store` | 自動升級(累積儲值 ≥ NT$100,000) | 經銷價再 -3~5% |

### 3-2. 價格驗證在 server 端

**鐵則:** 價格計算一律在 server 端執行、client 只收到該 tier 能看的那一個價格。

**錯誤:**
```ts
// API 回傳全部價格
return {
  retailPrice: 1000,
  wholesalePrice: 800,        // ❌ 一般會員瀏覽器看得到 800
  premiumPrice: 760,
};
```

**正確:**
```ts
// API 依 tier 過濾
const price = user.tier === 'general' ? 1000
            : user.tier === 'store' ? 800
            : 760;
return { price };
```

### 3-3. 儲值金統一處理

三級會員**共用同一套儲值金 ledger**(不分 B2C / B2B 兩個錢包)。

```
store_credit_ledger
├── id              uuid PK
├── member_id       uuid FK
├── amount          decimal (+ 加值 / - 扣款)
├── balance_after   decimal
├── reason          text   (admin_adjust / order_pay / order_refund / cashback)
├── source_type     enum   (Phase 1: customer / admin_adjust)
├── source_ref_id   uuid   (來自訂單則指向 order.id)
├── created_by      uuid   (執行者)
├── created_at      timestamp
```

`source_type` 用 enum、Phase 2 加 `dealer_to_customer` 等不破壞既有資料。

### 3-4. 結帳儲值金扣抵

- 結帳時可勾「使用儲值金」、不足部分自動用信用卡補
- 訂單取消、儲值金自動退回
- 退款先進儲值金、不退現金(除非 Sean 後台手動指定)

---

## 4. 商品 schema(對應 design）

### 4-1. fitment_type 區分

PCM 商品兩類:
- **specific(80%)**:車輛特定品(車型 / 年份 / 引擎不能換、fitment 鎖在 product title、options = 顏色 / 規格)
- **universal(20%)**:通用品(fitment 是 variant option、客人選車型才生 variant)

**schema:**
```ts
metadata: {
  fitment_type: 'specific' | 'universal'
  // 其他 design 定義的欄位
}
```

### 4-2. 圖片與 PDF 用 URL string

PCM 商品圖大量、若存 BLOB 成本高、效能差。**全部存外部 URL**:

```ts
images: string[]      // ['https://cdn.../img1.jpg', ...]
pdfs: string[]        // 商品說明 PDF
```

**不在 Phase 1 做圖片上傳介面**(廠商提供連結即可、Phase 2 再決定 CDN)。

### 4-3. 多 price tier(Medusa Price List)

用 Medusa 內建 Price List:
- `retail_price_list` — 零售價
- `wholesale_price_list` — 經銷價

Phase 1 設兩個 price list 起步、Phase 2 加廠牌折扣 / 個人化覆蓋。

---

## 5. 內容分級 L1 / L2 / L3

### 5-1. 三級定義

| 級別 | 變更頻率 | 處置 |
|---|---|---|
| **L1** | 每年 0-1 次 | hardcode 可接受 |
| **L2** | 每季 1-3 次 | hardcode + TODO + backlog |
| **L3** | 每週多次 | **必須**後台 CRUD、強制停 slice 寫 PRD |

### 5-2. 範例

| 內容 | 級別 | 處置 |
|---|---|---|
| Footer 客服電話 | L1 | hardcode |
| 首頁 hero banner | L2 | hardcode + backlog 加 CMS |
| 商品庫存 / 價格 | L3 | 後台 CRUD(Medusa 內建) |
| 行銷 banner / 季節主視覺 | L3 | 後台 CRUD(Phase 2 加) |
| 品牌列表 | L2 | hardcode + backlog 加 CMS |

### 5-3. slice 強制前置分級

任何 slice 前先標記涉及內容是哪一級。發現 L3 內容 → 立即停、不繼續、寫 PRD 後再動。

---

## 6. Sean / 環境特性

### 6-1. Sean 無程式背景

- 不寫 code、不看 git diff
- 用 GitHub.com / Vercel / Railway / Supabase Dashboard 操作
- 終端機跑 busboy-start 與 credential 設定
- 寫進 slice 指令的 bash **不可含 `#` 註解、全形標點**(zsh 禁忌)

### 6-2. 主機 / 路徑

| 項目 | 路徑 |
|---|---|
| 主 repo | `/Users/sean_1/pcm-website-v2` |
| 舊 repo(凍結) | `/Users/sean_1/pcm-website` |
| Busboy 腳本 | `/Users/sean_1/pcm-tools/scripts/` |
| Hermes Node | `/Users/sean_1/.hermes/node/bin/` |

### 6-3. SSH only

兩 repo 都用 `git@github.com:...` 格式、第一輪因 HTTPS + token 出事、永久禁用 HTTPS。

---

## 7. Medusa 規則

### 7-1. service role key 走 server-only

Medusa backend 用 service role key 連 Supabase、bypass RLS。

**鐵則:**
- service role key 只在 `apps/api` 的 server runtime 用
- **絕不**出現在 storefront client 端
- 所有讀寫透過 Medusa API、不直接連 DB

### 7-2. RLS 全開、不寫 policy

Supabase 所有 table 開 RLS、**不寫 policy**(Medusa service role bypass、所有合法存取走 Medusa)。

第一輪 04-23 因 RLS 未開吃到 advisor 警告、新 project 起手就開。

### 7-3. Prisma migrate 必用直連

```bash
DATABASE_URL="$DIRECT_URL" npx prisma migrate dev --name <名稱>
```

PgBouncer 不支援 migrate、必須直連。

---

## 8. Backlog 條目寫法

### 8-1. 必含元素

每條 backlog 必含:

1. **問題** — 是什麼狀況
2. **觸發事件** — 何時 / 為何發現
3. **狀態** — ⏳ 待執行 / 🔴 立即啟動 / ✅ 完成
4. **優先級** — 🔴 高 / 🟠 中 / 🟡 低 / 🟢 觀察
5. **預期解法** — 想怎麼解
6. **不修會痛在** — **必填、不可空泛**(三視角:擴充性 / 可維護性 / bug 可追蹤性)
7. **估時** — 大致範圍
8. **依賴** — 前置條目
9. **發現於** — 日期 + 哪個 slice / session

### 8-2. 禁止寫法

| 禁 | 為什麼 |
|---|---|
| 「待 Sean 決定」 | 空泛、Sean 不知道要決定什麼 |
| 「未來考慮」 | 沒明確時機 |
| 「需評估」 | 評估什麼?標準是什麼? |
| 「建議改進」 | 不修會怎樣? |

### 8-3. 範例

❌ **錯:**
```
#XX 字型 drift、待 Sean 決定
```

✅ **對:**
```
#XX 字型 drift

問題:Storybook 用 PingFang、storefront 用 system-ui、改 storefront 後新加元件繼承錯誤字型
觸發事件:M-β-CP3-§4 真機驗收、Sean 觀察 Storybook vs Vercel preview 字型不同
狀態:⏳ 待執行
優先級:🟡 中
預期解法:packages/ui 改用 Google Fonts CDN 統一、或 storefront 與 Storybook 共用 fontFamily token
不修會痛在:
  - 擴充性:每加新元件都要重新對齊字型、重複工作
  - 可維護性:Storybook 看到的不是 storefront 真實樣貌、設計師驗收失準
  - bug 可追蹤性:Sean 認為「Storybook 看起來對」但 storefront 是錯、定位 bug 困難
估時:30-60 min
依賴:無
發現於:2026-04-25 M-β-CP3-§4 真機驗收
```

---

## 9. 商業優先級(Sean 拍板的不可動)

### 9-1. PCM 不碰工資

- PCM 只賺零件差價
- 店家只賺工資 + 額外施工
- **不做安裝工資線上收款**(系統嚴禁碰這筆錢)

### 9-2. 不做星級評分

不對店家做客人評分、只做作品集 + 內部觀察。

### 9-3. 退貨走人工客服、不做自助退貨按鈕

前台**不做**自助退貨按鈕、所有退貨走客服人工管道以保品質。

### 9-4. 通訊只用 Line + Email

不用簡訊(成本)、所有通訊走 Line(主)+ Email(fallback)。

— END —
