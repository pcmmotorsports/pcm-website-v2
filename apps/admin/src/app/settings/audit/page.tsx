import { notFound } from 'next/navigation';
// 🔴 **相對路徑,不用 `@/`** —— vitest 的 `@` alias 指向 `apps/storefront/src`
//    (`vitest.config.ts:28`)⇒ 用 `@/` 寫,`page.test.tsx` 就 resolve 不到本檔的依賴,
//    而那道「直接打網址會不會被擋」的負測就**跑不起來**(症狀是整族解析失敗,不是紅一格)。
//    形狀照抄同層既有前例 `app/settings/suppliers/page.tsx:2-9`(該頁檔頭寫了同一個理由)。
import { isAuditUiEnabled } from '../../../lib/audit/audit-ui-flag';

export const dynamic = 'force-dynamic';

// page.tsx — `#27` D1c-1:稽核紀錄檢視的**頁殼 + 第二道閘**。
//
// ── 🔴 為什麼頁本體也要擋(這是本片唯一的 must)────────────────────────
//   **只擋側欄 = 擋的是「看得到入口」,不是「進得去」。** 側欄那一項不渲染時,
//   **直接在網址列打 `/settings/audit` 照樣進得來** ⇒ 那不是「到不了」。
//   ⇒ 兩處都要接,而且**兩道閘必須各自獨立紅**:
//     刪掉本檔這行 `notFound()`,側欄那側的守門**一格都不會紅**(它量的是清單,不是可達性)。
//   守門在 `page.test.tsx`,它**不經過側欄任何一行 code**。
//   (`audit-ui-flag.ts:22-23` 檔頭逐字寫了同一件事;主視窗 2026-08-15 派工信再釘一次。)
//
// ── 為什麼是 `notFound()` 而不是導回首頁 ────────────────────────────
//   語意是「這頁在旗標關閉時**不該存在**」,與 `app/customers/[id]/page.tsx:24` 同族(既有前例)。
//   ⚠️ **本頁是獨立路由、不在 `@panel` 平行路由槽裡** —— 槽裡呼叫 `notFound()` 炸掉的是
//   **整個頁面**(`app/@panel/orders/page.tsx:51-53` 記過,主視窗 2026-08-10 裁⑤)。不吃這個坑。
//
// 🔴 **路徑 `/settings/audit` = 主視窗 2026-08-15 裁定,不是 Sean 拍板**
//   (後台內部路由、不對外、不影響 SEO)。**改起來成本低,別當釘死的。**
//
// ⚠️ **D1c-1 只做到頁殼**:表格與展開檢視是 D1c-2。
//   顯示層(`lib/audit/audit-list-view.ts`)與讀取埠(`AuditLogReader`)D1b/D1a-2 已備好,
//   本片**刻意不接** —— 先把「進不進得去」閉環,再談好不好看。
export default function AuditLogPage() {
  if (!isAuditUiEnabled()) notFound();

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>操作紀錄</h1>
        <p className='text-muted-foreground text-sm'>
          後台每一筆異動的紀錄:誰、什麼時候、對哪張單、做了什麼。
        </p>
      </div>

      <div className='text-muted-foreground rounded-lg border p-6 text-sm'>
        紀錄表格尚未接上(D1c-2)。
      </div>
    </div>
  );
}
