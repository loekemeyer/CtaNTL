# Cuenta Corriente NTL

Aplicación web para llevar las cuentas corrientes (antes en el Excel `Cuenta Corriente NTL.xlsx`).
Permite **ver, agregar, modificar y eliminar** movimientos desde cualquier navegador, sin instalar nada.

## 🔗 Cómo verla online (GitHub Pages)

1. En GitHub, entrar en **Settings → Pages**.
2. En *Build and deployment → Source* elegir **Deploy from a branch**.
3. Seleccionar la rama donde están estos archivos y la carpeta **`/ (root)`**. Guardar.
4. A los pocos minutos la página queda disponible en:
   `https://<usuario>.github.io/<repositorio>/`

También se puede abrir localmente con doble clic en `index.html`.

## 🧾 Qué incluye

- **Resumen**: saldos totales de cada cuenta y proveedores.
- **Cuenta NTL** y **Cuenta CH**: el libro completo con **saldo calculado automáticamente**
  (saldo anterior + créditos − débitos), desglose por empresa, buscador y filtros
  por empresa, tipo y rango de fechas, más la sección de *Pendientes de recupero*.
- **Ownland** y **Frontier**: seguimiento de proveedores.

En cada tabla se puede:
- **＋ Nuevo movimiento** — cargar una fila con un formulario.
- **✎ Editar** / **🗑 Eliminar** cualquier fila.
- **↕ Ordenar por fecha** y **⬇ CSV** (se abre en Excel).

## 💾 Dónde se guardan los datos

Los cambios se guardan **automáticamente en tu navegador** (localStorage). Para no perderlos
o compartirlos entre dispositivos, usá los botones de la barra superior:

| Botón | Para qué |
|-------|----------|
| **⬇ Backup JSON** | Descarga una copia de seguridad de todo. |
| **⬆ Importar** | Restaura los datos desde un backup JSON. |
| **💾 Guardar en repo** | Genera el archivo `data.js`. Si lo subís al repositorio, la versión online queda actualizada para todos. |

> Para que la versión publicada muestre datos nuevos para cualquiera que la abra por primera vez,
> reemplazá el `data.js` del repositorio por el que descargaste con **Guardar en repo**.

## 🗂️ Archivos

- `index.html` — estructura de la página.
- `styles.css` — estilos.
- `app.js` — lógica (CRUD, filtros, saldos, exportar/importar).
- `data.js` — datos iniciales extraídos del Excel.
