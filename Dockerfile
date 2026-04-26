FROM node:24-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY app/package*.json ./

RUN npm install --omit=dev && \
    npm cache clean --force

COPY app/ ./

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://localhost:3000/ || exit 1

CMD ["node", "src/index.js"]