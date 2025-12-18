const btnLogin = document.getElementById('btnLogin');
const loginError = document.getElementById('loginError');

btnLogin.addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await window.electronAPI.sendLogin(email, password);
  if(res.ok){
    window.location.href = 'panel.html';
  } else {
    loginError.innerText = res.error || 'Error al iniciar sesión';
  }
});
