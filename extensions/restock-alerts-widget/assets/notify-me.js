/**
 * Back in Stock — Notify Me Widget
 * Loaded as a classic <script defer> tag from the Shopify theme via Liquid's
 * asset_url filter. No module system — pure IIFE.
 *
 * For testability, the core logic is also exported in notify-me.module.js
 * (ESM), which is imported by Vitest tests. Both files share the same
 * implementation — edit one, keep the other in sync.
 */
(function () {
  'use strict';

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function initForm(container) {
    var form = container.querySelector('.bis-form');
    var emailInput = container.querySelector('.bis-email-input');
    var submitBtn = container.querySelector('.bis-submit-btn');
    var successEl = container.querySelector('.bis-success');
    var errorEl = container.querySelector('.bis-error');

    if (!form || !emailInput || !submitBtn || !successEl || !errorEl) {
      return;
    }

    var variantId = container.dataset.variantId;
    var productId = container.dataset.productId;
    var productTitle = container.dataset.productTitle || '';
    var variantTitle = container.dataset.variantTitle || '';
    var shop = container.dataset.shop;
    var appUrl = container.dataset.appUrl;

    var isSubmitting = false;
    var submitted = false;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (submitted) return;
      if (isSubmitting) return;

      var email = emailInput.value.trim();

      // Clear previous messages
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      if (!isValidEmail(email)) {
        errorEl.textContent = 'Please enter a valid email address.';
        errorEl.style.display = '';
        emailInput.focus();
        return;
      }

      isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.setAttribute('aria-label', 'Submitting, please wait');
      var originalText = submitBtn.textContent;
      submitBtn.textContent = '...';

      fetch(appUrl + '/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: email,
          variantId: variantId,
          productId: productId,
          productTitle: productTitle,
          variantTitle: variantTitle,
          shop: shop,
        }),
      })
        .then(function (response) {
          if (response.ok) {
            submitted = true;
            emailInput.parentElement.style.display = 'none';
            submitBtn.style.display = 'none';
            successEl.style.display = '';
          } else {
            return response
              .json()
              .catch(function () {
                return null;
              })
              .then(function (data) {
                var message =
                  (data && data.error) ||
                  'Something went wrong. Please try again.';
                errorEl.textContent = message;
                errorEl.style.display = '';
              });
          }
        })
        .catch(function () {
          errorEl.textContent =
            'Unable to connect. Please check your connection and try again.';
          errorEl.style.display = '';
        })
        .finally(function () {
          if (!submitted) {
            isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-busy');
            submitBtn.removeAttribute('aria-label');
            submitBtn.textContent = originalText;
          }
        });
    });
  }

  // Guard: skip if no widgets present on this page
  var containers = document.querySelectorAll('.bis-notify-me');
  if (containers.length === 0) return;

  containers.forEach(initForm);
})();
