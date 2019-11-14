# create the runtime image which will just contain the built code
FROM node:12.13.0-alpine

WORKDIR /usr/src/app
COPY package.json ./
COPY .yarnrc ./
RUN yarn install --prod
RUN yarn add @tfwdev/platform@snapshot

COPY lib ./lib
COPY dist ./dist
COPY --chown=node firebase-creds.json ./

ENV HTTP_PORT 8080
ENV GOOGLE_APPLICATION_CREDENTIALS firebase-creds.json
ENV SERVER_URL https://moncher.tfw.dev/

USER node
CMD node lib/server.js

EXPOSE 8080
