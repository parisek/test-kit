# Specification (fixture)

- R5.1 A render uses the project's Twig environment and the project's `iframe.css`, `iframe.js` and fonts. The package does not change component markup.
- R6.1 `/api/components`, `/api/pages`, `/api/docs` and `/api/fields` return bare arrays. Their shapes are `@api`. A new field is optional and non-breaking. A removed or renamed field is a major change.
