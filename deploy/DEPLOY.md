# HEARTSENSE Deploy Guide

Tai lieu nay chuan bi san de khi ban co tai khoan thi co the dung ngay.

## Kien truc deploy de xuat

- `apps/web` deploy len Vercel
- `apps/api` deploy len Railway
- Database Postgres va Auth tren Supabase
- Email SOS that qua Resend
- Weather that qua OpenWeather

## 1. Resend Email

Theo tai lieu chinh thuc cua Resend, de gui email voi Node.js ban can:

- Tao API key
- Verify domain
- Cai SDK `resend`

Tai lieu:

- [Resend Send with Node.js](https://resend.com/docs/send-with-nodejs)
- [Resend Managing Domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend + Vercel](https://resend.com/docs/knowledge-base/vercel)

Bien moi truong can dat:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `RESEND_API_BASE_URL=https://api.resend.com/emails`

Ghi chu:

- Resend khuyen nghi dung subdomain gui email, vi du `updates.yourdomain.com`.
- Ban khong the gui email that den ben ngoai neu chua co API key va domain/gui nguoi gui hop le.

## 2. OpenWeather

Tai lieu chinh thuc:

- [OpenWeather Current weather data](https://openweathermap.org/current)

Endpoint dang duoc code vao project:

- `https://api.openweathermap.org/data/2.5/weather`

Bien moi truong:

- `OPENWEATHER_API_KEY`
- `OPENWEATHER_CURRENT_URL=https://api.openweathermap.org/data/2.5/weather`
- `WEATHER_DEFAULT_QUERY=Ha Noi,VN`

## 3. Vercel cho `apps/web`

Tai lieu chinh thuc:

- [Vercel Next.js](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel Monorepos](https://vercel.com/docs/monorepos)

Theo tai lieu Vercel:

- Import repo
- Chon `Root Directory` = `apps/web`
- Them env cho project
- Neu can local env, co the dung `vercel env pull`

Env can dat tren Vercel:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WEB_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## 4. Railway cho `apps/api`

Tai lieu chinh thuc:

- [Railway Public Networking](https://docs.railway.com/networking/public-networking)
- [Railway Deploying with CLI](https://docs.railway.com/cli/deploying)

Theo tai lieu Railway:

- Tao service moi tu repo nay
- Chon root/service path la `apps/api`
- Railway se cap public domain va SSL tu dong
- App phai listen tren `0.0.0.0:$PORT` hoac `PORT`

Env can dat tren Railway:

- `PORT=4000` hoac de Railway cap
- `DATABASE_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `RESEND_API_BASE_URL`
- `OPENWEATHER_API_KEY`
- `OPENWEATHER_CURRENT_URL`
- `WEATHER_DEFAULT_QUERY`

## 5. Supabase

Tai lieu chinh thuc:

- [Supabase connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase with Next.js](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)

Khuyen nghi ket noi:

- Runtime app/web serverless: dung pooler transaction mode
- Server persistent: dung direct connection hoac session mode

Env can dat:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## 6. Thu tu thao tac de co link test

1. Tao project Supabase, copy URL + publishable key + connection string.
2. Tao tai khoan Resend, tao API key, them sending domain/subdomain.
3. Tao tai khoan OpenWeather, lay API key.
4. Deploy `apps/api` len Railway.
5. Deploy `apps/web` len Vercel, tro `NEXT_PUBLIC_API_BASE_URL` ve domain Railway.
6. Neu muon ten mien rieng, tro DNS `app.heartsense.vn` ve Vercel.

## 7. Luu y

- Minh da dien endpoint server chinh thuc cho Email va Weather vao code va `.env.example`.
- Minh khong the tu tao API key Resend/OpenWeather thay ban neu khong co tai khoan cua ban.
- SOS email se hoat dong ngay khi `RESEND_API_KEY` + `EMAIL_FROM` hop le duoc them vao env.
