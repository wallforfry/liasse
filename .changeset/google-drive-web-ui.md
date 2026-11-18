---
'@liasse/contract': minor
'@liasse/sdk': minor
'@liasse/web': minor
---

The web UI connects a Google Drive source. "Add a source" offers an IMAP mailbox or a Google Drive folder; the Drive form takes the address of the folder in Drive, its id or `root`, and the edit page of a Drive source sends only the fields it changed, as the IMAP form does. The card of a Drive source shows the folder it reads, offers "Connect with Google" until a first consent and "Connect again" once Google refused the authorization or it no longer opens, and points to the settings while no Google client is saved. The page `/ui/sources/google` completes the consent once, takes Google's answer out of the address and says how it ended. The settings gain a Google section: the client id, the client secret, and the redirect URI to register. The SDK adds `startGoogleConsent` and `completeGoogleConsent`, and exports `GoogleConsent`, `GoogleConsentAnswer` and `GoogleConsentResult`. The contract exports `GOOGLE_CALLBACK_PATH` and `GOOGLE_CONSENT_UI_PATH`, the paths the server and the web UI share.
