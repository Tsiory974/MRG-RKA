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

let editingId      = null;
let searchQuery    = '';
let activeStatus   = 'all';
let inviteChoiceId = null;       // invité dont on choisit le canal d'envoi (Email/SMS)
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
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}

// Code d'accès : 5 caractères, sans 0/O/1/I/L (lisibilité à l'impression)
function generateAccessCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Minuscules + suppression des accents, pour une recherche insensible aux accents
function normalizeText(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

// Cache mémoire : évite de re-parser le localStorage à chaque rendu
// (recherche au clavier). Invalidé par saveGuests (même référence de tableau).
let guestsCache = null;

function loadGuests() {
  if (guestsCache) return guestsCache;

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
    if (!g.accessCode) {
      g.accessCode = generateAccessCode();
      changed = true;
    }
  });
  if (changed) saveGuests(guests);

  guestsCache = guests;
  return guests;
}

function saveGuests(guests) {
  guestsCache = guests;
  try {
    localStorage.setItem(GUESTS_KEY, JSON.stringify(guests));
  } catch (e) {
    console.error('[saveGuests]', e);
    alert('Erreur : impossible d\'enregistrer les invités (stockage plein ou indisponible).');
  }
}

// ===== Synchronisation Firestore =====
// Stratégie "local d'abord" : le localStorage reste la copie de travail
// (UI instantanée, fallback hors ligne, dashboard index.html inchangé) ;
// Firestore est la source de référence, synchronisée en arrière-plan.

const FS_COLLECTION = 'guests';

function fsAvailable() {
  return !!(window.db && window.fs);
}

// Crée ou met à jour un invité dans Firestore (upsert sur l'id local).
// setDoc(doc(..., id)) plutôt que addDoc : addDoc générerait un nouvel id
// à chaque écriture, rendant impossible la mise à jour/suppression ensuite.
function fsPushGuest(guest) {
  if (!fsAvailable()) return;
  const { doc, setDoc } = window.fs;
  setDoc(doc(window.db, FS_COLLECTION, String(guest.id)), guest)
    .then(() => console.log('[firestore] guest ajouté dans Firebase :', guest.name))
    .catch(e => console.warn('[firestore] écriture impossible (données conservées en local) :', e));
}

function fsDeleteGuest(id) {
  if (!fsAvailable()) return;
  const { doc, deleteDoc } = window.fs;
  deleteDoc(doc(window.db, FS_COLLECTION, String(id)))
    .then(() => console.log('[firestore] guest supprimé de Firebase :', id))
    .catch(e => console.warn('[firestore] suppression impossible :', e));
}

// Au chargement : lit la collection. Si elle contient des données, elle fait
// foi (cache + miroir localStorage remplacés). Si elle est vide alors que le
// localStorage a des invités, migration initiale : on pousse tout vers Firebase.
async function initFirestoreSync() {
  if (!fsAvailable()) return;
  const { collection, getDocs } = window.fs;
  try {
    const snapshot = await getDocs(collection(window.db, FS_COLLECTION));
    const remote = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));

    if (remote.length > 0) {
      // Complète les codes d'accès manquants (anciens documents) et les pousse
      remote.forEach(g => {
        if (!g.accessCode) {
          g.accessCode = generateAccessCode();
          fsPushGuest(g);
        }
      });
      guestsCache = remote;
      try { localStorage.setItem(GUESTS_KEY, JSON.stringify(remote)); } catch {}
      renderGuests();
      console.log(`[firestore] ${remote.length} guests chargés depuis Firebase`);
    } else {
      const local = loadGuests();
      if (local.length > 0) {
        local.forEach(fsPushGuest);
        console.log(`[firestore] migration initiale : ${local.length} invité(s) envoyé(s) vers Firebase`);
      } else {
        console.log('[firestore] guests chargés depuis Firebase (collection vide)');
      }
    }
  } catch (e) {
    console.warn('[firestore] lecture impossible — utilisation du localStorage :', e);
  }
}

// Le module Firebase (fin de guests.html) s'exécute après ce script :
// on attend son signal. S'il est déjà passé (rechargement), on lance direct.
if (fsAvailable()) initFirestoreSync();
else document.addEventListener('firebase-ready', initFirestoreSync, { once: true });

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
  const guest = { id: generateId(), ...data, invitationSent: false, accessCode: generateAccessCode() };
  guests.push(guest);
  saveGuests(guests);
  fsPushGuest(guest);          // sync Firestore en arrière-plan
  resetForm();
  renderGuests();
}

function updateGuest(id) {
  const data = readForm();
  if (!data) return;
  const guests = loadGuests();
  const g = guests.find(g => String(g.id) === String(id));
  if (!g) { resetForm(); renderGuests(); return; }  // invité supprimé entre-temps
  Object.assign(g, data);
  delete g.status;  // statut désormais dérivé de confirmedCount
  saveGuests(guests);
  fsPushGuest(g);              // sync Firestore en arrière-plan
  resetForm();
  renderGuests();
}

function deleteGuest(id) {
  const guests = loadGuests().filter(g => String(g.id) !== String(id));
  saveGuests(guests);
  fsDeleteGuest(id);           // sync Firestore en arrière-plan
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
  fsPushGuest(g);              // sync Firestore en arrière-plan
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
  syncConfirmedMax();

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

// ===== Invitations RSVP =====

// Statut d'envoi : 'answered' (a répondu, même 0), 'sent', 'notsent'
function inviteStatus(g) {
  if (g.confirmedCount != null) return 'answered';
  if (g.invitationSent)         return 'sent';
  return 'notsent';
}

const INVITE_LABELS = {
  answered: '✅ Répondu',
  sent:     '⏳ Envoyé',
  notsent:  '❌ Non envoyé',
};

// Lien unique vers la page de réponse (URL absolue, utilisable hors du site)
function inviteLink(id) {
  return new URL(`invite.html?id=${encodeURIComponent(id)}`, window.location.href).href;
}

function sendInvite(id, channel) {
  const guests = loadGuests();
  const g = guests.find(g => String(g.id) === String(id));
  if (!g) return;
  const link = inviteLink(id);

  if (channel === 'email') {
    const subject = encodeURIComponent('Invitation mariage');
    const body    = encodeURIComponent(`Bonjour, voici votre invitation :\n${link}`);
    window.location.href = `mailto:${(g.email || '').trim()}?subject=${subject}&body=${body}`;
  } else {
    const phone = (g.phone || '').trim().replace(/\s+/g, '');
    // iOS attend '&body=', Android '?body='
    const sep = /iPhone|iPad/i.test(navigator.userAgent) ? '&' : '?';
    window.location.href = `sms:${phone}${sep}body=${encodeURIComponent(`Invitation : ${link}`)}`;
  }

  // Marque l'invitation comme envoyée (= l'app mail/SMS a été ouverte)
  g.invitationSent = true;
  saveGuests(guests);
  fsPushGuest(g);

  inviteChoiceId = null;
  renderGuests();
}

function handleInvite(id) {
  const g = loadGuests().find(g => String(g.id) === String(id));
  if (!g) return;
  const email = (g.email || '').trim();
  const phone = (g.phone || '').trim();

  if (!email && !phone) {
    alert('Ajoute un email ou un téléphone pour cet invité.');
    return;
  }
  if (email && phone) {
    // Les deux canaux existent : afficher le choix Email / SMS dans la carte
    inviteChoiceId = String(id);
    renderGuests();
    return;
  }
  sendInvite(id, email ? 'email' : 'sms');
}

// ===== QR Code (invités confirmés) =====

let currentQrName = null;

function showQrModal(id) {
  const guests = loadGuests();
  const g = guests.find(g => String(g.id) === String(id));
  if (!g) return;

  // Filet de sécurité : génère le code s'il manque encore
  if (!g.accessCode) {
    g.accessCode = generateAccessCode();
    saveGuests(guests);
    fsPushGuest(g);
  }

  currentQrName = g.name;
  document.getElementById('qrModalName').textContent  = g.name;
  document.getElementById('qrAccessCode').textContent = g.accessCode;

  const box = document.getElementById('qrCodeBox');
  box.innerHTML = '';
  if (typeof QRCode === 'undefined') {
    box.textContent = 'QR indisponible (bibliothèque non chargée — vérifiez la connexion).';
  } else {
    new QRCode(box, {
      text: inviteLink(id),
      width: 220,
      height: 220,
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  document.getElementById('qrModal').style.display = 'flex';
}

function closeQrModal() {
  document.getElementById('qrModal').style.display = 'none';
  document.getElementById('qrCodeBox').innerHTML = '';
}

// ===== Statistiques =====

function renderStats(guests) {
  const sum = fn => guests.reduce((n, g) => n + fn(g), 0);
  document.getElementById('statTotal').textContent     = guests.length;
  document.getElementById('statPeople').textContent    = sum(guestInvited);
  document.getElementById('statConfirmed').textContent = sum(guestConfirmed);
  document.getElementById('statPending').textContent   = sum(g => guestStatus(g) === 'pending' ? guestInvited(g) : 0);
  // Refusés = foyers refusés + places non confirmées des foyers partiels,
  // pour que Confirmés + En attente + Refusés = Total personnes
  document.getElementById('statDeclined').textContent  = sum(g => {
    const s = guestStatus(g);
    if (s === 'declined') return guestInvited(g);
    if (s === 'partial')  return guestInvited(g) - guestConfirmed(g);
    return 0;
  });
}

// ===== Rendu =====

function matchesFilters(g) {
  const q = normalizeText(searchQuery.trim());
  if (q) {
    const haystack = normalizeText(`${g.name || ''} ${g.names || ''}`);
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
  const idAttr    = escapeHtml(String(g.id));

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
      <div class="guest-actions guest-actions--invite">
        ${inviteChoiceId === String(g.id)
          ? `<button class="btn-invite btn-invite--option" data-channel="email" data-id="${idAttr}">✉️ Envoyer par Email</button>
             <button class="btn-invite btn-invite--option" data-channel="sms"   data-id="${idAttr}">💬 Envoyer par SMS</button>`
          : `<button class="btn-invite" data-id="${idAttr}">✉️ Envoyer invitation</button>`}
        ${confirmed > 0 ? `<button class="btn-qr" data-id="${idAttr}">📦 QR Code</button>` : ''}
      </div>
      <div class="guest-actions">
        ${status !== 'confirmed' ? `<button class="btn-quick btn-quick--confirm" data-action="confirm" data-id="${idAttr}">✓ Confirmer</button>` : ''}
        ${status !== 'declined'  ? `<button class="btn-quick btn-quick--decline" data-action="decline" data-id="${idAttr}">✕ Refuser</button>` : ''}
        <button class="btn-edit-guest" data-id="${idAttr}">✏️ Modifier</button>
        <button class="btn-delete" data-id="${idAttr}">Supprimer</button>
      </div>
    </div>`;

  return `
    <div class="guest-card ${expanded ? 'guest-card--open' : ''}" data-id="${idAttr}">
      <div class="guest-card-head">
        <span class="guest-card-titles">
          <span class="guest-card-name">${escapeHtml(primary)}</span>
          ${secondary ? `<span class="guest-card-sub">🏷 ${escapeHtml(secondary)}</span>` : ''}
        </span>
        <span class="guest-card-counts">
          <span class="invite-chip invite-chip--${inviteStatus(g)}">${INVITE_LABELS[inviteStatus(g)]}</span>
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

  const emptyMsg  = document.getElementById('guestsEmptyMsg');
  const emptyHint = document.getElementById('guestsEmptyHint');

  if (guests.length === 0) {
    empty.style.display = 'block';
    emptyMsg.textContent = 'Aucun invité ajouté pour l\'instant.';
    emptyHint.style.display = 'block';
    list.innerHTML = '';
    return;
  }

  const filtered = guests.filter(matchesFilters);

  if (filtered.length === 0) {
    empty.style.display = 'block';
    emptyMsg.textContent = 'Aucun invité ne correspond aux critères.';
    emptyHint.style.display = 'none';   // le conseil "utilisez le formulaire" n'a pas de sens ici
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';

  // Groupes présents, dédoublonnés et triés alphabétiquement par libellé
  const groups = [...new Set(filtered.map(g => g.group || ''))]
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), 'fr', { sensitivity: 'base' }));

  // Statut précalculé une fois par invité (évite n·log(n) appels dans le tri)
  const statusRank = new Map(filtered.map(g => [g, STATUS_ORDER[guestStatus(g)] ?? 9]));

  let html = '';
  groups.forEach(group => {
    const inGroup = filtered
      .filter(g => (g.group || '') === group)
      .sort((a, b) => statusRank.get(a) - statusRank.get(b));

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

// Borne le champ "Personnes confirmées" au nombre d'invités saisi
function syncConfirmedMax() {
  const count = parseInt(document.getElementById('guestCount').value, 10);
  const confirmedInput = document.getElementById('guestConfirmed');
  if (count >= 1) {
    confirmedInput.max = count;
    if (parseInt(confirmedInput.value, 10) > count) confirmedInput.value = count;
  } else {
    confirmedInput.removeAttribute('max');
  }
}
document.getElementById('guestCount').addEventListener('input', syncConfirmedMax);

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

  const qrBtn = e.target.closest('.btn-qr');
  if (qrBtn) { showQrModal(qrBtn.dataset.id); return; }

  const inviteBtn = e.target.closest('.btn-invite');
  if (inviteBtn) {
    if (inviteBtn.dataset.channel) sendInvite(inviteBtn.dataset.id, inviteBtn.dataset.channel);
    else handleInvite(inviteBtn.dataset.id);
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

  // Déplier/replier : uniquement via l'en-tête de la carte — un clic dans le
  // détail (sélection du téléphone, copie d'un prénom…) ne referme plus la carte
  const head = e.target.closest('.guest-card-head');
  if (head) {
    const card = head.closest('.guest-card');
    const id   = String(card.dataset.id);
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    // Mise à jour ciblée de cette carte seulement (pas de re-render global)
    const g = loadGuests().find(x => String(x.id) === id);
    if (g) card.outerHTML = renderCard(g);
    else renderGuests();
  }
});

let searchDebounce = null;
document.getElementById('guestSearch').addEventListener('input', e => {
  searchQuery = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderGuests, 150);
});

document.getElementById('guestStatusFilters').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  activeStatus = pill.dataset.status;
  document.querySelectorAll('#guestStatusFilters .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  renderGuests();
});

// Modal QR : fermeture + téléchargement PNG
document.getElementById('qrModalClose').addEventListener('click', closeQrModal);
document.getElementById('qrModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeQrModal();
});
document.getElementById('btnDownloadQr').addEventListener('click', () => {
  const canvas = document.getElementById('qrCodeBox').querySelector('canvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `qr-${(currentQrName || 'invite').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
  a.click();
});

renderGuests();
