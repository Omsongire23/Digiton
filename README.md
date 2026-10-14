# Digiton: Digital Image Forensics Tool

A browser-based forensic image triage tool for educational and preliminary examination of digital images. **All analysis runs entirely in your browser — no images are sent to any server.**

![Tool Screenshot](assets/logo.svg)

---

## Features

| Feature | Details |
|---|---|
| **EXIF Metadata** | Extracts all available tags grouped by category; searchable and filterable; per-row copy |
| **SHA-256 Hash** | Computed from the exact uploaded bytes using Web Crypto; reference-hash comparison with auto-normalization |
| **ELA Visualization** | High-performance Error Level Analysis with adjustable quality (50–100) and amplification (1–40); side-by-side and single-image views |
| **Overall Result** | Neutral rule-based verdict (no-notable-indicators / review-suggested / incomplete) — never claims authenticity or tampering |
| **PDF Report** | 11-section A4 report with thumbnail, ELA image, all stats, limitations, and page numbers |
| **JSON Report** | Machine-readable structured export with schema version |

---

## Important Limitations

> ELA and metadata are investigative indicators, **not proof** of authenticity or manipulation.
> - ELA differences can have innocent causes: compression, resizing, re-saving, texture.
> - Missing EXIF metadata is common for screenshots and web images — it is not evidence of tampering.
> - SHA-256 verifies byte-level consistency against a known baseline only; it does not establish the image's origin or history.
> - ELA values differ between browser engines and tools like Pillow — compare regions **within the same image**.
> - Verdict thresholds are heuristics, not scientifically validated cutoffs.

---

## Local Development

### Option A — Python (no npm required)
```bash
cd /home/om/Downloads/Digital_Image_Forensics_Mini_Project
python3 -m http.server 5500
```
Open **http://localhost:5500**

### Option B — npm script
```bash
npm start
```
Open **http://localhost:8080**

### Option C — Any static file server
The site is a single `index.html` with no build step. Serve the repo root directory with any static server.

> **Note:** SHA-256 requires a **secure context** (HTTPS or localhost). It will not work when opened via `file://` directly.

---

## Project Structure

```
/
├── index.html                 # Main application HTML
├── css/
│   ├── tokens.css             # Design tokens (colors, spacing, radii)
│   ├── base.css               # Reset, typography, utilities, focus styles
│   ├── layout.css             # Header, main grid, sidebar, footer, responsive
│   └── components.css         # Buttons, cards, tabs, tables, badges, dropzone, toasts
├── js/
│   ├── main.js                # Bootstrap, analysis pipeline, upload/reset wiring
│   ├── state.js               # Single app-state object + subscribe/dispatch
│   ├── ui.js                  # All DOM rendering (tabs, evidence strip, panels, sidebar)
│   ├── upload.js              # File input, drag-and-drop, magic-byte validation
│   ├── imageInfo.js           # Format, dimensions, color mode, alpha detection
│   ├── metadata.js            # EXIF extraction and normalization via exifr
│   ├── hash.js                # SHA-256 + reference-hash comparison
│   ├── ela.js                 # ELA algorithm, statistics, hot-region detection
│   ├── verdict.js             # Neutral rule-based overall result
│   ├── reportPdf.js           # 11-section PDF generation via jsPDF
│   ├── reportJson.js          # JSON report generation
│   └── utils.js               # formatBytes, escapeHtml, copyToClipboard, debounce, download
├── vendor/
│   ├── exifr.umd.js           # EXIF extraction library (vendored, no CDN)
│   ├── jspdf.umd.min.js       # PDF generation library (vendored, no CDN)
│   └── VERSIONS.md            # Exact vendored versions
├── assets/
│   └── logo.svg               # Application logo (inline SVG)
├── vercel.json                # Vercel static deployment config + security headers
├── package.json               # Dev-only (local server script)
└── CLAUDE.md / claude.md      # Project context and build specification
```

---

## How Each Analysis Works

### Metadata extraction
Uses [exifr](https://github.com/MikeKovarik/exifr) v7.1.3 (vendored locally). Tags are grouped by section (Image, Camera/Exposure, GPS, etc.), normalized, and displayed in a searchable table. Binary blobs are shown as `[binary, N bytes]`.

### SHA-256 integrity
Uses `crypto.subtle.digest('SHA-256', arrayBuffer)` from the Web Crypto API on the **exact bytes of the uploaded file** — never a converted or recompressed copy. Reference hashes are normalized (trim whitespace, strip `sha256:` prefix, lowercase) before comparison.

### Error Level Analysis (ELA)
1. Draw the working copy onto an `OffscreenCanvas` (downscaled to ≤ 2048 px longest side if needed; alpha composited over white for PNG/WebP).
2. Re-encode to JPEG at the selected quality using `canvas.convertToBlob`.
3. Decode the re-encoded JPEG and draw it to a second canvas.
4. Compute per-pixel channel differences, amplify, and write to an output canvas.
5. Compute statistics: mean, 95th percentile, max, % above threshold (≥ 12), and the hottest 8×8 grid cell.

**Overall result thresholds (heuristics — not scientific cutoffs):**
- `review-suggested` if: `regionRatio ≥ 2.5` AND `hotRegion.mean ≥ 8`, OR `pctAboveThreshold ≥ 20%`, OR reference hash provided and mismatched.
- Otherwise `no-notable-indicators`.

---

## Privacy

- All image processing happens in your browser.
- No image data, metadata, or hashes are sent to any server.
- GPS coordinates are masked in the UI by default and excluded from reports unless you explicitly enable the GPS option.
- Nothing is stored between sessions.

---

## Vercel Deployment

This is a **static site** — no build step, no server functions.

1. Push the repository to GitHub (ensure `index.html`, `css/`, `js/`, `vendor/`, `assets/`, and `vercel.json` are at the repo root).
2. In Vercel: **Add New → Project → Import** the repository.
3. **Framework Preset:** Other. Leave Build Command and Output Directory **empty**.
4. Click **Deploy**.
5. Post-deploy smoke test: upload a JPEG, confirm hash, ELA, and tab navigation work, and download the PDF and JSON reports.

> Note: `script-src 'unsafe-eval'` is required by jsPDF (internal use of `new Function`). This is noted in `vercel.json`.

---

## Streamlit Version

The original Python/Streamlit implementation is preserved in `digital_image_forensics_tool/`. Run it with:

```bash
cd digital_image_forensics_tool
source ../.venv/bin/activate
streamlit run app.py
```
Open http://localhost:8501
