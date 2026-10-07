// The view registry. Order here is the order of the switch. A view is a module with this default export:
//
//   { id, label, enabled, reason?,          // `reason` explains a disabled view in its tooltip
//     rail(ctx)  -> Node,                   // rail body below the brand
//     main(ctx)  -> Node,                   // content below the pair bar and the note
//     keys?(ctx, event) -> boolean }        // optional, return true when the key was handled
//
// ctx = { state, report, actions, known, summary }  (see js/app.js). Views read, they never write state.
import targets from './targets.js';
import matrix from './matrix.js';
import findings from './findings.js';
import timeline from './timeline.js';

export const VIEWS = [targets, matrix, findings, timeline];
export const viewById = (id) => VIEWS.find((view) => view.id === id && view.enabled) ?? VIEWS[0];
