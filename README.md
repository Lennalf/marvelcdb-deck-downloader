# MarvelCDB Deck Downloader (Chromium extension)

Back up **all your MarvelCDB decks** in one ZIP: cards, metadata, and the Markdown
write-up that the Text and OCTGN downloads leave out. It works on your unpublished
decks too. Everything runs in your browser, and nothing is uploaded anywhere.

## Why an extension (and not a website)

Your unpublished decks are private to your account, so reading them means being signed
in. For security, browsers don't let an ordinary website reach into your MarvelCDB
session from the outside. An extension can, because it works as part of MarvelCDB's own
pages while you're logged in. That's the only reason this is an extension and not just a
page you'd visit, and it only ever reads your own decks.

## Install

You add this to your browser yourself. It takes a couple of minutes, and you only do it
once. These steps are for Chrome, and they work the same in Brave, Edge, or any other
Chromium browser. No coding required, and you don't need a GitHub account.

### Step 1: Download the files

1. Near the top of this page, find the green **`< > Code`** button and click it.
2. In the small menu that opens, click **Download ZIP**.
3. Your browser saves a file named `marvelcdb-deck-downloader-main.zip`, usually into
   your **Downloads** folder.

### Step 2: Unzip the folder

The file you downloaded is a compressed "ZIP" folder, and the browser can't use it until
you unpack it.

- **Windows:** right-click the file, choose **Extract All**, then click **Extract**.
- **Mac:** double-click the file.

You'll now have a normal folder called `marvelcdb-deck-downloader-main`. Move it
somewhere safe that you won't clean out later, like your Documents folder. The extension
runs straight from this folder. If you move or delete it, the extension will stop
working the next time you restart your browser.

### Step 3: Add it to Chrome

1. Open a new tab, type `chrome://extensions` into the address bar, and press Enter.
2. Turn on **Developer mode** with the switch in the top-right corner.
3. Click the **Load unpacked** button that appears at the top-left.
4. Select the `marvelcdb-deck-downloader-main` folder you unzipped, then click **Select
   Folder** (Windows) or **Open** (Mac).

That's it. You'll see "MarvelCDB Deck Downloader" in your list of extensions. If you'd
like its icon in the toolbar, click the puzzle-piece button in Chrome and pin it.

Everything runs on your own computer. The extension has no server and sends nothing
anywhere.

## Use

1. Make sure you're **logged in** to [marvelcdb.com](https://marvelcdb.com).
2. Go to your **My Decks** page at
   [marvelcdb.com/decks](https://marvelcdb.com/decks). To keep it out of your way,
   the downloader only appears here, on your deck list, and nowhere else on the site.
   (Clicking the toolbar icon takes you straight to this page.)
3. Click the floating **Download my decks** button in the bottom-right corner (or click
   the toolbar icon again).
4. A progress panel appears with two stages:
   - **Discovering decks:** it pages through your deck list to build the full set of
     IDs, showing "list page N of X" and a running deck count.
   - **Downloading decks:** it fetches each deck, showing "deck Y of Z: {name}" and a
     progress bar, plus a running count of any that failed. You can **Pause/Resume** or
     **Cancel** at any point. If you cancel partway through, it offers to save the decks
     collected so far. When it finishes, `marvelcdb-decks-backup-YYYY-MM-DD.zip`
     downloads. An **Activity log** (collapsed by default) records any per-deck errors
     and server back-off notices.

## What's in the ZIP

Each deck is saved five different ways, plus a couple of files that index the whole
backup:

- `decks/{id}-{name}.json`: the complete **raw** deck object (cards, meta, tags,
  write-up) plus its full revision history (`history`: every saved version with its
  card list and timestamp). This is the source of truth, and every other format is
  generated from it.
- `decks/{id}-{name}.md`: YAML front-matter plus your Markdown write-up, for reading.
- `decks/{id}-{name}.txt`: plain-text decklist matching MarvelCDB's **Text** download.
- `decks/{id}-{name}.o8d`: **OCTGN** deck file matching MarvelCDB's OCTGN download.
- `decks/{id}-{name}.html`: a standalone, print-friendly page that reproduces the
  MarvelCDB deck view. Decklist on the left (grouped by type, with quantities and card
  **subtitles** so you can tell apart cards that share a name, like the two Spider-Man
  allies), notes on the right, plus the hero's nemesis "Hero set". Card names link to
  marvelcdb.com. It needs no styling or images, so you can print it and build the deck
  from paper. Card names come from MarvelCDB's public card database, fetched once per
  run.
- `index.html`: a browsable table of every deck in the backup, linking to each page.
  Open this first.
- `manifest.json`: a machine-readable index of every deck backed up.

That's everything MarvelCDB keeps for a personal deck. Re-run it any time, and it always
pulls a fresh, complete set.

## Security and privacy

Being careful about an extension you found online is fair, so here is exactly what this
one does and doesn't do:

- **It runs entirely on your own computer.** There's no server behind it and no account
  to sign up for. Your decks are read, converted, and saved to a ZIP right in your
  browser. Nothing is ever uploaded, and there's no tracking or analytics of any kind.
- **It never sees your password or login.** It doesn't ask you to sign in and it doesn't
  touch the MarvelCDB login form. It just relies on your browser already being logged
  in, the same way the site's own pages do. Your username, password, and session are
  never read, stored, or sent anywhere.
- **It only talks to marvelcdb.com.** Every request it makes goes to MarvelCDB and
  nowhere else, only to read your decks and the public card list. It contacts no other
  websites and no third parties.
- **It only reads, and only your own decks.** It never edits, deletes, or publishes
  anything on your account, and it can't see anyone else's private decks.
- **It stays asleep everywhere except your My Decks page.** The extension has no access
  to any site other than marvelcdb.com, and even there it only wakes up on your deck
  list. On every other page and every other website, it does nothing.
- **It has no outside code.** The whole thing is a handful of small, plain JavaScript
  files with zero third-party libraries, so there's no hidden dependency that could
  change under it. Because you loaded it from a folder you downloaded yourself, it also
  can't quietly update itself later.
- **You can read every line first.** All of the code is right here in this repository,
  it's small enough to skim, and nothing is minified or hidden.

When you add it, Chrome warns that the extension can "read and change your data on
marvelcdb.com." That's the permission that lets it read your deck pages in the first
place, and it's limited to marvelcdb.com. It only ever reads, and it never changes a
thing on your account.

## Gentle on MarvelCDB

The downloader is deliberately easy on the site. It fetches one deck at a time with a
short pause between each, slows down if the server ever asks it to, and only makes the
same kind of requests MarvelCDB's own pages already do. A few hundred decks take about 3
to 5 minutes, and there's nothing here that would strain the site.
