import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LiveView from './LiveView.vue';

const index = {
	sides: [{ id: 'local', origin: 'http://127.0.0.1:4101' }, { id: 'production', origin: 'http://127.0.0.1:4102' }],
	targets: [{ id: 'home', paths: { local: '/', production: '/start' } }],
	viewports: [{ id: 'desktop', width: 1440, height: 900 }],
};
function respond(body, ok = true) {
	return vi.fn(async () => ({ ok, headers: { get: () => 'application/json' }, json: async () => body }));
}

describe('the Live page (R10.17)', () => {
	beforeEach(() => { history.replaceState(null, '', '/#live'); });
	afterEach(() => { vi.unstubAllGlobals(); });

	it('shows two sandboxed frames from the proxy origins and no verdict', async () => {
		vi.stubGlobal('fetch', respond(index));
		const wrapper = mount(LiveView, { props: { back: { label: 'Comparisons' } }, attachTo: document.body });
		await flushPromises();
		const frames = wrapper.findAll('iframe');
		expect(frames.map((frame) => frame.attributes('src'))).toEqual(['http://127.0.0.1:4101/', 'http://127.0.0.1:4102/start']);
		for (const frame of frames) expect(frame.attributes('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups');
		expect(location.hash).toBe('#live/home/local/production/desktop?layout=swap&zoom=fit&show=a');
		expect(wrapper.text()).not.toMatch(/unexplained|explained|match|verdict/i);
		expect(wrapper.text()).toContain('desktop · 1440 px at');
		wrapper.unmount();
	});

	it('draws each picker arrow inside the field, like the report filters', async () => {
		vi.stubGlobal('fetch', respond(index));
		const wrapper = mount(LiveView, { attachTo: document.body });
		await flushPromises();
		const selects = wrapper.findAll('.live-pickers select');
		expect(selects).toHaveLength(6);
		for (const select of selects) expect(select.element.parentElement.classList.contains('filter-select')).toBe(true);
		wrapper.unmount();
	});

	it('swaps with the space bar, replaces the history entry, and ignores the key in a form control', async () => {
		vi.stubGlobal('fetch', respond(index));
		const wrapper = mount(LiveView, { attachTo: document.body });
		await flushPromises();
		const length = history.length;
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		await flushPromises();
		expect(location.hash).toContain('show=b');
		expect(history.length).toBe(length);
		wrapper.find('select').element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		await flushPromises();
		expect(location.hash).toContain('show=b');
		wrapper.unmount();
	});

	it('accepts a scroll message only from the origin and the window of its frame', async () => {
		vi.stubGlobal('fetch', respond(index));
		const wrapper = mount(LiveView, { attachTo: document.body });
		await flushPromises();
		const [a, b] = wrapper.findAll('iframe').map((frame) => frame.element);
		const posted = vi.spyOn(b.contentWindow, 'postMessage');
		const button = () => wrapper.find('.live-bar button');
		const send = (origin, source, ratio) => window.dispatchEvent(new MessageEvent('message', { origin, source, data: { type: 'test-kit/live-scroll', ratio } }));
		const swapToB = async () => { await button().trigger('click'); const last = posted.mock.lastCall; await button().trigger('click'); return last; };
		// A wrong origin from the window of frame A, and the origin of A from the window of frame B: both are ignored.
		send('http://127.0.0.1:4102', a.contentWindow, 0.9);
		send('http://127.0.0.1:4101', b.contentWindow, 0.8);
		expect(await swapToB()).toEqual([{ type: 'test-kit/live-scroll-to', ratio: 0 }, 'http://127.0.0.1:4102']);
		// A ratio outside 0 to 1 is ignored too.
		send('http://127.0.0.1:4101', a.contentWindow, 7);
		expect(await swapToB()).toEqual([{ type: 'test-kit/live-scroll-to', ratio: 0 }, 'http://127.0.0.1:4102']);
		send('http://127.0.0.1:4101', a.contentWindow, 0.4);
		expect(await swapToB()).toEqual([{ type: 'test-kit/live-scroll-to', ratio: 0.4 }, 'http://127.0.0.1:4102']);
		wrapper.unmount();
	});

	it('copies the measure command and names its effect (R10.17 item 8)', async () => {
		vi.stubGlobal('fetch', respond(index));
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const wrapper = mount(LiveView, { attachTo: document.body });
		await flushPromises();
		expect(wrapper.find('.live-measure').text()).toContain('before replaces the stored baseline of this selection');
		await wrapper.find('.live-measure button').trigger('click');
		await flushPromises();
		expect(writeText).toHaveBeenCalledWith('test-kit before --config FILE --side local --target home --viewport desktop && test-kit after --config FILE --side production --target home --viewport desktop');
		wrapper.unmount();
	});

	it('shows the serve command and no frame without the proxy (R10.17 item 7)', async () => {
		vi.stubGlobal('fetch', respond({}, false));
		const wrapper = mount(LiveView, { attachTo: document.body });
		await flushPromises();
		expect(wrapper.find('iframe').exists()).toBe(false);
		expect(wrapper.text()).toContain('test-kit serve REPORT --live');
		wrapper.unmount();
	});

	it('drops a frame source that is not a loopback proxy origin', async () => {
		vi.stubGlobal('fetch', respond({ ...index, sides: [index.sides[0], { id: 'production', origin: 'https://evil.example' }] }));
		const wrapper = mount(LiveView, { attachTo: document.body });
		await flushPromises();
		expect(wrapper.find('iframe').exists()).toBe(false);
		expect(wrapper.text()).toContain('fewer than two usable sides');
		wrapper.unmount();
	});
});
