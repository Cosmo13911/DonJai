# คู่มือตั้งค่า Supabase & Vercel สำหรับโปรเจค DonJai

เอกสารนี้อธิบายขั้นตอนการสร้างฐานข้อมูล, ระบบสมาชิก (Email + Google Login), ที่เก็บรูปภาพส่วนตัว (Private Storage) และการนำขึ้นใช้งานจริงบน Vercel

---

## 1. สร้างโปรเจค Supabase และติดตั้งฐานข้อมูล

1. ไปที่ [https://supabase.com](https://supabase.com) แล้วสร้างโปรเจคใหม่ (แนะนำ Region `Southeast Asia (Singapore)` เพื่อให้ผู้ใช้ในไทยโหลดเร็วที่สุด)
2. เปิดเมนู **SQL Editor** ในหน้า Dashboard ของ Supabase
3. คัดลอกเนื้อหาทั้งหมดจากไฟล์ `supabase/migrations/202611230001_init_donjai.sql` ไปวางแล้วกด **Run**
4. ตรวจสอบผลลัพธ์หลังรัน:
   - **Table Editor**: ต้องพบ 7 ตาราง ได้แก่ `profiles`, `templates` (มี 3 แถวเริ่มต้น), `gifts`, `gift_assets`, `gift_blocks`, `gift_publications`, `gift_unlock_attempts`
   - **Storage**: ต้องพบ Bucket ชื่อ `gift-assets` โดยตั้งค่าเป็น **Private** (`Public = false`)

---

## 2. เปิดใช้งานการเข้าสู่ระบบ (Email + Google Login)

### 2.1 ตั้งค่า URL สำหรับ Redirect
ไปที่ **Authentication → URL Configuration**:
- **Site URL**:
  - ระหว่างพัฒนาในเครื่อง: `http://localhost:4173`
  - เมื่อขึ้น Vercel แล้ว: `https://<your-domain>.vercel.app`
- **Redirect URLs** (เพิ่มทั้ง 2 รายการ):
  - `http://localhost:4173/auth/callback`
  - `https://<your-domain>.vercel.app/auth/callback`

### 2.2 Email / Password
ไปที่ **Authentication → Providers → Email**:
- เปิดใช้งาน **Enable Email provider**
- หากต้องการให้สมัครแล้วเข้าใช้งานได้ทันทีในระหว่างทดสอบ สามารถปิด **Confirm email** ชั่วคราวได้ (แนะนำให้เปิดใช้งานเมื่อเปิดรับผู้ใช้จริง)

### 2.3 Google Login
1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials** → สร้าง **OAuth 2.0 Client ID** (ชนิด Web application)
2. ในช่อง **Authorized redirect URIs** ของ Google ให้ใส่ Callback URL จาก Supabase (รูปแบบ `https://<project-ref>.supabase.co/auth/v1/callback`)
3. นำ **Client ID** และ **Client Secret** ไปกรอกใน Supabase ที่ **Authentication → Providers → Google** แล้วเปิด **Enable Sign in with Google**

---

## 3. ตั้งค่า Environment Variables (`.env.local`)

คัดลอก `.env.example` เป็น `.env.local` แล้วกรอกค่าจาก **Project Settings → API** ใน Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key

# สุ่มข้อความยาวอย่างน้อย 32 ตัวอักษร (เช่น รัน openssl rand -hex 32)
DONJAI_SESSION_SECRET=replace-with-random-64-hex-characters

NEXT_PUBLIC_SITE_URL=http://localhost:4173
```

> **คำเตือนความปลอดภัย:** ห้ามนำ `SUPABASE_SERVICE_ROLE_KEY` และ `DONJAI_SESSION_SECRET` ไปเผยแพร่หรือคอมมิตขึ้น Git เด็ดขาด (`.gitignore` กัน `.env*` ไว้ให้แล้ว)

---

## 4. การรันทดสอบในเครื่อง (Windows)

> **ข้อควรทราบสำหรับ Google Drive (`F:\`):** หากโฟลเดอร์โปรเจคอยู่ใน Google Drive (`F:\ไดรฟ์ของฉัน\...`) ระบบไฟล์เสมือนของ Google Drive อาจทำให้ `npm install` เขียนไฟล์ขนาดเล็กจำนวนมากใน `node_modules` ไม่สำเร็จ แนะนำให้คัดลอกโฟลเดอร์โปรเจคไปไว้บนไดรฟ์ในเครื่อง (เช่น `C:\Projects\DonJai-project` หรือ `D:\Projects\DonJai-project`) ก่อนรันคำสั่ง

```sh
npm install
npm run dev
```

เปิดเบราว์เซอร์ที่ `http://localhost:4173`

---

## 5. นำขึ้นใช้งานจริงบน Vercel

1. นำโค้ดขึ้น GitHub / GitLab / Bitbucket
2. Import โปรเจคเข้า [Vercel](https://vercel.com) (Framework Preset: **Next.js**)
3. เพิ่ม Environment Variables ทั้ง 5 ตัวใน Vercel Project Settings (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DONJAI_SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`)
4. Deploy แล้วนำโดเมนที่ได้ไปอัปเดตใน **Supabase Authentication → URL Configuration**
