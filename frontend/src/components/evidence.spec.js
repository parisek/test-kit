import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TargetDetail from './TargetDetail.vue';
import ScreenshotComparison from './ScreenshotComparison.vue';
import HtmlDiff from './HtmlDiff.vue';
import StatusComparison from './StatusComparison.vue';
import ArtifactEvidence from './ArtifactEvidence.vue';
import FindingCards from './FindingCards.vue';
import { adaptReport } from '../../../src/report/model.js';
const source = 'http://localhost/report.json';
function report() {
    return { pair: { kind: 'update' }, meta: { viewports: [{ id: 'wide', width: 1280 }, { id: 'phone', width: 390 }] }, rules: {}, causes: [], findings: [
        { id: 'wide', targetId: 'home', viewportId: 'wide', artifact: 'screenshot', message: 'Wide difference' },
        { id: 'phone', targetId: 'home', viewportId: 'phone', artifact: 'screenshot', message: 'Phone difference' },
        { id: 'html', targetId: 'home', viewportId: 'wide', artifact: 'html', message: 'HTML difference' },
    ], entries: [{ id: 'home', title: 'Example page', viewports: [{ id: 'wide', state: 'complete', artifacts: {
        screenshot: { a: { src: 'a.png' }, b: { src: 'b.png' }, diff: { src: 'diff.png', ratio: 1 } },
        html: { state: 'complete', diff: { src: 'html.json' } }, status: { state: 'complete', diff: { src: 'status.json' } },
    } }, { id: 'phone', state: 'missing', artifacts: {} }] }] };
}
async function size(image, width, height) {
    Object.defineProperty(image.element, 'naturalWidth', { configurable: true, value: width });
    Object.defineProperty(image.element, 'naturalHeight', { configurable: true, value: height });
    await image.trigger('load');
}
describe('detail evidence navigation', () => {
    it('uses central actions for artifact, viewport and comparison; scopes visible findings', async () => {
        const wrapper = mount(TargetDetail, { props: { report: report(), targetId: 'home', viewportId: 'wide', source } });
        expect(wrapper.text()).toContain('Wide difference');
        expect(wrapper.text()).not.toContain('Phone difference');
        expect(wrapper.text()).not.toContain('HTML difference');
        await wrapper.get('[aria-label="Evidence artifacts"]').findAll('button')[1].trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['artifact', 'html']);
        await wrapper.get('[aria-label="Viewport"]').findAll('button')[1].trigger('click');
        expect(wrapper.emitted('action')[1]).toEqual(['viewport', 'phone']);
        await wrapper.get('[aria-label="Screenshot comparison mode"]').findAll('button')[1].trigger('click');
        expect(wrapper.emitted('action')[2]).toEqual(['comparison', 'overlay']);
        await wrapper.setProps({ artifact: 'html' });
        expect(wrapper.text()).toContain('HTML difference');
        expect(wrapper.text()).not.toContain('Wide difference');
        expect(wrapper.find('[aria-label="Screenshot comparison mode"]').exists()).toBe(false);
        expect(wrapper.get('[aria-label="Evidence artifacts"]').findAll('button')[1].attributes('aria-pressed')).toBe('true');
    });
    it('exposes only indexed artifact tabs and keeps HTTP-only failures readable', () => {
        const data = report();
        data.entries[0].viewports[0].artifacts = { status: { state: 'failed', diagnostic: 'Response exceeds limit.' } };
        const wrapper = mount(TargetDetail, { props: { report: data, targetId: 'home', viewportId: 'wide', source } });
        expect(wrapper.get('[aria-label="Evidence artifacts"]').findAll('button').map(button => button.text())).toEqual(['Status']);
        expect(wrapper.text()).toContain('Response exceeds limit.');
        expect(wrapper.find('img').exists()).toBe(false);
    });
});
describe('selected artifact measurement', () => {
    it('keeps screenshot and HTML results readable when behavior fails', async () => {
        const data = report(), row = data.entries[0].viewports[0];
        row.state = 'failed'; row.artifacts.screenshot.state = 'complete';
        row.artifacts.behavior = { state: 'failed' };
        const wrapper = mount(TargetDetail, { props: { report: data, targetId: 'home', viewportId: 'wide', source } });
        const selected = () => wrapper.get('[aria-label="Selected artifact measurement"]').text();
        expect(selected()).toContain('Screenshot'); expect(selected()).toContain('unexplained'); expect(selected()).toContain('complete'); expect(selected()).not.toContain('failed');
        await wrapper.setProps({ artifact: 'html' }); expect(selected()).toContain('HTML'); expect(selected()).toContain('complete');
        await wrapper.setProps({ artifact: 'behavior' }); expect(selected()).toContain('failed'); expect(selected()).toContain('unclassified');
        // The target header still reports its incomplete aggregate state.
        expect(wrapper.find('header').text()).toContain('failed');
    });
});
describe('original screenshot overlay', () => {
    const props = { screenshot: { a: { src: 'a.png' }, b: { src: 'b.png' }, diff: { src: 'diff.png', ratio: 2 } }, source, targetTitle: 'Example', viewportId: 'wide', mode: 'overlay', overlay: 50 };
    it('waits for equal natural dimensions and emits opacity without local selection state', async () => {
        const wrapper = mount(ScreenshotComparison, { props });
        expect(wrapper.get('input').element.disabled).toBe(true);
        expect(wrapper.get('input').attributes('min')).toBe('0');
        expect(wrapper.get('input').attributes('max')).toBe('100');
        const images = wrapper.findAll('img');
        await size(images[0], 1200, 800);
        expect(wrapper.get('input').element.disabled).toBe(true);
        await size(images[1], 1200, 800);
        expect(wrapper.get('input').element.disabled).toBe(false);
        await wrapper.get('input').setValue('25');
        expect(wrapper.emitted('action')[0]).toEqual(['overlay', 25]);
        expect(images[1].attributes('style')).toContain('opacity: 0.5');
        await wrapper.setProps({ overlay: 25 });
        expect(images[1].attributes('style')).toContain('opacity: 0.25');
        expect(wrapper.text()).toContain('2.000%');
    });
    it('disables mismatch overlays instead of silently stretching originals', async () => {
        const wrapper = mount(ScreenshotComparison, { props });
        const images = wrapper.findAll('img');
        await size(images[0], 1200, 800);
        await size(images[1], 1000, 700);
        expect(wrapper.get('input').element.disabled).toBe(true);
        expect(wrapper.text()).toContain('Image dimensions differ: A 1200 × 800 px; B 1000 × 700 px');
        expect(images[1].attributes('style')).toContain('opacity: 0');
        expect(wrapper.text()).toContain('A · Original dimensions');
    });
    it('shows missing and failed images, rejects remote links, and resets dimensions on source change', async () => {
        const wrapper = mount(ScreenshotComparison, { props });
        const old = wrapper.findAll('img')[0];
        await old.trigger('error');
        expect(wrapper.text()).toContain('An original image is unavailable');
        await wrapper.setProps({ screenshot: { a: { src: 'next.png' }, b: { src: 'next-b.png' } } });
        await old.trigger('error');
        expect(wrapper.text()).not.toContain('An original image is unavailable');
        expect(wrapper.get('input').element.disabled).toBe(true);
        await wrapper.setProps({ screenshot: { a: { src: 'https://other.example/a.png' }, b: { src: 'next-b.png' } } });
        expect(wrapper.text()).toContain('Overlay needs both original images');
        expect(wrapper.findAll('img')).toHaveLength(0);
        expect(wrapper.findAll('a').every(link => !link.attributes('href') || link.attributes('href').startsWith('http://localhost/'))).toBe(true);
    });
    it('ignores malformed optional regions from an adapted untrusted report', () => {
        const data = report();
        data.schemaVersion = 2;
        data.runs = [{ id: 'a' }, { id: 'b' }];
        data.pair = { kind: 'update', aRunId: 'a', bRunId: 'b' };
        data.meta.matchBelow = 3;
        data.entries[0].kind = 'page';
        delete data.entries[0].viewports[0].artifacts.html;
        delete data.entries[0].viewports[0].artifacts.status;
        data.entries[0].viewports[0].artifacts.screenshot.diff.regions = [null, 'bad', { x: 0, y: 0, width: -1, height: 2 }, { x: 1, y: 2, w: 3, h: 4, unit: 'px' }];
        const normalized = adaptReport(data);
        const wrapper = mount(ScreenshotComparison, { props: { ...props, mode: 'diff', screenshot: normalized.entries[0].viewports[0].artifacts.screenshot } });
        expect(wrapper.text()).toContain('x 1, y 2 · 3 × 4 px');
        expect(wrapper.findAll('li')).toHaveLength(1);
    });
    it('shows the full difference image and readable region coordinates', () => {
        const wrapper = mount(ScreenshotComparison, { props: { ...props, mode: 'diff', screenshot: { diff: { src: 'diff.png', ratio: 2, regions: [{ x: 10, y: 20, width: 30, height: 40, pixels: 500, unit: 'px' }] } } } });
        expect(wrapper.get('img').attributes('src')).toBe('http://localhost/diff.png');
        expect(wrapper.text()).toContain('x 10, y 20 · 30 × 40 px');
        expect(wrapper.text()).toContain('500 changed pixels');
    });
});
describe('readable response evidence', () => {
    const data = { changed: true, removedLines: 1, addedLines: 1, omittedLines: 3, lines: [{ kind: 'removed', line: 5, text: '<script>unsafe()</script>', truncated: false }, { kind: 'added', line: 5, text: '<h1>Example</h1>', truncated: true }], rawWindow: { changed: true, removedLines: 1, addedLines: 0, omittedLines: 0, lines: [{ kind: 'removed', line: 2, text: 'RAW RESPONSE', truncated: false }] } };
    it('renders literal line text, signs, numbers, omitted counts and raw selection', async () => {
        const wrapper = mount(HtmlDiff, { props: { data } });
        expect(wrapper.find('script').exists()).toBe(false);
        expect(wrapper.find('h1').exists()).toBe(false);
        expect(wrapper.findAll('code')[0].text()).toBe('<script>unsafe()</script>');
        expect(wrapper.text()).toContain('−1 removed');
        expect(wrapper.text()).toContain('+1 added');
        expect(wrapper.text()).toContain('3 changed lines are outside');
        expect(wrapper.text()).toContain('[line truncated]');
        await wrapper.findAll('button')[1].trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['evidence-view', 'raw']);
        await wrapper.setProps({ view: 'raw' });
        expect(wrapper.text()).toContain('RAW RESPONSE');
        expect(wrapper.text()).not.toContain('<h1>Example</h1>');
    });
    it('does not present normalized lines as unindexed raw evidence', () => {
        const wrapper = mount(HtmlDiff, { props: { data: { ...data, rawWindow: undefined }, view: 'raw' } });
        expect(wrapper.findAll('button')[1].element.disabled).toBe(true);
        expect(wrapper.text()).toContain('A raw line comparison is not indexed');
        expect(wrapper.find('code').exists()).toBe(false);
    });
    it('shows status errors, redirects and failed asset counts without raw JSON by default', () => {
        const wrapper = mount(StatusComparison, { props: { data: { a: { statusCode: 200, finalPath: '/before', redirects: [], assets: { requests: 4, failed: 0, httpErrors: 0 } }, b: { statusCode: 503, finalPath: '/after', redirects: ['/redirect'], assets: { requests: 5, failed: 2, httpErrors: 1 } } } } });
        expect(wrapper.text()).toContain('503');
        expect(wrapper.text()).toContain('The navigation returns an HTTP error');
        expect(wrapper.text()).toContain('/redirect');
        expect(wrapper.text()).toContain('Requests');
        expect(wrapper.findAll('pre')).toHaveLength(0);
    });
    it('makes loading and retry states explicit with central actions', async () => {
        const wrapper = mount(ArtifactEvidence, { props: { kind: 'status', source, row: { artifacts: { status: { state: 'complete', diff: { src: 'status.json' } } } }, evidence: { kind: 'status', loading: true } } });
        expect(wrapper.text()).toContain('Loading evidence');
        await wrapper.setProps({ evidence: { kind: 'status', error: 'Evidence request fails.' } });
        expect(wrapper.text()).toContain('Evidence request fails.');
        await wrapper.get('button').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['load-artifact', 'status']);
        expect(wrapper.get('details').attributes('open')).toBeUndefined();
    });
});
describe('finding explanation remains authoritative', () => {
    it('does not call a cause accepted without its current-pair evidence', () => {
        const data = report();
        data.meta.comparisonPolicyHash = 'sha256:' + 'a'.repeat(64);
        data.causes = [{ id: 'known', known: true, title: 'Recorded cause' }];
        const wrapper = mount(FindingCards, { props: { source, report: data, findings: [{ targetId: 'home', artifact: 'html', causeId: 'known', message: '<img src=x>', evidence: 'https://other.example/x' }] } });
        expect(wrapper.text()).toContain('unexplained');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('a').exists()).toBe(false);
    });
});
