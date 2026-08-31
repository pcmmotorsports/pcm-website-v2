import { SettingsResultBanner } from '@/components/settings/settings-result-banner';
import { permissionNotice, type ManagePermission } from '@/components/settings/staff-edit-row';
import { Button } from '@/components/ui/button';
import { requeueDeadEmailAction } from '@/lib/mail/dead-letter-actions';
import { DEAD_LETTER_RESULT_MESSAGES } from '@/lib/mail/dead-letter-messages';
import { listDeadLetters } from '@/lib/mail/dead-letter-read';
import { getSessionActorIdWithSource } from '@/lib/session/actor';
import { listStaffRows } from '@/lib/staff-repository';

// /settings/mail — M-4b ⟦b4-MAILDEAD⟧:寄不出去的信(死信)清單 + 重排。
//
// 🔴 **這一頁在 2026-09-01 之前【不存在】,而那是這一片真正的範圍**:
//    `grep -rn "email_outbox" apps/admin/src`(非測試)⇒ **0 處**,不加過濾也是 0
//    ⇒ 📌 員工收到死信告警之後,進後台**沒有任何地方**看得到那封信。
//    ⇒ 那顆重排的 RPC 2026-08-31 就上線了,而它**0 個呼叫端** —— 這一頁是它的第一個。
//
// 🔴 **三態權限(yes / no / unknown)是抄的,不是我發明的** —— Sean 2026-08-31 拍甲。
//    `unknown` 也停用,**而它與 `no` 的差別在那句話**:
//    「你沒有權限」與「暫時無法確認權限」對使用者是兩件事,而灰掉的按鈕長得一樣。
//    ⚠️ **為什麼不用現成的 `isActiveManager`**:它回**布林** ——
//      `false` 同時代表「不是管理者」與「查不出來」⇒ 三態在資料進頁面之前就塌成兩態
//      (`staff-edit-row.tsx:17` 逐字記著這一格)。
//    ⇒ 代價明寫:為了判一個人的權限,這裡**撈了整份員工名單**(今天 2 人,成本可忽略)。
//
// 🔵 **刻意沒有二次確認對話**:誤按的代價是「一封本來就該寄的信重試一次」——
//    那支 RPC 的白名單只認 `pending`/`failed` 且 attempts 已燒完 ⇒ **按不到已寄出的信**。
//    ⚠️ 而它**不是零代價**:重排會讓下一輪 cron 真的寄一封信給真的客人。
//      哪天這裡開始出現誤按,回來看這一段,不要重新評估一次。

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MailDeadLetterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const resultCode = typeof raw.r === 'string' ? raw.r : undefined;

  const list = await listDeadLetters();

  let canManage: ManagePermission = 'unknown';
  try {
    const { id } = await getSessionActorIdWithSource();
    const rows = await listStaffRows();
    const me = id ? rows.find((row) => row.id === id) : undefined;
    canManage = me?.is_active === true && me.is_manager === true ? 'yes' : 'no';
  } catch (error) {
    console.error('[admin/settings/mail] 權限判定失敗', error);
    canManage = 'unknown';
  }

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>寄不出去的信</h1>
        <p className='text-muted-foreground text-sm'>
          這裡列出還沒寄成功的信。標「已放棄」的才排得回去,其餘的系統還會自己再試。
          <br />
          <strong>重排會讓下一輪真的寄一封信給客人。</strong>
          信的內容是寄送當下才組的,所以會用到最新的追蹤碼與品項 ——
          但系統<strong>不會</strong>檢查這張訂單後來是不是已經取消、退款或改過地址。
          按之前請先看一眼那張訂單。
        </p>
      </div>

      <SettingsResultBanner code={resultCode} messages={DEAD_LETTER_RESULT_MESSAGES} />

      {permissionNotice(canManage) ? (
        <p
          className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'
          role='status'
        >
          {permissionNotice(canManage)}
        </p>
      ) : null}

      {list.loadFailed ? (
        /* 🔴 「讀不到」與「一封都沒有」**不可以長一樣** —— 一個是我們壞了,一個是好消息。 */
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          死信清單載入失敗,請稍後再試或聯絡系統維護。
          <br />
          這<strong>不代表</strong>一封都沒有 —— 它代表我們現在讀不到。
        </div>
      ) : list.rows.length === 0 ? (
        <div className='text-muted-foreground rounded-lg border p-6 text-sm'>
          目前沒有等待寄送的信。
        </div>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/40 text-muted-foreground'>
              <tr>
                <th className='p-3 text-left font-medium'>訂單</th>
                <th className='p-3 text-left font-medium'>信件種類</th>
                <th className='p-3 text-left font-medium'>狀態</th>
                <th className='p-3 text-left font-medium'>試了幾次</th>
                <th className='p-3 text-left font-medium'>最後的錯誤</th>
                <th className='p-3 text-left font-medium'>排進來的時間</th>
                <th className='p-3 text-right font-medium'>動作</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id} className='border-t'>
                  <td className='p-3 font-mono text-xs'>{row.orderId}</td>
                  <td className='p-3'>{row.eventType}</td>
                  <td className='p-3'>{row.status}</td>
                  <td className='p-3'>
                    {row.attempts} / {row.maxAttempts}
                    {/* 🔴 「已放棄」與「還會再試」要在畫面上分得出來 ——
                        兩者現在列在同一張表裡(codex R1 must-fix 4 的修法),
                        而它們的差別決定那顆鈕按不按得動。 */}
                    <span className='text-muted-foreground ml-2 text-xs'>
                      {row.isDead ? '已放棄' : '還會再試'}
                    </span>
                  </td>
                  {/* 🔴 沒有錯誤碼要印一個看得出來的東西 —— 空白格與「沒有錯誤」長得一樣。 */}
                  <td className='p-3 font-mono text-xs'>{row.lastErrorCode ?? '(沒有記到)'}</td>
                  <td className='p-3'>{row.createdAt}</td>
                  <td className='p-3 text-right'>
                    <form action={requeueDeadEmailAction}>
                      <input type='hidden' name='outbox_id' value={row.id} />
                      <Button
                        type='submit'
                        size='sm'
                        variant='outline'
                        disabled={canManage !== 'yes' || !row.isDead}
                      >
                        重排
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.truncated ? (
        <p className='text-muted-foreground text-sm' role='status'>
          還有沒列出來的 —— 這一頁只顯示最舊的一批。處理完再重新整理。
        </p>
      ) : null}
    </div>
  );
}
