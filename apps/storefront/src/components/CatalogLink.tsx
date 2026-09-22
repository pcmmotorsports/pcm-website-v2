'use client';
// CatalogLink.tsx — 指向列表頁的站內連結(頁首「商品目錄」、「新品上架」等,plan §2-4 / §3-4)。
// = Next `Link` + 點下去當下登記目的網址(`registerLinkTarget`),之後的操作以它為底(第三輪實測 S5)。
// 🔴 只在「這個分頁真的會導航」時登記(Codex R4 必修 ②):按住 Command / Ctrl / Shift / Alt、
//    不是左鍵、`target` 另開、`download`、`onClick` 已被取消 ⇒ 目前分頁不會導航 ⇒ 不登記,
//    否則之後的操作會以一個沒去成的網址為底。
// 🔴 分頁連結(`Pagination`)不要換成這個:它自己 preventDefault 改走頁碼變更(R3 必修 1)。
import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { registerLinkTarget } from '@/lib/url-writer';

type Props = ComponentProps<typeof Link> & { href: string };

/** 這次點擊會不會讓「目前分頁」導航(與 Next `Link` 自己判斷要不要攔下的條件相同)。 */
export function navigatesCurrentTab(e: MouseEvent<HTMLAnchorElement>): boolean {
  if (e.defaultPrevented || e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = e.currentTarget;
  const target = a.getAttribute('target');
  if (target && target !== '_self') return false;
  if (a.hasAttribute('download')) return false;
  return true;
}

export function CatalogLink({ onClick, ...props }: Props) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (navigatesCurrentTab(e)) registerLinkTarget(props.href);
      }}
    />
  );
}
