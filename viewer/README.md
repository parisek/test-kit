# Report viewer

Requirements: R10.1–R10.10, R11.6.

Serve `index.html`, `app.js`, and `style.css` under `/viewer/`.
Serve the shared pure modules under `/src/report/`.
The initial report is `/report.json`. The source form accepts same-origin URLs.
Artifact paths resolve from the selected report URL. The server owns mappings.

The viewer uses the shared adapter and classifier. It shows measurement state,
site availability, and class separately. Unknown noise floor remains explicit.
It supports detail, matrix, findings by cause, and stored run provenance.
The viewer does not write causes or known differences.

Every state change uses `dispatch`. Report text uses text nodes. Artifact URLs
stay on the report origin. Storage failure does not stop rendering.
Browser integration and visual QA run explicitly outside `npm test`.
