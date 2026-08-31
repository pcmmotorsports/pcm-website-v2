import type { MemberTier, Paginated } from '../shared/types';

export type CustomerId = string; // = auth.users.id uuid(M-1-14 customers PK)

/**
 * Customer: 會員 entity(M-1-14 擴自 M-0-04 type stub)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §4.1 + Supabase migration
 * `20260523034911_init_customers_and_subtables` customers 表(M-1-14a);
 * 逐欄對齊 design AccountPages.jsx L312-414 user 物件(email / name / phone / birthday)。
 *
 * 命名:DB snake_case ↔ domain camelCase(wallet_balance ↔ walletBalance 等)、由 adapter mapper 轉。
 * tier 由後台手動標記(Q1=A、design TierComponents L27)、客人不可自改(DB column GRANT + RLS 守);
 * tier 寫入不經 ICustomerRepository(走 service_role、見 IAdminCustomerRepository M-4a)。
 *
 * walletBalance / totalDeposit 用 number(非 shared/MoneyAmount brand):
 * brand type 強制非負、但這兩欄語意上由 ledger signed amount 累加而來(use entry 為負);
 * 整數性由 DB integer column + CHECK constraint 守(M-1-14a)、不在 domain 重複守門。
 *
 * 子 entity 分檔:[[address]] / [[vehicle]] / [[wallet]](identity/address.ts 等)。
 */
export type Customer = {
  id: CustomerId;
  email: string;
  name: string;
  phone: string;
  birthday: string | null; // ISO date 'YYYY-MM-DD' or null
  tier: MemberTier;
  walletBalance: number; // Q1=B:DB trigger 同步、authenticated 不可直寫
  totalDeposit: number; // Q1=B:累積儲值(後台參考門檻、非 auto-upgrade 觸發)
  createdAt: string; // ISO datetime
  updatedAt: string;
};

// ── M-4a 客戶管理:後台客戶列表讀模型(admin read-model)──

/**
 * AdminCustomerFilter: 後台客戶列表篩選(value-object;全欄可選、缺 = 不限)。
 *
 * v1 只 `tier` 軸(依會員等級找經銷 / 一般客);free-text 姓名 / email 搜尋留 follow-up。
 *
 * 🔴 **2026-08-16 更新那個 follow-up 的狀態(它已經不是「有空再說」了)**:
 *    那個缺口已排成 **`#525`**(`docs/phase-1-backlog.md`)、plan 在
 *    `docs/specs/2026-08-16-525-customer-search-plan.md`。
 *    **實測後果**:正式庫 11 位客戶中 **7 位零訂單**,而**零訂單的客人在訂單搜尋的
 *    `orders JOIN customers` 上完全撈不到** ⇒ 現況只能用眼睛翻列表(一頁 20 筆、註冊日期新到舊)。
 * ⚠️ **本行上面那句「留 follow-up」保留不刪** —— 它記錄的是「當初知情」這個事實,
 *    刪掉會讓後人以為這是漏做。**要改的是它的狀態,不是它的存在。**
 * 🔴 **`keyword` 已加進型別,但【後端尚未實作】** —— 見該欄位自己的 docstring。
 */
/**
 * 後台客戶列表的**排序軸**(2026-08-19 W3;主視窗裁「這不是決策題」——
 * 一個列表顯示了三個數字欄而不能按它們排序,換任何一個後台都會有)。
 *
 * 🔴 **與 `AdminCustomerFilter` 分開,是刻意的**:篩選決定**哪些列進來**,
 *    排序決定**它們怎麼排** —— 兩者混在一個型別裡,下一個人會把排序值也拿去做 where 下推。
 *
 * 🔴 **三個鍵各自對應 `admin_customer_list_v` 已經存在的欄**,零 migration:
 * ```
 * spend      active_spend_total      零訂單 ⇒ 0（view 已 coalesce）
 * orders     active_order_count      零訂單 ⇒ 0（count 不會 NULL）
 * lastOrder  last_active_ordered_at  零訂單 ⇒ **NULL**（view 檔頭逐字「刻意不 coalesce」）
 * ```
 * ⚠️ **`lastOrder` 那顆的 NULL 是這一軸最大的坑** —— 見 `SupabaseCustomerAdapter` 那段
 *    `nullsFirst` 的註解:Postgres `DESC` 預設 **NULLS FIRST**
 *    ⇒ 不處理的話,「最後下單由新到舊」的第一頁**全是從來沒下過單的人**,而畫面看起來完全正常。
 *
 * 📌 **不含預設排序** —— 預設維持 `created_at DESC`,而**換預設是行為改動**
 *    (那是 Sean 每天打開先看到誰),不歸這一片。`undefined` = 用預設。
 */
export const ADMIN_CUSTOMER_SORT_KEYS = ['spend', 'orders', 'lastOrder'] as const;
export type AdminCustomerSortKey = (typeof ADMIN_CUSTOMER_SORT_KEYS)[number];
export type AdminCustomerSort = {
  readonly key: AdminCustomerSortKey;
  /** `true` = 由小到大 / 由舊到新。 */
  readonly ascending: boolean;
};

export type AdminCustomerFilter = {
  tier?: MemberTier;
  /**
   * 搜尋詞(姓名 / Email / 電話的子字串)。`undefined` = 不搜尋。
   *
   * 🔴 **`undefined` 與 `''` 是兩條路,不可互換**:前者不打 RPC,後者會打一次必然全空的 RPC。
   *
   * **走 RPC(POST + JSON body)而不是 `.or()`**(`Q-525-1`):
   * **`.or()` 是把值內插進 PostgREST 的 GET query string** ⇒ 值裡的字元會改變 filter 結構;
   * 訂單側之所以不需要字元集守門,**正是因為它走 `.rpc()`**
   * (理由全文 `packages/domain/src/order/keyword-search.ts:20-28`)。
   * ⚠️ 連帶:**搜尋詞是 PII,不進 URL、不進 log** —— UI 端走 httpOnly cookie + PRG。
   *
   * ⚠️ **2026-08-16 訂正一條假宣稱(不刪除,留著當紀錄)**:
   * 上一版這裡逐字寫「`customer-filter-bar` 有一格守門釘住『客戶篩選列沒有搜尋輸入框』,
   * **那是刻意的絆線**:接 UI 的那一片必須自覺地移除它」。
   * 🔴 **那格守門【從來不存在】** —— `apps/admin/src/components/customers/` 底下
   * **一個測試檔都沒有**,全樹搜「搜尋」在該目錄零命中。
   * ⇒ 它宣稱要攔的那件事(有人順手把搜尋框加上去而沒想過 fail-open)**一次都不會響**。
   * 🔴 **教訓**:**寫下一條絆線的【描述】,與【裝上】那條絆線,是兩件事** ——
   * 而讀的人(包括三小時後的我)會把描述讀成「有人守著了」。
   */
  keyword?: string;

  /**
   * 生日的**月份** 1-12。`undefined` = 不篩。
   *
   * 對應 `admin_customer_list_v.birth_month`(`20260826140000` 那支 migration 加的)。
   * Sean 2026-08-26 `e:丙`「兩個都要」的第一半:**這個月生日的客人**(生日行銷)。
   *
   * 🔴 **UI 給的是【12 個月的下拉】,不是一顆「本月」開關** —— 而這是刻意的:
   * ① 員工要準備下個月的行銷時,不必等到下個月才篩得到。
   * ② 🔴 **更重要**:一顆「本月」開關需要**伺服器知道今天是幾月**,
   *    而伺服器跑 UTC ⇒ **台灣時間每月 1 號凌晨 0-8 點,它還在上個月**
   *    ⇒ 會印出一份**看起來完全正常**的名單,而那名單是上個月的人。
   *    **改成下拉之後,這一軸【結構上不需要時鐘】** ⇒ 那個坑不是被小心避開,是被移除。
   * ⚠️ 而**年齡那一軸仍然需要今天**(見 `birthdayFrom` / `birthdayTo`),那個坑只搬走一半。
   */
  birthMonth?: number;

  /**
   * 年齡下界 / 上界(都**含**)。`undefined` = 不限。**這是使用者打的那個值。**
   *
   * 🔴🔴 **為什麼年齡與日期【兩個都在 filter 裡】**(2026-08-26 `code-reviewer` R1 must-fix):
   * 上一版把年齡放在 `buildCustomerListHref` 的**第 4 個 optional 參數**,而其他每一軸都住在
   * `filter` 裡 ⇒ **三個呼叫點全部忘了傳** ⇒ 翻頁、清關鍵字、按欄頭排序,
   * **年齡條件靜靜消失而月份還在** ⇒ 筆數變多、畫面自洽、零訊號。
   * ⇒ **根因是形狀不是手滑:optional 參數必然被忘。** 兩個都掛在同一個物件上,就沒有東西可以忘。
   *
   * 🔴 **兩者的分工是硬的,不要合併也不要互推**:
   * ```
   * ageMin / ageMax          使用者打的 ⇒ 進網址(網址明天還要指到同一批人)
   * birthdayFrom / birthdayTo 換算出來的 ⇒ 進查詢(adapter 只認日期, 不碰時鐘)
   * ```
   * ⚠️ **它們只在 `parseCustomerListSearchParams` 裡【一起】被設定**,別處不得單獨改其中一半
   * —— 單獨改會讓「網址說的」與「查詢做的」漂開,而**畫面上看不出來**。
   * 那條不變式有一格測試釘著(`customer-list-view.test.ts` 的「年齡與日期同源」)。
   */
  ageMin?: number;
  /** 見 `ageMin`。 */
  ageMax?: number;

  /**
   * 生日**下界**(含),`YYYY-MM-DD`。`undefined` = 不限。
   *
   * 🔴 **這裡刻意存【日期】不存【年齡】** —— 年齡要靠「今天」才算得出來,
   * 而把「今天」放進 adapter 會讓那一層**不可單測**(每天跑出不同結果)。
   * ⇒ 換算在純函式層 `customer-list-view.ts` 的 `birthdayRangeForAges(min, max, today)`,
   *   `today` 由呼叫端明給。**adapter 只做 `.gte` / `.lte`,不碰時鐘。**
   *
   * ⚠️ 年齡→日期的換算**用日期界線,不用天數除以 365** ——
   * 除法遇到閏年會漂,而 **2/29 出生的人是它最先出錯的地方**。
   */
  birthdayFrom?: string;

  /** 生日**上界**(含),`YYYY-MM-DD`。`undefined` = 不限。理由同 `birthdayFrom`。 */
  birthdayTo?: string;

  /**
   * 性別代碼。`undefined` = 不篩。
   *
   * 對應 `admin_customer_list_v.gender`(`20260901010000` 那支 migration 加的,
   * 值域由底表的 `customers_gender_chk` 管 —— `20260831150000`)。
   * Sean 2026-08-26 逐字「當然要做啊......... 性別、生日這個在客戶註冊時候也要有」的第三段。
   *
   * 🔴 **這裡手寫一份聯集,而 `GENDER_CODES` 的正本在 `@pcm/schemas`** ——
   * 不是重複,是 `packages/domain` **不依賴** `@pcm/schemas`(package.json 實查 0)。
   * ⇒ 而這正是本 repo 既有的慣例:同一支檔的 `MemberTier`(`../shared/types.ts:70`)
   *   也是手寫的,旁邊配一支 `member-tier-enum-drift.test.ts` 在盯。
   * ⚠️ 而**本欄配的不是那種漂移測試** —— 那支掃的是 `CREATE TYPE … AS ENUM`,
   *   而 gender 是 **CHECK 不是 enum** ⇒ 抄過來要重寫整組 regex。
   *   📌 **那不是「嫌麻煩」,是【那把尺量的不是這個東西】。**
   *   改用**型別層斷言**釘住這份手抄 vs `GENDER_CODES`,落點
   *   `apps/admin/src/lib/customers/customer-list-view.test.ts`(兩邊都看得到的那一層)。
   *
   * 🔴🔴 **`'unset'` 是哨兵,不是一個性別** —— 它代表 `gender IS NULL`。
   * 規格逐字要求(`docs/specs/2026-08-26-customer-gender-birthday-spec.md:86`):
   *   「後台篩選的 UI 要**分得開「未填」與「不透露」**,不要只給一個「空白」。」
   * ⇒ 而那兩者在資料上就是兩件事(同檔 `:79-83`):
   *   `NULL` = **沒機會填 / 還沒填**(含【全部】OAuth 註冊者)
   *   `'undisclosed'` = 他看過那張表單,而**他選了不說**
   * 🛑 **上一版我漏了這一格**(codex R3 2026-09-01 換角度抓到):
   *   下拉只有 男/女/不透露 ⇒ **上線當天三個選項都會回 0 筆**(今天 14 筆全 NULL),
   *   而員工會把它讀成「沒有這種客人」,不是「這批資料還沒收到」。
   *   📌 **一個回 0 的篩選器與一個壞掉的篩選器,在畫面上長得一樣。**
   *
   * 🔴 **NULL 的人用 `'unset'` 才篩得到,而那是【多數】** —— 只有 Email 註冊路徑會填這一欄,
   * Google 一鍵與 LINE 進來的使用者恆 NULL(結構,不是漏做;全文在 `customers.gender`
   * 的 `COMMENT ON COLUMN`)。⇒ 用它做出來的任何分布都只涵蓋 Email 註冊那一群,
   * **而那個偏差在畫面上沒有形狀。**
   */
  gender?: 'male' | 'female' | 'undisclosed' | 'unset';
};

/**
 * AdminCustomerSummary: 後台客戶列表摘要投影(admin read-model、server 分頁)。
 *
 * 🔴 刻意**排除** `walletBalance` / `totalDeposit`(#202 儲值金台灣法規 HOLD、不進雛型)+ `birthday`(列表不需);
 * 型別層無任何成本 / 經銷價欄(customers 表本身無)。`tier` = 會員等級標籤(admin 需知經銷身分、**非價格**);
 * `phone` 可 null(DB 欄 nullable);`createdAt` ISO 原樣(UI 端格式化)。
 */
export type AdminCustomerSummary = {
  id: CustomerId;
  name: string;
  email: string;
  phone: string | null;
  tier: MemberTier;
  /** 註冊時間 ISO(customers.created_at 原樣) */
  createdAt: string;

  // ── 客戶頁三欄(`admin_customer_list_v` 的聚合欄)────────────────────────────
  //
  // 🔴 **三欄共用一條口徑:已取消的訂單不算。** 不扣退款。
  //    主視窗 2026-08-16 裁(消費金額那條)+ Q-522-分母 同一天裁「最後下單也排除」——
  //    理由是**兩欄並排必須共用一條規則**,否則員工要學兩套而畫面看起來是同一組資訊。
  //    ⚠️ 要「他最近有沒有來」那個行為訊號,那是**另一個欄位**(「最後互動」),不是改這欄。
  //
  // ⚠️ **欄名帶 `active` 是刻意的** —— 對齊 view 的 `active_order_count` 等。
  //    UI 標籤仍是 Sean 指定的「訂單數 / 消費金額 / 最後下單」;
  //    **標籤旁要不要註明「不含已取消」是文案題,本片沒做。**

  /** 未取消訂單數。零訂單 = 0(不會是 null)。 */
  activeOrderCount: number;
  /** 未取消訂單的 total 加總,**整數元位**(禁浮點)。零訂單 = 0。 */
  activeSpendTotal: number;
  /**
   * 最後一筆未取消訂單的建立時間 ISO。
   * 🔴 **零訂單 = `null`,不是 0 也不是空字串** —— 沒有一個合理的「零日期」。
   *    UI 必須顯示成「從未下單」或「—」,**不得留白**:留白與載入失敗長得一樣。
   */
  lastActiveOrderedAt: string | null;
};

/**
 * 後台客戶列表的回傳(`#525`)—— `Paginated` + **關鍵字搜尋的兩個訊號**。
 *
 * 🔴 **為什麼不直接加寬 `Paginated<T>`**:那會為了一個分支去加寬**所有**消費端都看得到的共用型別。
 * 這裡加寬的是**這一支方法的回傳**,其他人的 `Paginated` 一個字不動。
 * (形狀逐字對齊訂單側的 `AdminOrderListResult`,兩條線的搜尋讀法因此可以共用心智模型。)
 */
export type AdminCustomerListResult = Paginated<AdminCustomerSummary> & {
  /**
   * 🔴 **精確語意:「關鍵字【自己】命中的客戶超過上限,RPC 只回了最新的 100 筆」**
   * —— **不是**「畫面上這個結果集被截斷」。
   * RPC 先取全域前 100,才在第二段與 tier 篩選取交集 ⇒
   * `true` 時**第 101 筆之後的命中看不到**,而畫面可能顯示 0 筆
   * (真正符合的人**整批落在那 100 筆之外**)。
   *
   * 🔴 **所以 UI 必須在 `true` 時【一律】顯示「結果太多,請輸入更精確的關鍵字」,包含 0 筆的情況**
   * —— **0 筆 + 沒有提示 = 員工得到「查無此人」的錯誤結論**,而那正是 migration `COMMENT`
   * 逐字要禁的形狀(「靜默截斷會讓員工以為就這幾筆」)。
   * ⚠️ 型別上的必填只約束**產出者**;真正防靜默截斷的守門是畫面測試。
   */
  keywordTruncated: boolean;
  /**
   * 關鍵字**自己**命中的筆數(非 PII)。`null` = **根本沒查**(沒帶 keyword)。
   * 🔴 `0` 與 `null` **不可互換**:前者是「查過了、DB 說沒有」,後者是「沒查」——
   * 混掉的話畫面會對「沒搜尋」的狀態說「命中 0 筆」。
   */
  keywordMatchCount: number | null;
};
