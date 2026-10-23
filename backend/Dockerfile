FROM node:20-alpine

WORKDIR /app

# postinstall runs `prisma generate`, so the schema and config must be here first.
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
