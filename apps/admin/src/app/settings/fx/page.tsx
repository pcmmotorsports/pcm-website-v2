import { SettingsResultBanner } from '@/components/settings/settings-result-banner';
import type { ManagePermission } from '@/components/settings/staff-edit-row';
import { setFxRateAction } from '@/lib/fx/fx-rate-actions';
import { FX_RESULT_MESSAGES } from '@/lib/fx/fx-rate-messages';
import { listFxRateRows } from '@/lib/fx/fx-rate-repository';
import { currentFxRates, FX_CURRENCIES, type FxRateRow } from '@/lib/fx/fx-rate-view';
import { formatOrderDateTime } from '@/lib/orders/order-detail-view';
import { getSessionActorIdWithSource } from '@/lib/session/actor';
import { listStaffRows } from '@/lib/staff-repository';

// /settings/fx — 後台「設定 › 匯率」(plan `docs/plans/2026-09-13-fx-rate-settings-plan.md`;主視窗裁獨立一頁)。
//
// 一列一幣別:現在的匯率 / 生效起 / 誰改;老闆那一列多一格「改」= 存成【新的一列】(append-only),舊列不動。
// 下面「最近的變更」是同一張表倒著列(含未來生效的)。TWD 固定 1、沒有輸入格。
//
// 🔴 **今天零消費端**:這頁存的數字還沒有任何算式在讀(plan §1-c)。文案只說「之後存的訂單會用」,
//    那是拍板的方向(memory `project_0913-admin-order-ux-redesign-rulings.md`),不是已接上的功能。
//
// 三態權限(yes / no / unknown)與那句話抄 `settings/mail/page.tsx`;文案改成本頁的(那裡那格逐字警告過)。
//
// 🔴 字級每一格都帶 `leading-[1.4]`:`FIX-27`(globals.css)會把沒帶 leading 的 `.text-sm`/`.text-xs` 拉大一號,
//    稿的 12.5 / 13 / 14.5 要照抄就得帶(`invoice-cheatsheet-panel.tsx:37` 那段實測)。

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const TH = 'px-2 py-[6px] text-left text-[11.5px] leading-[1.4] font-semibold';
const TD = 'px-2 py-[5px] text-[13px] leading-[1.4] align-middle';
const INPUT = 'border-input bg-background h-7 w-[112px] rounded-md border px-2 font-mono text-[13px] leading-[1.4]';
const BTN = 'bg-primary text-primary-foreground hover:bg-primary/90 h-7 rounded-md px-3 text-[12.5px] leading-[1.4] font-medium';

export default async function FxRateSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const resultCode = typeof raw.r === 'string' ? raw.r : undefined;

  let rows: FxRateRow[] = [];
  let loadFailed = false;
  try {
    rows = await listFxRateRows();
  } catch (error) {
    console.error('[admin/settings/fx] 匯率載入失敗', error);
    loadFailed = true;
  }

  let canManage: ManagePermission = 'unknown';
  try {
    const { id } = await getSessionActorIdWithSource();
    const staff = await listStaffRows();
    const me = id ? staff.find((row) => row.id === id) : undefined;
    canManage = me?.is_active === true && me.is_manager === true ? 'yes' : 'no';
  } catch (error) {
    console.error('[admin/settings/fx] 權限判定失敗', error);
    canManage = 'unknown';
  }

  const current = currentFxRates(rows, new Date());
  const labelOf = (code: string) => FX_CURRENCIES.find((c) => c.code === code)?.label ?? code;

  return (
    <div className='mx-auto space-y-3'>
      <div className='space-y-[2px]'>
        <h1 className='text-[16px] leading-[1.4] font-semibold'>匯率</h1>
        <p className='text-muted-foreground text-[12.5px] leading-[1.4]'>
          1 單位外幣 = 多少台幣。改了只影響之後存的訂單;已經存過的不會回頭重算。每一次改都留一列,舊的不會被蓋掉。
        </p>
      </div>

      <SettingsResultBanner code={resultCode} messages={FX_RESULT_MESSAGES} />

      {canManage !== 'yes' ? (
        <p className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-[12.5px] leading-[1.4]' role='status'>
          {canManage === 'no'
            ? '只有管理者可以改匯率。你目前不是管理者,這頁只能看。'
            : '暫時無法確認你的權限,所以改匯率的格子先不顯示。請重新整理,或稍後再試。'}
        </p>
      ) : null}

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-[12.5px] leading-[1.4]'>
          匯率載入失敗,請稍後再試或聯絡系統維護。這不代表沒有設過 —— 它代表我們現在讀不到。
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full'>
              <thead className='bg-muted/40 text-muted-foreground'>
                <tr>
                  <th className={TH}>幣別</th>
                  <th className={`${TH} text-right`}>現在匯率</th>
                  <th className={TH}>生效起</th>
                  <th className={TH}>誰改</th>
                  {canManage === 'yes' ? <th className={TH}>改成</th> : null}
                </tr>
              </thead>
              <tbody>
                {current.map((c) => (
                  <tr key={c.code} className='border-t' data-testid={`fx-row-${c.code}`}>
                    <td className={TD}>
                      <span className='font-mono'>{c.code}</span>
                      <span className='text-muted-foreground ml-[6px] text-[12px] leading-[1.4]'>{c.label}</span>
                    </td>
                    <td className={`${TD} text-right font-mono`}>
                      {c.rate ?? <span className='text-muted-foreground font-sans text-[12px] leading-[1.4]'>還沒設</span>}
                    </td>
                    <td className={`${TD} text-muted-foreground`}>{c.fixed ? '固定' : c.effectiveFrom ? formatOrderDateTime(c.effectiveFrom) : '—'}</td>
                    <td className={`${TD} text-muted-foreground`}>{c.fixed ? '—' : (c.by ?? '—')}</td>
                    {canManage === 'yes' ? (
                      <td className={TD}>
                        {c.fixed ? (
                          <span className='text-muted-foreground text-[12px] leading-[1.4]'>固定 1,不可改</span>
                        ) : (
                          <form action={setFxRateAction} className='flex items-center gap-[6px]'>
                            <input type='hidden' name='currency_code' value={c.code} />
                            <input
                              name='rate_to_twd'
                              inputMode='decimal'
                              required
                              pattern='\d{1,9}(\.\d{1,6})?'
                              placeholder={c.rate ?? '例 32.5'}
                              aria-label={`${c.code} 新匯率`}
                              className={INPUT}
                            />
                            <button type='submit' className={BTN}>存</button>
                          </form>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className='rounded-md border px-3 py-2'>
            <summary className='cursor-pointer text-[12.5px] leading-[1.4] font-semibold'>
              最近的變更({rows.length} 列{rows.length >= 200 ? ',只列最近 200' : ''})
            </summary>
            {rows.length === 0 ? (
              <p className='text-muted-foreground mt-1 text-[12.5px] leading-[1.4]'>還沒有人設過匯率。</p>
            ) : (
              <table className='mt-1 w-full'>
                <thead className='text-muted-foreground'>
                  <tr>
                    <th className={TH}>幣別</th>
                    <th className={`${TH} text-right`}>匯率</th>
                    <th className={TH}>生效起</th>
                    <th className={TH}>誰改</th>
                    <th className={TH}>何時改</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className='border-t'>
                      <td className={TD}><span className='font-mono'>{r.currency_code}</span> <span className='text-muted-foreground text-[12px] leading-[1.4]'>{labelOf(r.currency_code)}</span></td>
                      <td className={`${TD} text-right font-mono`}>{r.rate_to_twd}</td>
                      <td className={`${TD} text-muted-foreground`}>{formatOrderDateTime(r.effective_from)}</td>
                      <td className={`${TD} text-muted-foreground`}>{r.created_by}</td>
                      <td className={`${TD} text-muted-foreground`}>{formatOrderDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        </>
      )}
    </div>
  );
}
