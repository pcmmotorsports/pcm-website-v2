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
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
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
// 🔴🔴 **2026-09-13 晚 Sean 答甲:側欄 11 項 → 6 項。** 主視窗端題時明講「設定灰字點不動那一拍(08-20 甲)可以動嗎」,
//    他答甲 ⇒ **知情下推翻自己 08-20 那一拍**。目標逐字:
//      「總覽 · 訂單 · 出貨 · 客戶 · 商品 · 設定▸(員工 / 供應商 / 優惠券 / 寄不出去的信 / 操作紀錄)」
//    · **退款異常 不再佔一格** ⇒ 變成總覽頁上的紅色數字(B 窗「總覽頁改成今天要做的事」那片,**同一個計數來源**,
//      `sidebar-counts.ts` 的 `refundExceptionCount` 不另做第二份)。它的頁面 `/orders/refund-exceptions` **還在**,只是側欄不列。
//    · **寄不出去的信** 收進「設定」群組(它也會在總覽上有數字,但頁面要到得了 ⇒ 群組裡留入口)。
//    · **優惠券** 收進「設定」:今天那頁唯讀、沒有建券入口(`app/coupons/page.tsx` 檔頭逐字「本頁唯讀」)
//      ⇒ 一週改 0 次 ⇒ 鐵則 9 的判準下它是設定不是日常操作。哪天建券做出來再搬回軌上,那時再問。
// 🔴 **每一項仍然是單行字面、`href` 後不得有逗號** —— `app-sidebar.test.ts` 的 `navEntries()` regex 守門認的是這個形狀,
//    它掃的是整支檔,所以分成兩個陣列不影響它(它照樣抓到全部 10 條 + 稽核那條)。
const BASE_NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', label: '總覽', icon: 'dashboard', href: '/' },
  { key: 'orders', label: '訂單', icon: 'billing', href: '/orders' },
  { key: 'shipments', label: '出貨清單', icon: 'post', href: '/shipments' },
  { key: 'customers', label: '客戶', icon: 'user', href: '/customers' },
  { key: 'products', label: '商品', icon: 'product', href: '/products' },
];

/**
 * 「設定」群組裡的入口 —— 軌上只顯示「設定」一格,點了展開這幾項(旗標開時再多「操作紀錄」,見 `buildNavItems`)。
 * 🔴 `PARKED_NAV_ITEM` 仍是群組的**表頭**(沒有 href、不是頁面),而它現在**點得動** —— 見該常數的註解。
 */
const SETTINGS_GROUP_ITEMS: readonly NavItem[] = [
  { key: 'staff', label: '員工管理', icon: 'teams', href: '/settings/staff' },
  { key: 'suppliers', label: '供應商', icon: 'post', href: '/settings/suppliers' },
  { key: 'coupons', label: '優惠券', icon: 'billing', href: '/coupons' },
  { key: 'maildead', label: '寄不出去的信', icon: 'alertCircle', href: '/settings/mail' },
  // 2026-09-13 匯率(plan 2026-09-13-fx-rate-settings-plan.md;主視窗裁獨立一頁,入口在設定群組)。
  { key: 'fx', label: '匯率', icon: 'billing', href: '/settings/fx' },
];

// ⛔ **退款異常自 2026-09-13 起不在側欄**(Sean 答甲):頁面 `/orders/refund-exceptions` 仍在、計數搬到總覽(B 窗那片,
//    讀 `sidebar-counts.ts` 同一個 `refundExceptionCount`)。**這裡刻意不留那條字面** —— 留著會被 `navEntries()` 抓成一個入口,
//    而「有字面沒入口」正是那道守門在防的形狀。要找它的 href 去 `app/orders/refund-exceptions/page.tsx`。

/**
 * 「設定」—— 🔴 **它在軌上【最下面】、灰字、點不動,而這是 Sean 拍板,不是我隨手擺的。**
 *
 * 🔴 **2026-08-20 Sean 拍板甲:設定改放【軌上最下面】,灰字、點不動。**
 *   ~~定案稿 `admin-sidebar-rail-final.html:357` 逐字:「『設定』**不在軌上出現** ——
 *   它連預設狀態都沒有,只在滑出清單底部以灰字＋『未啟用』存在。」~~ ⇒ **作廢**
 *   ⇒ 它是「拿掉滑出面板」那個拍板的**連帶**:設定原本住在那塊清單裡,清單沒了就得換地方。
 *   ⚠️ 本 export 的名字 `PARKED_NAV_ITEM` 仍然成立(它仍是「停在那裡、沒有頁面可去」那一項),
 *      **變的是它畫在哪裡,不是它是什麼**。
 * ⚠️ **這一格我差點做錯**:轉述給我的版本是「停在最底下、未啟用」——
 *    照那句我會**在軌上留一格灰的**,而稿上沒有那一格。
 *    📌 加出來的東西最難被發現,因為讀的人不會去稿上找一個不存在的東西的反證。
 *
 * 而它**沒有 href** 的理由不變(M-4b E10 A9w2:唯一去處已隨九碼退場下架)——
 * 兩件事剛好一致:**沒有頁面可去** ⇒ **畫成未啟用**。
 * 🔴 而它從 `BASE_NAV_ITEMS` 搬出來**不影響既有字面守門** ——
 *    `app-sidebar.test.ts:74` 那條 regex 要求 `href: '…'`,而本項從來就沒有 href
 *    ⇒ 它本來就不在那條守門的分母裡(**這是查過的,不是推的**)。
 */
// 🔴🔴 **2026-09-13 晚 Sean 答甲:「設定」從灰字點不動變成【可展開的群組表頭】。** 上面那段 08-20 甲的理由**照留**
//    (它解釋了為什麼這一格曾經是灰的,而下一個讀稿的人會撞到那份定案稿),**而它已被知情推翻**:
//    主視窗端題時明講「側欄那條要你先點頭『設定』那一拍可以動」,他答甲。⇒ 仍然**沒有 href**(它不是頁面),
//    改成點了展開 `SETTINGS_GROUP_ITEMS`;`app-sidebar.test.ts` 那格「不得有 href」照舊成立。
export const PARKED_NAV_ITEM: NavItem = { key: 'settings', label: '設定', icon: 'settings' };

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
  return auditEnabled
    ? [...BASE_NAV_ITEMS, ...SETTINGS_GROUP_ITEMS, AUDIT_NAV_ITEM]
    : [...BASE_NAV_ITEMS, ...SETTINGS_GROUP_ITEMS];
}

/**
 * 側欄要的兩段:軌上直接顯示的 `rail`(5 項)+ 「設定」群組裡的 `settings`(4 項,旗標開 5 項)。
 * 🔴 `settings` 由 `buildNavItems` 減去 `rail` 算出來,**不是另一份清單** —— 旗標那條邏輯只住在 `buildNavItems` 一處,
 *    這裡不重複判旗標(重複 = 兩邊哪天不一樣,而「操作紀錄」出不出現就變成看誰先跑)。
 */
export function buildRailNav(auditEnabled: boolean): { rail: readonly NavItem[]; settings: readonly NavItem[] } {
  const all = buildNavItems(auditEnabled);
  const railKeys = new Set(BASE_NAV_ITEMS.map((i) => i.key));
  return { rail: all.filter((i) => railKeys.has(i.key)), settings: all.filter((i) => !railKeys.has(i.key)) };
}
