#!/usr/bin/env bash
# Starts the Gazebo container with the host's X display and Intel/AMD GPU.
# Usage: sim/run.sh [command...]   (default: an interactive shell)
# GZ_IP pins gz-transport to loopback; without it service replies inside the container fail with "Host unreachable".
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker run --rm -it \
    --name turtle-sim \
    --env DISPLAY="${DISPLAY:-:0}" \
    --env QT_X11_NO_MITSHM=1 \
    --env GZ_IP=127.0.0.1 \
    --env-file "$here/../.env" \
    --device /dev/dri \
    --volume /tmp/.X11-unix:/tmp/.X11-unix \
    --volume "$here":/sim \
    --ipc host \
    turtle-sim "${@:-bash}"
