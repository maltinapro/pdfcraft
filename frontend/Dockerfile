FROM --platform=$BUILDPLATFORM node:26-slim AS build
# Not /app: it collides with the app/ entry (Vite drops the root index.html)
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Published next to the API reference page (vite.config.ts reads ../docs/openapi.yaml)
COPY docs/openapi.yaml /docs/openapi.yaml
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION
RUN npm run build

FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
