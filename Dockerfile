FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN npm install -g typescript
RUN npm run build

EXPOSE 8000

CMD ["node", "dist/server.js"]
