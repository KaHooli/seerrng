---
category: fixed
audience: operators
area: ci
action: none
breaking: false
---
Chart release runs no longer queue indefinitely on a fork without the maintainer's self-hosted runners. Set `SEERRNG_ENABLE_RELEASE_PIPELINE` to `true` to publish Helm charts where those runners exist.
