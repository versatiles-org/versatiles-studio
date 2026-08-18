#!/usr/bin/env bash
cd "$(dirname "$0")/.."
set -e

echo "Update rust toolchain"
rustup update

echo "Upgrade Rust Dependencies"
# to use "cargo upgrade": cargo install cargo-edit
rm Cargo.lock
cargo upgrade --incompatible
cargo check --workspace

echo "Upgrade NPM dependencies"
npx npm-check-updates -u
rm -rf node_modules package-lock.json
npm install
npm update
