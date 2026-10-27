FROM node:22-alpine3.23

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 7373

CMD ["npm", "run", "dev", "--", "--host"]
