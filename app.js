const STORAGE_KEY = 'mariage_prestataires';
const GUESTS_KEY  = 'mariage_invites';

const PRESET_TYPES = [
  'Traiteur', 'DJ', 'Photographe', 'Vidéaste',
  'Salle', 'Fleuriste', 'Robe / Costume', 'Animation', 'Transport'
];

function isPresetType(type) {
  return PRESET_TYPES.includes(type);
}

const activeFilters = {
  payment: 'all',
  urgency: 'all',
  type:    'all',
};

// ===== Utilitaires =====

function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function generateId() {
  return Date.now().toString();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== localStorage =====

function loadVendors() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  let vendors;
  try {
    vendors = JSON.parse(raw);
  } catch (e) {
    console.error('[loadVendors] JSON corrompu, réinitialisation:', e);
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }

  if (!Array.isArray(vendors)) return [];

  let needsSave = false;
  vendors.forEach(v => {
    if (!v.id) {
      v.id = Date.now().toString() + Math.random().toString().slice(2, 6);
      needsSave = true;
    } else if (typeof v.id !== 'string') {
      v.id = String(v.id);
      needsSave = true;
    }
    if (typeof v.paid !== 'undefined' && !v.payments) {
      v.payments = v.paid > 0 ? [{ amount: v.paid, date: '' }] : [];
      delete v.paid;
      needsSave = true;
    }
    if (!v.payments) { v.payments = []; needsSave = true; }
  });

  if (needsSave) localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors));
  console.log('[loadVendors] clé=' + STORAGE_KEY + ' | ' + vendors.length + ' prestataire(s) | ids:', vendors.map(v => v.id));
  return vendors;
}

function saveVendors(vendors) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors));
}

// ===== Calculs =====

function getPaidTotal(vendor) {
  if (!vendor.payments || vendor.payments.length === 0) return 0;
  return vendor.payments.reduce((sum, p) => sum + p.amount, 0);
}

function computeTotals(vendors) {
  const total     = vendors.reduce((sum, v) => sum + v.total, 0);
  const paid      = vendors.reduce((sum, v) => sum + getPaidTotal(v), 0);
  const remaining = total - paid;
  return { total, paid, remaining };
}

function getPaymentStatus(vendor) {
  const paid = getPaidTotal(vendor);
  if (paid <= 0)           return 'unpaid';
  if (paid < vendor.total) return 'partial';
  return 'paid';
}

function getUrgencyStatus(vendor) {
  if (getPaymentStatus(vendor) === 'paid') return 'normal';
  if (!vendor.dueDate)                     return 'normal';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(vendor.dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86_400_000);

  if (diffDays < 0)  return 'overdue';
  if (diffDays <= 7) return 'urgent';
  return 'normal';
}

// ===== Filtrage =====

function filterVendors(vendors) {
  return vendors.filter(v => {
    const matchPayment = activeFilters.payment === 'all' || getPaymentStatus(v) === activeFilters.payment;
    const matchUrgency = activeFilters.urgency === 'all' || getUrgencyStatus(v) === activeFilters.urgency;
    const matchType    = activeFilters.type    === 'all' || v.type === activeFilters.type;
    return matchPayment && matchUrgency && matchType;
  });
}

function buildTypeFilterOptions(vendors) {
  const select  = document.getElementById('filterType');
  const current = select.value;
  const types   = [...new Set(vendors.map(v => v.type))].sort((a, b) => a.localeCompare(b));

  select.innerHTML = '<option value="all">Tous les types</option>';
  types.forEach(type => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    if (type === current) opt.selected = true;
    select.appendChild(opt);
  });
}

function syncFilterUI() {
  document.querySelectorAll('.pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === activeFilters[btn.dataset.filter]);
  });

  const select = document.getElementById('filterType');
  if (select) select.value = activeFilters.type;

  const hasFilter = activeFilters.payment !== 'all' || activeFilters.urgency !== 'all' || activeFilters.type !== 'all';
  document.getElementById('btnResetFilters').style.display = hasFilter ? 'inline-flex' : 'none';
}

// ===== TODO dashboard =====

function getTodoDashboardUrgency(todo) {
  if (!todo.dueDate) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(todo.dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 7) return 'urgent';
  if (due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth()) return 'month';
  return 'none';
}

function getAllTodos(vendors) {
  const URGENCY_ORDER = { overdue: 0, urgent: 1, month: 2 };
  const result = [];

  vendors.forEach(vendor => {
    (vendor.todos || []).forEach(todo => {
      if (todo.done) return;
      const urgency = getTodoDashboardUrgency(todo);
      if (urgency === 'none') return;
      result.push({ vendor, todo, urgency });
    });
  });

  return result.sort((a, b) => {
    const ud = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (ud !== 0) return ud;
    return a.todo.dueDate.localeCompare(b.todo.dueDate);
  });
}

function renderTodoDashboard(vendors) {
  const section = document.getElementById('todoDashboardSection');
  const list    = document.getElementById('todoDashboardList');
  const todos   = getAllTodos(vendors);

  if (todos.length === 0) {
    section.style.display = 'none';
    return;
  }

  document.getElementById('todoTotalCount').textContent = todos.length;
  section.style.display = 'block';

  const GROUPS = [
    { key: 'overdue', label: '🚨 En retard',    cls: 'overdue' },
    { key: 'urgent',  label: '⚠️ Cette semaine', cls: 'urgent'  },
    { key: 'month',   label: '📅 Ce mois-ci',    cls: 'month'   },
  ];

  list.innerHTML = GROUPS
    .map(({ key, label, cls }) => {
      const items = todos.filter(t => t.urgency === key);
      if (items.length === 0) return '';

      const itemsHtml = items.map(({ vendor, todo }) => `
        <a class="todo-dash-item todo-dash-item--${cls}" href="vendor.html?id=${escapeHtml(vendor.id)}">
          <span class="todo-dash-vendor">${escapeHtml(vendor.name)}</span>
          <span class="todo-dash-text">${escapeHtml(todo.text)}</span>
          <span class="todo-dash-due">${formatDate(todo.dueDate)}</span>
          <span class="todo-dash-arrow">→</span>
        </a>
      `).join('');

      return `
        <div class="todo-dash-group">
          <h3 class="todo-dash-group-title todo-dash-group-title--${cls}">
            ${label} <span class="count-badge">${items.length}</span>
          </h3>
          <div class="todo-dash-group-items">${itemsHtml}</div>
        </div>
      `;
    })
    .join('');
}

// ===== Rendu d'une ligne =====

function createRow(vendor) {
  const paidTotal = getPaidTotal(vendor);
  const remaining = vendor.total - paidTotal;
  const status    = getPaymentStatus(vendor);
  const urgency   = getUrgencyStatus(vendor);
  const payCount  = vendor.payments ? vendor.payments.length : 0;

  const statusConfig = {
    unpaid:  { cls: 'badge-unpaid',  label: 'À payer' },
    partial: { cls: 'badge-partial', label: 'Acompte' },
    paid:    { cls: 'badge-paid',    label: 'Payé ✅' },
  };
  const urgencyConfig = {
    overdue: { cls: 'badge-overdue', label: 'EN RETARD' },
    urgent:  { cls: 'badge-urgent',  label: 'URGENT'    },
    normal:  null,
  };

  const { cls, label } = statusConfig[status];
  const urgencyBadge   = urgencyConfig[urgency]
    ? `<span class="badge ${urgencyConfig[urgency].cls}">${urgencyConfig[urgency].label}</span>`
    : '';

  const tr = document.createElement('tr');
  tr.classList.add(`row-${status}`);
  if (urgency !== 'normal') tr.classList.add(`row-${urgency}`);

  const typeClass       = vendor.isCustomType ? 'type-tag-custom' : 'type-tag';
  const payCountBadge   = payCount > 0
    ? `<span class="payment-count-badge">${payCount}</span>`
    : '';

  tr.innerHTML = `
    <td class="td-name"><strong>${escapeHtml(vendor.name)}</strong></td>
    <td class="td-type"><span class="${typeClass}">${escapeHtml(vendor.type)}</span></td>
    <td class="td-total"    data-label="Total">${formatCurrency(vendor.total)}</td>
    <td class="td-paid"     data-label="Payé">${formatCurrency(paidTotal)}${payCountBadge}</td>
    <td class="td-remaining ${remaining > 0 ? 'amount-remaining' : 'amount-zero'}" data-label="Reste">
      ${formatCurrency(remaining)}
    </td>
    <td class="td-status"><span class="badge ${cls}">${label}</span></td>
    <td class="td-due due-cell" data-label="Échéance">
      ${formatDate(vendor.dueDate)}
      ${urgencyBadge}
    </td>
    <td class="td-actions action-cell">
      <a class="btn-view" href="vendor.html?id=${vendor.id}">👁 Voir</a>
      <button class="btn-add-payment" data-id="${vendor.id}">+ Paiement</button>
      <button class="btn-history"     data-id="${vendor.id}">📋 Historique${payCount > 0 ? ` (${payCount})` : ''}</button>
      <button class="btn-delete"      data-id="${vendor.id}">Supprimer</button>
    </td>
  `;
  return tr;
}

// ===== Rendu principal =====

function renderTotals(vendors) {
  const { total, paid, remaining } = computeTotals(vendors);
  document.getElementById('totalBudget').textContent    = formatCurrency(total);
  document.getElementById('totalPaid').textContent      = formatCurrency(paid);
  document.getElementById('totalRemaining').textContent = formatCurrency(remaining);
}

function renderCount(count) {
  document.getElementById('vendorCount').textContent = count;
}

function renderAlerts(vendors) {
  const section = document.getElementById('alertsSection');
  if (vendors.length === 0) { section.style.display = 'none'; return; }

  const overdue = vendors.filter(v => getUrgencyStatus(v) === 'overdue').length;
  const urgent  = vendors.filter(v => getUrgencyStatus(v) === 'urgent').length;
  const paid    = vendors.filter(v => getPaymentStatus(v) === 'paid').length;

  document.getElementById('countOverdue').textContent = overdue;
  document.getElementById('countUrgent').textContent  = urgent;
  document.getElementById('countPaid').textContent    = paid;

  document.getElementById('alertOverdue').classList.toggle('alert-zero', overdue === 0);
  document.getElementById('alertUrgent').classList.toggle('alert-zero', urgent === 0);

  section.style.display = 'grid';
}

function renderVendors() {
  const vendors      = loadVendors();
  const filtered     = filterVendors(vendors);
  const tbody        = document.getElementById('vendorsBody');
  const emptyState   = document.getElementById('emptyState');
  const tableWrapper = document.getElementById('tableWrapper');

  document.getElementById('filtersBar').style.display = vendors.length > 0 ? 'flex' : 'none';

  buildTypeFilterOptions(vendors);
  syncFilterUI();

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.style.display   = 'block';
    tableWrapper.style.display = 'none';

    const isFiltered = vendors.length > 0;
    document.getElementById('emptyStateMsg').textContent       = isFiltered
      ? 'Aucun prestataire ne correspond aux filtres.'
      : 'Aucun prestataire ajouté pour l\'instant.';
    document.getElementById('emptyStateHint').style.display    = isFiltered ? 'none' : 'block';
  } else {
    emptyState.style.display   = 'none';
    tableWrapper.style.display = 'block';

    const URGENCY_ORDER = { overdue: 0, urgent: 1, normal: 2 };
    const PAYMENT_ORDER = { unpaid: 0, partial: 1, paid: 2 };
    const sorted = [...filtered].sort((a, b) => {
      const ud = URGENCY_ORDER[getUrgencyStatus(a)] - URGENCY_ORDER[getUrgencyStatus(b)];
      if (ud !== 0) return ud;
      return PAYMENT_ORDER[getPaymentStatus(a)] - PAYMENT_ORDER[getPaymentStatus(b)];
    });
    sorted.forEach(v => tbody.appendChild(createRow(v)));
  }

  renderTotals(vendors);
  renderCount(filtered.length);
  renderAlerts(vendors);
  renderTodoDashboard(vendors);
}

// ===== Formulaire ajout prestataire =====

function resolveType() {
  const selected   = document.getElementById('vendorType').value;
  const customText = document.getElementById('vendorCustomType').value.trim();
  if (selected === 'Autre' && customText) return customText;
  return selected;
}

function addVendor(event) {
  event.preventDefault();

  const name        = document.getElementById('vendorName').value.trim();
  const type        = resolveType();
  const total       = parseFloat(document.getElementById('vendorTotal').value) || 0;
  const initialPaid = parseFloat(document.getElementById('vendorPaid').value)  || 0;
  const dueDate     = document.getElementById('vendorDueDate').value;

  if (!name || !type || type === 'Autre') {
    if (type === 'Autre') document.getElementById('vendorCustomType').focus();
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  const vendor = {
    id: generateId(),
    name,
    type,
    isCustomType: !isPresetType(type),
    total,
    payments: initialPaid > 0 ? [{ amount: initialPaid, date: today }] : [],
    dueDate
  };

  const vendors = loadVendors();
  vendors.push(vendor);
  saveVendors(vendors);

  event.target.reset();
  toggleCustomTypeField();
  renderVendors();
}

function toggleCustomTypeField() {
  const select      = document.getElementById('vendorType');
  const group       = document.getElementById('customTypeGroup');
  const customInput = document.getElementById('vendorCustomType');
  const isOther     = select.value === 'Autre';

  if (isOther) {
    group.style.display = 'flex';
    setTimeout(() => customInput.focus(), 50);
  } else {
    group.style.display = 'none';
    customInput.value   = '';
  }
}

// ===== Suppression prestataire =====

function deleteVendor(id) {
  saveVendors(loadVendors().filter(v => v.id !== id));
  renderVendors();
}

function handleTableClick(event) {
  const btn = event.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains('btn-delete')) {
    const name = btn.closest('tr').querySelector('strong').textContent;
    if (confirm(`Supprimer le prestataire « ${name} » ?`)) deleteVendor(id);
  } else if (btn.classList.contains('btn-add-payment')) {
    openAddPaymentModal(id);
  } else if (btn.classList.contains('btn-history')) {
    openPaymentHistoryModal(id);
  }
}

// ===== Filtres =====

function handleFilterClick(event) {
  const btn = event.target.closest('.pill');
  if (!btn) return;
  activeFilters[btn.dataset.filter] = btn.dataset.value;
  renderVendors();
}

function handleTypeFilterChange() {
  activeFilters.type = document.getElementById('filterType').value;
  renderVendors();
}

function resetFilters() {
  activeFilters.payment = 'all';
  activeFilters.urgency = 'all';
  activeFilters.type    = 'all';
  renderVendors();
}

// ===== Modal paiements =====

function closeModal() {
  document.getElementById('paymentModal').style.display = 'none';
  document.getElementById('modalBody').innerHTML = '';
}

function openAddPaymentModal(vendorId) {
  const vendor    = loadVendors().find(v => v.id === vendorId);
  if (!vendor) return;

  const paidTotal = getPaidTotal(vendor);
  const remaining = vendor.total - paidTotal;
  const today     = new Date().toISOString().split('T')[0];

  document.getElementById('modalTitle').textContent = `Ajouter un paiement — ${vendor.name}`;

  document.getElementById('modalBody').innerHTML = `
    <form id="paymentForm" class="modal-form">
      <div class="form-group">
        <label for="paymentAmount">Montant (€)</label>
        <input type="number" id="paymentAmount" min="0.01" step="0.01"
               placeholder="0,00" ${remaining > 0 ? `max="${remaining}"` : ''} required />
        ${remaining > 0 ? `<span class="field-hint">Reste à payer : ${formatCurrency(remaining)}</span>` : ''}
      </div>
      <div class="form-group">
        <label for="paymentDate">Date du paiement</label>
        <input type="date" id="paymentDate" value="${today}" required />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="btnCancelPayment">Annuler</button>
        <button type="submit" class="btn-primary">Enregistrer</button>
      </div>
    </form>
  `;

  document.getElementById('paymentModal').style.display = 'flex';
  setTimeout(() => document.getElementById('paymentAmount').focus(), 50);

  document.getElementById('paymentForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const date   = document.getElementById('paymentDate').value;
    if (!amount || amount <= 0) return;

    const vendors = loadVendors();
    const v = vendors.find(v => v.id === vendorId);
    if (v) {
      v.payments.push({ amount, date });
      saveVendors(vendors);
      closeModal();
      renderVendors();
    }
  });

  document.getElementById('btnCancelPayment').addEventListener('click', closeModal);
}

function openPaymentHistoryModal(vendorId) {
  const vendor = loadVendors().find(v => v.id === vendorId);
  if (!vendor) return;

  const paidTotal = getPaidTotal(vendor);
  const payments  = vendor.payments || [];

  document.getElementById('modalTitle').textContent = `Historique des paiements — ${vendor.name}`;

  const listHtml = payments.length === 0
    ? '<p class="empty-payments">Aucun paiement enregistré.</p>'
    : payments.map((p, idx) => `
        <div class="payment-item">
          <div class="payment-info">
            <span class="payment-amount">${formatCurrency(p.amount)}</span>
            <span class="payment-date">${formatDate(p.date)}</span>
          </div>
          <button class="btn-delete-payment" data-idx="${idx}" title="Supprimer ce paiement">✕</button>
        </div>
      `).join('');

  document.getElementById('modalBody').innerHTML = `
    <div class="payments-list" id="paymentsList">${listHtml}</div>
    <div class="payment-total-row">
      Total payé : <strong>${formatCurrency(paidTotal)}</strong>
      <span class="payment-total-sub">sur ${formatCurrency(vendor.total)}</span>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="btnCloseHistory">Fermer</button>
      <button type="button" class="btn-primary"   id="btnGoAddPayment">+ Ajouter un paiement</button>
    </div>
  `;

  document.getElementById('paymentModal').style.display = 'flex';

  document.getElementById('btnCloseHistory').addEventListener('click', closeModal);
  document.getElementById('btnGoAddPayment').addEventListener('click', () => {
    closeModal();
    openAddPaymentModal(vendorId);
  });

  document.getElementById('paymentsList').addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete-payment');
    if (!btn) return;
    const idx     = parseInt(btn.dataset.idx);
    const vendors = loadVendors();
    const v       = vendors.find(v => v.id === vendorId);
    if (v) {
      v.payments.splice(idx, 1);
      saveVendors(vendors);
      closeModal();
      renderVendors();
    }
  });
}

// ===== Export / Import Drive =====

function showDriveFeedback(msg, isError = false) {
  const el = document.getElementById('driveFeedback');
  el.textContent = msg;
  el.className = 'drive-feedback' + (isError ? ' drive-feedback--error' : '');
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

function isIPhone() {
  return /iPhone/i.test(navigator.userAgent);
}

function exportData() {
  const vendors = loadVendors();
  const blob    = new Blob([JSON.stringify(vendors, null, 2)], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href     = url;
  a.download = 'mariage_data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (isIPhone()) {
    showDriveFeedback('✓ Fichier téléchargé. Sur iPhone, ouvrez l\'app Fichiers puis partagez le fichier vers Google Drive.');
  } else {
    showDriveFeedback('✓ Fichier téléchargé. Déposez-le dans Google Drive.');
    setTimeout(() => window.open('https://drive.google.com', '_blank', 'noopener,noreferrer'), 500);
  }
}

function importData(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    let vendors;
    try {
      vendors = JSON.parse(e.target.result);
    } catch {
      showDriveFeedback('Erreur : le fichier n\'est pas un JSON valide.', true);
      return;
    }

    if (!Array.isArray(vendors)) {
      showDriveFeedback('Erreur : le fichier ne contient pas une liste de prestataires.', true);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors));
    renderVendors();
    showDriveFeedback(`✓ ${vendors.length} prestataire(s) importé(s) avec succès.`);
  };
  reader.readAsText(file);
}

// ===== Invités =====

function loadGuests() {
  const raw = localStorage.getItem(GUESTS_KEY);
  if (!raw) return [];
  try {
    const guests = JSON.parse(raw);
    return Array.isArray(guests) ? guests : [];
  } catch (e) {
    console.error('[loadGuests] JSON corrompu:', e);
    return [];
  }
}

function guestInvited(g) {
  return Number(g.count) || 0;
}

function guestConfirmed(g) {
  const invited = guestInvited(g);
  if (g.confirmedCount == null) {
    return g.status === 'confirmed' ? invited : 0;  // repli données héritées
  }
  return Math.max(0, Math.min(Number(g.confirmedCount) || 0, invited));
}

function guestStatus(g) {
  if (g.confirmedCount == null) {
    if (g.status === 'confirmed') return 'confirmed';
    if (g.status === 'declined')  return 'declined';
    return 'pending';
  }
  const confirmed = guestConfirmed(g);
  if (confirmed <= 0)                  return 'declined';
  if (confirmed >= guestInvited(g))    return 'confirmed';
  return 'partial';
}

function renderGuestsSummary() {
  const guests = loadGuests();
  const sum = fn => guests.reduce((n, g) => n + fn(g), 0);

  document.getElementById('guestsTotal').textContent     = guests.length;
  document.getElementById('guestsConfirmed').textContent = sum(guestConfirmed);
  document.getElementById('guestsPending').textContent   = sum(g => guestStatus(g) === 'pending' ? guestInvited(g) : 0);
}

// ===== Initialisation =====

document.getElementById('vendorForm').addEventListener('submit', addVendor);
document.getElementById('vendorsBody').addEventListener('click', handleTableClick);
document.getElementById('vendorType').addEventListener('change', toggleCustomTypeField);
document.getElementById('filtersBar').addEventListener('click', handleFilterClick);
document.getElementById('filterType').addEventListener('change', handleTypeFilterChange);
document.getElementById('btnResetFilters').addEventListener('click', resetFilters);
document.getElementById('paymentModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});
document.getElementById('modalClose').addEventListener('click', closeModal);

document.getElementById('btnExport').addEventListener('click', exportData);
document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});
document.getElementById('importFileInput').addEventListener('change', e => {
  importData(e.target.files[0]);
  e.target.value = '';
});

renderVendors();
renderGuestsSummary();
