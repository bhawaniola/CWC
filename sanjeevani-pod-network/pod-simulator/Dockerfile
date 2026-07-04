FROM node:20-alpine AS frontend-build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY vite.config.js ./
COPY client ./client
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=frontend-build /app/public ./public

EXPOSE 8100

CMD ["npm", "start"]
