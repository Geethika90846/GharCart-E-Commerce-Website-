import express from 'express';
import { getDb } from '../db.js';

const router = express.Router();

// GET /api/products?search=&category=&sort=
router.get('/products', async (req, res) => {
  const db = await getDb();
  const search = req.query.search ? req.query.search.trim() : '';
  const category = req.query.category ? req.query.category.trim() : '';
  const sort = req.query.sort || 'default';

  try {
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category && category !== 'All') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (sort === 'price_asc') {
      query += ' ORDER BY price ASC';
    } else if (sort === 'price_desc') {
      query += ' ORDER BY price DESC';
    } else if (sort === 'rating') {
      query += ' ORDER BY rating DESC';
    } else {
      query += ' ORDER BY id DESC';
    }

    const products = db.prepare(query).all(...params);
    res.json({ success: true, products });
  } catch (err) {
    console.error('API products error:', err);
    res.status(500).json({ success: false, error: 'Database query failed' });
  }
});

// GET /api/cart/count
router.get('/cart/count', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.json({ count: 0 });
  }

  const db = await getDb();
  const userId = req.session.user.id;

  try {
    const row = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM cart_items WHERE user_id = ?').get(userId);
    res.json({ count: row ? row.total : 0 });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// POST /api/cart/add
router.post('/cart/add', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ success: false, message: 'Please log in as a customer to add items to cart.' });
  }

  const productId = Number(req.body.productId);
  const qtyToAdd = Math.max(1, Number(req.body.quantity) || 1);
  const userId = req.session.user.id;
  const db = await getDb();

  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (product.stock <= 0) {
      return res.status(400).json({ success: false, message: 'Sorry, this product is currently out of stock.' });
    }

    const existingCartItem = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, productId);

    let newQuantity = qtyToAdd;
    if (existingCartItem) {
      newQuantity = existingCartItem.quantity + qtyToAdd;
      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Cannot add more. You have ${existingCartItem.quantity} in cart, and stock is ${product.stock}.`
        });
      }
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQuantity, existingCartItem.id);
    } else {
      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} item(s) available in stock.`
        });
      }
      db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, productId, newQuantity);
    }

    const totalCountRow = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM cart_items WHERE user_id = ?').get(userId);

    res.json({
      success: true,
      cartCount: totalCountRow ? totalCountRow.total : 0,
      message: `Added ${product.name} to cart!`
    });
  } catch (err) {
    console.error('API cart add error:', err);
    res.status(500).json({ success: false, message: 'Failed to add item to cart.' });
  }
});

// POST /api/cart/update
router.post('/api/cart/update', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const productId = Number(req.body.productId);
  const newQty = Number(req.body.quantity);
  const userId = req.session.user.id;
  const db = await getDb();

  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (newQty <= 0) {
      db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(userId, productId);
    } else {
      if (newQty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units available in stock.`
        });
      }
      db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?').run(newQty, userId, productId);
    }

    // Calculate updated cart totals
    const cartItems = db.prepare(`
      SELECT c.quantity, p.price
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
    `).all(userId);

    const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const deliveryFee = subtotal > 0 ? (subtotal >= 999 ? 0 : 40) : 0;
    const total = subtotal + deliveryFee;
    const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

    res.json({
      success: true,
      cartCount,
      subtotal,
      deliveryFee,
      total,
      itemTotal: newQty > 0 ? product.price * newQty : 0
    });
  } catch (err) {
    console.error('API cart update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update cart.' });
  }
});

// POST /api/cart/remove
router.post('/cart/remove', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const productId = Number(req.body.productId);
  const userId = req.session.user.id;
  const db = await getDb();

  try {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(userId, productId);

    const cartItems = db.prepare(`
      SELECT c.quantity, p.price
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
    `).all(userId);

    const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const deliveryFee = subtotal > 0 ? (subtotal >= 999 ? 0 : 40) : 0;
    const total = subtotal + deliveryFee;
    const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

    res.json({
      success: true,
      cartCount,
      subtotal,
      deliveryFee,
      total,
      message: 'Item removed from cart.'
    });
  } catch (err) {
    console.error('API cart remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove item.' });
  }
});

// Support both /api/cart/update and /cart/update if mounted
router.post('/cart/update', (req, res, next) => {
  // forward to same logic
  req.url = '/api/cart/update';
  router.handle(req, res, next);
});

// GET /api/notifications
router.get('/notifications', async (req, res) => {
  if (!req.session.user) {
    return res.json({ notifications: [], unreadCount: 0 });
  }

  const db = await getDb();
  const userId = req.session.user.id;

  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 10
    `).all(userId);

    const unreadCount = notifications.filter(n => !n.is_read).length;

    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('API notifications error:', err);
    res.status(500).json({ notifications: [], unreadCount: 0 });
  }
});

// POST /api/notifications/read
router.post('/notifications/read', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false });
  }

  const db = await getDb();
  const userId = req.session.user.id;

  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Admin-only endpoints
// POST /api/admin/orders/:id/status
router.post('/admin/orders/:id/status', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  const orderId = Number(req.params.id);
  const { status } = req.body;

  const validStatuses = ['Placed', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid order status' });
  }

  const db = await getDb();

  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);

    // Create notification for customer
    let statusEmoji = '📦';
    if (status === 'Shipped') statusEmoji = '🚚';
    if (status === 'Delivered') statusEmoji = '🎉';
    if (status === 'Cancelled') statusEmoji = '❌';

    db.prepare(`
      INSERT INTO notifications (user_id, message)
      VALUES (?, ?)
    `).run(order.user_id, `Your order #${orderId} status has been updated to "${status}" ${statusEmoji}`);

    res.json({
      success: true,
      status,
      message: `Order #${orderId} updated to ${status}`
    });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/admin/products/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  const productId = Number(req.params.id);
  const db = await getDb();

  try {
    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Remove from cart_items first
    db.prepare('DELETE FROM cart_items WHERE product_id = ?').run(productId);

    // Delete product
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);

    res.json({
      success: true,
      message: `"${product.name}" deleted successfully.`
    });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

export default router;
