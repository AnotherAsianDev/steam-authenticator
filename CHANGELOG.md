# Changelog

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
