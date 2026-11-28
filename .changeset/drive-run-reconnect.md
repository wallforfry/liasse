---
'@liasse/core': patch
---

A save of a Drive source whose authorization Google refused keeps it stopped and keeps its "Connect again" button: only a new consent at Google clears the flag, since a save leaves the authorization as it was. A save used to clear the flag and run the source again, which met the same refusal, while its card showed no way to reconnect.
