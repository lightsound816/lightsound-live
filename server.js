const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Rutas de almacenamiento
const uploadDir = path.join(__dirname, 'public/uploads');
const dbFile = path.join(__dirname, 'album.json');

// Crear carpeta uploads y base de datos local si no existen
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify([]));
}

// Configuración de Multer con extensión segura
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (file.fieldname === 'audio' ? '.mp4' : '.jpg');
        cb(null, `${Date.now()}-${file.fieldname}${ext}`);
    }
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Función segura para guardar en el álbum
function saveToAlbum(item) {
    try {
        let album = [];
        if (fs.existsSync(dbFile)) {
            const raw = fs.readFileSync(dbFile, 'utf8');
            album = raw ? JSON.parse(raw) : [];
        }
        album.unshift(item);
        fs.writeFileSync(dbFile, JSON.stringify(album, null, 2));
    } catch (err) {
        console.error('Error al guardar en album.json:', err);
    }
}

// Endpoint de recepción con validaciones seguras
app.post('/api/upload', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
    try {
        const author = req.body.author || 'Invitado';
        const message = req.body.message || '';
        
        // Extracción segura de archivos (evita error si no vienen)
        const photoFile = (req.files && req.files['photo'] && req.files['photo'][0]) ? req.files['photo'][0] : null;
        const audioFile = (req.files && req.files['audio'] && req.files['audio'][0]) ? req.files['audio'][0] : null;

        if (!photoFile && !message.trim() && !audioFile) {
            return res.status(400).json({ error: 'No se envió contenido válido' });
        }

        const itemData = {
            id: Date.now(),
            author: author,
            message: message.trim(),
            photoUrl: photoFile ? `/uploads/${photoFile.filename}` : null,
            audioUrl: audioFile ? `/uploads/${audioFile.filename}` : null,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        saveToAlbum(itemData);

        // Emitir en vivo a la pantalla
        io.emit('new_content', itemData);

        return res.status(200).json({ success: true, data: itemData });
    } catch (error) {
        console.error('Error en /api/upload:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener registros del álbum
app.get('/api/album', (req, res) => {
    try {
        if (!fs.existsSync(dbFile)) return res.json([]);
        const raw = fs.readFileSync(dbFile, 'utf8');
        res.json(JSON.parse(raw || '[]'));
    } catch (e) {
        res.status(500).json({ error: 'Error al leer el álbum' });
    }
});

// Ruta raíz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/screen.html'));
});

// Socket.io para reacciones
io.on('connection', (socket) => {
    socket.on('send_reaction', (emoji) => {
        io.emit('show_reaction', emoji);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});