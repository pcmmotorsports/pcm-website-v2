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
