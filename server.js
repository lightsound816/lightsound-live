const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Rutas de almacenamiento local
const uploadDir = path.join(__dirname, 'public/uploads');
const dbFile = path.join(__dirname, 'album.json');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify([]));
}

// Configuración de Multer
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

// Endpoint de recepción de fotos / mensajes / audios
app.post('/api/upload', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
    try {
        const author = req.body.author || 'Invitado';
        const message = req.body.message || '';
        
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
        io.emit('new_content', itemData);

        return res.status(200).json({ success: true, data: itemData });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener datos del álbum
app.get('/api/album', (req, res) => {
    try {
        if (!fs.existsSync(dbFile)) return res.json([]);
        const raw = fs.readFileSync(dbFile, 'utf8');
        res.json(JSON.parse(raw || '[]'));
    } catch (e) {
        res.status(500).json({ error: 'Error al leer el álbum' });
    }
});

// Endpoint de descarga de ZIP
app.get('/api/download-album', (req, res) => {
    try {
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        // Configurar nombre de descarga
        res.attachment('Album-Recuerdos-LightSound.zip');

        archive.on('error', (err) => {
            console.error('Error al empaquetar:', err);
            if (!res.headersSent) {
                res.status(500).send('Error interno en compresión');
            }
        });

        archive.pipe(res);

        // 1. Agregar archivos si la carpeta existe
        if (fs.existsSync(uploadDir)) {
            archive.directory(uploadDir, 'archivos_multimedia');
        }

        // 2. Generar el reporte de dedicatorias
        let textReport = "=== LIBRO DE RECUERDOS Y DEDICATORIAS - LIGHT SOUND ===\n\n";
        if (fs.existsSync(dbFile)) {
            try {
                const raw = fs.readFileSync(dbFile, 'utf8');
                const album = JSON.parse(raw || '[]');
                album.forEach((item, index) => {
                    textReport += `[#${index + 1}] De: ${item.author} (${item.timestamp})\n`;
                    if (item.message) textReport += `Mensaje: "${item.message}"\n`;
                    if (item.photoUrl) textReport += `Foto: ${item.photoUrl}\n`;
                    if (item.audioUrl) textReport += `Audio: ${item.audioUrl}\n`;
                    textReport += "--------------------------------------------------\n\n";
                });
            } catch (e) {
                textReport += "No se pudieron recuperar las dedicatorias en texto.\n";
            }
        }

        archive.append(textReport, { name: 'Dedicatorias_y_Mensajes.txt' });

        // Finalizar compresión
        archive.finalize();

    } catch (err) {
        console.error('Error general en endpoint:', err);
        if (!res.headersSent) {
            res.status(500).send('Error al procesar la descarga');
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/screen.html'));
});

io.on('connection', (socket) => {
    socket.on('send_reaction', (emoji) => {
        io.emit('show_reaction', emoji);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));