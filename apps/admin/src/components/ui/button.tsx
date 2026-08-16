import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
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
           ⬜ **OD `.btn` 的另外三件本片【沒有】做**:44px 高、大寫、1.5px 字距。
              前者會改動全站每一顆按鈕的高度(排版影響面遠大於顏色);
              **大寫對中文是 no-op**(同表頭與摘要卡那兩次的判斷)。⇒ 另片,不是漏看。 */
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
