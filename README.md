# LiveAudio Translate 🎧

Extensión de Google Chrome (Manifest V3) que escucha el audio de una **pestaña**, de **otra ventana o app** (Zoom, Teams…) o del **micrófono**, y muestra **subtítulos traducidos en tiempo real** sobre la página o en una ventana para tu segundo monitor.

Funciona en **Windows y macOS** (Chrome, Edge y otros navegadores basados en Chromium).

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

## 🔒 Privacidad

- El audio se envía **solo** al motor elegido: Google (Chrome Live), Deepgram o Groq.
- El texto se envía a Google Translate para traducirlo.
- El historial (últimas 300 frases) se guarda en tu navegador. Puedes copiarlo, exportarlo a `.txt` o borrarlo.

---

## 👩‍💻 Desarrollo

```text
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
tests/                     pruebas unitarias (node:test) y e2e (Playwright)
```

```bash
npm install          # solo para desarrollo
npm run check        # lint + pruebas unitarias
npm run test:e2e     # carga la extensión en Chromium con APIs simuladas
                     # (Linux sin pantalla: xvfb-run npm run test:e2e)
```
