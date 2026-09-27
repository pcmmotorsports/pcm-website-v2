'use client';

// 商品文字「我們的版本」編輯(商品編輯丙方案片 2;商品頁改版乙 B3 改成三欄一次儲存)。
// 版面照設計稿 ~/pcm-mailbox/設計稿-商品編輯-基本資料-20260927.html:每欄一張卡,左邊供應商(唯讀)、右邊我們的版本。
// 🔴 B3(計畫 ~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第五節;審視 E2):
//    ⛔ ~~每張卡自己一個 <form>, 改三樣要存三次~~ ⇒ 三欄同一個表單、一顆「儲存」;後端仍逐欄寫、逐欄留紀錄。
//    · 存完停在原位:不 redirect, 結果顯示在儲存鈕旁邊(有一欄沒存成功時講清楚是哪一欄)。
//    · 沒動過的欄位標成 unchanged, 伺服器不送那一欄:存標題時不會用舊內容蓋掉別人剛改的副標、賣點。
//    · 用 onSubmit 自己送出, 不用 <form action>:React 的 form action 送完會把欄位重設, 沒存成功時員工剛打的字會不見。
// 🔴 「還原成供應商的」只把那一欄清空(不送出);按儲存時空白就是還原 ⇒ RPC 刪鍵(見 product-overrides-form.ts)。
// ⚠️ 設計稿上的「賣點可拖曳排序」第一版沒做:用固定格子輸入,順序就是格子由上到下。要拖曳是之後的事。

import { startTransition, useActionState, useRef, type ReactNode } from 'react';
import { saveProductTextAction } from '../../lib/products/product-overrides-actions';
import {
  OVERRIDE_HIGHLIGHT_FIELD,
  OVERRIDE_HIGHLIGHTS_MAX_COUNT,
  OVERRIDE_HIGHLIGHT_MAX,
  OVERRIDE_PRODUCT_ID_FIELD,
  OVERRIDE_SUBTITLE_FIELD,
  OVERRIDE_TEXT_MAX,
  OVERRIDE_TITLE_FIELD,
  OVERRIDE_UNCHANGED_FIELD,
  describeTextSave,
  type OverrideField,
  type TextSaveState,
} from '../../lib/products/product-overrides-form';
import type { ProductOverrides } from '../../lib/products/product-overrides-view';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

const EXTRA_HIGHLIGHT_ROWS = 2;
const PRIMARY_BTN = 'bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50';
const LINK_BTN = 'text-primary h-9 px-2 text-sm underline-offset-2 hover:underline';
const IDLE: TextSaveState = { kind: 'idle' };

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
  field,
  label,
  ours,
  hint,
  supplier,
  editor,
  onRestore,
}: {
  field: OverrideField;
  label: string;
  ours: boolean;
  hint: string;
  supplier: ReactNode;
  editor: ReactNode;
  onRestore: () => void;
}) {
  return (
    <section data-override-field={field} className='rounded-lg border p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <h3 className='text-sm font-medium'>{label}</h3>
        <Badge ours={ours} />
        {ours && (
          <button type='button' onClick={onRestore} className={`${LINK_BTN} ml-auto`}>
            還原成供應商的
          </button>
        )}
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div>
          <p className='text-muted-foreground mb-1 text-xs'>供應商提供（每天同步）</p>
          <div className='bg-muted min-h-9 rounded-md border px-3 py-2 text-sm break-words'>{supplier}</div>
        </div>
        <div>{editor}</div>
      </div>
      <p className='text-muted-foreground mt-3 text-xs'>{hint}</p>
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
  const [state, formAction, pending] = useActionState(saveProductTextAction, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const clear = (name: string) => {
    for (const el of formRef.current?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`) ?? []) el.value = '';
  };
  const said = describeTextSave(state);

  const textField = (field: 'title' | 'subtitle', label: string, supplierValue: string | null, ours: string | null) => (
    <OverrideCard
      field={field}
      label={label}
      ours={ours !== null}
      onRestore={() => clear(field === 'title' ? OVERRIDE_TITLE_FIELD : OVERRIDE_SUBTITLE_FIELD)}
      // 審查建議:搜尋(storefront_search_product_ids)還比對供應商原字,要先講清楚(計畫片 10 會修)。
      hint={`${ours !== null ? '存檔後網站約 1 分鐘內更新；清空再儲存等於還原。' : '目前沒有我們的版本。'}客人用新標題搜尋，要等之後搜尋功能更新才找得到。`}
      supplier={supplierValue ?? <span className='text-muted-foreground'>（供應商沒有提供）</span>}
      editor={
        <label className='block'>
          <span className='text-muted-foreground mb-1 block text-xs'>我們的版本</span>
          <input
            // Codex R1 必修 2:key 綁伺服器目前的值 ⇒ 存成功或同事剛改, 這一格換成新值(value 又等於 defaultValue,
            // 「沒動過」判得準);伺服器沒變的欄位不重掛, 員工剛打的字留著。
            key={ours ?? ''}
            name={field === 'title' ? OVERRIDE_TITLE_FIELD : OVERRIDE_SUBTITLE_FIELD}
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
    <form
      ref={formRef}
      id='product-text'
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        // 沒動過的欄位標成 unchanged, 伺服器就不送那一欄(不會用舊內容蓋掉別人剛改的)。
        const untouched = (name: string) =>
          [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].every((i) => i.value === i.defaultValue);
        if (untouched(OVERRIDE_TITLE_FIELD)) fd.append(OVERRIDE_UNCHANGED_FIELD, 'title');
        if (untouched(OVERRIDE_SUBTITLE_FIELD)) fd.append(OVERRIDE_UNCHANGED_FIELD, 'subtitle');
        if (untouched(OVERRIDE_HIGHLIGHT_FIELD)) fd.append(OVERRIDE_UNCHANGED_FIELD, 'highlights');
        startTransition(() => formAction(fd));
      }}
    >
      <input type='hidden' name={OVERRIDE_PRODUCT_ID_FIELD} value={productId} />
      {/* 儲存中鎖住欄位(Fable R2 建議):回應回來時存成功的欄位會重掛成新值, 儲存中補打的字會不見。
          FormData 在按下儲存那一刻就取好了, 鎖住不影響送出的內容。 */}
      <fieldset disabled={pending} className='min-w-0 space-y-4'>
      {textField('title', '標題', supplier.title, overrides.title)}
      {textField('subtitle', '副標', supplier.subtitle, overrides.subtitle)}
      <OverrideCard
        field='highlights'
        label='賣點'
        ours={overrides.highlights !== null}
        onRestore={() => clear(OVERRIDE_HIGHLIGHT_FIELD)}
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
            {/* Codex R1 必修 1:格子用索引當 key、搭配 defaultValue, 存完賣點變少時舊格子不會換值(會留空白, 下次存就清掉)。
                ⇒ 整組 key 綁伺服器目前的賣點, 伺服器的值一變就整組重排。 */}
            <div key={JSON.stringify(overrides.highlights)} className='flex flex-col gap-2'>
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
      </fieldset>
      <div className='flex flex-wrap items-start justify-end gap-3'>
        {said !== null && (
          <div role='status' className={`flex-1 text-sm ${said.tone === 'ok' ? 'text-emerald-700' : 'text-destructive'}`}>
            {said.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        )}
        <button type='submit' disabled={pending} className={PRIMARY_BTN}>
          {pending ? '儲存中…' : '儲存標題、副標、賣點'}
        </button>
      </div>
    </form>
  );
}
