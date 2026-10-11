FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s/deb.debian.org/${DEBIAN_MIRROR}/g" /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run skill:build && npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
