const intro = document.querySelector(".intro");
const loginWrap = document.querySelector(".login-wrap");
const msLoginBtn = document.getElementById("msLoginBtn");
const offlineBtn = document.getElementById("offlineBtn");
const offlineName = document.getElementById("offlineName");
const toastContainer = document.getElementById("toastContainer");

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (intro) intro.style.display = "none";
    if (loginWrap) loginWrap.classList.add("fade-in");
  }, 1200);
});

msLoginBtn?.addEventListener("click", async () => {
  msLoginBtn.disabled = true;
  msLoginBtn.textContent = "Abriendo Microsoft...";

  try {
    const res = await window.api.loginMicrosoft();
    if (!res.success) {
      showToast(res.message || "No se pudo iniciar sesión con Microsoft", 'error');
    }
  } catch (err) {
    console.error(err);
    showToast("Error al iniciar sesión con Microsoft", 'error');
  } finally {
    msLoginBtn.disabled = false;
    msLoginBtn.textContent = "Iniciar sesión con Microsoft";
  }
});

offlineBtn?.addEventListener("click", async () => {
  const name = offlineName?.value || "";
  offlineBtn.disabled = true;
  offlineBtn.textContent = "Entrando...";
  try {
    const res = await window.api.loginOffline(name);
    if (!res.success) {
      showToast(res.message || "No se pudo entrar offline", 'error');
    }
  } catch (err) {
    console.error(err);
    showToast("Error al entrar offline", 'error');
  } finally {
    offlineBtn.disabled = false;
    offlineBtn.textContent = "Entrar offline";
  }
});

function showToast(message, type = 'info') {
  if (!toastContainer) {
    alert(message);
    return;
  }
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = message;
  toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}
