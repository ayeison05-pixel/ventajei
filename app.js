// app.js - Versión con formato de fecha dd/mm/yyyy y hora sin segundos

const TIMEZONE = 'America/Caracas';
const formatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

// Funciones auxiliares para formatear visualmente fecha y hora
function formatearFechaVisual(fechaISO) {
    if (!fechaISO) return '';
    const partes = fechaISO.split('-');
    if (partes.length === 3) {
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return fechaISO; // fallback
}

function formatearHoraVisual(horaCompleta) {
    if (!horaCompleta) return '';
    // Elimina los segundos (":ss") antes del espacio o del final
    return horaCompleta.replace(/(:\d{2})(?=\s|$)/, '');
}

let db;
const DB_NAME = 'PuntoVentaDB';
const DB_VERSION = 2;

// Referencias a modales personalizados
const modalConfirm = document.getElementById('modal-confirm');
const modalAlert = document.getElementById('modal-alert');
const modalReporte = document.getElementById('modal-reporte');
let confirmResolve = null;

// Contador de toques para el encabezado
let tapCount = 0;
let tapTimer = null;

// Función para reiniciar todos los datos (mejorada)
async function resetAllData() {
    const confirmacion = await showConfirm('¿Eliminar TODOS los datos? Esta acción no se puede deshacer.');
    if (!confirmacion) return;

    // Cerrar la conexión actual si existe
    if (db) {
        db.close();
    }

    // Eliminar la base de datos
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
    deleteRequest.onsuccess = () => {
        showAlert('Datos eliminados. La aplicación se recargará.');
        setTimeout(() => {
            location.reload();
        }, 1500);
    };
    deleteRequest.onerror = (e) => {
        console.error('Error al eliminar DB:', e);
        showAlert('Error al eliminar los datos. Intenta de nuevo.');
    };
    deleteRequest.onblocked = () => {
        showAlert('La eliminación está bloqueada. Cierra otras pestañas y vuelve a intentar.');
    };
}

// Detectar toques en el encabezado
document.getElementById('main-header').addEventListener('click', () => {
    tapCount++;
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
        tapCount = 0; // Reiniciar después de 1 segundo sin toques
    }, 1000);

    if (tapCount === 3) {
        tapCount = 0;
        resetAllData();
    }
});

// Funciones para modales personalizados
function showConfirm(mensaje) {
    return new Promise((resolve) => {
        document.getElementById('confirm-mensaje').textContent = mensaje;
        modalConfirm.style.display = 'flex';
        confirmResolve = resolve;
    });
}

function showAlert(mensaje) {
    return new Promise((resolve) => {
        document.getElementById('alert-mensaje').textContent = mensaje;
        modalAlert.style.display = 'flex';
        const okBtn = document.getElementById('alert-ok');
        okBtn.onclick = () => {
            modalAlert.style.display = 'none';
            resolve();
        };
    });
}

document.getElementById('confirm-si').addEventListener('click', () => {
    modalConfirm.style.display = 'none';
    if (confirmResolve) confirmResolve(true);
});

document.getElementById('confirm-no').addEventListener('click', () => {
    modalConfirm.style.display = 'none';
    if (confirmResolve) confirmResolve(false);
});

// Cerrar modales al hacer clic fuera
window.addEventListener('click', (e) => {
    if (e.target === modalConfirm) modalConfirm.style.display = 'none';
    if (e.target === modalAlert) modalAlert.style.display = 'none';
    if (e.target === modalReporte) modalReporte.style.display = 'none';
});

document.querySelector('.close-modal-reporte').addEventListener('click', () => {
    modalReporte.style.display = 'none';
});

document.getElementById('reporte-cerrar').addEventListener('click', () => {
    modalReporte.style.display = 'none';
});

// Base de datos
const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onerror = (event) => console.error('Error al abrir DB:', event.target.error);
request.onsuccess = (event) => {
    db = event.target.result;
    console.log('DB abierta correctamente');
    cargarBalanceDiario();
    cargarProductosEnSelect();
    cargarListaProductos();
};

request.onupgradeneeded = (event) => {
    db = event.target.result;
    const oldVersion = event.oldVersion;

    if (!db.objectStoreNames.contains('productos')) {
        const storeProductos = db.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
        storeProductos.createIndex('nombre', 'nombre', { unique: false });
    }
    if (!db.objectStoreNames.contains('ventas')) {
        const storeVentas = db.createObjectStore('ventas', { keyPath: 'id', autoIncrement: true });
        storeVentas.createIndex('fecha', 'fecha', { unique: false });
        storeVentas.createIndex('metodo', 'metodo', { unique: false });
        storeVentas.createIndex('cerrado', 'cerrado', { unique: false });
    }
    if (!db.objectStoreNames.contains('cierres')) {
        db.createObjectStore('cierres', { keyPath: 'fecha' });
    }

    if (oldVersion < 2) {
        const tx = event.target.transaction;
        const productStore = tx.objectStore('productos');
        productStore.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const prod = cursor.value;
                if (!prod.tipo) {
                    prod.tipo = 'unidad';
                    prod.unidadesPorEmpaque = 1;
                    cursor.update(prod);
                }
                cursor.continue();
            }
        };
    }
};

// Variables globales
let carrito = [];
let productoEditandoId = null;
let productoSeleccionado = null;

// ------------------------- Helper fecha
function getFechaCaracas() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

// ------------------------- Balance diario (solo ventas no cerradas)
async function cargarBalanceDiario() {
    const fechaHoy = getFechaCaracas();
    const tx = db.transaction('ventas', 'readonly');
    const store = tx.objectStore('ventas');
    const index = store.index('fecha');
    const range = IDBKeyRange.only(fechaHoy);
    const ventasHoy = await new Promise((resolve) => {
        const ventas = [];
        index.openCursor(range).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                ventas.push(cursor.value);
                cursor.continue();
            } else {
                resolve(ventas);
            }
        };
    });

    const ventasAbiertas = ventasHoy.filter(v => !v.cerrado);
    let totalEfectivo = 0, totalTransferencia = 0;
    ventasAbiertas.forEach(venta => {
        if (venta.metodo === 'efectivo') totalEfectivo += venta.total;
        else if (venta.metodo === 'transferencia') totalTransferencia += venta.total;
        else if (venta.metodo === 'mixto') {
            totalEfectivo += venta.montoEfectivo || 0;
            totalTransferencia += venta.montoTransferencia || 0;
        }
    });

    document.getElementById('balance-efectivo').textContent = formatter.format(totalEfectivo);
    document.getElementById('balance-transferencia').textContent = formatter.format(totalTransferencia);
}

// ------------------------- Cargar productos en select
function cargarProductosEnSelect() {
    const select = document.getElementById('producto-select');
    select.innerHTML = '<option value="">Seleccionar producto</option>';
    const tx = db.transaction('productos', 'readonly');
    const store = tx.objectStore('productos');
    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const prod = cursor.value;
            const option = document.createElement('option');
            option.value = prod.id;
            let texto = `${prod.nombre} - ${formatter.format(prod.precio)} (Stock: ${prod.stock}`;
            if (prod.tipo === 'peso') texto += ' kg';
            else if (prod.tipo === 'empaque') texto += `, ${prod.unidadesPorEmpaque} uds/emp`;
            else texto += ' uds';
            texto += ')';
            option.textContent = texto;
            select.appendChild(option);
            cursor.continue();
        }
    };
}

// ------------------------- Cargar lista de productos en inventario
function cargarListaProductos() {
    const lista = document.getElementById('lista-productos');
    lista.innerHTML = '';
    const tx = db.transaction('productos', 'readonly');
    const store = tx.objectStore('productos');
    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const prod = cursor.value;
            const li = document.createElement('li');
            let tipoTexto = '';
            if (prod.tipo === 'peso') tipoTexto = ' (kg)';
            else if (prod.tipo === 'empaque') tipoTexto = ` (${prod.unidadesPorEmpaque} uds/emp)`;
            li.innerHTML = `
                <div class="producto-info">
                    <strong>${prod.nombre}</strong><br>
                    Precio: ${formatter.format(prod.precio)} | Stock: ${prod.stock}${tipoTexto}
                </div>
                <div class="producto-acciones">
                    <button onclick="editarProducto(${prod.id})"><i class="fas fa-edit"></i></button>
                    <button onclick="eliminarProducto(${prod.id})"><i class="fas fa-trash"></i></button>
                </div>
            `;
            lista.appendChild(li);
            cursor.continue();
        }
    };
}

// Funciones globales para inventario
window.editarProducto = (id) => {
    const tx = db.transaction('productos', 'readonly');
    const store = tx.objectStore('productos');
    const request = store.get(id);
    request.onsuccess = () => {
        const prod = request.result;
        document.getElementById('prod-nombre').value = prod.nombre;
        document.getElementById('prod-precio').value = prod.precio;
        document.getElementById('prod-stock').value = prod.stock;
        document.getElementById('prod-tipo').value = prod.tipo || 'unidad';
        document.getElementById('prod-unidades-por-empaque').value = prod.unidadesPorEmpaque || 1;
        document.getElementById('empaque-fields').style.display = prod.tipo === 'empaque' ? 'block' : 'none';
        productoEditandoId = id;
        document.getElementById('modal-title').textContent = 'Editar Producto';
        document.getElementById('producto-modal').classList.add('show');
    };
};

window.eliminarProducto = async (id) => {
    const confirmacion = await showConfirm('¿Eliminar producto?');
    if (confirmacion) {
        const tx = db.transaction('productos', 'readwrite');
        tx.objectStore('productos').delete(id);
        tx.oncomplete = () => {
            cargarListaProductos();
            cargarProductosEnSelect();
            showAlert('Producto eliminado');
        };
    }
};

// ------------------------- Manejo de pantallas
function mostrarScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

document.getElementById('btn-venta').addEventListener('click', () => {
    mostrarScreen('venta-screen');
    cargarProductosEnSelect();
    carrito = [];
    actualizarCarritoUI();
    productoSeleccionado = null;
    document.getElementById('controles-producto').innerHTML = '';
});

document.getElementById('btn-inventario').addEventListener('click', () => {
    mostrarScreen('inventario-screen');
    cargarListaProductos();
});

document.getElementById('btn-historial').addEventListener('click', () => {
    mostrarScreen('historial-screen');
    cargarHistorial();
});

document.getElementById('btn-recibos').addEventListener('click', () => {
    mostrarScreen('recibo-screen');
    document.getElementById('recibo-contenido').innerHTML = '<p>Selecciona una venta del historial</p>';
});

document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        mostrarScreen('main-screen');
        cargarBalanceDiario();
    });
});

// ------------------------- Lógica de producto seleccionado
document.getElementById('producto-select').addEventListener('change', (e) => {
    const prodId = e.target.value;
    if (!prodId) {
        productoSeleccionado = null;
        document.getElementById('controles-producto').innerHTML = '';
        return;
    }
    const tx = db.transaction('productos', 'readonly');
    const store = tx.objectStore('productos');
    const request = store.get(Number(prodId));
    request.onsuccess = () => {
        productoSeleccionado = request.result;
        const container = document.getElementById('controles-producto');
        container.innerHTML = '';

        if (productoSeleccionado.tipo === 'peso') {
            container.innerHTML = `
                <div class="control-peso">
                    <input type="number" id="peso-cantidad" placeholder="Cantidad" min="0" step="any" value="0">
                    <select id="peso-unidad">
                        <option value="kg">kg</option>
                        <option value="g">gramos</option>
                    </select>
                </div>
            `;
        } else if (productoSeleccionado.tipo === 'empaque') {
            container.innerHTML = `
                <div class="control-empaque">
                    <div>
                        <label>Unidades sueltas:</label>
                        <input type="number" id="empaque-unidades" min="0" step="1" value="0">
                    </div>
                    <div>
                        <label>Empaques completos:</label>
                        <input type="number" id="empaque-cantidad" min="0" step="1" value="0">
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="control-unidad">
                    <input type="number" id="unidad-cantidad" placeholder="Cantidad" min="0" step="1" value="1">
                </div>
            `;
        }
    };
});

// ------------------------- Agregar al carrito
document.getElementById('agregar-producto-btn').addEventListener('click', () => {
    if (!productoSeleccionado) {
        showAlert('Selecciona un producto');
        return;
    }

    let cantidadTotal = 0;
    let descripcion = '';

    if (productoSeleccionado.tipo === 'peso') {
        const cantidad = parseFloat(document.getElementById('peso-cantidad').value);
        const unidad = document.getElementById('peso-unidad').value;
        if (isNaN(cantidad) || cantidad <= 0) {
            showAlert('Cantidad inválida');
            return;
        }
        if (unidad === 'g') {
            cantidadTotal = cantidad / 1000;
            descripcion = `${cantidad} g`;
        } else {
            cantidadTotal = cantidad;
            descripcion = `${cantidad} kg`;
        }
        if (productoSeleccionado.stock < cantidadTotal) {
            showAlert(`Stock insuficiente. Disponible: ${productoSeleccionado.stock} kg`);
            return;
        }
    } else if (productoSeleccionado.tipo === 'empaque') {
        const unidades = parseInt(document.getElementById('empaque-unidades').value) || 0;
        const empaques = parseInt(document.getElementById('empaque-cantidad').value) || 0;
        if (unidades === 0 && empaques === 0) {
            showAlert('Debes agregar al menos una unidad o empaque');
            return;
        }
        cantidadTotal = unidades + (empaques * productoSeleccionado.unidadesPorEmpaque);
        let partes = [];
        if (unidades > 0) partes.push(`${unidades} und`);
        if (empaques > 0) partes.push(`${empaques} cartón(es) (${empaques * productoSeleccionado.unidadesPorEmpaque} und)`);
        descripcion = partes.join(' + ');
        if (productoSeleccionado.stock < cantidadTotal) {
            showAlert(`Stock insuficiente. Disponible: ${productoSeleccionado.stock} unidades`);
            return;
        }
    } else {
        const cantidad = parseInt(document.getElementById('unidad-cantidad').value);
        if (isNaN(cantidad) || cantidad <= 0) {
            showAlert('Cantidad inválida');
            return;
        }
        cantidadTotal = cantidad;
        descripcion = `${cantidad} und`;
        if (productoSeleccionado.stock < cantidadTotal) {
            showAlert(`Stock insuficiente. Disponible: ${productoSeleccionado.stock} unidades`);
            return;
        }
    }

    const subtotal = productoSeleccionado.precio * cantidadTotal;

    const item = {
        id: productoSeleccionado.id,
        nombre: productoSeleccionado.nombre,
        precio: productoSeleccionado.precio,
        cantidadTotal: cantidadTotal,
        descripcion: descripcion,
        subtotal: subtotal
    };

    carrito.push(item);
    actualizarCarritoUI();
});

function actualizarCarritoUI() {
    const lista = document.getElementById('carrito-lista');
    lista.innerHTML = '';
    let total = 0;
    carrito.forEach((item, index) => {
        total += item.subtotal;
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="detalle">
                <strong>${item.nombre}</strong> ${item.descripcion}
            </div>
            <div>
                ${formatter.format(item.subtotal)}
                <button onclick="quitarDelCarrito(${index})"><i class="fas fa-times"></i></button>
            </div>
        `;
        lista.appendChild(li);
    });
    document.getElementById('total-venta').textContent = formatter.format(total);
}

window.quitarDelCarrito = (index) => {
    carrito.splice(index, 1);
    actualizarCarritoUI();
};

// ------------------------- Pago mixto
document.querySelectorAll('input[name="pago"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        document.getElementById('mixto-fields').style.display = e.target.value === 'mixto' ? 'flex' : 'none';
    });
});

// ------------------------- Finalizar venta
document.getElementById('finalizar-venta-btn').addEventListener('click', async () => {
    if (carrito.length === 0) {
        showAlert('Agrega productos al carrito');
        return;
    }

    const metodo = document.querySelector('input[name="pago"]:checked').value;
    let totalVenta = carrito.reduce((acc, i) => acc + i.subtotal, 0);
    let montoEfectivo = 0, montoTransferencia = 0;

    if (metodo === 'efectivo') {
        montoEfectivo = totalVenta;
    } else if (metodo === 'transferencia') {
        montoTransferencia = totalVenta;
    } else if (metodo === 'mixto') {
        montoEfectivo = parseFloat(document.getElementById('monto-efectivo').value) || 0;
        montoTransferencia = parseFloat(document.getElementById('monto-transferencia').value) || 0;
        if (montoEfectivo + montoTransferencia !== totalVenta) {
            showAlert('La suma de pagos no coincide con el total');
            return;
        }
    }

    const confirmacion = await showConfirm('¿Confirmar la venta?');
    if (!confirmacion) return;

    const tx = db.transaction(['ventas', 'productos'], 'readwrite');
    const ventasStore = tx.objectStore('ventas');
    const productosStore = tx.objectStore('productos');

    const fechaHoy = getFechaCaracas();
    const horaLocal = new Date().toLocaleTimeString('es-VE', { timeZone: TIMEZONE, hour12: true });

    const venta = {
        fecha: fechaHoy,
        hora: horaLocal,
        items: carrito.map(i => ({
            id: i.id,
            nombre: i.nombre,
            descripcion: i.descripcion,
            cantidadTotal: i.cantidadTotal,
            precio: i.precio,
            subtotal: i.subtotal
        })),
        total: totalVenta,
        metodo: metodo,
        montoEfectivo: montoEfectivo,
        montoTransferencia: montoTransferencia,
        cerrado: false
    };

    ventasStore.add(venta);

    carrito.forEach(item => {
        const getRequest = productosStore.get(item.id);
        getRequest.onsuccess = () => {
            const prod = getRequest.result;
            prod.stock -= item.cantidadTotal;
            productosStore.put(prod);
        };
    });

    tx.oncomplete = () => {
        showAlert('Venta registrada');
        carrito = [];
        actualizarCarritoUI();
        cargarBalanceDiario();
        cargarProductosEnSelect();
        mostrarScreen('main-screen');
    };
});

// ------------------------- Inventario: nuevo producto
document.getElementById('nuevo-producto-btn').addEventListener('click', () => {
    productoEditandoId = null;
    document.getElementById('prod-nombre').value = '';
    document.getElementById('prod-precio').value = '';
    document.getElementById('prod-stock').value = '';
    document.getElementById('prod-tipo').value = 'unidad';
    document.getElementById('empaque-fields').style.display = 'none';
    document.getElementById('prod-unidades-por-empaque').value = '';
    document.getElementById('modal-title').textContent = 'Nuevo Producto';
    document.getElementById('producto-modal').classList.add('show');
});

document.querySelector('.close-modal').addEventListener('click', () => {
    document.getElementById('producto-modal').classList.remove('show');
});

document.getElementById('prod-tipo').addEventListener('change', (e) => {
    document.getElementById('empaque-fields').style.display = e.target.value === 'empaque' ? 'block' : 'none';
});

document.getElementById('guardar-producto-btn').addEventListener('click', async () => {
    const nombre = document.getElementById('prod-nombre').value.trim();
    const precio = parseFloat(document.getElementById('prod-precio').value);
    const stock = parseFloat(document.getElementById('prod-stock').value);
    const tipo = document.getElementById('prod-tipo').value;
    let unidadesPorEmpaque = 1;
    if (tipo === 'empaque') {
        unidadesPorEmpaque = parseInt(document.getElementById('prod-unidades-por-empaque').value, 10);
        if (isNaN(unidadesPorEmpaque) || unidadesPorEmpaque < 1) {
            showAlert('Indica las unidades por empaque');
            return;
        }
    }
    if (!nombre || isNaN(precio) || precio <= 0 || isNaN(stock) || stock < 0) {
        showAlert('Datos inválidos');
        return;
    }

    const tx = db.transaction('productos', 'readwrite');
    const store = tx.objectStore('productos');

    const producto = {
        nombre,
        precio,
        stock,
        tipo,
        unidadesPorEmpaque: tipo === 'empaque' ? unidadesPorEmpaque : 1
    };

    if (productoEditandoId) {
        producto.id = productoEditandoId;
        store.put(producto);
    } else {
        store.add(producto);
    }

    tx.oncomplete = () => {
        document.getElementById('producto-modal').classList.remove('show');
        cargarListaProductos();
        cargarProductosEnSelect();
        showAlert(productoEditandoId ? 'Producto actualizado' : 'Producto agregado');
    };
});

// ------------------------- Historial (con formato visual)
async function cargarHistorial(fechaFiltro = '', metodoFiltro = '') {
    const lista = document.getElementById('historial-lista');
    lista.innerHTML = 'Cargando...';
    const tx = db.transaction('ventas', 'readonly');
    const store = tx.objectStore('ventas');
    const allVentas = await new Promise((resolve) => {
        const ventas = [];
        store.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                ventas.push(cursor.value);
                cursor.continue();
            } else {
                resolve(ventas);
            }
        };
    });

    let filtradas = allVentas;
    if (fechaFiltro) filtradas = filtradas.filter(v => v.fecha === fechaFiltro);
    if (metodoFiltro) filtradas = filtradas.filter(v => v.metodo === metodoFiltro);
    filtradas.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));

    lista.innerHTML = '';
    if (filtradas.length === 0) {
        lista.innerHTML = '<p>No hay ventas</p>';
        return;
    }

    filtradas.forEach(venta => {
        const div = document.createElement('div');
        div.className = 'venta-item';
        // Aplicar formato visual
        div.innerHTML = `
            <strong>${formatearFechaVisual(venta.fecha)} ${formatearHoraVisual(venta.hora)}</strong><br>
            Total: ${formatter.format(venta.total)} | Método: ${venta.metodo}
        `;
        div.addEventListener('click', () => mostrarRecibo(venta));
        lista.appendChild(div);
    });
}

document.getElementById('aplicar-filtros').addEventListener('click', () => {
    const fecha = document.getElementById('filtro-fecha').value;
    const metodo = document.getElementById('filtro-metodo').value;
    cargarHistorial(fecha, metodo);
});

// ------------------------- Recibo (con formato visual)
function mostrarRecibo(venta) {
    mostrarScreen('recibo-screen');
    let reciboHtml = `
        <div class="encabezado">PUNTO DE VENTA JEI</div>
        <div class="encabezado" style="font-size:0.9rem;">servicio de calidad</div>
        <div style="text-align:center;">Fecha: ${formatearFechaVisual(venta.fecha)}  Hora: ${formatearHoraVisual(venta.hora)}</div>
        <hr>
    `;
    venta.items.forEach(item => {
        reciboHtml += `<div style="display:flex; justify-content:space-between;">
            <span>${item.nombre} ${item.descripcion}</span>
            <span>${formatter.format(item.subtotal)}</span>
        </div>`;
    });
    reciboHtml += `<hr>
        <div style="display:flex; justify-content:space-between; font-weight:bold;">
            <span>TOTAL</span> <span>${formatter.format(venta.total)}</span>
        </div>
        <div>Método de pago: ${venta.metodo}</div>`;
    if (venta.metodo === 'mixto') {
        reciboHtml += `<div>Efectivo: ${formatter.format(venta.montoEfectivo)}</div>
                       <div>Transferencia: ${formatter.format(venta.montoTransferencia)}</div>`;
    }
    reciboHtml += `<hr><div class="gracias">¡Gracias por su compra!</div>`;
    document.getElementById('recibo-contenido').innerHTML = reciboHtml;
}

// ------------------------- Cierre diario (CORREGIDO: solo ventas no cerradas)
document.getElementById('btn-cierre').addEventListener('click', async () => {
    const confirmacion = await showConfirm('¿Realizar cierre diario? Se reiniciará el balance y se mostrará el reporte de las ventas del día.');
    if (!confirmacion) return;

    const fechaHoy = getFechaCaracas();
    const tx = db.transaction('ventas', 'readonly');
    const store = tx.objectStore('ventas');
    const index = store.index('fecha');
    const range = IDBKeyRange.only(fechaHoy);
    
    const ventasHoy = await new Promise((resolve) => {
        const ventas = [];
        index.openCursor(range).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                ventas.push(cursor.value);
                cursor.continue();
            } else {
                resolve(ventas);
            }
        };
    });

    // Filtrar solo las que NO están cerradas
    const ventasAbiertas = ventasHoy.filter(v => !v.cerrado);

    if (ventasAbiertas.length === 0) {
        showAlert('No hay ventas pendientes de cierre hoy');
        return;
    }

    // Marcar como cerradas
    const txWrite = db.transaction('ventas', 'readwrite');
    const storeWrite = txWrite.objectStore('ventas');
    ventasAbiertas.forEach(venta => {
        venta.cerrado = true;
        storeWrite.put(venta);
    });

    await new Promise((resolve) => { txWrite.oncomplete = resolve; });

    // Guardar cierre en store de cierres (opcional)
    const total = ventasAbiertas.reduce((acc, v) => acc + v.total, 0);
    const totalEfectivo = ventasAbiertas.reduce((acc, v) => acc + (v.montoEfectivo || 0), 0);
    const totalTransferencia = ventasAbiertas.reduce((acc, v) => acc + (v.montoTransferencia || 0), 0);
    const txCierre = db.transaction('cierres', 'readwrite');
    const cierreStore = txCierre.objectStore('cierres');
    cierreStore.put({ fecha: fechaHoy, ventas: ventasAbiertas.length, total, totalEfectivo, totalTransferencia });

    // Mostrar reporte con las ventas cerradas
    mostrarReporte(ventasAbiertas, total, totalEfectivo, totalTransferencia);

    cargarBalanceDiario(); // ahora debe ser cero
});

function mostrarReporte(ventas, total, totalEfectivo, totalTransferencia) {
    const detalle = document.getElementById('reporte-detalle');
    // También podemos formatear la fecha en el reporte si se desea
    let html = `<div class="reporte-item"><strong>Fecha:</strong> ${formatearFechaVisual(getFechaCaracas())}</div>`;
    html += `<div class="reporte-item"><strong>Ventas realizadas:</strong> ${ventas.length}</div>`;
    
    // Agrupar productos vendidos
    const productosVendidos = {};
    ventas.forEach(venta => {
        venta.items.forEach(item => {
            const key = item.nombre;
            if (!productosVendidos[key]) {
                productosVendidos[key] = { cantidad: 0, total: 0 };
            }
            productosVendidos[key].cantidad += item.cantidadTotal;
            productosVendidos[key].total += item.subtotal;
        });
    });

    html += `<hr><h4>Detalle por producto:</h4>`;
    for (const [nombre, data] of Object.entries(productosVendidos)) {
        html += `<div class="reporte-item">
            <div><strong>${nombre}</strong></div>
            <div>Cantidad: ${data.cantidad.toFixed(2)} | Total: ${formatter.format(data.total)}</div>
        </div>`;
    }

    html += `<hr><div class="reporte-totales">
        <div>Total Efectivo: ${formatter.format(totalEfectivo)}</div>
        <div>Total Transferencia: ${formatter.format(totalTransferencia)}</div>
        <div style="font-size:1.1rem;">TOTAL GENERAL: ${formatter.format(total)}</div>
    </div>`;

    detalle.innerHTML = html;
    modalReporte.style.display = 'flex';
}

// Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('Error al registrar SW', err));
}