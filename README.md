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
4. Abre cualquier stream en [twitch.tv](https://www.twitch.tv). Funcionará de forma 100% silenciosa en segundo plano (sin banners ni elementos que interrumpan la visualización).

---

### Opción 2: uBlock Origin

1. Abre el panel de control de **uBlock Origin** (Opciones).
2. En la pestaña **Mis filtros**, agrega esta regla:
   ```adblock
   twitch.tv##+js(twitch-videoad)
   ```
3. En la pestaña **Configuración**, activa la casilla **"Soy un usuario avanzado"** y haz clic en el icono del engranaje ⚙️.
4. En `userResourcesLocation`, añade la ruta local:
   ```text
   file:///home/axioma/Documentos/Proyectos/TwitchShield/dist/twitch-shield.ublock.js
   ```
5. Haz clic en **Aplicar cambios**.

---

## ⚙️ Configuración y Modo Silencioso

* **Modo Silencioso por Defecto:** No añade elementos visuales ni banners sobre el reproductor de Twitch para no interrumpir el directo.
* **Soporte de Idiomas:** Mensajes y configuración en Español (`es`) por defecto con soporte multi-idioma.
* **Watchdog Anti-Congelamiento:** Monitorea el buffering para evitar pausas o pantallas negras tras los cortes de streaming.
* **Consola de Diagnóstico:** Puedes consultar el estado en cualquier momento ejecutando `TwitchShield.status()` en la consola del navegador.

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
