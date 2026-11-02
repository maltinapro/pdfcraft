# Build context is the repository root (the backend embeds frontend/src/template/invoice.typ):
#   docker build -f backend/Dockerfile -t pdfcraft-backend .
FROM rust:1-slim AS build
WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock backend/
COPY backend/src backend/src
COPY frontend/src/template frontend/src/template
ARG APP_VERSION=
ARG APP_COMMIT=
ENV APP_VERSION=$APP_VERSION APP_COMMIT=$APP_COMMIT
RUN cd backend && cargo build --release

FROM debian:stable-slim
# Typst only embeds Libertinus Serif, New Computer Modern and DejaVu Sans Mono; the other
# fonts offered in the configurator (see FONTS in backend/src/invoice.rs) come from these
# packages. Without them Typst silently falls back to Libertinus Serif.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       fonts-liberation fonts-crosextra-carlito fonts-open-sans fonts-roboto fonts-lato fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/backend/target/release/pdfcraft-backend /app/pdfcraft-backend
COPY backend/vendor/typst-packages /app/typst-packages
ENV TYPST_PACKAGE_PATH=/app/typst-packages
EXPOSE 3000
CMD ["/app/pdfcraft-backend"]
