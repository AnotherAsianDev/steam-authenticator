# Steam Authenticator

A lean desktop Steam Guard authenticator for Windows. Plain maFiles next to the exe, confirmations, no background hammering of Steam.

![Codes](docs/screenshots/codes.png)

<table>
<tr>
<td width="50%"><img src="docs/screenshots/confirmations.png" alt="Confirmations"><br><sub>Confirmations across all accounts, grouped and filterable</sub></td>
<td width="50%"><img src="docs/screenshots/account.png" alt="Account page"><br><sub>Account page: copy fields, open Steam signed in</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/todo.png" alt="To do"><br><sub>To do: what is missing per account</sub></td>
<td width="50%"><img src="docs/screenshots/export.png" alt="Export"><br><sub>Export with your own fields and separator</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/add.png" alt="Add account"><br><sub>Add an authenticator to an account that has none</sub></td>
<td></td>
</tr>
</table>

*Screenshots use made-up accounts.*

Minimal desktop Steam Guard authenticator (Electron + TypeScript, no UI framework).

- **Codes** with Steam clock sync. Click the code box to copy (clipboard clears after a configurable time). Click an account name to open its Steam profile.
- **Drop folder:** put maFiles (any file name) into the storage folder while the app is running or closed;
  they are renamed to `<steamid>.maFile` and appear within a second or two. "Open storage folder" shows it
  (the `maFiles` folder next to the exe in the Windows build).
- **Auto-import:** on start, folders named `maFiles` in Downloads, Desktop and Documents (plus any folders
  you add in Settings) are scanned. New accounts are copied as plain `.maFile` files into the app's
  `maFiles` folder. Existing accounts are never overwritten and originals are never changed.
- **Confirmations:** pending trades/market listings per account, review, accept or deny selected,
  accept/deny all. Security-related requests (account recovery, phone change) are never included in
  "all" and must be handled one at a time.
- **Sign-in:** needed only if the maFile has no usable session. The Steam Guard code is generated
  from the shared secret. You can save a password per account (`credentials.json`, plain text); it is then
  used automatically. A rejected saved password is not retried for 30 minutes (or until you change it).
  A refresh token is kept in `sessions.json` (plain text).
- **Copy** username, password (if saved), shared secret, identity secret, revocation code, SteamID64.
- **Profile pictures** from the public profile (no API key), at most once a week per account.
- **Settings:** theme, density, show SteamID64, pictures, check on startup / optional interval, clipboard clearing, import folders.

    npm install      (PowerShell: npm.cmd install)
    npm test
    npm start        (PowerShell: npm.cmd start)
    npm run package:win   builds out/Authenticator-portable (no Node needed to run it)

Tested against a mock Steam and against steam-totp for code/signature parity.
Not yet verified against live Steam: the sign-in flow and real confirmation responses.

## Adding an authenticator to an account that has none

`+` > Add account. Sign in with username and password (plus the emailed code if Steam asks), confirm, and the app asks Steam to attach a Mobile Authenticator. The new secrets and the revocation code are written to `pending/` *before* activation, so a crash or lost connection cannot lose them. After you enter the SMS/email activation code, the maFile moves into the storage folder and the account appears in the list. "Cancel and remove it again" detaches it using the revocation code.

Needs the account to have a confirmed phone number or email. This flow has only been tested against a mocked Steam, not a live account. Write the revocation code down.

Click an account name to open its Steam profile; click the code box to copy the code.

## When it talks to Steam

Confirmations are checked once at startup (can be turned off in Settings) and whenever you press the refresh button. There is no background polling unless you pick an interval. A round checks one account at a time with a pause between them, ignores repeated button presses for 20 seconds, and stops completely for 10 to 30 minutes if Steam says to slow down.

## Open on Steam, signed in

On an account's page, Profile / Inventory / Trade offers / Market / Store / Account open a separate window already logged in as that account (using its saved session; it signs in with the saved password first if needed). Each window has its own in-memory session that is wiped on close, can only stay on Steam domains, and sends other links to your normal browser. Untested against live Steam: if a page asks you to log in anyway, the session token was not accepted for that site.

## Folder layout (Windows build)

```
Authenticator.exe   small launcher, double-click this
maFiles/            your maFiles, like SDA (drop files here)
data/               settings, saved passwords, caches
app/                the program itself, you can ignore it
```
Everything lives next to the exe, so copying or backing up the folder moves it all. If the folder is not writable (for example inside Program Files) the per-user app data folder is used instead. On first start, data from the earlier per-user location is copied over (the old copy is left in place).

The launcher is built from `launcher/launcher.c` (a prebuilt `launcher/Launcher.exe` is included).

## To do and Export

To do lists what is missing per account (saved password, revocation code, sign-in, unfinished activation) with the fix inline. Export builds a plain-text list: pick fields and their order, pick the separator (`: ; , . |`, tab, space or your own), see an example with made-up data, then copy or save as .txt.
