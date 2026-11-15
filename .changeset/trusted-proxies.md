---
'@liasse/core': minor
'@liasse/server': minor
---

`TRUSTED_PROXIES` lists the reverse proxies in front of the server (addresses, CIDR ranges and the keyword `cloudflare`). From one of them, the sign-in rate limit counts the client named by the right-most untrusted address of `X-Forwarded-For`, or by `CF-Connecting-IP` when Cloudflare received the request, so one client behind the proxy no longer locks every other one out. Empty by default: the socket address stays the client. The Coolify compose file trusts the private networks of its proxy.
