import { onLanguageChange, start, t } from './shared.js?v=5';

const toc = document.querySelector('[data-toc]');
let observer;

/* Table of contents for the visible language, with the section being read marked as current. */
function buildToc() {
  const article = document.querySelector('article[data-lang]:not([hidden])');
  if (!article || !toc) return;
  const headings = [...article.querySelectorAll('h2[id]')];
  toc.replaceChildren(
    ...headings.map((heading) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      item.append(link);
      return item;
    }),
  );
  observer?.disconnect();
  const links = new Map([...toc.querySelectorAll('a')].map((link) => [link.hash.slice(1), link]));
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (!visible.length) return;
      const id = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0].target.id;
      for (const [key, link] of links) {
        if (key === id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );
  for (const heading of headings) observer.observe(heading);
}

/* Copy buttons on every code block. */
function addCopyButtons() {
  for (const pre of document.querySelectorAll('.docs-main pre')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = t('copy');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? '');
        button.textContent = t('copied');
        setTimeout(() => {
          button.textContent = t('copy');
        }, 1600);
      } catch {
        button.textContent = t('copyFailed');
      }
    });
    pre.append(button);
  }
}

/* An anchor from the other language (#en-install ↔ #fr-install) jumps to the matching section. */
function followHash(language) {
  const match = /^#(en|fr)-(.+)$/.exec(location.hash);
  if (!match || match[1] === language) return;
  const target = document.getElementById(`${language}-${match[2]}`);
  if (target) {
    history.replaceState(null, '', `#${target.id}`);
    target.scrollIntoView();
  }
}

addCopyButtons();
onLanguageChange((language) => {
  for (const button of document.querySelectorAll('.code-copy')) button.textContent = t('copy');
  buildToc();
  followHash(language);
});
start();
