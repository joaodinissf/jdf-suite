/**
 * Helper functions for interacting with the extension popup.
 */

/**
 * Open the popup as a page. Returns the Page object.
 */
export async function openPopup(context, extensionId) {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForLoadState('domcontentloaded');
  return popupPage;
}

/**
 * Click an action button on the popup page.
 * @param {import('@playwright/test').Page} popupPage
 * @param {string} buttonId - e.g. 'sortCurrentWindow'
 */
export async function clickPopupButton(popupPage, buttonId) {
  await popupPage.click(`#${buttonId}`);
}

/**
 * Set the popup's Groups/Flat toggle, which drives the `respectGroups`
 * boolean sent with every action message.
 * @param {import('@playwright/test').Page} popupPage
 * @param {'groups' | 'individual'} mode - 'groups' presses the Groups
 *   segment (respectGroups: true); 'individual' presses Flat (respectGroups: false).
 */
export async function switchMode(popupPage, mode) {
  const buttonId = mode === 'individual' ? 'modeFlat' : 'modeGroups';
  await popupPage.click(`#${buttonId}`);
}

/**
 * Set the popup's Groups/Flat toggle directly by respectGroups value.
 * @param {import('@playwright/test').Page} popupPage
 * @param {boolean} respectGroups
 */
export async function setRespectGroupsToggle(popupPage, respectGroups) {
  await popupPage.click(`#${respectGroups ? 'modeGroups' : 'modeFlat'}`);
}

/**
 * Open the snooze time picker for a given unit and wait for the panel.
 * @param {import('@playwright/test').Page} popupPage
 * @param {'tab' | 'selected' | 'window' | 'group'} unit
 */
export async function openSnoozePicker(popupPage, unit) {
  const idMap = {
    tab: 'snoozeTab',
    selected: 'snoozeSelected',
    window: 'snoozeWindow',
    group: 'snoozeGroup',
  };
  await popupPage.click(`#${idMap[unit]}`);
  await popupPage.waitForSelector('#snoozePickerPanel:not([hidden])');
}
