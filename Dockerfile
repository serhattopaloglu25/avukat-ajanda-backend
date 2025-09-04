FROM node:22-alpine AS builder
WORKDIR /app

# Bağımlılıklar
COPY package*.json ./
RUN npm ci

# Prisma client üretimi
COPY prisma ./prisma/
RUN npx prisma generate

# Kaynak kod ve derleme
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime image ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Derlenmiş kod ve gerekli dosyalar
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Render PORT'u otomatik geçer; biz ekstra set etmiyoruz
EXPOSE 8000

# Migrate + server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
