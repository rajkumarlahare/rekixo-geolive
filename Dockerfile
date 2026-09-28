FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server ./server
COPY dashboard ./dashboard
COPY sdk ./sdk
COPY scripts ./scripts
COPY database ./database
COPY openapi.yaml ./

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

USER node
CMD ["node", "server/src/server.mjs"]
