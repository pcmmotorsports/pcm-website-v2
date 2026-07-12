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
    <header className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
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
