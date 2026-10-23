const button = document.getElementById('btnAllow');
const result = document.getElementById('result');
const isMac = /Mac/i.test(navigator.userAgentData?.platform ?? navigator.platform);

button.addEventListener('click', requestPermission);

async function requestPermission() {
  button.disabled = true;
  result.className = 'result';
  result.textContent = 'Esperando tu respuesta en el aviso de Chrome…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    result.classList.add('ok');
    result.textContent = '¡Listo! Ya puedes cerrar esta pestaña y volver a iniciar la traducción.';
    await chrome.runtime.sendMessage({ action: 'MIC_PERMISSION_GRANTED' }).catch(() => {});
    setTimeout(() => window.close(), 2500);
  } catch (error) {
    button.disabled = false;
    result.classList.add('error');
    result.textContent = error.name === 'NotAllowedError'
      ? `Permiso denegado. Actívalo desde el icono del candado en la barra de direcciones${isMac ? ' y revisa Ajustes del Sistema → Privacidad y seguridad → Micrófono → Google Chrome' : ' y revisa Configuración de Windows → Privacidad → Micrófono'}.`
      : `No se pudo acceder al micrófono: ${error.message}`;
  }
}
