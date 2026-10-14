# Digiton: Digital Image Forensics Tool

A comprehensive, client-side digital image forensics and triage application designed for educational and preliminary investigation of digital images. **Digiton** executes all forensic analyses 100% in-browser using modern Web APIs — ensuring complete privacy with zero server uploads or external network requests.

The project also includes a companion Python/Streamlit implementation for local CLI and workstation analysis workflows.

---

## 1. System Architecture

Digiton is architected around a **pure unidirectional data flow** and a **parallel asynchronous pipeline**. All UI components render strictly from an immutable central state store, and all compute-intensive forensic tasks run concurrently.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Uploaded Image                                 │
│                   (Magic Byte Validation: JPEG/PNG/WebP)                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────────────┐             ┌───────────────────────────────┐
│     Shared ArrayBuffer        │             │   Native ImageBitmap Decode   │
│   (Single zero-copy read)     │             │  (Hardware-accelerated async) │
└───────┬───────────────┬───────┘             └───────────────┬───────────────┘
        │               │                                     │
        ▼               ▼                                     ▼
┌──────────────┐ ┌──────────────┐                     ┌───────────────┐
│  Web Crypto  │ │ EXIF Parser  │                     │  Image Info   │
│   SHA-256    │ │   (exifr)    │                     │  & Alpha Test │
└───────┬──────┘ └──────┬───────┘                     └───────┬───────┘
        │               │                                     │
        │               │                     ┌───────────────┴───────────────┐
        │               │                     ▼                               │
        │               │         ┌───────────────────────────────┐           │
        │               │         │   High-Speed ELA Engine       │           │
        │               │         │  - JPEG Recompression Canvas  │           │
        │               │         │  - Vectorized Diff & Amplify  │           │
        │               │         │  - 8x8 Grid Hot-Region & p95  │           │
        │               │         └───────────────┬───────────────┘           │
        │               │                         │                           │
        └───────────────┼─────────────────────────┘                           │
                        │                                                     │
                        ▼                                                     ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │                 Central State Store (`state.js`)                   │
        │           Protected with Stale-Run Invalidation (`runId`)           │
        └──────────────────────────────────┬──────────────────────────────────┘
                                           │
                                           ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │                    Neutral Rule-Based Verdict                       │
        │                   (`computeVerdict()` in verdict.js)                │
        └──────────────────────────────────┬──────────────────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
        ┌───────────────────────────────┐     ┌───────────────────────────────┐
        │     Accessible Tabbed UI      │     │       Export Engines          │
        │  Overview • Metadata • Hash   │     │  • 11-Section PDF (jsPDF)     │
        │       ELA • Full Report       │     │  • Structured JSON Data       │
        └───────────────────────────────┘     └───────────────────────────────┘
```

### Unidirectional State Architecture
- **Single State Object (`state.js`):** Centralized state drives all views. UI never stores or scrapes forensic findings from the DOM.
- **Stale-Result Protection (`runId`):** Every upload or reset increments `runId`. All asynchronous tasks verify their captured `myRun` against current `state.runId` before committing, preventing race conditions.
- **Recompression Caching:** ELA recompression buffers are cached in memory. Adjusting the amplification slider skips JPEG re-encoding and re-renders in **~25ms**.

---

## 2. Key Forensic Features

| Module | Technical Implementation | Forensic Output |
|---|---|---|
| **File Validation** | Magic bytes inspection (`upload.js`) | Rejects non-images (20 MB limit); flags MIME/extension mismatches |
| **Image Properties** | Decoded `ImageBitmap` + Alpha sampling (`imageInfo.js`) | Dimensions, format, color space, alpha channel detection |
| **EXIF Metadata** | Vendored `exifr` v7.1.3 (`metadata.js`) | Categorized tags (Camera, Exposure, GPS, etc.), searchable & filterable table |
| **GPS Handling** | Masked coordinate parser with privacy toggle | Coordinates masked by default; excluded from reports unless opted in |
| **Integrity (SHA-256)** | `crypto.subtle.digest` on exact original bytes (`hash.js`) | 64-character hex hash, timestamp, auto-normalizing baseline comparison |
| **Error Level Analysis** | Dynamic JPEG re-encode + difference amplification (`ela.js`) | ELA visual overlay, mean error, 95th percentile, max error, 8×8 hot region |
| **Neutral Verdict** | Deterministic multi-factor heuristic engine (`verdict.js`) | Objective indicator summary — never claims "authentic" or "tampered" |
| **Forensic PDF Report** | Client-side jsPDF generator (`reportPdf.js`) | Formal 11-section PDF with embedded images, checksums, and disclaimer |
| **Machine-Readable JSON** | Standardized JSON schema export (`reportJson.js`) | Complete forensic dump for chain of custody and external tools |

---

## 3. Repository Structure

```text
Digital_Image_Forensics_Mini_Project/
├── index.html                           # Accessible HTML5 Single Page Application
├── css/
│   ├── tokens.css                       # Design tokens (dark palette, HSL, spacing, typography)
│   ├── base.css                         # Reset, focus rings, base typography, animations
│   ├── layout.css                       # Header, evidence strip, 2-column workspace, responsive
│   └── components.css                   # Buttons, cards, tabs, dropzone, tables, badges, toasts
├── js/
│   ├── main.js                          # Bootstrap, parallel analysis pipeline, event orchestration
│   ├── state.js                         # Central reactive state object & runId management
│   ├── ui.js                            # Modular DOM rendering, ARIA live regions, tabs, sidebar
│   ├── upload.js                        # Drag-and-drop, file picking, magic-byte validation
│   ├── imageInfo.js                     # Dimensions, natural resolution, color mode, alpha scan
│   ├── metadata.js                      # EXIF extraction & tag normalization via exifr
│   ├── hash.js                          # Web Crypto SHA-256 & reference hash normalization
│   ├── ela.js                           # High-performance ELA engine with recompression cache
│   ├── verdict.js                       # Neutral rule-based overall assessment engine
│   ├── reportPdf.js                     # 11-section A4 forensic PDF generator (jsPDF)
│   ├── reportJson.js                    # Standardized JSON export generator
│   └── utils.js                         # Formatting, clipboard, debounce, and download helpers
├── vendor/
│   ├── exifr.umd.js                     # Vendored EXIF parser (v7.1.3, zero runtime CDN)
│   ├── jspdf.umd.min.js                 # Vendored PDF generator (v2.5.1, zero runtime CDN)
│   └── VERSIONS.md                      # Vendor dependency audit & licenses
├── assets/
│   └── logo.svg                         # Vector branding icon
├── vercel.json                          # Static deployment configuration & CSP security headers
├── package.json                         # Project metadata & local development scripts
├── digital_image_forensics_tool/        # Companion Python/Streamlit version
│   ├── app.py                           # Streamlit forensics dashboard
│   ├── requirements.txt                 # Python dependencies (Pillow, reportlab, streamlit)
│   └── College_Project_Report.docx      # Academic report documentation
└── README.md                            # Primary project documentation
```

---

## 4. Setup & Execution

### Option A: Web Application (Recommended — Fastest)
The web application runs 100% client-side with no build step required.

```bash
# Navigate to the workspace root
cd /home/om/Downloads/Digital_Image_Forensics_Mini_Project

# Start the local server
python3 -m http.server 5500
```
Open **[http://localhost:5500](http://localhost:5500)** in any modern browser (Chrome, Firefox, Safari, Edge).

*(Note: A secure context like `http://localhost` or `https://` is required for the Web Crypto SHA-256 API to function).*

### Option B: Python / Streamlit Application
For running the standalone Python desktop-triage tool:

```bash
cd /home/om/Downloads/Digital_Image_Forensics_Mini_Project/digital_image_forensics_tool

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate       # On Windows: .venv\Scripts\activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Run the Streamlit dashboard
streamlit run app.py
```
Open the local URL printed in your terminal (typically **http://localhost:8501**).

---

## 5. Forensic Principles & Limitations

1. **Investigative Indicators, Not Conclusive Proof:**
   - ELA highlights compression variance across 8×8 discrete cosine transform (DCT) grids. High-frequency textures, sharp edges, text overlays, and multi-generation saves naturally exhibit elevated error levels without malicious intent.
2. **Metadata Volatility:**
   - EXIF metadata is easily stripped or sanitized by social media networks and messaging apps. The absence of metadata is normal and must not be used as evidence of tampering.
3. **Cryptographic Baseline:**
   - SHA-256 verifies exact byte-for-byte consistency against a recorded baseline. A match proves the file has not altered since hashing; it does not prove the original image was never altered before the hash was taken.
4. **Engine Calibration:**
   - Browser JPEG encoders (Chromium Skia / Gecko / WebKit) implement subtle variations in quantization tables. Always compare regions **within the same analyzed image** rather than comparing raw numbers across different software packages.

---

## 6. Suggested Verification Test Cases

| Test Case | Expected Forensic Indicator |
|---|---|
| **Original Camera JPEG** | Consistent ELA noise floor across uniform surfaces; rich EXIF camera make/model/shutter tags |
| **Resaved JPEG (Photo Editor)** | Altered quantization noise; potential software signature in `Image.Software` EXIF tag |
| **PNG/WebP Graphic or Screenshot** | Converted to JPEG working copy for ELA; missing EXIF; alpha compositing noted |
| **Spliced / Composite Image** | Divergent ELA error brightness between foreign inserted patch and background |
| **SHA-256 Known Vector** | ASCII bytes `abc` produce `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |

---

## 7. Evidence Handling & Chain of Custody

- Always preserve master original files on write-blocked or read-only storage.
- Calculate cryptographic hashes immediately upon acquiring evidence.
- Perform all forensic triage and ELA operations exclusively on working copies.
- Archive the downloaded PDF and JSON forensic reports together with the original files.
