FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
COPY assets/words/dict.txt ./assets/words/dict.txt
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
