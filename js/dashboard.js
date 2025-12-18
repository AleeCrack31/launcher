const { ipcRenderer } = require('electron');

window.addEventListener("DOMContentLoaded", () => {
  // Obtenemos datos del usuario enviados desde el main
  ipcRenderer.invoke('get-user-data').then(user => {
    if (user) {
      document.getElementById('playerName').innerText = user.game_name;
      document.getElementById('playerRole').innerText = user.role;
    }
  });

  document.getElementById('launchBtn').addEventListener('click', () => {
    ipcRenderer.invoke('launch-game').then(res => {
      if (res.success) {
        alert("Juego iniciado!");
      } else {
        alert("Error al iniciar el juego: " + (res.message || ""));
      }
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    ipcRenderer.invoke('logout').then(() => {
      // Volver al login
      ipcRenderer.invoke('load-login');
    });
  });
});
