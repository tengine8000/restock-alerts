/**
 * ESM re-export of notify-me.js logic — used by Vitest tests only.
 * NOT loaded by the Shopify theme. The browser loads notify-me.js (classic IIFE).
 *
 * Keep this file's implementation in sync with notify-me.js.
 */

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function initForm(container) {
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
          submitBtn.textContent = originalText;
        }
      });
  });
}

export function init(scope) {
  var root = scope || document;
  root.querySelectorAll('.bis-notify-me').forEach(initForm);
}
