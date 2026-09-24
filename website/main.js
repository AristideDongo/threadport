import { packs } from './context-packs.js';
import { language, onLanguageChange, reducedMotion, start } from './shared.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const tokensOutput = document.querySelector('[data-pack="tokens"]');
let currentMode = 'standard';
let shownTokens = packs.standard.tokens;
let countFrame = 0;

/** Counts the token total from its previous value, so switching modes shows how the budget changes. */
function countTokens(target) {
  cancelAnimationFrame(countFrame);
  const from = shownTokens;
  if (reducedMotion.matches || from === target) {
    shownTokens = target;
    tokensOutput.textContent = target.toLocaleString(language);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / 450);
    shownTokens = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
    tokensOutput.textContent = shownTokens.toLocaleString(language);
    if (progress < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
}

function renderPack(mode, animate = false) {
  const pack = packs[mode];
  if (!pack) return;
  currentMode = mode;
  const code = document.querySelector('[data-pack="text"]');
  code.innerHTML = highlight(pack.text);
  if (animate && !reducedMotion.matches) {
    code.classList.remove('is-swapping');
    void code.offsetWidth;
    code.classList.add('is-swapping');
  }
  countTokens(pack.tokens);
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
  tab.addEventListener('click', () => renderPack(tab.dataset.mode, true));
  // Arrow keys move between tabs, as in the WAI-ARIA tabs pattern.
  tab.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(tab);
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = tabs[(index + moves[event.key] + tabs.length) % tabs.length];
    renderPack(next.dataset.mode, true);
    next.focus();
  });
}

/*
 * Hero handoff: commands are typed in the Claude terminal, the thread carries handoff.md across, then the Codex
 * terminal types its command and receives the context. The full text is in the HTML, so without JavaScript or
 * with reduced motion the finished state shows immediately.
 */
const demo = document.querySelector('.handoff-demo');
const replay = document.querySelector('[data-action="replay"]');
let playId = 0;

function prepareLines(terminal) {
  const lines = [...terminal.querySelectorAll('.line')];
  return lines.map((line, index) => {
    const typed = Boolean(line.querySelector('.prompt')) || /\\\s*$/.test(lines[index - 1]?.textContent ?? '');
    const node = [...line.childNodes].findLast((child) => child.nodeType === Node.TEXT_NODE);
    const text = node?.textContent ?? '';
    return { line, typed, node, text };
  });
}

const terminals = [...document.querySelectorAll('.handoff-demo .terminal-body')].map(prepareLines);

function resetDemo() {
  for (const lines of terminals)
    for (const item of lines) {
      item.line.classList.remove('is-visible');
      if (item.node) item.node.textContent = item.text;
    }
}

async function typeTerminal(lines, id) {
  for (const item of lines) {
    if (id !== playId) return;
    if (item.typed && item.node) {
      item.node.textContent = '';
      item.line.classList.add('is-visible');
      for (let index = 1; index <= item.text.length; index++) {
        if (id !== playId) return;
        item.node.textContent = item.text.slice(0, index);
        await wait(item.text[index - 1] === ' ' ? 10 : 24);
      }
      await wait(220);
    } else {
      item.line.classList.add('is-visible');
      await wait(90);
    }
  }
}

async function playHandoff() {
  if (!demo || reducedMotion.matches) return;
  const id = ++playId;
  resetDemo();
  demo.classList.remove('is-handed-off');
  demo.classList.add('is-playing');
  if (replay) replay.hidden = true;
  await wait(400);
  await typeTerminal(terminals[0] ?? [], id);
  if (id !== playId) return;
  await wait(250);
  demo.classList.add('is-handed-off');
  await wait(950);
  await typeTerminal(terminals[1] ?? [], id);
  if (id !== playId) return;
  demo.classList.remove('is-playing');
  resetDemo();
  if (replay) replay.hidden = false;
}

replay?.addEventListener('click', () => void playHandoff());

/*
 * The page thread: a line in the left gutter that fills as you scroll and lights a port beside each section.
 * The handoff steps use the same progress for their own rail.
 */
const pageThread = document.querySelector('.page-thread');
const ports = [];
const steps = document.querySelector('.steps');
const stepItems = [...document.querySelectorAll('.steps li')];

function layoutPorts() {
  if (!pageThread) return;
  const main = document.getElementById('main');
  const top = main.getBoundingClientRect().top + window.scrollY;
  for (const port of pageThread.querySelectorAll('.port')) port.remove();
  ports.length = 0;
  for (const heading of document.querySelectorAll('.section h2, .closing h2')) {
    const port = document.createElement('span');
    port.className = 'port';
    const y = heading.getBoundingClientRect().top + window.scrollY - top + heading.offsetHeight / 2;
    port.style.top = `${y}px`;
    pageThread.append(port);
    ports.push({ port, y });
  }
}

let scrollFrame = 0;
function onScroll() {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    const reading = window.scrollY + window.innerHeight * 0.6;
    if (pageThread) {
      const main = document.getElementById('main');
      const top = main.getBoundingClientRect().top + window.scrollY;
      const filled = Math.max(0, reading - top);
      pageThread.style.setProperty('--filled', `${filled}px`);
      for (const { port, y } of ports) port.classList.toggle('is-reached', y <= filled);
    }
    if (steps) {
      const box = steps.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - box.top) / box.height));
      steps.style.setProperty('--progress', progress.toFixed(3));
      for (const item of stepItems)
        item.classList.toggle('is-reached', item.getBoundingClientRect().top < window.innerHeight * 0.6);
    }
  });
}

/* Redaction: when the example comes into view, the token is shown, scrambled, then replaced as it is stored. */
const redaction = document.querySelector('[data-redact]');
function playRedaction() {
  if (!redaction || reducedMotion.matches) return;
  const secret = redaction.dataset.redact;
  const glyphs = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    const kept = Math.max(0, secret.length - frame * 2);
    redaction.textContent =
      secret.slice(0, kept) +
      Array.from({ length: secret.length - kept }, () => glyphs[Math.floor(Math.random() * glyphs.length)]).join('');
    if (kept === 0) {
      clearInterval(timer);
      redaction.textContent = '[REDACTED]';
      redaction.classList.add('is-redacted');
    }
  }, 45);
  redaction.textContent = secret;
}

if (redaction && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setTimeout(playRedaction, 400);
    },
    { threshold: 0.8 },
  );
  observer.observe(redaction.closest('figure'));
}

onLanguageChange(() => renderPack(currentMode));
start();
layoutPorts();
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => {
  layoutPorts();
  onScroll();
});
document.fonts?.ready.then(() => {
  layoutPorts();
  onScroll();
});
void playHandoff();
