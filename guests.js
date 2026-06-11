const GUESTS_KEY = 'mariage_invites';

// ===== Libellés =====

// Groupes connus (compatibilité) : clé stockée -> libellé affiché
const GROUP_LABELS = {
  famille:   'Famille',
  amis:      'Amis',
  collegues: 'Collègues',
};

const DEFAULT_GROUPS = ['Famille', 'Amis', 'Collègues'];

// Libellé d'affichage d'un groupe (connu, libre, ou vide)
function groupLabel(group) {
  if (!group) return 'Sans groupe';
  if (GROUP_LABELS[group]) return GROUP_LABELS[group];
  return group.charAt(0).toUpperCase() + group.slice(1);
}

// Classe CSS : couleur dédiée pour les groupes connus, neutre sinon
function groupChipClass(group) {
  return GROUP_LABELS[group] ? `guest-group guest-group--${group}` : 'guest-group';
}

// Normalise la saisie : mappe les groupes connus vers leur clé héritée,
// réutilise un groupe existant (insensible à la casse), sinon conserve la saisie
function normalizeGroupInput(value, existingGroups) {
  const v = value.trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  for (const [key, label] of Object.entries(GROUP_LABELS)) {
    if (lower === key || lower === label.toLowerCase()) return key;
  }
  const match = existingGroups.find(g => g.toLowerCase() === lower);
  return match || v;
}

const STATUS_LABELS = {
  pending:   'En attente',
  partial:   'Partiel',
  confirmed: 'Confirmé',
  declined:  'Refusé',
};

const STATUS_BADGE = {
  pending:   'badge-neutral',
  partial:   'badge-partial',
  confirmed: 'badge-paid',
  declined:  'badge-unpaid',
};

const STATUS_ORDER = {
  pending:   0,
  partial:   1,
  confirmed: 2,
  declined:  3,
};

const MEAL_LABELS = {
  standard:   'Standard',
  vegetarien: 'Végétarien',
  allergie:   'Allergie',
};

const MEAL_ICON = {
  standard:   '🍽️',
  vegetarien: '🥗',
  allergie:   '⚠️',
};

// ===== État =====

const PAGE_SIZE = 25;            // invités affichés par groupe avant « Afficher plus »

let editingId    = null;
let searchQuery  = '';
let activeStatus = 'all';
const openGroups  = {};          // clé groupe -> bool (ouvert par défaut)
const groupLimits = {};          // clé groupe -> nombre affiché
const expandedIds = new Set();

// ===== Utilitaires =====

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "Jean, Marie, Paul" -> ['Jean', 'Marie', 'Paul']
function splitNames(namesStr) {
  return (namesStr || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Affichage compact : 2 prénoms max, puis "(+X)"
function compactNames(arr) {
  if (arr.length <= 2) return arr.join(', ');
  return `${arr.slice(0, 2).join(', ')} (+${arr.length - 2})`;
}

function generateId() {
  return Date.now().toString();
}

// ===== Statut dérivé de confirmedCount =====

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
  const invited   = guestInvited(g);
  const confirmed = guestConfirmed(g);
  if (confirmed <= 0)        return 'declined';
  if (confirmed >= invited)  return 'confirmed';
  return 'partial';
}

// ===== localStorage =====

function loadGuests() {
  const raw = localStorage.getItem(GUESTS_KEY);
  if (!raw) return [];

  let guests;
  try {
    guests = JSON.parse(raw);
  } catch (e) {
    console.error('[loadGuests] JSON corrompu:', e);
    return [];
  }
  if (!Array.isArray(guests)) return [];

  // Migration : initialiser confirmedCount à partir de l'ancien statut
  let changed = false;
  guests.forEach(g => {
    if (!('confirmedCount' in g)) {
      if (g.status === 'confirmed')     g.confirmedCount = guestInvited(g);
      else if (g.status === 'declined') g.confirmedCount = 0;
      else                              g.confirmedCount = null;  // en attente
      changed = true;
    }
  });
  if (changed) saveGuests(guests);

  return guests;
}

function saveGuests(guests) {
  localStorage.setItem(GUESTS_KEY, JSON.stringify(guests));
}

// ===== CRUD =====

function readForm() {
  const name   = document.getElementById('guestName').value.trim();
  const count  = parseInt(document.getElementById('guestCount').value, 10);
  const names  = document.getElementById('guestNames').value.trim();
  const email  = document.getElementById('guestEmail').value.trim();
  const phone  = document.getElementById('guestPhone').value.trim();
  const meal   = document.getElementById('guestMeal').value;
  if (!name || !count || count < 1) return null;

  const existingGroups = [...new Set(loadGuests().map(g => g.group).filter(Boolean))];
  const group = normalizeGroupInput(document.getElementById('guestGroup').value, existingGroups);

  const rawConfirmed = document.getElementById('guestConfirmed').value.trim();
  let confirmedCount = null;
  if (rawConfirmed !== '') {
    confirmedCount = parseInt(rawConfirmed, 10);
    if (isNaN(confirmedCount) || confirmedCount < 0) confirmedCount = 0;
    if (confirmedCount > count) confirmedCount = count;
  }

  return { name, count, names, email, phone, group, meal, confirmedCount };
}

function addGuest() {
  const data = readForm();
  if (!data) return;
  const guests = loadGuests();
  guests.push({ id: generateId(), ...data });
  saveGuests(guests);
  resetForm();
  renderGuests();
}

function updateGuest(id) {
  const data = readForm();
  if (!data) return;
  const guests = loadGuests();
  const g = guests.find(g => String(g.id) === String(id));
  if (!g) return;
  Object.assign(g, data);
  delete g.status;  // statut désormais dérivé de confirmedCount
  saveGuests(guests);
  resetForm();
  renderGuests();
}

function deleteGuest(id) {
  const guests = loadGuests().filter(g => String(g.id) !== String(id));
  saveGuests(guests);
  if (String(editingId) === String(id)) resetForm();
  renderGuests();
}

function setConfirmed(id, value) {
  const guests = loadGuests();
  const g = guests.find(g => String(g.id) === String(id));
  if (!g) return;
  g.confirmedCount = Math.max(0, Math.min(value, guestInvited(g)));
  delete g.status;  // statut désormais dérivé de confirmedCount
  saveGuests(guests);
  renderGuests();
}

function startEdit(id) {
  const g = loadGuests().find(g => String(g.id) === String(id));
  if (!g) return;
  editingId = id;
  document.getElementById('guestName').value   = g.name;
  document.getElementById('guestCount').value  = g.count;
  document.getElementById('guestNames').value  = g.names  || '';
  document.getElementById('guestEmail').value  = g.email  || '';
  document.getElementById('guestPhone').value  = g.phone  || '';
  document.getElementById('guestGroup').value  = g.group ? groupLabel(g.group) : '';
  document.getElementById('guestMeal').value   = g.meal   || 'standard';
  document.getElementById('guestConfirmed').value = (g.confirmedCount == null) ? '' : g.confirmedCount;

  document.getElementById('formTitle').textContent  = 'Modifier l\'invité';
  document.getElementById('btnSubmit').textContent  = '💾 Enregistrer';
  document.getElementById('btnCancelEdit').style.display = 'inline-flex';
  document.getElementById('guestName').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  editingId = null;
  document.getElementById('guestForm').reset();
  document.getElementById('guestCount').value = 1;
  document.getElementById('formTitle').textContent = 'Ajouter un invité';
  document.getElementById('btnSubmit').textContent = '+ Ajouter';
  document.getElementById('btnCancelEdit').style.display = 'none';
}

// ===== Statistiques =====

function renderStats(guests) {
  const sum = fn => guests.reduce((n, g) => n + fn(g), 0);
  document.getElementById('statTotal').textContent     = guests.length;
  document.getElementById('statPeople').textContent    = sum(guestInvited);
  document.getElementById('statConfirmed').textContent = sum(guestConfirmed);
  document.getElementById('statPending').textContent   = sum(g => guestStatus(g) === 'pending'  ? guestInvited(g) : 0);
  document.getElementById('statDeclined').textContent  = sum(g => guestStatus(g) === 'declined' ? guestInvited(g) : 0);
}

// ===== Rendu =====

function matchesFilters(g) {
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const haystack = `${g.name || ''} ${g.names || ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (activeStatus !== 'all' && guestStatus(g) !== activeStatus) return false;
  return true;
}

function renderCard(g) {
  const status    = guestStatus(g);
  const invited   = guestInvited(g);
  const confirmed = guestConfirmed(g);
  const expanded  = expandedIds.has(String(g.id));
  const meal      = g.meal || 'standard';
  const phone     = (g.phone || '').trim();
  const email     = (g.email || '').trim();

  const namesArr = splitNames(g.names);
  // Nom principal = prénoms (repli sur le nom du foyer si absents)
  const primary   = namesArr.length ? compactNames(namesArr) : (g.name || '');
  const secondary = namesArr.length ? (g.name || '') : '';

  const statusText = status === 'pending'
    ? 'en attente'
    : `${confirmed} confirmé${confirmed > 1 ? 's' : ''}`;

  const detail = !expanded ? '' : `
    <div class="guest-card-detail">
      ${namesArr.length ? `<span class="guest-names">👤 ${escapeHtml(namesArr.join(' • '))}</span>` : ''}
      <span class="guest-info-line">👥 ${invited} invité${invited > 1 ? 's' : ''} — ${statusText}</span>
      ${(phone || email) ? `
      <span class="guest-info-line guest-contact">
        ${phone ? `<a href="tel:${escapeHtml(phone.replace(/\s+/g, ''))}">📞 ${escapeHtml(phone)}</a>` : ''}
        ${email ? `<a href="mailto:${escapeHtml(email)}">📧 ${escapeHtml(email)}</a>` : ''}
      </span>` : ''}
      <span class="guest-info-line">${MEAL_ICON[meal] || ''} ${MEAL_LABELS[meal] || meal}</span>
      <div class="guest-actions">
        ${status !== 'confirmed' ? `<button class="btn-quick btn-quick--confirm" data-action="confirm" data-id="${g.id}">✓ Confirmer</button>` : ''}
        ${status !== 'declined'  ? `<button class="btn-quick btn-quick--decline" data-action="decline" data-id="${g.id}">✕ Refuser</button>` : ''}
        <button class="btn-edit-guest" data-id="${g.id}">✏️ Modifier</button>
        <button class="btn-delete" data-id="${g.id}">Supprimer</button>
      </div>
    </div>`;

  return `
    <div class="guest-card ${expanded ? 'guest-card--open' : ''}" data-id="${g.id}">
      <div class="guest-card-head">
        <span class="guest-card-titles">
          <span class="guest-card-name">${escapeHtml(primary)}</span>
          ${secondary ? `<span class="guest-card-sub">🏷 ${escapeHtml(secondary)}</span>` : ''}
        </span>
        <span class="guest-card-counts">
          <span class="guest-card-pax" title="invités · confirmés">👥 ${invited} · ✓ ${confirmed}</span>
          <span class="badge ${STATUS_BADGE[status] || ''}">${STATUS_LABELS[status] || status}</span>
        </span>
      </div>
      ${detail}
    </div>`;
}

function renderGroupOptions(guests) {
  const fromData = guests.map(g => groupLabel(g.group)).filter(g => g && g !== 'Sans groupe');
  const all = [...new Set([...DEFAULT_GROUPS, ...fromData])]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  document.getElementById('groupOptions').innerHTML =
    all.map(g => `<option value="${escapeHtml(g)}"></option>`).join('');
}

function renderGuests() {
  const guests = loadGuests();
  renderStats(guests);
  renderGroupOptions(guests);

  document.getElementById('guestListCount').textContent = guests.length;
  document.getElementById('guestControls').style.display = guests.length ? 'flex' : 'none';

  const empty = document.getElementById('guestsEmpty');
  const list  = document.getElementById('guestsList');

  if (guests.length === 0) {
    empty.style.display = 'block';
    empty.querySelector('p').textContent = 'Aucun invité ajouté pour l\'instant.';
    list.innerHTML = '';
    return;
  }

  const filtered = guests.filter(matchesFilters);

  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.querySelector('p').textContent = 'Aucun invité ne correspond aux critères.';
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';

  // Groupes présents, dédoublonnés et triés alphabétiquement par libellé
  const groups = [...new Set(filtered.map(g => g.group || ''))]
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), 'fr', { sensitivity: 'base' }));

  let html = '';
  groups.forEach(group => {
    const inGroup = filtered
      .filter(g => (g.group || '') === group)
      .sort((a, b) => (STATUS_ORDER[guestStatus(a)] ?? 9) - (STATUS_ORDER[guestStatus(b)] ?? 9));

    const open      = openGroups[group] !== false;   // ouvert par défaut
    const limit     = groupLimits[group] || PAGE_SIZE;
    const shown     = inGroup.slice(0, limit);
    const remaining = inGroup.length - shown.length;
    const groupAttr = escapeHtml(group);

    html += `
      <div class="guest-group-section ${open ? 'is-open' : ''}">
        <button class="guest-group-header" data-group="${groupAttr}" aria-expanded="${open}">
          <span class="guest-group-toggle">▸</span>
          <span class="guest-group-title">${escapeHtml(groupLabel(group))}</span>
          <span class="count-badge">${inGroup.length}</span>
        </button>
        <div class="guest-group-body">
          ${shown.map(renderCard).join('')}
          ${remaining > 0
            ? `<button class="btn-show-more" data-group="${groupAttr}">Afficher plus (${remaining} restant${remaining > 1 ? 's' : ''})</button>`
            : ''}
        </div>
      </div>`;
  });

  list.innerHTML = html;
}

// ===== Initialisation =====

document.getElementById('guestForm').addEventListener('submit', e => {
  e.preventDefault();
  if (editingId) updateGuest(editingId);
  else addGuest();
});

document.getElementById('btnCancelEdit').addEventListener('click', resetForm);

document.getElementById('guestsList').addEventListener('click', e => {
  // Laisser fonctionner les liens tel:/mailto:
  if (e.target.closest('a')) return;

  const showMore = e.target.closest('.btn-show-more');
  if (showMore) {
    const group = showMore.dataset.group;
    groupLimits[group] = (groupLimits[group] || PAGE_SIZE) + PAGE_SIZE;
    renderGuests();
    return;
  }

  const quickBtn = e.target.closest('.btn-quick');
  if (quickBtn) {
    // 'confirm' → toutes les personnes (borné à invited) ; 'decline' → 0
    setConfirmed(quickBtn.dataset.id, quickBtn.dataset.action === 'confirm' ? Number.MAX_SAFE_INTEGER : 0);
    return;
  }

  const editBtn = e.target.closest('.btn-edit-guest');
  if (editBtn) { startEdit(editBtn.dataset.id); return; }

  const delBtn = e.target.closest('.btn-delete');
  if (delBtn) {
    if (confirm('Supprimer cet invité ?')) deleteGuest(delBtn.dataset.id);
    return;
  }

  const header = e.target.closest('.guest-group-header');
  if (header) {
    const group = header.dataset.group;
    openGroups[group] = openGroups[group] === false;  // bascule (ouvert par défaut)
    renderGuests();
    return;
  }

  const card = e.target.closest('.guest-card');
  if (card) {
    const id = String(card.dataset.id);
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    renderGuests();
  }
});

document.getElementById('guestSearch').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderGuests();
});

document.getElementById('guestStatusFilters').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  activeStatus = pill.dataset.status;
  document.querySelectorAll('#guestStatusFilters .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  renderGuests();
});

renderGuests();
