// Entry point `@parisek/test-kit/packs/swiper`. Opt-in (G3, R5.1). Pure. Contract sets for Swiper 12 and Swiper 14 (R13.42).
//
// Input value (JSON-like facts about the DOM, one frozen snapshot):
//   { instances: [{ id, containerClasses: [string], wrapperClasses: [string] | null, slides: [{ classes: [string] }] }] }
// Context: { components: ['swiper'], versions: { swiper: { version: '12.2.0', source: 'lockfile' } } }
//
// Verified facts. Both sets were checked by reading the published packages swiper@12.2.0 and swiper@14.3.0 from npm
// (file shared/swiper-core.mjs in each). In both releases the defaults are `wrapperClass: 'swiper-wrapper'`, `slideClass: 'swiper-slide'`,
// `slideActiveClass: 'swiper-slide-active'` and `containerModifierClass: 'swiper-'`. The container gets the modifier `initialized`,
// so the class `swiper-initialized`. Only the slide that equals the active slide gets `slideActiveClass`.
// The class surface did not differ between the two releases. The sets stay separate, so a later change in one major edits one set.
// Swiper exposes no runtime version property in the source of either release, so this pack reads the version from the lockfile or
// from the bundle banner comment, never from a page global.
import { defineContractSet, defineVersionedPack } from './sets.js';

const asList = value => (Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null);
const open = message => [{ severity: 'error', message, evidence: { state: 'incomplete' } }];
const bad = (instance, message, extra = {}) => ({ severity: 'error', message, evidence: { instance: instance.id, ...extra } });

// Returns the instances, or null when the value cannot be read as facts. A page with no instance never passes.
const instancesOf = value => (value && Array.isArray(value.instances) && value.instances.length > 0 ? value.instances : null);

function contracts() {
  return [
    {
      id: 'structure', title: 'Swiper container, wrapper and slides carry the library classes',
      check(value, facts) {
        const instances = instancesOf(value);
        if (!instances) return open('The facts list no Swiper instance, so the structure is not proven.');
        const found = [];
        for (const instance of instances) {
          const container = asList(instance?.containerClasses);
          const wrapper = instance?.wrapperClasses === null ? null : asList(instance?.wrapperClasses);
          const slides = Array.isArray(instance?.slides) ? instance.slides.map(slide => asList(slide?.classes)) : null;
          if (!container || !slides || slides.includes(null)) return open('The instance facts have a bad shape.');
          if (!container.includes(facts.initializedClass)) found.push(bad(instance, `The container lacks ${facts.initializedClass}.`, { expected: facts.initializedClass }));
          if (!wrapper || !wrapper.includes(facts.wrapperClass)) found.push(bad(instance, `The wrapper lacks ${facts.wrapperClass}.`, { expected: facts.wrapperClass }));
          if (slides.length === 0) found.push(bad(instance, 'The instance has no slide.'));
          slides.forEach((classes, index) => {
            if (!classes.includes(facts.slideClass)) found.push(bad(instance, `Slide ${index} lacks ${facts.slideClass}.`, { expected: facts.slideClass, slide: index }));
          });
        }
        return found;
      },
    },
    {
      id: 'active-slide', title: 'Exactly one Swiper slide is active',
      check(value, facts) {
        const instances = instancesOf(value);
        if (!instances) return open('The facts list no Swiper instance, so the active slide is not proven.');
        const found = [];
        for (const instance of instances) {
          const slides = Array.isArray(instance?.slides) ? instance.slides.map(slide => asList(slide?.classes)) : null;
          if (!slides || slides.includes(null)) return open('The instance facts have a bad shape.');
          const active = slides.filter(classes => classes.includes(facts.slideActiveClass)).length;
          if (slides.length > 0 && active !== 1) found.push(bad(instance, `Expected one slide with ${facts.slideActiveClass}, found ${active}.`, { expected: 1, actual: active }));
        }
        return found;
      },
    },
  ];
}

const verified = (major, release) => ({
  library: 'swiper', major, owner: 'test-kit', status: 'verified', verifiedAgainst: release,
  sources: [`npm package swiper@${release}, file shared/swiper-core.mjs (read 2026-10-18)`, 'https://github.com/nolimits4web/swiper (original project)'],
  facts: { initializedClass: 'swiper-initialized', wrapperClass: 'swiper-wrapper', slideClass: 'swiper-slide', slideActiveClass: 'swiper-slide-active' },
  contracts: contracts(),
});

export const swiperSets = Object.freeze([verified(12, '12.2.0'), verified(14, '14.3.0')].map(defineContractSet));
export const swiperPack = defineVersionedPack({ id: 'swiper', title: 'Swiper contracts by major version', owner: 'test-kit', library: 'swiper', sets: swiperSets });
