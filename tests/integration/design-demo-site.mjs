import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Anonymous local pages for the viewer demo. No remote resources (R12.4).
export async function startDesignDemoSite({ variant = 'before' } = {}) {
  if (!['before', 'after'].includes(variant)) throw new Error('Invalid demo variant.');
  const css = await readFile(new URL('../fixtures/example-site/demo.css', import.meta.url), 'utf8');
  const after = variant === 'after';
  const card = () => `<article class="card specimen"><span class="tag">Studio plan</span><h3>A little more room to grow.</h3><div class="price">$${after ? '39' : '29'} <small>/ month</small></div><p>One workspace. Every essential tool.<br>Start small and make it yours.</p><span class="cta">Choose this plan →</span></article>`;
  const body = path => {
    if (path === '/components/button') return `<div class="eyebrow">Component / Button</div><h1>A clear next step.</h1><p>Primary action. Comfortable spacing. One purpose.</p><section class="component-stage"><div class="specimen"><button class="cta primary-button">Start a conversation →</button></div></section>`;
    if (path === '/components/card') return `<div class="eyebrow">Component / Pricing card</div><h1>Simple by design.</h1><section class="component-stage">${card()}</section>`;
    if (path === '/support') return `<div class="eyebrow">Support</div><h1>Here when you need us.</h1><p>Useful answers. A little less friction.</p><div class="support"><h2>How can we help?</h2><p>This page looks the same on both sides. The after fixture returns HTTP 503.</p></div>`;
    if (path === '/catalogue') return `<div class="eyebrow">Component library</div><h1>Small pieces.<br>One thoughtful system.</h1><div class="cards">${['Typography','Space','Colour'].map((title,i)=>`<article class="card"><span class="number">0${i+1}</span><h3>${title}</h3><p>A steady foundation for everything you make.</p></article>`).join('')}</div>`;
    return `<section class="hero"><div><div class="eyebrow">Example site / Digital studio</div><h1>Make space<br>for ${after ? 'better' : 'good'} ideas.</h1><p>Thoughtful tools for people who care about the things they create.</p><span class="cta">Explore the work →</span></div><div class="hero-art"><span class="caption">A LITTLE DIFFERENT.</span><div class="sun"></div><div class="cube"></div><div class="ring"></div></div></section><div class="section-title"><div><div class="eyebrow">Made with intention</div><h2>Less noise. More possibility.</h2></div><span class="tag">Always evolving</span></div><div class="cards">${['Built around you','Every detail counts','Room for what is next'].map((title,i)=>`<article class="card"><span class="number">0${i+1}</span><h3>${title}</h3><p>Clear choices and useful details, from the first idea to the final result.</p></article>`).join('')}</div>`;
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    if (path === '/site.css') {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      response.end(css + (after ? '@media(max-width:700px){.primary-button{padding-bottom:17px}}' : '')); return;
    }
    if (!['/', '/components/button', '/components/card', '/support', '/catalogue'].includes(path)) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(after && path === '/support' ? 503 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Example site</title><link rel="stylesheet" href="/site.css"></head>
<body>
<header><a class="brand" href="/"><i></i>Example site.</a><nav><a href="/catalogue">Our approach</a><a href="/support">Get in touch ↗</a></nav></header>
<main>
${body(path).replaceAll('><', '>\n<')}
</main><footer><span>Independent ideas. Considered design.</span><span>Example site · Local fixture</span></footer>
</body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
