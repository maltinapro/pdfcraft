{ pkgs ? import <nixpkgs> {} }:

let
  fhs = pkgs.buildFHSEnv {
    name = "pdfcraft-fhs-env";
    
    targetPkgs = pkgs: with pkgs; [
      pkg-config
      cargo
      rustc
      rust-analyzer
      gcc
      gnumake
      cmake
      
      # Core system libraries and their development headers
      glibc
      glibc.dev
      openssl
      openssl.dev
      zlib
      zlib.dev
      
      # Tectonic dependencies
      freetype
      freetype.dev
      fontconfig
      fontconfig.dev
      icu
      icu.dev
      harfbuzz
      harfbuzz.dev
      graphite2
      graphite2.dev
      libpng
      libpng.dev
    ];

    # This script runs automatically every time you enter the FHS shell
    profile = ''
      export CXXFLAGS="-std=c++17"
    '';

    runScript = "bash";
  };
in
  fhs.env
