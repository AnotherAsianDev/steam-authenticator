# Changelog

## 0.9.0
- New compact design: smaller rows, avatars and codes so more fits on screen, and a side menu that collapses to icons. Two small icons at the bottom of the menu collapse/expand it and switch the theme (system, light, dark).
- New "columns" view: compact rows with two or more accounts per line, depending on the window width. Grid and columns use the full window width.
- Right-click an account: a clean menu in three groups (Copy, Account, Open on Steam) plus Move to trash, with arrow-key navigation.
- Status marks moved out of the way: each kind of ban (VAC, game, community, trade, trade probation) has its own icon, and waiting confirmations, sign-in problems, the note and the tag are small icons right after the name (hover for the meaning), so rows keep their height. The note no longer takes a line under the name. A banned account also gets a red outline.
- Tags: one short tag per account (account page), shown next to the name, searched by the filter, with a tag filter menu on the Codes page.
- A banner on the Codes page asks for a Steam Web API key while none is set (what is missing without it is stated); "Not now" hides it for good.
- Right-click menu: "Password" (was "Saved password") now follows Username and is greyed out with "not saved" when the account has no saved password.
- Animations: pages and rows fade in, the menu and toasts pop, icons appear with a small bounce, the code pulses when it changes, buttons and rows react to hover and press, theme changes blend. All of it is off when Windows is set to reduce motion.
- Ban history: what appeared or was lifted and when, on the account page.
- Sign-in warning: an account without a saved password gets a To do item, an icon and a Health check line when its saved sign-in has 14 days or less left. Saving the password lets the app renew it by itself.
- Optional Steam Web API key (Settings): checked with Steam before it is saved, can be tested again later or removed. With it, bans (VAC with count, game bans, community bans, trade bans, days since the last ban) come from the official API for all accounts in one request every 12 hours. The key is stored with the saved passwords (encrypted with a master password) and is hidden from the log.
- Ban check: the public profile page that is already read for the name and picture also says whether an account has a VAC ban or a trade ban. Such accounts get a red tag in the list, a "banned" chip in the overview, a section on the account page and a line in the Health check, and a new ban is reported as soon as it is seen. Profiles are now read about every 12 hours per account instead of weekly (one request each, the picture only when it changed). Turn it off with Settings, Watch for bans. Community bans and game bans are not part of that page; see the notes.
- Export, Codes and the account page: pinned accounts first, as before.
- Cleanup: the stylesheet's account-list rules are now one section instead of layered overrides; ban texts live in one place; removed the Density setting (the design is compact now), unused code and imports, and merged the profile name and picture address files into one `data/avatars/profiles.json` (older files are read once and carried over). The build now fails on unused code.
- Fixed the star overlapping the details arrow in the grid layout.

## 0.8.0
- Pin accounts: a star on each account keeps it at the top of the Codes page, the Confirmations page and the Export list, whatever the sort.
- Notes: a short note per account (set on the account page, up to 120 characters) shown under the name and searched by the filter. Pins and notes are stored in `data/meta.json`; the maFiles are not touched.
- Confirmations page: "Accept all" / "Deny all" per account for what is shown (respects the filter, asks for a second click, never includes security-critical items).
- Health check (Settings): tests each account's secrets, sign-in state, saved password and revocation code, and shows how far your PC clock is from Steam's.

## 0.7.1
- The Export filter box now looks like the filter boxes on the other pages.
- Clicking an avatar opens the account's Steam profile, in the list, the grid and the account page.

## 0.7.0
- Layouts: a switch next to the sort menu on the Codes page toggles between the list and a grid of cards (code in the middle of each card). The choice is remembered.
- Export shows the same big name as the Codes page (the Steam nickname if "Show Steam nickname" is on, else the login name), with the login name and SteamID under it, and sorts by that name.
- Export has a filter box. Accounts you filter out of view keep their selection; All and None only act on the accounts currently shown, and a counter shows how many are selected.
- Fewer Steam requests: when profile pictures are off, only the profile XML (for the nickname) is fetched and no image; when the picture address has not changed since last time, the picture is not downloaded again.
- Data safety: all files are written through a temporary file and flushed to disk before they replace the old one, so a crash or power loss cannot leave a half-written file. maFiles, the vault, saved passwords, sign-in tokens and settings also keep the previous copy as `.bak`.
- A damaged `credentials.json`, `sessions.json` or `vault.json` is no longer treated as empty: the `.bak` copy is used, and if there is none the file is left untouched and changes are refused with a clear message (it used to be overwritten by the next save).
- Crash handling: if the window process crashes it is reloaded; unexpected errors are written to the log; a disk-full or read-only folder gives a plain message; a failure during start-up shows a message instead of dying silently.

## 0.6.3
- With "Show Steam nickname" on, the login name is now shown under the name for every account, also when the nickname happens to be the same as the login name.

## 0.6.2
- Importing maFiles that are not named after the SteamID64 (for example `login.maFile`) and do not carry the SteamID in their Session block now works. The app looks, in this order, at a lowercase `steamid` field, the login cookie, a token's subject and finally SDA's `manifest.json` next to the file (which lists every file with its SteamID). When it finds the ID it writes it into the stored copy, so the file reads back on its own. The same applies to files dropped into the storage folder and to "Import maFiles…".
- If nothing tells which account a file belongs to, the message now says what to do: use Add account, Import with secrets.

## 0.6.1
- Export uses the same account order as the Codes page: the accounts list on the Export page is sorted that way, and the lines are written in that order. The sort menu is there too, and changing it changes both pages.

## 0.6.0
- Sort the account list (menu next to the filter chips): added oldest first (default), added newest first, name A to Z, name Z to A, most pending confirmations first. The choice is remembered. Name sorting follows what the list shows, so with "Show Steam nickname" on it sorts by nickname.
- Accounts you added before this version are sorted too: their date is taken from their maFile (the earlier of creation and modification time) the first time this version sees them, and then kept in `data/added.json`. If you copied your folder around, many files can share one time, and those accounts stay in name order among themselves. New accounts get the time they are added.

## 0.5.1
- The update check now runs every time the app starts (it used to wait up to a day). If GitHub cannot be reached, the last known answer is used.

## 0.5.0
- Update notice: once a day the app asks GitHub whether a newer release exists and, if so, shows a small notice with a button that opens the release page. It never downloads or installs anything; you update by dragging the new folder over the old one, as before. "Later" hides the notice for that version. Turn it off, or check right now, under Settings, Check for updates. The only request is to api.github.com, and the result is cached in `data/update.json`.

## 0.4.2
- Several accounts: a line can end with an optional revocation code, `username:password:shared_secret:identity_secret:R12345`. Lines without it work as before.

## 0.4.1
- Importing with secrets now has two modes: "One account" with a field for each value (username, password, shared_secret, identity_secret, and an optional revocation code that ends up in the maFile) and a message that names the field that is wrong, and "Several accounts" for pasted lines. The button on Add account is now "Import with secrets…".

## 0.4.0
- New: import accounts from plain text, one per line as `username:password:shared_secret:identity_secret` (Add account, then "Import from text"). Separator can be : ; , | or tab, and the password may contain the separator. For each line the app signs in once with the password and a code made from the shared secret to find the SteamID64, creates the maFile, and saves the password and sign-in token. Lines that fail are listed with the reason; the others still import. Accounts already in the app or the trash are skipped.

## 0.3.1
- New overview at the top of the Codes page: how many accounts you have, and how many still need a sign-in, have no saved password, no revocation code, or were never activated. Click a chip to open the To do list. When nothing is missing it says so.
- The logo in the sidebar is bigger and no longer sits on a dark tile that vanished into the sidebar; it is aligned with the menu icons.

## 0.3.0
- New logo: a shield with a Steam Guard style code. It is the app icon (window, taskbar, Authenticator.exe) and shows in the sidebar and on the lock screen.
- The Export page now shows each account as a card: login name, Steam nickname, SteamID64, and whether a password and a revocation code are saved (a missing one is highlighted when you export that field). New export field "Nickname".
- Settings ends with an About block: copyright (github.com/AnotherAsianDev), MIT License, and a note that the app is not affiliated with Valve. Added a LICENSE file.

## 0.2.2
- The title bar buttons (lock, minimize, maximize, close) work while the app is locked and while a dialog is open. The lock and dialog layers no longer count as part of the window's drag area, which was swallowing the clicks.
- New setting "Show Steam nickname": shows the profile name instead of the login name on the list, the account page and in confirmations. The login name moves to the second line, next to the SteamID64 if that is on. Search finds both. The name comes from the same public profile lookup as the pictures, so it costs no extra requests, and it is kept in `data/avatars/names.json`.

## 0.2.1
- The padlock moved to the title bar, next to minimize (shown once a master password exists; closed and blue while locked). The sidebar is tidier.
- Settings now has a gear icon instead of a sun.
- Scroll bars match the app: thin, rounded, quiet until you use them.

## 0.2.0
- Optional **master password** (Settings > Security). Encrypts saved passwords, sign-in tokens and trashed accounts' passwords; the maFiles stay plain. Portable: not tied to a PC or Windows account.
- Lock screen at start, a Lock/Unlock button in the sidebar, "Open codes only" to skip. Everything that needs a saved password (sign-in, password copy, export, add account) waits for the unlock, and an encrypted file is never overwritten while locked.
- Optional **PIN for this PC** (4 to 12 digits) so you do not type the master password every time. Stored outside the program folder, removed after 5 wrong tries.
- Change the master password or turn encryption off again at any time; turning it off writes plain files back.

## 0.1.5
- Removing an account now moves it to a Trash (`data/trash/`) instead of deleting it. New Trash page: restore (with the saved password), delete forever, empty, open folder. Removed accounts are no longer re-imported on their own from SDA folders.
- Own title bar with minimize, maximize and close, in the app's colours.
- Remembers window size and position (and if it was maximized). Only one copy runs per folder; starting a second one focuses the first.
- Faster and quieter: screens refresh only when something changed (the Codes screen no longer re-checks the to-do list every second), nothing refreshes while the window is minimized, profile pictures are looked up on disk once per few minutes, the first codes wait for the clock sync so they are never off for a second, and the startup scan no longer waits for the network.
- No stray menu bar when pressing Alt. Ctrl+F focuses the filter.

## 0.1.4
- New Log page in the sidebar: every warning and error with its full details (error codes, stack, what Steam answered), filter, copy all, save as .txt, clear. Stored in `data/log.jsonl`. Passwords, secrets, tokens and revocation codes are hidden before anything is written.

## 0.1.3
- Saving a password now checks it with a real sign-in first. A wrong password is refused and not saved; with no connection it is saved and marked as unchecked.

## 0.1.2
- Cleaner layout: title, filters and cards share one left edge; the account page is grouped into cards (Copy, Open on Steam, Confirmations).
- Code boxes line up across rows whether or not a badge is shown.

## 0.1.1
- Releases no longer contain `maFiles` or `data` folders. Update by dragging the new folder over the old one and choosing Replace; your accounts and settings are never touched, and anything missing is recreated on start.
- Settings shows the installed version.

## 0.1.0
First release: codes, confirmations, add an authenticator, signed-in Steam window, To do, export, portable layout with a launcher, gentle checks against Steam.
