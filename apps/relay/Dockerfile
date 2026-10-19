# The relay as a Node program (ADR 0140): Fly.io, Render, or any box with Docker.
#   docker build -t conch-relay apps/relay
#   docker run -d --restart unless-stopped -p 8787:8787 -v conch-relay:/data \
#     -e CONCH_RELAY_SETUP=<the setup code from Conch> conch-relay
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4
WORKDIR /relay
COPY src/core.ts src/envelope.ts src/store.ts src/node.ts ./
RUN mkdir /data && chown node /data
ENV CONCH_RELAY_DATA=/data PORT=8787
USER node
EXPOSE 8787
CMD ["node", "node.ts"]
