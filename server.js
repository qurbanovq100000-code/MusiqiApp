const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Sessiya tənzimləmələri
app.use(session({
    secret: 'musiqi_gizli_kalit',
    resave: false,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

// Statik fayllar
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Multer tənzimləməsi
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Dinamik baseURL
const baseURL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";

// Passport Google Strategy
passport.use(new GoogleStrategy({
    clientID: '626813770669-9a71u7c8ddipq8fa9fi0kb17lghd0hvb.apps.googleusercontent.com',
    clientSecret: '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',
    callbackURL: `${baseURL}/auth/google/callback`
  },
  function(accessToken, refreshToken, profile, cb) {
    return cb(null, profile);
  }
));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// Ana səhifə
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Google Giriş
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google Callback
app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        if (req.user) {
            const userName = req.user.displayName;
            const userEmail = req.user.emails && req.user.emails[0].value;
            const now = new Date().toLocaleString();
            const historyFilePath = path.join(__dirname, 'users_history.json');

            let history = [];
            if (fs.existsSync(historyFilePath)) {
                try {
                    history = JSON.parse(fs.readFileSync(historyFilePath, 'utf8'));
                } catch (e) {
                    history = [];
                }
            }

            const isRegisteredBefore = history.some(item => item.email === userEmail && item.status === 'Qeydiyyat');
            const status = isRegisteredBefore ? 'Giriş' : 'Qeydiyyat';

            history.push({
                name: userName,
                email: userEmail,
                status: status,
                time: now
            });

            fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
        }

        res.redirect('/');
    }
);

// İstifadəçi statusu və Sərt Email yoxlaması
app.get('/current-user', (req, res) => {
    if (req.isAuthenticated()) {
        const userEmail = req.user.emails && req.user.emails[0].value;
        
        if (userEmail === 'qurbanovq100000@gmail.com') {
            res.json({ 
                loggedIn: true, 
                displayName: req.user.displayName,
                isAdmin: true 
            });
        } else {
            res.json({ 
                loggedIn: true, 
                displayName: req.user.displayName,
                isAdmin: false 
            });
        }
    } else {
        res.json({ loggedIn: false, isAdmin: false });
    }
});

// Mahnı yükləmək - Kateqoriyanı yoxlayan versiya
app.post('/upload', upload.single('song'), (req, res) => {
    const userEmail = req.isAuthenticated() && req.user.emails && req.user.emails[0].value;
    const isOwner = userEmail === 'qurbanovq100000@gmail.com';

    if (!isOwner) {
        return res.status(403).json({ error: 'İcazəniz yoxdur!' });
    }
    
    if (!req.file) {
        return res.status(400).json({ error: 'Fayl yüklənmədi!' });
    }

    // Gələn məlumatları terminalda yoxlayaq
    console.log("REQ.BODY:", req.body);

    const category = req.body.category || 'All';
    console.log(`Fayl adı: ${req.file.originalname} | Seçilən Kateqoriya: ${category}`);

    const originalName = req.file.originalname;
    const fileUrl = `/uploads/${req.file.filename}`;

    const metaFilePath = path.join(__dirname, 'songs_meta.json');
    let songsMeta = [];
    if (fs.existsSync(metaFilePath)) {
        try {
            songsMeta = JSON.parse(fs.readFileSync(metaFilePath, 'utf8'));
        } catch (e) {
            songsMeta = [];
        }
    }

    songsMeta = songsMeta.filter(m => m.filename !== req.file.filename);

    songsMeta.push({
        filename: req.file.filename,
        name: originalName,
        url: fileUrl,
        category: category
    });

    fs.writeFileSync(metaFilePath, JSON.stringify(songsMeta, null, 2));

    io.emit('newSong', {
        name: originalName,
        url: fileUrl,
        category: category
    });
    
    res.json({ success: true, name: originalName, url: fileUrl, category: category });
});

// Mahnı siyahısı
app.get('/songs', (req, res) => {
    fs.readdir('./uploads', (err, files) => {
        if (err) {
            return res.json([]);
        }

        const metaFilePath = path.join(__dirname, 'songs_meta.json');
        let songsMeta = [];
        if (fs.existsSync(metaFilePath)) {
            try {
                songsMeta = JSON.parse(fs.readFileSync(metaFilePath, 'utf8'));
            } catch (e) {
                songsMeta = [];
            }
        }

        const songList = files.map(file => {
            const meta = songsMeta.find(m => m.filename === file);
            return {
                name: file.substring(file.indexOf('-') + 1),
                url: `/uploads/${file}`,
                category: meta ? meta.category : 'All'
            };
        });
        
        res.json(songList);
    });
});

// Çıxış
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

// Socket.io
io.on('connection', (socket) => {
    socket.on('disconnect', () => {});
});

// Dinamik port tənzimləməsi
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server işləyir: port ${PORT}`);
});