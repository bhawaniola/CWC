FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY providers ./providers

EXPOSE 9600

CMD ["npm", "start"]
