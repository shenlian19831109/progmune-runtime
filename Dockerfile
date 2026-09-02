# Progmune 中央免疫 Hub —— 零依赖 Node 服务（无需 npm install / dist）
FROM node:18-alpine
WORKDIR /app
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "server/hub.js"]
