import express from 'express';
import { body, validationResult } from 'express-validator';
import { getDb } from '../db.js';
import { requireUser } from '../middleware/auth.js';

const router = express.Router();

// GET /dashboard
router.get('/dashboard', requireUser, async (req, res) => {
  const db = await getDb();
  const search = req.query.search ? req.query.search.trim() : '';
  const category = req.query.category ? req.query.category.trim() : '';
  const sort = req.query.sort || 'default';

  try {
    const categories = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();

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

    res.render('dashboard', {
      title: 'Shop Best Deals - GharCart',
      products,
      categories: categories.map(c => c.category),
      selectedCategory: category || 'All',
      searchQuery: search,
      selectedSort: sort
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server Error');
  }
});

// GET /product/:id
router.get('/product/:id', requireUser, async (req, res) => {
  const productId = Number(req.params.id);
  const db = await getDb();

  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

    if (!product) {
      return res.status(404).render('404', {
        title: 'Product Not Found - GharCart',
        message: 'The product you are looking for does not exist or has been removed.'
      });
    }

    // Related products (same category, excluding current product)
    const relatedProducts = db.prepare(`
      SELECT * FROM products
      WHERE category = ? AND id != ?
      LIMIT 4
    `).all(product.category, product.id);

    res.render('product', {
      title: `${product.name} - GharCart`,
      product,
      relatedProducts
    });
  } catch (err) {
    console.error('Product page error:', err);
    res.status(500).send('Server Error');
  }
});

// GET /cart
router.get('/cart', requireUser, async (req, res) => {
  const db = await getDb();
  const userId = req.session.user.id;

  try {
    const cartItems = db.prepare(`
      SELECT c.id as cart_id, c.quantity, p.id as product_id, p.name, p.price, p.stock, p.image_url, p.category
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
      ORDER BY c.id DESC
    `).all(userId);

    const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const deliveryFee = subtotal > 0 ? (subtotal >= 999 ? 0 : 40) : 0;
    const total = subtotal + deliveryFee;

    res.render('cart', {
      title: 'Shopping Cart - GharCart',
      cartItems,
      subtotal,
      deliveryFee,
      total
    });
  } catch (err) {
    console.error('Cart page error:', err);
    res.status(500).send('Server Error');
  }
});

// GET /checkout
router.get('/checkout', requireUser, async (req, res) => {
  const db = await getDb();
  const userId = req.session.user.id;

  try {
    const cartItems = db.prepare(`
      SELECT c.quantity, p.id as product_id, p.name, p.price, p.stock, p.image_url
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
    `).all(userId);

    if (cartItems.length === 0) {
      req.session.flash = { type: 'error', message: 'Your cart is empty. Add products before checkout.' };
      return res.redirect('/cart');
    }

    const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const deliveryFee = subtotal >= 999 ? 0 : 40;
    const total = subtotal + deliveryFee;

    // Try to get address from last order or user profile
    let defaultAddress = req.session.checkoutDetails || {};
    if (!defaultAddress.address) {
      const lastOrder = db.prepare('SELECT full_name, phone, address, city, pincode FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
      if (lastOrder) {
        defaultAddress = lastOrder;
      } else {
        defaultAddress = {
          full_name: req.session.user.name,
          phone: req.session.user.phone || '',
          address: '',
          city: '',
          pincode: ''
        };
      }
    }

    res.render('checkout', {
      title: 'Checkout & Delivery Details - GharCart',
      cartItems,
      subtotal,
      deliveryFee,
      total,
      formData: defaultAddress,
      errors: []
    });
  } catch (err) {
    console.error('Checkout page error:', err);
    res.status(500).send('Server Error');
  }
});

// POST /checkout
router.post(
  '/checkout',
  requireUser,
  [
    body('full_name').trim().notEmpty().withMessage('Recipient full name is required.'),
    body('phone').trim().isLength({ min: 10 }).withMessage('Valid phone number (at least 10 digits) is required.'),
    body('address').trim().notEmpty().withMessage('Delivery address is required.'),
    body('city').trim().notEmpty().withMessage('City is required.'),
    body('pincode').trim().isLength({ min: 6 }).withMessage('Valid 6-digit postal pincode is required.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const db = await getDb();
    const userId = req.session.user.id;

    const cartItems = db.prepare(`
      SELECT c.quantity, p.id as product_id, p.name, p.price, p.stock, p.image_url
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
    `).all(userId);

    const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const deliveryFee = subtotal >= 999 ? 0 : 40;
    const total = subtotal + deliveryFee;

    if (!errors.isEmpty()) {
      return res.status(400).render('checkout', {
        title: 'Checkout & Delivery Details - GharCart',
        cartItems,
        subtotal,
        deliveryFee,
        total,
        formData: req.body,
        errors: errors.array()
      });
    }

    req.session.checkoutDetails = {
      full_name: req.body.full_name,
      phone: req.body.phone,
      address: req.body.address,
      city: req.body.city,
      pincode: req.body.pincode
    };

    req.session.save(() => {
      res.redirect('/payment' + (req.sessionID ? '?sid=' + req.sessionID : ''));
    });
  }
);

// GET /payment
router.get('/payment', requireUser, async (req, res) => {
  const db = await getDb();
  const userId = req.session.user.id;

  let shipping = req.session.checkoutDetails;
  if (!shipping || !shipping.address) {
    const lastOrder = db.prepare('SELECT full_name, phone, address, city, pincode FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
    if (lastOrder) {
      shipping = lastOrder;
    } else {
      shipping = {
        full_name: req.session.user.name,
        phone: req.session.user.phone || '9876543210',
        address: '123 MG Road, Central Market',
        city: 'Bengaluru',
        pincode: '560001'
      };
    }
    req.session.checkoutDetails = shipping;
  }

  try {
    const cartItems = db.prepare(`
      SELECT c.quantity, p.id as product_id, p.name, p.price, p.stock, p.image_url
      FROM cart_items c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
    `).all(userId);

    if (cartItems.length === 0) {
      req.session.flash = { type: 'error', message: 'Your cart is empty.' };
      return res.redirect('/cart');
    }

    const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const deliveryFee = subtotal >= 999 ? 0 : 40;
    const total = subtotal + deliveryFee;

    res.render('payment', {
      title: 'Payment (Cash on Delivery) - GharCart',
      cartItems,
      subtotal,
      deliveryFee,
      total,
      shippingDetails: shipping
    });
  } catch (err) {
    console.error('Payment page error:', err);
    res.status(500).send('Server Error');
  }
});

// POST /place-order
router.post('/place-order', requireUser, async (req, res) => {
  const db = await getDb();
  const userId = req.session.user.id;
  let shipping = req.session.checkoutDetails;

  if (!shipping || !shipping.address) {
    if (req.body && req.body.address && req.body.full_name) {
      shipping = {
        full_name: req.body.full_name,
        phone: req.body.phone,
        address: req.body.address,
        city: req.body.city,
        pincode: req.body.pincode
      };
    } else {
      const lastOrder = db.prepare('SELECT full_name, phone, address, city, pincode FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
      if (lastOrder) {
        shipping = lastOrder;
      } else {
        shipping = {
          full_name: req.session.user.name,
          phone: req.session.user.phone || '9876543210',
          address: '123 MG Road, Central Market',
          city: 'Bengaluru',
          pincode: '560001'
        };
      }
    }
    req.session.checkoutDetails = shipping;
  }

  try {
    // Perform order placement inside a transaction
    const placeOrderTx = db.transaction(() => {
      const cartItems = db.prepare(`
        SELECT c.id as cart_id, c.quantity, p.id as product_id, p.name, p.price, p.stock, p.image_url
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
        WHERE c.user_id = ?
      `).all(userId);

      if (cartItems.length === 0) {
        throw new Error('Your cart is empty.');
      }

      // Check stock availability
      for (const item of cartItems) {
        if (item.quantity > item.stock) {
          throw new Error(`Insufficient stock for "${item.name}". Only ${item.stock} item(s) left.`);
        }
      }

      const subtotal = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
      const deliveryFee = subtotal >= 999 ? 0 : 40;
      const grandTotal = subtotal + deliveryFee;

      // Create order
      const orderInsert = db.prepare(`
        INSERT INTO orders (user_id, total, status, payment_method, full_name, phone, address, city, pincode)
        VALUES (?, ?, 'Placed', 'Cash on Delivery', ?, ?, ?, ?, ?)
      `).run(
        userId,
        grandTotal,
        shipping.full_name,
        shipping.phone,
        shipping.address,
        shipping.city,
        shipping.pincode
      );

      const orderId = orderInsert.lastInsertRowid;

      // Insert order items and decrease product stock
      const insertOrderItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, price, quantity, image_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const decrementStock = db.prepare(`
        UPDATE products
        SET stock = stock - ?
        WHERE id = ?
      `);

      for (const item of cartItems) {
        insertOrderItem.run(
          orderId,
          item.product_id,
          item.name,
          item.price,
          item.quantity,
          item.image_url
        );

        decrementStock.run(item.quantity, item.product_id);
      }

      // Clear cart
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);

      // Create notification
      db.prepare(`
        INSERT INTO notifications (user_id, message)
        VALUES (?, ?)
      `).run(userId, `Your order #${orderId} has been placed successfully! 🎉`);

      return orderId;
    });

    const newOrderId = placeOrderTx();

    delete req.session.checkoutDetails;
    req.session.flash = {
      type: 'success',
      message: '🎉 Your order has been placed!'
    };

    req.session.save(() => {
      res.redirect(`/order-success/${newOrderId}` + (req.sessionID ? '?sid=' + req.sessionID : ''));
    });
  } catch (err) {
    console.error('Place order error:', err);
    req.session.flash = {
      type: 'error',
      message: err.message || 'Failed to place order. Please try again.'
    };
    req.session.save(() => {
      res.redirect('/cart' + (req.sessionID ? '?sid=' + req.sessionID : ''));
    });
  }
});

// GET /order-success/:id
router.get('/order-success/:id', requireUser, async (req, res) => {
  const orderId = Number(req.params.id);
  const db = await getDb();
  const userId = req.session.user.id;

  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);

    if (!order) {
      return res.status(404).render('404', {
        title: 'Order Not Found - GharCart',
        message: 'Could not find the requested order details.'
      });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

    res.render('order-success', {
      title: 'Order Placed Successfully! - GharCart',
      order,
      items
    });
  } catch (err) {
    console.error('Order success error:', err);
    res.status(500).send('Server Error');
  }
});

// GET /orders
router.get('/orders', requireUser, async (req, res) => {
  const db = await getDb();
  const userId = req.session.user.id;

  try {
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(userId);

    // Fetch items for each order
    const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    const enrichedOrders = orders.map(ord => ({
      ...ord,
      items: getItems.all(ord.id)
    }));

    res.render('orders', {
      title: 'My Orders - GharCart',
      orders: enrichedOrders
    });
  } catch (err) {
    console.error('Orders page error:', err);
    res.status(500).send('Server Error');
  }
});

export default router;
