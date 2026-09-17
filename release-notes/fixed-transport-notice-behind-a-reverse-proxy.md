---
category: fixed
audience: operators
area: auth
action: none
breaking: false
---
The login page no longer warns that traffic could be intercepted when a reverse proxy is already encrypting it. With the built-in HTTPS listener disabled and HTTP sign-in permitted — now the default — every reverse-proxy installation saw the insecure-transport warning even though the browser connection was HTTPS. Such a viewer is now told that their connection is protected, and separately that direct HTTP sign-in is still permitted for anyone reaching the server past the proxy.
