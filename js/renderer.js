const intro = document.querySelector(".intro");
const loginWrap = document.querySelector(".login-wrap");
const msLoginBtn = document.getElementById("msLoginBtn");
const loginBtn = document.getElementById("loginBtn");
const userField = document.getElementById("userField");
const emailField = document.getElementById("emailField");
const passField = document.getElementById("passField");
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

loginBtn?.addEventListener("click", async () => {
  const username = userField?.value || "";
  const email = emailField?.value || "";
  const password = passField?.value || "";
  if (!username.trim() || !email.trim() || !password.trim()) {
    showToast("Completa usuario, correo y contraseña.", "error");
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = "Ingresando...";
  try {
    const res = await window.api.loginCustom({ username, email, password });
    if (!res?.success) {
      showToast(res?.message || "No se pudo iniciar sesión.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Error al iniciar sesión.", "error");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Iniciar sesión";
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
