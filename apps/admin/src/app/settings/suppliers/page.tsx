import Link from 'next/link';
import { SettingsResultBanner } from '../../../components/settings/settings-result-banner';
import { SupplierCreateForm } from '../../../components/settings/supplier-create-form';
import { SupplierTable } from '../../../components/settings/supplier-table';
import { listSuppliersForSettings } from '../../../lib/supplier';
import { filterSupplierCandidates } from '../../../lib/supplier-candidates';
import { boundSupplierQuery } from '../../../lib/supplier-form';
import type { SupplierRow } from '../../../lib/supplier-repository';
import { SUPPLIER_RESULT_MESSAGES } from '../../../lib/supplier-result-messages';

// app/settings/suppliers/page.tsx — M-4b E10 S3b-3:供應商設定頁。
// server component,形狀對照 `settings/staff/page.tsx`,但有**兩處刻意的偏離**:
//   ①讀取失敗時不渲染新增表單(見 loadFailed 分支)。
//   ②🔴 **import 走相對路徑而不是 `@/`** —— vitest 的 `@` alias 指向
//     **`apps/storefront/src`**(`vitest.config.ts:28`,admin 沒有自己的 alias)
//     ⇒ 用 `@/` 寫的 admin 頁面在測試裡 resolve 不到、根本 render 不起來。
//     這正是 `settings/staff/page.tsx` 的頁面層行為至今零測試的原因,
//     也是 `[K1-M7]` 那個「loadFailed 仍渲染新增表單」的缺陷沒有被任何測試抓到的原因。
//     ⇒ 本頁刻意不繼承那個寫法,好讓 `page.test.tsx` 測得到 loadFailed 與 `?r=` 兩條路。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。

export const dynamic = 'force-dynamic';

const SETTINGS_PATH = '/settings/suppliers';

type SearchParams = Record<string, string | string[] | undefined>;

/** URL 參數一律只取字串形態;`?q=a&q=b` 會被 Next 解析成陣列 ⇒ 當作沒給。 */
function singleParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export default async function SupplierSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  // 🔴 `?r=` **只用於查表**、`?q=` **只當過濾字串**,兩者永不直接渲染成文字
  //    (plan §3.5 / §3.7 第③條)。`q` 來自 URL 的任意輸入,`boundSupplierQuery`
  //    只收斂空白與長度(≤100),**不**過濾控制字元或 U+202E 這類方向覆寫字
  //    ⇒ 把它印到畫面上是本頁明文禁止的事,下方「已定位」提示因此不含 `q` 的內容。
  const resultCode = singleParam(raw.r) ?? undefined;
  const locate = boundSupplierQuery(singleParam(raw.q));

  let rows: SupplierRow[] = [];
  let loadFailed = false;
  try {
    rows = await listSuppliersForSettings();
  } catch (error) {
    console.error('[admin/settings/suppliers] 供應商名單載入失敗', error);
    loadFailed = true;
  }

  // 撞名時 action 會帶 `?r=duplicate&q=<label>` 回來(Sean 2026-08-02 拍板 Q2=A:
  // 只定位 + 標記,系統**不代按**啟用)。定位用的是**同一支**過濾純函式,
  // 不是另寫一套比對 —— 否則「候選裡看得到」與「清單定位得到」會各漂各的。
  const located =
    locate === null ? rows : filterSupplierCandidates(rows, locate);
  // 🔴 定位不到就退回完整清單:名單被清空比沒定位更糟(員工會以為那家不見了,
  //    然後再建一筆**永久刪不掉**的重複列)。撞名當下那一列一定在,但頁面可能是
  //    重整、書籤或別人剛把它改名之後才打開的。
  // 🔴 `located.length < rows.length` 是 R1 nit 補的:`q` 若命中每一列
  //    (例如單一常見字元、或名單只剩一家),畫面會宣稱「目前只顯示 N 家」+ 給一個
  //    「顯示全部」連結,而它其實什麼都沒過濾掉 —— 那句話就是假的。
  const locating =
    locate !== null && located.length > 0 && located.length < rows.length;

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>供應商管理</h1>
        {/* 🔴 這裡是 JSX 純文字,**不會**解析 markdown —— 第一版寫了 `**建立後不可刪除**`,
            員工看到的是逐字的星號(R1 抓;三綠看不見,因為沒有任何測試斷言這段開場白)。
            🔴 也不得寫「停用後不會出現在新單的選單裡」:`is_active` 目前**零下游消費者**
            (`listSuppliers()` 全 repo 無生產呼叫端,採購表單 A10b 還沒做)⇒ 那是對未來的承諾,
            而 plan §6 明文「不得說停用功能已生效」。 */}
        <p className='text-muted-foreground text-sm'>
          新增下單對象、修改名稱,或停用不再往來的供應商。
          供應商建立後不可刪除;停用只是把它標記起來,舊採購紀錄照常顯示。
        </p>
      </div>

      {loadFailed ? (
        // 🔴 **刻意偏離 staff 樣板**(`settings/staff/page.tsx:47-55` 在讀取失敗時
        //    仍然渲染新增表單):名單載不出來 ⇒ 候選恆為空 ⇒ 員工看不到「這家已經有了」
        //    ⇒ 建一筆**永久刪不掉**的重複列。供應商不可刪除,所以這裡 fail-closed:
        //    連同新增表單一起不渲染,只留錯誤訊息(plan §3.1 `[K1-M7]`)。
        // 🔴🔴 **result banner 也一起不渲染**(codex K2 R2 must-fix 1):
        //    每一則結果文案都在指路到「下方清單」(找出那一家 / 按該列的啟用),
        //    而這條路上根本沒有清單 ⇒ 那是一句做不到的指示。上一輪我只拿掉了
        //    「已定位」三個字,**沒發現「到下方清單找出那一家」是同一個謊的另一半** ——
        //    `feedback_claimed-sync-but-only-patched-touched-lines` 的同型復發。
        //    ⇒ 改成:結果碼存在時只誠實說「有一次操作、結果這裡講不清楚、請重整確認」。
        <div className='border-destructive/30 bg-destructive/5 text-destructive space-y-2 rounded-lg border p-6 text-sm'>
          <p>
            供應商名單載入失敗,請稍後再試或聯絡系統維護。
            在名單恢復之前不能新增供應商 —— 看不到現有名單就新增,會建立重複且無法刪除的資料。
          </p>
          {resultCode !== undefined && (
            <p>
              你剛才那次操作的結果訊息無法在這裡顯示 —— 它要指到清單上的某一列,
              而清單現在載不出來。請在名單恢復後重新整理確認。
            </p>
          )}
        </div>
      ) : (
        <>
          <SettingsResultBanner
            code={resultCode}
            messages={SUPPLIER_RESULT_MESSAGES}
          />

          {locating && (
            <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-sm'>
              {/* 🔴 不寫「剛才那個名稱」(codex K2 R2 nit):`q` 是任意 URL 輸入,
                  直接開一個帶 `q` 的網址時根本沒有「剛才」這回事。 */}
              <span>清單目前只顯示符合網址篩選條件的 {located.length} 家。</span>
              <Link href={SETTINGS_PATH} className='underline'>
                顯示全部
              </Link>
            </div>
          )}

          <SupplierTable rows={locating ? located : rows} />

          {/* 🔴 候選來源是**完整**名單(`rows`),不是定位後的 `located` ——
              定位是為了讓員工看到「那一家」,不是把候選面板一起縮到一家
              (那會讓 typeahead 在撞名之後正好失效,而那正是最需要它的時候)。
              驗收 16h 釘的也是這一份:候選必須來自 `listSuppliersForSettings()` 的輸出。 */}
          <SupplierCreateForm rows={rows} resultCode={resultCode} />
        </>
      )}
    </div>
  );
}
