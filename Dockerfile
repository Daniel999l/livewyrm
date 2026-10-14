# One image, one service: Avida (C++) is compiled here and the Node service
# spawns it as a child process in the same container.

# ---- stage 1: build Avida ----
FROM ubuntu:22.04 AS avida
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates cmake g++ make \
    && rm -rf /var/lib/apt/lists/*
ARG AVIDA_REF=47f13dadb547fcf10f620ace60247f38b30b8b16
RUN git clone --recursive https://github.com/devosoft/avida /avida \
    && cd /avida && git checkout ${AVIDA_REF} && git submodule update --init --recursive
WORKDIR /avida
RUN mkdir build && cd build \
    && AVIDA_DISABLE_BACKTRACE=1 cmake -DCMAKE_BUILD_TYPE=Release -DAVD_GUI_NCURSES=OFF -DAVD_UNIT_TESTS=OFF .. \
    && make -j4 avida
RUN mkdir -p /opt/avida/config \
    && cp build/bin/avida /opt/avida/avida \
    && cp avida-core/support/config/avida.cfg avida-core/support/config/instset-heads.cfg \
          avida-core/support/config/default-heads.org /opt/avida/config/

# ---- stage 2: node service ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=avida /opt/avida /opt/avida
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV AVIDA_BIN=/opt/avida/avida AVIDA_CONFIG_DIR=/opt/avida/config AVIDA_WORK_DIR=/data/avida
CMD ["npm", "start"]
