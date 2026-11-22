# CapCut Play Store metadata

This repository publishes a small public `capcut.json` record for the homepage and Download page at capcutmod.win. It reads CapCut's public US/English Play Store listing for package `com.lemon.lvoverseas` with the pinned `google-play-scraper` dependency.

The automation updates display information only. It does not upload, replace, inspect or download the hosted APK. Both website download buttons retain their existing APK link. The second button's version is a visual history label.

## Local commands

Use Node.js 22 or later:

```sh
npm ci --ignore-scripts
npm test
npm run update
```

`npm run update` validates the current public version and update timestamp, then atomically replaces `capcut.json`. Failed requests, missing/device-dependent versions, malformed dates, source version downgrades and damaged existing JSON fail the run without overwriting the last valid data.

## Published data

- `current.version`: latest valid version observed from the configured listing.
- `current.updatedDate`: the listing's update timestamp converted to a UTC calendar date, in `YYYY-MM-DD` format. The website should format this as a date without shifting it into another time zone.
- `previous`: the complete prior current record, shifted only when a numerically newer version is observed.
- `currentOrigin` and `previousOrigin`: identify values observed from Play Store and the initial website migration seed.
- `checkedAt`: the successful validation time associated with the published record. Unchanged successful checks are logged in Actions and do not create new JSON commits or alter this timestamp.

The initial migration seed is the pre-existing website's displayed version **16.9.0**, dated **2026-03-05**. Its origin is explicitly `existing-website`; it is not presented as verified Play Store history. After the first newer Play Store result, that seed becomes the previous visual version. Later previous values are versions actually observed by this automation. The workflow can miss intermediate releases between scheduled checks, so this is observed history, not a complete release archive.

Play Store's public page format and regional availability can change. The fetcher intentionally retains last-good metadata instead of publishing an unknown version. A real Play Store rollback requires an intentional manual correction to the saved baseline before the guard permits it.

Only public application information belongs in this file. No GitHub credentials or other secrets are needed by visitors reading it.
