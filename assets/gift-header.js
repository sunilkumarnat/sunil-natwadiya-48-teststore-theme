/**
 * Gift Header — mobile toggle.
 *
 * On mobile the announcement + CTA are collapsed behind a "+" trigger next to the logo,
 * matching a standard menu-toggle disclosure: closed by default on every page load, opens
 * and closes on tap. Nothing is persisted between loads — unlike a "dismiss" pattern, there's
 * no memory of a previous state to restore, so no pre-hydration script is needed here.
 */
document.querySelectorAll('[data-testid="gift-header"]').forEach((header) => {
  const bar = header.querySelector('.gift-header__bar');
  const toggleButton = header.querySelector('[data-gift-header-toggle]');

  toggleButton?.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    toggleButton.setAttribute('aria-expanded', String(!isExpanded));
    bar?.setAttribute('data-expanded', String(!isExpanded));
  });
});
