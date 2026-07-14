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
  { key: 'customers', label: '客戶', icon: Icons.user, href: '/customers' },
  { key: 'settings', label: '設定', icon: Icons.settings, href: '/settings/order-statuses' },
];

/** 目前路徑是否命中此 nav('/' 精確;其餘含子路徑)。 */
function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader>
        <div className='flex items-center gap-2 px-2 py-1.5'>
          <Icons.logo className='size-5 shrink-0' />
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
