FROM node:20-alpine

WORKDIR /app

COPY src ./src
COPY package.json ./

EXPOSE 4000

CMD ["node", "src/server.js"]
