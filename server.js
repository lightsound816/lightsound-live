const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const uploadDir = path.join(__dirname, 'public/uploads');
const dbFile = path.join(__dirname, 'album.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify([]));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function saveToAlbum(item) {
    const raw = fs.readFileSync(dbFile);
    const album = JSON.parse(raw);
    album.unshift(item); // Lo más nuevo primero
    fs.writeFileSync(dbFile, JSON.stringify(album, null, 2));
}

// Endpoint unificado: Foto, Texto y/o Audio
app.post('/api/upload', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
    const { author, message } = req.body;
    const photoFile = req.files['photo'] ? req.files['photo'][0] : null;
    const audioFile = req.files['audio'] ? req.files['audio'][0] : null;

    if (!photoFile && !message && !audioFile) {
        return res.status(400).json({ error: 'No se envió contenido' });
    }

    const itemData = {
        id: Date.now(),
        author: author || 'Invitado',
        message: message || '',
        photoUrl: photoFile ? `/uploads/${photoFile.filename}` : null,
        audioUrl: audioFile ? `/uploads/${audioFile.filename}` : null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    saveToAlbum(itemData);

    // Si tiene foto o texto, se proyecta en la pantalla en vivo
    io.emit('new_content', itemData);
    res.json({ success: true, data: itemData });
});

// Obtener todo el álbum
app.get('/api/album', (req, res) => {
    const raw = fs.readFileSync(dbFile);
    res.json(JSON.parse(raw));
});

io.on('connection', (socket) => {
    socket.on('send_reaction', (emoji) => io.emit('show_reaction', emoji));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/screen.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));