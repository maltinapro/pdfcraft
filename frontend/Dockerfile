FROM --platform=$BUILDPLATFORM node:22-slim AS build
# Not /app: it collides with the app/ entry (Vite drops the root index.html)
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
