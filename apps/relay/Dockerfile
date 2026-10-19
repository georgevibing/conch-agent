# The relay as a Node program (ADR 0140): Fly.io, Render, or any box with Docker.
#   docker build -t conch-relay apps/relay
#   docker run -d --restart unless-stopped -p 8787:8787 -v conch-relay:/data \
#     -e CONCH_RELAY_SETUP=<the setup code from Conch> conch-relay
FROM node:24-alpine
WORKDIR /relay
COPY src/core.ts src/envelope.ts src/store.ts src/node.ts ./
RUN mkdir /data && chown node /data
ENV CONCH_RELAY_DATA=/data PORT=8787
USER node
EXPOSE 8787
CMD ["node", "node.ts"]
