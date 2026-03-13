#!/bin/bash
# Download the TrailBase binary for the current platform
set -e

VERSION="v0.24.4"
DEST="src-tauri/binaries"
mkdir -p "$DEST"

ARCH=$(uname -m)
OS=$(uname -s)

case "$OS-$ARCH" in
  Darwin-arm64)
    URL="https://github.com/trailbaseio/trailbase/releases/download/${VERSION}/trailbase_${VERSION}_arm64_apple_darwin.zip"
    BINARY="trail-aarch64-apple-darwin"
    ;;
  Darwin-x86_64)
    URL="https://github.com/trailbaseio/trailbase/releases/download/${VERSION}/trailbase_${VERSION}_x86_64_apple_darwin.zip"
    BINARY="trail-x86_64-apple-darwin"
    ;;
  Linux-x86_64)
    URL="https://github.com/trailbaseio/trailbase/releases/download/${VERSION}/trailbase_${VERSION}_x86_64_unknown_linux_gnu.zip"
    BINARY="trail-x86_64-unknown-linux-gnu"
    ;;
  *)
    echo "Unsupported platform: $OS-$ARCH"
    exit 1
    ;;
esac

echo "Downloading TrailBase $VERSION for $OS-$ARCH..."
curl -L -o /tmp/trail.zip "$URL"
unzip -o /tmp/trail.zip trail -d "$DEST/"
mv "$DEST/trail" "$DEST/$BINARY"
chmod +x "$DEST/$BINARY"
rm /tmp/trail.zip
echo "TrailBase binary saved to $DEST/$BINARY"
