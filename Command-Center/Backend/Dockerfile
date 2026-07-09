FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY services ./services

EXPOSE 9000

CMD ["npm", "start"]
