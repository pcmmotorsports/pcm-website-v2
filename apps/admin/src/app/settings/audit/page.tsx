import { notFound } from 'next/navigation';
// 🔴 **相對路徑,不用 `@/`** —— vitest 的 `@` alias 指向 `apps/storefront/src`
//    (`vitest.config.ts:28`)⇒ 用 `@/` 寫,`page.test.tsx` 就 resolve 不到本檔的依賴,
//    而那道「直接打網址會不會被擋」的負測就**跑不起來**(症狀是整族解析失敗,不是紅一格)。
//    形狀照抄同層既有前例 `app/settings/suppliers/page.tsx:2-9`(該頁檔頭寫了同一個理由)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { isAuditUiEnabled } from '../../../lib/audit/audit-ui-flag';
import { toAuditListRow } from '../../../lib/audit/audit-list-view';
import { diffAuditPayload } from '../../../lib/audit/audit-diff';
import { getAdminAuditLogReader } from '../../../lib/orders/order-repository';
import { listActiveStaff } from '../../../lib/staff';
import { AuditLogTable, type AuditTableRow } from '../../../components/audit/audit-log-table';

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
// ── 🔴🔴 2026-08-15:`20260815020000` 檔頭的正當性,前半段已被 Sean 推翻 ────────────
//   **被推翻的原句**(逐字,留痕不刪):
//     > 本片開放 SELECT 的正當性建立在「後台目前只有 Sean 一人測試、員工未上工」。
//     > **員工真正上工之前,真認證必須先落地** —— 否則自選身分的人讀得到經銷價 / 成本 / PII。
//   **Sean 2026-08-15 原話**(經主視窗轉達):
//     > **「是可以甲, 但是成本、客戶客人資料 **員工是可以看的**」**
//   ⇒ **前半段(員工未上工所以還安全)是錯的前提** —— **不是因為員工還沒上工才安全,
//     是因為員工本來就該看得到這些。** 內容本身不是風險。
//   ✅ **後半段仍然成立,而且現在是唯一的理由**:
//     🔴 **真認證要的不是「擋員工」,是「確認進來的人真的是員工」。**
//     🔴🔴 **這兩處原本寫的是 `#26`,而那是【錯號】**(2026-08-18 E 窗查、C 窗複驗):
//        backlog 的 `#26`(`docs/phase-1-backlog.md:829`)是
//        「**✅ 已收 · `partiallyRefunded` transition 評估**」—— **與真認證毫無關係,而且是已收的**。
//        ⇒ **任何人照 `#26` 去查會看到一個 ✅,然後結論是「這件做完了」** ——
//        **而它一行都沒做,而這段講的是經銷價 / 成本 / PII 讀得到。**
//        ⇒ 🔴 **指到一個【已收的錯號】,比指不到還糟:它給的是【錯的安心】。**
//     **改指到查得到的東西(逐一核過,不挑一個最像的)**:
//        · **`E8-B`** = 真登入線的既有代號(`grep -rn 'E8-B' docs/` ⇒ **77 命中**,不是 `#NNN` 號)
//        · **`#215`** 🔴 `pcm-tier` cookie **非身分權威** ⇒ **經銷價洩漏** —— 與本段的「讀得到」同一面
//        · **`#436`** 🎭 admin RPC 的 `p_actor` 是**存在性驗證不是身分驗證** ⇒ 稽核痕跡可被冒名
//          ⚠️ **`#436` 與本段【不是同一件】** —— 它管「帳本上的誰做的可不可信」,
//             本段管「誰讀得到」。**兩個都列是因為單一號涵蓋不了,不是因為分不出來。**
//     Sean 說的是**員工**可以看,**不是任何登入的人**都可以看。
//   ⇒ **風險的形狀變了:不是「內容太敏感」,是「身分沒驗過」。兩者要防的東西不同。**
//   ⚠️ **那支 migration 已 apply、不得回頭改** ⇒ 更正只能寫在這裡。引用該檔頭前先讀本段。
//
// ⚠️ **D1c-2a = 表格 + 三狀態**;展開檢視(顯示 `before`/`after`)是 **D1c-2b**,已批准、尚未做。
export default async function AuditLogPage() {
  if (!isAuditUiEnabled()) notFound();

  // 🔴 **`50` 寫在這裡是刻意的**:`AuditLogReader.listRecent(limit)` **沒有預設值**
  //    (`lib/audit/repository.ts:73-75` 逐字:預設值會讓「這頁一次抓幾筆」藏在最底層,
  //     而那是頁面層的決定)。⇒ 這個數字要看得見。
  //    ⚠️ **50 是我(C 窗)定的,不是拍板** —— 一頁看得完、又不會讓人覺得「只有幾筆」。改起來一行。
  const LIMIT = 50;

  // ── 🔴🔴 「讀取失敗」與「沒有資料」必須走兩條路,而這是機制不是文案 ────────────
  //   `SupabaseAuditLogReader.listRecent()` 出錯時**是 throw、不是回 `[]`**(D1a-2 刻意如此)。
  //   ⇒ 若這裡寫成 `catch { rows = [] }`,畫面會顯示「目前沒有操作紀錄」——
  //     **那就是「壞掉但看起來完全正常」**,而且是**親手把 D1a-2 的設計意圖丟掉**。
  //   🔴 同形狀已在同一天的訂單線獨立踩過一次(「拿不到值 ≠ 0」,換一個資料型別)
  //     ⇒ 主視窗裁定:守門那格 **must,不准降級**。負測在 `page.test.tsx`。
  let rows: AuditTableRow[] = [];
  let loadFailed = false;
  try {
    const [logs, staff] = await Promise.all([
      getAdminAuditLogReader().listRecent(LIMIT),
      listActiveStaff(),
    ]);
    // 🔴 差異在**頁面層**算,不塞進 `toAuditListRow` —— 那支是 D1b 的顯示層,
    //    檔頭逐字寫著 `before`/`after` 不在它的輸出裡(plan 驗收 6)。
    rows = logs.map((log) => ({
      ...toAuditListRow(log, staff),
      changes: diffAuditPayload(log.before, log.after),
    }));
  } catch (error) {
    console.error('[admin/settings/audit] 操作紀錄載入失敗', error);
    loadFailed = true;
  }

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>操作紀錄</h1>
        <p className='text-muted-foreground text-sm'>
          後台每一筆異動的紀錄:誰、什麼時候、對哪張單、做了什麼。
        </p>
      </div>

      {loadFailed ? (
        // 🔴 **文案與空狀態必須讀起來完全不同** —— 這一塊的存在意義就是讓員工分得出
        //    「沒人動過東西」和「這頁讀不到資料」。長得像的話,這道分流等於沒做。
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          操作紀錄載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <AuditLogTable rows={rows} />
      )}
    </div>
  );
}
