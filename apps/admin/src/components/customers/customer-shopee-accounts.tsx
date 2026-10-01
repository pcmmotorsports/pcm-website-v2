import { addShopeeAccountAction, deleteShopeeAccountAction } from '../../lib/customers/shopee-account-actions';
import type { ShopeeAccount } from '../../lib/customers/shopee-accounts';
import { formatCustomerDate } from '../../lib/customers/customer-list-view';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

// 客人頁「個人資料」卡裡的蝦皮帳號(貼板 261;Sean 2026-10-01 蝦皮帳號 Q1 甲:一位客人可記多個)。
// 建蝦皮單時會自動記上來;這裡可以手動新增、刪除。帳號全站不分大小寫唯一, 記在別的客人身上會擋下並說明。

const BUTTON = 'h-9 rounded-md border px-3 text-sm font-medium';

export function CustomerShopeeAccounts({
  customerId,
  accounts,
  loadFailed,
  readOnly,
}: {
  customerId: string;
  accounts: ShopeeAccount[];
  loadFailed: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className='mt-3 border-t pt-3'>
      <div className='text-muted-foreground mb-2 text-sm'>蝦皮帳號</div>
      {loadFailed ? (
        <p className='text-destructive text-sm'>蝦皮帳號載入失敗，請重新整理頁面。</p>
      ) : accounts.length === 0 ? (
        <p className='text-muted-foreground text-sm'>還沒有記錄蝦皮帳號。</p>
      ) : (
        <ul className='space-y-1'>
          {accounts.map((a) => (
            <li key={a.id} className='flex flex-wrap items-center gap-2 text-sm'>
              <span className='font-medium break-all'>{a.account}</span>
              <span className='text-muted-foreground text-xs'>記錄於 {formatCustomerDate(a.createdAt)}</span>
              {!readOnly && (
                <form action={deleteShopeeAccountAction} className='ml-auto'>
                  <input type='hidden' name='customer_id' value={customerId} />
                  <input type='hidden' name='account_id' value={a.id} />
                  <button type='submit' className={BUTTON} aria-label={`刪除蝦皮帳號 ${a.account}`}>
                    刪除
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && !loadFailed && (
        <form action={addShopeeAccountAction} className='mt-2 flex flex-wrap items-center gap-2'>
          <input type='hidden' name='customer_id' value={customerId} />
          <input
            name='shopee_account'
            aria-label='新的蝦皮帳號'
            placeholder='蝦皮帳號'
            autoComplete='off'
            required
            maxLength={64}
            pattern='\S+'
            title='蝦皮帳號不能有空白'
            className={`${ADMIN_INPUT_CLASS} min-w-0 flex-1`}
          />
          <button type='submit' className={BUTTON}>
            新增蝦皮帳號
          </button>
        </form>
      )}
    </div>
  );
}
