---
category: fixed
audience: operators
area: auth
action: none
breaking: false
---
The login page no longer warns that traffic could be intercepted when a reverse proxy is already encrypting it. With the built-in HTTPS listener disabled and HTTP sign-in permitted — now the default — every reverse-proxy install saw that warning even over HTTPS. Such a viewer is now told their connection is protected, and separately that direct HTTP sign-in remains permitted.
