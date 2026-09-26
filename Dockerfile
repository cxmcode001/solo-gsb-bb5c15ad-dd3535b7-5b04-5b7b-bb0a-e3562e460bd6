# ---- 构建阶段：安装全部 workspace 依赖并打包 React 前端 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先拷贝清单以利用 Docker 层缓存
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install

# 拷贝源码并构建前端静态资源
COPY . .
RUN npm run build

# ---- 运行阶段：仅保留生产依赖 + 构建产物 ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

EXPOSE 8080
CMD ["node", "server/src/index.js"]
