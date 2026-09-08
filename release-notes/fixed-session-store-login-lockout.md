---
category: fixed
audience: operators
area: auth
action: Restart SeerrNG once to clear the condition if sign-in is currently failing with "Session is unavailable."; the running process cannot recover on its own.
breaking: false
---
A single failed query against the session table no longer locks every user out until SeerrNG is restarted. The session store treated any such failure as a permanent disconnect, after which no request was given a session and every sign-in route failed: password, Plex, Jellyfin and OIDC alike.
