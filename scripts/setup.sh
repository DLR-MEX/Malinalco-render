#!/bin/bash
# Script de instalación para MALINALCO RENDER (Linux/macOS)
# Verifica Node.js e instala dependencias

echo
echo "===================================="
echo "  MALINALCO RENDER - Setup (Unix)"
echo "===================================="
echo

# Verificar si Node.js esta instalado
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js no esta instalado"
    echo
    echo "Por favor instala Node.js desde: https://nodejs.org/"
    echo "O usa tu gestor de paquetes:"
    echo "  - macOS: brew install node"
    echo "  - Ubuntu/Debian/Raspberry Pi: sudo apt-get install nodejs npm"
    echo "  - Fedora: sudo dnf install nodejs npm"
    echo
    echo "Requiere version: 20.0.0 o superior"
    exit 1
fi

# Obtener versiones
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)

echo "[OK] Node.js encontrado: $NODE_VERSION"
echo "[OK] npm encontrado: $NPM_VERSION"
echo

# Instalar dependencias
echo "Instalando dependencias npm..."
npm install

if [ $? -ne 0 ]; then
    echo
    echo "[ERROR] Error durante la instalacion de npm"
    exit 1
fi

echo
echo "[OK] Instalacion completada exitosamente"
echo
echo "Proximos pasos:"
echo "  1. Crear archivo .env desde .env.example (si no existe)"
echo "  2. Ejecutar: npm start"
echo "  3. O para desarrollo: npm run dev"
echo
