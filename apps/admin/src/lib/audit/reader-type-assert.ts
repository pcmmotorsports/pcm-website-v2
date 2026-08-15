// reader-type-assert.ts — **型別層負測**:釘住 `getAdminAuditLogReader()` 回**介面**、不回具象類別。
//
// 🔴 **為什麼副檔名不是 `.test.ts`**:它 import `lib/orders/order-repository.ts`,而那支頂層有
//   `import 'server-only'` ⇒ **在 vitest 環境會 throw**(該檔自己的註解 `:22` 早就寫了
//   「未在 vitest 覆蓋:本檔 import server-only〔node/測試環境會 throw〕」)。
//   ⇒ 放成 `.test.ts` 會讓整個檔在執行期紅掉(**我第一版就是這樣,被全測抓到:1 failed**)。
//   ⇒ 本檔**不進 vitest 的 include glob**,由 `tsc --noEmit` 檢查 —— **它要驗的本來就只有型別。**
//
// 🔴 **它怎麼會紅**:若有人把回傳型別改回 `SupabaseAuditLogReader`,下面那個指派**會變成合法**
//   ⇒ `@ts-expect-error` 變成「未使用的抑制」⇒ **`tsc` 報 `TS2578` 而紅**。
//   **實測(2026-08-15)**:現行回介面 ⇒ typecheck **8/8 綠**;改回具象類別 ⇒ **7/8,`TS2578` 逐字**。
//
// 🔴 **為什麼需要這一格**(E 窗 2026-08-15 確認輪 must-fix):
//   本檔姊妹 getter(`getAdminOrderRepository` / `getAdminAuditLogRepository`)**本來就回具象類別**
//   ⇒ **回具象是那個檔的既有慣例**,下一個人「順手統一」改回去是完全可能的,而**沒有任何東西會叫**。
//   機制:`constructor(private readonly selector: …)` 的 `private` 讓類別**名義化**,介面對它不可指派。
//
// ⚠️ **審查員自標的限度,原樣寫在這裡**:它**只找到形狀先例,沒找到真的會撞的既有呼叫端** ——
//   `getAdminAuditLogReader()` **今天零消費者**。⇒ **不削弱這格的判別力,但今天沒有人正在被它擋。**
//   🔴 **這道守門是先架好的,不是因為出過事。** 下一個人要知道這個分別。
import type { AuditLogReader } from './repository';
import type { SupabaseAuditLogReader } from './supabase-repository';
import type { getAdminAuditLogReader } from '../orders/order-repository';

type Returned = ReturnType<typeof getAdminAuditLogReader>;

// 🔴 **`declare const` 而不是真的呼叫** —— 本檔零執行期 import(上面全是 `import type`),
//   所以 `order-repository.ts` 的 `import 'server-only'` 不會被觸發。
declare const probe: Returned;

// 🔴 **這一格就是負測本體**:現行回介面 ⇒ 這個指派非法 ⇒ `@ts-expect-error` 有作用 ⇒ 綠。
//   改回具象類別 ⇒ 指派變合法 ⇒ 抑制未使用 ⇒ **`TS2578` 紅**。
// @ts-expect-error 介面不可指派給帶 private 成員的具象類別(TS2741: 'selector' is missing)
const asConcrete: SupabaseAuditLogReader = probe;
void asConcrete;

// 正向對照:證明上面那格不是「回傳型別根本不符介面」的假紅 —— 它確實符合介面。
const asInterface: AuditLogReader = probe;
void asInterface;

// ⚠️ 第一版我用 `T extends U ? … : …` 條件型別寫 —— **那個形式不會報錯**,
//   `@ts-expect-error` 立刻變成未使用 ⇒ **typecheck 直接紅**。**斷言方向錯了,不是實作錯。**
//   (記在這裡:型別層負測要用**指派**,不要用條件型別 —— 條件型別只會解析,不會拒絕。)
