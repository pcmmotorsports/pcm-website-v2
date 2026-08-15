'use client';

import { useTheme } from 'next-themes';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

// 精簡自 Kiranism starter src/components/layout/header.tsx(見 src/FORK-PROVENANCE.md):
// 砍掉 SearchInput / ThemeSelector(多主題)/ CtaGithub / NotificationCenter / Breadcrumbs 動態;
// 只留 SidebarTrigger + 標題 + 單一 light/dark 切換(next-themes)。
export function Header() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    // 🔴 `print:hidden`(#10 片1,Q-D-2=乙):列印時整條 header 不上紙。
    //    宣告放在**元素本身**,不放在列印頁裡去記住這支檔的 DOM 長什麼樣 ——
    //    後者是耦合,而且是改壞了不會有人發現的那種。
    //    ⚠️ 這行是**字面**,真正決定紙上有沒有它的是瀏覽器算出的**用值**;三綠與單測都看不到它壞掉
    //    (memory `feedback_css-guards-pin-the-literal-not-the-computed-value`)⇒ 交件附真瀏覽器實測。
    <header className='flex h-14 shrink-0 items-center gap-2 border-b px-4 print:hidden'>
      <SidebarTrigger className='-ml-1' />
      <Separator orientation='vertical' className='mr-1 h-4' />
      <span className='text-sm font-medium'>總覽</span>
      <div className='ml-auto flex items-center gap-2'>
        <Button
          variant='ghost'
          size='icon'
          aria-label={isDark ? '切換淺色' : '切換深色'}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isDark ? <Icons.sun /> : <Icons.moon />}
        </Button>
      </div>
    </header>
  );
}
