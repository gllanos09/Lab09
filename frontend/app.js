const API = '';
const MAX_SIZE_MB = 5;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

let session = JSON.parse(localStorage.getItem('lab9_session') || 'null');

function saveSession(data, email) {
  session = { ...data, email };
  localStorage.setItem('lab9_session', JSON.stringify(session));
}
function clearSession() {
  session = null;
  localStorage.removeItem('lab9_session');
}
function authHeader() {
  return session ? { Authorization: `Bearer ${session.accessToken}` } : {};
}

document.querySelectorAll('.tabBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabBtn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const statusEl = document.getElementById('registerStatus');
  statusEl.textContent = 'Registrando...';
  try {
    const res = await fetch(`${API}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    statusEl.textContent = res.ok
      ? 'Registro exitoso. Revisa tu correo y confirma tu cuenta en la pestaña "Confirmar código".'
      : `Error: ${data.error}`;
  } catch (err) {
    statusEl.textContent = 'Error de conexión.';
  }
});

document.getElementById('confirmBtn').addEventListener('click', async () => {
  const email = document.getElementById('confEmail').value.trim();
  const code = document.getElementById('confCode').value.trim();
  const statusEl = document.getElementById('confirmStatus');
  statusEl.textContent = 'Confirmando...';
  try {
    const res = await fetch(`${API}/api/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    statusEl.textContent = res.ok
      ? 'Cuenta confirmada. Ya puedes iniciar sesión.'
      : `Error: ${data.error}`;
  } catch (err) {
    statusEl.textContent = 'Error de conexión.';
  }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const statusEl = document.getElementById('loginStatus');
  statusEl.textContent = 'Ingresando...';
  try {
    const res = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = `Error: ${data.error}`;
      return;
    }
    saveSession(data, email);
    statusEl.textContent = '';
    showApp();
  } catch (err) {
    statusEl.textContent = 'Error de conexión.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  clearSession();
  showAuth();
});

function showApp() {
  document.getElementById('authPanel').classList.add('hidden');
  document.getElementById('appPanel').classList.remove('hidden');
  document.getElementById('userBar').classList.remove('hidden');
  document.getElementById('userEmail').textContent = session.email;
  loadGallery();
}
function showAuth() {
  document.getElementById('authPanel').classList.remove('hidden');
  document.getElementById('appPanel').classList.add('hidden');
  document.getElementById('userBar').classList.add('hidden');
}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');

['dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
  e.preventDefault();
  dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
}));
dropzone.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) fileInput.files = e.dataTransfer.files;
});

document.getElementById('uploadBtn').addEventListener('click', async () => {
  const file = fileInput.files[0];
  const proyecto = document.getElementById('proyecto').value.trim();
  if (!file) return alert('Selecciona un archivo');
  if (!ALLOWED.includes(file.type)) return alert('Tipo de archivo no permitido');
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return alert('Archivo demasiado grande (máx. 5MB)');

  statusEl.textContent = 'Solicitando URL de carga...';

  const res = await fetch(`${API}/api/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size, proyecto }),
  });
  if (res.status === 401) {
    statusEl.textContent = 'Tu sesión expiró. Inicia sesión de nuevo.';
    clearSession();
    showAuth();
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    statusEl.textContent = `Error: ${err.error || res.status}`;
    return;
  }
    const { uploadUrl, tagging } = await res.json();

  statusEl.textContent = 'Subiendo a S3...';
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
      'x-amz-server-side-encryption': 'AES256',
    },
    body: file,
  });

  statusEl.textContent = put.ok ? 'Subida completa.' : 'Error al subir a S3.';
  fileInput.value = '';
  document.getElementById('proyecto').value = '';
  loadGallery();
});

async function loadGallery() {
  const res = await fetch(`${API}/api/images`, { headers: authHeader() });
  if (res.status === 401) {
    clearSession();
    showAuth();
    return;
  }
  const items = await res.json();
  const gallery = document.getElementById('gallery');
  if (!items.length) {
    gallery.innerHTML = '<p>Sin imágenes todavía.</p>';
    return;
  }
  gallery.innerHTML = items.map(i => `
    <div class="card">
      <img src="${i.url}" alt="${i.key}">
      <div class="meta">${(i.size / 1024).toFixed(1)} KB</div>
      <button onclick="del('${i.key}')">Eliminar</button>
    </div>
  `).join('');
}

async function del(key) {
  if (!confirm('¿Eliminar esta imagen?')) return;
  await fetch(`${API}/api/images/${encodeURIComponent(key)}`, { method: 'DELETE', headers: authHeader() });
  loadGallery();
}

if (session && session.accessToken) { showApp(); } else { showAuth(); }
