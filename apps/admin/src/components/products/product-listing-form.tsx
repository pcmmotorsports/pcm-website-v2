import { setProductListingAction } from '../../lib/products/product-listing-actions';
import {
  LISTING_PRODUCT_ID_FIELD,
  LISTING_DELISTED_FIELD,
  LISTING_NOTE_FIELD,
  LISTING_RETURN_TO_FIELD,
  LISTING_NOTE_MAX,
} from '../../lib/products/product-listing-form';
import { ADMIN_INPUT_CLASS, AdminForm, AdminFormField } from '../shared/admin-form';
import { ListingToggleSubmitButton } from './product-listing-submit';

// M-4b `#20`:商品詳情頁的上下架表單(server action)。
// plan = `docs/specs/2026-08-19-product-listing-toggle-plan.md`;鏡像 `customers/tier-edit-form.tsx`。
//
// 🔴 **位置=詳情頁,不是列表**(plan §3 主視窗代裁,Sean 可推翻)。理由逐字:
//    「列表每列一顆:員工在【掃視】的狀態下按到 —— 而下架會改變客人看得到什麼;
//      詳情頁:員工已經【打開這一件商品】—— 他知道自己在對誰動手。
//      多一步的成本是【一次點擊】,誤按的成本是【一件商品從店裡消失,而沒有人知道】」
//    ⚠️ 之後若出現「一次下架 20 件」的需求 ⇒ 那是**批次**、是另一片,**不要拿它來反推這一片該放列表**。
//
// 🔴 **`delisted` 用 hidden input 帶字面 `String(!listed)`,不用 checkbox** ——
//    理由(原生 checkbox 送 `'on'` / 不送)寫在 `lib/products/product-listing-form.ts` 檔頭。
//    ⇒ **一顆按鈕送一個明確方向**,而按鈕上的字就是它要做的事。
//
// 🔴 **變更原因是【選填】** —— 那是 RPC 的設計(上下架每天做很多次,Sean 沒有對它拍過必填)。
//    ⚠️ 而**同狀態再按一次時,打了的備註會被丟掉**(NO_CHANGE 零寫入)⇒ 那一格由 action 回
//    `?r=noop_note_dropped`,畫面必須講出來;`footerHint` 也先講一次。

export function ProductListingForm({
  productId,
  listed,
}: {
  productId: string;
  listed: boolean;
}) {
  return (
    <AdminForm
      action={setProductListingAction}
      variant='section'
      hidden={{
        [LISTING_PRODUCT_ID_FIELD]: productId,
        // 🔴 送的是「要變成什麼」,不是「現在是什麼」:上架中 ⇒ 送 true(去下架)。
        [LISTING_DELISTED_FIELD]: String(listed),
        [LISTING_RETURN_TO_FIELD]: `/products/${productId}`,
      }}
      footerHint={
        listed
          ? '下架之後客人立刻看不到這件商品。變更會寫入稽核紀錄(誰、什麼時候、從什麼變成什麼)。'
          : '上架之後客人立刻看得到這件商品。變更會寫入稽核紀錄(誰、什麼時候、從什麼變成什麼)。'
      }
      actions={<ListingToggleSubmitButton listed={listed} />}
    >
      <AdminFormField label='變更原因(選填)'>
        <input
          type='text'
          name={LISTING_NOTE_FIELD}
          maxLength={LISTING_NOTE_MAX}
          placeholder={listed ? '例:原廠停產且無現貨' : '例:補到貨了'}
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>
    </AdminForm>
  );
}
