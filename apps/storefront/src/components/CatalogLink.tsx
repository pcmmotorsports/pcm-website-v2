'use client';
// CatalogLink.tsx — 指向列表頁的站內連結(頁首「商品目錄」、「新品上架」等,plan §2-4 / §3-4)。
// = Next `Link` + 真的要導航時登記目的網址(`registerLinkTarget`),之後的操作以它為底(第三輪實測 S5)。
// 🔴 登記放在 `onNavigate`,不放在 `onClick`(Codex R4 必修 ②、片 2 R1 必修 4):
//    Next 16.3.0 `client/app-dir/link.js` 的 `linkClicked` 只有在「目前分頁真的要做站內導航」時才呼叫 `onNavigate`
//    (已排除 Command / Ctrl / Shift / Alt、中鍵、`target` 另開、`download`、站外網址、`onClick` 已取消),
//    而呼叫端自己的 `onNavigate` 若 `preventDefault()`,Next 也不會導航 ⇒ 我們跟著不登記。
// 🔴 分頁連結(`Pagination`)不要換成這個:它自己 preventDefault 改走頁碼變更(R3 必修 1)。
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { registerLinkTarget } from '@/lib/url-writer';

type Props = ComponentProps<typeof Link> & { href: string };

export function CatalogLink({ onNavigate, ...props }: Props) {
  return (
    <Link
      {...props}
      onNavigate={(e) => {
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
            e.preventDefault();
          },
        });
        if (!cancelled) registerLinkTarget(props.href);
      }}
    />
  );
}
