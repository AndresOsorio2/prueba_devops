#!/bin/bash

# ========================================
# VERIFICACIÓN DE PROYECTO: Backend
# ========================================

# Ir al directorio del script (permite ejecutar desde cualquier lugar)
cd "$(dirname "$0")" || exit 1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
WARN=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASS++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAIL++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARN++))
}

echo "========================================"
echo "  VERIFICACIÓN DE PROYECTO: Backend"
echo "  Fecha: $(date)"
echo "========================================"
echo ""

# 1. Node.js
echo "--- Entorno Runtime ---"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    if [[ "$NODE_VERSION" == v20.* ]]; then
        check_pass "Node.js $NODE_VERSION (requerido: v20.x)"
    else
        check_warn "Node.js $NODE_VERSION (se recomienda: v20.x)"
    fi
else
    check_fail "Node.js no encontrado"
fi

# 2. npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    check_pass "npm $NPM_VERSION"
else
    check_fail "npm no encontrado"
fi

echo ""

# 3. Dependencias
echo "--- Dependencias ---"
if [ -d "node_modules" ]; then
    DEPS=$(ls node_modules | wc -l)
    check_pass "node_modules existe ($DEPS paquetes)"
else
    check_fail "node_modules no encontrado - ejecuta: npm install"
fi

if [ -f "package.json" ]; then
    check_pass "package.json existe"
    
    # Verificar dependencias faltantes
    if [ -d "node_modules" ]; then
        MISSING=$(npm ls --depth=0 2>&1 | grep "missing" | wc -l)
        if [ "$MISSING" -gt 0 ]; then
            check_fail "Hay $MISSING dependencias faltantes"
        else
            check_pass "Todas las dependencias instaladas"
        fi
    fi
else
    check_fail "package.json no encontrado"
fi

echo ""

# 4. Configuración
echo "--- Configuración ---"
if [ -f ".env" ]; then
    check_pass "Archivo .env existe"
    
    # Verificar variables requeridas
    if grep -q "MONGODB_URI" .env; then
        check_pass "MONGODB_URI configurada"
    else
        check_fail "MONGODB_URI no encontrada en .env"
    fi
    
    if grep -q "SEQ_SERVER_URL" .env; then
        check_pass "SEQ_SERVER_URL configurada"
    else
        check_warn "SEQ_SERVER_URL no encontrada en .env"
    fi
    
    # D-105: el default real vive en src/config. Se lee de alli en vez de repetirlo aqui.
    DEFAULT_PORT=$(node -e "process.stdout.write(String(require('./src/config').port))" 2>/dev/null)
    DEFAULT_PORT=${DEFAULT_PORT:-3000}

    if grep -q "PORT" .env; then
        check_pass "PORT configurado"
    else
        check_warn "PORT no configurado (usando default: ${DEFAULT_PORT})"
    fi
    
    if grep -q "JWT_SECRET" .env; then
        check_pass "JWT_SECRET configurada"
    else
        check_fail "JWT_SECRET no encontrada en .env"
    fi
    
    if grep -q "CORS_ORIGIN" .env; then
        check_pass "CORS_ORIGIN configurada"
    else
        check_fail "CORS_ORIGIN no encontrada en .env"
    fi
    
    if grep -q "TOKEN_EXPIRES_IN" .env; then
        check_pass "TOKEN_EXPIRES_IN configurada"
    else
        check_warn "TOKEN_EXPIRES_IN no configurada (usando default: 8h)"
    fi
else
    check_warn "Archivo .env no encontrado (usando .env.local)"
fi

echo ""

# 5. Servicios externos
echo "--- Servicios Externos ---"

# MongoDB
if command -v mongosh &> /dev/null; then
    MONGO_STATUS=$(mongosh --eval "db.adminCommand('ping')" --quiet 2>&1)
    if echo "$MONGO_STATUS" | grep -q "ok"; then
        check_pass "MongoDB responde correctamente"
    else
        check_fail "MongoDB no responde"
    fi
else
    # Intentar con curl si mongosh no está disponible
    if curl -s localhost:27017 > /dev/null 2>&1; then
        check_pass "MongoDB reachable en puerto 27017"
    else
        check_warn "No se puede verificar MongoDB (mongosh no disponible)"
    fi
fi

# SEQ
if curl -s localhost:5341 > /dev/null 2>&1; then
    check_pass "SEQ reachable en puerto 5341"
else
    check_warn "SEQ no reachable en puerto 5341"
fi

echo ""

# 6. Build
echo "--- Build ---"
if [ -f "src/index.js" ]; then
    check_pass "src/index.js existe"
else
    check_fail "src/index.js no encontrado"
fi

echo ""

# 7. Tests
echo "--- Tests ---"
if grep -q '"test"' package.json 2>/dev/null; then
    npm test > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        check_pass "Tests pasaron correctamente"
    else
        check_fail "Tests fallaron"
    fi
else
    check_warn "No hay tests configurados"
fi

echo ""

# 8. Docker
echo "--- Docker ---"
if [ -f "../infra/docker-compose.yml" ]; then
    check_pass "docker-compose.yml existe en /infra"
else
    check_warn "docker-compose.yml no encontrado en /infra"
fi

if [ -f "Dockerfile" ]; then
    check_pass "Dockerfile existe"
else
    check_warn "Dockerfile no encontrado"
fi

echo ""

# Resumen
echo "========================================"
if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}  RESUMEN: $PASS pasaron, $WARN advertencias, $FAIL errores${NC}"
    echo "  Estado: LISTO ✓"
else
    echo -e "${RED}  RESUMEN: $PASS pasaron, $WARN advertencias, $FAIL errores${NC}"
    echo "  Estado: NO LISTO ✗"
fi
echo "========================================"

# Salir con código de error si hay fallos
[ $FAIL -eq 0 ] && exit 0 || exit 1
