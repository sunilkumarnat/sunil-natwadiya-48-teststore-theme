/**
 * Gift Header — mobile toggle.
 *
 * On mobile the announcement + CTA are collapsed behind a burger trigger next to the logo,
 * matching a standard menu-toggle disclosure: closed by default on every page load, opens
 * and closes on tap. The toggle button's `aria-controls` points at the content's id, and its
 * `hidden` attribute (rather than a class or a data-attribute elsewhere in the DOM) is the
 * single source of truth for open/closed — nothing is persisted between loads.
 */
document.querySelectorAll('[data-testid="gift-header"]').forEach((header) => {
  const toggleButton = header.querySelector('[data-gift-header-toggle]');
  const content = document.getElementById(toggleButton?.getAttribute('aria-controls'));

  toggleButton?.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    toggleButton.setAttribute('aria-expanded', String(!isExpanded));
    if (content) content.hidden = isExpanded;
  });
});
