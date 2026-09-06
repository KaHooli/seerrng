---
category: fixed
audience: operators
area: logging
action: none
breaking: false
---
A configuration directory the container cannot change permissions on, such as a bind mount owned by another user, no longer fills the log with the same warning on every settings save; it is now reported once per path with guidance on what to do about it.
