# LiveAudio Translate 🎧

Subtítulos traducidos en tiempo real, en dos formatos:

- **🧩 Extensión de Chrome** (Windows y macOS): escucha el audio de una **pestaña**, de **otra ventana o app** (Zoom, Teams…) o del **micrófono**, y muestra los subtítulos sobre la página o en una ventana para tu segundo monitor.
- **📱 Web para el celular** (Android y iPhone): se abre con un enlace o un código QR, usa el micrófono del celular y muestra la traducción en vivo. No hay nada que instalar. → [ver sección](#-web-para-el-celular)

---

## ⚡ Motores de voz

| Motor | Retraso típico | Coste | Necesita |
|---|---|---|---|
| **Chrome Live** | < 1 s (texto parcial al instante) | Gratis | Chrome 133+ y permiso de micrófono una vez |
| **Deepgram Nova** | < 1 s (streaming) | Crédito gratis al registrarte; luego de pago | Clave de Deepgram |
| **Groq Whisper** | 1–3 s (por frases) | Plan gratis con límites | Clave de Groq |

- **Automático (recomendado):** usa Deepgram si tienes clave; si no, Chrome Live. Si un motor falla, cambia solo al siguiente (y a Groq como último recurso si tienes su clave).
- Mientras alguien habla, el subtítulo aparece en el idioma original **al instante** y la traducción se actualiza unas 3 veces por segundo; al terminar la frase queda la traducción definitiva.
- La traducción usa el servicio público de Google Translate (sin clave).

> **¿Por qué Groq no baja de ~3 s?** Su plan gratis permite unos 20 envíos por minuto y cobra un mínimo de 10 s de audio por envío, así que no admite streaming. La extensión corta el audio en las pausas (no cada 3,5 s fijos), descarta los silencios y las frases que Whisper suele inventar, y respeta el límite para no quedarse bloqueada.

---

## 🛠️ Instalación

1. Descarga el proyecto:
   ```bash
   git clone https://github.com/anibaler123143423234321/extension-traductor-audio.git
   ```
   (o, si ya lo tienes, actualízalo con `git pull`).
2. Abre Chrome y entra en `chrome://extensions/`.
3. Activa el **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta **`extension`** del proyecto:
   - **Mac:** `~/…/extension-traductor-audio/extension`
   - **Windows:** `C:\…\extension-traductor-audio\extension`
5. Fija el icono en la barra de Chrome (icono del puzle 🧩 → 📌).

Para actualizar después de un `git pull`, pulsa el botón de recargar 🔄 de la extensión en `chrome://extensions/`.

> Si antes cargabas la carpeta raíz del proyecto, quítala y carga la carpeta `extension`.

---

## ▶️ Uso

1. Abre el video, la clase o la reunión en una pestaña.
2. Pulsa el icono de la extensión, elige los idiomas (por defecto **Inglés → Español**) y pulsa **Iniciar**.
3. Aparece un subtítulo flotante sobre la página:
   - Arrástralo por la barra superior; con **doble clic** vuelve a su sitio.
   - Botones: ventana independiente 🗗, modo bilingüe / solo traducción, tamaño de letra, minimizar y ocultar.
   - Sigue visible con el video en **pantalla completa**.
4. Atajo de teclado para iniciar y detener: **Alt + Shift + T** en Windows, **⌥ Option + ⇧ Shift + T** en Mac. Puedes cambiarlo en `chrome://extensions/shortcuts`.

### Fuentes de audio

- **🌐 Pestaña:** YouTube, Google Meet, Teams o Zoom web, cursos, podcasts… Sigues oyendo el audio con normalidad.
- **🖥️ Ventana / App:** para apps de escritorio (Zoom, Teams). Se abre la ventana de segundo monitor y eliges qué compartir:
  - **Windows:** elige **Pantalla completa** y marca **«Compartir también el audio del sistema»**. Las ventanas sueltas no comparten sonido en Windows.
  - **Mac:** el audio del sistema requiere **macOS 14.2 o posterior y Chrome 141 o posterior**. Elige **Pantalla completa** con **«Compartir audio del sistema»**. Si no aparece esa opción, abre la reunión en el navegador (por ejemplo, Zoom web) y usa la fuente **Pestaña**.
- **🎙️ Micrófono:** clases presenciales o conversaciones.

### Modo segundo monitor

**🗗 Abrir en segundo monitor** abre una ventana limpia con letra grande y la transcripción completa. Es ideal si compartes pantalla: los demás no ven los subtítulos. **📌 Siempre visible** la convierte en una ventanita flotante sobre cualquier app.

---

## 🔑 Claves (opcionales)

En el popup, abre **Claves de API**:

- **Deepgram:** crea una cuenta en [console.deepgram.com](https://console.deepgram.com/signup) y genera una API key. Es la opción más precisa en tiempo real.
- **Groq:** en [console.groq.com/keys](https://console.groq.com/keys) pulsa **Create API Key** (sin tarjeta).

Las claves se guardan solo en tu navegador (`chrome.storage.local`) y no se sincronizan.

---

## 🍎 / 🪟 Permisos según el sistema

**Mac**
- **Micrófono:** Ajustes del Sistema → Privacidad y seguridad → Micrófono → activa Google Chrome.
- **Compartir ventana o pantalla:** Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla y audio del sistema → activa Google Chrome (reinicia Chrome después).

**Windows**
- **Micrófono:** Configuración → Privacidad y seguridad → Micrófono → permite el acceso a las aplicaciones de escritorio (Chrome).

**Permiso de micrófono de la extensión:** el motor gratuito Chrome Live puede pedirlo una vez aunque traduzcas una pestaña. La extensión abre una página para concederlo; tu micrófono no se graba si la fuente es la pestaña o una ventana.

---

## 🧯 Solución de problemas

| Síntoma | Solución |
|---|---|
| «Chrome no permite capturar esta página» | Las páginas `chrome://` y la Chrome Web Store no se pueden capturar. Usa una pestaña normal. |
| «Concede permiso de micrófono…» | Pulsa **Conceder permiso** en el aviso y acepta. Revisa también los permisos del sistema (arriba). |
| «Esta pestaña ya se está capturando» | Detén la otra captura o recarga la pestaña. |
| Chrome Live se corta o no funciona | Comprueba tu conexión. Chrome Live usa el servicio de voz de Google y necesita Chrome 133+. Prueba Deepgram o Groq. |
| «Límite gratuito de Groq alcanzado» | La extensión se reanuda sola. Para uso continuo, usa Chrome Live o Deepgram. |
| No llega audio al compartir una ventana | Mira las notas de **Ventana / App** para Windows y Mac. |

---

## 📱 Web para el celular

La carpeta [`web/`](web/) es una página HTML que cualquiera abre desde su celular. Toca el micrófono, acerca el celular a quien habla en inglés (o al parlante) y lee la traducción al español en tiempo real.

### Publicarla gratis con GitHub Pages

El micrófono del celular solo funciona en páginas **https://**, así que hay que publicarla. Solo se hace una vez:

1. En GitHub abre el repositorio → **Settings** → **Pages**.
2. En **Build and deployment** elige **Deploy from a branch**.
3. Elige la rama **`web-movil`** (o `main` cuando la fusiones) y la carpeta **`/ (root)`**, y pulsa **Save**.
4. En un par de minutos estará en:
   **https://anibaler123143423234321.github.io/extension-traductor-audio/**
   (la raíz redirige a `/web/`).

> GitHub Pages es gratis para repositorios públicos. Si el repositorio es privado, hace falta un plan de pago de GitHub, o puedes publicar la carpeta en otro hosting estático con HTTPS (Netlify, Cloudflare Pages, Vercel). Sube el repositorio completo, porque la web usa el código de `extension/lib`.

### Usarla

1. Abre el enlace en el celular, o pulsa el botón **QR** de la web para que otros lo escaneen con la cámara.
2. Toca el **micrófono 🎙️** y acepta el permiso.
3. Arriba se ve la traducción en grande y, debajo, la transcripción completa. Puedes copiarla o descargarla en `.txt`.
4. **⛶** activa el modo presentación (solo el subtítulo, letra más grande).
5. **⚙️ Ajustes:** idiomas, motor de voz, claves, tamaño de letra, bilingüe o solo traducción, y mantener la pantalla encendida.
6. Para tenerla como app: menú del navegador → **Añadir a pantalla de inicio**.

### Compatibilidad

| Celular | Navegador | Motor gratuito (sin clave) |
|---|---|---|
| Android | **Google Chrome** | ✅ |
| iPhone / iPad | **Safari** (con Dictado activado: Ajustes → General → Teclado → Dictado) | ✅ |
| Cualquiera | Firefox u otros | ❌ → usa una clave de **Deepgram** o **Groq** |

- Con clave de **Deepgram** funciona en cualquier navegador y es lo más preciso.
- Si bloqueas la pantalla o cambias de app, la escucha se pausa y continúa al volver. Si el navegador no lo permite, toca el micrófono otra vez. Por eso la opción de **mantener la pantalla encendida** viene activada.
- En algunos Android se oye un pitido corto cada vez que el reconocimiento gratuito se reinicia entre frases. Con Deepgram no ocurre.
- Las claves de API se guardan solo en ese celular. No pongas tu clave en la página publicada: cada persona agrega la suya si la necesita.

---

## 🔒 Privacidad

- El audio se envía **solo** al motor elegido: el servicio de voz del navegador (Google en Chrome, Apple en Safari), Deepgram o Groq.
- El texto se envía a Google Translate para traducirlo.
- El historial (últimas 300 frases) se guarda en tu navegador. Puedes copiarlo, exportarlo a `.txt` o borrarlo.

---

## 👩‍💻 Desarrollo

```text
web/                       ← web para el celular (HTML, CSS, JS, PWA)
  index.html · app.js · app.css · sw.js · manifest.webmanifest
extension/                 ← carpeta que se carga en Chrome
  manifest.json
  background.js            service worker: sesión, offscreen, historial, atajos
  offscreen.js             captura de pestaña / micrófono
  popup.*                  panel de control
  viewer.*                 ventana de segundo monitor (+ captura de ventanas)
  content.js               subtítulo flotante (Shadow DOM)
  permission.*             página para conceder el micrófono
  lib/
    pipeline.js            motor de voz + traducción, cambio automático de motor
    capture-session.js     une un MediaStream con el pipeline
    engines/               webspeech.js · deepgram.js · groq.js
    audio/                 AudioWorklet PCM 16 kHz, detector de voz, WAV
    translator.js          Google Translate con caché
    (lib/ es compartido: la web también lo usa)
tests/                     pruebas unitarias (node:test) y e2e (Playwright)
scripts/serve.mjs          servidor local para probar la web
```

```bash
npm install          # solo para desarrollo
npm run check        # lint + pruebas unitarias
npm run web          # web en http://localhost:8080/web/ (en el ordenador; el celular necesita https)
npm run test:e2e     # extensión + web en Chromium con micrófono y APIs simulados
                     # (Linux sin pantalla: xvfb-run npm run test:e2e)
```
