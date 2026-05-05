# Supabase Adapter

對齊 ADR-0005「Custom + Supabase 直寫架構」。

## 結構

```
packages/adapters/src/supabase/
├── migrations/      ← Supabase CLI migrations(supabase db push 同步)
│   └── *.sql        ← 由 M-1-03 main-a2 起逐步落地
├── SupabaseProductAdapter.ts    ← M-1-03 main-b 落地
├── mappers/         ← M-1-03 main-b 落地
└── README.md        ← 本檔
```

## Migration 工作流(B 方案、Sean 2026-05-05 拍板)

1. Claude Code 在 migrations/ 寫新的 .sql(命名 `{timestamp}_{name}.sql`、Supabase CLI 慣例)
2. Sean Terminal 跑 `supabase db push`(從 monorepo root)
3. Supabase Dashboard 驗證表 / policy 落地
4. commit migration 檔(SQL 進 git、是 source of truth)

## env 變數

對應 .env.example 樣板:

- **NEXT_PUBLIC_SUPABASE_URL**:Supabase project URL(public、可進 client bundle)
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**:anon key(public、RLS-protected、可進 client bundle)
- **SUPABASE_SERVICE_ROLE_KEY**:service role key(server-only、絕不進 client bundle、絕不入 git)

對齊 docs/architecture/supabase-schema-design.md §9.3。
