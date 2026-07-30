# Cuenta Corriente NTL

Aplicación web para llevar las cuentas corrientes (antes en el Excel `Cuenta Corriente NTL.xlsx`).
Permite **ver, agregar, modificar y eliminar** movimientos desde cualquier navegador, sin instalar nada.

Los datos son **compartidos**: viven en **Supabase** (proyecto *Costos*) y se sincronizan
**en tiempo real** entre todos los dispositivos. Ver es libre; **editar requiere una clave**.

## 🌐 La página online

👉 **https://fxyhvacysnqzzsdvmplx.supabase.co/functions/v1/cuenta**

Está publicada como una **Supabase Edge Function** (misma cuenta *Costos*), así que ya funciona
sin depender de GitHub Pages. Guardala en favoritos / pantalla de inicio del teléfono.

## 🔑 Clave de edición

- La clave inicial es **`NTL2026`**. **Cambiala** apenas puedas: botón **🔒 Editar** → **Cambiar clave**.
- Cualquiera con el link puede **ver** los datos; solo quien tenga la clave puede **guardar cambios**.
- La clave se guarda encriptada (bcrypt) en Supabase y se valida en el servidor: no se puede
  deducir desde la página.

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

Todo se guarda en **Supabase** (proyecto *Costos*), en las tablas `cc_movimientos` y
`cc_pendientes`. Cada cambio se replica en vivo a los navegadores conectados.

- El indicador de arriba muestra **Conectado** / **Sin conexión**.
- Si te quedás sin internet, la app muestra la **última copia** guardada localmente y avisa
  que no se guardará hasta reconectar.
- **⬇ Backup** descarga una copia completa en JSON por las dudas.

### Seguridad (cómo funciona)

- Las tablas tienen **RLS**: lectura pública, sin escritura directa.
- Agregar/editar/borrar pasa por **funciones en el servidor** (`cc_upsert_movimiento`,
  `cc_delete_movimiento`, `cc_upsert_pendiente`, etc.) que **exigen la clave** antes de tocar
  la base. La clave pública (`sb_publishable_...`) del `supabase-config.js` solo sirve para leer.

## 🗂️ Archivos

- `index.html` — estructura de la página.
- `styles.css` — estilos.
- `app.js` — lógica (carga desde Supabase, CRUD con clave, filtros, saldos, tiempo real).
- `supabase-config.js` — URL y clave pública del proyecto (seguro exponerlas).
- `data.js` — copia del Excel usada solo como respaldo offline inicial.
- `deploy/` — cómo se publica online:
  - `build_standalone.py` — junta todo en un solo HTML y genera `functions/cuenta/page.ts`.
  - `functions/cuenta/index.ts` — la Edge Function que sirve la página.

### Publicar cambios online

Cuando edites `index.html`, `styles.css` o `app.js`, para actualizar la versión online:

1. `python3 deploy/build_standalone.py`
2. Redeployar la función `cuenta` en Supabase con `deploy/functions/cuenta/index.ts` y `page.ts`.

> El otro camino (opcional) es **GitHub Pages**: Settings → Pages → esta rama → carpeta `/ (root)`.
> Sirve los mismos archivos sueltos en `https://<usuario>.github.io/<repo>/`.
