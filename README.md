# HEARTSENSE Workspace

Workspace nay hien co 2 lop song song:

- Lop 1: prototype web/PWA dang chay ngay o root workspace de ban test flow tuc thi.
- Lop 2: scaffold production moi gom `apps/web`, `apps/mobile`, `apps/api`, `packages/shared`, `prisma`.

## 1. Prototype dang test ngay

Ban co the chay ngay:

```powershell
node server.js
```

Sau do mo [http://localhost:8080](http://localhost:8080).

Prototype hien co:

- Dang ky / dang nhap va luu ho so tim mach co tuoi, gioi tinh, benh nen.
- Guardian setup voi phone/email va mo phong kenh SMS, Zalo, Email.
- Camera selector, huong dan quyen webcam, fallback khi khong co webcam.
- Face PPG demo qua webcam, Finger PPG demo mode, breathing coach.
- Heart-Print baseline 3 lan, ket qua so sanh voi resting BPM/HRV ca nhan.
- Phan loai normal / elevated / AFib nghi ngo, popup hoi ly do bat thuong nhe.
- SOS 15 giay, huy SOS, nhac goi 115, benh vien gan nhat, thong bao web va alarm tone.
- Nhat ky trieu chung, lich nhac thuoc OCR prototype tu ten file anh, bao cao hang tuan.
- Report HTML de in / luu PDF bang trinh duyet.
- Polling dashboard dinh ky de mo phong dong bo cross-platform.

## 2. Scaffold production moi

### `apps/web`

- Next.js app scaffold de dua giao dien production len domain web.
- Du kien noi TensorFlow.js Face rPPG, OCR that, auth that, push subscription va dashboard production.

### `apps/mobile`

- Expo/native wrapper scaffold cho iOS va Android.
- Duong nang cap de them `expo-camera`, push notification, Finger PPG camera sau + flash, offline sync.

### `apps/api`

- API service production scaffold.
- Duong nang cap de noi PostgreSQL/Prisma, Twilio SMS, Zalo ZNS, Resend Email, Web Push, weather API.

### `packages/shared`

- Module dung chung cho Finger PPG, Face rPPG, OCR parser va notification adapters.
- Day la noi de dong bo thuat toan giua web, mobile va backend.

### `prisma`

- Schema database production cho user, guardian, baseline, measurement, symptom, reminder, push device, SOS.

## 3. File quan trong

- `server.js`: prototype server dang runnable.
- `index.html`, `styles.css`, `app.js`: prototype UI/UX de test ngay.
- `.env.example`: bien moi truong cho ban production.
- `apps/api/src/server.js`: production API scaffold.
- `apps/web/app/page.tsx`: production web scaffold.
- `apps/mobile/App.tsx`: production mobile scaffold.
- `packages/shared/src/*`: signal processing va adapters dung chung.
- `prisma/schema.prisma`: database schema production.

## 4. Ghi chu quan trong

- Prototype root dang test duoc ngay, nhung chua la he thong y te duoc kiem dinh.
- Scaffold production moi da co cau truc va diem noi tich hop, nhung de chay that can cai dependency, tao DB, them credential va deploy.
- OCR, SMS, Zalo, Email, Push, weather va mobile native hien moi o muc scaffold/provider adapter, chua active vi chua co key va moi truong that.
- De deploy web that, ban nen dung HTTPS bat buoc de `getUserMedia()` hoat dong.
