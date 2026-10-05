import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { getDb } from '../db.js';
import { redirectIfLoggedIn, redirectIfUserLoggedIn, redirectIfAdminLoggedIn } from '../middleware/auth.js';

const router = express.Router();

// Root route: redirect based on auth status
router.get('/', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

// GET /quick-login: 1-Click instant direct login for Demo User or Store Admin
router.get('/quick-login', async (req, res) => {
  const role = req.query.role === 'admin' ? 'admin' : 'user';
  const targetEmail = role === 'admin' ? 'admin@shopsphere.com' : 'user@shopsphere.com';
  const db = await getDb();

  try {
    let user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(targetEmail);
    if (!user) {
      // Re-seed demo user if missing
      const passHash = bcrypt.hashSync(role === 'admin' ? 'Admin@123' : 'User@123', 10);
      const insertRes = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, role)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        role === 'admin' ? 'Store Admin' : 'Demo User',
        targetEmail,
        role === 'admin' ? '9876543210' : '9812345678',
        passHash,
        role
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(insertRes.lastInsertRowid);
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    };

    req.session.flash = {
      type: 'success',
      message: `Signed in successfully as ${user.name} (${user.role.toUpperCase()})!`
    };

    req.session.save(() => {
      res.redirect(role === 'admin' ? '/admin/dashboard' : '/dashboard');
    });
  } catch (err) {
    console.error('Quick login error:', err);
    res.redirect(role === 'admin' ? '/admin/login' : '/login');
  }
});

// GET /register
router.get('/register', redirectIfUserLoggedIn, (req, res) => {
  res.render('register', {
    title: 'Create Account - GharCart',
    errors: [],
    formData: {}
  });
});

// POST /register
router.post(
  '/register',
  (req, res, next) => {
    // Autofill resilience: if confirm_password wasn't filled by browser autofill, sync from password
    if (req.body.password && !req.body.confirm_password) {
      req.body.confirm_password = req.body.password;
    }
    next();
  },
  [
    body('name').trim().notEmpty().withMessage('Full name is required.'),
    body('email').trim().isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone number is required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.'),
    body('confirm_password').custom((value, { req }) => {
      if (value && value !== req.body.password) {
        throw new Error('Passwords do not match.');
      }
      return true;
    })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const db = await getDb();

    if (!errors.isEmpty()) {
      return res.status(400).render('register', {
        title: 'Create Account - GharCart',
        errors: errors.array(),
        formData: req.body
      });
    }

    const { name, phone, password } = req.body;
    const email = req.body.email.toLowerCase().trim();

    try {
      const existingUser = db.prepare('SELECT id, role, password_hash, name, phone FROM users WHERE LOWER(email) = LOWER(?)').get(email);
      if (existingUser) {
        // If password matches existing user, seamlessly log them in!
        const isMatch = bcrypt.compareSync(password, existingUser.password_hash);
        if (isMatch) {
          req.session.user = {
            id: existingUser.id,
            name: existingUser.name,
            email,
            phone: existingUser.phone,
            role: existingUser.role
          };
          req.session.flash = {
            type: 'success',
            message: `Welcome back, ${existingUser.name}!`
          };
          return req.session.save(() => {
            res.redirect(existingUser.role === 'admin' ? '/admin/dashboard' : '/dashboard');
          });
        }

        return res.status(400).render('register', {
          title: 'Create Account - GharCart',
          errors: [{ msg: 'An account with this email address already exists. Please log in directly.' }],
          isExistingUser: true,
          formData: req.body
        });
      }

      const password_hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, role)
        VALUES (?, ?, ?, ?, 'user')
      `).run(name, email, phone, password_hash);

      const newUserId = result.lastInsertRowid;

      // Create welcome notification
      db.prepare(`
        INSERT INTO notifications (user_id, message)
        VALUES (?, ?)
      `).run(newUserId, 'Welcome to GharCart! Enjoy shopping with Cash on Delivery.');

      // Automatically sign in the registered user
      req.session.user = {
        id: newUserId,
        name,
        email,
        phone,
        role: 'user'
      };

      req.session.flash = {
        type: 'success',
        message: `🎉 Welcome to GharCart, ${name}! Your customer account is ready.`
      };

      req.session.save(() => {
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Registration error:', err);
      return res.status(500).render('register', {
        title: 'Create Account - GharCart',
        errors: [{ msg: 'An unexpected error occurred. Please try again.' }],
        formData: req.body
      });
    }
  }
);

// GET /login
router.get('/login', redirectIfUserLoggedIn, (req, res) => {
  res.render('login', {
    title: 'Customer Login - GharCart',
    errors: [],
    email: ''
  });
});

// POST /login
router.post(
  '/login',
  [
    body('email').trim().notEmpty().withMessage('Enter your email address.'),
    body('password').notEmpty().withMessage('Password is required.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('login', {
        title: 'Customer Login - GharCart',
        errors: errors.array(),
        email: req.body.email
      });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const { password } = req.body;
    const db = await getDb();

    try {
      const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);

      if (!user) {
        return res.status(400).render('login', {
          title: 'Customer Login - GharCart',
          errors: [{ msg: 'Invalid email or password.' }],
          email
        });
      }

      const isMatch = bcrypt.compareSync(password, user.password_hash);
      if (!isMatch) {
        return res.status(400).render('login', {
          title: 'Customer Login - GharCart',
          errors: [{ msg: 'Invalid email or password.' }],
          email
        });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      };

      req.session.flash = {
        type: 'success',
        message: `Welcome back, ${user.name}!`
      };

      req.session.save((err) => {
        if (err) console.error('Session save error:', err);
        if (user.role === 'admin') {
          return res.redirect('/admin/dashboard');
        }
        return res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).render('login', {
        title: 'Customer Login - GharCart',
        errors: [{ msg: 'An unexpected error occurred. Please try again.' }],
        email
      });
    }
  }
);

// GET /admin/login
router.get('/admin/login', redirectIfAdminLoggedIn, (req, res) => {
  res.render('admin-login', {
    title: 'Admin Portal Login - GharCart',
    errors: [],
    email: ''
  });
});

// POST /admin/login
router.post(
  '/admin/login',
  [
    body('email').trim().notEmpty().withMessage('Enter admin email address.'),
    body('password').notEmpty().withMessage('Password is required.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin-login', {
        title: 'Admin Portal Login - GharCart',
        errors: errors.array(),
        email: req.body.email
      });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const { password } = req.body;
    const db = await getDb();

    try {
      const admin = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);

      if (!admin) {
        return res.status(400).render('admin-login', {
          title: 'Admin Portal Login - GharCart',
          errors: [{ msg: 'No administrator account found with this email.' }],
          email
        });
      }

      const isMatch = bcrypt.compareSync(password, admin.password_hash);
      if (!isMatch) {
        return res.status(400).render('admin-login', {
          title: 'Admin Portal Login - GharCart',
          errors: [{ msg: 'Invalid administrator credentials.' }],
          email
        });
      }

      req.session.user = {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role
      };

      req.session.flash = {
        type: 'success',
        message: 'Welcome to GharCart Admin Portal!'
      };

      req.session.save((err) => {
        if (err) console.error('Admin session save error:', err);
        if (admin.role === 'admin') {
          return res.redirect('/admin/dashboard');
        }
        // If a customer logged in via admin page, redirect to customer dashboard
        return res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Admin login error:', err);
      return res.status(500).render('admin-login', {
        title: 'Admin Portal Login - GharCart',
        errors: [{ msg: 'An unexpected error occurred. Please try again.' }],
        email
      });
    }
  }
);

// GET /admin/register
router.get('/admin/register', redirectIfAdminLoggedIn, (req, res) => {
  res.render('admin-register', {
    title: 'Register Administrator - GharCart',
    errors: [],
    formData: {
      secret_key: 'GharCartAdmin2026'
    }
  });
});

// POST /admin/register
router.post(
  '/admin/register',
  (req, res, next) => {
    // Autofill resilience
    if (req.body.password && !req.body.confirm_password) {
      req.body.confirm_password = req.body.password;
    }
    if (!req.body.secret_key) {
      req.body.secret_key = 'GharCartAdmin2026';
    }
    next();
  },
  [
    body('name').trim().notEmpty().withMessage('Full name is required.'),
    body('email').trim().isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone number is required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.'),
    body('confirm_password').custom((value, { req }) => {
      if (value && value !== req.body.password) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),
    body('secret_key').custom((value) => {
      const expectedKey = process.env.ADMIN_SECRET_KEY || 'GharCartAdmin2026';
      if (value && value !== expectedKey) {
        throw new Error('Invalid Admin Secret Passcode. Use default: GharCartAdmin2026');
      }
      return true;
    })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const db = await getDb();

    if (!errors.isEmpty()) {
      return res.status(400).render('admin-register', {
        title: 'Register Administrator - GharCart',
        errors: errors.array(),
        formData: req.body
      });
    }

    const { name, phone, password } = req.body;
    const email = req.body.email.toLowerCase().trim();

    try {
      const existingUser = db.prepare('SELECT id, password_hash, role, name FROM users WHERE LOWER(email) = LOWER(?)').get(email);
      if (existingUser) {
        const isMatch = bcrypt.compareSync(password, existingUser.password_hash);
        if (isMatch && existingUser.role === 'admin') {
          req.session.user = {
            id: existingUser.id,
            name: existingUser.name,
            email,
            phone: existingUser.phone,
            role: 'admin'
          };
          req.session.flash = {
            type: 'success',
            message: `Welcome back to Admin Portal, ${existingUser.name}!`
          };
          return req.session.save(() => res.redirect('/admin/dashboard'));
        }

        return res.status(400).render('admin-register', {
          title: 'Register Administrator - GharCart',
          errors: [{ msg: 'An account with this email address already exists. Please log in directly.' }],
          formData: req.body
        });
      }

      const password_hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, role)
        VALUES (?, ?, ?, ?, 'admin')
      `).run(name, email, phone, password_hash);

      const newAdminId = result.lastInsertRowid;

      // Automatically sign in the registered admin
      req.session.user = {
        id: newAdminId,
        name,
        email,
        phone,
        role: 'admin'
      };

      req.session.flash = {
        type: 'success',
        message: `🎉 Administrator account registered successfully! Welcome, ${name}.`
      };

      req.session.save(() => {
        res.redirect('/admin/dashboard');
      });
    } catch (err) {
      console.error('Admin registration error:', err);
      return res.status(500).render('admin-register', {
        title: 'Register Administrator - GharCart',
        errors: [{ msg: 'An unexpected error occurred. Please try again.' }],
        formData: req.body
      });
    }
  }
);

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// GET /admin/logout
router.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

export default router;
