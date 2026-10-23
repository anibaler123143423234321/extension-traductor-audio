# LiveAudio Translate 🎧 | Extensión de Chrome (Groq Whisper Turbo)

Extensión de navegador para Google Chrome (**Manifest V3**) que captura internamente el audio reproducido en cualquier pestaña o ventana (videos, Zoom, Meet, plataformas de inglés, podcasts o cursos virtuales), lo transcribe en inglés mediante **Groq Whisper Turbo** y lo traduce al español en segundos con **subtítulos flotantes o en una ventana para segundo monitor**.

---

## 🚀 Características Principales

1. **Motor 100% Gratuito y sin Tarjetas (Groq Whisper Turbo):**
   - Utiliza el modelo oficial `whisper-large-v3-turbo` de OpenAI ejecutado en los microprocesadores LPU de **Groq**.
   - Capa gratuita generosa: **2,000 peticiones diarias** y hasta **7,200 segundos de audio por hora**.
   - Traduce al español en 40 ms mediante el servicio público de Google Translate (**sin costo ni API key adicional**).
   - Velocidad ultra rápida (~180 ms de respuesta).

2. **Modo Segundo Monitor / Ventana Independiente:**
   - Puedes abrir una ventana limpia (sin pestañas ni barra de URL) con el botón **`🗗 Abrir en Segundo Monitor`**.
   - Ideal para reuniones donde estás compartiendo pantalla: los demás ven tu pantalla limpia, mientras tú ves las traducciones en tu segundo monitor.
   - Cuenta con **letra gigante ajustable (hasta 48px)** y modo teleprompter con auto-desplazamiento.

3. **Captura de OTRA Ventana (Zoom, Teams, etc.):**
   - Puedes capturar el audio de la pestaña activa o presionar **`🎙️ Escuchar otra ventana / Zoom`** para capturar cualquier reunión o aplicación que reproduzca audio en tu PC.

4. **Subtítulo Flotante en Pantalla (Glassmorphism):**
   - Si no usas segundo monitor, puedes ver la caja flotante sobre el video, moverla arrastrando con el ratón o enviarla a la ventana externa con el botón `🗗`.

---

## 🛠️ Instalación en Google Chrome

1. Abre Google Chrome y escribe en la barra:
   ```text
   chrome://extensions/
   ```
2. Activa **"Modo de desarrollador"** (arriba a la derecha).
3. Haz clic en **"Cargar descomprimida"** y selecciona esta carpeta:
   ```text
   e:\USS\PROYECTOS\ellucian-instructivos\extension-traductor-audio
   ```
   *(Si ya estaba cargada, solo pulsa el botón de recargar 🔄)*.

---

## 🔑 Clave Gratuita de Groq (15 segundos)

1. Entra a: [**console.groq.com/keys**](https://console.groq.com/keys).
2. Inicia sesión con tu cuenta de Google (Gmail).
3. Haz clic en **"Create API Key"**, ponle cualquier nombre y copia la clave (`gsk_...`). *(No requiere tarjeta de crédito)*.
4. Pega la clave en la extensión y pulsa **"Guardar"**.
