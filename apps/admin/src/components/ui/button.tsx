// button.tsx — shadcn Button。
//
// ── 🔴 2026-08-22:動效接上 BMW M token(`--motion-fast` / `--ease-standard`)──────
//   **接線前它們是「宣告在、消費端 0」** —— `docs/design/admin-design-system.md` 檔頭那張
//   落地狀態表逐字寫著「值存在但沒有任何元件吃它;寫『已套用動效規範』是假的」。
//   ⇒ 本檔是它們的**第一個消費端**。
//
//   **設計權威**:OD `pcm-admin-order-ui/overview-desktop-bmw-m.html` 的 `.btn` 逐字
//   `transition:background var(--motion-fast) var(--ease-standard)`。
//   🔴 **那是整份設計稿【唯一】一處 transition**(三份稿實查:總覽 1 處、列表 0、明細 0)
//   ⇒ 這個後台本來就該幾乎不動,**不要因為「動效 token 有三顆」就去找地方用滿它們**。
//
//   ── 為什麼從 `transition-all` 改成 `transition-colors` ──────────────────────
//   ① 設計稿寫的是 `transition:background`,不是 all。
//   🔴 ② `globals.css:186-187` 那段警告逐字:「**用它們時只准動 `transform` / `opacity`**
//      —— 動 `top/left/width/height` 會逐幀觸發版面重算,在 1,000 列的訂單表上是可見的卡頓」。
//      `transition-all` **正好會去動那些**。⇒ 收窄成 colors 同時修掉這個風險。
//
//   ⚠️ **量到的差**(接線前 → 後):`150ms cubic-bezier(.4,0,.2,1)` → `130ms cubic-bezier(.16,1,.3,1)`。
//      前者是 Tailwind 預設(對稱緩動),後者是 OD 指定的**急停**曲線。守門在 `button-motion.test.tsx`。
//   ⚠️ **`--motion-base`(220ms)仍然沒有消費端** —— 設計稿沒有用到它。
//      **不要為了「讓它有人用」去發明一個消費端**;它該不該留是設計系統的決定,不是本檔的。

import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        /* 🔴 **BMW M 清陰影片(Sean 2026-08-16 批「3 可以做」):四個 variant 的 `shadow-xs` 全拿掉。**
           依據不是品味,是 OD 原稿的立場(數法可重跑,對 `overview-desktop-bmw-m.html`):
             `grep -c 'var(--elev-raised)'` → **0** —— 唯一的投影式陰影**宣告在、用值 0**
             `grep -c 'box-shadow'`         → **10**,全是 1px 描邊(3)/focus 環(2)/inset 色條(4)/none(1)
           ⇒ **BMW M 沒有任何投影式陰影,分層靠 hairline。**
           ⚠️ `outline` variant **本來就有 `border`** ⇒ 拿掉陰影後它仍有 1px 邊界,不是變成沒有邊界。
              實心的三個(default/destructive/secondary)**靠底色與周圍分開** —— 那正是 OD 的做法
              (`.btn-primary{background:var(--accent);border-color:var(--accent)}`,邊框與底同色)。
           ⬜ **OD `.btn` 的另外三件**(2026-08-21 更正:~~原本三件並列寫成「本片沒有做」~~,
              而它們今天已經是**三種不同的狀態**,並列會讓下一個人以為都還等著做):
              · **44px 高** ⇒ 🔴 **真的還沒做**。會改動全站每一顆按鈕的高度
                (排版影響面遠大於顏色)⇒ 另片,不是漏看。
              · **大寫(`text-transform:uppercase`)** ⇒ ✅ **已裁【永不採用】,不要再判一次**
                (`docs/design/admin-design-system.md:65` 逐字)。對 CJK 是 no-op:
                寫上去畫面一個像素都不會變,卻會留下一行「已照 OD 做大寫」的**假字面**。
              · **1.5px 字距(`letter-spacing`)** ⇒ ⏳ **品味題,待 Sean 看實體版本**。
                🔴 它**不在**上面那條 uppercase 裁定之內 —— 對 CJK **不是** no-op
                (會把中文字一個個撐開)。同處逐字:摘要卡小標的 `tracking-[1.5px]` 已在線上、
                Sean 2026-08-16 於真路由看過答「目前這樣OK」⇒ **未定的是按鈕要不要也套**
                (那才是全站影響)。 */
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

function Button({
  className,
  variant,
  size,
  isLoading,
  children,
  disabled,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    isLoading?: boolean;
  }) {
  // Normal button — no loading support, default shadcn behavior
  if (isLoading === undefined) {
    return (
      <ButtonPrimitive
        data-slot='button'
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled}
        {...props}
      >
        {children}
      </ButtonPrimitive>
    );
  }

  // Loading-aware button — grid overlap for zero layout shift.
  // Children are always wrapped in a span so has-[>svg] padding
  // stays consistent between loading and non-loading states.
  return (
    <ButtonPrimitive
      data-slot='button'
      className={cn(
        buttonVariants({ variant, size }),
        'grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1',
        className
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      <span className={cn('inline-flex items-center gap-2', isLoading && 'invisible')}>
        {children}
      </span>
      <span className={cn('flex items-center justify-center', !isLoading && 'invisible')}>
        <Spinner />
      </span>
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
