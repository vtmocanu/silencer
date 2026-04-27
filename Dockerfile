FROM node:24-alpine

# node:*-alpine ships with a `node` user/group at UID/GID 1000. Reuse it
# instead of creating a duplicate (which collides on `addgroup -g 1000`).
WORKDIR /app

COPY app/package*.json ./

RUN npm install --omit=dev && \
    npm cache clean --force

COPY app/ ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://localhost:3000/ || exit 1

CMD ["node", "src/index.js"]