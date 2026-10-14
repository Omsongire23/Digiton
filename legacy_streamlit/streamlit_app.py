import io
import json
import hashlib
import datetime as dt
from pathlib import Path

import streamlit as st
from PIL import Image, ExifTags, ImageChops, ImageEnhance, UnidentifiedImageError
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle

st.set_page_config(page_title="Digital Image Forensics", page_icon="🔎", layout="wide")

st.title("🔎 Digital Image Forensics Tool")
st.caption("Educational forensic triage: metadata, SHA-256 integrity hashing, and JPEG Error Level Analysis (ELA).")
st.warning(
    "Interpretation note: ELA and metadata can reveal indicators worth investigating, but cannot prove that an image is authentic or manipulated. "
    "Work on copies and preserve original evidence using your institution's approved procedures."
)

MAX_UPLOAD_MB = 25
uploaded = st.file_uploader(
    "Upload an image (JPG, JPEG, PNG, TIFF, BMP, or WEBP)",
    type=["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp"],
    help=f"Maximum upload size: {MAX_UPLOAD_MB} MB."
)

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def safe_image(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image

def extract_metadata(image: Image.Image, data: bytes) -> dict:
    info = {
        "Format": image.format or "Unknown",
        "Width": image.width,
        "Height": image.height,
        "Color mode": image.mode,
        "File size (bytes)": len(data),
        "File size (KiB)": round(len(data) / 1024, 2),
        "EXIF fields found": 0,
    }
    exif_out = {}
    try:
        exif = image.getexif()
        for tag_id, value in exif.items():
            tag = ExifTags.TAGS.get(tag_id, str(tag_id))
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            elif isinstance(value, (tuple, list)):
                value = ", ".join(map(str, value))
            else:
                value = str(value)
            # Keep reports readable and avoid dumping very large values.
            exif_out[tag] = value[:500]
    except Exception as exc:
        exif_out["EXIF read note"] = f"Could not read EXIF: {exc}"
    info["EXIF fields found"] = len(exif_out)
    return info, exif_out

def make_ela(data: bytes, quality: int = 90, scale: int = 15):
    """Return original RGB image, ELA visualization, and note.
    ELA is meaningful mainly for JPEGs; non-JPEG images are converted for a limited demonstration.
    """
    original = safe_image(data).convert("RGB")
    source_format = Image.open(io.BytesIO(data)).format
    buffer = io.BytesIO()
    original.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    recompressed = Image.open(buffer).convert("RGB")
    diff = ImageChops.difference(original, recompressed)
    ela = ImageEnhance.Brightness(diff).enhance(scale)
    note = (
        "Input is JPEG; ELA compares the supplied image with a recompressed JPEG."
        if source_format == "JPEG"
        else f"Input format is {source_format or 'unknown'}; it was converted to JPEG for comparison. "
             "Results are less interpretable than for a JPEG workflow."
    )
    return original, ela, note

def build_pdf(report: dict, ela_png: bytes | None = None) -> bytes:
    out = io.BytesIO()
    doc = SimpleDocTemplate(
        out, pagesize=A4, rightMargin=18*mm, leftMargin=18*mm,
        topMargin=16*mm, bottomMargin=16*mm
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Digital Image Forensics Report", styles["Title"]),
        Spacer(1, 4*mm),
        Paragraph(f"Generated: {report['generated_at']}", styles["Normal"]),
        Paragraph("Purpose: preliminary technical examination of a supplied image.", styles["Normal"]),
        Spacer(1, 5*mm),
        Paragraph("1. Evidence summary", styles["Heading2"]),
    ]
    summary_rows = [["Property", "Value"]] + [[str(k), str(v)] for k, v in report["summary"].items()]
    table = Table(summary_rows, colWidths=[55*mm, 105*mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#183153")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("GRID", (0,0), (-1,-1), 0.35, colors.grey),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story.extend([table, Spacer(1, 5*mm), Paragraph("2. EXIF metadata", styles["Heading2"])])
    if report["exif"]:
        exif_rows = [["Tag", "Value"]] + [[str(k), str(v)] for k, v in report["exif"].items()]
        exif_table = Table(exif_rows, colWidths=[55*mm, 105*mm], repeatRows=1)
        exif_table.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#e8eef5")),
            ("GRID", (0,0), (-1,-1), 0.3, colors.grey),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING", (0,0), (-1,-1), 5),
            ("RIGHTPADDING", (0,0), (-1,-1), 5),
            ("TOPPADDING", (0,0), (-1,-1), 4),
            ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ]))
        story.append(exif_table)
    else:
        story.append(Paragraph("No EXIF metadata was found or could be read.", styles["Normal"]))
    story.extend([
        Spacer(1, 5*mm),
        Paragraph("3. ELA review", styles["Heading2"]),
        Paragraph(report["ela_note"], styles["Normal"]),
    ])
    if ela_png:
        image_buf = io.BytesIO(ela_png)
        story.extend([Spacer(1, 3*mm), RLImage(image_buf, width=150*mm, height=95*mm, kind="proportional")])
    story.extend([
        Spacer(1, 5*mm),
        Paragraph("4. SHA-256", styles["Heading2"]),
        Paragraph(report["sha256"], styles["Code"]),
        Spacer(1, 4*mm),
        Paragraph("5. Limitations and handling", styles["Heading2"]),
        Paragraph(
            "SHA-256 identifies this exact byte sequence and can help verify that it has not changed since hashing. "
            "It does not establish who created the image or whether it was edited before acquisition. "
            "ELA highlights compression differences and can produce false positives or false negatives. "
            "Metadata may be absent, inaccurate, or modified. Treat all findings as leads for further examination, "
            "not standalone proof. Record acquisition details and preserve the original file.",
            styles["BodyText"]
        ),
    ])
    doc.build(story)
    return out.getvalue()

if uploaded:
    data = uploaded.getvalue()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        st.error(f"File exceeds {MAX_UPLOAD_MB} MB. Please upload a smaller image.")
        st.stop()
    try:
        image = safe_image(data)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        st.error(f"Could not open this image: {exc}")
        st.stop()

    summary, exif = extract_metadata(image, data)
    digest = sha256_bytes(data)
    original, ela, ela_note = make_ela(data)
    ela_buffer = io.BytesIO()
    ela.save(ela_buffer, format="PNG")
    ela_png = ela_buffer.getvalue()

    left, right = st.columns(2)
    with left:
        st.subheader("Original image")
        st.image(original, use_container_width=True)
    with right:
        st.subheader("ELA visualization")
        st.image(ela, use_container_width=True)
        st.caption(ela_note)

    st.subheader("Evidence summary")
    st.dataframe([{"Property": k, "Value": v} for k, v in summary.items()], use_container_width=True, hide_index=True)
    st.subheader("SHA-256 file hash")
    st.code(digest)
    st.caption("Save this value at acquisition. Re-hash the same file later to check byte-for-byte integrity.")

    st.subheader("EXIF metadata")
    if exif:
        st.dataframe([{"Tag": k, "Value": v} for k, v in exif.items()], use_container_width=True, hide_index=True)
    else:
        st.info("No EXIF metadata found. This is common for screenshots, edited images, and images shared through some platforms.")

    report_data = {
        "generated_at": dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z"),
        "summary": summary,
        "exif": exif,
        "sha256": digest,
        "ela_note": ela_note,
    }
    try:
        pdf_bytes = build_pdf(report_data, ela_png)
        st.download_button(
            "📄 Download forensic report (PDF)",
            data=pdf_bytes,
            file_name="digital_image_forensics_report.pdf",
            mime="application/pdf",
            use_container_width=True,
        )
    except Exception as exc:
        st.error(f"PDF generation failed: {exc}")

    with st.expander("Download machine-readable JSON results"):
        json_data = {
            **report_data,
            "sha256": digest,
            "analysis_notice": "Indicators only; not a definitive authenticity determination."
        }
        st.download_button(
            "Download JSON",
            data=json.dumps(json_data, indent=2, ensure_ascii=False).encode("utf-8"),
            file_name="digital_image_forensics_results.json",
            mime="application/json",
        )
else:
    st.info("Upload an image to begin analysis.")
    st.markdown("""
    **Current capabilities**
    - EXIF and basic image metadata extraction
    - SHA-256 hash calculation
    - JPEG Error Level Analysis (ELA) visualization
    - PDF and JSON report export

    **Not included in this prototype:** automated copy-move forgery detection, source attribution, or a definitive AI-based authenticity verdict.
    """)
