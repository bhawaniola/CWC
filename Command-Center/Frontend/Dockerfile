FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY vite.config.mjs ./
COPY client ./client
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
COPY --from=build /app/dist ./dist
EXPOSE 9400
CMD ["node", "server.js"]
