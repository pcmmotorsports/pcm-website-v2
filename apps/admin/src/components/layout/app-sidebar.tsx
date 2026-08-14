'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icons, type Icon } from '@/components/icons';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

// 精簡自 Kiranism starter(見 src/FORK-PROVENANCE.md):砍 Clerk / nav-config 動態導覽 / user dropdown。
// M-4a:總覽 → / ;訂單 → /orders(訂單線第一片)、客戶 → /customers(客戶管理第一片)皆已接真頁面 <Link>
// (usePathname 判 active)。href 缺 = 尚未接頁面、渲染不可點 button 避免 404。
type NavItem = { key: string; label: string; icon: Icon; href?: string };

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', label: '總覽', icon: Icons.dashboard, href: '/' },
  { key: 'orders', label: '訂單', icon: Icons.billing, href: '/orders' },
  // M-3 RW3:退款異常清單(RW4 值班入口)。href 在 /orders 底下 ⇒ 進本頁時「訂單」同時
  // 呈 active(prefix 語意既有行為)—— 同屬訂單域,雙亮可接受、不為此改 active 邏輯。
  { key: 'refund-exceptions', label: '退款異常', icon: Icons.warning, href: '/orders/refund-exceptions' },
  { key: 'customers', label: '客戶', icon: Icons.user, href: '/customers' },
  // M-4b #20 片1a:商品列表(唯讀)。href 有值 = 頁面已接上(照本檔檔頭慣例)。
  { key: 'products', label: '商品', icon: Icons.product, href: '/products' },
  { key: 'staff', label: '員工管理', icon: Icons.teams, href: '/settings/staff' },
  { key: 'suppliers', label: '供應商', icon: Icons.post, href: '/settings/suppliers' },
  // M-4b E10 A9w2:唯一去處 `/settings/order-statuses`(九碼狀態詞彙 CRUD)已隨九碼退場下架。
  // 照本檔既有慣例(檔頭:href 缺 = 尚未接頁面、渲染不可點 button 避免 404)拿掉 href,
  // 保留這一格等日後真的有「設定」頁再接;整項刪掉是另一個決定,不在退場片的範圍。
  { key: 'settings', label: '設定', icon: Icons.settings },
];

/** 目前路徑是否命中此 nav('/' 精確;其餘含子路徑)。 */
function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    // 🔴 #380(Sean 2026-08-10 深夜正式站肉眼驗):收合模式 `icon` → `offcanvas`。
    //    **那顆鈕從來沒有消失過**(S-010 唯讀診斷:`SidebarTrigger` 在整個 repo 歷史裡只出現於
    //    後台骨架那一顆 commit、從沒被動過)—— Sean 按得到,只是按下去**收成一條窄圖示列**
    //    而不是整條收起,所以他讀成「隱藏鈕不見了」。要的是後者 ⇒ 換模式,不是補鈕。
    //    · `icon`:收合後留 `SIDEBAR_WIDTH_ICON`(3rem)圖示列,內容區只多拿到 6rem;
    //    · `offcanvas`:gap 收成 `w-0`、面板整條滑出畫面左側(`ui/sidebar.tsx` 的
    //      `group-data-[collapsible=offcanvas]:w-0` 與 `left-[calc(var(--sidebar-width)*-1)]`)
    //      ⇒ 內容區拿回整整 9rem。
    //    ✅ **收起後開得回來**:`SidebarTrigger` 住在 `layout/header.tsx`,而 header 在
    //      `<SidebarInset>` 內 = 側欄的**兄弟節點**、不在被收起的那棵子樹裡(見 `app/layout.tsx`)
    //      ⇒ 側欄整條滑走後那顆鈕照樣在。這是本片唯一「改壞了會把員工鎖在收合狀態」的地方,
    //      守門在 `app-sidebar.test.ts`。
    <Sidebar collapsible='offcanvas'>
      <SidebarHeader>
        <div className='flex items-center gap-2 px-2 py-1.5'>
          <Icons.logo className='size-5 shrink-0' />
          {/* `group-data-[collapsible=icon]:hidden` 在 offcanvas 下**永遠不會命中**(整條都滑走了);
              留著是 icon 模式的回頭路 —— 要拿掉請連同上面那段一起改,別只刪這一個 class。 */}
          <span className='text-sm font-semibold group-data-[collapsible=icon]:hidden'>
            PCM 後台
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>管理</SidebarGroupLabel>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.key}>
                {item.href ? (
                  <SidebarMenuButton
                    isActive={isNavActive(pathname, item.href)}
                    tooltip={item.label}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton isActive={false} tooltip={item.label} aria-disabled>
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
