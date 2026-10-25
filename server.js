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

// Dinamik baseURL (Həm kompüterdə localhost, həm də Render-də internet linki üçün avtomatik işləyir)
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

// Ana səhifə birbaşa Spotify interfeysini açır
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Google Giriş
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google Callback - Qeydiyyat və Giriş izləmə sistemi
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

            // Bu e-poçt daha əvvəl qeydiyyatdan keçibmi?
            const isRegisteredBefore = history.some(item => item.email === userEmail && item.status === 'Qeydiyyat');
            
            // Əgər əvvəl yoxdursa "Qeydiyyat", varsa "Giriş" yazırıq
            const status = isRegisteredBefore ? 'Giriş' : 'Qeydiyyat';

            history.push({
                name: userName,
                email: userEmail,
                status: status, // Qeydiyyat və ya Giriş
                time: now
            });

            // Fayla yazırıq
            fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));

            // Terminalda səliqəli şəkildə göstəririk
            console.log(`\n================ SİSTEM HADİSƏSİ ===============`);
            console.log(`Status : ${status.toUpperCase()}`);
            console.log(`Ad     : ${userName}`);
            console.log(`Email  : ${userEmail}`);
            console.log(`Vaxt   : ${now}`);
            console.log(`=================================================\n`);
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

// Mahnı yükləmək - Kateqoriya dəstəyi ilə (Yalnız qurbanovq100000@gmail.com üçün qorunur)
app.post('/upload', upload.single('song'), (req, res) => {
    const userEmail = req.isAuthenticated() && req.user.emails && req.user.emails[0].value;
    const isOwner = userEmail === 'qurbanovq100000@gmail.com';

    if (!isOwner) {
        return res.status(403).send('İcazəniz yoxdur! Bu panel yalnız Qurban üçündür.');
    }
    
    if (!req.file) {
        return res.status(400).send('Fayl yüklənmədi!');
    }

    const category = req.body.category || 'All';

    io.emit('newSong', {
        name: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        category: category
    });
    res.redirect('/');
});

// Mahnı siyahısı (Kateqoriya məlumatı ilə birlikdə)
app.get('/songs', (req, res) => {
    fs.readdir('./uploads', (err, files) => {
        if (err) {
            return res.json([]);
        }
        const songList = files.map(file => {
            return {
                name: file.substring(file.indexOf('-') + 1),
                url: `/uploads/${file}`,
                category: 'All' // Əgər köhnə yüklənənlər varsa 'All' götürülür
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

// Dinamik port tənzimləməsi (Render və ya localhost üçün)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server işləyir: port ${PORT}`);
});