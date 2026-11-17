# Photobook

A web app that turns a year of Google Photos into print-ready photo book pages (JPEG pages or a PDF).

1. **Photos**: sign in with Google and choose photos in Google's own picker (HEIC is fine, since Google sends JPEG copies). Each photo keeps the date it was taken, and the book is always sorted by that date.
2. **Groups**: photos are grouped by the month they were taken. Rename groups, move boundaries ("← Previous group" / "Next group →"), start a new group anywhere, merge groups, exclude photos, and pick the cover photo.
3. **Design**: set the page size (presets or custom, mm or inches), bleed, margins, spacing and photos per page (default 7–10). Choose how group names appear, plus font and colours. Use **↻ Layout** on any page to try another arrangement.
4. **Download**, in one of two forms:
   - **JPEG pages (.zip)**: one 300 dpi image per page, bleed included, to upload as full-page layouts in a printer's own editor (e.g. MILK Books). Tick "Join facing pages into spreads" for lay-flat books that need spreads.
   - **PDF**: one file, every page at trim size plus bleed, for printers that take PDFs (e.g. Blurb).

Everything stays in your browser (IndexedDB). Nothing is uploaded anywhere except the requests to Google.

## Google setup (one time, about 10 minutes)

Google only lets an app read photos you pick, through the **Google Photos Picker API**. The app needs its own OAuth client ID:

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "Photobook").
2. **APIs & Services → Library** → search **Google Photos Picker API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name "Photobook", your email as support/developer contact.
   - **Data access / Scopes**: add `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
   - **Audience → Test users**: add your Google account (and anyone else who'll use it). Leave the app in **Testing**; no verification is needed for test users.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - **Authorized JavaScript origins**: `https://jdszwarga.github.io` and `http://localhost:5180`.
5. Copy the client ID (`….apps.googleusercontent.com`) into `js/config.js` as `GOOGLE_CLIENT_ID`, commit and push.

### If downloads are blocked

If importing fails with "The browser blocked the download from Google", Google isn't allowing direct browser downloads. Deploy `tools/proxy-worker.js` as a free Cloudflare Worker (instructions in the file) and set `PROXY_URL` in `js/config.js`. The worker only forwards requests to Google's photo host.

## Printing with Diamond Photo (best value, printed in NZ)

[Diamond Photo](https://diamondphoto.co.nz/pages/photobooks) prints in New Zealand and delivers in about 5 working days. In Nov 2026 the 28 × 28 cm Layflat Hardcover (Standard, 300 gsm satin) was $29.92 for 20 pages, or $14.96 with their 50% code, plus $2.01 per extra page (up to 90 pages). The extra pages aren't discounted.

1. In the app, pick the **Diamond Photo 28 × 28 cm (layflat)** size and download **JPEG pages** with spreads **off**.
2. In Diamond Photo's editor, start the 28 × 28 Layflat Hardcover and add enough pages.
3. Use a single-photo, full-page layout on each page and drop the images in, in order. Design the cover in their editor.

Diamond Photo doesn't publish bleed specs for its editor. The app's 12 mm margins keep photos well clear of the edge, so a small crop from their editor won't touch your photos. Check the preview before ordering.

## Printing with MILK Books

MILK accepts custom pages as JPEGs with 3 mm bleed at 300 dpi ([their spec](https://support.milkbooks.com/knowledge/uploading)). The app has MILK size presets that match their upload sizes (e.g. Premium Large Square exports at 285.4 × 285.4 mm).

- **Premium (lay-flat) books** want facing pages uploaded as one spread, so tick "Join facing pages into spreads". Only the first and last pages are single.
- **Classic and Softcover books** take single pages only, so leave spreads off.
- MILK designs the cover in its own editor, so you may want to turn off "Cover page with photo".
- In MILK's Design Studio, choose a full-bleed single-photo layout for each page (or spread) and drop the images in order.

## Printing notes

- The PDF page size is **trim + bleed on every side** (e.g. 300 × 300 mm with 3 mm bleed gives 306 × 306 mm pages). Check your printer's spec for bleed and size.
- Photos sit inside the margin, so only the background colour runs into the bleed.
- "Even number of pages" adds a blank page at the end if needed. Some printers need a multiple of 4 or a minimum page count.
- Cover: the first page is a cover with your chosen photo. If your printer wants the cover as a separate file, turn the cover off.

## Development

```bash
node tools/serve.mjs 5180
```

Then open <http://localhost:5180>. "Add from this computer" (JPEG/PNG, dated from EXIF) is there for testing without Google.

Files: `js/google.js` (Picker API), `js/layout.js` (grouping and page layouts), `js/pdf.js` (export, using the vendored `js/vendor/pdf-lib.min.js`), `js/app.js` (UI), `js/store.js` (IndexedDB).
