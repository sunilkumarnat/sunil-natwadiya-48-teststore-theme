/**
 * Gift Header — dismiss button.
 *
 * Clicking the mobile close icon hides the bar and remembers the choice for the rest of
 * the browsing session (a fresh visit, or a new tab, shows it again). The inline script in
 * sections/gift-header.liquid handles the initial paint so a previously-dismissed bar
 * never flashes visible before this module loads.
 */
const STORAGE_KEY = 'giftHeaderDismissed';

document.querySelectorAll('[data-testid="gift-header"]').forEach((bar) => {
  const dismissButton = bar.querySelector('[data-gift-header-dismiss]');

  dismissButton?.addEventListener('click', () => {
    bar.hidden = true;
    sessionStorage.setItem(STORAGE_KEY, '1');
  });
});
