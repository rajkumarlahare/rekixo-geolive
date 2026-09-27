FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY dashboard ./dashboard
COPY sdk ./sdk
COPY scripts ./scripts
COPY openapi.yaml ./

ENV NODE_ENV=development
ENV PORT=8787
EXPOSE 8787

USER node
CMD ["node", "server/src/server.mjs"]
