# Content

The settled DOM extractor produces a versioned local snapshot (R7.1, R7.4).
It reads the page that capture already opened. It does not crawl or navigate.
Capture stores the snapshot as gzip JSON. Comparison bounds decoded JSON to 2 MiB.
The local report gets a decoded JSON copy.
The snapshot holds title, declared language, text, headings, images and same-origin links.
Each list has a limit of 1000 items. Text has a limit of 100000 characters.
The snapshot records omissions. Checks report incomplete evidence.
The extractor does not detect language. An empty alt attribute can mark a decorative image.
Internal link checks use explicit stored final responses. An unmeasured link is unknown.
No check runs by default. Snapshot retention stays undecided.
