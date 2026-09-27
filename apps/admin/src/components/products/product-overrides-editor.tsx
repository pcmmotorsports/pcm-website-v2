// 商品文字「我們的版本」編輯(商品編輯丙方案片 2)。
// 版面照設計稿 ~/pcm-mailbox/設計稿-商品編輯-基本資料-20260927.html:每欄一張卡,左邊供應商(唯讀)、右邊我們的版本。
// 🔴 每張卡自己一個 <form>:存標題不會順手把副標、賣點一起送出去(各自一筆稽核,員工也不會誤改別欄)。
// 🔴 「還原成供應商的」= intent=restore ⇒ RPC 刪鍵;欄位清空再存也是還原(見 product-overrides-form.ts)。
// ⚠️ 設計稿上的「賣點可拖曳排序」第一版沒做:用固定格子輸入,順序就是格子由上到下。要拖曳是之後的事。

import { setProductOverrideAction } from '../../lib/products/product-overrides-actions';
import {
  OVERRIDE_FIELD_FIELD,
  OVERRIDE_HIGHLIGHT_FIELD,
  OVERRIDE_HIGHLIGHTS_MAX_COUNT,
  OVERRIDE_HIGHLIGHT_MAX,
  OVERRIDE_INTENT_FIELD,
  OVERRIDE_PRODUCT_ID_FIELD,
  OVERRIDE_RETURN_TO_FIELD,
  OVERRIDE_TEXT_MAX,
  OVERRIDE_VALUE_FIELD,
  type OverrideField,
} from '../../lib/products/product-overrides-form';
import type { ProductOverrides } from '../../lib/products/product-overrides-view';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

const EXTRA_HIGHLIGHT_ROWS = 2;
const PRIMARY_BTN = 'bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium';
const LINK_BTN = 'text-primary h-9 px-2 text-sm underline-offset-2 hover:underline';

export interface SupplierText {
  readonly title: string;
  readonly subtitle: string | null;
  readonly highlights: readonly string[];
}

function Badge({ ours }: { ours: boolean }) {
  return ours ? (
    <span className='rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800'>網站顯示：我們的版本</span>
  ) : (
    <span className='bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs font-medium'>網站顯示：供應商的</span>
  );
}

function OverrideCard({
  productId,
  field,
  label,
  ours,
  hint,
  supplier,
  editor,
}: {
  productId: string;
  field: OverrideField;
  label: string;
  ours: boolean;
  hint: string;
  supplier: React.ReactNode;
  editor: React.ReactNode;
}) {
  return (
    <section data-override-field={field} className='rounded-lg border p-4'>
      <form action={setProductOverrideAction}>
        <input type='hidden' name={OVERRIDE_PRODUCT_ID_FIELD} value={productId} />
        <input type='hidden' name={OVERRIDE_FIELD_FIELD} value={field} />
        <input type='hidden' name={OVERRIDE_RETURN_TO_FIELD} value={`/products/${productId}`} />
        <div className='mb-3 flex items-center gap-2'>
          <h3 className='text-sm font-medium'>{label}</h3>
          <Badge ours={ours} />
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div>
            <p className='text-muted-foreground mb-1 text-xs'>供應商提供（每天同步）</p>
            <div className='bg-muted min-h-9 rounded-md border px-3 py-2 text-sm break-words'>{supplier}</div>
          </div>
          <div>{editor}</div>
        </div>
        <div className='mt-3 flex flex-wrap items-center justify-between gap-2'>
          <p className='text-muted-foreground text-xs'>{hint}</p>
          <div className='flex items-center gap-1'>
            {ours && (
              <button type='submit' name={OVERRIDE_INTENT_FIELD} value='restore' className={LINK_BTN}>
                還原成供應商的
              </button>
            )}
            <button type='submit' name={OVERRIDE_INTENT_FIELD} value='save' className={PRIMARY_BTN}>
              儲存{label}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

export function ProductOverridesEditor({
  productId,
  supplier,
  overrides,
}: {
  productId: string;
  supplier: SupplierText;
  overrides: ProductOverrides;
}) {
  const textField = (field: 'title' | 'subtitle', label: string, supplierValue: string | null, ours: string | null) => (
    <OverrideCard
      productId={productId}
      field={field}
      label={label}
      ours={ours !== null}
      // 審查建議:搜尋(storefront_search_product_ids)還比對供應商原字,要先講清楚(計畫片 10 會修)。
      hint={`${ours !== null ? '存檔後網站約 1 分鐘內更新；清空再儲存等於還原。' : '目前沒有我們的版本。'}客人用新標題搜尋，要等之後搜尋功能更新才找得到。`}
      supplier={supplierValue ?? <span className='text-muted-foreground'>（供應商沒有提供）</span>}
      editor={
        <label className='block'>
          <span className='text-muted-foreground mb-1 block text-xs'>我們的版本</span>
          <input
            name={OVERRIDE_VALUE_FIELD}
            defaultValue={ours ?? ''}
            maxLength={OVERRIDE_TEXT_MAX[field]}
            placeholder='沒填就顯示供應商的'
            className={`${ADMIN_INPUT_CLASS} w-full`}
          />
        </label>
      }
    />
  );

  const ourHighlights = overrides.highlights ?? [];
  const rows = [
    ...ourHighlights,
    ...Array.from({ length: Math.max(0, Math.min(EXTRA_HIGHLIGHT_ROWS, OVERRIDE_HIGHLIGHTS_MAX_COUNT - ourHighlights.length)) }, () => ''),
  ];

  return (
    <>
      {textField('title', '標題', supplier.title, overrides.title)}
      {textField('subtitle', '副標', supplier.subtitle, overrides.subtitle)}
      <OverrideCard
        productId={productId}
        field='highlights'
        label='賣點'
        ours={overrides.highlights !== null}
        hint={`一格一點，空白的格子不會存；最多 ${OVERRIDE_HIGHLIGHTS_MAX_COUNT} 點。要新增更多，先存檔，存完會再多出空白格。`}
        supplier={
          supplier.highlights.length > 0 ? (
            <ul className='list-disc pl-4'>
              {supplier.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : (
            <span className='text-muted-foreground'>（供應商沒有提供）</span>
          )
        }
        editor={
          <fieldset>
            <legend className='text-muted-foreground mb-1 text-xs'>我們的版本（一格一點）</legend>
            <div className='flex flex-col gap-2'>
              {rows.map((h, i) => (
                <input
                  key={i}
                  name={OVERRIDE_HIGHLIGHT_FIELD}
                  defaultValue={h}
                  maxLength={OVERRIDE_HIGHLIGHT_MAX}
                  aria-label={`賣點第 ${i + 1} 點`}
                  placeholder={i >= ourHighlights.length ? '新增一點' : undefined}
                  className={`${ADMIN_INPUT_CLASS} w-full`}
                />
              ))}
            </div>
          </fieldset>
        }
      />
    </>
  );
}
