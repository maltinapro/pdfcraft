FROM rust:1-slim AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:stable-slim
WORKDIR /app
COPY --from=build /app/target/release/pdfcraft-backend /app/pdfcraft-backend
COPY vendor/typst-packages /app/typst-packages
ENV TYPST_PACKAGE_PATH=/app/typst-packages
EXPOSE 3000
CMD ["/app/pdfcraft-backend"]
