# 通用工程規矩

> **定位(2026-07-06):本檔=CLAUDE.md/AGENTS.md 鐵則的詳解與程式碼範例層、按需讀非常載;規則字面以 CLAUDE.md/AGENTS.md 為準,發現不一致以彼為準、並回報修本檔。**

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **狀態:** v1 / 2026-04-29
>
> 本檔是「**可移植的通用規矩**」、不限 PCM、寫 React / Next.js / TypeScript / monorepo project 都適用。

---

## 1. 檔案大小

### 1-1. 元件檔上限

| 行數 | 處理 |
|---|---|
| ≤ 200 行 | 正常 |
| 200-300 行 | 注意、思考是否可拆 |
| 300-400 行 | **硬警戒**、計畫拆分 |
| > 400 行 | **必須拆**、抽子元件 / hook |

**為什麼:** 第一輪 OrdersClient 因 Orchestrator 跑出 2269 行、TDZ(Temporal Dead Zone)事故、卡兩天才修。

**怎麼拆:**
- 抽 hook(`useOrdersFilter` / `useOrdersPagination`)
- 抽子元件(`<OrderRow>` / `<OrdersTable>` / `<OrdersFilter>`)
- 抽 utility function(`formatOrderDate` / `calculateTotal`)

### 1-2. Hook 檔上限

| 行數 | 處理 |
|---|---|
| ≤ 100 行 | 正常 |
| 100-200 行 | 注意、評估拆 hook |
| > 200 行 | 拆成多個 hook |

---

## 2. Build vs Runtime

### 2-1. build pass ≠ runtime pass

`ignoreBuildErrors` 只影響 TypeScript compile、**不影響 ESLint runtime check**、**不影響執行時的 JavaScript 錯誤**。

**意思是:**
- `pnpm build` 通過、不代表開瀏覽器看不會紅屏
- TypeScript 型別錯誤被忽略、runtime 仍會 throw

**怎麼做:**
- 不要依賴 `pnpm build` 當最終檢查
- 必須**實際開瀏覽器跑**(用 Chrome DevTools MCP 開 localhost、跑使用者流程)
- Vercel preview 部署成功不代表頁面沒 bug

### 2-2. ESLint 守門

Vercel build **不跑 ESLint**、所以 ESLint 錯誤不擋部署。

**怎麼做:**
- 本地必須 `pnpm lint` 跑
- 加 GitHub Actions CI gate(push 時自動跑 lint + typecheck)
- 不允許 `eslint-disable` 沒附原因(必加 `// eslint-disable-next-line xxx -- 原因說明`)

---

## 3. React 19 Hooks 嚴格規則

### 3-1. `react-hooks/purity` 拒絕 render body 內副作用

**錯誤:**
```tsx
function Component() {
  const now = Date.now();              // ❌ render body 內呼叫副作用
  const random = Math.random();         // ❌
  return <div>{now}</div>;
}
```

**正確:**
```tsx
function Component() {
  const [now] = useState(() => Date.now());   // ✅ initial state lazy
  return <div>{now}</div>;
}
```

### 3-2. `react-hooks/set-state-in-effect`

`try / finally` vs `.catch()` AST 結構敏感、setState 必須在 try 完整包覆中:

**錯誤:**
```tsx
useEffect(() => {
  fetchData()
    .then(data => setData(data))
    .catch(err => setError(err));        // ❌ AST 不直接、可能誤判
  setLoading(false);                       // ❌ 在 await 外
}, []);
```

**正確:**
```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const data = await fetchData();
      if (!cancelled) setData(data);
    } catch (err) {
      if (!cancelled) setError(err);
    } finally {
      if (!cancelled) setLoading(false);   // ✅ try / finally 完整包
    }
  })();
  return () => { cancelled = true; };
}, []);
```

### 3-3. 規則修法超出 slice 範圍時

當 lint rule 修起來會牽動很多檔、超出本 slice scope:

```tsx
// eslint-disable-next-line react-hooks/set-state-in-effect -- 修法需重構整個 fetch flow、見 backlog #N
useEffect(() => {
  // ...
}, []);
```

**規則:** 必加 backlog 條目追蹤、不能默默 disable。

---

## 4. Server vs Client 邊界

### 4-1. Client component 不得 import server-only 模組

**錯誤:**
```tsx
'use client';
import { prisma } from '@/lib/prisma';   // ❌ Prisma 是 server-only
```

**正確:**
```tsx
'use client';
import { fetchProducts } from '@/lib/api/products';   // ✅ 走 API client
```

### 4-2. 敏感資料絕不傳到 client

| 不可暴露 | 替代 |
|---|---|
| 經銷價(批發價) | server 端依 user.tier 決定回傳哪個價格 |
| API token / DB 連線字串 | env 內、僅 server runtime 可讀 |
| 其他用戶個資 | server 端過濾後回傳 |

**寫法:**
```tsx
// ❌ 錯
return { retailPrice: 1000, wholesalePrice: 800 };   // 一般會員看得到 800

// ✅ 對
const price = user.tier === 'general' ? 1000 : 800;
return { price };
```

### 4-3. Server-side 重新驗證

不信任 client 送的欄位、即使是 user.id。

**錯誤:**
```ts
export async function getOrders(userId: string) {   // ❌ 信任 client 送的 userId
  return prisma.order.findMany({ where: { userId } });
}
```

**正確:**
```ts
export async function getOrders() {
  const session = await getServerSession();         // ✅ 從 session 拿
  if (!session?.user) throw new Error('Unauthorized');
  return prisma.order.findMany({ where: { userId: session.user.id } });
}
```

---

## 5. 金額處理

### 5-1. 整數或 Decimal、禁用 number

JavaScript `number` 是 IEEE 754 浮點數、會有精度誤差:

```js
0.1 + 0.2 === 0.30000000000000004   // ❌
```

**規則:**
- 整數(以「分」或「元」為單位)
- 或用 Prisma `Decimal` / 自訂 Money type
- **絕不**用 `number` 直接處理價格

### 5-2. 顯示時轉換

```ts
// 內部以「分」為單位儲存
const priceInCents = 12345;   // = NT$ 123.45

// 顯示時轉換
const display = `NT$ ${(priceInCents / 100).toLocaleString('zh-TW', { minimumFractionDigits: 0 })}`;
// = "NT$ 123.45"
```

---

## 6. CSS 與 TSX 雙檔聯動

### 6-1. 同元件不拆 slice

寫元件時、`.tsx` 與對應 `.css` 屬於同一個邏輯單元、必在**同一個 slice 完成**。

**為什麼:** 第一輪曾把 CSS 與 TSX 拆兩個 slice 做、中間出現 dead code、Sean 無法肉眼驗。

**寫法:**
```
slice [M-1-3] 新增 ProductsPage:
  - 新增 apps/storefront/src/components/ProductsPage.tsx
  - 新增 apps/storefront/src/styles/products-page.css
  - 修改 apps/storefront/src/app/products/page.tsx
  - commit 訊息: feat(storefront): 新增 ProductsPage 對齊 design [M-1-3]
```

### 6-2. CSS class 命名

對齊 design-reference 字面、不重命名:

**錯誤:**
```tsx
// design 用 .pp-head、storefront 改成 .products-header
<div className="products-header">
```

**正確:**
```tsx
// 對齊 design 字面
<div className="pp-head">
```

---

## 7. Git 操作

### 7-1. 精準 add

```bash
# 正確
git add apps/storefront/src/components/ProductsPage.tsx
git add apps/storefront/src/styles/products-page.css

# 禁止
git add .                    ❌
git add -A                   ❌
```

**為什麼:** 避免誤包未追蹤的暫存檔、設定檔、其他 slice 殘留。

### 7-2. Commit 訊息

```
type(scope): subject [optional milestone-id]
```

- `type`: feat / fix / refactor / docs / chore / test / perf
- `scope`: 子系統名(storefront / medusa / ui / schemas / docs / config)
- `subject`: 繁體中文、祈使句、≤72 字元
- `[optional]`: milestone-id

**範例:**
```
feat(storefront): 新增 ProductsPage 對齊 design 真權威 [M-1-3]
fix(medusa): 修正 cart line item 計算邏輯
refactor(ui): 拆 ProductCard 為 3 個子元件
```

### 7-3. 不自動 push

slice 結束 commit 完、**不 push**。Sean 手動推當 review checkpoint。

---

## 8. Bash / Terminal 紀律(macOS zsh 環境)

### 8-1. zsh 禁忌

| 禁忌 | 為什麼 |
|---|---|
| `#` 註解 | zsh 報 `command not found` |
| 全形標點 (「」(): ;) | 報 `unknown file attribute` |

註解寫在外部對話、不寫進命令本身。

### 8-2. Pipeline `&&` 串接

任一步失敗自動停。**禁裸換行 batch 多命令。**

```bash
# 正確
cd /tmp && test -s newfile && cp newfile target.txt

# 錯誤
cd /tmp
test -s newfile
cp newfile target.txt
```

### 8-3. 「產生新檔 → 驗證 → 覆蓋」模式

```bash
# 產生
cat > /tmp/newfile <<'EOF'
...
EOF

# 驗證
test -s /tmp/newfile || exit 1

# 才覆蓋
mv /tmp/newfile target.txt
```

### 8-4. 不假設非 macOS 預設 CLI 已裝

`jq` / `yq` 等用前先 `command -v jq` 確認、或改 Python 內建。

### 8-5. zsh nomatch

zsh 在 glob 無匹配時 exit 1、含 glob 加 `|| true` 或用 `find`。

```bash
# 正確
find . -name "*.tsx" -delete

# 錯誤
rm *.tsx     # 沒檔案時 zsh 會 exit 1
```

---

## 9. CJK 處理

### 9-1. str_replace 大塊中文易失敗

全形「」(): ; 常被無意打成半形、byte 不 match。

**連敗 2 次切換策略:**
1. `bash sed` + anchor pattern(起迄特徵文字、非行號)
2. read → rewrite 整段 → write
3. 拆短 anchor

**str_replace 適用範圍:** 程式碼、英文、短中文 anchor。

---

## 10. SSH / Credential

### 10-1. SSH only

```
git@github.com:org/repo.git    ✅
https://github.com/org/repo    ❌
```

### 10-2. 涉及 credential 必加 redaction

```bash
git remote -v | grep -v ghp_
env | grep -v -i 'token\|key\|secret'
```

`cat .env` 不在對話跑、用戶在 Terminal 自驗。

### 10-3. 絕不在對話貼 token

任何 `ghp_xxxx` / `sk-xxxx` / 密碼出現 → 提醒用戶 revoke + 切 SSH。

— END —
