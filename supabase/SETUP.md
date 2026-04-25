# Supabase Setup Notes

Tai lieu goc:

- [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Use Supabase with Next.js](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)

## Bien moi truong web

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Bien moi truong API

- `DATABASE_URL`

## Chu y ket noi

Theo docs Supabase:

- Session mode phu hop backend persistent can IPv4
- Transaction mode phu hop serverless/edge function va khong ho tro prepared statements

Voi HEARTSENSE:

- Railway API: uu tien transaction mode neu app scale theo request
- Migration/Prisma Studio: uu tien direct connection hoac session mode
