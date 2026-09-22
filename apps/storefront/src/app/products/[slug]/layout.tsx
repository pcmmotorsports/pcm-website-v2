// 商品詳情頁外層:只掛網址寫入的落地 / 完成追蹤(:901,見 `components/UrlWriterMount.tsx`)。
import { UrlWriterMount } from '@/components/UrlWriterMount';

export default function ProductDetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <UrlWriterMount />
    </>
  );
}
