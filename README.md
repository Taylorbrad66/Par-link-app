# ParLink Golf

Live app: https://parlink-web-install.vercel.app/

## Current version: V1.5.0

V1.5.0 upgrades the V1.4.1 round-finish repair and keeps the same live address and saved-data key. No reset or data migration is required.

- **Real rounds and demo are separate.** Play golf uses your saved, activated courses. Try demo opens the example course. Real courses can be added or imported; location does not download course data.
- **Clearer scoring.** Larger score controls distinguish an unentered score from par. Finish round checks all 18 holes and returns to any skipped hole without inventing a score.
- **Round recovery.** A resume card, a second local recovery copy and visible save status help protect progress. A failed finish keeps the active round available for retry. Unreadable data opens a recovery screen instead of overwriting it.
- **Backup and restore.** Download a JSON backup and restore it on another browser or device. Restore validates the file and asks before replacing current device data.
- **Offline reopening.** A service worker caches the app shell after a successful online visit. Wait for “Offline reopening ready” before relying on it. Updates wait for an explicit Apply update action between rounds.
- **Course and GPS checks.** Course editing includes tee details, ratings, stroke-index validation and optional green-centre coordinates. GPS distance requires a fresh, sufficiently accurate reading and is suppressed beyond 2 km. Real-round Caddie does not substitute the demo distance when reliable yardage is unavailable.

The V1.4.1 fix remains included: completed-round cards use `playerIds`, with legacy fallbacks, and repeated finish actions are ignored. Existing scores, courses, profiles and club distances continue to use `parlink.v1`.

## Files to update

Keep these files at the top level of the repository:

- `index.html`: the current app HTML, styles and JavaScript.
- `sw.js`: versioned offline shell and update handling.
- `manifest.webmanifest` and `icon.svg`: installation metadata and icon.
- `index-15.html`: redirect for old bookmarks, preserving query strings and fragments.
- `parlink-regression.cjs`: automated regression checks.

The older `index.html.` file and V1.2 ZIP are legacy copies, not the current homepage. Uploading a ZIP only stores the ZIP; it does not replace the app files.

## Update through GitHub

1. Update the app and related assets together. For a new release, change the version displayed by the app and the service-worker cache name together.
2. Run `node --test parlink-regression.cjs` and review the changes. Use a separate branch and preview first for larger changes.
3. Commit to `main` to publish through the connected Vercel project, `parlink-web-install`.
4. Wait for Vercel to report the deployment as **Ready**, then open the main app address and check the new version and round flow.
5. Existing V1.5+ installations show **Apply update** when a replacement worker is ready. Finish the current round and apply the update from the app.

Use the main address for bookmarks and home-screen shortcuts. Reload to check an update. Do not use Reset app or clear website data to force an update.

## Saved golf data and limits

Data is stored locally in the browser/device under `parlink.v1`, with a recovery copy under `parlink.v1.backup`. Both copies share the browser's storage limits and can be removed by clearing site data. Download a backup for a separate copy or to transfer between devices. There is no cloud account or automatic multi-phone synchronization.

Course scorecards and mappings must be added or imported. GPS shows distance to the saved green centre, not the current pin position. Course data and phone GPS accuracy still need an on-course check. ParLink handicap is an app estimate, not an official handicap service.

## Validation

Run `node --test parlink-regression.cjs` with Node.js 18 or later.

The 35 checks cover all three scoring formats with one and four players, 18-hole completion, share/Home/Stats rendering, reloads, legacy saved rounds, duplicate finish, missing scores, resume and course snapshots, primary/backup recovery, failed storage writes, backup restore, course validation, GPS safeguards and cached offline navigation. They execute the app source with synthetic DOM, storage and location inputs; they do not establish real-phone GPS accuracy or airplane-mode behavior.
