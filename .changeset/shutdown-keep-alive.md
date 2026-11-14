---
'@liasse/server': patch
---

On shutdown, a keep-alive connection that was busy when the listener closed no longer goes on serving requests until the grace period cuts it: a request received after the close is answered with `Connection: close`, which ends the connection.
