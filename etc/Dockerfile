# create the runtime image which will just contain the built code
FROM node:12.13.0-alpine

WORKDIR /usr/src/app
COPY package.json ./
COPY .yarnrc ./
RUN yarn install --prod

COPY lib ./lib
COPY dist ./dist

USER node
CMD node lib/server.js

ENV HTTP_PORT 8080

EXPOSE 8080
