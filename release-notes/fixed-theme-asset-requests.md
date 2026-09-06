---
category: fixed
audience: users
area: themes
action: none
breaking: false
---
Logos, icons, favicons and backgrounds from an installed theme package now load. Every asset URL carried a cache-busting version that the API specification did not declare, so request validation rejected it before the theme route ran and the images never appeared.
