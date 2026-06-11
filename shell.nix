{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    rustup
    cargo
    rustc
    rust-analyzer
    
    # OpenSSL and dependencies
    pkg-config
    openssl
    openssl.dev
    
    # Additional build tools
    gcc
    gnumake
    cmake
    
    # C library dependencies
    glibc
  ];

  shellHook = ''
    # Set up environment for OpenSSL
    export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig:$PKG_CONFIG_PATH"
    export OPENSSL_DIR="${pkgs.openssl.dev}"
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ pkgs.openssl ]}:$LD_LIBRARY_PATH"
    
    echo "Rust development environment loaded"
    echo "Rust: $(rustc --version)"
    echo "Cargo: $(cargo --version)"
  '';
}
