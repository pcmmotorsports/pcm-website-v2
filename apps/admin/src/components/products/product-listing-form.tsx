import { setProductListingAction } from '../../lib/products/product-listing-actions';
import {
  LISTING_PRODUCT_ID_FIELD,
  LISTING_DELISTED_FIELD,
  LISTING_NOTE_FIELD,
  LISTING_RETURN_TO_FIELD,
  LISTING_CONFIRM_FIELD,
  LISTING_CONFIRM_OWNER_FIELD,
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
  variantSkuCollisionOwner,
}: {
  productId: string;
  listed: boolean;
  /**
   * 🔵 **第一層(給人看的那一層)**(板 `⟦b4-NOVARIANT1⟧`, Sean `Q2=甲`)。
   * 有值 = 這支商品的料號是【那一支商品】的一個規格 ⇒ 它八成是重複匯進來的空殼。
   *
   * 🔴 **為什麼要在按鈕【旁邊】而不是按下之後才說**:
   *    一個只在按下之後才出現的警告, 讀的人已經在「我要完成這件事」的狀態裡了。
   * 🛑 而它**只在【要上架】時有意義** —— 下架一支可疑商品永遠是安全的。
   */
  variantSkuCollisionOwner?: string | null;
}) {
  // 🔴 `listed === true` 表示這顆鈕要做的是【下架】⇒ 那一側不問。
  const askConfirm = !listed && typeof variantSkuCollisionOwner === 'string' && variantSkuCollisionOwner !== '';
  return (
    <AdminForm
      action={setProductListingAction}
      variant='section'
      hidden={{
        [LISTING_PRODUCT_ID_FIELD]: productId,
        // 🔴 送的是「要變成什麼」,不是「現在是什麼」:上架中 ⇒ 送 true(去下架)。
        [LISTING_DELISTED_FIELD]: String(listed),
        [LISTING_RETURN_TO_FIELD]: `/products/${productId}`,
        // 🔴🔴 **這裡【只送 owner】, 不送 confirm** —— 那是 codex R1 #1 打掉的東西:
        //    ⛔ ~~原本 hidden 自動夾帶 `confirm='true'`~~ ⇒ 那是**畫面幫員工確定了**,
        //      而不是他確定。⇒ confirm 現在是下面那個【他要自己勾】的 checkbox。
        //    🔵 而 owner 仍然用 hidden 送:它不是「他的決定」, 是**他看到的那句話的內容**,
        //      server 端拿它比對現在算出來的是不是同一支 ⇒ 擋 stale confirmation。
        ...(askConfirm ? { [LISTING_CONFIRM_OWNER_FIELD]: variantSkuCollisionOwner } : {}),
      }}
      footerHint={
        listed
          ? '下架之後客人立刻看不到這件商品。變更會寫入稽核紀錄(誰、什麼時候、從什麼變成什麼)。'
          : '上架之後客人立刻看得到這件商品。變更會寫入稽核紀錄(誰、什麼時候、從什麼變成什麼)。'
      }
      actions={<ListingToggleSubmitButton listed={listed} />}
    >
      {askConfirm ? (
        <p className='rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900'>
          {/* 🔴 **一定要說得出【是誰的規格】** —— 一句「這支看起來怪怪的」會被一路按過去,
              而一個講得出對方料號的句子, 員工可以當場去查。 */}
          ⚠️ 這支商品看起來是「{variantSkuCollisionOwner}」的一個規格,不是一件獨立商品。
          <br />
          先確認它該獨立存在再上架 —— 上架之後客人會在店裡看到兩個一樣的東西。
          {/* 🔴🔴 **這個 checkbox 就是那道確認本身** —— 它必須是員工【自己勾】的動作。
              value 用死值 `'true'`(原生 checkbox 勾了送 `'on'`, 而 parse 那側只認 `'true'`)
              ⇒ 沒勾 ⇒ 瀏覽器【根本不送這一欄】⇒ server 端當「沒確認」⇒ 擋下。 */}
          <label className='mt-2 flex items-center gap-2 font-medium'>
            <input type='checkbox' name={LISTING_CONFIRM_FIELD} value='true' />
            我確認這支商品該獨立存在,要上架
          </label>
        </p>
      ) : null}
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
