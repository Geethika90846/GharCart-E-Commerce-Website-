import express from 'express';
import { body, validationResult } from 'express-validator';
import { getDb } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/register') {
    return next();
  }
  requireAdmin(req, res, next);
});

// GET /admin/dashboard
router.get('/dashboard', async (req, res) => {
  const db = await getDb();

  try {
    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = "user"').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const revenueRow = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status != "Cancelled"').get();
    const totalRevenue = revenueRow ? revenueRow.total : 0;

    const recentOrders = db.prepare(`
      SELECT o.*, u.name as customer_name, u.email as customer_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.id DESC
      LIMIT 5
    `).all();

    const products = db.prepare(`
      SELECT * FROM products
      ORDER BY id DESC
    `).all();

    res.render('admin-dashboard', {
      title: 'Admin Dashboard - GharCart',
      stats: {
        totalProducts,
        totalCustomers,
        totalOrders,
        totalRevenue
      },
      recentOrders,
      products
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).send('Server Error');
  }
});

// GET /admin/add-product
router.get('/add-product', async (req, res) => {
  const db = await getDb();
  try {
    const categoryRows = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
    const categories = categoryRows.map(r => r.category);

    res.render('admin-add-product', {
      title: 'Add New Product - GharCart Admin',
      categories,
      errors: [],
      formData: {}
    });
  } catch (err) {
    console.error('Add product page error:', err);
    res.status(500).send('Server Error');
  }
});

// POST /admin/add-product
router.post(
  '/add-product',
  [
    body('name').trim().notEmpty().withMessage('Product name is required.'),
    body('price').isFloat({ min: 1 }).withMessage('Price must be a valid positive amount.'),
    body('stock').isInt({ min: 0 }).withMessage('Stock must be 0 or more.'),
    body('image_url').trim().notEmpty().withMessage('Product image URL is required.').isURL().withMessage('Please enter a valid image URL.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const db = await getDb();

    let category = req.body.category || 'General';
    if (req.body.new_category && req.body.new_category.trim()) {
      category = req.body.new_category.trim();
    }

    if (!errors.isEmpty()) {
      const categoryRows = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
      return res.status(400).render('admin-add-product', {
        title: 'Add New Product - GharCart Admin',
        categories: categoryRows.map(r => r.category),
        errors: errors.array(),
        formData: req.body
      });
    }

    const { name, description, price, stock, image_url } = req.body;

    try {
      db.prepare(`
        INSERT INTO products (name, description, price, category, stock, image_url, rating)
        VALUES (?, ?, ?, ?, ?, ?, 4.5)
      `).run(
        name,
        description || 'High quality retail merchandise with verified standards.',
        parseFloat(price),
        category,
        parseInt(stock, 10),
        image_url
      );

      req.session.flash = {
        type: 'success',
        message: 'Product added successfully!'
      };

      res.redirect('/admin/dashboard');
    } catch (err) {
      console.error('Insert product error:', err);
      res.status(500).send('Server Error');
    }
  }
);

// GET /admin/edit-product/:id
router.get('/edit-product/:id', async (req, res) => {
  const productId = Number(req.params.id);
  const db = await getDb();

  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      req.session.flash = { type: 'error', message: 'Product not found.' };
      return res.redirect('/admin/dashboard');
    }

    const categoryRows = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
    const categories = categoryRows.map(r => r.category);

    res.render('admin-edit-product', {
      title: `Edit ${product.name} - GharCart Admin`,
      product,
      categories,
      errors: []
    });
  } catch (err) {
    console.error('Edit product page error:', err);
    res.status(500).send('Server Error');
  }
});

// POST /admin/edit-product/:id
router.post(
  '/edit-product/:id',
  [
    body('name').trim().notEmpty().withMessage('Product name is required.'),
    body('price').isFloat({ min: 1 }).withMessage('Price must be a valid positive amount.'),
    body('stock').isInt({ min: 0 }).withMessage('Stock must be 0 or more.'),
    body('image_url').trim().notEmpty().withMessage('Product image URL is required.').isURL().withMessage('Please enter a valid image URL.')
  ],
  async (req, res) => {
    const productId = Number(req.params.id);
    const errors = validationResult(req);
    const db = await getDb();

    let category = req.body.category || 'General';
    if (req.body.new_category && req.body.new_category.trim()) {
      category = req.body.new_category.trim();
    }

    if (!errors.isEmpty()) {
      const categoryRows = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
      return res.status(400).render('admin-edit-product', {
        title: 'Edit Product - GharCart Admin',
        product: { id: productId, ...req.body },
        categories: categoryRows.map(r => r.category),
        errors: errors.array()
      });
    }

    const { name, description, price, stock, image_url } = req.body;

    try {
      db.prepare(`
        UPDATE products
        SET name = ?, description = ?, price = ?, category = ?, stock = ?, image_url = ?
        WHERE id = ?
      `).run(
        name,
        description,
        parseFloat(price),
        category,
        parseInt(stock, 10),
        image_url,
        productId
      );

      req.session.flash = {
        type: 'success',
        message: 'Product updated successfully!'
      };

      res.redirect('/admin/dashboard');
    } catch (err) {
      console.error('Update product error:', err);
      res.status(500).send('Server Error');
    }
  }
);

// GET /admin/orders
router.get('/orders', async (req, res) => {
  const db = await getDb();
  const filterStatus = req.query.status || 'All';

  try {
    let query = `
      SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone
      FROM orders o
      JOIN users u ON o.user_id = u.id
    `;
    const params = [];

    if (filterStatus !== 'All') {
      query += ' WHERE o.status = ?';
      params.push(filterStatus);
    }

    query += ' ORDER BY o.id DESC';

    const orders = db.prepare(query).all(...params);

    const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    const enrichedOrders = orders.map(ord => ({
      ...ord,
      items: getItems.all(ord.id)
    }));

    res.render('admin-orders', {
      title: 'Manage Customer Orders - GharCart Admin',
      orders: enrichedOrders,
      filterStatus
    });
  } catch (err) {
    console.error('Admin orders error:', err);
    res.status(500).send('Server Error');
  }
});

// GET /admin/customers
router.get('/customers', async (req, res) => {
  const db = await getDb();
  const search = req.query.search ? req.query.search.trim() : '';

  try {
    let query = `
      SELECT u.id, u.name, u.email, u.phone, u.created_at,
             COUNT(o.id) as order_count,
             COALESCE(SUM(o.total), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.role = 'user'
    `;
    const params = [];

    if (search) {
      query += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' GROUP BY u.id ORDER BY u.id DESC';

    const customers = db.prepare(query).all(...params);

    res.render('admin-customers', {
      title: 'Customer Directory - GharCart Admin',
      customers,
      searchQuery: search
    });
  } catch (err) {
    console.error('Admin customers error:', err);
    res.status(500).send('Server Error');
  }
});

export default router;
