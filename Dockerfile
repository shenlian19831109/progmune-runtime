FROM node:18-alpine
WORKDIR /app
COPY server/ ./server/
COPY dist/ ./dist/
COPY public/ ./public/
COPY package.json package-lock.json* ./
RUN npm install --production
EXPOSE 8080
CMD ["node", "server/hub.js"]
