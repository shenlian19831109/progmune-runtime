FROM node:18-alpine

WORKDIR /app

# 只复制运行时需要的文件
COPY server/ ./server/
COPY dist/ ./dist/
COPY package.json package-lock.json* ./

# 安装生产依赖
RUN npm install --production

# 暴露端口
EXPOSE 3000

# 启动中央免疫服务器
CMD ["node", "server/hub.js"]
