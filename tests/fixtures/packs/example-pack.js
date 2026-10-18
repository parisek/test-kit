// Tiny sample pack for tests. It is not a real check set.
import { definePack } from '../../../src/packs/index.js';
export const titleCheck = {
  id: 'example-title', title: 'Example title present', basis: 'absolute', applies: { artifacts: ['content'] },
  check: (doc, ctx) => doc.title ? [] : [{ targetId: ctx.targetId, artifact: 'content', severity: 'warning', message: 'The page has no title.', evidence: {} }],
};
export const throwingCheck = { id: 'example-throws', title: 'Example failing check', basis: 'absolute', applies: { artifacts: ['content'] }, check() { throw new Error('boom'); } };
export const examplePack = definePack({ id: 'example-pack', title: 'Example pack', owner: 'example-owner', checks: [titleCheck, throwingCheck] });
