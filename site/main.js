// The hero's call shows the shared screen readable for a moment, then inked out, once.
// The switch lets visitors flip Inkout off and on to compare.
const INTRO_DELAY_MS = 900;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reducedMotion) document.documentElement.dataset.intro = 'pending';

document.addEventListener('DOMContentLoaded', () => {
  const call = document.querySelector('.call');
  const toggle = document.getElementById('ink-switch');
  if (!call || !toggle) return;

  if (!reducedMotion) {
    setTimeout(() => delete document.documentElement.dataset.intro, INTRO_DELAY_MS);
  }

  toggle.addEventListener('click', () => {
    delete document.documentElement.dataset.intro;
    const on = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(on));
    call.dataset.inkout = on ? 'on' : 'off';
  });
});
