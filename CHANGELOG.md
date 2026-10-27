# Changelog

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
