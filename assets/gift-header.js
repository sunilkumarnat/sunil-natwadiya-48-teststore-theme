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

  if (content) {
    // Prep content for smooth transitions
    content.style.overflow = 'hidden';
    content.style.transition = 'height 0.3s ease, opacity 0.3s ease';

    // Set initial state based on current aria-expanded value
    const initiallyExpanded = toggleButton?.getAttribute('aria-expanded') === 'true';
    if (!initiallyExpanded) {
      content.style.height = '0px';
      content.style.opacity = '0';
      content.style.padding = '0';
      content.hidden = false; // we control visibility via height/opacity now
    } else {
      content.style.height = 'auto';
      content.style.opacity = '1';
      content.style.padding = '15px 10px';
    }
  }

  toggleButton?.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    toggleButton.setAttribute('aria-expanded', String(!isExpanded));

    if (!content) return;

    if (isExpanded) {
      // Collapsing: measure current height, then animate to 0
      const currentHeight = content.scrollHeight;
      content.style.height = currentHeight + 'px'; // lock in starting height
      // force reflow so the browser registers the starting height
      content.offsetHeight;
      content.style.height = '0px';
      content.style.opacity = '0';
      content.style.padding = '0';
    } else {
      // Expanding: animate from 0 to measured scrollHeight
      content.style.height = content.scrollHeight + 'px';
      content.style.opacity = '1';
      content.style.padding = '15px 10px';

      // After the transition ends, let height go back to auto
      // so content can resize naturally (e.g. window resize, dynamic content)
      content.addEventListener('transitionend', function handler(e) {
        if (e.propertyName === 'height') {
          content.style.height = 'auto';
          content.removeEventListener('transitionend', handler);
        }
      });
    }
  });
});
