# Build context is the repository root (the backend embeds frontend/src/template/invoice.typ):
#   docker build -f backend/Dockerfile -t pdfcraft-backend .
FROM rust:1-slim AS build
WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock backend/
COPY backend/src backend/src
COPY frontend/src/template frontend/src/template
RUN cd backend && cargo build --release

FROM debian:stable-slim
WORKDIR /app
COPY --from=build /app/backend/target/release/pdfcraft-backend /app/pdfcraft-backend
COPY backend/vendor/typst-packages /app/typst-packages
ENV TYPST_PACKAGE_PATH=/app/typst-packages
EXPOSE 3000
CMD ["/app/pdfcraft-backend"]
