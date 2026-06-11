const STORAGE_KEY = 'mariage_prestataires';

// ===== Utilitaires =====

function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Parse 'YYYY-MM-DD' en date LOCALE (new Date('YYYY-MM-DD') parse en UTC :
// décalage d'un jour possible selon le fuseau horaire)
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getPaidTotal(vendor) {
  if (!vendor.payments || vendor.payments.length === 0) return 0;
  return vendor.payments.reduce((sum, p) => sum + p.amount, 0);
}

function getPaymentStatus(vendor) {
  const paid = getPaidTotal(vendor);
  if (paid <= 0)           return 'unpaid';
  if (paid < vendor.total) return 'partial';
  return 'paid';
}

function getUrgencyStatus(vendor) {
  if (getPaymentStatus(vendor) === 'paid') return 'normal';
  if (!vendor.dueDate) return 'normal';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseLocalDate(vendor.dueDate);
  const diffDays = Math.round((due - today) / 86_400_000);

  if (diffDays < 0)  return 'overdue';
  if (diffDays <= 7) return 'urgent';
  return 'normal';
}

// ===== localStorage =====

function loadVendors() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  let vendors;
  try {
    vendors = JSON.parse(raw);
  } catch (e) {
    console.error('[vendor/loadVendors] JSON corrompu:', e);
    return [];
  }

  return Array.isArray(vendors) ? vendors : [];
}

function saveVendors(vendors) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors));
  } catch (e) {
    console.error('[saveVendors]', e);
    alert('Erreur : impossible d\'enregistrer les données (stockage plein ou indisponible).');
  }
}

function loadVendor(id) {
  const vendors = loadVendors();
  console.log('[vendor] recherche id:', id, '| ids disponibles:', vendors.map(v => v.id));
  const found = vendors.find(v => String(v.id) === String(id));
  if (!found) console.warn('[vendor] prestataire introuvable pour id:', id);
  return found || null;
}

// ===== État global =====

let currentVendorId = null;

// ===== Rendu de la page =====

function renderPage() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) return showError();

  const vendor = loadVendor(id);
  if (!vendor) return showError();

  currentVendorId = id;

  // Titre
  document.title = `${vendor.name} — Mariage`;
  document.getElementById('pageTitle').textContent = vendor.name;

  const typeClass = vendor.isCustomType ? 'type-tag-custom' : 'type-tag';
  document.getElementById('pageSubtitle').innerHTML =
    `<span class="${typeClass}">${escapeHtml(vendor.type)}</span>`;

  // Résumé financier
  const paidTotal = getPaidTotal(vendor);
  const remaining = vendor.total - paidTotal;
  const status    = getPaymentStatus(vendor);
  const urgency   = getUrgencyStatus(vendor);

  document.getElementById('vTotal').textContent = formatCurrency(vendor.total);
  document.getElementById('vPaid').textContent  = formatCurrency(paidTotal);

  const remainingEl = document.getElementById('vRemaining');
  remainingEl.textContent = formatCurrency(remaining);
  remainingEl.className   = 'finance-value ' + (remaining > 0 ? 'finance-value--remaining' : 'finance-value--zero');

  const statusLabels  = { unpaid: 'À payer', partial: 'Acompte versé', paid: 'Payé ✅' };
  const statusClasses = { unpaid: 'badge-unpaid', partial: 'badge-partial', paid: 'badge-paid' };
  document.getElementById('vStatusBadge').innerHTML =
    `<span class="badge ${statusClasses[status]}">${statusLabels[status]}</span>`;

  document.getElementById('vDueDate').value = vendor.dueDate || '';

  const urgencyEl = document.getElementById('vUrgencyBadge');
  if (urgency === 'overdue') {
    urgencyEl.innerHTML = '<span class="badge badge-overdue">EN RETARD</span>';
  } else if (urgency === 'urgent') {
    urgencyEl.innerHTML = '<span class="badge badge-urgent">URGENT</span>';
  } else {
    urgencyEl.innerHTML = '';
  }

  // Coordonnées
  document.getElementById('fPhone').value   = vendor.phone   || '';
  document.getElementById('fEmail').value   = vendor.email   || '';
  document.getElementById('fAddress').value = vendor.address || '';

  const siteWeb = vendor.siteWeb || '';
  document.getElementById('fSiteWeb').value = siteWeb;
  updateSiteWebButton(siteWeb);

  // Administratif
  document.getElementById('fDevisRecu').checked     = vendor.devisRecu     || false;
  document.getElementById('fContratSigne').checked  = vendor.contratSigne  || false;
  document.getElementById('fAcompteValide').checked = vendor.acompteValide || false;
  const contrat = vendor.contrat || '';
  document.getElementById('fContrat').value = contrat;
  updateContratButton(contrat);
  document.getElementById('fRib').value = vendor.rib || '';

  // Organisation
  document.getElementById('fHeurePrestation').value  = vendor.heurePrestation  || '';
  document.getElementById('fLieuPrestation').value   = vendor.lieuPrestation   || '';
  document.getElementById('fProchaineAction').value  = vendor.prochaineAction  || '';

  // Notes
  document.getElementById('fNotes').value = vendor.notes || '';

  // Hint "reste à payer"
  const hint = document.getElementById('remainingHint');
  hint.textContent = remaining > 0
    ? `Reste à payer : ${formatCurrency(remaining)}`
    : 'Entièrement payé';

  renderPayments(vendor);
  renderTodos(vendor);
  renderContactBar(vendor);
}

function renderContactBar(vendor) {
  const bar     = document.getElementById('contactBar');
  const btnCall = document.getElementById('btnCall');
  const btnSms  = document.getElementById('btnSms');
  const btnMail = document.getElementById('btnMail');

  const phone = (vendor.phone || '').trim().replace(/\s+/g, '');
  const email = (vendor.email || '').trim();

  if (!phone && !email) { bar.style.display = 'none'; return; }

  if (phone) {
    btnCall.href          = `tel:${phone}`;
    btnCall.style.display = 'inline-flex';
    btnSms.href           = `sms:${phone}`;
    btnSms.style.display  = 'inline-flex';
  } else {
    btnCall.style.display = 'none';
    btnSms.style.display  = 'none';
  }

  if (email) {
    const subject = encodeURIComponent(`Mariage — ${vendor.name}`);
    const body    = encodeURIComponent(`Bonjour,\n\nSuite à notre échange concernant notre mariage…\n\nCordialement`);
    btnMail.href          = `mailto:${email}?subject=${subject}&body=${body}`;
    btnMail.style.display = 'inline-flex';
  } else {
    btnMail.style.display = 'none';
  }

  bar.style.display = 'flex';
}

function updateSiteWebButton(url) {
  const btn = document.getElementById('btnOpenSite');
  if (url && url.trim()) {
    btn.href = url.trim();
    btn.style.display = 'inline-flex';
  } else {
    btn.href = '#';
    btn.style.display = 'none';
  }
}

function updateContratButton(url) {
  const btn = document.getElementById('btnOpenContrat');
  if (url && url.trim()) {
    btn.href = url.trim();
    btn.style.display = 'inline-flex';
  } else {
    btn.href = '#';
    btn.style.display = 'none';
  }
}

function renderPayments(vendor) {
  const list     = document.getElementById('paymentsList');
  const payments = vendor.payments || [];

  document.getElementById('payCount').textContent = payments.length;

  if (payments.length === 0) {
    list.innerHTML = '<p class="empty-payments">Aucun paiement enregistré.</p>';
    return;
  }

  list.innerHTML = payments.map((p, idx) => `
    <div class="payment-item">
      <div class="payment-info">
        <span class="payment-amount">${formatCurrency(p.amount)}</span>
        <span class="payment-date">${formatDate(p.date)}</span>
      </div>
      <button class="btn-delete-payment" data-idx="${idx}" title="Supprimer ce paiement">✕</button>
    </div>
  `).join('');
}

// ===== TODO list =====

function getTodoUrgency(todo) {
  if (todo.done) return 'done';
  if (!todo.dueDate) return 'normal';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseLocalDate(todo.dueDate);
  const diffDays = Math.round((due - today) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 7) return 'urgent';
  return 'normal';
}

function renderTodos(vendor) {
  const list  = document.getElementById('todoList');
  const todos = vendor.todos || [];
  const pending = todos.filter(t => !t.done).length;
  document.getElementById('todoCount').textContent = pending;

  if (todos.length === 0) {
    list.innerHTML = '<p class="empty-todos">Aucune tâche enregistrée.</p>';
    return;
  }

  list.innerHTML = todos.map((t, idx) => {
    const urgency   = getTodoUrgency(t);
    const itemClass = urgency === 'done'    ? 'todo-item--done'
                    : urgency === 'overdue' ? 'todo-item--overdue'
                    : urgency === 'urgent'  ? 'todo-item--urgent'
                    : '';
    const label = urgency === 'overdue' ? ' — EN RETARD'
                : urgency === 'urgent'  ? ' — URGENT'
                : '';
    const dueBadge = t.dueDate
      ? `<span class="todo-due">${formatDate(t.dueDate)}${label}</span>`
      : '';
    return `
      <div class="todo-item ${itemClass}">
        <input type="checkbox" class="todo-check" data-idx="${idx}" ${t.done ? 'checked' : ''} />
        <span class="todo-text">${escapeHtml(t.text)}</span>
        ${dueBadge}
        <button class="btn-delete-todo" data-idx="${idx}" title="Supprimer">✕</button>
      </div>
    `;
  }).join('');
}

function addTodo() {
  const text = document.getElementById('newTodoText').value.trim();
  if (!text) return;
  const dueDate = document.getElementById('newTodoDate').value;

  const vendors = loadVendors();
  const v = vendors.find(v => String(v.id) === String(currentVendorId));
  if (!v) return;
  if (!v.todos) v.todos = [];

  v.todos.push({ text, done: false, dueDate });
  saveVendors(vendors);

  document.getElementById('newTodoText').value = '';
  document.getElementById('newTodoDate').value = '';
  renderTodos(v);
}

function toggleTodo(idx) {
  const vendors = loadVendors();
  const v = vendors.find(v => String(v.id) === String(currentVendorId));
  if (!v || !v.todos || !v.todos[idx]) return;
  v.todos[idx].done = !v.todos[idx].done;
  saveVendors(vendors);
  renderTodos(v);
}

function deleteTodo(idx) {
  const vendors = loadVendors();
  const v = vendors.find(v => String(v.id) === String(currentVendorId));
  if (!v || !v.todos) return;
  v.todos.splice(idx, 1);
  saveVendors(vendors);
  renderTodos(v);
}

// ===== Paiements =====

function addPayment() {
  const amount = parseFloat(document.getElementById('newPayAmount').value);
  const date   = document.getElementById('newPayDate').value;
  if (!amount || amount <= 0 || !date) return;

  const vendors = loadVendors();
  const v = vendors.find(v => String(v.id) === String(currentVendorId));
  if (!v) return;

  const rest = v.total - getPaidTotal(v);
  if (amount > rest && !confirm(
    `Ce paiement (${formatCurrency(amount)}) dépasse le reste à payer (${formatCurrency(Math.max(rest, 0))}). Enregistrer quand même ?`
  )) return;

  v.payments.push({ amount, date });
  saveVendors(vendors);

  document.getElementById('newPayAmount').value = '';
  renderPage();
}

function deletePayment(idx) {
  const vendors = loadVendors();
  const v = vendors.find(v => String(v.id) === String(currentVendorId));
  if (!v) return;

  v.payments.splice(idx, 1);
  saveVendors(vendors);
  renderPage();
}

// ===== Sauvegarde =====

function saveVendorChanges() {
  const vendors = loadVendors();
  const v = vendors.find(v => String(v.id) === String(currentVendorId));
  if (!v) return;

  // Résumé
  v.dueDate = document.getElementById('vDueDate').value;

  // Coordonnées
  v.phone   = document.getElementById('fPhone').value.trim();
  v.email   = document.getElementById('fEmail').value.trim();
  v.address = document.getElementById('fAddress').value.trim();
  v.siteWeb = document.getElementById('fSiteWeb').value.trim();

  // Administratif
  v.devisRecu     = document.getElementById('fDevisRecu').checked;
  v.contratSigne  = document.getElementById('fContratSigne').checked;
  v.acompteValide = document.getElementById('fAcompteValide').checked;
  v.contrat       = document.getElementById('fContrat').value.trim();
  v.rib           = document.getElementById('fRib').value.trim();

  // Organisation
  v.heurePrestation  = document.getElementById('fHeurePrestation').value;
  v.lieuPrestation   = document.getElementById('fLieuPrestation').value.trim();
  v.prochaineAction  = document.getElementById('fProchaineAction').value.trim();

  // Notes
  v.notes = document.getElementById('fNotes').value.trim();

  saveVendors(vendors);
  showSaveFeedback();
}

function showSaveFeedback() {
  const el = document.getElementById('saveFeedback');
  el.textContent = '✓ Modifications enregistrées';
  el.classList.add('save-feedback--visible');
  setTimeout(() => el.classList.remove('save-feedback--visible'), 2500);
}

// ===== Erreur =====

function showError() {
  document.getElementById('vendorContent').style.display = 'none';
  document.getElementById('errorState').style.display    = 'block';
}

// ===== Initialisation =====

document.addEventListener('DOMContentLoaded', () => {
  renderPage();

  // Délégation sur la liste de paiements
  document.getElementById('paymentsList').addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete-payment');
    if (!btn) return;
    deletePayment(parseInt(btn.dataset.idx));
  });

  document.getElementById('btnAddPayment').addEventListener('click', addPayment);
  document.getElementById('btnSave').addEventListener('click', saveVendorChanges);

  // Entrée dans les champs de paiement
  document.getElementById('newPayAmount').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addPayment(); }
  });
  document.getElementById('newPayDate').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addPayment(); }
  });

  // Délégation sur la todo list
  document.getElementById('todoList').addEventListener('change', e => {
    if (e.target.classList.contains('todo-check')) {
      toggleTodo(parseInt(e.target.dataset.idx));
    }
  });
  document.getElementById('todoList').addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete-todo');
    if (!btn) return;
    deleteTodo(parseInt(btn.dataset.idx));
  });
  document.getElementById('btnAddTodo').addEventListener('click', addTodo);
  document.getElementById('newTodoText').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addTodo(); }
  });

  // Mise à jour dynamique des boutons "ouvrir"
  document.getElementById('fSiteWeb').addEventListener('input', e => {
    updateSiteWebButton(e.target.value);
  });
  document.getElementById('fContrat').addEventListener('input', e => {
    updateContratButton(e.target.value);
  });

  // Date du jour pour le nouveau paiement
  document.getElementById('newPayDate').value = new Date().toISOString().split('T')[0];
});
