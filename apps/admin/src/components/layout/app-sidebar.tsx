'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
import { buildNavItems } from './nav-items';

// 精簡自 Kiranism starter(見 src/FORK-PROVENANCE.md):砍 Clerk / nav-config 動態導覽 / user dropdown。
//
// 🔴 `#27` D1c-1:導覽清單本體已搬到 `nav-items.ts`(**零 runtime 依賴**),理由與代價寫在該檔檔頭
//    —— 一句話:旗標控制的「有沒有被濾掉」在本檔測不到(`@/` alias 進不了 jsdom),搬出去才測得到。
//
// ── 🔴🔴 旗標為什麼由 `app/layout.tsx` 算好傳進來,而不是本檔自己呼叫 `isAuditUiEnabled()` ──────
//   **本檔是 `'use client'`,而 `AUDIT_UI_ENABLED` 不是 `NEXT_PUBLIC_*`。**
//   ⇒ 在這裡呼叫旗標函式會拿到 `undefined`,**不會報錯、不會紅,只會靜默把入口關掉** ——
//     症狀是「功能做完了但員工看不到」,而三綠全綠。
//   📎 **實測(2026-08-15,本片實作第一步;丟棄式探針,已還原、shasum 對回 baseline)**
//     量法:在本檔(client component)暫時放一行 `process.env.AUDIT_UI_ENABLED`,跑 `next build`,
//     然後比對 client 與 server 兩邊產物裡**同一行**被編成什麼:
//       · client(`.next/static/chunks/…`):`…,d=t.default.env.AUDIT_UI_ENABLED;…`
//       · server(`.next/server/…`)      :`…,k=process.env.AUDIT_UI_ENABLED;…`
//     ⇒ **client 那側沒有被換成值,而是改讀一個被 bundler 換掉的 `process` 模組**
//       (`t.default`,不是 Node 的 `process`)⇒ **瀏覽器端拿不到這個變數。**
//     🔴 **誠實邊界**:我量的是**編出來的 code**,不是**瀏覽器裡跑出來的值** ——
//       我沒有在真瀏覽器觀察到 `undefined`。已證的是「**bundler 沒有把值內聯進去**」,
//       那已足以否決「在這裡直接呼叫旗標函式」的寫法,但別把它引用成「已驗證恆為 undefined」。
//     ⚠️ **測得到的那一半有守門,測不到的那一半才靠這段註解**(E 窗 R1 must-fix 更正我的原句):
//       · **測不到**:「bundler 把 env 編成什麼」——vitest 跑在 Node、`process.env` 是通的,
//         要複現得真跑 `next build` ⇒ **這半只有上面那段實測紀錄,別刪。**
//       · **✅ 測得到,而且已經守了**:「**有沒有人在 client component 寫下那條 import**」——
//         那是**倉庫裡的一行字**,不是瀏覽器行為 ⇒ 守門在 `lib/audit/audit-ui-flag.test.ts` 檔尾。
//       🔴 **我原本把這兩件併成一件,然後宣稱「寫不成測試」** —— 錯的那半讓一道 10 行的守門
//         差點沒被寫出來(該檔已有 **21 支**測試用同一種手法)。**別再用「難測」把可測的那半一起放掉。**
//   ✅ 形狀**照抄** repo 既有前例:`components/orders/order-detail-route.tsx:250`
//     逐字 `refundEnabled={isRefundUiEnabled()}`(server 元件算完、當 prop 交給 client 元件)。

/** 目前路徑是否命中此 nav('/' 精確;其餘含子路徑)。 */
function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ auditEnabled }: { auditEnabled: boolean }) {
  const pathname = usePathname();
  const navItems = buildNavItems(auditEnabled);

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
        {/* 🔴 **M 三色條**(片2)—— OD `overview-desktop-bmw-m.html:83-88` 把它定為
            「全系統唯一的裝飾元素,只當分隔與品牌標記」。漸層本體在 `globals.css` 的 `.m-stripe`,
            那裡寫了為什麼三個色停是硬寫的 hex 而不是 token。
            ⚠️ **【改】:寬度不照 OD 的 32px。** OD 的 `.rail .mstripe` 是 32 寬,因為它對齊的是
               一個 32×32 的**純圖示 mark**;我方的品牌列是「圖示 + PCM 後台」一整行
               ⇒ 條跟著那一行走(`mx-2`),否則會變成一截對不到任何東西的短線。
               **這是尺寸隨版面走,不是改設計** —— OD 自己也給了兩種尺寸(`:89` 的 4px 高
               通欄 `hr` 與 `:133` 的 32×4),形狀是同一個。
            ⚠️ 高度 4px 照抄(`:89` `hr.m-stripe{height:4px}`)。
            📎 `aria-hidden`:它是裝飾,不該被螢幕閱讀器唸成一個東西。 */}
        <div aria-hidden className='m-stripe mx-2 h-1' />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>管理</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              // `nav-items.ts` 存的是**字串鍵**不是元件(該檔檔頭:存元件就得 runtime import
              // `../icons`,那支會把整條 `@tabler/icons-react` 依賴帶進測試 ⇒ resolve 不到)。
              const ItemIcon = Icons[item.icon];
              return (
                <SidebarMenuItem key={item.key}>
                  {item.href ? (
                    <SidebarMenuButton
                      isActive={isNavActive(pathname, item.href)}
                      tooltip={item.label}
                      /* 🔴 **選中態改吃 M 藍 + 左側 2px 藍邊**(片2)——
                         逐字搬 OD `overview-desktop-bmw-m.html:138`
                         `.rail a[aria-current]{color:var(--accent);border-left-color:var(--accent);
                          background:var(--surface-warm)}`,以及 `:136` 的
                         `border-left:2px solid transparent`(未選中時佔位,選中才上色)。
                         ⚠️ **`border-l-2 border-transparent` 那半是承重的**:少了它,選中時才長出
                            2px 邊框 ⇒ **整行文字會往右跳 2px**,而那只有在點的當下看得到。
                         ⚠️ 底色不另外寫 —— shadcn 的 `data-[active=true]:bg-sidebar-accent` 已經是
                            暖填 `#eef3f8`(片1 對映),與 OD 的 `var(--surface-warm)` 同值。
                            **重複寫一次不會更對,只會多一個日後會對不上的地方。** */
                      className='border-l-2 border-transparent data-[active=true]:border-l-primary data-[active=true]:text-primary'
                      render={<Link href={item.href} />}
                    >
                      <ItemIcon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton isActive={false} tooltip={item.label} aria-disabled>
                      <ItemIcon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
