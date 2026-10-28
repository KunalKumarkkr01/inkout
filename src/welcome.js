// Welcome page (opened once, on install): buttons that open the settings page.
for (const button of document.querySelectorAll('[data-open-settings]')) {
  button.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

const demoFrame = document.getElementById('demo-frame');

/**
 * Summary: makes the demo frame exactly as tall as its paragraph, which wraps on narrow windows.
 */
function fitDemoFrame() {
  const content = demoFrame.contentDocument?.body;
  if (content) demoFrame.style.height = `${content.scrollHeight}px`;
}

demoFrame.addEventListener('load', fitDemoFrame);
window.addEventListener('resize', fitDemoFrame);
