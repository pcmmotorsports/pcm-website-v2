import type { Icons } from '../icons';

// nav-items.ts — `#27` D1c-1:側欄導覽清單 +「哪幾項該出現」的判斷。
//
// ── 🔴 為什麼從 `app-sidebar.tsx` 搬出來(**不是為了抽象,是那支測試自己招的**)──────
//   `app-sidebar.test.ts:22-28` 逐字列了它**擋不住**的五種,第 ⑤ 種是:
//     「**render 時被 runtime 條件濾掉**(例如 `.filter(...)` 或 feature flag)——
//       清單字面完好無缺,而畫面上就是沒有那一項」
//   ⇒ **本片做的就是第 ⑤ 種。** 旗標關掉時,`NAV_ITEMS` 的字面一個字都不會少,
//     而畫面上那一項不見了 ⇒ **純字面守門對本片恆綠 = 零判別力。**
//   而該檔 `:16-19` 也寫死了為什麼不能改用渲染測試補:`app-sidebar.tsx` 經
//   `@/components/ui/sidebar` 進 shadcn 積木、那支自己還有 9 個 `@/` import 並繼續連鎖,
//   而 vitest 的 `@` alias 指向 **`apps/storefront/src`**(`vitest.config.ts:28`)⇒ resolve 不到。
//   ⇒ **搬到一支「runtime 依賴為零」的檔,是這個約束下唯一拿得到真行為守門的做法。**
//   (主視窗 2026-08-15 裁定「准」,並附三個硬條件:讀取路徑改但斷言不放寬 /
//    改完各打一發突變證明 `#380`、`#350a` 兩道守門還會紅 / 兩件寫進 STOP 交 E 驗。)
//
// 🔴🔴 **本檔只准有 `import type`** —— `import type` 會被 esbuild 整行抹掉,不進 runtime。
//   **加任何 runtime import(尤其 `@/…`)⇒ `nav-items.test.ts` 會 resolve 不到而整族失效**,
//   而症狀是「測試沒跑」不是「測試紅」⇒ 旗標守門靜默消失。這正是上面那段約束的來源,別重蹈。
//   ⚠️ 這也是 `icon` 存**字串鍵**而不是存 `Icons.xxx` 元件本身的原因 ——
//   存元件就必須 runtime import `../icons`,而那支 import `@tabler/icons-react`。
//   對應代價:`app-sidebar.tsx` 那側要用 `Icons[item.icon]` 查表。
//   🔴 **打錯 icon 名由 `typecheck` 擋,不是 `nav-items.test.ts` 擋**(E 窗 R1 nit,實測)——
//     `Icons` 是 object literal、**零 index signature** ⇒ `keyof typeof Icons` 是真的窄 union
//     (**98** 個字面鍵 —— 2026-08-15 實數,**兩種量法互證**:直接數鍵 / 去重後再數;
//      ⚠️ **加一個 icon 就會變,別當常數引用**),`icon: 'nosuchicon'` 會在 `tsc --noEmit` 吐 **TS2322**,
//     而 `npx vitest run nav-items.test.ts` **5 passed、一格都沒紅**。
//     ⇒ **鐵則 11 的三綠含 typecheck,所以現況安全** —— 但別讀成「測試在守 icon」,它沒有。

export type IconKey = keyof typeof Icons;

export type NavItem = {
  key: string;
  label: string;
  icon: IconKey;
  /** 缺 href = 尚未接頁面、渲染成不可點 button 避免 404(沿用 `app-sidebar.tsx` 既有慣例)。 */
  href?: string;
};

// 精簡自 Kiranism starter(見 src/FORK-PROVENANCE.md)。
// M-4a:總覽 → / ;訂單 → /orders、客戶 → /customers 皆已接真頁面。
const BASE_NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', label: '總覽', icon: 'dashboard', href: '/' },
  { key: 'orders', label: '訂單', icon: 'billing', href: '/orders' },
  // M-3 RW3:退款異常清單(RW4 值班入口)。href 在 /orders 底下 ⇒ 進本頁時「訂單」同時
  // 呈 active(prefix 語意既有行為)—— 同屬訂單域,雙亮可接受、不為此改 active 邏輯。
  { key: 'refund-exceptions', label: '退款異常', icon: 'warning', href: '/orders/refund-exceptions' },
  { key: 'customers', label: '客戶', icon: 'user', href: '/customers' },
  // M-4b #20 片1a:商品列表(唯讀)。href 有值 = 頁面已接上(照本檔檔頭慣例)。
  // 🔴 2026-08-15 合併時補回:本檔是從「商品線併進 dev 之前」的基準分岔出去的,
  //    搬清單那一刻它還不存在 ⇒ 直接取本檔會靜默刪掉側欄的「商品」入口。
  //    合併者比對兩側 key 集合才發現(不是 git 提示的——那不是文字衝突,是集合差異)。
  { key: 'products', label: '商品', icon: 'product', href: '/products' },
  { key: 'staff', label: '員工管理', icon: 'teams', href: '/settings/staff' },
  { key: 'suppliers', label: '供應商', icon: 'post', href: '/settings/suppliers' },
  // M-4b E10 A9w2:唯一去處 `/settings/order-statuses`(九碼狀態詞彙 CRUD)已隨九碼退場下架。
  // 照既有慣例拿掉 href,保留這一格等日後真的有「設定」頁再接;整項刪掉是另一個決定。
  { key: 'settings', label: '設定', icon: 'settings' },
];

/**
 * `#27` 稽核紀錄檢視的入口。**只在旗標開啟時出現。**
 *
 * 🔴 **`/settings/audit` 這個路徑 = 主視窗 2026-08-15 裁定,不是 Sean 拍板**
 *    (理由:後台內部路由、不對外、不影響 SEO、與既有 `/settings/*` 同族)。
 *    **改起來成本低,不要當成釘死的。**
 * 🔴🔴 **`label` = 「操作紀錄」是 Sean 2026-08-15 拍板(`Q-選單名 = 乙`;甲「稽核紀錄」、
 *    丙「誰改了什麼」都沒選)。**
 *    ⚠️⚠️ **「內部叫 audit、畫面上叫操作紀錄」是刻意的,不是漏改。**
 *    本檔以外的一切內部命名都是 audit —— 資料表 `admin_audit_log`、旗標 `AUDIT_UI_ENABLED`、
 *    路由 `/settings/audit`、`lib/audit/*` 整個目錄。**只有員工看得到的那幾個字不是。**
 *    🔴 **不要「順手統一」把畫面文案改回「稽核紀錄」** —— 那會違反 Sean 自己定的準則
 *    (**操作直覺化:文案寫「怎麼做」,不寫內部語彙**;「稽核」是會計/法遵用語)。
 *    ⚠️ 真要換字,要同步改 `nav-items.test.ts` 與 `app-sidebar.test.ts` 的清單斷言(**那是刻意的**,
 *    見 `app-sidebar.test.ts:86`:斷言完整清單才擋得住「每一項 href 都被改成同一個」這種退化)。
 */
// 🔴 **寫成一行、且與上面那批同一個形狀,不是排版偏好** —— `app-sidebar.test.ts:60-66` 的
//    `navEntries()` regex 要求 `{ key: '…', label: '…', icon: …, href: '…' }` 這個字面形狀
//    (且 `href` 後面**不得有逗號**)。拆成多行或加尾逗號 ⇒ **抽不到 ⇒ 那一項從字面守門裡
//    靜默消失,而測試照樣全綠。** 這正是該檔在防的東西,別讓它從新增的這一項身上漏掉。
const AUDIT_NAV_ITEM: NavItem = { key: 'audit', label: '操作紀錄', icon: 'clock', href: '/settings/audit' };

/**
 * 依旗標算出這次要渲染的導覽清單。
 *
 * 🔴 **稽核項擺最後、不插在「設定」前面** —— 純粹因為插入位置需要 `findIndex`,
 *    而 `findIndex` 找不到時回 `-1`、`slice(0, -1)` 會**靜默吃掉最後一項**。
 *    位置是可以再調的偏好;**靜默少一項不是**。⇒ 用不會出錯的那個寫法。
 *
 * ⚠️ 本函式**不讀 env** —— 旗標值由 server 端算好傳進來(`app/layout.tsx`)。
 *    理由見 `app-sidebar.tsx` 檔頭那段**實測紀錄**(2026-08-15 build 產物比對):
 *    **client bundle 沒有把非 `NEXT_PUBLIC` 的 env 內聯進去,而是改讀一個被換掉的 `process` 模組。**
 */
export function buildNavItems(auditEnabled: boolean): readonly NavItem[] {
  return auditEnabled ? [...BASE_NAV_ITEMS, AUDIT_NAV_ITEM] : BASE_NAV_ITEMS;
}
