const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const uploadDir = path.join(__dirname, 'public/uploads');
const dbFile = path.join(__dirname, 'album.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify([]));

// Configuración de Multer para Fotos, Audios y Videos (Límite 60MB)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        let ext = path.extname(file.originalname);
        if (!ext) {
            if (file.fieldname === 'audio') ext = '.mp4';
            else if (file.fieldname === 'video') ext = '.mp4';
            else ext = '.jpg';
        }
        cb(null, `${Date.now()}-${file.fieldname}${ext}`);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 60 * 1024 * 1024 } // Límite de 60 MB
});

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

// Endpoint unificado: Foto, Video, Audio y Texto
app.post('/api/upload', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), (req, res) => {
    try {
        const author = req.body.author || 'Invitado';
        const message = req.body.message || '';
        
        const photoFile = (req.files && req.files['photo']) ? req.files['photo'][0] : null;
        const videoFile = (req.files && req.files['video']) ? req.files['video'][0] : null;
        const audioFile = (req.files && req.files['audio']) ? req.files['audio'][0] : null;

        if (!photoFile && !videoFile && !message.trim() && !audioFile) {
            return res.status(400).json({ error: 'No se envió contenido válido' });
        }

        const itemData = {
            id: Date.now(),
            author: author,
            message: message.trim(),
            photoUrl: photoFile ? `/uploads/${photoFile.filename}` : null,
            videoUrl: videoFile ? `/uploads/${videoFile.filename}` : null,
            audioUrl: audioFile ? `/uploads/${audioFile.filename}` : null,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        saveToAlbum(itemData);
        
        // Emitir a la pantalla para encolar
        io.emit('new_content', itemData);

        return res.status(200).json({ success: true, data: itemData });
    } catch (error) {
        console.error('Error en /api/upload:', error);
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

// Descargar álbum completo en ZIP
app.get('/api/download-album', (req, res) => {
    try {
        const zip = new AdmZip();

        if (fs.existsSync(uploadDir)) {
            const files = fs.readdirSync(uploadDir);
            files.forEach(file => {
                const fullPath = path.join(uploadDir, file);
                if (fs.statSync(fullPath).isFile()) {
                    zip.addLocalFile(fullPath, 'archivos_multimedia');
                }
            });
        }

        let textReport = "=====================================================\n";
        textReport += "   LIBRO DE RECUERDOS Y DEDICATORIAS - LIGHTSOUND   \n";
        textReport += "=====================================================\n\n";

        let album = [];
        if (fs.existsSync(dbFile)) {
            try {
                const raw = fs.readFileSync(dbFile, 'utf8');
                album = JSON.parse(raw || '[]');
            } catch (e) { album = []; }
        }

        album.forEach((item, index) => {
            textReport += `[Recuerdo #${index + 1}]\n`;
            textReport += `De: ${item.author || 'Invitado'}\n`;
            textReport += `Hora: ${item.timestamp || 'N/A'}\n`;
            if (item.message) textReport += `Mensaje: "${item.message}"\n`;
            if (item.photoUrl) textReport += `Foto: ${path.basename(item.photoUrl)}\n`;
            if (item.videoUrl) textReport += `Video: ${path.basename(item.videoUrl)}\n`;
            if (item.audioUrl) textReport += `Audio: ${path.basename(item.audioUrl)}\n`;
            textReport += "-----------------------------------------------------\n\n";
        });

        zip.addFile('Dedicatorias_y_Mensajes.txt', Buffer.from(textReport, 'utf8'));

        const zipBuffer = zip.toBuffer();
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', 'attachment; filename="Album-Recuerdos-LightSound.zip"');
        res.set('Content-Length', zipBuffer.length);
        return res.send(zipBuffer);
    } catch (err) {
        console.error('Error generando ZIP:', err);
        return res.status(500).send('Error al procesar la descarga');
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/screen.html')));

io.on('connection', (socket) => {
    socket.on('send_reaction', (emoji) => io.emit('show_reaction', emoji));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));