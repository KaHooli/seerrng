---
category: fixed
audience: operators
area: auth
action: none
breaking: false
---
The session store upstream introduced in this release no longer disables every login until SeerrNG is restarted when a single database query fails. It reported any such failure as a permanent disconnect, after which no request was given a session and every sign-in route failed: password, Plex, Jellyfin and OIDC alike.
