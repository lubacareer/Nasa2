FROM --platform=$BUILDPLATFORM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS desktop-build

WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci
COPY . .

ARG TARGETARCH
RUN npm run build \
    && case "$TARGETARCH" in \
         amd64) electron_arch=x64 ;; \
         arm64) electron_arch=arm64 ;; \
         *) echo "Unsupported Docker target architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && npm exec -- electron-forge package --platform=linux --arch="$electron_arch" \
    && mv "out/desktop/NISAR Surface Change-linux-$electron_arch" out/desktop/nisar-app

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8 AS runtime

ENV DISPLAY=:99 \
    HOME=/home/nisar \
    NO_AT_BRIDGE=1

RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian/20261026T000000Z/ bookworm main' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian/20261026T000000Z/ bookworm-updates main' \
      'deb [check-valid-until=no signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://snapshot.debian.org/archive/debian-security/20261026T000000Z/ bookworm-security main' \
      > /etc/apt/sources.list.d/nisar-snapshot.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i 's|http://snapshot.debian.org/|https://snapshot.debian.org/|g' /etc/apt/sources.list.d/nisar-snapshot.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnss3 \
      libpango-1.0-0 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
      novnc \
      tini \
      websockify \
      x11-utils \
      x11vnc \
      xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin nisar \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix

COPY --from=desktop-build /app/out /opt/nisar/out
COPY docker/entrypoint.sh /usr/local/bin/nisar-entrypoint
RUN chown -R root:root /opt/nisar/out /usr/local/bin/nisar-entrypoint \
    && chmod -R a+rX /opt/nisar/out \
    && chmod -R a-w /opt/nisar/out \
    && chmod 0755 /usr/local/bin/nisar-entrypoint \
    && find /opt/nisar/out -type f -name chrome-sandbox -exec chown root:root {} + -exec chmod 4755 {} +

USER nisar
WORKDIR /home/nisar
EXPOSE 6080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nisar-entrypoint"]
