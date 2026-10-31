# Changelog

## 0.9.10
- Steam profile setup, detection fixed: an account counts as "without Steam profile" when Steam returns no profile data for it, or when the signed-in page shows Steam's "Set Up Steam Profile" welcome. Every profile is read once more so accounts saved by an older version are checked too. The button on the account page and the "N without Steam profile" mark on the Accounts page now appear for them. A "Set up Steam profile" entry in the right-click menu works for any account.
- Opening a saved trade link signed in is now only in the right-click menu of an account (one entry per saved link) and in the menu of the signed-in Steam window. The extra button in the Send panel is gone.

## 0.9.9
- Set up the Steam profile from the app: an account that never opened its Steam Community profile (Steam's "Hello, ... Set Up Steam Profile" page) gets a "Set up Steam profile" button on its account page, and the Accounts page shows a "N without Steam profile" mark that sets up all of them (click twice to confirm, 1.5 seconds between accounts). It opens the same page as Steam's own button. Needed for trading and for the nickname and picture to appear.
- Trades: "Open signed in" next to a saved or pasted trade link opens it in a Steam window signed in as the sending account.
- The signed-in Steam window has a "Saved trade links" menu that opens any saved link.

## 0.9.8
- The side menu opens and closes in one smooth movement: the icons stay exactly where they are, only the width changes and the labels fade in and out. Before, labels appeared at once and some entries jumped sideways while the menu was still moving. The count badges glide to their place too.

## 0.9.7
- Lower CPU use: the ring around the codes is redrawn 12 times a second instead of 60 (it still looks smooth), and each code box repaints on its own.

## 0.9.6
- More modern controls with the same colors: quiet outlined buttons with a soft hover, one filled main action with a gentle glow, dropdowns with a chevron, a clear accent glow on the field you are in, a raised pill for the active tab, softer card edges with a faint top highlight, Cascadia Mono for the codes, a visible keyboard focus ring.
- Nickname for accounts without a set-up Steam profile, third try: the app asks for the profile page as the account itself (with its saved sign-in), then the public page, then Steam's hover card. An account with a picture but no name is asked again at most once an hour. If no name is found, the log says what the page contained.
- The window respects the Windows "reduce motion" setting.

## 0.9.5
- Trades: reading another account's trade link from Steam is removed, because Steam does not hand it out reliably. Items are sent to a trade link you paste, or to one you saved (the saved links stay, with Save as and Remove). The "Your accounts" entries in the Send to lists are gone from both the single and the several-accounts screen.
- Cleanup: removed the code and styles left over from the removed trade-link lookup, the old Check account and earlier layouts.

## 0.9.4
- Nicknames for accounts whose Steam Community profile was never set up: Steam gives no profile data for them, so the app now reads the name and picture from the normal profile page as a second try. If that page has no picture either, Steam's default picture is used.

## 0.9.3
- The ring around a code now empties in one smooth sweep instead of in one-second steps.
- Trades: "Check account" is removed. It only repeated what the sign-in and the ban marks already show, and a trade ban still shows as a warning above the items.
- Text is easier to read: more space between a setting and its description, long explanations are kept to a comfortable line length, and the ban history on the account page has its dates in a column.
- Accounts whose Steam profile could not be read completely now show the nickname as soon as it was read, instead of waiting for the next refresh.

## 0.9.2
- Trades: when Steam sends the trade-link page somewhere the app will not follow (usually its sign-in page), the app no longer says the session is refused, since the inventory still works. It says Steam would not show that account's trade link and asks you to paste it. The page address Steam answered with is written to the log (no query data).
- Trades: the trade-link request now also sends a session id, like a browser does.

## 0.9.1
- Trades, check: "Check account" now only looks at the sign-in and at bans. The unreliable trade-link lookup and the market, limit and authenticator-age checks are gone, so it no longer shows warnings that Steam cannot confirm.
- Trades, send: the controls are one tidy panel (selected count, Send to, trade link, Save as, Review). Saved links can be removed from the same row.
- Trades: error messages now name the step that failed (reading the inventory, the trade link, sending the offer) instead of a general "sign in again".
- Trades: reading your own trade link follows Steam's redirect to your custom profile address.
- Trades: item pictures try several Steam image servers, so they show up again.
- Profile pictures: Steam's default picture no longer replaces a real picture that was already saved.

## 0.9.0
- New compact design: smaller rows, avatars and codes so more fits on screen, and a side menu that collapses to icons. Two small icons at the bottom of the menu collapse/expand it and switch the theme (system, light, dark).
- New compact list view: one thin line per account, about 36 px instead of 56, still showing the login name and SteamID64 when those settings are on.
- The time left on a code is now the border of the code box, which empties clockwise and turns red in the last 5 seconds, instead of a line across the whole row. Every view uses it.
- The page called Codes is now called Accounts, with a people icon in the side menu instead of the shield.
- The small marks on an account sit in fixed places, so the same mark is in the same spot on every row of the list and compact list: sign-in expiry, note, then bans and the tag. Waiting confirmations (and "sign in needed") sit right after the name.
- The four views (list, compact list, columns, grid) sit in one View menu instead of four buttons.
- Profile picture: an account whose Steam profile was never set up now shows Steam's default picture instead of a letter.
- New "columns" view: compact rows with two or more accounts per line, depending on the window width. Grid and columns use the full window width.
- Right-click an account: a clean menu in three groups (Copy, Account, Open on Steam) plus Move to trash, with arrow-key navigation.
- Status marks moved out of the way: each kind of ban (VAC, game, community, trade, trade probation) has its own icon, and waiting confirmations, sign-in problems, the note and the tag are small icons right after the name (hover for the meaning), so rows keep their height. The note no longer takes a line under the name. A banned account also gets a red outline.
- Tags: one short tag per account (account page), shown next to the name, searched by the filter, with a tag filter menu on the Accounts page.
- A banner on the Accounts page asks for a Steam Web API key while none is set (what is missing without it is stated); "Not now" hides it for good.
- Right-click menu: "Password" (was "Saved password") now follows Username and is greyed out with "not saved" when the account has no saved password.
- Animations: pages and rows fade in, the menu and toasts pop, icons appear with a small bounce, the code pulses when it changes, buttons and rows react to hover and press, theme changes blend. All of it is off when Windows is set to reduce motion.
- Ban history: what appeared or was lifted and when, on the account page.
- Sign-in warning: an account without a saved password gets a To do item, an icon and a Health check line when its saved sign-in has 14 days or less left. Saving the password lets the app renew it by itself.
- Optional Steam Web API key (Settings): checked with Steam before it is saved, can be tested again later or removed. With it, bans (VAC with count, game bans, community bans, trade bans, days since the last ban) come from the official API for all accounts in one request every 12 hours. The key is stored with the saved passwords (encrypted with a master password) and is hidden from the log.
- Ban check: the public profile page that is already read for the name and picture also says whether an account has a VAC ban or a trade ban. Such accounts get a red tag in the list, a "banned" chip in the overview, a section on the account page and a line in the Health check, and a new ban is reported as soon as it is seen. Profiles are now read about every 12 hours per account instead of weekly (one request each, the picture only when it changed). Turn it off with Settings, Watch for bans. Community bans and game bans are not part of that page; see the notes.
- Export, Accounts and the account page: pinned accounts first, as before.
- Cleanup: the stylesheet's account-list rules are now one section instead of layered overrides; ban texts live in one place; removed the Density setting (the design is compact now), unused code and imports, and merged the profile name and picture address files into one `data/avatars/profiles.json` (older files are read once and carried over). The build now fails on unused code.
- Settings are split into tabs (General, Bans, Confirmations, Security, Import and updates, Health and about). The theme (System, Light, Dark) is now chosen there as a three-way switch instead of an icon in the side menu.
- Trades tab: choose the sending account, then pick its tradeable items (the account page and the right-click menu have a "Send items…" shortcut that opens the tab for that account) from a game's inventory (CS2, Dota 2, TF2, Rust, Steam cards and similar), with pictures, names and stack counts, a filter and select all/none. Send them to another of your accounts (its trade link is read from that account) or to a pasted or saved trade link. A summary and typing SEND are required first; the items are checked against Steam's current inventory, split into offers of up to 100, and each offer is confirmed on the sending account automatically. Items that cannot be traded yet (trade protection) are not selectable and are shown separately with the date they become tradable. This uses the same web calls as Steam's own trade page, which Steam may change.
- Trades, several accounts: tick the accounts to send from, choose the game and the receiver (the receiver is unticked automatically and can't be a sender). A preview lists, per account, how many items and offers there are and how many are still locked; after typing SEND the accounts are processed one after the other with a 5 second pause, each with live status. It stops on a rate-limit reply from Steam and can be cancelled after the current account. Leaving the tab also stops it.
- Trades with many accounts: the sender list has a filter, a tag menu, "Select all shown" / "None" and a counter, and scrolls inside its own box; the preview table scrolls with a fixed header and total, lists accounts with items first and skips empty ones. Game, receiver and the other controls now have titles above them.
- Trades: hover an account in the sender list and click the small crossed-circle to leave it out of "Select all shown" (remembered in `data/meta.json`; you can still tick it by hand).
- Log: a "Trades" filter shows every trade, with each offer's items in the details (count per item name), who sent to whom, and whether it was confirmed.
- Trades: reading another account's trade link now follows Steam's move from the numeric profile address to a custom address (that was a likely cause of "refused reading the trade link (HTTP 302)"). The saved-link controls no longer run off the edge: the name field and Save link share one row, and Remove only shows for a saved link.
- Trades: when Steam refuses a request, the message now says which step it was (reading the inventory, the trade link, the open offers, sending, cancelling) and the HTTP number, and the Log tab records it.
- Trades tab, check: "Check account" gives one answer: Can trade now, Can trade but watch out, or Cannot trade right now, with the reasons underneath (sign-in session and bans).
- Trades tab, open offers: lists the offers an account (or all accounts) sent that nobody accepted yet, with Cancel and Cancel all, in a list that uses the full window height. Uses Steam's trade offer service with the account's own sign-in, so no API key. Not tested against live Steam.
- Trades tab, overview: reads every account's inventory one after another (1.2 s apart, stops on a rate limit) and shows tradable and locked items per account with a total. Click an account to send from it.
- Backup and restore (Settings, Import and updates): one file with every maFile, saved password, note and tag, sealed with AES-256-GCM and a password you choose (8 or more characters). Restoring only adds accounts that are missing and never changes existing ones.
- One control size everywhere: inputs, drop-downs, buttons, filter chips, tabs and switches share the same height and text size. Fixed the Confirmations list being squeezed after the trade tiles were added.
- README screenshots redone for the new design, plus grid and settings.
- Grid layout: roomier cards; name and login name stay together, status icons sit on their own line below them. Fixed the star overlapping the details arrow.

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
