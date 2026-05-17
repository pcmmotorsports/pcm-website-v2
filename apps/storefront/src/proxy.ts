import { NextRequest, NextResponse } from 'next/server';

// 保護 /admin 與 /api/admin — HTTP Basic Auth（密碼存環境變數 ADMIN_PASSWORD）
// matcher 只鎖這兩個路徑，/api/line/* 完全不受影響
export function proxy(req: NextRequest): NextResponse {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse('ADMIN_PASSWORD 未設定', { status: 500 });
  }

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password === expected) {
        return NextResponse.next();
      }
    } catch {
      // base64 格式錯誤 → 落到下方 401
    }
  }

  return new NextResponse('需要密碼', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="PCM Admin"' },
  });
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};
