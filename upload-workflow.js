/**
 * ============================================================================
 * SCRIPT: upload-workflow.js
 * Descripción: Sube un workflow JSON a n8n utilizando su API REST.
 * 
 * INSTRUCCIONES DE EJECUCIÓN Y CONFIGURACIÓN:
 * 
 * Opción A: Mediante archivo .env (Recomendado)
 * --------------------------------------------
 * 1. Instala la librería 'dotenv':
 *    npm install dotenv
 * 2. Crea un archivo '.env' en la raíz del proyecto con el siguiente contenido:
 *    N8N_BASE_URL=https://tu-instancia.n8n.cloud
 *    N8N_API_TOKEN=tu-jwt-token-de-acceso
 * 3. Ejecuta el script:
 *    node upload-workflow.js
 * 
 * Opción B: Mediante Variables de Entorno del Sistema
 * --------------------------------------------------
 * En PowerShell:
 *    $env:N8N_BASE_URL="https://tu-instancia.n8n.cloud"
 *    $env:N8N_API_TOKEN="tu-jwt-token-de-acceso"
 *    node upload-workflow.js
 * 
 * En CMD/Command Prompt:
 *    set N8N_BASE_URL=https://tu-instancia.n8n.cloud
 *    set N8N_API_TOKEN=tu-jwt-token-de-acceso
 *    node upload-workflow.js
 * 
 * Opción C: Mediante Argumentos de Línea de Comandos
 * --------------------------------------------------
 * Ejecuta el script pasando los argumentos:
 *    node upload-workflow.js --url https://tu-instancia.n8n.cloud --token tu-jwt-token-de-acceso
 * 
 * ============================================================================
 */

// Cargar variables desde archivo .env si la librería dotenv está disponible
try {
  require('dotenv').config();
} catch (e) {
  // Continuar silenciosamente si dotenv no está instalado
}

const fs = require('fs');
const https = require('https');

// Analizar argumentos de línea de comandos (formato simple: --url <valor> --token <valor>)
const args = process.argv.slice(2);
let cliUrl = null;
let cliToken = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) {
    cliUrl = args[i + 1];
  }
  if (args[i] === '--token' && args[i + 1]) {
    cliToken = args[i + 1];
  }
}

// Configuración - Lee de argumentos CLI o variables de entorno
const N8N_BASE_URL = cliUrl || process.env.N8N_BASE_URL;
const BEARER_TOKEN = cliToken || process.env.N8N_API_TOKEN;
const WORKFLOW_FILE = 'n8n_workflow_v2.json';

// Validar parámetros obligatorios
if (!N8N_BASE_URL || !BEARER_TOKEN) {
  console.error('❌ Error de configuración: Falta N8N_BASE_URL o BEARER_TOKEN/N8N_API_TOKEN.');
  console.error('\nPor favor, configura las variables de entorno de una de las siguientes formas:');
  console.error('1. Crea un archivo .env en este directorio con:');
  console.error('   N8N_BASE_URL=https://tu-instancia.n8n.cloud');
  console.error('   N8N_API_TOKEN=tu-jwt-token-de-acceso');
  console.error('2. O define variables de entorno en tu sistema:');
  console.error('   (Ver instrucciones detalladas en la cabecera de este script)');
  console.error('3. O ejecuta el script pasando los argumentos:');
  console.error('   node upload-workflow.js --url https://tu-instancia.n8n.cloud --token tu-jwt-token\n');
  process.exit(1);
}

// Función para hacer una petición HTTP POST
function uploadWorkflow(workflowData) {
  return new Promise((resolve, reject) => {
    // Parsear la URL para obtener hostname y path
    const url = new URL(`${N8N_BASE_URL}/rest/workflows`);
    
    // Convertir el objeto workflow a JSON string
    const jsonData = JSON.stringify(workflowData);
    
    // Configurar las opciones de la petición HTTPS
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Length': Buffer.byteLength(jsonData)
      }
    };
    
    console.log('📤 Subiendo workflow a n8n...');
    console.log(`📍 URL: ${N8N_BASE_URL}/rest/workflows`);
    console.log(`📄 Archivo: ${WORKFLOW_FILE}`);
    
    // Crear la petición
    const req = https.request(options, (res) => {
      let responseData = '';
      
      // Acumular los datos de la respuesta
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      // Cuando termine la respuesta
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ ¡Workflow subido exitosamente!');
          console.log('📋 Respuesta:', responseData);
          
          try {
            const response = JSON.parse(responseData);
            if (response.id) {
              console.log(`🆔 ID del workflow: ${response.id}`);
              console.log(`📝 Nombre: ${response.name}`);
              
              // Opcional: Activar el workflow
              activateWorkflow(response.id)
                .then(() => {
                  resolve(response);
                })
                .catch(reject);
            } else {
              resolve(response);
            }
          } catch (e) {
            resolve(responseData);
          }
        } else {
          console.error('❌ Error al subir el workflow');
          console.error(`Status Code: ${res.statusCode}`);
          console.error('Respuesta:', responseData);
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });
    
    // Manejar errores de la petición
    req.on('error', (error) => {
      console.error('❌ Error de conexión:', error.message);
      reject(error);
    });
    
    // Enviar los datos del workflow
    req.write(jsonData);
    req.end();
  });
}

// Función para activar el workflow después de crearlo
function activateWorkflow(workflowId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${N8N_BASE_URL}/rest/workflows/${workflowId}`);
    const jsonData = JSON.stringify({ active: true });
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Length': Buffer.byteLength(jsonData)
      }
    };
    
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Workflow activado correctamente');
          resolve(responseData);
        } else {
          console.warn('⚠️ No se pudo activar el workflow automáticamente');
          console.warn(`Status Code: ${res.statusCode}`);
          resolve(responseData); // No rechazamos, solo avisamos
        }
      });
    });
    
    req.on('error', reject);
    req.write(jsonData);
    req.end();
  });
}

// Función principal
async function main() {
  try {
    // Leer el archivo JSON del workflow
    console.log(`📖 Leyendo archivo: ${WORKFLOW_FILE}...`);
    
    if (!fs.existsSync(WORKFLOW_FILE)) {
      throw new Error(`El archivo ${WORKFLOW_FILE} no existe`);
    }
    
    const fileContent = fs.readFileSync(WORKFLOW_FILE, 'utf8');
    const workflowData = JSON.parse(fileContent);
    
    console.log(`✅ Archivo leído correctamente`);
    console.log(`📊 Nombre del workflow: ${workflowData.name}`);
    console.log(`🔧 Nodos: ${workflowData.nodes.length}`);
    
    // Subir el workflow a n8n
    await uploadWorkflow(workflowData);
    
    console.log('\n🎉 ¡Proceso completado!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Ejecutar el script
main();
