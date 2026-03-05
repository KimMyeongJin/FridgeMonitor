import { t } from './i18n.js';

let selectedDevice = 'all';
let knownDevices = new Set();

export function getSelectedDevice() { return selectedDevice; }
export function getKnownDevices() { return knownDevices; }

export function updateDeviceTabs(onSwitch) {
  const tabsContainer = document.getElementById('deviceTabs');
  tabsContainer.style.display = knownDevices.size > 1 ? 'flex' : 'none';
  const devices = ['all', ...Array.from(knownDevices).sort()];

  tabsContainer.innerHTML = devices.map(d => {
    const label = t(`device.${d}`, {}) !== `device.${d}` ? t(`device.${d}`) : d;
    const active = d === selectedDevice ? 'active' : '';
    const safeD = d.replace(/"/g, '&quot;');
    const selected = d === selectedDevice;
    return `<button class="device-tab ${active}" data-device="${safeD}" role="tab" aria-selected="${selected}">${label}</button>`;
  }).join('');

  tabsContainer.querySelectorAll('.device-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectedDevice = tab.dataset.device;
      updateDeviceTabs(onSwitch);
      if (onSwitch) onSwitch();
    });
  });
}

export function addKnownDevice(deviceId) {
  if (deviceId) knownDevices.add(deviceId);
}
