// Behaviour shared by every page: language, theme, copy buttons, mobile menu, GitHub stars and npm version.
import { translations } from './i18n.js?v=3';

const root = document.documentElement;
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function stored(key, storage = localStorage) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key, value, storage = localStorage) {
  try {
    storage.setItem(key, value);
  } catch {
    /* Private mode or blocked storage: the value simply is not remembered. */
  }
}

/* Language: English markup is the source; French replaces the marked strings. */
const english = new Map();
for (const element of document.querySelectorAll('[data-i18n]')) english.set(element, element.innerHTML);
const englishLabels = new Map();
for (const element of document.querySelectorAll('[data-i18n-label]'))
  englishLabels.set(element, element.getAttribute('aria-label'));
const listeners = [];

export let language = 'en';

export function t(key) {
  return (language === 'fr' && translations.fr[key]) || translations.en[key] || key;
}

/** Runs now and after every language change. */
export function onLanguageChange(listener) {
  listeners.push(listener);
}

function applyLanguage(next) {
  language = next;
  root.lang = next;
  for (const [element, html] of english) {
    const key = element.dataset.i18n;
    // Static strings from i18n.js only; they may contain <code>, <kbd> and <a>.
    element.innerHTML = next === 'fr' && translations.fr[key] ? translations.fr[key] : html;
  }
  for (const [element, label] of englishLabels) {
    const key = element.dataset.i18nLabel;
    element.setAttribute('aria-label', next === 'fr' && translations.fr[key] ? translations.fr[key] : label);
  }
  // Long-form pages ship one block per language.
  for (const block of document.querySelectorAll('[data-lang]')) block.hidden = block.dataset.lang !== next;
  const titleKey = document.body.dataset.titleKey;
  if (titleKey) document.title = t(titleKey);
  document.querySelector('[data-action="language"]')?.setAttribute('aria-label', t('lang.label'));
  applyThemeLabel();
  renderStars();
  for (const listener of listeners) listener(next);
}

/* Theme: follows the system until the visitor picks one. */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function activeTheme() {
  return root.dataset.theme ?? (darkQuery.matches ? 'dark' : 'light');
}

function applyThemeLabel() {
  const theme = activeTheme();
  root.dataset.themeActive = theme;
  document
    .querySelector('[data-action="theme"]')
    ?.setAttribute('aria-label', t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark'));
}

/* Copy buttons */
function setupCopy() {
  const status = document.querySelector('[data-copy-status]');
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.dataset.copied = '';
        button.textContent = t('copied');
        if (status) status.textContent = t('copiedStatus');
        setTimeout(() => {
          delete button.dataset.copied;
          button.textContent = t('copy');
        }, 1800);
      } catch {
        if (status) status.textContent = t('copyFailed');
      }
    });
  }
}

/* Mobile menu: a disclosure button that shows the navigation below the header. */
function setupMenu() {
  const button = document.querySelector('[data-action="menu"]');
  const menu = document.getElementById('site-menu');
  if (!button || !menu) return;
  const close = () => {
    button.setAttribute('aria-expanded', 'false');
    menu.dataset.open = 'false';
  };
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    menu.dataset.open = String(open);
    if (open) menu.querySelector('a')?.focus();
  });
  menu.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      close();
      button.focus();
    }
  });
}

/* GitHub stars and the latest npm version, cached for the tab so navigation does not refetch. */
let stars = null;

/** 29300 → "29.3k" in English, "29,3k" in French; below 1,000 the exact number. */
function compact(value) {
  if (value < 1000) return value.toLocaleString(language);
  const thousands = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(Math.floor(value / 100) / 10);
  return `${thousands}k`;
}

function renderStars() {
  // No stars yet reads as an invitation rather than a bare "0".
  const label = stars === null ? 'GitHub' : stars === 0 ? t('stars.cta') : compact(stars);
  for (const element of document.querySelectorAll('[data-stars]')) element.textContent = label;
  for (const link of document.querySelectorAll('[data-stars-link]'))
    link.setAttribute(
      'aria-label',
      stars === null || stars === 0
        ? t('stars.link')
        : `${t('stars.link')}, ${t('stars.count').replace('{0}', stars.toLocaleString(language))}`,
    );
}

async function cachedJson(key, url, pick) {
  const cached = stored(key, sessionStorage);
  if (cached !== null) return JSON.parse(cached);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const value = pick(await response.json());
  store(key, JSON.stringify(value), sessionStorage);
  return value;
}

async function loadRemoteFacts() {
  try {
    const count = await cachedJson(
      'threadport-stars',
      'https://api.github.com/repos/AristideDongo/threadport',
      (data) => data.stargazers_count,
    );
    if (Number.isInteger(count)) {
      stars = count;
      renderStars();
    }
  } catch {
    /* Rate-limited or offline: the button still links to GitHub, just without a count. */
  }
  try {
    const version = await cachedJson(
      'threadport-version',
      'https://registry.npmjs.org/threadport/latest',
      (data) => data.version,
    );
    if (typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version))
      for (const element of document.querySelectorAll('[data-npm-version]')) {
        element.textContent = `v${version}`;
        element.hidden = false;
      }
  } catch {
    /* The version badge stays hidden. */
  }
}

export function start() {
  document.querySelector('[data-action="language"]')?.addEventListener('click', () => {
    const next = language === 'fr' ? 'en' : 'fr';
    store('threadport-lang', next);
    applyLanguage(next);
  });
  document.querySelector('[data-action="theme"]')?.addEventListener('click', () => {
    const next = activeTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store('threadport-theme', next);
    applyThemeLabel();
  });
  darkQuery.addEventListener('change', applyThemeLabel);
  setupCopy();
  setupMenu();
  const preferred = stored('threadport-lang') ?? (navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en');
  applyLanguage(preferred === 'fr' ? 'fr' : 'en');
  void loadRemoteFacts();
}
