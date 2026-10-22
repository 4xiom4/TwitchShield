# TwitchShield 🛡️

Solución moderna, modular y de cero latencia para evadir anuncios en Twitch mediante extracción dinámica de tokens GraphQL y sincronización continua HLS.

---

## 🚀 Instalación y Uso

### Opción 1: Userscript (Recomendado)
Compatible con **Violentmonkey** o **Tampermonkey** (Firefox, Chrome, Brave, Edge).

1. Instala [Violentmonkey](https://violentmonkey.github.io/) o [Tampermonkey](https://www.tampermonkey.net/).
   > *En navegadores basados en Chromium (Chrome/Brave/Edge), asegúrate de activar el **"Modo de desarrollador"** o permitir scripts de usuario en `chrome://extensions`.*
2. Agrega un nuevo script en la extensión y copia el contenido compilado de:
   👉 **[`dist/twitch-shield.user.js`](dist/twitch-shield.user.js)**
3. Guarda el script.
4. Abre cualquier stream en [twitch.tv](https://www.twitch.tv). Verás el indicador `🛡️ TwitchShield Active` en la esquina superior izquierda del reproductor.

---

### Opción 2: uBlock Origin

1. Abre el panel de control de **uBlock Origin** (Opciones).
2. En la pestaña **Mis filtros**, agrega esta regla:
   ```adblock
   twitch.tv##+js(twitch-videoad)
   ```
3. En la pestaña **Configuración**, activa la casilla **"Soy un usuario avanzado"** y haz clic en el icono del engranaje ⚙️.
4. Busca `userResourcesLocation` y escribe la ruta local o URL a:
   ```text
   userResourcesLocation file:///home/axioma/Documentos/Proyectos/TwitchShield/dist/twitch-shield.ublock.js
   ```
   *(Si ya tienes otra URL, deja un espacio antes de agregar esta).*
5. Haz clic en **Aplicar cambios** y reinicia el navegador o recarga la extensión.

---

## ⚙️ Menú en el Reproductor

Haz clic en el indicador `🛡️ TwitchShield` o en su icono `⚙️` en la pantalla del directo para abrir el panel de control:
* **Auto Buffer Watchdog:** Detecta y recupera automáticamente congelamientos de video sin recargar la página.
* **Ad Stripping Fallback:** Suprime los fragmentos de anuncio si los streams limpios de respaldo no están disponibles.
* **Full Reload on Stall:** Activa recarga profunda si el stream se congela repetidamente.
* **🔄 Force Reload Stream:** Botón manual para resincronizar el reproductor con un solo clic.

---

## 🛠️ Desarrollo y Compilación

Requisitos: Node.js >= 18.

```bash
# Instalar dependencias
npm install

# Comprobar tipos TypeScript
npm run typecheck

# Ejecutar tests unitarios
npm test

# Compilar bundles para Userscript y uBlock
npm run build
```

Los archivos generados se crean en la carpeta `dist/`.

---

## 📄 Licencia

MIT License.
