import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

// 精簡自 Kiranism starter src/components/layout/header.tsx(見 src/FORK-PROVENANCE.md):
// 砍掉 SearchInput / ThemeSelector(多主題)/ CtaGithub / NotificationCenter / Breadcrumbs 動態;
// 只留 SidebarTrigger + 標題。
//
// 🔴 **深色切換鈕已於 2026-08-16 依 Sean 拍板移除**(逐字「不要深色模式」+「拿掉那顆按鈕」)。
//    ⚠️ **只拿按鈕不夠**:`next-themes` 在 `attribute='class'` 下把選擇存進 localStorage,
//    而 `defaultTheme='light'` **只在沒存過時生效** ⇒ 曾經切過深色的人會**鎖死在深色且沒有出口**。
//    ⇒ 真正關掉深色的是 `app/layout.tsx` 的 `forcedTheme='light'`,**不是這裡少了一顆按鈕**。
//    要復原深色請從那個 prop 下手,不要只把按鈕加回來。
export function Header() {
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
    </header>
  );
}
