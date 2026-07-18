# ---------- build stage ----------
FROM node:22-slim AS builder
WORKDIR /app

# ติดตั้ง dependencies ทั้งหมด (รวม devDeps สำหรับ nest build)
COPY package*.json ./
RUN npm ci

# คอมไพล์ TypeScript -> dist/
COPY . .
RUN npm run build

# ---------- run stage ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# ติดตั้งเฉพาะ dependencies ที่ใช้ตอนรัน (เล็กลง เร็วขึ้น)
COPY package*.json ./
RUN npm ci --omit=dev

# เอาโค้ดที่คอมไพล์แล้วจาก build stage มา
COPY --from=builder /app/dist ./dist

# พอร์ตของ backend (ตรงกับ env PORT=3001)
EXPOSE 3001

CMD ["node", "dist/main.js"]