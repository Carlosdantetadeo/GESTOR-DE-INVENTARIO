# Guía de Obtención de Credenciales: Supabase y Groq (Ferretería Zero-Typing)

Esta guía te explica paso a paso cómo obtener las credenciales necesarias para configurar tu servidor n8n con los servicios de **Supabase (PostgreSQL)** y **Groq (API de Inteligencia Artificial)**.

---

## 💾 1. Credenciales de Supabase (Postgres)

Para que n8n pueda leer y escribir en tu base de datos de Supabase, necesitas los datos de conexión PostgreSQL.

### Paso 1.1: Acceder a los ajustes de la base de datos
1. Inicia sesión en tu panel de [Supabase](https://supabase.com).
2. Selecciona tu proyecto ferretero en la lista de proyectos.
3. En el menú lateral izquierdo, haz clic en el ícono de **Settings** (el engranaje ⚙️) en la parte inferior.
4. Dentro del menú de configuración del proyecto, haz clic en **Database** (Base de datos).

### Paso 1.2: Copiar los datos de conexión (Connection Info)
Desplázate hacia abajo hasta la sección **Connection info** (Información de conexión). Ahí encontrarás los siguientes datos individuales que deberás rellenar en n8n:

*   **Host:** Por ejemplo, `db.xxxxxxxxxxxxxx.supabase.co`
*   **Database name:** Por defecto es `postgres`.
*   **Port:** Por defecto es `5432` o `6543` (se recomienda usar el puerto directo `5432` o el pooler `6543` según tu configuración. Generalmente para n8n, el puerto estándar directo es `5432`).
*   **User:** Por defecto es `postgres`.
*   **Password:** La contraseña que creaste al inicializar el proyecto en Supabase.
    *   *Nota:* Si olvidaste tu contraseña, puedes hacer clic en **Reset database password** en esa misma pantalla para crear una nueva.
*   **SSL:** Marca la opción de habilitar SSL (generalmente `SSL: Require` o `SSL: True` en n8n) para asegurar una conexión cifrada con Supabase.

### Paso 1.3: Alternativa por URI de Conexión (Connection String)
Si prefieres usar una URI completa:
1. En la misma pantalla de **Database Settings**, busca la sección **Connection String**.
2. Selecciona la pestaña **URI**.
3. Copia la cadena que tiene el formato:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxx.supabase.co:5432/postgres`
4. Reemplaza `[YOUR-PASSWORD]` con la contraseña real de tu base de datos.

---

## ⚡ 2. Credenciales de Groq (API Key para Whisper y Llama 3)

Usamos Groq por su velocidad extrema de respuesta (<2 segundos) tanto para la transcripción del audio como para la interpretación de Llama 3.

### Paso 2.1: Obtener tu API Key en Groq
1. Entra a la consola de desarrolladores de Groq: [console.groq.com](https://console.groq.com/).
2. Regístrate o inicia sesión con tu cuenta.
3. En el menú lateral izquierdo, haz clic en **API Keys** (Llaves de API).
4. Haz clic en el botón **Create API Key** (Crear Llave de API).
5. Dale un nombre identificable (ej. `n8n-ferreteria-mvp`).
6. **Copia la API Key inmediatamente** (comienza con `gsk_...`) y guárdala en un lugar seguro. No podrás volver a verla una vez que cierres la ventana.

### Paso 2.2: Configurar la Credencial en n8n (Header Auth)
Dado que estamos interactuando con la API de Groq mediante el nodo **HTTP Request** estándar de n8n, configuraremos una credencial de tipo **Header Auth** (Autenticación por Cabecera):

1. En tu panel de n8n, ve a **Credentials** (Credenciales) ➔ **Add Credential** (Añadir Credencial).
2. Busca e inserta **Header Auth** (o **Header de autenticación HTTP**).
3. Configura la credencial con los siguientes campos exactos:
    *   **Name (Nombre para ti en n8n):** `Groq Header Auth`
    *   **Name (Nombre del Header):** `Authorization`
    *   **Value (Valor del Header):** `Bearer <TU_API_KEY_DE_GROQ>`
        *   *Ejemplo real:* Si tu API Key es `gsk_123456abc`, el valor debe ser exactamente:
            `Bearer gsk_123456abc` (asegúrate de incluir la palabra `Bearer ` con un espacio antes de la llave).

---

¡Eso es todo! Con estos dos bloques de credenciales y tu token de Telegram, tu MVP de inventario funcionará de manera fluida y ultra veloz. 🚀
