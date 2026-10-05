import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';

const DB_FILE = path.resolve('shop.db');

class SqliteWrapper {
  constructor(sqlInstance, rawDb, filePath) {
    this.SQL = sqlInstance;
    this.rawDb = rawDb;
    this.filePath = filePath;
    this.inTransaction = false;
  }

  save() {
    if (this.inTransaction) return;
    try {
      const data = this.rawDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.filePath, buffer);
    } catch (err) {
      console.error('Error saving SQLite database to disk:', err);
    }
  }

  exec(sql) {
    this.rawDb.exec(sql);
    this.save();
  }

  prepare(sql) {
    const self = this;
    return {
      run(...args) {
        const flatArgs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self.rawDb.prepare(sql);
        try {
          if (flatArgs && flatArgs.length > 0) {
            stmt.bind(flatArgs);
          }
          stmt.step();
          const changes = self.rawDb.getRowsModified();
          let lastInsertRowid = 0;
          const idRes = self.rawDb.exec('SELECT last_insert_rowid() AS id');
          if (idRes.length > 0 && idRes[0].values.length > 0) {
            lastInsertRowid = idRes[0].values[0][0];
          }
          self.save();
          return { changes, lastInsertRowid };
        } finally {
          stmt.free();
        }
      },

      get(...args) {
        const flatArgs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self.rawDb.prepare(sql);
        try {
          if (flatArgs && flatArgs.length > 0) {
            stmt.bind(flatArgs);
          }
          if (stmt.step()) {
            const row = stmt.getAsObject();
            return row;
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },

      all(...args) {
        const flatArgs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self.rawDb.prepare(sql);
        try {
          if (flatArgs && flatArgs.length > 0) {
            stmt.bind(flatArgs);
          }
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      }
    };
  }

  transaction(fn) {
    const self = this;
    return function (...args) {
      self.inTransaction = true;
      self.rawDb.exec('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        self.rawDb.exec('COMMIT');
        self.inTransaction = false;
        self.save();
        return result;
      } catch (err) {
        try {
          self.rawDb.exec('ROLLBACK');
        } catch (rbErr) {
          // ignore rollback error
        }
        self.inTransaction = false;
        throw err;
      }
    };
  }
}

let dbInstance = null;

export async function getDb() {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  let rawDb;

  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      rawDb = new SQL.Database(fileBuffer);
    } catch (e) {
      console.warn('Could not read existing shop.db, creating fresh database:', e.message);
      rawDb = new SQL.Database();
    }
  } else {
    rawDb = new SQL.Database();
  }

  rawDb.exec('PRAGMA foreign_keys = ON;');

  dbInstance = new SqliteWrapper(SQL, rawDb, DB_FILE);

  initSchema(dbInstance);

  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT,
      stock INTEGER DEFAULT 0,
      image_url TEXT,
      rating REAL DEFAULT 4.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER DEFAULT 1,
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      total REAL,
      status TEXT DEFAULT 'Placed',
      payment_method TEXT DEFAULT 'Cash on Delivery',
      full_name TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      pincode TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES orders(id),
      product_id INTEGER,
      product_name TEXT,
      price REAL,
      quantity INTEGER,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      message TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function seedDatabase(db) {
  // Check if users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

  let demoUserId = 2;

  if (userCount === 0) {
    console.log('Seeding initial admin and demo users...');
    const adminHash = bcrypt.hashSync('Admin@123', 10);
    const userHash = bcrypt.hashSync('User@123', 10);

    db.prepare(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('Store Admin', 'admin@shopsphere.com', '9876543210', adminHash, 'admin');

    const userRes = db.prepare(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('Demo User', 'user@shopsphere.com', '9812345678', userHash, 'user');

    demoUserId = userRes.lastInsertRowid;
  } else {
    const demoUser = db.prepare('SELECT id FROM users WHERE email = ?').get('user@shopsphere.com');
    if (demoUser) {
      demoUserId = demoUser.id;
    }
  }

  // Check if products exist
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (productCount === 0) {
    console.log('Seeding products...');
    let seeded = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://dummyjson.com/products?limit=24&select=title,description,price,category,stock,rating,thumbnail,images', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.products) && data.products.length > 0) {
          const insertStmt = db.prepare(`
            INSERT INTO products (name, description, price, category, stock, image_url, rating)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          for (const item of data.products) {
            const name = item.title;
            const description = item.description || 'Premium quality product crafted with high-grade materials for daily durability and optimal comfort.';
            const inrPrice = Math.round((item.price * 80) / 10) * 10;
            const category = item.category ? (item.category.charAt(0).toUpperCase() + item.category.slice(1)) : 'General';
            const stock = item.stock || 20;
            const rating = Math.min(5, Math.max(1, Number(item.rating) || 4.2));
            const imageUrl = (item.images && item.images.length > 0) ? item.images[0] : (item.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80');

            insertStmt.run(name, description, inrPrice, category, stock, imageUrl, rating);
          }
          seeded = true;
          console.log(`Seeded ${data.products.length} products from DummyJSON API`);
        }
      }
    } catch (apiErr) {
      console.warn('DummyJSON API fetch failed or timed out, using fallback mock products:', apiErr.message);
    }

    if (!seeded) {
      // 12 Fallback mock products as per specification
      const fallbackProducts = [
        { name: 'Wireless Headphones', category: 'Electronics', price: 2499, stock: 25, rating: 4.6, image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80', description: 'Immersive sound with active noise cancellation, 30-hour battery life, and plush memory-foam ear cushions.' },
        { name: 'Smart Watch Series 5', category: 'Electronics', price: 3999, stock: 15, rating: 4.8, image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80', description: 'Always-on AMOLED display, heart rate and SpO2 tracking, multiple workout modes, and waterproof design.' },
        { name: 'Bluetooth Speaker', category: 'Electronics', price: 1799, stock: 30, rating: 4.4, image_url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=600&q=80', description: 'Deep bass 360-degree acoustic projection with IPX7 waterproof casing and 12-hour continuous playtime.' },
        { name: 'Classic Cotton T-Shirt', category: 'Fashion', price: 599, stock: 60, rating: 4.3, image_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&q=80', description: 'Breathable 100% organic combed cotton, relaxed fit, durable double stitching, and pre-shrunk fabric.' },
        { name: 'Slim Fit Denim Jeans', category: 'Fashion', price: 1499, stock: 40, rating: 4.5, image_url: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80', description: 'Stretch denim designed for comfort and modern contour styling with classic five-pocket construction.' },
        { name: 'Running Sneakers', category: 'Footwear', price: 2199, stock: 20, rating: 4.7, image_url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80', description: 'Ultra-lightweight mesh upper with cushioned responsive EVA midsole for maximum impact absorption.' },
        { name: 'Leather Wallet', category: 'Accessories', price: 799, stock: 50, rating: 4.2, image_url: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=600&q=80', description: 'Genuine handcrafted grain leather bi-fold wallet featuring RFID blocking protection and slim profile.' },
        { name: 'Ceramic Coffee Mug Set', category: 'Home', price: 649, stock: 35, rating: 4.6, image_url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&q=80', description: 'Set of 4 artisan ceramic mugs with glazed finish, comfortable ergonomic handles, and microwave safe.' },
        { name: 'LED Desk Lamp', category: 'Home', price: 999, stock: 3, rating: 4.5, image_url: 'https://images.unsplash.com/photo-1534073828943-f801091bb18c?w=600&q=80', description: 'Eye-caring non-flicker LED lamp with 3 color temperatures, continuous touch dimming, and flexible gooseneck.' },
        { name: 'Yoga Mat Pro', category: 'Fitness', price: 899, stock: 45, rating: 4.7, image_url: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600&q=80', description: 'High-density anti-tear 6mm TPE mat with non-slip dual texture and carrying strap included.' },
        { name: 'Backpack 30L', category: 'Accessories', price: 1299, stock: 28, rating: 4.6, image_url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&q=80', description: 'Water-resistant urban backpack with dedicated padded laptop compartment (up to 15.6 inch) and ergonomic straps.' },
        { name: 'Organic Face Cleanser', category: 'Beauty', price: 449, stock: 0, rating: 4.1, image_url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&q=80', description: 'Gentle sulfate-free foaming face wash infused with aloe vera, tea tree extract, and vitamin E for glowing skin.' }
      ];

      const insertStmt = db.prepare(`
        INSERT INTO products (name, description, price, category, stock, image_url, rating)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const prod of fallbackProducts) {
        insertStmt.run(prod.name, prod.description, prod.price, prod.category, prod.stock, prod.image_url, prod.rating);
      }
      console.log('Seeded 12 fallback mock products');
    }
  }

  // Check if orders exist
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  if (orderCount === 0 && demoUserId) {
    console.log('Seeding sample orders for demo user...');
    const products = db.prepare('SELECT * FROM products LIMIT 4').all();

    if (products.length >= 2) {
      // Order 1: Shipped
      const order1 = db.prepare(`
        INSERT INTO orders (user_id, total, status, payment_method, full_name, phone, address, city, pincode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 days'))
      `).run(
        demoUserId,
        products[0].price + 40,
        'Shipped',
        'Cash on Delivery',
        'Demo User',
        '9812345678',
        'Flat 402, Sunshine Apartments, MG Road',
        'Bengaluru',
        '560001'
      );

      db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, price, quantity, image_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(order1.lastInsertRowid, products[0].id, products[0].name, products[0].price, 1, products[0].image_url);

      // Order 2: Delivered
      if (products.length >= 3) {
        const order2Total = (products[1].price * 2) + products[2].price;
        const order2 = db.prepare(`
          INSERT INTO orders (user_id, total, status, payment_method, full_name, phone, address, city, pincode, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-7 days'))
        `).run(
          demoUserId,
          order2Total,
          'Delivered',
          'Cash on Delivery',
          'Demo User',
          '9812345678',
          'Flat 402, Sunshine Apartments, MG Road',
          'Bengaluru',
          '560001'
        );

        db.prepare(`
          INSERT INTO order_items (order_id, product_id, product_name, price, quantity, image_url)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(order2.lastInsertRowid, products[1].id, products[1].name, products[1].price, 2, products[1].image_url);

        db.prepare(`
          INSERT INTO order_items (order_id, product_id, product_name, price, quantity, image_url)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(order2.lastInsertRowid, products[2].id, products[2].name, products[2].price, 1, products[2].image_url);
      }

      // Seed initial notifications for demo user
      db.prepare(`
        INSERT INTO notifications (user_id, message, is_read, created_at)
        VALUES (?, ?, ?, datetime('now', '-3 days'))
      `).run(demoUserId, 'Your order #1001 status has been updated to Shipped! 🚚', 0);

      db.prepare(`
        INSERT INTO notifications (user_id, message, is_read, created_at)
        VALUES (?, ?, ?, datetime('now', '-7 days'))
      `).run(demoUserId, 'Your order #1002 has been successfully Delivered. Thank you for shopping with GharCart! ✨', 1);

      db.prepare(`
        INSERT INTO notifications (user_id, message, is_read, created_at)
        VALUES (?, ?, ?, datetime('now', '-10 days'))
      `).run(demoUserId, 'Welcome to GharCart! Enjoy hassle-free shopping with Cash on Delivery.', 1);
    }
  }
}
