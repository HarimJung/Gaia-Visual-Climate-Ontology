# Independent .docx fixture writer (WP-08, R10 proof). Deliberately shares
# NOTHING with the production zip writer in engine/author/docx.mjs: Python's
# zipfile builds the archive, so a bug mirrored between our reader and writer
# cannot hide. Reads a JSON spec on stdin:
#   { "out": "<path>", "paragraphs": ["...", ...],
#     "chunk": 5,            # optional: split each paragraph's text into runs
#                            # of this many characters (Word fragments runs
#                            # arbitrarily; the parser must not care)
#     "no_rels": false }     # optional: omit word/_rels/document.xml.rels
import json
import sys
import zipfile
from xml.sax.saxutils import escape

spec = json.load(sys.stdin)
chunk = spec.get("chunk", 0)

def runs(text):
    pieces = [text[i : i + chunk] for i in range(0, len(text), chunk)] if chunk > 0 else [text]
    return "".join(
        '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % escape(p) for p in pieces
    )

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
body = "".join("<w:p>%s</w:p>" % runs(p) for p in spec["paragraphs"])
document = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<w:document xmlns:w="%s"><w:body>%s</w:body></w:document>' % (W, body)
)
content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
root_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/></Relationships>'
)
doc_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    "</Relationships>"
)

with zipfile.ZipFile(spec["out"], "w", zipfile.ZIP_DEFLATED) as z:
    def put(name, data):
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)

    put("[Content_Types].xml", content_types)
    put("_rels/.rels", root_rels)
    put("word/document.xml", document)
    if not spec.get("no_rels", False):
        put("word/_rels/document.xml.rels", doc_rels)
print("ok")
