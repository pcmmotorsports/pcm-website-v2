import type { NextConfig } from 'next';

// PCM 後台 admin — 純殼(M-4a M0-S1)。目前不接資料、不做登入、無 Sentry/自訂 webpack。
// 未來 slice 依需求(SSO 收端 middleware、圖片網域等)再擴,擴時走鐵則 8 重大改動 plan。
const nextConfig: NextConfig = {};

export default nextConfig;
