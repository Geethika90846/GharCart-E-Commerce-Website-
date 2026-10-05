// GharCart Client Application Logic

// 0. Session token management for cross-origin iframes
function getActiveSid() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSid = urlParams.get('sid');
    if (urlSid) {
      try { sessionStorage.setItem('gharcart_sid', urlSid); } catch (e) {}
      try { localStorage.setItem('gharcart_sid', urlSid); } catch (e) {}
      return urlSid;
    }
    
    // Check form input on the page if server rendered
    const inputSid = document.querySelector('input[name="sid"]')?.value;
    if (inputSid) {
      try { sessionStorage.setItem('gharcart_sid', inputSid); } catch (e) {}
      try { localStorage.setItem('gharcart_sid', inputSid); } catch (e) {}
      return inputSid;
    }

    let saved = '';
    try { saved = sessionStorage.getItem('gharcart_sid') || ''; } catch (e) {}
    if (!saved) {
      try { saved = localStorage.getItem('gharcart_sid') || ''; } catch (e) {}
    }
    return saved;
  } catch (e) {
    return '';
  }
}

function decorateUrl(url) {
  const sid = getActiveSid();
  if (!sid || typeof url !== 'string') return url;
  try {
    if (url.startsWith('/logout') || url.startsWith('/admin/logout')) return url;
    const parsed = new URL(url, window.location.origin);
    if (!parsed.searchParams.has('sid')) {
      parsed.searchParams.set('sid', sid);
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch (e) {
    return url;
  }
}

function secureFetch(url, options = {}) {
  const sid = getActiveSid();
  const headers = Object.assign({}, options.headers || {});
  if (sid) {
    headers['X-Session-ID'] = sid;
  }
  return fetch(decorateUrl(url), Object.assign({}, options, {
    credentials: 'include',
    headers
  }));
}

// 1. Toast Notification System
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const isSuccess = type === 'success';
  const isError = type === 'error';
  const isInfo = type === 'info';

  const bgColor = isSuccess ? 'bg-emerald-600' : isError ? 'bg-rose-600' : 'bg-indigo-600';
  const icon = isSuccess ? 'check-circle' : isError ? 'alert-triangle' : 'info';

  toast.className = `toast-enter flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-xl ${bgColor} max-w-sm pointer-events-auto transition-all`;
  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-5 h-5 flex-shrink-0"></i>
    <span class="text-sm font-medium flex-1">${message}</span>
    <button type="button" class="text-white/80 hover:text-white p-1" onclick="this.parentElement.remove()">
      <i data-lucide="x" class="w-4 h-4"></i>
    </button>
  `;

  container.appendChild(toast);
  if (window.lucide) {
    window.lucide.createIcons();
  }

  setTimeout(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// 2. Add to Cart AJAX
async function addToCart(productId, quantity = 1, btn = null) {
  let originalHtml = '';
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>Adding...</span>
    `;
  }

  try {
    const res = await secureFetch('/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      if (res.status === 401) {
        showToast('Please log in to add items to your cart.', 'error');
        setTimeout(() => { window.location.href = decorateUrl('/login'); }, 1200);
        return;
      }
      showToast(data.message || 'Could not add to cart.', 'error');
      return;
    }

    // Update cart badge
    updateCartBadge(data.cartCount);
    showToast(data.message || 'Added to cart!', 'success');
  } catch (err) {
    console.error('Cart add error:', err);
    showToast('Failed to add item to cart. Please try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// 3. Update Cart Badge UI
function updateCartBadge(count) {
  const badge = document.getElementById('nav-cart-badge');
  if (!badge) return;

  const num = parseInt(count, 10) || 0;
  badge.textContent = num;
  if (num > 0) {
    badge.classList.remove('hidden');
    badge.classList.add('animate-badge-pop');
    setTimeout(() => badge.classList.remove('animate-badge-pop'), 400);
  } else {
    badge.classList.add('hidden');
  }
}

// 4. Cart Page Actions: Update Quantity & Remove
async function updateCartItem(productId, quantity) {
  try {
    const res = await secureFetch('/api/cart/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.message || 'Failed to update item quantity.', 'error');
      return false;
    }

    updateCartBadge(data.cartCount);

    if (quantity <= 0) {
      const row = document.getElementById(`cart-row-${productId}`);
      if (row) row.remove();
      showToast('Item removed from cart.', 'info');
    } else {
      // Update item subtotal
      const itemSubtotalEl = document.getElementById(`item-total-${productId}`);
      if (itemSubtotalEl) {
        itemSubtotalEl.textContent = '₹' + Number(data.itemTotal).toLocaleString('en-IN');
      }
      const qtyInput = document.getElementById(`qty-input-${productId}`);
      if (qtyInput) qtyInput.value = quantity;
    }

    // Update summary
    updateOrderSummary(data.subtotal, data.deliveryFee, data.total, data.cartCount);
    return true;
  } catch (err) {
    console.error('Cart update error:', err);
    showToast('Connection error updating cart.', 'error');
    return false;
  }
}

async function removeCartItem(productId) {
  try {
    const res = await secureFetch('/api/cart/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.message || 'Failed to remove item.', 'error');
      return;
    }

    const row = document.getElementById(`cart-row-${productId}`);
    if (row) {
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      row.style.transition = 'all 0.3s ease';
      setTimeout(() => row.remove(), 300);
    }

    updateCartBadge(data.cartCount);
    updateOrderSummary(data.subtotal, data.deliveryFee, data.total, data.cartCount);
    showToast('Item removed from cart.', 'info');
  } catch (err) {
    console.error('Cart remove error:', err);
    showToast('Could not remove item.', 'error');
  }
}

function updateOrderSummary(subtotal, deliveryFee, total, cartCount) {
  const subtotalEl = document.getElementById('summary-subtotal');
  const deliveryEl = document.getElementById('summary-delivery');
  const totalEl = document.getElementById('summary-total');
  const freeShipBadge = document.getElementById('free-shipping-progress');

  if (subtotalEl) subtotalEl.textContent = '₹' + Number(subtotal).toLocaleString('en-IN');
  if (deliveryEl) {
    if (deliveryFee === 0 && subtotal > 0) {
      deliveryEl.innerHTML = '<span class="text-emerald-600 font-semibold">FREE</span>';
    } else {
      deliveryEl.textContent = '₹' + Number(deliveryFee).toLocaleString('en-IN');
    }
  }
  if (totalEl) totalEl.textContent = '₹' + Number(total).toLocaleString('en-IN');

  if (freeShipBadge) {
    if (subtotal >= 999) {
      freeShipBadge.innerHTML = '🎉 You qualified for <b>FREE Delivery</b>!';
      freeShipBadge.className = 'text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-center font-medium';
    } else if (subtotal > 0) {
      const needed = 999 - subtotal;
      freeShipBadge.innerHTML = `Add <b>₹${needed.toLocaleString('en-IN')}</b> more to unlock <b>FREE Delivery</b>!`;
      freeShipBadge.className = 'text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800 text-center font-medium';
    }
  }

  // If cart is now empty, reload to show empty state
  if (cartCount === 0) {
    const cartContainer = document.getElementById('cart-items-container');
    const emptyState = document.getElementById('cart-empty-state');
    if (cartContainer && emptyState) {
      cartContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');
    }
  }
}

// 5. Notifications Dropdown & Read Handler
async function toggleNotifications() {
  const dropdown = document.getElementById('notif-dropdown');
  const badge = document.getElementById('notif-badge');
  if (!dropdown) return;

  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');

    // Fetch latest notifications
    try {
      const res = await secureFetch('/api/notifications');
      const data = await res.json();
      const listContainer = document.getElementById('notif-list');

      if (listContainer && data.notifications) {
        if (data.notifications.length === 0) {
          listContainer.innerHTML = '<div class="p-4 text-center text-sm text-slate-500">No notifications yet.</div>';
        } else {
          listContainer.innerHTML = data.notifications.map(n => `
            <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${!n.is_read ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : ''}">
              <p class="text-xs text-slate-800 dark:text-slate-200 leading-snug">${n.message}</p>
              <span class="text-[10px] text-slate-400 mt-1 block">${new Date(n.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          `).join('');
        }
      }

      // Mark as read
      if (badge && !badge.classList.contains('hidden')) {
        await secureFetch('/api/notifications/read', { method: 'POST' });
        badge.classList.add('hidden');
      }
    } catch (e) {
      console.error('Failed to load notifications:', e);
    }
  } else {
    dropdown.classList.add('hidden');
  }
}

// Close notifications when clicking outside
document.addEventListener('click', (e) => {
  const notifContainer = document.getElementById('notif-container');
  const dropdown = document.getElementById('notif-dropdown');
  if (dropdown && notifContainer && !notifContainer.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// 6. Admin Order Status AJAX
async function updateAdminOrderStatus(orderId, newStatus, selectEl) {
  const originalVal = selectEl.getAttribute('data-prev') || selectEl.value;
  selectEl.disabled = true;

  try {
    const res = await secureFetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.message || 'Failed to update order status.', 'error');
      selectEl.value = originalVal;
      return;
    }

    selectEl.setAttribute('data-prev', newStatus);
    showToast(`Order #${orderId} updated to ${newStatus}`, 'success');

    // Update status badge styling on the card if present
    const badgeEl = document.getElementById(`status-badge-${orderId}`);
    if (badgeEl) {
      badgeEl.textContent = newStatus;
      badgeEl.className = 'px-3 py-1 text-xs font-semibold rounded-full ' + getStatusBadgeClass(newStatus);
    }
  } catch (err) {
    console.error('Update status error:', err);
    showToast('Failed to update status.', 'error');
    selectEl.value = originalVal;
  } finally {
    selectEl.disabled = false;
  }
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'Placed': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
    case 'Shipped': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';
    case 'Delivered': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300';
    case 'Cancelled': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300';
    default: return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
  }
}

// 7. Admin Delete Product AJAX
async function deleteProduct(productId, productName) {
  if (!confirm(`Are you sure you want to delete "${productName}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await secureFetch(`/api/admin/products/${productId}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.message || 'Failed to delete product.', 'error');
      return;
    }

    const row = document.getElementById(`admin-product-${productId}`);
    if (row) {
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 250);
    }

    showToast(data.message || 'Product deleted.', 'info');
  } catch (err) {
    console.error('Delete product error:', err);
    showToast('Failed to delete product.', 'error');
  }
}

// 8. Dark Mode Manager
function initTheme() {
  const saved = localStorage.getItem('gharcart_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('gharcart_theme', isDark ? 'dark' : 'light');
  if (window.lucide) window.lucide.createIcons();
}

// Execute on load & decorate links/forms with sid if needed for iframe third-party cookie restrictions
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  getActiveSid(); // extracts sid from query if present

  const sid = getActiveSid();
  if (sid) {
    // Add sid to internal navigation links if not present
    document.querySelectorAll('a[href^="/"]').forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('/logout') && !href.startsWith('/admin/logout') && !href.includes('sid=')) {
        link.setAttribute('href', decorateUrl(href));
      }
    });

    // Add hidden input to forms if not present
    document.querySelectorAll('form[action^="/"]').forEach(form => {
      const action = form.getAttribute('action');
      if (action && !action.includes('sid=')) {
        if (!form.querySelector('input[name="sid"]')) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'sid';
          input.value = sid;
          form.appendChild(input);
        }
      }
    });
  }

  // Dynamic link click listener to guarantee sid is appended
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="/"]');
    if (link) {
      const href = link.getAttribute('href');
      const currentSid = getActiveSid();
      if (currentSid && href && !href.startsWith('/logout') && !href.startsWith('/admin/logout') && !href.includes('sid=')) {
        link.setAttribute('href', decorateUrl(href));
      }
    }
  }, true);

  // Dynamic form submit listener to ensure sid is submitted
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form && form.tagName === 'FORM') {
      const currentSid = getActiveSid();
      if (currentSid && !form.querySelector('input[name="sid"]')) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'sid';
        input.value = currentSid;
        form.appendChild(input);
      }
    }
  }, true);

  if (window.lucide) {
    window.lucide.createIcons();
  }
});
