# ParLink Golf

Live app: https://parlink-web-install.vercel.app/

## Which file to update

**`index.html` is the app.** It contains the current V1.4.1 HTML, styles and JavaScript.

Keep that exact filename, in the top level of this repository. Do not add a version number, an extra full stop or an enclosing folder. Uploading a ZIP only stores that ZIP; it does not replace the app files.

`index-15.html` redirects existing bookmarks to the main address, so those links receive future updates too. The older `index.html.` file and V1.2 ZIP are legacy copies, not the current homepage.

## Update through GitHub

1. Open `index.html` and choose **Edit this file**, or use **Add file → Upload files** to replace it with an updated file named exactly `index.html`.
2. Review the changes. Save a clear commit message explaining the update.
3. Commit to `main` to publish through the connected Vercel project, `parlink-web-install`. Use a separate branch and preview first for larger changes.
4. Wait for Vercel to report the new deployment as **Ready**, then open the main app address and check the update.

Use the main app address for bookmarks and home-screen shortcuts.

## Saved golf data

The app uses browser local storage under `parlink.v1`. This homepage repair keeps the same domain and storage key. Saved data belongs to that browser/device; it is not automatically transferred between browsers or devices.

Reload the page to check an update. Do not use **Reset app** or clear website data to force an update, because those actions can remove saved rounds and settings.

## Current repair

V1.4.1 fixes a crash when finishing a round and when reopening the app afterwards. The completed-round card read `players.length`, but saved rounds use `playerIds`. Home and Stats now read the correct field, with fallbacks for older saved shapes. Existing scores, courses, profiles and the `parlink.v1` storage key are preserved; no reset or data migration is needed. Repeated finish actions after a round is saved are ignored.

Regression checks cover all three formats with one and four players, the round-complete/share screen, Home and Stats, reloads with previously saved V1.4 rounds, participant-count fallbacks, duplicate finishes and an incomplete final hole.

## Previous homepage and GPS repair

The main address returned HTTP 404 because the repository had no `index.html`. The repair makes the V1.4 app the homepage and redirects the old V1.4 address to it, preserving query strings and fragments.

Two GPS/Caddie corrections are included:

- Missing, blank, non-numeric or out-of-range green coordinates are excluded from course-centre and distance calculations. Valid zero coordinates remain supported.
- A zero-metre target stays at zero instead of becoming the 135-metre example. The GPS label remains accurate, and Caddie does not suggest a carry club at zero metres. The labelled example remains available when no GPS/green distance exists.

The storage key remains `parlink.v1`. Real-device GPS accuracy and course data still need on-course validation.

## Regression checks

Run `node --test parlink-regression.cjs` with Node.js 18 or later. These checks exercise the app source with synthetic browser and location inputs; they do not establish real-device GPS accuracy.


