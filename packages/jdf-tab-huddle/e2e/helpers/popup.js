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
 * @param {string} buttonId - e.g. 'sortCurrentWindow-groups'
 */
export async function clickPopupButton(popupPage, buttonId) {
  await popupPage.click(`#${buttonId}`);
}

/**
 * Switch mode on the popup.
 * @param {import('@playwright/test').Page} popupPage
 * @param {'groups' | 'individual'} mode
 */
export async function switchMode(popupPage, mode) {
  await popupPage.click(`.tab-button[data-tab="${mode}"]`);
}
