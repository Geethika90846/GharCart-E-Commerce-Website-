import express from 'express';
import session from 'express-session';
import path from 'path';
import dotenv from 'dotenv';
import { getDb, seedDatabase } from './db.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import apiRoutes from './routes/api.js';

dotenv.config();

const app = express();
const PORT = process.env.APP_PORT || 3000;

// Trust reverse proxy for Cloud Run and iframe environments
app.set('trust proxy', 1);

// Set EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.resolve('views'));

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static assets
app.use(express.static(path.resolve('public')));

// Express session configuration - configured for both localhost/HTTP and cross-origin iframe
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'gharcart_super_secret_session_key_2026',
  resave: true,
  saveUninitialized: true,
  proxy: true,
  cookie: {
    secure: false, // Allows session cookies over HTTP dev server / local environment
    sameSite: 'lax', // Compatible with standard browser navigation and form submissions
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
});
app.use(sessionMiddleware);

// Session hydration & dual-mode fallback for iframes
app.use((req, res, next) => {
  const sid = req.query.sid || req.body?.sid || req.headers['x-session-id'] || req.headers['authorization'];
  
  // Wrap res.redirect so all internal redirects carry the active sid token
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function (url) {
    const activeSid = sid || req.sessionID;
    if (activeSid && typeof url === 'string' && url.startsWith('/') && !url.includes('sid=')) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}sid=${encodeURIComponent(activeSid)}`;
    }
    return originalRedirect(url);
  };

  if (sid && req.sessionStore) {
    req.sessionStore.get(sid, (err, sess) => {
      if (!err && sess && sess.user) {
        req.session.user = sess.user;
        if (sess.checkoutDetails) req.session.checkoutDetails = sess.checkoutDetails;
        if (sess.flash) {
          req.session.flash = sess.flash;
          delete sess.flash;
          req.sessionStore.set(sid, sess, () => {});
        }
        res.locals.sid = sid;
        req.activeSid = sid;
      }
      next();
    });
  } else {
    next();
  }
});

// Global middleware for views
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.sid = (req.session && req.session.user && req.sessionID) ? req.sessionID : '';

  // Flash message
  if (req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  } else {
    res.locals.flash = null;
  }

  // Format price helper in INR
  res.locals.formatPrice = (amount) => {
    return '₹' + Number(amount || 0).toLocaleString('en-IN');
  };

  // Cart count & unread notifications
  res.locals.cartCount = 0;
  res.locals.unreadNotifications = 0;

  if (req.session.user) {
    try {
      const db = await getDb();
      if (req.session.user.role === 'user') {
        const cartRow = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM cart_items WHERE user_id = ?').get(req.session.user.id);
        res.locals.cartCount = cartRow ? cartRow.total : 0;
      }
      const notifRow = db.prepare('SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.user.id);
      res.locals.unreadNotifications = notifRow ? notifRow.total : 0;
    } catch (err) {
      console.error('Error fetching header metrics:', err);
    }
  }

  next();
});

// Mount routes
app.use('/api', apiRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', userRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404', {
    title: '404 - Page Not Found | GharCart',
    message: 'The page you are looking for might have been moved or does not exist.'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled express error:', err);
  res.status(500).render('404', {
    title: '500 - Server Error | GharCart',
    message: 'An unexpected error occurred. Please try again shortly.'
  });
});

// Initialize DB and start server
async function startServer() {
  try {
    const db = await getDb();
    await seedDatabase(db);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 GharCart is running live on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  }
}

startServer();
