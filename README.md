# Foodezy Backend (NestJS)

API สำหรับระบบ Foodezy — เฟสแรกทำ **สมัครร้านค้า** (แทน `shop_register_form.php` เดิม)
โครงแบบแยกชั้น: controller (รับ request) → service (ตรรกะ + เซฟ DB) → entity (ตาราง)

## โครงไฟล์ (ตอบคำถามที่คุณถามไว้)

```
src/
├─ main.ts                              # จุดเริ่ม: เปิด CORS, validation, prefix /api
├─ app.module.ts                        # รวมทุกอย่าง + เสิร์ฟรูปที่อัปโหลด (/uploads)
├─ config/
│  └─ database.config.ts                # (ข้อ 2) ไฟล์ต่อ MySQL — อ่านค่าจาก .env
└─ modules/shops/
   ├─ shops.controller.ts               # (ข้อ 5) รับฟอร์ม POST /api/shops/register
   ├─ shops.service.ts                  # (ข้อ 4,7) INSERT ลง shops + audit_logs + จัดการรูป
   ├─ dto/register-shop.dto.ts          # validate ค่าที่รับเข้ามา
   └─ entities/
      ├─ shop.entity.ts                 # map ตาราง shops
      └─ audit-log.entity.ts            # map ตาราง audit_logs
```

- **ข้อ 8 (รูปเก็บที่ไหน):** โฟลเดอร์ `UPLOAD_DIR` (`.env`) — บน Dokploy จะเป็น **Volume** ถาวร
  แล้วเสิร์ฟออกทาง `/uploads/<ชื่อไฟล์>`

## Endpoint

```
POST /api/shops/register        Content-Type: multipart/form-data
fields: shopName, ownerName, phone, email, password,
        address?, taxId?, ownerId?, packageId, orderMode,
        kitchenOutput, billingType, buffetPrice?, printerIp?
files:  shopFront?, shopInside?

200 → { "success": true, "data": { "shopId", "shopCode", "trialEndAt" } }
409 → { "message": "อีเมลนี้มีในระบบแล้ว..." }      (อีเมลซ้ำ)
400 → { "message": [ ...ข้อความ validation... ] }
500 → { "message": "เกิดข้อผิดพลาดระบบ..." }         (ไม่ leak รายละเอียด DB)
```

## รันในเครื่อง (ถ้าต้องการ)

```bash
cp .env.example .env      # แล้วแก้ค่า DB ให้ตรง (local ใช้ external port)
npm install
npm run start:dev
```

## Deploy บน Dokploy

- Build Type: **Nixpacks** (เหมือน frontend) — จะรัน `npm run build` แล้ว `npm start`
- ต้องตั้ง **Environment** ตาม `.env.example` (DB_HOST ใช้ internal host `foodezy-db-me2kxd`)
- ต้องเพิ่ม **Volume** map เข้า `UPLOAD_DIR` เพื่อไม่ให้รูปหายตอน redeploy

> `synchronize: false` เสมอ — TypeORM จะไม่ไปแก้ schema ที่ import มาแล้ว
> password เก็บ plain text ชั่วคราว (จุดเดียวใน `shops.service.ts` → `preparePassword`)
