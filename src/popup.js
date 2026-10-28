// Popup: master on/off switch and per-type checkboxes, saved to Chrome sync storage.
(function () {
  'use strict';

  const Settings = globalThis.PrivacyGuardSettings;
  const enabledToggle = document.getElementById('enabled');
  const status = document.getElementById('status');
  const typesFieldset = document.getElementById('types');
  const typeCheckboxes = typesFieldset.querySelectorAll('input[data-type]');

  /**
   * Summary: shows the given settings in the popup controls.
   * Parameters: settings — complete settings object.
   * Usage: render(await Settings.load()) when the popup opens.
   */
  function render(settings) {
    enabledToggle.checked = settings.enabled;
    status.textContent = settings.enabled ? 'Hiding is ON' : 'Hiding is OFF — data is visible';
    status.classList.toggle('off', !settings.enabled);
    typesFieldset.disabled = !settings.enabled;
    typeCheckboxes.forEach((box) => {
      box.checked = settings.types[box.dataset.type];
    });
  }

  /**
   * Summary: reads the popup controls into a settings object.
   * Returns: complete settings object.
   * Usage: Settings.save(readControls()) after any control changes.
   */
  function readControls() {
    const types = {};
    typeCheckboxes.forEach((box) => {
      types[box.dataset.type] = box.checked;
    });
    return { enabled: enabledToggle.checked, types };
  }

  document.addEventListener('change', async () => {
    const settings = readControls();
    render(settings);
    await Settings.save(settings);
  });

  Settings.onChange(render);
  Settings.load().then(render);
})();
