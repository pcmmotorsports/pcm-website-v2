import Link from 'next/link';
import type { AuditListRow } from '../../lib/audit/audit-list-view';
import { AdminDataTable, type AdminColumn } from '../shared/admin-data-table';

// audit-log-table.tsx — `#27` D1c-2a:操作紀錄四欄表格。
//
// 🔴 **純顯示、零 I/O、零判斷** —— 吃 `AuditListRow[]`(D1b 的 `toAuditListRow` 已經把
//    代碼→中文、slug→姓名、時間→台北、target→連結四件都做完了)。
//    ⇒ **本檔不得再做任何格式化**;要改顯示規則請改 `audit-list-view.ts`,那裡才有測試。
//
// 🔴 **`before` / `after` 不在這裡** —— 建表 `20260712210000:26-28` 逐字寫那兩欄
//    **可合法含經銷價 / 成本 / PII**,列表層不顯示(plan 驗收 6)。展開檢視是 D1c-2b,
//    而它要有**明確的使用者動作**才出現(驗收 9)。
//    ⚠️ **2026-08-15 Sean 推翻了一個相關前提,更正寫在 `page.tsx` 檔頭** —— 引用前先讀那段。
//
// ⚠️ 用共用積木 `AdminDataTable`,不自己刻表格:它已內含桌機 table / 手機卡片 / 空狀態,
//    而通用 UI 規範 §4-1 要求「手機一律轉卡片、不做橫向捲動表格」(Sean 常用手機遠端操作)。

/**
 * target 欄:三態各自不同,而**「有沒有連結」是最容易被做成假的那一態**。
 *
 * 🔴 `formatAuditTarget` 回的 `href` 為 null 時**不得渲染 `<Link>`** ——
 *    渲染一個空 href 的連結,員工點下去會停在原地或跳到根路徑,
 *    **看起來像「這頁壞了」而不是「這筆沒有可去的地方」。**
 */
function AuditTargetCell({ row }: { row: AuditListRow }) {
  const { label, href } = row.target;
  if (!href) return <span>{label}</span>;
  return (
    <Link href={href} className='underline underline-offset-2'>
      {label}
    </Link>
  );
}

const COLUMNS: ReadonlyArray<AdminColumn<AuditListRow>> = [
  // 🔴 欄序 = 員工問問題的順序(plan §3):**什麼時候 → 誰 → 做了什麼 → 對哪張單**。
  //    不是資料表的欄序。
  { key: 'at', header: '時間', cell: (row) => row.at, mobile: 'meta' },
  { key: 'actor', header: '操作人', cell: (row) => row.actor, mobile: 'sub' },
  { key: 'action', header: '做了什麼', cell: (row) => row.action, mobile: 'title' },
  {
    key: 'target',
    header: '對象',
    cell: (row) => <AuditTargetCell row={row} />,
    mobile: 'sub',
  },
];

export function AuditLogTable({ rows }: { rows: readonly AuditListRow[] }) {
  return (
    <AdminDataTable
      rows={rows}
      columns={COLUMNS}
      getRowKey={(row) => row.id}
      // 🔴 **空狀態文案要說「為什麼這是正常的」** —— 只寫「沒有資料」會被讀成壞掉或權限不對,
      //    而 Sean 第一眼幾乎一定看到空的(這張表目前幾乎沒有資料)。
      emptyText='目前沒有操作紀錄。有人在後台改動資料之後,這裡就會出現紀錄。'
    />
  );
}
