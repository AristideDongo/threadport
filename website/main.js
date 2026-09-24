import { packs } from './context-packs.js';
import { translations } from './i18n.js';

const root = document.documentElement;

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private mode or blocked storage: the choice simply is not remembered. */
  }
}

/* Language: English markup is the source; French replaces the marked strings. */
const english = new Map();
for (const element of document.querySelectorAll('[data-i18n]')) english.set(element, element.innerHTML);
const englishLabels = new Map();
for (const element of document.querySelectorAll('[data-i18n-label]'))
  englishLabels.set(element, element.getAttribute('aria-label'));

let language = 'en';

function t(key) {
  return (language === 'fr' && translations.fr[key]) || translations.en[key] || key;
}

function applyLanguage(next) {
  language = next;
  root.lang = next;
  for (const [element, html] of english) {
    const key = element.dataset.i18n;
    // Static strings from i18n.js only; they may contain <code> and <kbd>.
    element.innerHTML = next === 'fr' && translations.fr[key] ? translations.fr[key] : html;
  }
  for (const [element, label] of englishLabels) {
    const key = element.dataset.i18nLabel;
    element.setAttribute('aria-label', next === 'fr' && translations.fr[key] ? translations.fr[key] : label);
  }
  document.title = t('meta.title');
  const toggle = document.querySelector('[data-action="language"]');
  toggle.setAttribute('aria-label', t('lang.label'));
  applyThemeLabel();
  renderPack(currentMode);
}

document.querySelector('[data-action="language"]').addEventListener('click', () => {
  const next = language === 'fr' ? 'en' : 'fr';
  store('threadport-lang', next);
  applyLanguage(next);
});

/* Theme: follows the system until the visitor picks one. */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function activeTheme() {
  return root.dataset.theme ?? (darkQuery.matches ? 'dark' : 'light');
}

function applyThemeLabel() {
  const theme = activeTheme();
  root.dataset.themeActive = theme;
  const button = document.querySelector('[data-action="theme"]');
  button.setAttribute('aria-label', t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark'));
}

document.querySelector('[data-action="theme"]').addEventListener('click', () => {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  store('threadport-theme', next);
  applyThemeLabel();
});
darkQuery.addEventListener('change', applyThemeLabel);

/* Copy buttons */
const copyStatus = document.querySelector('[data-copy-status]');
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.dataset.copied = '';
      button.textContent = t('copied');
      copyStatus.textContent = t('copiedStatus');
      setTimeout(() => {
        delete button.dataset.copied;
        button.textContent = t('copy');
      }, 1800);
    } catch {
      copyStatus.textContent = t('copyFailed');
    }
  });
}

/* Context pack viewer */
function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function highlight(text) {
  let inDiff = false;
  return text
    .split('\n')
    .map((raw) => {
      const line = escapeHtml(raw);
      const heading = /^(## .+?) (\[[^\]]+\])$/.exec(line);
      if (heading) {
        inDiff = heading[1] === '## Git diff';
        return `<span class="heading">${heading[1]}</span> <span class="source">${heading[2]}</span>`;
      }
      if (inDiff && /^\+(?!\+\+)/.test(raw)) return `<span class="added">${line}</span>`;
      if (inDiff && /^-(?!--)/.test(raw)) return `<span class="removed">${line}</span>`;
      if (raw.startsWith('- [failed]')) return `<span class="failed">${line}</span>`;
      return line;
    })
    .join('\n');
}

const tabs = [...document.querySelectorAll('[role="tab"][data-mode]')];
const panel = document.getElementById('pack-panel');
let currentMode = 'standard';

function renderPack(mode) {
  const pack = packs[mode];
  if (!pack) return;
  currentMode = mode;
  document.querySelector('[data-pack="text"]').innerHTML = highlight(pack.text);
  document.querySelector('[data-pack="tokens"]').textContent = pack.tokens.toLocaleString(language);
  document.querySelector('[data-pack="budget"]').textContent = pack.budget.toLocaleString(language);
  document.querySelector('[data-pack="mode"]').textContent = mode;
  document
    .querySelector('[data-pack="bar"]')
    .style.setProperty('--fill', `${Math.round((pack.tokens / pack.budget) * 100)}%`);
  for (const tab of tabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) panel.setAttribute('aria-labelledby', tab.id);
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => renderPack(tab.dataset.mode));
  // Arrow keys move between tabs, as in the WAI-ARIA tabs pattern.
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = tabs[(index + moves[event.key] + tabs.length) % tabs.length];
    renderPack(next.dataset.mode);
    next.focus();
  });
}

/* Stagger the hero terminal lines (CSS reads --i). */
for (const terminal of document.querySelectorAll('.terminal-body')) {
  for (const [index, line] of terminal.querySelectorAll('.line').entries())
    line.style.setProperty('--i', String(index));
}

const preferred = stored('threadport-lang') ?? (navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en');
applyLanguage(preferred === 'fr' ? 'fr' : 'en');
