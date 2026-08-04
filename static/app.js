const API = '';

function togglePw(id, btn) {
  const el = document.getElementById(id);
  if (el.type === 'password') {
    el.type = 'text';
    btn.textContent = '🙈';
  } else {
    el.type = 'password';
    btn.textContent = '👁';
  }
}

// Auto-lock timer
let autoLockTimer = null;
let autoLockMinutes = 10;

// Clipboard auto-clear
let clipboardClearMs = 15000;
let currentCreds = [];

function loadSettings() {
  const savedLock = localStorage.getItem('cred-vault-auto-lock');
  const savedClip = localStorage.getItem('cred-vault-clipboard-timeout');
  if (savedLock !== null) {
    autoLockMinutes = parseInt(savedLock);
    const el = document.getElementById('auto-lock-timeout');
    if (el) el.value = savedLock;
  }
  if (savedClip !== null) {
    clipboardClearMs = parseInt(savedClip) * 1000;
    const el = document.getElementById('clipboard-timeout');
    if (el) el.value = savedClip;
  }
}

function updateAutoLock() {
  autoLockMinutes = parseInt(document.getElementById('auto-lock-timeout').value);
  localStorage.setItem('cred-vault-auto-lock', autoLockMinutes);
  resetAutoLockTimer();
}

function updateClipboardTimeout() {
  const sec = parseInt(document.getElementById('clipboard-timeout').value);
  clipboardClearMs = sec * 1000;
  localStorage.setItem('cred-vault-clipboard-timeout', sec);
}

function resetAutoLockTimer() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (autoLockMinutes > 0) {
    autoLockTimer = setTimeout(() => lock(), autoLockMinutes * 60 * 1000);
  }
}

function setupInactivityListeners() {
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
  events.forEach(e => document.addEventListener(e, resetAutoLockTimer, { passive: true }));
}

async function secureCopy(text, label) {
  if (!text) {
    showToast(label + ' copied to clipboard');
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(label + ' copied to clipboard');
    if (clipboardClearMs > 0) {
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {});
      }, clipboardClearMs);
    }
    return true;
  } catch (e) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (successful) {
      showToast(label + ' copied to clipboard');
      return true;
    }
    showToast('Failed to copy');
    return false;
  }
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (data.locked && !path.includes('unlock') && !path.includes('status')) {
    showLogin();
    return null;
  }
  return data;
}

async function unlock() {
  const pass = document.getElementById('master-pass').value;
  if (!pass) return;
  const confirmEl = document.getElementById('master-pass-confirm');
  if (confirmEl.style.display !== 'none') {
    const confirm = confirmEl.value;
    if (pass !== confirm) {
      document.getElementById('login-error').textContent = 'Passwords do not match';
      return;
    }
  }
  const res = await api('/api/unlock', {
    method: 'POST',
    body: JSON.stringify({ password: pass }),
  });
  if (res && res.status === 'ok') {
    document.getElementById('login-error').textContent = '';
    showVault();
    renderList();
  } else if (res) {
    document.getElementById('login-error').textContent = res.message || 'Wrong password';
  }
}

async function lock() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  await api('/api/lock', { method: 'POST' });
  document.getElementById('master-pass').value = '';
  showLogin(false);
}

function showLogin(firstRun) {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('vault-screen').classList.add('hidden');
  const prompt = document.getElementById('login-prompt');
  const passEl = document.getElementById('master-pass');
  const confirmEl = document.getElementById('master-pass-confirm');
  const btn = document.getElementById('login-btn');
  passEl.value = '';
  confirmEl.value = '';
  document.getElementById('login-error').textContent = '';
  if (firstRun) {
    prompt.textContent = 'Create a master password to secure your vault.';
    confirmEl.style.display = '';
    btn.textContent = 'Create Vault';
  } else {
    prompt.textContent = 'Enter your master password to unlock the vault.';
    confirmEl.style.display = 'none';
    btn.textContent = 'Unlock';
  }
  passEl.focus();
}

function showVault() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('vault-screen').classList.remove('hidden');
  loadSettings();
  resetAutoLockTimer();
}

function credLabel(c) {
  if (c.title && c.title.trim()) return c.title;
  if (c.type === 'general') return c.url || c.username || 'General';
  if (c.type === 'iam') return c.url || c.username || 'IAM User';
  if (c.type === 'ssh') return c.instance_name || c.url || c.username || 'SSH Server';
  return c.url || c.username || 'Web Login';
}

function credSub(c) {
  if (c.type === 'general') return (c.username || '');
  if (c.type === 'iam') return (c.username ? 'User: ' + c.username : '') + (c.password ? ' · Key: ' + c.password : '');
  if (c.type === 'ssh') {
    let parts = [];
    if (c.service) parts.push(c.service);
    if (c.url) parts.push(c.url);
    else if (c.public_ip) parts.push(c.public_ip);
    if (c.username) parts.push(c.username + (c.port && c.port != 22 ? ':' + c.port : ''));
    return parts.join(' · ');
  }
  return c.username || '';
}

function credDesc(c) {
  if (c.description && c.description.trim()) return c.description;
  if (c.type === 'ssh') return c.remarks || c.notes || '';
  return c.notes || '';
}

function typeIcon(c) {
  if (c.type === 'general') return '📄';
  if (c.type === 'iam') return '🔑';
  if (c.type === 'ssh') return '🖥';
  return '🌐';
}

function typeBadge(c) {
  const labels = { general: 'General', web: 'Web', ssh: 'SSH', iam: 'IAM' };
  const t = c.type || 'web';
  return `<span class="type-badge ${t}">${typeIcon(c)} ${labels[t] || 'Web'}</span>`;
}

async function renderList() {
  const creds = await api('/api/credentials');
  if (!creds) return;
  currentCreds = creds;
  const search = document.getElementById('search').value.toLowerCase();
  const typeFilter = document.getElementById('type-filter').value;
  const filtered = creds.filter(c => {
    if (typeFilter && c.type !== typeFilter) return false;
    if (!search) return true;
    const haystack = [
      c.title,
      c.description,
      c.url,
      c.username,
      c.notes,
      c.service,
      c.instance_name,
      c.public_ip,
      c.remarks,
      c.aws_account,
      c.aws_region,
      c.os_service,
      c.ssh_col,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(search);
  });
  const container = document.getElementById('cred-list');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔐</div><p class="empty-state-text">No credentials found.</p></div>';
  } else {
    container.innerHTML = filtered.map((c, i) => `
      <div class="cred-item" onclick="viewCredential('${c.id}')" style="cursor:pointer;animation-delay:${i * 40}ms">
        <div class="info">
          <div class="url">${typeBadge(c)} ${esc(credLabel(c))}</div>
          <div class="username">${esc(credSub(c))}</div>
          ${credDesc(c) ? `<div class="desc">${esc(credDesc(c))}</div>` : ''}
        </div>
        <div class="actions" onclick="event.stopPropagation()">
          ${c.type === 'ssh' ? `<button data-connect-id="${c.id}" onclick="connectSSH('${c.id}')" style="background:#1a6b3c;">Connect</button>` : c.type === 'iam' ? `<button onclick="copyIAM('${c.id}')" style="background:#b8860b;">Copy Keys</button>` : c.type === 'web' ? `<button onclick="openURL('${c.id}')">Open & Copy</button>` : ''}
          <button onclick="showEditForm('${c.id}')">Edit</button>
          <button onclick="deleteCred('${c.id}')" style="background:#ff4444;">Del</button>
        </div>
      </div>
    `).join('');
  }
}

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

function normalizeURL(url) {
  if (!url) return url;
  if (!url.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//)) return 'https://' + url;
  return url;
}

function openURL(id) {
  const c = currentCreds.find(x => x.id === id);
  if (!c || !c.url) return;
  openWebCredential(c);
}

function credentialClipboardText(c) {
  const parts = [];
  if (c.username) parts.push('Username: ' + c.username);
  if (c.password) parts.push('Password: ' + c.password);
  return parts.join('\n');
}

function openWebCredential(c) {
  const text = credentialClipboardText(c);
  if (text) {
    secureCopy(text, c.username && c.password ? 'Username and password' : c.username ? 'Username' : 'Password');
  }
  window.open(normalizeURL(c.url), '_blank', 'noopener,noreferrer');
}

function copyIAM(id) {
  const c = currentCreds.find(x => x.id === id);
  if (!c) return;
  const text = 'Access Key: ' + (c.password || '') + '\nSecret Key: ' + (c.secret_key || '');
  secureCopy(text, 'Access Key and Secret Key');
}

let detailCredId = null;

function viewCredential(id) {
  const c = currentCreds.find(x => x.id === id);
  if (!c) return;
  detailCredId = c.id;
  const t = c.type || 'web';

  // Set title and type badge
  const titleEl = document.getElementById('detail-title');
  const badgeEl = document.getElementById('detail-type-badge');
  if (titleEl) titleEl.textContent = credLabel(c);
  if (badgeEl) badgeEl.innerHTML = typeBadge(c);

  document.getElementById('detail-web-group').style.display = t === 'web' ? '' : 'none';
  document.getElementById('detail-ssh-group').style.display = t === 'ssh' ? '' : 'none';
  document.getElementById('detail-iam-group').style.display = t === 'iam' ? '' : 'none';
  document.getElementById('detail-open-btn').style.display = t === 'web' ? '' : 'none';
  document.getElementById('detail-connect-btn').style.display = t === 'ssh' ? '' : 'none';
  document.getElementById('detail-secret-group').style.display = t === 'iam' ? '' : 'none';

  if (t === 'iam') {
    document.getElementById('detail-iam-user').textContent = c.username || '(not set)';
    document.getElementById('detail-user-label').textContent = 'Access Key ID';
    document.getElementById('detail-pass-label').textContent = 'Secret Access Key';
  } else if (t === 'general') {
    document.getElementById('detail-user-label').textContent = 'Identifier';
    document.getElementById('detail-pass-label').textContent = 'Secret';
  } else {
    document.getElementById('detail-user-label').textContent = 'Username';
    document.getElementById('detail-pass-label').textContent = 'Password';
  }

  if (t === 'ssh') {
    document.getElementById('detail-host').textContent = c.url;
    document.getElementById('detail-port').textContent = 'port ' + (c.port || 22) + (c.key_file ? ' · key: ' + c.key_file : '');
    document.getElementById('detail-ssh-service').textContent = c.service || '(not set)';
    document.getElementById('detail-ssh-instance').textContent = c.instance_name || '(not set)';
    document.getElementById('detail-ssh-public-ip').textContent = c.public_ip || '(not set)';
    document.getElementById('detail-ssh-aws-account').textContent = c.aws_account || '(not set)';
    document.getElementById('detail-ssh-aws-region').textContent = c.aws_region || '(not set)';
    document.getElementById('detail-ssh-os-service').textContent = c.os_service || '(not set)';
    document.getElementById('detail-ssh-ssh-col').textContent = c.ssh_col || '(none)';
    document.getElementById('detail-ssh-remarks').textContent = c.remarks || '(none)';
  }


  document.getElementById('detail-url').textContent = c.url;
  document.getElementById('detail-url').href = normalizeURL(c.url);
  document.getElementById('detail-username').textContent = c.username || '(not set)';
  document.getElementById('detail-password-real').value = c.password || '';
  document.getElementById('detail-password').textContent = '••••••••';
  document.getElementById('detail-password').className = 'password-masked';
  document.getElementById('toggle-pw-btn').textContent = '👁';
  document.getElementById('detail-secret-real').value = c.secret_key || '';
  document.getElementById('detail-secret').textContent = '••••••••';
  document.getElementById('detail-secret').className = 'password-masked';
  document.getElementById('toggle-sec-btn').textContent = '👁';
  document.getElementById('detail-notes').textContent = credDesc(c) || '(none)';
  document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  detailCredId = null;
}

function togglePassword() {
  const pwEl = document.getElementById('detail-password');
  const real = document.getElementById('detail-password-real').value;
  const btn = document.getElementById('toggle-pw-btn');
  if (pwEl.textContent === '••••••••') {
    pwEl.textContent = real || '(empty)';
    pwEl.className = '';
    btn.textContent = '🙈';
  } else {
    pwEl.textContent = '••••••••';
    pwEl.className = 'password-masked';
    btn.textContent = '👁';
  }
}

function toggleSecret() {
  const el = document.getElementById('detail-secret');
  const real = document.getElementById('detail-secret-real').value;
  const btn = document.getElementById('toggle-sec-btn');
  if (el.textContent === '••••••••') {
    el.textContent = real || '(empty)';
    el.className = '';
    btn.textContent = '🙈';
  } else {
    el.textContent = '••••••••';
    el.className = 'password-masked';
    btn.textContent = '👁';
  }
}

function copyField(elementId, label) {
  const el = document.getElementById(elementId);
  const text = el.tagName === 'INPUT' ? el.value : el.textContent;
  secureCopy(text === '(not set)' || text === '(empty)' ? '' : text, label);
}

async function editFromDetail() {
  closeDetailModal();
  if (detailCredId) showEditForm(detailCredId);
}

async function connectFromDetail() {
  closeDetailModal();
  if (detailCredId) connectSSH(detailCredId);
}

async function deleteFromDetail() {
  closeDetailModal();
  if (detailCredId) deleteCred(detailCredId);
}

function getHostPort(c) {
  let host = c.url;
  let port = c.port || 22;
  if (host.includes('://')) host = host.split('/')[2] || host.split('/')[0] || host;
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    if (parts[1] && !isNaN(parts[1])) port = parseInt(parts[1]);
  }
  return { host, port };
}

async function connectSSH(id) {
  const btn = document.querySelector(`[data-connect-id="${id}"]`) || document.getElementById('detail-connect-btn');
  if (btn) btn.disabled = true;
  const c = currentCreds.find(x => x.id === id);
  if (!c || !c.url || !c.username) { if (btn) btn.disabled = false; return; }
  const { host, port } = getHostPort(c);
  const res = await api('/api/connect', {
    method: 'POST',
    body: JSON.stringify({ host, port, username: c.username, password: c.password, key_file: c.key_file || '' }),
  });
  if (btn) btn.disabled = false;
  if (res && res.status === 'ok') {
    // Copy password to client clipboard for user convenience
    if (c.password) {
      secureCopy(c.password, 'Password');
    }
    showToast(res.message || 'Connecting...');
  } else if (res) {
    showToast('Connection failed: ' + (res.message || 'unknown error'));
  }
}

function openFromDetail() {
  if (!detailCredId) return;
  const c = currentCreds.find(x => x.id === detailCredId);
  if (!c || !c.url) return;
  openWebCredential(c);
  closeDetailModal();
}

function toggleCredType() {
  const t = document.getElementById('cred-type').value;
  document.getElementById('general-fields').style.display = t === 'general' ? '' : 'none';
  document.getElementById('web-fields').style.display = t === 'web' ? '' : 'none';
  document.getElementById('ssh-fields').style.display = t === 'ssh' ? '' : 'none';
  document.getElementById('iam-fields').style.display = t === 'iam' ? '' : 'none';
}

function resetForm() {
  document.getElementById('cred-id').value = '';
  document.getElementById('cred-type').value = 'general';
  document.getElementById('cred-title').value = '';
  document.getElementById('cred-description').value = '';
  document.getElementById('cred-name').value = '';
  document.getElementById('cred-identifier').value = '';
  document.getElementById('cred-secret').value = '';
  document.getElementById('cred-url').value = '';
  document.getElementById('cred-username').value = '';
  document.getElementById('cred-password').value = '';
  document.getElementById('cred-host').value = '';
  document.getElementById('cred-port').value = '22';
  document.getElementById('cred-ssh-user').value = '';
  document.getElementById('cred-ssh-pass').value = '';
  document.getElementById('cred-key-file').value = '';
  document.getElementById('cred-service').value = '';
  document.getElementById('cred-instance').value = '';
  document.getElementById('cred-url-ssh').value = '';
  document.getElementById('cred-public-ip').value = '';
  document.getElementById('cred-aws-account').value = '';
  document.getElementById('cred-aws-region').value = '';
  document.getElementById('cred-os-service').value = '';
  document.getElementById('cred-ssh-col').value = '';
  document.getElementById('cred-remarks').value = '';
  document.getElementById('cred-iam-desc').value = '';
  document.getElementById('cred-iam-user').value = '';
  document.getElementById('cred-access-key').value = '';
  document.getElementById('cred-secret-key').value = '';
  document.getElementById('cred-notes').value = '';
  toggleCredType();
}

function showAddForm() {
  document.getElementById('modal-title').textContent = 'Add Credential';
  resetForm();
  document.getElementById('form-submit').textContent = 'Add';
  document.getElementById('modal').classList.remove('hidden');
}

function showEditForm(id) {
  const c = currentCreds.find(x => x.id === id);
  if (!c) return;
  const t = c.type || 'web';
  document.getElementById('modal-title').textContent = 'Edit Credential';
  document.getElementById('cred-id').value = c.id;
  document.getElementById('cred-type').value = t;
  document.getElementById('cred-title').value = c.title || '';
  document.getElementById('cred-description').value = c.description || '';
  document.getElementById('cred-name').value = t === 'general' ? c.url : '';
  document.getElementById('cred-identifier').value = t === 'general' ? (c.username || '') : '';
  document.getElementById('cred-secret').value = t === 'general' ? (c.password || '') : '';
  document.getElementById('cred-url').value = t === 'web' ? c.url : '';
  document.getElementById('cred-username').value = t === 'web' ? (c.username || '') : '';
  document.getElementById('cred-password').value = t === 'web' ? (c.password || '') : '';
  document.getElementById('cred-host').value = t === 'ssh' ? c.url : '';
  document.getElementById('cred-port').value = t === 'ssh' ? (c.port || 22) : '22';
  document.getElementById('cred-ssh-user').value = t === 'ssh' ? (c.username || '') : '';
  document.getElementById('cred-ssh-pass').value = t === 'ssh' ? (c.password || '') : '';
  document.getElementById('cred-key-file').value = t === 'ssh' ? (c.key_file || '') : '';
  document.getElementById('cred-service').value = t === 'ssh' ? (c.service || '') : '';
  document.getElementById('cred-instance').value = t === 'ssh' ? (c.instance_name || '') : '';
  document.getElementById('cred-url-ssh').value = t === 'ssh' ? (c.url || '') : '';
  document.getElementById('cred-public-ip').value = t === 'ssh' ? (c.public_ip || '') : '';
  document.getElementById('cred-aws-account').value = t === 'ssh' ? (c.aws_account || '') : '';
  document.getElementById('cred-aws-region').value = t === 'ssh' ? (c.aws_region || '') : '';
  document.getElementById('cred-os-service').value = t === 'ssh' ? (c.os_service || '') : '';
  document.getElementById('cred-ssh-col').value = t === 'ssh' ? (c.ssh_col || '') : '';
  document.getElementById('cred-remarks').value = t === 'ssh' ? (c.remarks || '') : '';
  document.getElementById('cred-iam-desc').value = t === 'iam' ? c.url : '';
  document.getElementById('cred-iam-user').value = t === 'iam' ? (c.username || '') : '';
  document.getElementById('cred-access-key').value = t === 'iam' ? (c.password || '') : '';
  document.getElementById('cred-secret-key').value = t === 'iam' ? (c.secret_key || '') : '';
  document.getElementById('cred-notes').value = c.notes || '';
  toggleCredType();
  document.getElementById('form-submit').textContent = 'Save';
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

function buildCredBody() {
  const t = document.getElementById('cred-type').value;
  const base = {
    type: t,
    title: document.getElementById('cred-title').value,
    description: document.getElementById('cred-description').value,
    notes: document.getElementById('cred-notes').value,
  };
  if (t === 'general') {
    base.url = document.getElementById('cred-name').value;
    base.username = document.getElementById('cred-identifier').value;
    base.password = document.getElementById('cred-secret').value;
    base.port = 0;
    base.key_file = '';
    base.secret_key = '';
  } else if (t === 'web') {
    base.url = document.getElementById('cred-url').value;
    base.username = document.getElementById('cred-username').value;
    base.password = document.getElementById('cred-password').value;
    base.port = 0;
    base.key_file = '';
    base.secret_key = '';
  } else if (t === 'ssh') {
    base.url = document.getElementById('cred-host').value;
    base.username = document.getElementById('cred-ssh-user').value;
    base.password = document.getElementById('cred-ssh-pass').value;
    base.port = parseInt(document.getElementById('cred-port').value) || 22;
    base.key_file = document.getElementById('cred-key-file').value;
    base.service = document.getElementById('cred-service').value;
    base.instance_name = document.getElementById('cred-instance').value;
    base.public_ip = document.getElementById('cred-public-ip').value;
    base.aws_account = document.getElementById('cred-aws-account').value;
    base.aws_region = document.getElementById('cred-aws-region').value;
    base.os_service = document.getElementById('cred-os-service').value;
    base.ssh_col = document.getElementById('cred-ssh-col').value;
    base.remarks = document.getElementById('cred-remarks').value;
    base.secret_key = '';
  } else {
    base.url = document.getElementById('cred-iam-desc').value;
    base.username = document.getElementById('cred-iam-user').value;
    base.password = document.getElementById('cred-access-key').value;
    base.secret_key = document.getElementById('cred-secret-key').value;
    base.port = 0;
    base.key_file = '';
  }
  return base;
}

document.getElementById('cred-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('cred-id').value;
  const body = buildCredBody();
  if (id) {
    await api('/api/credentials/' + id, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    await api('/api/credentials', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal();
  renderList();
});

async function deleteCred(id) {
  if (!confirm('Delete this credential?')) return;
  await api('/api/credentials/' + id, { method: 'DELETE' });
  renderList();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2000);
}

function showBookmarkletModal() {
  var port = location.port || "9090";
  var bm = `javascript:(function(p){var d=location.hostname.replace(/^www\\./,'');` +
`function n(m,b){var t=document.createElement("div");t.textContent=m;` +
`var bg=b?"#3a1515":"#1a1a2e";var br=b?"#ff6b6b":"#6c63ff";` +
`t.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:"+bg+";color:#e0e0e0;border:1px solid "+br+";padding:10px 20px;border-radius:8px;z-index:2147483647;font:14px sans-serif";` +
`document.body.appendChild(t);setTimeout(function(){t.remove()},4500);}var V=function(e){return!!(e&&(e.offsetWidth||e.offsetHeight||e.getClientRects().length))};` +
`var S=function(e,v){e.focus();e.value=v;try{e.dispatchEvent(new InputEvent("input",{bubbles:true}))}catch(_){}e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))};` +
`var F=function(s,v){var a=document.querySelectorAll(s);for(var i=0;i<a.length;i++)if(V(a[i])){S(a[i],v);return 1}return 0};` +
`var H=function(c){if(!Array.isArray(c)||!c.length){n("No web credential for "+d,1);return}var a=c[0];` +
`var u=!a.username||F('input[autocomplete="username"],input[type="email"],input[name*="user" i],input[id*="user" i],input[type="text"],input:not([type])',a.username);` +
`var p=!a.password||F('input[autocomplete^="current-password"],input[autocomplete^="new-password"],input[type="password"],input[name*="pass" i]',a.password);` +
`if(u&&p)n("Vault filled for "+d);else n("Missing "+(!u?"username":!p?"password":"field"),1)};` +
`var T=async function(b){try{var r=await fetch(b+"/api/lookup?domain="+encodeURIComponent(d),{mode:"cors"});` +
`if(r.ok){r.json().then(H)}else{n("Vault error: "+r.status,1)}catch(e){n("Cannot connect to vault. Ensure HTTPS is enabled and cert accepted.",1)}};T("https://127.0.0.1:"+p)})("${port}")`;
  document.getElementById("bookmarklet-link").href = bm;
  document.getElementById("bookmarklet-modal").classList.remove("hidden");
}

function closeBookmarkletModal() {
  document.getElementById('bookmarklet-modal').classList.add('hidden');
}

async function checkStatus() {
  var res = await api('/api/status');
  if (res && !res.locked) {
    showVault();
    renderList();
  } else if (res) {
    showLogin(res.first_run);
  }
}
loadSettings();
setupInactivityListeners();
checkStatus();
document.getElementById('master-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') unlock(); });
