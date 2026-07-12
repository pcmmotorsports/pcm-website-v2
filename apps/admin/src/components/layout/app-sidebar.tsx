'use client';

import { Icons } from '@/components/icons';
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

// 精簡自 Kiranism starter src/components/layout/app-sidebar.tsx(見 src/FORK-PROVENANCE.md):
// 砍掉 Clerk(useUser/useOrganization/SignOutButton)、nav-config/use-nav 動態導覽、user dropdown。
// M0-S1 骨架階段 = 靜態占位導覽、不接資料、不導頁(訂單/客戶線待後續 slice 才真的接 route)。
// 之所以用 button(非 Link)= 這些頁面尚未存在,避免點了 404;真接頁面時各 slice 換成 <Link>。
const NAV_ITEMS = [
  { key: 'overview', label: '總覽', icon: Icons.dashboard, active: true },
  { key: 'orders', label: '訂單', icon: Icons.billing, active: false },
  { key: 'customers', label: '客戶', icon: Icons.user, active: false },
] as const;

export function AppSidebar() {
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
                <SidebarMenuButton
                  isActive={item.active}
                  tooltip={item.label}
                  aria-disabled={!item.active}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
