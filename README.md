# DonJai

เว็บแอปสร้าง **ของขวัญดิจิทัล (Digital Gift)** ภาษาไทย สำหรับโอกาสพิเศษ (วันครบรอบ วันเกิด และจดหมายถึงคนสำคัญ) ใช้สถาปัตยกรรม **Next.js App Router + Supabase + Vercel** ตามข้อกำหนดใน [requirement.pdf](docs/requirement.pdf)

## สถาปัตยกรรมและระบบหลัก

- **Authentication (Supabase Auth)**: สมัครสมาชิก / เข้าสู่ระบบด้วย **Email + Password** และ **Google OAuth** จัดการ session ฝั่งเซิร์ฟเวอร์ด้วย `@supabase/ssr` และ HttpOnly Cookies (ผู้รับเปิดลิงก์ได้ทันทีโดยไม่ต้องสมัครสมาชิก)
- **PostgreSQL + Row Level Security (RLS)**:
  - `profiles` — ข้อมูลบัญชีผู้สร้าง (สร้างอัตโนมัติผ่าน trigger)
  - `templates` — เทมเพลตเริ่มต้น 3 แบบ (`anniversary`, `birthday`, `letter`)
  - `gifts` & `gift_blocks` — ฉบับร่างและบล็อกเนื้อหาของขวัญ (ป้องกันข้ามบัญชีด้วย RLS)
  - `gift_publications` — ฉบับเผยแพร่แยกขาดจากฉบับร่าง (`snapshot`), เก็บรหัสผ่านแบบ PBKDF2-SHA256 (server-only, ปิด client access)
  - `gift_assets` & `gift-assets` Private Bucket — เก็บรูปภาพใน Private Storage ออก **Signed URL อายุสั้น (30 นาที)** เฉพาะเจ้าของและผู้รับที่ผ่านการตรวจสิทธิ์
  - `gift_unlock_attempts` — Rate limit ป้องกันเดารหัสผ่าน (จำกัด 5 ครั้ง / 10 นาที / IP) และเพิกถอน session ผู้รับทันทีเมื่อเจ้าของยกเลิกเผยแพร่หรือเปลี่ยนรหัสผ่าน
- **Offline Draft Safety**: ระหว่างยังไม่เชื่อมต่อหรือยังไม่ได้ตั้งค่าคีย์ Supabase แอปยังสามารถสร้าง แต่งบล็อก ดูพรีวิว บันทึกฉบับร่างลง IndexedDB ในเบราว์เซอร์ และนำเข้า/ส่งออกไฟล์ JSON ได้

## คำสั่งรันและตรวจสอบ

> หมายเหตุบน Windows: หากโปรเจคอยู่บนไดรฟ์เสมือน Google Drive (`F:\`) แนะนำให้คัดลอกโฟลเดอร์ไปไว้บนไดรฟ์ในเครื่อง (`C:\` หรือ `D:\`) ก่อนรัน `npm install`

```sh
npm install
cp .env.example .env.local   # ใส่คีย์ Supabase (ดู docs/supabase-setup.md)
npm run dev                  # เปิดที่ http://localhost:4173
npm test                     # รันชุดทดสอบทั้งหมด
npm run typecheck            # ตรวจ TypeScript
npm run build                # Build Next.js สำหรับ Production / Vercel
```

## คู่มือตั้งค่า Supabase & Vercel

ดูขั้นตอนละเอียดสำหรับสร้างโปรเจค Supabase, รัน SQL Migration (`supabase/migrations/202611230001_init_donjai.sql`), ตั้งค่า Google OAuth และ Deploy บน Vercel ได้ที่ [docs/supabase-setup.md](docs/supabase-setup.md)

## ฟีเจอร์ที่รวมอยู่ในแอป

- หน้าแรกภาษาไทยพร้อมซองจดหมาย 3D แบบโต้ตอบได้, 1.4-second letter reveal, ลดแอนิเมชัน (OS + toggle), และตัวอย่างของขวัญ 3 เทมเพลต
- ตัวแก้ไข 4 ขั้นตอน (ข้อมูลผู้รับ/ผู้ส่ง → บล็อกข้อความ/รูป/ไทม์ไลน์/เกมจับคู่ → สีธีมและปก → ตั้งรหัส/คำใบ้และเผยแพร่) พร้อม Drag & Drop, ปุ่มเลื่อนลำดับ, Undo และพรีวิวมือถือแบบเรียลไทม์
- ลิงก์แชร์สำหรับผู้รับ (`/g/[slug]` และ `/?gift=[id]`), หน้ารหัสผ่านพร้อมคำใบ้, ขยายภาพความทรงจำ และมินิเกมจับคู่ 3 คู่ (ข้ามหรือเล่นซ้ำได้)
- ระบบสำรอง/นำเข้าไฟล์ JSON ในเครื่อง และซิงก์อัตโนมัติขึ้น Supabase เมื่อเข้าสู่ระบบ
