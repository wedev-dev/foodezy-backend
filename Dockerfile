# ---------- build stage ----------
FROM node:22-slim AS builder
WORKDIR /app

# ติดตั้ง dependencies ทั้งหมด (รวม devDeps สำหรับ nest build)
# ใช้ npm install เพราะ repo นี้ไม่มี package-lock.json
COPY package*.json ./
RUN npm install

# คอมไพล์ TypeScript -> dist/
COPY . .
RUN npm run build

# ---------- run stage ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# ติดตั้งเฉพาะ dependencies ที่ใช้ตอนรัน
COPY package*.json ./
RUN npm install --omit=dev

# เอาโค้ดที่คอมไพล์แล้วจาก build stage มา
COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/main.js"]